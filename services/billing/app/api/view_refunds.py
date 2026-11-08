import uuid

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.response import Response

from app.api import idempotency
from app.auth.lease import require_lease, check_lease
from app.api.querying import parse_date_param, vn_day_window
from app.auth.jwt_auth import (
    authenticated,
    can_read_patient_resource,
    patient_scope_error,
    require_staff,
)
from app.domain.models import BillingAuditEvent, BillingEventOutbox, Charge, Refund

REFUND_STATES = ("REQUESTED", "SUCCEEDED", "FAILED")


def get_correlation_id(request):
    return request.headers.get("X-Correlation-Id", str(uuid.uuid4()))


def serialize_refund(refund):
    return {
        "id": str(refund.id),
        "chargeId": str(refund.charge_id),
        "cancellationId": str(refund.cancellation_id),
        "reasonCode": refund.reason_code,
        "amountVnd": refund.amount_vnd,
        "state": refund.state,
        "attempts": refund.attempts,
        "version": refund.version,
        "updatedAt": refund.updated_at.isoformat() if refund.updated_at else None
    }


def validation_error(request, message):
    return Response({
        "error": {"code": "VALIDATION_ERROR", "message": message},
        "meta": {"correlationId": get_correlation_id(request)}
    }, status=400)


def record_audit(action, actor_user_id, target_id, payload, correlation_id):
    """Ghi vết nghiệp vụ tiền.

    BI-007 quy định reasonCode "được ghi vào audit"; bảng BillingAuditEvent là
    nơi lưu vết đó, tách khỏi audit an ninh của Identity.
    """
    actor = None
    if actor_user_id:
        try:
            actor = uuid.UUID(str(actor_user_id))
        except (ValueError, TypeError):
            actor = None
    BillingAuditEvent.objects.create(
        action=action,
        actor_user_id=actor,
        target_id=target_id,
        payload=payload,
        correlation_id=str(correlation_id)[:64],
    )


def parse_vn_date(request, name):
    parsed, bad = parse_date_param(request.query_params.get(name))
    if bad:
        return None, validation_error(
            request, f"Tham số '{name}' phải có định dạng YYYY-MM-DD hợp lệ."
        )
    return parsed, None


@api_view(["GET", "POST"])
@authenticated
def refunds_list_or_create_view(request):
    """BI-007 (POST): tạo yêu cầu hoàn tiền. BI-014 (GET): CASHIER xem hàng chờ hoàn."""
    principal = request.principal
    if request.method == "POST":
        failure = check_lease(request, "BI-007")
        if failure is not None:
            return failure
        if principal.actor_type not in ("SERVICE", "STAFF"):
            return Response({
                "error": {
                    "code": "FORBIDDEN",
                    "message": "Chỉ SERVICE hoặc STAFF[CASHIER] được tạo yêu cầu hoàn tiền."
                },
                "meta": {"correlationId": get_correlation_id(request)}
            }, status=403)
        if principal.actor_type == "STAFF" and not principal.has("CASHIER"):
            return Response({
                "error": {
                    "code": "FORBIDDEN",
                    "message": "Thiếu quyền bắt buộc: CASHIER."
                },
                "meta": {"correlationId": get_correlation_id(request)}
            }, status=403)
        return create_refund(request)

    if principal.actor_type != "STAFF" or not principal.has("CASHIER"):
        return Response({
            "error": {
                "code": "FORBIDDEN",
                "message": "Chỉ STAFF[CASHIER] được xem danh sách yêu cầu hoàn tiền."
            },
            "meta": {"correlationId": get_correlation_id(request)}
        }, status=403)
    return list_refunds(request)


def create_refund(request):
    correlation_id = get_correlation_id(request)
    idempotency_key = request.headers.get("Idempotency-Key", "").strip()
    if not idempotency_key:
        return validation_error(request, "Thiếu header bắt buộc Idempotency-Key.")

    if len(idempotency_key) > 100:
        return validation_error(request, "Idempotency-Key tối đa 100 ký tự.")

    if not isinstance(request.data, dict):
        return validation_error(request, "Dữ liệu payload phải là JSON object.")

    charge_id = request.data.get("chargeId")
    source_id = request.data.get("sourceId")  # chính là cancellationId
    reason_code = str(request.data.get("reasonCode", "")).strip()
    amount_vnd = request.data.get("amountVnd")

    if not charge_id or not source_id or not reason_code or amount_vnd is None:
        return validation_error(
            request, "Các trường chargeId, sourceId, reasonCode và amountVnd là bắt buộc."
        )

    if len(reason_code) > 50:
        return validation_error(request, "reasonCode tối đa 50 ký tự.")

    if isinstance(amount_vnd, bool) or isinstance(amount_vnd, float):
        return validation_error(
            request, "Định dạng UUID hoặc số tiền amountVnd (>=0) không hợp lệ."
        )

    try:
        charge_uuid = uuid.UUID(str(charge_id))
        cancellation_uuid = uuid.UUID(str(source_id))
        if isinstance(amount_vnd, str):
            if not amount_vnd.isdigit():
                raise ValueError()
            amount_vnd = int(amount_vnd)
        elif isinstance(amount_vnd, int):
            if amount_vnd < 0:
                raise ValueError()
        else:
            raise ValueError()
    except (ValueError, TypeError, OverflowError):
        return validation_error(
            request, "Định dạng UUID hoặc số tiền amountVnd (>=0) không hợp lệ."
        )

    scope = "BI-007:" + uuid.uuid5(uuid.NAMESPACE_URL, request.principal.user_id).hex
    payload = {
        "chargeId": str(charge_uuid),
        "sourceId": str(cancellation_uuid),
        "reasonCode": reason_code,
        "amountVnd": amount_vnd,
    }
    data, conflict = idempotency.replay(scope, idempotency_key, payload)
    if conflict:
        return idempotency.conflict_response(request, correlation_id)
    if data is not None:
        return Response({
            "data": data,
            "meta": {"correlationId": correlation_id}
        }, status=201)

    # Chống trùng lặp theo UniqueConstraint (charge, cancellation_id, reason_code)
    existing_refund = Refund.objects.filter(
        charge_id=charge_uuid,
        cancellation_id=cancellation_uuid,
        reason_code=reason_code
    ).first()
    if existing_refund:
        if existing_refund.amount_vnd != amount_vnd:
            return Response({
                "error": {
                    "code": "REFUND_CONFLICT",
                    "message": f"Yêu cầu hoàn tiền đã tồn tại với số tiền khác ({existing_refund.amount_vnd}đ != {amount_vnd}đ)."
                },
                "meta": {"correlationId": correlation_id}
            }, status=409)
        return Response({
            "data": {"refund": serialize_refund(existing_refund)},
            "meta": {"correlationId": correlation_id}
        }, status=201)

    with transaction.atomic():
        try:
            charge = Charge.objects.select_for_update().get(id=charge_uuid)
        except Charge.DoesNotExist:
            return Response({
                "error": {
                    "code": "NOT_FOUND",
                    "message": f"Khoản thu {charge_uuid} không tồn tại."
                },
                "meta": {"correlationId": correlation_id}
            }, status=404)

        # Double-check sau khi đã giữ lock để đảm bảo idempotency tuyệt đối
        existing_locked_refund = Refund.objects.filter(
            charge=charge,
            cancellation_id=cancellation_uuid,
            reason_code=reason_code
        ).first()
        if existing_locked_refund:
            if existing_locked_refund.amount_vnd != amount_vnd:
                return Response({
                    "error": {
                        "code": "REFUND_CONFLICT",
                        "message": f"Yêu cầu hoàn tiền đã tồn tại với số tiền khác ({existing_locked_refund.amount_vnd}đ != {amount_vnd}đ)."
                    },
                    "meta": {"correlationId": correlation_id}
                }, status=409)
            return Response({
                "data": {"refund": serialize_refund(existing_locked_refund)},
                "meta": {"correlationId": correlation_id}
            }, status=201)

        from app.domain.models import CancellationEvidence
        evidence = CancellationEvidence.objects.filter(cancellation_id=cancellation_uuid,
            source_type=charge.source_type, source_id=charge.source_id,
            source_revision=charge.source_revision).first()
        if not evidence:
            return Response({"error": {"code": "CANCELLATION_EVIDENCE_REQUIRED",
                "message": "Owner cancellation evidence has not synchronized."},
                "meta": {"correlationId": correlation_id}}, status=409)

        # Ràng buộc 1: Chỉ cho phép hoàn khi khoản thu đã thanh toán thành công (PAID)
        if charge.state != "PAID":
            return Response({
                "error": {
                    "code": "REFUND_NOT_ELIGIBLE",
                    "message": f"Khoản thu chưa ở trạng thái PAID để hoàn tiền (hiện tại: {charge.state})."
                },
                "meta": {"correlationId": correlation_id}
            }, status=409)

        # Ràng buộc 2: tổng tiền đã hoàn + đang chờ hoàn không vượt quá số tiền đã thu.
        # Phải cộng cả REQUESTED, nếu không có thể tạo nhiều yêu cầu vượt trần rồi kẹt ở bước execute.
        committed_refunded = Refund.objects.filter(
            charge=charge, state__in=("REQUESTED", "SUCCEEDED")
        ).aggregate(total=Sum("amount_vnd"))["total"] or 0

        if committed_refunded + amount_vnd > charge.amount_vnd:
            return Response({
                "error": {
                    "code": "REFUND_EXCEEDS_PAID",
                    "message": (
                        f"Tổng tiền hoàn đã cam kết ({committed_refunded + amount_vnd}đ) "
                        f"vượt quá số tiền đã thanh toán ({charge.amount_vnd}đ)."
                    )
                },
                "meta": {"correlationId": correlation_id}
            }, status=409)

        refund = Refund.objects.create(
            charge=charge,
            cancellation_id=cancellation_uuid,
            reason_code=reason_code,
            amount_vnd=amount_vnd,
            state="REQUESTED",
            attempts=[],
            version=1
        )

        data = {"refund": serialize_refund(refund)}
        idempotency.remember(scope, idempotency_key, payload, data)
        record_audit(
            "REFUND_REQUESTED",
            request.principal.user_id,
            refund.id,
            {
                "chargeId": str(charge.id),
                "cancellationId": str(cancellation_uuid),
                "reasonCode": reason_code,
                "amountVnd": amount_vnd,
            },
            correlation_id,
        )

    return Response({
        "data": data,
        "meta": {"correlationId": correlation_id}
    }, status=201)


def list_refunds(request):
    correlation_id = get_correlation_id(request)

    try:
        page = int(request.query_params.get("page", 1))
        limit = int(request.query_params.get("limit", 20))
        if page < 1 or limit < 1 or limit > 100:
            raise ValueError()
    except (ValueError, TypeError):
        return validation_error(
            request, "Tham số phân trang page phải >= 1 và limit nằm trong khoảng 1-100."
        )

    state = request.query_params.get("state")
    if state:
        state = state.strip().upper()
        if state not in REFUND_STATES:
            return validation_error(
                request, "Giá trị state không hợp lệ, chỉ chấp nhận: " + ", ".join(REFUND_STATES) + "."
            )

    parsed_from, error = parse_vn_date(request, "from")
    if error:
        return error
    parsed_to, error = parse_vn_date(request, "to")
    if error:
        return error

    if parsed_from and parsed_to and parsed_from > parsed_to:
        return validation_error(request, "Tham số 'from' không được lớn hơn 'to'.")

    queryset = Refund.objects.all().order_by("-updated_at")
    if state:
        queryset = queryset.filter(state=state)
    if parsed_from:
        queryset = queryset.filter(updated_at__gte=vn_day_window(parsed_from))
    if parsed_to:
        # 02_ThamSo: 'to' là biên loại trừ, nên dừng ngay tại đầu ngày 'to' theo giờ VN
        queryset = queryset.filter(updated_at__lt=vn_day_window(parsed_to))

    total = queryset.count()
    start = (page - 1) * limit
    items = [serialize_refund(r) for r in queryset[start:start + limit]]

    return Response({
        "data": {
            "items": items,
            "total": total
        },
        "meta": {"correlationId": correlation_id}
    }, status=200)


@api_view(["POST"])
@require_staff("CASHIER")
@require_lease("BI-008")
def execute_refund_view(request, refund_id):
    """BI-008: Thực hiện hoàn tiền mô phỏng (SUCCESS hoặc FAIL)."""
    correlation_id = get_correlation_id(request)

    idempotency_key = request.headers.get("Idempotency-Key", "").strip()
    if not idempotency_key:
        return validation_error(request, "Thiếu header bắt buộc Idempotency-Key.")

    if len(idempotency_key) > 100:
        return validation_error(request, "Idempotency-Key tối đa 100 ký tự.")

    if not isinstance(request.data, dict):
        return validation_error(request, "Dữ liệu payload phải là JSON object.")

    transaction_id = str(request.data.get("transactionId", "")).strip()
    scenario = str(request.data.get("scenario", "")).strip().upper()
    expected_version = request.data.get("expectedVersion")

    if not transaction_id or scenario not in ["SUCCESS", "FAIL"] or expected_version is None:
        return validation_error(
            request,
            "Các trường transactionId, scenario (SUCCESS hoặc FAIL) và expectedVersion là bắt buộc."
        )

    try:
        expected_version = int(expected_version)
    except (ValueError, TypeError):
        return validation_error(request, "Trường expectedVersion phải là số nguyên hợp lệ.")

    scope = "BI-008:" + uuid.uuid5(uuid.NAMESPACE_URL, request.principal.user_id + str(refund_id)).hex
    payload = {
        "transactionId": transaction_id,
        "scenario": scenario,
        "expectedVersion": expected_version,
    }
    data, conflict = idempotency.replay(scope, idempotency_key, payload)
    if conflict:
        return idempotency.conflict_response(request, correlation_id)
    if data is not None:
        return Response({
            "data": data,
            "meta": {"correlationId": correlation_id}
        }, status=200)

    with transaction.atomic():
        try:
            refund = Refund.objects.select_for_update().get(id=refund_id)
        except Refund.DoesNotExist:
            return Response({
                "error": {
                    "code": "NOT_FOUND",
                    "message": f"Yêu cầu hoàn tiền {refund_id} không tồn tại."
                },
                "meta": {"correlationId": correlation_id}
            }, status=404)

        # Replay idempotent: cùng transactionId đã hoàn thành trước đó
        if refund.state == "SUCCEEDED":
            for attempt in refund.attempts:
                if attempt.get("transactionId") == transaction_id:
                    return Response({
                        "data": {"refund": serialize_refund(refund)},
                        "meta": {"correlationId": correlation_id}
                    }, status=200)

            return Response({
                "error": {
                    "code": "REFUND_ALREADY_EXECUTED",
                    "message": f"Yêu cầu hoàn tiền {refund_id} đã được thực hiện thành công trước đó."
                },
                "meta": {"correlationId": correlation_id}
            }, status=409)

        # Reject execution unless refund.state is REQUESTED (e.g. FAILED cannot later succeed)
        if refund.state not in ("REQUESTED", "FAILED"):
            return Response({
                "error": {
                    "code": "REFUND_NOT_EXECUTABLE",
                    "message": f"Yêu cầu hoàn tiền {refund_id} không ở trạng thái REQUESTED (trạng thái hiện tại: {refund.state})."
                },
                "meta": {"correlationId": correlation_id}
            }, status=409)

        # Reject execution unless refund.state is REQUESTED (e.g. FAILED cannot later succeed)
        if refund.state not in ("REQUESTED", "FAILED"):
            return Response({
                "error": {
                    "code": "REFUND_NOT_EXECUTABLE",
                    "message": f"Yêu cầu hoàn tiền {refund_id} không ở trạng thái REQUESTED (trạng thái hiện tại: {refund.state})."
                },
                "meta": {"correlationId": correlation_id}
            }, status=409)

        # Kiểm tra OCC sau khi đã loại trừ trường hợp replay idempotent
        if refund.version != expected_version:
            return Response({
                "error": {
                    "code": "CONCURRENT_MODIFICATION",
                    "message": f"Xung đột phiên bản (expectedVersion={expected_version}, hiện tại={refund.version})."
                },
                "meta": {"correlationId": correlation_id}
            }, status=409)

        try:
            charge = Charge.objects.select_for_update().get(id=refund.charge.id)
        except Charge.DoesNotExist:
            return Response({
                "error": {
                    "code": "NOT_FOUND",
                    "message": f"Khoản thu {refund.charge.id} không tồn tại."
                },
                "meta": {"correlationId": correlation_id}
            }, status=404)

        if scenario == "SUCCESS":
            # Kiểm tra trần số tiền hoàn
            other_refunded = Refund.objects.filter(
                charge=charge, state="SUCCEEDED"
            ).exclude(id=refund.id).aggregate(total=Sum("amount_vnd"))["total"] or 0

            if other_refunded + refund.amount_vnd > charge.amount_vnd:
                return Response({
                    "error": {
                        "code": "REFUND_EXCEEDS_PAID",
                        "message": f"Tổng tiền hoàn vượt quá số tiền đã thanh toán ({charge.amount_vnd}đ)."
                    },
                    "meta": {"correlationId": correlation_id}
                }, status=409)

            refund.state = "SUCCEEDED"
            refund.attempts.append({
                "transactionId": transaction_id,
                "scenario": scenario,
                "result": "SUCCEEDED",
                "executedAt": timezone.now().isoformat()
            })
            refund.version += 1
            refund.save()

            from app.infrastructure.message_delivery import make_envelope
            charge.version += 1
            charge.save(update_fields=["version", "updated_at"])
            status_payload = {"chargeId": str(charge.id), "recipientUserId": str(charge.recipient_user_id) if charge.recipient_user_id else None,
                "refundId": str(refund.id), "state": "REFUNDED", "version": charge.version,
                "sourceType": charge.source_type, "sourceId": str(charge.source_id),
                "refundStatus": refund.state, "asOf": timezone.now().isoformat()}
            BillingEventOutbox.objects.create(event_type="BillingStatusChanged",
                exchange="umc.events.billing.v1", routing_key="billing.billing-status-changed.v1",
                payload=make_envelope("BillingStatusChanged",status_payload,charge.id,refund.version))

        else:
            refund.state = "FAILED"
            refund.attempts.append({
                "transactionId": transaction_id,
                "scenario": scenario,
                "result": "FAILED",
                "executedAt": timezone.now().isoformat()
            })
            refund.version += 1
            refund.save()

        data = {"refund": serialize_refund(refund)}
        idempotency.remember(scope, idempotency_key, payload, data)
        record_audit(
            "REFUND_SUCCEEDED" if scenario == "SUCCESS" else "REFUND_FAILED",
            request.principal.user_id,
            refund.id,
            {
                "chargeId": str(refund.charge.id),
                "transactionId": transaction_id,
                "scenario": scenario,
                "amountVnd": refund.amount_vnd,
            },
            correlation_id,
        )

    return Response({
        "data": data,
        "meta": {"correlationId": correlation_id}
    }, status=200)


@api_view(["GET"])
@authenticated
def refund_detail_view(request, refund_id):
    """BI-009: Lấy thông tin trạng thái yêu cầu hoàn tiền."""
    correlation_id = get_correlation_id(request)

    try:
        refund = Refund.objects.select_related("charge").get(id=refund_id)
    except Refund.DoesNotExist:
        return Response({
            "error": {
                "code": "NOT_FOUND",
                "message": f"Yêu cầu hoàn tiền {refund_id} không tồn tại."
            },
            "meta": {"correlationId": correlation_id}
        }, status=404)

    if not can_read_patient_resource(request.principal, refund.charge.patient_id):
        return patient_scope_error(request)

    return Response({
        "data": {"refund": serialize_refund(refund)},
        "meta": {"correlationId": correlation_id}
    }, status=200)
