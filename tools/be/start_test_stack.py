"""Start the isolated integration environment in dependency order."""
import os
import subprocess
from pathlib import Path
from prepare_test_stack import prepare
from configure_test_broker import configure

ROOT = Path(__file__).resolve().parents[2]


def main():
    prepare()
    env_path = ROOT / ".runtime/be-test/test.env"
    # Compose gives the host environment priority over --env-file. Override every
    # generated value explicitly so an online DSN/password cannot leak into tests.
    process_env = dict(os.environ)
    process_env.update(dict(line.split("=", 1) for line in env_path.read_text(encoding="utf-8").splitlines()))
    compose = ["docker", "compose", "--env-file", str(env_path), "-p", "umc-be-test",
               "-f", str(ROOT / "infra/compose/be.test.yaml")]
    subprocess.run(compose + ["config", "--quiet"], check=True, cwd=ROOT, env=process_env)
    subprocess.run(compose + ["up", "-d", "--wait", "postgres", "mongo", "rabbitmq", "redis-catalog"],
                   check=True, cwd=ROOT, env=process_env)
    configure()
    subprocess.run(compose + ["up", "-d", "--build"], check=True, cwd=ROOT, env=process_env)


if __name__ == "__main__":
    main()
