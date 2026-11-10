import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { createPharmacyApi } from '../src/features/pharmacy/api';
import { StockPage } from '../src/features/pharmacy/pages/StockPage';
import { PrescriptionDetail } from '../src/features/pharmacy/pages/PrescriptionDetail';
import type {
  PharmacyApi,
  PrescriptionDetail as Detail,
} from '../src/features/pharmacy/types';
afterEach(cleanup);
const held: Detail = {
  prescriptionId: 'rx',
  revision: 1,
  latestHoldState: 'HELD',
  dispensedAt: null,
  view: 'PHARMACY',
  prescription: {
    id: 'rx',
    revision: 1,
    patientId: 'patient',
    itemsSnapshot: [{ medicineCode: 'MED-1', quantity: 1 }],
  },
  stock: [],
  holds: [
    {
      id: 'hold',
      prescriptionId: 'rx',
      revision: 1,
      attemptNo: 1,
      status: 'HELD',
      version: 2,
      amountVnd: 1000,
      chargeSync: 'PENDING',
      settlementState: 'NONE',
      expiresAt: '2099-01-01T00:00:00Z',
    },
  ],
};
function api(overrides: Partial<PharmacyApi> = {}): PharmacyApi {
  return {
    stock: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    receiveStock: vi.fn(),
    queue: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    detail: vi.fn().mockResolvedValue(held),
    hold: vi.fn(),
    release: vi.fn(),
    reconcile: vi.fn(),
    dispense: vi.fn(),
    ...overrides,
  };
}
describe('pharmacy UI and transport', () => {
  it('preserves caller key and body for async mutation and reports 409 with correlation', async () => {
    const transport = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            requestId: 'r',
            holdId: 'h',
            state: 'HELD',
            statusUrl: '/api/v1/pharmacy/prescriptions/rx',
          },
        }),
        { status: 202 },
      ),
    );
    const lease = vi.fn().mockResolvedValue('signed-lease');
    const client = createPharmacyApi(transport, { authorizationLease: lease });
    await client.hold('rx', 2, 'stable-key');
    expect(transport.mock.calls[0][1].headers['idempotency-key']).toBe(
      'stable-key',
    );
    expect(transport.mock.calls[0][1].headers['x-authorization-lease']).toBe(
      'signed-lease',
    );
    expect(lease).toHaveBeenCalledWith('PH005');
    expect(JSON.parse(transport.mock.calls[0][1].body)).toEqual({
      prescriptionRevision: 2,
    });
    transport.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'STATE_CONFLICT', message: 'Changed' },
          meta: { correlationId: 'trace' },
        }),
        { status: 409 },
      ),
    );
    await expect(client.hold('rx', 2, 'stable-key')).rejects.toMatchObject({
      status: 409,
      correlationId: 'trace',
    });
  });
  it('retains the same receipt key when an ambiguous request is retried', async () => {
    const client = api({
      receiveStock: vi.fn().mockRejectedValue(new Error('Network timeout')),
    });
    render(
      <MemoryRouter>
        <StockPage api={client} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Mã thuốc (UUID)'), {
      target: { value: 'medicine' },
    });
    fireEvent.change(screen.getByLabelText('Số lượng nhập'), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Nhập tồn' }));
    await waitFor(() => expect(client.receiveStock).toHaveBeenCalledTimes(1));
    await screen.findByText('Network timeout');
    fireEvent.click(screen.getByRole('button', { name: 'Nhập tồn' }));
    await waitFor(() => expect(client.receiveStock).toHaveBeenCalledTimes(2));
    expect(vi.mocked(client.receiveStock).mock.calls[0][1]).toBe(
      vi.mocked(client.receiveStock).mock.calls[1][1],
    );
  });
  it('never offers dispense before server COMMITTED evidence', async () => {
    render(
      <MemoryRouter>
        <PrescriptionDetail api={api()} prescriptionId="rx" />
      </MemoryRouter>,
    );
    await screen.findByText('Đang giữ thuốc');
    expect(
      screen.queryByRole('button', { name: 'Xác nhận cấp phát' }),
    ).toBeNull();
    expect(screen.getByText(/chờ xác nhận thanh toán/i)).toBeTruthy();
  });
  it('dispense submits the version actually returned by server', async () => {
    const detail = {
      ...held,
      latestHoldState: 'COMMITTED',
      holds: [{ ...held.holds![0], status: 'COMMITTED' as const, version: 7 }],
    };
    const client = api({
      detail: vi.fn().mockResolvedValue(detail),
      dispense: vi.fn().mockResolvedValue({
        dispenseId: 'd',
        holdId: 'hold',
        state: 'DISPENSED',
      }),
    });
    render(
      <MemoryRouter>
        <PrescriptionDetail api={client} prescriptionId="rx" />
      </MemoryRouter>,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Xác nhận cấp phát' }),
    );
    await waitFor(() =>
      expect(client.dispense).toHaveBeenCalledWith(
        'hold',
        7,
        expect.any(String),
      ),
    );
  });
  it('aborts polling on unmount', async () => {
    let signal: AbortSignal | undefined;
    const client = api({
      detail: vi.fn((_id, _revision, incoming) => {
        signal = incoming;
        return new Promise<Detail>(() => {});
      }),
    });
    const view = render(
      <MemoryRouter>
        <PrescriptionDetail api={client} prescriptionId="rx" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(client.detail).toHaveBeenCalled());
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
});
