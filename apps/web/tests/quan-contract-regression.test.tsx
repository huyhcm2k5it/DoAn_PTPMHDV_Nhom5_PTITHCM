import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { AppointmentDetail } from '../src/features/appointment/pages/AppointmentDetail';
import { AdminSummary } from '../src/features/appointment/pages/AdminSummary';
import { BookingReview } from '../src/features/appointment/pages/BookingReview';
import { createAppointmentApi } from '../src/features/appointment/api';
import { createPatientApi } from '../src/features/patient/api';
import type { AppointmentApi } from '../src/features/appointment/types';
import type { CatalogApi } from '../src/features/catalog/types';
import type { BillingApi } from '../src/features/billing/types';

afterEach(cleanup);
const detail = {
  appointmentId: 'apt',
  state: 'COMPLETED',
  appointment: {
    id: 'apt',
    patientId: 'patient',
    state: 'COMPLETED',
    version: 4,
  },
  chargeSync: { state: 'CREATED', chargeId: 'charge' },
  chargeStatus: 'PAID',
};
it('renders the real AP-011 chargeSync object without crashing', async () => {
  const api = {
    getAppointment: vi.fn().mockResolvedValue(detail),
  } as unknown as AppointmentApi;
  render(
    <MemoryRouter>
      <AppointmentDetail api={api} />
    </MemoryRouter>,
  );
  expect(await screen.findByText('CREATED')).toBeTruthy();
  expect(
    screen.getByRole('heading', { name: 'Chi tiết lịch khám' }),
  ).toBeTruthy();
});
it('renders the AP-019 flat metrics and sends an exclusive date range', async () => {
  const transport = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        data: {
          booked: 7,
          cancelled: 1,
          checkedIn: 4,
          completed: 3,
          asOf: '2026-11-27T06:00:00Z',
        },
      }),
    ),
  );
  const api = createAppointmentApi(transport);
  await api.getAdminSummary!('2026-11-27');
  expect(transport.mock.calls[0][0]).toContain('date=2026-11-27');
  expect(transport.mock.calls[0][0]).toContain('from=2026-11-27&to=2026-11-28');
  const apiMock = {
    getAdminSummary: vi.fn().mockResolvedValue({
      booked: 7,
      cancelled: 1,
      checkedIn: 4,
      completed: 3,
      asOf: '2026-11-27T06:00:00Z',
    }),
  } as unknown as AppointmentApi;
  const billing = vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          data: {
            receivedVnd: 125000,
            refundedVnd: 0,
            asOf: '2026-11-27T06:00:00Z',
          },
        }),
      ),
    ),
  );
  render(
    <MemoryRouter>
      <AdminSummary
        api={apiMock}
        catalog={
          { services: vi.fn().mockResolvedValue([]) } as unknown as CatalogApi
        }
        transport={billing}
      />
    </MemoryRouter>,
  );
  expect(await screen.findByText('7')).toBeTruthy();
  expect(screen.getByText('Lịch được đặt')).toBeTruthy();
  expect(screen.queryByText('Cannot read')).toBeNull();
});
it('keeps patient mutation idempotency across network retry but changes it for a new intent', async () => {
  const transport = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('network lost'))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { patient: { id: 'patient' } } })),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { patient: { id: 'patient' } } })),
    );
  const api = createPatientApi(transport);
  const input = {
    relation: 'OTHER' as const,
    fullName: 'Demo Patient',
    birthDate: '1990-01-01',
    sex: 'FEMALE',
  };
  await expect(api.create!(input)).rejects.toThrow('network lost');
  await api.create!(input);
  await api.create!({ ...input, fullName: 'Another Demo' });
  const key = (n: number) =>
    (transport.mock.calls[n][1].headers as Record<string, string>)[
      'Idempotency-Key'
    ];
  expect(key(0)).toBe(key(1));
  expect(key(2)).not.toBe(key(1));
  expect(JSON.parse(transport.mock.calls[1][1].body).sex).toBe('FEMALE');
});
it('pays only the exact appointment charge and waits for Appointment confirmation after 202', async () => {
  let finish!: (v: unknown) => void;
  const confirmed = new Promise((resolve) => {
    finish = resolve;
  });
  const api = {
    createAppointment: vi
      .fn()
      .mockResolvedValue({ appointmentId: 'apt', state: 'PENDING_PAYMENT' }),
    getAppointment: vi.fn().mockReturnValue(confirmed),
  } as unknown as AppointmentApi;
  const billing = {
    getPatientCharges: vi.fn().mockResolvedValue({
      items: [
        { id: 'wrong', sourceType: 'LAB_ORDER', sourceId: 'other' },
        { id: 'right', sourceType: 'APPOINTMENT', sourceId: 'apt' },
      ],
      total: 2,
    }),
    simulatePayment: vi
      .fn()
      .mockResolvedValue({ state: 'PENDING', paymentId: 'pay' }),
  } as unknown as BillingApi;
  render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: '/patient/appointments/review',
          search: '?patientId=patient&holdId=hold',
          state: {
            patientId: 'patient',
            holdId: 'hold',
            expiresAt: '2099-01-01T00:00:00Z',
            amountVnd: 175000,
          },
        },
      ]}
    >
      <BookingReview api={api} billingApi={billing} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận tạo lịch' }));
  await waitFor(() =>
    expect(billing.simulatePayment).toHaveBeenCalledWith(
      { chargeId: 'right', transactionId: expect.any(String) },
      expect.any(String),
      expect.any(AbortSignal),
    ),
  );
  expect(
    screen.queryByRole('button', { name: 'Xem lịch khám của tôi →' }),
  ).toBeNull();
  await act(async () => finish({ appointmentId: 'apt', state: 'CONFIRMED' }));
  expect(
    await screen.findByRole('button', { name: 'Xem lịch khám của tôi →' }),
  ).toBeTruthy();
});
