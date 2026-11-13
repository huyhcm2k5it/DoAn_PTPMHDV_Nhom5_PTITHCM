"""Generate isolated test config in temporary roots; never start containers."""
import contextlib
import io
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit

import yaml
import prepare_test_stack as generator
import start_test_stack as starter

REPO = Path(__file__).resolve().parents[2]
PORTS = {"patient": "8001", "appointment": "8002", "pharmacy": "8003",
         "identity": "8004", "billing": "8005", "notification": "8006",
         "catalog": "8007", "clinical": "8008", "diagnostic": "8009"}


class TestStackGeneration(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="umc-test-config-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.runtime = self.root / ".runtime/be-test"
        self.profile = self.root / "infra/compose/be.test.yaml"
        self.profile.parent.mkdir(parents=True)
        shutil.copyfile(REPO / "infra/compose/compose.yaml", self.profile.parent / "compose.yaml")
        for name, value in (("env/hung.env", "ONLINE_MUST_NOT_BE_READ=1"),
                            ("infra/certs/jwt_public.pem", "online-public-key"),
                            ("services/identity/jwt_private.pem", "online-private-key")):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(value, encoding="utf-8")
        self.online = {p: p.read_bytes() for p in self.root.rglob("*") if p.is_file() and p.name != "compose.yaml"}
        for attr, value in (("ROOT", self.root), ("RUNTIME", self.runtime), ("PROFILE", self.profile)):
            patcher = patch.object(generator, attr, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.generate()

    def generate(self):
        with contextlib.redirect_stdout(io.StringIO()):
            generator.prepare()
        self.doc = yaml.safe_load(self.profile.read_text(encoding="utf-8"))
        self.values = dict(line.split("=", 1) for line in (self.runtime / "test.env").read_text(encoding="utf-8").splitlines())

    def test_redis_is_local_even_when_main_profile_is_online(self):
        self.assertIn('redis-catalog', self.doc['services'])
        self.assertIn('~umc:appointment:available:v1:*', str(self.doc['services']['redis-catalog']))
        self.assertIn('~umc:catalog:v1:*', str(self.doc['services']['redis-catalog']))
        self.assertNotIn('UMC_REDIS_URL', str(self.doc))
        self.assertIn('redis-catalog:6379', self.doc['services']['appointment']['environment']['APPOINTMENT_REDIS_URL'])
        self.assertIn('redis-catalog:6379', self.doc['services']['catalog']['environment']['REDIS_URL'])

    def test_local_database_urls_and_gateway_matching_ports_are_complete(self):
        for owner, port in PORTS.items():
            with self.subTest(owner=owner):
                self.assertEqual(self.values.get(owner.upper() + "_PORT"), port)
        for owner in ("catalog", "clinical", "diagnostic"):
            with self.subTest(owner=owner):
                uri = urlsplit(self.values.get(owner.upper() + "_DATABASE_URL", ""))
                self.assertEqual((uri.hostname, uri.port, uri.username, uri.path, uri.query),
                                 ("postgres", 5432, owner + "_owner", "/" + owner + "_db", "sslmode=disable"))
                self.assertEqual(uri.password, self.values[owner.upper() + "_DB_PASSWORD"])

    def test_django_apis_and_workers_explicitly_use_local_postgres(self):
        for owner in ("identity", "billing", "notification"):
            for name in (owner, owner + "-worker"):
                env = self.doc["services"][name]["environment"]
                prefix = owner.upper() + "_DB_"
                with self.subTest(service=name):
                    for key, value in {"HOST": "postgres", "PORT": "5432", "NAME": owner + "_db",
                                       "USER": owner + "_owner", "SSLMODE": "disable"}.items():
                        self.assertEqual(env.get(prefix + key), value)
                    self.assertEqual(env.get(prefix + "PASSWORD"), "${" + prefix + "PASSWORD}")

    def test_all_worker_broker_aliases_use_their_own_test_account(self):
        for owner in PORTS:
            name = owner + "-worker"
            env = self.doc["services"][name]["environment"]
            expected = "${" + owner.upper() + "_AMQP_URL}"
            with self.subTest(service=name):
                for key in ("AMQP_URL", "RABBITMQ_URL", "UMC_AMQP_URL"):
                    self.assertEqual(env.get(key), expected)
                self.assertEqual(env["RABBITMQ_HOST"], "rabbitmq")
                self.assertEqual(env["RABBITMQ_VHOST"], "/umc-be-test")
                uri = urlsplit(self.values[owner.upper() + "_AMQP_URL"])
                self.assertEqual((uri.hostname, uri.port, uri.username, uri.path),
                                 ("rabbitmq", 5672, owner, "/%2Fumc-be-test"))

    def test_repeat_preserves_secrets_and_online_files_and_repairs_derived_keys(self):
        before = {name: (self.runtime / name).read_bytes() for name in ("secrets.json", "jwt_private.pem", "mongo.key")}
        self.generate()
        self.assertEqual(before, {name: (self.runtime / name).read_bytes() for name in before})
        public = (self.runtime / "jwt_public.pem").read_bytes()
        (self.runtime / "jwt_public.pem").unlink()
        self.generate()
        self.assertTrue((self.runtime / "jwt_public.pem").exists(), "Existing private keys must regenerate missing public material")
        self.assertEqual(public, (self.runtime / "jwt_public.pem").read_bytes())
        for path, contents in self.online.items():
            self.assertEqual(path.read_bytes(), contents)
        for name, service in self.doc["services"].items():
            self.assertNotIn("env_file", service, name)
            mounts = str(service.get("volumes", []))
            self.assertNotIn("infra/certs", mounts)
            self.assertNotIn("services/identity/jwt_private.pem", mounts)
            if name not in ("identity", "identity-worker"):
                self.assertNotIn("jwt_private.pem", mounts)
        self.assertEqual(self.doc["services"]["gateway"]["ports"], ["127.0.0.1:18080:8080"])
        self.assertIn(".runtime/be-test/jwks.json", str(self.doc["services"]["gateway"]["volumes"]))
        self.assertEqual(set(self.doc["volumes"]), {"mongo_data", "rabbitmq_data", "postgres_data", "huy_postgres_data", "postgres_be_data"})

    def test_catalog_seed_completes_before_owner_publishers_start(self):
        with patch.object(starter, "ROOT", self.root), patch.object(starter, "prepare"), \
             patch.object(starter, "configure"), patch.object(starter.subprocess, "run") as run:
            starter.main(seed_catalog=True)
        commands = [call.args[0] for call in run.call_args_list]
        seed = next(i for i, cmd in enumerate(commands) if cmd[-4:] == ["run", "--rm", "catalog-migrate", "-seed"])
        start = next(i for i, cmd in enumerate(commands) if cmd[-3:] == ["up", "-d", "--build"])
        self.assertLess(seed, start)

    def test_start_uses_generated_values_despite_inherited_online_environment(self):
        hostile = {"DIAGNOSTIC_DATABASE_URL": "postgres://online.invalid/production",
                   "PATIENT_MONGO_URI": "mongodb://online.invalid/production",
                   "POSTGRES_PASSWORD": "wrong-online-password", "PATIENT_PORT": "9999"}
        with patch.object(starter, "ROOT", self.root), patch.object(starter, "prepare"), \
             patch.object(starter, "configure"), patch.object(starter.subprocess, "run") as run, \
             patch.dict(os.environ, hostile):
            starter.main()
        self.assertTrue(run.call_args_list, "Start must invoke Compose with the isolated environment")
        for call in run.call_args_list:
            process_env = call.kwargs.get("env", {})
            for key in hostile:
                with self.subTest(command=call.args[0][-1], variable=key):
                    self.assertEqual(process_env.get(key), self.values[key],
                                     "Inherited host variables must not override isolated generated values")

    @unittest.skipUnless(shutil.which("docker"), "Docker Compose CLI not installed")
    def test_generated_profile_passes_compose_interpolation_without_owner_env(self):
        env = dict(os.environ)
        for key in self.values:
            env.pop(key, None)
        result = subprocess.run(["docker", "compose", "--env-file", str(self.runtime / "test.env"),
                                 "-p", "umc-be-test", "-f", str(self.profile), "config", "--quiet"],
                                cwd=self.root, env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, "Generated test profile must validate without any owner environment files")


if __name__ == "__main__":
    unittest.main()
