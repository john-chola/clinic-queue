// Admin screens: cleaning input, the rules on services and staff, and who may use the routes
const request = require('supertest');
const jwt = require('jsonwebtoken');
const Staff = require('../models/Staff');
const Service = require('../models/Service');
const Ticket = require('../models/Ticket');
const { createApp } = require('../app');
const { pick, cleanRooms, checkBoolean } = require('../utils/admin');
const admin = require('../services/adminService');

process.env.JWT_SECRET = 'test-secret';
const app = createApp();
const tokenFor = (id) => jwt.sign({ id }, process.env.JWT_SECRET);

afterEach(() => jest.restoreAllMocks());

// A stored document: fields plus save() and deleteOne() that do nothing
const doc = (fields) => ({ ...fields, save: jest.fn(async function save() { return this; }), deleteOne: jest.fn(async () => {}) });

describe('helpers', () => {
  test('pick keeps only the allowed fields', () => {
    expect(pick({ name: 'OPD', isAdmin: true, _id: 'x' }, ['name', 'rooms'])).toEqual({ name: 'OPD' });
    expect(pick(undefined, ['name'])).toEqual({});
  });

  test('rooms are trimmed, blanks dropped and spaces tidied', () => {
    expect(cleanRooms([' Room 1 ', '', 'Room   2', null])).toEqual(['Room 1', 'Room 2']);
  });

  test('a service needs at least one room, and no room twice', () => {
    expect(() => cleanRooms(['', '  '])).toThrow('at least one room');
    expect(() => cleanRooms(['Room 1', 'room 1'])).toThrow('listed twice');
    expect(() => cleanRooms('Room 1')).toThrow('must be a list');
    expect(() => cleanRooms(['x'.repeat(31)])).toThrow('too long');
  });

  test('true/false must really be a boolean', () => {
    expect(checkBoolean(false, 'Open')).toBe(false);
    expect(() => checkBoolean('false', 'Open')).toThrow('Open must be true or false');
  });
});

describe('services', () => {
  const OPD = () => doc({ _id: 'svc1', name: 'OPD', prefix: 'A', rooms: ['Room 1', 'Room 2'], isOpen: true });

  test('a new service gets a clean letter and rooms', async () => {
    jest.spyOn(Service, 'findOne').mockResolvedValue(null);
    const create = jest.spyOn(Service, 'create').mockImplementation(async (d) => d);
    await admin.createService({ name: 'Dental', prefix: ' d ', rooms: ['Chair 1 ', ''], hacked: true });
    expect(create).toHaveBeenCalledWith({ name: 'Dental', prefix: 'D', rooms: ['Chair 1'] });
  });

  test('a letter already in use is refused, naming the service that has it', async () => {
    jest.spyOn(Service, 'findOne').mockResolvedValue({ name: 'Pharmacy' });
    await expect(admin.createService({ name: 'Physio', prefix: 'P', rooms: ['Room 1'] }))
      .rejects.toMatchObject({ statusCode: 409, message: 'The letter P is already used by Pharmacy' });
  });

  test('closing a queue', async () => {
    const opd = OPD();
    jest.spyOn(Service, 'findById').mockResolvedValue(opd);
    await admin.updateService('svc1', { isOpen: false });
    expect(opd.isOpen).toBe(false);
    expect(opd.save).toHaveBeenCalled();
    await expect(admin.updateService('svc1', { isOpen: 'no' })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('a room with a patient in it cannot be removed', async () => {
    const opd = OPD();
    jest.spyOn(Service, 'findById').mockResolvedValue(opd);
    const findOne = jest.spyOn(Ticket, 'findOne').mockResolvedValue({ room: 'Room 2', code: 'A-004' });
    await expect(admin.updateService('svc1', { rooms: ['Room 1'] }))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('Room 2 has a patient (A-004)') });
    expect(findOne.mock.calls[0][0]).toMatchObject({ status: 'called', room: { $in: ['Room 2'] } });
    expect(opd.rooms).toEqual(['Room 1', 'Room 2']);
    expect(opd.save).not.toHaveBeenCalled();
  });

  test('an empty room can be removed, and adding rooms needs no check', async () => {
    const opd = OPD();
    jest.spyOn(Service, 'findById').mockResolvedValue(opd);
    jest.spyOn(Ticket, 'findOne').mockResolvedValue(null);
    await admin.updateService('svc1', { rooms: ['Room 1'] });
    expect(opd.rooms).toEqual(['Room 1']);

    const check = jest.spyOn(Ticket, 'findOne');
    check.mockClear();
    await admin.updateService('svc1', { rooms: ['Room 1', 'Room 3'] });
    expect(check).not.toHaveBeenCalled();
  });

  test('the letter cannot change once tickets have gone out today', async () => {
    jest.spyOn(Service, 'findById').mockResolvedValue(OPD());
    jest.spyOn(Service, 'findOne').mockResolvedValue(null);
    jest.spyOn(Ticket, 'exists').mockResolvedValue({ _id: 't1' });
    await expect(admin.updateService('svc1', { prefix: 'O' })).rejects.toMatchObject({ statusCode: 409 });
    // Saving the same letter again (the form sends every field) is fine
    await expect(admin.updateService('svc1', { prefix: 'a', name: 'OPD' })).resolves.toBeTruthy();
  });

  test('only a service that never had a patient can be deleted', async () => {
    const opd = OPD();
    jest.spyOn(Service, 'findById').mockResolvedValue(opd);
    jest.spyOn(Ticket, 'exists').mockResolvedValueOnce({ _id: 't1' }).mockResolvedValueOnce(null);
    await expect(admin.deleteService('svc1')).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('Close it instead') });
    expect(opd.deleteOne).not.toHaveBeenCalled();
    await admin.deleteService('svc1');
    expect(opd.deleteOne).toHaveBeenCalled();
  });

  test('an unknown service is a 404', async () => {
    jest.spyOn(Service, 'findById').mockResolvedValue(null);
    await expect(admin.updateService('nope', {})).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('staff accounts', () => {
  const ME = { _id: 'me', name: 'Clinic Admin', role: 'admin', isActive: true };
  const stored = (fields) => {
    const s = doc({ _id: 's2', name: 'Mercy', phone: '+260970000002', role: 'receptionist', isActive: true, ...fields });
    jest.spyOn(Staff, 'findById').mockResolvedValue(s);
    return s;
  };

  test('a new account: phone tidied, password never sent back', async () => {
    jest.spyOn(Staff, 'findOne').mockResolvedValue(null);
    const create = jest.spyOn(Staff, 'create').mockImplementation(async (d) => ({ _id: 'new', isActive: true, ...d }));
    const s = await admin.createStaff({ name: 'Dr Phiri', phone: '097 555 1234', role: 'clinician', password: 'secret1' });
    expect(create).toHaveBeenCalledWith({ name: 'Dr Phiri', phone: '+260975551234', role: 'clinician', password: 'secret1' });
    expect(s).not.toHaveProperty('password');
    expect(s.phone).toBe('+260975551234');
  });

  test('bad input is refused before anything is saved', async () => {
    jest.spyOn(Staff, 'findOne').mockResolvedValue(null);
    const create = jest.spyOn(Staff, 'create');
    const base = { name: 'X', phone: '0975551234', role: 'clinician', password: 'secret1' };
    await expect(admin.createStaff({ ...base, password: '' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(admin.createStaff({ ...base, password: '123' })).rejects.toThrow('at least 6');
    await expect(admin.createStaff({ ...base, phone: '12345' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(admin.createStaff({ ...base, role: 'boss' })).rejects.toThrow('Role must be one of');
    expect(create).not.toHaveBeenCalled();
  });

  test('a phone number already in use is refused, naming who has it', async () => {
    jest.spyOn(Staff, 'findOne').mockResolvedValue({ name: 'Dr Banda' });
    await expect(admin.createStaff({ name: 'X', phone: '0970000003', role: 'clinician', password: 'secret1' }))
      .rejects.toMatchObject({ statusCode: 409, message: 'Dr Banda already uses this phone number' });
  });

  test('an empty password box keeps the old password; a new one is set', async () => {
    const s = stored();
    await admin.updateStaff('s2', { name: 'Mercy B.', password: '' }, ME);
    expect(s).not.toHaveProperty('password');
    expect(s.name).toBe('Mercy B.');
    await admin.updateStaff('s2', { password: 'newpass' }, ME);
    expect(s.password).toBe('newpass');   // hashed by the Staff model when saved
  });

  test('another account can be disabled or given a new role', async () => {
    const s = stored();
    await admin.updateStaff('s2', { isActive: false }, ME);
    expect(s.isActive).toBe(false);
    await admin.updateStaff('s2', { role: 'clinician', isActive: true }, ME);
    expect(s).toMatchObject({ role: 'clinician', isActive: true });
  });

  test('you cannot disable yourself or take away your own admin role', async () => {
    const me = stored({ ...ME });
    await expect(admin.updateStaff('me', { isActive: false }, ME)).rejects.toThrow('cannot disable your own account');
    await expect(admin.updateStaff('me', { role: 'clinician' }, ME)).rejects.toThrow('own admin role');
    expect(me.save).not.toHaveBeenCalled();
    // Saving your own form unchanged (role still admin) is fine
    await admin.updateStaff('me', { name: 'Head Admin', role: 'admin', isActive: true }, ME);
    expect(me.name).toBe('Head Admin');
  });

  test('the last admin cannot be disabled or demoted by anyone', async () => {
    stored({ _id: 'a2', name: 'Other Admin', role: 'admin' });
    const count = jest.spyOn(Staff, 'countDocuments').mockResolvedValue(1);
    await expect(admin.updateStaff('a2', { role: 'receptionist' }, ME)).rejects.toMatchObject({ statusCode: 409 });
    expect(count).toHaveBeenCalledWith({ role: 'admin', isActive: true });
    count.mockResolvedValue(2);
    await expect(admin.updateStaff('a2', { isActive: false }, ME)).resolves.toMatchObject({ isActive: false });
  });
});

describe('admin routes', () => {
  const as = (role) => {
    jest.spyOn(Staff, 'findById').mockResolvedValue({ _id: 's1', role, isActive: true });
    return { Authorization: `Bearer ${tokenFor('s1')}` };
  };
  const ROUTES = [
    ['get', '/api/admin/services'], ['post', '/api/admin/services'], ['patch', '/api/admin/services/abc'],
    ['delete', '/api/admin/services/abc'], ['get', '/api/admin/staff'], ['post', '/api/admin/staff'], ['patch', '/api/admin/staff/abc'],
  ];

  test.each(ROUTES)('%s %s needs a token', async (method, url) => {
    expect((await request(app)[method](url)).status).toBe(401);
  });

  test.each(ROUTES)('%s %s is refused to receptionists and clinicians', async (method, url) => {
    for (const role of ['receptionist', 'clinician']) {
      expect((await request(app)[method](url).set(as(role))).status).toBe(403);
    }
  });

  test('an admin gets the staff list, without passwords', async () => {
    const headers = as('admin');
    jest.spyOn(Staff, 'find').mockReturnValue({ sort: async () => [{ _id: 's1', name: 'A', phone: '+260970000001', role: 'admin', isActive: true, password: 'hash' }] });
    const res = await request(app).get('/api/admin/staff').set(headers);
    expect(res.status).toBe(200);
    expect(res.body.staff[0]).toMatchObject({ name: 'A', role: 'admin' });
    expect(res.body.staff[0]).not.toHaveProperty('password');
  });

  test('a disabled account is turned away on its next request', async () => {
    jest.spyOn(Staff, 'findById').mockResolvedValue({ _id: 's1', role: 'admin', isActive: false });
    const res = await request(app).get('/api/admin/staff').set('Authorization', `Bearer ${tokenFor('s1')}`);
    expect(res.status).toBe(401);
  });
});
