import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PatientRecordsRoute } from '../src/features/clinical/PatientRecordsRoute';
import { PriceVersionsPage } from '../src/features/catalog/PriceVersionsPage';
import type { PatientApi } from '../src/features/patient/types';
import type { ClinicalApi } from '../src/features/clinical/types';
import type { DiagnosticApi } from '../src/features/diagnostic/types';
import type { CatalogApi } from '../src/features/catalog/types';

afterEach(cleanup);
const profiles = [
  { id: 'self', fullName: 'Hồ sơ bản thân', relation: 'SELF', active: true },
  {
    id: 'other',
    fullName: 'Hồ sơ người thân',
    relation: 'OTHER',
    active: true,
  },
];
function page(profile: string) {
  const patientApi = {
    list: vi.fn().mockResolvedValue({ items: profiles, total: 2 }),
  } as unknown as PatientApi;
  const diagnostic = {
    publishedResults: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  } as unknown as DiagnosticApi;
  const clinical = {
    medicalRecords: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  } as unknown as ClinicalApi;
  render(
    <MemoryRouter
      initialEntries={['/patient/lab-results?patientId=' + profile]}
    >
      <PatientRecordsRoute
        patientApi={patientApi}
        clinicalApi={clinical}
        diagnosticApi={diagnostic}
        kind="results"
      />
    </MemoryRouter>,
  );
  return { patientApi, diagnostic, clinical };
}
it('preserves an owned OTHER profile in record API calls and navigation', async () => {
  const { diagnostic } = page('other');
  await screen.findByText('Chưa có kết quả xét nghiệm đã công bố.');
  expect(diagnostic.publishedResults).toHaveBeenCalledWith(
    'other',
    1,
    10,
    expect.any(AbortSignal),
  );
  expect(
    screen.getByRole('link', { name: 'Đơn thuốc' }).getAttribute('href'),
  ).toBe('/patient/medical-records?patientId=other');
  expect(
    screen
      .getByRole('link', { name: 'Quay lại lịch khám' })
      .getAttribute('href'),
  ).toBe('/patient/appointments?patientId=other');
  fireEvent.change(screen.getByLabelText('Hồ sơ người khám'), {
    target: { value: 'self' },
  });
  await waitFor(() =>
    expect(diagnostic.publishedResults).toHaveBeenLastCalledWith(
      'self',
      1,
      10,
      expect.any(AbortSignal),
    ),
  );
});
it('does not silently replace an unauthorized profile with the first patient', async () => {
  const { diagnostic, clinical } = page('not-owned');
  await screen.findByText(/Hồ sơ trên đường dẫn không thuộc/);
  expect(diagnostic.publishedResults).not.toHaveBeenCalled();
  expect(clinical.medicalRecords).not.toHaveBeenCalled();
});
it('blocks non-admin access to price history and the price form without loading restricted data', () => {
  const api = {
    priceHistory: vi.fn(),
    services: vi.fn(),
    medicines: vi.fn(),
    labTests: vi.fn(),
  } as unknown as CatalogApi;
  render(
    <PriceVersionsPage
      api={api}
      session={{ actorType: 'STAFF', capabilities: ['LAB_TECH'] }}
    />,
  );
  expect(screen.getByRole('alert').textContent).toContain('ADMIN');
  expect(api.priceHistory).not.toHaveBeenCalled();
  expect(api.services).not.toHaveBeenCalled();
});
it('reads actual price revisions and filters history on the server', async () => {
  const api = {
    services: vi.fn().mockResolvedValue([]),
    medicines: vi.fn().mockResolvedValue([]),
    labTests: vi.fn().mockResolvedValue([]),
    priceHistory: vi.fn().mockResolvedValue({
      items: [
        {
          priceVersionId: 'price-2',
          itemId: 'item',
          itemCode: 'LAB01',
          itemName: 'Xét nghiệm trong phản hồi',
          itemType: 'LAB',
          revision: 2,
          amountVnd: 25000,
          effectiveFrom: '2030-01-01T00:00:00Z',
        },
      ],
      total: 1,
    }),
  } as unknown as CatalogApi;
  render(
    <PriceVersionsPage
      api={api}
      session={{ actorType: 'STAFF', capabilities: ['ADMIN'] }}
    />,
  );
  await screen.findByText('Xét nghiệm trong phản hồi');
  expect(screen.getByText('v2')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Loại danh mục'), {
    target: { value: 'LAB' },
  });
  await waitFor(() =>
    expect(api.priceHistory).toHaveBeenLastCalledWith(
      { itemType: 'LAB', page: 1, limit: 20 },
      expect.any(AbortSignal),
    ),
  );
});
