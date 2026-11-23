import type { GatewayTransport } from '../../app/runtime';
import type {
  AdminReportSummary,
  BillingApi,
  Charge,
  ChargeDetail,
  PaymentResult,
  Receipt,
  Refund,
} from './types';

export function createBillingApi(
  transport: GatewayTransport,
  lease?: (action: string) => Promise<string>,
): BillingApi {
  async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await transport(url, init);
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(
        body?.error?.message ?? 'Không thực hiện được thao tác viện phí.',
      ) as Error & { status: number; code?: string; correlationId?: string };
      error.status = response.status;
      error.code = body?.error?.code;
      error.correlationId = body?.correlationId ?? body?.meta?.correlationId;
      throw error;
    }
    if (!body || !Object.hasOwn(body, 'data')) {
      const error = new Error(
        'Máy chủ trả dữ liệu không đúng hợp đồng.',
      ) as Error & {
        status: number;
        code: string;
      };
      error.status = 502;
      error.code = 'INVALID_RESPONSE';
      throw error;
    }
    return body.data as T;
  }

  async function mutationHeaders(action: string, key?: string) {
    const headers = new Headers({
      'Content-Type': 'application/json',
    });
    if (key) headers.set('Idempotency-Key', key);
    if (lease) {
      const token = await lease(action).catch(() => undefined);
      if (token) headers.set('X-Authorization-Lease', token);
    }
    return headers;
  }

  return {
    async getPatientCharges(patientId, query, signal) {
      const params = new URLSearchParams();
      if (query?.state) params.set('state', query.state);
      if (query?.page) params.set('page', String(query.page));
      if (query?.limit) params.set('limit', String(query.limit));
      const qs = params.toString();
      const url = `/api/v1/patients/${encodeURIComponent(patientId)}/charges${qs ? `?${qs}` : ''}`;
      return request<{ items: Charge[]; total: number }>(url, { signal });
    },

    async getCharges(query, signal) {
      const params = new URLSearchParams();
      if (query?.state) params.set('state', query.state);
      if (query?.page) params.set('page', String(query.page));
      if (query?.limit) params.set('limit', String(query.limit));
      const qs = params.toString();
      const url = `/api/v1/charges${qs ? `?${qs}` : ''}`;
      return request<{ items: Charge[]; total: number }>(url, { signal });
    },

    async getCharge(chargeId, signal) {
      return request<ChargeDetail>(
        `/api/v1/charges/${encodeURIComponent(chargeId)}`,
        { signal },
      );
    },

    async simulatePayment(input, idempotencyKey, signal) {
      return request<PaymentResult>('/api/v1/payments/simulate', {
        method: 'POST',
        signal,
        headers: await mutationHeaders('BI-004', idempotencyKey),
        body: JSON.stringify(input),
      });
    },

    async counterPayment(input, idempotencyKey, signal) {
      return request<PaymentResult>('/api/v1/payments/counter', {
        method: 'POST',
        signal,
        headers: await mutationHeaders('BI-005', idempotencyKey),
        body: JSON.stringify(input),
      });
    },

    async getReceipt(receiptId, signal) {
      const result = await request<{ receipt: Receipt }>(
        `/api/v1/receipts/${encodeURIComponent(receiptId)}`,
        { signal },
      );
      return result.receipt;
    },

    async createRefund(input, idempotencyKey, signal) {
      const result = await request<{ refund: Refund }>('/api/v1/refunds', {
        method: 'POST',
        signal,
        headers: await mutationHeaders('BI-007', idempotencyKey),
        body: JSON.stringify(input),
      });
      return result.refund;
    },

    async executeRefund(refundId, idempotencyKey, signal) {
      const result = await request<{ refund: Refund }>(
        `/api/v1/refunds/${encodeURIComponent(refundId)}/execute`,
        {
          method: 'POST',
          signal,
          headers: await mutationHeaders('BI-008', idempotencyKey),
        },
      );
      return result.refund;
    },

    async listRefunds(query, signal) {
      const params = new URLSearchParams();
      if (query?.state) params.set('state', query.state);
      if (query?.page) params.set('page', String(query.page));
      if (query?.limit) params.set('limit', String(query.limit));
      const qs = params.toString();
      const url = `/api/v1/refunds${qs ? `?${qs}` : ''}`;
      return request<{ items: Refund[]; total: number }>(url, { signal });
    },

    async getReportSummary(signal) {
      return request<AdminReportSummary>('/api/v1/admin/reports/summary', {
        signal,
      });
    },
  };
}
