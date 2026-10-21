// Daily report helpers and the report service, with the database faked
const Ticket = require('../models/Ticket');
const Service = require('../models/Service');
const QueueEvent = require('../models/QueueEvent');
const { stats, lusakaHour, summarize, buildServiceReport } = require('../utils/report');
const { dailyReport, isValidDateKey } = require('../services/reportService');

// Minutes after 08:00 Lusaka (06:00 UTC) on 21 Oct 2026
const at = (min) => new Date(Date.UTC(2026, 9, 21, 6, min));
const ticket = (over) => ({ service: 'svc1', status: 'waiting', source: 'self', priority: false, room: '', createdAt: at(0), ...over });
const seen = (joinMin, calledMin, doneMin, over = {}) =>
  ticket({ status: 'done', room: 'Room 1', createdAt: at(joinMin), calledAt: at(calledMin), doneAt: at(doneMin), ...over });

afterEach(() => jest.restoreAllMocks());

describe('stats', () => {
  test('median, p90 and max', () => {
    expect(stats([5, 1, 3, 2, 4, 6, 7, 8, 9, 10])).toEqual({ count: 10, median: 5, p90: 9, max: 10 });
  });
  test('an empty day has no numbers rather than zeros', () => {
    expect(stats([])).toEqual({ count: 0, median: null, p90: null, max: null });
  });
});

test('hours follow Lusaka time, not UTC', () => {
  expect(lusakaHour(new Date('2026-10-21T06:30:00Z'))).toBe(8);
  expect(lusakaHour(new Date('2026-10-21T21:59:00Z'))).toBe(23);
});

describe('summarize', () => {
  test('counts outcomes, sources, priority and SMS', () => {
    const r = summarize([
      seen(0, 10, 16),
      seen(5, 30, 40, { source: 'reception', priority: true, notifiedAt: at(20) }),
      ticket({ status: 'no_show', calledAt: at(50) }),
      ticket({ status: 'cancelled' }),
      ticket({ createdAt: at(70) }),
    ], 1);
    expect(r.joined).toBe(5);
    expect(r.outcomes).toEqual({ waiting: 1, called: 0, done: 2, no_show: 1, cancelled: 1 });
    expect(r.bySource).toEqual({ self: 4, reception: 1 });
    expect(r.priority).toBe(1);
    expect(r.returned).toBe(1);
    expect(r.smsSent).toBe(1);
    expect(r.byHour).toEqual([{ hour: 8, joined: 4 }, { hour: 9, joined: 1 }]);
  });

  test('wait counts everyone called; service time only those finished', () => {
    const r = summarize([seen(0, 10, 16), seen(0, 20, 30), ticket({ status: 'no_show', calledAt: at(40) }), ticket()]);
    expect(r.waitMinutes).toMatchObject({ count: 3, median: 20, max: 40 });
    expect(r.serviceMinutes).toMatchObject({ count: 2, median: 6, max: 10 });
  });

  test('an empty day', () => {
    const r = summarize([]);
    expect(r.joined).toBe(0);
    expect(r.waitMinutes.median).toBeNull();
    expect(r.byHour).toEqual([]);
  });
});

test('rooms are listed busiest first', () => {
  const r = buildServiceReport({ _id: 'svc1', name: 'OPD', prefix: 'A' }, [
    seen(0, 1, 5, { room: 'Room 2' }),
    seen(0, 6, 14, { room: 'Room 1' }),
    seen(0, 15, 19, { room: 'Room 1' }),
  ]);
  expect(r.service).toEqual({ _id: 'svc1', name: 'OPD', prefix: 'A' });
  expect(r.byRoom).toEqual([
    { room: 'Room 1', served: 2, medianServiceMinutes: 4 },
    { room: 'Room 2', served: 1, medianServiceMinutes: 4 },
  ]);
});

test('dates must be real YYYY-MM-DD days', () => {
  expect(isValidDateKey('2026-10-21')).toBe(true);
  expect(isValidDateKey('2026-02-30')).toBe(false);
  expect(isValidDateKey('21/10/2026')).toBe(false);
});

describe('dailyReport', () => {
  const OPD = { _id: 'svc1', name: 'OPD', prefix: 'A' };
  const LAB = { _id: 'svc2', name: 'Lab', prefix: 'L' };
  const chain = (result) => ({ sort: () => result, select: async () => result });

  test('every service gets its own report, plus clinic totals', async () => {
    jest.spyOn(Service, 'find').mockReturnValue(chain([OPD, LAB]));
    const find = jest.spyOn(Ticket, 'find').mockReturnValue(chain([
      seen(0, 10, 16, { _id: 't1' }),
      seen(0, 5, 9, { _id: 't2', service: 'svc2' }),
      ticket({ _id: 't3', service: 'svc2' }),
    ]));
    jest.spyOn(QueueEvent, 'find').mockReturnValue(chain([{ service: 'svc2' }]));

    const r = await dailyReport({ date: '2026-10-21' });
    expect(find).toHaveBeenCalledWith({ dateKey: '2026-10-21', service: { $in: ['svc1', 'svc2'] } });
    expect(r.date).toBe('2026-10-21');
    expect(r.services.map((s) => [s.service.name, s.joined, s.returned])).toEqual([['OPD', 1, 0], ['Lab', 2, 1]]);
    expect(r.totals).toMatchObject({ joined: 3, returned: 1 });
    expect(r.totals.outcomes.done).toBe(2);
  });

  test('a bad date or unknown service is refused', async () => {
    await expect(dailyReport({ date: '2026-13-01' })).rejects.toMatchObject({ statusCode: 400 });
    jest.spyOn(Service, 'findById').mockResolvedValue(null);
    await expect(dailyReport({ serviceId: 'nope' })).rejects.toMatchObject({ statusCode: 404 });
  });
});
