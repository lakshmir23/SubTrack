import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Request, Response, NextFunction } from 'express';
import type { User, Role } from '../shared/contracts.js';
import { DomainError } from './errors.js';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export interface UserRow { id: string; name: string; email: string; password_hash: string; role: Role; created_at: string }
export function serializeUser(row: UserRow): User {
  return { id: row.id, name: row.name, email: row.email, role: row.role, createdAt: row.created_at };
}
export function cookieToken(req: Request): string | null {
  const value = req.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith('subtrack_session='))?.slice('subtrack_session='.length);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
export function issueSession(db: DatabaseSync, userId: string, res: Response, now: Date, secure: boolean, oldToken: string | null = null) {
  const token = randomBytes(32).toString('hex');
  const csrf = randomBytes(32).toString('hex');
  if (oldToken) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(oldToken));
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?)').run(digest(token), userId, csrf, new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString(), now.toISOString());
  res.cookie('subtrack_session', token, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 12 * 60 * 60 * 1000 });
  return csrf;
}
export function readSession(db: DatabaseSync, req: Request, now: Date) {
  const token = cookieToken(req);
  if (!token) return null;
  const row = db.prepare(`SELECT u.*, s.csrf_token FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`).get(digest(token), now.toISOString()) as (UserRow & { csrf_token: string }) | undefined;
  return row ? { user: serializeUser(row), csrfToken: row.csrf_token } : null;
}
export function requireRole(...allowed: Role[]) {
  return (_req: Request, res: Response, next: NextFunction) => {
    const user = res.locals.user as User | undefined;
    if (!user) throw new DomainError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    if (allowed.length && !allowed.includes(user.role)) throw new DomainError(403, 'FORBIDDEN', 'Your account does not have permission for this action.');
    next();
  };
}
export function rateLimit(db: DatabaseSync, key: string, now: Date, limit: number, windowMs = 15 * 60 * 1000) {
  const current = db.prepare('SELECT attempts, window_start FROM auth_limits WHERE key = ?').get(key) as { attempts: number; window_start: number } | undefined;
  if (!current || now.getTime() - current.window_start >= windowMs) {
    db.prepare('INSERT INTO auth_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=1, window_start=excluded.window_start').run(key, now.getTime());
  } else {
    if (current.attempts >= limit) throw new DomainError(429, 'RATE_LIMITED', 'Too many attempts. Wait 15 minutes, then try again.');
    db.prepare('UPDATE auth_limits SET attempts=attempts+1 WHERE key=?').run(key);
  }
}
export function audit(db: DatabaseSync, actor: string | null, kind: string, subject: string, now: Date, details: Record<string, unknown> = {}) {
  db.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?,?)').run(randomUUID(), actor, kind, subject, JSON.stringify(details), now.toISOString());
}
