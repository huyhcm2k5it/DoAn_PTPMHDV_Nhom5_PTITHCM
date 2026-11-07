from django.urls import path
from app.api import view_health, view_charges, view_payments, view_receipts, view_reports, view_refunds

urlpatterns = [
    # Health checks cho Docker / Envoy Gateway
    path("health/ready", view_health.health_ready, name="health-ready"),
    path("health/live", view_health.health_live, name="health-live"),

    # BI-013: CASHIER xem danh sách khoản thu / chờ thu
    path("api/v1/charges", view_charges.charges_list_view, name="charges-list"),

    # BI-002: Lấy chi tiết charge cùng latestPayment, saga và refundState
    path("api/v1/charges/<uuid:charge_id>", view_charges.charge_detail_view, name="charge-detail"),

    # BI-003: Lấy các khoản thu theo patientId
    path("api/v1/patients/<uuid:patient_id>/charges", view_charges.patient_charges_list_view, name="patient-charges-list"),

    # BI-004: Giả lập thanh toán (trả 202 Accepted và statusUrl)
    path("api/v1/payments/simulate", view_payments.simulate_payment_view, name="payments-simulate"),

    # BI-005: Thu viện phí tại quầy bệnh viện (CASHIER)
    path("api/v1/payments/counter", view_payments.counter_payment_view, name="payments-counter"),

    # BI-006: Chi tiết biên nhận điện tử
    path("api/v1/receipts/<uuid:receipt_id>", view_receipts.receipt_detail_view, name="receipt-detail"),

    # BI-007 (POST) & BI-014 (GET): Tạo yêu cầu hoàn tiền & Danh sách hàng chờ hoàn
    path("api/v1/refunds", view_refunds.refunds_list_or_create_view, name="refunds-list-create"),

    # BI-008: Thực hiện hoàn tiền mô phỏng
    path("api/v1/refunds/<uuid:refund_id>/execute", view_refunds.execute_refund_view, name="refund-execute"),

    # BI-009: Trạng thái chi tiết yêu cầu hoàn tiền
    path("api/v1/refunds/<uuid:refund_id>", view_refunds.refund_detail_view, name="refund-detail"),

    # BI-010: Báo cáo thu/hoàn viện phí cho ADMIN (route theo hợp đồng API v5.2)
    path("api/v1/admin/reports/summary", view_reports.revenue_report_view, name="reports-revenue"),
]
