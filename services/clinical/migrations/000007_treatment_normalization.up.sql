-- Normalize prescription snapshots and align the Clinical-owned columns with
-- the ERD. Existing finalized revision values are retained because Pharmacy
-- may already have consumed them; draft revisions are reassigned uniquely.
ALTER TABLE prescriptions ADD COLUMN finalized_by uuid;
UPDATE prescriptions AS p
SET finalized_by = v.doctor_user_id
FROM visits AS v
WHERE p.visit_id = v.id AND p.state = 'FINAL' AND p.finalized_by IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM prescriptions AS p
    CROSS JOIN LATERAL jsonb_array_elements(p.lines) AS line
    LEFT JOIN catalog_entity_projection AS medicine
      ON medicine.entity_type = 'MEDICINE'
     AND medicine.code = line.value->>'medicineCode'
    WHERE medicine.entity_id IS NULL
       OR NULLIF(line.value->>'nameSnapshot', '') IS NULL
       OR NULLIF(line.value->>'doseText', '') IS NULL
       OR COALESCE((line.value->>'quantity')::integer, 0) <= 0
  ) THEN
    RAISE EXCEPTION 'Clinical migration blocked: every prescription line must map to a valid Catalog medicine snapshot';
  END IF;
END $$;

WITH final_revision AS (
  SELECT visit_id, min(revision) AS revision
  FROM prescriptions
  WHERE state = 'FINAL'
  GROUP BY visit_id
), ranked_drafts AS (
  SELECT p.id, p.visit_id,
         row_number() OVER (PARTITION BY p.visit_id ORDER BY p.id) AS position,
         f.revision AS final_revision
  FROM prescriptions AS p
  LEFT JOIN final_revision AS f ON f.visit_id = p.visit_id
  WHERE p.state <> 'FINAL'
)
UPDATE prescriptions AS p
SET revision = CASE
  WHEN d.final_revision IS NULL THEN d.position::integer
  WHEN d.position < d.final_revision THEN d.position::integer
  ELSE (d.position + 1)::integer
END
FROM ranked_drafts AS d
WHERE p.id = d.id;

CREATE UNIQUE INDEX prescription_visit_revision ON prescriptions(visit_id, revision);

CREATE TABLE prescription_items (
  id uuid PRIMARY KEY,
  prescription_id uuid NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  medicine_id uuid NOT NULL,
  medicine_code_snapshot text NOT NULL,
  name_snapshot text NOT NULL,
  dose_text text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  instruction text NOT NULL DEFAULT '',
  position integer NOT NULL CHECK (position >= 0),
  UNIQUE (prescription_id, medicine_code_snapshot),
  UNIQUE (prescription_id, position)
);

INSERT INTO prescription_items (
  id, prescription_id, medicine_id, medicine_code_snapshot, name_snapshot,
  dose_text, quantity, instruction, position
)
SELECT md5(p.id::text || ':' || line.ordinality::text)::uuid,
       p.id,
       medicine.entity_id,
       line.value->>'medicineCode',
       line.value->>'nameSnapshot',
       line.value->>'doseText',
       (line.value->>'quantity')::integer,
       COALESCE(line.value->>'instruction', ''),
       (line.ordinality - 1)::integer
FROM prescriptions AS p
CROSS JOIN LATERAL jsonb_array_elements(p.lines) WITH ORDINALITY AS line(value, ordinality)
JOIN catalog_entity_projection AS medicine
  ON medicine.entity_type = 'MEDICINE'
 AND medicine.code = line.value->>'medicineCode';

ALTER TABLE prescriptions DROP COLUMN lines;
ALTER TABLE prescriptions DROP COLUMN patient_id;

ALTER TABLE lab_requests RENAME COLUMN request_id TO id;
ALTER TABLE lab_requests RENAME COLUMN tests TO test_snapshot;
ALTER TABLE lab_requests ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE lab_requests ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
