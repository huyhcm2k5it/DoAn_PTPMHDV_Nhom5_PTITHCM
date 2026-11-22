-- Stop old API/workers before applying. Pending retries are handed off through
-- outbox atomically, retaining their original source, attempt, body and due time.
ALTER TABLE inbox ADD COLUMN retry_token uuid;
ALTER TABLE inbox ADD COLUMN delivery_attempt integer NOT NULL DEFAULT 0 CHECK(delivery_attempt BETWEEN 0 AND 3);

-- Legacy schedulers could mark the job complete without finishing the inbox.
-- Preserve those failures for operator review; never invent a missing body.
INSERT INTO outbox(message_id,aggregate_id,destination,routing_key,envelope)
SELECT md5('clinical:orphan-retry:'||i.message_id::text)::uuid,i.message_id,
       'umc.deadletters.clinical.v1','clinical.quarantine.v1',
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
SELECT md5('clinical:retry:'||r.message_id::text||':'||r.attempt::text)::uuid,r.message_id,
       'umc.retry.clinical.v1','retry',jsonb_build_object('schemaVersion',1,'service','clinical',
          'input',jsonb_build_object('messageId',r.message_id,'exchange',r.exchange_name,'routingKey',r.routing_key,
             'body',replace(encode(r.body,'base64'),E'\n',''),'attempt',r.attempt,
             'retryToken',md5('clinical:retry:'||r.message_id::text||':'||r.attempt::text)::uuid),
          'notBefore',r.due_at)
FROM retry_jobs r WHERE r.status='PENDING';
UPDATE inbox i SET retry_token=md5('clinical:retry:'||r.message_id::text||':'||r.attempt::text)::uuid,
    delivery_attempt=r.attempt FROM retry_jobs r WHERE i.message_id=r.message_id AND r.status='PENDING';

INSERT INTO outbox(message_id,aggregate_id,destination,routing_key,envelope)
SELECT md5('clinical:legacy-dead:'||d.id::text)::uuid,d.id,'umc.deadletters.clinical.v1','clinical.quarantine.v1',
       jsonb_build_object('deadLetterId',d.id,'originalMessageId',d.message_id,'exchange',d.exchange_name,
           'routingKey',d.routing_key,'reasonCode',d.reason_code,'payloadHash',d.payload_hash,
           'body',replace(encode(d.body,'base64'),E'\n',''),'recordedAt',d.created_at)
FROM dead_letters d WHERE NOT EXISTS(SELECT 1 FROM outbox o WHERE o.aggregate_id=d.id
    AND o.destination='umc.deadletters.clinical.v1');

DROP TABLE retry_jobs;
DROP TABLE dead_letters;

ALTER TABLE inbox ADD CONSTRAINT inbox_retry_token_state CHECK ((status='RETRY_SCHEDULED')=(retry_token IS NOT NULL));
