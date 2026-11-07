package postgres

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"umccare/catalog/internal/domain"
)

type identityEnvelope struct {
	MessageID        string          `json:"messageId"`
	MessageKind      string          `json:"messageKind"`
	MessageType      string          `json:"messageType"`
	SchemaVersion    int             `json:"schemaVersion"`
	Producer         string          `json:"producer"`
	AggregateID      string          `json:"aggregateId"`
	AggregateVersion int64           `json:"aggregateVersion"`
	CorrelationID    string          `json:"correlationId"`
	CausationID      string          `json:"causationId"`
	RequestID        string          `json:"requestId"`
	OccurredAt       time.Time       `json:"occurredAt"`
	Payload          json.RawMessage `json:"payload"`
}

type identityPayload struct {
	UserID       string   `json:"userId"`
	ActorType    string   `json:"actorType"`
	Status       string   `json:"status"`
	TokenVersion int      `json:"tokenVersion"`
	Capabilities []string `json:"capabilities"`
	Version      int64    `json:"version"`
}

// ApplyIdentityAccessChanged stores the source version/hash together with its inbox
// receipt. Old events are acknowledged without moving the projection backwards.
func (s *Store) ApplyIdentityAccessChanged(ctx context.Context, exchange, routingKey, deliveryID string, raw []byte) error {
	var m identityEnvelope
	if len(raw) > 1<<20 || json.Unmarshal(raw, &m) != nil || exchange != "umc.events.identity.v1" || routingKey != "identity.identity-access-changed.v1" || m.MessageKind != "EVENT" || m.MessageType != "IdentityAccessChanged" || m.SchemaVersion != 1 || m.Producer != "identity" || !domain.ValidID(m.MessageID) || (deliveryID != "" && !sameID(deliveryID, m.MessageID)) || !domain.ValidID(m.AggregateID) || m.AggregateVersion < 1 || m.CorrelationID == "" || len(m.CorrelationID) > 128 || !domain.ValidID(m.CausationID) || !domain.ValidID(m.RequestID) || m.OccurredAt.IsZero() {
		return domain.Fail("INVALID_MESSAGE", "Invalid IdentityAccessChanged envelope")
	}
	var p identityPayload
	if json.Unmarshal(m.Payload, &p) != nil || !domain.ValidID(p.UserID) || !sameID(p.UserID, m.AggregateID) || p.ActorType == "" || p.Status == "" || len(p.Status) > 32 || p.TokenVersion < 0 || p.Capabilities == nil || p.Version != m.AggregateVersion {
		return domain.Fail("INVALID_MESSAGE", "Invalid identity access projection")
	}
	canonical, err := json.Marshal(m)
	if err != nil {
		return err
	}
	sum := sha256.Sum256(canonical)
	hash := hex.EncodeToString(sum[:])
	projectionBytes, err := json.Marshal(p)
	if err != nil {
		return err
	}
	projectionSum := sha256.Sum256(projectionBytes)
	projectionHash := hex.EncodeToString(projectionSum[:])
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, `identity-message:`+m.MessageID); err != nil {
		return err
	}
	var priorHash string
	err = tx.QueryRow(ctx, `SELECT payload_hash FROM inbox WHERE message_id=$1`, m.MessageID).Scan(&priorHash)
	if err == nil {
		if priorHash != hash {
			return domain.Fail("INVALID_MESSAGE", "Identity message ID reused with different content")
		}
		return tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO inbox(message_id,payload_hash) VALUES($1,$2)`, m.MessageID, hash); err != nil {
		return err
	}
	var sourceVersion int64
	var existingHash string
	err = tx.QueryRow(ctx, `SELECT source_version,payload_hash FROM user_access_projection WHERE user_id=$1 FOR UPDATE`, p.UserID).Scan(&sourceVersion, &existingHash)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if errors.Is(err, pgx.ErrNoRows) || p.Version > sourceVersion || (p.Version == sourceVersion && existingHash == "") {
		_, err = tx.Exec(ctx, `INSERT INTO user_access_projection(user_id,actor_type,capabilities,token_version,status,source_version,payload_hash,applied_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT(user_id) DO UPDATE SET actor_type=EXCLUDED.actor_type,capabilities=EXCLUDED.capabilities,token_version=EXCLUDED.token_version,status=EXCLUDED.status,source_version=EXCLUDED.source_version,payload_hash=EXCLUDED.payload_hash,applied_at=now() WHERE user_access_projection.source_version<EXCLUDED.source_version OR (user_access_projection.source_version=EXCLUDED.source_version AND user_access_projection.payload_hash='')`, p.UserID, p.ActorType, p.Capabilities, p.TokenVersion, p.Status, p.Version, projectionHash)
		if err != nil {
			return err
		}
	} else if p.Version == sourceVersion && existingHash != "" && existingHash != projectionHash {
		return domain.Fail("STATE_CONFLICT", fmt.Sprintf("Identity projection version %d has conflicting content", p.Version))
	}
	return tx.Commit(ctx)
}

func sameID(a, b string) bool {
	return len(a) == len(b) && domain.ValidID(a) && domain.ValidID(b) && equalFoldASCII(a, b)
}
func equalFoldASCII(a, b string) bool { return strings.EqualFold(a, b) }

func (s *Store) QuarantineIdentity(ctx context.Context, messageID, exchange, routingKey, reason string, raw []byte) error {
	if len(raw) > 1<<20 {
		raw = raw[:1<<20]
	}
	if messageID == "" || len(messageID) > 128 {
		messageID = "invalid-envelope"
	}
	sum := sha256.Sum256(raw)
	_, err := s.pool.Exec(ctx, `INSERT INTO catalog_quarantine(message_id,payload_hash,exchange_name,routing_key,reason_code) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, messageID, hex.EncodeToString(sum[:]), exchange, routingKey, reason)
	return err
}
