import jwt
from pathlib import Path
from rest_framework.test import APITestCase
from rest_framework import status

BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent

class AuthLoginTests(APITestCase):

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
        local_pub = Path(__file__).resolve().parent.parent / "jwt_public.pem"
        public_key_path = local_pub if local_pub.exists() else BASE_DIR / "infra" / "certs" / "jwt_public.pem"
        with open(public_key_path, "r", encoding="utf-8") as f:
            pub_key = f.read()

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