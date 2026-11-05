ALTER TABLE catalog_stream ADD COLUMN bootstrap_completed_at timestamptz;
ALTER TABLE catalog_stream ADD COLUMN checkpoint_at timestamptz;
ALTER TABLE user_access_projection ADD COLUMN payload_hash text NOT NULL DEFAULT '';
ALTER TABLE outbox ADD COLUMN sent_at timestamptz;
ALTER TABLE outbox ADD COLUMN retry_count integer NOT NULL DEFAULT 0 CHECK(retry_count>=0);
ALTER TABLE outbox ADD COLUMN last_error text NOT NULL DEFAULT '';
CREATE TABLE inbox(message_id uuid PRIMARY KEY,payload_hash text NOT NULL,processed_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX outbox_publish_due ON outbox(next_attempt_at,created_at,message_id) WHERE status='PENDING';
CREATE TABLE catalog_quarantine(
  message_id text NOT NULL,
  payload_hash text NOT NULL,
  exchange_name text NOT NULL,
  routing_key text NOT NULL,
  reason_code text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(message_id,payload_hash)
);
