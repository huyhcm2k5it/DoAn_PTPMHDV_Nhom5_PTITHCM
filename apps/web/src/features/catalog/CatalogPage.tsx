import { useEffect, useState } from "react";
import type { DependencyList } from "react";
import type {
  CatalogApi,
  Department,
  Doctor,
  MedicalService,
  Medicine,
  LabTest,
  Price,
  Session,
} from "./types";
import { can } from "./types";
import { errorMessage } from "./api";
import { PriceForm } from "./PriceForm";
import type { PriceChoice } from "./PriceForm";
import "./catalog.css";

function useLoad<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList,
) {
  const [state, setState] = useState<{
    data?: T;
    pending: boolean;
    error?: unknown;
  }>({ pending: true });
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setState({ pending: true });
    load(controller.signal).then(
      (data) => {
        if (current) setState({ pending: false, data });
      },
      (error) => {
        if (current) setState({ pending: false, error });
      },
    );
    return () => {
      current = false;
      controller.abort();
    };
  }, deps);
  return state;
}
export function formatPrice(price: Price | null) {
  if (!price) return "Chưa có giá hiệu lực";
  if (!Number.isSafeInteger(price.amountVnd))
    return "Giá vượt giới hạn hiển thị an toàn";
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(price.amountVnd);
}
type PublicData = {
  doctors: { items: Doctor[]; total: number };
  services: MedicalService[];
};
export function CatalogPage({
  api,
  session,
  onChooseDoctor,
  onChooseService,
}: {
  api: CatalogApi;
  session?: Session;
  onChooseDoctor?: (id: string) => void;
  onChooseService?: (id: string) => void;
}) {
  const [department, setDepartment] = useState("");
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<"public" | "medicines" | "lab">("public");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [refresh, setRefresh] = useState(0);
  const admin = can(session, "ADMIN");
  const medicineAllowed =
    session?.actorType === "DOCTOR" || can(session, "PHARMACY", "ADMIN");
  const labAllowed =
    session?.actorType === "DOCTOR" ||
    can(session, "LAB_TECH", "LAB_REVIEW", "ADMIN");
  // Session is owned by the shell; role changes must clear restricted data immediately.
  const allowedTab =
    (tab === "medicines" && !medicineAllowed) || (tab === "lab" && !labAllowed)
      ? "public"
      : tab;
  const departments = useLoad<Department[]>(
    (signal) => api.departments(signal),
    [api, refresh],
  );
  const publicData = useLoad<PublicData>(
    async (signal) => {
      const [doctors, services] = await Promise.all([
        api.doctors(department, page, signal),
        api.services(department, signal),
      ]);
      return { doctors, services };
    },
    [api, department, page, refresh],
  );
  const privateData = useLoad<(Medicine | LabTest)[]>(
    async (signal) =>
      allowedTab === "medicines"
        ? api.medicines(search, signal)
        : allowedTab === "lab"
          ? api.labTests(search, signal)
          : [],
    [api, allowedTab, search, refresh, session],
  );
  const data = publicData.data;
  const restricted = privateData.data ?? [];
  const active = allowedTab === "public" ? publicData : privateData;
  const choices: PriceChoice[] =
    allowedTab === "public"
      ? (data?.services ?? []).map((x) => ({
          type: "EXAM",
          id: x.id,
          name: x.name,
        }))
      : restricted.map((x) => ({
          type: allowedTab === "medicines" ? "MEDICINE" : "LAB",
          id: x.id,
          name: x.name,
        }));
  function changeTab(value: typeof tab) {
    setTab(value);
    setQ("");
    setSearch("");
  }
  return (
    <section className="umc-catalog" aria-labelledby="catalog-heading">
      <header className="catalog-header">
        <p className="catalog-eyebrow">UMC CARE · ĐỒ ÁN NHÓM 5</p>
        <h1 id="catalog-heading">
          Chọn chuyên khoa.
          <br />
          Hiểu rõ dịch vụ.
        </h1>
        <p>Tra cứu bác sĩ, dịch vụ và giá hiệu lực trước khi chọn lịch khám.</p>
      </header>
      <div className="catalog-toolbar">
        <label>
          Chuyên khoa
          <select
            value={department}
            onChange={(e) => {
              setDepartment(e.target.value);
              setPage(1);
            }}
            disabled={departments.pending}
          >
            <option value="">Tất cả chuyên khoa</option>
            {departments.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <div role="tablist" aria-label="Nhóm danh mục">
          <button
            role="tab"
            aria-selected={allowedTab === "public"}
            onClick={() => changeTab("public")}
          >
            Bác sĩ & dịch vụ
          </button>
          {medicineAllowed && (
            <button
              role="tab"
              aria-selected={allowedTab === "medicines"}
              onClick={() => changeTab("medicines")}
            >
              Thuốc
            </button>
          )}
          {labAllowed && (
            <button
              role="tab"
              aria-selected={allowedTab === "lab"}
              onClick={() => changeTab("lab")}
            >
              Xét nghiệm
            </button>
          )}
        </div>
      </div>
      {departments.error != null && (
        <p role="alert">
          Không tải được chuyên khoa. {errorMessage(departments.error)}
        </p>
      )}
      {allowedTab !== "public" && (
        <form
          className="catalog-search"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q);
          }}
        >
          <label>
            Tìm tên hoặc mã
            <input
              maxLength={100}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <button type="submit">Tìm kiếm</button>
        </form>
      )}
      {active.pending ? (
        <p role="status">Đang tải danh mục…</p>
      ) : active.error != null ? (
        <div role="alert">
          <p>{errorMessage(active.error)}</p>
          <button onClick={() => setRefresh((x) => x + 1)}>Thử lại</button>
        </div>
      ) : allowedTab === "public" ? (
        <>
          <div className="catalog-section-title">
            <h2>Bác sĩ theo chuyên khoa</h2>
            <span>{data?.doctors.total ?? 0} bác sĩ</span>
          </div>
          <div className="catalog-grid">
            {data?.doctors.items.map((d) => (
              <article className="catalog-card" key={d.id}>
                <span className="catalog-avatar" aria-hidden="true">
                  BS
                </span>
                <div>
                  <h3>{d.displayName}</h3>
                  <p>
                    {departments.data?.find((x) => x.id === d.departmentId)
                      ?.name ?? "Chuyên khoa"}
                  </p>
                </div>
                {onChooseDoctor && (
                  <button
                    onClick={() => onChooseDoctor(d.id)}
                    aria-label={`Chọn ${d.displayName}`}
                  >
                    Chọn bác sĩ
                  </button>
                )}
              </article>
            ))}
          </div>
          {!data?.doctors.items.length && (
            <p className="catalog-empty">Chưa có bác sĩ trong danh mục này.</p>
          )}
          {(data?.doctors.total ?? 0) > 20 && (
            <nav aria-label="Phân trang bác sĩ">
              <button
                disabled={page === 1}
                onClick={() => setPage((x) => x - 1)}
              >
                Trang trước
              </button>
              <span> Trang {page} </span>
              <button
                disabled={page * 20 >= (data?.doctors.total ?? 0)}
                onClick={() => setPage((x) => x + 1)}
              >
                Trang sau
              </button>
            </nav>
          )}
          <div className="catalog-section-title">
            <h2>Dịch vụ & giá tham khảo</h2>
            <span>VND</span>
          </div>
          <p className="catalog-note">
            Giá hiển thị theo thời điểm tra cứu; phí được xác định lại khi thực
            hiện giao dịch.
          </p>
          <div className="catalog-grid">
            {data?.services.map((s) => (
              <article className="catalog-card" key={s.id}>
                <div>
                  <small>{s.code}</small>
                  <h3>{s.name}</h3>
                  <strong>{formatPrice(s.price)}</strong>
                </div>
                {onChooseService && (
                  <button
                    onClick={() => onChooseService(s.id)}
                    disabled={!s.price}
                  >
                    Chọn dịch vụ
                  </button>
                )}
              </article>
            ))}
          </div>
          {!data?.services.length && (
            <p className="catalog-empty">
              Chưa có dịch vụ trong chuyên khoa này.
            </p>
          )}
        </>
      ) : (
        <>
          <h2>
            {allowedTab === "medicines"
              ? "Danh mục thuốc"
              : "Danh mục xét nghiệm"}
          </h2>
          <div className="catalog-grid">
            {restricted.map((x) => (
              <article className="catalog-card" key={x.id}>
                <div>
                  <small>{x.code}</small>
                  <h3>{x.name}</h3>
                  <p>
                    {"specimenType" in x
                      ? `Mẫu: ${x.specimenType}`
                      : `Đơn vị: ${x.unit}`}
                  </p>
                  <strong>{formatPrice(x.price)}</strong>
                </div>
              </article>
            ))}
          </div>
          {!restricted.length && (
            <p className="catalog-empty">
              {allowedTab === "medicines"
                ? "Chưa có thuốc phù hợp."
                : "Chưa có xét nghiệm phù hợp."}
            </p>
          )}
        </>
      )}
      {admin && (
        <PriceForm
          key={allowedTab}
          api={api}
          choices={active.pending || active.error != null ? [] : choices}
          onSaved={() => setRefresh((x) => x + 1)}
        />
      )}
      <footer className="catalog-note">
        Dữ liệu đồ án phục vụ học tập. Danh mục thuốc không thể hiện tồn kho và
        không thay thế chỉ định khám.
      </footer>
    </section>
  );
}
