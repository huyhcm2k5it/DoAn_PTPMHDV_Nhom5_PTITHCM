"""Validate Diagnostic OpenAPI and optional actual HTTP response fixtures."""
import json
from pathlib import Path
import sys
from jsonschema import Draft202012Validator, FormatChecker
from openapi_spec_validator import validate

root = Path(__file__).resolve().parents[2]
doc = json.loads((root/'contracts/http/diagnostic.openapi.json').read_text(encoding='utf-8'))
validate(doc)
assert sorted(v['operationId'] for p in doc['paths'].values() for v in p.values()) == ['DI_%03d'%n for n in range(1,14)]
assert '/api/v1/diagnostic-orders' in doc['paths']
assert doc['paths']['/api/v1/diagnostic-orders']['post'].get('x-enabled-by-default') is False, 'Recovery endpoint must remain disabled'
assert doc['paths']['/api/v1/diagnostic-orders']['post'].get('x-visibility') == 'private', 'Recovery endpoint must remain private'
assert 'LabResultItem' in doc['components']['schemas']
assert 'lifecycleState' in doc['components']['schemas']['Order']['properties']
assert 'expectedVersion' in doc['components']['schemas']['ResultUpdateInput']['required']
assert 'X-Authorization-Lease' in [p['name'] for p in doc['paths']['/api/v1/patients/{patientId}/published-results']['get']['parameters']]

def validator(name):
    return Draft202012Validator({'$ref':'#/components/schemas/'+name,'components':doc['components']},format_checker=FormatChecker())

validator('SampleInput').validate({})
validator('RejectInput').validate({'reasonCode':'HEMOLYSIS','expectedVersion':1})
for bad in [{}, {'reasonCode':'','expectedVersion':1}, {'reasonCode':'HEMOLYSIS','expectedVersion':0},
            {'reasonCode':'HEMOLYSIS','expectedVersion':1,'collectedBy':'spoof'}]:
    assert list(validator('RejectInput').iter_errors(bad)), bad
assert list(validator('SampleInput').iter_errors({'chargeState':'PAID'}))
if len(sys.argv)>1:
    validated = 0
    fixture_names = set()
    for fixture_path in sys.argv[1:]:
        fixtures=json.loads(Path(fixture_path).read_text(encoding='utf-8'))
        assert fixtures, f'No actual Diagnostic HTTP fixtures were captured in {fixture_path}'
        for name,body in fixtures.items():
            validator(name).validate(body)
            fixture_names.add(name)
            validated += 1
    required = {'ResultDataResponse', 'PublishedResultsResponse', 'Error'}
    assert required <= fixture_names, f'Missing actual Diagnostic response fixtures: {sorted(required-fixture_names)}'
    print(f'PASS: actual Diagnostic HTTP response fixtures ({validated} responses)')
print('PASS: Diagnostic OpenAPI, strict inputs and disabled recovery surface')
