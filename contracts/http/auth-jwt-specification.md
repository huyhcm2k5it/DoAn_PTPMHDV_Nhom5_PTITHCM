# ĐẶC TẢ HỢP ĐỒNG XÁC THỰC VÀ PHÂN QUYỀN (JWT & CAPABILITIES) — UMC CARE

- **Owner phụ trách phát hành:** Hưng (Identity Service)
- **Các bên tiêu thụ:** Envoy Gateway, 8 microservices, Web Shell (Quân), Android App (Hưng)
- **Chuẩn mã hóa:** RS256 (RSA Signature with SHA-256)

---

## 1. Cặp khóa RSA (Asymmetric Keys)
- **Identity Service:** Nắm giữ `jwt_private.pem` (2048-bit RSA) để ký token khi người dùng đăng nhập (`IA-004`) hoặc refresh (`IA-005`). **Tuyệt đối không commit private key lên Git.**
- **Envoy Gateway & các Microservices:** Nhận file `jwt_public.pem` qua cấu hình môi trường `JWT_PUBLIC_KEY_FILE` để kiểm tra chữ ký độc lập, không gọi HTTP về Identity.

---

## 2. Định dạng Access Token (Bearer Token)
- **Thời hạn sống (`exp`):** 15 phút (900 giây) kể từ thời điểm phát hành (`iat`).
- **Header:**
  ```json
  {
    "alg": "RS256",
    "typ": "JWT"
  }
  ```
- **Payload (Claims):**
  ```json
  {
    "iss": "umc-care-identity",
    "aud": "umc-care-services",
    "sub": "00000000-0000-4000-8000-000000000901",
    "actorType": "STAFF",
    "capabilities": ["RECEPTION", "CASHIER"],
    "tokenVersion": 1,
    "iat": 1729339200,
    "exp": 1729340100
  }
  ```
- **Ý nghĩa các trường:**
  * `iss`: Cố định `"umc-care-identity"`.
  * `aud`: Cố định `"umc-care-services"` (hoặc tên service cụ thể khi verify).
  * `sub`: UUID duy nhất của tài khoản người dùng tại Identity.
  * `actorType`: Một trong 3 giá trị: `"PATIENT"` | `"DOCTOR"` | `"STAFF"`.
  * `capabilities`: Mảng danh sách chuỗi các quyền được cấp cho tài khoản `STAFF`. Với `PATIENT` và `DOCTOR`, mảng này để trống `[]`.
  * `tokenVersion`: Số nguyên dương (khởi tạo là 1). Khi user đổi mật khẩu, đăng xuất hoặc bị quản trị viên thu hồi quyền, `tokenVersion` trong DB Identity sẽ tăng lên.

---

## 3. Header đặc thù: Authorization Lease (`X-Authorization-Lease`)
- Áp dụng cho các thao tác nhạy cảm (như `CA-004` cập nhật giá, ký duyệt hồ sơ bệnh án, duyệt kết quả LAB, xuất kho thuốc, hủy lịch hoàn tiền).
- Client gọi `IA-010` (`GET /api/v1/auth/session`) để xin Lease token trước khi thực hiện hành động.
- **Thời hạn sống:** Tối đa **30 giây**.
- **Payload mẫu:**
  ```json
  {
    "iss": "umc-care-identity",
    "aud": "umc-care-services",
    "sub": "00000000-0000-4000-8000-000000000901",
    "action": "CA-004",
    "tokenVersion": 1,
    "iat": 1729339200,
    "exp": 1729339230
  }
  ```
- Nếu Lease hết hạn, service trả mã lỗi `401 AUTHZ_LEASE_EXPIRED`. Client phải xin Lease mới để retry (giữ nguyên `Idempotency-Key`).

---

## 4. Ma trận Capabilities của STAFF

| Capability | Mục đích nghiệp vụ | Danh sách API chính liên quan |
| :--- | :--- | :--- |
| `RECEPTION` | Tiếp nhận bệnh nhân tại quầy, tạo hồ sơ hộ, đặt lịch hộ, check-in lấy số thứ tự | `PT-002`, `PT-003`, `AP-013` |
| `LAB_TECH` | Tiếp nhận order xét nghiệm, lấy mẫu, từ chối mẫu, nhập kết quả nháp | `DI-002` đến `DI-008` |
| `LAB_REVIEW`| Duyệt và công bố kết quả xét nghiệm (**Quy tắc 2 người: người đã nhập nháp không được tự duyệt**) | `DI-009` đến `DI-011` |
| `PHARMACY` | Quản lý kho dược, giữ thuốc theo đơn (`MED_HOLD`), xuất và xác nhận cấp phát thuốc | `PH-001` đến `PH-008` |
| `CASHIER` | Xem danh sách khoản thu viện phí, thu tiền mặt/POS tại quầy, xuất biên lai, xử lý hoàn tiền | `BI-003`, `BI-005` đến `BI-009` |
| `ADMIN` | Quản trị phòng/ca/danh mục, phân quyền nhân viên, tra cứu audit log | `IA-011`, `IA-012`, `IA-013` |

---

## 5. Sự kiện đồng bộ: `IdentityAccessChanged` (RabbitMQ)
Khi tài khoản thay đổi quyền hoặc tăng `tokenVersion`, Identity bắn sự kiện:
- **Exchange:** `umc.events.identity.v1`
- **Routing Key:** `identity.identity-access-changed.v1`
- **Payload:**
  ```json
  {
    "userId": "00000000-0000-4000-8000-000000000901",
    "status": "ACTIVE",
    "actorType": "STAFF",
    "capabilities": ["RECEPTION", "CASHIER"],
    "tokenVersion": 2,
    "phoneVerified": true,
    "version": 2
  }
  ```