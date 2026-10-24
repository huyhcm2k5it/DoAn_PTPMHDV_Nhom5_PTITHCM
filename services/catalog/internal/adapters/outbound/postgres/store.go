package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"time"
	"umccare/catalog/internal/application/ports"
	"umccare/catalog/internal/domain"
	"umccare/catalog/migrations"
)

type Store struct{ pool *pgxpool.Pool }

func New(ctx context.Context, dsn string) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 10
	cfg.MinConns = 0
	cfg.ConnConfig.ConnectTimeout = 3 * time.Second
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	return &Store{pool}, nil
}
func (s *Store) Close() { s.pool.Close() }
func (s *Store) Ready(ctx context.Context) error {
	var version int
	return s.pool.QueryRow(ctx, "SELECT version FROM schema_migrations WHERE version=1").Scan(&version)
}
func (s *Store) Migrate(ctx context.Context) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(74001001)"); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())"); err != nil {
		return err
	}
	var exists bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=1)").Scan(&exists); err != nil {
		return err
	}
	if !exists {
		sql, _ := migrations.Files.ReadFile("000001_catalog.up.sql")
		if _, err = tx.Exec(ctx, string(sql)); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO schema_migrations(version) VALUES(1)"); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
func (s *Store) Seed(ctx context.Context) error {
	sql, _ := migrations.Files.ReadFile("seed.sql")
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, string(sql)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) Departments(ctx context.Context) ([]domain.Department, error) {
	rows, err := s.pool.Query(ctx, "SELECT id::text,code,name,status FROM departments WHERE status='ACTIVE' ORDER BY name,id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.Department{}
	for rows.Next() {
		var x domain.Department
		if err = rows.Scan(&x.ID, &x.Code, &x.Name, &x.Status); err != nil {
			return nil, err
		}
		items = append(items, x)
	}
	return items, rows.Err()
}
func (s *Store) Doctors(ctx context.Context, q ports.DoctorQuery) (ports.Doctors, error) {
	var raw []byte
	result := ports.Doctors{Items: []domain.Doctor{}}
	err := s.pool.QueryRow(ctx, `WITH filtered AS(SELECT id,department_id,display_name,status FROM doctors WHERE status='ACTIVE' AND (NULLIF($1::text,'') IS NULL OR department_id=NULLIF($1::text,'')::uuid)),page AS(SELECT * FROM filtered ORDER BY display_name,id LIMIT $2 OFFSET $3) SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'departmentId',department_id,'displayName',display_name,'status',status) ORDER BY display_name,id),'[]'::jsonb),(SELECT count(*) FROM filtered) FROM page`, q.DepartmentID, q.Limit, (q.Page-1)*q.Limit).Scan(&raw, &result.Total)
	if err != nil {
		return result, err
	}
	err = json.Unmarshal(raw, &result.Items)
	return result, err
}

const priceJSON = `CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('priceVersionId',p.id,'revision',p.revision,'itemType',p.item_type,'itemId',p.item_id,'amountVnd',p.amount_vnd,'effectiveFrom',p.effective_from,'effectiveTo',p.effective_to) END`

func decodePrice(raw []byte) (*domain.Price, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var p domain.Price
	err := json.Unmarshal(raw, &p)
	return &p, err
}
func (s *Store) MedicalServices(ctx context.Context, q ports.ServiceQuery) ([]domain.MedicalService, error) {
	query := `SELECT m.id::text,m.department_id::text,m.code,m.name,m.status,` + priceJSON + ` FROM medical_services m LEFT JOIN LATERAL(SELECT * FROM price_versions WHERE item_type='EXAM' AND item_id=m.id AND effective_from<=$2 AND (effective_to IS NULL OR effective_to>$2) ORDER BY revision DESC LIMIT 1)p ON true WHERE m.status='ACTIVE' AND(NULLIF($1::text,'') IS NULL OR m.department_id=NULLIF($1::text,'')::uuid) ORDER BY m.name,m.id`
	rows, err := s.pool.Query(ctx, query, q.DepartmentID, q.At)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.MedicalService{}
	for rows.Next() {
		var x domain.MedicalService
		var raw []byte
		if err = rows.Scan(&x.ID, &x.DepartmentID, &x.Code, &x.Name, &x.Status, &raw); err != nil {
			return nil, err
		}
		if x.Price, err = decodePrice(raw); err != nil {
			return nil, err
		}
		items = append(items, x)
	}
	return items, rows.Err()
}
func (s *Store) Medicines(ctx context.Context, q ports.SearchQuery, at time.Time) ([]domain.Medicine, error) {
	if q.Status == "" {
		q.Status = "ACTIVE"
	}
	rows, err := s.pool.Query(ctx, `SELECT m.id::text,m.code,m.name,m.unit,m.strength,m.form,m.status,`+priceJSON+` FROM medicines m LEFT JOIN LATERAL(SELECT * FROM price_versions WHERE item_type='MEDICINE' AND item_id=m.id AND effective_from<=$3 AND (effective_to IS NULL OR effective_to>$3) ORDER BY revision DESC LIMIT 1)p ON true WHERE m.status=$2 AND(m.name ILIKE '%'||$1||'%' OR m.code ILIKE '%'||$1||'%') ORDER BY m.name,m.id`, q.Q, q.Status, at)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.Medicine{}
	for rows.Next() {
		var x domain.Medicine
		var raw []byte
		if err = rows.Scan(&x.ID, &x.Code, &x.Name, &x.Unit, &x.Strength, &x.Form, &x.Status, &raw); err != nil {
			return nil, err
		}
		if x.Price, err = decodePrice(raw); err != nil {
			return nil, err
		}
		items = append(items, x)
	}
	return items, rows.Err()
}
func (s *Store) LabTests(ctx context.Context, q ports.SearchQuery, at time.Time) ([]domain.LabTest, error) {
	if q.Status == "" {
		q.Status = "ACTIVE"
	}
	rows, err := s.pool.Query(ctx, `SELECT m.id::text,m.code,m.name,m.specimen_type,m.unit,m.reference_range,m.revision,m.status,`+priceJSON+` FROM lab_tests m LEFT JOIN LATERAL(SELECT * FROM price_versions WHERE item_type='LAB' AND item_id=m.id AND effective_from<=$3 AND (effective_to IS NULL OR effective_to>$3) ORDER BY revision DESC LIMIT 1)p ON true WHERE m.status=$2 AND(m.name ILIKE '%'||$1||'%' OR m.code ILIKE '%'||$1||'%') ORDER BY m.name,m.id`, q.Q, q.Status, at)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.LabTest{}
	for rows.Next() {
		var x domain.LabTest
		var raw []byte
		if err = rows.Scan(&x.ID, &x.Code, &x.Name, &x.SpecimenType, &x.Unit, &x.ReferenceRange, &x.Revision, &x.Status, &raw); err != nil {
			return nil, err
		}
		if x.Price, err = decodePrice(raw); err != nil {
			return nil, err
		}
		items = append(items, x)
	}
	return items, rows.Err()
}
func (s *Store) Access(ctx context.Context, id string) (domain.Access, error) {
	var a domain.Access
	var caps []byte
	err := s.pool.QueryRow(ctx, "SELECT user_id::text,actor_type,capabilities,token_version,status FROM user_access_projection WHERE user_id=$1", id).Scan(&a.UserID, &a.ActorType, &caps, &a.TokenVersion, &a.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return a, domain.Fail("SERVICE_UNAVAILABLE", "Identity access projection is not ready")
	}
	if err != nil {
		return a, err
	}
	if err = json.Unmarshal(caps, &a.Capabilities); err != nil {
		return a, fmt.Errorf("invalid access projection")
	}
	return a, nil
}
