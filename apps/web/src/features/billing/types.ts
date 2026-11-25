export type ChargeSourceType = 'APPOINTMENT' | 'LAB_ORDER' | 'MED_HOLD';

export type ChargeState = 'OPEN' | 'PAID' | 'VOID';

export type PriceSnapshotItem = {
  itemId?: string;
  name?: string;
  code?: string;
  quantity?: number;
  unitAmountVnd?: number;
  amountVnd?: number;
  currency?: string;
  priceVersionId?: string;
};

export type Charge = {
  id: string;
  patientId: string;
  sourceType: ChargeSourceType;
  sourceId: string;
  sourceRevision: number;
  amountVnd: number;
  state: ChargeState;
  settlementState: string;
  createdAt: string | null;
  updatedAt?: string | null;
  priceSnapshot?: PriceSnapshotItem[];
};

export type PaymentState = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'IN_DOUBT';

export type Payment = {
  id: string;
  receiptId: string | null;
  transactionId: string;
  amountVnd: number;
  state: PaymentState;
  method: string;
  paidAt: string | null;
};

export type Receipt = {
  id: string;
  receiptNo: string;
  paymentId: string;
  chargeId: string;
  amountVnd: number;
  issuedAt: string | null;
};

export type RefundState = 'REQUESTED' | 'EXECUTED' | 'FAILED';

export type Refund = {
  id: string;
  chargeId: string;
  cancellationId?: string;
  reasonCode: string;
  amountVnd: number;
  state: RefundState;
  attempts?: Array<{
    transactionId: string;
    scenario: string;
    result: string;
    executedAt: string;
  }>;
  version?: number;
  updatedAt?: string;
};

export type ChargeDetail = {
  charge: Charge;
  latestPayment?: Payment;
  saga?: {
    id: string;
    state: string;
    fence?: number;
  };
  refundState?: string;
  receiptId?: string;
};

export type PaymentResult = {
  requestId: string;
  paymentId: string;
  state: PaymentState;
  statusUrl?: string;
};

export type AdminReportSummary = {
  receivedVnd: number;
  refundedVnd: number;
  asOf: string;
};

export type BillingApi = {
  getPatientCharges(
    patientId: string,
    query?: { state?: string; page?: number; limit?: number },
    signal?: AbortSignal,
  ): Promise<{ items: Charge[]; total: number }>;

  getCharges(
    query?: { state?: string; page?: number; limit?: number },
    signal?: AbortSignal,
  ): Promise<{ items: Charge[]; total: number }>;

  getCharge(chargeId: string, signal?: AbortSignal): Promise<ChargeDetail>;

  simulatePayment(
    input: { chargeId: string; transactionId: string },
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<PaymentResult>;

  counterPayment(
    input: {
      chargeId: string;
      transactionId: string;
      counterReference: string;
    },
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<PaymentResult>;

  getReceipt(receiptId: string, signal?: AbortSignal): Promise<Receipt>;

  createRefund(
    input: { chargeId: string; reasonCode: string; cancellationId?: string },
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<Refund>;

  executeRefund(
    refundId: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<Refund>;

  listRefunds(
    query?: { state?: string; page?: number; limit?: number },
    signal?: AbortSignal,
  ): Promise<{ items: Refund[]; total: number }>;

  getReportSummary(signal?: AbortSignal): Promise<AdminReportSummary>;
};
