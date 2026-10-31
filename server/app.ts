import express from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { openDatabase } from './database.js';
import { DomainError, errorHandler } from './errors.js';
import { readSession } from './security.js';
import { identityRoutes } from './identity.js';
import { createMailDelivery, type MailConfig } from './mail.js';
import { catalogRoutes } from './catalog.js';

export interface AppOptions { databasePath: string; clock?: () => Date; appUrl?: string; mailMode?: 'outbox' | 'smtp'; mailConfig?: MailConfig; production?: boolean }
export function createApp(options: AppOptions) {
  const app = express();
  const db = openDatabase(options.databasePath);
  const clock = options.clock || (() => new Date());
  const origin = new URL(options.appUrl || 'http://localhost:3000').origin;
  const mailConfig = options.mailConfig || { mode: options.mailMode || 'outbox' };
  app.locals.db = db;
  app.locals.deliverPending = createMailDelivery(db, mailConfig);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: options.production ? undefined : false, referrerPolicy: { policy: 'no-referrer' } }));
  app.use((_req, res, next) => { res.locals.requestId = randomUUID(); res.setHeader('X-Request-Id', res.locals.requestId); next(); });
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.headers.origin && req.headers.origin !== origin) throw new DomainError(403, 'ORIGIN', 'This request must come from your SubTrack workspace.');
      if (!req.is('application/json')) throw new DomainError(415, 'CONTENT_TYPE', 'Send this request as JSON.');
    }
    const session = readSession(db, req, clock());
    if (session) { res.locals.user = session.user; res.locals.csrfToken = session.csrfToken; }
    const publicAuth = ['/auth/login', '/auth/signup', '/auth/forgot-password', '/auth/reset-password'].includes(req.path);
    if (session && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !publicAuth && req.headers['x-csrf-token'] !== session.csrfToken) throw new DomainError(403, 'CSRF', 'Your session changed. Refresh this page, then try again.');
    next();
  });
  app.get('/api/health', (_req, res) => {
    const schema = db.prepare('SELECT max(version) AS version FROM schema_migrations').get();
    res.json({ status: 'ok', database: 'sqlite', schemaVersion: schema?.version, organization: 'Brightloop Software' });
  });
  app.use('/api', identityRoutes(db, clock, origin, mailConfig.mode));
  app.use('/api', catalogRoutes(db, clock));
  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'This operation is not available.', requestId: res.locals.requestId } }));
  app.use(errorHandler);
  return app;
}
