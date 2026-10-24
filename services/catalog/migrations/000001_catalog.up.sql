CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE departments(id uuid PRIMARY KEY,code text NOT NULL UNIQUE,name text NOT NULL,status text NOT NULL CHECK(status IN ('ACTIVE','INACTIVE')));
CREATE TABLE doctors(id uuid PRIMARY KEY,identity_user_id uuid NOT NULL UNIQUE,department_id uuid NOT NULL REFERENCES departments(id),display_name text NOT NULL,status text NOT NULL CHECK(status IN ('ACTIVE','INACTIVE')));
CREATE TABLE medical_services(id uuid PRIMARY KEY,department_id uuid NOT NULL REFERENCES departments(id),code text NOT NULL UNIQUE,name text NOT NULL,status text NOT NULL CHECK(status IN ('ACTIVE','INACTIVE')));
CREATE TABLE medicines(id uuid PRIMARY KEY,code text NOT NULL UNIQUE,name text NOT NULL,unit text NOT NULL,strength text NOT NULL DEFAULT '',form text NOT NULL DEFAULT '',status text NOT NULL CHECK(status IN ('ACTIVE','INACTIVE')));
CREATE TABLE lab_tests(id uuid PRIMARY KEY,code text NOT NULL UNIQUE,name text NOT NULL,specimen_type text NOT NULL,unit text NOT NULL DEFAULT '',reference_range text NOT NULL DEFAULT '',revision integer NOT NULL CHECK(revision>0),status text NOT NULL CHECK(status IN ('ACTIVE','INACTIVE')));
CREATE TABLE price_versions(
 id uuid PRIMARY KEY,item_type text NOT NULL CHECK(item_type IN ('EXAM','LAB','MEDICINE')),item_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0),amount_vnd bigint NOT NULL CHECK(amount_vnd>=0),
 effective_from timestamptz NOT NULL,effective_to timestamptz,created_by uuid,
 CHECK(effective_to IS NULL OR effective_to>effective_from),UNIQUE(item_type,item_id,revision),
 EXCLUDE USING gist(item_type WITH =,item_id WITH =,tstzrange(effective_from,effective_to,'[)') WITH &&)
);
CREATE INDEX doctors_department ON doctors(department_id,display_name,id) WHERE status='ACTIVE';
CREATE INDEX medical_services_department ON medical_services(department_id) WHERE status='ACTIVE';
CREATE TABLE user_access_projection(user_id uuid PRIMARY KEY,actor_type text NOT NULL,capabilities jsonb NOT NULL DEFAULT '[]',token_version integer NOT NULL CHECK(token_version>=0),status text NOT NULL,source_version bigint NOT NULL DEFAULT 1,applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE catalog_stream(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),sequence bigint NOT NULL DEFAULT 0,generation bigint NOT NULL DEFAULT 0);
INSERT INTO catalog_stream(singleton) VALUES(true);
CREATE TABLE idempotency_records(user_id uuid NOT NULL,operation text NOT NULL,idempotency_key uuid NOT NULL,request_hash text NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,operation,idempotency_key));
CREATE TABLE outbox(
 message_id uuid PRIMARY KEY,aggregate_id uuid NOT NULL,aggregate_version integer NOT NULL,
 message_kind text NOT NULL CHECK(message_kind IN ('EVENT','COMMAND')),message_type text NOT NULL,
 schema_version integer NOT NULL DEFAULT 1,producer text NOT NULL,destination text NOT NULL,routing_key text NOT NULL,
 payload jsonb NOT NULL,payload_hash text NOT NULL,status text NOT NULL DEFAULT 'PENDING',
 created_at timestamptz NOT NULL DEFAULT now(),next_attempt_at timestamptz NOT NULL DEFAULT now(),claim_lease timestamptz
);
CREATE INDEX outbox_pending ON outbox(next_attempt_at) WHERE status='PENDING';
