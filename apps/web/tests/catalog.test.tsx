import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CatalogPage } from '../src/features/catalog/CatalogPage';
import { createCatalogApi, ApiError } from '../src/features/catalog/api';
import type {
  CatalogApi,
  MedicalService,
} from '../src/features/catalog/types';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const mockService: MedicalService = {
  id: '00000000-0000-4000-8000-000000000201',
  departmentId: 'd1',
  code: 'EXAM',
  name: 'Khám tổng quát',
  status: 'ACTIVE',
  price: {
    itemType: 'EXAM',
    itemId: '00000000-0000-4000-8000-000000000201',
    amountVnd: 150000,
    effectiveFrom: '2026-01-01T00:00:00Z',
    priceVersionId: 'pv1',
    revision: 1,
  },
};

function createMockApi(): CatalogApi {
  return {
    departments: vi.fn().mockResolvedValue([
      { id: 'd1', code: 'K1', name: 'Khoa Nội', status: 'ACTIVE' },
      { id: 'd2', code: 'K2', name: 'Khoa Ngoại', status: 'ACTIVE' },
    ]),
    doctors: vi.fn().mockResolvedValue({
      items: [
        {
          id: 'doc1',
          departmentId: 'd1',
          displayName: 'BS. Nguyễn Văn A',
          status: 'ACTIVE',
        },
      ],
      total: 1,
    }),
    services: vi.fn().mockResolvedValue([mockService]),
    medicines: vi.fn().mockResolvedValue([]),
    labTests: vi.fn().mockResolvedValue([]),
    createPrice: vi.fn().mockResolvedValue({
      priceVersionId: 'p1',
      revision: 2,
      effectiveFrom: '2030-01-01T00:00:00Z',
    }),
  };
}

describe('Catalog Screen', () => {
  it('renders departments, doctors, services with effective price and triggers selection', async () => {
    const api = createMockApi();
    const onChooseDoctor = vi.fn();
    const onChooseService = vi.fn();

    render(
      <CatalogPage
        api={api}
        onChooseDoctor={onChooseDoctor}
        onChooseService={onChooseService}
      />,
    );

    expect(screen.getByRole('status').textContent).toContain('Đang tải');

    await screen.findByText('BS. Nguyễn Văn A');
    expect(screen.getByText('Khám tổng quát')).toBeTruthy();
    expect(screen.getByText('150.000 ₫')).toBeTruthy();

    const chooseDoctorBtn = screen.getByRole('button', {
      name: 'Chọn BS. Nguyễn Văn A',
    });
    fireEvent.click(chooseDoctorBtn);
    expect(onChooseDoctor).toHaveBeenCalledWith('doc1');

    const chooseServiceBtn = screen.getByRole('button', {
      name: 'Chọn dịch vụ',
    });
    fireEvent.click(chooseServiceBtn);
    expect(onChooseService).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000201',
    );
  });

  it('hides admin price form and restricted tabs for PATIENT role', async () => {
    const api = createMockApi();
    render(
      <CatalogPage
        api={api}
        session={{ actorType: 'PATIENT', capabilities: [] }}
      />,
    );

    await screen.findByText('BS. Nguyễn Văn A');
    expect(
      screen.queryByRole('button', { name: 'Tạo phiên bản giá' }),
    ).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Thuốc' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Xét nghiệm' })).toBeNull();
  });

  it('shows staff tabs and price form for STAFF with ADMIN capability', async () => {
    const api = createMockApi();
    render(
      <CatalogPage
        api={api}
        session={{ actorType: 'STAFF', capabilities: ['ADMIN'] }}
      />,
    );

    await screen.findByText('BS. Nguyễn Văn A');
    expect(screen.getByRole('tab', { name: 'Thuốc' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Xét nghiệm' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Tạo phiên bản giá' }),
    ).toBeTruthy();
  });
});

describe('Catalog Api Contract', () => {
  it('formats doctors query and passes cancellation', async () => {
    const transport = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { items: [], total: 0 },
          meta: { correlationId: 'c' },
        }),
      ),
    );
    const controller = new AbortController();
    const api = createCatalogApi(transport);
    const result = await api.doctors('dept-1', 2, controller.signal);

    expect(result).toEqual({ items: [], total: 0 });
    expect(transport).toHaveBeenCalledWith(
      '/api/v1/doctors?departmentId=dept-1&page=2&limit=20',
      { signal: controller.signal },
    );
  });

  it('attaches Idempotency-Key and JSON body for createPrice', async () => {
    const transport = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            priceVersionId: 'p1',
            revision: 1,
            effectiveFrom: '2026-06-01',
          },
        }),
      ),
    );
    const api = createCatalogApi(transport);
    await api.createPrice(
      {
        itemType: 'EXAM',
        itemId: 'srv-1',
        amountVnd: 200000,
        effectiveFrom: '2026-06-01T00:00:00Z',
      },
      'idem-uuid-1234',
    );

    expect(transport).toHaveBeenCalledWith('/api/v1/prices', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem-uuid-1234',
      },
      body: JSON.stringify({
        itemType: 'EXAM',
        itemId: 'srv-1',
        amountVnd: 200000,
        effectiveFrom: '2026-06-01T00:00:00Z',
      }),
    });
  });
});
