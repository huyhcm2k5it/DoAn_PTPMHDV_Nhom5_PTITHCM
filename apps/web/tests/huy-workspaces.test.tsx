import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { TreatmentPanel } from '../src/features/clinical/TreatmentPanel';
import { ResultEditor } from '../src/features/diagnostic/ResultEditor';
import { DraftEditor } from '../src/features/clinical/DraftEditor';
import { ClinicalFeature } from '../src/features/clinical/ClinicalFeature';
import { createDiagnosticApi } from '../src/features/diagnostic/api';
import { ApiError } from '../src/features/clinical/api';
import type {
  ClinicalApi,
  ClinicalTreatmentApi,
  VisitDetail,
} from '../src/features/clinical/types';
import type {
  DiagnosticApi,
  DiagnosticOrder,
  LabResult,
} from '../src/features/diagnostic/types';

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
});
afterEach(cleanup);

const detail: VisitDetail = {
  visit: {
    id: 'visit',
    appointmentId: 'appt',
    patientId: 'patient',
    doctorUserId: 'doctor',
    departmentId: 'dep',
    claimId: 'claim',
    state: 'IN_PROGRESS',
    version: 2,
    returnRound: 0,
    startedAt: '2026-11-20T01:00:00Z',
  },
  notes: [
    {
      id: 'note',
      visitId: 'visit',
      revision: 1,
      symptoms: 'Đau họng',
      findings: '',
      assessment: '',
      diagnosis: 'Viêm họng',
      authorUserId: 'doctor',
      savedAt: '',
    },
  ],
  prescriptions: [],
  labRequests: [],
};
it('requires an explicit visit selection when opening the treatment route without a visit ID', async () => {
  const api = {
    worklist: vi.fn().mockResolvedValue({
      items: [detail.visit],
      total: 1,
      startRequest: null,
    }),
    detail: vi.fn(),
    start: vi.fn(),
    saveDraft: vi.fn(),
  } as ClinicalApi;
  render(
    <ClinicalFeature
      api={api}
      session={{ userId: 'doctor', actorType: 'DOCTOR' }}
      initialView="treatment"
    />,
  );
  await screen.findByRole('button', { name: 'Mở lượt visit' });
  expect(api.detail).not.toHaveBeenCalled();
  expect(screen.getByText('Chọn một lượt khám để xem bệnh án.')).toBeTruthy();
});
it('reloads the same visit after Appointment accepts its return ticket', async () => {
  const operation = {
    requestId: 'op',
    operationId: 'op',
    state: 'ACCEPTED' as const,
    statusUrl: '',
    visitId: detail.visit.id,
  };
  const api: ClinicalApi = {
    worklist: vi
      .fn()
      .mockImplementation(async (q) => ({
        items: [detail.visit],
        total: 1,
        startRequest: q.operationId ? operation : null,
      })),
    start: vi.fn().mockResolvedValue({ ...operation, state: 'PENDING' }),
    detail: vi
      .fn()
      .mockResolvedValueOnce({
        ...detail,
        visit: { ...detail.visit, state: 'RETURN_READY' },
      })
      .mockResolvedValue({
        ...detail,
        visit: { ...detail.visit, returnRound: 1, version: 3 },
      }),
    saveDraft: vi.fn(),
  };
  render(
    <ClinicalFeature
      api={api}
      session={{ userId: 'doctor', actorType: 'DOCTOR' }}
      selectedTicket={{
        ticketId: 'ticket',
        doctorId: 'doctor',
        expectedTicketVersion: 3,
      }}
    />,
  );
  await screen.findByLabelText('Chẩn đoán');
  fireEvent.click(screen.getByRole('button', { name: 'Nhận lượt khám' }));
  await waitFor(() => expect(api.detail).toHaveBeenCalledTimes(2));
});
function treatment(): ClinicalTreatmentApi {
  return {
    medicines: vi
      .fn()
      .mockResolvedValue([
        { code: 'PAR', name: 'Paracetamol', status: 'ACTIVE' },
      ]),
    labTests: vi.fn().mockResolvedValue([
      {
        id: 'test',
        code: 'CBC',
        name: 'Huyết học',
        revision: 2,
        status: 'ACTIVE',
      },
    ]),
    createPrescription: vi.fn().mockRejectedValue(new Error('network')),
    updatePrescription: vi.fn(),
    deletePrescription: vi.fn(),
    finalizePrescription: vi.fn(),
    complete: vi
      .fn()
      .mockResolvedValue({ visitId: 'visit', state: 'SIGNED', version: 3 }),
    requestLab: vi.fn().mockResolvedValue({
      requestId: 'req',
      state: 'PENDING',
      statusUrl: '/api/v1/visits/visit',
    }),
  };
}
it.each(['PENDING', 'CREATED', 'REJECTED'])(
  'blocks signing when LAB remains %s',
  async (state) => {
    const api = treatment();
    render(
      <TreatmentPanel
        api={api}
        detail={{ ...detail, labRequests: [{ requestId: 'r', state }] }}
        onChanged={vi.fn()}
      />,
    );
    await screen.findByRole('checkbox', { name: /Huyết học/ });
    expect(
      screen
        .getByRole('button', { name: 'Ký kết luận khám' })
        .hasAttribute('disabled'),
    ).toBe(true);
    expect(api.complete).not.toHaveBeenCalled();
  },
);
it('sends only Catalog IDs and revisions and waits for asynchronous confirmation', async () => {
  const api = treatment();
  render(<TreatmentPanel api={api} detail={detail} onChanged={vi.fn()} />);
  fireEvent.click(await screen.findByRole('checkbox', { name: /Huyết học/ }));
  expect(
    screen
      .getByRole('button', { name: 'Ký kết luận khám' })
      .hasAttribute('disabled'),
  ).toBe(true);
  fireEvent.click(
    screen.getByRole('button', { name: 'Gửi chỉ định xét nghiệm' }),
  );
  await waitFor(() => expect(api.requestLab).toHaveBeenCalledTimes(1));
  expect(vi.mocked(api.requestLab).mock.calls[0][1]).toEqual({
    tests: [{ testId: 'test', revision: 2 }],
  });
  expect(await screen.findByText(/Đã tiếp nhận yêu cầu chỉ định/)).toBeTruthy();
  expect(
    screen
      .getByRole('button', { name: 'Ký kết luận khám' })
      .hasAttribute('disabled'),
  ).toBe(true);
});
it.each(['RETURN_READY', 'WAITING_RETURN'] as const)(
  'requires a return ticket claim before ordering or signing from %s',
  async (state) => {
    const api = treatment();
    render(
      <TreatmentPanel
        api={api}
        detail={{ ...detail, visit: { ...detail.visit, state } }}
        onChanged={vi.fn()}
      />,
    );
    const checkbox = await screen.findByRole('checkbox', { name: /Huyết học/ });
    expect(checkbox.closest('fieldset')?.disabled).toBe(true);
    expect(
      screen
        .getByRole('button', { name: 'Ký kết luận khám' })
        .hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.getByText(/Cần nhận vé khám quay lại/)).toBeTruthy();
  },
);
it('does not offer a second FINAL prescription for a signed visit', () => {
  const api = treatment();
  const prescription = {
    id: 'final',
    visitId: 'visit',
    patientId: 'patient',
    revision: 1,
    version: 2,
    state: 'FINAL' as const,
    lines: [{ medicineCode: 'PAR', doseText: '1 viên', quantity: 2 }],
  };
  render(
    <TreatmentPanel
      api={api}
      detail={{
        ...detail,
        visit: { ...detail.visit, state: 'SIGNED' },
        prescriptions: [
          prescription,
          { ...prescription, id: 'draft', state: 'DRAFT' },
        ],
      }}
      onChanged={vi.fn()}
    />,
  );
  expect(
    screen
      .getByRole('button', { name: 'Ký toa thuốc' })
      .hasAttribute('disabled'),
  ).toBe(true);
});
it('keeps the prescription body and idempotency key on an ambiguous retry', async () => {
  const api = treatment();
  render(<TreatmentPanel api={api} detail={detail} onChanged={vi.fn()} />);
  fireEvent.change(
    screen.getByPlaceholderText('Nhập tên hoặc mã thuốc để thêm vào đơn…'),
    { target: { value: 'Para' } },
  );
  fireEvent.click(await screen.findByRole('button', { name: /Paracetamol/ }));
  fireEvent.change(screen.getByLabelText('Liều dùng Paracetamol'), {
    target: { value: '1 viên sau ăn' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu toa nháp' }));
  await screen.findByRole('button', { name: 'Thử lại cùng yêu cầu' });
  const first = vi.mocked(api.createPrescription).mock.calls[0];
  expect(
    screen.getByLabelText('Liều dùng Paracetamol').hasAttribute('disabled'),
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại cùng yêu cầu' }));
  await waitFor(() => expect(api.createPrescription).toHaveBeenCalledTimes(2));
  expect(vi.mocked(api.createPrescription).mock.calls[1]).toEqual(first);
});
it('requires confirmation and separates visit signing from prescription signing', async () => {
  const api = treatment();
  render(<TreatmentPanel api={api} detail={detail} onChanged={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Ký kết luận khám' }));
  expect(api.complete).not.toHaveBeenCalled();
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Xác nhận ký',
    }),
  );
  await waitFor(() => expect(api.complete).toHaveBeenCalledTimes(1));
  expect(vi.mocked(api.complete).mock.calls[0][1]).toEqual({
    expectedVersion: 2,
  });
  expect(api.finalizePrescription).not.toHaveBeenCalled();
});

const order: DiagnosticOrder = {
  id: 'order',
  visitId: 'visit',
  patientId: 'patient',
  doctorId: 'doctor',
  state: 'SPECIMEN_COLLECTED',
  version: 3,
  chargeState: 'PAID',
  tests: [
    {
      testId: 'test',
      code: 'GLU',
      name: 'Glucose',
      revision: 2,
      unit: 'mmol/L',
      referenceRange: '3.9–6.4',
    },
  ],
};
const result: LabResult = {
  id: 'result',
  orderId: 'order',
  specimenId: 'sample',
  revision: 1,
  state: 'REVIEW',
  enteredBy: 'tech',
  version: 2,
  items: [
    {
      id: 'item',
      testCode: 'GLU',
      valueText: '5.2',
      flag: 'NORMAL',
      unit: 'mmol/L',
      referenceRange: '3.9–6.4',
    },
  ],
};
function lab(): DiagnosticApi {
  return {
    list: vi.fn(),
    detail: vi.fn(),
    collect: vi.fn(),
    reject: vi.fn(),
    recollect: vi.fn(),
    createResult: vi.fn(),
    updateResult: vi.fn(),
    transitionResult: vi.fn().mockResolvedValue({
      result: { ...result, state: 'PUBLISHED', version: 3 },
    }),
  };
}
const callbacks = () => ({
  onChanged: vi.fn(),
  onDirty: vi.fn(),
  unavailable: false,
});
it('prevents an author with both capabilities from reviewing their own result', () => {
  const api = lab();
  render(
    <ResultEditor
      api={api}
      order={order}
      result={result}
      session={{
        userId: 'tech',
        actorType: 'STAFF',
        capabilities: ['LAB_TECH', 'LAB_REVIEW'],
      }}
      {...callbacks()}
    />,
  );
  expect(
    screen
      .getByRole('button', { name: 'Duyệt và công bố' })
      .hasAttribute('disabled'),
  ).toBe(true);
  expect(screen.getByText(/Một nhân viên có quyền duyệt khác/)).toBeTruthy();
  expect(api.transitionResult).not.toHaveBeenCalled();
});
it('independent reviewer publishes the confirmed version and sees read-only output', async () => {
  const api = lab();
  render(
    <ResultEditor
      api={api}
      order={order}
      result={result}
      session={{
        userId: 'reviewer',
        actorType: 'STAFF',
        capabilities: ['LAB_REVIEW'],
      }}
      {...callbacks()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Duyệt và công bố' }));
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Duyệt và công bố',
    }),
  );
  await waitFor(() =>
    expect(api.transitionResult).toHaveBeenCalledWith(
      'result',
      'publish',
      { expectedVersion: 2 },
      expect.any(String),
    ),
  );
  expect(
    await screen.findByText(/Kết quả chuyển sang chế độ chỉ đọc/),
  ).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
});
it('retains newly acknowledged results while the order projection is stale', async () => {
  const api = lab();
  vi.mocked(api.createResult!).mockResolvedValue({
    result: { ...result, state: 'DRAFT', version: 1 },
  });
  const props = {
    api,
    order,
    session: {
      userId: 'tech',
      actorType: 'STAFF' as const,
      capabilities: ['LAB_TECH'],
    },
    ...callbacks(),
  };
  const view = render(<ResultEditor {...props} />);
  fireEvent.change(screen.getByLabelText('Kết quả Glucose'), {
    target: { value: '5.2' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu kết quả nháp' }));
  await screen.findByText('Đã tạo kết quả nháp.');
  view.rerender(<ResultEditor {...props} />);
  expect(
    (screen.getByLabelText('Kết quả Glucose') as HTMLInputElement).value,
  ).toBe('5.2');
  expect(
    screen.getByRole('button', { name: 'Gửi duyệt' }).hasAttribute('disabled'),
  ).toBe(false);
});
it('preserves a locally edited note after a version conflict until explicit discard', async () => {
  const api = {
    saveDraft: vi
      .fn()
      .mockRejectedValue(new ApiError(409, 'VERSION_CONFLICT', 'Conflict')),
  } as unknown as ClinicalApi;
  render(
    <DraftEditor
      api={api}
      detail={detail}
      onDirty={vi.fn()}
      onContinue={vi.fn()}
      onReload={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText('Chẩn đoán'), {
    target: { value: 'Bản đang soạn' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
  await screen.findByRole('button', { name: 'Xem lại bản đã lưu' });
  expect(
    (screen.getByLabelText('Chẩn đoán') as HTMLTextAreaElement).value,
  ).toBe('Bản đang soạn');
});
it('attaches the right lease for each protected Diagnostic action without changing payloads', async () => {
  const transport = vi
    .fn()
    .mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: { result } }), { status: 200 }),
    );
  const authorizationLease = vi
    .fn()
    .mockImplementation(async (action) => `lease-${action}`);
  const api = createDiagnosticApi(transport, { authorizationLease });
  await api.updateResult!(
    'r',
    { expectedVersion: 1, items: [{ testCode: 'GLU', valueText: '5.2' }] },
    'same-key',
  );
  await api.transitionResult!(
    'r',
    'submit-review',
    { expectedVersion: 2 },
    'k2',
  );
  await api.transitionResult!(
    'r',
    'return-rework',
    { expectedVersion: 3, reason: 'Kiểm tra lại' },
    'k3',
  );
  await api.transitionResult!('r', 'publish', { expectedVersion: 4 }, 'k4');
  await api.publishedResults!('patient', 1, 20);
  expect(authorizationLease.mock.calls.map((args) => args[0])).toEqual([
    'DI-008',
    'DI-009',
    'DI-011',
    'DI-013',
  ]);
  const init = transport.mock.calls[0][1];
  expect(init.method).toBe('PUT');
  expect(new Headers(init.headers).get('Idempotency-Key')).toBe('same-key');
  expect(new Headers(init.headers).get('X-Authorization-Lease')).toBe(
    'lease-DI-008',
  );
  expect(JSON.parse(init.body)).toEqual({
    expectedVersion: 1,
    items: [{ testCode: 'GLU', valueText: '5.2' }],
  });
  expect(
    new Headers(transport.mock.calls[2][1].headers).has(
      'X-Authorization-Lease',
    ),
  ).toBe(false);
});
