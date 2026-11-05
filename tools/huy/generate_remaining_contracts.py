"""Generate versioned Catalog and Diagnostic lifecycle message schemas and fixtures."""
import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "contracts/messages"
EXAMPLES = OUT / "examples"
EXAMPLES.mkdir(parents=True, exist_ok=True)
UUID = {"type": "string", "format": "uuid"}
VERSION = {"type": "integer", "minimum": 1, "maximum": 2147483647}
STREAM_SEQUENCE = {"type": "integer", "minimum": 0, "maximum": 9223372036854775807}
DATE_TIME = {"type": "string", "format": "date-time"}

def obj(properties, required=None):
    return {"type": "object", "properties": properties,
            "required": list(properties) if required is None else required,
            "additionalProperties": False}

def envelope(message_type, producer, payload):
    return obj({
        "messageId": UUID,
        "messageKind": {"const": "EVENT"},
        "messageType": {"const": message_type},
        "schemaVersion": {"const": 1},
        "producer": producer,
        "aggregateId": UUID,
        "aggregateVersion": VERSION,
        "correlationId": {"type": "string", "minLength": 1, "maxLength": 128},
        "causationId": UUID,
        "requestId": UUID,
        "occurredAt": DATE_TIME,
        "payload": payload,
    })

catalog_payload = obj({
    "entityType": {"enum": ["DEPARTMENT", "DOCTOR", "SERVICE", "MEDICINE", "LAB_TEST", "PRICE_VERSION", "STREAM"]},
    "entityId": UUID,
    "entityVersion": VERSION,
    "fullSnapshot": {"type": "object"},
    "effectiveAt": DATE_TIME,
    "streamSequence": STREAM_SEQUENCE,
    "mode": {"enum": ["UPSERT", "TOMBSTONE", "CHECKPOINT"]},
})
catalog_payload["allOf"] = [{
    "if": {"properties": {"mode": {"const": "CHECKPOINT"}}},
    "then": {"properties": {"entityType": {"const": "STREAM"}}},
}, {
    "if": {"properties": {"mode": {"enum": ["UPSERT", "TOMBSTONE"]}}},
    "then": {"properties": {"streamSequence": {"minimum": 1}}},
}]
catalog = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:umc-care:catalog-changed:v1",
    "title": "CatalogChanged v1",
    "description": "Full entity snapshots, tombstones and stream checkpoints. New producer identity is lowercase catalog; uppercase Catalog is accepted only for already persisted v1 deliveries.",
    **envelope("CatalogChanged", {"enum": ["catalog", "Catalog"]}, catalog_payload),
}
(OUT / "catalog.v1.schema.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

base = {
    "messageId": "11111111-1111-4111-8111-111111111101",
    "messageKind": "EVENT",
    "schemaVersion": 1,
    "producer": "diagnostic",
    "aggregateId": "22222222-2222-4222-8222-222222222202",
    "aggregateVersion": 2,
    "correlationId": "task-bk01",
    "causationId": "33333333-3333-4333-8333-333333333303",
    "requestId": "44444444-4444-4444-8444-444444444404",
    "occurredAt": "2026-11-05T10:00:00Z",
}
published_payload = obj({
    "orderId": UUID,
    "visitId": UUID,
    "revision": VERSION,
    "publishedAt": DATE_TIME,
    "recipientUserId": UUID,
    "version": VERSION,
})
cancelled_payload = obj({
    "orderId": UUID,
    "visitId": UUID,
    "cancellationId": UUID,
    "noSpecimen": {"const": True},
    "reasonCode": {"type": "string", "minLength": 1, "maxLength": 128},
    "version": VERSION,
})
lab_lifecycle = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:umc-care:diagnostic-lifecycle:v1",
    "title": "Diagnostic lifecycle events v1",
    "description": "Terminal events contain identifiers and state only. LabResultPublished never includes medical result values.",
    "oneOf": [
        envelope("LabResultPublished", {"const": "diagnostic"}, published_payload),
        envelope("LabCancelled", {"const": "diagnostic"}, cancelled_payload),
    ],
}
(OUT / "lab-lifecycle.v1.schema.json").write_text(json.dumps(lab_lifecycle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

examples = {}
price_id = "55555555-5555-4555-8555-555555555505"
item_id = "66666666-6666-4666-8666-666666666606"
examples["catalog-price-upsert.json"] = {
    "messageId": "11111111-1111-4111-8111-111111111111", "messageKind": "EVENT",
    "messageType": "CatalogChanged", "schemaVersion": 1, "producer": "catalog",
    "aggregateId": item_id, "aggregateVersion": 1, "correlationId": "catalog-seed-1",
    "causationId": "77777777-7777-4777-8777-777777777707", "requestId": "88888888-8888-4888-8888-888888888808",
    "occurredAt": "2026-11-05T10:00:00Z", "payload": {
        "entityType": "PRICE_VERSION", "entityId": price_id, "entityVersion": 1,
        "fullSnapshot": {"priceVersionId": price_id, "itemId": item_id, "revision": 1, "amountVnd": 125000,
                         "effectiveFrom": "2026-11-05T00:00:00Z", "status": "ACTIVE"},
        "effectiveAt": "2026-11-05T00:00:00Z", "streamSequence": 41, "mode": "UPSERT"}}
examples["catalog-checkpoint.json"] = {
    "messageId": "11111111-1111-4111-8111-111111111112", "messageKind": "EVENT",
    "messageType": "CatalogChanged", "schemaVersion": 1, "producer": "catalog",
    "aggregateId": "99999999-9999-4999-8999-999999999909", "aggregateVersion": 1,
    "correlationId": "catalog-checkpoint-42", "causationId": "77777777-7777-4777-8777-777777777707",
    "requestId": "88888888-8888-4888-8888-888888888808", "occurredAt": "2026-11-05T10:00:10Z",
    "payload": {"entityType": "STREAM", "entityId": "99999999-9999-4999-8999-999999999909",
                "entityVersion": 1, "fullSnapshot": {"sequence": 42, "at": "2026-11-05T10:00:10Z"},
                "effectiveAt": "2026-11-05T10:00:10Z", "streamSequence": 42, "mode": "CHECKPOINT"}}
examples["lab-result-published.json"] = {
    **copy.deepcopy(base), "messageType": "LabResultPublished", "payload": {
        "orderId": base["aggregateId"], "visitId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "revision": 1, "publishedAt": "2026-11-05T10:00:00Z",
        "recipientUserId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "version": 2}}
examples["lab-cancelled.json"] = {
    **copy.deepcopy(base), "messageId": "11111111-1111-4111-8111-111111111102", "messageType": "LabCancelled",
    "payload": {"orderId": base["aggregateId"], "visitId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                "cancellationId": "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "noSpecimen": True,
                "reasonCode": "DOCTOR_REQUEST", "version": 2}}
for name, value in examples.items():
    (EXAMPLES / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

invalid = {}
invalid["lab-invalid-producer.json"] = copy.deepcopy(examples["lab-result-published.json"])
invalid["lab-invalid-producer.json"]["producer"] = "billing"
invalid["lab-invalid-order-id.json"] = copy.deepcopy(examples["lab-result-published.json"])
invalid["lab-invalid-order-id.json"]["payload"]["orderId"] = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
invalid["lab-invalid-envelope-version.json"] = copy.deepcopy(examples["lab-result-published.json"])
invalid["lab-invalid-envelope-version.json"]["aggregateVersion"] = 3
invalid["lab-invalid-result-revision.json"] = copy.deepcopy(examples["lab-result-published.json"])
invalid["lab-invalid-result-revision.json"]["payload"]["revision"] = 0
invalid["lab-invalid-medical-payload.json"] = copy.deepcopy(examples["lab-result-published.json"])
invalid["lab-invalid-medical-payload.json"]["payload"]["valueText"] = "sensitive result"
for name, value in invalid.items():
    (EXAMPLES / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Generated CatalogChanged, LabResultPublished, LabCancelled schemas and fixtures")
