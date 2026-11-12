"""Summarize two owner-provided dead-letter exports without publishing messages."""
import argparse
import base64
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import sys


TEMPORARY = {"RETRY_EXHAUSTED", "SERVICE_UNAVAILABLE", "TIMEOUT", "UNROUTABLE"}
INVALID = {"INVALID_MESSAGE", "SCHEMA_INVALID", "PRODUCER_MISMATCH", "MESSAGE_CONFLICT"}
LABEL = re.compile(r"[A-Za-z0-9_.-]{1,100}")


def label(value):
    return value if isinstance(value, str) and LABEL.fullmatch(value) else "UNKNOWN"


def original(row):
    if row.get("messageKind") in ("EVENT", "COMMAND"):
        return row
    body = row.get("body", row.get("contentBase64"))
    if isinstance(body, dict):
        return body
    if isinstance(body, str):
        try:
            parsed = json.loads(body) if body.lstrip().startswith("{") else json.loads(base64.b64decode(body, validate=True))
            return parsed if isinstance(parsed, dict) else {}
        except (ValueError, UnicodeError):
            pass
    return {}


def summarize(rows):
    groups = Counter()
    fingerprints = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Each export row must be a JSON object")
        message = original(row)
        reason = label(row.get("reasonCode", row.get("reason_code", row.get("reason"))))
        producer = label(message.get("producer"))
        kind = label(message.get("messageType"))
        route = label(row.get("routingKey", row.get("routing_key")))
        message_id = message.get("messageId")
        duplicate = False
        conflict = False
        if isinstance(message_id, str) and LABEL.fullmatch(message_id):
            fingerprint = hashlib.sha256(json.dumps(message, sort_keys=True, separators=(",", ":")).encode()).digest()
            if message_id in fingerprints:
                duplicate = fingerprints[message_id] == fingerprint
                conflict = not duplicate
            else:
                fingerprints[message_id] = fingerprint

        if conflict or reason in INVALID or (message and message.get("schemaVersion") != 1):
            category = "schema_or_source"
        elif row.get("inboxStatus") == "PROCESSED" or duplicate:
            category = "processed_or_duplicate"
        elif reason in TEMPORARY:
            category = "temporary_needs_fix_verification"
        else:
            category = "owner_review"
        groups[(category, producer, kind, route, reason)] += 1
    return [
        {"category": category, "producer": producer, "messageType": kind,
         "routingKey": route, "reason": reason, "count": count}
        for (category, producer, kind, route, reason), count in sorted(groups.items())
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--queue", nargs=2, metavar=("NAME", "EXPORT_JSON"), action="append", required=True)
    parser.add_argument("--expected", type=int, help="Compare the combined export count to this snapshot count")
    args = parser.parse_args()
    if len(args.queue) != 2 or len({name for name, _ in args.queue}) != 2:
        parser.error("Specify two distinct queues")
    reports = {}
    count = 0
    for name, file in args.queue:
        try:
            rows = json.loads(Path(file).read_text(encoding="utf-8-sig"))
            if not isinstance(rows, list):
                raise ValueError("Expected a JSON array")
            reports[name] = {"count": len(rows), "groups": summarize(rows)}
        except (OSError, ValueError):
            parser.error(f"Invalid or unreadable export for {label(name)}")
        count += len(rows)
    print(json.dumps({"count": count, "expected": args.expected, "queues": reports}, indent=2))
    return 1 if args.expected is not None and args.expected != count else 0


if __name__ == "__main__":
    sys.exit(main())
