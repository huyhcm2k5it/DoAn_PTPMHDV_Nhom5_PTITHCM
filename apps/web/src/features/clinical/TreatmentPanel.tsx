import React, { useEffect, useRef, useState } from 'react';
import { ApiError, errorMessage } from './api';
import type {
  ClinicalTreatmentApi,
  Prescription,
  PrescriptionLine,
  TreatmentCatalogMedicine,
  TreatmentCatalogTest,
  VisitDetail,
} from './types';
const emptyLine = (): PrescriptionLine => ({
  medicineCode: '',
  doseText: '',
  quantity: 1,
  instruction: '',
});
export function TreatmentPanel({
  api,
  detail,
  onChanged,
}: {
  api: ClinicalTreatmentApi;
  detail: VisitDetail;
  onChanged: () => void;
}) {
  const apiRef = useRef(api);
  apiRef.current = api;
  const [medicines, setMedicines] = useState<TreatmentCatalogMedicine[]>([]),
    [tests, setTests] = useState<TreatmentCatalogTest[]>([]);
  const [catalogError, setCatalogError] = useState<unknown>(),
    [reload, setReload] = useState(0);
  const [lines, setLines] = useState<PrescriptionLine[]>([emptyLine()]);
  const [editing, setEditing] = useState<Prescription | null>(null),
    [selectedTests, setSelectedTests] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const [signed, setSigned] = useState(detail.visit.state === 'SIGNED'),
    [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false),
    [conflict, setConflict] = useState(false);
  const attempt = useRef<{
    key: string;
    run: (key: string) => Promise<unknown>;
    success: (result: any) => void;
  } | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    setCatalogError(undefined);
    Promise.all([api.medicines(abort.signal), api.labTests(abort.signal)])
      .then(([m, t]) => {
        if (active) {
          setMedicines(m.filter((x) => x.status === 'ACTIVE'));
          setTests(t.filter((x) => x.status === 'ACTIVE'));
        }
      })
      .catch((e) => {
        if (active) setCatalogError(e);
      });
    return () => {
      active = false;
      abort.abort();
    };
  }, [api, reload]);
  async function execute() {
    if (!attempt.current || busy) return;
    setBusy(true);
    setError(undefined);
    const action = attempt.current;
    try {
      const result = await action.run(action.key);
      if (!alive.current) return;
      action.success(result);
      attempt.current = null;
      setUncertain(false);
      onChanged();
    } catch (e) {
      if (!alive.current) return;
      setError(e);
      const definitive =
        e instanceof ApiError &&
        [400, 403, 404, 409, 422].includes(e.status) &&
        e.code !== 'AUTHZ_LEASE_EXPIRED';
      if (definitive) {
        attempt.current = null;
        setUncertain(false);
        setConflict(e.status === 409);
      } else setUncertain(true);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function act(
    run: (key: string) => Promise<unknown>,
    success: (result: any) => void,
  ) {
    if (busy || attempt.current) return;
    attempt.current = { key: crypto.randomUUID(), run, success };
    void execute();
  }
  const locked = busy || uncertain || conflict;
  const unresolved =
    pending ||
    detail.labRequests.some(
      (r) => !['REJECTED', 'CANCELLED', 'PUBLISHED'].includes(r.state),
    );
  function savePrescription(e: React.FormEvent) {
    e.preventDefault();
    const input = { lines: lines.map((x) => ({ ...x })) };
    if (editing) {
      const id = editing.id,
        body = { ...input, expectedVersion: editing.version };
      act(
        (key) => apiRef.current.updatePrescription(id, body, key),
        () => {
          setNotice('Đã cập nhật toa nháp.');
          setEditing(null);
          setLines([emptyLine()]);
        },
      );
    } else
      act(
        (key) => apiRef.current.createPrescription(detail.visit.id, input, key),
        () => {
          setNotice('Đã lưu toa nháp.');
          setLines([emptyLine()]);
        },
      );
  }
  return (
    <section className="clinical-treatment" aria-label="Điều trị và chỉ định">
      <h2>Toa thuốc và chỉ định</h2>
      {notice && <p role="status">{notice}</p>}
      {error !== undefined && (
        <div role="alert">
          {errorMessage(error)}
          {uncertain && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void execute()}
            >
              Thử lại thao tác
            </button>
          )}
          {conflict && (
            <button type="button" onClick={onChanged}>
              Tải bản mới (bỏ thay đổi chưa lưu)
            </button>
          )}
        </div>
      )}
      {catalogError !== undefined && (
        <div role="alert">
          Không tải được danh mục thuốc/xét nghiệm.{' '}
          <button type="button" onClick={() => setReload((n) => n + 1)}>
            Tải lại danh mục
          </button>
        </div>
      )}
      <ul className="clinical-prescriptions">
        {detail.prescriptions
          .filter((p) => p.state !== 'DELETED')
          .map((p) => (
            <li key={p.id}>
              <h3>
                Toa {p.id.slice(0, 8)} · {p.state} · phiên bản {p.version}
              </h3>
              <ul>
                {p.lines.map((line, i) => (
                  <li key={i}>
                    {line.nameSnapshot || line.medicineCode} — {line.doseText} ·
                    số lượng {line.quantity} · {line.instruction}
                  </li>
                ))}
              </ul>
              {p.state === 'DRAFT' && (
                <div className="clinical-actions">
                  {!signed && (
                    <>
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => {
                          setEditing(p);
                          setLines(
                            p.lines.length
                              ? p.lines.map((x) => ({ ...x }))
                              : [emptyLine()],
                          );
                          setNotice('');
                        }}
                      >
                        Sửa toa {p.id.slice(0, 8)}
                      </button>
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() =>
                          act(
                            (key) =>
                              apiRef.current.deletePrescription(
                                p.id,
                                p.version,
                                key,
                              ),
                            () => setNotice('Đã xóa toa nháp.'),
                          )
                        }
                      >
                        Xóa toa {p.id.slice(0, 8)}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    disabled={locked || !signed || p.lines.length === 0}
                    onClick={() =>
                      act(
                        (key) =>
                          apiRef.current.finalizePrescription(
                            p.id,
                            { expectedVersion: p.version },
                            key,
                          ),
                        () => setNotice('Đã ký toa chính thức.'),
                      )
                    }
                  >
                    Ký toa {p.id.slice(0, 8)}
                  </button>
                </div>
              )}
            </li>
          ))}
      </ul>
      {!signed && (
        <>
          <form onSubmit={savePrescription}>
            <h3>{editing ? 'Sửa toa nháp' : 'Lập toa nháp'}</h3>
            {lines.map((line, i) => (
              <fieldset key={i} disabled={locked}>
                <legend>Dòng {i + 1}</legend>
                <label>
                  Thuốc dòng {i + 1}
                  <select
                    required
                    value={line.medicineCode}
                    onChange={(e) =>
                      setLines(
                        lines.map((x, n) =>
                          n === i ? { ...x, medicineCode: e.target.value } : x,
                        ),
                      )
                    }
                  >
                    <option value="">Chọn thuốc</option>
                    {medicines.map((m) => (
                      <option key={m.code} value={m.code}>
                        {m.name} ({m.code})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Liều dùng dòng {i + 1}
                  <input
                    required
                    maxLength={1000}
                    disabled={locked}
                    value={line.doseText}
                    onChange={(e) =>
                      setLines(
                        lines.map((x, n) =>
                          n === i ? { ...x, doseText: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Số lượng dòng {i + 1}
                  <input
                    type="number"
                    required
                    min={1}
                    max={2147483647}
                    step={1}
                    value={line.quantity}
                    onChange={(e) =>
                      setLines(
                        lines.map((x, n) =>
                          n === i
                            ? { ...x, quantity: Number(e.target.value) }
                            : x,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Hướng dẫn dòng {i + 1}
                  <input
                    maxLength={1000}
                    value={line.instruction ?? ''}
                    onChange={(e) =>
                      setLines(
                        lines.map((x, n) =>
                          n === i ? { ...x, instruction: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
                {lines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setLines(lines.filter((_, n) => n !== i))}
                  >
                    Bỏ dòng {i + 1}
                  </button>
                )}
              </fieldset>
            ))}
            <div className="clinical-actions">
              <button
                type="button"
                disabled={locked || lines.length >= 50}
                onClick={() => setLines([...lines, emptyLine()])}
              >
                Thêm dòng thuốc
              </button>
              <button disabled={locked || !medicines.length} type="submit">
                {editing ? 'Lưu thay đổi toa' : 'Lưu toa nháp'}
              </button>
              {editing && (
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    setEditing(null);
                    setLines([emptyLine()]);
                  }}
                >
                  Bỏ sửa toa
                </button>
              )}
            </div>
          </form>
          <section>
            <h3>Chỉ định xét nghiệm</h3>
            {tests.length === 0 && !catalogError && (
              <p>Chưa có xét nghiệm khả dụng trong danh mục.</p>
            )}
            <fieldset disabled={locked || pending}>
              {tests.map((t) => (
                <label className="clinical-check" key={t.id}>
                  <input
                    type="checkbox"
                    checked={selectedTests.includes(t.id)}
                    onChange={(e) =>
                      setSelectedTests(
                        e.target.checked
                          ? [...selectedTests, t.id]
                          : selectedTests.filter((id) => id !== t.id),
                      )
                    }
                  />
                  {t.name}
                </label>
              ))}
            </fieldset>
            <button
              type="button"
              disabled={locked || pending || !selectedTests.length}
              onClick={() => {
                const input = {
                  tests: tests
                    .filter((t) => selectedTests.includes(t.id))
                    .map((t) => ({ testId: t.id, revision: t.revision })),
                };
                act(
                  (key) =>
                    apiRef.current.requestLab(detail.visit.id, input, key),
                  () => {
                    setPending(true);
                    setSelectedTests([]);
                    setNotice(
                      'Đã nhận chỉ định, đang chờ tạo order. Chưa có xác nhận xét nghiệm.',
                    );
                  },
                );
              }}
            >
              Gửi chỉ định xét nghiệm
            </button>
          </section>
          <button
            type="button"
            disabled={locked || unresolved}
            onClick={() =>
              act(
                (key) =>
                  apiRef.current.complete(
                    detail.visit.id,
                    { expectedVersion: detail.visit.version },
                    key,
                  ),
                () => {
                  setSigned(true);
                  setNotice(
                    'Đã ký kết luận khám. Toa thuốc cần được ký riêng.',
                  );
                },
              )
            }
          >
            Ký kết luận khám
          </button>
          {unresolved && (
            <p>
              Chỉ ký khám khi tất cả chỉ định đã được giải quyết và xét nghiệm
              hoàn tất hoặc hủy hợp lệ.
            </p>
          )}
        </>
      )}
      <section>
        <h3>Theo dõi chỉ định</h3>
        {!detail.labRequests.length ? (
          <p>Chưa có chỉ định xét nghiệm.</p>
        ) : (
          <ul>
            {detail.labRequests.map((r) => (
              <li key={r.requestId}>
                Yêu cầu {r.requestId.slice(0, 8)} · {r.state}
                {r.orderId && ` · Order ${r.orderId}`}
                {r.reasonCode && ` · ${r.reasonCode}`}
              </li>
            ))}
          </ul>
        )}
        <button type="button" disabled={busy || uncertain} onClick={onChanged}>
          Kiểm tra trạng thái chỉ định
        </button>
      </section>
    </section>
  );
}
