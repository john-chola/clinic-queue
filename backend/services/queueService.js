// All queue changes go through here, so the rules live in one place.
const crypto = require('crypto');
const Ticket = require('../models/Ticket');
const Counter = require('../models/Counter');
const Service = require('../models/Service');
const QueueEvent = require('../models/QueueEvent');
const httpError = require('../utils/httpError');
const { normalizePhone, isValidPhone } = require('../utils/phone');
const {
  dateKey, formatCode, averageServiceMinutes, estimateWaitMinutes, describeWait,
} = require('../utils/queue');
const {sendSms} = require('../utils/sms');

const ACTIVE_ROOM_WINDOW_MS = 30 * 60 * 1000;   // a room that called someone in the last 30 min is "working"
const QUEUE_ORDER = { priority: -1, createdAt: 1 };

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

  const counter = await Counter.findOneAndUpdate(
    { _id: `${service._id}:${today}` },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  const ticket = await Ticket.create({
    service: service._id,
    dateKey: today,
    number: counter.seq,
    code: formatCode(service.prefix, counter.seq),
    publicId: crypto.randomBytes(9).toString('base64url'),
    name: String(name).trim().slice(0, 60),
    phone: cleanPhone,
    source,
    priority: Boolean(priority),
    priorityReason: priority ? String(priorityReason).trim().slice(0, 120) : '',
  });
  log(ticket, 'joined', staff);
  return { ticket, existing: false };
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

  await Ticket.updateMany(
    { service: service._id, dateKey: today, status: 'called', room },
    { $set: { status: 'done', doneAt: now } }
  );

  const next = await Ticket.findOneAndUpdate(
    { service: service._id, dateKey: today, status: 'waiting' },
    { $set: { status: 'called', room, calledAt: now }, $inc: { calls: 1 } },
    { sort: QUEUE_ORDER, new: true }
  );
  if (next) log(next, 'called', staff, room);
  return next;   // null when nobody is waiting
};

const notifyNearlyUp = async (serviceId) => {
  // "Today" window - local midnight to next midnight
  const  startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new  Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const firstThree = await Ticket.find({
    service: serviceId,
    status: 'waiting',
    notifiedAt: { $exists: false },
    createdAt: { $gte: startOfDay, $lt: endOfDay },
  }).sort(QUEUE_ORDER)
  .limit(3)
  .lean();

  const results = [];

  for (const ticket of firstThree) {
    if (ticket.phone || ticket.notifiedAt) continue; // Skip if no phone or already notified{
      
    try {
      await sendSms(ticket.phone, `Your ticket ${ticket.code} is nearly up. Please be ready to go to the room when called.`);
      await Ticket.updateOne({ _id: ticket._id }, { $set: { notifiedAt: new Date() } });
      console.log(`Notified ticket ${ticket.code} at ${ticket.phone}`);
    }

    const res = await Ticket.updateOne({ _id: ticket._id }, { $set: { notifiedAt: new Date() } });
    if (res.modifiedCount > 0) {
      console.log(`Notified ticket ${ticket.code} at ${ticket.phone}`);
      results.push({ ticketId: ticket._id, code: ticket.code, phone: ticket.phone });
    } else {
      console.log(`Ticket ${ticket.code} at ${ticket.phone} was already notified.`);
    }
  }

  return results;
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
    ticket.priorityReason = ticket.priorityReason || 'Returned after missing the call';
    ticket.room = '';
  }
  await ticket.save();
  log(ticket, rule.event, staff, ticket.room);
  return ticket;
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

// ── Reading the queue ───────────────────────────────────────
const recentServed = (serviceId, today) =>
  Ticket.find({ service: serviceId, dateKey: today, status: 'done', doneAt: { $exists: true } })
    .sort({ doneAt: -1 }).limit(10).select('calledAt doneAt');

const activeRoomCount = async (serviceId, today) => {
  const since = new Date(Date.now() - ACTIVE_ROOM_WINDOW_MS);
  const rooms = await Ticket.distinct('room', { service: serviceId, dateKey: today, calledAt: { $gte: since }, room: { $ne: '' } });
  return Math.max(1, rooms.length);
};

// Everything the display screen and staff page need for one service.
// Staff get names and phones; the public view gets ticket codes only.
const snapshot = async (serviceOrId, { forStaff = false } = {}) => {
  const service = serviceOrId._id ? serviceOrId : await findService(serviceOrId);
  const today = dateKey();
  const [waiting, called, served, rooms, missed] = await Promise.all([
    Ticket.find({ service: service._id, dateKey: today, status: 'waiting' }).sort(QUEUE_ORDER),
    Ticket.find({ service: service._id, dateKey: today, status: 'called' }).sort({ calledAt: -1 }),
    recentServed(service._id, today),
    activeRoomCount(service._id, today),
    forStaff ? Ticket.find({ service: service._id, dateKey: today, status: 'no_show' }).sort({ updatedAt: -1 }).limit(10) : [],
  ]);
  const avgMinutes = averageServiceMinutes(served, service.defaultMinutes);
  const pub = (t) => ({ code: t.code, room: t.room, priority: t.priority, calls: t.calls });
  const staffView = (t) => ({
    ...pub(t), _id: t._id, name: t.name, phone: t.phone, priorityReason: t.priorityReason,
    source: t.source, createdAt: t.createdAt, calledAt: t.calledAt,
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
  const ticket = await Ticket.findOne({ publicId }).populate('service', 'name prefix rooms defaultMinutes');
  if (!ticket) throw httpError(404, 'Ticket not found');
  const service = ticket.service;
  const result = {
    code: ticket.code, status: ticket.status, room: ticket.room, priority: ticket.priority,
    name: ticket.name, service: { _id: service._id, name: service.name }, createdAt: ticket.createdAt, calledAt: ticket.calledAt,
  };
  if (ticket.status !== 'waiting') return result;

  const today = ticket.dateKey;
  const ahead = await Ticket.countDocuments({
    service: service._id, dateKey: today, status: 'waiting',
    $or: ticket.priority
      ? [{ priority: true, createdAt: { $lt: ticket.createdAt } }]
      : [{ priority: true }, { createdAt: { $lt: ticket.createdAt } }],
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

module.exports = { issueTicket, callNext, applyAction, cancelByPatient, snapshot, ticketStatus, TRANSITIONS, QUEUE_ORDER };
