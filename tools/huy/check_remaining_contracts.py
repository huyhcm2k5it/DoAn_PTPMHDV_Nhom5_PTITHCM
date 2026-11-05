"""Validate remaining Huy HTTP and lifecycle message contracts and examples."""
import json
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[2]
MESSAGES = ROOT / "contracts/messages"
EXAMPLES = MESSAGES / "examples"

def read(path):
    return json.loads(path.read_text(encoding="utf-8"))

def event_identity_errors(event):
    payload = event["payload"]
    errors = []
    if event["messageType"] == "CatalogChanged":
        if event["aggregateVersion"] != payload["entityVersion"]:
            errors.append("aggregateVersion must match entityVersion")
        snapshot_revision = payload["fullSnapshot"].get("revision")
        if snapshot_revision is not None and snapshot_revision != payload["entityVersion"]:
            errors.append("snapshot revision must match entityVersion")
    else:
        if event["aggregateId"] != payload["orderId"]:
            errors.append("aggregateId must match orderId")
        if event["aggregateVersion"] != payload["version"]:
            errors.append("aggregateVersion must match payload version")
    return errors

catalog = read(MESSAGES / "catalog.v1.schema.json")
lifecycle = read(MESSAGES / "lab-lifecycle.v1.schema.json")
Draft202012Validator.check_schema(catalog)
Draft202012Validator.check_schema(lifecycle)
catalog_validator = Draft202012Validator(catalog, format_checker=FormatChecker())
lifecycle_validator = Draft202012Validator(lifecycle, format_checker=FormatChecker())
valid_catalog = ["catalog-price-upsert.json", "catalog-checkpoint.json"]
valid_lab = ["lab-result-published.json", "lab-cancelled.json"]
for name in valid_catalog:
    item = read(EXAMPLES / name)
    catalog_validator.validate(item)
    assert not event_identity_errors(item), (name, event_identity_errors(item))
for name in valid_lab:
    item = read(EXAMPLES / name)
    lifecycle_validator.validate(item)
    assert not event_identity_errors(item), (name, event_identity_errors(item))
for name in ["lab-invalid-producer.json", "lab-invalid-result-revision.json", "lab-invalid-medical-payload.json"]:
    item = read(EXAMPLES / name)
    assert list(lifecycle_validator.iter_errors(item)), name
for name in ["lab-invalid-order-id.json", "lab-invalid-envelope-version.json"]:
    item = read(EXAMPLES / name)
    lifecycle_validator.validate(item)
    assert event_identity_errors(item), name
assert "valueText" not in lifecycle["oneOf"][0]["properties"]["payload"]["properties"]
print("PASS: CatalogChanged and lab lifecycle schemas, valid examples, invalid producer/ID/revision/medical field")
