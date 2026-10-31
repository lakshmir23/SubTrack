import { Router } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { signupSchema, loginSchema, resetRequestSchema, resetSchema, staffSchema } from '../shared/validation.js';
import type { User } from '../shared/contracts.js';
import { transaction } from './database.js';
import { DomainError } from './errors.js';
import { hashPassword, verifyPassword } from './password.js';
import { businessDate } from './calendar.js';
import { audit, cookieToken, digest, issueSession, rateLimit, requireRole, serializeUser, type UserRow } from './security.js';

const genericReset = { message: 'If an account uses this email, a password reset link has been requested. Check your inbox. The link expires in 30 minutes.' };
const dummyHash = 'scrypt:16384:8:1:efb3e8fb22932f35a5a7e3bc387b0324:9c139a792195e87e8c6e6f9a6cc5fa8822316423429f34ea361d88b54e7db62f65a020722609222d8539f5f1ee2f94b9b6de7457ea6d5a28ccbac33bac32d10a';
const listSchema = z.object({ page: z.coerce.number().int().min(1).max(1000000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), q: z.string().trim().max(100).optional(), search: z.string().trim().max(100).optional() });
function attempt(db: DatabaseSync, req: Request, now: Date, kind: string, email?: string, accountLimit = 10) {
  transaction(db, () => {
    rateLimit(db, `${kind}:ip:${digest(req.ip || 'local')}`, now, kind === 'login' ? 50 : 20);
    if (email) rateLimit(db, `${kind}:account:${digest(email)}`, now, accountLimit);
  });
}
function userByEmail(db: DatabaseSync, email: string) { return db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined; }

export function identityRoutes(db: DatabaseSync, clock: () => Date, origin: string, mailMode: 'outbox' | 'smtp') {
  const router = Router();
  const secure = origin.startsWith('https://');
  router.get('/session', (_req, res) => res.json({ user: res.locals.user || null, csrfToken: res.locals.csrfToken || null }));
  router.post('/auth/signup', async (req, res) => {
    const input = signupSchema.parse(req.body);
    attempt(db, req, clock(), 'signup', input.email, 5);
    const passwordHash = await hashPassword(input.password);
    const now = clock();
    const session = transaction(db, () => {
      if (userByEmail(db, input.email)) throw new DomainError(409, 'EMAIL_EXISTS', 'An account already uses this email. Sign in or reset your password.', { email: 'This email is already registered.' });
      const id = randomUUID();
      db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id, input.name, input.email, passwordHash, 'customer', now.toISOString());
      const csrfToken = issueSession(db, id, res, now, secure, cookieToken(req));
      audit(db, id, 'customer.created', id, now);
      return { user: serializeUser(userByEmail(db, input.email)!), csrfToken };
    });
    res.status(201).json(session);
  });
  router.post('/auth/login', async (req, res) => {
    const input = loginSchema.parse(req.body);
    attempt(db, req, clock(), 'login', input.email);
    const user = userByEmail(db, input.email);
    const valid = await verifyPassword(input.password, user?.password_hash || dummyHash);
    if (!user || !valid) throw new DomainError(401, 'INVALID_CREDENTIALS', 'The email or password is incorrect. Try again or reset your password.');
    const now = clock();
    const session = transaction(db, () => {
      if (userByEmail(db, input.email)?.password_hash !== user.password_hash) throw new DomainError(401, 'INVALID_CREDENTIALS', 'The email or password is incorrect. Try again or reset your password.');
      // A successful sign-in clears the account's consecutive-failure allowance.
      // The independent IP window still bounds overall authentication traffic.
      db.prepare('DELETE FROM auth_limits WHERE key=?').run(`login:account:${digest(input.email)}`);
      const csrfToken = issueSession(db, user.id, res, now, secure, cookieToken(req));
      audit(db, user.id, 'session.started', user.id, now);
      return { user: serializeUser(user), csrfToken };
    });
    res.json(session);
  });
  router.post('/auth/logout', requireRole(), (req, res) => {
    transaction(db, () => {
      const token = cookieToken(req);
      if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));
      audit(db, (res.locals.user as User).id, 'session.ended', (res.locals.user as User).id, clock());
    });
    res.clearCookie('subtrack_session', { httpOnly: true, sameSite: 'lax', secure, path: '/' });
    res.json({ message: 'Signed out.' });
  });
  router.post('/auth/forgot-password', (req, res) => {
    const input = resetRequestSchema.parse(req.body);
    const now = clock();
    attempt(db, req, now, 'reset-request', input.email, 5);
    const token = randomBytes(32).toString('hex');
    transaction(db, () => {
      const user = userByEmail(db, input.email);
      if (!user) return;
      db.prepare('UPDATE password_resets SET used_at=? WHERE user_id=? AND used_at IS NULL').run(now.toISOString(), user.id);
      db.prepare('INSERT INTO password_resets VALUES(?,?,?,?,NULL,?)').run(randomUUID(), user.id, digest(token), new Date(now.getTime() + 30 * 60 * 1000).toISOString(), now.toISOString());
      db.prepare('INSERT INTO outbox(id,recipient,subject,body,created_at,status) VALUES(?,?,?,?,?,?)').run(randomUUID(), user.email, 'Reset your SubTrack password', `A password reset was requested for your Brightloop SubTrack account.\n\nOpen this link within 30 minutes:\n${origin}/reset-password#token=${token}\n\nOnly the newest link works. If you did not request this, ignore this message.\n`, now.toISOString(), 'generated');
      audit(db, null, 'password.reset_requested', user.id, now);
    });
    res.json(genericReset);
  });
  router.post('/auth/reset-password', async (req, res) => {
    const input = resetSchema.parse(req.body);
    attempt(db, req, clock(), 'reset-submit');
    const passwordHash = await hashPassword(input.password);
    transaction(db, () => {
      const now = clock();
      const reset = db.prepare('SELECT * FROM password_resets WHERE token_hash=? AND used_at IS NULL AND expires_at>?').get(digest(input.token), now.toISOString()) as { user_id: string } | undefined;
      if (!reset) throw new DomainError(400, 'INVALID_RESET', 'This reset link has expired or has already been used. Request a new link.');
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash, reset.user_id);
      db.prepare('UPDATE password_resets SET used_at=? WHERE user_id=? AND used_at IS NULL').run(now.toISOString(), reset.user_id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(reset.user_id);
      audit(db, reset.user_id, 'password.reset_completed', reset.user_id, now);
    });
    res.clearCookie('subtrack_session', { httpOnly: true, sameSite: 'lax', secure, path: '/' });
    res.json({ message: 'Password updated. Sign in with your new password.' });
  });
  router.get('/workspace', requireRole(), (_req, res) => {
    const user = res.locals.user as User;
    const counts = user.role === 'customer' ? { customers: 0, staff: 0 } : { customers: Number(db.prepare("SELECT count(*) AS count FROM users WHERE role='customer'").get()?.count), staff: Number(db.prepare("SELECT count(*) AS count FROM users WHERE role='staff'").get()?.count) };
    res.json({ organization: 'Brightloop Software', businessDate: businessDate(clock()), timezone: 'Asia/Kolkata', currency: 'INR', ...counts, database: 'sqlite', mailMode });
  });
  const directory = (role: 'staff' | 'customer') => (req: Request, res: Response) => {
    const input = listSchema.parse(req.query);
    const query = (input.q || input.search || '').replace(/[\\%_]/g, '\\$&');
    const pattern = `%${query}%`;
    const where = "role=? AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')";
    const total = Number(db.prepare(`SELECT count(*) AS count FROM users WHERE ${where}`).get(role, pattern, pattern)?.count);
    const page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
    const rows = db.prepare(`SELECT id,name,email,role,created_at FROM users WHERE ${where} ORDER BY created_at DESC,id LIMIT ? OFFSET ?`).all(role, pattern, pattern, input.pageSize, (page - 1) * input.pageSize) as unknown as UserRow[];
    res.json({ items: rows.map(serializeUser), total, page, pageSize: input.pageSize });
  };
  router.get('/staff', requireRole('admin'), directory('staff'));
  router.get('/customers', requireRole('admin', 'staff'), directory('customer'));
  router.post('/staff', requireRole('admin'), async (req, res) => {
    const input = staffSchema.parse(req.body);
    const passwordHash = await hashPassword(input.password);
    const user = transaction(db, () => {
      if (userByEmail(db, input.email)) throw new DomainError(409, 'EMAIL_EXISTS', 'An account already uses this email.', { email: 'This email is already registered.' });
      const id = randomUUID(); const now = clock();
      db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id, input.name, input.email, passwordHash, 'staff', now.toISOString());
      audit(db, (res.locals.user as User).id, 'staff.created', id, now);
      return serializeUser(userByEmail(db, input.email)!);
    });
    res.status(201).json(user);
  });
  router.get('/deliveries', requireRole('admin'), (req, res) => {
    const input = listSchema.parse(req.query);
    const total = Number(db.prepare('SELECT count(*) AS count FROM outbox').get()?.count);
    const page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
    const items = db.prepare("SELECT id,recipient,subject,created_at AS createdAt,CASE WHEN status='generated' AND claimed_at IS NOT NULL THEN 'sending' ELSE status END AS status,error FROM outbox ORDER BY created_at DESC,id LIMIT ? OFFSET ?").all(input.pageSize, (page - 1) * input.pageSize);
    res.json({ items, total, page, pageSize: input.pageSize });
  });
  return router;
}
