"""Fail-closed API86 matrix/schema validation. No service is treated as covered by parsing alone."""
import argparse
import csv
import json
from pathlib import Path
import re

METHODS = {'get','post','put','patch','delete','options','head'}
PUBLIC = {'IA-001','IA-002','IA-003','IA-004','IA-005','IA-007','IA-008','CA-001','CA-002','CA-003','AP-004'}
SENSITIVE = {'CA-004','PT-003','PT-005','AP-002','AP-003','AP-008','AP-009','AP-010','AP-013','AP-014','AP-015','AP-017','AP-018','PH-002','PH-003','PH-004','PH-005','PH-006','PH-007','PH-008','DI-008','DI-009','DI-011','DI-013','BI-004','BI-005','BI-007','BI-008','CL-009','CL-010','CL-011','IA-012'}

def resolve(doc, value):
    seen=set()
    while isinstance(value,dict) and '$ref' in value:
        ref=value['$ref']
        if not ref.startswith('#/') or ref in seen: raise ValueError('invalid/cyclic reference '+ref)
        seen.add(ref)
        value=doc
        for key in ref[2:].split('/'): value=value[key.replace('~1','/').replace('~0','~')]
    return value

def schema_errors(doc, schema, location, seen=None):
    errors=[];seen=set() if seen is None else seen
    if not isinstance(schema,dict) or not schema: return [location+': empty schema']
    if '$ref' in schema:
        ref=schema['$ref']
        if ref in seen: return []
        try: return schema_errors(doc,resolve(doc,schema),location,seen|{ref})
        except (KeyError,ValueError,TypeError): return [location+': unresolved reference '+ref]
    if schema.get('x-unresolved-contract'):errors.append(location+': unresolved owner contract')
    typ=schema.get('type')
    if typ=='object' or isinstance(typ,list) and 'object' in typ:
        if not schema.get('properties') and not isinstance(schema.get('additionalProperties'),dict): errors.append(location+': unbounded object schema')
        for key,child in schema.get('properties',{}).items(): errors+=schema_errors(doc,child,location+'.'+key,seen)
        if set(schema.get('required',[]))-set(schema.get('properties',{})):errors.append(location+': required property absent')
    if typ=='array':errors+=schema_errors(doc,schema.get('items'),location+'[]',seen)
    for keyword in ('anyOf','oneOf','allOf'):
        for child in schema.get(keyword,[]): errors+=schema_errors(doc,child,location,seen)
    return errors

def validate_documents(rows, documents, parameter_rows=(), response_rows=()):
    errors=[]; actual={}
    for service,doc in documents.items():
        for path,item in doc.get('paths',{}).items():
            for method,op in item.items():
                if method not in METHODS: continue
                oid=op.get('operationId','').replace('_','-')
                if oid in actual:errors.append(oid+': duplicate operationId')
                actual[oid]=(service,path,method,op,doc,item)
    expected={r['id'] for r in rows}
    for extra in actual.keys()-expected: errors.append(extra+': unexpected operation')
    for row in rows:
        oid=row['id']; prefix=oid+': '
        if oid not in actual:errors.append(prefix+'missing operation');continue
        service,path,method,op,doc,item=actual[oid]
        if (service,path,method)!=(row['service'],row['path'],row['method'].lower()):errors.append(prefix+'service/method/path mismatch')
        if op.get('operationId')!=oid.replace('-','_'):errors.append(prefix+'noncanonical operationId')
        security=op.get('security',doc.get('security',[]))
        if oid not in PUBLIC and not security:errors.append(prefix+'missing authentication')
        schemes=doc.get('components',{}).get('securitySchemes',{})
        for requirement in security:
            for name in requirement:
                if name not in schemes:errors.append(prefix+'undefined security scheme '+name)
        if oid in {'BI-004','BI-005'} and op.get('x-actor-policy') != row.get('actor'):
            errors.append(prefix+'actor policy mismatch')
        if oid in SENSITIVE:
            lease=op.get('x-authorization-lease',{})
            if (lease.get('action')!=oid or lease.get('maxAgeSeconds')!=30 or lease.get('expiryLeewaySeconds')!=0 or lease.get('expiredStatus')!=401 or lease.get('expiredCode')!='AUTHZ_LEASE_EXPIRED'):
                errors.append(prefix+'missing canonical strict 30-second lease policy')
            if not any(any(schemes.get(name,{}).get('name')=='X-Authorization-Lease' for name in req) for req in security):
                errors.append(prefix+'missing authorization lease security')
        if row.get('profile')=='recovery':
            if op.get('x-enabled-by-default') is not False or op.get('x-visibility')!='private':errors.append(prefix+'recovery must be private/default-off')
            if not any(schemes.get(name,{}).get('x-token-type')=='service' for requirement in security for name in requirement):errors.append(prefix+'recovery requires service token')
        params=[]
        for value in item.get('parameters',[])+op.get('parameters',[]):
            try:params.append(resolve(doc,value))
            except (KeyError,ValueError):errors.append(prefix+'unresolved parameter')
        for name in re.findall(r'\{([^}]+)\}',path):
            if not any(p.get('name')==name and p.get('in')=='path' and p.get('required') is True for p in params):errors.append(prefix+'missing required path parameter '+name)
        statuses=set(re.findall(r'\d{3}',row.get('success','')+','+row.get('errors','')))
        for status in statuses:
            if status not in op.get('responses',{}):errors.append(prefix+'missing status '+status)
        for status,value in op.get('responses',{}).items():
            try:resp=resolve(doc,value);schema=resp['content']['application/json']['schema']
            except (KeyError,ValueError):errors.append(prefix+'missing response schema '+status);continue
            errors+=schema_errors(doc,schema,prefix+status)
            try:
                expanded=resolve(doc,schema);props=expanded.get('properties',{})
                if status.startswith(('4','5')):
                    if not {'error','meta'}<=set(props):errors.append(prefix+'noncanonical error envelope '+status)
                if status=='202':
                    data=resolve(doc,props.get('data',{}))
                    if 'Location' not in resp.get('headers',{}) or 'statusUrl' not in data.get('properties',{}):errors.append(prefix+'202 requires Location/statusUrl')
            except (KeyError,ValueError): pass
        try:
            body=resolve(doc,op.get('requestBody',{})).get('content',{}).get('application/json',{}).get('schema')
            if body:errors+=schema_errors(doc,body,prefix+'request');body=resolve(doc,body)
            else:body={}
        except (KeyError,ValueError):errors.append(prefix+'unresolved request schema');body={}
        for p in parameter_rows:
            if p[0]!=oid or '[].' in p[2]:continue
            if p[1]=='body':
                if p[2] not in body.get('properties',{}):errors.append(prefix+'missing body field '+p[2])
                elif p[4]=='C\u00f3' and p[2] not in body.get('required',[]):errors.append(prefix+'optional required body field '+p[2])
            elif not any(x.get('name')==p[2] and x.get('in')==p[1] for x in params):errors.append(prefix+'missing '+p[1]+' '+p[2])
        for p in response_rows:
            if p[0]==oid and p[3]:
                text=json.dumps(op.get('responses',{}).get(p[1],{}))
                try:text+=json.dumps(resolve(doc,op['responses'][p[1]]))
                except (KeyError,ValueError):pass
                for code in p[3].split(','):
                    if code.strip() not in text:errors.append(prefix+'undocumented error '+p[1]+' '+code.strip())
    return sorted(set(errors))

def read_csv(root,name):
    with (root/'docs'/('UMC_Care_API_86_9_Service_v5_2 - '+name+'.csv')).open(encoding='utf-8-sig',newline='') as stream:return list(csv.reader(stream))[5:]

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[2]);parser.add_argument('--service',action='append');parser.add_argument('--strict',action='store_true');args=parser.parse_args()
    rows=json.loads((args.root/'contracts/be-baseline-manifest.json').read_text(encoding='utf-8-sig'))['http']
    if args.service:rows=[r for r in rows if r['service'] in args.service]
    docs={}
    for service in {r['service'] for r in rows}:
        file=args.root/'contracts/http'/f'{service}.openapi.json'
        if file.exists():docs[service]=json.loads(file.read_text(encoding='utf-8-sig'))
    errors=validate_documents(rows,docs,read_csv(args.root,'02_ThamSo'),read_csv(args.root,'03_PhanHoi'))
    print(json.dumps({'operations':len(rows),'documents':len(docs),'errors':errors},indent=2,ensure_ascii=True))
    return bool(errors)

if __name__=='__main__':raise SystemExit(main())
