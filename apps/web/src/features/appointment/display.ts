const time = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Asia/Ho_Chi_Minh',
});
export function formatAppointmentTime(value: unknown) {
  const date = new Date(typeof value === 'string' ? value : '');
  return Number.isFinite(date.getTime())
    ? time.format(date)
    : 'Chưa có thông tin';
}
export const appointmentLabels: Record<string, string> = {
  CONFIRMED: 'Đã xác nhận',
  PENDING_PAYMENT: 'Chờ thanh toán',
  CHECKED_IN: 'Đã tiếp nhận',
  IN_PROGRESS: 'Đang khám',
  COMPLETED: 'Đã hoàn thành',
  CANCELLED: 'Đã hủy',
  EXPIRED: 'Đã hết hạn',
  NO_SHOW: 'Vắng mặt',
};
