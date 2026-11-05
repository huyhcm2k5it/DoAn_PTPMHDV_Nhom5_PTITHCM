CREATE TABLE idempotency_records(actor_id uuid NOT NULL,operation text NOT NULL,idempotency_key uuid NOT NULL,request_hash text NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor_id,operation,idempotency_key));
CREATE TABLE outbox(message_id uuid PRIMARY KEY,aggregate_id uuid NOT NULL,destination text NOT NULL,routing_key text NOT NULL,envelope jsonb NOT NULL,status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENT')),created_at timestamptz NOT NULL DEFAULT now(),sent_at timestamptz);
CREATE INDEX outbox_pending ON outbox(created_at,message_id) WHERE status='PENDING';
CREATE TABLE inbox(message_id uuid PRIMARY KEY,payload_hash text NOT NULL,status text NOT NULL DEFAULT 'PROCESSED' CHECK(status IN ('PROCESSED','RETRY_SCHEDULED','DEAD')),processed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE retry_jobs(message_id uuid PRIMARY KEY,exchange_name text NOT NULL,routing_key text NOT NULL,body bytea NOT NULL,payload_hash text NOT NULL,attempt integer NOT NULL CHECK(attempt BETWEEN 1 AND 3),due_at timestamptz NOT NULL,status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSED','DEAD')),lease_id uuid,lease_until timestamptz);
CREATE INDEX retry_jobs_due ON retry_jobs(due_at) WHERE status='PENDING';
CREATE TABLE dead_letters(id uuid PRIMARY KEY,message_id text NOT NULL,exchange_name text NOT NULL,routing_key text NOT NULL,body bytea NOT NULL,payload_hash text NOT NULL,reason_code text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(message_id,payload_hash));

CREATE TABLE objects(kind text NOT NULL,key text NOT NULL,value jsonb NOT NULL,PRIMARY KEY(kind,key));
CREATE TABLE lab_orders(id uuid PRIMARY KEY,clinical_request_id uuid UNIQUE NOT NULL,body jsonb NOT NULL);
CREATE TABLE specimen_barcodes(barcode text PRIMARY KEY,order_id uuid NOT NULL);
