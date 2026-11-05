//go:build integration

package postgres

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"github.com/golang-jwt/jwt/v5"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
	httpadapter "umccare/diagnostic/internal/adapters/inbound/http"
	"umccare/diagnostic/internal/application/ports"
	"umccare/diagnostic/internal/application/usecase"
	"umccare/diagnostic/internal/domain"
)

func TestDiagnosticCatalogSnapshotImport(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	testID, priceID := domain.NewID(), domain.NewID()
	testRaw, _ := json.Marshal(map[string]any{"id": testID, "code": "SNAP-LAB", "name": "Snapshot LAB", "unit": "U", "referenceRange": "1-2", "revision": 4, "status": "ACTIVE"})
	priceRaw, _ := json.Marshal(map[string]any{"priceVersionId": priceID, "itemId": testID, "itemType": "LAB", "amountVnd": 75000, "revision": 4, "effectiveFrom": time.Now().UTC().Add(-time.Hour)})
	entries := []CatalogSnapshotEntry{{EntityType: "LAB_TEST", EntityID: testID, EntityVersion: 4, Mode: "UPSERT", FullSnapshot: testRaw}, {EntityType: "PRICE_VERSION", EntityID: priceID, EntityVersion: 4, Mode: "UPSERT", FullSnapshot: priceRaw}}
	canonical, _ := json.Marshal(entries)
	sum := sha256.Sum256(canonical)
	snapshot := CatalogSnapshotImport{SchemaVersion: 1, Watermark: 17, GeneratedAt: time.Now().UTC(), Checksum: hex.EncodeToString(sum[:]), Entities: entries}
	if err := db.ImportCatalogSnapshot(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	if err := db.Within(ctx, "", func(tx ports.Tx) error {
		var checkpoint struct {
			Sequence int64
			At       time.Time
		}
		raw, err := tx.Get(ctx, "catalog", "checkpoint")
		if err != nil {
			return err
		}
		if json.Unmarshal(raw, &checkpoint) != nil || checkpoint.Sequence != 17 || checkpoint.At.IsZero() {
			t.Fatalf("checkpoint %+v", checkpoint)
		}
		var prices []usecase.PriceProjection
		raw, err = tx.Get(ctx, "LAB_PRICES", testID)
		if err != nil {
			return err
		}
		if json.Unmarshal(raw, &prices) != nil || len(prices) != 1 || prices[0].PriceVersionID != priceID {
			t.Fatalf("prices %+v", prices)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func testDB(t *testing.T) *Probe {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("TEST_DATABASE_URL required")
	}
	ctx := context.Background()
	admin, e := New(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	schema := "diag_test_" + strings.ReplaceAll(domain.NewID(), "-", "")
	if _, e = admin.pool.Exec(ctx, "CREATE SCHEMA "+schema); e != nil {
		t.Fatal(e)
	}
	u, e := url.Parse(dsn)
	if e != nil {
		t.Fatal(e)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, e := New(ctx, u.String())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { db.Close(); admin.pool.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE"); admin.Close() })
	if e = db.Migrate(ctx); e != nil {
		t.Fatal(e)
	}
	return db
}
func msg(typ, kind, producer, aggregate, request string, p any) domain.Envelope {
	b, _ := json.Marshal(p)
	return domain.Envelope{MessageID: domain.NewID(), MessageKind: kind, MessageType: typ, Producer: producer, SchemaVersion: 1, AggregateID: aggregate, AggregateVersion: 1, RequestID: request, CorrelationID: domain.NewID(), CausationID: domain.NewID(), OccurredAt: time.Now().UTC(), Payload: b}
}
func setup(t *testing.T, db *Probe) (*usecase.Service, domain.CreateInput, domain.Principal) {
	t.Helper()
	ctx := context.Background()
	s := usecase.New(db, time.Now)
	tech := domain.Principal{UserID: domain.NewID(), ActorType: "STAFF", TokenVersion: 1, Capabilities: []string{"LAB_TECH"}}
	test := domain.TestSnapshot{TestID: domain.NewID(), Revision: 1, Code: "CBC", Name: "Blood count", Unit: "g/L", ReferenceRange: "10-20"}
	in := domain.CreateInput{RequestID: domain.NewID(), VisitID: domain.NewID(), PatientID: domain.NewID(), DoctorID: domain.NewID(), Tests: []domain.TestSnapshot{test}, AuthorizedAt: time.Now().UTC()}
	in.RequestHash = in.Hash()
	e := db.Within(ctx, "diagnostic:business", func(tx ports.Tx) error {
		items := []struct {
			k, id string
			v     any
		}{{"access", tech.UserID, domain.Access{UserID: tech.UserID, ActorType: tech.ActorType, Status: "ACTIVE", TokenVersion: 1, Capabilities: tech.Capabilities}}, {"patient", in.PatientID, map[string]any{"ownerUserId": domain.NewID(), "active": true}}, {"TEST", test.TestID, map[string]any{"id": test.TestID, "code": test.Code, "name": test.Name, "unit": test.Unit, "referenceRange": test.ReferenceRange, "revision": 1, "status": "ACTIVE"}}, {"LAB_PRICE", test.TestID, map[string]any{"itemId": test.TestID, "itemType": "LAB", "priceVersionId": domain.NewID(), "revision": 1, "amountVnd": 50000, "effectiveFrom": time.Now().Add(-time.Hour)}}, {"catalog", "checkpoint", map[string]any{"sequence": 1, "at": time.Now()}}}
		for _, x := range items {
			if e := tx.Put(ctx, x.k, x.id, x.v); e != nil {
				return e
			}
		}
		return nil
	})
	if e != nil {
		t.Fatal(e)
	}
	return s, in, tech
}
func createOrder(t *testing.T, db *Probe, s *usecase.Service, in domain.CreateInput) domain.Order {
	t.Helper()
	m := msg("CreateLabOrder", "COMMAND", "clinical", in.RequestID, in.RequestID, in)
	if e := s.Handle(context.Background(), "umc.commands.clinical.v1", "diagnostic.create-lab-order.v1", m); e != nil {
		t.Fatal(e)
	}
	var out domain.Order
	db.Within(context.Background(), "", func(tx ports.Tx) error {
		xs, e := tx.Orders(context.Background())
		if e == nil {
			out = xs[0]
		}
		return e
	})
	return out
}
func pay(t *testing.T, s *usecase.Service, o domain.Order) {
	t.Helper()
	ctx := context.Background()
	settlement, charge := domain.NewID(), domain.NewID()
	request := "" // use owner request stored in aggregate
	request = o.Stored().ChargeRequestID
	events := []struct {
		typ, kind, route string
		p                any
	}{{"ChargePrepared", "EVENT", "billing.charge-prepared.v1", map[string]any{"requestId": request, "sourceType": "LAB_ORDER", "sourceId": o.ID, "sourceRevision": 1, "chargeId": charge, "state": "CREATED", "reasonCode": ""}}, {"ReserveSettlement", "COMMAND", "diagnostic.reserve-settlement.v1", map[string]any{"settlementId": settlement, "chargeId": charge, "sourceType": "LAB_ORDER", "sourceId": o.ID, "sourceRevision": 1, "amountHash": o.AmountHash, "attemptVersion": 1}}, {"ChargePaid", "EVENT", "billing.charge-paid.v1", map[string]any{"chargeId": charge, "sourceType": "LAB_ORDER", "sourceId": o.ID, "sourceRevision": 1, "settlementId": settlement, "fence": 1, "transactionId": domain.NewID(), "amountVnd": o.AmountVND, "paidAt": time.Now()}}}
	for _, v := range events {
		x := "umc.events.billing.v1"
		if v.kind == "COMMAND" {
			x = "umc.commands.billing.v1"
		}
		if e := s.Handle(ctx, x, v.route, msg(v.typ, v.kind, "billing", o.ID, domain.NewID(), v.p)); e != nil {
			t.Fatal(e)
		}
	}
}
func TestCreateDedupeAndSampleConcurrency(t *testing.T) {
	db := testDB(t)
	s, in, p := setup(t, db)
	o := createOrder(t, db, s, in)
	m := msg("CreateLabOrder", "COMMAND", "clinical", in.RequestID, in.RequestID, in)
	if e := s.Handle(context.Background(), "umc.commands.clinical.v1", "diagnostic.create-lab-order.v1", m); e != nil {
		t.Fatal(e)
	}
	var count int
	db.pool.QueryRow(context.Background(), "SELECT count(*) FROM outbox WHERE envelope->>'messageType'='RequestCharge'").Scan(&count)
	if count != 1 {
		t.Fatal("duplicate charge", count)
	}
	if _, e := s.Sample(context.Background(), p, o.ID, domain.NewID(), domain.SampleInput{}, false); domain.Code(e) != "ORDER_NOT_PAID" {
		t.Fatal("unpaid sample", e)
	}
	pay(t, s, o)
	var wg sync.WaitGroup
	success := make(chan bool, 2)
	for n := 0; n < 2; n++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, e := s.Sample(context.Background(), p, o.ID, domain.NewID(), domain.SampleInput{}, false)
			success <- e == nil
		}()
	}
	wg.Wait()
	close(success)
	wins := 0
	for x := range success {
		if x {
			wins++
		}
	}
	if wins != 1 {
		t.Fatal("sample race", wins)
	}
	in.Tests[0].Name = "tampered"
	in.RequestHash = in.Hash()
	m = msg("CreateLabOrder", "COMMAND", "clinical", in.RequestID, in.RequestID, in)
	if e := s.Handle(context.Background(), "umc.commands.clinical.v1", "diagnostic.create-lab-order.v1", m); domain.Code(e) != "INVALID_MESSAGE" {
		t.Fatal("request conflict accepted", e)
	}
}
func TestRealDiagnosticHTTP(t *testing.T) {
	db := testDB(t)
	s, in, p := setup(t, db)
	o := createOrder(t, db, s, in)
	key, e := rsa.GenerateKey(rand.Reader, 2048)
	if e != nil {
		t.Fatal(e)
	}
	token, e := jwt.NewWithClaims(jwt.SigningMethodRS256, httpadapter.Claims{ActorType: p.ActorType, TokenVersion: 1, Capabilities: p.Capabilities, RegisteredClaims: jwt.RegisteredClaims{Subject: p.UserID, Issuer: "diag-test", Audience: jwt.ClaimStrings{"umc-test"}, IssuedAt: jwt.NewNumericDate(time.Now().Add(-time.Second)), ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Minute))}}).SignedString(key)
	if e != nil {
		t.Fatal(e)
	}
	server := httpadapter.New(db, httpadapter.Options{App: s, Auth: httpadapter.NewJWT(&key.PublicKey, "diag-test", "umc-test"), Ready: db.BusinessReady})
	fixtures := map[string]any{}
	request := func(method, path string, body any, status int, name string) map[string]any {
		t.Helper()
		b, _ := json.Marshal(body)
		r := httptest.NewRequest(method, path, strings.NewReader(string(b)))
		r.Header.Set("Authorization", "Bearer "+token)
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Idempotency-Key", domain.NewID())
		w := httptest.NewRecorder()
		server.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatal(method, path, w.Code, w.Body.String())
		}
		var result map[string]any
		if e = json.Unmarshal(w.Body.Bytes(), &result); e != nil {
			t.Fatal(e)
		}
		if name != "" {
			fixtures[name] = result
		}
		return result
	}
	request("GET", "/api/v1/diagnostic-orders", nil, 200, "ListResponse")
	request("GET", "/api/v1/diagnostic-orders/"+o.ID, nil, 200, "DetailResponse")
	request("POST", "/api/v1/diagnostic-orders/"+o.ID+"/specimens", map[string]any{}, 409, "Error")
	pay(t, s, o)
	result := request("POST", "/api/v1/diagnostic-orders/"+o.ID+"/specimens", map[string]any{"barcode": "SAMPLE-A"}, 201, "SpecimenDataResponse")
	sp := result["data"].(map[string]any)["specimen"].(map[string]any)
	request("POST", "/api/v1/specimens/"+sp["id"].(string)+"/reject", map[string]any{"reasonCode": "HEMOLYSIS", "expectedVersion": 1}, 200, "")
	request("POST", "/api/v1/diagnostic-orders/"+o.ID+"/recollect", map[string]any{"barcode": "SAMPLE-A"}, 409, "")
	request("POST", "/api/v1/diagnostic-orders/"+o.ID+"/recollect", map[string]any{"barcode": "SAMPLE-B"}, 201, "")
	request("POST", "/api/v1/diagnostic-orders", map[string]any{}, 405, "")
	request("POST", "/api/v1/diagnostic-orders/"+o.ID+"/specimens", map[string]any{"chargeState": "PAID"}, 400, "")
	if path := os.Getenv("DIAGNOSTIC_CONTRACT_RESPONSE_FILE"); path != "" {
		b, _ := json.MarshalIndent(fixtures, "", "  ")
		if e = os.WriteFile(path, b, 0600); e != nil {
			t.Fatal(e)
		}
	}
}

// TestClinicalCreateLabWire consumes the actual Clinical PostgreSQL/outbox fixture.
// CI may provide the same file as a cross-service artifact; no Go service imports are shared.
func TestClinicalCreateLabWire(t *testing.T) {
	path := os.Getenv("CLINICAL_CREATE_LAB_WIRE_FILE")
	if path == "" {
		t.Skip("CLINICAL_CREATE_LAB_WIRE_FILE not supplied; independent service jobs do not share artifacts")
	}
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var envelope domain.Envelope
	if err = json.Unmarshal(body, &envelope); err != nil {
		t.Fatal(err)
	}
	var input domain.CreateInput
	if err = json.Unmarshal(envelope.Payload, &input); err != nil {
		t.Fatal(err)
	}
	if err = input.Validate(); err != nil {
		t.Fatal("Clinical payload incompatible", err)
	}
	db := testDB(t)
	ctx := context.Background()
	s := usecase.New(db, time.Now)
	err = db.Within(ctx, "diagnostic:business", func(tx ports.Tx) error {
		for _, v := range []struct {
			kind, key string
			value     any
		}{
			{"patient", input.PatientID, map[string]any{"ownerUserId": domain.NewID(), "active": true}},
			{"DOCTOR", input.DoctorID, map[string]any{"identityUserId": domain.NewID()}},
			{"catalog", "checkpoint", map[string]any{"sequence": 1, "at": time.Now().UTC()}},
		} {
			if e := tx.Put(ctx, v.kind, v.key, v.value); e != nil {
				return e
			}
		}
		for _, test := range input.Tests {
			if e := tx.Put(ctx, "TEST", test.TestID, map[string]any{"id": test.TestID, "code": test.Code, "name": test.Name, "unit": test.Unit, "referenceRange": test.ReferenceRange, "revision": test.Revision, "status": "ACTIVE"}); e != nil {
				return e
			}
			if e := tx.Put(ctx, "LAB_PRICE", test.TestID, map[string]any{"itemId": test.TestID, "itemType": "LAB", "priceVersionId": domain.NewID(), "revision": 1, "amountVnd": 50000, "effectiveFrom": input.AuthorizedAt.Add(-time.Hour)}); e != nil {
				return e
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	receiver := usecase.NewReceiver(s, db)
	delivery := ports.Incoming{MessageID: envelope.MessageID, Exchange: "umc.commands.clinical.v1", RoutingKey: "diagnostic.create-lab-order.v1", Body: body}
	if err = receiver.Receive(ctx, delivery); err != nil {
		t.Fatal(err)
	}
	// Both transport redelivery and a distinct message with the same business ID are safe.
	if err = receiver.Receive(ctx, delivery); err != nil {
		t.Fatal(err)
	}
	envelope.MessageID = domain.NewID()
	delivery.MessageID = envelope.MessageID
	delivery.Body, _ = json.Marshal(envelope)
	if err = receiver.Receive(ctx, delivery); err != nil {
		t.Fatal(err)
	}
	var orders, charges, resolved, dead int
	if err = db.pool.QueryRow(ctx, "SELECT count(*) FROM lab_orders").Scan(&orders); err != nil {
		t.Fatal(err)
	}
	db.pool.QueryRow(ctx, "SELECT count(*) FROM outbox WHERE envelope->>'messageType'='RequestCharge'").Scan(&charges)
	db.pool.QueryRow(ctx, "SELECT count(*) FROM outbox WHERE envelope->>'messageType'='LabOrderResolved'").Scan(&resolved)
	db.pool.QueryRow(ctx, "SELECT count(*) FROM dead_letters").Scan(&dead)
	if orders != 1 || charges != 1 || resolved != 1 || dead != 0 {
		t.Fatalf("Clinical wire produced orders=%d charges=%d resolved=%d dead=%d", orders, charges, resolved, dead)
	}
	var reply []byte
	if err = db.pool.QueryRow(ctx, "SELECT envelope FROM outbox WHERE envelope->>'messageType'='LabOrderResolved'").Scan(&reply); err != nil {
		t.Fatal(err)
	}
	var event domain.Envelope
	var payload struct{ RequestID, VisitID, OrderID, State string }
	if json.Unmarshal(reply, &event) != nil || json.Unmarshal(event.Payload, &payload) != nil || payload.RequestID != input.RequestID || payload.VisitID != input.VisitID || payload.State != "CREATED" || !domain.ValidID(payload.OrderID) {
		t.Fatal("Invalid return event", string(reply))
	}
	if output := os.Getenv("DIAGNOSTIC_LAB_RESOLVED_WIRE_FILE"); output != "" {
		if err = os.WriteFile(output, reply, 0600); err != nil {
			t.Fatal(err)
		}
	}
}
func TestProjectionImportAndLiveShareRevisionGuard(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	user := domain.NewID()
	s := usecase.New(db, time.Now)
	imported := func(version int, status string) error {
		b, _ := json.Marshal(domain.Access{UserID: user, ActorType: "STAFF", Status: status, TokenVersion: 1, Capabilities: []string{"LAB_TECH"}})
		return db.ImportProjections(ctx, []ProjectionImport{{Kind: "access", Key: user, Value: b, Version: version}})
	}
	live := func(version int, status string) error {
		return s.Handle(ctx, "umc.events.identity.v1", "identity.identity-access-changed.v1", func() domain.Envelope {
			m := msg("IdentityAccessChanged", "EVENT", "identity", user, domain.NewID(), map[string]any{"userId": user, "actorType": "STAFF", "status": status, "tokenVersion": 1, "capabilities": []string{"LAB_TECH"}, "phoneVerified": true, "version": version})
			m.AggregateVersion = version
			return m
		}())
	}
	status := func() string {
		var a domain.Access
		err := db.Within(ctx, "", func(tx ports.Tx) error {
			b, e := tx.Get(ctx, "access", user)
			if e != nil {
				return e
			}
			return json.Unmarshal(b, &a)
		})
		if err != nil {
			t.Fatal(err)
		}
		return a.Status
	}
	if e := imported(1, "ACTIVE"); e != nil {
		t.Fatal(e)
	}
	if e := live(5, "SUSPENDED"); e != nil {
		t.Fatal(e)
	}
	if e := imported(2, "ACTIVE"); e != nil {
		t.Fatal(e)
	}
	if status() != "SUSPENDED" {
		t.Fatal("stale bootstrap regranted access")
	}
	if e := imported(6, "ACTIVE"); e != nil {
		t.Fatal(e)
	}
	if e := live(2, "SUSPENDED"); e != nil {
		t.Fatal(e)
	}
	if status() != "ACTIVE" {
		t.Fatal("stale live projection overwrote import")
	}
	if e := live(6, "ACTIVE"); e != nil {
		t.Fatal("semantically identical revision rejected", e)
	}
	if e := live(6, "SUSPENDED"); domain.Code(e) != "INVALID_MESSAGE" {
		t.Fatal("equal revision conflict accepted", e)
	}
}
func TestCatalogGapBlocksQuotes(t *testing.T) {
	db := testDB(t)
	s, in, _ := setup(t, db)
	ctx := context.Background()
	checkpoint := func() domain.Envelope {
		id := "00000000-0000-4000-8000-000000000000"
		at := time.Now().UTC()
		return msg("CatalogChanged", "EVENT", "catalog", id, domain.NewID(), map[string]any{"entityType": "STREAM", "entityId": id, "entityVersion": 1, "fullSnapshot": map[string]any{"sequence": 2, "at": at}, "effectiveAt": at, "streamSequence": 2, "mode": "CHECKPOINT"})
	}
	m := checkpoint()
	if e := s.Handle(ctx, "umc.events.catalog.v1", "catalog.changed.v1", m); domain.Code(e) != "SERVICE_UNAVAILABLE" {
		t.Fatal("gap not retryable", e)
	}
	cmd := msg("CreateLabOrder", "COMMAND", "clinical", in.RequestID, in.RequestID, in)
	if e := s.Handle(ctx, "umc.commands.clinical.v1", "diagnostic.create-lab-order.v1", cmd); domain.Code(e) != "SERVICE_UNAVAILABLE" {
		t.Fatal("fresh checkpoint permitted quote during known gap", e)
	}
	price := usecase.PriceProjection{ItemID: in.Tests[0].TestID, ItemType: "LAB", PriceVersionID: domain.NewID(), Revision: 2, AmountVND: 99, EffectiveFrom: in.AuthorizedAt.Add(-time.Minute)}
	p := msg("CatalogChanged", "EVENT", "catalog", price.ItemID, domain.NewID(), map[string]any{"entityType": "PRICE_VERSION", "entityId": price.PriceVersionID, "entityVersion": 2, "fullSnapshot": price, "effectiveAt": price.EffectiveFrom, "streamSequence": 2, "mode": "UPSERT"})
	p.AggregateVersion = 2
	if e := s.Handle(ctx, "umc.events.catalog.v1", "catalog.changed.v1", p); e != nil {
		t.Fatal(e)
	}
	if e := s.Handle(ctx, "umc.events.catalog.v1", "catalog.changed.v1", m); e != nil {
		t.Fatal(e)
	}
	if e := s.Handle(ctx, "umc.commands.clinical.v1", "diagnostic.create-lab-order.v1", cmd); e != nil {
		t.Fatal("caught-up stream unavailable", e)
	}
}
func TestReserveReplyAndWithdrawalPersisted(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	s, in, _ := setup(t, db)
	o := createOrder(t, db, s, in)
	charge := domain.NewID()
	prep := msg("ChargePrepared", "EVENT", "billing", o.ID, domain.NewID(), map[string]any{"requestId": o.Stored().ChargeRequestID, "sourceType": "LAB_ORDER", "sourceId": o.ID, "sourceRevision": 1, "chargeId": charge, "state": "CREATED", "reasonCode": ""})
	if e := s.Handle(ctx, "umc.events.billing.v1", "billing.charge-prepared.v1", prep); e != nil {
		t.Fatal(e)
	}
	reserve := func(id string) domain.Envelope {
		return msg("ReserveSettlement", "COMMAND", "billing", o.ID, domain.NewID(), map[string]any{"settlementId": id, "chargeId": charge, "sourceType": "LAB_ORDER", "sourceId": o.ID, "sourceRevision": 1, "amountHash": o.AmountHash, "attemptVersion": 1})
	}
	a, b := domain.NewID(), domain.NewID()
	for _, id := range []string{a, b} {
		if e := s.Handle(ctx, "umc.commands.billing.v1", "diagnostic.reserve-settlement.v1", reserve(id)); e != nil {
			t.Fatal(e)
		}
	}
	decision := msg("SettlementDecision", "EVENT", "billing", o.ID, domain.NewID(), map[string]any{"settlementId": a, "sourceId": o.ID, "sourceRevision": 1, "decisionVersion": 1, "state": "FAILED", "fence": 1})
	if e := s.Handle(ctx, "umc.events.billing.v1", "billing.settlement-decision.v1", decision); e != nil {
		t.Fatal(e)
	}
	if e := s.Handle(ctx, "umc.commands.billing.v1", "diagnostic.reserve-settlement.v1", reserve(b)); e != nil {
		t.Fatal(e)
	}
	var count int
	db.pool.QueryRow(ctx, `SELECT count(DISTINCT envelope->'payload') FROM outbox WHERE envelope->>'messageType'='SettlementReserved' AND envelope->'payload'->>'settlementId'=$1`, b).Scan(&count)
	if count != 1 {
		t.Fatal("reserve replay changed", count)
	}
	// Withdraw the actual projected immutable price, retaining historical authorization semantics.
	var price usecase.PriceProjection
	db.Within(ctx, "", func(tx ports.Tx) error {
		raw, e := tx.Get(ctx, "LAB_PRICE", in.Tests[0].TestID)
		if e != nil {
			return e
		}
		return json.Unmarshal(raw, &price)
	})
	at := time.Now().UTC()
	event := msg("CatalogChanged", "EVENT", "catalog", price.ItemID, domain.NewID(), map[string]any{"entityType": "PRICE_VERSION", "entityId": price.PriceVersionID, "entityVersion": price.Revision, "fullSnapshot": price, "effectiveAt": at, "streamSequence": 2, "mode": "TOMBSTONE"})
	event.AggregateVersion = price.Revision
	if e := s.Handle(ctx, "umc.events.catalog.v1", "catalog.changed.v1", event); e != nil {
		t.Fatal(e)
	}
	in.RequestID = domain.NewID()
	in.AuthorizedAt = at.Add(time.Millisecond)
	in.RequestHash = in.Hash()
	if e := s.Handle(ctx, "umc.commands.clinical.v1", "diagnostic.create-lab-order.v1", msg("CreateLabOrder", "COMMAND", "clinical", in.RequestID, in.RequestID, in)); domain.Code(e) != "SERVICE_UNAVAILABLE" {
		t.Fatal("withdrawn price permitted new charge", e)
	}
}
