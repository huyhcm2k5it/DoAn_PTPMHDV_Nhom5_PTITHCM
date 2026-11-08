"""Configure only an explicitly isolated test broker; never purge queues."""
import json
import re
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
RUNTIME=ROOT/".runtime/be-test"
OWNERS=("identity","patient","appointment","catalog","clinical","diagnostic","pharmacy","billing","notification")


def configure(project="umc-be-test"):
    if not re.fullmatch(r"umc-be-test(?:-[a-z0-9]+)*",project):
        raise ValueError("Only explicitly isolated test projects are accepted.")
    container=project+"-rabbitmq-1"
    meta=json.loads(subprocess.check_output(["docker","inspect",container],text=True))[0]
    if meta["Config"]["Labels"].get("com.docker.compose.project") != project:
        raise ValueError("Container project identity differs.")
    values=json.loads((RUNTIME/"secrets.json").read_text(encoding="utf-8"))
    definitions=json.loads((ROOT/"rabbitmq/definitions.json").read_text(encoding="utf-8"))
    text=json.dumps(definitions).replace("/umc-care","/umc-be-test")
    source=RUNTIME/"definitions.json"
    source.write_text(text,encoding="utf-8")
    def run(args):
        result=subprocess.run(args,capture_output=True,text=True)
        if result.returncode:
            # Do not include argv: add_user's argv contains a test credential.
            raise RuntimeError("Isolated broker configuration failed; no queues were purged.")
        return result.stdout
    run(["docker","cp",str(source),container+":/tmp/umc-be-definitions.json"])
    run(["docker","exec",container,"rabbitmqctl","import_definitions","/tmp/umc-be-definitions.json"])
    names=set(line.split()[0] for line in run(["docker","exec",container,"rabbitmqctl","list_users","--no-table-headers"]).splitlines() if line.split())
    for owner in OWNERS:
        if owner not in names:
            run(["docker","exec",container,"rabbitmqctl","add_user",owner,values[owner.upper()+"_RABBIT_PASSWORD"]])
        queue=r"(evt|cmd|dlq)\."+owner+r"(\.[a-z]+)?\.v1"
        foreign=r"umc\.(events|commands|deadletters)\.[a-z]+\.v1"
        own=r"umc\.(events|commands|deadletters)\."+owner+r"\.v1"
        run(["docker","exec",container,"rabbitmqctl","set_permissions","-p","/umc-be-test",
             owner,"^("+queue+"|"+foreign+")$","^("+queue+"|"+own+")$","^("+queue+"|"+foreign+")$"])
    print("Configured canonical topology and nine scoped worker accounts in isolated /umc-be-test.")


if __name__=="__main__":
    configure()
