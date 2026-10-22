// Pure queue helpers
const {
  dateKey, formatCode, averageServiceMinutes, estimateWaitMinutes, describeWait, compareQueueOrder,
} = require('../utils/queue');

const served = (...minutes) => minutes.map((m, i) => ({
  calledAt: new Date(Date.UTC(2026, 9, 14, 8, i * 20)),
  doneAt: new Date(Date.UTC(2026, 9, 14, 8, i * 20) + m * 60000),
}));

test('the queue day follows Lusaka time, not UTC', () => {
  expect(dateKey(new Date('2026-10-14T21:59:00Z'))).toBe('2026-10-14'); // 23:59 in Lusaka
  expect(dateKey(new Date('2026-10-14T22:01:00Z'))).toBe('2026-10-15'); // 00:01 in Lusaka
});

test('ticket codes are a letter and three digits', () => {
  expect(formatCode('A', 7)).toBe('A-007');
  expect(formatCode('P', 123)).toBe('P-123');
});

describe('average minutes per patient', () => {
  test('uses the service default until three patients have been seen', () => {
    expect(averageServiceMinutes([], 8)).toBe(8);
    expect(averageServiceMinutes(served(4, 6), 8)).toBe(8);
  });
  test('averages recent patients', () => {
    expect(averageServiceMinutes(served(4, 6, 8), 10)).toBe(6);
  });
  test('ignores a ticket left open for hours', () => {
    expect(averageServiceMinutes(served(4, 6, 8, 300), 10)).toBe(6);
  });
});

describe('wait estimate', () => {
  test('next in line waits about one patient', () => {
    expect(estimateWaitMinutes({ ahead: 0, avgMinutes: 6, activeRooms: 1 })).toBe(6);
  });
  test('two rooms halve the wait', () => {
    expect(estimateWaitMinutes({ ahead: 5, avgMinutes: 6, activeRooms: 1 })).toBe(36);
    expect(estimateWaitMinutes({ ahead: 5, avgMinutes: 6, activeRooms: 2 })).toBe(18);
  });
  test('never says zero minutes', () => {
    expect(estimateWaitMinutes({ ahead: 0, avgMinutes: 0.2, activeRooms: 3 })).toBe(1);
  });
  test('is described in plain words', () => {
    expect(describeWait(1)).toBe('about 2 minutes');
    expect(describeWait(25)).toBe('about 25 minutes');
    expect(describeWait(60)).toBe('about 1 hour');
    expect(describeWait(95)).toBe('about 1 hour 35 minutes');
    expect(describeWait(130)).toBe('about 2 hours 10 minutes');
  });
});

test('priority patients go first, then first come, first served', () => {
  const t = (code, priority, minute) => ({ code, priority, createdAt: new Date(2026, 9, 14, 8, minute) });
  const order = [t('A-001', false, 1), t('A-002', false, 2), t('A-003', true, 3), t('A-004', true, 4)]
    .sort(compareQueueOrder).map((x) => x.code);
  expect(order).toEqual(['A-003', 'A-004', 'A-001', 'A-002']);
});

test('a patient sent on from another service is placed by when they arrived at the clinic', () => {
  const t = (code, arrived, created) => ({ code, priority: false, arrivedAt: new Date(2026, 9, 14, 8, arrived), createdAt: new Date(2026, 9, 14, 8, created) });
  // L-003 was made last (minute 40) but the patient arrived at OPD at minute 5
  const order = [t('L-001', 10, 10), t('L-002', 20, 20), t('L-003', 5, 40)].sort(compareQueueOrder).map((x) => x.code);
  expect(order).toEqual(['L-003', 'L-001', 'L-002']);
});

test('tickets made before arrivedAt existed are ordered by createdAt', () => {
  const old = { code: 'A-001', priority: false, createdAt: new Date(2026, 9, 14, 8, 0) };
  const sentOn = { code: 'A-002', priority: false, arrivedAt: new Date(2026, 9, 14, 7, 0), createdAt: new Date(2026, 9, 14, 9, 0) };
  expect([old, sentOn].sort(compareQueueOrder).map((x) => x.code)).toEqual(['A-002', 'A-001']);
});
