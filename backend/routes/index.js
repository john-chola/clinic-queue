const express = require('express');
const auth = require('../controllers/authController');
const q = require('../controllers/queueController');
const reports = require('../controllers/reportController');
const admin = require('../controllers/adminController');
const { protect, restrictTo } = require('../middleware/auth');
const { joinLimiter, loginLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Attach the staff member when a valid token is sent, without requiring one
const optionalStaff = (req, res, next) => (req.headers.authorization ? protect(req, res, next) : next());

// Public: patients and the waiting-room display
router.get('/services', q.listServices);
router.get('/services/:id/queue', optionalStaff, q.getQueue);
router.post('/services/:id/tickets', joinLimiter, q.joinQueue);
router.get('/tickets/:publicId', q.getTicket);
router.post('/tickets/:publicId/cancel', q.cancelOwnTicket);

// Staff
router.post('/auth/login', loginLimiter, auth.login);
router.get('/auth/me', protect, auth.me);
router.post('/staff/services/:id/tickets', protect, restrictTo('admin', 'receptionist'), q.addWalkIn);
router.post('/staff/services/:id/next', protect, restrictTo('admin', 'clinician', 'receptionist'), q.callNext);
router.post('/staff/tickets/:id/transfer', protect, restrictTo('admin', 'clinician', 'receptionist'), q.transferTicket);
router.post('/staff/tickets/:id/:action', protect, q.ticketAction);
router.get('/staff/reports/daily', protect, restrictTo('admin'), reports.daily);

// Admin: services, rooms and staff accounts
const adminOnly = [protect, restrictTo('admin')];
router.get('/admin/services', adminOnly, admin.listServices);
router.post('/admin/services', adminOnly, admin.createService);
router.patch('/admin/services/:id', adminOnly, admin.updateService);
router.delete('/admin/services/:id', adminOnly, admin.deleteService);
router.get('/admin/staff', adminOnly, admin.listStaff);
router.post('/admin/staff', adminOnly, admin.createStaff);
router.patch('/admin/staff/:id', adminOnly, admin.updateStaff);

module.exports = router;
