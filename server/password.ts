import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCallback(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) => error ? reject(error) : resolve(key)));
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt:16384:8:1:${salt.toString('hex')}:${key.toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, cost, block, parallel, saltHex, hashHex] = encoded.split(':');
  if (algorithm !== 'scrypt' || cost !== '16384' || block !== '8' || parallel !== '1' || !saltHex || !hashHex) return false;
  const stored = Buffer.from(hashHex, 'hex');
  const computed = await scrypt(password, Buffer.from(saltHex, 'hex'));
  return stored.length === computed.length && timingSafeEqual(stored, computed);
}
