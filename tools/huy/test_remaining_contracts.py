import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]

def operations(path):
    document = json.loads((root / path).read_text(encoding="utf-8"))
    return document, {
        operation["operationId"]: (route, method, operation)
        for route, methods in document["paths"].items()
        for method, operation in methods.items()
    }

clinical, clinical_ops = operations("contracts/http/clinical.openapi.json")
diagnostic, diagnostic_ops = operations("contracts/http/diagnostic.openapi.json")

assert "CL_011" in clinical_ops, "CL-011 medical records contract is missing"
assert set(f"DI_{n:03}" for n in range(2, 14)) <= set(diagnostic_ops), "DI-007..013 result, cancellation, and published-results contracts are missing"
recovery = diagnostic["paths"]["/api/v1/diagnostic-orders"].get("post", {})
assert recovery.get("operationId") == "DI_001", "DI-001 recovery contract is missing"
assert recovery.get("x-enabled-by-default") is False, "DI-001 recovery must stay disabled by default"
assert recovery.get("x-visibility") == "private", "DI-001 recovery must stay private"

expected_routes = {
    "DI_007": ("/api/v1/diagnostic-orders/{orderId}/results", "post"),
    "DI_008": ("/api/v1/results/{resultId}", "put"),
    "DI_009": ("/api/v1/results/{resultId}/submit-review", "post"),
    "DI_010": ("/api/v1/results/{resultId}/return-rework", "post"),
    "DI_011": ("/api/v1/results/{resultId}/publish", "post"),
    "DI_012": ("/api/v1/diagnostic-orders/{orderId}/cancel", "post"),
    "DI_013": ("/api/v1/patients/{patientId}/published-results", "get"),
}
for operation_id, route in expected_routes.items():
    assert diagnostic_ops[operation_id][:2] == route, f"{operation_id} route/method mismatch"
assert clinical_ops["CL_011"][:2] == ("/api/v1/patients/{patientId}/medical-records", "get")

schemas = diagnostic["components"]["schemas"]
assert "lifecycleState" in schemas["Order"]["properties"], "compatibility lifecycle state mapping is missing"
assert "LabResultItem" in schemas and {"testCode", "valueText"} <= set(schemas["LabResultItem"]["required"])
assert "Result" in schemas and {"DRAFT", "REVIEW", "REWORK", "PUBLISHED"} <= set(schemas["Result"]["properties"]["state"]["enum"])
assert "expectedVersion" in schemas["ResultUpdateInput"]["required"]
assert "expectedVersion" in schemas["ReviewInput"]["required"]
assert {"expectedVersion", "reasonCode"} <= set(schemas["CancelInput"]["required"])
catalog_schema_path = root / "contracts/messages/catalog.v1.schema.json"
lab_schema_path = root / "contracts/messages/lab-lifecycle.v1.schema.json"
assert catalog_schema_path.is_file(), "CatalogChanged v1 schema is missing"
assert lab_schema_path.is_file(), "LabResultPublished/LabCancelled v1 schemas are missing"
catalog_schema = json.loads(catalog_schema_path.read_text(encoding="utf-8"))
lab_schema = json.loads(lab_schema_path.read_text(encoding="utf-8"))
assert catalog_schema["properties"]["messageType"]["const"] == "CatalogChanged"
assert {item["properties"]["messageType"]["const"] for item in lab_schema["oneOf"]} == {"LabResultPublished", "LabCancelled"}
examples = root / "contracts/messages/examples"
for name in ["catalog-price-upsert.json", "catalog-checkpoint.json", "lab-result-published.json",
             "lab-cancelled.json", "lab-invalid-producer.json", "lab-invalid-order-id.json",
             "lab-invalid-envelope-version.json", "lab-invalid-result-revision.json",
             "lab-invalid-medical-payload.json"]:
    assert (examples / name).is_file(), f"missing contract fixture: {name}"
print("PASS: remaining Huy HTTP contracts, lifecycle event schemas, fixtures, and private recovery boundary")
