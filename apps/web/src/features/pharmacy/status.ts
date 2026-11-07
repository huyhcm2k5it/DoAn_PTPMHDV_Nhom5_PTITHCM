import type { HoldState } from './types';
export const statusLabel: Record<HoldState, string> = {
  NOT_HELD: 'Chưa giữ thuốc',
  HELD: 'Đang giữ thuốc',
  SETTLEMENT_LOCKED: 'Đang xác nhận thanh toán',
  COMMITTED: 'Sẵn sàng cấp phát',
  DISPENSED: 'Đã cấp phát',
  RELEASED: 'Đã nhả thuốc',
  EXPIRED: 'Đã hết hạn giữ',
};
