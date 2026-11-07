"""API quản trị của Identity: IA-011, IA-012, IA-013."""

import uuid
from datetime import datetime, time
from zoneinfo import ZoneInfo

from django.db import transaction
from django.utils.dateparse import parse_date
from rest_framework.decorators import api_view
from rest_framework.response import Response

from app.api import idempotency
from app.api.audit import record_audit
from app.api.authz import error_response, require_capability
from app.api.authz import correlation_id as get_correlation_id, error_response, require_capability
from app.domain.models import AuditEvent, StaffCapability, User

VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")
MAX_IDEMPOTENCY_KEY = 100
MAX_CAPABILITY = 50
MAX_SCOPE_KEY = 50



def vn_day_window(date_value):
    """Đầu ngày theo giờ Việt Nam, quy về datetime có múi giờ để so với cột UTC."""
    return datetime.combine(date_value, time.min, tzinfo=VN_TZ)


def parse_pagination(request):
    """Trả (page, limit, None) hoặc (None, None, response lỗi)."""
    try:
        page = int(request.query_params.get("page", 1))
        limit = int(request.query_params.get("limit", 20))
        if page < 1 or limit < 1 or limit > 100:
            raise ValueError()
    except (ValueError, TypeError):
        return None, None, error_response(
            request, 400, "VALIDATION_ERROR",
            "Tham số phân trang page phải >= 1 và limit nằm trong khoảng 1-100.",
        )
    return page, limit, None


def parse_date_param(request, name):
    raw = request.query_params.get(name)
    if not raw:
        return None, None
    try:
        parsed = parse_date(raw)
    except ValueError:
        parsed = None
    if parsed is None:
        return None, error_response(
            request, 400, "VALIDATION_ERROR",
            f"Tham số '{name}' phải có định dạng YYYY-MM-DD hợp lệ.",
        )
    return parsed, None


def serialize_capability(capability):
    return {
        "capability": capability.capability,
        "scopeKey": capability.scope_key,
        "enabled": capability.enabled,
    }


def serialize_staff(user):
    return {
        "id": str(user.id),
        "phone": user.phone,
        "actorType": user.actor_type,
        "status": user.status,
        "version": user.version,
        "capabilities": [serialize_capability(c) for c in user.capabilities.all()],
    }


@api_view(["GET"])
@require_capability("ADMIN")
def staff_list_view(request):
    """IA-011: STAFF[ADMIN] xem danh sách nhân viên và quyền hiện có."""
    page, limit, error = parse_pagination(request)
    if error:
        return error

    assert page is not None and limit is not None  # mypy

    queryset = (
        User.objects.filter(actor_type="STAFF")
        .prefetch_related("capabilities")
        .order_by("phone")
    )

    department_id = request.query_params.get("departmentId")
    if department_id:
        try:
            scope_key = str(uuid.UUID(str(department_id)))
        except (ValueError, TypeError):
            return error_response(
                request, 400, "VALIDATION_ERROR", "departmentId phải là UUID hợp lệ."
            )
        # User không có cột khoa; phạm vi khoa nằm ở scope_key của capability
        queryset = queryset.filter(capabilities__scope_key=scope_key).distinct()

    total = queryset.count()
    start = (page - 1) * limit
    items = [serialize_staff(user) for user in queryset[start:start + limit]]

    return Response({
        "data": {"items": items, "total": total},
        "meta": {"correlationId": get_correlation_id(request)},
    }, status=200)


@api_view(["PUT"])
@require_capability("ADMIN")
def staff_roles_view(request, staff_id):
    """IA-012: STAFF[ADMIN] cấp/thu hồi capability cho một tài khoản STAFF."""
    correlation_id = get_correlation_id(request)

    idempotency_key = request.headers.get("Idempotency-Key", "").strip()
    if not idempotency_key:
        return error_response(
            request, 400, "VALIDATION_ERROR", "Thiếu header bắt buộc Idempotency-Key."
        )
    if len(idempotency_key) > MAX_IDEMPOTENCY_KEY:
        return error_response(
            request, 400, "VALIDATION_ERROR",
            f"Idempotency-Key tối đa {MAX_IDEMPOTENCY_KEY} ký tự.",
        )

    if not isinstance(request.data, dict):
        return error_response(
            request, 400, "VALIDATION_ERROR", "Dữ liệu payload phải là JSON object."
        )

    raw_capabilities = request.data.get("capabilities")
    expected_version = request.data.get("expectedVersion")
    if not isinstance(raw_capabilities, list) or expected_version is None:
        return error_response(
            request, 400, "VALIDATION_ERROR",
            "Trường capabilities (mảng) và expectedVersion là bắt buộc.",
        )

    parsed = []
    for item in raw_capabilities:
        if not isinstance(item, dict):
            return error_response(
                request, 400, "VALIDATION_ERROR", "Mỗi phần tử capabilities phải là object."
            )
        raw_cap = item.get("capability")
        raw_scope = item.get("scopeKey")
        enabled = item.get("enabled")
        if not isinstance(raw_cap, str) or not isinstance(raw_scope, str) or not isinstance(enabled, bool):
            return error_response(
                request, 400, "VALIDATION_ERROR",
                "Mỗi phần tử cần capability (chuỗi), scopeKey (chuỗi) và enabled (boolean).",
            )
        capability = raw_cap.strip().upper()
        scope_key = raw_scope.strip()
        if not capability or not scope_key:
            return error_response(
                request, 400, "VALIDATION_ERROR",
                "capability và scopeKey không được để trống.",
            )
        if len(capability) > MAX_CAPABILITY or len(scope_key) > MAX_SCOPE_KEY:
            return error_response(
                request, 400, "VALIDATION_ERROR",
                f"capability tối đa {MAX_CAPABILITY} và scopeKey tối đa {MAX_SCOPE_KEY} ký tự.",
            )
        parsed.append((capability, scope_key, enabled))

    if isinstance(expected_version, bool) or isinstance(expected_version, float):
        return error_response(
            request, 400, "VALIDATION_ERROR", "expectedVersion phải là số nguyên."
        )
    try:
        expected_version = int(expected_version)
    except (ValueError, TypeError, OverflowError):
        return error_response(
            request, 400, "VALIDATION_ERROR", "expectedVersion phải là số nguyên."
        )

    payload = {
        "staffId": str(staff_id),
        "expectedVersion": expected_version,
        "capabilities": [
            {"capability": capability, "scopeKey": scope_key, "enabled": enabled}
            for capability, scope_key, enabled in parsed
        ],
    }

    data, conflict = idempotency.replay("IA-012", idempotency_key, payload)
    if conflict:
        return idempotency.conflict_response(request, correlation_id)
    if data is not None:
        return Response({
            "data": data,
            "meta": {"correlationId": correlation_id},
        }, status=200)

    with transaction.atomic():
        staff = (
            User.objects.select_for_update()
            .filter(id=staff_id, actor_type="STAFF")
            .first()
        )
        if not staff:
            return error_response(
                request, 404, "NOT_FOUND", f"Nhân viên {staff_id} không tồn tại."
            )

        # Re-check idempotency inside atomic lock
        data, conflict = idempotency.replay("IA-012", idempotency_key, payload)
        if conflict:
            return idempotency.conflict_response(request, correlation_id)
        if data is not None:
            return Response({
                "data": data,
                "meta": {"correlationId": correlation_id},
            }, status=200)

        if staff.version != expected_version:
            return error_response(
                request, 409, "STAFF_VERSION_CONFLICT",
                f"Quyền đã đổi kể từ phiên bản client đọc "
                f"(expectedVersion={expected_version}, hiện tại={staff.version}).",
            )

        # Dựng trạng thái sau khi áp thay đổi để kiểm tra ADMIN cuối cùng
        effective = {
            (cap.capability, cap.scope_key): cap.enabled
            for cap in staff.capabilities.all()
        }
        for capability, scope_key, enabled in parsed:
            effective[(capability, scope_key)] = enabled

        keeps_admin = any(
            enabled
            for (capability, _scope), enabled in effective.items()
            if capability == "ADMIN"
        )
        if not keeps_admin:
            admin_caps = list(
                StaffCapability.objects.select_for_update()
                .filter(capability="ADMIN", enabled=True)
                .order_by("id")
            )
            other_admins = sum(1 for c in admin_caps if c.user.id != staff.id)
            if other_admins == 0:
                return error_response(
                    request, 409, "LAST_ADMIN_REQUIRED",
                    "Không được thu hồi ADMIN cuối cùng của hệ thống.",
                )

        for capability, scope_key, enabled in parsed:
            assignment, _created = StaffCapability.objects.get_or_create(
                user=staff,
                capability=capability,
                scope_key=scope_key,
                defaults={"enabled": enabled},
            )
            if assignment.enabled != enabled:
                assignment.enabled = enabled
                assignment.save(update_fields=["enabled"])

        staff.version += 1
        staff.access_version += 1
        staff.save(update_fields=["version", "access_version"])

        staff = User.objects.prefetch_related("capabilities").get(id=staff.id)
        data = {
            "staffId": str(staff.id),
            "version": staff.version,
            "capabilities": [serialize_capability(c) for c in staff.capabilities.all()],
        }

        idempotency.remember("IA-012", idempotency_key, payload, data)
        record_audit(
            "STAFF_ROLES_CHANGED",
            correlation_id,
            actor_user_id=request.principal.id,
            target_id=staff.id,
            detail={
                "version": staff.version,
                "capabilities": payload["capabilities"],
            },
        )

    return Response({
        "data": data,
        "meta": {"correlationId": correlation_id},
    }, status=200)


@api_view(["GET"])
@require_capability("ADMIN")
def audit_list_view(request):
    """IA-013: STAFF[ADMIN] tra cứu nhật ký thao tác nhạy cảm."""
    page, limit, error = parse_pagination(request)
    if error:
        return error

    assert page is not None and limit is not None  # mypy

    parsed_from, error = parse_date_param(request, "from")
    if error:
        return error
    parsed_to, error = parse_date_param(request, "to")
    if error:
        return error
    if parsed_from and parsed_to and parsed_from > parsed_to:
        return error_response(
            request, 400, "VALIDATION_ERROR", "Tham số 'from' không được lớn hơn 'to'."
        )

    queryset = AuditEvent.objects.all().order_by("-at")

    actor_user_id = request.query_params.get("actorUserId")
    if actor_user_id:
        try:
            queryset = queryset.filter(actor_user_id=uuid.UUID(str(actor_user_id)))
        except (ValueError, TypeError):
            return error_response(
                request, 400, "VALIDATION_ERROR", "actorUserId phải là UUID hợp lệ."
            )

    action = request.query_params.get("action")
    if action:
        queryset = queryset.filter(action=action.strip()[:100])

    if parsed_from:
        queryset = queryset.filter(at__gte=vn_day_window(parsed_from))
    if parsed_to:
        # 02_ThamSo: 'to' là biên loại trừ
        queryset = queryset.filter(at__lt=vn_day_window(parsed_to))

    total = queryset.count()
    start = (page - 1) * limit
    items = [
        {
            "id": str(event.id),
            "actorUserId": str(event.actor_user_id) if event.actor_user_id else None,
            "action": event.action,
            "targetId": str(event.target_id) if event.target_id else None,
            "detail": event.before_after,
            "correlationId": str(event.correlation_id),
            "at": event.at.isoformat(),
        }
        for event in queryset[start:start + limit]
    ]

    return Response({
        "data": {"items": items, "total": total},
        "meta": {"correlationId": get_correlation_id(request)},
    }, status=200)
