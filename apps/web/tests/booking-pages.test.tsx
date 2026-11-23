import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { BookingReview } from '../src/features/appointment/pages/BookingReview';
import { MyAppointments } from '../src/features/appointment/pages/MyAppointments';
import { AppointmentDetail } from '../src/features/appointment/pages/AppointmentDetail';
import { useAppointmentPolling } from '../src/features/appointment/hooks/useAppointmentPolling';
import type { AppointmentApi } from '../src/features/appointment/types';

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
    expect(await screen.findByText('CONFIRMED')).toBeTruthy();
    expect(appointmentApi.getAppointment).toHaveBeenCalledTimes(1);
  });
});
