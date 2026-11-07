// PH-001..008 source definition. Contract changes require consumer/owner review.
const fs = require('node:fs');
const path = require('node:path');
const id = { type: 'string', format: 'uuid' };
const positive = { type: 'integer', minimum: 1, maximum: 2147483647 };
const nonnegative = { type: 'integer', minimum: 0, maximum: 2147483647 };
const timestamp = { type: 'string', format: 'date-time' };
const object = (properties, required = Object.keys(properties), extra = false) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: extra,
});
const ref = (name) => ({ $ref: '#/components/schemas/' + name });
const states = [
  'NOT_HELD',
  'HELD',
  'SETTLEMENT_LOCKED',
  'COMMITTED',
  'DISPENSED',
  'RELEASED',
  'EXPIRED',
];
const schemas = {
  Meta: object({ correlationId: { type: 'string' } }),
  ErrorResponse: object({
    error: object(
      { code: { type: 'string' }, message: { type: 'string' }, details: { type: 'object' } },
      ['code', 'message'],
    ),
    meta: ref('Meta'),
  }),
  StockItem: object(
    {
      medicineId: id,
      medicineCode: { type: 'string' },
      name: { type: 'string' },
      onHand: nonnegative,
      reserved: nonnegative,
      available: nonnegative,
      version: positive,
    },
    ['medicineId', 'onHand', 'reserved', 'available'],
    true,
  ),
  Prescription: object(
    {
      id,
      prescriptionId: id,
      revision: positive,
      patientId: id,
      visitId: id,
      state: { const: 'FINAL' },
      itemsSnapshot: {
        type: 'array',
        minItems: 1,
        items: object(
          {
            medicineCode: { type: 'string', minLength: 1 },
            quantity: positive,
            nameSnapshot: { type: 'string' },
            doseText: { type: 'string' },
            instruction: { type: 'string' },
          },
          ['medicineCode', 'quantity'],
          true,
        ),
      },
    },
    ['revision', 'patientId', 'itemsSnapshot'],
    true,
  ),
  MedicationHold: object(
    {
      id,
      prescriptionId: id,
      revision: positive,
      attemptNo: positive,
      status: { enum: states.slice(1) },
      version: positive,
      expiresAt: timestamp,
      amountVnd: { type: 'integer', minimum: 0 },
      chargeId: { type: ['string', 'null'] },
      chargeSync: { type: 'string' },
      settlementState: { type: 'string' },
    },
    [
      'id',
      'prescriptionId',
      'revision',
      'attemptNo',
      'status',
      'version',
      'expiresAt',
      'amountVnd',
    ],
    true,
  ),
  StockPage: object({ items: { type: 'array', items: ref('StockItem') }, total: nonnegative }),
  ReceiptInput: object(
    { medicineId: id, quantity: positive, batchRef: { type: 'string', maxLength: 200 } },
    ['medicineId', 'quantity'],
  ),
  Receipt: object({
    stockReceiptId: id,
    medicineId: id,
    onHand: nonnegative,
    available: nonnegative,
  }),
  PrescriptionPage: object({
    items: { type: 'array', items: ref('Prescription') },
    total: nonnegative,
  }),
  StaffDetail: object({
    view: { const: 'PHARMACY' },
    prescriptionId: id,
    revision: positive,
    latestHoldState: { enum: states },
    dispensedAt: { anyOf: [timestamp, { type: 'null' }] },
    prescription: ref('Prescription'),
    stock: { type: 'array', items: ref('StockItem') },
    holds: { type: 'array', items: ref('MedicationHold') },
  }),
  PatientDetail: object({
    view: { const: 'PATIENT_STATUS' },
    prescriptionId: id,
    revision: positive,
    latestHoldState: { enum: states },
    dispensedAt: { anyOf: [timestamp, { type: 'null' }] },
  }),
  PendingHold: object({
    requestId: id,
    holdId: id,
    state: { enum: states },
    statusUrl: { type: 'string', pattern: '^/api/v1/pharmacy/' },
  }),
  Released: object({ holdId: id, state: { const: 'RELEASED' } }),
  Dispensed: object({ dispenseId: id, holdId: id, state: { const: 'DISPENSED' } }),
};
schemas.Detail = { oneOf: [ref('StaffDetail'), ref('PatientDetail')] };
for (const name of [
  'StockPage',
  'Receipt',
  'PrescriptionPage',
  'Detail',
  'PendingHold',
  'Released',
  'Dispensed',
])
  schemas[name + 'Response'] = object({ data: ref(name), meta: ref('Meta') });
const query = (name, schema) => ({ in: 'query', name, required: false, schema });
const pagination = [
  query('page', { ...positive, default: 1 }),
  query('limit', { ...positive, maximum: 100, default: 20 }),
];
const key = { in: 'header', name: 'Idempotency-Key', required: true, schema: id };
const definitions = [
  [
    'PH-001',
    'get',
    '/stock',
    200,
    'StockPage',
    undefined,
    [...pagination, query('code', { type: 'string' }), query('name', { type: 'string' })],
  ],
  ['PH-002', 'post', '/stock/receipts', 201, 'Receipt', ref('ReceiptInput'), []],
  ['PH-003', 'get', '/prescriptions/queue', 200, 'PrescriptionPage', undefined, pagination],
  [
    'PH-004',
    'get',
    '/prescriptions/{prescriptionId}',
    200,
    'Detail',
    undefined,
    [query('revision', positive), query('holdId', id)],
  ],
  [
    'PH-005',
    'post',
    '/prescriptions/{prescriptionId}/holds',
    202,
    'PendingHold',
    object({ prescriptionRevision: positive }),
    [],
  ],
  [
    'PH-006',
    'delete',
    '/holds/{holdId}',
    200,
    'Released',
    undefined,
    [{ in: 'query', name: 'expectedVersion', required: true, schema: positive }],
  ],
  [
    'PH-007',
    'post',
    '/holds/{holdId}/commit',
    202,
    'PendingHold',
    object({ expectedAttemptNo: positive }),
    [],
  ],
  [
    'PH-008',
    'post',
    '/holds/{holdId}/dispense',
    200,
    'Dispensed',
    object({ expectedVersion: positive }),
    [],
  ],
];
const paths = {};
for (const [operationId, method, suffix, status, response, body, params] of definitions) {
  const route = '/api/v1/pharmacy' + suffix;
  const parameters = [...params];
  for (const match of suffix.matchAll(/\{(.*?)\}/g))
    parameters.push({ in: 'path', name: match[1], required: true, schema: id });
  if (method !== 'get') parameters.push(key);
  if (operationId !== 'PH-001')
    parameters.push({
      in: 'header',
      name: 'X-Authorization-Lease',
      required: true,
      description:
        'Identity RS256 lease, action ' +
        operationId.replace('-', '') +
        ', bound subject/tokenVersion, lifetime <=30s.',
      schema: { type: 'string', minLength: 1 },
    });
  paths[route] ||= {};
  paths[route][method] = {
    operationId,
    tags: ['Pharmacy'],
    security: [{ bearerAuth: [] }],
    parameters,
    ...(body
      ? { requestBody: { required: true, content: { 'application/json': { schema: body } } } }
      : {}),
    responses: Object.fromEntries(
      [status, 400, 401, 403, 404, 409, 503].map((code) => [
        code,
        {
          description: code === status ? 'Operation result' : 'Operation rejected or unavailable',
          ...(code === 202 ? { headers: { Location: { schema: { type: 'string' } } } } : {}),
          content: {
            'application/json': {
              schema: ref(code === status ? response + 'Response' : 'ErrorResponse'),
            },
          },
        },
      ]),
    ),
  };
}
const spec = {
  openapi: '3.1.1',
  info: { title: 'UMC Care Pharmacy PH-001..008', version: '5.2.0' },
  paths,
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas,
  },
};
const target = path.resolve(__dirname, '../../contracts/http/pharmacy.openapi.json');
const output = JSON.stringify(spec, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== output)
    throw new Error('Pharmacy contract is not reproducible.');
} else fs.writeFileSync(target, output);
console.log('Pharmacy contract: 8 operations.');
