import os
import time
from pathlib import Path
import jwt

# Đường dẫn đến file private key RS256
BASE_DIR = Path(__file__).resolve().parent.parent.parent
PRIVATE_KEY_PATH = os.getenv("JWT_PRIVATE_KEY_PATH", BASE_DIR / "jwt_private.pem")

def get_private_key():
    """Đọc private key từ file PEM."""
    if not os.path.exists(PRIVATE_KEY_PATH):
        raise FileNotFoundError(f"Private key not found at {PRIVATE_KEY_PATH}")
    with open(PRIVATE_KEY_PATH, "r", encoding="utf-8") as f:
        return f.read()

def generate_access_token(user_id: str, actor_type: str, capabilities: list, token_version: int = 1) -> str:
    """Ký Access Token chuẩn RS256, thời hạn 15 phút (900s)."""
    now = int(time.time())
    payload = {
        "iss": "umc-care-identity",
        "aud": "umc-care-services",
        "sub": str(user_id),
        "actorType": actor_type,
        "capabilities": capabilities,
        "tokenVersion": token_version,
        "iat": now,
        "exp": now + 900,  # 15 phút
    }
    return jwt.encode(payload, get_private_key(), algorithm="RS256")

def generate_authorization_lease(user_id: str, action: str, token_version: int = 1) -> str:
    """Ký Authorization Lease ngắn tối đa 30 giây cho thao tác nhạy cảm (như đổi giá CA-004)."""
    now = int(time.time())
    payload = {
        "iss": "umc-care-identity",
        "aud": "umc-care-services",
        "sub": str(user_id),
        "action": action,
        "tokenVersion": token_version,
        "iat": now,
        "exp": now + 30,  # Tối đa 30 giây
    }
    return jwt.encode(payload, get_private_key(), algorithm="RS256")