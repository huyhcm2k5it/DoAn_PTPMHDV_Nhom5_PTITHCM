import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BookingReview } from '../src/features/appointment/pages/BookingReview';
import { MyAppointments } from '../src/features/appointment/pages/MyAppointments';
import { AppointmentDetail } from '../src/features/appointment/pages/AppointmentDetail';
import type { AppointmentApi } from '../src/features/appointment/types';
import type { BillingApi } from '../src/features/billing/types';

afterEach(cleanup);

function api(overrides: Partial<AppointmentApi> = {}): AppointmentApi {
  return {
    listAvailable: vi.fn(),
    createHold: vi.fn(),
    releaseHold: vi.fn(),
    createAppointment: vi
      .fn()
      .mockResolvedValue({ appointmentId: 'apt-1', state: 'PENDING_PAYMENT' }),
    getAppointment: vi.fn().mockResolvedValue({
      appointmentId: 'apt-1',
      state: 'CONFIRMED',
      appointment: { state: 'CONFIRMED', patientId: 'patient-1' },
      chargeSync: 'CREATED',
      chargeStatus: 'PAID',
    }),
    listAppointments: vi.fn().mockResolvedValue({
      items: [
        {
          appointmentId: 'apt-1',
          state: 'PENDING_PAYMENT',
          chargeSync: 'PENDING',
        },
      ],
      total: 1,
    }),
    ...overrides,
  };
}

function mockBillingApi(overrides: Partial<BillingApi> = {}): BillingApi {
  return {
    getPatientCharges: vi.fn().mockResolvedValue({
      items: [
        {
          id: 'charge-1',
          patientId: 'patient-1',
          sourceType: 'APPOINTMENT',
          sourceId: 'apt-1',
          sourceRevision: 1,
          amountVnd: 150000,
          state: 'OPEN',
          settlementState: 'UNSETTLED',
          createdAt: new Date().toISOString(),
        },
      ],
      total: 1,
    }),
    getCharges: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    getCharge: vi.fn(),
    simulatePayment: vi.fn().mockResolvedValue({
      requestId: 'req-1',
      paymentId: 'pay-1',
      state: 'SUCCEEDED',
    }),
    counterPayment: vi.fn().mockResolvedValue({
      requestId: 'req-1',
      paymentId: 'pay-1',
      state: 'SUCCEEDED',
    }),
    getReceipt: vi.fn(),
    createRefund: vi.fn(),
    executeRefund: vi.fn(),
    listRefunds: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    getReportSummary: vi.fn(),
    ...overrides,
  };
}

describe('appointment booking screens', () => {
  it('confirms a held slot with one appointment request', async () => {
    const appointmentApi = api();
    render(
      <MemoryRouter
        initialEntries={[
          '/patient/appointments/review?patientId=patient-1&holdId=hold-1',
        ]}
      >
        <BookingReview api={appointmentApi} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận tạo lịch' }));
    await waitFor(() =>
      expect(appointmentApi.createAppointment).toHaveBeenCalledWith(
        { patientId: 'patient-1', holdId: 'hold-1' },
        expect.any(String),
      ),
    );
  });

  it('handles simulate payment flow with BillingApi and confirms appointment', async () => {
    const appointmentApi = api();
    const billing = mockBillingApi();
    render(
      <MemoryRouter
        initialEntries={[
          '/patient/appointments/review?patientId=patient-1&holdId=hold-1',
        ]}
      >
        <BookingReview api={appointmentApi} billingApi={billing} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận tạo lịch' }));

    await waitFor(() => {
      expect(appointmentApi.createAppointment).toHaveBeenCalledTimes(1);
      expect(billing.simulatePayment).toHaveBeenCalledWith(
        { chargeId: 'charge-1', transactionId: expect.any(String) },
        expect.any(String),
      );
    });

    expect(await screen.findByRole('button', { name: 'Xem lịch khám của tôi →' })).toBeTruthy();
  });

  it('handles counter payment method: creates appointment in waiting counter state', async () => {
    const appointmentApi = api();
    const billing = mockBillingApi();
    render(
      <MemoryRouter
        initialEntries={[
          '/patient/appointments/review?patientId=patient-1&holdId=hold-1',
        ]}
      >
        <BookingReview api={appointmentApi} billingApi={billing} />
      </MemoryRouter>,
    );

    // Chọn phương thức thanh toán tại quầy
    fireEvent.click(screen.getByText('Thanh toán tại quầy'));

    // Bấm Tạo lịch chờ thanh toán
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận tạo lịch' }));

    await waitFor(() => {
      expect(appointmentApi.createAppointment).toHaveBeenCalledWith(
        { patientId: 'patient-1', holdId: 'hold-1' },
        expect.any(String),
      );
    });

    // Không gọi simulate payment
    expect(billing.simulatePayment).not.toHaveBeenCalled();

    // Hiển thị nút Xem lịch chờ thanh toán
    expect(await screen.findByRole('button', { name: 'Xem lịch chờ thanh toán →' })).toBeTruthy();
  });

  it('handles simulate payment failure and allows retry', async () => {
    const appointmentApi = api();
    const billing = mockBillingApi({
      simulatePayment: vi.fn().mockResolvedValue({
        requestId: 'req-1',
        paymentId: 'pay-1',
        state: 'FAILED',
      }),
    });

    render(
      <MemoryRouter
        initialEntries={[
          '/patient/appointments/review?patientId=patient-1&holdId=hold-1',
        ]}
      >
        <BookingReview api={appointmentApi} billingApi={billing} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận tạo lịch' }));

    expect(await screen.findByRole('button', { name: 'Thử lại thanh toán' })).toBeTruthy();
  });

  it('loads the patient list and renders a link to detail', async () => {
    const appointmentApi = api();
    render(
      <MemoryRouter>
        <MyAppointments api={appointmentApi} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Mã hồ sơ bệnh nhân'), {
      target: { value: 'patient-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tải lịch hẹn' }));
    expect(await screen.findByText('apt-1')).toBeTruthy();
    expect(appointmentApi.listAppointments).toHaveBeenCalledWith('patient-1');
  });

  it('stops polling after a terminal appointment state', async () => {
    const appointmentApi = api();
    render(
      <MemoryRouter initialEntries={['/patient/appointments/apt-1']}>
        <AppointmentDetail api={appointmentApi} />
      </MemoryRouter>,
    );
    expect(await screen.findByText('CONFIRMED')).toBeTruthy();
    expect(appointmentApi.getAppointment).toHaveBeenCalledTimes(1);
  });
});
