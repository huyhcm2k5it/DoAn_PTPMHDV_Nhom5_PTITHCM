-- The publisher must select the earliest stream event, including when it is
-- delayed. Index that exact order rather than scanning/sorting the JSON backlog.
-- Checkpoints at the same sequence follow the entity change they confirm.
CREATE INDEX outbox_pending_stream_order ON outbox (
    ((payload->'payload'->>'streamSequence')::bigint),
    (CASE WHEN payload->'payload'->>'mode'='CHECKPOINT' THEN 1 ELSE 0 END),
    created_at, message_id
) WHERE status='PENDING';
