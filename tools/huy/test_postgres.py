"""One Windows runner for Huy's isolated PostgreSQL integration suites."""
import argparse
import os
from pathlib import Path
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / ".runtime"
SERVICES = ("catalog", "clinical", "diagnostic")
HIDDEN = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--service", choices=(*SERVICES, "all"), default="all")
    parser.add_argument("--run", default=".")
    args = parser.parse_args()
    program = Path(os.environ.get("PG_BIN", r"C:\Program Files\PostgreSQL\18\bin"))
    go = os.environ.get("GO_BIN", r"C:\Program Files\Go\bin\go.exe")
    data = RUNTIME / "postgres-tests"
    data.mkdir(parents=True, exist_ok=True)
    port = os.environ.get("HUY_TEST_PG_PORT", "55439")
    env = os.environ.copy()
    for key, folder in (("GOCACHE", "gocache"), ("GOMODCACHE", "gomodcache"), ("GOPATH", "gopath"), ("GOTMPDIR", "go-temp")):
        path = RUNTIME / folder
        path.mkdir(exist_ok=True)
        env[key] = str(path)

    def run(arguments, **kwargs):
        return subprocess.run([str(a) for a in arguments], check=True, creationflags=HIDDEN, **kwargs)

    if not (data / "PG_VERSION").exists():
        run([program / "initdb.exe", "-D", data, "-U", "huy_test", "-A", "trust", "--encoding=UTF8", "--locale=C"], stdout=subprocess.DEVNULL)
    started = subprocess.run([str(program / "pg_ctl.exe"), "-D", str(data), "status"],
                             stdout=subprocess.DEVNULL, creationflags=HIDDEN).returncode != 0
    selected = SERVICES if args.service == "all" else (args.service,)
    files = {"catalog": {"CONTRACT_RESPONSE_FILE": "catalog-http-responses.json"},
             "clinical": {"CLINICAL_CONTRACT_RESPONSE_FILE": "clinical-http-responses.json",
                          "CLINICAL_WEEK3_CONTRACT_RESPONSE_FILE": "clinical-week3-http-responses.json",
                          "CLINICAL_CREATE_LAB_WIRE_FILE": "clinical-create-lab-wire.json"},
             "diagnostic": {"DIAGNOSTIC_CONTRACT_RESPONSE_FILE": "diagnostic-http-responses.json",
                            "DIAGNOSTIC_RESULT_RESPONSE_FILE": "diagnostic-result-http-responses.json",
                            "DIAGNOSTIC_RESULT_EVENT_FILE": "diagnostic-result-event.json"}}
    if args.service == "all":
        # Only these task-owned generated wire artifacts are removed, never user data.
        for name in ("clinical-create-lab-wire.json", "diagnostic-result-event.json"):
            (RUNTIME / name).unlink(missing_ok=True)
    success = True
    started_here = False
    try:
        if started:
            run([program / "pg_ctl.exe", "-D", data, "-l", RUNTIME / "postgres-tests.log",
                 "-o", "-h 127.0.0.1 -p " + port, "-w", "start"], stdout=subprocess.DEVNULL)
            started_here = True
        rounds = [(s, args.run) for s in selected]
        if args.service == "all":
            rounds.append(("clinical", "^TestDiagnosticPublishedResultWire$"))
        for index, (service, pattern) in enumerate(rounds):
            database = "umc_huy_test_" + service + "_" + uuid.uuid4().hex[:10]
            created = False
            try:
                run([program / "createdb.exe", "-h", "127.0.0.1", "-p", port, "-U", "huy_test", database])
                created = True
                case_env = dict(env, TEST_DATABASE_URL=f"postgres://huy_test@127.0.0.1:{port}/{database}?sslmode=disable")
                for key, name in files[service].items():
                    case_env[key] = str(RUNTIME / name)
                for key, name in (("CLINICAL_CREATE_LAB_WIRE_FILE", "clinical-create-lab-wire.json"),
                                  ("DIAGNOSTIC_RESULT_EVENT_FILE", "diagnostic-result-event.json")):
                    if (RUNTIME / name).exists():
                        case_env[key] = str(RUNTIME / name)
                command = [go, "test", "-count=1", "-tags=integration", "-run", pattern, "-v", "./internal/adapters/outbound/postgres"]
                result = subprocess.run(command, cwd=ROOT / "services" / service, env=case_env,
                                        creationflags=HIDDEN, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
                output = result.stdout.decode("utf-8", errors="replace")
                (RUNTIME / f"{service}-postgres-integration-{index}.log").write_text(output, encoding="utf-8")
                print(output, flush=True)
                success = success and result.returncode == 0
                if not success:
                    break
            finally:
                if created:
                    run([program / "dropdb.exe", "-h", "127.0.0.1", "-p", port, "-U", "huy_test", database])
    finally:
        if started_here:
            run([program / "pg_ctl.exe", "-D", data, "-m", "fast", "-w", "stop"], stdout=subprocess.DEVNULL)
    return 0 if success else 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
