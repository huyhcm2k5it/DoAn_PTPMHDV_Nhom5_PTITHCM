//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"umccare/diagnostic/internal/application/ports"
	"umccare/diagnostic/internal/application/usecase"
	"umccare/diagnostic/internal/domain"
)

func TestSharedBillingEventsDoNotPolluteDiagnosticRetries(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	r := usecase.NewReceiver(usecase.New(db, time.Now), db)
	for _, owner := range []string{"APPOINTMENT", "MED_HOLD"} {
		for _, typ := range []string{"ChargePrepared", "ChargePaid", "SettlementDecision"} {
			var p map[string]any
			source := domain.NewID()
			switch typ {
			case "ChargePrepared":
				p = map[string]any{"requestId": domain.NewID(), "sourceType": owner, "sourceId": source, "sourceRevision": 1, "chargeId": domain.NewID(), "state": "CREATED"}
			case "ChargePaid":
				p = map[string]any{"chargeId": domain.NewID(), "sourceType": owner, "sourceId": source, "sourceRevision": 1, "settlementId": domain.NewID(), "transactionId": "TXN_FOREIGN", "fence": 1, "amountVND": 100000, "paidAt": time.Now()}
			default:
				p = map[string]any{"settlementId": domain.NewID(), "sourceId": source, "sourceRevision": 1, "decisionVersion": 1, "state": "FAILED"}
			}
			m := msg(typ, "EVENT", "billing", domain.NewID(), domain.NewID(), p)
			body, _ := json.Marshal(m)
			route := map[string]string{"ChargePrepared": "billing.charge-prepared.v1", "ChargePaid": "billing.charge-paid.v1", "SettlementDecision": "billing.settlement-decision.v1"}[typ]
			in := ports.Incoming{MessageID: m.MessageID, Exchange: "umc.events.billing.v1", RoutingKey: route, Body: body}
			// Deliver twice to verify the normal durable inbox deduplicates it.
			for i := 0; i < 2; i++ {
				if err := r.Receive(ctx, in); err != nil {
					t.Fatal(err)
				}
			}
		}
	}
	var processed, retries, dead, orders, objects, outgoing int
	err := db.pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM inbox WHERE status='PROCESSED'),
		(SELECT count(*) FROM retry_jobs),(SELECT count(*) FROM dead_letters),
		(SELECT count(*) FROM lab_orders),(SELECT count(*) FROM objects),(SELECT count(*) FROM outbox)`).Scan(&processed, &retries, &dead, &orders, &objects, &outgoing)
	if err != nil || processed != 6 || retries != 0 || dead != 0 || orders != 0 || objects != 0 || outgoing != 0 {
		t.Fatalf("foreign billing receipts=%d retries=%d dead=%d orders=%d objects=%d outbox=%d err=%v", processed, retries, dead, orders, objects, outgoing, err)
	}
}
