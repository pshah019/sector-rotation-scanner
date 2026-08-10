// Period / range vocabulary, mirroring the upstream RRG chart exactly.
//
// Read off the live provider UI on 2026-08-10 by driving its own dropdowns:
// every period exposes a different, fixed set of ranges. The data service takes
// `p` (d | w | m | q, or a bar size in minutes) and `m` (a whole number of
// MONTHS). Sub-month ranges have no `m` representation, so those are fetched as
// one month and trimmed by calendar days after the fact.

export const PERIODS = [
  { value: 'quarterly', label: 'Quarterly', p: 'q', disabled: true },
  { value: 'monthly', label: 'Monthly', p: 'm' },
  { value: 'weekly', label: 'Weekly', p: 'w' },
  { value: 'daily', label: 'Daily', p: 'd' },
  { value: 'onehundredninetyfiveminutes', label: '195 min (2 bars/day)', p: '195' },
  { value: 'onehundredthirtyminutes', label: '130 min (3 bars/day)', p: '130' },
  { value: 'onehundredtwentyminutes', label: '120 min (2 hours)', p: '120' },
  { value: 'seventyeightminutes', label: '78 min (5 bars/day)', p: '78' },
  { value: 'sixtyfiveminutes', label: '65 min (6 bars/day)', p: '65' },
  { value: 'sixtyminutes', label: '60 min', p: '60' },
  { value: 'thirtynineminutes', label: '39 min (10 bars/day)', p: '39' },
  { value: 'thirtyminutes', label: '30 min', p: '30' },
  { value: 'fifteenminutes', label: '15 min', p: '15' },
  { value: 'tenminutes', label: '10 min', p: '10' },
  { value: 'fiveminutes', label: '5 min', p: '5' },
];

export const RANGES = {
  oneday: { label: '1 day', days: 1 },
  twodays: { label: '2 days', days: 2 },
  threedays: { label: '3 days', days: 3 },
  fivedays: { label: '5 days', days: 5 },
  tendays: { label: '10 days', days: 10 },
  threeweeks: { label: '3 Weeks', days: 21 },
  onemonth: { label: '1 month', months: 1 },
  threemonths: { label: '3 months', months: 3 },
  sixmonths: { label: '6 months', months: 6 },
  oneyear: { label: '1 year', months: 12 },
  threeyears: { label: '3 years', months: 36 },
  fiveyears: { label: '5 years', months: 60 },
  tenyears: { label: '10 years', months: 120 },
};

// Which ranges each period allows, and in what order — the first entry is the
// upstream default for that period.
export const PERIOD_RANGES = {
  quarterly: ['fiveyears', 'tenyears'],
  monthly: ['fiveyears', 'tenyears'],
  weekly: ['oneyear', 'threeyears', 'fiveyears', 'tenyears'],
  daily: ['threemonths', 'sixmonths', 'oneyear', 'threeyears', 'fiveyears', 'tenyears'],
  onehundredninetyfiveminutes: ['tendays', 'threeweeks', 'onemonth', 'threemonths'],
  onehundredthirtyminutes: ['fivedays', 'tendays', 'threeweeks', 'onemonth'],
  onehundredtwentyminutes: ['tendays', 'threeweeks', 'onemonth', 'threemonths'],
  seventyeightminutes: ['tendays', 'threeweeks', 'onemonth', 'threemonths'],
  sixtyfiveminutes: ['tendays', 'threeweeks', 'onemonth', 'threemonths'],
  sixtyminutes: ['tendays', 'threeweeks', 'onemonth', 'threemonths'],
  thirtynineminutes: ['fivedays', 'tendays', 'threeweeks', 'onemonth'],
  thirtyminutes: ['fivedays', 'tendays', 'threeweeks', 'onemonth'],
  fifteenminutes: ['threedays', 'fivedays', 'tendays', 'threeweeks'],
  tenminutes: ['twodays', 'threedays', 'fivedays', 'tendays'],
  fiveminutes: ['oneday', 'twodays', 'threedays', 'fivedays'],
};

export const DEFAULT_PERIOD = 'daily';
export const DEFAULT_RANGE = 'threemonths';

const BY_VALUE = Object.fromEntries(PERIODS.map((p) => [p.value, p]));
// Legacy single-letter periods, so older links keep working.
const LEGACY = { d: 'daily', w: 'weekly', m: 'monthly', q: 'quarterly' };

/**
 * Resolve a (period, range) pair into what the data service needs.
 * Returns { period, range, p, months, trimDays } where trimDays is null for
 * month-based ranges and a calendar-day count for the short ones.
 */
export function resolveWindow(periodToken, rangeToken, legacyMonths) {
  let period = LEGACY[periodToken] || periodToken;
  if (!BY_VALUE[period] || BY_VALUE[period].disabled) period = DEFAULT_PERIOD;

  const allowed = PERIOD_RANGES[period] || PERIOD_RANGES[DEFAULT_PERIOD];
  let range = rangeToken;

  // No range given: fall back to a legacy month count if it maps to a range
  // this period allows, otherwise the period's own default.
  if (!range && legacyMonths) {
    range = allowed.find((r) => RANGES[r].months === Number(legacyMonths));
  }
  if (!range || !allowed.includes(range)) range = allowed[0];

  const spec = RANGES[range];
  return {
    period,
    range,
    p: BY_VALUE[period].p,
    months: spec.months || 1, // short ranges are fetched as a month, then trimmed
    trimDays: spec.days || null,
    label: `${BY_VALUE[period].label} · ${spec.label}`,
  };
}

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).json({
    ok: true,
    periods: PERIODS,
    ranges: RANGES,
    periodRanges: PERIOD_RANGES,
    defaults: { period: DEFAULT_PERIOD, range: DEFAULT_RANGE },
  });
}
