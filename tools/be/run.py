"""Run the existing group stack with its three owner env files."""
import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OWNER_ENVS = tuple(ROOT / "env" / (owner + ".env") for owner in ("quan", "huy", "hung"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", nargs="?", choices=("up", "build", "ps", "logs", "down"), default="up")
    parser.add_argument("--build", action="store_true", help="Rebuild images after source changes")
    args = parser.parse_args()
    process_env = dict(os.environ)
    for path in OWNER_ENVS:
        if not path.is_file():
            parser.error("Missing owner env: " + str(path.relative_to(ROOT)))
        # Compose's host environment otherwise takes priority over --env-file.
        # Keep the owner's file authoritative without parsing or printing secrets.
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            key = re.match(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=", line)
            if key:
                process_env.pop(key.group(1), None)
    compose = ["docker", "compose"]
    for path in OWNER_ENVS:
        compose += ["--env-file", str(path)]
    compose += ["-f", str(ROOT / "infra/compose/compose.yaml")]

    def run(command):
        subprocess.run(command, cwd=ROOT, env=process_env, check=True)

    run(compose + ["config", "--quiet"])
    if args.action == "up":
        # Reuse the group's key pair. Never generate a replacement private key.
        node = shutil.which("node")
        if node:
            run([node, "tools/quan/prepare-gateway-key.js", "--verify-identity"])
        else:
            run(["docker", "run", "--rm", "--network", "none", "--mount",
                 "type=bind,source=" + str(ROOT) + ",target=/project", "-w", "/project",
                 "node:24-alpine", "node", "tools/quan/prepare-gateway-key.js", "--verify-identity"])
        command = compose + ["up", "-d", "--wait", "--wait-timeout", "180"]
        if args.build:
            command.append("--build")
        run(command)
        print("Group web: http://127.0.0.1:15173")
    else:
        commands = {"build": ["build"], "ps": ["ps", "--all"],
                    "logs": ["logs", "--tail", "100"], "down": ["down"]}
        run(compose + commands[args.action])


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError:
        raise SystemExit("Group stack command failed; check the preceding service status. No data was reset.")
