const reports = require('../services/reportService');

// GET /api/staff/reports/daily?date=YYYY-MM-DD&service=<id>: admin only.
// date defaults to today (Lusaka time); leave out service for every service plus totals.
exports.daily = async (req, res, next) => {
  try {
    const { date, service } = req.query;
    res.json({ status: 'success', report: await reports.dailyReport({ date, serviceId: service }) });
  } catch (err) { next(err); }
};
