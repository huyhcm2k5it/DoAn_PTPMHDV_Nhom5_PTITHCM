const sift = require('sift').default;
const models = require('../models/appointment.model');

const appointmentFields =
  'id holdId patientId slotId serviceId doctorId priceSnapshotVnd state version slotHistory chargeId expiresAt priceVersion settlementId settlementState settlementVersion'.split(
    ' ',
  );
const ticketFields =
  'id appointmentId ticketType visitId returnRound state calledAt claimId claimedBy noShowReason version'.split(
    ' ',
  );
const pick = (value, fields) =>
  Object.fromEntries(
    fields
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, value[key]]),
  );

async function hydrateAppointment(connection, row, session, cache) {
  if (!row) return null;
  const context =
    cache || (await appointmentReadContext(connection, [row], session));
  const slot = context.slots.get(row.slotId),
    hold = context.holds.get(row.holdId),
    doctor = context.doctors.get(row.doctorId),
    access = context.access.get(row.patientId);
  const messages = context.messages.get(row.id) || [];
  const source = messages.find((item) => item.message_type === 'RequestCharge');
  const cancellations = messages.filter(
    (item) =>
      item.message_type === 'AppointmentChanged' && item.payload.cancellationId,
  );
  const cancellation = cancellations[cancellations.length - 1];
  const deliveries = context.deliveries.get(row.id) || [];
  const prepared = deliveries.find(
    (item) => item.message_type === 'ChargePrepared',
  );
  const paid = deliveries.find(
    (item) =>
      item.message_type === 'ChargePaid' &&
      item.payload.chargeId === row.chargeId,
  );
  const statuses = deliveries
    .filter((item) => item.message_type === 'BillingStatusChanged')
    .sort((a, b) => b.payload.version - a.payload.version);
  const results = [...(context.reserves.get(row.id) || [])];
  results.sort((a, b) => a.request.attemptVersion - b.request.attemptVersion);
  const reserve = results.find(
    (item) => item.request.settlementId === row.settlementId,
  );
  const lastReserve = results[results.length - 1];
  const legacyReserve = deliveries.find(
    (item) =>
      item.message_type === 'SettlementReserved' &&
      item.payload.state === 'ACCEPTED' &&
      item.payload.settlementId === row.settlementId,
  );
  const ticket = context.visits.get(row.id);
  const history = messages.flatMap((item) => {
    let state;
    if (item.message_type === 'RequestCharge') state = 'PENDING_PAYMENT';
    if (item.message_type === 'AppointmentChanged')
      state = item.payload.state || item.payload.changeType;
    if (item.message_type === 'QueueTicketChanged')
      state = {
        WAITING: 'CHECKED_IN',
        CALLED: 'CHECKED_IN',
        CLAIMED: 'IN_SERVICE',
        DONE: 'COMPLETED',
        NO_SHOW: 'NO_SHOW',
      }[item.payload.state];
    return state ? [{ state, at: item.occurred_at }] : [];
  });
  const createdAt =
    row.createdAt ?? source?.occurred_at ?? hold?.consumedAt ?? hold?.createdAt;
  return {
    ...row,
    requestId: row.requestId ?? source?.payload.requestId,
    sourceRevision: Math.max(
      row.sourceRevision || 0,
      source?.payload.sourceRevision || 0,
      cancellation?.payload.sourceRevision || 0,
    ),
    principalId: row.principalId ?? hold?.principalId,
    recipientUserId:
      row.recipientUserId ??
      source?.payload.recipientUserId ??
      access?.ownerUserId,
    scheduleId: slot?.scheduleId ?? row.scheduleId,
    startAt: slot?.startAt ?? row.startAt,
    endAt: slot?.endAt ?? row.endAt,
    doctorUserId:
      doctor?.fullSnapshot?.status === 'ACTIVE'
        ? doctor.fullSnapshot.identityUserId
        : row.doctorUserId,
    departmentId:
      doctor?.fullSnapshot?.status === 'ACTIVE'
        ? doctor.fullSnapshot.departmentId
        : row.departmentId,
    chargeSync:
      prepared?.payload.state ??
      row.chargeSync ??
      (row.chargeId ? 'CREATED' : 'PENDING'),
    chargeStatus: paid
      ? 'PAID'
      : (row.chargeStatus ??
        (prepared
          ? prepared.payload.state === 'REJECTED'
            ? 'REJECTED'
            : ['EXPIRED', 'CANCELLED'].includes(row.state)
              ? 'VOID'
              : 'OPEN'
          : 'PENDING')),
    refundStatus:
      statuses[0]?.payload.refundStatus ??
      cancellation?.payload.refundStatus ??
      row.refundStatus ??
      'NONE',
    refundVersion: statuses[0]?.payload.version ?? row.refundVersion ?? 0,
    cancellationId: cancellation?.payload.cancellationId ?? row.cancellationId,
    fence: reserve?.response.fence ?? legacyReserve?.payload.fence ?? row.fence,
    fenceCounter: Math.max(
      row.fenceCounter || 0,
      ...results.map((item) => item.response.fence || 0),
    ),
    reserveAttemptVersion:
      lastReserve?.request.attemptVersion ?? row.reserveAttemptVersion,
    visitId: ticket?.visitId ?? row.visitId,
    createdAt,
    updatedAt:
      messages[messages.length - 1]?.occurred_at ?? row.updatedAt ?? createdAt,
    stateHistory: row.stateHistory?.length
      ? row.stateHistory
      : [
          ...history,
          {
            state: row.state,
            at: messages[messages.length - 1]?.occurred_at ?? createdAt,
          },
        ],
  };
}

async function hydrateTicket(connection, row, session, cache) {
  const context =
    cache || (await ticketReadContext(connection, [row], session));
  const appointment = context.appointments.get(row.appointmentId);
  const source = appointment
    ? await hydrateAppointment(connection, appointment, session, context)
    : null;
  const events = context.ticketEvents.get(row.id) || [];
  const queueTime = events[0]?.occurred_at ?? row.createdAt ?? source?.startAt;
  const date = queueTime
    ? new Date(+new Date(queueTime) + 7 * 3600000).toISOString().slice(0, 10)
    : row.appointmentDate;
  return {
    ...row,
    patientId: source?.patientId ?? row.patientId,
    doctorId: source?.doctorId ?? row.doctorId,
    doctorUserId: source?.doctorUserId ?? row.doctorUserId,
    departmentId: source?.departmentId ?? row.departmentId,
    appointmentDate: date,
    createdAt: events[0]?.occurred_at ?? row.createdAt,
    updatedAt: events[events.length - 1]?.occurred_at ?? row.updatedAt,
    stateHistory:
      row.stateHistory ??
      events.map((event) => ({
        state: event.payload.state,
        at: event.occurred_at,
        by: row.claimedBy,
      })),
  };
}

// Query only persisted predicates first, then evaluate predicates on joined values.
// Primary-key, patient and state filters still use Mongo indexes before hydration.
function persistedFilter(filter, fields) {
  const result = {};
  for (const [key, value] of Object.entries(filter)) {
    if (['$or', '$and'].includes(key)) {
      const parts = value.map((part) => persistedFilter(part, fields));
      if (key === '$and') result[key] = parts;
      else if (parts.every((part) => Object.keys(part).length))
        result[key] = parts;
    } else if (fields.includes(key.split('.')[0]) || key === '_id')
      result[key] = value;
  }
  return result;
}

function groupRows(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const value = key(row);
    if (value == null) continue;
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
  }
  return groups;
}
async function appointmentReadContext(connection, rows, session) {
  const ids = rows.map((row) => row.id);
  const collect = async (name, filter, sort) => {
    let query = connection.collection(name).find(filter, { session });
    if (sort) query = query.sort(sort);
    return query.toArray();
  };
  const slots = await collect('slots', {
    id: { $in: rows.map((row) => row.slotId) },
  });
  const holds = await collect('holds', {
    id: { $in: rows.map((row) => row.holdId) },
  });
  const doctors = await collect('catalog_projection', {
    entityType: 'DOCTOR',
    entityId: { $in: rows.map((row) => row.doctorId) },
    active: true,
  });
  const access = await collect('patient_access_projection', {
    patientId: { $in: rows.map((row) => row.patientId) },
    active: true,
  });
  const events = await collect(
    'outbox',
    {
      $or: [
        { aggregate_id: { $in: ids } },
        {
          message_type: 'QueueTicketChanged',
          'payload.appointmentId': { $in: ids },
        },
      ],
    },
    { occurred_at: 1, aggregate_version: 1 },
  );
  const receipts = await collect('inbox', {
    consumer_name: 'appointment-billing',
    $or: [
      { 'payload.sourceId': { $in: ids } },
      {
        'payload.chargeId': {
          $in: rows.map((row) => row.chargeId).filter(Boolean),
        },
      },
    ],
  });
  const results = await collect('command_results', {
    command_type: 'ReserveSettlement',
    'request.sourceId': { $in: ids },
    'response.state': 'ACCEPTED',
  });
  const tickets = await collect('queue_tickets', {
    appointmentId: { $in: ids },
    visitId: { $type: 'string' },
  });
  const idSet = new Set(ids),
    chargeOwners = new Map(
      rows.filter((row) => row.chargeId).map((row) => [row.chargeId, row.id]),
    );
  return {
    appointments: new Map(rows.map((row) => [row.id, row])),
    slots: new Map(slots.map((row) => [row.id, row])),
    holds: new Map(holds.map((row) => [row.id, row])),
    doctors: new Map(doctors.map((row) => [row.entityId, row])),
    access: new Map(access.map((row) => [row.patientId, row])),
    messages: groupRows(events, (row) =>
      idSet.has(row.aggregate_id)
        ? row.aggregate_id
        : row.payload?.appointmentId,
    ),
    deliveries: groupRows(
      receipts,
      (row) => row.payload.sourceId || chargeOwners.get(row.payload.chargeId),
    ),
    reserves: groupRows(results, (row) => row.request.sourceId),
    visits: new Map(tickets.map((row) => [row.appointmentId, row])),
  };
}
async function ticketReadContext(connection, rows, session) {
  const appointments = await connection
    .collection('appointments')
    .find({ id: { $in: rows.map((row) => row.appointmentId) } }, { session })
    .toArray();
  const context = await appointmentReadContext(
    connection,
    appointments,
    session,
  );
  const events = await connection
    .collection('outbox')
    .find(
      {
        aggregate_id: { $in: rows.map((row) => row.id) },
        message_type: 'QueueTicketChanged',
      },
      { session },
    )
    .sort({ aggregate_version: 1 })
    .toArray();
  context.ticketEvents = groupRows(events, (row) => row.aggregate_id);
  return context;
}
async function narrowReadFilter(repo, filter, session) {
  let result = persistedFilter(filter, repo.fields);
  if (repo.name === 'appointments' && (filter.startAt || filter.endAt)) {
    const window = {
      ...(filter.startAt ? { startAt: filter.startAt } : {}),
      ...(filter.endAt ? { endAt: filter.endAt } : {}),
    };
    const slots = await repo.connection
      .collection('slots')
      .find(window, { session, projection: { id: 1 } })
      .toArray();
    result = {
      $and: [
        result,
        { $or: [{ slotId: { $in: slots.map((row) => row.id) } }, window] },
      ],
    };
  }
  if (
    repo.name === 'queue_tickets' &&
    (filter.appointmentDate || filter.doctorId)
  ) {
    let appointments = {
      ...(filter.doctorId ? { doctorId: filter.doctorId } : {}),
    };
    if (filter.appointmentDate) {
      const start = new Date(filter.appointmentDate + 'T00:00:00+07:00'),
        end = new Date(+start + 86400000);
      const window = { startAt: { $gte: start, $lt: end } };
      const slots = await repo.connection
        .collection('slots')
        .find(window, { session, projection: { id: 1 } })
        .toArray();
      appointments.$or = [
        { slotId: { $in: slots.map((row) => row.id) } },
        window,
      ];
    }
    const matches = await repo.connection
      .collection('appointments')
      .find(appointments, { session, projection: { id: 1 } })
      .toArray();
    const legacy = {
      ...(filter.appointmentDate
        ? { appointmentDate: filter.appointmentDate }
        : {}),
      ...(filter.doctorId ? { doctorId: filter.doctorId } : {}),
    };
    const alternatives = [
      { appointmentId: { $in: matches.map((row) => row.id) } },
      legacy,
    ];
    if (filter.appointmentDate) {
      const start = new Date(filter.appointmentDate + 'T00:00:00+07:00'),
        end = new Date(+start + 86400000);
      const returns = await repo.connection
        .collection('outbox')
        .find(
          {
            message_type: 'QueueTicketChanged',
            'payload.ticketType': 'RETURN',
            'payload.state': 'WAITING',
            occurred_at: { $gte: start, $lt: end },
          },
          { session, projection: { aggregate_id: 1 } },
        )
        .toArray();
      alternatives.push({
        id: { $in: returns.map((row) => row.aggregate_id) },
      });
    }
    result = { $and: [result, { $or: alternatives }] };
  }
  return result;
}

class ReadQuery {
  constructor(repository, filter, one) {
    this.repository = repository;
    this.filter = filter;
    this.one = one;
  }
  session(value) {
    this.sessionValue = value;
    return this;
  }
  sort(value) {
    this.sortValue = value;
    return this;
  }
  skip(value) {
    this.skipValue = value;
    return this;
  }
  limit(value) {
    this.limitValue = value;
    return this;
  }
  select(value) {
    this.selectValue = value;
    return this;
  }
  async lean() {
    const repo = this.repository;
    const narrowed = await narrowReadFilter(
      repo,
      this.filter,
      this.sessionValue,
    );
    const raw = await repo.collection
      .find(narrowed, {
        session: this.sessionValue,
      })
      .toArray();
    const context =
      repo.name === 'appointments'
        ? await appointmentReadContext(repo.connection, raw, this.sessionValue)
        : await ticketReadContext(repo.connection, raw, this.sessionValue);
    const rows = [];
    const matches = sift(this.filter);
    for (const row of raw) {
      const value = await repo.hydrate(
        repo.connection,
        row,
        this.sessionValue,
        context,
      );
      if (matches(value)) rows.push(value);
    }
    if (this.sortValue)
      rows.sort((a, b) => {
        for (const [key, order] of Object.entries(this.sortValue)) {
          if (a[key] < b[key]) return -order;
          if (a[key] > b[key]) return order;
        }
        return 0;
      });
    let selected = rows.slice(
      this.skipValue || 0,
      this.limitValue ? (this.skipValue || 0) + this.limitValue : undefined,
    );
    if (this.selectValue === '-_id')
      selected = selected.map(({ _id, ...row }) => row);
    return this.one ? selected[0] || null : selected;
  }
  then(resolve, reject) {
    return this.lean().then(resolve, reject);
  }
}

function repository(connection, name, fields, getModel, hydrate) {
  const coll = connection.collection(name);
  const repo = {
    connection,
    name,
    collection: coll,
    fields,
    hydrate,
    find(filter = {}) {
      return new ReadQuery(repo, filter, false);
    },
    findOne(filter = {}) {
      return new ReadQuery(repo, filter, true);
    },
    exists(filter = {}) {
      return repo.findOne(filter);
    },
    async countDocuments(filter = {}) {
      return (await repo.find(filter).lean()).length;
    },
    async create(rows, options) {
      return getModel(connection).create(
        rows.map((row) => pick(row, fields)),
        options,
      );
    },
    async updateOne(filter, update, options = {}) {
      const row = await repo.findOne(filter).session(options.session).lean();
      if (!row) return { matchedCount: 0, modifiedCount: 0 };
      const operators = Object.fromEntries(
        Object.entries(update)
          .map(([op, values]) => [op, pick(values, fields)])
          .filter(([, values]) => Object.keys(values).length),
      );
      if (!Object.keys(operators).length)
        return { matchedCount: 1, modifiedCount: 0 };
      return coll.updateOne(
        {
          id: row.id,
          ...(row.version !== undefined ? { version: row.version } : {}),
        },
        operators,
        options,
      );
    },
    async updateMany(filter, update, options = {}) {
      let modifiedCount = 0;
      for (const row of await repo.find(filter).session(options.session).lean())
        modifiedCount += (
          await repo.updateOne(
            { id: row.id, version: row.version },
            update,
            options,
          )
        ).modifiedCount;
      return { modifiedCount };
    },
    findOneAndUpdate(filter, update, options = {}) {
      return {
        async lean() {
          const row = await repo
            .findOne(filter)
            .sort(options.sort)
            .session(options.session)
            .lean();
          if (!row) return null;
          const changed = await repo.updateOne(
            { id: row.id, version: row.version },
            update,
            options,
          );
          return changed.modifiedCount
            ? repo.findOne({ id: row.id }).session(options.session).lean()
            : null;
        },
      };
    },
  };
  return repo;
}

const getAppointmentRepository = (connection) =>
  repository(
    connection,
    'appointments',
    appointmentFields,
    models.getAppointmentModel,
    hydrateAppointment,
  );
const getQueueTicketRepository = (connection) =>
  repository(
    connection,
    'queue_tickets',
    ticketFields,
    models.getQueueTicketModel,
    hydrateTicket,
  );
module.exports = {
  getAppointmentRepository,
  getQueueTicketRepository,
  hydrateAppointment,
  hydrateTicket,
  appointmentFields,
  ticketFields,
};
