-- Historical quarantine stored metadata only. Preserve that limitation explicitly.
INSERT INTO outbox(message_id,aggregate_id,aggregate_version,message_kind,message_type,producer,
                   destination,routing_key,payload,payload_hash)
SELECT md5('catalog:legacy-dead:'||q.message_id||':'||q.payload_hash)::uuid,
       md5('catalog:legacy-dead:'||q.message_id||':'||q.payload_hash)::uuid,
       1,'EVENT','CatalogQuarantined','catalog','umc.deadletters.catalog.v1','catalog.quarantine.v1',
       jsonb_build_object('originalMessageId',q.message_id,'payloadHash',q.payload_hash,'exchange',q.exchange_name,
          'routingKey',q.routing_key,'reasonCode',q.reason_code,'recordedAt',q.received_at,'historicalBodyUnavailable',true),
       q.payload_hash
FROM catalog_quarantine q;
DROP TABLE catalog_quarantine;

-- State the ERD candidate key explicitly in addition to the exclusion constraint.
ALTER TABLE price_versions ADD CONSTRAINT price_versions_item_start_key UNIQUE(item_type,item_id,effective_from);
