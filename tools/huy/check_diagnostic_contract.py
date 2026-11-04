"""Validate Diagnostic OpenAPI and optional actual HTTP response fixtures."""
import json
from pathlib import Path
import sys
from jsonschema import Draft202012Validator, FormatChecker
from openapi_spec_validator import validate

root = Path(__file__).resolve().parents[2]
doc = json.loads((root/'contracts/http/diagnostic.openapi.json').read_text(encoding='utf-8'))
validate(doc)
assert sorted(v['operationId'] for p in doc['paths'].values() for v in p.values()) == ['DI_%03d'%n for n in range(2,7)]
assert '/api/v1/diagnostic-orders' in doc['paths']
assert 'post' not in doc['paths']['/api/v1/diagnostic-orders'], 'Recovery endpoint must remain disabled'

def validator(name):
    return Draft202012Validator({'$ref':'#/components/schemas/'+name,'components':doc['components']},format_checker=FormatChecker())

validator('SampleInput').validate({})
validator('RejectInput').validate({'reasonCode':'HEMOLYSIS','expectedVersion':1})
for bad in [{}, {'reasonCode':'','expectedVersion':1}, {'reasonCode':'HEMOLYSIS','expectedVersion':0},
            {'reasonCode':'HEMOLYSIS','expectedVersion':1,'collectedBy':'spoof'}]:
    assert list(validator('RejectInput').iter_errors(bad)), bad
assert list(validator('SampleInput').iter_errors({'chargeState':'PAID'}))
if len(sys.argv)>1:
    fixtures=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    assert fixtures, 'No actual HTTP fixtures were captured'
    for name,body in fixtures.items():
        validator(name).validate(body)
    print('PASS: actual Diagnostic HTTP response fixtures')
print('PASS: Diagnostic OpenAPI, strict inputs and disabled recovery surface')
