"""DI-013 leases are obtainable only by active patients and doctors."""
from unittest.mock import patch

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from django.test import TestCase
from rest_framework.test import APIClient

from app.application.token_service import generate_access_token
from app.domain.models import StaffCapability, User


class DiagnosticPublishedResultsLeaseTests(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        private = key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        cls.public = key.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        for name, value in [("get_private_key", private), ("get_public_key", cls.public)]:
            key_patch = patch("app.application.token_service." + name, return_value=value)
            key_patch.start()
            cls.addClassCleanup(key_patch.stop)

    def user(self, actor, status="ACTIVE"):
        return User.objects.create(
            phone="000113" + str(User.objects.count()).zfill(4),
            actor_type=actor,
            status=status,
            token_version=4,
        )

    def session(self, user, action="DI-013", token_version=4, actor=None):
        token = generate_access_token(str(user.id), actor or user.actor_type, [], token_version)
        return APIClient().get(
            "/api/v1/auth/session",
            {"action": action},
            HTTP_AUTHORIZATION="Bearer " + token,
        )

    def assert_bound_lease(self, actor):
        user = self.user(actor)
        response = self.session(user)
        self.assertEqual(response.status_code, 200, response.json())
        claims = jwt.decode(
            response.json()["data"]["authorizationLease"],
            self.public,
            algorithms=["RS256"],
            issuer="umc-care-identity",
            audience="umc-care-services",
        )
        self.assertEqual(claims["sub"], str(user.id))
        self.assertEqual(claims["action"], "DI-013")
        self.assertEqual(claims["tokenType"], "LEASE")
        self.assertEqual(claims["tokenVersion"], 4)
        self.assertEqual(claims["exp"] - claims["iat"], 30)

    def test_patient_obtains_current_signed_published_results_lease(self):
        self.assert_bound_lease("PATIENT")

    def test_doctor_obtains_current_signed_published_results_lease(self):
        self.assert_bound_lease("DOCTOR")

    def test_lab_cancellation_lease_is_doctor_only(self):
        doctor = self.user("DOCTOR")
        response = self.session(doctor, "DI-012")
        self.assertEqual(response.status_code, 200, response.json())
        claims = jwt.decode(
            response.json()["data"]["authorizationLease"], self.public, algorithms=["RS256"],
            issuer="umc-care-identity", audience="umc-care-services",
        )
        self.assertEqual(claims["action"], "DI-012")
        self.assertEqual(claims["exp"] - claims["iat"], 30)
        self.assertEqual(self.session(self.user("PATIENT"), "DI-012").status_code, 403)

    def test_staff_capabilities_and_stale_doctor_claim_cannot_grant_results_lease(self):
        user = self.user("STAFF")
        for capability in ["ADMIN", "RECEPTION", "LAB_TECH", "LAB_REVIEW"]:
            StaffCapability.objects.create(user=user, capability=capability)
        for actor in ["STAFF", "DOCTOR", "PATIENT"]:
            with self.subTest(bearer_actor=actor):
                response = self.session(user, actor=actor)
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.json()["error"]["code"], "FORBIDDEN")
                self.assertNotIn("authorizationLease", response.json().get("data", {}))

    def test_inactive_accounts_and_revoked_access_tokens_cannot_obtain_lease(self):
        for actor in ["PATIENT", "DOCTOR"]:
            for status in ["PENDING_VERIFICATION", "BLOCKED", "LOCKED"]:
                with self.subTest(actor=actor, status=status):
                    response = self.session(self.user(actor, status))
                    self.assertEqual(response.status_code, 403)
                    self.assertEqual(response.json()["error"]["code"], "FORBIDDEN")
            response = self.session(self.user(actor), token_version=3)
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.json()["error"]["code"], "UNAUTHENTICATED")

    def test_unknown_and_wrong_case_actions_remain_forbidden(self):
        for actor in ["PATIENT", "DOCTOR"]:
            user = self.user(actor)
            for action in ["di-013", "DI-999"]:
                with self.subTest(actor=actor, action=action):
                    response = self.session(user, action)
                    self.assertEqual(response.status_code, 403)
                    self.assertEqual(response.json()["error"]["code"], "FORBIDDEN")
