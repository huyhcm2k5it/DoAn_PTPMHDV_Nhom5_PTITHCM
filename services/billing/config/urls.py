from django.urls import path
from app.api import view_health, view_charges, view_payments

urlpatterns = [
    # Health checks cho Docker / Envoy Gateway
    path("health/ready", view_health.health_ready, name="health-ready"),
    path("health/live", view_health.health_live, name="health-live"),

    # BI-013: CASHIER xem danh sách khoản thu / chờ thu
    path("api/v1/charges", view_charges.charges_list_view, name="charges-list"),

    # BI-002: Lấy chi tiết charge cùng latestPayment, saga và refundState
    path("api/v1/charges/<uuid:charge_id>", view_charges.charge_detail_view, name="charge-detail"),

    # BI-004: Giả lập thanh toán (trả 202 Accepted và statusUrl)
    path("api/v1/payments/simulate", view_payments.simulate_payment_view, name="payments-simulate"),
]