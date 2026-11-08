"""Structural integration invariants; runtime readiness is a separate live gate."""
import unittest
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[2]


class RuntimeTopology(unittest.TestCase):
    def test_single_postgres_and_private_ports(self):
        config = yaml.safe_load((ROOT / "infra/compose/compose.yaml").read_text(encoding="utf-8"))
        services = config["services"]
        self.assertEqual([n for n, s in services.items() if s.get("image", "").startswith("postgres:")], ["postgres"])
        self.assertNotIn("ports", services["postgres"])
        for name, service in services.items():
            if name != "gateway":
                self.assertFalse(service.get("ports"), name)
        for owner in ("IDENTITY", "BILLING", "NOTIFICATION", "CATALOG", "CLINICAL", "DIAGNOSTIC"):
            self.assertIn(owner + "_DB_PASSWORD", services["postgres"]["environment"])

    def test_redis_separate_prefix_acl_and_no_gateway_private_key(self):
        text = (ROOT / "infra/compose/compose.yaml").read_text(encoding="utf-8")
        self.assertIn("~umc:appointment:available:v1:*", text)
        config = yaml.safe_load(text)
        mounts = str(config["services"]["gateway"].get("volumes", []))
        self.assertNotIn("private.pem", mounts)


if __name__ == "__main__":
    unittest.main()
