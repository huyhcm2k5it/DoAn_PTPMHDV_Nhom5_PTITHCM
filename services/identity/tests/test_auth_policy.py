from datetime import timedelta
from unittest.mock import patch
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from app.domain.models import User, OtpRequest

class AuthPolicyTests(TestCase):
    def test_BLOCKED_STAFF_cannot_register_or_OTP_to_ACTIVE(self):
        for actor, status in [("STAFF", "BLOCKED"), ("DOCTOR", "PENDING_VERIFICATION"), ("PATIENT", "LOCKED")]:
            user = User.objects.create(phone="090000000" + str(User.objects.count()), actor_type=actor, status=status)
            otp = OtpRequest(user=user, phone=user.phone, purpose="REGISTER", expires_at=timezone.now()+timedelta(minutes=5))
            otp.set_code("123456"); otp.save()
            with patch("app.api.view_auth.send_otp", return_value=None):
                response = APIClient().post("/api/v1/auth/register", {"phone":user.phone,"password":"password123"}, format="json")
            self.assertEqual(response.status_code,409)
            response = APIClient().post("/api/v1/auth/otp/verify", {"phone":user.phone,"purpose":"REGISTER","otpCode":"123456"},format="json")
            self.assertEqual(response.status_code,409)
            user.refresh_from_db();self.assertEqual(user.status,status)

    def test_lease_is_not_access(self):
        from app.application import token_service as ts
        with patch.object(ts,"get_public_key",return_value="unused"), patch.object(ts.jwt,"decode",return_value={"sub":"x","action":"PH-008","tokenVersion":1}):
            with self.assertRaises(ts.jwt.InvalidTokenError): ts.verify_access_token("lease")


from django.test import TransactionTestCase


class ForgotPasswordTransactionTests(TransactionTestCase):
    def test_forgot_password_commits_without_testcase_outer_transaction(self):
        user = User.objects.create(phone="0900077777", actor_type="PATIENT", status="ACTIVE")
        with patch("app.api.view_auth.send_otp",return_value=None):
            response = APIClient().post("/api/v1/auth/password/forgot",{"phone":user.phone},format="json")
        self.assertEqual(response.status_code,200)
