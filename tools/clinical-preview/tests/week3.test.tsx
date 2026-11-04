import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TreatmentPanel } from '../../../apps/web/src/features/clinical/TreatmentPanel';
import { DiagnosticFeature } from '../../../apps/web/src/features/diagnostic/DiagnosticFeature';
import { createClinicalApi, ApiError } from '../../../apps/web/src/features/clinical/api';
import { ClinicalFeature } from '../../../apps/web/src/features/clinical/ClinicalFeature';
import { act } from '@testing-library/react';
afterEach(cleanup);
const detail: any = {
  visit: { id: 'visit', state: 'IN_PROGRESS', version: 2 },
  notes: [],
  prescriptions: [],
  labRequests: [],
};
function treatment() {
  return {
    medicines: vi.fn().mockResolvedValue([{ code: 'PAR', name: 'Paracetamol', status: 'ACTIVE' }]),
    labTests: vi
      .fn()
      .mockResolvedValue([{ id: 'test', name: 'Huyết học', revision: 1, status: 'ACTIVE' }]),
    createPrescription: vi
      .fn()
      .mockResolvedValue({ prescription: { id: 'rx', state: 'DRAFT', version: 1, lines: [] } }),
    updatePrescription: vi.fn(),
    deletePrescription: vi.fn(),
    finalizePrescription: vi.fn(),
    complete: vi.fn().mockResolvedValue({ visitId: 'visit', state: 'SIGNED', version: 3 }),
    requestLab: vi
      .fn()
      .mockResolvedValue({ requestId: 'req', state: 'PENDING', statusUrl: '/api/v1/visits/visit' }),
  };
}
it('keeps LAB pending as pending and submits only Catalog IDs/revisions', async () => {
  const api = treatment();
  render(<TreatmentPanel api={api} detail={detail} onChanged={() => {}} />);
  fireEvent.click(await screen.findByLabelText('Huyết học'));
  fireEvent.click(screen.getByRole('button', { name: 'Gửi chỉ định xét nghiệm' }));
  await waitFor(() => expect(api.requestLab).toHaveBeenCalledTimes(1));
  expect(api.requestLab.mock.calls[0][1]).toEqual({ tests: [{ testId: 'test', revision: 1 }] });
  expect(await screen.findByText(/Đã nhận chỉ định, đang chờ tạo order/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Ký kết luận khám' }).hasAttribute('disabled')).toBe(
    true,
  );
});
it('preserves mutation body and key during an ambiguous retry', async () => {
  const api = treatment();
  api.createPrescription.mockRejectedValue(new Error('network'));
  render(<TreatmentPanel api={api} detail={detail} onChanged={() => {}} />);
  await screen.findByLabelText('Thuốc dòng 1');
  fireEvent.change(screen.getByLabelText('Thuốc dòng 1'), { target: { value: 'PAR' } });
  fireEvent.change(screen.getByLabelText('Liều dùng dòng 1'), { target: { value: '1 viên' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu toa nháp' }));
  await screen.findByRole('alert');
  const first = api.createPrescription.mock.calls[0];
  expect(screen.getByLabelText('Liều dùng dòng 1').hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại thao tác' }));
  await waitFor(() => expect(api.createPrescription).toHaveBeenCalledTimes(2));
  expect(api.createPrescription.mock.calls[1]).toEqual(first);
});
it('signing visit does not silently finalize a prescription', async () => {
  const api = treatment();
  render(<TreatmentPanel api={api} detail={detail} onChanged={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Ký kết luận khám' }));
  await waitFor(() => expect(api.complete).toHaveBeenCalledTimes(1));
  expect(api.finalizePrescription).not.toHaveBeenCalled();
});
function lab() {
  return {
    list: vi
      .fn()
      .mockResolvedValue({
        items: [{ id: 'order', state: 'WAITING_SAMPLE', chargeState: 'PAID', version: 1 }],
        total: 1,
      }),
    detail: vi
      .fn()
      .mockResolvedValue({
        order: { id: 'order', state: 'WAITING_SAMPLE', chargeState: 'PENDING', version: 1 },
        specimens: [],
      }),
    collect: vi.fn(),
    reject: vi.fn(),
    recollect: vi.fn(),
  };
}
it('denies lab mutations to review-only staff and does not claim payment sync', async () => {
  const api = lab();
  render(
    <DiagnosticFeature
      api={api}
      session={{ userId: 'review', actorType: 'STAFF', capabilities: ['LAB_REVIEW'] }}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Mở order order' }));
  await screen.findByText(/Chờ đồng bộ thanh toán/);
  expect(screen.queryByRole('button', { name: 'Lấy mẫu' })).toBeNull();
  expect(api.collect).not.toHaveBeenCalled();
});
it('does not load LAB data for patient', () => {
  const api = lab();
  render(
    <DiagnosticFeature
      api={api}
      session={{ userId: 'p', actorType: 'PATIENT', capabilities: [] }}
    />,
  );
  expect(api.list).not.toHaveBeenCalled();
});
it('refreshes the signing lease while retaining the mutation key and body', async () => {
  const transport = vi
    .fn()
    .mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: { visitId: 'v', state: 'SIGNED', version: 3 } }), {
          status: 200,
        }),
    );
  const lease = vi.fn().mockResolvedValueOnce('lease-one').mockResolvedValueOnce('lease-two');
  const api = createClinicalApi(transport, { authorizationLease: lease });
  await api.treatment!.complete('v', { expectedVersion: 2 }, 'intent');
  await api.treatment!.complete('v', { expectedVersion: 2 }, 'intent');
  expect(lease).toHaveBeenNthCalledWith(1, 'CL-010', 'v');
  const first = transport.mock.calls[0][1],
    second = transport.mock.calls[1][1];
  expect(new Headers(first.headers).get('X-Authorization-Lease')).toBe('lease-one');
  expect(new Headers(second.headers).get('X-Authorization-Lease')).toBe('lease-two');
  expect(second.body).toBe(first.body);
  expect(new Headers(second.headers).get('Idempotency-Key')).toBe('intent');
});
it('preserves the signing intent when the authorization lease expires', async () => {
  const api = treatment();
  api.complete
    .mockRejectedValueOnce(new ApiError(401, 'AUTHZ_LEASE_EXPIRED', 'Lease expired'))
    .mockResolvedValueOnce({ visitId: 'visit', state: 'SIGNED', version: 3 });
  render(<TreatmentPanel api={api} detail={detail} onChanged={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Ký kết luận khám' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Thử lại thao tác' }));
  await waitFor(() => expect(api.complete).toHaveBeenCalledTimes(2));
  expect(api.complete.mock.calls[1]).toEqual(api.complete.mock.calls[0]);
});
it('edits and deletes a draft with the observed version, and finalizes only after signing', async () => {
  const api = treatment();
  api.updatePrescription.mockResolvedValue({});
  api.deletePrescription.mockResolvedValue({});
  api.finalizePrescription.mockResolvedValue({});
  const rx = {
    id: 'rx123456',
    visitId: 'visit',
    patientId: 'patient',
    state: 'DRAFT',
    version: 4,
    revision: 1,
    lines: [{ medicineCode: 'PAR', doseText: '1 viên', quantity: 2 }],
  };
  const view = render(
    <TreatmentPanel api={api} detail={{ ...detail, prescriptions: [rx] }} onChanged={() => {}} />,
  );
  await screen.findByRole('option', { name: 'Paracetamol (PAR)' });
  fireEvent.click(screen.getByRole('button', { name: 'Sửa toa rx123456' }));
  fireEvent.change(screen.getByLabelText('Liều dùng dòng 1'), { target: { value: '2 viên' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi toa' }));
  await waitFor(() => expect(api.updatePrescription).toHaveBeenCalledTimes(1));
  expect(api.updatePrescription.mock.calls[0][1]).toMatchObject({
    expectedVersion: 4,
    lines: [{ medicineCode: 'PAR', doseText: '2 viên', quantity: 2 }],
  });
  fireEvent.click(screen.getByRole('button', { name: 'Xóa toa rx123456' }));
  await waitFor(() => expect(api.deletePrescription).toHaveBeenCalledTimes(1));
  expect(api.deletePrescription.mock.calls[0].slice(0, 2)).toEqual(['rx123456', 4]);
  view.unmount();
  render(
    <TreatmentPanel
      api={api}
      detail={{ ...detail, visit: { ...detail.visit, state: 'SIGNED' }, prescriptions: [rx] }}
      onChanged={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Ký toa rx123456' }));
  await waitFor(() => expect(api.finalizePrescription).toHaveBeenCalledTimes(1));
  expect(api.finalizePrescription.mock.calls[0][1]).toEqual({ expectedVersion: 4 });
});
it('rejects with a reason and version then recollects the same order', async () => {
  const api = lab();
  const specimen = {
    id: 'sample',
    orderId: 'order',
    state: 'COLLECTED',
    sequence: 1,
    barcode: 'BAR1',
    version: 7,
    collectedBy: 'tech',
    collectedAt: '2026-11-04T00:00:00Z',
  };
  api.detail.mockResolvedValueOnce({
    order: { id: 'order', state: 'SPECIMEN_COLLECTED', chargeState: 'PAID', version: 1 },
    specimens: [specimen],
  });
  api.reject.mockResolvedValue({ specimen: { ...specimen, state: 'REJECTED' } });
  api.detail.mockResolvedValue({
    order: { id: 'order', state: 'SPECIMEN_REJECTED', chargeState: 'PAID', version: 2 },
    specimens: [{ ...specimen, state: 'REJECTED', version: 8, reasonCode: 'HEMOLYSIS' }],
  });
  api.recollect.mockResolvedValue({ specimen: { ...specimen, id: 'sample2', sequence: 2 } });
  render(
    <DiagnosticFeature
      api={api}
      session={{ userId: 'tech', actorType: 'STAFF', capabilities: ['LAB_TECH'] }}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Mở order order' }));
  fireEvent.change(await screen.findByLabelText('Lý do từ chối mẫu 1'), {
    target: { value: 'HEMOLYSIS' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Từ chối mẫu 1' }));
  await waitFor(() => expect(api.reject).toHaveBeenCalledTimes(1));
  expect(api.reject.mock.calls[0].slice(0, 2)).toEqual([
    'sample',
    { reasonCode: 'HEMOLYSIS', expectedVersion: 7 },
  ]);
  fireEvent.click(await screen.findByRole('button', { name: 'Lấy lại mẫu' }));
  await waitFor(() => expect(api.recollect).toHaveBeenCalledTimes(1));
  expect(api.recollect.mock.calls[0][0]).toBe('order');
  expect(api.collect).not.toHaveBeenCalled();
});
it('polls pending LAB without discarding draft text', async () => {
  const visit = {
    id: 'visit',
    state: 'LAB_REQUEST_PENDING',
    version: 2,
    startedAt: '2026-11-04T00:00:00Z',
  };
  const original = {
    ...detail,
    visit,
    labRequests: [{ requestId: 'pending-request', state: 'PENDING' }],
  };
  const client: any = {
    worklist: vi.fn().mockResolvedValue({ items: [visit], total: 1, startRequest: null }),
    start: vi.fn(),
    saveDraft: vi.fn(),
    treatment: treatment(),
    detail: vi
      .fn()
      .mockResolvedValueOnce(original)
      .mockResolvedValue({
        ...original,
        visit: { ...visit, state: 'WAITING_LAB', version: 3 },
        labRequests: [{ requestId: 'pending-request', state: 'CREATED', orderId: 'order' }],
      }),
  };
  render(<ClinicalFeature api={client} session={{ userId: 'doctor', actorType: 'DOCTOR' }} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Mở lượt visit' }));
  fireEvent.change(await screen.findByLabelText('Triệu chứng'), {
    target: { value: 'Giữ nguyên nội dung đang viết' },
  });
  await waitFor(() => expect(client.detail).toHaveBeenCalledTimes(2), { timeout: 4000 });
  expect((screen.getByLabelText('Triệu chứng') as HTMLTextAreaElement).value).toBe(
    'Giữ nguyên nội dung đang viết',
  );
  expect(await screen.findByText(/CREATED.*Order order/)).toBeTruthy();
});
it('preserves prescription text after a conflict until an explicit reload', async () => {
  const api = treatment(),
    changed = vi.fn();
  api.createPrescription.mockRejectedValue(new ApiError(409, 'STATE_CONFLICT', 'Reload required'));
  render(<TreatmentPanel api={api} detail={detail} onChanged={changed} />);
  await screen.findByRole('option', { name: 'Paracetamol (PAR)' });
  fireEvent.change(screen.getByLabelText('Thuốc dòng 1'), { target: { value: 'PAR' } });
  fireEvent.change(screen.getByLabelText('Liều dùng dòng 1'), {
    target: { value: 'Nội dung chưa lưu' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu toa nháp' }));
  await screen.findByRole('alert');
  expect((screen.getByLabelText('Liều dùng dòng 1') as HTMLInputElement).value).toBe(
    'Nội dung chưa lưu',
  );
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Tải bản mới (bỏ thay đổi chưa lưu)' }));
  expect(changed).toHaveBeenCalledTimes(1);
});
it('ignores an old LAB detail response after the session changes', async () => {
  const api = lab();
  let resolve!: (value: any) => void;
  api.detail.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const view = render(
    <DiagnosticFeature
      api={api}
      session={{ userId: 'tech-a', actorType: 'STAFF', capabilities: ['LAB_TECH'] }}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Mở order order' }));
  await waitFor(() => expect(api.detail).toHaveBeenCalledTimes(1));
  view.rerender(
    <DiagnosticFeature
      api={api}
      session={{ userId: 'tech-b', actorType: 'STAFF', capabilities: ['LAB_TECH'] }}
    />,
  );
  await act(async () =>
    resolve({
      order: {
        id: 'order',
        patientId: 'PRIVATE-OLD-PATIENT',
        state: 'PAID',
        chargeState: 'PAID',
        version: 1,
      },
      specimens: [],
    }),
  );
  expect(screen.queryByText(/PRIVATE-OLD-PATIENT/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Lấy mẫu' })).toBeNull();
});
