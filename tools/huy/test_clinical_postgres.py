"""Clinical tests against a task-owned local PostgreSQL database, removed afterwards."""
import os
from pathlib import Path
import subprocess
import sys
import uuid

repo = Path(__file__).resolve().parents[2]
runtime = repo / '.runtime'
runtime.mkdir(exist_ok=True)
program = Path(os.environ.get('PG_BIN', r'C:\Program Files\PostgreSQL\18\bin'))
data = runtime / 'postgres-tests'
data.mkdir(exist_ok=True)
port = os.environ.get('HUY_TEST_PG_PORT', '55439')
hidden = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
env = os.environ.copy()
for key, folder in [('GOCACHE','gocache'),('GOMODCACHE','gomodcache'),('GOPATH','gopath'),('GOTMPDIR','go-temp')]:
    path = runtime / folder
    path.mkdir(exist_ok=True)
    env[key] = str(path)

def run(args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, creationflags=hidden, **kwargs)

if not (data / 'PG_VERSION').exists():
    run([program/'initdb.exe','-D',data,'-U','huy_test','-A','trust','--encoding=UTF8','--locale=C'], stdout=subprocess.DEVNULL)
started = subprocess.run([str(program/'pg_ctl.exe'),'-D',str(data),'status'], stdout=subprocess.DEVNULL, creationflags=hidden).returncode != 0
database = 'umc_huy_test_clinical_' + uuid.uuid4().hex[:10]
created = False
code = 1
try:
    if started:
        run([program/'pg_ctl.exe','-D',data,'-l',runtime/'postgres-tests.log','-o','-h 127.0.0.1 -p '+port,'-w','start'], stdout=subprocess.DEVNULL)
    run([program/'createdb.exe','-h','127.0.0.1','-p',port,'-U','huy_test',database])
    created = True
    env['TEST_DATABASE_URL'] = f'postgres://huy_test@127.0.0.1:{port}/{database}?sslmode=disable'
    env['CLINICAL_CONTRACT_RESPONSE_FILE'] = str(runtime/'clinical-http-responses.json')
    result = subprocess.run([os.environ.get('GO_BIN',r'C:\Program Files\Go\bin\go.exe'),'test','-count=1','-tags=integration','-v','./internal/adapters/outbound/postgres'], cwd=repo/'services/clinical', env=env, creationflags=hidden, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    output = result.stdout.decode('utf-8', errors='replace')
    (runtime/'clinical-postgres-integration.log').write_text(output,encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    print(output)
    code = result.returncode
finally:
    if created:
        run([program/'dropdb.exe','-h','127.0.0.1','-p',port,'-U','huy_test',database])
    if started:
        run([program/'pg_ctl.exe','-D',data,'-m','fast','-w','stop'], stdout=subprocess.DEVNULL)
sys.exit(code)
