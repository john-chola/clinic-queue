const rateLimit = require('express-rate-limit');

const options = (max, windowMinutes, message) => ({
  windowMs: windowMinutes * 60 * 1000, max, standardHeaders: true, legacyHeaders: false,
  message: { status: 'error', message },
});

// A patient joining from their phone: stops one person filling the queue with fake tickets
exports.joinLimiter = rateLimit(options(20, 10, 'Too many tickets from this device. Please ask at reception.'));
exports.loginLimiter = rateLimit(options(10, 15, 'Too many login attempts. Try again in 15 minutes.'));
