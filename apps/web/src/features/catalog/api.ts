import type {
  CatalogApi,
  Department,
  Doctor,
  MedicalService,
  Medicine,
  LabTest,
  PriceResult,
} from "./types";
// Inject Hưng's shared transport here. The feature never stores tokens or grants permissions.
export type Transport = (url: string, init?: RequestInit) => Promise<Response>;
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public correlationId?: string,
  ) {
    super(message);
  }
}
export function createCatalogApi(transport: Transport): CatalogApi {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await transport(`/api/v1/${path}`, init);
    const body = await res.json().catch(() => null);
    if (!res.ok)
      throw new ApiError(
        res.status,
        body?.error?.code ?? "INVALID_RESPONSE",
        body?.error?.message ?? "Không đọc được phản hồi máy chủ",
        body?.meta?.correlationId,
      );
    if (!body || !Object.hasOwn(body, "data"))
      throw new ApiError(
        502,
        "INVALID_RESPONSE",
        "Máy chủ trả dữ liệu không đúng hợp đồng",
      );
    return body.data as T;
  }
  return {
    departments: async (signal) =>
      (await request<{ items: Department[] }>("departments", { signal })).items,
    doctors: (departmentId, page, signal) =>
      request<{ items: Doctor[]; total: number }>(
        `doctors?${new URLSearchParams({ ...(departmentId && { departmentId }), page: String(page), limit: "20" })}`,
        { signal },
      ),
    services: async (departmentId, signal) =>
      (
        await request<{ items: MedicalService[] }>(
          `medical-services${departmentId ? `?${new URLSearchParams({ departmentId })}` : ""}`,
          { signal },
        )
      ).items,
    medicines: (q, signal) =>
      request<Medicine[]>(
        `catalog/medicines?${new URLSearchParams({ q, status: "ACTIVE" })}`,
        { signal },
      ),
    labTests: (q, signal) =>
      request<LabTest[]>(
        `catalog/lab-tests?${new URLSearchParams({ q, status: "ACTIVE" })}`,
        { signal },
      ),
    createPrice: (input, key) =>
      request<PriceResult>("prices", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(input),
      }),
  };
}
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const friendly: Record<string, string> = {
      UNAUTHENTICATED: "Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.",
      FORBIDDEN: "Tài khoản hoặc quyền hiện tại không cho phép thao tác này.",
      OVERLAPPING_PRICE_PERIOD:
        "Khoảng thời gian này trùng một phiên bản giá. Hãy kiểm tra lại khoảng hiệu lực.",
      IDEMPOTENCY_CONFLICT:
        "Mã yêu cầu đã gắn với một nội dung khác. Hãy kiểm tra lại thao tác.",
      SERVICE_UNAVAILABLE: "Dịch vụ tạm thời chưa sẵn sàng. Hãy thử lại.",
    };
    return `${friendly[error.code] ?? error.message}${error.correlationId ? ` (Mã tra cứu: ${error.correlationId})` : ""}`;
  }
  return "Không kết nối được máy chủ. Hãy kiểm tra mạng và thử lại.";
}
