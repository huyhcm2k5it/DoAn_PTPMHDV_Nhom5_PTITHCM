package postgres

import (
	"context"
	"encoding/json"
	"umccare/catalog/internal/application/ports"
	"umccare/catalog/internal/domain"
)

func (s *Store) PriceHistory(ctx context.Context, q ports.PriceQuery) (ports.PriceVersions, error) {
	out := ports.PriceVersions{Items: []domain.PriceVersion{}}
	var raw []byte
	err := s.pool.QueryRow(ctx, `WITH items AS (
		SELECT 'EXAM'::text AS kind,id,code,name FROM medical_services
		UNION ALL SELECT 'LAB',id,code,name FROM lab_tests
		UNION ALL SELECT 'MEDICINE',id,code,name FROM medicines
	), filtered AS (
		SELECT p.*,i.code,i.name FROM price_versions p
		JOIN items i ON i.kind=p.item_type AND i.id=p.item_id
		WHERE ($1::text='' OR p.item_type=$1)
		AND (NULLIF($2::text,'') IS NULL OR p.item_id=NULLIF($2::text,'')::uuid)
	), page AS (
		SELECT * FROM filtered ORDER BY effective_from DESC,item_type,item_id,revision DESC,id LIMIT $3 OFFSET $4
	)
	SELECT COALESCE(jsonb_agg(jsonb_build_object(
		'priceVersionId',id,'itemType',item_type,'itemId',item_id,'revision',revision,
		'amountVnd',amount_vnd,'effectiveFrom',effective_from,'effectiveTo',effective_to,
		'createdBy',created_by,'itemCode',code,'itemName',name)
		ORDER BY effective_from DESC,item_type,item_id,revision DESC,id),'[]'::jsonb),
		(SELECT count(*) FROM filtered) FROM page`, q.ItemType, q.ItemID, q.Limit, (q.Page-1)*q.Limit).Scan(&raw, &out.Total)
	if err != nil {
		return out, err
	}
	err = json.Unmarshal(raw, &out.Items)
	return out, err
}
