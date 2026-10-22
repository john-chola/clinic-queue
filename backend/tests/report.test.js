// Daily report: the pure helpers, the route, and the service with aggregate faked
const request = require('supertest');
const jwt = require('jsonwebtoken');
const Staff = require('../models/Staff');
const Service = require('../models/Service');
const Ticket = require('../models/Ticket');
const { createApp } = require('../app');
const { isValidDateKey, msToMinutes, noShowRate, fillHours, buildDailyReport } = require('../utils/report');
const { dailyReport, hoursPipeline } = require('../services/reportService');

process.env.JWT_SECRET = 'test-secret';
const app = createApp();
const tokenFor = (id) => jwt.sign({ id }, process.env.JWT_SECRET);
const asRole = (role) => {
  jest.spyOn(Staff, 'findById').mockResolvedValue({ _id: 's1', role, isActive: true });
  return { Authorization: `Bearer ${tokenFor('s1')}` };
};

const OPD = { _id: 'svc1', name: 'OPD', prefix: 'A' };
const LAB = { _id: 'svc2', name: 'Lab', prefix: 'L' };
const MIN = 60000;

// Fake the database: Service.find().sort() and the two Ticket.aggregate calls, in order
const fakeDb = ({ services = [OPD, LAB], totals = [], hours = [] } = {}) => {
  jest.spyOn(Service, 'find').mockReturnValue({ sort: async () => services });
  return jest.spyOn(Ticket, 'aggregate').mockResolvedValueOnce(totals).mockResolvedValueOnce(hours);
};

afterEach(() => jest.restoreAllMocks());

describe('helpers', () => {
  test('milliseconds become minutes to 1 decimal place', () => {
    expect(msToMinutes(12.64 * MIN)).toBe(12.6);
    expect(msToMinutes(90000)).toBe(1.5);
    expect(msToMinutes(0)).toBe(0);
  });

  test('no average stays null rather than becoming 0', () => {
    expect(msToMinutes(null)).toBeNull();
    expect(msToMinutes(undefined)).toBeNull();
  });

  test('no-show rate is a percentage of those called', () => {
    expect(noShowRate(1, 3)).toBe(33.3);
    expect(noShowRate(2, 8)).toBe(25);
  });

  test('no-show rate is 0 when nobody was called', () => {
    expect(noShowRate(0, 0)).toBe(0);
  });

  test('every hour 06–20 is there, with gaps filled by 0', () => {
    const hours = fillHours([{ hour: 8, joined: 4 }, { hour: 10, joined: 1 }]);
    expect(hours.map((h) => h.hour)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(hours.slice(0, 5)).toEqual([
      { hour: 6, joined: 0 }, { hour: 7, joined: 0 }, { hour: 8, joined: 4 }, { hour: 9, joined: 0 }, { hour: 10, joined: 1 },
    ]);
  });

  test('a patient joining outside 06–20 is not dropped', () => {
    const hours = fillHours([{ hour: 22, joined: 1 }]);
    expect(hours[hours.length - 1]).toEqual({ hour: 22, joined: 1 });
    expect(hours).toHaveLength(16);
  });

  test('dates must be real YYYY-MM-DD days', () => {
    expect(isValidDateKey('2026-10-21')).toBe(true);
    expect(isValidDateKey('2026-02-30')).toBe(false);
    expect(isValidDateKey('21-10-2026')).toBe(false);
    expect(isValidDateKey(['2026-10-21'])).toBe(false);   // ?date=..&date=..
  });

  test('clinic averages are weighted by how many patients each service had', () => {
    const r = buildDailyReport({
      date: '2026-10-21',
      services: [OPD, LAB],
      totals: [
        { service: 'svc1', joined: 3, called: 3, served: 3, noShows: 0, avgWaitMs: 10 * MIN, avgServiceMs: 6 * MIN },
        { service: 'svc2', joined: 1, called: 1, served: 0, noShows: 1, avgWaitMs: 30 * MIN, avgServiceMs: null },
      ],
      hours: [],
    });
    expect(r.totals.avgWaitMinutes).toBe(15);          // (3×10 + 1×30) / 4, not (10 + 30) / 2
    expect(r.totals.avgServiceMinutes).toBe(6);        // the Lab, with nobody finished, is left out
    expect(r.totals.noShowRate).toBe(25);
  });
});

describe('GET /api/staff/reports/daily', () => {
  test('needs a token', async () => {
    expect((await request(app).get('/api/staff/reports/daily')).status).toBe(401);
  });

  test('a receptionist is refused', async () => {
    const res = await request(app).get('/api/staff/reports/daily').set(asRole('receptionist'));
    expect(res.status).toBe(403);
  });

  test('a clinician is refused', async () => {
    const res = await request(app).get('/api/staff/reports/daily').set(asRole('clinician'));
    expect(res.status).toBe(403);
  });

  test('an invalid date is a 400', async () => {
    const aggregate = jest.spyOn(Ticket, 'aggregate');
    for (const date of ['21-10-2026', '2026-13-01', 'yesterday']) {
      const res = await request(app).get(`/api/staff/reports/daily?date=${date}`).set(asRole('admin'));
      expect(res.status).toBe(400);
    }
    expect(aggregate).not.toHaveBeenCalled();
  });

  test('an admin gets the report', async () => {
    fakeDb();
    const res = await request(app).get('/api/staff/reports/daily?date=2026-10-21').set(asRole('admin'));
    expect(res.status).toBe(200);
    expect(res.body.report.date).toBe('2026-10-21');
    expect(res.body.report.services.map((s) => s.service.name)).toEqual(['OPD', 'Lab']);
  });

  test('without a date it reports on today', async () => {
    fakeDb();
    const res = await request(app).get('/api/staff/reports/daily').set(asRole('admin'));
    expect(res.body.report.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Ticket.aggregate.mock.calls[0][0][0]).toEqual({ $match: { dateKey: res.body.report.date } });
  });
});

describe('dailyReport', () => {
  test('hours are counted on the Lusaka clock', () => {
    expect(JSON.stringify(hoursPipeline('2026-10-21'))).toContain('"timezone":"Africa/Lusaka"');
  });

  test('turns the aggregation rows into the final report', async () => {
    const aggregate = fakeDb({
      totals: [{
        service: 'svc1', joined: 5, waiting: 1, called: 3, served: 2, noShows: 1, cancelled: 1, priority: 1,
        avgWaitMs: 754000, avgServiceMs: 7.25 * MIN,
      }],
      hours: [{ service: 'svc1', hour: 8, joined: 4 }, { service: 'svc1', hour: 9, joined: 1 }],
    });

    const r = await dailyReport('2026-10-21');
    expect(aggregate).toHaveBeenCalledTimes(2);
    for (const [pipeline] of aggregate.mock.calls) expect(pipeline[0]).toEqual({ $match: { dateKey: '2026-10-21' } });

    expect(r.date).toBe('2026-10-21');
    expect(r.services[0]).toMatchObject({
      service: { _id: 'svc1', name: 'OPD', prefix: 'A' },
      joined: 5, served: 2, noShows: 1, cancelled: 1, priority: 1,
      noShowRate: 33.3, avgWaitMinutes: 12.6, avgServiceMinutes: 7.3,
    });
    expect(r.services[0].byHour).toHaveLength(15);
    expect(r.services[0].byHour.find((h) => h.hour === 8)).toEqual({ hour: 8, joined: 4 });

    // A service nobody visited still gets a row, with zeros and no averages
    expect(r.services[1]).toMatchObject({
      service: { name: 'Lab' }, joined: 0, served: 0, noShowRate: 0, avgWaitMinutes: null, avgServiceMinutes: null,
    });
    expect(r.services[1].byHour.every((h) => h.joined === 0)).toBe(true);

    expect(r.totals).toMatchObject({ joined: 5, served: 2, noShows: 1, noShowRate: 33.3, avgWaitMinutes: 12.6 });
    expect(r.totals.byHour.find((h) => h.hour === 9)).toEqual({ hour: 9, joined: 1 });
  });
});
