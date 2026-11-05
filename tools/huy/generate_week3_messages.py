"""Cross-owner message boundary for the week 3 Clinical/Diagnostic increment."""
import json
from pathlib import Path
from generate_clinical_contract import obj, uuid, version, date_time, base

root=Path(__file__).resolve().parents[2]
text={'type':'string'}
test=obj({'testId':uuid,'revision':version,'code':text,'name':text,'unit':text,'referenceRange':text})
payloads={
 'CreateLabOrder':('COMMAND','clinical',obj({'requestId':uuid,'visitId':uuid,'patientId':uuid,'doctorId':uuid,
     'testSnapshot':{'type':'array','minItems':1,'maxItems':100,'items':test},
     'requestHash':{'type':'string','pattern':'^[0-9a-f]{64}$'},'authorizedAt':date_time})),
 'LabOrderResolved':('EVENT','diagnostic',obj({'requestId':uuid,'visitId':uuid,'state':{'enum':['CREATED','REJECTED']},
     'orderId':uuid,'reasonCode':text,'version':version},['requestId','visitId','state','version'])),
 'VisitSigned':('EVENT','clinical',obj({'visitId':uuid,'appointmentId':uuid,'signedAt':date_time,'version':version})),
}
payloads['LabOrderResolved'][2]['allOf']=[
 {'if':{'properties':{'state':{'const':'CREATED'}}},'then':{'required':['orderId']}},
 {'if':{'properties':{'state':{'const':'REJECTED'}}},'then':{'required':['reasonCode'],'properties':{'reasonCode':{'minLength':1}}}},
]
variants=[]
for name,(kind,producer,payload) in payloads.items():
 variants.append(obj({**base,'messageKind':{'const':kind},'messageType':{'const':name},'producer':{'const':producer},'payload':payload}))
doc={'$schema':'https://json-schema.org/draft/2020-12/schema','$id':'urn:umc-care:clinical-diagnostic:v1','oneOf':variants}
(root/'contracts/messages/clinical-diagnostic.v1.schema.json').write_text(json.dumps(doc,indent=2)+'\n',encoding='utf-8')
print('Generated CreateLabOrder, LabOrderResolved and VisitSigned message schemas')
