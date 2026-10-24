package postgres

import (
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
	"time"
)

type Probe struct{ pool *pgxpool.Pool }

func New(ctx context.Context, dsn string) (*Probe, error) {
	cfg, e := pgxpool.ParseConfig(dsn)
	if e != nil {
		return nil, e
	}
	cfg.MaxConns = 4
	cfg.ConnConfig.ConnectTimeout = 3 * time.Second
	p, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		return nil, e
	}
	return &Probe{p}, nil
}
func (p *Probe) Ready(ctx context.Context) error { return p.pool.Ping(ctx) }
func (p *Probe) Close()                          { p.pool.Close() }
