THIẾT KẾ CƠ SỞ DỮ LIỆU & SƠ ĐỒ ERD CHI TIẾT — HỆ THỐNG UMC CARE (v5.0)

**Phiên bản:** 5.0 (Đồng bộ BRD, SRS, UC, OpenAPI 86 & AsyncAPI 18 Events / 5 Commands ngày 17/10/2026. Bản tích hợp bổ sung QueueTicketChanged và VisitDoctorGrantChanged)

**Mô hình phân công (3–3–3):**

**Hưng (Django · PostgreSQL):** Identity (identity\_db), Billing (billing\_db), Notification (notification\_db)

**Quân (Node.js/TS · MongoDB):** Patient (patient\_db), Appointment (appointment\_db), Pharmacy (pharmacy\_db)

**Huy (Go · PostgreSQL):** Catalog (catalog\_db), Clinical (clinical\_db), Diagnostic (diagnostic\_db)

# PHẦN 0: TỔNG QUAN KIẾN TRÚC DỮ LIỆU & LIÊN KẾT LOGIC XUYÊN SERVICE (LREF)

## 0.1. Nguyên tắc thiết kế cốt lõi

**Database-per-Service:** 6 database logic PostgreSQL và 3 database logic MongoDB (trên 1 Mongo Replica Set và 1 PostgreSQL instance phục vụ demo). Mỗi service dùng credential riêng và **chỉ có quyền ghi vào DB của mình**.

**Không FK / Không JOIN xuyên Service:** Mọi tham chiếu sang thực thể của service khác đều là **LREF (Logical Reference)** lưu dưới dạng UUID opaque. Việc kiểm tra quyền hoặc đồng bộ dữ liệu đọc được thực hiện qua **Local Projections** cập nhật từ 20 Integration Events và 5 Commands trên RabbitMQ.

**Cách đọc DBML:** Mỗi khối ERD ở Phần 1 mô tả một service và có thể dán riêng vào trình hỗ trợ DBML. Với MongoDB, `Table` biểu diễn collection và `pk` là khóa logic trong tài liệu. Các tham chiếu nội bộ MongoDB và LREF xuyên service nằm trong ghi chú. `ref` biểu diễn khóa ngoại nội bộ PostgreSQL. Bảng kỹ thuật và quy tắc có điều kiện được mô tả trong từ điển dữ liệu.

**Định dạng chuẩn:** Khóa chính id kiểu uuid; thời gian lưu theo UTC (ngày nghiệp vụ tính theo Asia/Ho\_Chi\_Minh); tiền tệ kiểu số nguyên bigint / int64 (VND); kiểm soát đồng thời bằng version (Optimistic Concurrency) và SELECT FOR UPDATE / Mongo Transaction cho các thao tác giữ chỗ, trừ tồn, thu/hoàn tiền.

## 0.2. Sơ đồ Liên kết Logic xuyên Service (Cross-Service LREF & Event/Command Topology)

Dán riêng khối này vào trình hỗ trợ DBML System Architecture. Đường nét đứt biểu diễn LREF theo bảng mục 0.3. Các đường AMQP biểu diễn luồng trao đổi qua RabbitMQ.

```dbml
---
diagram_type: arch
---

Server "Identity" as identity [database: 'identity_db / PostgreSQL']
Server "Patient" as patient [database: 'patient_db / MongoDB']
Server "Catalog" as catalog [database: 'catalog_db / PostgreSQL']
Server "Appointment" as appointment [database: 'appointment_db / MongoDB']
Server "Clinical" as clinical [database: 'clinical_db / PostgreSQL']
Server "Diagnostic" as diagnostic [database: 'diagnostic_db / PostgreSQL']
Server "Pharmacy" as pharmacy [database: 'pharmacy_db / MongoDB']
Server "Billing" as billing [database: 'billing_db / PostgreSQL']
Server "Notification" as notification [database: 'notification_db / PostgreSQL']

// Liên kết logic. Bội số và khóa tham chiếu xem mục 0.3.
Link: identity - patient [style: dashed, lref: 'patients.ownerUserId']
Link: identity - catalog [style: dashed, lref: 'doctors.identity_user_id']
Link: identity - notification [style: dashed, lref: 'notifications.recipient_user_id']
Link: patient - appointment [style: dashed, lref: 'appointments.patientId']
Link: catalog - appointment [style: dashed, lref: 'schedules.doctorId, schedules.serviceId']
Link: catalog - pharmacy [style: dashed, lref: 'inventory.medicineId']
Link: catalog - diagnostic [style: dashed, lref: 'lab_orders.test_codes, lab_orders.test_snapshot']
Link: appointment - clinical [style: dashed, lref: 'visits.appointment_id']
Link: clinical - diagnostic [style: dashed, lref: 'lab_orders.clinical_request_id, lab_orders.visit_id']
Link: clinical - pharmacy [style: dashed, lref: 'prescription_projection.(prescriptionId, revision)']

// Luồng command/event đi qua RabbitMQ.
Link: appointment - billing [proto: AMQP, source_type: 'APPOINTMENT']
Link: diagnostic - billing [proto: AMQP, source_type: 'LAB_ORDER']
Link: pharmacy - billing [proto: AMQP, source_type: 'MED_HOLD']
Link: appointment - notification [proto: AMQP, event: 'AppointmentChanged']
Link: diagnostic - notification [proto: AMQP, event: 'LabResultPublished']
Link: pharmacy - notification [proto: AMQP, event: 'MedicationDispensed']
Link: billing - notification [proto: AMQP, event: 'BillingStatusChanged']
```

## 0.3. Bảng tổng hợp Liên kết Logic xuyên Service (Cross-Service LREF)

| **Liên kết logic (Nguồn → Đích)** | **Bội số** | **Khóa tham chiếu & Ràng buộc đồng bộ** |
| --- | --- | --- |
| Identity.users → Patient.patients | 1 : 0..N | ownerUserId (LREF); Patient phát PatientAccessChanged, các consumer giữ patient\_access\_projection. |
| Identity.users → Catalog.doctors | 1 : 0..1 | identity\_user\_id (UQ LREF); quyền/scope vẫn thuộc Identity. |
| Catalog.doctors / medical\_services → Appointment.schedules | 1 : 0..N | doctorId / serviceId (LREF); giữ snapshot trường cần hiển thị. |
| Catalog.medicines → Pharmacy.inventory | 1 : 0..1 | medicineId (UQ LREF); tồn kho thực tế chỉ lưu ở Pharmacy. |
| Catalog.lab\_tests → Diagnostic.lab\_orders | N : N | Qua test\_codes / test\_snapshot (lưu mã, đơn vị, khoảng tham chiếu, giá tại thời điểm chỉ định). |
| Patient.patients → Appointment.appointments | 1 : 0..N | patientId (LREF). |
| Appointment.appointments → Clinical.visits | 1 : 0..1 | appointment\_id (UQ LREF); lượt khám RETURN tiếp tục dùng cùng visitId. |
| Clinical.lab\_requests → Diagnostic.lab\_orders | 1 : 0..1 | clinical\_request\_id (UQ LREF); khi đang PENDING sẽ chặn ký kết luận Visit. |
| Clinical.visits → Diagnostic.lab\_orders | 1 : 0..N | visit\_id (LREF). |
| Clinical.prescriptions → Pharmacy.prescription\_projection | 1 : 0..1 | UQ(prescriptionId, revision) cho mỗi bản FINAL. |
| Appointment / Diagnostic / Pharmacy → Billing.charges | 1 : 0..1 | UQ(source\_type, source\_id, source\_revision); không tạo FK đa hình. |
| Identity.users → Notification.notifications | 1 : 0..N | recipient\_user\_id (LREF); tuyệt đối không dùng patientId làm userId. |

# PHẦN 1: CHI TIẾT ERD & TỪ ĐIỂN DỮ LIỆU CỦA 9 MICROSERVICES

## 1. Identity Service (identity\_db — PostgreSQL · Owner: Hưng · Django)

**Trách nhiệm:** Quản lý tài khoản (PATIENT, DOCTOR, STAFF), xác minh tài khoản và đặt lại mật khẩu bằng OTP 6 số gửi qua email, quản lý phiên đăng nhập (sessions), phân quyền nhân viên theo capability/scope (staff\_capabilities), cấp authorization lease ngắn hạn (tối đa 30s) và ghi nhật ký bảo mật (audit\_events).

### Sơ đồ ERD — Identity Service

```dbml
Project identity_db {
  database_type: 'PostgreSQL'
}

Table users {
  id uuid [pk]
  phone text [not null, unique]
  email varchar(255) [null, note: 'Địa chỉ nhận OTP. IA-001 bắt buộc email hợp lệ.']
  password_hash text [not null]
  actor_type text [not null]
  status text [not null]
  phone_verified_at timestamptz [null, note: 'Tên trường hiện hành. Identity ghi khi xác minh OTP đăng ký qua email.']
  version int [not null]
  token_version int [not null]
  access_version int [not null]

  checks {
    `actor_type IN ('PATIENT', 'DOCTOR', 'STAFF')`
  }
}

Table otp_requests {
  id uuid [pk]
  user_id uuid [null, ref: > users.id]
  phone text [not null]
  email varchar(255) [null, note: 'Địa chỉ đích của lần gửi OTP. Tra cứu mã theo phone và purpose.']
  purpose text [not null]
  code_hash text [not null]
  expires_at timestamptz [not null]
  used_at timestamptz [null]
  attempts int [not null]

  indexes {
    (phone, purpose, expires_at)
  }
}

Table sessions {
  id uuid [pk]
  user_id uuid [not null, ref: > users.id]
  refresh_hash text [not null, unique]
  expires_at timestamptz [not null]
  revoked_at timestamptz [null]
  device_id text [null]

  indexes {
    (user_id, expires_at)
  }
}

Table staff_capabilities {
  id uuid [pk]
  user_id uuid [not null, ref: > users.id]
  capability text [not null]
  scope_key text [not null]
  enabled boolean [not null]
  assigned_by uuid [not null, ref: > users.id]
  assigned_at timestamptz [not null]

  indexes {
    (user_id, capability, scope_key) [unique]
  }
}

Table audit_events {
  id uuid [pk]
  actor_user_id uuid [null, ref: > users.id]
  action text [not null]
  target_id uuid [null, note: 'LREF']
  before_after jsonb [null]
  correlation_id uuid [not null]
  at timestamptz [not null]

  indexes {
    (actor_user_id, at)
  }

  Note: 'Append-only. Không lưu OTP hoặc password hash.'
}
```

### Từ điển dữ liệu — Identity Service

| **Bảng (Table)** | **Thuộc tính & Kiểu dữ liệu** | **Khóa, Chỉ mục & Quy tắc bất biến (Invariants)** |
| --- | --- | --- |
| users | id: uuid PK; phone: text UQ; email: varchar(255)?; password\_hash: text; actor\_type: text; status: text; phone\_verified\_at: timestamptz?; version: int; token\_version: int; access\_version: int | UQ(phone); CHECK actor\_type IN ('PATIENT','DOCTOR','STAFF'); chỉ tài khoản ACTIVE mới được tạo phiên. API đăng ký yêu cầu email hợp lệ để nhận OTP. DB cho phép email NULL và không đặt UNIQUE cho email. Identity ghi phone\_verified\_at khi xác minh OTP đăng ký qua email. |
| otp\_requests | id: uuid PK; user\_id: uuid FK?; phone: text; email: varchar(255)?; purpose: text; code\_hash: text; expires\_at: timestamptz; used\_at: timestamptz?; attempts: int | FK user\_id -> users.id (khi có); INDEX(phone, purpose, expires\_at); giới hạn thử ≤ 5 lần trong transaction; job dọn dữ liệu quá hạn. Email là địa chỉ đích của lần gửi. Identity vẫn tra cứu mã theo phone và purpose. |
| sessions | id: uuid PK; user\_id: uuid FK; refresh\_hash: text UQ; expires\_at: timestamptz; revoked\_at: timestamptz?; device\_id: text? | FK user\_id -> users.id; UQ(refresh\_hash); INDEX(user\_id, expires\_at). Đổi/reset mật khẩu thu hồi toàn bộ phiên cũ. |
| staff\_capabilities | id: uuid PK; user\_id: uuid FK; capability: text; scope\_key: text; enabled: boolean; assigned\_by: uuid FK; assigned\_at: timestamptz | FK user\_id, assigned\_by -> users.id; UQ(user\_id, capability, scope\_key); quyền ADMIN chỉ cấp cho tài khoản quản trị chỉ định. |
| audit\_events | id: uuid PK; actor\_user\_id: uuid FK?; action: text; target\_id: uuid? LREF; before\_after: jsonb?; correlation\_id: uuid; at: timestamptz | INDEX(actor\_user\_id, at); bảng bất biến (append-only), tuyệt đối không ghi mã OTP hoặc password hash vào log/audit. |
| **Bảng kỹ thuật** | outbox, inbox, idempotency\_records, retry\_jobs, dead\_letters | Phát sự kiện IdentityAccessChanged qua outbox trong cùng SQL transaction khi thay đổi quyền/trạng thái. |

## 2. Patient Service (patient\_db — MongoDB · Owner: Quân · Node.js/TS)

**Trách nhiệm:** Quản lý hồ sơ hành chính của bệnh nhân (bản thân SELF hoặc người thân OTHER), kiểm soát quyền sở hữu hồ sơ (ownerUserId) và lưu vết chỉnh sửa (profile\_audit).

### Sơ đồ ERD — Patient Service

```dbml
Project patient_db {
  Note: 'Mô hình document MongoDB. Table biểu diễn collection. PK là khóa logic và các tham chiếu được ghi chú.'
}

Table patients {
  id uuid [pk]
  ownerUserId uuid [not null, note: 'LREF']
  relation string [not null, note: 'Giá trị: SELF, OTHER.']
  fullName string [not null]
  birthDate date [not null]
  sex string [null]
  bhytSelfDeclared string [null]
  version int [not null]
  contactPhone string [null]
  address string [null]
  createdAt date [not null]
  updatedAt date [not null]
  active bool [not null]
  policyVersion int [not null]

  indexes {
    ownerUserId
  }
}

Table profile_audit {
  id uuid [pk]
  patientId uuid [not null, note: 'Tham chiếu nội bộ: patients.id.']
  actorUserId uuid [not null, note: 'LREF']
  action string [not null]
  changedFields string[] [not null]
  at date [not null]

  indexes {
    (patientId, at)
  }

  Note: 'Chỉ lưu tên trường thay đổi trong changedFields.'
}
```

### Từ điển dữ liệu — Patient Service

| **Collection** | **Thuộc tính & Kiểu dữ liệu** | **Khóa, Chỉ mục & Quy tắc bất biến (Invariants)** |
| --- | --- | --- |
| patients | id: uuid PK; ownerUserId: uuid LREF; relation: enum (SELF|OTHER); fullName: string; birthDate: date; sex: enum?; bhytSelfDeclared: string?; version: int; contactPhone: string?; address: string?; createdAt: UTC; updatedAt: UTC; active: bool; policyVersion: int | INDEX(ownerUserId); cấm tạo hồ sơ vô chủ. Tại quầy lễ tân đối chiếu user\_access\_projection hoặc account proof ký từ Identity (không gọi chuỗi HTTP Patient -> Identity). |
| profile\_audit | id: uuid PK; patientId: uuid ref; actorUserId: uuid LREF; action: string; changedFields: string[]; at: UTC | INDEX(patientId, at); chỉ ghi tên trường thay đổi, không lưu dữ liệu nhạy cảm nguyên bản. |
| **Collection kỹ thuật** | user\_access\_projection, outbox, inbox, idempotency\_records, retry\_jobs, dead\_letters | Phát PatientAccessChanged(patientId, ownerUserId, active, policyVersion) qua outbox để 5 services nghiệp vụ cập nhật projection quyền. |

## 3. Catalog Service (catalog\_db — PostgreSQL · Owner: Huy · Go)

**Trách nhiệm:** Quản lý danh mục dùng chung (khoa, hồ sơ nghề nghiệp bác sĩ, dịch vụ khám, thuốc, xét nghiệm) và bảng giá có hiệu lực theo thời gian (price\_versions).

### Sơ đồ ERD — Catalog Service

```dbml
Project catalog_db {
  database_type: 'PostgreSQL'
}

Table departments {
  id uuid [pk]
  code text [not null, unique]
  name text [not null]
  status text [not null]
}

Table doctors {
  id uuid [pk]
  identity_user_id uuid [not null, unique, note: 'LREF']
  department_id uuid [not null, ref: > departments.id]
  display_name text [not null]
  status text [not null]
}

Table medical_services {
  id uuid [pk]
  department_id uuid [not null, ref: > departments.id]
  code text [not null, unique]
  name text [not null]
  status text [not null]
}

Table medicines {
  id uuid [pk]
  code text [not null, unique]
  name text [not null]
  unit text [not null]
  strength text [null]
  form text [null]
  status text [not null]
}

Table lab_tests {
  id uuid [pk]
  code text [not null, unique]
  name text [not null]
  specimen_type text [not null]
  unit text [null]
  reference_range text [null]
  revision int [not null]
  status text [not null]
}

Table price_versions {
  id uuid [pk]
  item_type text [not null, note: 'Giá trị: EXAM, LAB, MEDICINE.']
  item_id uuid [not null, note: 'Tham chiếu theo item_type: EXAM → medical_services.id, LAB → lab_tests.id, MEDICINE → medicines.id.']
  revision int [not null]
  amount_vnd bigint [not null]
  effective_from timestamptz [not null]
  effective_to timestamptz [null]
  created_by uuid [not null, note: 'LREF']

  indexes {
    (item_type, item_id, revision) [unique]
  }

  checks {
    `amount_vnd >= 0`
  }

  Note: 'Các khoảng hiệu lực của cùng (item_type, item_id) không được chồng lấn.'
}
```

### Từ điển dữ liệu — Catalog Service

| **Bảng (Table)** | **Thuộc tính & Kiểu dữ liệu** | **Khóa, Chỉ mục & Quy tắc bất biến (Invariants)** |
| --- | --- | --- |
| departments | id: uuid PK; code: text UQ; name: text; status: text | UQ(code). |
| doctors | id: uuid PK; identity\_user\_id: uuid LREF UQ; department\_id: uuid FK; display\_name: text; status: text | FK department\_id -> departments.id; UQ(identity\_user\_id). Quyền đăng nhập/scope thuộc Identity. |
| medical\_services | id: uuid PK; department\_id: uuid FK; code: text UQ; name: text; status: text | FK department\_id -> departments.id; UQ(code). Giá lưu tại price\_versions. |
| medicines | id: uuid PK; code: text UQ; name: text; unit: text; strength: text?; form: text?; status: text | UQ(code). Chỉ chứa định nghĩa danh mục; tồn kho thực tế thuộc Pharmacy. |
| lab\_tests | id: uuid PK; code: text UQ; name: text; specimen\_type: text; unit: text?; reference\_range: text?; revision: int; status: text | UQ(code). Khi chỉ định LAB, snapshot mã, đơn vị và khoảng tham chiếu vào order. |
| price\_versions | id: uuid PK; item\_type: text (EXAM|LAB|MEDICINE); item\_id: uuid; revision: int; amount\_vnd: bigint; effective\_from: timestamptz; effective\_to: timestamptz?; created\_by: uuid LREF | UQ(item\_type, item\_id, revision); CHECK amount\_vnd >= 0; dùng khóa/advisory lock khi phát hành giá tương lai để chặn khoảng thời gian hiệu lực chồng lấn. |
| **Bảng kỹ thuật** | outbox, inbox, user\_access\_projection, idempotency\_records, retry\_jobs, dead\_letters | Phát CatalogChanged (UPSERT/TOMBSTONE và CHECKPOINT mỗi 10s kèm streamSequence). Cache Redis umc:catalog:v1:{generation}:{filterHash} TTL 60s. |

## 4. Appointment Service (appointment\_db — MongoDB · Owner: Quân · Node.js/TS)

**Trách nhiệm:** Quản lý lịch làm việc (schedules), chia khung giờ (slots), giữ chỗ nguyên tử 10 phút (holds), chống trùng giờ cùng hồ sơ (patient\_time\_locks), lịch hẹn (appointments) và hàng chờ vé khám (queue\_tickets).

### Sơ đồ ERD — Appointment Service

```dbml
Project appointment_db {
  Note: 'Mô hình document MongoDB. Table biểu diễn collection. PK là khóa logic và các tham chiếu được ghi chú.'
}

Table schedules {
  id uuid [pk]
  doctorId uuid [not null, note: 'LREF']
  serviceId uuid [not null, note: 'LREF']
  room string [not null]
  startAt date [not null]
  endAt date [not null]
  capacityPerSlot int [not null]
  status string [not null]
  version int [not null]
  slotMinutes int [not null]

  indexes {
    (doctorId, startAt)
  }
}

Table slots {
  id uuid [pk]
  scheduleId uuid [not null, note: 'Tham chiếu nội bộ: schedules.id.']
  startAt date [not null]
  endAt date [not null]
  capacity int [not null]
  heldCount int [not null]
  confirmedCount int [not null]
  version int [not null]

  indexes {
    (scheduleId, startAt) [unique]
  }

  Note: 'heldCount + confirmedCount không vượt capacity.'
}

Table holds {
  id uuid [pk]
  slotId uuid [not null, note: 'Tham chiếu nội bộ: slots.id.']
  patientId uuid [not null, note: 'LREF']
  status string [not null, note: 'Giá trị: HELD, CONSUMED, RELEASED, EXPIRED.']
  expiresAt date [not null]
  principalId string [not null]
  idempotencyKey string [not null]
  createdAt date [not null]
  priceSnapshot object [not null]
  consumedAt date [null]

  indexes {
    (principalId, idempotencyKey) [unique]
  }
}

Table appointments {
  id uuid [pk]
  holdId uuid [not null, unique, note: 'Tham chiếu nội bộ: holds.id (tối đa một lịch hẹn mỗi hold).']
  patientId uuid [not null, note: 'LREF']
  slotId uuid [not null, note: 'Tham chiếu nội bộ: slots.id.']
  serviceId uuid [not null, note: 'LREF']
  doctorId uuid [not null, note: 'LREF']
  priceSnapshotVnd int64 [not null]
  state string [not null]
  version int [not null]
  slotHistory object[] [not null]
  chargeId uuid [null, note: 'LREF']
  expiresAt date [not null]
  priceVersion uuid [not null, note: 'LREF']
  settlementId uuid [null]
  settlementState string [not null]
  settlementVersion int [not null]
}

Table queue_tickets {
  id uuid [pk]
  appointmentId uuid [not null, note: 'Tham chiếu nội bộ: appointments.id.']
  ticketType string [not null, note: 'Giá trị: FIRST, RETURN.']
  visitId uuid [null, note: 'LREF']
  returnRound int [not null]
  state string [not null, note: 'Giá trị: WAITING, CALLED, CLAIMED, NO_SHOW, DONE.']
  calledAt date [null]
  claimId uuid [null, note: 'Chỉ mục duy nhất có điều kiện cho claimId hợp lệ.']
  claimedBy uuid [null, note: 'LREF']
  noShowReason string [null]
  version int [not null]

  indexes {
    (appointmentId, ticketType, returnRound) [unique]
  }
}

Table patient_time_locks {
  patientId uuid [pk, note: 'LREF']
  intervals object[] [not null, note: 'Mảng tài liệu nhúng [{holdId, appointmentId?, startAt, endAt, state}]. holdId và appointmentId tham chiếu nội bộ. Mỗi patientId có một document.']
  version int [not null]
}
```

### Từ điển dữ liệu — Appointment Service

| **Collection** | **Thuộc tính & Kiểu dữ liệu** | **Khóa, Chỉ mục & Quy tắc bất biến (Invariants)** |
| --- | --- | --- |
| schedules | id: uuid PK; doctorId: uuid LREF; serviceId: uuid LREF; room: string; startAt: UTC; endAt: UTC; capacityPerSlot: int; status: enum; version: int; slotMinutes: int | INDEX(doctorId, startAt) chặn trùng ca bác sĩ; kiểm tra overlap (room, startAt); cấm giảm capacityPerSlot xuống dưới held + confirmed. slotMinutes được lưu từ AP-005/AP-006 để tái tạo slots nhất quán. |
| slots | id: uuid PK; scheduleId: uuid ref; startAt: UTC; endAt: UTC; capacity: int; heldCount: int; confirmedCount: int; version: int | UQ(scheduleId, startAt); bất biến heldCount + confirmedCount <= capacity. |
| holds | id: uuid PK; slotId: uuid ref; patientId: uuid LREF; status: enum (HELD|CONSUMED|RELEASED|EXPIRED); expiresAt: UTC; principalId: string; idempotencyKey: string; createdAt: UTC; priceSnapshot: object; consumedAt: UTC? | UQ(principalId, idempotencyKey); giữ chỗ 10 phút trong Mongo transaction; job trả chỗ khi hết hạn (Redis không phải nguồn giữ chỗ). |
| appointments | id: uuid PK; holdId: uuid ref UQ; patientId: uuid LREF; slotId: uuid ref; serviceId: uuid LREF; doctorId: uuid LREF; priceSnapshotVnd: int64; state: enum; version: int; slotHistory: object[]; chargeId: uuid LREF?; expiresAt: UTC; priceVersion: uuid LREF; settlementId: uuid?; settlementState: enum; settlementVersion: int | UQ(holdId). Đổi lịch giữ slot mới trước rồi mới nhả slot cũ trong cùng transaction. Chỉ chuyển CONFIRMED khi nhận ChargePaid/SettlementDecision đúng fence. |
| queue\_tickets | id: uuid PK; appointmentId: uuid ref; ticketType: FIRST|RETURN; visitId: uuid LREF?; returnRound: int; state: WAITING|CALLED|CLAIMED|NO\_SHOW|DONE; calledAt: UTC?; claimId: uuid?; claimedBy: uuid LREF?; noShowReason: string?; version: int | UQ(appointmentId, ticketType, returnRound); sparse UQ(claimId). FIRST có returnRound=0, RETURN có returnRound=1. Vắng mặt RETURN không đổi appointment thành NO\_SHOW. |
| patient\_time\_locks | patientId: uuid PK LREF; intervals: [{holdId, appointmentId?, startAt, endAt, state}]; version: int | 1 document / patient; cập nhật trong cùng Mongo transaction với slots khi giữ/đổi/nhả để chặn 1 hồ sơ đặt 2 lịch trùng khoảng [startAt, endAt). |
| **Collection kỹ thuật** | settlement\_decisions, command\_results, catalog\_projection, patient\_access\_projection, user\_access\_projection, projection\_checkpoints, outbox, inbox, idempotency\_records, retry\_jobs, dead\_letters | Nhận command ClaimQueueTicket (trả QueueTicketClaimed) và ReserveSettlement (khóa lịch SETTLEMENT\_LOCKED, tăng fence, trả SettlementReserved). |

## 5. Clinical Service (clinical\_db — PostgreSQL · Owner: Huy · Go)

**Trách nhiệm:** Quản lý lượt khám (visits), ghi chú khám bệnh nháp/ký cuối (visit\_notes), danh sách yêu cầu chỉ định xét nghiệm (lab\_requests) và kê toa thuốc (prescriptions, prescription\_items).

### Sơ đồ ERD — Clinical Service

```dbml
Project clinical_db {
  database_type: 'PostgreSQL'
}

Table visits {
  id uuid [pk]
  appointment_id uuid [not null, unique, note: 'LREF']
  doctor_user_id uuid [not null, note: 'LREF']
  state text [not null]
  version int [not null]
  started_at timestamptz [not null]
  signed_at timestamptz [null]
  patient_id uuid [not null, note: 'LREF']
  department_id uuid [not null, note: 'LREF']
  return_round int [not null]
  claim_id uuid [not null, note: 'LREF']
}

Table visit_notes {
  id uuid [pk]
  visit_id uuid [not null, ref: > visits.id]
  revision int [not null]
  symptoms text [not null]
  findings text [not null]
  assessment text [not null]
  diagnosis text [not null]
  author_user_id uuid [not null, note: 'LREF']
  saved_at timestamptz [not null]

  indexes {
    (visit_id, revision) [unique]
  }
}

Table prescriptions {
  id uuid [pk]
  visit_id uuid [not null, ref: > visits.id]
  revision int [not null]
  state text [not null, note: 'Giá trị: DRAFT, FINAL, DELETED.']
  version int [not null]
  finalized_at timestamptz [null]
  finalized_by uuid [null, note: 'LREF']

  indexes {
    (visit_id, revision) [unique]
  }

  Note: 'Toa DRAFT có thể chưa có dòng thuốc. Khi FINAL phải có ít nhất một dòng thuốc và visit đã SIGNED. Tối đa một bản FINAL hiệu lực trên mỗi visit.'
}

Table prescription_items {
  id uuid [pk]
  prescription_id uuid [not null, ref: > prescriptions.id]
  medicine_id uuid [not null, note: 'LREF']
  medicine_code_snapshot string [not null]
  name_snapshot string [not null]
  dose_text string [not null]
  quantity int [not null]
  instruction text [not null]

  checks {
    `quantity > 0`
  }
}

Table lab_requests {
  id uuid [pk]
  visit_id uuid [not null, ref: > visits.id]
  request_key string [not null]
  request_hash string [not null]
  state text [not null, note: 'Giá trị: PENDING, CREATED, FAILED.']
  order_id uuid [null, note: 'LREF']
  test_snapshot jsonb [not null]
  version int [not null]
  created_at timestamptz [not null]

  indexes {
    (visit_id, request_key) [unique]
  }
}
```

### Từ điển dữ liệu — Clinical Service

| **Bảng (Table)** | **Thuộc tính & Kiểu dữ liệu** | **Khóa, Chỉ mục & Quy tắc bất biến (Invariants)** |
| --- | --- | --- |
| visits | id: uuid PK; appointment\_id: uuid LREF UQ; doctor\_user\_id: uuid LREF; state: enum; version: int; started\_at: UTC; signed\_at: UTC?; patient\_id: uuid LREF; department\_id: uuid LREF; return\_round: int; claim\_id: uuid LREF | UQ(appointment\_id) — mỗi lịch hẹn có tối đa 1 visit duy nhất; lượt quay lại RETURN sau xét nghiệm tiếp tục dùng cùng visit.id và không thu phí khám mới. |
| visit\_notes | id: uuid PK; visit\_id: uuid FK; revision: int; symptoms: text; findings: text; assessment: text; diagnosis: text; author\_user\_id: uuid LREF; saved\_at: UTC | FK visit\_id -> visits.id; UQ(visit\_id, revision). Bản nháp không hiển thị cho bệnh nhân. |
| prescriptions | id: uuid PK; visit\_id: uuid FK; revision: int; state: DRAFT|FINAL|DELETED; version: int; finalized\_at: UTC?; finalized\_by: uuid LREF? | FK visit\_id -> visits.id; UQ(visit\_id, revision). Chỉ được ký FINAL sau khi visit đã SIGNED; tối đa 1 bản FINAL hiệu lực và bất biến sau khi ký. |
| prescription\_items | id: uuid PK; prescription\_id: uuid FK; medicine\_id: uuid LREF; medicine\_code\_snapshot: string; name\_snapshot: string; dose\_text: string; quantity: int; instruction: text | FK prescription\_id -> prescriptions.id; CHECK quantity > 0. Toa FINAL bắt buộc có ít nhất 1 dòng thuốc. |
| lab\_requests | id: uuid PK; visit\_id: uuid FK; request\_key: string; request\_hash: string; state: PENDING|CREATED|FAILED; order\_id: uuid LREF?; test\_snapshot: jsonb; version: int; created\_at: UTC | FK visit\_id -> visits.id; UQ(visit\_id, request\_key). Ghi PENDING + outbox CreateLabOrder trong cùng transaction khóa visit. Còn PENDING hoặc order chưa PUBLISHED/CANCELLED thì **cấm ký Visit**. Trạng thái FAILED trong DB ánh xạ thành REJECTED trên LabOrderResolved và CL-003; timeout vẫn PENDING, không coi là FAILED. |
| **Bảng kỹ thuật** | start\_requests, lab\_status\_projection, catalog\_projection, patient\_access\_projection, user\_access\_projection, projection\_checkpoints, outbox, inbox, idempotency\_records, retry\_jobs, dead\_letters | start\_requests giữ trạng thái gọi ClaimQueueTicket; lab\_status\_projection theo dõi trạng thái order từ Diagnostic để mở RETURN\_READY và kiểm điều kiện ký. |

## 6. Diagnostic Service (diagnostic\_db — PostgreSQL · Owner: Huy · Go)

**Trách nhiệm:** Quản lý vòng đời xét nghiệm (LAB) từ lúc nhận command tạo order (lab\_orders), lấy mẫu/từ chối/lấy lại mẫu (specimens), nhập kết quả nháp (results, result\_items) đến bước duyệt công bố bởi người thứ hai (reviews).

### Sơ đồ ERD — Diagnostic Service

```dbml
Project diagnostic_db {
  database_type: 'PostgreSQL'
}

Table lab_orders {
  id uuid [pk]
  visit_id uuid [not null, note: 'LREF']
  test_codes jsonb [not null]
  state text [not null]
  charge_id uuid [null, note: 'LREF']
  created_at timestamptz [not null]
  version int [not null]
  clinical_request_id uuid [not null, unique, note: 'LREF']
  patient_id uuid [not null, note: 'LREF']
  test_snapshot jsonb [not null]
  price_snapshot jsonb [not null]
  settlement_id uuid [null]
  settlement_state text [not null]
  settlement_version int [not null]

  Note: 'Một order có thể chưa có mẫu. Chỉ hủy trước khi có specimen.'
}

Table specimens {
  id uuid [pk]
  order_id uuid [not null, ref: > lab_orders.id]
  sequence int [not null]
  state text [not null, note: 'Giá trị: COLLECTED, REJECTED.']
  barcode string [not null, unique]
  collected_at timestamptz [not null]
  collected_by uuid [not null, note: 'LREF']
  reject_reason string [null]
  version int [not null]

  indexes {
    (order_id, sequence) [unique]
  }
}

Table results {
  id uuid [pk]
  order_id uuid [not null, ref: > lab_orders.id]
  specimen_id uuid [not null, ref: > specimens.id]
  revision int [not null]
  state text [not null, note: 'Giá trị: DRAFT, REVIEW, REWORK, PUBLISHED.']
  entered_by uuid [not null, note: 'LREF']
  submitted_at timestamptz [null]
  published_at timestamptz [null]
  version int [not null]
  contributor_user_ids uuid[] [not null]

  indexes {
    (order_id, revision) [unique]
  }

  Note: 'Specimen phải thuộc cùng order. Kết quả PUBLISHED là bất biến.'
}

Table result_items {
  id uuid [pk]
  result_id uuid [not null, ref: > results.id]
  test_code string [not null]
  value_text string [not null]
  unit string [null]
  reference_range string [null]
  flag string [null]

  indexes {
    (result_id, test_code) [unique]
  }
}

Table reviews {
  id uuid [pk]
  result_id uuid [not null, ref: > results.id]
  reviewer_user_id uuid [not null, note: 'LREF']
  decision text [not null]
  reason text [null]
  reviewed_at timestamptz [not null]

  Note: 'Reviewer không được có trong results.contributor_user_ids.'
}
```

### Từ điển dữ liệu — Diagnostic Service

| **Bảng (Table)** | **Thuộc tính & Kiểu dữ liệu** | **Khóa, Chỉ mục & Quy tắc bất biến (Invariants)** |
| --- | --- | --- |
| lab\_orders | id: uuid PK; visit\_id: uuid LREF; test\_codes: jsonb; state: enum; charge\_id: uuid LREF?; created\_at: UTC; version: int; clinical\_request\_id: uuid LREF UQ; patient\_id: uuid LREF; test\_snapshot: jsonb; price\_snapshot: jsonb; settlement\_id: uuid?; settlement\_state: enum; settlement\_version: int | UQ(clinical\_request\_id). Chỉ tạo từ command CreateLabOrder của Clinical; ghi order + RequestCharge + LabOrderResolved trong cùng transaction với inbox. Chỉ được hủy trước khi có bất kỳ specimen nào. |
| specimens | id: uuid PK; order\_id: uuid FK; sequence: int; state: COLLECTED|REJECTED; barcode: string UQ; collected\_at: UTC; collected\_by: uuid LREF; reject\_reason: string?; version: int | FK order\_id -> lab\_orders.id; UQ(order\_id, sequence); UQ(barcode). Chỉ lấy mẫu khi order đã PAID (xác minh qua settlement\_decisions cục bộ). Mẫu lỗi REJECTED được lấy lại (recollect) tăng sequence trong cùng order, không thu phí lần 2. |
| results | id: uuid PK; order\_id: uuid FK; specimen\_id: uuid FK; revision: int; state: enum (DRAFT|REVIEW|REWORK|PUBLISHED); entered\_by: uuid LREF; submitted\_at: UTC?; published\_at: UTC?; version: int; contributor\_user\_ids: uuid[] | FK order\_id -> lab\_orders.id; FK specimen\_id -> specimens.id (phải cùng order\_id); UQ(order\_id, revision). Bản PUBLISHED là bất biến. |
| result\_items | id: uuid PK; result\_id: uuid FK; test\_code: string; value\_text: string; unit: string?; reference\_range: string?; flag: string? | FK result\_id -> results.id; UQ(result\_id, test\_code). |
| reviews | id: uuid PK; result\_id: uuid FK; reviewer\_user\_id: uuid LREF; decision: enum; reason: text?; reviewed\_at: UTC | FK result\_id -> results.id. **Quy tắc 2 người bắt buộc:** reviewer\_user\_id không được nằm trong mảng results.contributor\_user\_ids (trả 409 SELF\_REVIEW\_FORBIDDEN nếu vi phạm). |
| **Bảng kỹ thuật** | settlement\_decisions, command\_results, catalog\_projection, patient\_access\_projection, user\_access\_projection, projection\_checkpoints, outbox, inbox, idempotency\_records, retry\_jobs, dead\_letters | Lưu settlement\_decisions để đối chiếu fence trước khi lấy mẫu; phát LabResultPublished và LabCancelled. |

## 7. Pharmacy Service (pharmacy\_db — MongoDB · Owner: Quân · Node.js/TS)

**Trách nhiệm:** Quản lý tồn kho thực tế (inventory), phiếu nhập kho bổ sung (stock\_receipts), nhận bản chiếu toa thuốc cuối (prescription\_projection), giữ toàn bộ toa 15 phút (medication\_holds) và cấp phát thuốc một lần (dispenses).

### Sơ đồ ERD — Pharmacy Service

```dbml
Project pharmacy_db {
  Note: 'Mô hình document MongoDB. Table biểu diễn collection. PK là khóa logic và các tham chiếu được ghi chú.'
}

Table inventory {
  id uuid [pk]
  medicineId uuid [not null, unique, note: 'LREF']
  onHand int [not null]
  reserved int [not null]
  version int [not null]
  updatedAt date [not null]

  Note: '0 <= reserved <= onHand. Giữ, nhả và cấp phát toàn toa trong Mongo transaction.'
}

Table stock_receipts {
  id uuid [pk]
  receiptKey string [not null, unique]
  actorUserId uuid [not null, note: 'LREF']
  items object[] [not null, note: 'Mảng tài liệu nhúng [{medicineId, quantity, batchRef}]. medicineId đối chiếu inventory.medicineId.']
  receivedAt date [not null]
}

Table prescription_projection {
  id uuid [pk]
  prescriptionId uuid [not null, note: 'LREF']
  revision int [not null]
  visitId uuid [not null, note: 'LREF']
  linesSnapshot object[] [not null]
  sourceEventId uuid [not null]
  patientId uuid [not null, note: 'LREF']

  indexes {
    (prescriptionId, revision) [unique]
  }
}

Table medication_holds {
  id uuid [pk]
  prescriptionId uuid [not null, note: 'LREF. Đối chiếu prescription_projection theo (prescriptionId, revision). Mỗi bản chiếu có tối đa một hold, dùng attemptNo khi giữ lại.']
  revision int [not null]
  attemptNo int [not null]
  status string [not null, note: 'Giá trị: HELD, SETTLEMENT_LOCKED, COMMITTED, RELEASED, EXPIRED.']
  itemsSnapshot object[] [not null]
  expiresAt date [not null]
  chargeId uuid [null, note: 'LREF']
  version int [not null]
  attemptHistory object[] [not null]
  patientId uuid [not null, note: 'LREF']
  settlementId uuid [null]
  settlementState string [not null]
  settlementVersion int [not null]

  indexes {
    (prescriptionId, revision) [unique]
  }
}

Table dispenses {
  id uuid [pk]
  holdId uuid [not null, unique, note: 'Tham chiếu nội bộ: medication_holds.id (tối đa một lượt cấp phát mỗi hold).']
  prescriptionId uuid [not null, note: 'LREF']
  revision int [not null]
  actorUserId uuid [not null, note: 'LREF']
  itemsSnapshot object[] [not null, note: 'Mỗi dòng thuốc trong mảng đối chiếu inventory.medicineId. Một lần cấp phát có thể chứa nhiều thuốc.']
  dispensedAt date [not null]
  attemptNo int [not null]

  indexes {
    (prescriptionId, revision) [unique]
  }
}
```

### Từ điển dữ liệu — Pharmacy Service

| **Collection** | **Thuộc tính & Kiểu dữ liệu** | **Khóa, Chỉ mục & Quy tắc bất biến (Invariants)** |
| --- | --- | --- |
| inventory | id: uuid PK; medicineId: uuid LREF UQ; onHand: int; reserved: int; version: int; updatedAt: UTC | UQ(medicineId); bất biến 0 <= reserved <= onHand. Mọi thao tác giữ/nhả/phát toàn toa phải chạy trong Mongo transaction. |
| stock\_receipts | id: uuid PK; receiptKey: string UQ; actorUserId: uuid LREF; items: [{medicineId, quantity, batchRef}]; receivedAt: UTC | UQ(receiptKey); quantity > 0; ghi receipt và tăng onHand trong cùng transaction. PH-002 nhận một medicineId/quantity/batchRef và lưu thành một phần tử items[]; receiptKey chống nhập lặp. |
| prescription\_projection | id: uuid PK; prescriptionId: uuid LREF; revision: int; visitId: uuid LREF; linesSnapshot: object[]; sourceEventId: uuid; patientId: uuid LREF | UQ(prescriptionId, revision) nhận từ sự kiện PrescriptionFinalized. Nhà thuốc không bao giờ cấp phát từ toa DRAFT. patientId lấy từ PrescriptionFinalized để PH-004 kiểm quyền PATIENT owner với patient\_access\_projection. |
| medication\_holds | id: uuid PK; prescriptionId: uuid LREF; revision: int; attemptNo: int; status: enum (HELD|SETTLEMENT\_LOCKED|COMMITTED|RELEASED|EXPIRED); itemsSnapshot: object[]; expiresAt: UTC; chargeId: uuid LREF?; version: int; attemptHistory: object[]; patientId: uuid LREF; settlementId: uuid?; settlementState: enum; settlementVersion: int | UQ(prescriptionId, revision). Giữ đủ toàn toa (thiếu 1 dòng thì không giữ dòng nào). Khi giữ lại sau khi nhả/hết hạn sẽ tăng attemptNo (tương ứng sourceRevision bên Billing). Khi đang SETTLEMENT\_LOCKED tuyệt đối không tự nhả tồn do timeout. |
| dispenses | id: uuid PK; holdId: uuid ref UQ; prescriptionId: uuid LREF; revision: int; actorUserId: uuid LREF; itemsSnapshot: object[]; dispensedAt: UTC; attemptNo: int | UQ(holdId); UQ(prescriptionId, revision). Cùng transaction giảm onHand, giảm reserved, ghi dispenses và phát MedicationDispensed. |
| **Collection kỹ thuật** | settlement\_decisions, command\_results, catalog\_projection, patient\_access\_projection, user\_access\_projection, projection\_checkpoints, outbox, inbox, idempotency\_records, retry\_jobs, dead\_letters | Kiểm tra bằng chứng thanh toán từ settlement\_decisions cục bộ đúng fence và attemptNo trước khi chuyển COMMITTED và phát thuốc. |

## 8. Billing Service (billing\_db — PostgreSQL · Owner: Hưng · Django)

**Trách nhiệm:** Quản lý khoản phải thu (charges), điều phối Saga thanh toán và đối soát fence (settlement\_sagas), ghi nhận giao dịch thanh toán (payments), phát hành biên nhận bất biến (receipts) và xử lý hoàn tiền có căn cứ (refunds).

### Sơ đồ ERD — Billing Service

```dbml
Project billing_db {
  database_type: 'PostgreSQL'
}

Table charges {
  id uuid [pk]
  patient_id uuid [not null, note: 'LREF']
  source_type text [not null]
  source_id uuid [not null, note: 'LREF. Nguồn được chọn bởi source_type: APPOINTMENT, LAB_ORDER hoặc MED_HOLD.']
  source_revision int [not null]
  amount_vnd bigint [not null]
  state text [not null, note: 'Giá trị: OPEN, PAID, VOID.']
  price_snapshot jsonb [not null]
  version int [not null]
  snapshot_hash text [not null]
  settlement_id uuid [null]
  settlement_state text [not null]
  settlement_saga_id uuid [null, ref: > settlement_sagas.id]

  indexes {
    (source_type, source_id, source_revision) [unique]
  }

  checks {
    `amount_vnd >= 0`
  }
}

Table settlement_sagas {
  id uuid [pk]
  charge_id uuid [not null, ref: > charges.id]
  source_type text [not null]
  source_id uuid [not null, note: 'LREF đến nguồn được chọn bởi source_type.']
  source_revision int [not null]
  state text [not null, note: 'Giá trị: REQUESTED, RESERVED, IN_DOUBT, SUCCEEDED, FAILED.']
  fence int [null]
  amount_hash text [not null]
  decision_version int [not null]
  deadline_at timestamptz [not null]
  version int [not null]

  Note: 'Unique có điều kiện trên charge_id đối với REQUESTED, RESERVED và IN_DOUBT.'
}

Table payments {
  id uuid [pk]
  charge_id uuid [not null, ref: > charges.id]
  saga_id uuid [not null, unique, ref: - settlement_sagas.id]
  transaction_id text [not null, unique]
  amount_vnd bigint [not null]
  state text [not null, note: 'Giá trị: PENDING, SUCCEEDED, FAILED.']
  method text [not null]
  attempted_at timestamptz [not null]
  paid_at timestamptz [null]
  source_revision int [not null]
  settlement_id uuid [not null]
  idempotency_key text [not null]
  fence int [not null]

  Note: 'Unique có điều kiện trên charge_id khi state = SUCCEEDED.'
}

Table receipts {
  id uuid [pk]
  payment_id uuid [not null, unique, ref: - payments.id, note: 'Mỗi payment có tối đa một receipt. Chỉ tạo receipt khi payment SUCCEEDED.']
  charge_id uuid [not null, ref: > charges.id]
  receipt_no text [not null, unique]
  amount_vnd bigint [not null]
  issued_at timestamptz [not null]
}

Table refunds {
  id uuid [pk]
  charge_id uuid [not null, ref: > charges.id]
  cancellation_id uuid [not null, note: 'LREF']
  reason_code text [not null]
  amount_vnd bigint [not null]
  state text [not null, note: 'Giá trị: REQUESTED, SUCCEEDED, FAILED.']
  attempts jsonb [not null]
  version int [not null]
  updated_at timestamptz [not null]

  indexes {
    (charge_id, cancellation_id, reason_code) [unique]
  }
}
```

### Từ điển dữ liệu — Billing Service

| **Bảng (Table)** | **Thuộc tính & Kiểu dữ liệu** | **Khóa, Chỉ mục & Quy tắc bất biến (Invariants)** |
| --- | --- | --- |
| charges | id: uuid PK; patient\_id: uuid LREF; source\_type: text; source\_id: uuid LREF; source\_revision: int; amount\_vnd: bigint; state: text (OPEN|PAID|VOID); price\_snapshot: jsonb; version: int; snapshot\_hash: text; settlement\_id: uuid?; settlement\_state: text; settlement\_saga\_id: uuid FK? | UQ(source\_type, source\_id, source\_revision); CHECK amount\_vnd >= 0. Tạo duy nhất qua handler RequestCharge và trả ChargePrepared. Không tự sửa giá lịch sử khi Catalog đổi giá. |
| settlement\_sagas | id: uuid PK; charge\_id: uuid FK; source\_type: text; source\_id: uuid; source\_revision: int; state: text (REQUESTED|RESERVED|IN\_DOUBT|SUCCEEDED|FAILED); fence: int?; amount\_hash: text; decision\_version: int; deadline\_at: timestamptz; version: int | Partial UQ(charge\_id) với trạng thái chưa terminal (mỗi charge chỉ có tối đa 1 saga đang hoạt động). Quá 60s chưa có phản hồi chuyển IN\_DOUBT (không tự động chuyển FAILED chỉ vì timeout). |
| payments | id: uuid PK; charge\_id: uuid FK; saga\_id: uuid FK UQ; transaction\_id: text UQ; amount\_vnd: bigint; state: text (PENDING|SUCCEEDED|FAILED); method: text; attempted\_at: timestamptz; paid\_at: timestamptz?; source\_revision: int; settlement\_id: uuid; idempotency\_key: text; fence: int | FK charge\_id -> charges.id; FK saga\_id -> settlement\_sagas.id; UQ(transaction\_id); Partial UQ(charge\_id) WHERE state = 'SUCCEEDED'. Chỉ chuyển SUCCEEDED sau khi nhận SettlementReserved(ACCEPTED) kèm fence hợp lệ. |
| receipts | id: uuid PK; payment\_id: uuid FK UQ; charge\_id: uuid FK; receipt\_no: text UQ; amount\_vnd: bigint; issued\_at: timestamptz | FK payment\_id -> payments.id; FK charge\_id -> charges.id; UQ(payment\_id), UQ(receipt\_no). Ghi cùng SQL transaction với payment SUCCEEDED và outbox; bất biến sau khi cấp. |
| refunds | id: uuid PK; charge\_id: uuid FK; cancellation\_id: uuid LREF; reason\_code: text; amount\_vnd: bigint; state: text (REQUESTED|SUCCEEDED|FAILED); attempts: jsonb; version: int; updated\_at: timestamptz | FK charge\_id -> charges.id; UQ(charge\_id, cancellation\_id, reason\_code). Dùng SELECT FOR UPDATE trên charge khi thực thi hoàn để bảo đảm tổng tiền hoàn thành công ≤ số tiền đã thu. |
| **Bảng kỹ thuật** | command\_results, catalog\_projection, patient\_access\_projection, user\_access\_projection, projection\_checkpoints, outbox, inbox, idempotency\_records, retry\_jobs, dead\_letters | Phát ReserveSettlement (command) và các events ChargePrepared, ChargePaid, BillingStatusChanged, SettlementDecision. |

## 9. Notification Service (notification\_db — PostgreSQL · Owner: Hưng · Django)

**Trách nhiệm:** Hộp thư thông báo trong ứng dụng cho cả 3 actor (PATIENT, DOCTOR, STAFF), tiêu thụ sự kiện một lần qua inbox và tuyệt đối không lưu trữ dữ liệu bệnh án nhạy cảm.

### Sơ đồ ERD — Notification Service

```dbml
Project notification_db {
  database_type: 'PostgreSQL'
}

Table notifications {
  id uuid [pk]
  recipient_user_id uuid [not null, note: 'LREF']
  event_id uuid [not null]
  kind text [not null]
  subject_ref text [not null]
  message_code text [not null]
  created_at timestamptz [not null]
  read_at timestamptz [null]
  source_aggregate_id uuid [not null]
  source_version int [not null]

  indexes {
    (recipient_user_id, event_id, kind) [unique]
    (recipient_user_id, created_at [desc])
  }

  Note: 'Chỉ lưu mã thông báo và tham chiếu, ghi cùng transaction với inbox.'
}

Table inbox {
  message_id uuid [not null]
  consumer_name text [not null]
  command_id uuid [null]
  payload_hash text [not null]
  state text [not null, note: 'Giá trị: PROCESSED, RETRY_SCHEDULED.']
  outcome_ref text [null]
  processed_at timestamptz [not null]

  indexes {
    (message_id, consumer_name) [unique]
  }
}
```

### Từ điển dữ liệu — Notification Service

| **Bảng (Table)** | **Thuộc tính & Kiểu dữ liệu** | **Khóa, Chỉ mục & Quy tắc bất biến (Invariants)** |
| --- | --- | --- |
| notifications | id: uuid PK; recipient\_user\_id: uuid LREF; event\_id: uuid; kind: text; subject\_ref: text; message\_code: text; created\_at: timestamptz; read\_at: timestamptz?; source\_aggregate\_id: uuid; source\_version: int | UQ(recipient\_user\_id, event\_id, kind); INDEX(recipient\_user\_id, created\_at DESC). Ghi cùng SQL transaction với inbox; chỉ lưu mã thông điệp (message\_code) và ID tham chiếu, không sao chép chẩn đoán, kết quả xét nghiệm hay tên thuốc. |
| inbox | message\_id: uuid; consumer\_name: text; command\_id: uuid?; payload\_hash: text; state: text (PROCESSED|RETRY\_SCHEDULED); outcome\_ref: text?; processed\_at: timestamptz | UQ(message\_id, consumer\_name) chống xử lý lặp mọi bản tin từ AppointmentChanged, LabResultPublished, MedicationDispensed, BillingStatusChanged. |
| **Bảng kỹ thuật** | user\_access\_projection, idempotency\_records, retry\_jobs, dead\_letters | Không có bảng outbox nghiệp vụ vì Notification là consumer cuối. |

# PHẦN 2: TỔNG HỢP CÁC BẢNG KĨ THUẬT BẤT ĐỒNG BỘ (TECHNICAL TABLES & PROJECTIONS)

Để đảm bảo tính đúng đắn của kiến trúc hướng sự kiện (At-least-once delivery, Idempotent consumer, Transactional Outbox và Saga Fence), các bảng/collection kỹ thuật dưới đây được đặt trực tiếp trong DB của từng service sở hữu:

| **Thực thể kỹ thuật** | **Service sở hữu (Owner)** | **Khóa chính / Unique & Quy tắc vận hành cốt lõi** |
| --- | --- | --- |
| outbox | 8 Services (trừ Notification) | PK(message\_id). Ghi cùng local transaction với state nghiệp vụ. Publisher claim theo lease, dùng delivery\_mode=2, mandatory=true và publisher confirms; chỉ đánh dấu PUBLISHED khi được broker confirm và không bị return. Giữ tối thiểu ≥ 7 ngày trong demo. |
| inbox | Cả 9 Services | UQ(message\_id, consumer\_name). Ghi inbox + cập nhật state + ghi response outbox trong cùng transaction trước khi gửi basic.ack. Chống lặp cho cả trường hợp redelivered=false (publisher phát lại). |
| command\_results | Billing, Diagnostic, Appointment, Pharmacy | PK(command\_id). Lưu kết quả xử lý của 5 commands (RequestCharge, CreateLabOrder, ClaimQueueTicket, ReserveSettlement, QuerySettlement). Nếu trùng key nhưng khác request\_hash → trả conflict; nếu trùng hoàn toàn → phát lại response cũ. |
| retry\_jobs & dead\_letters | Cả 9 Services | UQ(message\_id, handler\_name). Lỗi tạm thời được lập lịch thử lại bền vững trong DB (3 lần: 5s, 15s, 60s + jitter) kèm trạng thái inbox = RETRY\_SCHEDULED trước khi ack message gốc. Quá 3 lần hoặc lỗi schema/producer → chuyển vào dead\_letters (DLQ). |
| idempotency\_records | Cả 9 Services (HTTP Write) | UQ(principal\_id, route, key). Lưu request\_hash và response\_ref tối thiểu ≥ 24h cho mọi lệnh POST/PUT/PATCH/DELETE có Idempotency-Key. |
| settlement\_sagas & settlement\_decisions | Billing (sagas) & Appt/Diag/Pharm (decisions) | Bảo vệ giao dịch thu tiền hai pha qua RabbitMQ. Nếu SettlementDecision(FAILED) đến trước ReserveSettlement, owner ghi ngay **tombstone FAILED** vào settlement\_decisions để chặn lệnh reserve đến muộn khóa lại nguồn. Trạng thái UNKNOWN không bao giờ tự mở khóa SETTLEMENT\_LOCKED. |
| user\_access\_projection & patient\_access\_projection | Các Consumer Services | Đồng bộ từ IdentityAccessChanged và PatientAccessChanged. Kiểm tra quyền cục bộ kết hợp với Authorization Lease (hạn tối đa 30s) mà không cần gọi HTTP chéo về Identity hay Patient. |
| catalog\_projection & projection\_checkpoints | Appt, Clin, Diag, Pharm, Bill | UQ(entity\_type, entity\_id) và UQ(producer, stream\_id). Theo dõi CHECKPOINT mỗi 10s từ Catalog; nếu phát hiện gap hoặc checkpoint trễ quá 30s thì chặn tạo báo giá mới bằng mã lỗi 503 PRICE\_PROJECTION\_STALE. |
