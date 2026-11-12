"""Check the source-controlled backend interface baseline without healing drift."""
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "contracts/be-baseline-manifest.json"
DECISIONS = {
    "C01": "Canonical sourceType APPOINTMENT/LAB_ORDER/MED_HOLD; legacy aliases require explicit owner migration, never duplicate financial keys.",
    "C02": "Twelve-field envelope, same claim requestId in envelope/payload; BillingStatusChanged consumed by source owners.",
    "C03": "BI-007 public sourceId denotes cancellationId; verified owner evidence and refund attempt history required.",
    "C04": "Lease action API-ID with hyphen, max30s no expiry leeway; access/lease/service token types separate; expired401 AUTHZ_LEASE_EXPIRED.",
    "C05": "FAILED/REJECTED LAB unresolved until audited revisioned resubmit or valid cancellation; no new HTTP operation.",
    "C06": "Stable medication hold per prescription revision; retain reserved at COMMITTED, decrement onHand/reserved only at DISPENSED.",
    "C07": "Notification durable technical retry/quarantine; ticket and visit-grant events are owned by Appointment and Clinical.",
    "C08": "Three recovery operations disabled by default; private SERVICE identity plus owner evidence required.",
    "C09": "Integer VND <=9007199254740991 in interoperable JSON; immutable64hex snapshot hash; Billing must not reprice.",
    "C10": "Source DOCX/workbook v5.2 plus Git24Oct; user overrides Node TypeScript to CommonJS; onePGsixDB and Mongo3DB."
}


def sheet(suffix):
    matches = list((ROOT / "docs").glob("* - " + suffix + ".csv"))
    if len(matches) != 1:
        raise ValueError("Expected exactly one source sheet: " + suffix)
    source = matches[0]
    text = source.read_text(encoding="utf-8-sig").splitlines(keepends=True)
    return source, list(csv.DictReader(io.StringIO("".join(text[4:]))))


def build():
    sources = []
    tables = {}
    for name in ("01_HTTP_86", "02_ThamSo", "03_PhanHoi", "04_Events_18", "05_Commands_5", "06_QuyUoc"):
        source, rows = sheet(name)
        tables[name] = rows
        sources.append({"path": source.relative_to(ROOT).as_posix(),
                        "sha256": hashlib.sha256(source.read_bytes()).hexdigest()})
    return {
        "version": "v5.2-be-20261108",
        "ownerApproval": "PENDING_REVIEW",
        "approvalNote": "Implementation authorized by user; human producer/consumer review still required before shared merge.",
        "sources": sources,
        "decisions": DECISIONS,
        "http": [{"id": r["API ID"], "service": r["Service"].lower(),
                  "method": r["Method"], "path": r["Route"], "actor": r["Actor / capability"],
                  "success": r["Success"], "errors": r["HTTP lỗi"],
                  "poll": r["Poll khi 202"],
                  "profile": "recovery" if r["API ID"] in ("IA-014", "DI-001", "BI-001") else "normal"}
                 for r in tables["01_HTTP_86"] if r.get("API ID")],
        "events": tables["04_Events_18"],
        "commands": tables["05_Commands_5"],
    }


def validate(manifest):
    current = build()
    if manifest != current:
        raise ValueError("Baseline drift: review source/decision changes and explicitly regenerate.")
    assert len(manifest["http"]) == 86
    assert len({r["id"] for r in manifest["http"]}) == 86
    assert sum(r["profile"] == "normal" for r in manifest["http"]) == 83
    assert len(manifest["events"]) == 20 and len(manifest["commands"]) == 5
    assert len(manifest["decisions"]) == 10


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true", help="Explicit regeneration after reviewing source drift.")
    args = parser.parse_args()
    if args.write:
        MANIFEST.write_text(json.dumps(build(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    validate(json.loads(MANIFEST.read_text(encoding="utf-8")))
    print("PASS baseline: 86 HTTP, 20 events, 5 commands; human review PENDING.")
