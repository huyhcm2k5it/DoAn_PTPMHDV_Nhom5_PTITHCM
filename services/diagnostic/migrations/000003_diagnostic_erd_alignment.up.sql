-- Replace the Diagnostic JSONB aggregate with the relational ERD tables.
-- Keep event projections, idempotency records and audit objects in `objects`.
ALTER TABLE lab_orders
  ADD COLUMN state text,
  ADD COLUMN charge_id uuid,
  ADD COLUMN created_at timestamptz,
  ADD COLUMN version integer,
  ADD COLUMN source_revision integer,
  ADD COLUMN doctor_id uuid,
  ADD COLUMN charge_state text,
  ADD COLUMN charge_request_id uuid,
  ADD COLUMN amount_vnd bigint,
  ADD COLUMN amount_hash text,
  ADD COLUMN test_snapshot jsonb,
  ADD COLUMN price_snapshot jsonb,
  ADD COLUMN request_hash text,
  ADD COLUMN settlement_id uuid,
  ADD COLUMN settlement_state text,
  ADD COLUMN settlement_version integer,
  ADD COLUMN attempt_version integer,
  ADD COLUMN last_query_at timestamptz,
  ADD COLUMN refund_status text;

UPDATE lab_orders
SET state = COALESCE(body->'order'->>'state', 'PENDING_PAYMENT'),
    charge_id = NULLIF(body->'order'->>'chargeId', '')::uuid,
    created_at = COALESCE(NULLIF(body->'order'->>'createdAt', '')::timestamptz, now()),
    version = COALESCE(NULLIF(body->'order'->>'version', '')::integer, 1),
    source_revision = COALESCE(NULLIF(body->'order'->>'sourceRevision', '')::integer, 1),
    doctor_id = NULLIF(body->'order'->>'doctorId', '')::uuid,
    charge_state = COALESCE(body->'order'->>'chargeState', ''),
    charge_request_id = NULLIF(body->>'ChargeRequestID', '')::uuid,
    amount_vnd = COALESCE(NULLIF(body->'order'->>'amountVnd', '')::bigint, 0),
    amount_hash = COALESCE(body->'order'->>'snapshotHash', ''),
    test_snapshot = CASE WHEN jsonb_typeof(body->'order'->'tests')='array' THEN body->'order'->'tests' ELSE '[]'::jsonb END,
    price_snapshot = CASE WHEN jsonb_typeof(body->'order'->'linesSnapshot')='array' THEN body->'order'->'linesSnapshot' ELSE '[]'::jsonb END,
    request_hash = COALESCE(body->>'RequestHash', ''),
    settlement_id = NULLIF(body->>'SettlementID', '')::uuid,
    settlement_state = COALESCE(body->>'SettlementState', ''),
    settlement_version = COALESCE(NULLIF(body->>'Fence', '')::integer, 0),
    attempt_version = COALESCE(NULLIF(body->>'AttemptVersion', '')::integer, 0),
    last_query_at = COALESCE(NULLIF(body->>'LastQueryAt', '')::timestamptz, 'epoch'::timestamptz),
    refund_status = COALESCE(body->'order'->>'refundStatus', '');

ALTER TABLE lab_orders
  ALTER COLUMN state SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN version SET NOT NULL,
  ALTER COLUMN source_revision SET NOT NULL,
  ALTER COLUMN charge_state SET NOT NULL,
  ALTER COLUMN amount_vnd SET NOT NULL,
  ALTER COLUMN amount_hash SET NOT NULL,
  ALTER COLUMN test_snapshot SET NOT NULL,
  ALTER COLUMN price_snapshot SET NOT NULL,
  ALTER COLUMN request_hash SET NOT NULL,
  ALTER COLUMN settlement_state SET NOT NULL,
  ALTER COLUMN settlement_version SET NOT NULL,
  ALTER COLUMN attempt_version SET NOT NULL,
  ALTER COLUMN last_query_at SET NOT NULL,
  ALTER COLUMN refund_status SET NOT NULL;

CREATE TABLE specimens (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES lab_orders(id),
  sequence integer NOT NULL CHECK (sequence > 0),
  state text NOT NULL CHECK (state IN ('COLLECTED','REJECTED')),
  barcode text NOT NULL UNIQUE,
  collected_at timestamptz NOT NULL,
  collected_by uuid NOT NULL,
  reject_reason text,
  version integer NOT NULL CHECK (version > 0),
  UNIQUE (order_id, sequence),
  UNIQUE (id, order_id)
);

INSERT INTO specimens(id,order_id,sequence,state,barcode,collected_at,collected_by,reject_reason,version)
SELECT (specimen.item->>'id')::uuid, o.id, (specimen.item->>'sequence')::integer, specimen.item->>'state',
       specimen.item->>'barcode', (specimen.item->>'collectedAt')::timestamptz,
       (specimen.item->>'collectedBy')::uuid, NULLIF(specimen.item->>'reasonCode',''),
       (specimen.item->>'version')::integer
FROM lab_orders AS o
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o.body->'specimens')='array' THEN o.body->'specimens' ELSE '[]'::jsonb END) AS specimen(item);

CREATE TABLE results (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES lab_orders(id),
  specimen_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  state text NOT NULL CHECK (state IN ('DRAFT','REVIEW','REWORK','PUBLISHED')),
  entered_by uuid NOT NULL,
  submitted_at timestamptz,
  published_at timestamptz,
  version integer NOT NULL CHECK (version > 0),
  UNIQUE (order_id, revision),
  FOREIGN KEY (specimen_id, order_id) REFERENCES specimens(id, order_id)
);

INSERT INTO results(id,order_id,specimen_id,revision,state,entered_by,submitted_at,published_at,version)
SELECT (value->'result'->>'id')::uuid,
       (value->'result'->>'orderId')::uuid,
       (value->'result'->>'specimenId')::uuid,
       (value->'result'->>'revision')::integer,
       value->'result'->>'state',
       (value->'result'->>'enteredBy')::uuid,
       NULLIF(value->'result'->>'submittedAt','')::timestamptz,
       NULLIF(value->'result'->>'publishedAt','')::timestamptz,
       (value->'result'->>'version')::integer
FROM objects
WHERE kind='result';

CREATE TABLE result_contributors (
  result_id uuid NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  contributor_user_id uuid NOT NULL,
  PRIMARY KEY (result_id, contributor_user_id)
);

INSERT INTO result_contributors(result_id,contributor_user_id)
SELECT (result_record.value->'result'->>'id')::uuid, contributor.value::uuid
FROM objects AS result_record
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE WHEN jsonb_typeof(result_record.value->'contributors')='array'
       THEN result_record.value->'contributors'
       ELSE '[]'::jsonb END
) AS contributor(value)
WHERE result_record.kind='result'
ON CONFLICT DO NOTHING;

CREATE TABLE result_items (
  id uuid PRIMARY KEY,
  result_id uuid NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  test_code text NOT NULL,
  value_text text NOT NULL,
  flag text,
  position integer NOT NULL CHECK (position >= 0),
  UNIQUE (result_id, test_code),
  UNIQUE (result_id, position)
);

INSERT INTO result_items(id,result_id,test_code,value_text,flag,position)
SELECT (result_item.item->>'id')::uuid, (value->'result'->>'id')::uuid,
       result_item.item->>'testCode', result_item.item->>'valueText', NULLIF(result_item.item->>'flag',''),
       (result_item.ordinality - 1)::integer
FROM objects
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(value->'result'->'items')='array' THEN value->'result'->'items' ELSE '[]'::jsonb END) WITH ORDINALITY AS result_item(item,ordinality)
WHERE kind='result';

CREATE TABLE reviews (
  id uuid PRIMARY KEY,
  result_id uuid NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  reviewer_user_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('REWORK','PUBLISHED')),
  reason text,
  reviewed_at timestamptz NOT NULL
);

INSERT INTO reviews(id,result_id,reviewer_user_id,decision,reason,reviewed_at)
SELECT audit.key::uuid,
       (audit.value->>'resultId')::uuid,
       (audit.value->>'actorId')::uuid,
       CASE audit.value->>'action' WHEN 'DI-010' THEN 'REWORK' ELSE 'PUBLISHED' END,
       NULLIF(audit.value->>'reason',''),
       (audit.value->>'at')::timestamptz
FROM objects AS audit
WHERE audit.kind='result-audit'
  AND audit.value->>'action' IN ('DI-010','DI-011');

DELETE FROM objects WHERE kind IN ('result','result-order');
ALTER TABLE lab_orders DROP COLUMN body;
