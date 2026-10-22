const reports = require('../services/reportService');

// GET /api/staff/reports/daily?date=YYYY-MM-DD: admin only. date defaults to today (Lusaka time).
exports.daily = async (req, res, next) => {
  try {
    res.json({ status: 'success', report: await reports.dailyReport(req.query.date) });
  } catch (err) { next(err); }
};
