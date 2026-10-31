import React, { useEffect, useRef, useState } from "react";
import { ApiError, errorMessage } from "./api";
import type {
  ClinicalApi,
  ClinicalSession,
  DraftInput,
  StartInput,
  StartResult,
  VisitDetail,
  Worklist,
} from "./types";
import "./clinical.css";

export type ClinicalFeatureProps = {
  api: ClinicalApi;
  session?: ClinicalSession;
  selectedTicket?: StartInput;
};
const labels: Record<string, string> = {
  IN_PROGRESS: "Đang khám",
  LAB_REQUEST_PENDING: "Đang tạo chỉ định",
  WAITING_LAB: "Chờ xét nghiệm",
  RETURN_READY: "Sẵn sàng quay lại",
  WAITING_RETURN: "Chờ quay lại",
  SIGNED: "Đã ký",
};

export function ClinicalFeature({
  api,
  session,
  selectedTicket,
}: ClinicalFeatureProps) {
  if (!session || session.actorType !== "DOCTOR")
    return (
      <section className="clinical-feature">
        <h1>Bàn khám</h1>
        <p role="alert">Màn hình này chỉ dành cho bác sĩ đã đăng nhập.</p>
      </section>
    );
  return (
    <Workbench key={session.userId} api={api} selectedTicket={selectedTicket} />
  );
}
function Workbench({
  api,
  selectedTicket,
}: {
  api: ClinicalApi;
  selectedTicket?: StartInput;
}) {
  const apiRef = useRef(api);
  apiRef.current = api;
  const [date, setDate] = useState("");
  const [state, setState] = useState("");
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [list, setList] = useState<Worklist>({
    items: [],
    total: 0,
    startRequest: null,
  });
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<unknown>();
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<VisitDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<unknown>();
  const [detailReload, setDetailReload] = useState(0);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<unknown>();
  const [operation, setOperation] = useState<StartResult | null>(null);
  const [pollReload, setPollReload] = useState(0);
  const intent = useRef<{ input: StartInput; key: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setListError(undefined);
    apiRef.current
      .worklist({ date, state, page, limit: 20 }, controller.signal)
      .then((data) => {
        if (active) setList(data);
      })
      .catch((error) => {
        if (active) setListError(error);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [date, state, page, reload]);
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setDetail(null);
    setDetailLoading(true);
    setDetailError(undefined);
    apiRef.current
      .detail(selected, controller.signal)
      .then((data) => {
        if (active) setDetail(data);
      })
      .catch((error) => {
        if (active) setDetailError(error);
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [selected, detailReload]);
  useEffect(() => {
    if (!operation?.operationId || operation.state !== "PENDING") return;
    const controller = new AbortController();
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const id = operation.operationId;
    const poll = async () => {
      try {
        const data = await apiRef.current.worklist(
          { operationId: id },
          controller.signal,
        );
        if (!active) return;
        const result = data.startRequest;
        if (!result || result.operationId !== id)
          throw new ApiError(
            502,
            "INVALID_RESPONSE",
            "Chưa đọc được trạng thái nhận lượt",
          );
        setStartError(undefined);
        if (result.state === "PENDING") {
          timer = setTimeout(poll, 1000);
          return;
        }
        if (result.state === "ACCEPTED" && !result.visitId)
          throw new ApiError(
            502,
            "INVALID_RESPONSE",
            "Lượt khám chưa có mã hợp lệ",
          );
        setOperation(result);
        intent.current = null;
        if (result.state === "ACCEPTED" && result.visitId) {
          setSelected(result.visitId);
          setReload((n) => n + 1);
        }
      } catch (error) {
        if (!active) return;
        setStartError(error);
        if (
          !(error instanceof ApiError) ||
          ![401, 403, 404].includes(error.status)
        )
          timer = setTimeout(poll, 2000);
      }
    };
    void poll();
    return () => {
      active = false;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [operation?.operationId, operation?.state, pollReload]);
  async function start() {
    if (starting || operation?.state === "PENDING") return;
    if (!intent.current && selectedTicket)
      intent.current = {
        input: { ...selectedTicket },
        key: crypto.randomUUID(),
      };
    if (!intent.current) return;
    setStarting(true);
    setStartError(undefined);
    try {
      const result = await apiRef.current.start(
        intent.current.input,
        intent.current.key,
      );
      if (alive.current) setOperation(result);
    } catch (error) {
      if (alive.current) {
        // These responses definitively rejected the request before 202. A
        // corrected queue selection starts a new intention; ambiguous failures
        // preserve the original body/key so a committed start can be replayed.
        if (
          error instanceof ApiError &&
          [400, 401, 403, 404, 409, 422].includes(error.status)
        ) {
          intent.current = null;
        }
        setStartError(error);
      }
    } finally {
      if (alive.current) setStarting(false);
    }
  }
  return (
    <section className="clinical-feature">
      <header className="clinical-heading">
        <div>
          <p className="clinical-eyebrow">Không gian bác sĩ</p>
          <h1>Bàn khám</h1>
          <p>Theo dõi lượt khám và lưu bệnh án nháp.</p>
        </div>
        <button type="button" onClick={() => setReload((n) => n + 1)}>
          Làm mới danh sách
        </button>
      </header>
      <div className="clinical-start">
        <div>
          <h2>Nhận bệnh nhân</h2>
          <p>
            {selectedTicket
              ? "Vé hàng chờ đã được chọn. Xác nhận để bắt đầu nhận lượt."
              : "Chọn một vé từ hàng chờ để nhận lượt khám."}
          </p>
        </div>
        <button
          type="button"
          disabled={
            starting ||
            operation?.state === "PENDING" ||
            (!selectedTicket && !intent.current)
          }
          onClick={() => void start()}
        >
          {starting
            ? "Đang gửi…"
            : intent.current && startError && !operation
              ? "Thử lại yêu cầu nhận lượt"
              : "Nhận lượt khám"}
        </button>
      </div>
      {operation?.state === "PENDING" && (
        <p role="status">
          Đang chờ xác nhận vé. Lượt khám sẽ mở khi hàng chờ xác nhận thành
          công.
        </p>
      )}
      {operation?.state === "REJECTED" && (
        <p role="alert">
          Không nhận được lượt: {operation.reasonCode ?? "CLAIM_REJECTED"}. Hãy
          kiểm tra lại vé hàng chờ.
        </p>
      )}
      {startError !== undefined && (
        <div role="alert">
          {errorMessage(startError)}
          {operation?.state === "PENDING" && (
            <button type="button" onClick={() => setPollReload((n) => n + 1)}>
              Kiểm tra lại trạng thái
            </button>
          )}
        </div>
      )}
      <div className="clinical-filters">
        <label>
          Ngày khám (UTC)
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Trạng thái
          <select
            value={state}
            onChange={(e) => {
              setState(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Tất cả trạng thái</option>
            {Object.entries(labels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="clinical-columns">
        <section className="clinical-list" aria-label="Danh sách lượt khám">
          <h2>
            Lượt khám của tôi <small>({list.total})</small>
          </h2>
          {loading ? (
            <p role="status">Đang tải danh sách…</p>
          ) : listError ? (
            <p role="alert">{errorMessage(listError)}</p>
          ) : list.items.length === 0 ? (
            <p>Chưa có lượt khám phù hợp.</p>
          ) : (
            <ul>
              {list.items.map((v) => (
                <li key={v.id}>
                  <span className="clinical-state">
                    {labels[v.state] ?? v.state}
                  </span>
                  <strong>Lượt {v.id.slice(0, 8)}</strong>
                  <span>Hồ sơ {v.patientId}</span>
                  <time dateTime={v.startedAt}>
                    {new Date(v.startedAt).toLocaleString("vi-VN")}
                  </time>
                  <button type="button" onClick={() => setSelected(v.id)}>
                    Mở lượt {v.id.slice(0, 8)}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <nav className="clinical-pagination" aria-label="Phân trang">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => p - 1)}
            >
              Trang trước
            </button>
            <span>Trang {page}</span>
            <button
              type="button"
              disabled={page * 20 >= list.total || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Trang sau
            </button>
          </nav>
        </section>
        <section className="clinical-detail" aria-label="Bệnh án nháp">
          {detailLoading ? (
            <p role="status">Đang tải lượt khám…</p>
          ) : detailError ? (
            <p role="alert">{errorMessage(detailError)}</p>
          ) : detail ? (
            <DraftEditor
              key={`${detail.visit.id}:${detailReload}`}
              api={api}
              detail={detail}
              onReload={() => setDetailReload((n) => n + 1)}
              onSaved={() => setReload((n) => n + 1)}
            />
          ) : (
            <p>Chọn một lượt khám để xem và ghi nháp.</p>
          )}
        </section>
      </div>
    </section>
  );
}

function DraftEditor({
  api,
  detail,
  onReload,
  onSaved,
}: {
  api: ClinicalApi;
  detail: VisitDetail;
  onReload: () => void;
  onSaved: () => void;
}) {
  const last = detail.notes.at(-1);
  const [fields, setFields] = useState({
    symptoms: last?.symptoms ?? "",
    findings: last?.findings ?? "",
    assessment: last?.assessment ?? "",
    diagnosis: last?.diagnosis ?? "",
  });
  const [version, setVersion] = useState(detail.visit.version);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>();
  const [saved, setSaved] = useState(false);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving || detail.visit.state === "SIGNED") return;
    const input: DraftInput = { ...fields, expectedVersion: version };
    const fingerprint = JSON.stringify({ visitId: detail.visit.id, input });
    if (attempt.current?.fingerprint !== fingerprint)
      attempt.current = { fingerprint, key: crypto.randomUUID() };
    const key = attempt.current.key;
    setSaving(true);
    setError(undefined);
    setSaved(false);
    try {
      const result = await api.saveDraft(detail.visit.id, input, key);
      if (alive.current) {
        setVersion(result.version);
        setSaved(true);
        attempt.current = null;
        onSaved();
      }
    } catch (err) {
      if (alive.current) setError(err);
    } finally {
      if (alive.current) setSaving(false);
    }
  }
  const locked = detail.visit.state === "SIGNED";
  return (
    <form onSubmit={(event) => void save(event)}>
      <header>
        <h2>Bệnh án nháp</h2>
        <p>
          {labels[detail.visit.state]} · Phiên bản {version}
        </p>
      </header>
      {locked && <p>Lượt khám đã ký. Nội dung được giữ nguyên.</p>}
      {(
        [
          ["symptoms", "Triệu chứng"],
          ["findings", "Dấu hiệu khám"],
          ["assessment", "Nhận định"],
          ["diagnosis", "Chẩn đoán"],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          {label}
          <textarea
            value={fields[key]}
            maxLength={10000}
            rows={key === "symptoms" ? 4 : 3}
            disabled={saving || locked}
            onChange={(event) => {
              setFields({ ...fields, [key]: event.target.value });
              setSaved(false);
            }}
          />
        </label>
      ))}
      {error !== undefined && (
        <div role="alert">
          {errorMessage(error)}
          {error instanceof ApiError && error.status === 409 && (
            <button type="button" onClick={onReload}>
              Tải bản mới (bỏ thay đổi chưa lưu)
            </button>
          )}
        </div>
      )}
      {saved && <p role="status">Đã lưu bản nháp thành công.</p>}
      {!locked && (
        <button type="submit" disabled={saving}>
          {saving ? "Đang lưu…" : "Lưu bản nháp"}
        </button>
      )}
    </form>
  );
}
