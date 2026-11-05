"""Generate implemented week 3 Diagnostic HTTP contracts deterministically."""
import json
from pathlib import Path
from generate_clinical_contract import obj, ref, uuid, version, date_time, operation, parameter, key, schemas

root = Path(__file__).resolve().parents[2]
text = {'type':'string'}
test = obj({'testId':uuid,'revision':version,'code':text,'name':text,'unit':text,'referenceRange':text})
price = obj({'itemId':uuid,'code':text,'name':text,'quantity':version,
             'unitPriceVnd':{'type':'integer','minimum':0},'priceVersionId':uuid,'revision':version})
schemas.clear()
schemas['Meta'] = obj({'correlationId':{'type':'string','minLength':1,'maxLength':128}})
schemas['Error'] = obj({'error':obj({'code':text,'message':text}),'meta':ref('Meta')})
schemas['Specimen'] = obj({'id':uuid,'orderId':uuid,'state':{'enum':['COLLECTED','REJECTED']},
    'sequence':version,'barcode':text,'version':version,'collectedBy':uuid,'collectedAt':date_time,
    'reasonCode':text},['id','orderId','state','sequence','barcode','version','collectedBy','collectedAt'])
schemas['Order'] = obj({'id':uuid,'requestId':uuid,'visitId':uuid,'patientId':uuid,'doctorId':uuid,
    'state':text,'version':version,'sourceRevision':version,'chargeId':uuid,'chargeState':text,
    'amountVnd':{'type':'integer','minimum':0},'snapshotHash':text,
    'linesSnapshot':{'type':'array','items':price},'tests':{'type':'array','items':test},'createdAt':date_time},
    ['id','requestId','visitId','patientId','doctorId','state','version','sourceRevision','chargeState',
     'amountVnd','snapshotHash','linesSnapshot','tests','createdAt'])
schemas['List'] = obj({'items':{'type':'array','items':ref('Order')},'total':{'type':'integer','minimum':0}})
schemas['Detail'] = obj({'order':ref('Order'),'specimens':{'type':'array','items':ref('Specimen')}})
schemas['SpecimenData'] = obj({'specimen':ref('Specimen')})
schemas['SampleInput'] = obj({'barcode':{'type':'string','maxLength':128}},[])
schemas['RejectInput'] = obj({'reasonCode':{'type':'string','minLength':1,'maxLength':128},'expectedVersion':version})
for name in ['List','Detail','SpecimenData']:
    schemas[name+'Response']=obj({'data':ref(name),'meta':ref('Meta')})
order_id=parameter('orderId','path',uuid,True)
specimen_id=parameter('specimenId','path',uuid,True)
errors=[400,401,403,404,409,503]
doc={'openapi':'3.1.1','info':{'title':'UMC Care Diagnostic','version':'1.0.0',
     'description':'DI-002–006. LAB_TECH collects, rejects and recollects specimens; LAB_REVIEW reads. Assigned DOCTOR may read detail. Collection requires local trusted settlement evidence. Recovery DI-001 is disabled.'},
     'paths':{
       '/api/v1/diagnostic-orders':{'get':operation('DI_002','ListResponse',parameters=[
           parameter('state','query',{'type':'string'}),parameter('page','query',{'type':'integer','minimum':1}),parameter('limit','query',{'type':'integer','minimum':1,'maximum':100})])},
       '/api/v1/diagnostic-orders/{orderId}':{'get':operation('DI_003','DetailResponse',parameters=[order_id])},
       '/api/v1/diagnostic-orders/{orderId}/specimens':{'post':operation('DI_004','SpecimenDataResponse',201,[order_id,key],'SampleInput',errors)},
       '/api/v1/specimens/{specimenId}/reject':{'post':operation('DI_005','SpecimenDataResponse',200,[specimen_id,key],'RejectInput',errors)},
       '/api/v1/diagnostic-orders/{orderId}/recollect':{'post':operation('DI_006','SpecimenDataResponse',201,[order_id,key],'SampleInput',errors)},
     },'components':{'securitySchemes':{'bearerAuth':{'type':'http','scheme':'bearer','bearerFormat':'JWT (RS256)'}},'schemas':schemas}}
(root/'contracts/http/diagnostic.openapi.json').write_text(json.dumps(doc,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Generated Diagnostic HTTP (5 operations)')
