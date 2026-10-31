import assert from 'node:assert/strict';
import test from 'node:test';
import nodemailer from 'nodemailer';
import request from 'supertest';
import { createMailDelivery } from '../server/mail.js';
import { fixture, signIn } from './fixtures.js';

test('AUTH-03: outbox mode remains generation-only and never opens a transport', async t => {
  const { app, db } = await fixture(t);
  const transport = t.mock.method(nodemailer, 'createTransport', () => { throw new Error('Unexpected mail transport.'); });
  assert.equal((await request(app).post('/api/auth/forgot-password').send({ email: 'maya@brightloop.test' })).status, 200);
  await app.locals.deliverPending();
  assert.equal(transport.mock.callCount(), 0);
  assert.equal(db.prepare('SELECT status FROM outbox').get()?.status, 'generated');
});

test('AUTH-03: missing SMTP configuration fails safely without opening a transport', async t => {
  const { app, db } = await fixture(t);
  const transport = t.mock.method(nodemailer, 'createTransport', () => { throw new Error('Unexpected mail transport.'); });
  assert.equal((await request(app).post('/api/auth/forgot-password').send({ email: 'maya@brightloop.test' })).status, 200);
  await createMailDelivery(db, { mode: 'smtp' })();
  assert.equal(transport.mock.callCount(), 0);
  const message = db.prepare('SELECT status,error FROM outbox').get();
  assert.equal(message?.status, 'failed');
  assert.equal(message.error, 'SMTP configuration is incomplete.');
});

test('AUTH-03: SMTP allowlist blocks other recipients before any network-capable transport exists', async t => {
  const { app, db } = await fixture(t);
  const transport = t.mock.method(nodemailer, 'createTransport', () => { throw new Error('Unexpected mail transport.'); });
  assert.equal((await request(app).post('/api/auth/forgot-password').send({ email: 'maya@brightloop.test' })).status, 200);
  await createMailDelivery(db, {
    mode: 'smtp', host: 'unused.example.test', user: 'synthetic-user', password: 'SyntheticMailPassword!',
    from: 'sender@brightloop.test', allowedRecipients: ['other@brightloop.test'],
  })();
  assert.equal(transport.mock.callCount(), 0);
  const message = db.prepare('SELECT status,error FROM outbox').get();
  assert.equal(message?.status, 'failed');
  assert.equal(message.error, 'Recipient is not in the approved test allowlist.');
  assert.equal(JSON.stringify(message).includes('SyntheticMailPassword!'), false);
});

test('AUTH-03: an abandoned SMTP claim becomes unknown and is never silently retried', async t => {
  const { app, db } = await fixture(t);
  const transport = t.mock.method(nodemailer, 'createTransport', () => { throw new Error('Unexpected mail transport.'); });
  assert.equal((await request(app).post('/api/auth/forgot-password').send({ email: 'maya@brightloop.test' })).status, 200);
  db.prepare('UPDATE outbox SET claimed_at=?').run(new Date(Date.now() - 3 * 60_000).toISOString());
  const deliver = createMailDelivery(db, {
    mode: 'smtp', host: 'unused.example.test', user: 'synthetic-user', password: 'SyntheticMailPassword!',
    from: 'sender@brightloop.test', allowedRecipients: ['maya@brightloop.test'],
  });
  await deliver();
  assert.equal(db.prepare('SELECT status FROM outbox').get()?.status, 'unknown');
  assert.ok(String(db.prepare('SELECT error FROM outbox').get()?.error).includes('interrupted'));
  await deliver();
  assert.equal(transport.mock.callCount(), 0);
  assert.equal(db.prepare('SELECT status FROM outbox').get()?.status, 'unknown');
});

test('AUTH-03: stopping the SMTP worker before dispatch leaves messages unclaimed', async t => {
  const { app, db } = await fixture(t);
  const transport = t.mock.method(nodemailer, 'createTransport', () => { throw new Error('Unexpected mail transport.'); });
  assert.equal((await request(app).post('/api/auth/forgot-password').send({ email: 'maya@brightloop.test' })).status, 200);
  const deliver = createMailDelivery(db, { mode: 'smtp' });
  await deliver.stop();
  await deliver();
  assert.equal(transport.mock.callCount(), 0);
  const message = db.prepare('SELECT status,claimed_at FROM outbox').get();
  assert.equal(message?.status, 'generated');
  assert.equal(message.claimed_at, null);
});

test('AUTH-03: SMTP shutdown waits for the in-flight message and claims no additional message', async t => {
  const { app, db } = await fixture(t);
  for (const email of ['maya@brightloop.test', 'arun@brightloop.test']) {
    assert.equal((await request(app).post('/api/auth/forgot-password').send({ email })).status, 200);
  }
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  let closed = false;
  const fakeTransport = {
    async sendMail(mail: { to: { address: string } }) {
      markStarted();
      await gate;
      return { accepted: [mail.to.address], messageId: 'synthetic-message-id' };
    },
    close() { closed = true; },
  };
  const transport = t.mock.method(nodemailer, 'createTransport', () => fakeTransport as unknown as ReturnType<typeof nodemailer.createTransport>);
  const deliver = createMailDelivery(db, {
    mode: 'smtp', host: 'unused.example.test', user: 'synthetic-user', password: 'SyntheticMailPassword!',
    from: 'sender@brightloop.test', allowedRecipients: ['maya@brightloop.test', 'arun@brightloop.test'],
  });
  const dispatched = deliver();
  await started;
  const admin = await signIn(app);
  const metadata = await admin.agent.get('/api/deliveries');
  assert.equal(metadata.status, 200);
  assert.equal(metadata.body.items.filter((item: { status: string }) => item.status === 'sending').length, 1);
  let stopped = false;
  const stopping = deliver.stop().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false, 'Shutdown must await the transport before allowing database closure.');
  release();
  await Promise.all([dispatched, stopping]);
  assert.equal(closed, true);
  assert.equal(transport.mock.callCount(), 1);
  assert.equal(db.prepare("SELECT count(*) AS count FROM outbox WHERE status='accepted'").get()?.count, 1);
  assert.equal(db.prepare("SELECT count(*) AS count FROM outbox WHERE status='generated' AND claimed_at IS NULL").get()?.count, 1);
  await deliver();
  assert.equal(transport.mock.callCount(), 1);
});
