const jwt = require('jsonwebtoken');
const Staff = require('../models/Staff');

// Staff routes need a valid token: "Authorization: Bearer <token>"
exports.protect = async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ status: 'error', message: 'Please log in' });
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ status: 'error', message: 'Your session has expired. Please log in again.' });
    }
    const staff = await Staff.findById(decoded.id);
    if (!staff || !staff.isActive) return res.status(401).json({ status: 'error', message: 'Account not found or disabled' });
    req.staff = staff;
    next();
  } catch (err) { next(err); }
};

exports.restrictTo = (...roles) => (req, res, next) => {
  if (!roles.includes(req.staff.role)) {
    return res.status(403).json({ status: 'error', message: 'You do not have permission to do this' });
  }
  next();
};
