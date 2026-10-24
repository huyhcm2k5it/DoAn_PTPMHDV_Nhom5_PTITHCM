export type ApiFailure = { status?: number; code?: string; message?: string; correlationId?: string };

export function ErrorPanel({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const failure = (error ?? {}) as ApiFailure;
  const status = failure.status;
  const retryable = status === 503 || status === 502 || status === 429 || status === undefined || status >= 500;
  let message = failure.message || "Đã xảy ra lỗi khi tải dữ liệu.";
  if (status === 401) message = "Phiên đăng nhập không còn hợp lệ. Đang chuyển tới xác thực.";
  else if (status === 403) message = "Tài khoản hiện tại không có quyền xem nội dung này.";
  else if (status === 503) message = "Dịch vụ tạm thời chưa sẵn sàng. Bạn có thể thử lại.";
  else if (status === 502) message = "Dịch vụ trả về dữ liệu chưa đúng định dạng. Hãy thử lại sau.";
  return <section className="state-card state-error" role="alert"><span className="state-icon" aria-hidden="true">!</span><h2>{status === 403 ? "Không đủ quyền" : "Chưa tải được dữ liệu"}</h2><p>{message}</p>{failure.correlationId && <small>Mã tra cứu: {failure.correlationId}</small>}{retryable && onRetry && <button className="button button-secondary" type="button" onClick={onRetry}>Thử tải lại</button>}</section>;
}