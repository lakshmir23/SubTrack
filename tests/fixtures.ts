import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import type { DatabaseSync } from 'node:sqlite';
import request from 'supertest';
import { createApp, type AppOptions } from '../server/app.js';
import { openDatabase } from '../server/database.js';
import { seedDemo } from '../server/seed.js';

export const demoPassword = 'Brightloop!2026';

export async function fixture(t: TestContext, options: { seeded?: boolean; appOptions?: Omit<AppOptions, 'databasePath' | 'clock'> } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'subtrack-test-'));
  const databasePath = join(directory, 'test.sqlite');
  let currentTime = new Date('2026-11-01T04:00:00.000Z');
  if (options.seeded !== false) {
    const database = openDatabase(databasePath);
    await seedDemo(database);
    database.close();
  }
  const app = await createApp({
    ...options.appOptions,
    databasePath,
    clock: () => new Date(currentTime),
    mailMode: options.appOptions?.mailMode || 'outbox',
  });
  const db = app.locals.db as DatabaseSync;
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    app, db, databasePath,
    advanceTime(milliseconds: number) { currentTime = new Date(currentTime.getTime() + milliseconds); },
  };
}

export async function signIn(app: Awaited<ReturnType<typeof createApp>>, email = 'admin@brightloop.test') {
  const agent = request.agent(app);
  const response = await agent.post('/api/auth/login').send({ email, password: demoPassword });
  if (response.status !== 200) throw new Error(`Login failed for synthetic ${email}: ${response.status}`);
  const session = await agent.get('/api/session');
  if (!session.body.csrfToken) throw new Error('Authenticated session did not return a CSRF token.');
  return { agent, csrfToken: session.body.csrfToken as string, user: session.body.user };
}

export function assertNoSecrets(value: unknown) {
  const text = JSON.stringify(value);
  for (const field of ['password', 'passwordHash', 'password_hash', 'token_hash', 'tokenHash', 'resetToken', 'sessionToken']) {
    if (text.includes(`"${field}"`)) throw new Error(`Response exposed protected field ${field}.`);
  }
  if (text.includes(demoPassword)) throw new Error('Response exposed the synthetic plaintext password.');
}
