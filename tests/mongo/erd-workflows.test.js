const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID: id } = require('node:crypto');
const { mongoHarness } = require('./test-harness');
const { ensurePatientStorage } = require('../../services/patient/src/dbs/indexes');
const { ensureAppointmentStorage } = require('../../services/appointment/src/dbs/indexes');
const { ensurePharmacyStorage } = require('../../services/pharmacy/src/dbs/indexes');
const { installBusinessValidators, auditBusinessStorage } = require('../../mongo/erd-storage');
const {
  applyIdentityAccessChanged,
} = require('../../services/patient/src/services/identity-projection.service');
const { createApp } = require('../../services/patient/src/app');
const { createSchedule } = require('../../services/appointment/src/services/schedules.service');
const { createHold } = require('../../services/appointment/src/services/holds.service');
const {
  createAppointment,
} = require('../../services/appointment/src/services/appointments.service');
const {
  handleBillingMessage,
  handleReserveSettlementCommand,
} = require('../../services/appointment/src/workers/billing-events.worker');
const {
  checkInAppointment,
  callNextQueueTicket,
} = require('../../services/appointment/src/services/queue.service');
const {
  handleClaimQueueTicketCommand,
  handleClinicalMessage,
} = require('../../services/appointment/src/workers/clinical-events.worker');
const { receiveStock } = require('../../services/pharmacy/src/services/stock.service');
const {
  applyPrescriptionFinalized,
} = require('../../services/pharmacy/src/services/prescription-projection.service');
const {
  createMedicationHold,
} = require('../../services/pharmacy/src/services/medication-holds.service');
const {
  handleBillingMessage: pharmacyBilling,
} = require('../../services/pharmacy/src/services/settlement.service');
const { dispenseMedication } = require('../../services/pharmacy/src/services/dispenses.service');
const {
  loadMedicationHold,
} = require('../../services/pharmacy/src/services/medication-hold.repository');
const h = mongoHarness(ensurePatientStorage);
const now = new Date('2026-12-01T00:00:00Z');
function identity(userId, actorType, phone, capabilities = []) {
  return {
    messageId: id(),
    messageKind: 'EVENT',
    messageType: 'IdentityAccessChanged',
    schemaVersion: 1,
    producer: 'identity',
    aggregateId: userId,
    aggregateVersion: 1,
    correlationId: id(),
    causationId: null,
    requestId: null,
    occurredAt: now.toISOString(),
    payload: {
      userId,
      actorType,
      phone,
      capabilities,
      status: 'ACTIVE',
      phoneVerified: true,
      tokenVersion: 1,
      version: 1,
    },
  };
}
test('strict ERD storage survives ownerPhone HTTP, booking/payment/Clinical and full pharmacy dispensing', async (t) => {
  const patientDb = h.connection.useDb('erd_patient', { useCache: true });
  const appDb = h.connection.useDb('erd_appointment', { useCache: true });
  const pharmacyDb = h.connection.useDb('erd_pharmacy', { useCache: true });
  for (const [connection, owner, bootstrap] of [
    [patientDb, 'patient', ensurePatientStorage],
    [appDb, 'appointment', ensureAppointmentStorage],
    [pharmacyDb, 'pharmacy', ensurePharmacyStorage],
  ]) {
    await bootstrap(connection);
    await installBusinessValidators(connection, owner);
  }
  const reception = id(),
    owner = id(),
    doctor = id(),
    doctorUser = id(),
    department = id(),
    service = id(),
    pharmacist = id();
  await applyIdentityAccessChanged({
    connection: patientDb,
    message: identity(reception, 'STAFF', '0901234500', ['RECEPTION']),
    now,
  });
  await applyIdentityAccessChanged({
    connection: patientDb,
    message: identity(owner, 'PATIENT', '0901234567'),
    now,
  });
  const server = createApp({
    connection: patientDb,
    now: () => now,
    verifyBearerToken: async () => ({ sub: reception, actorType: 'STAFF', tokenVersion: 1 }),
    verifyAuthorizationLease: async (_, options) => ({
      tokenType: 'LEASE',
      sub: options.subject,
      action: options.action,
      tokenVersion: options.tokenVersion,
      iat: +now / 1000,
      exp: +now / 1000 + 30,
    }),
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/v1/patients', {
    method: 'POST',
    headers: {
      authorization: 'Bearer reception',
      'x-authorization-lease': 'test',
      'content-type': 'application/json',
      'idempotency-key': id(),
    },
    body: JSON.stringify({
      ownerPhone: '0901234567',
      relation: 'OTHER',
      fullName: 'ERD Patient',
      birthDate: '1990-01-01',
    }),
  });
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  const patient = (await response.json()).data.patient;
  assert.equal(patient.ownerUserId, owner);
  assert.equal(patient.birthDate, '1990-01-01');
  const patientId = patient.id;
  assert.ok(
    (await patientDb.collection('patients').findOne({ id: patientId })).birthDate instanceof Date,
  );
  await appDb
    .collection('patient_access_projection')
    .insertOne({ patientId, ownerUserId: owner, active: true, policyVersion: 1 });
  await appDb.collection('catalog_projection').insertOne({
    entityKey: 'DOCTOR:' + doctor,
    entityType: 'DOCTOR',
    entityId: doctor,
    entityVersion: 1,
    active: true,
    fullSnapshot: {
      id: doctor,
      identityUserId: doctorUser,
      departmentId: department,
      status: 'ACTIVE',
    },
  });
  const schedule = await createSchedule({
    connection: appDb,
    authContext: { userId: reception, actorType: 'STAFF', capabilities: ['ADMIN'] },
    idempotencyKey: id(),
    now: new Date(+now - 86400000),
    body: {
      doctorId: doctor,
      serviceId: service,
      room: 'ERD-1',
      startAt: '2026-12-01T01:00:00Z',
      endAt: '2026-12-01T02:00:00Z',
      capacityPerSlot: 2,
      slotMinutes: 30,
    },
  });
  const snapshot = {
    amountVnd: 100000,
    priceVersionId: id(),
    snapshotHash: 'a'.repeat(64),
    currency: 'VND',
  };
  const hold = await createHold({
    connection: appDb,
    patientId,
    slotId: schedule.slots[0].id,
    principalId: owner,
    idempotencyKey: id(),
    now,
    resolvePriceSnapshot: async () => snapshot,
  });
  const appointment = await createAppointment({
    connection: appDb,
    patientId,
    holdId: hold.holdId,
    principalId: owner,
    idempotencyKey: id(),
    now,
  });
  const charge = id(),
    settlement = id();
  const source = {
    sourceType: 'APPOINTMENT',
    sourceId: appointment.appointmentId,
    sourceRevision: 1,
    chargeId: charge,
    settlementId: settlement,
  };
  const event = (messageType, payload) => ({
    messageId: id(),
    messageKind: 'EVENT',
    messageType,
    schemaVersion: 1,
    producer: 'billing',
    payload: { ...source, ...payload },
  });
  await handleBillingMessage({
    connection: appDb,
    now,
    message: event('ChargePrepared', { state: 'CREATED' }),
  });
  const reserved = await handleReserveSettlementCommand({
    connection: appDb,
    now,
    message: {
      ...event('ReserveSettlement', { amountHash: snapshot.snapshotHash, attemptVersion: 1 }),
      messageKind: 'COMMAND',
    },
  });
  assert.equal(reserved.state, 'ACCEPTED');
  await handleBillingMessage({
    connection: appDb,
    now,
    message: event('SettlementDecision', {
      state: 'SUCCEEDED',
      decisionVersion: 1,
      paymentId: id(),
      fence: reserved.fence,
    }),
  });
  await handleBillingMessage({
    connection: appDb,
    now,
    message: event('ChargePaid', {
      amountVnd: 100000,
      fence: reserved.fence,
      paidAt: now.toISOString(),
      transactionId: 'ERD-AP',
    }),
  });
  const checkin = await checkInAppointment({
    connection: appDb,
    appointmentId: appointment.appointmentId,
    staffId: reception,
    idempotencyKey: id(),
    now,
  });
  const called = await callNextQueueTicket({
    connection: appDb,
    actorType: 'STAFF',
    capabilities: ['RECEPTION'],
    calledBy: reception,
    idempotencyKey: id(),
    now,
  });
  assert.equal(called.ticketId, checkin.ticketId);
  const claim = await handleClaimQueueTicketCommand({
    connection: appDb,
    now,
    message: {
      messageId: id(),
      messageKind: 'COMMAND',
      messageType: 'ClaimQueueTicket',
      payload: {
        requestId: id(),
        ticketId: called.ticketId,
        appointmentId: appointment.appointmentId,
        patientId,
        doctorId: doctor,
        expectedTicketVersion: called.version,
      },
    },
  });
  assert.equal(claim.state, 'ACCEPTED');
  const visit = id();
  await handleClinicalMessage({
    connection: appDb,
    now,
    message: {
      messageId: id(),
      messageType: 'VisitSigned',
      messageKind: 'EVENT',
      producer: 'clinical',
      payload: { appointmentId: appointment.appointmentId, visitId: visit },
    },
  });
  assert.equal(
    (await appDb.collection('appointments').findOne({ id: appointment.appointmentId })).state,
    'COMPLETED',
  );
  const type = await appDb
    .collection('appointments')
    .aggregate([
      { $match: { id: appointment.appointmentId } },
      { $project: { kind: { $type: '$priceSnapshotVnd' } } },
    ])
    .next();
  assert.equal(type.kind, 'long');
  const medicine = id();
  await pharmacyDb.collection('user_access_projection').insertOne({
    userId: pharmacist,
    status: 'ACTIVE',
    actorType: 'STAFF',
    capabilities: ['PHARMACY'],
    tokenVersion: 1,
    policyVersion: 1,
  });
  await pharmacyDb
    .collection('patient_access_projection')
    .insertOne({ patientId, ownerUserId: owner, active: true, policyVersion: 1 });
  await pharmacyDb.collection('catalog_projection').insertMany([
    {
      entityKey: 'MEDICINE:' + medicine,
      entityType: 'MEDICINE',
      entityId: medicine,
      entityVersion: 1,
      active: true,
      fullSnapshot: { id: medicine, code: 'ERD-MED', name: 'ERD Medicine', status: 'ACTIVE' },
    },
    {
      entityKey: 'PRICE_VERSION:' + medicine,
      entityType: 'PRICE_VERSION',
      entityId: id(),
      entityVersion: 1,
      active: true,
      fullSnapshot: {
        itemId: medicine,
        priceVersionId: id(),
        revision: 1,
        amountVnd: 1000,
        effectiveFrom: '2026-01-01T00:00:00Z',
      },
    },
  ]);
  await pharmacyDb.collection('projection_checkpoints').insertOne({
    projectionName: 'CatalogChanged',
    gap: false,
    streamSequence: 2,
    lastCheckpointAt: now,
  });
  await receiveStock({
    connection: pharmacyDb,
    principalId: pharmacist,
    idempotencyKey: id(),
    medicineId: medicine,
    quantity: 10,
    batchRef: 'ERD-LOT',
    now,
  });
  const prescription = id();
  await applyPrescriptionFinalized({
    connection: pharmacyDb,
    now,
    message: {
      messageId: id(),
      messageKind: 'EVENT',
      messageType: 'PrescriptionFinalized',
      schemaVersion: 1,
      producer: 'clinical',
      aggregateId: prescription,
      aggregateVersion: 1,
      payload: {
        prescriptionId: prescription,
        revision: 1,
        patientId,
        visitId: visit,
        itemsSnapshot: [
          { medicineCode: 'ERD-MED', quantity: 2, nameSnapshot: 'ERD Medicine', doseText: '1/day' },
        ],
        finalizedAt: now.toISOString(),
      },
    },
  });
  const medication = await createMedicationHold({
    connection: pharmacyDb,
    principalId: pharmacist,
    idempotencyKey: id(),
    prescriptionId: prescription,
    prescriptionRevision: 1,
    now,
  });
  const medCharge = id(),
    medSettlement = id();
  async function medEvent(type, patch = {}) {
    const row = await loadMedicationHold(pharmacyDb, { id: medication.holdId });
    return pharmacyBilling({
      connection: pharmacyDb,
      now,
      message: {
        messageId: id(),
        messageKind: type === 'ReserveSettlement' ? 'COMMAND' : 'EVENT',
        messageType: type,
        producer: 'billing',
        schemaVersion: 1,
        payload: {
          sourceType: 'MED_HOLD',
          sourceId: row.id,
          sourceRevision: row.attemptNo,
          chargeId: medCharge,
          settlementId: medSettlement,
          amountHash: row.snapshotHash,
          amountVnd: row.amountVnd,
          fence: row.fence,
          attemptVersion: 1,
          ...patch,
        },
      },
    });
  }
  await medEvent('ChargePrepared', { state: 'CREATED' });
  await medEvent('ReserveSettlement');
  await medEvent('SettlementDecision', { state: 'SUCCEEDED', decisionVersion: 1, paymentId: id() });
  await medEvent('ChargePaid', { transactionId: 'ERD-PH', paidAt: now.toISOString() });
  const committed = await loadMedicationHold(pharmacyDb, { id: medication.holdId });
  assert.equal(committed.status, 'COMMITTED');
  await dispenseMedication({
    connection: pharmacyDb,
    principalId: pharmacist,
    holdId: committed.id,
    expectedVersion: committed.version,
    idempotencyKey: id(),
    now,
  });
  assert.equal(
    (await pharmacyDb.collection('inventory').findOne({ medicineId: medicine })).onHand,
    8,
  );
  for (const [connection, ownerName] of [
    [patientDb, 'patient'],
    [appDb, 'appointment'],
    [pharmacyDb, 'pharmacy'],
  ]) {
    const report = await auditBusinessStorage(connection, ownerName);
    assert.ok(
      report.every((entry) => entry.invalid === 0),
      JSON.stringify(report),
    );
  }
  await assert.rejects(
    appDb
      .collection('appointments')
      .updateOne({ id: appointment.appointmentId }, { $set: { fence: 999 } }),
    (error) => error.code === 121,
  );
  await assert.rejects(
    pharmacyDb
      .collection('medication_holds')
      .updateOne({ id: medication.holdId }, { $set: { paidEvidence: { fake: true } } }),
    (error) => error.code === 121,
  );
});

test('QuerySettlement batches do not starve later holds after removing queryAfter from business storage', async () => {
  const {
    queryUnresolvedSettlements,
  } = require('../../services/pharmacy/src/services/settlement.service');
  const connection = h.connection.useDb('erd_probe_fairness', { useCache: true });
  await ensurePharmacyStorage(connection);
  await installBusinessValidators(connection, 'pharmacy');
  const rows = Array.from({ length: 101 }, () => ({
    id: id(),
    prescriptionId: id(),
    revision: 1,
    attemptNo: 1,
    status: 'SETTLEMENT_LOCKED',
    itemsSnapshot: [],
    expiresAt: new Date(+now + 900000),
    chargeId: id(),
    version: 1,
    attemptHistory: [],
    patientId: id(),
    settlementId: id(),
    settlementState: 'UNKNOWN',
    settlementVersion: 1,
  }));
  await connection.collection('medication_holds').insertMany(rows);
  assert.equal(await queryUnresolvedSettlements({ connection, now }), 100);
  assert.equal(await queryUnresolvedSettlements({ connection, now }), 1);
  assert.equal(await queryUnresolvedSettlements({ connection, now }), 0);
  assert.equal(
    await connection.collection('outbox').countDocuments({ message_type: 'QuerySettlement' }),
    101,
  );
  assert.equal(
    await connection
      .collection('medication_holds')
      .countDocuments({ queryAfter: { $exists: true } }),
    0,
  );
  assert.equal(await queryUnresolvedSettlements({ connection, now: new Date(+now + 31000) }), 100);
});

test('RETURN tickets use their actual queue creation day and RETURN no-show preserves the appointment state', async () => {
  const {
    getAppointmentModel,
  } = require('../../services/appointment/src/models/appointment.model');
  const {
    listTodayQueue,
    markNoShow,
  } = require('../../services/appointment/src/services/queue.service');
  const connection = h.connection.useDb('erd_return_queue', { useCache: true });
  await ensureAppointmentStorage(connection);
  await installBusinessValidators(connection, 'appointment');
  const doctor = id(),
    service = id(),
    department = id(),
    user = id(),
    patient = id(),
    schedule = id(),
    slot = id(),
    hold = id(),
    appointment = id(),
    version = id();
  await connection.collection('catalog_projection').insertOne({
    entityKey: 'DOCTOR:' + doctor,
    entityType: 'DOCTOR',
    entityId: doctor,
    active: true,
    entityVersion: 1,
    fullSnapshot: {
      id: doctor,
      identityUserId: user,
      departmentId: department,
      status: 'ACTIVE',
    },
  });
  await connection.collection('schedules').insertOne({
    id: schedule,
    doctorId: doctor,
    serviceId: service,
    room: 'RETURN',
    startAt: now,
    endAt: new Date(+now + 3600000),
    capacityPerSlot: 2,
    status: 'OPEN',
    version: 1,
    slotMinutes: 30,
  });
  await connection.collection('slots').insertOne({
    id: slot,
    scheduleId: schedule,
    startAt: now,
    endAt: new Date(+now + 1800000),
    capacity: 2,
    heldCount: 0,
    confirmedCount: 1,
    version: 1,
  });
  await connection.collection('holds').insertOne({
    id: hold,
    slotId: slot,
    patientId: patient,
    status: 'CONSUMED',
    expiresAt: new Date(+now + 600000),
    principalId: id(),
    idempotencyKey: id(),
    createdAt: now,
    consumedAt: now,
    priceSnapshot: { amountVnd: 100, priceVersionId: version, snapshotHash: 'fixture' },
  });
  await getAppointmentModel(connection).create({
    id: appointment,
    holdId: hold,
    patientId: patient,
    slotId: slot,
    serviceId: service,
    doctorId: doctor,
    priceSnapshotVnd: 100n,
    state: 'IN_SERVICE',
    version: 1,
    slotHistory: [],
    chargeId: id(),
    expiresAt: new Date(+now + 600000),
    priceVersion: version,
    settlementId: id(),
    settlementState: 'SUCCEEDED',
    settlementVersion: 1,
  });
  const nextDay = new Date(+now + 86400000);
  await handleClinicalMessage({
    connection,
    now: nextDay,
    message: {
      messageId: id(),
      messageType: 'VisitReturnReady',
      messageKind: 'EVENT',
      producer: 'clinical',
      payload: { appointmentId: appointment, visitId: id(), returnRound: 1 },
    },
  });
  const query = {
    connection,
    actorType: 'STAFF',
    capabilities: ['RECEPTION'],
    doctorId: doctor,
    ticketType: 'RETURN',
    now: nextDay,
  };
  const current = await listTodayQueue({ ...query, date: '2026-12-02' });
  assert.equal(current.total, 1);
  assert.equal((await listTodayQueue({ ...query, date: '2026-12-01' })).total, 0);
  await markNoShow({
    connection,
    ticketId: current.items[0].ticketId,
    staffId: id(),
    reasonCode: 'PATIENT_ABSENT',
    expectedVersion: current.items[0].version,
    idempotencyKey: id(),
    now: nextDay,
  });
  assert.equal(
    (await connection.collection('appointments').findOne({ id: appointment })).state,
    'IN_SERVICE',
  );
});

test('broadcast Billing events for another source owner are durably ignored instead of retry or DLQ', async () => {
  const ap = h.connection.useDb('erd_broadcast_ap', { useCache: true }),
    ph = h.connection.useDb('erd_broadcast_ph', { useCache: true });
  await ensureAppointmentStorage(ap);
  await ensurePharmacyStorage(ph);
  for (const [connection, handler, foreign] of [
    [ap, handleBillingMessage, 'MED_HOLD'],
    [ph, pharmacyBilling, 'APPOINTMENT'],
  ]) {
    for (const type of [
      'ChargePrepared',
      'ChargePaid',
      'SettlementDecision',
      'BillingStatusChanged',
    ]) {
      const message = {
        messageId: id(),
        messageKind: 'EVENT',
        messageType: type,
        schemaVersion: 1,
        producer: 'billing',
        payload: {
          sourceId: id(),
          sourceRevision: 1,
          chargeId: id(),
          ...(type === 'SettlementDecision' ? {} : { sourceType: foreign }),
        },
      };
      const result = await handler({ connection, message });
      assert.equal(result.ignored, true);
      assert.equal((await handler({ connection, message })).duplicate, true);
      await assert.rejects(
        handler({
          connection,
          message: { ...message, payload: { ...message.payload, sourceRevision: 2 } },
        }),
        (error) => error.code === 'MESSAGE_CONFLICT',
      );
    }
    assert.equal(await connection.collection('inbox').countDocuments(), 4);
    assert.equal(await connection.collection('outbox').countDocuments(), 0);
  }
});
