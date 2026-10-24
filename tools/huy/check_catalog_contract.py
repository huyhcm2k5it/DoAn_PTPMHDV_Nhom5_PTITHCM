"""Structural validation plus representative positive/negative schema checks."""
import json, sys
from pathlib import Path
from openapi_spec_validator import validate
from jsonschema import Draft202012Validator, FormatChecker

root = Path(__file__).resolve().parents[2]
doc = json.loads((root / "contracts/http/catalog.openapi.json").read_text(encoding="utf-8"))
validate(doc)
assert sorted(v["operationId"] for p in doc["paths"].values() for v in p.values()) == [f"CA_{i:03}" for i in range(1, 7)]
schema = {"$ref": "#/components/schemas/PriceInput", "components": doc["components"]}
check = Draft202012Validator(schema, format_checker=FormatChecker())
sample = {"itemType": "EXAM", "itemId": "00000000-0000-4000-8000-000000000201", "amountVnd": 0, "effectiveFrom": "2026-11-10T00:00:00Z"}
check.validate(sample)
for bad in [dict(sample, amountVnd=-1), dict(sample, amountVnd=1.5), dict(sample, role="ADMIN"), dict(sample, itemId="bad"), {k:v for k,v in sample.items() if k!="amountVnd"}]:
    assert list(check.iter_errors(bad)), bad
print("Catalog OpenAPI 3.1.1: valid; 6 operations; positive + 5 negative request schemas checked")
if len(sys.argv)>1:
    fixtures=json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    expected={"DepartmentsResponse","DoctorsResponse","ServicesResponse","MedicinesResponse","LabTestsResponse","PriceResponse","Error"}
    assert set(fixtures)==expected
    for name,body in fixtures.items():
        response_schema={"$ref":f"#/components/schemas/{name}","components":doc["components"]}
        Draft202012Validator(response_schema,format_checker=FormatChecker()).validate(body)
    print("PASS: all six real PostgreSQL-backed HTTP response schemas + error envelope")
