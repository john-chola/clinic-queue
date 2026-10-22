// Daily reports, worked out inside MongoDB with aggregation pipelines.
// The database does the counting and averaging next to the data and sends back
// one small row per service (and per hour), instead of every ticket of the day.
const Ticket = require('../models/Ticket');
const Service = require('../models/Service');
const httpError = require('../utils/httpError');
const { TIME_ZONE, dateKey } = require('../utils/queue');
const { isValidDateKey, buildDailyReport } = require('../utils/report');

const countWhere = (cond) => ({ $sum: { $cond: [cond, 1, 0] } });
const statusIs = (status) => ({ $eq: ['$status', status] });

// Counts and average times for each service
const totalsPipeline = (day) => [
  { $match: { dateKey: day } },
  {
    $group: {
      _id: '$service',
      joined: { $sum: 1 },
      waiting: countWhere(statusIs('waiting')),
      called: countWhere({ $ifNull: ['$calledAt', false] }),   // everyone who was called, whatever happened next
      served: countWhere(statusIs('done')),
      noShows: countWhere(statusIs('no_show')),
      cancelled: countWhere(statusIs('cancelled')),
      priority: countWhere('$priority'),
      // Milliseconds. $subtract gives null when calledAt is missing, and $avg skips nulls,
      // so these are null when nobody was called (or finished).
      avgWaitMs: { $avg: { $subtract: ['$calledAt', '$createdAt'] } },
      avgServiceMs: { $avg: { $cond: [statusIs('done'), { $subtract: ['$doneAt', '$calledAt'] }, null] } },
    },
  },
  { $project: { _id: 0, service: '$_id', joined: 1, waiting: 1, called: 1, served: 1, noShows: 1, cancelled: 1, priority: 1, avgWaitMs: 1, avgServiceMs: 1 } },
];

// Patients joining in each hour, on the clinic's clock (UTC would put everything 2 hours early)
const hoursPipeline = (day) => [
  { $match: { dateKey: day } },
  {
    $group: {
      _id: { service: '$service', hour: { $hour: { date: '$createdAt', timezone: TIME_ZONE } } },
      joined: { $sum: 1 },
    },
  },
  { $project: { _id: 0, service: '$_id.service', hour: '$_id.hour', joined: 1 } },
];

// One day's report: every service plus clinic-wide totals. date defaults to today in Lusaka.
const dailyReport = async (date) => {
  const day = date || dateKey();
  if (!isValidDateKey(day)) throw httpError(400, 'Give the date as YYYY-MM-DD, for example 2026-10-21');

  const [services, totals, hours] = await Promise.all([
    Service.find().sort({ order: 1, name: 1 }),
    Ticket.aggregate(totalsPipeline(day)),
    Ticket.aggregate(hoursPipeline(day)),
  ]);
  return buildDailyReport({ date: day, services, totals, hours });
};

module.exports = { dailyReport, totalsPipeline, hoursPipeline };
