import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { openDatabase } from '../server/database.js';
import { fixture, signIn } from './fixtures.js';

test('P2: a competing writer returns a retryable domain error without a partial write', async t => {
  const { app, db, databasePath } = await fixture(t, { seeded: false });
  const competingWriter = openDatabase(databasePath);
  const payload = { name: 'Retry Customer', email: 'retry@example.test', password: 'Abcdefgh!' };
  try {
    competingWriter.exec('BEGIN IMMEDIATE');
    const response = await request(app).post('/api/auth/signup').send(payload);
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, 'DATABASE_BUSY');
    assert.equal(db.prepare('SELECT count(*) AS count FROM users').get()?.count, 0);
    competingWriter.exec('ROLLBACK');
    assert.equal((await request(app).post('/api/auth/signup').send(payload)).status, 201);
    assert.equal(db.prepare('SELECT count(*) AS count FROM users').get()?.count, 1);
  } finally {
    if (competingWriter.isTransaction) competingWriter.exec('ROLLBACK');
    competingWriter.close();
  }
});

test('P2: price preview reads a consistent committed snapshot while another writer is open', async t => {
  const { app, databasePath } = await fixture(t);
  const admin = await signIn(app);
  const product = await admin.agent.post('/api/products').set('X-CSRF-Token', admin.csrfToken).send({ name: 'Snapshot Product', type: 'software', salesPrice: 120000, costPrice: 40000, notes: '', active: true, variants: [] });
  assert.equal(product.status, 201);
  const plan = await admin.agent.post('/api/plans').set('X-CSRF-Token', admin.csrfToken).send({ name: 'Snapshot Plan', primaryProductId: product.body.id, price: 100000, interval: 'monthly', minQuantity: 1, availableFrom: null, availableTo: null, autoClose: true, allowPause: true, allowRenew: true, allowEarlyClose: true, active: true });
  assert.equal(plan.status, 201);
  const writer = openDatabase(databasePath);
  try {
    writer.exec('BEGIN IMMEDIATE');
    writer.prepare('UPDATE plans SET price=200000 WHERE id=?').run(plan.body.id);
    const preview = await admin.agent.post('/api/catalog/preview').set('X-CSRF-Token', admin.csrfToken).send({ planId: plan.body.id, lines: [{ productId: product.body.id, variantId: null, quantity: 1 }] });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.total, 100000);
    writer.exec('ROLLBACK');
  } finally {
    if (writer.isTransaction) writer.exec('ROLLBACK');
    writer.close();
  }
});
