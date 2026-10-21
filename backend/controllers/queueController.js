const Service = require('../models/Service');
const queue = require('../services/queueService');
const { emitQueueChanged } = require('../utils/socket');

// Fire-and-forget: a staff action should never wait on (or fail because of) an SMS.
const notifyNearlyUp = (serviceId) =>
  queue.notifyNearlyUp(serviceId).catch((err) =>
    console.error('notifyNearlyUp failed:', err)
  );

// ── Public ──────────────────────────────────────────────────

// GET /api/services: every service with its current queue length and wait
exports.listServices = async (req, res, next) => {
  try {
    const services = await Service.find().sort({ order: 1, name: 1 });
    const queues = await Promise.all(services.map((s) => queue.snapshot(s)));
    res.json({ status: 'success', services: queues });
  } catch (err) { next(err); }
};

// GET /api/services/:id/queue: public view (codes only); staff get names too
exports.getQueue = async (req, res, next) => {
  try {
    res.json({ status: 'success', queue: await queue.snapshot(req.params.id, { forStaff: Boolean(req.staff) }) });
  } catch (err) { next(err); }
};

// POST /api/services/:id/tickets  { name?, phone? }: patient joins from their phone
exports.joinQueue = async (req, res, next) => {
  try {
    const { name, phone } = req.body || {};
    const { ticket, existing } = await queue.issueTicket(req.params.id, { name, phone }, { source: 'self' });
    if (!existing) emitQueueChanged(ticket.service);
    res.status(existing ? 200 : 201).json({ status: 'success', existing, ticket: { publicId: ticket.publicId, code: ticket.code } });
  } catch (err) { next(err); }
};

// GET /api/tickets/:publicId: the patient's own ticket: position and estimate
exports.getTicket = async (req, res, next) => {
  try {
    res.json({ status: 'success', ticket: await queue.ticketStatus(req.params.publicId) });
  } catch (err) { next(err); }
};

// POST /api/tickets/:publicId/cancel: the patient leaves the queue
exports.cancelOwnTicket = async (req, res, next) => {
  try {
    const ticket = await queue.cancelByPatient(req.params.publicId);
    emitQueueChanged(ticket.service);
    notifyNearlyUp(ticket.service);
    res.json({ status: 'success', message: `Ticket ${ticket.code} cancelled` });
  } catch (err) { next(err); }
};

// ── Staff ───────────────────────────────────────────────────

// POST /api/staff/services/:id/tickets  { name?, phone?, priority?, priorityReason? }: walk-in at reception
exports.addWalkIn = async (req, res, next) => {
  try {
    const { ticket, existing } = await queue.issueTicket(req.params.id, req.body || {}, { source: 'reception', staff: req.staff });
    if (!existing) emitQueueChanged(ticket.service);
    res.status(existing ? 200 : 201).json({ status: 'success', existing, ticket: { _id: ticket._id, publicId: ticket.publicId, code: ticket.code } });
  } catch (err) { next(err); }
};

// POST /api/staff/services/:id/next  { room }: finish the current patient and call the next one
exports.callNext = async (req, res, next) => {
  try {
    const ticket = await queue.callNext(req.params.id, req.body?.room, req.staff);
    emitQueueChanged(req.params.id, ticket ? { called: { code: ticket.code, room: ticket.room } } : {});
    notifyNearlyUp(req.params.id);
    res.json({
      status: 'success',
      ticket: ticket ? { _id: ticket._id, code: ticket.code, room: ticket.room, name: ticket.name } : null,
      message: ticket ? `Calling ${ticket.code} to ${ticket.room}` : 'Nobody is waiting',
    });
  } catch (err) { next(err); }
};

// POST /api/staff/tickets/:id/:action  (recall | done | no_show | cancel | return)
exports.ticketAction = async (req, res, next) => {
  try {
    const ticket = await queue.applyAction(req.params.id, req.params.action, req.staff);
    const extra = req.params.action === 'recall' ? { called: { code: ticket.code, room: ticket.room } } : {};
    emitQueueChanged(ticket.service, extra);
    // Only these two actions remove someone from the queue and shift positions.
    if (req.params.action === 'cancel' || req.params.action === 'no_show') {
      notifyNearlyUp(ticket.service);
    }
    res.json({ status: 'success', ticket: { _id: ticket._id, code: ticket.code, status: ticket.status } });
  } catch (err) { next(err); }
};