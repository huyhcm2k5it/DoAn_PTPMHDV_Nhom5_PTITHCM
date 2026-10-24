"""Regenerate the Catalog OpenAPI contract; no business logic runs here."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ref = lambda name: {"$ref": f"#/components/schemas/{name}"}
uuid = {"type": "string", "format": "uuid"}
stamp = {"type": "string", "format": "date-time"}
price_stamp = {**stamp, "pattern": r"T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$", "description": "At most 6 fractional-second digits (PostgreSQL microsecond precision)"}
string = {"type": "string"}
status = {"type": "string", "enum": ["ACTIVE", "INACTIVE"]}

def obj(properties, required=None):
    return {"type": "object", "properties": properties, "required": required or list(properties), "additionalProperties": False}

def array(schema):
    return {"type": "array", "items": schema}

price_input = {"itemType": {"type": "string", "enum": ["EXAM", "LAB", "MEDICINE"]}, "itemId": uuid,
               "amountVnd": {"type": "integer", "format": "int64", "minimum": 0, "maximum": 9223372036854775807},
               "effectiveFrom": price_stamp, "effectiveTo": {**price_stamp, "type": ["string", "null"]}}
price_required = ["itemType", "itemId", "amountVnd", "effectiveFrom"]
price_ref = {"oneOf": [ref("Price"), {"type": "null"}]}
schemas = {
    "Department": obj({"id": uuid, "code": string, "name": string, "status": status}),
    "Doctor": obj({"id": uuid, "departmentId": uuid, "displayName": string, "status": status}),
    "PriceInput": obj(price_input, price_required),
    "Price": obj({"priceVersionId": uuid, "revision": {"type": "integer", "minimum": 1}, **price_input}, ["priceVersionId", "revision", *price_required]),
    "PriceResult": obj({"priceVersionId": uuid, "revision": {"type": "integer", "minimum": 1}, "effectiveFrom": stamp}),
    "MedicalService": obj({"id": uuid, "departmentId": uuid, "code": string, "name": string, "status": status, "price": price_ref}),
    "Medicine": obj({"id": uuid, "code": string, "name": string, "unit": string, "strength": string, "form": string, "status": status, "price": price_ref}, ["id", "code", "name", "unit", "status", "price"]),
    "LabTest": obj({"id": uuid, "code": string, "name": string, "specimenType": string, "unit": string, "referenceRange": string, "revision": {"type": "integer", "minimum": 1}, "status": status, "price": price_ref}, ["id", "code", "name", "specimenType", "revision", "status", "price"]),
    "Meta": obj({"correlationId": {"type": "string", "minLength": 1, "maxLength": 100}}),
    "Error": obj({"error": obj({"code": {"type": "string", "enum": ["VALIDATION_ERROR", "UNAUTHENTICATED", "FORBIDDEN", "OVERLAPPING_PRICE_PERIOD", "IDEMPOTENCY_CONFLICT", "SERVICE_UNAVAILABLE", "NOT_FOUND", "METHOD_NOT_ALLOWED"]}, "message": string}), "meta": ref("Meta")}),
}

def envelope(schema):
    return obj({"data": schema, "meta": ref("Meta")})

schemas.update({
    "DepartmentsResponse": envelope(obj({"items": array(ref("Department"))})),
    "DoctorsResponse": envelope(obj({"items": array(ref("Doctor")), "total": {"type": "integer", "minimum": 0}})),
    "ServicesResponse": envelope(obj({"items": array(ref("MedicalService"))})),
    "MedicinesResponse": envelope(array(ref("Medicine"))),
    "LabTestsResponse": envelope(array(ref("LabTest"))),
    "PriceResponse": envelope(ref("PriceResult")),
})

def parameter(name, schema, location="query", required=False, description=""):
    return {"name": name, "in": location, "required": required, "schema": schema, "description": description}

correlation = parameter("X-Correlation-ID", {"type": "string", "pattern": "^[A-Za-z0-9._:-]{1,100}$"}, "header", description="Optional. Missing/unsafe value is replaced by a server UUID.")
department = parameter("departmentId", uuid)
headers = {"X-Correlation-ID": {"description": "Correlation ID for this response", "schema": string}}

def operation(code, summary, response, description, params=None, protected=False, create=False):
    errors = {400: "Invalid input", 503: "Database or required Identity verification unavailable"}
    if protected:
        errors.update({401: "Missing, invalid or expired bearer", 403: "Insufficient current permission or authorization lease"})
    if create:
        errors[409] = "OVERLAPPING_PRICE_PERIOD or IDEMPOTENCY_CONFLICT"
    responses = {str(k): {"description": v, "headers": headers, "content": {"application/json": {"schema": ref("Error")}}} for k, v in errors.items()}
    responses["201" if create else "200"] = {"description": "Created (also on an idempotent replay)" if create else "Success", "headers": headers, "content": {"application/json": {"schema": ref(response)}}}
    result = {"operationId": code, "summary": summary, "description": description, "tags": ["Catalog"], "parameters": [correlation, *(params or [])], "security": [{"bearerAuth": [], **({"authorizationLease": []} if create else {})}] if protected else [], "responses": responses}
    if create:
        result["requestBody"] = {"required": True, "content": {"application/json": {"schema": ref("PriceInput"), "example": {"itemType": "EXAM", "itemId": "00000000-0000-4000-8000-000000000201", "amountVnd": 150000, "effectiveFrom": "2026-11-10T02:00:00Z", "effectiveTo": "2026-11-11T02:00:00Z"}}}}
    return result

search = [parameter("q", {"type": "string", "maxLength": 200}, description="Case-insensitive name or code search"), parameter("status", status, description="Defaults to ACTIVE")]
paths = {
    "/api/v1/departments": {"get": operation("CA_001", "List active departments", "DepartmentsResponse", "Public; stable ordering by name/id.")},
    "/api/v1/doctors": {"get": operation("CA_002", "List active doctors", "DoctorsResponse", "Public. Uses Catalog doctorId; never returns Identity user IDs. No name search parameter in the baseline.", [department, parameter("page", {"type": "integer", "minimum": 1, "maximum": 1000000, "default": 1}), parameter("limit", {"type": "integer", "minimum": 1, "maximum": 100, "default": 20})])},
    "/api/v1/medical-services": {"get": operation("CA_003", "List medical services with price effective at a time", "ServicesResponse", "Public. Default at is server now. Price is null when unavailable. Displayed price is not a Billing quote.", [department, parameter("at", stamp)])},
    "/api/v1/prices": {"post": operation("CA_004", "Create an immutable future price version", "PriceResponse", "STAFF with ADMIN in verified JWT and current access projection; requires an RS256 authorization lease for action CA-004, at most 30 seconds. effectiveFrom >= server now + 5 minutes; periods are half-open [from,to), missing/null to is unbounded; no automatic closing of old prices. Price, idempotency response, sequence and outbox insert commit atomically. Same actor/key + canonical body replays original 201, including after effectiveFrom; changed body is 409. Int64 VND; browser form restricts writes to safe integers. Maximum body 64 KiB. Unknown JSON fields are rejected.", [parameter("Idempotency-Key", uuid, "header", True)], True, True)},
    "/api/v1/catalog/medicines": {"get": operation("CA_005", "List medicine catalog", "MedicinesResponse", "DOCTOR or STAFF with PHARMACY/ADMIN, verified against current local access projection. No inventory/stock fields. data is an array.", search, True)},
    "/api/v1/catalog/lab-tests": {"get": operation("CA_006", "List laboratory test catalog", "LabTestsResponse", "DOCTOR or STAFF with LAB_TECH/LAB_REVIEW/ADMIN, verified against current local access projection. data is an array.", search, True)},
}
document = {"openapi": "3.1.1", "info": {"title": "UMC Care - Catalog", "version": "0.1.0", "description": "Week-one implementation contract from API86 v5.2 / ERD v5. Health endpoints are technical and documented separately. JWT/lease claims and event envelope require integration agreement with Identity/Gateway owners."}, "servers": [{"url": "http://127.0.0.1:8081", "description": "Huy local service, before Gateway integration"}], "tags": [{"name": "Catalog"}], "paths": paths, "components": {"schemas": schemas, "securitySchemes": {"bearerAuth": {"type": "http", "scheme": "bearer", "bearerFormat": "JWT RS256"}, "authorizationLease": {"type": "apiKey", "in": "header", "name": "X-Authorization-Lease", "description": "Short-lived signed JWT from Identity; never a caller-declared role"}}}}
target = ROOT / "contracts/http/catalog.openapi.json"
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(target)
