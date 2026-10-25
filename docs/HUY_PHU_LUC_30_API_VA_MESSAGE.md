# Phụ lục 30 API và message thuộc phần Huy

Bản tra cứu trích từ CSV API v5.2 trong repository ngày 25/10/2026. Dùng cùng [hướng dẫn task](HUY_HUONG_DAN_HOAN_THANH_TOAN_BO_TASK.md). Nội dung dưới phản ánh nguồn, không khẳng định API đã được code hoặc các mâu thuẫn đã giải quyết.

**Cách đọc:** tìm API ID, đối chiếu tham số ở đúng path/query/header/body; sau đó kiểm response thành công và lỗi. Với object lồng nhau, dùng schema đầy đủ đã chốt ở H02, không tự suy ra cấu trúc từ tên kiểu. Các chỗ chưa rõ được theo dõi ở H00.

**Quy ước chung:** data/meta.correlationId theo contract; Idempotency-Key ở các thao tác được yêu cầu; 202 kèm statusUrl và Location; operationId = API ID thay dấu gạch nối bằng dấu gạch dưới. Auth/lease/error chung phải đối chiếu hợp đồng Identity và OpenAPI.

**Điểm cần đặc biệt đối chiếu:** DI-001 tắt mặc định và thiếu mapping phục hồi chi tiết ở sheet tham số; DI-013 có câu mô tả STAFF không khớp cột quyền PATIENT/DOCTOR; DI-012 cần nguồn refundStatus; LAB FAILED/REJECTED cần quy tắc resubmit/giải quyết. Phụ lục giữ nguyên nguồn để nhìn thấy gap, không tự sửa nghĩa.

## Danh sách tra nhanh

| API | Method | Route | Task chính |
| --- | --- | --- | --- |
| CA-001 | GET | /api/v1/departments | H06 |
| CA-002 | GET | /api/v1/doctors | H06 |
| CA-003 | GET | /api/v1/medical-services | H06 |
| CA-004 | POST | /api/v1/prices | H06 |
| CA-005 | GET | /api/v1/catalog/medicines | H06 |
| CA-006 | GET | /api/v1/catalog/lab-tests | H06 |
| CL-001 | GET | /api/v1/clinical/worklist | H07 |
| CL-002 | POST | /api/v1/visits/start | H07/H12 |
| CL-003 | GET | /api/v1/visits/{visitId} | H07/H12 |
| CL-004 | PUT | /api/v1/visits/{visitId}/draft | H07 |
| CL-005 | POST | /api/v1/visits/{visitId}/lab-orders | H09 |
| CL-006 | POST | /api/v1/visits/{visitId}/prescriptions | H08 |
| CL-007 | PUT | /api/v1/prescriptions/{prescriptionId} | H08 |
| CL-008 | DELETE | /api/v1/prescriptions/{prescriptionId} | H08 |
| CL-009 | POST | /api/v1/prescriptions/{prescriptionId}/finalize | H08 |
| CL-010 | POST | /api/v1/visits/{visitId}/complete | H08/H12 |
| CL-011 | GET | /api/v1/patients/{patientId}/medical-records | H12 |
| DI-001 | POST | /api/v1/diagnostic-orders | H09 |
| DI-002 | GET | /api/v1/diagnostic-orders | H09 |
| DI-003 | GET | /api/v1/diagnostic-orders/{orderId} | H09 |
| DI-004 | POST | /api/v1/diagnostic-orders/{orderId}/specimens | H10 |
| DI-005 | POST | /api/v1/specimens/{specimenId}/reject | H10 |
| DI-006 | POST | /api/v1/diagnostic-orders/{orderId}/recollect | H10 |
| DI-007 | POST | /api/v1/diagnostic-orders/{orderId}/results | H11 |
| DI-008 | PUT | /api/v1/results/{resultId} | H11 |
| DI-009 | POST | /api/v1/results/{resultId}/submit-review | H11 |
| DI-010 | POST | /api/v1/results/{resultId}/return-rework | H11 |
| DI-011 | POST | /api/v1/results/{resultId}/publish | H11 |
| DI-012 | POST | /api/v1/diagnostic-orders/{orderId}/cancel | H10 |
| DI-013 | GET | /api/v1/patients/{patientId}/published-results | H12 |


## CA-001 GET /api/v1/departments

**Service:** Catalog. **Auth:** Public. **Quyền:** PATIENT (công khai).

**Gateway:** Có. **HTTP thành công:** 200.

Trả danh mục khoa đang hoạt động cho tìm kiếm bác sĩ, dịch vụ và đặt lịch.

**Response data theo nguồn:** items: Department[].

### Tham số

Không có tham số nghiệp vụ riêng được liệt kê ở sheet 02; vẫn áp dụng auth/header/quy ước chung.

### Phản hồi

| HTTP | Loại | Mã lỗi | Ý nghĩa | Schema hoặc data |
| --- | --- | --- | --- | --- |
| 200 | Thành công |  | Hoàn tất thao tác danh mục khoa. Kết quả nằm trong data; meta.correlationId dùng để truy vết yêu cầu. | items: Department[] |
| 503 | Lỗi | SERVICE_UNAVAILABLE | SERVICE_UNAVAILABLE: Dependency hoặc projection cần thiết chưa sẵn sàng; không xác nhận nghiệp vụ thành công. | ErrorResponse |

## CA-002 GET /api/v1/doctors

**Service:** Catalog. **Auth:** Public. **Quyền:** PATIENT (công khai).

**Gateway:** Có. **HTTP thành công:** 200.

Lọc bác sĩ theo khoa/tên để người bệnh chọn bác sĩ phù hợp trước khi xem slot.

**Response data theo nguồn:** items: Doctor[], total: integer:int32.

### Tham số

| Vị trí | Tên | Kiểu | Bắt buộc | Ràng buộc | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| query | departmentId | string:uuid | Không |  | ID khoa dùng lọc bác sĩ, dịch vụ hoặc tài khoản theo ngữ cảnh API. |
| query | page | integer | Không | minimum=1; default=1 | Số trang bắt đầu từ 1; bỏ qua dùng mặc định trong schema. |
| query | limit | integer | Không | minimum=1; maximum=100; default=20 | Số bản ghi tối đa mỗi trang; tuân theo giới hạn và mặc định trong schema. |

### Phản hồi

| HTTP | Loại | Mã lỗi | Ý nghĩa | Schema hoặc data |
| --- | --- | --- | --- | --- |
| 200 | Thành công |  | Hoàn tất thao tác bác sĩ theo khoa. Kết quả nằm trong data; meta.correlationId dùng để truy vết yêu cầu. | items: Doctor[], total: integer:int32 |
| 400 | Lỗi | VALIDATION_ERROR | VALIDATION_ERROR: Request sai kiểu, thiếu trường hoặc vi phạm ràng buộc đầu vào. | ErrorResponse |
| 503 | Lỗi | SERVICE_UNAVAILABLE | SERVICE_UNAVAILABLE: Dependency hoặc projection cần thiết chưa sẵn sàng; không xác nhận nghiệp vụ thành công. | ErrorResponse |

## CA-003 GET /api/v1/medical-services

**Service:** Catalog. **Auth:** Public. **Quyền:** PATIENT (công khai).

**Gateway:** Có. **HTTP thành công:** 200.

Trả dịch vụ khám cùng giá đang có hiệu lực và định danh/version giá để hiển thị trước khi đặt lịch.

**Response data theo nguồn:** items: MedicalService[].

### Tham số

| Vị trí | Tên | Kiểu | Bắt buộc | Ràng buộc | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| query | departmentId | string:uuid | Không |  | ID khoa dùng lọc bác sĩ, dịch vụ hoặc tài khoản theo ngữ cảnh API. |
| query | at | string:date-time | Không |  | Thời điểm cần tra cứu giá có hiệu lực; không tự dùng giá hiện tại cho lịch đã chốt. |

### Phản hồi

| HTTP | Loại | Mã lỗi | Ý nghĩa | Schema hoặc data |
| --- | --- | --- | --- | --- |
| 200 | Thành công |  | Hoàn tất thao tác dịch vụ khám và giá. Kết quả nằm trong data; meta.correlationId dùng để truy vết yêu cầu. | items: MedicalService[] |
| 400 | Lỗi | VALIDATION_ERROR | VALIDATION_ERROR: Request sai kiểu, thiếu trường hoặc vi phạm ràng buộc đầu vào. | ErrorResponse |
| 503 | Lỗi | SERVICE_UNAVAILABLE | SERVICE_UNAVAILABLE: Dependency hoặc projection cần thiết chưa sẵn sàng; không xác nhận nghiệp vụ thành công. | ErrorResponse |

## CA-004 POST /api/v1/prices

**Service:** Catalog. **Auth:** Bearer user. **Quyền:** STAFF[ADMIN].

**Gateway:** Có. **HTTP thành công:** 201.

ADMIN tạo phiên bản giá cho dịch vụ khám, xét nghiệm hoặc thuốc với khoảng hiệu lực không chồng lấn; giá lịch đã chốt giữ snapshot.

**Response data theo nguồn:** priceVersionId: string:uuid, revision: integer, effectiveFrom: string:date-time.

### Tham số

| Vị trí | Tên | Kiểu | Bắt buộc | Ràng buộc | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| header | Idempotency-Key | string:uuid | Có |  | UUID của một ý định ghi. Khi retry giữ nguyên key và payload; cùng key với payload khác phải trả 409. |
| body | itemType | string | Có | enum=['EXAM', 'LAB', 'MEDICINE'] | Loại mục danh mục được định giá hoặc tra cứu. |
| body | itemId | string:uuid | Có |  | ID mục danh mục thuộc itemType. |
| body | amountVnd | integer:int64 | Có | minimum=0 | Số tiền nguyên VND của giá, charge hoặc refund theo operation; không dùng số thực. |
| body | effectiveFrom | string:date-time | Có |  | Thời điểm bắt đầu hiệu lực của bản giá. |
| body | effectiveTo | string:date-time | Không |  | Thời điểm kết thúc hiệu lực của bản giá, nếu có. |

### Phản hồi

| HTTP | Loại | Mã lỗi | Ý nghĩa | Schema hoặc data |
| --- | --- | --- | --- | --- |
| 201 | Thành công |  | Hoàn tất thao tác tạo phiên bản giá tương lai cho khám/lab/thuốc. Kết quả nằm trong data; meta.correlationId dùng để truy vết yêu cầu. | priceVersionId: string:uuid, revision: integer, effectiveFrom: string:date-time |
| 400 | Lỗi | VALIDATION_ERROR | VALIDATION_ERROR: Request sai kiểu, thiếu trường hoặc vi phạm ràng buộc đầu vào. | ErrorResponse |
| 401 | Lỗi | UNAUTHENTICATED | UNAUTHENTICATED: Thiếu hoặc hết hạn thông tin xác thực. | ErrorResponse |
| 403 | Lỗi | FORBIDDEN | FORBIDDEN: Actor thiếu capability hoặc không có quyền trên tài nguyên. | ErrorResponse |
| 409 | Lỗi | OVERLAPPING_PRICE_PERIOD | OVERLAPPING_PRICE_PERIOD: Khoảng hiệu lực giá giao nhau với phiên bản hiện có. | ErrorResponse |
| 503 | Lỗi | SERVICE_UNAVAILABLE | SERVICE_UNAVAILABLE: Dependency hoặc projection cần thiết chưa sẵn sàng; không xác nhận nghiệp vụ thành công. | ErrorResponse |

## CA-005 GET /api/v1/catalog/medicines

**Service:** Catalog. **Auth:** Bearer user. **Quyền:** DOCTOR/STAFF[PHARMACY]/STAFF[ADMIN].

**Gateway:** Có. **HTTP thành công:** 200.

Trả thuốc khả dụng từ Catalog cho màn kê toa; mã và tên danh mục không thay thế snapshot đã lưu trong toa FINAL.

**Response data theo nguồn:** data: MedicineCatalogItem[].

### Tham số

| Vị trí | Tên | Kiểu | Bắt buộc | Ràng buộc | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| query | q | string | Không |  | Từ khóa tìm kiếm tự do theo phạm vi API. |
| query | status | string | Không |  | Trạng thái dùng lọc danh sách theo API. |

### Phản hồi

| HTTP | Loại | Mã lỗi | Ý nghĩa | Schema hoặc data |
| --- | --- | --- | --- | --- |
| 200 | Thành công |  | Hoàn tất thao tác danh mục thuốc để kê toa. Kết quả nằm trong data; meta.correlationId dùng để truy vết yêu cầu. | data: MedicineCatalogItem[] |
| 400 | Lỗi | VALIDATION_ERROR | VALIDATION_ERROR: Request sai kiểu, thiếu trường hoặc vi phạm ràng buộc đầu vào. | ErrorResponse |
| 401 | Lỗi | UNAUTHENTICATED | UNAUTHENTICATED: Thiếu hoặc hết hạn thông tin xác thực. | ErrorResponse |
| 403 | Lỗi | FORBIDDEN | FORBIDDEN: Actor thiếu capability hoặc không có quyền trên tài nguyên. | ErrorResponse |
| 503 | Lỗi | SERVICE_UNAVAILABLE | SERVICE_UNAVAILABLE: Dependency hoặc projection cần thiết chưa sẵn sàng; không xác nhận nghiệp vụ thành công. | ErrorResponse |

## CA-006 GET /api/v1/catalog/lab-tests

**Service:** Catalog. **Auth:** Bearer user. **Quyền:** DOCTOR/STAFF[LAB_TECH]/STAFF[LAB_REVIEW]/STAFF[ADMIN].

**Gateway:** Có. **HTTP thành công:** 200.

Trả xét nghiệm có thể chỉ định cùng revision, đơn vị/khoảng tham chiếu và giá phiên bản để Clinical chụp snapshot.

**Response data theo nguồn:** data: LabTestCatalogItem[].

### Tham số

| Vị trí | Tên | Kiểu | Bắt buộc | Ràng buộc | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| query | q | string | Không |  | Từ khóa tìm kiếm tự do theo phạm vi API. |
| query | status | string | Không |  | Trạng thái dùng lọc danh sách theo API. |

### Phản hồi

| HTTP | Loại | Mã lỗi | Ý nghĩa | Schema hoặc data |
| --- | --- | --- | --- | --- |
| 200 | Thành công |  | Hoàn tất thao tác danh mục test, đơn vị, khoảng tham chiếu, giá version. Kết quả nằm trong data; meta.correlationId dùng để truy vết yêu cầu. | data: LabTestCatalogItem[] |
| 400 | Lỗi | VALIDATION_ERROR | VALIDATION_ERROR: Request sai kiểu, thiếu trường hoặc vi phạm ràng buộc đầu vào. | ErrorResponse |
| 401 | Lỗi | UNAUTHENTICATED | UNAUTHENTICATED: Thiếu hoặc hết hạn thông tin xác thực. | ErrorResponse |
| 403 | Lỗi | FORBIDDEN | FORBIDDEN: Actor thiếu capability hoặc không có quyền trên tài nguyên. | ErrorResponse |
| 503 | Lỗi | SERVICE_UNAVAILABLE | SERVICE_UNAVAILABLE: Dependency hoặc projection cần thiết chưa sẵn sàng; không xác nhận nghiệp vụ thành công. | ErrorResponse |

## CL-001 GET /api/v1/clinical/worklist

**Service:** Clinical. **Auth:** Bearer user. **Quyền:** DOCTOR.

**Gateway:** Có. **HTTP thành công:** 200.

Khi có operationId, trả startRequest kể cả lúc chưa có Visit; chỉ đọc request thuộc bác sĩ đăng nhập.

**Response data theo nguồn:** items: Visit[], total: integer:int32, startRequest: StartRequestStatus.

### Tham số

| Vị trí | Tên | Kiểu | Bắt buộc | Ràng buộc | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| query | date | string:date | Không |  | Ngày cần xem ca hoặc slot trống theo định dạng date. |
| query | state | string | Không |  | Trạng thái dùng lọc danh sách; giá trị phải thuộc state machine của tài nguyên. |
| query | page | integer | Không | minimum=1; default=1 | Số trang bắt đầu từ 1; bỏ qua dùng mặc định trong schema. |
| query | limit | integer | Không | minimum=1; maximum=100; default=20 | Số bản ghi tối đa mỗi trang; tuân theo giới hạn và mặc định trong schema. |
| query | operationId | string:uuid | Không |  | ID start_requests do CL-002 trả; dùng đọc tiến độ startRequest trong CL-001. |

### Phản hồi

| HTTP | Loại | Mã lỗi | Ý nghĩa | Schema hoặc data |
| --- | --- | --- | --- | --- |
| 200 | Thành công |  | Hoàn tất thao tác danh sách lượt bác sĩ. Kết quả nằm trong data; meta.correlationId dùng để truy vết yêu cầu. | items: Visit[], total: integer:int32, startRequest: StartRequestStatus |
| 400 | Lỗi | VALIDATION_ERROR | VALIDATION_ERROR: Request sai kiểu, thiếu trường hoặc vi phạm ràng buộc đầu vào. | ErrorResponse |
| 401 | Lỗi | UNAUTHENTICATED | UNAUTHENTICATED: Thiếu hoặc hết hạn thông tin xác thực. | ErrorResponse |
| 403 | Lỗi | FORBIDDEN | FORBIDDEN: Actor thiếu capability hoặc không có quyền trên tài nguyên. | ErrorResponse |
| 503 | Lỗi | SERVICE_UNAVAILABLE | SERVICE_UNAVAILABLE: Dependency hoặc projection cần thiết chưa sẵn sàng; không xác nhận nghiệp vụ thành công. | ErrorResponse |
| 404 | Lỗi | START_REQUEST_NOT_FOUND | START_REQUEST_NOT_FOUND: Không thấy operationId start visit thuộc quyền người gọi. | ErrorResponse |

## CL-002 POST /api/v1/visits/start

**Service:** Clinical. **Auth:** Bearer user. **Quyền:** DOCTOR.

**Gateway:** Có. **HTTP thành công:** 202.

Clinical ghi start_requests PENDING + ClaimQueueTicket; 202 chưa có Visit. Poll CL-001 bằng operationId tới ACCEPTED hoặc REJECTED.

**Response data theo nguồn:** requestId: string:uuid, operationId: string:uuid, state: string, statusUrl: string:uri-reference.

**statusUrl:** `/api/v1/clinical/worklist?operationId={operationId}`.

### Tham số

| Vị trí | Tên | Kiểu | Bắt buộc | Ràng buộc | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| header | Idempotency-Key | string:uuid | Có |  | UUID của một ý định ghi. Khi retry giữ nguyên key và payload; cùng key với payload khác phải trả 409. |
| body | ticketId | string:uuid | Có |  | ID vé hàng chờ cần gọi hoặc claim cho lượt khám. |
| body | doctorId | string:uuid | Có |  | ID bác sĩ gắn với lịch, hàng chờ hoặc yêu cầu LAB. |
| body | expectedTicketVersion | integer | Có |  | Phiên bản vé client đã đọc; Appointment từ chối claim nếu đã đổi. |

### Phản hồi

| HTTP | Loại | Mã lỗi | Ý nghĩa | Schema hoặc data |
| --- | --- | --- | --- | --- |
| 202 | Thành công |  | Đã nhận lệnh và commit local/outbox; kết quả liên service còn chờ. Client đọc Location hoặc data.statusUrl để theo dõi. | requestId: string:uuid, operationId: string:uuid, state: string, statusUrl: string:uri-reference |
| 400 | Lỗi | VALIDATION_ERROR | VALIDATION_ERROR: Request sai kiểu, thiếu trường hoặc vi phạm ràng buộc đầu vào. | ErrorResponse |
| 401 | Lỗi | UNAUTHENTICATED | UNAUTHENTICATED: Thiếu hoặc hết hạn thông tin xác thực. | ErrorResponse |
| 403 | Lỗi | FORBIDDEN | FORBIDDEN: Actor thiếu capability hoặc không có quyền trên tài nguyên. | ErrorResponse |
| 404 | Lỗi | NOT_FOUND | NOT_FOUND: Tài nguyên không tồn tại hoặc không được phép thấy. | ErrorResponse |
| 409 | Lỗi | TICKET_VERSION_CONFLICT, TICKET_ALREADY_CLAIMED | TICKET_VERSION_CONFLICT: Phiên bản vé không còn khớp.; TICKET_ALREADY_CLAIMED: Vé đã được claim bởi lượt khám khác. | ErrorResponse |
| 503 | Lỗi | SERVICE_UNAVAILABLE | SERVICE_UNAVAILABLE: Dependency hoặc projection cần thiết chưa sẵn sàng; không xác nhận nghiệp vụ thành công. | ErrorResponse |

## CL-003 GET /api/v1/visits/{visitId}

**Service:** Clinical. **Auth:** Bearer user. **Quyền:** DOCTOR/PATIENT.

**Gateway:** Có. **HTTP thành công:** 200.

Trả Visit cùng labRequests registry; request còn PENDING hoặc REJECTED vẫn hiển thị để chặn ký/giải thích lỗi.

**Response data theo nguồn:** visit: Visit, notes: VisitNote[], prescriptions: Prescription[], labRequests: LabRequestStatus[].

### Tham số

| Vị trí | Tên | Kiểu | Bắt buộc | Ràng buộc | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| path | visitId | string:uuid | Có |  | ID lượt khám; Clinical kiểm quyền bác sĩ hoặc bệnh nhân trước khi trả dữ liệu. |

### Phản hồi

| HTTP | Loại | Mã lỗi | Ý nghĩa | Schema hoặc data |
| --- | --- | --- | --- | --- |
| 200 | Thành công |  | Hoàn tất thao tác chi tiết visit. Kết quả nằm trong data; meta.correlationId dùng để truy vết yêu cầu. | visit: Visit, notes: VisitNote[], prescriptions: Prescription[], labRequests: LabRequestStatus[] |
| 400 | Lỗi | VALIDATION_ERROR | VALIDATION_ERROR: Request sai kiểu, thiếu trường hoặc vi phạm ràng buộc đầu vào. | ErrorResponse |
| 401 | Lỗi | UNAUTHENTICATED | UNAUTHENTICATED: Thiếu hoặc hết hạn thông tin xác thực. | ErrorResponse |
| 403 | Lỗi | FORBIDDEN | FORBIDDEN: Actor thiếu capability hoặc không có quyền trên tài nguyên. | ErrorResponse |
| 404 | Lỗi | NOT_FOUND | NOT_FOUND: Tài nguyên không tồn tại hoặc không được phép thấy. | ErrorResponse |
| 503 | Lỗi | SERVICE_UNAVAILABLE | SERVICE_UNAVAILABLE: Dependency hoặc projection cần thiết chưa sẵn sàng; không xác nhận nghiệp vụ thành công. | ErrorResponse |

## CL-004 PUT /api/v1/visits/{visitId}/draft

**Service:** Clinical. **Auth:** Bearer user. **Quyền:** DOCTOR.

**Gateway:** Có. **HTTP thành công:** 200.

Bác sĩ lưu toàn bộ bốn trường nháp của visit bằng PUT theo expectedVersion; không sửa visit đã ký.

**Response data theo nguồn:** visitId: string:uuid, version: integer:int32, state: string.

### Tham số

| Vị trí | Tên | Kiểu | Bắt buộc | Ràng buộc | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| path | visitId | string:uuid | Có |  | ID lượt khám; Clinical kiểm quyền bác sĩ hoặc bệnh nhân trước khi trả dữ liệu. |
| header | Idempotency-Key | string:uuid | Có |  | UUID của một ý định ghi. Khi retry giữ nguyên key và payload; cùng key với payload khác phải trả 409. |
| body | symptoms | string | Có |  | Triệu chứng trong bản nháp bệnh án; PUT gửi cả bốn trường draft, có thể là chuỗi rỗng. |
| body | findings | string | Có |  | Dấu hiệu khám trong bản nháp bệnh án; có thể là chuỗi rỗng. |
| body | assessment | string | Có |  | Đánh giá lâm sàng trong bản nháp bệnh án; có thể là chuỗi rỗng. |
| body | diagnosis | string | Có |  | Chẩn đoán trong bản nháp bệnh án; có thể là chuỗi rỗng. |
| body | expectedVersion | integer:int32 | Có |  | Phiên bản tài nguyên client đã đọc để kiểm tra ghi cạnh tranh; lệch phiên bản trả 409. |

### Phản hồi

| HTTP | Loại | Mã lỗi | Ý nghĩa | Schema hoặc data |
| --- | --- | --- | --- | --- |
| 200 | Thành công |  | Hoàn tất thao tác lưu nháp triệu chứng, khám, nhận định và chẩn đoán. Kết quả nằm trong data; meta.correlationId dùng để truy vết yêu cầu. | visitId: string:uuid, version: integer:int32, state: string |
| 400 | Lỗi | VALIDATION_ERROR | VALIDATION_ERROR: Request sai kiểu, thiếu trường hoặc vi phạm ràng buộc đầu vào. | ErrorResponse |
| 401 | Lỗi | UNAUTHENTICATED | UNAUTHENTICATED: Thiếu hoặc hết hạn thông tin xác thực. | ErrorResponse |
| 403 | Lỗi | FORBIDDEN | FORBIDDEN: Actor thiếu capability hoặc không có quyền trên tài nguyên. | ErrorResponse |
| 404 | Lỗi | NOT_FOUND | NOT_FOUND: Tài nguyên không tồn tại hoặc không được phép thấy. | ErrorResponse |
| 409 | Lỗi | VISIT_VERSION_CONFLICT, VISIT_ALREADY_SIGNED | VISIT_VERSION_CONFLICT: Lượt khám đã đổi kể từ phiên bản client đọc.; VISIT_ALREADY_SIGNED: Lượt khám đã được ký; không sửa bản nháp. | ErrorResponse |
| 503 | Lỗi | SERVICE_UNAVAILABLE | SERVICE_UNAVAILABLE: Dependency hoặc projection cần thiết chưa sẵn sàng; không xác nhận nghiệp vụ thành công. | ErrorResponse |

## CL-005 POST /api/v1/visits/{visitId}/lab-orders

**Service:** Clinical. **Auth:** Bearer user. **Quyền:** DOCTOR.

**Gateway:** Có. **HTTP thành công:** 202.

Ghi lab_requests PENDING và CreateLabOrder trong cùng transaction; 202 chưa có LabOrder. Poll CL-003 theo requestId.

**Response data theo nguồn:** requestId: string:uuid, state: string, statusUrl: string:uri-reference.

**statusUrl:** `/api/v1/visits/{visitId}`.

### Tham số

| Vị trí | Tên | Kiểu | Bắt buộc | Ràng buộc | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| path | visitId | string:uuid | Có |  | ID lượt khám; Clinical kiểm quyền bác sĩ hoặc bệnh nhân trước khi trả dữ liệu. |
| header | Idempotency-Key | string:uuid | Có |  | UUID của một ý định ghi. Khi retry giữ nguyên key và payload; cùng key với payload khác phải trả 409. |
| body | tests | object[] | Có | minItems=1 | Danh sách xét nghiệm được chỉ định; mỗi dòng gồm testId và revision, ít nhất một dòng. |
| body | tests[].testId | string:uuid | Có |  | Trong mỗi phần tử: ID xét nghiệm trong Catalog đã được chọn cho chỉ định. |
| body | tests[].revision | integer | Có |  | Trong mỗi phần tử: Phiên bản định nghĩa xét nghiệm đã chọn; Clinical đối chiếu với Catalog projection trước khi chỉ định. |

### Phản hồi

| HTTP | Loại | Mã lỗi | Ý nghĩa | Schema hoặc data |
| --- | --- | --- | --- | --- |
| 202 | Thành công |  | Đã nhận lệnh và commit local/outbox; kết quả liên service còn chờ. Client đọc Location hoặc data.statusUrl để theo dõi. | requestId: string:uuid, state: string, statusUrl: string:uri-reference |
| 400 | Lỗi | VALIDATION_ERROR | VALIDATION_ERROR: Request sai kiểu, thiếu trường hoặc vi phạm ràng buộc đầu vào. | ErrorResponse |
| 401 | Lỗi | UNAUTHENTICATED | UNAUTHENTICATED: Thiếu hoặc hết hạn thông tin xác thực. | ErrorResponse |
| 403 | Lỗi | FORBIDDEN | FORBIDDEN: Actor thiếu capability hoặc không có quyền trên tài nguyên. | ErrorResponse |
| 404 | Lỗi | NOT_FOUND | NOT_FOUND: Tài nguyên không tồn tại hoặc không được phép thấy. | ErrorResponse |
| 409 | Lỗi | VISIT_NOT_ACTIVE, LAB_REQUEST_DUPLICATE | VISIT_NOT_ACTIVE: Lượt khám chưa hoặc không còn cho phép chỉ định LAB.; LAB_REQUEST_DUPLICATE: Yêu cầu LAB trùng khóa/requestHash của lượt khám. | ErrorResponse |
| 503 | Lỗi | SERVICE_UNAVAILABLE | SERVICE_UNAVAILABLE: Dependency hoặc projection cần thiết chưa sẵn sàng; không xác nhận nghiệp vụ thành công. | ErrorResponse |

## CL-006 POST /api/v1/visits/{visitId}/prescriptions

**Service:** Clinical. **Auth:** Bearer user. **Quyền:** DOCTOR.

**Gateway:** Có. **HTTP thành công:** 201.

Bác sĩ tạo toa DRAFT gắn visit đang khám, gồm các dòng thuốc và hướng dẫn; chưa phát sự kiện cấp thuốc.

**Response data theo nguồn:** prescription: Prescription.

### Tham số

| Vị trí | Tên | Kiểu | Bắt buộc | Ràng buộc | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| path | visitId | string:uuid | Có |  | ID lượt khám; Clinical kiểm quyền bác sĩ hoặc bệnh nhân trước khi trả dữ liệu. |
| header | Idempotency-Key | string:uuid | Có |  | UUID của một ý định ghi. Khi retry giữ nguyên key và payload; cùng key với payload khác phải trả 409. |
| body | lines | PrescriptionLine[] | Có |  | Các dòng thuốc của toa; mỗi dòng tuân theo PrescriptionLine và bản FINAL không được sửa đè. |
| body | lines[].medicineCode | string | Có |  | Trong mỗi phần tử: Mã thuốc tại thời điểm chốt dòng toa. |
| body | lines[].nameSnapshot | string | Không |  | Trong mỗi phần tử: Tên thuốc chụp tại thời điểm lập toa, không sửa theo danh mục về sau. |
| body | lines[].doseText | string | Có |  | Trong mỗi phần tử: Liều dùng bác sĩ ghi cho dòng thuốc. |
| body | lines[].quantity | integer:int32 | Có |  | Trong mỗi phần tử: Số đơn vị thuốc bác sĩ kê trong dòng toa; phải là số nguyên dương. |
| body | lines[].instruction | string | Không |  | Trong mỗi phần tử: Hướng dẫn dùng thuốc của dòng toa. |

### Phản hồi

| HTTP | Loại | Mã lỗi | Ý nghĩa | Schema hoặc data |
| --- | --- | --- | --- | --- |
| 201 | Thành công |  | Hoàn tất thao tác tạo toa draft. Kết quả nằm trong data; meta.correlationId dùng để truy vết yêu cầu. | prescription: Prescription |
| 400 | Lỗi | VALIDATION_ERROR | VALIDATION_ERROR: Request sai kiểu, thiếu trường hoặc vi phạm ràng buộc đầu vào. | ErrorResponse |
| 401 | Lỗi | UNAUTHENTICATED | UNAUTHENTICATED: Thiếu hoặc hết hạn thông tin xác thực. | ErrorResponse |
| 403 | Lỗi | FORBIDDEN | FORBIDDEN: Actor thiếu capability hoặc không có quyền trên tài nguyên. | ErrorResponse |
| 404 | Lỗi | NOT_FOUND | NOT_FOUND: Tài nguyên không tồn tại hoặc không được phép thấy. | ErrorResponse |
| 409 | Lỗi | STATE_CONFLICT | STATE_CONFLICT: Trạng thái hiện tại không cho phép thao tác này. | ErrorResponse |
| 503 | Lỗi | SERVICE_UNAVAILABLE | SERVICE_UNAVAILABLE: Dependency hoặc projection cần thiết chưa sẵn sàng; không xác nhận nghiệp vụ thành công. | ErrorResponse |

## CL-007 PUT /api/v1/prescriptions/{prescriptionId}

**Service:** Clinical. **Auth:** Bearer user. **Quyền:** DOCTOR.

**Gateway:** Có. **HTTP thành công:** 200.

Bác sĩ thay toàn bộ dòng toa DRAFT theo revision đã đọc; toa FINAL là bất biến.

**Response data theo nguồn:** prescription: Prescription.

### Tham số

| Vị trí | Tên | Kiểu | Bắt buộc | Ràng buộc | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| path | prescriptionId | string:uuid | Có |  | ID toa thuốc cần xem, sửa hoặc giữ toàn bộ thuốc. |
| header | Idempotency-Key | string:uuid | Có |  | UUID của một ý định ghi. Khi retry giữ nguyên key và payload; cùng key với payload khác phải trả 409. |
| body | lines | PrescriptionLine[] | Có |  | Các dòng thuốc của toa; mỗi dòng tuân theo PrescriptionLine và bản FINAL không được sửa đè. |
| body | lines[].medicineCode | string | Có |  | Trong mỗi phần tử: Mã thuốc tại thời điểm chốt dòng toa. |
| body | lines[].nameSnapshot | string | Không |  | Trong mỗi phần tử: Tên thuốc chụp tại thời điểm lập toa, không sửa theo danh mục về sau. |
| body | lines[].doseText | string | Có |  | Trong mỗi phần tử: Liều dùng bác sĩ ghi cho dòng thuốc. |
| body | lines[].quantity | integer:int32 | Có |  | Trong mỗi phần tử: Số đơn vị thuốc bác sĩ kê trong dòng toa; phải là số nguyên dương. |
| body | lines[].instruction | string | Không |  | Trong mỗi phần tử: Hướng dẫn dùng thuốc của dòng toa. |
| body | expectedVersion | integer:int32 | Có |  | Phiên bản tài nguyên client đã đọc để kiểm tra ghi cạnh tranh; lệch phiên bản trả 409. |

### Phản hồi

| HTTP | Loại | Mã lỗi | Ý nghĩa | Schema hoặc data |
| --- | --- | --- | --- | --- |
| 200 | Thành công |  | Hoàn tất thao tác sửa toa draft. Kết quả nằm trong data; meta.correlationId dùng để truy vết yêu cầu. | prescription: Prescription |
| 400 | Lỗi | VALIDATION_ERROR | VALIDATION_ERROR: Request sai kiểu, thiếu trường hoặc vi phạm ràng buộc đầu vào. | ErrorResponse |
| 401 | Lỗi | UNAUTHENTICATED | UNAUTHENTICATED: Thiếu hoặc hết hạn thông tin xác thực. | ErrorResponse |
| 403 | Lỗi | FORBIDDEN | FORBIDDEN: Actor thiếu capability hoặc không có quyền trên tài nguyên. | ErrorResponse |
| 404 | Lỗi | NOT_FOUND | NOT_FOUND: Tài nguyên không tồn tại hoặc không được phép thấy. | ErrorResponse |
| 409 | Lỗi | STATE_CONFLICT | STATE_CONFLICT: Trạng thái hiện tại không cho phép thao tác này. | ErrorResponse |
| 503 | Lỗi | SERVICE_UNAVAILABLE | SERVICE_UNAVAILABLE: Dependency hoặc projection cần thiết chưa sẵn sàng; không xác nhận nghiệp vụ thành công. | ErrorResponse |

## CL-008 DELETE /api/v1/prescriptions/{prescriptionId}

**Service:** Clinical. **Auth:** Bearer user. **Quyền:** DOCTOR.

**Gateway:** Có. **HTTP thành công:** 200.

Bác sĩ xóa toa còn DRAFT; không xóa toa đã FINAL hoặc đã được Pharmacy sử dụng.

**Response data theo nguồn:** prescriptionId: string:uuid, state: string.

### Tham số

| Vị trí | Tên | Kiểu | Bắt buộc | Ràng buộc | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| path | prescriptionId | string:uuid | Có |  | ID toa thuốc cần xem, sửa hoặc giữ toàn bộ thuốc. |
| query | expectedVersion | integer:int32 | Có |  | Phiên bản tài nguyên client đã đọc để kiểm tra ghi cạnh tranh; lệch phiên bản trả 409. |
| header | Idempotency-Key | string:uuid | Có |  | UUID của một ý định ghi. Khi retry giữ nguyên key và payload; cùng key với payload khác phải trả 409. |

### Phản hồi

| HTTP | Loại | Mã lỗi | Ý nghĩa | Schema hoặc data |
| --- | --- | --- | --- | --- |
| 200 | Thành công |  | Hoàn tất thao tác xóa toa draft. Kết quả nằm trong data; meta.correlationId dùng để truy vết yêu cầu. | prescriptionId: string:uuid, state: string |
| 400 | Lỗi | VALIDATION_ERROR | VALIDATION_ERROR: Request sai kiểu, thiếu trường hoặc vi phạm ràng buộc đầu vào. | ErrorResponse |
| 401 | Lỗi | UNAUTHENTICATED | UNAUTHENTICATED: Thiếu hoặc hết hạn thông tin xác thực. | ErrorResponse |
| 403 | Lỗi | FORBIDDEN | FORBIDDEN: Actor thiếu capability hoặc không có quyền trên tài nguyên. | ErrorResponse |
| 404 | Lỗi | NOT_FOUND | NOT_FOUND: Tài nguyên không tồn tại hoặc không được phép thấy. | ErrorResponse |
| 409 | Lỗi | STATE_CONFLICT | STATE_CONFLICT: Trạng thái hiện tại không cho phép thao tác này. | ErrorResponse |
| 503 | Lỗi | SERVICE_UNAVAILABLE | SERVICE_UNAVAILABLE: Dependency hoặc projection cần thiết chưa sẵn sàng; không xác nhận nghiệp vụ thành công. | ErrorResponse |

## CL-009 POST /api/v1/prescriptions/{prescriptionId}/finalize

**Service:** Clinical. **Auth:** Bearer user. **Quyền:** DOCTOR.

**Gateway:** Có. **HTTP thành công:** 200.

Chốt toa DRAFT thành FINAL bất biến, ghi snapshot thuốc và phát PrescriptionFinalized qua outbox.

**Response data theo nguồn:** prescription: Prescription.

### Tham số

| Vị trí | Tên | Kiểu | Bắt buộc | Ràng buộc | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| path | prescriptionId | string:uuid | Có |  | ID toa thuốc cần xem, sửa hoặc giữ toàn bộ thuốc. |
| header | Idempotency-Key | string:uuid | Có |  | UUID của một ý định ghi. Khi retry giữ nguyên key và payload; cùng key với payload khác phải trả 409. |
| body | expectedVersion | integer:int32 | Có |  | Phiên bản tài nguyên client đã đọc để kiểm tra ghi cạnh tranh; lệch phiên bản trả 409. |

### Phản hồi

| HTTP | Loại | Mã lỗi | Ý nghĩa | Schema hoặc data |
| --- | --- | --- | --- | --- |
| 200 | Thành công |  | Hoàn tất thao tác ký toa final. Kết quả nằm trong data; meta.correlationId dùng để truy vết yêu cầu. | prescription: Prescription |
| 400 | Lỗi | VALIDATION_ERROR | VALIDATION_ERROR: Request sai kiểu, thiếu trường hoặc vi phạm ràng buộc đầu vào. | ErrorResponse |
| 401 | Lỗi | UNAUTHENTICATED | UNAUTHENTICATED: Thiếu hoặc hết hạn thông tin xác thực. | ErrorResponse |
| 403 | Lỗi | FORBIDDEN | FORBIDDEN: Actor thiếu capability hoặc không có quyền trên tài nguyên. | ErrorResponse |
| 404 | Lỗi | NOT_FOUND | NOT_FOUND: Tài nguyên không tồn tại hoặc không được phép thấy. | ErrorResponse |
| 409 | Lỗi | PRESCRIPTION_NOT_DRAFT, PRICE_VERSION_CONFLICT | PRESCRIPTION_NOT_DRAFT: Toa không ở trạng thái DRAFT để sửa/chốt.; PRICE_VERSION_CONFLICT: Bản giá/toa client sử dụng không còn hiệu lực. | ErrorResponse |
| 503 | Lỗi | SERVICE_UNAVAILABLE | SERVICE_UNAVAILABLE: Dependency hoặc projection cần thiết chưa sẵn sàng; không xác nhận nghiệp vụ thành công. | ErrorResponse |

## CL-010 POST /api/v1/visits/{visitId}/complete

**Service:** Clinical. **Auth:** Bearer user. **Quyền:** DOCTOR.

**Gateway:** Có. **HTTP thành công:** 200.

Bác sĩ ký kết luận và kết thúc visit khi không còn yêu cầu LAB chờ và dữ liệu bắt buộc đã đủ.

**Response data theo nguồn:** visit: Visit.

### Tham số

| Vị trí | Tên | Kiểu | Bắt buộc | Ràng buộc | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| path | visitId | string:uuid | Có |  | ID lượt khám; Clinical kiểm quyền bác sĩ hoặc bệnh nhân trước khi trả dữ liệu. |
| header | Idempotency-Key | string:uuid | Có |  | UUID của một ý định ghi. Khi retry giữ nguyên key và payload; cùng key với payload khác phải trả 409. |
| body | expectedVersion | integer:int32 | Có |  | Phiên bản tài nguyên client đã đọc để kiểm tra ghi cạnh tranh; lệch phiên bản trả 409. |

### Phản hồi

| HTTP | Loại | Mã lỗi | Ý nghĩa | Schema hoặc data |
| --- | --- | --- | --- | --- |
| 200 | Thành công |  | Hoàn tất thao tác ký kết luận và kết thúc. Kết quả nằm trong data; meta.correlationId dùng để truy vết yêu cầu. | visit: Visit |
| 400 | Lỗi | VALIDATION_ERROR | VALIDATION_ERROR: Request sai kiểu, thiếu trường hoặc vi phạm ràng buộc đầu vào. | ErrorResponse |
| 401 | Lỗi | UNAUTHENTICATED | UNAUTHENTICATED: Thiếu hoặc hết hạn thông tin xác thực. | ErrorResponse |
| 403 | Lỗi | FORBIDDEN | FORBIDDEN: Actor thiếu capability hoặc không có quyền trên tài nguyên. | ErrorResponse |
| 404 | Lỗi | NOT_FOUND | NOT_FOUND: Tài nguyên không tồn tại hoặc không được phép thấy. | ErrorResponse |
| 409 | Lỗi | VISIT_NOT_READY, LAB_RESULT_PENDING | VISIT_NOT_READY: Lượt khám chưa đủ điều kiện ký hoàn tất.; LAB_RESULT_PENDING: Còn yêu cầu/order LAB chưa có kết quả kết thúc. | ErrorResponse |
| 503 | Lỗi | SERVICE_UNAVAILABLE | SERVICE_UNAVAILABLE: Dependency hoặc projection cần thiết chưa sẵn sàng; không xác nhận nghiệp vụ thành công. | ErrorResponse |

## CL-011 GET /api/v1/patients/{patientId}/medical-records

**Service:** Clinical. **Auth:** Bearer user. **Quyền:** PATIENT/DOCTOR.

**Gateway:** Có. **HTTP thành công:** 200.

Trả các bản khám đã ký của bệnh nhân theo quyền, gồm chẩn đoán và tham chiếu toa/kết quả đã công bố.

**Response data theo nguồn:** items: Visit[], total: integer:int32.

### Tham số

| Vị trí | Tên | Kiểu | Bắt buộc | Ràng buộc | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| path | patientId | string:uuid | Có |  | ID hồ sơ bệnh nhân; server kiểm quyền chủ sở hữu hoặc capability tương ứng. |
| query | page | integer | Không | minimum=1; default=1 | Số trang bắt đầu từ 1; bỏ qua dùng mặc định trong schema. |
| query | limit | integer | Không | minimum=1; maximum=100; default=20 | Số bản ghi tối đa mỗi trang; tuân theo giới hạn và mặc định trong schema. |

### Phản hồi

| HTTP | Loại | Mã lỗi | Ý nghĩa | Schema hoặc data |
| --- | --- | --- | --- | --- |
| 200 | Thành công |  | Hoàn tất thao tác bản khám đã ký. Kết quả nằm trong data; meta.correlationId dùng để truy vết yêu cầu. | items: Visit[], total: integer:int32 |
| 400 | Lỗi | VALIDATION_ERROR | VALIDATION_ERROR: Request sai kiểu, thiếu trường hoặc vi phạm ràng buộc đầu vào. | ErrorResponse |
| 401 | Lỗi | UNAUTHENTICATED | UNAUTHENTICATED: Thiếu hoặc hết hạn thông tin xác thực. | ErrorResponse |
| 403 | Lỗi | FORBIDDEN | FORBIDDEN: Actor thiếu capability hoặc không có quyền trên tài nguyên. | ErrorResponse |
| 404 | Lỗi | NOT_FOUND | NOT_FOUND: Tài nguyên không tồn tại hoặc không được phép thấy. | ErrorResponse |
| 503 | Lỗi | SERVICE_UNAVAILABLE | SERVICE_UNAVAILABLE: Dependency hoặc projection cần thiết chưa sẵn sàng; không xác nhận nghiệp vụ thành công. | ErrorResponse |

## DI-001 POST /api/v1/diagnostic-orders

**Service:** Diagnostic. **Auth:** Bearer service. **Quyền:** SERVICE[Clinical]; handler CreateLabOrder cùng requestId/hash; DOCTOR dùng CL-005.

**Gateway:** Không · adapter tắt mặc định. **HTTP thành công:** 201.

Adapter phục hồi nội bộ tạo order LAB từ dữ liệu đã đối soát; luồng chính nhận CreateLabOrder qua RabbitMQ.

**Response data theo nguồn:** order: LabOrder, chargeStatus: string.

### Tham số

| Vị trí | Tên | Kiểu | Bắt buộc | Ràng buộc | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| header | Idempotency-Key | string:uuid | Có |  | UUID của một ý định ghi. Khi retry giữ nguyên key và payload; cùng key với payload khác phải trả 409. |
| body | visitId | string:uuid | Có |  | ID lượt khám; Clinical kiểm quyền bác sĩ hoặc bệnh nhân trước khi trả dữ liệu. |
| body | testCodes | string[] | Có |  | Các mã xét nghiệm của adapter phục hồi nội bộ; luồng chính dùng CL-005. |

### Phản hồi

| HTTP | Loại | Mã lỗi | Ý nghĩa | Schema hoặc data |
| --- | --- | --- | --- | --- |
| 201 | Thành công |  | Hoàn tất thao tác adapter phục hồi tắt mặc định. Kết quả nằm trong data; meta.correlationId dùng để truy vết yêu cầu. | order: LabOrder, chargeStatus: string |
| 400 | Lỗi | VALIDATION_ERROR | VALIDATION_ERROR: Request sai kiểu, thiếu trường hoặc vi phạm ràng buộc đầu vào. | ErrorResponse |
| 401 | Lỗi | UNAUTHENTICATED | UNAUTHENTICATED: Thiếu hoặc hết hạn thông tin xác thực. | ErrorResponse |
| 403 | Lỗi | FORBIDDEN | FORBIDDEN: Actor thiếu capability hoặc không có quyền trên tài nguyên. | ErrorResponse |
| 404 | Lỗi | NOT_FOUND | NOT_FOUND: Tài nguyên không tồn tại hoặc không được phép thấy. | ErrorResponse |
| 409 | Lỗi | STATE_CONFLICT | STATE_CONFLICT: Trạng thái hiện tại không cho phép thao tác này. | ErrorResponse |
| 503 | Lỗi | SERVICE_UNAVAILABLE | SERVICE_UNAVAILABLE: Dependency hoặc projection cần thiết chưa sẵn sàng; không xác nhận nghiệp vụ thành công. | ErrorResponse |

## DI-002 GET /api/v1/diagnostic-orders

**Service:** Diagnostic. **Auth:** Bearer user. **Quyền:** STAFF[LAB_TECH]/STAFF[LAB_REVIEW].

**Gateway:** Có. **HTTP thành công:** 200.

LAB_TECH/LAB_REVIEW xem danh sách order LAB theo trạng thái và phạm vi để xử lý lấy mẫu, nhập hoặc duyệt kết quả.

**Response data theo nguồn:** items: LabOrder[], total: integer:int32.

### Tham số

| Vị trí | Tên | Kiểu | Bắt buộc | Ràng buộc | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| query | state | string | Không |  | Trạng thái dùng lọc danh sách; giá trị phải thuộc state machine của tài nguyên. |
| query | date | string:date | Không |  | Ngày cần xem ca hoặc slot trống theo định dạng date. |
| query | page | integer | Không | minimum=1; default=1 | Số trang bắt đầu từ 1; bỏ qua dùng mặc định trong schema. |
| query | limit | integer | Không | minimum=1; maximum=100; default=20 | Số bản ghi tối đa mỗi trang; tuân theo giới hạn và mặc định trong schema. |

### Phản hồi

| HTTP | Loại | Mã lỗi | Ý nghĩa | Schema hoặc data |
| --- | --- | --- | --- | --- |
| 200 | Thành công |  | Hoàn tất thao tác hàng chờ lab. Kết quả nằm trong data; meta.correlationId dùng để truy vết yêu cầu. | items: LabOrder[], total: integer:int32 |
| 400 | Lỗi | VALIDATION_ERROR | VALIDATION_ERROR: Request sai kiểu, thiếu trường hoặc vi phạm ràng buộc đầu vào. | ErrorResponse |
| 401 | Lỗi | UNAUTHENTICATED | UNAUTHENTICATED: Thiếu hoặc hết hạn thông tin xác thực. | ErrorResponse |
| 403 | Lỗi | FORBIDDEN | FORBIDDEN: Actor thiếu capability hoặc không có quyền trên tài nguyên. | ErrorResponse |
| 503 | Lỗi | SERVICE_UNAVAILABLE | SERVICE_UNAVAILABLE: Dependency hoặc projection cần thiết chưa sẵn sàng; không xác nhận nghiệp vụ thành công. | ErrorResponse |

## DI-003 GET /api/v1/diagnostic-orders/{orderId}

**Service:** Diagnostic. **Auth:** Bearer user. **Quyền:** STAFF[LAB_TECH]/STAFF[LAB_REVIEW]/DOCTOR.

**Gateway:** Có. **HTTP thành công:** 200.

Trả order LAB cùng trạng thái thanh toán, mẫu và kết quả cho actor được phép; không công bố kết quả DRAFT cho bệnh nhân.

**Response data theo nguồn:** order: LabOrder, specimens: Specimen[], results: LabResult[].

### Tham số

| Vị trí | Tên | Kiểu | Bắt buộc | Ràng buộc | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| path | orderId | string:uuid | Có |  | ID order LAB cần lấy mẫu, hủy hoặc xem trạng thái. |

### Phản hồi

| HTTP | Loại | Mã lỗi | Ý nghĩa | Schema hoặc data |
| --- | --- | --- | --- | --- |
| 200 | Thành công |  | Hoàn tất thao tác order theo quyền. Kết quả nằm trong data; meta.correlationId dùng để truy vết yêu cầu. | order: LabOrder, specimens: Specimen[], results: LabResult[] |
| 400 | Lỗi | VALIDATION_ERROR | VALIDATION_ERROR: Request sai kiểu, thiếu trường hoặc vi phạm ràng buộc đầu vào. | ErrorResponse |
| 401 | Lỗi | UNAUTHENTICATED | UNAUTHENTICATED: Thiếu hoặc hết hạn thông tin xác thực. | ErrorResponse |
| 403 | Lỗi | FORBIDDEN | FORBIDDEN: Actor thiếu capability hoặc không có quyền trên tài nguyên. | ErrorResponse |
| 404 | Lỗi | NOT_FOUND | NOT_FOUND: Tài nguyên không tồn tại hoặc không được phép thấy. | ErrorResponse |
| 503 | Lỗi | SERVICE_UNAVAILABLE | SERVICE_UNAVAILABLE: Dependency hoặc projection cần thiết chưa sẵn sàng; không xác nhận nghiệp vụ thành công. | ErrorResponse |

## DI-004 POST /api/v1/diagnostic-orders/{orderId}/specimens

**Service:** Diagnostic. **Auth:** Bearer user. **Quyền:** STAFF[LAB_TECH].

**Gateway:** Có. **HTTP thành công:** 201.

Chỉ cho lấy mẫu khi Diagnostic đã áp dụng bằng chứng PAID và fence cục bộ; không gọi HTTP Billing trong request.

**Response data theo nguồn:** specimen: Specimen.

### Tham số

| Vị trí | Tên | Kiểu | Bắt buộc | Ràng buộc | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| path | orderId | string:uuid | Có |  | ID order LAB cần lấy mẫu, hủy hoặc xem trạng thái. |
| header | Idempotency-Key | string:uuid | Có |  | UUID của một ý định ghi. Khi retry giữ nguyên key và payload; cùng key với payload khác phải trả 409. |
| body | barcode | string | Không |  | Mã nhận dạng mẫu; server bảo đảm không trùng trong phạm vi mẫu. |
| body | note | string | Không |  | Ghi chú nghiệp vụ cho thao tác lấy mẫu. |

### Phản hồi

| HTTP | Loại | Mã lỗi | Ý nghĩa | Schema hoặc data |
| --- | --- | --- | --- | --- |
| 201 | Thành công |  | Hoàn tất thao tác lấy mẫu khi order paid và fence cục bộ hợp lệ. Kết quả nằm trong data; meta.correlationId dùng để truy vết yêu cầu. | specimen: Specimen |
| 400 | Lỗi | VALIDATION_ERROR | VALIDATION_ERROR: Request sai kiểu, thiếu trường hoặc vi phạm ràng buộc đầu vào. | ErrorResponse |
| 401 | Lỗi | UNAUTHENTICATED | UNAUTHENTICATED: Thiếu hoặc hết hạn thông tin xác thực. | ErrorResponse |
| 403 | Lỗi | FORBIDDEN | FORBIDDEN: Actor thiếu capability hoặc không có quyền trên tài nguyên. | ErrorResponse |
| 404 | Lỗi | NOT_FOUND | NOT_FOUND: Tài nguyên không tồn tại hoặc không được phép thấy. | ErrorResponse |
| 409 | Lỗi | ORDER_NOT_PAID, SPECIMEN_ALREADY_COLLECTED | ORDER_NOT_PAID: Order LAB chưa có bằng chứng PAID/fence trong Diagnostic.; SPECIMEN_ALREADY_COLLECTED: Mẫu đã được lấy; thao tác tạo/hủy không còn hợp lệ. | ErrorResponse |
| 503 | Lỗi | SERVICE_UNAVAILABLE | SERVICE_UNAVAILABLE: Dependency hoặc projection cần thiết chưa sẵn sàng; không xác nhận nghiệp vụ thành công. | ErrorResponse |

## DI-005 POST /api/v1/specimens/{specimenId}/reject

**Service:** Diagnostic. **Auth:** Bearer user. **Quyền:** STAFF[LAB_TECH].

**Gateway:** Có. **HTTP thành công:** 200.

LAB_TECH từ chối mẫu có lý do khi mẫu chưa đi tiếp; order chuyển sang nhánh cần lấy lại.

**Response data theo nguồn:** specimen: Specimen.

### Tham số

| Vị trí | Tên | Kiểu | Bắt buộc | Ràng buộc | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| path | specimenId | string:uuid | Có |  | ID mẫu LAB cần từ chối hoặc xem. |
| header | Idempotency-Key | string:uuid | Có |  | UUID của một ý định ghi. Khi retry giữ nguyên key và payload; cùng key với payload khác phải trả 409. |
| body | reasonCode | string | Có |  | Mã lý do nghiệp vụ cho thao tác hủy, từ chối hoặc hoàn; được ghi vào audit. |
| body | expectedVersion | integer:int32 | Có |  | Phiên bản tài nguyên client đã đọc để kiểm tra ghi cạnh tranh; lệch phiên bản trả 409. |

### Phản hồi

| HTTP | Loại | Mã lỗi | Ý nghĩa | Schema hoặc data |
| --- | --- | --- | --- | --- |
| 200 | Thành công |  | Hoàn tất thao tác từ chối mẫu có lý do. Kết quả nằm trong data; meta.correlationId dùng để truy vết yêu cầu. | specimen: Specimen |
| 400 | Lỗi | VALIDATION_ERROR | VALIDATION_ERROR: Request sai kiểu, thiếu trường hoặc vi phạm ràng buộc đầu vào. | ErrorResponse |
| 401 | Lỗi | UNAUTHENTICATED | UNAUTHENTICATED: Thiếu hoặc hết hạn thông tin xác thực. | ErrorResponse |
| 403 | Lỗi | FORBIDDEN | FORBIDDEN: Actor thiếu capability hoặc không có quyền trên tài nguyên. | ErrorResponse |
| 404 | Lỗi | NOT_FOUND | NOT_FOUND: Tài nguyên không tồn tại hoặc không được phép thấy. | ErrorResponse |
| 409 | Lỗi | SPECIMEN_ALREADY_PROCESSED | SPECIMEN_ALREADY_PROCESSED: Mẫu đã đi tiếp quy trình, không thể từ chối ở trạng thái này. | ErrorResponse |
| 503 | Lỗi | SERVICE_UNAVAILABLE | SERVICE_UNAVAILABLE: Dependency hoặc projection cần thiết chưa sẵn sàng; không xác nhận nghiệp vụ thành công. | ErrorResponse |

## DI-006 POST /api/v1/diagnostic-orders/{orderId}/recollect

**Service:** Diagnostic. **Auth:** Bearer user. **Quyền:** STAFF[LAB_TECH].

**Gateway:** Có. **HTTP thành công:** 201.

LAB_TECH tạo lượt lấy lại mẫu cho order đủ điều kiện, giữ liên kết với mẫu bị từ chối.

**Response data theo nguồn:** specimen: Specimen.

### Tham số

| Vị trí | Tên | Kiểu | Bắt buộc | Ràng buộc | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| path | orderId | string:uuid | Có |  | ID order LAB cần lấy mẫu, hủy hoặc xem trạng thái. |
| header | Idempotency-Key | string:uuid | Có |  | UUID của một ý định ghi. Khi retry giữ nguyên key và payload; cùng key với payload khác phải trả 409. |
| body | barcode | string | Không |  | Mã nhận dạng mẫu; server bảo đảm không trùng trong phạm vi mẫu. |

### Phản hồi

| HTTP | Loại | Mã lỗi | Ý nghĩa | Schema hoặc data |
| --- | --- | --- | --- | --- |
| 201 | Thành công |  | Hoàn tất thao tác tạo mẫu lấy lại. Kết quả nằm trong data; meta.correlationId dùng để truy vết yêu cầu. | specimen: Specimen |
| 400 | Lỗi | VALIDATION_ERROR | VALIDATION_ERROR: Request sai kiểu, thiếu trường hoặc vi phạm ràng buộc đầu vào. | ErrorResponse |
| 401 | Lỗi | UNAUTHENTICATED | UNAUTHENTICATED: Thiếu hoặc hết hạn thông tin xác thực. | ErrorResponse |
| 403 | Lỗi | FORBIDDEN | FORBIDDEN: Actor thiếu capability hoặc không có quyền trên tài nguyên. | ErrorResponse |
| 404 | Lỗi | NOT_FOUND | NOT_FOUND: Tài nguyên không tồn tại hoặc không được phép thấy. | ErrorResponse |
| 409 | Lỗi | STATE_CONFLICT | STATE_CONFLICT: Trạng thái hiện tại không cho phép thao tác này. | ErrorResponse |
| 503 | Lỗi | SERVICE_UNAVAILABLE | SERVICE_UNAVAILABLE: Dependency hoặc projection cần thiết chưa sẵn sàng; không xác nhận nghiệp vụ thành công. | ErrorResponse |

## DI-007 POST /api/v1/diagnostic-orders/{orderId}/results

**Service:** Diagnostic. **Auth:** Bearer user. **Quyền:** STAFF[LAB_TECH].

**Gateway:** Có. **HTTP thành công:** 201.

LAB_TECH tạo bản kết quả DRAFT cho order đã có mẫu hợp lệ; ghi các chỉ số theo test snapshot.

**Response data theo nguồn:** result: LabResult.

### Tham số

| Vị trí | Tên | Kiểu | Bắt buộc | Ràng buộc | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| path | orderId | string:uuid | Có |  | ID order LAB cần lấy mẫu, hủy hoặc xem trạng thái. |
| header | Idempotency-Key | string:uuid | Có |  | UUID của một ý định ghi. Khi retry giữ nguyên key và payload; cùng key với payload khác phải trả 409. |
| body | items | LabResultItem[] | Có |  | Các chỉ số kết quả LAB; mỗi phần tử theo LabResultItem. |
| body | items[].testCode | string | Có |  | Trong mỗi phần tử: Mã xét nghiệm mà chỉ số kết quả thuộc về. |
| body | items[].valueText | string | Có |  | Trong mỗi phần tử: Giá trị kết quả dưới dạng văn bản, chưa công bố khi còn DRAFT. |
| body | items[].unit | string | Không |  | Trong mỗi phần tử: Đơn vị hiển thị của chỉ số LAB nếu có. |
| body | items[].referenceRange | string | Không |  | Trong mỗi phần tử: Khoảng tham chiếu đã chụp cho chỉ số LAB nếu có. |
| body | items[].flag | string | Không |  | Trong mỗi phần tử: Cờ diễn giải kết quả LAB nếu có. |

### Phản hồi

| HTTP | Loại | Mã lỗi | Ý nghĩa | Schema hoặc data |
| --- | --- | --- | --- | --- |
| 201 | Thành công |  | Hoàn tất thao tác tạo kết quả draft. Kết quả nằm trong data; meta.correlationId dùng để truy vết yêu cầu. | result: LabResult |
| 400 | Lỗi | VALIDATION_ERROR | VALIDATION_ERROR: Request sai kiểu, thiếu trường hoặc vi phạm ràng buộc đầu vào. | ErrorResponse |
| 401 | Lỗi | UNAUTHENTICATED | UNAUTHENTICATED: Thiếu hoặc hết hạn thông tin xác thực. | ErrorResponse |
| 403 | Lỗi | FORBIDDEN | FORBIDDEN: Actor thiếu capability hoặc không có quyền trên tài nguyên. | ErrorResponse |
| 404 | Lỗi | NOT_FOUND | NOT_FOUND: Tài nguyên không tồn tại hoặc không được phép thấy. | ErrorResponse |
| 409 | Lỗi | STATE_CONFLICT | STATE_CONFLICT: Trạng thái hiện tại không cho phép thao tác này. | ErrorResponse |
| 503 | Lỗi | SERVICE_UNAVAILABLE | SERVICE_UNAVAILABLE: Dependency hoặc projection cần thiết chưa sẵn sàng; không xác nhận nghiệp vụ thành công. | ErrorResponse |

## DI-008 PUT /api/v1/results/{resultId}

**Service:** Diagnostic. **Auth:** Bearer user. **Quyền:** STAFF[LAB_TECH].

**Gateway:** Có. **HTTP thành công:** 200.

LAB_TECH cập nhật revision kết quả DRAFT/REWORK theo expectedVersion; mọi thay đổi cần truy vết người sửa.

**Response data theo nguồn:** result: LabResult.

### Tham số

| Vị trí | Tên | Kiểu | Bắt buộc | Ràng buộc | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| path | resultId | string:uuid | Có |  | ID bộ kết quả LAB cần sửa, gửi duyệt hoặc công bố. |
| header | Idempotency-Key | string:uuid | Có |  | UUID của một ý định ghi. Khi retry giữ nguyên key và payload; cùng key với payload khác phải trả 409. |
| body | items | LabResultItem[] | Có |  | Các chỉ số kết quả LAB; mỗi phần tử theo LabResultItem. |
| body | items[].testCode | string | Có |  | Trong mỗi phần tử: Mã xét nghiệm mà chỉ số kết quả thuộc về. |
| body | items[].valueText | string | Có |  | Trong mỗi phần tử: Giá trị kết quả dưới dạng văn bản, chưa công bố khi còn DRAFT. |
| body | items[].unit | string | Không |  | Trong mỗi phần tử: Đơn vị hiển thị của chỉ số LAB nếu có. |
| body | items[].referenceRange | string | Không |  | Trong mỗi phần tử: Khoảng tham chiếu đã chụp cho chỉ số LAB nếu có. |
| body | items[].flag | string | Không |  | Trong mỗi phần tử: Cờ diễn giải kết quả LAB nếu có. |
| body | expectedVersion | integer:int32 | Có |  | Phiên bản tài nguyên client đã đọc để kiểm tra ghi cạnh tranh; lệch phiên bản trả 409. |

### Phản hồi

| HTTP | Loại | Mã lỗi | Ý nghĩa | Schema hoặc data |
| --- | --- | --- | --- | --- |
| 200 | Thành công |  | Hoàn tất thao tác sửa draft/rework. Kết quả nằm trong data; meta.correlationId dùng để truy vết yêu cầu. | result: LabResult |
| 400 | Lỗi | VALIDATION_ERROR | VALIDATION_ERROR: Request sai kiểu, thiếu trường hoặc vi phạm ràng buộc đầu vào. | ErrorResponse |
| 401 | Lỗi | UNAUTHENTICATED | UNAUTHENTICATED: Thiếu hoặc hết hạn thông tin xác thực. | ErrorResponse |
| 403 | Lỗi | FORBIDDEN | FORBIDDEN: Actor thiếu capability hoặc không có quyền trên tài nguyên. | ErrorResponse |
| 404 | Lỗi | NOT_FOUND | NOT_FOUND: Tài nguyên không tồn tại hoặc không được phép thấy. | ErrorResponse |
| 409 | Lỗi | RESULT_VERSION_CONFLICT, RESULT_ALREADY_PUBLISHED | RESULT_VERSION_CONFLICT: Kết quả LAB đã đổi kể từ phiên bản client đọc.; RESULT_ALREADY_PUBLISHED: Kết quả đã công bố và bất biến. | ErrorResponse |
| 503 | Lỗi | SERVICE_UNAVAILABLE | SERVICE_UNAVAILABLE: Dependency hoặc projection cần thiết chưa sẵn sàng; không xác nhận nghiệp vụ thành công. | ErrorResponse |

## DI-009 POST /api/v1/results/{resultId}/submit-review

**Service:** Diagnostic. **Auth:** Bearer user. **Quyền:** STAFF[LAB_TECH].

**Gateway:** Có. **HTTP thành công:** 200.

Kỹ thuật viên chuyển revision kết quả đã nhập sang chờ duyệt sau khi kiểm đủ chỉ số bắt buộc. Bản này chưa được công bố cho bệnh nhân.

**Response data theo nguồn:** result: LabResult.

### Tham số

| Vị trí | Tên | Kiểu | Bắt buộc | Ràng buộc | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| path | resultId | string:uuid | Có |  | ID bộ kết quả LAB cần sửa, gửi duyệt hoặc công bố. |
| header | Idempotency-Key | string:uuid | Có |  | UUID của một ý định ghi. Khi retry giữ nguyên key và payload; cùng key với payload khác phải trả 409. |
| body | expectedVersion | integer:int32 | Có |  | Phiên bản tài nguyên client đã đọc để kiểm tra ghi cạnh tranh; lệch phiên bản trả 409. |

### Phản hồi

| HTTP | Loại | Mã lỗi | Ý nghĩa | Schema hoặc data |
| --- | --- | --- | --- | --- |
| 200 | Thành công |  | Hoàn tất thao tác gửi duyệt. Kết quả nằm trong data; meta.correlationId dùng để truy vết yêu cầu. | result: LabResult |
| 400 | Lỗi | VALIDATION_ERROR | VALIDATION_ERROR: Request sai kiểu, thiếu trường hoặc vi phạm ràng buộc đầu vào. | ErrorResponse |
| 401 | Lỗi | UNAUTHENTICATED | UNAUTHENTICATED: Thiếu hoặc hết hạn thông tin xác thực. | ErrorResponse |
| 403 | Lỗi | FORBIDDEN | FORBIDDEN: Actor thiếu capability hoặc không có quyền trên tài nguyên. | ErrorResponse |
| 404 | Lỗi | NOT_FOUND | NOT_FOUND: Tài nguyên không tồn tại hoặc không được phép thấy. | ErrorResponse |
| 409 | Lỗi | RESULT_INCOMPLETE | RESULT_INCOMPLETE: Kết quả thiếu chỉ số hoặc dữ liệu bắt buộc để gửi duyệt. | ErrorResponse |
| 503 | Lỗi | SERVICE_UNAVAILABLE | SERVICE_UNAVAILABLE: Dependency hoặc projection cần thiết chưa sẵn sàng; không xác nhận nghiệp vụ thành công. | ErrorResponse |

## DI-010 POST /api/v1/results/{resultId}/return-rework

**Service:** Diagnostic. **Auth:** Bearer user. **Quyền:** STAFF[LAB_REVIEW].

**Gateway:** Có. **HTTP thành công:** 200.

LAB_REVIEW trả revision đang REVIEW về REWORK kèm lý do để kỹ thuật viên sửa rồi gửi duyệt lại.

**Response data theo nguồn:** result: LabResult.

### Tham số

| Vị trí | Tên | Kiểu | Bắt buộc | Ràng buộc | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| path | resultId | string:uuid | Có |  | ID bộ kết quả LAB cần sửa, gửi duyệt hoặc công bố. |
| header | Idempotency-Key | string:uuid | Có |  | UUID của một ý định ghi. Khi retry giữ nguyên key và payload; cùng key với payload khác phải trả 409. |
| body | reason | string | Có |  | Lý do trả kết quả về trạng thái REWORK. |
| body | expectedVersion | integer:int32 | Có |  | Phiên bản tài nguyên client đã đọc để kiểm tra ghi cạnh tranh; lệch phiên bản trả 409. |

### Phản hồi

| HTTP | Loại | Mã lỗi | Ý nghĩa | Schema hoặc data |
| --- | --- | --- | --- | --- |
| 200 | Thành công |  | Hoàn tất thao tác trả sửa có lý do. Kết quả nằm trong data; meta.correlationId dùng để truy vết yêu cầu. | result: LabResult |
| 400 | Lỗi | VALIDATION_ERROR | VALIDATION_ERROR: Request sai kiểu, thiếu trường hoặc vi phạm ràng buộc đầu vào. | ErrorResponse |
| 401 | Lỗi | UNAUTHENTICATED | UNAUTHENTICATED: Thiếu hoặc hết hạn thông tin xác thực. | ErrorResponse |
| 403 | Lỗi | FORBIDDEN | FORBIDDEN: Actor thiếu capability hoặc không có quyền trên tài nguyên. | ErrorResponse |
| 404 | Lỗi | NOT_FOUND | NOT_FOUND: Tài nguyên không tồn tại hoặc không được phép thấy. | ErrorResponse |
| 409 | Lỗi | RESULT_NOT_IN_REVIEW | RESULT_NOT_IN_REVIEW: Kết quả không ở trạng thái chờ duyệt. | ErrorResponse |
| 503 | Lỗi | SERVICE_UNAVAILABLE | SERVICE_UNAVAILABLE: Dependency hoặc projection cần thiết chưa sẵn sàng; không xác nhận nghiệp vụ thành công. | ErrorResponse |

## DI-011 POST /api/v1/results/{resultId}/publish

**Service:** Diagnostic. **Auth:** Bearer user. **Quyền:** STAFF[LAB_REVIEW].

**Gateway:** Có. **HTTP thành công:** 200.

Người duyệt phải khác người nhập/sửa revision hiện tại; PUBLISHED là bất biến và chỉ sau kiểm đầy đủ.

**Response data theo nguồn:** result: LabResult.

### Tham số

| Vị trí | Tên | Kiểu | Bắt buộc | Ràng buộc | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| path | resultId | string:uuid | Có |  | ID bộ kết quả LAB cần sửa, gửi duyệt hoặc công bố. |
| header | Idempotency-Key | string:uuid | Có |  | UUID của một ý định ghi. Khi retry giữ nguyên key và payload; cùng key với payload khác phải trả 409. |
| body | expectedVersion | integer:int32 | Có |  | Phiên bản tài nguyên client đã đọc để kiểm tra ghi cạnh tranh; lệch phiên bản trả 409. |

### Phản hồi

| HTTP | Loại | Mã lỗi | Ý nghĩa | Schema hoặc data |
| --- | --- | --- | --- | --- |
| 200 | Thành công |  | Hoàn tất thao tác reviewer khác người nhập duyệt và công bố trong một lệnh. Kết quả nằm trong data; meta.correlationId dùng để truy vết yêu cầu. | result: LabResult |
| 400 | Lỗi | VALIDATION_ERROR | VALIDATION_ERROR: Request sai kiểu, thiếu trường hoặc vi phạm ràng buộc đầu vào. | ErrorResponse |
| 401 | Lỗi | UNAUTHENTICATED | UNAUTHENTICATED: Thiếu hoặc hết hạn thông tin xác thực. | ErrorResponse |
| 403 | Lỗi | FORBIDDEN | FORBIDDEN: Actor thiếu capability hoặc không có quyền trên tài nguyên. | ErrorResponse |
| 404 | Lỗi | NOT_FOUND | NOT_FOUND: Tài nguyên không tồn tại hoặc không được phép thấy. | ErrorResponse |
| 409 | Lỗi | SELF_REVIEW_FORBIDDEN, RESULT_NOT_IN_REVIEW | SELF_REVIEW_FORBIDDEN: Người nhập/sửa revision này không được tự duyệt nó.; RESULT_NOT_IN_REVIEW: Kết quả không ở trạng thái chờ duyệt. | ErrorResponse |
| 503 | Lỗi | SERVICE_UNAVAILABLE | SERVICE_UNAVAILABLE: Dependency hoặc projection cần thiết chưa sẵn sàng; không xác nhận nghiệp vụ thành công. | ErrorResponse |

## DI-012 POST /api/v1/diagnostic-orders/{orderId}/cancel

**Service:** Diagnostic. **Auth:** Bearer user. **Quyền:** DOCTOR.

**Gateway:** Có. **HTTP thành công:** 200.

Hủy order LAB trước khi lấy mẫu theo điều kiện trạng thái; phát thay đổi để Billing xử lý charge/hoàn phù hợp.

**Response data theo nguồn:** order: LabOrder, refundStatus: string.

### Tham số

| Vị trí | Tên | Kiểu | Bắt buộc | Ràng buộc | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| path | orderId | string:uuid | Có |  | ID order LAB cần lấy mẫu, hủy hoặc xem trạng thái. |
| header | Idempotency-Key | string:uuid | Có |  | UUID của một ý định ghi. Khi retry giữ nguyên key và payload; cùng key với payload khác phải trả 409. |
| body | reasonCode | string | Có |  | Mã lý do nghiệp vụ cho thao tác hủy, từ chối hoặc hoàn; được ghi vào audit. |
| body | expectedVersion | integer:int32 | Có |  | Phiên bản tài nguyên client đã đọc để kiểm tra ghi cạnh tranh; lệch phiên bản trả 409. |

### Phản hồi

| HTTP | Loại | Mã lỗi | Ý nghĩa | Schema hoặc data |
| --- | --- | --- | --- | --- |
| 200 | Thành công |  | Hoàn tất thao tác hủy trước mẫu. Kết quả nằm trong data; meta.correlationId dùng để truy vết yêu cầu. | order: LabOrder, refundStatus: string |
| 400 | Lỗi | VALIDATION_ERROR | VALIDATION_ERROR: Request sai kiểu, thiếu trường hoặc vi phạm ràng buộc đầu vào. | ErrorResponse |
| 401 | Lỗi | UNAUTHENTICATED | UNAUTHENTICATED: Thiếu hoặc hết hạn thông tin xác thực. | ErrorResponse |
| 403 | Lỗi | FORBIDDEN | FORBIDDEN: Actor thiếu capability hoặc không có quyền trên tài nguyên. | ErrorResponse |
| 404 | Lỗi | NOT_FOUND | NOT_FOUND: Tài nguyên không tồn tại hoặc không được phép thấy. | ErrorResponse |
| 409 | Lỗi | SPECIMEN_ALREADY_COLLECTED | SPECIMEN_ALREADY_COLLECTED: Mẫu đã được lấy; thao tác tạo/hủy không còn hợp lệ. | ErrorResponse |
| 503 | Lỗi | SERVICE_UNAVAILABLE | SERVICE_UNAVAILABLE: Dependency hoặc projection cần thiết chưa sẵn sàng; không xác nhận nghiệp vụ thành công. | ErrorResponse |

## DI-013 GET /api/v1/patients/{patientId}/published-results

**Service:** Diagnostic. **Auth:** Bearer user. **Quyền:** PATIENT/DOCTOR.

**Gateway:** Có. **HTTP thành công:** 200.

Bệnh nhân hoặc STAFF có quyền đọc chỉ các kết quả LAB đã PUBLISHED thuộc hồ sơ.

**Response data theo nguồn:** items: LabResult[], total: integer:int32.

### Tham số

| Vị trí | Tên | Kiểu | Bắt buộc | Ràng buộc | Ý nghĩa |
| --- | --- | --- | --- | --- | --- |
| path | patientId | string:uuid | Có |  | ID hồ sơ bệnh nhân; server kiểm quyền chủ sở hữu hoặc capability tương ứng. |
| query | page | integer | Không | minimum=1; default=1 | Số trang bắt đầu từ 1; bỏ qua dùng mặc định trong schema. |
| query | limit | integer | Không | minimum=1; maximum=100; default=20 | Số bản ghi tối đa mỗi trang; tuân theo giới hạn và mặc định trong schema. |

### Phản hồi

| HTTP | Loại | Mã lỗi | Ý nghĩa | Schema hoặc data |
| --- | --- | --- | --- | --- |
| 200 | Thành công |  | Hoàn tất thao tác kết quả đã công bố. Kết quả nằm trong data; meta.correlationId dùng để truy vết yêu cầu. | items: LabResult[], total: integer:int32 |
| 400 | Lỗi | VALIDATION_ERROR | VALIDATION_ERROR: Request sai kiểu, thiếu trường hoặc vi phạm ràng buộc đầu vào. | ErrorResponse |
| 401 | Lỗi | UNAUTHENTICATED | UNAUTHENTICATED: Thiếu hoặc hết hạn thông tin xác thực. | ErrorResponse |
| 403 | Lỗi | FORBIDDEN | FORBIDDEN: Actor thiếu capability hoặc không có quyền trên tài nguyên. | ErrorResponse |
| 404 | Lỗi | NOT_FOUND | NOT_FOUND: Tài nguyên không tồn tại hoặc không được phép thấy. | ErrorResponse |
| 503 | Lỗi | SERVICE_UNAVAILABLE | SERVICE_UNAVAILABLE: Dependency hoặc projection cần thiết chưa sẵn sàng; không xác nhận nghiệp vụ thành công. | ErrorResponse |

## Event liên quan trực tiếp Catalog Clinical Diagnostic

Các hàng dưới được chọn khi producer hoặc consumer có Catalog/Clinical/Diagnostic. Huy viết phía service mình sở hữu và phối hợp owner phía còn lại. Đây là danh sách baseline; các mở rộng ở H00 như consumer refund phải được cập nhật lại sau khi chốt.

| Event | Producer | Consumer | Payload fields | Exchange | Routing key | Queue | Quy tắc |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ChargePaid | Billing | Appointment Diagnostic Pharmacy | chargeId, sourceType, sourceId, sourceRevision, settlementId, fence, transactionId, amountVnd, paidAt | umc.events.{producer}.v1 | billing.charge-paid.v1 | evt.appointment.v1, evt.diagnostic.v1, evt.pharmacy.v1 | chargeId, sourceType, sourceId, sourceRevision, settlementId, fence, transactionId, amountVnd, paidAt. Chốt nguồn đúng fence; cùng transaction tiền và receipt |
| LabCancelled | Diagnostic | Billing Clinical | orderId, visitId, cancellationId, noSpecimen, reasonCode, version | umc.events.{producer}.v1 | diagnostic.lab-cancelled.v1 | evt.billing.v1, evt.clinical.v1 | orderId, visitId, cancellationId, noSpecimen, reasonCode, version. Hủy order; xét lại điều kiện ký và tiền |
| LabResultPublished | Diagnostic | Clinical Notification | orderId, visitId, revision, publishedAt, recipientUserId, version | umc.events.{producer}.v1 | diagnostic.lab-result-published.v1 | evt.clinical.v1, evt.notification.v1 | orderId, visitId, revision, publishedAt, recipientUserId, version. Cập nhật kết quả đã công bố; không mang giá trị y tế vào Notification |
| PrescriptionFinalized | Clinical | Pharmacy | prescriptionId, revision, visitId, patientId, itemsSnapshot, finalizedAt | umc.events.{producer}.v1 | clinical.prescription-finalized.v1 | evt.pharmacy.v1 | prescriptionId, revision, visitId, patientId, itemsSnapshot, finalizedAt. Projection toa FINAL bất biến |
| VisitSigned | Clinical | Appointment | visitId, appointmentId, signedAt, version | umc.events.{producer}.v1 | clinical.visit-signed.v1 | evt.appointment.v1 | visitId, appointmentId, signedAt, version. Chuyển appointment COMPLETED |
| VisitReturnReady | Clinical | Appointment | visitId, appointmentId, returnRound, version | umc.events.{producer}.v1 | clinical.visit-return-ready.v1 | evt.appointment.v1 | visitId, appointmentId, returnRound, version. Tạo RETURN duy nhất |
| CatalogChanged | Catalog | Appointment Clinical Diagnostic Pharmacy Billing | entityType?, entityId?, entityVersion?, fullSnapshot?, effectiveAt, streamSequence, mode | umc.events.{producer}.v1 | catalog.catalog-changed.v1 | evt.appointment.v1, evt.billing.v1, evt.clinical.v1, evt.diagnostic.v1, evt.pharmacy.v1 | entityType, entityId, entityVersion, fullSnapshot, effectiveAt, streamSequence, mode. UPSERT/TOMBSTONE/CHECKPOINT; cập nhật projection tối thiểu |
| PatientAccessChanged | Patient | Appointment Clinical Diagnostic Pharmacy Billing | patientId, ownerUserId, active, policyVersion | umc.events.{producer}.v1 | patient.patient-access-changed.v1 | evt.appointment.v1, evt.billing.v1, evt.clinical.v1, evt.diagnostic.v1, evt.pharmacy.v1 | patientId, ownerUserId, active, policyVersion. Projection quyền hồ sơ; không mang bệnh án, địa chỉ hoặc BHYT |
| IdentityAccessChanged | Identity | Patient Appointment Clinical Diagnostic Pharmacy Billing Notification Catalog | userId, status, actorType, capabilities, tokenVersion, phoneVerified, version | umc.events.{producer}.v1 | identity.identity-access-changed.v1 | evt.appointment.v1, evt.billing.v1, evt.catalog.v1, evt.clinical.v1, evt.diagnostic.v1, evt.notification.v1, evt.patient.v1, evt.pharmacy.v1 | userId, status, actorType, capabilities, tokenVersion, phoneVerified, version. Projection quyền và trạng thái tài khoản; không mang mật khẩu/OTP/phone đầy đủ |
| ChargePrepared | Billing | Appointment Diagnostic Pharmacy | requestId, sourceType, sourceId, sourceRevision, chargeId?, state, reasonCode? | umc.events.{producer}.v1 | billing.charge-prepared.v1 | evt.appointment.v1, evt.diagnostic.v1, evt.pharmacy.v1 | requestId, sourceType, sourceId, sourceRevision, chargeId, state, reasonCode. Phản hồi nghiệp vụ cho RequestCharge; state=CREATED/REJECTED |
| LabOrderResolved | Diagnostic | Clinical | requestId, visitId, state, orderId?, reasonCode?, version | umc.events.{producer}.v1 | diagnostic.lab-order-resolved.v1 | evt.clinical.v1 | requestId, visitId, state, orderId?, reasonCode, version. CREATED/REJECTED; kết thúc pending registry an toàn |
| QueueTicketClaimed | Appointment | Clinical | requestId, ticketId, appointmentId, patientId, visitId?, claimId?, state, reasonCode? | umc.events.{producer}.v1 | appointment.queue-ticket-claimed.v1 | evt.clinical.v1 | requestId, ticketId, appointmentId, patientId, visitId?, claimId?, state, reasonCode. ACCEPTED/REJECTED; FIRST và RETURN cùng contract |
| SettlementReserved | Appointment Diagnostic Pharmacy | Billing | settlementId, sourceId, sourceRevision, state, fence?, lockedAt?, reasonCode? | umc.events.{producer}.v1 | appointment diagnostic pharmacy.settlement-reserved.v1 | evt.billing.v1 | settlementId, sourceId, sourceRevision, state, fence?, lockedAt?, reasonCode. ACCEPTED/REJECTED; owner khóa nguồn trong transaction |
| SettlementDecision | Billing | Appointment Diagnostic Pharmacy | settlementId, sourceId, sourceRevision, decisionVersion, state, fence?, paymentId? | umc.events.{producer}.v1 | billing.settlement-decision.v1 | evt.appointment.v1, evt.diagnostic.v1, evt.pharmacy.v1 | settlementId, sourceId, sourceRevision, decisionVersion, state, fence?, paymentId?. SUCCEEDED/FAILED/UNKNOWN; UNKNOWN không mở khóa |

## Command liên quan trực tiếp

| Command | Producer | Owner nhận | Payload fields | Exchange | Routing key | Queue | Quy tắc |
| --- | --- | --- | --- | --- | --- | --- | --- |
| RequestCharge | Appointment Diagnostic Pharmacy | Billing | requestId, sourceType, sourceId, sourceRevision, patientId, recipientUserId, linesSnapshot, amountVnd, snapshotHash | umc.commands.{producer}.v1 | billing.request-charge.v1 | cmd.billing.v1 | requestId, sourceType, sourceId, sourceRevision, patientId, recipientUserId, linesSnapshot, amountVnd, snapshotHash → ChargePrepared |
| CreateLabOrder | Clinical | Diagnostic | requestId, visitId, patientId, doctorId, testSnapshot, requestHash, authorizedAt | umc.commands.{producer}.v1 | diagnostic.create-lab-order.v1 | cmd.diagnostic.v1 | requestId, visitId, patientId, doctorId, testSnapshot, requestHash, authorizedAt → LabOrderResolved |
| ClaimQueueTicket | Clinical | Appointment | requestId, ticketId, expectedTicketVersion, doctorId, patientId | umc.commands.{producer}.v1 | appointment.claim-queue-ticket.v1 | cmd.appointment.v1 | requestId, ticketId, expectedTicketVersion, doctorId, patientId → QueueTicketClaimed |
| ReserveSettlement | Billing | Appointment Diagnostic Pharmacy theo sourceType | settlementId, chargeId, sourceType, sourceId, sourceRevision, amountHash, attemptVersion | umc.commands.{producer}.v1 | {target}.reserve-settlement.v1 | cmd.{target}.v1 | settlementId, chargeId, sourceType, sourceId, sourceRevision, amountHash, attemptVersion → SettlementReserved |
| QuerySettlement | Appointment Diagnostic Pharmacy | Billing | requestId, settlementId, sourceType, sourceId, sourceRevision | umc.commands.{producer}.v1 | billing.query-settlement.v1 | cmd.billing.v1 | requestId, settlementId, sourceType, sourceId, sourceRevision → SettlementDecision |

## Những gì phụ lục không tự bổ sung

- Không invent enum/error/field còn thiếu. Lấy OpenAPI/AsyncAPI đầy đủ đã thống nhất và ghi quyết định ở H00.
- Không triển khai các route IN-01..IN-10 đã bị loại khỏi baseline.
- Không đếm command/event/health thành HTTP operations.
- Không gửi giá trị y tế trong LabResultPublished cho Notification; payload giữ tối thiểu theo contract.
- Không lấy role từ client để thay quyền backend; auth/ownership vẫn kiểm tại owner.

## Nguồn CSV

- [UMC_Care_API_86_9_Service_v5_2 - 01_HTTP_86.csv](UMC_Care_API_86_9_Service_v5_2%20-%2001_HTTP_86.csv)
- [UMC_Care_API_86_9_Service_v5_2 - 02_ThamSo.csv](UMC_Care_API_86_9_Service_v5_2%20-%2002_ThamSo.csv)
- [UMC_Care_API_86_9_Service_v5_2 - 03_PhanHoi.csv](UMC_Care_API_86_9_Service_v5_2%20-%2003_PhanHoi.csv)
- [UMC_Care_API_86_9_Service_v5_2 - 04_Events_18.csv](UMC_Care_API_86_9_Service_v5_2%20-%2004_Events_18.csv)
- [UMC_Care_API_86_9_Service_v5_2 - 05_Commands_5.csv](UMC_Care_API_86_9_Service_v5_2%20-%2005_Commands_5.csv)
