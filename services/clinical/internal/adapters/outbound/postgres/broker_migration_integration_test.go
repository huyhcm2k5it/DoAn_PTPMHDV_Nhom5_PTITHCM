//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"umccare/clinical/internal/application/ports"
	"umccare/clinical/internal/domain"
	"umccare/clinical/migrations"
)

func TestBrokerMigrationPreservesPendingWork(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	tx, err := db.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	schema := "upgrade_" + strings.ReplaceAll(domain.NewID(), "-", "")
	if _, err = tx.Exec(ctx, "CREATE SCHEMA "+schema+"; SET LOCAL search_path TO "+schema); err != nil {
		t.Fatal(err)
	}
	for _, file := range []string{"000001_clinical.up.sql", "000002_treatment.up.sql", "000003_catalog_stream.up.sql", "000004_lab_terminal.up.sql", "000005_lab_resubmit.up.sql", "000006_visit_grants.up.sql", "000007_treatment_normalization.up.sql"} {
		raw, e := migrations.Files.ReadFile(file)
		if e != nil {
			t.Fatal(e)
		}
		if _, e = tx.Exec(ctx, string(raw)); e != nil {
			t.Fatal(file, e)
		}
	}

	orphan, lost := domain.NewID(), domain.NewID()
	if _, err = tx.Exec(ctx, `INSERT INTO inbox(message_id,payload_hash,status)
        VALUES($1,'orphan-hash','RETRY_SCHEDULED'),($2,'lost-hash','RETRY_SCHEDULED')`, orphan, lost); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO retry_jobs(message_id,exchange_name,routing_key,body,payload_hash,attempt,due_at,status)
        VALUES($1,'umc.events.identity.v1','identity.identity-access-changed.v1',$2,'orphan-hash',2,now(),'PROCESSED')`, orphan, []byte("old-body")); err != nil {
		t.Fatal(err)
	}

	message, dead := domain.NewID(), domain.NewID()
	if _, err = tx.Exec(ctx, `INSERT INTO inbox(message_id,payload_hash,status) VALUES($1,'legacy-hash','RETRY_SCHEDULED')`, message); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO retry_jobs(message_id,exchange_name,routing_key,body,payload_hash,attempt,due_at)
        VALUES($1,'umc.events.identity.v1','identity.identity-access-changed.v1',$2,'legacy-hash',2,now()+interval '15 seconds')`, message, []byte(`{"legacy":true}`)); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO dead_letters(id,message_id,exchange_name,routing_key,body,payload_hash,reason_code)
        VALUES($1,$2,'umc.events.identity.v1','identity.identity-access-changed.v1',$3,'dead-hash','INVALID_MESSAGE')`, dead, domain.NewID(), []byte("bad")); err != nil {
		t.Fatal(err)
	}

	rawMigration, err := migrations.Files.ReadFile("000008_broker_delivery.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, string(rawMigration)); err != nil {
		t.Fatal(err)
	}

	var raw []byte
	if err = tx.QueryRow(ctx, `SELECT envelope FROM outbox WHERE aggregate_id=$1 AND destination='umc.retry.clinical.v1'`, message).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var retry ports.BrokerRetry
	if json.Unmarshal(raw, &retry) != nil || retry.Input.Attempt != 2 || string(retry.Input.Body) != `{"legacy":true}` {
		t.Fatal("lost retry envelope", string(raw))
	}
	var token string
	if err = tx.QueryRow(ctx, `SELECT retry_token::text FROM inbox WHERE message_id=$1`, message).Scan(&token); err != nil || token != retry.Input.RetryToken {
		t.Fatal("inbox retry not linked to handoff", token, err)
	}
	var dropped bool
	if err = tx.QueryRow(ctx, `SELECT to_regclass('retry_jobs') IS NULL AND to_regclass('dead_letters') IS NULL`).Scan(&dropped); err != nil || !dropped {
		t.Fatal("old delivery tables remained", err)
	}
	var archived, missing bool
	if err = tx.QueryRow(ctx, `SELECT envelope->>'body'='b2xkLWJvZHk=' AND envelope->>'historicalBodyUnavailable'='false'
        FROM outbox WHERE aggregate_id=$1 AND envelope->>'reasonCode'='LEGACY_RETRY_ORPHANED'`, orphan).Scan(&archived); err != nil || !archived {
		t.Fatal("orphan retry body was not preserved", err)
	}
	if err = tx.QueryRow(ctx, `SELECT envelope->>'historicalBodyUnavailable'='true' AND envelope->>'payloadHash'='lost-hash'
        FROM outbox WHERE aggregate_id=$1 AND envelope->>'reasonCode'='LEGACY_RETRY_ORPHANED'`, lost).Scan(&missing); err != nil || !missing {
		t.Fatal("lost retry body was not explicitly identified", err)
	}
	var deadOrphans int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM inbox WHERE message_id IN ($1,$2) AND status='DEAD' AND retry_token IS NULL`, orphan, lost).Scan(&deadOrphans); err != nil || deadOrphans != 2 {
		t.Fatal("orphan inbox entries were not reconciled", deadOrphans, err)
	}

	var deadCount int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM outbox WHERE destination='umc.deadletters.clinical.v1'`).Scan(&deadCount); err != nil || deadCount != 3 {
		t.Fatal("lost legacy DLQ record", deadCount, err)
	}

}
