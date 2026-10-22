// Pure queue helpers: no database, so they are easy to unit-test.

const TIME_ZONE = 'Africa/Lusaka';
const RECENT_SAMPLE = 10;            // average over the last 10 patients served
const MIN_MINUTES = 1;
const MAX_MINUTES = 60;

// "2026-10-14" for the clinic's local day, so numbering restarts at midnight in Lusaka
const dateKey = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

// ("A", 7) → "A-007"
const formatCode = (prefix, number) => `${prefix}-${String(number).padStart(3, '0')}`;

// Average minutes per patient from recent [calledAt, doneAt] pairs.
// Falls back to the service default until there is enough data, and
// ignores outliers (a ticket left open over lunch should not wreck the estimate).
const averageServiceMinutes = (served, fallback = 5) => {
  const minutes = served
    .filter((t) => t.calledAt && t.doneAt)
    .slice(0, RECENT_SAMPLE)
    .map((t) => (new Date(t.doneAt) - new Date(t.calledAt)) / 60000)
    .filter((m) => m > 0 && m <= MAX_MINUTES * 2);
  if (minutes.length < 3) return fallback;
  const avg = minutes.reduce((a, b) => a + b, 0) / minutes.length;
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, avg));
};

// Minutes until this patient is called: everyone ahead, plus the patient
// currently in the room, shared across the rooms that are working.
const estimateWaitMinutes = ({ ahead, avgMinutes, activeRooms = 1 }) => {
  const rooms = Math.max(1, activeRooms);
  return Math.max(1, Math.round(((ahead + 1) * avgMinutes) / rooms));
};

// Human-friendly wording for the estimate
const describeWait = (minutes) => {
  if (minutes <= 2) return 'about 2 minutes';
  if (minutes < 60) return `about ${minutes} minutes`;
  const h = Math.floor(minutes / 60);
  const m = Math.round((minutes % 60) / 5) * 5;
  return `about ${h} hour${h > 1 ? 's' : ''}${m ? ` ${m} minutes` : ''}`;
};

// When the patient first arrived at the clinic (tickets made before arrivedAt existed fall back to createdAt)
const arrivalTime = (t) => new Date(t.arrivedAt || t.createdAt);

// Queue order: priority patients first, then by arrival at the clinic, so a patient
// sent on from another service keeps their place. Ties go to the older ticket.
const compareQueueOrder = (a, b) =>
  (b.priority === true) - (a.priority === true)
  || arrivalTime(a) - arrivalTime(b)
  || new Date(a.createdAt) - new Date(b.createdAt);

module.exports = {
  TIME_ZONE, RECENT_SAMPLE, dateKey, formatCode, averageServiceMinutes, estimateWaitMinutes, describeWait, arrivalTime, compareQueueOrder,
};
