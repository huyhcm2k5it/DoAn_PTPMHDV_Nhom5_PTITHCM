from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest import skipUnless
from unittest.mock import patch
import uuid

from django.contrib.auth.hashers import make_password
from django.db import connection, connections
from django.test import TestCase, TransactionTestCase
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.test import APIClient

from app.domain.models import IdempotencyRecord, OtpRequest, User


class OtpPolicyTests(TestCase):
    phone = "0398765444"

    def setUp(self):
        self.user = User.objects.create(
            phone=self.phone, email="otp-policy@example.com",
            actor_type="PATIENT", status="PENDING_VERIFICATION",
        )
        self.client = APIClient()
        sender = patch("app.api.view_auth.send_otp", return_value=None)
        self.sender = sender.start()
        self.addCleanup(sender.stop)

    def resend(self, *, purpose="REGISTER", key=None, phone=None):
        return self.client.post("/api/v1/auth/otp/resend", {
            "phone": phone or self.phone, "purpose": purpose,
        }, format="json", HTTP_IDEMPOTENCY_KEY=key or str(uuid.uuid4()))

    def seed_otp(self, now, *, purpose="REGISTER", is_resend=True, code="123456"):
        otp = OtpRequest(
            user=self.user, phone=self.phone, email=self.user.email,
            purpose=purpose, expires_at=now + timedelta(minutes=5),
            is_resend=is_resend,
        )
        otp.set_code(code)
        otp.save()
        OtpRequest.objects.filter(pk=otp.pk).update(created_at=now)
        return otp

    def test_three_resends_then_hourly_limit_and_exact_boundary(self):
        start = timezone.now()
        self.seed_otp(start, is_resend=False)
        for minute in (1, 2, 3):
            with patch("app.api.view_auth.timezone.now", return_value=start + timedelta(minutes=minute)):
                self.assertEqual(self.resend().status_code, 200)
        with patch("app.api.view_auth.timezone.now", return_value=start + timedelta(minutes=4)):
            response = self.resend()
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["error"]["code"], "RATE_LIMITED")
        self.assertGreater(int(response["Retry-After"]), 0)
        self.assertEqual(self.sender.call_count, 3)
        with patch("app.api.view_auth.timezone.now", return_value=start + timedelta(minutes=61)):
            self.assertEqual(self.resend().status_code, 200)

    def test_registration_cannot_bypass_hourly_resend_limit(self):
        now = timezone.now()
        for minute in (2, 3, 4):
            self.seed_otp(now - timedelta(minutes=minute))
        response = self.client.post("/api/v1/auth/register", {
            "phone": self.phone, "email": "changed@example.com",
            "password": "ChangedPassword123!",
        }, format="json")
        self.assertEqual(response.status_code, 429)
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, "otp-policy@example.com")
        self.sender.assert_not_called()

    def test_replay_precedes_cooldown_and_account_status_checks(self):
        key = str(uuid.uuid4())
        first = self.resend(key=key)
        self.user.status = "ACTIVE"
        self.user.save(update_fields=["status"])
        replay = self.resend(key=key)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(replay.json(), first.json())
        self.assertEqual(OtpRequest.objects.count(), 1)
        self.assertEqual(self.sender.call_count, 1)
        conflict = self.resend(key=key, purpose="RESET")
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json()["error"]["code"], "IDEMPOTENCY_KEY_REUSED")

    def test_invalid_purpose_or_missing_key_has_no_effect(self):
        self.assertEqual(self.resend(purpose="OTHER").status_code, 400)
        response = self.client.post("/api/v1/auth/otp/resend", {
            "phone": self.phone, "purpose": "REGISTER",
        }, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.resend(key="not-a-uuid").status_code, 400)
        verify = self.client.post("/api/v1/auth/otp/verify", {
            "phone": self.phone, "purpose": "OTHER", "otpCode": "123456",
        }, format="json")
        self.assertEqual(verify.status_code, 400)
        self.assertFalse(OtpRequest.objects.exists())
        self.assertFalse(IdempotencyRecord.objects.exists())

    def test_reset_limits_do_not_reveal_account(self):
        self.user.status = "ACTIVE"
        self.user.save(update_fields=["status"])
        now = timezone.now()
        for minute in (2, 3, 4):
            self.seed_otp(now - timedelta(minutes=minute), purpose="RESET")
        known = self.resend(purpose="RESET")
        unknown = self.resend(purpose="RESET", phone="0398765445")
        forgot = self.client.post("/api/v1/auth/password/forgot", {"phone": self.phone}, format="json")
        self.assertEqual([known.status_code, unknown.status_code, forgot.status_code], [200, 200, 200])
        self.assertEqual(known.json()["data"], unknown.json()["data"])
        self.assertEqual(known.json()["data"], forgot.json()["data"])
        self.sender.assert_not_called()
        self.assertEqual(OtpRequest.objects.count(), 3)

    def test_reset_email_failure_and_blocked_account_keep_accepted_response(self):
        self.user.status = "ACTIVE"
        self.user.save(update_fields=["status"])
        self.sender.return_value = Response({"error": {"code": "EMAIL_UNAVAILABLE"}}, status=503)
        failed = self.resend(purpose="RESET")
        self.user.status = "BLOCKED"
        self.user.save(update_fields=["status"])
        blocked = self.resend(purpose="RESET")
        unknown = self.resend(purpose="RESET", phone="0398765445")
        self.assertEqual([failed.status_code, blocked.status_code, unknown.status_code], [200, 200, 200])
        self.assertEqual(failed.json()["data"], blocked.json()["data"])
        self.assertEqual(failed.json()["data"], unknown.json()["data"])
        self.assertFalse(OtpRequest.objects.exists())
        self.assertEqual(self.sender.call_count, 1)

    def test_reset_and_register_have_independent_hourly_limits(self):
        now = timezone.now()
        for minute in (2, 3, 4):
            self.seed_otp(now - timedelta(minutes=minute), purpose="RESET")
        self.assertEqual(self.resend().status_code, 200)

    def test_initial_reset_request_does_not_consume_resend_quota(self):
        self.user.status = "ACTIVE"
        self.user.save(update_fields=["status"])
        response = self.client.post("/api/v1/auth/password/forgot", {"phone": self.phone}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(OtpRequest.objects.get().is_resend)

    def test_expired_and_used_codes_are_rejected(self):
        otp = self.seed_otp(timezone.now() - timedelta(minutes=6), is_resend=False)
        body = {"phone": self.phone, "purpose": "REGISTER", "otpCode": "123456"}
        expired = self.client.post("/api/v1/auth/otp/verify", body, format="json")
        self.assertEqual(expired.status_code, 409)
        self.assertEqual(expired.json()["error"]["code"], "OTP_EXPIRED")
        OtpRequest.objects.filter(pk=otp.pk).update(
            expires_at=timezone.now() + timedelta(minutes=5), used_at=timezone.now(),
        )
        used = self.client.post("/api/v1/auth/otp/verify", body, format="json")
        self.assertEqual(used.status_code, 409)
        self.assertEqual(used.json()["error"]["code"], "OTP_ALREADY_USED")

    def test_email_failure_preserves_previous_otp_and_cached_response(self):
        previous = self.seed_otp(timezone.now() - timedelta(seconds=61), is_resend=False)
        self.sender.return_value = Response({"error": {"code": "EMAIL_UNAVAILABLE"}}, status=503)
        key = str(uuid.uuid4())
        self.assertEqual(self.resend(key=key).status_code, 503)
        self.assertEqual(self.resend(key=key).status_code, 503)
        self.assertEqual(OtpRequest.objects.get().pk, previous.pk)
        self.assertEqual(self.sender.call_count, 1)

    def test_resend_invalidates_old_code_and_five_failures_exhaust_new_code(self):
        self.seed_otp(timezone.now() - timedelta(seconds=61), is_resend=False)
        with patch("app.api.view_auth.secrets.randbelow", return_value=554321):
            self.assertEqual(self.resend().status_code, 200)
        body = {"phone": self.phone, "purpose": "REGISTER", "otpCode": "123456"}
        for _ in range(5):
            self.assertEqual(self.client.post("/api/v1/auth/otp/verify", body, format="json").status_code, 400)
        body["otpCode"] = "654321"
        self.assertEqual(self.client.post("/api/v1/auth/otp/verify", body, format="json").status_code, 429)


class PasswordHasherTests(TestCase):
    def test_new_passwords_use_argon2id(self):
        user = User(phone="0398765451")
        user.set_password("Password123!")
        self.assertTrue(user.password_hash.startswith("argon2$argon2id$"))
        self.assertTrue(user.check_password("Password123!"))

    def test_correct_legacy_password_upgrades_without_revoking_sessions(self):
        user = User.objects.create(
            phone="0398765452", token_version=7,
            password_hash=make_password("Password123!", hasher="pbkdf2_sha256"),
        )
        self.assertTrue(user.check_password("Password123!"))
        user.refresh_from_db()
        self.assertTrue(user.password_hash.startswith("argon2$argon2id$"))
        self.assertEqual(user.token_version, 7)

    def test_wrong_legacy_password_never_changes_hash(self):
        encoded = make_password("Password123!", hasher="pbkdf2_sha256")
        user = User.objects.create(phone="0398765453", password_hash=encoded)
        self.assertFalse(user.check_password("WrongPassword!"))
        user.refresh_from_db()
        self.assertEqual(user.password_hash, encoded)


@skipUnless(connection.vendor == "postgresql", "Requires PostgreSQL row and unique-insert locks")
class ConcurrentOtpPolicyTests(TransactionTestCase):
    def test_same_key_retries_send_once(self):
        phone = "0398765461"
        User.objects.create(phone=phone, email="otp-race@example.com", status="PENDING_VERIFICATION")
        key = str(uuid.uuid4())
        ready = Barrier(2)

        def resend():
            connections.close_all()
            try:
                ready.wait(timeout=10)
                response = APIClient().post("/api/v1/auth/otp/resend", {
                    "phone": phone, "purpose": "REGISTER",
                }, format="json", HTTP_IDEMPOTENCY_KEY=key)
                return response.status_code, response.json()
            finally:
                connections.close_all()

        with patch("app.api.view_auth.send_otp", return_value=None) as sender:
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = [future.result(timeout=30) for future in (pool.submit(resend), pool.submit(resend))]
        self.assertEqual(results[0], results[1])
        self.assertEqual(results[0][0], 200)
        self.assertEqual(sender.call_count, 1)
        self.assertEqual(OtpRequest.objects.count(), 1)
