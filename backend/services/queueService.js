// All queue changes go through here, so the rules live in one place.
const crypto = require('crypto');
const mongoose = require('mongoose');
const Ticket = require('../models/Ticket');
const Counter = require('../models/Counter');
const Service = require('../models/Service');
const QueueEvent = require('../models/QueueEvent');
const httpError = require('../utils/httpError');
const { normalizePhone, isValidPhone } = require('../utils/phone');
const { sendSms } = require('../utils/sms');
const {
  dateKey, formatCode, averageServiceMinutes, estimateWaitMinutes, describeWait, arrivalTime,
} = require('../utils/queue');

const ACTIVE_ROOM_WINDOW_MS = 30 * 60 * 1000;   // a room that called someone in the last 30 min is "working"
const QUEUE_ORDER = { priority: -1, arrivedAt: 1, createdAt: 1 };
const NEARLY_UP_COUNT = 3;                       // how many at the front get a "nearly up" text
const RETURNED_REASON = 'Returned after missing the call';

const log = (ticket, action, staff, room = '') =>
  QueueEvent.create({ ticket: ticket._id, service: ticket.service, action, staff: staff?._id, room })
    .catch((err) => console.error('Queue event log failed:', err.message));

const findService = async (serviceId) => {
  const service = await Service.findById(serviceId);
  if (!service) throw httpError(404, 'Service not found');
  return service;
};

// ── Join the queue ──────────────────────────────────────────
// source "self" = patient scanned the QR code; "reception" = added at the desk
const issueTicket = async (serviceId, { name = '', phone = '', priority = false, priorityReason = '' } = {}, { source = 'self', staff } = {}) => {
  const service = await findService(serviceId);
  if (!service.isOpen) throw httpError(409, `${service.name} is not taking patients right now`);

  const cleanPhone = phone ? normalizePhone(phone) : '';
  if (cleanPhone && !isValidPhone(cleanPhone)) throw httpError(400, 'Enter a valid Zambian phone number, or leave it empty');
  if (priority && source !== 'reception') throw httpError(403, 'Only reception can give priority');
  if (priority && !String(priorityReason).trim()) throw httpError(400, 'Give a reason for priority (for example: pregnant, elderly, emergency)');

  const today = dateKey();

  // One active ticket per phone per service: a second tap returns the same ticket
  if (cleanPhone) {
    const existing = await Ticket.findOne({ service: service._id, dateKey: today, phone: cleanPhone, status: { $in: ['waiting', 'called'] } });
    if (existing) return { ticket: existing, existing: true };
  }

  const ticket = await createTicket(service, {
    name: String(name).trim().slice(0, 60),
    phone: cleanPhone,
    source,
    priority: Boolean(priority),
    priorityReason: priority ? String(priorityReason).trim().slice(0, 120) : '',
  });
  log(ticket, 'joined', staff);
  return { ticket, existing: false };
};

// The next number in this service's queue today, and the ticket that goes with it
const createTicket = async (service, fields) => {
  const today = dateKey();
  const counter = await Counter.findOneAndUpdate(
    { _id: `${service._id}:${today}` },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return Ticket.create({
    arrivedAt: new Date(),
    ...fields,
    service: service._id,
    dateKey: today,
    number: counter.seq,
    code: formatCode(service.prefix, counter.seq),
    publicId: crypto.randomBytes(9).toString('base64url'),
  });
};

// ── Call the next patient to a room ─────────────────────────
// The patient currently in this room is finished first. The next ticket is
// claimed with one atomic findOneAndUpdate, so two rooms pressing "Next" at
// the same moment can never call the same patient.
const callNext = async (serviceId, room, staff) => {
  const service = await findService(serviceId);
  if (!room || !service.rooms.includes(room)) throw httpError(400, 'Choose one of this service\'s rooms');
  const today = dateKey();
  const now = new Date();

  const inRoom = { service: service._id, dateKey: today, status: 'called', room };
  const finishing = await Ticket.find(inRoom).select('_id service');
  await Ticket.updateMany(inRoom, { $set: { status: 'done', doneAt: now } });
  finishing.forEach((t) => log(t, 'done', staff, room));

  const next = await Ticket.findOneAndUpdate(
    { service: service._id, dateKey: today, status: 'waiting' },
    { $set: { status: 'called', room, calledAt: now }, $inc: { calls: 1 } },
    { sort: QUEUE_ORDER, new: true }
  );
  if (next) log(next, 'called', staff, room);
  return next;   // null when nobody is waiting
};

// ── Actions on one ticket ───────────────────────────────────
const TRANSITIONS = {
  recall:   { from: ['called'],             to: 'called',    event: 'recalled' },
  done:     { from: ['called'],             to: 'done',      event: 'done' },
  no_show:  { from: ['called'],             to: 'no_show',   event: 'no_show' },
  cancel:   { from: ['waiting', 'called'],  to: 'cancelled', event: 'cancelled' },
  // A patient who missed their call comes back. They already waited, so they go
  // to the front (as priority) rather than the back. Reception presses "Return".
  return:   { from: ['no_show'],            to: 'waiting',   event: 'returned' },
};

const applyAction = async (ticketId, action, staff) => {
  const rule = TRANSITIONS[action];
  if (!rule) throw httpError(400, `Unknown action "${action}"`);
  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw httpError(404, 'Ticket not found');
  if (!rule.from.includes(ticket.status)) {
    throw httpError(409, `Ticket ${ticket.code} is ${ticket.status.replace('_', '-')}, so it cannot be changed with "${action}"`);
  }
  const now = new Date();
  ticket.status = rule.to;
  if (action === 'recall') ticket.calls += 1;
  if (action === 'done') ticket.doneAt = now;
  if (action === 'return') {
    ticket.priority = true;
    ticket.priorityReason = ticket.priorityReason || RETURNED_REASON;
    ticket.room = '';
  }
  await ticket.save();
  log(ticket, rule.event, staff, ticket.room);
  return ticket;
};

// ── Send a patient on to another service ────────────────────
// OPD → Lab → Pharmacy. The patient is finished here and gets a new ticket in the
// next service's queue, linked to this one both ways. They keep their place: queues
// are ordered by arrival at the clinic, and the new ticket carries the old arrivedAt.
const transferTicket = async (ticketId, toServiceId, staff) => {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw httpError(404, 'Ticket not found');
  if (ticket.transferredTo) throw httpError(409, `${ticket.code} has already been sent on`);
  if (!['called', 'done'].includes(ticket.status)) {
    throw httpError(409, `Only a patient who has been called can be sent on (${ticket.code} is ${ticket.status.replace('_', '-')})`);
  }
  if (ticket.dateKey !== dateKey()) throw httpError(409, `${ticket.code} is from an earlier day`);
  if (!toServiceId) throw httpError(400, 'Choose the service to send the patient to');
  const to = await findService(toServiceId);
  if (String(to._id) === String(ticket.service)) throw httpError(400, `${ticket.code} is already in ${to.name}`);
  if (!to.isOpen) throw httpError(409, `${to.name} is not taking patients right now`);
  if (ticket.phone) {
    const existing = await Ticket.findOne({ service: to._id, dateKey: ticket.dateKey, phone: ticket.phone, status: { $in: ['waiting', 'called'] } });
    if (existing) throw httpError(409, `This patient is already in the ${to.name} queue as ${existing.code}`);
  }

  // How to put the old ticket back if the new one cannot be made
  const undo = ticket.status === 'called'
    ? { $set: { status: 'called' }, $unset: { transferredTo: 1, doneAt: 1 } }
    : { $unset: { transferredTo: 1 } };

  // Claim the old ticket in one atomic step, so a double tap (or two staff at once)
  // cannot make two new tickets: only one update can find transferredTo still empty.
  const newId = new mongoose.Types.ObjectId();
  const from = await Ticket.findOneAndUpdate(
    { _id: ticket._id, status: { $in: ['called', 'done'] }, transferredTo: null },
    { $set: { status: 'done', doneAt: ticket.doneAt || new Date(), transferredTo: newId } },
    { new: true }
  );
  if (!from) throw httpError(409, `${ticket.code} has already been sent on`);

  let next;
  try {
    next = await createTicket(to, {
      _id: newId,
      name: ticket.name,
      phone: ticket.phone,
      source: 'reception',
      // Priority belongs to the patient (pregnant, elderly…), except the one-off
      // priority given for returning after a missed call
      priority: ticket.priority && ticket.priorityReason !== RETURNED_REASON,
      priorityReason: ticket.priorityReason !== RETURNED_REASON ? ticket.priorityReason : '',
      arrivedAt: arrivalTime(ticket),
      fromTicket: ticket._id,
    });
  } catch (err) {
    // Put the old ticket back as it was, so the transfer can be tried again
    await Ticket.updateOne({ _id: ticket._id }, undo);
    throw err;
  }
  log(from, 'transferred', staff, from.room);
  log(next, 'joined', staff);
  return { from, to: next, service: to };
};

// A patient may cancel their own ticket from their phone
const cancelByPatient = async (publicId) => {
  const ticket = await Ticket.findOne({ publicId });
  if (!ticket) throw httpError(404, 'Ticket not found');
  if (!['waiting', 'called'].includes(ticket.status)) throw httpError(409, 'This ticket is no longer in the queue');
  ticket.status = 'cancelled';
  await ticket.save();
  log(ticket, 'cancelled');
  return ticket;
};

// ── SMS notifications ───────────────────────────────────────
const ordinal = (n) => (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');

// Text the first few patients in line who have a phone and haven't been told
// yet. Called (fire-and-forget) whenever the queue moves. Errors are caught
// per-ticket so one bad number can never break the queue for everyone else.
const notifyNearlyUp = async (serviceId) => {
  const service = await findService(serviceId);
  // First 3 in line — NOT "first 3 not yet notified", which would skip ahead
  // to positions 4–6 once positions 1–3 were texted.
  const firstFew = await Ticket.find({
    service: service._id,
    dateKey: dateKey(),
    status: 'waiting',
  })
    .sort(QUEUE_ORDER)
    .limit(NEARLY_UP_COUNT);

  for (let i = 0; i < firstFew.length; i += 1) {
    const ticket = firstFew[i];
    if (!ticket.phone || ticket.notifiedAt) continue;   // no phone, or already told
    const position = i + 1;
    try {
      await sendSms(
        ticket.phone,
        `Clinic Queue: ${ticket.code}, you are ${position}${ordinal(position)} in line for ${service.name}. Please return to the waiting area.`
      );
      // Guarded update: if two runs overlap, only the first write lands.
      await Ticket.updateOne(
        { _id: ticket._id, notifiedAt: null },
        { $set: { notifiedAt: new Date() } }
      );
    } catch (err) {
      console.error(`notifyNearlyUp: SMS failed for ${ticket.code}:`, err.message);
    }
  }
};

// ── Reading the queue ───────────────────────────────────────
const recentServed = (serviceId, today) =>
  Ticket.find({ service: serviceId, dateKey: today, status: 'done', doneAt: { $exists: true } })
    .sort({ doneAt: -1 }).limit(10).select('calledAt doneAt');

const activeRoomCount = async (serviceId, today) => {
  const since = new Date(Date.now() - ACTIVE_ROOM_WINDOW_MS);
  const rooms = await Ticket.distinct('room', { service: serviceId, dateKey: today, calledAt: { $gte: since }, room: { $ne: '' } });
  return Math.max(1, rooms.length);
};

// A populated fromTicket / transferredTo, as { code, service, publicId? }
const linked = (t, { withLink = false } = {}) => (t?.code
  ? { code: t.code, service: t.service?.name, ...(withLink && { publicId: t.publicId }) }
  : null);

// Everything the display screen and staff page need for one service.
// Staff get names and phones; the public view gets ticket codes only.
const snapshot = async (serviceOrId, { forStaff = false } = {}) => {
  const service = serviceOrId._id ? serviceOrId : await findService(serviceOrId);
  const today = dateKey();
  const [waiting, called, served, rooms, missed] = await Promise.all([
    Ticket.find({ service: service._id, dateKey: today, status: 'waiting' }).sort(QUEUE_ORDER)
      .populate(forStaff ? { path: 'fromTicket', select: 'code service', populate: { path: 'service', select: 'name' } } : []),
    Ticket.find({ service: service._id, dateKey: today, status: 'called' }).sort({ calledAt: -1 }),
    recentServed(service._id, today),
    activeRoomCount(service._id, today),
    forStaff ? Ticket.find({ service: service._id, dateKey: today, status: 'no_show' }).sort({ updatedAt: -1 }).limit(10) : [],
  ]);
  const avgMinutes = averageServiceMinutes(served, service.defaultMinutes);
  const pub = (t) => ({ code: t.code, room: t.room, priority: t.priority, calls: t.calls });
  const staffView = (t) => ({
    ...pub(t), _id: t._id, name: t.name, phone: t.phone, priorityReason: t.priorityReason,
    source: t.source, createdAt: t.createdAt, arrivedAt: arrivalTime(t), calledAt: t.calledAt,
    from: linked(t.fromTicket),
  });
  const view = forStaff ? staffView : pub;
  return {
    service: { _id: service._id, name: service.name, prefix: service.prefix, rooms: service.rooms, isOpen: service.isOpen },
    nowServing: called.map(view),
    waiting: forStaff ? waiting.map(view) : waiting.slice(0, 3).map(view),
    waitingCount: waiting.length,
    ...(forStaff && { missed: missed.map(view) }),
    avgMinutes: Math.round(avgMinutes * 10) / 10,
    activeRooms: rooms,
    // How long someone joining now would wait
    newPatientWait: estimateWaitMinutes({ ahead: waiting.length, avgMinutes, activeRooms: rooms }),
    updatedAt: new Date(),
  };
};

// One patient's view of their own ticket
const ticketStatus = async (publicId) => {
  const withService = (path, select) => ({ path, select: `${select} service`, populate: { path: 'service', select: 'name' } });
  const ticket = await Ticket.findOne({ publicId })
    .populate('service', 'name prefix rooms defaultMinutes')
    .populate(withService('fromTicket', 'code'))
    .populate(withService('transferredTo', 'code publicId'));
  if (!ticket) throw httpError(404, 'Ticket not found');
  const service = ticket.service;
  const result = {
    code: ticket.code, status: ticket.status, room: ticket.room, priority: ticket.priority,
    name: ticket.name, service: { _id: service._id, name: service.name }, createdAt: ticket.createdAt, calledAt: ticket.calledAt,
    from: linked(ticket.fromTicket),
    // Sent on to another service: the patient's page follows this to the new ticket
    next: linked(ticket.transferredTo, { withLink: true }),
  };
  if (ticket.status !== 'waiting') return result;

  const today = ticket.dateKey;
  // Everyone before this ticket in compareQueueOrder: priority first, then earlier arrival
  const arrived = arrivalTime(ticket);
  const arrivedEarlier = { $or: [{ arrivedAt: { $lt: arrived } }, { arrivedAt: arrived, createdAt: { $lt: ticket.createdAt } }] };
  const ahead = await Ticket.countDocuments({
    service: service._id, dateKey: today, status: 'waiting',
    ...(ticket.priority ? { priority: true, ...arrivedEarlier } : { $or: [{ priority: true }, arrivedEarlier] }),
  });
  const [served, rooms, nowServing] = await Promise.all([
    recentServed(service._id, today),
    activeRoomCount(service._id, today),
    Ticket.find({ service: service._id, dateKey: today, status: 'called' }).sort({ calledAt: -1 }).select('code room'),
  ]);
  const avgMinutes = averageServiceMinutes(served, service.defaultMinutes);
  const minutes = estimateWaitMinutes({ ahead, avgMinutes, activeRooms: rooms });
  return {
    ...result,
    position: ahead + 1,
    ahead,
    estimateMinutes: minutes,
    estimateText: describeWait(minutes),
    nowServing: nowServing.map((t) => ({ code: t.code, room: t.room })),
  };
};

module.exports = {
  issueTicket, callNext, applyAction, transferTicket, cancelByPatient,
  snapshot, ticketStatus, notifyNearlyUp,
  TRANSITIONS, QUEUE_ORDER,
};