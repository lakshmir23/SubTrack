import { DomainError } from './errors.js';

export type Cadence = 'daily' | 'weekly' | 'monthly' | 'yearly';
export function businessDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (kind: string) => parts.find(item => item.type === kind)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function assertDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31') throw new DomainError(400, 'INVALID_DATE', 'Use a valid calendar date in YYYY-MM-DD format.');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new DomainError(400, 'INVALID_DATE', 'This calendar date does not exist.');
  return value;
}
export function addDays(value: string, days: number): string {
  assertDate(value);
  if (!Number.isSafeInteger(days)) throw new DomainError(400, 'INVALID_PERIOD', 'Use a whole number of days.');
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  if (!Number.isFinite(date.getTime())) throw new DomainError(400, 'INVALID_DATE', 'The calculated date is outside the supported range.');
  const output = date.toISOString().slice(0, 10);
  return assertDate(output);
}
export function periodBoundary(anchor: string, cadence: Cadence, index: number): string {
  assertDate(anchor);
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(cadence)) throw new DomainError(400, 'INVALID_PERIOD', 'Choose daily, weekly, monthly or yearly billing.');
  if (!Number.isInteger(index) || index < 0 || index > 100000) throw new DomainError(400, 'INVALID_PERIOD', 'Use a supported nonnegative whole period index.');
  if (cadence === 'daily' || cadence === 'weekly') return addDays(anchor, index * (cadence === 'weekly' ? 7 : 1));
  const [year, month, day] = anchor.split('-').map(Number);
  const absoluteMonth = year * 12 + month - 1 + index * (cadence === 'yearly' ? 12 : 1);
  const targetYear = Math.floor(absoluteMonth / 12);
  const targetMonth = absoluteMonth % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return assertDate(`${String(targetYear).padStart(4, '0')}-${String(targetMonth + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`);
}
export function periodIndex(anchor: string, cadence: Cadence, boundary: string): number {
  assertDate(boundary);
  if (boundary < anchor) throw new DomainError(400, 'INVALID_TERM', 'Expiry must be after the subscription start.');
  const start = new Date(`${assertDate(anchor)}T00:00:00Z`);
  const end = new Date(`${boundary}T00:00:00Z`);
  let index: number;
  if (cadence === 'daily' || cadence === 'weekly') index = (end.getTime() - start.getTime()) / 86400000 / (cadence === 'weekly' ? 7 : 1);
  else index = ((end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth()) / (cadence === 'yearly' ? 12 : 1);
  if (!Number.isInteger(index) || periodBoundary(anchor, cadence, index) !== boundary) throw new DomainError(400, 'UNALIGNED_TERM', 'Expiry must be a full billing-period boundary. Partial periods are not supported.');
  return index;
}
