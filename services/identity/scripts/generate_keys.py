#!/usr/bin/env python3
"""Sinh và đồng bộ cặp khóa RS256 dùng cho JWT của UMC Care.

Vì sao cần: quy định nhóm cấm commit private key, nên mỗi máy phải tự sinh khóa.
Public key được nhân bản ở ba nơi (Identity, Billing, JWKS trong Envoy); nếu lệch
nhau thì token hợp lệ vẫn bị 401 mà rất khó tìm nguyên nhân.

Chế độ:
    generate [--force]   sinh cặp khóa mới rồi đồng bộ public key
    sync                 chỉ đồng bộ public key từ jwt_private.pem hiện có
    check                kiểm tra các bản public key có khớp nhau không

Ví dụ:
    python services/identity/scripts/generate_keys.py generate
    python services/identity/scripts/generate_keys.py check
"""

import argparse
import base64
import json
import re
import sys
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

SERVICE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVICE_DIR.parents[1]

PRIVATE_KEY = SERVICE_DIR / "jwt_private.pem"
PUBLIC_TARGETS = [
    SERVICE_DIR / "jwt_public.pem",
    REPO_ROOT / "services" / "billing" / "jwt_public.pem",
    REPO_ROOT / "services" / "notification" / "jwt_public.pem",
]
# File dùng chung của nhóm: chỉ đọc để cảnh báo, không tự ghi.
SHARED_PUBLIC = REPO_ROOT / "infra" / "certs" / "jwt_public.pem"
ENVOY_CONFIG = REPO_ROOT / "envoy" / "envoy.yaml"

INLINE_PATTERN = re.compile(
    r"""^(?P<indent>\s*)inline_string: '(?P<jwks>\{"keys":\[.*\]\})'(?P<eol>\r?)$""",
    re.MULTILINE,
)


def jwk_from_public_key(public_key):
    numbers = public_key.public_numbers()
    modulus_size = (numbers.n.bit_length() + 7) // 8
    exponent_size = (numbers.e.bit_length() + 7) // 8
    return {
        "kty": "RSA",
        "use": "sig",
        "alg": "RS256",
        "n": base64.urlsafe_b64encode(numbers.n.to_bytes(modulus_size, "big")).decode().rstrip("="),
        "e": base64.urlsafe_b64encode(numbers.e.to_bytes(exponent_size, "big")).decode().rstrip("="),
    }


def fingerprint(public_key):
    jwk = jwk_from_public_key(public_key)
    return (jwk["n"], jwk["e"])


def short(value):
    return value[:16] + "…"


def public_pem_bytes(public_key):
    return public_key.public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )


def load_private():
    if not PRIVATE_KEY.exists():
        return None
    return serialization.load_pem_private_key(PRIVATE_KEY.read_bytes(), password=None)


def read_text(path):
    with path.open("r", encoding="utf-8", newline="") as handle:
        return handle.read()


def write_text(path, text):
    with path.open("w", encoding="utf-8", newline="") as handle:
        handle.write(text)


def envoy_fingerprint():
    """Trả (indent, fingerprint) của JWKS trong Envoy, hoặc (None, None)."""
    if not ENVOY_CONFIG.exists():
        return None, None
    match = INLINE_PATTERN.search(read_text(ENVOY_CONFIG))
    if not match:
        return None, None
    jwks = json.loads(match.group("jwks"))
    key = jwks["keys"][0]
    return match.group("indent"), (key["n"], key["e"])


def patch_envoy(public_key):
    """Ghi đè đúng một dòng JWKS inline; từ chối nếu không tìm thấy đúng 1 dòng."""
    if not ENVOY_CONFIG.exists():
        print(f"  bỏ qua   {ENVOY_CONFIG} (không tồn tại)")
        return True

    text = read_text(ENVOY_CONFIG)
    matches = list(INLINE_PATTERN.finditer(text))
    if len(matches) != 1:
        print(
            f"  DỪNG     {ENVOY_CONFIG}: tìm thấy {len(matches)} dòng JWKS inline, "
            "cần đúng 1. Sửa tay rồi chạy lại."
        )
        return False

    jwks = json.dumps({"keys": [jwk_from_public_key(public_key)]}, separators=(",", ":"))
    match = matches[0]
    replacement = f"{match.group('indent')}inline_string: '{jwks}'{match.group('eol')}"
    updated = text[: match.start()] + replacement + text[match.end():]

    if updated == text:
        print(f"  giữ nguyên {ENVOY_CONFIG} (JWKS)")
    else:
        write_text(ENVOY_CONFIG, updated)
        print(f"  đã ghi    {ENVOY_CONFIG} (JWKS)")
    return True


def warn_shared(public_key):
    if not SHARED_PUBLIC.exists():
        return
    shared = serialization.load_pem_public_key(SHARED_PUBLIC.read_bytes())
    if fingerprint(shared) != fingerprint(public_key):
        print(
            f"  CẢNH BÁO  {SHARED_PUBLIC} đang lệch khóa. "
            "File này thuộc thư mục dùng chung của nhóm nên script không tự sửa; "
            "báo người phụ trách infra cập nhật."
        )


def sync(public_key=None):
    if public_key is None:
        private = load_private()
        if private is None:
            print(f"Không thấy {PRIVATE_KEY}. Chạy 'generate' trước.")
            return 1
        public_key = private.public_key()

    pem = public_pem_bytes(public_key)
    for target in PUBLIC_TARGETS:
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and target.read_bytes() == pem:
            print(f"  giữ nguyên {target}")
        else:
            target.write_bytes(pem)
            print(f"  đã ghi    {target}")

    if not patch_envoy(public_key):
        return 1
    warn_shared(public_key)
    print(f"  vân tay   n={short(jwk_from_public_key(public_key)['n'])}")
    return 0


def generate(force):
    if PRIVATE_KEY.exists() and not force:
        print(f"Đã có {PRIVATE_KEY}. Dùng --force nếu thật sự muốn thay khóa.")
        return 1

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    PRIVATE_KEY.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    try:
        PRIVATE_KEY.chmod(0o600)
    except OSError:
        pass
    print(f"  đã sinh  {PRIVATE_KEY}")
    return sync(key.public_key())


def check():
    sources = []

    private = load_private()
    if private is not None:
        sources.append(("jwt_private.pem (nguồn chuẩn)", fingerprint(private.public_key())))

    for target in PUBLIC_TARGETS:
        label = str(target.relative_to(REPO_ROOT))
        if not target.exists():
            print(f"THIẾU: {label}")
            return 1
        sources.append((label, fingerprint(serialization.load_pem_public_key(target.read_bytes()))))

    _, envoy_print = envoy_fingerprint()
    if envoy_print is None:
        print(f"THIẾU: JWKS inline trong {ENVOY_CONFIG.relative_to(REPO_ROOT)}")
        return 1
    sources.append(("envoy/envoy.yaml (JWKS)", envoy_print))

    if SHARED_PUBLIC.exists():
        sources.append(
            (
                str(SHARED_PUBLIC.relative_to(REPO_ROOT)),
                fingerprint(serialization.load_pem_public_key(SHARED_PUBLIC.read_bytes())),
            )
        )

    reference = sources[0][1]
    mismatched = False
    for label, value in sources:
        status = "OK  " if value == reference else "LỆCH"
        if value != reference:
            mismatched = True
        print(f"{status} {label:48} n={short(value[0])}")

    if mismatched:
        print("\nCó bản public key lệch nhau. Chạy 'sync' để đồng bộ phần thuộc Identity/Billing/Envoy.")
        return 1

    print("\nTất cả public key khớp nhau.")
    return 0


def main():
    parser = argparse.ArgumentParser(description="Quản lý cặp khóa RS256 của UMC Care.")
    parser.add_argument("mode", choices=("generate", "sync", "check"))
    parser.add_argument("--force", action="store_true", help="chỉ dùng với mode generate")
    args = parser.parse_args()

    if args.mode == "generate":
        return generate(args.force)
    if args.mode == "sync":
        return sync()
    return check()


if __name__ == "__&#8203;main__":
    sys.exit(main())
