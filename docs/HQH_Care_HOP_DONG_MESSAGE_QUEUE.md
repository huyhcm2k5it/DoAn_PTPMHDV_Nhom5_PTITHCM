# Hợp đồng Message Queue HQH Care v1

Ngày đối chiếu 19/11/2026. Phạm vi gồm 20 event và 5 command giữa 9 service. Tài liệu mô tả giao tiếp để các owner triển khai và nghiệm thu.

## Nguồn hợp đồng và trách nhiệm

- Bảng event và command trong bộ CSV API v5.2 liệt kê payload cùng quy tắc nghiệp vụ. Dấu ? sau tên trường nghĩa là tùy chọn.
- [JSON Schema](../contracts/messages/) xác định kiểu, trường bắt buộc và biến thể payload. Khi nội dung không thống nhất, đối chiếu publisher, consumer và cập nhật các nguồn liên quan trong cùng thay đổi.
- [RabbitMQ definitions](../rabbitmq/definitions.json) xác định exchange, queue và binding. Các queue nghiệp vụ dùng durable quorum.
- Quân phụ trách Patient, Appointment, Pharmacy và broker/topology. Huy phụ trách Catalog, Clinical, Diagnostic. Hưng phụ trách Identity, Billing, Notification.
- Credential chỉ nằm trong env thật. Dùng UMC_AMQP_URL của Quân với TLS và vhost do môi trường cấp. Tên vhost trong definitions là cấu hình mẫu, cần chọn đúng vhost đích khi import.
- producer trong envelope dùng chữ thường. Tên service viết hoa trong bảng dùng để người đọc nhận biết.

## Envelope dùng chung

Mỗi message nghiệp vụ là một JSON object, content-type application/json và schemaVersion=1. Tham chiếu [common-envelope.v1.schema.json](../contracts/messages/common-envelope.v1.schema.json). Schema từng message có thể siết chặt thêm các trường nullable.

| Trường | Ý nghĩa |
| --- | --- |
| messageId | UUID định danh message. Giữ nguyên khi gửi lại cùng message. |
| messageKind | EVENT hoặc COMMAND. |
| messageType | Tên chính xác trong bảng bên dưới. |
| schemaVersion | Phiên bản schema, hiện là 1. |
| producer | Service phát message, chữ thường. |
| aggregateId | UUID của aggregate theo schema. Ví dụ PrescriptionFinalized dùng prescriptionId. |
| aggregateVersion | Số nguyên dương theo phiên bản aggregate, không mặc định bằng 1 cho mọi event. |
| correlationId | Chuỗi 1–128 ký tự để truy vết toàn bộ luồng. |
| causationId | UUID message gây ra hiệu ứng này hoặc null nếu schema cho phép. |
| requestId | UUID yêu cầu nghiệp vụ hoặc null nếu schema cho phép. |
| occurredAt | Thời điểm RFC3339, sử dụng UTC khi phát mới. |
| payload | Object đúng schema của messageType. |

AMQP message_id khớp messageId trong body. Message dùng persistent delivery, publisher confirm và mandatory routing. Mỗi consumer kiểm cả exchange, routing key, producer, kind, version và payload trước khi áp dụng.

## Bảng event

Các dòng binding dưới đây ghi cụ thể từ definitions. Nhiều queue nhận cùng event theo kiểu pub/sub. Consumer chỉ áp dụng phần nghiệp vụ mình sở hữu.

### ChargePaid

Bên gửi Billing. Bên nhận Appointment Diagnostic Pharmacy.

| Exchange | Routing key | Queue nhận |
| --- | --- | --- |
| umc.events.billing.v1 | billing.charge-paid.v1 | evt.appointment.v1 |
| umc.events.billing.v1 | billing.charge-paid.v1 | evt.diagnostic.v1 |
| umc.events.billing.v1 | billing.charge-paid.v1 | evt.pharmacy.v1 |

Payload gồm chargeId, sourceType, sourceId, sourceRevision, settlementId, fence, transactionId, amountVnd, paidAt.

chargeId, sourceType, sourceId, sourceRevision, settlementId, fence, transactionId, amountVnd, paidAt. Chốt nguồn đúng fence; cùng transaction tiền và receipt

Schema tại [billing.v1.schema.json](../contracts/messages/billing.v1.schema.json).

### AppointmentChanged

Bên gửi Appointment. Bên nhận Billing Notification.

| Exchange | Routing key | Queue nhận |
| --- | --- | --- |
| umc.events.appointment.v1 | appointment.appointment-changed.v1 | evt.billing.v1 |
| umc.events.appointment.v1 | appointment.appointment-changed.v1 | evt.notification.v1 |

Payload gồm appointmentId, patientId, recipientUserId, changeType, reasonCode?, cancellationId?, version.

appointmentId, patientId, recipientUserId, changeType, reasonCode, cancellationId, version. Thông báo; void/hoàn khi hủy hoặc hết hạn

Chưa có JSON Schema riêng trong contracts/messages. Hiện đối chiếu payload bằng CSV, publisher và consumer. Cần bổ sung schema cùng kiểm tra tương thích trước khi đổi payload.

### LabCancelled

Bên gửi Diagnostic. Bên nhận Billing Clinical.

| Exchange | Routing key | Queue nhận |
| --- | --- | --- |
| umc.events.diagnostic.v1 | diagnostic.lab-cancelled.v1 | evt.billing.v1 |
| umc.events.diagnostic.v1 | diagnostic.lab-cancelled.v1 | evt.clinical.v1 |

Payload gồm orderId, visitId, cancellationId, noSpecimen, reasonCode, version.

orderId, visitId, cancellationId, noSpecimen, reasonCode, version. Hủy order; xét lại điều kiện ký và tiền

Schema tại [lab-lifecycle.v1.schema.json](../contracts/messages/lab-lifecycle.v1.schema.json).

### LabResultPublished

Bên gửi Diagnostic. Bên nhận Clinical Notification.

| Exchange | Routing key | Queue nhận |
| --- | --- | --- |
| umc.events.diagnostic.v1 | diagnostic.lab-result-published.v1 | evt.clinical.v1 |
| umc.events.diagnostic.v1 | diagnostic.lab-result-published.v1 | evt.notification.v1 |

Payload gồm orderId, visitId, revision, publishedAt, recipientUserId, version.

orderId, visitId, revision, publishedAt, recipientUserId, version. Cập nhật kết quả đã công bố; không mang giá trị y tế vào Notification

Schema tại [lab-lifecycle.v1.schema.json](../contracts/messages/lab-lifecycle.v1.schema.json).

### PrescriptionFinalized

Bên gửi Clinical. Bên nhận Pharmacy.

| Exchange | Routing key | Queue nhận |
| --- | --- | --- |
| umc.events.clinical.v1 | clinical.prescription-finalized.v1 | evt.pharmacy.v1 |

Payload gồm prescriptionId, revision, visitId, patientId, itemsSnapshot, finalizedAt.

prescriptionId, revision, visitId, patientId, itemsSnapshot, finalizedAt. Projection toa FINAL bất biến

Schema tại [pharmacy.v1.schema.json](../contracts/messages/pharmacy.v1.schema.json).

### MedicationDispensed

Bên gửi Pharmacy. Bên nhận Notification.

| Exchange | Routing key | Queue nhận |
| --- | --- | --- |
| umc.events.pharmacy.v1 | pharmacy.medication-dispensed.v1 | evt.notification.v1 |

Payload gồm prescriptionId, revision, holdId, attemptNo, recipientUserId, dispensedAt.

prescriptionId, revision, holdId, attemptNo, recipientUserId, dispensedAt. Thông báo đã phát; không lộ tên thuốc

Schema tại [pharmacy.v1.schema.json](../contracts/messages/pharmacy.v1.schema.json).

### BillingStatusChanged

Bên gửi Billing. Bên nhận Appointment Diagnostic Pharmacy Notification.

| Exchange | Routing key | Queue nhận |
| --- | --- | --- |
| umc.events.billing.v1 | billing.billing-status-changed.v1 | evt.appointment.v1 |
| umc.events.billing.v1 | billing.billing-status-changed.v1 | evt.diagnostic.v1 |
| umc.events.billing.v1 | billing.billing-status-changed.v1 | evt.notification.v1 |
| umc.events.billing.v1 | billing.billing-status-changed.v1 | evt.pharmacy.v1 |

Payload gồm chargeId, recipientUserId, paymentId?, state, version, sourceType?, sourceId?, refundId?, refundStatus?.

Thông báo thu/hoàn và projection trạng thái nguồn. Hoàn LAB cần sourceType=LAB_ORDER; sourceId là orderId; refundId và refundStatus=REQUESTED/FAILED/SUCCEEDED. version tăng theo charge. Payload sự kiện dùng sourceId của nguồn thu; API tạo refund dùng sourceId là cancellationId.

Schema tại [billing.v1.schema.json](../contracts/messages/billing.v1.schema.json).

### MedicationHoldChanged

Bên gửi Pharmacy. Bên nhận Billing.

| Exchange | Routing key | Queue nhận |
| --- | --- | --- |
| umc.events.pharmacy.v1 | pharmacy.medication-hold-changed.v1 | evt.billing.v1 |

Payload gồm holdId, attemptNo, chargeId?, changeType, cancellationId?, version.

holdId, attemptNo, chargeId, changeType, cancellationId, version. Void/hoàn cho lần giữ cũ; không chốt attempt mới

Schema tại [pharmacy.v1.schema.json](../contracts/messages/pharmacy.v1.schema.json).

### VisitSigned

Bên gửi Clinical. Bên nhận Appointment.

| Exchange | Routing key | Queue nhận |
| --- | --- | --- |
| umc.events.clinical.v1 | clinical.visit-signed.v1 | evt.appointment.v1 |

Payload gồm visitId, appointmentId, signedAt, version.

visitId, appointmentId, signedAt, version. Chuyển appointment COMPLETED

Schema tại [clinical-diagnostic.v1.schema.json](../contracts/messages/clinical-diagnostic.v1.schema.json).

### VisitReturnReady

Bên gửi Clinical. Bên nhận Appointment.

| Exchange | Routing key | Queue nhận |
| --- | --- | --- |
| umc.events.clinical.v1 | clinical.visit-return-ready.v1 | evt.appointment.v1 |

Payload gồm visitId, appointmentId, returnRound, version.

visitId, appointmentId, returnRound, version. Tạo RETURN duy nhất

Chưa có JSON Schema riêng trong contracts/messages. Hiện đối chiếu payload bằng CSV, publisher và consumer. Cần bổ sung schema cùng kiểm tra tương thích trước khi đổi payload.

### CatalogChanged

Bên gửi Catalog. Bên nhận Appointment Clinical Diagnostic Pharmacy Billing.

| Exchange | Routing key | Queue nhận |
| --- | --- | --- |
| umc.events.catalog.v1 | catalog.catalog-changed.v1 | evt.appointment.v1 |
| umc.events.catalog.v1 | catalog.catalog-changed.v1 | evt.billing.v1 |
| umc.events.catalog.v1 | catalog.catalog-changed.v1 | evt.clinical.v1 |
| umc.events.catalog.v1 | catalog.catalog-changed.v1 | evt.diagnostic.v1 |
| umc.events.catalog.v1 | catalog.catalog-changed.v1 | evt.pharmacy.v1 |

Payload gồm entityType?, entityId?, entityVersion?, fullSnapshot?, effectiveAt, streamSequence, mode.

entityType, entityId, entityVersion, fullSnapshot, effectiveAt, streamSequence, mode. UPSERT/TOMBSTONE/CHECKPOINT; cập nhật projection tối thiểu

Schema tại [catalog.v1.schema.json](../contracts/messages/catalog.v1.schema.json).

### PatientAccessChanged

Bên gửi Patient. Bên nhận Appointment Clinical Diagnostic Pharmacy Billing.

| Exchange | Routing key | Queue nhận |
| --- | --- | --- |
| umc.events.patient.v1 | patient.patient-access-changed.v1 | evt.appointment.v1 |
| umc.events.patient.v1 | patient.patient-access-changed.v1 | evt.billing.v1 |
| umc.events.patient.v1 | patient.patient-access-changed.v1 | evt.clinical.v1 |
| umc.events.patient.v1 | patient.patient-access-changed.v1 | evt.diagnostic.v1 |
| umc.events.patient.v1 | patient.patient-access-changed.v1 | evt.pharmacy.v1 |

Payload gồm patientId, ownerUserId, active, policyVersion.

patientId, ownerUserId, active, policyVersion. Projection quyền hồ sơ; không mang bệnh án, địa chỉ hoặc BHYT

Schema tại [identity-access.v1.schema.json](../contracts/messages/identity-access.v1.schema.json).

### IdentityAccessChanged

Bên gửi Identity. Bên nhận Patient Appointment Clinical Diagnostic Pharmacy Billing Notification Catalog.

| Exchange | Routing key | Queue nhận |
| --- | --- | --- |
| umc.events.identity.v1 | identity.identity-access-changed.v1 | evt.appointment.v1 |
| umc.events.identity.v1 | identity.identity-access-changed.v1 | evt.billing.v1 |
| umc.events.identity.v1 | identity.identity-access-changed.v1 | evt.catalog.v1 |
| umc.events.identity.v1 | identity.identity-access-changed.v1 | evt.clinical.v1 |
| umc.events.identity.v1 | identity.identity-access-changed.v1 | evt.diagnostic.v1 |
| umc.events.identity.v1 | identity.identity-access-changed.v1 | evt.notification.v1 |
| umc.events.identity.v1 | identity.identity-access-changed.v1 | evt.patient.v1 |
| umc.events.identity.v1 | identity.identity-access-changed.v1 | evt.pharmacy.v1 |

Payload gồm userId, status, actorType, capabilities, tokenVersion, phoneVerified, version.

Projection quyền và trạng thái tài khoản. phoneVerified giữ nguyên tên và được bật khi xác minh OTP đăng ký qua email, không chứng minh quyền sở hữu số điện thoại. Payload không mang mật khẩu, OTP, email hoặc số điện thoại đầy đủ.

Schema tại [identity-access.v1.schema.json](../contracts/messages/identity-access.v1.schema.json).

### ChargePrepared

Bên gửi Billing. Bên nhận Appointment Diagnostic Pharmacy.

| Exchange | Routing key | Queue nhận |
| --- | --- | --- |
| umc.events.billing.v1 | billing.charge-prepared.v1 | evt.appointment.v1 |
| umc.events.billing.v1 | billing.charge-prepared.v1 | evt.diagnostic.v1 |
| umc.events.billing.v1 | billing.charge-prepared.v1 | evt.pharmacy.v1 |

Payload gồm requestId, sourceType, sourceId, sourceRevision, chargeId?, state, reasonCode?.

requestId, sourceType, sourceId, sourceRevision, chargeId, state, reasonCode. Phản hồi nghiệp vụ cho RequestCharge; state=CREATED/REJECTED

Schema tại [billing.v1.schema.json](../contracts/messages/billing.v1.schema.json).

### LabOrderResolved

Bên gửi Diagnostic. Bên nhận Clinical.

| Exchange | Routing key | Queue nhận |
| --- | --- | --- |
| umc.events.diagnostic.v1 | diagnostic.lab-order-resolved.v1 | evt.clinical.v1 |

Payload gồm requestId, visitId, state, orderId?, reasonCode?, version.

requestId, visitId, state, orderId?, reasonCode, version. CREATED/REJECTED; kết thúc pending registry an toàn

Schema tại [clinical-diagnostic.v1.schema.json](../contracts/messages/clinical-diagnostic.v1.schema.json).

### QueueTicketClaimed

Bên gửi Appointment. Bên nhận Clinical.

| Exchange | Routing key | Queue nhận |
| --- | --- | --- |
| umc.events.appointment.v1 | appointment.queue-ticket-claimed.v1 | evt.clinical.v1 |

Payload gồm requestId, ticketId, appointmentId, patientId, visitId?, claimId?, state, reasonCode?.

requestId, ticketId, appointmentId, patientId, visitId?, claimId?, state, reasonCode. ACCEPTED/REJECTED; FIRST và RETURN cùng contract

Schema tại [clinical-queue.v1.schema.json](../contracts/messages/clinical-queue.v1.schema.json).

### SettlementReserved

Bên gửi Appointment Diagnostic Pharmacy. Bên nhận Billing.

| Exchange | Routing key | Queue nhận |
| --- | --- | --- |
| umc.events.appointment.v1 | appointment.settlement-reserved.v1 | evt.billing.v1 |
| umc.events.diagnostic.v1 | diagnostic.settlement-reserved.v1 | evt.billing.v1 |
| umc.events.pharmacy.v1 | pharmacy.settlement-reserved.v1 | evt.billing.v1 |

Payload gồm settlementId, sourceId, sourceRevision, state, fence?, lockedAt?, reasonCode?.

settlementId, sourceId, sourceRevision, state, fence?, lockedAt?, reasonCode. ACCEPTED/REJECTED; owner khóa nguồn trong transaction

Schema tại [billing.v1.schema.json](../contracts/messages/billing.v1.schema.json).

### SettlementDecision

Bên gửi Billing. Bên nhận Appointment Diagnostic Pharmacy.

| Exchange | Routing key | Queue nhận |
| --- | --- | --- |
| umc.events.billing.v1 | billing.settlement-decision.v1 | evt.appointment.v1 |
| umc.events.billing.v1 | billing.settlement-decision.v1 | evt.diagnostic.v1 |
| umc.events.billing.v1 | billing.settlement-decision.v1 | evt.pharmacy.v1 |

Payload gồm settlementId, sourceId, sourceRevision, decisionVersion, state, fence?, paymentId?.

settlementId, sourceId, sourceRevision, decisionVersion, state, fence?, paymentId?. SUCCEEDED/FAILED/UNKNOWN; UNKNOWN không mở khóa

Schema tại [billing.v1.schema.json](../contracts/messages/billing.v1.schema.json).

### QueueTicketChanged

Bên gửi Appointment. Bên nhận Clinical.

| Exchange | Routing key | Queue nhận |
| --- | --- | --- |
| umc.events.appointment.v1 | appointment.queue-ticket-changed.v1 | evt.clinical.v1 |

Payload gồm ticketId, appointmentId, patientId, doctorId, doctorUserId, departmentId, ticketType, state, version, visitId?.

Snapshot từ outbox Appointment. Clinical áp dụng version tăng dần. Vé RETURN gắn visitId.

Schema tại [queue-ticket-changed.v1.schema.json](../contracts/messages/queue-ticket-changed.v1.schema.json).

### VisitDoctorGrantChanged

Bên gửi Clinical. Bên nhận Diagnostic.

| Exchange | Routing key | Queue nhận |
| --- | --- | --- |
| umc.events.clinical.v1 | clinical.visit-doctor-grant-changed.v1 | evt.diagnostic.v1 |

Payload gồm mode, sequence, watermarkOnly?, visitId?, patientId?, doctorUserId?, active?, canCancel?.

UPSERT tăng sequence khi cấp hoặc thu hồi quyền theo lượt khám. CHECKPOINT mới dùng `watermarkOnly: true`, mang watermark hiện tại và không tăng sequence. Diagnostic chỉ làm mới checkpoint khi đã áp dụng đủ dữ liệu đến watermark; thiếu dù một sequence vẫn chặn quyền. Checkpoint không xóa gap cao hơn, không đổi quyền đã thu hồi và vẫn hết hạn sau 30 giây.

Cập nhật Diagnostic consumer trước Clinical publisher. Consumer vẫn nhận checkpoint tăng sequence của bản cũ khi không có marker; không rollback consumer cũ trong khi publisher mới đang chạy. Không cần đổi HTTP API, migration hoặc env.

Schema tại [visit-doctor-grant-changed.v1.schema.json](../contracts/messages/visit-doctor-grant-changed.v1.schema.json).


## Bảng command

Mỗi command được chọn đúng một owner xử lý. ReserveSettlement chọn target theo sourceType, không gửi đồng thời đến ba owner.

### RequestCharge

Bên gửi Appointment Diagnostic Pharmacy. Bên nhận Billing.

| Exchange | Routing key | Queue nhận |
| --- | --- | --- |
| umc.commands.appointment.v1 | billing.request-charge.v1 | cmd.billing.v1 |
| umc.commands.diagnostic.v1 | billing.request-charge.v1 | cmd.billing.v1 |
| umc.commands.pharmacy.v1 | billing.request-charge.v1 | cmd.billing.v1 |

Payload gồm requestId, sourceType, sourceId, sourceRevision, patientId, recipientUserId, linesSnapshot, amountVnd, snapshotHash, expiresAt?.

ChargePrepared trả kết quả CREATED/REJECTED. expiresAt tùy chọn là thời điểm hết hạn thanh toán theo RFC3339. sourceRevision và snapshotHash cố định theo phiên bản nguồn.

Schema tại [billing.v1.schema.json](../contracts/messages/billing.v1.schema.json).

### CreateLabOrder

Bên gửi Clinical. Bên nhận Diagnostic.

| Exchange | Routing key | Queue nhận |
| --- | --- | --- |
| umc.commands.clinical.v1 | diagnostic.create-lab-order.v1 | cmd.diagnostic.v1 |

Payload gồm requestId, visitId, patientId, doctorId, testSnapshot, requestHash, authorizedAt.

requestId, visitId, patientId, doctorId, testSnapshot, requestHash, authorizedAt → LabOrderResolved

Schema tại [clinical-diagnostic.v1.schema.json](../contracts/messages/clinical-diagnostic.v1.schema.json).

### ClaimQueueTicket

Bên gửi Clinical. Bên nhận Appointment.

| Exchange | Routing key | Queue nhận |
| --- | --- | --- |
| umc.commands.clinical.v1 | appointment.claim-queue-ticket.v1 | cmd.appointment.v1 |

Payload gồm requestId, ticketId, expectedTicketVersion, doctorId, patientId.

requestId, ticketId, expectedTicketVersion, doctorId, patientId → QueueTicketClaimed

Schema tại [clinical-queue.v1.schema.json](../contracts/messages/clinical-queue.v1.schema.json).

### ReserveSettlement

Bên gửi Billing. Bên nhận Appointment Diagnostic Pharmacy theo sourceType.

| Exchange | Routing key | Queue nhận |
| --- | --- | --- |
| umc.commands.billing.v1 | appointment.reserve-settlement.v1 | cmd.appointment.v1 |
| umc.commands.billing.v1 | diagnostic.reserve-settlement.v1 | cmd.diagnostic.v1 |
| umc.commands.billing.v1 | pharmacy.reserve-settlement.v1 | cmd.pharmacy.v1 |

Payload gồm settlementId, chargeId, sourceType, sourceId, sourceRevision, amountHash, attemptVersion.

settlementId, chargeId, sourceType, sourceId, sourceRevision, amountHash, attemptVersion → SettlementReserved

Schema tại [billing.v1.schema.json](../contracts/messages/billing.v1.schema.json).

### QuerySettlement

Bên gửi Appointment Diagnostic Pharmacy. Bên nhận Billing.

| Exchange | Routing key | Queue nhận |
| --- | --- | --- |
| umc.commands.appointment.v1 | billing.query-settlement.v1 | cmd.billing.v1 |
| umc.commands.diagnostic.v1 | billing.query-settlement.v1 | cmd.billing.v1 |
| umc.commands.pharmacy.v1 | billing.query-settlement.v1 | cmd.billing.v1 |

Payload gồm requestId, settlementId, sourceType, sourceId, sourceRevision.

requestId, settlementId, sourceType, sourceId, sourceRevision → SettlementDecision

Schema tại [billing.v1.schema.json](../contracts/messages/billing.v1.schema.json).

## Luồng nghiệp vụ cần giữ thống nhất

1. Appointment, Diagnostic hoặc Pharmacy gửi RequestCharge. Billing trả ChargePrepared. Nguồn lưu chargeId cùng đúng sourceRevision.
2. Khi thu tiền, Billing gửi ReserveSettlement tới đúng owner. Owner kiểm nguồn, giữ trạng thái và trả SettlementReserved. Billing ghi giao dịch, receipt và quyết định trong transaction. ChargePaid và SettlementDecision mang bằng chứng để owner chốt đúng fence. UNKNOWN giữ trạng thái chờ đối soát.
3. Appointment gửi QueueTicketChanged. Clinical gửi ClaimQueueTicket, chờ QueueTicketClaimed ACCEPTED rồi mới tạo hoặc nhận lại visit. RETURN giữ visitId của lượt trước.
4. Clinical gửi CreateLabOrder. Diagnostic tạo order và gửi LabOrderResolved. Charge LAB dùng nguồn LAB_ORDER. Sau lấy mẫu, duyệt và công bố, LabResultPublished tới Clinical và Notification. Clinical tổng hợp trạng thái chỉ định rồi gửi VisitReturnReady cho Appointment.
5. Clinical gửi PrescriptionFinalized sau khi chốt toa. Pharmacy lưu snapshot bất biến theo prescriptionId và revision, giữ thuốc, thanh toán rồi cấp thuốc. MedicationDispensed tới Notification.
6. Diagnostic phát LabCancelled khi đủ điều kiện. Billing đối chiếu cancellationId để tạo yêu cầu hoàn. BillingStatusChanged gửi REQUESTED, FAILED, SUCCEEDED để Diagnostic cập nhật refundStatus.

sourceType ánh xạ APPOINTMENT → Appointment, LAB_ORDER → Diagnostic, MED_HOLD → Pharmacy. Đặc biệt sourceId trong API tạo refund là cancellationId. sourceId trong BillingStatusChanged là ID nguồn thu, với LAB là orderId.

## Gửi lặp, phiên bản và thứ tự

- Thay đổi DB và ghi outbox trong cùng transaction. Chỉ đánh dấu gửi xong sau publisher confirm và kiểm tra mandatory return. Crash sau confirm có thể tạo delivery lặp.
- Consumer lưu inbox cùng thay đổi nghiệp vụ trước ACK. Cùng messageId và cùng nội dung chỉ tạo hiệu ứng một lần. Cùng ID nhưng nội dung khác là xung đột cần cách ly.
- Dedupe messageId chưa đủ cho tất cả ca. Kiểm thêm requestId/requestHash, sourceId/sourceRevision, prescriptionId/revision hoặc settlementId/fence theo hợp đồng riêng.
- Hai queue khác nhau và nhiều publisher không cung cấp thứ tự nghiệp vụ toàn cục. Consumer kiểm version và chịu được event đến trễ.
- CatalogChanged dùng streamSequence. CHECKPOINT chỉ xác nhận watermark liên tục đã nhận, không tự xóa khoảng thiếu. VisitDoctorGrantChanged có sequence/checkpoint riêng. Clinical và Diagnostic kiểm độ mới của projection khi xử lý quyền hoặc giá.
- Có thể nhận kết quả LAB trước LabOrderResolved. Clinical giữ trạng thái terminal để áp dụng khi mapping order sẵn sàng. Một lượt chỉ tạo RETURN theo round hợp lệ.

## Retry và dead-letter

- Clinical và Diagnostic lưu retry vào DB, thử lại theo lịch 5, 15, 60 giây cộng jitter. Lỗi dependency được retry, message sai nguồn/schema hoặc xung đột được cách ly.
- Các owner khác đối chiếu cấu hình retry trong worker của mình. Cần nghiệm thu timeout, reconnect, retry và giới hạn số lần theo runtime thực tế.
- Dead-letter nghiệp vụ lưu trong bảng/collection lỗi của consumer. Bản cảnh báo có thể được phát qua umc.deadletters.<owner>.v1 đến dlq.<owner>.v1. Cấu trúc cảnh báo kỹ thuật không phải envelope nghiệp vụ bên trên.
- Giữ bản lỗi và đối chiếu inbox cùng hiệu ứng nghiệp vụ trước khi phát lại. Inbox DEAD cần quy trình mở lại có kiểm soát, gửi lại cùng ID trực tiếp có thể bị bỏ qua.
- Đọc [quy trình nghiệm thu và đối soát dead-letter](../tests/e2e/care-integration.md) trước khi thao tác vhost nhóm.

## Bảo mật và cấu hình

- Broker ACL giới hạn quyền publish/consume theo owner. JWT dùng bảo vệ HTTP, còn nguồn message được kiểm bằng broker ACL cùng envelope và binding.
- Event quyền chỉ mang dữ liệu projection cần thiết. Notification nhận ID và metadata, không nhận bệnh án, giá trị xét nghiệm hoặc tên thuốc.
- Dùng rediss cho Redis chung của Quân và namespace cache theo service. Redis hỗ trợ cache, không tham gia hợp đồng event/command RabbitMQ.
- Các biến dùng trong tiến trình Huy được mô tả tại [env/README.md](../env/README.md). Giữ credential thật trong file env được Git bỏ qua.

## Checklist nghiệm thu

- Đối chiếu đầy đủ exchange, binding và queue trên cùng vhost. Xác nhận consumer của từng queue đang chạy.
- Với một lượt demo mới, ghi correlationId, requestId, messageId, aggregateId và version. Đối chiếu outbox publisher với inbox consumer và trạng thái nghiệp vụ.
- Kiểm message lặp, sai producer, sai schema, event cũ và event đến đảo thứ tự. Không tạo thêm lần thu, hoàn tiền, cấp thuốc hoặc RETURN.
- Kiểm ngắt broker sau DB commit và trước confirm, sau đó reconnect. Outbox còn gửi được và consumer xử lý lặp an toàn.
- Kiểm bác sĩ đúng lượt, bác sĩ khác và quyền bị thu hồi. Kiểm freshness của Catalog và visit grant khi worker dừng.
- Hoàn tất ca không LAB, có LAB, hủy/hoàn LAB và cấp thuốc. Phản hồi health hoặc publish confirm đơn lẻ chỉ xác nhận bước tương ứng.
