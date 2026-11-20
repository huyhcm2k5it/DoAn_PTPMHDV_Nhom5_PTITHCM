# features

- **Purpose:** Features organized by service/domain.
- **Owners:** Quân — Patient/Appointment/Pharmacy và shell; Huy — Catalog/Clinical/Diagnostic; Hưng — Identity/Billing/Notification và shared session/transport.
- **Add or change:** Keep source code, configuration, migrations, and tests within this folder's scope.

Xem [README web](../../README.md) để biết quy tắc sửa file chung và bàn giao component. Tách thư mục giúp giảm conflict; vẫn phải phối hợp khi đổi router, props hoặc hợp đồng API.
