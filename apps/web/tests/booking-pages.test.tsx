import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BookingReview } from '../src/features/appointment/pages/BookingReview';
import { MyAppointments } from '../src/features/appointment/pages/MyAppointments';
import { AppointmentDetail } from '../src/features/appointment/pages/AppointmentDetail';
import { useAppointmentPolling } from '../src/features/appointment/hooks/useAppointmentPolling';
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
          {
            pathname: '/patient/appointments/review',
            search: '?patientId=patient-1&holdId=hold-1',
            state: {
              patientId: 'patient-1',
              holdId: 'hold-1',
              expiresAt: '2099-01-01T00:00:00Z',
              amountVnd: 175000,
            },
          },
        ]}
      >
        <BookingReview api={appointmentApi} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận tạo lịch' }));
    await waitFor(() =>
      expect(appointmentApi.createAppointment).toHaveBeenCalledWith(
        { patientId: 'patient-1', holdId: 'hold-1' },
        expect.any(String),
      ),
    );
    expect(await screen.findByText(/Đã tạo lịch chờ thanh toán/)).toBeTruthy();
    expect(screen.queryByText(/Phí khám đã thanh toán/)).toBeNull();
  });

  it('requires real hold details and shows no demo price on a direct link', () => {
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
    expect(screen.getByText('Thiếu thông tin giữ chỗ')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Xác nhận tạo lịch' }),
    ).toBeNull();
  });

  it('handles simulate payment flow with BillingApi and confirms appointment', async () => {
    const appointmentApi = api();
    const billing = mockBillingApi();
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/patient/appointments/review',
            search: '?patientId=patient-1&holdId=hold-1',
            state: {
              patientId: 'patient-1',
              holdId: 'hold-1',
              expiresAt: '2099-01-01T00:00:00Z',
              amountVnd: 175000,
            },
          },
        ]}
      >
        <BookingReview api={appointmentApi} billingApi={billing} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận tạo lịch' }));

    await waitFor(() => {
      expect(appointmentApi.createAppointment).toHaveBeenCalledTimes(1);
      expect(billing.simulatePayment).toHaveBeenCalledWith(
        { chargeId: 'charge-1', transactionId: expect.any(String) },
        expect.any(String),
        expect.any(AbortSignal),
      );
    });

    expect(
      await screen.findByRole('button', { name: 'Xem lịch khám của tôi →' }),
    ).toBeTruthy();
  });

  it('handles counter payment method: creates appointment in waiting counter state', async () => {
    const appointmentApi = api();
    const billing = mockBillingApi();
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/patient/appointments/review',
            search: '?patientId=patient-1&holdId=hold-1',
            state: {
              patientId: 'patient-1',
              holdId: 'hold-1',
              expiresAt: '2099-01-01T00:00:00Z',
              amountVnd: 175000,
            },
          },
        ]}
      >
        <BookingReview api={appointmentApi} billingApi={billing} />
      </MemoryRouter>,
    );

    // Chọn phương thức thanh toán tại quầy
    fireEvent.click(screen.getByText('Thanh toán tại quầy'));
    fireEvent.click(screen.getByRole('checkbox'));

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
    expect(
      await screen.findByRole('button', { name: 'Xem lịch chờ thanh toán →' }),
    ).toBeTruthy();
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
          {
            pathname: '/patient/appointments/review',
            search: '?patientId=patient-1&holdId=hold-1',
            state: {
              patientId: 'patient-1',
              holdId: 'hold-1',
              expiresAt: '2099-01-01T00:00:00Z',
              amountVnd: 175000,
            },
          },
        ]}
      >
        <BookingReview api={appointmentApi} billingApi={billing} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận tạo lịch' }));

    expect(
      await screen.findByRole('button', { name: 'Thử lại thanh toán' }),
    ).toBeTruthy();
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

  it('continues polling a cancelled appointment until the refund succeeds', async () => {
    vi.useFakeTimers();
    const getAppointment = vi
      .fn()
      .mockResolvedValueOnce({
        appointmentId: 'apt-1',
        state: 'CANCELLED',
        refundStatus: 'REQUESTED',
      })
      .mockResolvedValueOnce({
        appointmentId: 'apt-1',
        state: 'CANCELLED',
        refundStatus: 'FAILED',
      })
      .mockResolvedValueOnce({
        appointmentId: 'apt-1',
        state: 'CANCELLED',
        refundStatus: 'SUCCEEDED',
      });
    const appointmentApi = api({ getAppointment });
    try {
      const { result, unmount } = renderHook(() =>
        useAppointmentPolling(appointmentApi, 'apt-1'),
      );
      await act(async () => {});
      expect(result.current.data?.refundStatus).toBe('REQUESTED');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(result.current.data?.refundStatus).toBe('FAILED');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(result.current.data?.refundStatus).toBe('SUCCEEDED');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(getAppointment).toHaveBeenCalledTimes(3);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops polling after a terminal appointment state', async () => {
    const appointmentApi = api();
    render(
      <MemoryRouter initialEntries={['/patient/appointments/apt-1']}>
        <AppointmentDetail api={appointmentApi} />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Đã xác nhận')).toBeTruthy();
    expect(appointmentApi.getAppointment).toHaveBeenCalledTimes(1);
  });
});
