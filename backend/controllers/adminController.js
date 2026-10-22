const admin = require('../services/adminService');
const { emitQueueChanged } = require('../utils/socket');

// Every route here is admin only (see routes/index.js).
// A changed service is announced like a queue change, so the join page, the
// waiting-room display and the staff desks pick up a new name, room or "closed" at once.

// GET /api/admin/services: every service, open or closed
exports.listServices = async (req, res, next) => {
  try {
    res.json({ status: 'success', services: await admin.listServices() });
  } catch (err) { next(err); }
};

// POST /api/admin/services  { name, prefix, rooms, defaultMinutes?, order?, isOpen? }
exports.createService = async (req, res, next) => {
  try {
    const service = await admin.createService(req.body);
    emitQueueChanged(service._id);
    res.status(201).json({ status: 'success', service, message: `${service.name} added` });
  } catch (err) { next(err); }
};

// PATCH /api/admin/services/:id  any of the fields above; { isOpen } opens or closes the queue
exports.updateService = async (req, res, next) => {
  try {
    const service = await admin.updateService(req.params.id, req.body);
    emitQueueChanged(service._id);
    res.json({ status: 'success', service, message: `${service.name} saved` });
  } catch (err) { next(err); }
};

// DELETE /api/admin/services/:id: only a service that never had a patient
exports.deleteService = async (req, res, next) => {
  try {
    const service = await admin.deleteService(req.params.id);
    emitQueueChanged(service._id);
    res.json({ status: 'success', message: `${service.name} deleted` });
  } catch (err) { next(err); }
};

// GET /api/admin/staff
exports.listStaff = async (req, res, next) => {
  try {
    res.json({ status: 'success', staff: await admin.listStaff() });
  } catch (err) { next(err); }
};

// POST /api/admin/staff  { name, phone, role, password }
exports.createStaff = async (req, res, next) => {
  try {
    const staff = await admin.createStaff(req.body);
    res.status(201).json({ status: 'success', staff, message: `Account made for ${staff.name}` });
  } catch (err) { next(err); }
};

// PATCH /api/admin/staff/:id  { name?, phone?, role?, isActive?, password? }
exports.updateStaff = async (req, res, next) => {
  try {
    const staff = await admin.updateStaff(req.params.id, req.body, req.staff);
    res.json({ status: 'success', staff, message: `${staff.name} saved` });
  } catch (err) { next(err); }
};
