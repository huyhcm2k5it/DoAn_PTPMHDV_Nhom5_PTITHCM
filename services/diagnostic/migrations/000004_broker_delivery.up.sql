-- Stop old API/workers before applying. Pending retries are handed off through
-- outbox atomically, retaining their original source, attempt, body and due time.
ALTER TABLE inbox ADD COLUMN retry_token uuid;
ALTER TABLE inbox ADD COLUMN delivery_attempt integer NOT NULL DEFAULT 0 CHECK(delivery_attempt BETWEEN 0 AND 3);

-- Legacy schedulers could mark the job complete without finishing the inbox.
-- Preserve those failures for operator review; never invent a missing body.
INSERT INTO outbox(message_id,aggregate_id,destination,routing_key,envelope)
SELECT md5('diagnostic:orphan-retry:'||i.message_id::text)::uuid,i.message_id,
       'umc.deadletters.diagnostic.v1','diagnostic.quarantine.v1',
       jsonb_build_object('originalMessageId',i.message_id,'reasonCode','LEGACY_RETRY_ORPHANED',
           'payloadHash',i.payload_hash,'exchange',r.exchange_name,'routingKey',r.routing_key,
           'body',replace(encode(r.body,'base64'),E'\n',''),'attempt',COALESCE(r.attempt,0),
           'historicalBodyUnavailable',r.body IS NULL,'legacyJobStatus',r.status,'recordedAt',now())
FROM inbox i LEFT JOIN retry_jobs r ON r.message_id=i.message_id AND r.payload_hash=i.payload_hash
WHERE i.status='RETRY_SCHEDULED'
  AND NOT EXISTS(SELECT 1 FROM retry_jobs p WHERE p.message_id=i.message_id AND p.status='PENDING')
ON CONFLICT(message_id) DO NOTHING;
UPDATE inbox i SET status='DEAD',retry_token=NULL WHERE i.status='RETRY_SCHEDULED'
  AND NOT EXISTS(SELECT 1 FROM retry_jobs p WHERE p.message_id=i.message_id AND p.status='PENDING');

INSERT INTO outbox(message_id,aggregate_id,destination,routing_key,envelope)
SELECT md5('diagnostic:retry:'||r.message_id::text||':'||r.attempt::text)::uuid,r.message_id,
       'umc.retry.diagnostic.v1','retry',jsonb_build_object('schemaVersion',1,'service','diagnostic',
          'input',jsonb_build_object('messageId',r.message_id,'exchange',r.exchange_name,'routingKey',r.routing_key,
             'body',replace(encode(r.body,'base64'),E'\n',''),'attempt',r.attempt,
             'retryToken',md5('diagnostic:retry:'||r.message_id::text||':'||r.attempt::text)::uuid),
          'notBefore',r.due_at)
FROM retry_jobs r WHERE r.status='PENDING';
UPDATE inbox i SET retry_token=md5('diagnostic:retry:'||r.message_id::text||':'||r.attempt::text)::uuid,
    delivery_attempt=r.attempt FROM retry_jobs r WHERE i.message_id=r.message_id AND r.status='PENDING';

INSERT INTO outbox(message_id,aggregate_id,destination,routing_key,envelope)
SELECT md5('diagnostic:legacy-dead:'||d.id::text)::uuid,d.id,'umc.deadletters.diagnostic.v1','diagnostic.quarantine.v1',
       jsonb_build_object('deadLetterId',d.id,'originalMessageId',d.message_id,'exchange',d.exchange_name,
           'routingKey',d.routing_key,'reasonCode',d.reason_code,'payloadHash',d.payload_hash,
           'body',replace(encode(d.body,'base64'),E'\n',''),'recordedAt',d.created_at)
FROM dead_letters d WHERE NOT EXISTS(SELECT 1 FROM outbox o WHERE o.aggregate_id=d.id
    AND o.destination='umc.deadletters.diagnostic.v1');

DROP TABLE retry_jobs;
DROP TABLE dead_letters;

-- The normalized specimen table already owns the global barcode invariant.
DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM specimen_barcodes b LEFT JOIN specimens s ON s.barcode=b.barcode
        WHERE s.id IS NULL OR s.order_id<>b.order_id) THEN
        RAISE EXCEPTION 'Cannot remove barcode registry: unmatched legacy barcode';
    END IF;
END $$;
DROP TABLE specimen_barcodes;

-- Unify the previously duplicated replay store without changing public response data.
DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM objects WHERE kind='replay' AND (
        key !~ '^[0-9a-fA-F-]{36}:[^:]+:[0-9a-fA-F-]{36}$'
        OR jsonb_typeof(value->'hash') IS DISTINCT FROM 'string'
        OR COALESCE(value->>'hash','')='' OR NOT(value ? 'response'))) THEN
        RAISE EXCEPTION 'Cannot migrate malformed Diagnostic idempotency record';
    END IF;
    IF EXISTS(WITH replays AS MATERIALIZED (SELECT key,value FROM objects WHERE kind='replay')
        SELECT 1 FROM replays o JOIN idempotency_records i
        ON i.actor_id=split_part(o.key,':',1)::uuid AND i.operation=split_part(o.key,':',2)
           AND i.idempotency_key=split_part(o.key,':',3)::uuid
        WHERE i.request_hash IS DISTINCT FROM (o.value->>'hash') OR i.response IS DISTINCT FROM (o.value->'response')) THEN
        RAISE EXCEPTION 'Conflicting Diagnostic idempotency stores; reconcile before migration';
    END IF;
END $$;
INSERT INTO idempotency_records(actor_id,operation,idempotency_key,request_hash,response)
SELECT split_part(key,':',1)::uuid,split_part(key,':',2),split_part(key,':',3)::uuid,value->>'hash',value->'response'
FROM objects WHERE kind='replay' ON CONFLICT(actor_id,operation,idempotency_key) DO NOTHING;
DELETE FROM objects WHERE kind='replay';

ALTER TABLE inbox ADD CONSTRAINT inbox_retry_token_state CHECK ((status='RETRY_SCHEDULED')=(retry_token IS NOT NULL));
