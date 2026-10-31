import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import request from 'supertest';
import { openDatabase } from '../server/database.js';
import { seedDemo } from '../server/seed.js';
import { assertNoSecrets, fixture } from './fixtures.js';

test('P0: fresh SQLite migration is repeatable, constrained and persisted across connections', () => {
  const directory = mkdtempSync(join(tmpdir(), 'subtrack-migrate-'));
  const path = join(directory, 'fresh.sqlite');
  const first = openDatabase(path);
  try {
    assert.equal(first.prepare('PRAGMA foreign_keys').get()?.foreign_keys, 1);
    assert.equal(first.prepare('PRAGMA journal_mode').get()?.journal_mode, 'wal');
    assert.ok(Number(first.prepare('SELECT max(version) AS version FROM schema_migrations').get()?.version) >= 1);
    const insert = first.prepare('INSERT INTO users(id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)');
    insert.run('first', 'First Customer', 'first@example.test', 'not-a-plaintext-password', 'customer', '2026-11-01T00:00:00.000Z');
    assert.throws(() => insert.run('duplicate', 'Duplicate Customer', 'first@example.test', 'hash', 'customer', '2026-11-01T00:00:00.000Z'));
    assert.throws(() => insert.run('unnormalized', 'Invalid Customer', ' FIRST@EXAMPLE.TEST ', 'hash', 'customer', '2026-11-01T00:00:00.000Z'));
    assert.throws(() => insert.run('bad-role', 'Invalid Customer', 'other@example.test', 'hash', 'superadmin', '2026-11-01T00:00:00.000Z'));
  } finally {
    first.close();
  }
  const reopened = openDatabase(path);
  try {
    assert.equal(reopened.prepare('SELECT count(*) AS count FROM users').get()?.count, 1);
    assert.equal(reopened.prepare('SELECT email FROM users WHERE id = ?').get('first')?.email, 'first@example.test');
  } finally {
    reopened.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('P0: health confirms a migrated persisted database without exposing configuration', async t => {
  const { app } = await fixture(t, { seeded: false });
  const response = await request(app).get('/api/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.database, 'sqlite');
  assert.ok(response.body.schemaVersion >= 1);
  assertNoSecrets(response.body);
  assert.equal(JSON.stringify(response.body).includes('OPENAI'), false);
});

test('AUTH-01: independent processes racing normalized signup create exactly one account', { timeout: 30_000 }, async t => {
  const { db, databasePath } = await fixture(t, { seeded: false });
  type WorkerMessage = { type: string; status?: number; message?: string };
  function worker() {
    const child = fork(fileURLToPath(new URL('./helpers/signup-worker.ts', import.meta.url)), [databasePath], {
      execArgv: ['--import', 'tsx'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    let stderr = '';
    child.stderr?.on('data', chunk => { stderr += String(chunk); });
    const ready = new Promise<void>((resolve, reject) => {
      child.on('message', raw => { if ((raw as WorkerMessage).type === 'ready') resolve(); });
      child.on('error', reject);
      child.on('exit', code => { if (code !== 0) reject(new Error(`Signup worker exited ${code}: ${stderr}`)); });
    });
    const result = new Promise<number>((resolve, reject) => {
      child.on('message', raw => {
        const message = raw as WorkerMessage;
        if (message.type === 'result') resolve(message.status!);
        if (message.type === 'error') reject(new Error(message.message));
      });
      child.on('error', reject);
      child.on('exit', code => { if (code !== 0) reject(new Error(`Signup worker exited ${code}: ${stderr}`)); });
    });
    const exited = new Promise<void>((resolve, reject) => {
      child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Signup worker exited ${code}: ${stderr}`)));
    });
    return { child, ready, result, exited };
  }
  const left = worker();
  const right = worker();
  await Promise.all([left.ready, right.ready]);
  left.child.send('go');
  right.child.send('go');
  const statuses = (await Promise.all([left.result, right.result])).sort();
  await Promise.all([left.exited, right.exited]);
  assert.deepEqual(statuses, [201, 409]);
  assert.equal(db.prepare('SELECT count(*) AS count FROM users WHERE email = ?').get('concurrent@example.test')?.count, 1);
});

test('P1: upgrading a version-two outbox preserves messages and permits explicit uncertain delivery status', () => {
  const directory = mkdtempSync(join(tmpdir(), 'subtrack-upgrade-'));
  const path = join(directory, 'previous.sqlite');
  const previous = new DatabaseSync(path);
  previous.exec(`
    CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;
    INSERT INTO schema_migrations VALUES(1,'2026-10-31T00:00:00.000Z'),(2,'2026-10-31T00:00:00.000Z');
    CREATE TABLE outbox(
      id TEXT PRIMARY KEY, recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
      created_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('generated','accepted','failed')),
      error TEXT, provider_id TEXT, claimed_at TEXT
    ) STRICT;
    INSERT INTO outbox VALUES('existing-message','maya@brightloop.test','Previous message','Preserve the snapshot',
      '2026-10-31T00:00:00.000Z','generated',NULL,NULL,'2026-10-31T00:00:00.000Z');
  `);
  previous.close();
  const upgraded = openDatabase(path);
  try {
    assert.ok(Number(upgraded.prepare('SELECT max(version) AS version FROM schema_migrations').get()?.version) >= 3);
    assert.equal(upgraded.prepare('SELECT body FROM outbox WHERE id=?').get('existing-message')?.body, 'Preserve the snapshot');
    upgraded.prepare("UPDATE outbox SET status='unknown' WHERE id=?").run('existing-message');
    assert.equal(upgraded.prepare('SELECT status FROM outbox WHERE id=?').get('existing-message')?.status, 'unknown');
  } finally { upgraded.close(); }
  const reopened = openDatabase(path);
  try { assert.equal(reopened.prepare('SELECT count(*) AS count FROM outbox').get()?.count, 1); }
  finally {
    reopened.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('P1: demo seed rejects reserved-role collisions atomically without changing the original customer', async t => {
  const { app, db } = await fixture(t, { seeded: false });
  assert.equal((await request(app).post('/api/auth/signup').send({ name: 'Original Customer', email: 'staff@brightloop.test', password: 'Abcdefgh!' })).status, 201);
  const before = db.prepare('SELECT id,name,role,password_hash FROM users WHERE email=?').get('staff@brightloop.test');
  await assert.rejects(seedDemo(db));
  assert.deepEqual(db.prepare('SELECT id,name,role,password_hash FROM users WHERE email=?').get('staff@brightloop.test'), before);
  assert.equal(db.prepare('SELECT count(*) AS count FROM users').get()?.count, 1, 'Admin inserted before the staff collision must roll back too.');
});
