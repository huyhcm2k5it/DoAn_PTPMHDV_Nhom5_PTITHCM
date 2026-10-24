package health

import (
	"context"
	"umccare/clinical/internal/application/ports"
)

type Service struct{ probe ports.Readiness }

func New(p ports.Readiness) *Service               { return &Service{p} }
func (s *Service) Ready(ctx context.Context) error { return s.probe.Ready(ctx) }
