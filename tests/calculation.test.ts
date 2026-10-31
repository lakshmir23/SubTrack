import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, amountInput, MAX_MINOR } from '../shared/money.js';
import { multiplyMinor, sumMinor, taxMinor } from '../server/money.js';
import { addDays, assertDate, businessDate, periodBoundary, periodIndex } from '../server/calendar.js';

test('P2 money: decimal parsing, multiplication and half-up tax remain exact and bounded', () => {
  assert.equal(parseAmount('1560.00'), 156000);
  assert.equal(parseAmount('-560', true), -56000);
  assert.equal(parseAmount('000.01'), 1);
  assert.equal(amountInput(-56001), '-560.01');
  assert.equal(multiplyMinor(156000, 2), 312000);
  assert.equal(taxMinor(280800, 1000), 28080);
  assert.equal(taxMinor(5, 1000), 1);
  assert.equal(taxMinor(4, 1000), 0);
  assert.equal(sumMinor([280800, 28080]), 308880);
  for (const value of ['1.001', '1e3', 'NaN', '-1', '', '10000000000.01']) assert.throws(() => parseAmount(value));
  assert.throws(() => multiplyMinor(MAX_MINOR, 2));
  assert.throws(() => multiplyMinor(1, 0.1));
  assert.throws(() => sumMinor([MAX_MINOR, 1]));
});
test('P2 calendar: original anchors recover month-end and leap-day in every cadence', () => {
  assert.equal(periodBoundary('2026-01-31', 'monthly', 1), '2026-02-28');
  assert.equal(periodBoundary('2026-01-31', 'monthly', 2), '2026-03-31');
  assert.equal(periodBoundary('2024-02-29', 'yearly', 1), '2025-02-28');
  assert.equal(periodBoundary('2024-02-29', 'yearly', 4), '2028-02-29');
  assert.equal(periodBoundary('2026-12-31', 'daily', 1), '2027-01-01');
  assert.equal(periodBoundary('2026-12-31', 'weekly', 1), '2027-01-07');
  assert.equal(periodIndex('2026-01-31', 'monthly', '2026-03-31'), 2);
  assert.equal(periodIndex('2024-02-29', 'yearly', '2028-02-29'), 4);
  assert.throws(() => periodIndex('2026-01-31', 'monthly', '2026-03-28'));
  assert.throws(() => assertDate('2026-02-29'));
  assert.throws(() => assertDate('2026-13-01'));
  assert.equal(addDays('2026-11-01', 7), '2026-11-08');
  assert.equal(businessDate(new Date('2026-10-31T18:30:00Z')), '2026-11-01');
});
