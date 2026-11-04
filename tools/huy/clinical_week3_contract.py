"""Week 3 additions used by the deterministic Clinical contract generator."""
def extend(doc, obj, ref, uuid, version, date_time, operation, parameter, key, visit_id):
    s = doc['components']['schemas']
    text = {'type': 'string', 'maxLength': 2000}
    line = obj({'medicineCode': {'type':'string','minLength':1,'maxLength':100},
                'nameSnapshot': {'type':'string','maxLength':300}, 'doseText': {'type':'string','minLength':1,'maxLength':1000},
                'quantity': version, 'instruction': text}, ['medicineCode','doseText','quantity'])
    s['PrescriptionLine'] = line
    s['PrescriptionInput'] = obj({'lines':{'type':'array','maxItems':100,'items':ref('PrescriptionLine')}})
    s['PrescriptionUpdate'] = obj({'lines':{'type':'array','maxItems':100,'items':ref('PrescriptionLine')},'expectedVersion':version})
    s['VersionInput'] = obj({'expectedVersion':version})
    s['Prescription'] = obj({'id':uuid,'visitId':uuid,'patientId':uuid,
        'state':{'enum':['DRAFT','DELETED','FINAL']},'version':version,'revision':version,
        'lines':{'type':'array','items':ref('PrescriptionLine')},'finalizedAt':date_time},
        ['id','visitId','patientId','state','version','revision','lines'])
    s['LabInput'] = obj({'tests':{'type':'array','minItems':1,'maxItems':100,
        'items':obj({'testId':uuid,'revision':version})}})
    test_snapshot=obj({'testId':uuid,'revision':version,'code':text,'name':text,'unit':text,'referenceRange':text})
    s['LabRequest'] = obj({'requestId':uuid,'visitId':uuid,'state':{'enum':['PENDING','CREATED','REJECTED']},
        'orderId':uuid,'reasonCode':text,'tests':{'type':'array','items':test_snapshot}},['requestId','visitId','state','tests'])
    s['LabPending'] = obj({'requestId':uuid,'state':{'const':'PENDING'},
        'statusUrl':{'type':'string','format':'uri-reference'}})
    s['PrescriptionData'] = obj({'prescription':ref('Prescription')})
    s['DeleteData'] = obj({'prescriptionId':uuid,'state':{'const':'DELETED'}})
    for name,data in [('PrescriptionResponse','PrescriptionData'),('DeleteResponse','DeleteData'),
                      ('CompleteResponse','DraftResult'),('LabResponse','LabPending')]:
        s[name]=obj({'data':ref(data),'meta':ref('Meta')})
    s['VisitDetail']['properties']['prescriptions']['items']=ref('Prescription')
    s['VisitDetail']['properties']['labRequests']['items']=ref('LabRequest')
    prescription_id=parameter('prescriptionId','path',uuid,True)
    lease=parameter('X-Authorization-Lease','header',{'type':'string','minLength':1},True)
    errors=[400,401,403,404,409,503]
    doc['paths'].update({
        '/api/v1/visits/{visitId}/lab-orders':{'post':operation('CL_005','LabResponse',202,[visit_id,key],'LabInput',errors)},
        '/api/v1/visits/{visitId}/prescriptions':{'post':operation('CL_006','PrescriptionResponse',201,[visit_id,key],'PrescriptionInput',errors)},
        '/api/v1/prescriptions/{prescriptionId}':{
            'put':operation('CL_007','PrescriptionResponse',200,[prescription_id,key],'PrescriptionUpdate',errors),
            'delete':operation('CL_008','DeleteResponse',200,[prescription_id,key,parameter('expectedVersion','query',version,True)],errors=errors)},
        '/api/v1/prescriptions/{prescriptionId}/finalize':{'post':operation('CL_009','PrescriptionResponse',200,[prescription_id,key,lease],'VersionInput',errors)},
        '/api/v1/visits/{visitId}/complete':{'post':operation('CL_010','CompleteResponse',200,[visit_id,key,lease],'VersionInput',errors)},
    })
    doc['info'].update(title='UMC Care Clinical',version='1.1.0',description='CL-001–010. Transactional lab registry, draft and final prescriptions, visit signing. Signing requires a current authorization lease; unresolved LAB blocks signing. Patient reads expose only signed notes and FINAL prescriptions.')
