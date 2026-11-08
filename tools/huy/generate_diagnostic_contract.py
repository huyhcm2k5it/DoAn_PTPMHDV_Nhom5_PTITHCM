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
    'state':text,'lifecycleState':{'enum':['WAITING_PAYMENT','SETTLEMENT_LOCKED','PAID','SAMPLING','RECOLLECT_REQUIRED','CANCELLED','PUBLISHED']},
    'version':version,'sourceRevision':version,'chargeId':uuid,'chargeState':text,
    'amountVnd':{'type':'integer','minimum':0},'snapshotHash':text,
    'linesSnapshot':{'type':'array','items':price},'tests':{'type':'array','items':test},'createdAt':date_time},
    ['id','requestId','visitId','patientId','doctorId','state','lifecycleState','version','sourceRevision','chargeState',
     'amountVnd','snapshotHash','linesSnapshot','tests','createdAt'])
schemas['List'] = obj({'items':{'type':'array','items':ref('Order')},'total':{'type':'integer','minimum':0}})
schemas['LabResultItem'] = obj({'id':uuid,'testCode':{'type':'string','minLength':1,'maxLength':100},
    'valueText':{'type':'string','minLength':1,'maxLength':2000},'unit':{'type':'string','maxLength':100},
    'referenceRange':{'type':'string','maxLength':200},'flag':{'type':'string','maxLength':100}},
    ['id','testCode','valueText'])
schemas['LabResultItemInput'] = obj({'testCode':{'type':'string','minLength':1,'maxLength':100},
    'valueText':{'type':'string','minLength':1,'maxLength':2000},'unit':{'type':'string','maxLength':100},
    'referenceRange':{'type':'string','maxLength':200},'flag':{'type':'string','maxLength':100}},
    ['testCode','valueText'])
schemas['Result'] = obj({'id':uuid,'orderId':uuid,'specimenId':uuid,'revision':version,
    'state':{'enum':['DRAFT','REVIEW','REWORK','PUBLISHED']},'enteredBy':uuid,
    'submittedAt':date_time,'publishedAt':date_time,'version':version,
    'items':{'type':'array','items':ref('LabResultItem')}},
    ['id','orderId','specimenId','revision','state','enteredBy','version','items'])
schemas['Detail'] = obj({'order':ref('Order'),'specimens':{'type':'array','items':ref('Specimen')},
    'results':{'type':'array','items':ref('Result')}})
schemas['SpecimenData'] = obj({'specimen':ref('Specimen')})
schemas['ResultData'] = obj({'result':ref('Result')})
schemas['CancelData'] = obj({'order':ref('Order'),'refundStatus':{'enum':['NOT_REQUIRED','PENDING_SYNC','REQUESTED','SUCCEEDED','FAILED']}})
schemas['PublishedResults'] = obj({'items':{'type':'array','items':ref('Result')},
    'total':{'type':'integer','minimum':0}})
schemas['SampleInput'] = obj({'barcode':{'type':'string','maxLength':128},'note':{'type':'string','maxLength':500}},[])
schemas['RecoveryOrderInput'] = obj({'visitId':uuid,'testCodes':{'type':'array','minItems':1,'maxItems':100,'items':{'type':'string','minLength':1,'maxLength':100}}})
schemas['RecoveryOrderData'] = obj({'order':ref('Order'),'chargeStatus':text})
schemas['RejectInput'] = obj({'reasonCode':{'type':'string','minLength':1,'maxLength':128},'expectedVersion':version})
schemas['ResultCreateInput'] = obj({'items':{'type':'array','minItems':1,'maxItems':100,'items':ref('LabResultItemInput')}})
schemas['ResultUpdateInput'] = obj({'items':{'type':'array','minItems':1,'maxItems':100,'items':ref('LabResultItemInput')},'expectedVersion':version})
schemas['ReviewInput'] = obj({'expectedVersion':version})
schemas['ReworkInput'] = obj({'reason':{'type':'string','minLength':1,'maxLength':2000},'expectedVersion':version})
schemas['CancelInput'] = obj({'reasonCode':{'type':'string','minLength':1,'maxLength':128},'expectedVersion':version})
for name in ['List','Detail','SpecimenData','ResultData','CancelData','PublishedResults','RecoveryOrderData']:
    schemas[name+'Response']=obj({'data':ref(name),'meta':ref('Meta')})
order_id=parameter('orderId','path',uuid,True)
specimen_id=parameter('specimenId','path',uuid,True)
result_id=parameter('resultId','path',uuid,True)
patient_id=parameter('patientId','path',uuid,True)
lease=parameter('X-Authorization-Lease','header',{'type':'string','minLength':1},True)
errors=[400,401,403,404,409,503]
di001 = operation('DI_001','RecoveryOrderDataResponse',201,[key],'RecoveryOrderInput',errors)
di001.update({'security':[{'serviceAuth':[]}],'x-enabled-by-default':False,'x-visibility':'private','x-owner-evidence-required':True})
doc={'openapi':'3.1.1','info':{'title':'UMC Care Diagnostic','version':'1.1.0',
     'description':'DI-001–013. LAB_TECH collects specimens and writes drafts; LAB_REVIEW returns/publishes with two-person review. Patient reads expose only PUBLISHED results. State aliases preserve existing API values; DI-001 recovery remains disabled by default (private service token only).'},
     'paths':{
       '/api/v1/diagnostic-orders':{
           'post':di001,
           'get':operation('DI_002','ListResponse',parameters=[
               parameter('state','query',{'type':'string'}),parameter('date','query',{'type':'string','format':'date'}),parameter('page','query',{'type':'integer','minimum':1}),parameter('limit','query',{'type':'integer','minimum':1,'maximum':100})])},
       '/api/v1/diagnostic-orders/{orderId}':{'get':operation('DI_003','DetailResponse',parameters=[order_id])},
       '/api/v1/diagnostic-orders/{orderId}/specimens':{'post':operation('DI_004','SpecimenDataResponse',201,[order_id,key],'SampleInput',errors)},
       '/api/v1/specimens/{specimenId}/reject':{'post':operation('DI_005','SpecimenDataResponse',200,[specimen_id,key],'RejectInput',errors)},
       '/api/v1/diagnostic-orders/{orderId}/recollect':{'post':operation('DI_006','SpecimenDataResponse',201,[order_id,key],'SampleInput',errors)},
       '/api/v1/diagnostic-orders/{orderId}/results':{'post':operation('DI_007','ResultDataResponse',201,[order_id,key,lease],'ResultCreateInput',errors)},
       '/api/v1/results/{resultId}':{'put':operation('DI_008','ResultDataResponse',200,[result_id,key,lease],'ResultUpdateInput',errors)},
       '/api/v1/results/{resultId}/submit-review':{'post':operation('DI_009','ResultDataResponse',200,[result_id,key,lease],'ReviewInput',errors)},
       '/api/v1/results/{resultId}/return-rework':{'post':operation('DI_010','ResultDataResponse',200,[result_id,key,lease],'ReworkInput',errors)},
       '/api/v1/results/{resultId}/publish':{'post':operation('DI_011','ResultDataResponse',200,[result_id,key,lease],'ReviewInput',errors)},
       '/api/v1/diagnostic-orders/{orderId}/cancel':{'post':operation('DI_012','CancelDataResponse',200,[order_id,key,lease],'CancelInput',errors)},
       '/api/v1/patients/{patientId}/published-results':{'get':operation('DI_013','PublishedResultsResponse',parameters=[patient_id,lease,
           parameter('page','query',{'type':'integer','minimum':1,'default':1}),
           parameter('limit','query',{'type':'integer','minimum':1,'maximum':100,'default':20})])},
     },'components':{'securitySchemes':{'bearerAuth':{'type':'http','scheme':'bearer','bearerFormat':'JWT (RS256)','x-token-type':'access'},'serviceAuth':{'type':'http','scheme':'bearer','bearerFormat':'JWT (RS256)','x-token-type':'service'},'authorizationLease':{'type':'apiKey','in':'header','name':'X-Authorization-Lease','description':'Short-lived signed JWT from Identity (<=30s, 0s leeway)'}},'schemas':schemas}}
doc['paths']['/api/v1/diagnostic-orders/{orderId}']['get']['description'] = 'DOCTOR reads require the current Appointment-owned doctor/visit grant projection; otherwise the request fails closed.'
doc['paths']['/api/v1/diagnostic-orders/{orderId}/cancel']['post']['description'] = 'Cancellation is limited to a successfully settled, uncollected order and requires the current Appointment-owned doctor/visit grant projection. Billing owns refund execution.'
(root/'contracts/http/diagnostic.openapi.json').write_text(json.dumps(doc,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Generated Diagnostic HTTP (12 public operations; DI-001 remains disabled)')
