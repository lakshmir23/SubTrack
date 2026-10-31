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
