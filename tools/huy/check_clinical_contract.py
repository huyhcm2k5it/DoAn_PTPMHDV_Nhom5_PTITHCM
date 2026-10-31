"""Validate Clinical schemas and optionally actual PostgreSQL-backed HTTP responses."""
import copy
import json
from pathlib import Path
import sys
from jsonschema import Draft202012Validator, FormatChecker
from openapi_spec_validator import validate

root=Path(__file__).resolve().parents[2]
doc=json.loads((root/'contracts/http/clinical.openapi.json').read_text(encoding='utf-8'))
validate(doc)
assert sorted(v['operationId'] for p in doc['paths'].values() for v in p.values())==['CL_001','CL_002','CL_003','CL_004']
def validator(name):
    return Draft202012Validator({'$ref':'#/components/schemas/'+name,'components':doc['components']},format_checker=FormatChecker())
draft={'symptoms':'','findings':'','assessment':'','diagnosis':'','expectedVersion':1}
validator('DraftInput').validate(draft)
for bad in [{k:v for k,v in draft.items() if k!='diagnosis'},dict(draft,expectedVersion=0),dict(draft,symptoms=None),dict(draft,patientId='spoof')]:
    assert list(validator('DraftInput').iter_errors(bad)),bad
queue=json.loads((root/'contracts/messages/clinical-queue.v1.schema.json').read_text())
check=Draft202012Validator(queue,format_checker=FormatChecker());uuid='11111111-0000-0000-0000-000000000001'
sample={'messageId':uuid,'messageKind':'EVENT','messageType':'QueueTicketClaimed','schemaVersion':1,'producer':'appointment','aggregateId':uuid,'aggregateVersion':1,'correlationId':'test-trace','causationId':uuid,'requestId':uuid,'occurredAt':'2026-10-27T01:00:00Z','payload':{'requestId':uuid,'ticketId':uuid,'appointmentId':uuid,'patientId':uuid,'claimId':uuid,'state':'ACCEPTED'}}
check.validate(sample)
for name in ['producer','schemaVersion','payload']:
    bad=copy.deepcopy(sample)
    if name=='producer':bad[name]='billing'
    elif name=='schemaVersion':bad[name]=2
    else:del bad['payload']['claimId']
    assert list(check.iter_errors(bad)),bad
snapshot=json.loads((root/'contracts/messages/clinical-ticket-snapshot.v1.schema.json').read_text())
Draft202012Validator.check_schema(snapshot)
if len(sys.argv)>1:
    fixtures=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    assert set(fixtures)=={'StartResponse','WorklistResponse','VisitDetailResponse','DraftResponse','Error'}
    for name,body in fixtures.items():validator(name).validate(body)
    print('PASS: actual PostgreSQL/HTTP response fixtures match all 4 operations + error envelope')
print('PASS: Clinical OpenAPI, required draft fields, queue producer/version/claim constraints and snapshot schema')
