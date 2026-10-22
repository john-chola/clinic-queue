// Pure daily-report helpers: no database, so they are easy to unit-test.

const FIRST_HOUR = 6;    // the chart runs 06:00–20:00 on the clinic's clock
const LAST_HOUR = 20;

const COUNTS = ['joined', 'waiting', 'called', 'served', 'noShows', 'cancelled', 'priority'];

// "2026-10-21" that is a real calendar day ("2026-02-30" is not)
const isValidDateKey = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

// 754000 → 12.6; null (nobody to average) stays null
const msToMinutes = (ms) => (ms === null || ms === undefined ? null : Math.round(ms / 6000) / 10);

// No-shows as a percentage of patients called, to 1 decimal place. 0 when nobody was called.
const noShowRate = (noShows, called) => (called ? Math.round((noShows / called) * 1000) / 10 : 0);

// [{ hour: 8, joined: 3 }] → every hour 06–20, with 0 where nobody joined.
// Hours outside that range are kept if anyone joined then, so no patient goes missing.
const fillHours = (rows) => {
  const joined = new Map(rows.map((r) => [r.hour, r.joined]));
  const hours = new Set(rows.map((r) => r.hour));
  for (let h = FIRST_HOUR; h <= LAST_HOUR; h += 1) hours.add(h);
  return [...hours].sort((a, b) => a - b).map((hour) => ({ hour, joined: joined.get(hour) || 0 }));
};

// Average of averages, weighted by how many tickets each one covers
const weightedAvg = (rows, avgKey, countKey) => {
  const n = rows.reduce((sum, r) => sum + (r[avgKey] === null ? 0 : r[countKey]), 0);
  return n ? rows.reduce((sum, r) => sum + (r[avgKey] === null ? 0 : r[avgKey] * r[countKey]), 0) / n : null;
};

// Raw counts and millisecond averages → the numbers people read
const tidy = (row) => ({
  ...Object.fromEntries(COUNTS.map((k) => [k, row[k] || 0])),
  noShowRate: noShowRate(row.noShows || 0, row.called || 0),
  avgWaitMinutes: msToMinutes(row.avgWaitMs),
  avgServiceMinutes: msToMinutes(row.avgServiceMs),
});

// Put the aggregation results together: one entry per service (including quiet ones), plus clinic totals.
// `totals` are the per-service $group rows, `hours` the { service, hour, joined } rows.
const buildDailyReport = ({ date, services, totals, hours }) => {
  const sameService = (id) => (row) => String(row.service) === String(id);
  const empty = { avgWaitMs: null, avgServiceMs: null };

  const perService = services.map((s) => {
    const row = totals.find(sameService(s._id)) || empty;
    return {
      service: { _id: s._id, name: s.name, prefix: s.prefix },
      ...tidy(row),
      byHour: fillHours(hours.filter(sameService(s._id))),
    };
  });

  const clinicHours = new Map();
  for (const r of hours) clinicHours.set(r.hour, (clinicHours.get(r.hour) || 0) + r.joined);

  const clinic = {
    ...Object.fromEntries(COUNTS.map((k) => [k, totals.reduce((sum, r) => sum + (r[k] || 0), 0)])),
    avgWaitMs: weightedAvg(totals, 'avgWaitMs', 'called'),
    avgServiceMs: weightedAvg(totals, 'avgServiceMs', 'served'),
  };

  return {
    date,
    totals: {
      ...tidy(clinic),
      byHour: fillHours([...clinicHours].map(([hour, joined]) => ({ hour, joined }))),
    },
    services: perService,
  };
};

module.exports = { FIRST_HOUR, LAST_HOUR, isValidDateKey, msToMinutes, noShowRate, fillHours, weightedAvg, buildDailyReport };
