package usecase

import (
	"context"
	"encoding/json"
	"time"
	"umccare/clinical/internal/application/ports"
	"umccare/clinical/internal/domain"
)

// Called only after the normal database-backed access checks. A version derived
// from committed records makes concurrent mutations bypass older cached pages.
func (s *Service) readRecordsCached(ctx context.Context, tx any, p domain.Principal, patient string, page, limit int,
	out *domain.MedicalRecords, load func() error) error {
	key := ""
	if versioned, ok := tx.(ports.RecordsVersion); ok && s.cache != nil {
		doctor := ""
		if p.ActorType == "DOCTOR" {
			doctor = domain.ID(p.UserID)
		}
		if version, err := versioned.RecordsCacheVersion(ctx, domain.ID(patient), doctor, s.now()); err == nil {
			key = "umc:clinical:v1:records:" + domain.Hash(map[string]any{"user": domain.ID(p.UserID), "actor": p.ActorType,
				"tokenVersion": p.TokenVersion, "patient": domain.ID(patient), "version": version, "page": page, "limit": limit})
			if raw, found, err := s.cache.Get(ctx, key); err == nil && found {
				var cached domain.MedicalRecords
				if json.Unmarshal(raw, &cached) == nil && validCachedRecords(cached, domain.ID(patient)) {
					*out = cached
					return nil
				}
			}
		}
	}
	if err := load(); err != nil {
		return err
	}
	if key != "" {
		if raw, err := json.Marshal(out); err == nil {
			_ = s.cache.Set(ctx, key, raw, 15*time.Second)
		}
	}
	return nil
}

func validCachedRecords(out domain.MedicalRecords, patient string) bool {
	if out.Items == nil || out.Total < len(out.Items) {
		return false
	}
	for _, record := range out.Items {
		if record.Visit.State != "SIGNED" || record.Visit.PatientID != patient || record.Note.VisitID != record.Visit.ID {
			return false
		}
		for _, rx := range record.Prescriptions {
			if rx.State != "FINAL" || rx.VisitID != record.Visit.ID {
				return false
			}
		}
	}
	return true
}
