// INR is the single configured currency in the baseline (scale = 2).
export const MAX_MINOR = 1_000_000_000_000;
export function parseAmount(value: string, signed = false): number {
  const text = value.trim();
  if (text.length > 24 || !(signed ? /^-?\d+(\.\d{1,2})?$/ : /^\d+(\.\d{1,2})?$/).test(text)) throw new Error('Enter an amount with no more than two decimal places.');
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace(/^-/, '').split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (minor > BigInt(MAX_MINOR)) throw new Error('This amount exceeds the supported limit.');
  return Number(negative ? -minor : minor);
}
export const formatMoney = (minor: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(minor / 100);
export const amountInput = (minor: number) => `${minor < 0 ? '-' : ''}${Math.floor(Math.abs(minor) / 100)}.${String(Math.abs(minor) % 100).padStart(2, '0')}`;
