"""Start the isolated integration environment in dependency order."""
import subprocess
from pathlib import Path
from prepare_test_stack import prepare
from configure_test_broker import configure

ROOT=Path(__file__).resolve().parents[2]
if __name__=="__main__":
    prepare()
    compose=["docker","compose","--env-file",str(ROOT/".runtime/be-test/test.env"),
             "-p","umc-be-test","-f",str(ROOT/"infra/compose/be.test.yaml")]
    subprocess.run(compose+["up","-d","--wait","postgres","mongo","rabbitmq","redis-catalog"],check=True,cwd=ROOT)
    configure()
    subprocess.run(compose+["up","-d","--build"],check=True,cwd=ROOT)
