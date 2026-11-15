MESSAGES = {
    "AppointmentChanged": ("appointmentId", "Lịch khám có cập nhật"),
    "BillingStatusChanged": ("chargeId", "Viện phí có cập nhật"),
    "LabResultPublished": ("orderId", "Có kết quả xét nghiệm mới"),
    "MedicationDispensed": ("prescriptionId", "Đã cấp phát đơn thuốc"),
}
BODY = "Mở ứng dụng để xem trạng thái đã được hệ thống xác nhận."


def present(message_code, subject_ref):
    field, title = MESSAGES[message_code]
    return title, BODY, {field: subject_ref}
