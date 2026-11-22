from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest import skipUnless
from unittest.mock import patch

from django.db import connection, connections
from django.test import TestCase, TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from app.domain.models import OtpRequest, User


class OtpCooldownTests(TestCase):
    registration = {"phone": "0398765432", "email": "seed@example.com", "password": "TestPass123!"}

    def setUp(self):
        sender_patch = patch("app.api.view_auth.send_otp", return_value=None)
        self.sender = sender_patch.start()
        self.addCleanup(sender_patch.stop)
        self.client = APIClient()

    def register(self, **changes):
        return self.client.post("/api/v1/auth/register", {**self.registration, **changes}, format="json")

    def resend(self, purpose="REGISTER"):
        return self.client.post("/api/v1/auth/otp/resend", {
            "phone": self.registration["phone"], "purpose": purpose,
        }, format="json")

    def test_registration_cannot_bypass_resend_cooldown_or_change_credentials(self):
        self.assertEqual(self.register().status_code, 201)
        user = User.objects.get(phone=self.registration["phone"])
        password_hash = user.password_hash
        response = self.register(email="changed@example.com", password="ChangedPass123!")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"]["code"], "OTP_NOT_RESENDABLE_YET")
        self.assertEqual(self.resend().status_code, 409)
        user.refresh_from_db()
        self.assertEqual(user.email, self.registration["email"])
        self.assertEqual(user.password_hash, password_hash)
        self.assertEqual(OtpRequest.objects.filter(user=user).count(), 1)
        self.assertEqual(self.sender.call_count, 1)

    def test_send_is_allowed_at_60_seconds_and_resend_blocks_registration(self):
        self.assertEqual(self.register().status_code, 201)
        now = timezone.now()
        OtpRequest.objects.filter(phone=self.registration["phone"]).update(created_at=now - timedelta(seconds=60))
        with patch("app.api.view_auth.timezone.now", return_value=now):
            self.assertEqual(self.resend().status_code, 200)
        self.assertEqual(self.register().status_code, 409)
        self.assertEqual(OtpRequest.objects.filter(phone=self.registration["phone"]).count(), 2)

    def test_forgot_password_and_resend_share_reset_cooldown_without_enumeration(self):
        User.objects.create(phone=self.registration["phone"], email="reset@example.com", status="ACTIVE")
        url = "/api/v1/auth/password/forgot"
        payload = {"phone": self.registration["phone"]}
        first = self.client.post(url, payload, format="json")
        second = self.client.post(url, payload, format="json")
        unknown = self.client.post(url, {"phone": "0398765433"}, format="json")
        self.assertEqual([first.status_code, second.status_code, unknown.status_code], [200, 200, 200])
        self.assertEqual(first.json()["data"], second.json()["data"])
        self.assertEqual(first.json()["data"], unknown.json()["data"])
        self.assertEqual(self.resend("RESET").status_code, 409)
        self.assertEqual(OtpRequest.objects.filter(phone=payload["phone"], purpose="RESET").count(), 1)
        self.assertEqual(self.sender.call_count, 1)
        OtpRequest.objects.filter(phone=payload["phone"]).update(created_at=timezone.now() - timedelta(seconds=61))
        self.assertEqual(self.resend("RESET").status_code, 200)
        self.assertEqual(self.client.post(url, payload, format="json").status_code, 200)
        self.assertEqual(OtpRequest.objects.filter(phone=payload["phone"]).count(), 2)
        self.assertEqual(self.sender.call_count, 2)


@skipUnless(connection.vendor == "postgresql", "Requires PostgreSQL row locks and unique insert races")
class ConcurrentOtpCooldownTests(TransactionTestCase):
    def race(self, paths, bodies):
        barrier = Barrier(2)

        def send(index):
            connections.close_all()
            try:
                barrier.wait(timeout=10)
                return APIClient().post(paths[index], bodies[index], format="json").status_code
            finally:
                connections.close_all()

        with patch("app.api.view_auth.send_otp", return_value=None) as sender:
            with ThreadPoolExecutor(max_workers=2) as pool:
                statuses = list(pool.map(send, range(2)))
            if paths[0] == paths[1]:
                self.assertEqual(sorted(statuses), [201, 409])
            else:
                self.assertIn(statuses, ([201, 409], [409, 200]))
            self.assertEqual(sender.call_count, 1)

    def test_parallel_first_registrations_send_one_otp(self):
        payload = OtpCooldownTests.registration
        self.race(["/api/v1/auth/register"] * 2, [payload, payload])
        self.assertEqual(User.objects.filter(phone=payload["phone"]).count(), 1)
        self.assertEqual(OtpRequest.objects.filter(phone=payload["phone"]).count(), 1)

    def test_registration_and_resend_serialize_on_the_same_account(self):
        payload = OtpCooldownTests.registration
        User.objects.create(phone=payload["phone"], email=payload["email"], status="PENDING_VERIFICATION")
        self.race(["/api/v1/auth/register", "/api/v1/auth/otp/resend"],
                  [payload, {"phone": payload["phone"], "purpose": "REGISTER"}])
        self.assertEqual(OtpRequest.objects.filter(phone=payload["phone"]).count(), 1)
