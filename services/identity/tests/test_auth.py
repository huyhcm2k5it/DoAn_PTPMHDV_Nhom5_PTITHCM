import jwt
from pathlib import Path
from rest_framework.test import APITestCase
from rest_framework import status

BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent

class AuthLoginTests(APITestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.hazmat.primitives import serialization
        from unittest.mock import patch
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
        cls.test_public_key = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
        cls.key_patch = patch("app.application.token_service.get_private_key", return_value=pem)
        cls.key_patch.start()
        cls.addClassCleanup(cls.key_patch.stop)


    def test_login_success_patient(self):
        """Happy Path: Bệnh nhân đăng nhập thành công, nhận token RS256 hợp lệ."""
        response = self.client.post("/api/v1/auth/login", {
            "phone": "0901234567",
            "password": "password123"
        }, format="json")
        response_data = response.json()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response_data["data"]["actorType"], "PATIENT")
        self.assertIn("accessToken", response_data["data"])

        # Kiểm tra token có đúng chữ ký RS256 bằng public key không
        pub_key = self.test_public_key

        decoded = jwt.decode(
            response_data["data"]["accessToken"],
            pub_key,
            algorithms=["RS256"],
            audience="umc-care-services"
        )
        self.assertEqual(decoded["actorType"], "PATIENT")

    def test_login_fail_wrong_password(self):
        """Unhappy Path: Sai mật khẩu trả về 401 UNAUTHENTICATED."""
        response = self.client.post("/api/v1/auth/login", {
            "phone": "0901234567",
            "password": "wrongpassword"
        }, format="json")
        response_data = response.json()

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(response_data["error"]["code"], "UNAUTHENTICATED")