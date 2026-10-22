// Queue rules, with the database replaced by small in-memory fakes.
jest.mock('../utils/sms', () => ({ sendSms: jest.fn() }));

const Ticket = require('../models/Ticket');
const Counter = require('../models/Counter');
const Service = require('../models/Service');
const QueueEvent = require('../models/QueueEvent');
const queue = require('../services/queueService');
const { compareQueueOrder, dateKey } = require('../utils/queue');
const sms = require('../utils/sms');

const SERVICE = { _id: 'svc1', name: 'OPD', prefix: 'A', rooms: ['Room 1', 'Room 2'], isOpen: true, defaultMinutes: 6 };
const LAB = { _id: 'svc2', name: 'Lab', prefix: 'L', rooms: ['Lab 1'], isOpen: true, defaultMinutes: 4 };
const SERVICES = { svc1: SERVICE, svc2: LAB };

let tickets;
let seq;
beforeEach(() => {
  tickets = [];
  seq = 0;
  jest.spyOn(Service, 'findById').mockImplementation(async (id) => (SERVICES[id] ? { ...SERVICES[id] } : null));
  jest.spyOn(QueueEvent, 'create').mockResolvedValue({});
  // One counter per service, like the real `${serviceId}:${day}` counters
  const counters = {};
  jest.spyOn(Counter, 'findOneAndUpdate').mockImplementation(async (q) => { counters[q._id] = (counters[q._id] || 0) + 1; seq += 1; return { seq: counters[q._id] }; });
  jest.spyOn(Ticket, 'create').mockImplementation(async (d) => { const t = { _id: `t${tickets.length + 1}`, createdAt: new Date(Date.now() + tickets.length), calls: 0, status: 'waiting', ...d }; tickets.push(t); return t; });
  jest.spyOn(Ticket, 'findOne').mockImplementation(async (q) =>
    tickets.find((t) => String(t.service) === String(q.service) && t.phone === q.phone && q.status.$in.includes(t.status)) || null);
  jest.spyOn(Ticket, 'findById').mockImplementation(async (id) => tickets.find((t) => t._id === String(id)) || null);
  jest.spyOn(Ticket, 'updateMany').mockImplementation(async (q, u) => {
    tickets.filter((t) => String(t.service) === String(q.service) && t.status === q.status && t.room === q.room).forEach((t) => Object.assign(t, u.$set));
  });
  // Like MongoDB: find, sort and update happen as one step, with no await in between
  jest.spyOn(Ticket, 'findOneAndUpdate').mockImplementation(async (q, u) => {
    if (q._id) {   // claiming one ticket for a transfer: { transferredTo: null } matches null or missing
      const t = tickets.find((tk) => tk._id === String(q._id) && q.status.$in.includes(tk.status) && tk.transferredTo == null);
      return t ? Object.assign(t, u.$set) : null;
    }
    const next = tickets.filter((t) => String(t.service) === String(q.service) && t.status === q.status).sort(compareQueueOrder)[0];
    if (!next) return null;
    Object.assign(next, u.$set);
    next.calls += u.$inc.calls;
    return next;
  });

  // notifyNearlyUp reads with .find().sort().limit() and callNext with .find().select(): return a chained stub.
  jest.spyOn(Ticket, 'find').mockImplementation((q) => {
    const matched = tickets.filter((t) => {
      if (q.service !== undefined && String(t.service) !== String(q.service)) return false;
      if (q.dateKey !== undefined && t.dateKey !== q.dateKey) return false;
      if (q.status !== undefined && t.status !== q.status) return false;
      if (q.room !== undefined && t.room !== q.room) return false;
      return true;
    });
    return {
      select: async () => matched,
      sort: () => ({
        limit: (n) => [...matched].sort(compareQueueOrder).slice(0, n),
      }),
    };
  });
  // { notifiedAt: null } in Mongo matches both null and missing fields.
  jest.spyOn(Ticket, 'updateOne').mockImplementation(async (q, u) => {
    const t = tickets.find((tk) => String(tk._id) === String(q._id));
    if (!t) return { modifiedCount: 0 };
    if (q.notifiedAt === null && t.notifiedAt != null) return { modifiedCount: 0 };
    Object.assign(t, u.$set);
    Object.keys(u.$unset || {}).forEach((k) => delete t[k]);
    return { modifiedCount: 1 };
  });

  // sendSms is a jest.fn() from the module factory — restoreAllMocks won't reset it.
  sms.sendSms.mockClear();
  sms.sendSms.mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

const join = (data = {}, opts = {}) => queue.issueTicket('svc1', data, opts);

describe('joining the queue', () => {
  test('tickets are numbered in order with the service letter', async () => {
    const a = await join();
    const b = await join();
    expect([a.ticket.code, b.ticket.code]).toEqual(['A-001', 'A-002']);
    expect(a.ticket.dateKey).toBe(dateKey());
    expect(a.ticket.publicId).toMatch(/^[\w-]{12}$/);
    expect(a.ticket.publicId).not.toBe(b.ticket.publicId);
  });

  test('the same phone gets its existing ticket back instead of a second one', async () => {
    const first = await join({ phone: '0971234567' });
    const again = await join({ phone: '097 123 4567' });
    expect(again.existing).toBe(true);
    expect(again.ticket.code).toBe(first.ticket.code);
    expect(seq).toBe(1);
  });

  test('rejects a wrong phone number, a closed service and self-given priority', async () => {
    await expect(join({ phone: '12345' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(join({ priority: true, priorityReason: 'x' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(join({ priority: true }, { source: 'reception' })).rejects.toMatchObject({ statusCode: 400 });
    Service.findById.mockResolvedValue({ ...SERVICE, isOpen: false });
    await expect(join()).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('calling the next patient', () => {
  test('priority first, then in order; the previous patient in the room is finished', async () => {
    await join({ name: 'first' });
    await join({ name: 'second' });
    await join({ name: 'urgent', priority: true, priorityReason: 'Pregnant' }, { source: 'reception' });

    const one = await queue.callNext('svc1', 'Room 1');
    expect(one.name).toBe('urgent');
    expect(one.status).toBe('called');

    const two = await queue.callNext('svc1', 'Room 1');
    expect(two.name).toBe('first');
    expect(one.status).toBe('done');
    expect(one.doneAt).toBeInstanceOf(Date);
  });

  test('finishing the previous patient is written to the event log', async () => {
    await join({ name: 'first' });
    await join({ name: 'second' });
    const one = await queue.callNext('svc1', 'Room 1');
    await queue.callNext('svc1', 'Room 1');
    const done = QueueEvent.create.mock.calls.map((c) => c[0]).filter((e) => e.action === 'done');
    expect(done).toEqual([expect.objectContaining({ ticket: one._id, room: 'Room 1' })]);
  });

  test('two rooms pressing Next at the same moment get different patients', async () => {
    await join({ name: 'p1' });
    await join({ name: 'p2' });
    const [r1, r2] = await Promise.all([queue.callNext('svc1', 'Room 1'), queue.callNext('svc1', 'Room 2')]);
    expect(r1.name).not.toBe(r2.name);
    expect(new Set([r1.room, r2.room])).toEqual(new Set(['Room 1', 'Room 2']));
  });

  test('returns null when nobody is waiting, and checks the room', async () => {
    expect(await queue.callNext('svc1', 'Room 1')).toBeNull();
    await expect(queue.callNext('svc1', 'Room 9')).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('ticket actions', () => {
  const stored = (over) => {
    const t = { _id: 'x', service: 'svc1', code: 'A-005', status: 'called', calls: 1, room: 'Room 1', priority: false, priorityReason: '', save: async () => {}, ...over };
    jest.spyOn(Ticket, 'findById').mockResolvedValue(t);
    return t;
  };

  test('recall announces again', async () => {
    const t = stored();
    await queue.applyAction('x', 'recall');
    expect(t.calls).toBe(2);
  });

  test('a patient who missed the call returns to the front', async () => {
    const t = stored({ status: 'no_show' });
    await queue.applyAction('x', 'return');
    expect(t.status).toBe('waiting');
    expect(t.priority).toBe(true);
  });

  test('impossible changes are refused', async () => {
    stored({ status: 'waiting' });
    await expect(queue.applyAction('x', 'done')).rejects.toMatchObject({ statusCode: 409 });
    await expect(queue.applyAction('x', 'dance')).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('sending a patient on to another service', () => {
  const at = (h, m) => new Date(2026, 9, 22, h, m);
  const joinLab = (data = {}) => queue.issueTicket('svc2', data);
  // A patient who arrived at OPD at 08:00 and is now in Room 1
  const seenInOpd = async (data = {}) => {
    const { ticket } = await join({ name: 'Mwila', phone: '0971234567', ...data });
    ticket.arrivedAt = at(8, 0);
    return queue.callNext('svc1', 'Room 1');
  };

  test('makes a linked ticket in the other queue and finishes the patient here', async () => {
    const opd = await seenInOpd();
    const { from, to, service } = await queue.transferTicket(opd._id, 'svc2');

    expect(service.name).toBe('Lab');
    expect(to).toMatchObject({ service: 'svc2', code: 'L-001', status: 'waiting', name: 'Mwila', phone: '+260971234567' });
    expect(to.publicId).not.toBe(opd.publicId);
    // Linked both ways
    expect(String(to.fromTicket)).toBe(opd._id);
    expect(String(from.transferredTo)).toBe(String(to._id));
    // Seen in OPD, so finished there; the room is free for the next patient
    expect(opd).toMatchObject({ status: 'done' });
    expect(opd.doneAt).toBeInstanceOf(Date);
    const events = QueueEvent.create.mock.calls.map((c) => c[0].action);
    expect(events).toEqual(expect.arrayContaining(['transferred', 'joined']));
  });

  test('keeps their place: the Lab queue is ordered by arrival at the clinic', async () => {
    (await joinLab({ name: 'before' })).ticket.arrivedAt = at(7, 50);
    (await joinLab({ name: 'after' })).ticket.arrivedAt = at(9, 30);
    const opd = await seenInOpd();
    await queue.transferTicket(opd._id, 'svc2');

    const order = [];
    for (let i = 0; i < 3; i += 1) order.push((await queue.callNext('svc2', 'Lab 1')).name);
    expect(order).toEqual(['before', 'Mwila', 'after']);
  });

  test('priority goes with the patient, but not the one-off priority for returning late', async () => {
    const { ticket: pregnant } = await join({ name: 'P', priority: true, priorityReason: 'Pregnant' }, { source: 'reception' });
    pregnant.status = 'called';
    const { to } = await queue.transferTicket(pregnant._id, 'svc2');
    expect(to).toMatchObject({ priority: true, priorityReason: 'Pregnant' });

    const { ticket: late } = await join({ name: 'L' });
    Object.assign(late, { status: 'called', priority: true, priorityReason: 'Returned after missing the call' });
    const { to: lateTo } = await queue.transferTicket(late._id, 'svc2');
    expect(lateTo).toMatchObject({ priority: false, priorityReason: '' });
  });

  test('a double tap makes only one new ticket', async () => {
    const opd = await seenInOpd();
    const results = await Promise.allSettled([queue.transferTicket(opd._id, 'svc2'), queue.transferTicket(opd._id, 'svc2')]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(results.find((r) => r.status === 'rejected').reason.statusCode).toBe(409);
    expect(tickets.filter((t) => t.service === 'svc2')).toHaveLength(1);
  });

  test('if the new ticket cannot be made, the patient is left as they were', async () => {
    const opd = await seenInOpd();
    Counter.findOneAndUpdate.mockRejectedValueOnce(new Error('database down'));
    await expect(queue.transferTicket(opd._id, 'svc2')).rejects.toThrow('database down');
    expect(opd.status).toBe('called');
    expect(opd.transferredTo).toBeUndefined();
    expect(opd.doneAt).toBeUndefined();

    const { to } = await queue.transferTicket(opd._id, 'svc2');   // and it can be tried again
    expect(to.code).toBe('L-001');
  });

  test('impossible transfers are refused', async () => {
    const { ticket: waiting } = await join({ name: 'W' });
    await expect(queue.transferTicket(waiting._id, 'svc2')).rejects.toMatchObject({ statusCode: 409 });
    const opd = await seenInOpd();
    await expect(queue.transferTicket(opd._id, 'svc1')).rejects.toMatchObject({ statusCode: 400 });
    await expect(queue.transferTicket(opd._id)).rejects.toMatchObject({ statusCode: 400 });
    await expect(queue.transferTicket(opd._id, 'nope')).rejects.toMatchObject({ statusCode: 404 });
    await expect(queue.transferTicket('missing', 'svc2')).rejects.toMatchObject({ statusCode: 404 });
    SERVICES.svc2 = { ...LAB, isOpen: false };
    try {
      await expect(queue.transferTicket(opd._id, 'svc2')).rejects.toMatchObject({ statusCode: 409 });
    } finally { SERVICES.svc2 = LAB; }
    expect(opd.status).toBe('called');   // nothing was changed by the refusals
  });

  test('a patient already waiting in that queue is not added twice', async () => {
    await joinLab({ phone: '0971234567' });
    const opd = await seenInOpd();
    await expect(queue.transferTicket(opd._id, 'svc2')).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('L-001') });
  });
});

describe('notifyNearlyUp', () => {
  test('texts the first 3 patients in line who have phones, and marks them notified', async () => {
    await join({ phone: '0971111111' });   // 1st — phone
    await join({ phone: '0972222222' });   // 2nd — phone
    await join({ phone: '0973333333' });   // 3rd — phone
    await join();                          // 4th — no phone, and not in the first 3 anyway

    await queue.notifyNearlyUp('svc1');

    expect(sms.sendSms).toHaveBeenCalledTimes(3);
    const messages = sms.sendSms.mock.calls.map((c) => c[1]);
    expect(messages[0]).toContain('1st in line');
    expect(messages[1]).toContain('2nd in line');
    expect(messages[2]).toContain('3rd in line');
    // The guarded update actually landed on each ticket
    expect(tickets.filter((t) => t.notifiedAt instanceof Date)).toHaveLength(3);
  });

  test('a second call sends nothing: everyone near the front is already notified', async () => {
    await join({ phone: '0971111111' });
    await join({ phone: '0972222222' });
    await join({ phone: '0973333333' });

    await queue.notifyNearlyUp('svc1');
    await queue.notifyNearlyUp('svc1');

    expect(sms.sendSms).toHaveBeenCalledTimes(3); // not 6
  });

  test('a patient without a phone is skipped, not texted as "undefined"', async () => {
    await join();                          // 1st — no phone
    await join({ phone: '0972222222' });   // 2nd — phone

    await queue.notifyNearlyUp('svc1');

    expect(sms.sendSms).toHaveBeenCalledTimes(1);
    expect(sms.sendSms.mock.calls[0][0]).toBeTruthy();
    expect(sms.sendSms.mock.calls[0][1]).toContain('2nd in line');
  });
});