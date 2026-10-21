// HTTP layer: routing, staff protection and roles
const request = require('supertest');
const jwt = require('jsonwebtoken');
const Staff = require('../models/Staff');
const Service = require('../models/Service');
const Ticket = require('../models/Ticket');
const { createApp } = require('../app');

process.env.JWT_SECRET = 'test-secret';
const app = createApp();
const tokenFor = (id) => jwt.sign({ id }, process.env.JWT_SECRET);

afterEach(() => jest.restoreAllMocks());

test('unknown API routes return JSON 404', async () => {
  const res = await request(app).get('/api/nothing-here');
  expect(res.status).toBe(404);
  expect(res.body.status).toBe('error');
});

test('staff routes need a token', async () => {
  const res = await request(app).post('/api/staff/services/abc/next').send({ room: 'Room 1' });
  expect(res.status).toBe(401);
});

test('a clinician cannot add walk-in patients', async () => {
  jest.spyOn(Staff, 'findById').mockResolvedValue({ _id: 's1', role: 'clinician', isActive: true });
  const res = await request(app)
    .post('/api/staff/services/abc/tickets')
    .set('Authorization', `Bearer ${tokenFor('s1')}`)
    .send({ name: 'Walk-in' });
  expect(res.status).toBe(403);
});

describe('daily report', () => {
  const asRole = (role) => {
    jest.spyOn(Staff, 'findById').mockResolvedValue({ _id: 's1', role, isActive: true });
    return { Authorization: `Bearer ${tokenFor('s1')}` };
  };

  test('needs a token', async () => {
    expect((await request(app).get('/api/staff/reports/daily')).status).toBe(401);
  });

  test('is for admins only', async () => {
    for (const role of ['clinician', 'receptionist']) {
      const res = await request(app).get('/api/staff/reports/daily').set(asRole(role));
      expect(res.status).toBe(403);
    }
  });

  test('refuses a badly written date', async () => {
    const res = await request(app).get('/api/staff/reports/daily?date=21-10-2026').set(asRole('admin'));
    expect(res.status).toBe(400);
  });

  test('an admin gets the report', async () => {
    const chain = (result) => ({ sort: () => result, select: async () => result });
    jest.spyOn(Service, 'find').mockReturnValue(chain([{ _id: 'svc1', name: 'OPD', prefix: 'A' }]));
    jest.spyOn(Ticket, 'find').mockReturnValue(chain([]));
    const res = await request(app).get('/api/staff/reports/daily?date=2026-10-21').set(asRole('admin'));
    expect(res.status).toBe(200);
    expect(res.body.report.date).toBe('2026-10-21');
    expect(res.body.report.services[0]).toMatchObject({ joined: 0, service: { name: 'OPD' } });
  });
});

test('login needs phone and password', async () => {
  const res = await request(app).post('/api/auth/login').send({ phone: '0970000001' });
  expect(res.status).toBe(400);
});
