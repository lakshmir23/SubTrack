import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import request from 'supertest';
import { assertNoSecrets, demoPassword, fixture, signIn } from './fixtures.js';

function latestResetToken(db: DatabaseSync, recipient = 'maya@brightloop.test'): string {
  const message = db.prepare('SELECT body FROM outbox WHERE recipient = ? ORDER BY rowid DESC LIMIT 1').get(recipient);
  assert.ok(message, 'Reset request must generate a message for the registered test address.');
  const body = String(message.body);
  assert.ok(body.includes('/reset-password#token='), 'Reset link must use the canonical fragment-token route.');
  const token = body.match(/#token=([a-f0-9]{64})/)?.[1];
  assert.ok(token, 'Reset link must contain a high-entropy 32-byte hexadecimal token.');
  return token;
}

test('AUTH-03: known/unknown reset acknowledgements match and only registered address gets a generated message', async t => {
  const { app, db } = await fixture(t);
  const known = await request(app).post('/api/auth/forgot-password').send({ email: ' MAYA@BRIGHTLOOP.TEST ' });
  const unknown = await request(app).post('/api/auth/forgot-password').send({ email: 'unknown@brightloop.test' });
  assert.equal(known.status, 200);
  assert.equal(unknown.status, 200);
  assert.equal(known.body.message, unknown.body.message);
  assert.ok(known.body.message);
  assertNoSecrets(known.body);
  assertNoSecrets(unknown.body);
  assert.equal(db.prepare('SELECT count(*) AS count FROM outbox').get()?.count, 1);
  const token = latestResetToken(db);
  const saved = db.prepare('SELECT token_hash, expires_at, used_at FROM password_resets').get();
  assert.ok(saved?.token_hash === createHash('sha256').update(token).digest('hex'), 'Database stores a hash rather than the reset token.');
  assert.equal(saved.used_at, null);
  assert.equal(saved.expires_at, '2026-11-01T04:30:00.000Z');
  const admin = await signIn(app);
  const deliveries = await admin.agent.get('/api/deliveries');
  assert.equal(deliveries.status, 200);
  const serialized = JSON.stringify(deliveries.body);
  assert.equal(serialized.includes(token), false, 'Even admin HTTP metadata must not expose a live reset token.');
  assert.equal(serialized.includes('"body"'), false);
  assert.ok(serialized.includes('generated'), 'Outbox generation must not be represented as real delivery.');
});

test('AUTH-03: only latest reset works, cannot replay, revokes all old sessions and preserves unrelated sessions', async t => {
  const { app, db, advanceTime } = await fixture(t);
  const mayaFirst = await signIn(app, 'maya@brightloop.test');
  const mayaSecond = await signIn(app, 'maya@brightloop.test');
  const admin = await signIn(app);
  const firstRequest = await request(app).post('/api/auth/forgot-password').send({ email: 'maya@brightloop.test' });
  assert.equal(firstRequest.status, 200);
  const oldToken = latestResetToken(db);
  advanceTime(60_000);
  const secondRequest = await request(app).post('/api/auth/forgot-password').send({ email: 'maya@brightloop.test' });
  assert.equal(secondRequest.status, 200);
  const newToken = latestResetToken(db);
  assert.notEqual(newToken, oldToken);
  const stale = await request(app).post('/api/auth/reset-password').send({ token: oldToken, password: 'Replacement!' });
  assert.equal(stale.status, 400);
  const changed = await request(app).post('/api/auth/reset-password').send({ token: newToken, password: 'Replacement!' });
  assert.equal(changed.status, 200);
  assertNoSecrets(changed.body);
  assert.equal((await mayaFirst.agent.get('/api/session')).body.user, null);
  assert.equal((await mayaSecond.agent.get('/api/session')).body.user, null);
  assert.equal((await admin.agent.get('/api/session')).body.user.role, 'admin');
  assert.equal((await request(app).post('/api/auth/reset-password').send({ token: newToken, password: 'AnotherPassword!' })).status, 400);
  assert.equal((await request(app).post('/api/auth/login').send({ email: 'maya@brightloop.test', password: demoPassword })).status, 401);
  assert.equal((await request(app).post('/api/auth/login').send({ email: 'maya@brightloop.test', password: 'Replacement!' })).status, 200);
  const maya = db.prepare('SELECT id FROM users WHERE email = ?').get('maya@brightloop.test');
  assert.equal(db.prepare('SELECT count(*) AS count FROM password_resets WHERE user_id = ? AND used_at IS NULL').get(maya!.id)?.count, 0);
});

test('AUTH-03: reset expires at the exact 30-minute boundary and clients cannot extend it', async t => {
  const { app, db, advanceTime } = await fixture(t);
  assert.equal((await request(app).post('/api/auth/forgot-password').send({ email: 'maya@brightloop.test' })).status, 200);
  const token = latestResetToken(db);
  advanceTime(30 * 60_000);
  const expired = await request(app).post('/api/auth/reset-password').send({ token, password: 'Replacement!' });
  assert.equal(expired.status, 400);
  assert.ok(expired.body.error.message);
  assert.equal((await request(app).post('/api/auth/login').send({ email: 'maya@brightloop.test', password: demoPassword })).status, 200);
  const overridden = await request(app).post('/api/auth/reset-password').send({ token, password: 'Replacement!', expires_at: '2099-01-01T00:00:00.000Z' });
  assert.equal(overridden.status, 400);
  const malformed = await request(app).post('/api/auth/reset-password').send({ token: 'invalid', password: 'Replacement!' });
  assert.equal(malformed.status, 400);
  assert.ok(malformed.body.error.fields?.token);
});

test('AUTH-03/AUTH-02: invalid replacement password does not consume a usable reset', async t => {
  const { app, db } = await fixture(t);
  assert.equal((await request(app).post('/api/auth/forgot-password').send({ email: 'maya@brightloop.test' })).status, 200);
  const token = latestResetToken(db);
  const invalid = await request(app).post('/api/auth/reset-password').send({ token, password: 'Abcdefg!' });
  assert.equal(invalid.status, 400);
  assert.ok(invalid.body.error.fields?.password);
  assert.equal((await request(app).post('/api/auth/reset-password').send({ token, password: 'Abcdefgh!' })).status, 200);
  assert.equal((await request(app).post('/api/auth/login').send({ email: 'maya@brightloop.test', password: 'Abcdefgh!' })).status, 200);
});

test('AUTH-03: reset requests are bounded to five per address per 15 minutes', async t => {
  const { app, db } = await fixture(t);
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await request(app).post('/api/auth/forgot-password').send({ email: 'maya@brightloop.test' })).status, 200);
  }
  const limited = await request(app).post('/api/auth/forgot-password').send({ email: 'maya@brightloop.test' });
  assert.equal(limited.status, 429);
  assert.equal(db.prepare('SELECT count(*) AS count FROM outbox WHERE recipient = ?').get('maya@brightloop.test')?.count, 5);
});

test('AUTH-03: concurrent attempts cannot spend the same reset token twice', async t => {
  const { app, db } = await fixture(t);
  assert.equal((await request(app).post('/api/auth/forgot-password').send({ email: 'maya@brightloop.test' })).status, 200);
  const token = latestResetToken(db);
  const passwords = ['FirstReplacement!', 'SecondReplacement!'];
  const attempts = await Promise.all(passwords.map(password => request(app).post('/api/auth/reset-password').send({ token, password })));
  assert.deepEqual(attempts.map(response => response.status).sort(), [200, 400]);
  const winner = attempts.findIndex(response => response.status === 200);
  const loser = winner === 0 ? 1 : 0;
  assert.equal((await request(app).post('/api/auth/login').send({ email: 'maya@brightloop.test', password: passwords[winner] })).status, 200);
  assert.equal((await request(app).post('/api/auth/login').send({ email: 'maya@brightloop.test', password: passwords[loser] })).status, 401);
});
