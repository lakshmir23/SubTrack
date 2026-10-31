import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import request from 'supertest';
import { assertNoSecrets, demoPassword, fixture, signIn } from './fixtures.js';

function cookieHeader(cookies: string[]) { return cookies.map(cookie => cookie.split(';')[0]).join('; '); }

test('AUTH-04: session tokens are hashed, rotated on login and expire at 12 hours', async t => {
  const { app, db, advanceTime } = await fixture(t);
  const agent = request.agent(app);
  const first = await agent.post('/api/auth/login').send({ email: 'maya@brightloop.test', password: demoPassword });
  assert.equal(first.status, 200);
  const firstCookie = cookieHeader(first.headers['set-cookie'] as unknown as string[]);
  const rawToken = firstCookie.match(/subtrack_session=([a-f0-9]{64})/)?.[1];
  assert.ok(rawToken);
  const stored = db.prepare('SELECT token_hash, expires_at FROM sessions').get();
  assert.ok(stored?.token_hash === createHash('sha256').update(rawToken).digest('hex'), 'Session storage must not contain the bearer token.');
  assert.equal(stored.expires_at, '2026-11-01T16:00:00.000Z');
  const second = await agent.post('/api/auth/login').send({ email: 'maya@brightloop.test', password: demoPassword });
  assert.equal(second.status, 200);
  const secondCookie = cookieHeader(second.headers['set-cookie'] as unknown as string[]);
  assert.notEqual(secondCookie, firstCookie);
  assert.equal((await request(app).get('/api/session').set('Cookie', firstCookie)).body.user, null);
  advanceTime(12 * 60 * 60_000 - 1);
  assert.equal((await agent.get('/api/session')).body.user.email, 'maya@brightloop.test');
  advanceTime(1);
  assert.equal((await agent.get('/api/session')).body.user, null);
  assert.equal((await agent.get('/api/workspace')).status, 401);
});

test('AUTH-04: forged or malformed cookies grant no authority and HTTPS uses Secure cookies', async t => {
  const { app } = await fixture(t, { appOptions: { appUrl: 'https://subtrack.example.test', production: true } });
  for (const cookie of [`subtrack_session=${'f'.repeat(64)}`, 'subtrack_session=admin', 'role=admin', 'subtrack_session=%00%27OR1=1']) {
    const response = await request(app).get('/api/session').set('Cookie', cookie);
    assert.equal(response.status, 200);
    assert.equal(response.body.user, null);
    assert.equal((await request(app).get('/api/staff').set('Cookie', cookie)).status, 401);
  }
  const login = await request(app).post('/api/auth/login').send({ email: 'maya@brightloop.test', password: demoPassword });
  assert.equal(login.status, 200);
  const cookies = login.headers['set-cookie'] as unknown as string[];
  assert.ok(cookies.some(cookie => /; Secure(?:;|$)/.test(cookie)));
  assert.ok(cookies.some(cookie => /; HttpOnly(?:;|$)/.test(cookie)));
  assert.ok(login.headers['content-security-policy']);
  assert.equal(login.headers['referrer-policy'], 'no-referrer');
  assert.equal(login.headers['cache-control'], 'no-store');
});

test('AUTH-04: directory treats SQL wildcard characters literally and clamps valid out-of-range pages', async t => {
  const { app } = await fixture(t);
  for (const [name, email] of [
    ['Percent % Customer', 'percent@example.test'], ['Underscore _ Customer', 'underscore@example.test'], ['Backslash \\ Customer', 'backslash@example.test'],
  ]) {
    assert.equal((await request(app).post('/api/auth/signup').send({ name, email, password: 'Abcdefgh!' })).status, 201);
  }
  const staff = await signIn(app, 'staff@brightloop.test');
  for (const [query, email] of [['%', 'percent@example.test'], ['_', 'underscore@example.test'], ['\\', 'backslash@example.test']]) {
    const response = await staff.agent.get('/api/customers').query({ q: query });
    assert.equal(response.status, 200);
    assert.equal(response.body.total, 1);
    assert.equal(response.body.items[0].email, email);
  }
  const finalPage = await staff.agent.get('/api/customers').query({ page: 999_999, pageSize: 2 });
  assert.equal(finalPage.status, 200);
  assert.equal(finalPage.body.total, 5);
  assert.equal(finalPage.body.page, 3);
  assert.equal(finalPage.body.items.length, 1);
  const empty = await staff.agent.get('/api/customers').query({ q: "' OR 1=1 --", page: 5 });
  assert.equal(empty.status, 200);
  assert.equal(empty.body.total, 0);
  assert.equal(empty.body.page, 1);
  assert.deepEqual(empty.body.items, []);
  for (const query of [{ page: 0 }, { page: -1 }, { page: 'invalid' }, { pageSize: 101 }, { pageSize: 0 }]) {
    assert.equal((await staff.agent.get('/api/customers').query(query)).status, 400);
  }
});

test('AUTH-04: authentication requires JSON and rejects oversized requests without disclosing input', async t => {
  const { app } = await fixture(t);
  const plain = await request(app).post('/api/auth/login').type('form').send({ email: 'admin@brightloop.test', password: demoPassword });
  assert.equal(plain.status, 415);
  const hugeMarker = 'OversizedSensitiveMarker';
  const oversized = await request(app).post('/api/auth/signup').send({ name: hugeMarker.repeat(1000), email: 'large@example.test', password: 'Abcdefgh!' });
  assert.equal(oversized.status, 413);
  assert.ok(oversized.body.error.requestId);
  assert.equal(JSON.stringify(oversized.body).includes(hugeMarker), false);
  assertNoSecrets(oversized.body);
});

test('P1: unexpected database failures return a safe domain error and log only a correlation ID', async t => {
  const { app, db } = await fixture(t);
  const messages: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { messages.push(args); });
  db.exec('DROP TABLE schema_migrations');
  const response = await request(app).get('/api/health');
  assert.equal(response.status, 500);
  assert.equal(response.body.error.code, 'INTERNAL');
  assert.ok(response.body.error.requestId);
  const serialized = JSON.stringify({ response: response.body, logs: messages });
  for (const forbidden of ['schema_migrations', 'SELECT', 'SQLITE', 'node_modules', demoPassword]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.ok(messages.length > 0);
  assert.ok(JSON.stringify(messages).includes(response.body.error.requestId));
});

test('AUTH-04: server business dates use Asia/Kolkata at the UTC date boundary', async t => {
  const { app, advanceTime } = await fixture(t);
  const signed = await signIn(app, 'staff@brightloop.test');
  advanceTime(14 * 60 * 60_000 + 29 * 60_000);
  // The original session has expired; a fresh session uses the same server clock.
  const refreshed = await signed.agent.post('/api/auth/login').send({ email: 'staff@brightloop.test', password: demoPassword });
  assert.equal(refreshed.status, 200);
  assert.equal((await signed.agent.get('/api/workspace')).body.businessDate, '2026-11-01');
  advanceTime(60_000);
  const afterMidnight = await signed.agent.get('/api/workspace');
  assert.equal(afterMidnight.body.businessDate, '2026-11-02');
  assert.equal(afterMidnight.body.timezone, 'Asia/Kolkata');
});
