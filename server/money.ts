import { MAX_MINOR } from '../shared/money.js';
import { DomainError } from './errors.js';

export function checkedMinor(value: bigint): number {
  if (value < 0n || value > BigInt(MAX_MINOR)) throw new DomainError(400, 'AMOUNT_RANGE', 'The calculated amount is outside the supported range. Adjust the price or quantity.');
  return Number(value);
}
export function multiplyMinor(unitPrice: number, quantity: number): number {
  if (!Number.isSafeInteger(unitPrice) || unitPrice < 0 || !Number.isSafeInteger(quantity) || quantity < 1) throw new DomainError(400, 'INVALID_AMOUNT', 'Use a nonnegative unit price and a positive whole quantity.');
  return checkedMinor(BigInt(unitPrice) * BigInt(quantity));
}
export function sumMinor(values: number[]): number {
  if (values.some(value => !Number.isSafeInteger(value) || value < 0)) throw new DomainError(400, 'INVALID_AMOUNT', 'Amounts must be nonnegative integer minor units.');
  return checkedMinor(values.reduce((sum, value) => sum + BigInt(value), 0n));
}
export function taxMinor(base: number, rateBps: number): number {
  if (!Number.isSafeInteger(base) || base < 0 || !Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10000) throw new DomainError(400, 'INVALID_TAX', 'Use a valid base amount and a tax rate from 0 to 100 percent.');
  return checkedMinor((BigInt(base) * BigInt(rateBps) + 5000n) / 10000n);
}

// Compute one eligible-scope discount, then allocate it. Rounding a percentage
// independently on tiny lines would over-discount (two 1-paisa lines at 50%).
export function discountMinor(base: number, kind: 'fixed' | 'percentage', value: number): number {
  if (!Number.isSafeInteger(base) || base < 0 || base > MAX_MINOR || !Number.isSafeInteger(value) || value < 0) throw new DomainError(400, 'INVALID_DISCOUNT', 'Use nonnegative exact discount values.');
  if (kind === 'fixed') {
    if (value > MAX_MINOR) throw new DomainError(400, 'INVALID_DISCOUNT', 'The fixed discount exceeds the supported limit.');
    return Math.min(base, value);
  }
  if (kind !== 'percentage' || value > 10000) throw new DomainError(400, 'INVALID_DISCOUNT', 'Percentage discounts must be between 0 and 100 percent.');
  return taxMinor(base, value);
}

export function allocateMinor(amount: number, lines: { id: string; base: number }[]): Map<string, number> {
  const total = sumMinor(lines.map(line => line.base));
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > total || new Set(lines.map(line => line.id)).size !== lines.length) throw new DomainError(400, 'INVALID_ALLOCATION', 'The discount allocation must have unique lines and stay within the eligible amount.');
  const result = new Map(lines.map(line => [line.id, 0]));
  if (!amount || !total) return result;
  const denominator = BigInt(total);
  const shares = lines.map(line => {
    const numerator = BigInt(amount) * BigInt(line.base);
    return { id: line.id, value: numerator / denominator, remainder: numerator % denominator };
  });
  let remaining = BigInt(amount) - shares.reduce((sum, share) => sum + share.value, 0n);
  shares.sort((left, right) => left.remainder === right.remainder ? (left.id < right.id ? -1 : left.id > right.id ? 1 : 0) : left.remainder > right.remainder ? -1 : 1);
  for (const share of shares) {
    const extra = remaining > 0n ? 1n : 0n;
    if (extra) remaining--;
    result.set(share.id, Number(share.value + extra));
  }
  return result;
}
