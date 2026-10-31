"""Generate the week-2 Clinical contract from its implemented API boundary."""
import copy
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
uuid = {'type':'string','format':'uuid'}
date_time = {'type':'string','format':'date-time'}
version = {'type':'integer','minimum':1,'maximum':2147483647}
states = ['IN_PROGRESS','LAB_REQUEST_PENDING','WAITING_LAB','RETURN_READY','WAITING_RETURN','SIGNED']

def obj(properties, required=None):
    return {'type':'object','properties':properties,'required':list(properties) if required is None else required,'additionalProperties':False}

def ref(name):
    return {'$ref':'#/components/schemas/'+name}

schemas = {}
schemas['Meta'] = obj({'correlationId':{'type':'string','minLength':1,'maxLength':128}})
schemas['Error'] = obj({'error':obj({'code':{'type':'string'},'message':{'type':'string'}}),'meta':ref('Meta')})
schemas['StartInput'] = obj({'ticketId':uuid,'doctorId':uuid,'expectedTicketVersion':version})
schemas['DraftInput'] = obj({**{key:{'type':'string','maxLength':10000} for key in ['symptoms','findings','assessment','diagnosis']},'expectedVersion':version})
start = {'requestId':uuid,'operationId':uuid,'state':{'type':'string','enum':['PENDING','ACCEPTED','REJECTED']},'statusUrl':{'type':'string','format':'uri-reference'}}
schemas['StartResult'] = obj({**start,'state':{'const':'PENDING'}})
schemas['StartRequest'] = obj({**start,'visitId':uuid,'reasonCode':{'type':'string','maxLength':100},'createdAt':date_time},list(start)+['createdAt'])
schemas['Visit'] = obj({'id':uuid,'appointmentId':uuid,'patientId':uuid,'doctorUserId':uuid,'departmentId':uuid,'claimId':uuid,'state':{'type':'string','enum':states},'version':version,'returnRound':{'type':'integer','enum':[0,1]},'startedAt':date_time,'signedAt':date_time},['id','appointmentId','patientId','doctorUserId','departmentId','claimId','state','version','returnRound','startedAt'])
schemas['VisitNote'] = obj({'id':uuid,'visitId':uuid,'revision':version,**{key:{'type':'string','maxLength':10000} for key in ['symptoms','findings','assessment','diagnosis']},'authorUserId':uuid,'savedAt':date_time})
schemas['Worklist'] = obj({'items':{'type':'array','items':ref('Visit')},'total':{'type':'integer','minimum':0},'startRequest':{'anyOf':[ref('StartRequest'),{'type':'null'}]}})
schemas['VisitDetail'] = obj({'visit':ref('Visit'),'notes':{'type':'array','items':ref('VisitNote')},'prescriptions':{'type':'array','items':{}},'labRequests':{'type':'array','items':{}}})
schemas['DraftResult'] = obj({'visitId':uuid,'version':version,'state':{'type':'string','enum':states}})
for name,content in [('StartResponse','StartResult'),('WorklistResponse','Worklist'),('VisitDetailResponse','VisitDetail'),('DraftResponse','DraftResult')]:
    schemas[name] = obj({'data':ref(content),'meta':ref('Meta')})

def parameter(name,where,schema,required=False):
    return {'name':name,'in':where,'required':required,'schema':schema}

key = parameter('Idempotency-Key','header',uuid,True)
visit_id = parameter('visitId','path',uuid,True)
correlation = parameter('X-Correlation-ID','header',{'type':'string','pattern':'^[A-Za-z0-9._:-]{1,128}$'})

def operation(id,response,status=200,parameters=None,body=None,errors=None):
    result={'operationId':id,'security':[{'bearerAuth':[]}],'parameters':[correlation]+(parameters or []),'responses':{str(status):{'description':'Committed locally; poll statusUrl for the claim result' if status==202 else 'Success','content':{'application/json':{'schema':ref(response)}}}}}
    for code in errors or [400,401,403,404,503]:
        result['responses'][str(code)]={'description':'See error.code and meta.correlationId','content':{'application/json':{'schema':ref('Error')}}}
    if status==202:
        result['responses']['202']['headers']={'Location':{'required':True,'schema':{'type':'string','format':'uri-reference'}}}
    if body:
        result['requestBody']={'required':True,'content':{'application/json':{'schema':ref(body)}}}
    return result

doc={'openapi':'3.1.1','info':{'title':'UMC Care Clinical week 2','version':'1.0.0','description':'CL-001–004 from CSV v5.2. Writes use Idempotency-Key. Worklist date filters use UTC. Patient detail is available only for owned SIGNED visits, with the final saved note. No clinical draft data appears in logs.'},'paths':{
    '/api/v1/clinical/worklist':{'get':operation('CL_001','WorklistResponse',parameters=[parameter('date','query',{'type':'string','format':'date'}),parameter('state','query',{'type':'string','enum':states}),parameter('page','query',{'type':'integer','minimum':1,'maximum':1000000,'default':1}),parameter('limit','query',{'type':'integer','minimum':1,'maximum':100,'default':20}),parameter('operationId','query',uuid)])},
    '/api/v1/visits/start':{'post':operation('CL_002','StartResponse',202,[key],'StartInput',[400,401,403,404,409,503])},
    '/api/v1/visits/{visitId}':{'get':operation('CL_003','VisitDetailResponse',parameters=[visit_id])},
    '/api/v1/visits/{visitId}/draft':{'put':operation('CL_004','DraftResponse',parameters=[visit_id,key],body='DraftInput',errors=[400,401,403,404,409,503])},
},'components':{'securitySchemes':{'bearerAuth':{'type':'http','scheme':'bearer','bearerFormat':'JWT (RS256)'}},'schemas':schemas}}
(root/'contracts/http/clinical.openapi.json').write_text(json.dumps(doc,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

base={'messageId':uuid,'messageKind':{'type':'string'},'messageType':{'type':'string'},'schemaVersion':{'const':1},'producer':{'type':'string'},'aggregateId':uuid,'aggregateVersion':version,'correlationId':{'type':'string','minLength':1,'maxLength':128},'causationId':uuid,'requestId':uuid,'occurredAt':date_time}
command=obj({'requestId':uuid,'ticketId':uuid,'expectedTicketVersion':version,'doctorId':uuid,'patientId':uuid})
event=obj({'requestId':uuid,'ticketId':uuid,'appointmentId':uuid,'patientId':uuid,'visitId':uuid,'claimId':uuid,'state':{'enum':['ACCEPTED','REJECTED']},'reasonCode':{'type':'string','minLength':1,'maxLength':100}},['requestId','ticketId','appointmentId','patientId','state'])
event['allOf']=[{'if':{'properties':{'state':{'const':'ACCEPTED'}}},'then':{'required':['claimId']}},{'if':{'properties':{'state':{'const':'REJECTED'}}},'then':{'required':['reasonCode']}}]
variants=[]
for kind,name,producer,payload in [('COMMAND','ClaimQueueTicket','clinical',command),('EVENT','QueueTicketClaimed','appointment',event)]:
    variants.append(obj({**copy.deepcopy(base),'messageKind':{'const':kind},'messageType':{'const':name},'producer':{'const':producer},'payload':payload}))
queue={'$schema':'https://json-schema.org/draft/2020-12/schema','$id':'urn:umc-care:clinical-queue:v1','title':'ClaimQueueTicket and QueueTicketClaimed v1','oneOf':variants}
(root/'contracts/messages/clinical-queue.v1.schema.json').write_text(json.dumps(queue,indent=2)+'\n',encoding='utf-8')
ticket=obj({'ticketId':uuid,'appointmentId':uuid,'patientId':uuid,'doctorId':uuid,'doctorUserId':uuid,'departmentId':uuid,'visitId':uuid,'ticketType':{'enum':['FIRST','RETURN']},'state':{'enum':['WAITING','CALLED','CLAIMED','NO_SHOW','DONE']},'version':version},['ticketId','appointmentId','patientId','doctorId','doctorUserId','departmentId','ticketType','state','version'])
ticket['allOf']=[{'if':{'properties':{'ticketType':{'const':'RETURN'}}},'then':{'required':['visitId']}},{'if':{'properties':{'ticketType':{'const':'FIRST'}}},'then':{'not':{'required':['visitId']}}}]
snapshot={'$schema':'https://json-schema.org/draft/2020-12/schema','$id':'urn:umc-care:clinical-ticket-import:v1','title':'Trusted Appointment snapshot import (provisional handoff, not a public event)','type':'array','maxItems':1000,'items':ticket}
(root/'contracts/messages/clinical-ticket-snapshot.v1.schema.json').write_text(json.dumps(snapshot,indent=2)+'\n',encoding='utf-8')
print('Generated Clinical HTTP (4 operations), queue and trusted snapshot schemas')
