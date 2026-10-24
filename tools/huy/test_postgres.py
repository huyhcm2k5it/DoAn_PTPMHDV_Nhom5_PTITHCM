"""Run real Catalog integration tests in an isolated, loopback-only PostgreSQL cluster.
No installed service, existing credentials, or unrelated databases are modified.
"""
import os, subprocess, sys, uuid
from pathlib import Path
repo=Path(__file__).resolve().parents[2]
runtime=repo/'.runtime'
runtime.mkdir(exist_ok=True)
program=Path(os.environ.get('PG_BIN',r'C:\Program Files\PostgreSQL\18\bin'))
data=runtime/'postgres-tests'
data.mkdir(exist_ok=True)
port=os.environ.get('HUY_TEST_PG_PORT','55439')
hidden=getattr(subprocess,'CREATE_NO_WINDOW',0)
def run(args,**kwargs):
    return subprocess.run([str(a) for a in args],check=True,creationflags=hidden,**kwargs)
env=os.environ.copy()
for key,folder in [('GOCACHE','gocache'),('GOMODCACHE','gomodcache'),('GOPATH','gopath'),('GOTMPDIR','go-temp')]:
    path=runtime/folder;path.mkdir(exist_ok=True);env[key]=str(path)
if not (data/'PG_VERSION').exists():
    run([program/'initdb.exe','-D',data,'-U','huy_test','-A','trust','--encoding=UTF8','--locale=C'],stdout=subprocess.DEVNULL)
status=subprocess.run([str(program/'pg_ctl.exe'),'-D',str(data),'status'],stdout=subprocess.DEVNULL,creationflags=hidden)
started=status.returncode!=0
database='umc_huy_test_'+uuid.uuid4().hex[:10]
try:
    if started:run([program/'pg_ctl.exe','-D',data,'-l',runtime/'postgres-tests.log','-o','-h 127.0.0.1 -p '+port,'-w','start'],stdout=subprocess.DEVNULL)
    run([program/'createdb.exe','-h','127.0.0.1','-p',port,'-U','huy_test',database])
    env['TEST_DATABASE_URL']='postgres://huy_test@127.0.0.1:'+port+'/'+database+'?sslmode=disable'
    env['CONTRACT_RESPONSE_FILE']=str(runtime/'catalog-http-responses.json')
    result=subprocess.run([os.environ.get('GO_BIN',r'C:\Program Files\Go\bin\go.exe'),'test','-count=1','-tags=integration','-v','./internal/adapters/outbound/postgres'],cwd=repo/'services/catalog',env=env,creationflags=hidden,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
    (runtime/'postgres-integration.log').write_text(result.stdout,encoding='utf-8')
    print(result.stdout,flush=True)
    code=result.returncode
finally:
    # Exact database name was generated above in this task-owned cluster.
    subprocess.run([str(program/'dropdb.exe'),'-h','127.0.0.1','-p',port,'-U','huy_test','--if-exists',database],creationflags=hidden)
    if started:subprocess.run([str(program/'pg_ctl.exe'),'-D',str(data),'-m','fast','-w','stop'],stdout=subprocess.DEVNULL,creationflags=hidden)
sys.exit(code)
