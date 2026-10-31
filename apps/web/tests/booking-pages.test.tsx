import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { BookingReview } from '../src/features/appointment/pages/BookingReview';
import { MyAppointments } from '../src/features/appointment/pages/MyAppointments';
import { AppointmentDetail } from '../src/features/appointment/pages/AppointmentDetail';
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
      items: [{ appointmentId: 'apt-1', state: 'PENDING_PAYMENT', chargeSync: 'PENDING' }],
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
        initialEntries={['/patient/appointments/review?patientId=patient-1&holdId=hold-1']}
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
