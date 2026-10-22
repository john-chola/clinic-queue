// Admin: services, their rooms, and staff accounts. Every rule about what may be
// changed lives here; the routes only check that the caller is an admin.
const Service = require('../models/Service');
const Staff = require('../models/Staff');
const Ticket = require('../models/Ticket');
const httpError = require('../utils/httpError');
const { dateKey } = require('../utils/queue');
const { normalizePhone, isValidPhone } = require('../utils/phone');
const { pick, cleanRooms, checkBoolean } = require('../utils/admin');

const SERVICE_FIELDS = ['name', 'prefix', 'rooms', 'defaultMinutes', 'order', 'isOpen'];
const STAFF_FIELDS = ['name', 'phone', 'role', 'isActive', 'password'];
const ROLES = Staff.schema.path('role').enumValues;
const MIN_PASSWORD = 6;

const findOr404 = async (Model, id, what) => {
  const doc = await Model.findById(id);
  if (!doc) throw httpError(404, `${what} not found`);
  return doc;
};

// ── Services ────────────────────────────────────────────────

const listServices = () => Service.find().sort({ order: 1, name: 1 });

// Clean the form's fields; name, minutes and order are checked by the Service schema
const serviceFields = async (body, current) => {
  const data = pick(body, SERVICE_FIELDS);
  if ('rooms' in data) data.rooms = cleanRooms(data.rooms);
  if ('isOpen' in data) checkBoolean(data.isOpen, 'Open');
  if ('prefix' in data) {
    data.prefix = String(data.prefix ?? '').trim().toUpperCase();
    const taken = await Service.findOne({ prefix: data.prefix, _id: { $ne: current?._id } });
    if (taken) throw httpError(409, `The letter ${data.prefix} is already used by ${taken.name}`);
  }
  return data;
};

const createService = async (body) => Service.create(await serviceFields(body));

const updateService = async (id, body) => {
  const service = await findOr404(Service, id, 'Service');
  const data = await serviceFields(body, service);
  const today = dateKey();

  // Today's tickets are already printed with the old letter (A-012); a new letter mid-day
  // would number the queue A-012, B-013… Allow it once today's queue is empty of tickets.
  if (data.prefix && data.prefix !== service.prefix
      && await Ticket.exists({ service: service._id, dateKey: today })) {
    throw httpError(409, `Tickets have been given out as ${service.prefix} today. Change the letter tomorrow, before the first patient.`);
  }
  // A room with a patient in it cannot disappear from under them
  if (data.rooms) {
    const removed = service.rooms.filter((r) => !data.rooms.includes(r));
    const busy = removed.length
      && await Ticket.findOne({ service: service._id, dateKey: today, status: 'called', room: { $in: removed } });
    if (busy) throw httpError(409, `${busy.room} has a patient (${busy.code}). Finish with them before removing the room.`);
  }

  Object.assign(service, data);
  return service.save();
};

// Only a service that never had a patient can be deleted: the others are in the
// reports and the patients' ticket links. Closing it is the way to stop using it.
const deleteService = async (id) => {
  const service = await findOr404(Service, id, 'Service');
  if (await Ticket.exists({ service: service._id })) {
    throw httpError(409, `${service.name} has patient records, so it cannot be deleted. Close it instead.`);
  }
  await service.deleteOne();
  return service;
};

// ── Staff accounts ──────────────────────────────────────────

const publicStaff = (s) => ({ _id: s._id, name: s.name, phone: s.phone, role: s.role, isActive: s.isActive, createdAt: s.createdAt });

const listStaff = async () => (await Staff.find().sort({ isActive: -1, role: 1, name: 1 })).map(publicStaff);

const staffFields = async (body, current) => {
  const data = pick(body, STAFF_FIELDS);
  if ('role' in data && !ROLES.includes(data.role)) throw httpError(400, `Role must be one of: ${ROLES.join(', ')}`);
  if ('isActive' in data) checkBoolean(data.isActive, 'Active');
  if ('phone' in data) {
    data.phone = normalizePhone(data.phone);
    if (!isValidPhone(data.phone)) throw httpError(400, 'Enter a valid Zambian phone number, for example 0971234567');
    const taken = await Staff.findOne({ phone: data.phone, _id: { $ne: current?._id } });
    if (taken) throw httpError(409, `${taken.name} already uses this phone number`);
  }
  if (current && !data.password) delete data.password;   // editing: an empty box keeps the old password
  if ('password' in data && String(data.password).length < MIN_PASSWORD) {
    throw httpError(400, `The password needs at least ${MIN_PASSWORD} characters`);
  }
  return data;
};

const createStaff = async (body) => {
  const data = await staffFields(body);
  if (!data.password) throw httpError(400, 'Give the new account a password');
  return publicStaff(await Staff.create(data));
};

// `me` is the admin making the change. Two role checks keep the clinic from locking
// itself out: you cannot disable or demote yourself, and the last admin stays an admin.
const updateStaff = async (id, body, me) => {
  const staff = await findOr404(Staff, id, 'Staff member');
  const data = await staffFields(body, staff);
  const isSelf = String(staff._id) === String(me._id);
  const losesAdmin = (data.role !== undefined && data.role !== 'admin') || data.isActive === false;

  if (isSelf && data.isActive === false) throw httpError(400, 'You cannot disable your own account');
  if (isSelf && losesAdmin) throw httpError(400, 'You cannot take away your own admin role. Ask another admin.');
  if (staff.role === 'admin' && staff.isActive && losesAdmin
      && await Staff.countDocuments({ role: 'admin', isActive: true }) <= 1) {
    throw httpError(409, `${staff.name} is the only admin. Make someone else an admin first.`);
  }

  Object.assign(staff, data);
  // A disabled account is logged out at once: protect() reloads the staff member on every request
  return publicStaff(await staff.save());
};

module.exports = {
  listServices, createService, updateService, deleteService,
  listStaff, createStaff, updateStaff, publicStaff,
};
