import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { openDatabase } from '../server/database.js';
import { fixture } from './fixtures.js';

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
