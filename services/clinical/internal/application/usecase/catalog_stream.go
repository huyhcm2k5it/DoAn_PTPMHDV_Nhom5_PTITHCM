package usecase

import (
	"context"
	"encoding/json"
	"time"

	"umccare/clinical/internal/application/ports"
	"umccare/clinical/internal/domain"
)

type catalogStreamTx interface {
	CatalogStream(context.Context) (sequence, highest int64, checkpoint *time.Time, err error)
	SaveCatalogStream(context.Context, int64, int64, *time.Time) error
}

func catalogValueIn(value string, options ...string) bool {
	for _, option := range options {
		if value == option {
			return true
		}
	}
	return false
}

func (s *Service) handleCatalogChanged(ctx context.Context, exchange string, m domain.Envelope) error {
	if exchange != "umc.events.catalog.v1" || (m.Producer != "catalog" && m.Producer != "Catalog") || !domain.ValidID(m.CausationID) {
		return domain.Fail("INVALID_MESSAGE", "Untrusted Catalog producer")
	}
	var p struct {
		EntityType     string          `json:"entityType"`
		EntityID       string          `json:"entityId"`
		EntityVersion  int             `json:"entityVersion"`
		FullSnapshot   json.RawMessage `json:"fullSnapshot"`
		EffectiveAt    time.Time       `json:"effectiveAt"`
		StreamSequence int64           `json:"streamSequence"`
		Mode           string          `json:"mode"`
	}
	if strictJSON(m.Payload, &p) != nil || !domain.ValidID(p.EntityID) || p.EntityVersion < 1 || p.StreamSequence < 0 || p.EffectiveAt.IsZero() || len(p.FullSnapshot) == 0 || m.AggregateVersion != p.EntityVersion {
		return domain.Fail("INVALID_MESSAGE", "Invalid CatalogChanged payload")
	}
	if !catalogValueIn(p.EntityType, "DEPARTMENT", "DOCTOR", "SERVICE", "MEDICINE", "LAB_TEST", "TEST", "PRICE_VERSION", "STREAM") || !catalogValueIn(p.Mode, "UPSERT", "TOMBSTONE", "CHECKPOINT") {
		return domain.Fail("INVALID_MESSAGE", "Unsupported Catalog entity or mode")
	}
	if p.Mode == "CHECKPOINT" {
		var snapshot struct {
			Sequence int64     `json:"sequence"`
			At       time.Time `json:"at"`
		}
		if p.EntityType != "STREAM" || strictJSON(p.FullSnapshot, &snapshot) != nil || snapshot.Sequence != p.StreamSequence || snapshot.At.IsZero() {
			return domain.Fail("INVALID_MESSAGE", "Invalid Catalog checkpoint")
		}
	} else if p.EntityType == "STREAM" || p.StreamSequence == 0 || (p.EntityType != "PRICE_VERSION" && domain.ID(m.AggregateID) != domain.ID(p.EntityID)) {
		return domain.Fail("INVALID_MESSAGE", "Invalid Catalog stream entity identity")
	}
	if p.EntityType == "TEST" {
		p.EntityType = "LAB_TEST"
	}
	var entity domain.CatalogEntity
	if p.Mode != "CHECKPOINT" && (p.EntityType == "MEDICINE" || p.EntityType == "LAB_TEST") {
		var raw struct {
			ID             string          `json:"id"`
			Code           string          `json:"code"`
			Name           string          `json:"name"`
			Unit           string          `json:"unit"`
			ReferenceRange string          `json:"referenceRange"`
			Revision       int             `json:"revision"`
			Status         string          `json:"status"`
			Strength       string          `json:"strength"`
			Form           string          `json:"form"`
			SpecimenType   string          `json:"specimenType"`
			Price          json.RawMessage `json:"price"`
		}
		if strictJSON(p.FullSnapshot, &raw) != nil || domain.ID(raw.ID) != domain.ID(p.EntityID) || !domain.ValidID(raw.ID) || raw.Code == "" || raw.Name == "" || (raw.Status != "ACTIVE" && raw.Status != "INACTIVE") || (p.EntityType == "LAB_TEST" && raw.Revision != p.EntityVersion) {
			return domain.Fail("INVALID_MESSAGE", "Invalid Catalog entity snapshot")
		}
		entity = domain.CatalogEntity{ID: domain.ID(raw.ID), Code: raw.Code, Name: raw.Name, Unit: raw.Unit, ReferenceRange: raw.ReferenceRange, Revision: p.EntityVersion, Status: raw.Status}
		if p.Mode == "TOMBSTONE" {
			entity.Status = "INACTIVE"
		}
	}

	gap := false
	err := s.store.Within(ctx, "catalog-stream", func(base ports.ClinicalTx) error {
		stream, ok := base.(catalogStreamTx)
		if !ok {
			return domain.Fail("SERVICE_UNAVAILABLE", "Catalog stream guard is unavailable")
		}
		tx, err := treatment(base)
		if err != nil {
			return err
		}
		hash := domain.Hash(m)
		seen, err := tx.SeenMessage(ctx, m.MessageID, hash, retryLease(ctx))
		if err != nil || seen {
			return err
		}
		sequence, highest, checkpoint, err := stream.CatalogStream(ctx)
		if err != nil {
			return err
		}
		if p.StreamSequence > highest {
			highest = p.StreamSequence
		}
		if p.Mode == "CHECKPOINT" {
			if p.StreamSequence > sequence {
				if err = stream.SaveCatalogStream(ctx, sequence, highest, checkpoint); err != nil {
					return err
				}
				gap = true
				return nil
			}
			if p.StreamSequence == sequence && (checkpoint == nil || m.OccurredAt.After(*checkpoint)) {
				at := m.OccurredAt.UTC()
				checkpoint = &at
			}
			if err = stream.SaveCatalogStream(ctx, sequence, highest, checkpoint); err != nil {
				return err
			}
			return tx.MarkMessage(ctx, m.MessageID, hash)
		}
		if p.StreamSequence <= sequence {
			return tx.MarkMessage(ctx, m.MessageID, hash)
		}
		if p.StreamSequence != sequence+1 {
			if err = stream.SaveCatalogStream(ctx, sequence, highest, checkpoint); err != nil {
				return err
			}
			gap = true
			return nil
		}
		if entity.ID != "" {
			if err = tx.PutCatalog(ctx, p.EntityType, entity); err != nil {
				return err
			}
		}
		sequence = p.StreamSequence
		if err = stream.SaveCatalogStream(ctx, sequence, highest, checkpoint); err != nil {
			return err
		}
		return tx.MarkMessage(ctx, m.MessageID, hash)
	})
	if err != nil {
		return err
	}
	if gap {
		return domain.Fail("SERVICE_UNAVAILABLE", "CATALOG_STREAM_GAP")
	}
	return nil
}
