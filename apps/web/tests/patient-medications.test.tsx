import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { PatientMedicationStatus } from '../src/features/pharmacy/pages/PatientMedicationStatus';
import type { PharmacyApi } from '../src/features/pharmacy/types';
import type { PatientApi } from '../src/features/patient/types';
import type { ClinicalApi } from '../src/features/clinical/types';

afterEach(cleanup);
const profiles = [
  {
    id: 'self',
    fullName: 'Demo Self',
    relation: 'SELF',
    birthDate: '1990-01-01',
  },
  {
    id: 'other',
    fullName: 'Demo Other',
    relation: 'OTHER',
    birthDate: '2000-01-01',
  },
];
const patientApi = {
  list: vi.fn().mockResolvedValue({ items: profiles, total: 2 }),
} as unknown as PatientApi;
const rx = {
  id: 'rx-final',
  patientId: 'self',
  visitId: 'visit',
  state: 'FINAL',
  revision: 1,
  version: 1,
  lines: [
    {
      medicineCode: 'MED-01',
      nameSnapshot: 'Paracetamol',
      quantity: 2,
      doseText: '1/day',
    },
  ],
};
const record = { visit: { id: 'visit', state: 'SIGNED' }, prescriptions: [rx] };
function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}
it('lets patients choose a signed prescription rather than requiring an opaque code', async () => {
  const detail = vi.fn().mockResolvedValue({
    prescriptionId: 'rx-final',
    latestHoldState: 'DISPENSED',
    dispensedAt: '2026-11-27T06:00:00Z',
  });
  render(
    <MemoryRouter>
      <PatientMedicationStatus
        api={{ detail } as unknown as PharmacyApi}
        patientApi={patientApi}
        clinicalApi={
          {
            medicalRecords: vi
              .fn()
              .mockResolvedValue({ items: [record], total: 1 }),
          } as unknown as ClinicalApi
        }
      />
      <Location />
    </MemoryRouter>,
  );
  expect(
    screen.getByRole('heading', { name: 'Đơn thuốc của tôi' }),
  ).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: /Toa #RX-FINAL/ }));
  expect(await screen.findByText('Đã cấp phát')).toBeTruthy();
  expect(screen.getByText('Paracetamol')).toBeTruthy();
  expect(screen.getByTestId('location').textContent).toContain(
    'prescriptionId=rx-final',
  );
  expect(detail).toHaveBeenCalledWith(
    'rx-final',
    undefined,
    expect.any(AbortSignal),
  );
});
it('clears the old prescription and hides its medicines when switching profiles', async () => {
  const records = vi.fn().mockImplementation((id: string) =>
    Promise.resolve({
      items: id === 'self' ? [record] : [],
      total: id === 'self' ? 1 : 0,
    }),
  );
  render(
    <MemoryRouter initialEntries={['/?patientId=self&prescriptionId=rx-final']}>
      <PatientMedicationStatus
        api={
          {
            detail: vi.fn().mockResolvedValue({
              prescriptionId: 'rx-final',
              latestHoldState: 'DISPENSED',
              dispensedAt: null,
            }),
          } as unknown as PharmacyApi
        }
        patientApi={patientApi}
        clinicalApi={{ medicalRecords: records } as unknown as ClinicalApi}
      />
      <Location />
    </MemoryRouter>,
  );
  await screen.findByText('Paracetamol');
  fireEvent.change(screen.getByLabelText('Chọn hồ sơ để xem đơn thuốc'), {
    target: { value: 'other' },
  });
  expect(screen.queryByText('Paracetamol')).toBeNull();
  expect(screen.getByTestId('location').textContent).not.toContain(
    'prescriptionId',
  );
  await waitFor(() =>
    expect(records).toHaveBeenCalledWith(
      'other',
      1,
      10,
      expect.any(AbortSignal),
    ),
  );
});
it('supports direct prescription links without assuming that they belong to the default profile', async () => {
  render(
    <MemoryRouter initialEntries={['/?prescriptionId=linked-rx']}>
      <PatientMedicationStatus
        api={
          {
            detail: vi.fn().mockResolvedValue({
              prescriptionId: 'linked-rx',
              latestHoldState: 'COMMITTED',
              dispensedAt: null,
            }),
          } as unknown as PharmacyApi
        }
        patientApi={patientApi}
        clinicalApi={{ medicalRecords: vi.fn() } as unknown as ClinicalApi}
      />
    </MemoryRouter>,
  );
  expect(await screen.findByText('Sẵn sàng cấp phát')).toBeTruthy();
  expect(screen.getByText('Toa thuốc từ liên kết tra cứu')).toBeTruthy();
  expect(
    (screen.getByLabelText('Chọn hồ sơ để xem đơn thuốc') as HTMLSelectElement)
      .value,
  ).toBe('');
});
