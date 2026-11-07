package usecase

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"
)

const cachePrefix = "umc:catalog:v1"

func (s *Service) cached(ctx context.Context, resource string, query any, at time.Time, destination any, load func() (any, error)) error {
	if s.cache == nil {
		value, err := load()
		if err != nil {
			return err
		}
		return copyValue(value, destination)
	}

	key, err := s.cacheKey(ctx, resource, query)
	if err == nil {
		if raw, found, cacheErr := s.cache.Get(ctx, key); cacheErr == nil && found && json.Unmarshal(raw, destination) == nil {
			return nil
		}
	}

	select {
	case s.fallback <- struct{}{}:
		defer func() { <-s.fallback }()
	default:
		return fmt.Errorf("catalog database fallback capacity exhausted")
	}

	value, err := load()
	if err != nil {
		return err
	}
	raw, marshalErr := json.Marshal(value)
	if marshalErr != nil {
		return marshalErr
	}
	if err = json.Unmarshal(raw, destination); err != nil {
		return err
	}
	if key == "" {
		return nil
	}
	now := s.clock.Now()
	expiresAt := now.Add(jitteredTTL(key))
	cacheable := true
	if !at.IsZero() {
		if boundaryReader, ok := s.reader.(interface {
			NextPriceBoundary(context.Context, time.Time) (*time.Time, error)
		}); ok {
			if boundary, boundaryErr := boundaryReader.NextPriceBoundary(ctx, at); boundaryErr != nil {
				cacheable = false
			} else if boundary != nil {
				if !boundary.After(now) {
					cacheable = false
				} else if boundary.Before(expiresAt) {
					expiresAt = *boundary
				}
			}
		} else {
			cacheable = false
		}
	}
	if cacheable && expiresAt.Sub(now) >= time.Millisecond {
		_ = s.cache.Set(ctx, key, raw, expiresAt)
	}
	return nil
}

func copyValue(source, destination any) error {
	raw, err := json.Marshal(source)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, destination)
}

func (s *Service) cacheKey(ctx context.Context, resource string, query any) (string, error) {
	generation, err := s.cache.Generation(ctx)
	if err != nil {
		return "", err
	}
	raw, err := json.Marshal(query)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(append([]byte(resource+":"), raw...))
	return fmt.Sprintf("%s:%s:%s", cachePrefix, generation, hex.EncodeToString(sum[:])), nil
}

func jitteredTTL(key string) time.Duration {
	sum := sha256.Sum256([]byte(key))
	// Stable 54..66 second jitter avoids synchronized expirations while keeping
	// tests and repeated cache fills deterministic.
	return time.Duration(54+int(sum[0])%13) * time.Second
}
