CREATE TABLE catalog_entity_projection(entity_type text NOT NULL,entity_id uuid NOT NULL,code text NOT NULL,name text NOT NULL,unit text NOT NULL DEFAULT '',reference_range text NOT NULL DEFAULT '',revision integer NOT NULL CHECK(revision>0),status text NOT NULL,PRIMARY KEY(entity_type,entity_id));
CREATE UNIQUE INDEX catalog_medicine_code ON catalog_entity_projection(code) WHERE entity_type='MEDICINE';
CREATE TABLE prescriptions(id uuid PRIMARY KEY,visit_id uuid NOT NULL REFERENCES visits(id),patient_id uuid NOT NULL,state text NOT NULL CHECK(state IN ('DRAFT','FINAL','DELETED')),version integer NOT NULL CHECK(version>0),revision integer NOT NULL CHECK(revision>0),lines jsonb NOT NULL,finalized_at timestamptz);
CREATE UNIQUE INDEX prescription_one_final ON prescriptions(visit_id) WHERE state='FINAL';
CREATE INDEX prescription_visit ON prescriptions(visit_id);
CREATE TABLE lab_requests(request_id uuid PRIMARY KEY,visit_id uuid NOT NULL REFERENCES visits(id),state text NOT NULL CHECK(state IN ('PENDING','CREATED','REJECTED','PUBLISHED','CANCELLED')),order_id uuid,reason_code text NOT NULL DEFAULT '',request_hash text NOT NULL,source_version integer NOT NULL DEFAULT 0,tests jsonb NOT NULL,UNIQUE(visit_id,request_hash));
CREATE INDEX lab_request_visit ON lab_requests(visit_id);
ALTER TABLE visits ADD COLUMN signed_by uuid;
