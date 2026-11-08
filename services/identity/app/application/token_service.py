import os
import time
from pathlib import Path
import jwt

BASE_DIR = Path(__file__).resolve().parent.parent.parent
PRIVATE_KEY_PATH = os.getenv("JWT_PRIVATE_KEY_PATH", BASE_DIR / "jwt_private.pem")

PUBLIC_KEY_PATH: str | Path
configured_public_key_path = os.getenv("JWT_PUBLIC_KEY_PATH")
if configured_public_key_path:
    PUBLIC_KEY_PATH = configured_public_key_path
else:
    local_pub = BASE_DIR / "jwt_public.pem"
    repo_pub = BASE_DIR.parent.parent / "infra" / "certs" / "jwt_public.pem"
    PUBLIC_KEY_PATH = local_pub if local_pub.exists() else repo_pub

def get_private_key():
    """Đọc private key từ file PEM."""
    if not os.path.exists(PRIVATE_KEY_PATH):
        raise FileNotFoundError(f"Private key not found at {PRIVATE_KEY_PATH}")
    with open(PRIVATE_KEY_PATH, "r", encoding="utf-8") as f:
        return f.read()

def get_public_key():
    """Đọc public key từ file PEM."""
    if not os.path.exists(PUBLIC_KEY_PATH):
        raise FileNotFoundError(f"Public key not found at {PUBLIC_KEY_PATH}")
    with open(PUBLIC_KEY_PATH, "r", encoding="utf-8") as f:
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
        "typ": "access",
        "iat": now,
        "exp": now + 900,
    }
    return jwt.encode(payload, get_private_key(), algorithm="RS256")

def verify_access_token(token: str) -> dict:
    """Xác thực Access Token JWT RS256 và trả về payload."""
    return jwt.decode(
        token,
        get_public_key(),
        algorithms=["RS256"],
        issuer="umc-care-identity",
        audience="umc-care-services"
    )

def generate_authorization_lease(user_id: str, action: str, token_version: int = 1) -> str:
    """Ký Authorization Lease ngắn tối đa 30 giây cho thao tác nhạy cảm."""
    now = int(time.time())
    payload = {
        "iss": "umc-care-identity",
        "aud": "umc-care-services",
        "sub": str(user_id),
        "action": action,
        "tokenVersion": token_version,
        "typ": "lease",
        "iat": now,
        "exp": now + 30,  # Bắt buộc <= 30 giây
    }
    return jwt.encode(payload, get_private_key(), algorithm="RS256")
