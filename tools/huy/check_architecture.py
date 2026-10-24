"""Fail when Go business cores depend on drivers/adapters/frameworks."""
import json,os,subprocess,sys
from pathlib import Path
root=Path(__file__).resolve().parents[2]
failures=[]
for name in ('catalog','clinical','diagnostic'):
    service=root/'services'/name
    for area in ('domain','application'):
        directory=service/'internal'/area
        if not list(directory.rglob('*.go')):continue
        proc=subprocess.run([os.environ.get('GO_BIN','go'),'list','-json','./internal/'+area+'/...'],cwd=service,text=True,capture_output=True)
        if proc.returncode:failures.append(proc.stderr);continue
        text=proc.stdout.lstrip();decoder=json.JSONDecoder()
        while text:
            package,end=decoder.raw_decode(text);text=text[end:].lstrip()
            for imported in package.get('Imports',[]):
                allowed=imported.startswith('umccare/'+name+'/internal/domain') or (area=='application' and imported.startswith('umccare/'+name+'/internal/application'))
                standard='.' not in imported.split('/')[0] and not imported.startswith('umccare/')
                if (not standard and not allowed) or imported.startswith(('net/http','database/sql')):
                    failures.append(package['ImportPath']+' imports forbidden '+imported)
if failures:
    print('\n'.join(failures));sys.exit(1)
print('PASS: domain/application depend only on neutral ports, domain and permitted standard-library packages')
