"""Regression checks for the backend baseline."""
import hashlib
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class BaselineTests(unittest.TestCase):
    def test_every_interface_and_decision(self):
        manifest = json.loads((ROOT / "contracts/be-baseline-manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(len(manifest["http"]), 86)
        self.assertEqual(len({row["id"] for row in manifest["http"]}), 86)
        self.assertEqual(sum(row["profile"] == "normal" for row in manifest["http"]), 83)
        self.assertEqual(len(manifest["events"]), 20)
        self.assertEqual(len(manifest["commands"]), 5)
        self.assertEqual(set(manifest["decisions"]), {f"C{i:02}" for i in range(1, 11)})
        self.assertEqual(manifest["ownerApproval"], "PENDING_REVIEW")

    def test_source_hashes_match(self):
        manifest = json.loads((ROOT / "contracts/be-baseline-manifest.json").read_text(encoding="utf-8"))
        for source in manifest["sources"]:
            with self.subTest(source=source["path"]):
                actual = hashlib.sha256((ROOT / source["path"]).read_bytes()).hexdigest()
                self.assertEqual(actual, source["sha256"])


if __name__ == "__main__":
    unittest.main()
