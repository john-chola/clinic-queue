const jwt = require('jsonwebtoken');
const Staff = require('../models/Staff');
const { normalizePhone } = require('../utils/phone');

const publicStaff = (s) => ({ _id: s._id, name: s.name, phone: s.phone, role: s.role });

// POST /api/auth/login  { phone, password }
exports.login = async (req, res, next) => {
  try {
    const { phone, password } = req.body || {};
    if (!phone || !password) return res.status(400).json({ status: 'error', message: 'Phone and password are required' });
    const staff = await Staff.findOne({ phone: normalizePhone(phone) }).select('+password');
    if (!staff || !(await staff.comparePassword(password))) {
      return res.status(401).json({ status: 'error', message: 'Wrong phone number or password' });
    }
    if (!staff.isActive) return res.status(403).json({ status: 'error', message: 'This account is disabled' });
    const token = jwt.sign({ id: staff._id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '12h' });
    res.json({ status: 'success', token, staff: publicStaff(staff) });
  } catch (err) { next(err); }
};

// GET /api/auth/me
exports.me = (req, res) => res.json({ status: 'success', staff: publicStaff(req.staff) });
