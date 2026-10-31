import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateMinor, discountMinor, sumMinor, taxMinor } from '../server/money.js';
import { MAX_MINOR } from '../shared/money.js';

test('P4: fixed discounts cap at the eligible base and allocate remainders by stable line ID', () => {
  const lines = [{ id: 'c', base: 101 }, { id: 'a', base: 101 }, { id: 'b', base: 101 }];
  const allocated = allocateMinor(discountMinor(303, 'fixed', 100), lines);
  assert.equal(allocated.get('a'), 34);
  assert.equal(allocated.get('b'), 33);
  assert.equal(allocated.get('c'), 33);
  assert.equal(sumMinor([...allocated.values()]), 100);
  assert.deepEqual([...allocateMinor(303, lines).values()], [101, 101, 101]);
  assert.equal(discountMinor(303, 'fixed', 99999), 303);
  const weighted = allocateMinor(101, [{ id: 'a', base: 100 }, { id: 'b', base: 300 }]);
  assert.equal(weighted.get('a'), 25);
  assert.equal(weighted.get('b'), 76);
});

test('P4: a percentage is rounded once on the eligible scope and never exaggerated across tiny lines', () => {
  assert.equal(discountMinor(2, 'percentage', 5000), 1);
  const shares = allocateMinor(1, [{ id: 'b', base: 1 }, { id: 'a', base: 1 }]);
  assert.equal(shares.get('a'), 1);
  assert.equal(shares.get('b'), 0);
  assert.equal(sumMinor([...shares.values()]), 1);
  assert.equal(discountMinor(312000, 'percentage', 1000), 31200);
  const taxable = 312000 - 31200;
  assert.equal(taxable + taxMinor(taxable, 1000), 308880);
  assert.equal(discountMinor(12345, 'percentage', 10000), 12345);
  assert.equal(discountMinor(MAX_MINOR, 'percentage', 10000), MAX_MINOR);
});

test('P4: zero allocations are valid; invalid bases, duplicate lines and excessive values fail safely', () => {
  assert.deepEqual([...allocateMinor(0, [{ id: 'a', base: 0 }])], [['a', 0]]);
  assert.deepEqual([...allocateMinor(0, [])], []);
  assert.throws(() => allocateMinor(2, [{ id: 'a', base: 1 }]));
  assert.throws(() => allocateMinor(1, [{ id: 'a', base: 1 }, { id: 'a', base: 1 }]));
  assert.throws(() => allocateMinor(1, [{ id: 'a', base: -1 }]));
  assert.throws(() => discountMinor(100, 'percentage', 10001));
  assert.throws(() => discountMinor(100, 'fixed', -1));
});
