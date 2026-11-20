-- Match the ERD's optional descriptive fields and required price audit actor.
-- Existing seed price rows have a deterministic demo admin; preserve unknown
-- historical actors by refusing to invent their identity during migration.
UPDATE price_versions
SET created_by = '00000000-0000-4000-8000-000000000901'
WHERE created_by IS NULL
  AND (id, item_type, item_id, revision, amount_vnd) IN (
    ('00000000-0000-4000-8000-000000000501'::uuid, 'EXAM', '00000000-0000-4000-8000-000000000201'::uuid, 1, 150000),
    ('00000000-0000-4000-8000-000000000502'::uuid, 'EXAM', '00000000-0000-4000-8000-000000000202'::uuid, 1, 200000),
    ('00000000-0000-4000-8000-000000000503'::uuid, 'MEDICINE', '00000000-0000-4000-8000-000000000301'::uuid, 1, 2000),
    ('00000000-0000-4000-8000-000000000504'::uuid, 'LAB', '00000000-0000-4000-8000-000000000401'::uuid, 1, 100000)
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM price_versions WHERE created_by IS NULL) THEN
    RAISE EXCEPTION 'Catalog ERD migration blocked: assign the real creator to every legacy price_versions row before applying 000004';
  END IF;
END $$;

ALTER TABLE price_versions ALTER COLUMN created_by SET NOT NULL;

ALTER TABLE medicines ALTER COLUMN strength DROP NOT NULL;
ALTER TABLE medicines ALTER COLUMN strength DROP DEFAULT;
ALTER TABLE medicines ALTER COLUMN form DROP NOT NULL;
ALTER TABLE medicines ALTER COLUMN form DROP DEFAULT;
UPDATE medicines SET strength = NULLIF(btrim(strength), ''), form = NULLIF(btrim(form), '');

ALTER TABLE lab_tests ALTER COLUMN unit DROP NOT NULL;
ALTER TABLE lab_tests ALTER COLUMN unit DROP DEFAULT;
ALTER TABLE lab_tests ALTER COLUMN reference_range DROP NOT NULL;
ALTER TABLE lab_tests ALTER COLUMN reference_range DROP DEFAULT;
UPDATE lab_tests
SET unit = NULLIF(btrim(unit), ''),
    reference_range = NULLIF(btrim(reference_range), '');
