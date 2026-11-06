/**
 * Date helpers — design §0 "Conventions":
 * API dates are `YYYY-MM-DD`, months are `YYYY-MM`, stored as `Date` at UTC midnight.
 *
 * Why UTC midnight? An expense has a calendar date, not a moment in time. Storing every date
 * at 00:00Z means "2026-11-06" is always the same value, whatever the server's timezone.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** True for a real calendar date in `YYYY-MM-DD` form (rejects 2026-02-30). */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = parseIsoDate(value);
  return !Number.isNaN(d.getTime()) && toIsoDate(d) === value;
}

/** `YYYY-MM-DD` → Date at UTC midnight. */
export function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Date (UTC midnight) → `YYYY-MM-DD`. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Today's calendar date in the **server's local timezone** (the user's laptop, IST).
 * Used for "date cannot be in the future" — using UTC here would reject today's
 * expenses between 00:00 and 05:30 IST.
 */
export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Current month as `YYYY-MM` (server local time). */
export function currentMonth(): string {
  return todayIso().slice(0, 7);
}

/** `YYYY-MM` → `{ start, end }` where `end` is exclusive (first day of next month). */
export function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

/** Moves a `YYYY-MM` month by `delta` months: addMonths('2026-01', -1) → '2025-12'. */
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** Number of days in a `YYYY-MM` month. */
export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Adds whole days to a UTC-midnight date. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}
