import os
import tempfile
import uuid
from datetime import datetime, timedelta, timezone as dt_timezone
from pathlib import Path

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from rest_framework import status
from rest_framework.test import APITestCase

from app.domain.models import Charge, Payment

_PRIVATE_KEY = None


def _private_key():
    """Sinh cặp khóa RSA riêng cho test và trỏ Billing sang public key tương ứng.

    Nhờ vậy test đi qua đúng lớp xác thực thật, không cần cờ tắt bảo vệ.
    """
    global _PRIVATE_KEY
    if _PRIVATE_KEY is None:
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        _PRIVATE_KEY = key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        public_pem = key.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        path = Path(tempfile.gettempdir()) / f"umc-billing-test-jwt-{os.getpid()}.pem"
        path.write_bytes(public_pem)
        os.environ["JWT_PUBLIC_KEY_PATH"] = str(path)
    return _PRIVATE_KEY


def bearer(actor_type="STAFF", capabilities=()):
    """Header Authorization cho một actor cụ thể."""
    now = datetime.now(dt_timezone.utc)
    token = jwt.encode(
        {
            "iss": "umc-care-identity",
            "aud": "umc-care-services",
            "sub": str(uuid.uuid5(uuid.NAMESPACE_URL, "billing-fixture:"+actor_type+":"+str(capabilities))),
            "actorType": actor_type,
            "capabilities": list(capabilities),
            "tokenVersion": 1,
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(minutes=15)).timestamp()),
        },
        _private_key(),
        algorithm="RS256",
    )
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def cashier(action="BI-005"):
    return with_lease(bearer("STAFF", ["CASHIER"]), action)


def with_lease(headers, action):
    from datetime import datetime, timezone
    p=jwt.decode(headers["HTTP_AUTHORIZATION"].split(" ",1)[1],options={"verify_signature":False})
    now=int(datetime.now(timezone.utc).timestamp())
    lease=jwt.encode({"iss":"umc-care-identity","aud":"umc-care-services","sub":p["sub"],
        "tokenType":"LEASE","action":action,"tokenVersion":1,"iat":now,"exp":now+30},
        _private_key(),algorithm="RS256")
    return {**headers,"HTTP_X_AUTHORIZATION_LEASE":lease}


def patient(patient_id):
    from app.domain.models import PatientAccessProjection
    headers=bearer("PATIENT", [])
    p=jwt.decode(headers["HTTP_AUTHORIZATION"].split(" ",1)[1],options={"verify_signature":False})
    PatientAccessProjection.objects.update_or_create(patient_id=patient_id,defaults={
        "owner_user_id":p["sub"],"version":1,"active":True,"body_hash":"fixture"})
    return with_lease(headers,"BI-004")



class BillingServiceTests(APITestCase):

    def setUp(self):
        """Khởi tạo dữ liệu mẫu cho mỗi test case."""
        self.patient_id = uuid.uuid4()
        self.appointment_id = uuid.uuid4()
        self.charge = Charge.objects.create(
            patient_id=self.patient_id,
            source_type="APPOINTMENT",
            source_id=self.appointment_id,
            source_revision=1,
            amount_vnd=150000,
            state="OPEN",
            price_snapshot={"service": "Khám tổng quát", "unitPrice": 150000}
        )

    def test_health_checks(self):
        """Kiểm tra liveness và readiness probe (không cần token)."""
        res_ready = self.client.get("/health/ready")
        self.assertEqual(res_ready.status_code, status.HTTP_200_OK)
        self.assertEqual(res_ready.json()["service"], "billing")

        res_live = self.client.get("/health/live")
        self.assertEqual(res_live.status_code, status.HTTP_200_OK)

    def test_business_endpoint_requires_token(self):
        """Endpoint nghiệp vụ phải trả 401 khi không có Bearer token."""
        response = self.client.get("/api/v1/charges")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(response.json()["error"]["code"], "UNAUTHENTICATED")

    def test_list_charges_bi_013(self):
        """BI-013: CASHIER xem danh sách khoản thu theo trạng thái."""
        response = self.client.get("/api/v1/charges?state=OPEN", **cashier())
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        data = response.json()["data"]
        self.assertGreaterEqual(data["total"], 1)
        self.assertEqual(data["items"][0]["id"], str(self.charge.id))
        self.assertEqual(data["items"][0]["amountVnd"], 150000)

    def test_charge_detail_bi_002_success(self):
        """BI-002: Lấy chi tiết khoản thu thành công."""
        response = self.client.get(f"/api/v1/charges/{self.charge.id}", **cashier())
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        data = response.json()["data"]
        self.assertEqual(data["charge"]["id"], str(self.charge.id))
        self.assertEqual(data["refundState"], "NONE")
        self.assertIsNone(data["latestPayment"])

    def test_charge_detail_bi_002_not_found(self):
        """BI-002: Khoản thu không tồn tại trả về 404 NOT_FOUND."""
        random_id = uuid.uuid4()
        response = self.client.get(f"/api/v1/charges/{random_id}", **cashier())
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.json()["error"]["code"], "NOT_FOUND")

    def test_simulate_payment_bi_004_success(self):
        """BI-004: Mô phỏng thanh toán hợp lệ, trả 202 Accepted và statusUrl."""
        idempotency_key = str(uuid.uuid4())
        tx_id = f"TX_SIM_{uuid.uuid4().hex[:8]}"

        response = self.client.post(
            "/api/v1/payments/simulate",
            {
                "chargeId": str(self.charge.id),
                "transactionId": tx_id
            },
            format="json",
            HTTP_IDEMPOTENCY_KEY=idempotency_key,
            **patient(self.patient_id)
        )

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        self.assertIn("Location", response.headers)
        self.assertEqual(response.headers["Location"], f"/api/v1/charges/{self.charge.id}")

        data = response.json()["data"]
        self.assertEqual(data["state"], "PENDING")
        self.assertEqual(data["statusUrl"], f"/api/v1/charges/{self.charge.id}")

        # Kiểm tra Payment và Saga đã được lưu vào database
        payment = Payment.objects.get(transaction_id=tx_id)
        self.assertEqual(payment.state, "PENDING")
        self.assertEqual(payment.amount_vnd, 150000)

    def test_simulate_payment_missing_idempotency_key(self):
        """BI-004: Thiếu header Idempotency-Key trả về 400 VALIDATION_ERROR."""
        response = self.client.post(
            "/api/v1/payments/simulate",
            {
                "chargeId": str(self.charge.id),
                "transactionId": "TX_TEST_FAIL"
            },
            format="json",
            **patient(self.patient_id)
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.json()["error"]["code"], "VALIDATION_ERROR")

    def test_simulate_payment_duplicate_transaction(self):
        """BI-004: Trùng transactionId khác key trả về 409 DUPLICATE_TRANSACTION."""
        tx_id = "TX_DUPLICATE_001"
        Payment.objects.create(
            charge=self.charge,
            transaction_id=tx_id,
            amount_vnd=150000,
            state="PENDING",
            idempotency_key=str(uuid.uuid4())
        )

        # Gửi request với transaction_id cũ nhưng idempotency_key mới
        response = self.client.post(
            "/api/v1/payments/simulate",
            {
                "chargeId": str(self.charge.id),
                "transactionId": tx_id
            },
            format="json",
            HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()),
            **patient(self.patient_id)
        )
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.json()["error"]["code"], "DUPLICATE_TRANSACTION")

    def test_simulate_payment_idempotent_retry(self):
        """BI-004: Retry gửi lại cùng Idempotency-Key trả về cùng kết quả 202."""
        key = str(uuid.uuid4())
        tx_id = "TX_IDEMPOTENT_RETRY"

        # Lần gửi 1
        res1 = self.client.post(
            "/api/v1/payments/simulate",
            {"chargeId": str(self.charge.id), "transactionId": tx_id},
            format="json",
            HTTP_IDEMPOTENCY_KEY=key,
            **patient(self.patient_id)
        )
        self.assertEqual(res1.status_code, status.HTTP_202_ACCEPTED)

        # Lần gửi 2 (retry mạng)
        res2 = self.client.post(
            "/api/v1/payments/simulate",
            {"chargeId": str(self.charge.id), "transactionId": tx_id},
            format="json",
            HTTP_IDEMPOTENCY_KEY=key,
            **patient(self.patient_id)
        )
        self.assertEqual(res2.status_code, status.HTTP_202_ACCEPTED)
        self.assertEqual(res1.json()["data"]["paymentId"], res2.json()["data"]["paymentId"])
        # requestId phải ổn định để client polling không coi là ý định mới
        self.assertEqual(res1.json()["data"]["requestId"], res2.json()["data"]["requestId"])

        # Giả lập đối soát hoàn tất: Charge chuyển sang PAID, Payment chuyển sang SUCCEEDED
        self.charge.refresh_from_db()
        self.charge.state = "PAID"
        self.charge.settlement_state = "SUCCEEDED"
        self.charge.save(update_fields=["state", "settlement_state"])

        payment = Payment.objects.get(id=res1.json()["data"]["paymentId"])
        payment.state = "SUCCEEDED"
        payment.save(update_fields=["state"])

        # Lần gửi 3 (retry gửi lại sau khi khoản thu đã PAID/settled): vẫn phải trả về 202 và giữ nguyên paymentId
        res3 = self.client.post(
            "/api/v1/payments/simulate",
            {"chargeId": str(self.charge.id), "transactionId": tx_id},
            format="json",
            HTTP_IDEMPOTENCY_KEY=key,
            **patient(self.patient_id)
        )
        self.assertEqual(res3.status_code, status.HTTP_202_ACCEPTED)
        self.assertEqual(res3.json()["data"]["paymentId"], str(payment.id))
