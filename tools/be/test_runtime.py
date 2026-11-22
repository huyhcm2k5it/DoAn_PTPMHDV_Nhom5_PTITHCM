"""Deployment guards for the single group stack; no live credentials required."""
import unittest
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[2]
APIS = ("patient", "appointment", "pharmacy", "identity", "billing", "notification", "catalog", "clinical", "diagnostic")


class RuntimeTopology(unittest.TestCase):
    def setUp(self):
        self.config = yaml.safe_load((ROOT / "infra/compose/compose.yaml").read_text(encoding="utf-8"))
        self.services = self.config["services"]

    def test_whole_group_without_replacement_infrastructure(self):
        expected = set(APIS) | {owner + "-worker" for owner in APIS} | {"gateway", "web"}
        self.assertEqual(set(self.services), expected)
        self.assertFalse(self.config.get("volumes"))
        self.assertFalse(self.config.get("secrets"))
        self.assertFalse(self.config["networks"]["private"]["internal"])
        for name, service in self.services.items():
            self.assertFalse(service.get("profiles"), name)
            if name not in ("gateway", "web"):
                self.assertFalse(service.get("ports"), name)

    def test_health_gates_follow_application_dependencies(self):
        for owner in APIS:
            self.assertIn("healthcheck", self.services[owner], owner)
            self.assertEqual(self.services[owner + "-worker"]["depends_on"], {owner: {"condition": "service_healthy"}})
        self.assertEqual(self.services["gateway"]["depends_on"], {owner: {"condition": "service_healthy"} for owner in APIS})
        self.assertEqual(self.services["web"]["depends_on"], {"gateway": {"condition": "service_healthy"}})
        for owner in ("catalog", "clinical", "diagnostic"):
            self.assertEqual(self.services[owner]["environment"]["MIGRATE_ON_START"], "1")

    def test_shared_redis_and_identity_signing_key_boundary(self):
        shared = self.services["catalog"]["environment"]["REDIS_URL"]
        self.assertIn("UMC_REDIS_URL", shared)
        self.assertEqual(self.services["appointment"]["environment"]["APPOINTMENT_REDIS_URL"], shared)
        for owner in ("clinical", "diagnostic"):
            self.assertEqual(self.services[owner]["environment"]["REDIS_URL"], shared)
        for name, service in self.services.items():
            if name not in ("identity", "identity-worker"):
                self.assertNotIn("jwt_private.pem", str(service.get("volumes", [])), name)


if __name__ == "__main__":
    unittest.main()
