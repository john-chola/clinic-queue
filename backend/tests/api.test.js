// HTTP layer: routing, staff protection and roles
const request = require('supertest');
const jwt = require('jsonwebtoken');
const Staff = require('../models/Staff');
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

test('sending a patient on reaches the transfer handler, not the generic ticket actions', async () => {
  jest.spyOn(Staff, 'findById').mockResolvedValue({ _id: 's1', role: 'clinician', isActive: true });
  jest.spyOn(Ticket, 'findById').mockResolvedValue(null);
  const res = await request(app)
    .post('/api/staff/tickets/abc/transfer')
    .set('Authorization', `Bearer ${tokenFor('s1')}`)
    .send({ serviceId: 'svc2' });
  expect(res.status).toBe(404);   // "Unknown action" would be a 400
  expect(res.body.message).toBe('Ticket not found');
});

test('login needs phone and password', async () => {
  const res = await request(app).post('/api/auth/login').send({ phone: '0970000001' });
  expect(res.status).toBe(400);
});
