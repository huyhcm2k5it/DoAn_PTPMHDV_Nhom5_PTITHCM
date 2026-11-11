const { createHash } = require('node:crypto');

const DEFAULT_BATCH = 'umc-ui-demo-v1';
const NAMESPACE = Buffer.from('84a5817eb4a852bc95110c3d546aa197', 'hex');
const DAY = 86400000;
function stableId(batch, kind, key) {
  const bytes = createHash('sha1')
    .update(NAMESPACE)
    .update(`${batch}:${kind}:${key}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function buildDataset({
  startDate,
  patientCount = 5000,
  doctorCount = 30,
  days = 30,
  medicineCount = 300,
  batchId = DEFAULT_BATCH,
} = {}) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate || '') ||
    new Date(startDate + 'T00:00:00Z').toISOString().slice(0, 10) !== startDate
  ) {
    throw new Error('A valid start date YYYY-MM-DD is required.');
  }
  for (const [name, value, max] of [
    ['patientCount', patientCount, 50000],
    ['doctorCount', doctorCount, 100],
    ['days', days, 90],
    ['medicineCount', medicineCount, 1000],
  ]) {
    if (!Number.isInteger(value) || value < 1 || value > max)
      throw new Error(`Invalid ${name}; allowed range 1..${max}.`);
  }
  if (!/^umc-[a-z0-9-]{1,60}$/.test(batchId))
    throw new Error(
      'Batch id must start with umc- and contain lowercase letters, numbers or hyphens.',
    );
  const id = (kind, key) => stableId(batchId, kind, key);
  const anchor = new Date(startDate + 'T00:00:00+07:00');
  const createdAt = new Date(anchor.getTime() - DAY);
  const config = {
    startDate,
    patientCount,
    doctorCount,
    days,
    medicineCount,
    batchId,
  };
  const surnames = [
    'Nguyễn',
    'Trần',
    'Lê',
    'Phạm',
    'Hoàng',
    'Huỳnh',
    'Vũ',
    'Võ',
    'Đặng',
    'Bùi',
    'Đỗ',
    'Hồ',
    'Ngô',
    'Dương',
    'Lý',
  ];
  const middles = [
    'Gia',
    'Minh',
    'Thanh',
    'Ngọc',
    'Quốc',
    'Thành',
    'Hoài',
    'Bảo',
    'Khánh',
    'Tuệ',
  ];
  const names = [
    'An',
    'Bình',
    'Châu',
    'Dũng',
    'Giang',
    'Hà',
    'Hải',
    'Hân',
    'Hòa',
    'Huy',
    'Khang',
    'Lan',
    'Linh',
    'Long',
    'Mai',
    'Nam',
    'Ngân',
    'Phúc',
    'Quân',
    'Thảo',
    'Trang',
    'Trúc',
    'Tú',
    'Uyên',
    'Vi',
  ];
  const places = [
    'TP. Hồ Chí Minh',
    'Hà Nội',
    'Đà Nẵng',
    'Cần Thơ',
    'Huế',
    'Đồng Nai',
  ];
  const person = (index) =>
    `${surnames[index % surnames.length]} ${middles[Math.floor(index / surnames.length) % middles.length]} ${names[Math.floor(index / (surnames.length * middles.length)) % names.length]}`;
  const patients = Array.from({ length: patientCount }, (_, index) => ({
    id: id('patient', index),
    ownerUserId: id('fictional-owner', Math.floor(index / 2)),
    relation: index % 2 ? 'OTHER' : 'SELF',
    fullName: `DEMO ${person(index)} ${String(index + 1).padStart(5, '0')}`,
    birthDate: `${1950 + (index % 60)}-${String(1 + (index % 12)).padStart(2, '0')}-${String(1 + (index % 28)).padStart(2, '0')}`,
    sex: index % 2 ? 'FEMALE' : 'MALE',
    contactPhone: '000' + String(index + 1).padStart(7, '0'),
    address: `Địa chỉ giả lập DEMO ${index + 1}, ${places[index % places.length]}`,
    active: true,
    version: 1,
    policyVersion: 1,
    createdAt,
    updatedAt: createdAt,
  }));
  const specialties = [
    'Nội tổng quát',
    'Ngoại tổng quát',
    'Nhi',
    'Tai Mũi Họng',
    'Mắt',
    'Da liễu',
    'Tim mạch',
    'Tiêu hóa',
    'Cơ xương khớp',
    'Hô hấp',
  ];
  const departments = specialties.map((name, index) => ({
    id: id('department', index),
    kind: 'DEPARTMENT',
    name: 'DEMO ' + name,
    code: `DEMO-DEP-${String(index + 1).padStart(2, '0')}`,
    source: 'DEMO_FIXTURE',
    seedBatch: batchId,
  }));
  const services = specialties.map((name, index) => ({
    id: id('service', index),
    kind: 'SERVICE',
    departmentId: departments[index].id,
    name: 'DEMO Khám ' + name,
    code: `DEMO-SVC-${String(index + 1).padStart(2, '0')}`,
    source: 'DEMO_FIXTURE',
    seedBatch: batchId,
  }));
  const doctors = Array.from({ length: doctorCount }, (_, index) => ({
    id: id('doctor', index),
    kind: 'DOCTOR',
    userId: id('fictional-doctor-user', index),
    departmentId: departments[index % 10].id,
    serviceId: services[index % 10].id,
    name: `DEMO BS. ${person(index + 100)} ${index + 1}`,
    source: 'DEMO_FIXTURE',
    seedBatch: batchId,
  }));
  const schedules = [];
  const slots = [];
  for (let day = 0; day < days; day++) {
    const date = new Date(Date.parse(startDate + 'T00:00:00Z') + day * DAY)
      .toISOString()
      .slice(0, 10);
    doctors.forEach((doctor, index) => {
      for (const hour of [8, 13]) {
        const startAt = new Date(
          `${date}T${String(hour).padStart(2, '0')}:00:00+07:00`,
        );
        const endAt = new Date(startAt.getTime() + 4 * 3600000);
        const schedule = {
          id: id('schedule', `${day}:${index}:${hour}`),
          doctorId: doctor.id,
          doctorUserId: doctor.userId,
          departmentId: doctor.departmentId,
          serviceId: doctor.serviceId,
          room: `DEMO-${String(index + 1).padStart(3, '0')}`,
          startAt,
          endAt,
          capacityPerSlot: 3 + (index % 3),
          status: 'OPEN',
          slotMinutes: 30,
          version: 1,
        };
        schedules.push(schedule);
        for (let slot = 0; slot < 8; slot++) {
          slots.push({
            id: id('slot', `${day}:${index}:${hour}:${slot}`),
            scheduleId: schedule.id,
            startAt: new Date(startAt.getTime() + slot * 1800000),
            endAt: new Date(startAt.getTime() + (slot + 1) * 1800000),
            capacity: schedule.capacityPerSlot,
            heldCount: 0,
            confirmedCount: 0,
          });
        }
      }
    });
  }
  const inventory = [],
    medicines = [],
    receipts = [],
    audits = [];
  const labels = [
    'Viên mẫu',
    'Dung dịch mẫu',
    'Gói mẫu',
    'Viên bổ sung mẫu',
    'Kem mẫu',
    'Ống mẫu',
  ];
  const units = ['viên', 'chai', 'gói', 'viên', 'tuýp', 'ống'];
  for (let index = 0; index < medicineCount; index++) {
    const medicineId = id('medicine', index);
    const fullSnapshot = {
      id: medicineId,
      code: `DEMO-MED-${String(index + 1).padStart(4, '0')}`,
      name: `DEMO ${labels[index % labels.length]} ${String(index + 1).padStart(3, '0')}`,
      unit: units[index % units.length],
      status: 'ACTIVE',
      revision: 1,
    };
    const onHand =
      index % 17 === 0
        ? 0
        : index % 11 === 0
          ? 5 + (index % 10)
          : 100 + ((index * 37) % 2900);
    inventory.push({
      id: id('inventory', index),
      medicineId,
      onHand,
      reserved: 0,
      version: 1,
      updatedAt: createdAt,
    });
    medicines.push({
      entityKey: 'MEDICINE:' + medicineId,
      entityType: 'MEDICINE',
      entityId: medicineId,
      entityVersion: 1,
      fullSnapshot,
      active: true,
      effectiveAt: createdAt,
      source: 'DEMO_FIXTURE',
      seedBatch: batchId,
      updatedAt: createdAt,
    });
    const receiptId = id('opening-receipt', index);
    receipts.push({
      id: receiptId,
      receiptKey: `${batchId}:opening:${index}`,
      actorUserId: id('seed-operator', 0),
      items: [{ medicineId, quantity: onHand, batchRef: 'DEMO-OPENING-STOCK' }],
      receivedAt: createdAt,
      source: 'DEMO_FIXTURE',
      seedBatch: batchId,
    });
    audits.push({
      id: id('opening-audit', index),
      medicineId,
      kind: 'DEMO_OPENING_BALANCE',
      quantity: onHand,
      receiptId,
      actorUserId: id('seed-operator', 0),
      at: createdAt,
      source: 'DEMO_FIXTURE',
      seedBatch: batchId,
    });
  }
  return {
    batchId,
    startDate,
    config,
    collections: {
      patient: { patients },
      appointment: {
        demo_reference_data: [...departments, ...services, ...doctors],
        schedules,
        slots,
      },
      pharmacy: {
        inventory,
        catalog_projection: medicines,
        stock_receipts: receipts,
        stock_audit: audits,
      },
    },
    examples: {
      patientId: patients[0].id,
      ownerUserId: patients[0].ownerUserId,
      doctorId: doctors[0].id,
      serviceId: doctors[0].serviceId,
      date: startDate,
      medicineId: inventory[0].medicineId,
      medicineCode: medicines[0].fullSnapshot.code,
    },
  };
}
module.exports = { DEFAULT_BATCH, stableId, buildDataset };
