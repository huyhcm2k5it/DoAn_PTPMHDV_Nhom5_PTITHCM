export function Loading({ label = "Đang tải dữ liệu" }: { label?: string }) {
  return <p className="state-loading" role="status" aria-live="polite"><span className="state-spinner" aria-hidden="true" />{label}</p>;
}