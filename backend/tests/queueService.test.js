// Queue rules, with the database replaced by small in-memory fakes.
const Ticket = require('../models/Ticket');
const Counter = require('../models/Counter');
const Service = require('../models/Service');
const QueueEvent = require('../models/QueueEvent');
const queue = require('../services/queueService');
const { compareQueueOrder, dateKey } = require('../utils/queue');

const SERVICE = { _id: 'svc1', name: 'OPD', prefix: 'A', rooms: ['Room 1', 'Room 2'], isOpen: true, defaultMinutes: 6 };

let tickets;
let seq;
beforeEach(() => {
  tickets = [];
  seq = 0;
  jest.spyOn(Service, 'findById').mockImplementation(async (id) => (id === 'svc1' ? { ...SERVICE } : null));
  jest.spyOn(QueueEvent, 'create').mockResolvedValue({});
  jest.spyOn(Counter, 'findOneAndUpdate').mockImplementation(async () => ({ seq: ++seq }));
  jest.spyOn(Ticket, 'create').mockImplementation(async (d) => { const t = { _id: `t${tickets.length + 1}`, createdAt: new Date(Date.now() + tickets.length), calls: 0, status: 'waiting', ...d }; tickets.push(t); return t; });
  jest.spyOn(Ticket, 'findOne').mockImplementation(async (q) => tickets.find((t) => t.phone === q.phone && q.status.$in.includes(t.status)) || null);
  jest.spyOn(Ticket, 'updateMany').mockImplementation(async (q, u) => {
    tickets.filter((t) => t.status === q.status && t.room === q.room).forEach((t) => Object.assign(t, u.$set));
  });
  // Like MongoDB: find, sort and update happen as one step, with no await in between
  jest.spyOn(Ticket, 'findOneAndUpdate').mockImplementation(async (q, u) => {
    const next = tickets.filter((t) => t.status === q.status).sort(compareQueueOrder)[0];
    if (!next) return null;
    Object.assign(next, u.$set);
    next.calls += u.$inc.calls;
    return next;
  });
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

describe('notifyNearlyUp', () => {
  it('texts the first 3 waiting patients who have phones', async () => {
    // fakes already set up in this file, e.g.:
    //   A-021 (phone)
    //   A-022 (no phone)
    //   A-023 (phone)
    //   A-024 (phone)
    //   -> 4 waiting, 3 with phones
    const spy = jest.spyOn(sms, 'sendSms').mockResolvedValue(undefined);

    await queueService.notifyNearlyUp('OPD');

    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls.map(c => c[0])).toEqual([
      '+260...021',
      '+260...023',
      '+260...024',
    ]);
  });

  it('does nothing on a second call — everyone is already notified', async () => {
    const spy = jest.spyOn(sms, 'sendSms').mockResolvedValue(undefined);

    await queueService.notifyNearlyUp('OPD');
    await queueService.notifyNearlyUp('OPD');

    expect(spy).toHaveBeenCalledTimes(3); // not 6
  });

  afterEach(() => jest.restoreAllMocks());
});
