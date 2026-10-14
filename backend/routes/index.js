const express = require('express');
const auth = require('../controllers/authController');
const q = require('../controllers/queueController');
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
router.post('/staff/tickets/:id/:action', protect, q.ticketAction);

module.exports = router;
