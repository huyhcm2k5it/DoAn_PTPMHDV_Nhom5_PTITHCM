"""Cổng giao OTP.

Nghiệp vụ chỉ gọi `get_sms_sender().send_otp(...)`. Kênh giao được chọn bằng
biến môi trường `SMS_BACKEND`, nên đổi từ hộp thư demo sang nhà cung cấp thật
không cần sửa code nghiệp vụ.
"""

import json
import logging
import os
import urllib.request

logger = logging.getLogger(__name__)


class SmsSender:
    """Giao diện gửi OTP."""

    def send_otp(self, phone, code, purpose):
        raise NotImplementedError


class HttpSmsSender(SmsSender):
    """Kênh thật: gọi nhà cung cấp SMS qua HTTP."""

    def __init__(self):
        self.url = os.environ["SMS_HTTP_URL"]
        self.token = os.environ["SMS_HTTP_TOKEN"]
        self.brandname = os.environ.get("SMS_BRANDNAME", "UMCCare")

    def send_otp(self, phone, code, purpose):
        body = json.dumps({
            "to": phone,
            "brandname": self.brandname,
            "message": f"Ma xac thuc UMC Care: {code}. Hieu luc 5 phut.",
        }).encode("utf-8")
        request = urllib.request.Request(
            self.url,
            data=body,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.token}",
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            if response.status >= 300:
                raise RuntimeError(f"Nha cung cap SMS tra ve {response.status}")


class DevInboxSmsSender(SmsSender):
    """Kênh demo: ghi vào hộp thư giả lập để endpoint dev đọc lại.

    Mã lưu ở đây chính là mã đã sinh cho người dùng, nên luồng xác thực vẫn
    đúng: người dùng nhập đúng mã đã "gửi", không phải mã sinh lại.
    """

    def send_otp(self, phone, code, purpose):
        from app.domain.models import DevSmsInbox

        DevSmsInbox.objects.create(phone=phone, purpose=purpose, body=code)


def get_sms_sender():
    backend = os.getenv("SMS_BACKEND", "dev_inbox").strip().lower()
    if backend == "http":
        return HttpSmsSender()
    if backend == "dev_inbox":
        return DevInboxSmsSender()
    raise RuntimeError(f"SMS_BACKEND không hợp lệ: {backend}")
