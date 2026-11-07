"""Helper cho Idempotency-Key của Billing.

02_ThamSo quy định: "Khi retry giữ nguyên key và payload; cùng key với payload
khác phải trả 409". Vì vậy mỗi lần ghi cần lưu hash của payload đi kèm key.
"""

import hashlib
import json

from rest_framework.response import Response

from app.domain.models import IdempotencyRecord


def canonical_hash(payload):
    """Hash ổn định: sắp key, không khoảng trắng, giữ nguyên Unicode."""
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def conflict_response(request, correlation_id):
    return Response({
        "error": {
            "code": "IDEMPOTENCY_KEY_REUSED",
            "message": "Idempotency-Key đã được dùng với payload khác.",
        },
        "meta": {"correlationId": correlation_id},
    }, status=409)


def replay(scope, key, payload):
    """Trả (data, None) khi replay hợp lệ, (None, "conflict") khi payload khác.

    (None, None) nghĩa là key chưa từng được dùng.
    """
    record = IdempotencyRecord.objects.filter(scope=scope, key=key).first()
    if record is None:
        return None, None
    if record.request_hash != canonical_hash(payload):
        return None, "conflict"
    return record.response.get("data"), None


def remember(scope, key, payload, data):
    """Lưu key + hash + dữ liệu trả về trong cùng transaction với nghiệp vụ."""
    IdempotencyRecord.objects.create(
        scope=scope,
        key=key,
        request_hash=canonical_hash(payload),
        response={"data": data},
    )
