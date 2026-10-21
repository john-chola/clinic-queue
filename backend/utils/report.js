// Pure daily-report helpers: no database, so they are easy to unit-test.
const { TIME_ZONE } = require('./queue');

const STATUSES = ['waiting', 'called', 'done', 'no_show', 'cancelled'];

const minutesBetween = (from, to) => (new Date(to) - new Date(from)) / 60000;
const round1 = (n) => Math.round(n * 10) / 10;

// Nearest-rank percentile of an already sorted list
const percentile = (sorted, p) => sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];

// Median, 90th percentile and max, in minutes. Medians rather than averages,
// so one ticket left open over lunch does not distort the day.
const stats = (values) => {
  const sorted = values.filter((m) => m >= 0).sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, median: null, p90: null, max: null };
  return {
    count: sorted.length,
    median: round1(percentile(sorted, 50)),
    p90: round1(percentile(sorted, 90)),
    max: round1(sorted[sorted.length - 1]),
  };
};

// 0–23, the hour on the clinic's clock
const lusakaHour = (date) =>
  Number(new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', hourCycle: 'h23' }).format(new Date(date)));

// Wait time is join → called. A patient who missed the call and returned has
// calledAt overwritten by the second call, so their wait includes the time missed.
const waitMinutes = (t) => (t.calledAt ? minutesBetween(t.createdAt, t.calledAt) : null);
const serviceMinutes = (t) => (t.status === 'done' && t.calledAt && t.doneAt ? minutesBetween(t.calledAt, t.doneAt) : null);
const present = (v) => v !== null;

// Counts and timings for one day's tickets (one service, or the whole clinic).
// `returned` is the number of "returned" queue events, which tickets do not record.
const summarize = (tickets, returned = 0) => {
  const outcomes = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const bySource = { self: 0, reception: 0 };
  const hours = new Map();
  for (const t of tickets) {
    outcomes[t.status] += 1;
    bySource[t.source] += 1;
    const h = lusakaHour(t.createdAt);
    hours.set(h, (hours.get(h) || 0) + 1);
  }
  return {
    joined: tickets.length,
    bySource,
    priority: tickets.filter((t) => t.priority).length,   // includes patients who returned after a no-show
    outcomes,
    returned,
    waitMinutes: stats(tickets.map(waitMinutes).filter(present)),
    serviceMinutes: stats(tickets.map(serviceMinutes).filter(present)),
    byHour: [...hours].sort((a, b) => a[0] - b[0]).map(([hour, joined]) => ({ hour, joined })),
    smsSent: tickets.filter((t) => t.notifiedAt).length,
  };
};

// Patients finished in each room, busiest first
const byRoom = (tickets) => {
  const rooms = new Map();
  for (const t of tickets) {
    const m = serviceMinutes(t);
    if (m === null || !t.room) continue;
    if (!rooms.has(t.room)) rooms.set(t.room, []);
    rooms.get(t.room).push(m);
  }
  return [...rooms]
    .map(([room, minutes]) => ({ room, served: minutes.length, medianServiceMinutes: stats(minutes).median }))
    .sort((a, b) => b.served - a.served || a.room.localeCompare(b.room));
};

const buildServiceReport = (service, tickets, returned = 0) => ({
  service: { _id: service._id, name: service.name, prefix: service.prefix },
  ...summarize(tickets, returned),
  byRoom: byRoom(tickets),
});

module.exports = { stats, lusakaHour, summarize, byRoom, buildServiceReport };
