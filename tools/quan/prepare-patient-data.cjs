const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { stableId } = require('./demo-dataset');
const medicineCatalog = require('./medicine-catalog.cjs');

const DAY = 86400000;
const MINUTE = 60000;
const sourcePath = path.resolve(__dirname, '../../docs/umc-care-demo-data.json');

function prepare(data, { startDate, days = 14 }) {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(startDate), 'startDate must be YYYY-MM-DD');
  const start = Date.parse(`${startDate}T00:00:00+07:00`);
  assert.equal(new Date(start + 7 * 3600000).toISOString().slice(0, 10), startDate);
  assert(Number.isInteger(days) && days >= 1 && days <= 90);
  const end = start + days * DAY;
  const iso = value => new Date(value).toISOString();
  const id = (kind, key) => stableId('umc-care-patient-data-v1', kind, key);
  const { catalog, identity, patient, appointment, pharmacy } = data.services;
  const admin = identity.users.find(user => identity.staff_capabilities.some(cap => cap.user_id === user.id && cap.capability === 'ADMIN' && cap.enabled));
  const pharmacist = identity.users.find(user => identity.staff_capabilities.some(cap => cap.user_id === user.id && cap.capability === 'PHARMACY' && cap.enabled));
  assert(admin && pharmacist, 'ADMIN and PHARMACY accounts are required');
  const add = (rows, record) => {
    const existing = rows.find(row => row.id === record.id);
    if (!existing) rows.push(record);
    return existing || record;
  };

  const cashier = add(identity.users, {
    id: id('user', 'cashier'), phone: '0000000500', email: 'thungan@example.invalid',
    actor_type: 'STAFF', status: 'ACTIVE', phone_verified_at: null,
    version: 1, token_version: 1, access_version: 1,
  });
  add(identity.staff_capabilities, {
    id: id('capability', 'cashier'), user_id: cashier.id, capability: 'CASHIER', scope_key: 'GLOBAL',
    enabled: true, assigned_by: admin.id, assigned_at: iso(start - DAY),
  });

  const familyNames = [['Nguyễn Ngọc Mai', 'Nguyễn Minh Khang'], ['Trần Thanh Hà', 'Trần Gia Hân']];
  const patientUsers = identity.users.filter(user => user.actor_type === 'PATIENT' && user.status === 'ACTIVE');
  patientUsers.forEach((user, ownerIndex) => {
    const self = patient.patients.find(profile => profile.ownerUserId === user.id && profile.relation === 'SELF');
    assert(self, `Missing SELF profile for ${user.id}`);
    familyNames[ownerIndex % familyNames.length].forEach((name, index) => add(patient.patients, {
      id: id('patient', `${user.id}-family-${index}`), ownerUserId: user.id, relation: 'OTHER', fullName: name,
      birthDate: index === 0 ? '1996-06-15' : '2016-08-20', sex: index === 0 ? 'FEMALE' : 'MALE',
      contactPhone: user.phone, active: true, version: 1, policyVersion: 1,
      createdAt: iso(start - DAY), updatedAt: iso(start - DAY),
    }));
  });

  for (const department of catalog.departments.filter(item => item.status === 'ACTIVE')) {
    if (!catalog.medical_services.some(service => service.department_id === department.id && service.status === 'ACTIVE')) {
      add(catalog.medical_services, {
        id: id('service', department.code), department_id: department.id,
        code: `KHAM_${department.code}`, name: `Khám ${department.name.toLocaleLowerCase('vi-VN')}`, status: 'ACTIVE',
      });
    }
  }
  medicineCatalog.medicines.forEach((definition, index) => {
    const code = `MED-${String(index + 1).padStart(2, '0')}`;
    let medicine = catalog.medicines.find(item => item.code === code);
    if (!medicine) {
      medicine = add(catalog.medicines, { id: id('medicine', code), code, status: 'ACTIVE' });
    }
    Object.assign(medicine, definition);
  });
  updateMedicineSnapshots(data.services, catalog.medicines);
  const testNames = ['Huyết học cơ bản', 'Sinh hóa máu', 'Đường huyết', 'Chức năng gan', 'Chức năng thận', 'Mỡ máu', 'Điện giải', 'Tổng phân tích nước tiểu', 'Vi sinh'];
  testNames.forEach((name, index) => {
    const code = `LAB-${String(index + 2).padStart(2, '0')}`;
    add(catalog.lab_tests, {
      id: id('lab-test', code), code, name, specimen_type: index === 7 ? 'URINE' : 'BLOOD',
      unit: '', reference_range: '', revision: 1, status: 'ACTIVE',
    });
  });

  function ensurePrices(type, items, amount) {
    items.filter(item => item.status === 'ACTIVE').forEach((item, index) => {
      const periods = catalog.price_versions.filter(price => price.item_type === type && price.item_id === item.id)
        .sort((left, right) => Date.parse(left.effective_from) - Date.parse(right.effective_from));
      let cursor = start;
      let revision = Math.max(0, ...periods.map(price => price.revision));
      for (const price of periods) {
        const priceStart = Date.parse(price.effective_from);
        const priceEnd = price.effective_to ? Date.parse(price.effective_to) : Infinity;
        if (priceEnd <= cursor) continue;
        if (priceStart >= end) break;
        if (priceStart > cursor) appendPrice(cursor, Math.min(priceStart, end));
        cursor = Math.max(cursor, priceEnd);
        if (cursor >= end) break;
      }
      if (cursor < end) appendPrice(cursor, end);
      function appendPrice(from, to) {
        revision++;
        add(catalog.price_versions, {
          id: id('price', `${type}-${item.id}-${iso(from)}-${iso(to)}`),
          item_type: type, item_id: item.id, revision, amount_vnd: amount(index),
          effective_from: iso(from), effective_to: iso(to), created_by: admin.id,
        });
        cursor = to;
      }
    });
  }
  ensurePrices('EXAM', catalog.medical_services, index => 150000 + (index % 4) * 25000);
  ensurePrices('MEDICINE', catalog.medicines, index => 2000 + index * 500);
  ensurePrices('LAB', catalog.lab_tests, index => 80000 + index * 10000);

  catalog.medicines.filter(item => item.status === 'ACTIVE').forEach((medicine, index) => {
    if (pharmacy.inventory.some(item => item.medicineId === medicine.id)) return;
    const quantity = 200 + index * 20;
    add(pharmacy.inventory, {
      id: id('inventory', medicine.id), medicineId: medicine.id, medicineCode: medicine.code,
      onHand: quantity, reserved: 0, version: 1, updatedAt: iso(start - DAY),
    });
    add(pharmacy.stock_receipts, {
      id: id('stock-receipt', medicine.id), receiptKey: id('stock-receipt-key', medicine.id), actorUserId: pharmacist.id,
      items: [{ medicineId: medicine.id, quantity, batchRef: `BATCH-${medicine.code}` }], receivedAt: iso(start - DAY),
    });
  });

  const doctors = catalog.doctors.filter(doctor => doctor.status === 'ACTIVE');
  for (let day = 0; day < days; day++) {
    const date = new Date(start + day * DAY + 7 * 3600000).toISOString().slice(0, 10);
    doctors.forEach((doctor, index) => {
      const service = catalog.medical_services.find(item => item.department_id === doctor.department_id && item.status === 'ACTIVE');
      assert(service, `Missing service for doctor ${doctor.id}`);
      for (const hour of [8, 13]) {
        const scheduleStart = Date.parse(`${date}T${String(hour).padStart(2, '0')}:00:00+07:00`);
        const schedule = add(appointment.schedules, {
          id: id('schedule', `${doctor.id}-${date}-${hour}`), doctorId: doctor.id,
          serviceId: service.id, room: `P-${String(index + 1).padStart(3, '0')}`,
          startAt: iso(scheduleStart), endAt: iso(scheduleStart + 4 * 3600000),
          capacityPerSlot: 3, status: 'OPEN', slotMinutes: 30, version: 1,
        });
        for (let slot = 0; slot < 8; slot++) add(appointment.slots, {
          id: id('slot', `${schedule.id}-${slot}`), scheduleId: schedule.id,
          startAt: iso(scheduleStart + slot * 30 * MINUTE), endAt: iso(scheduleStart + (slot + 1) * 30 * MINUTE),
          capacity: 3, heldCount: 0, confirmedCount: 0, version: 1,
        });
      }
    });
  }

  data.metadata.version = '2.3';
  data.metadata.title = 'Dữ liệu danh mục, lịch khám và hành trình bệnh nhân HQH Care';
  data.metadata.availability_note = `Lịch trống chuẩn bị cho ${days} ngày từ ${startDate}, hai ca 08:00–12:00 và 13:00–17:00 theo giờ Việt Nam, mỗi khung 30 phút và 3 chỗ. Giá và tồn kho là số liệu minh họa dành cho kiểm tra phần mềm.`;
  data.metadata.medicine_source = `${medicineCatalog.source.title}. Tên hoạt chất, hàm lượng và dạng bào chế được đối chiếu từ ${medicineCatalog.source.url}`;
  data.metadata.readiness_note = 'Dữ liệu JSON/Excel đã bổ sung đầu vào đặt lịch. Tài khoản example.invalid chưa có thông tin xác thực đăng nhập. Để sử dụng trên ứng dụng cần nạp theo schema từng service, tạo tài khoản bằng Identity và đồng bộ Catalog, quyền truy cập, hồ sơ qua cơ chế tích hợp hiện có.';
  data.metadata.limitations[0] = 'Hành trình đã hoàn thành ngày 10/11/2026 dùng UTC. Các ca và khung giờ bổ sung được ghi riêng theo khoảng thời gian trong availability_note.';
  validate(data, { start, end, days });
  return data;
}

function updateMedicineSnapshots(value, medicines) {
  const byCode = new Map(medicines.map(medicine => [medicine.code, medicine]));
  const byId = new Map(medicines.map(medicine => [medicine.id, medicine]));
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const medicine = byCode.get(node.medicine_code_snapshot || node.medicineCode)
      || byId.get(node.medicine_id || node.medicineId);
    if (medicine) {
      if ('name_snapshot' in node) node.name_snapshot = medicine.name;
      if ('nameSnapshot' in node) node.nameSnapshot = medicine.name;
    }
    Object.values(node).forEach(visit);
  }
  visit(value);
}

function validate(data, { start, end, days }) {
  const { catalog, identity, appointment, pharmacy, patient } = data.services;
  const userById = new Map(identity.users.map(user => [user.id, user]));
  const doctorById = new Map(catalog.doctors.map(doctor => [doctor.id, doctor]));
  const scheduleById = new Map(appointment.schedules.map(schedule => [schedule.id, schedule]));
  for (const [service, tables] of Object.entries(data.services)) {
    for (const [table, rows] of Object.entries(tables)) {
      const ids = rows.filter(row => row.id !== undefined).map(row => row.id);
      assert.equal(new Set(ids).size, ids.length, `Duplicate IDs in ${service}.${table}`);
    }
  }
  for (const field of ['phone', 'email']) {
    const values = identity.users.map(user => user[field]);
    assert.equal(new Set(values).size, values.length, `Duplicate user ${field}`);
  }
  for (const profile of patient.patients) assert.equal(userById.get(profile.ownerUserId)?.actor_type, 'PATIENT');
  const itemLists = { EXAM: catalog.medical_services, MEDICINE: catalog.medicines, LAB: catalog.lab_tests };
  for (const [type, items] of Object.entries(itemLists)) {
    for (const item of items) {
      const prices = catalog.price_versions.filter(price => price.item_type === type && price.item_id === item.id)
        .sort((left, right) => Date.parse(left.effective_from) - Date.parse(right.effective_from));
      for (let index = 1; index < prices.length; index++) {
        const previousEnd = prices[index - 1].effective_to ? Date.parse(prices[index - 1].effective_to) : Infinity;
        assert(previousEnd <= Date.parse(prices[index].effective_from), `Overlapping prices for ${item.code}`);
      }
      let cursor = start;
      for (const price of prices) {
        const from = Date.parse(price.effective_from);
        const to = price.effective_to ? Date.parse(price.effective_to) : Infinity;
        if (to <= cursor) continue;
        assert(from <= cursor, `Price gap for ${item.code}`);
        assert(Number.isSafeInteger(price.amount_vnd) && price.amount_vnd > 0);
        cursor = to;
        if (cursor >= end) break;
      }
      assert(cursor >= end, `Insufficient price coverage for ${item.code}`);
    }
  }
  for (const department of catalog.departments.filter(item => item.status === 'ACTIVE')) {
    const doctors = catalog.doctors.filter(doctor => doctor.department_id === department.id && doctor.status === 'ACTIVE');
    assert(doctors.length >= 2);
    for (const doctor of doctors) {
      assert.equal(userById.get(doctor.identity_user_id)?.actor_type, 'DOCTOR');
      assert.equal(userById.get(doctor.identity_user_id)?.status, 'ACTIVE');
      const schedules = appointment.schedules.filter(schedule => schedule.doctorId === doctor.id && Date.parse(schedule.startAt) >= start && Date.parse(schedule.endAt) <= end);
      assert.equal(schedules.length, days * 2, `Schedule coverage for ${doctor.display_name}`);
    }
  }
  const slotKeys = new Set();
  const slotCounts = new Map();
  for (const slot of appointment.slots) {
    const schedule = scheduleById.get(slot.scheduleId);
    assert(schedule, 'Unknown schedule');
    assert(doctorById.has(schedule.doctorId));
    const service = catalog.medical_services.find(item => item.id === schedule.serviceId);
    const doctor = doctorById.get(schedule.doctorId);
    assert(service && service.department_id === doctor.department_id);
    assert(identity.users.some(user => user.id === doctor.identity_user_id && user.actor_type === 'DOCTOR'));
    assert.equal(schedule.doctorUserId, undefined);
    assert.equal(schedule.departmentId, undefined);
    assert(Date.parse(slot.startAt) >= Date.parse(schedule.startAt) && Date.parse(slot.endAt) <= Date.parse(schedule.endAt));
    assert.equal(Date.parse(slot.endAt) - Date.parse(slot.startAt), 30 * MINUTE);
    assert(slot.heldCount >= 0 && slot.confirmedCount >= 0 && slot.heldCount + slot.confirmedCount <= slot.capacity);
    const key = `${slot.scheduleId}-${slot.startAt}`;
    assert(!slotKeys.has(key), 'Duplicate schedule slot');
    slotKeys.add(key);
    slotCounts.set(schedule.id, (slotCounts.get(schedule.id) || 0) + 1);
  }
  for (const schedule of appointment.schedules) {
    if (Date.parse(schedule.startAt) >= start && Date.parse(schedule.endAt) <= end) {
      assert.equal(slotCounts.get(schedule.id), 8, `Missing slots for ${schedule.id}`);
    }
  }
  for (const medicine of catalog.medicines) {
    assert(medicine.name && medicine.strength && medicine.form && medicine.unit);
    assert(!/^Thuốc (?:mẫu|[A-Z]$)/i.test(medicine.name), `Placeholder name for ${medicine.code}`);
    const stock = pharmacy.inventory.find(item => item.medicineId === medicine.id);
    assert(stock && stock.onHand - stock.reserved > 0, `Missing stock for ${medicine.code}`);
    const received = pharmacy.stock_receipts.flatMap(receipt => receipt.items)
      .filter(item => item.medicineId === medicine.id)
      .reduce((total, item) => total + item.quantity, 0);
    const dispensed = pharmacy.dispenses.flatMap(dispense => dispense.itemsSnapshot)
      .filter(item => item.medicineId === medicine.id)
      .reduce((total, item) => total + item.quantity, 0);
    assert.equal(stock.onHand, received - dispensed, `Stock balance for ${medicine.code}`);
  }
  for (const key of ['code', 'name']) {
    const values = catalog.medicines.map(medicine => medicine[key]);
    assert.equal(new Set(values).size, values.length, `Duplicate medicine ${key}`);
  }
  assert(!/demo/i.test(JSON.stringify(data)));
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const startDate = args[args.indexOf('--start-date') + 1];
  const text = fs.readFileSync(sourcePath, 'utf8');
  const original = JSON.parse(text);
  const prepared = prepare(structuredClone(original), { startDate });
  const repeated = prepare(structuredClone(prepared), { startDate });
  assert.deepEqual(repeated, prepared, 'Repeated preparation must preserve the same dataset');
  const summary = Object.fromEntries(Object.entries(prepared.services).map(([service, tables]) => [service, Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.length]))]));
  if (args.includes('--write')) fs.writeFileSync(sourcePath, JSON.stringify(prepared, null, 2) + '\n');
  console.log(JSON.stringify({ written: args.includes('--write'), startDate, days: 14, summary }, null, 2));
}

module.exports = { prepare, validate };
