"""Route ordering and public authentication regressions using the actual Envoy YAML."""
import unittest
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[2]


def configuration():
    doc = yaml.safe_load((ROOT / "envoy/envoy.yaml").read_text(encoding="utf-8"))
    return doc["static_resources"]["listeners"][0]["filter_chains"][0]["filters"][0]["typed_config"]


def matches(match, path, method="GET"):
    import re
    if any(h["name"] == ":method" and h["string_match"]["exact"] != method
           for h in match.get("headers", [])):
        return False
    if "path" in match:
        return match["path"] == path
    if "prefix" in match:
        return path.startswith(match["prefix"])
    return re.fullmatch(match["safe_regex"]["regex"], path) is not None


class GatewayRoutes(unittest.TestCase):
    def test_owner_routes_precede_patient_prefix(self):
        config = configuration()
        routes = config["route_config"]["virtual_hosts"][0]["routes"]
        for path, cluster, method in [
            ("/api/v1/patients/4b03c44e-d62c-4ab0-b808-0e9b16dbd65a/medical-records", "clinical_service", "GET"),
            ("/api/v1/patients/4b03c44e-d62c-4ab0-b808-0e9b16dbd65a/published-results", "diagnostic_service", "GET"),
            ("/api/v1/results/4b03c44e-d62c-4ab0-b808-0e9b16dbd65a", "diagnostic_service", "PUT"),
            ("/api/v1/admin/appointments/summary", "appointment_service", "GET"),
        ]:
            with self.subTest(path=path):
                found = next((r for r in routes if matches(r["match"], path, method)), {})
                self.assertEqual(found.get("route", {}).get("cluster"), cluster)

    def test_public_slots_get_allows_missing_token(self):
        filters = configuration()["http_filters"]
        jwt = next(f["typed_config"] for f in filters if f["name"].endswith("jwt_authn"))
        rule = next(r for r in jwt["rules"] if matches(r["match"], "/api/v1/slots/available"))
        self.assertEqual(rule["requires"], {"allow_missing": {}})

    def test_cors_is_an_allowlist_and_rate_filter_exists(self):
        config = configuration()
        cors = config["route_config"]["virtual_hosts"][0]["cors"]
        self.assertTrue(all("exact" in origin for origin in cors["allow_origin_string_match"]))
        self.assertIn("envoy.filters.http.local_ratelimit", [f["name"] for f in config["http_filters"]])


if __name__ == "__main__":
    unittest.main()
