import logging
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

logger = logging.getLogger(__name__)


class EmailSender:
    """Giao diện gửi OTP qua Email."""

    def send_otp(self, to_email: str, code: str, purpose: str):
        raise NotImplementedError


class SmtpEmailSender(EmailSender):
    """Kênh thật: gửi OTP qua Gmail / SMTP Server."""

    def __init__(self):
        self.host = os.getenv("SMTP_HOST", "smtp.gmail.com")
        self.port = int(os.getenv("SMTP_PORT", "587"))
        self.user = os.environ["SMTP_USER"]
        self.password = os.environ["SMTP_PASSWORD"]
        self.from_email = os.getenv("SMTP_FROM_EMAIL", self.user)

    def send_otp(self, to_email: str, code: str, purpose: str):
        subject = f"[UMC Care] Mã xác thực OTP ({purpose})"
        html = f"""
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
            <h2 style="color: #0077b6; text-align: center;">UMC Care</h2>
            <p>Xin chào,</p>
            <p>Mã xác thực OTP cho yêu cầu <strong>{purpose}</strong> của bạn là:</p>
            <div style="background: #f1f8fc; padding: 15px; text-align: center; border-radius: 6px; margin: 16px 0;">
                <span style="font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #023e8a;">{code}</span>
            </div>
            <p style="color: #666; font-size: 13px;">Mã có hiệu lực trong <strong>5 phút</strong>. Vui lòng không chia sẻ mã này cho người khác.</p>
        </div>
        """
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"UMC Care <{self.from_email}>"
        msg["To"] = to_email
        msg.attach(MIMEText(f"Mã OTP UMC Care của bạn là: {code} (hiệu lực 5 phút).", "plain"))
        msg.attach(MIMEText(html, "html"))

        with smtplib.SMTP(self.host, self.port, timeout=10) as server:
            server.starttls()
            server.login(self.user, self.password)
            server.sendmail(self.from_email, [to_email], msg.as_string())


class DevInboxEmailSender(EmailSender):
    """Kênh test/offline: lưu vào bảng DevSmsInbox để không cần mạng vẫn test được."""

    def send_otp(self, to_email: str, code: str, purpose: str):
        from app.domain.models import DevSmsInbox
        DevSmsInbox.objects.create(phone=to_email[:20], purpose=purpose, body=code)


def get_email_sender() -> EmailSender:
    backend = os.getenv("EMAIL_BACKEND", "dev_inbox").strip().lower()
    if backend == "smtp":
        return SmtpEmailSender()
    if backend == "dev_inbox":
        return DevInboxEmailSender()
    raise RuntimeError(f"EMAIL_BACKEND không hợp lệ: {backend}")