// Daily reports, built from the day's tickets.
// Tickets rather than QueueEvents: tickets already carry every timestamp, and
// the event log is only needed for "returned", which tickets do not record.
const Ticket = require('../models/Ticket');
const Service = require('../models/Service');
const QueueEvent = require('../models/QueueEvent');
const httpError = require('../utils/httpError');
const { dateKey } = require('../utils/queue');
const { summarize, buildServiceReport } = require('../utils/report');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// "2026-10-21" that is a real calendar day ("2026-02-30" is not)
const isValidDateKey = (s) => {
  if (!DATE_PATTERN.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

// One day's report for one service, or every service plus clinic-wide totals
const dailyReport = async ({ date, serviceId } = {}) => {
  const day = date || dateKey();
  if (!isValidDateKey(day)) throw httpError(400, 'Give the date as YYYY-MM-DD, for example 2026-10-21');

  let services;
  if (serviceId) {
    const service = await Service.findById(serviceId);
    if (!service) throw httpError(404, 'Service not found');
    services = [service];
  } else {
    services = await Service.find().sort({ order: 1, name: 1 });
  }

  const tickets = await Ticket.find({ dateKey: day, service: { $in: services.map((s) => s._id) } })
    .select('service status source priority room createdAt calledAt doneAt notifiedAt');
  const returns = tickets.length
    ? await QueueEvent.find({ action: 'returned', ticket: { $in: tickets.map((t) => t._id) } }).select('service')
    : [];

  const forService = (list, service) => list.filter((x) => String(x.service) === String(service._id));
  return {
    date: day,
    services: services.map((s) => buildServiceReport(s, forService(tickets, s), forService(returns, s).length)),
    totals: summarize(tickets, returns.length),
  };
};

module.exports = { dailyReport, isValidDateKey };
