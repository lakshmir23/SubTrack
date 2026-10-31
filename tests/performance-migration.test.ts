import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { openDatabase } from '../server/database.js';
import { migrateMeasuredListIndexes } from '../server/performance-schema.js';
import { buildNovemberDemo } from '../server/demo-fixture.js';
import { recordPayment } from '../server/payments.js';

test('FIN-02: fresh/reopened global list plans stream their created-date order without sorting wide snapshots', () => {
  const db = openDatabase(':memory:');
  try {
    assert.equal(db.prepare('SELECT count(*) AS count FROM schema_migrations WHERE version=11').get()?.count, 1);
    migrateMeasuredListIndexes(db);
    assert.equal(db.prepare('SELECT count(*) AS count FROM schema_migrations WHERE version=11').get()?.count, 1);
    for (const table of ['subscriptions', 'invoices']) {
      const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT * FROM ${table} ORDER BY created_at DESC,id LIMIT ? OFFSET ?`).all(20, 0);
      const details = plan.map(row => String(row.detail)).join(' ');
      assert.match(details, new RegExp(`${table}_created_page`)); assert.doesNotMatch(details, /TEMP B-TREE/);
    }
    assert.equal(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys, 1);
  } finally { db.close(); }
});

test('FIN-02: populated version-ten upgrade preserves accepted/invoice/payment facts, teammate objects and financial guards', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'subtrack-index-upgrade-')); const path = join(directory, 'populated.sqlite');
  const fixture = await buildNovemberDemo(path); let db = fixture.app.locals.db;
  try {
    await fixture.app.locals.billingWorker.stop(); await fixture.app.locals.deliverPending.stop();
    // Reconstruct the real v10 index state in this isolated disposable fixture.
    db.exec(`DROP INDEX subscriptions_created_page; DROP INDEX invoices_created_page; DELETE FROM schema_migrations WHERE version=11;
      CREATE INDEX teammate_invoice_number_index ON invoices(number,id);
      CREATE TRIGGER teammate_invoice_guard BEFORE UPDATE OF number ON invoices BEGIN SELECT RAISE(ABORT,'Teammate history guard'); END;`);
    const beforeInvoices = db.prepare('SELECT * FROM invoices ORDER BY id').all();
    const beforeSubscriptions = db.prepare('SELECT * FROM subscriptions ORDER BY id').all();
    const beforePayments = db.prepare('SELECT * FROM payments ORDER BY id').all();
    const beforeTriggers = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all();
    const expectedPages = new Map(['subscriptions', 'invoices'].map(table => [table, db.prepare(`SELECT id FROM ${table} ORDER BY created_at DESC,id LIMIT 2 OFFSET 1`).all()]));
    db.close(); db = openDatabase(path);
    assert.equal(db.prepare('SELECT max(version) AS version FROM schema_migrations').get()?.version, 11);
    assert.deepEqual(db.prepare('SELECT * FROM invoices ORDER BY id').all(), beforeInvoices);
    assert.deepEqual(db.prepare('SELECT * FROM subscriptions ORDER BY id').all(), beforeSubscriptions);
    assert.deepEqual(db.prepare('SELECT * FROM payments ORDER BY id').all(), beforePayments);
    assert.deepEqual(db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all(), beforeTriggers);
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='teammate_invoice_number_index'").get());
    for (const [table, expected] of expectedPages) assert.deepEqual(db.prepare(`SELECT id FROM ${table} ORDER BY created_at DESC,id LIMIT 2 OFFSET 1`).all(), expected);
    assert.throws(() => db.prepare('UPDATE invoices SET total=1 WHERE id=?').run(fixture.records.invoices.B));
    assert.throws(() => db.prepare('UPDATE payments SET amount=1').run());
    const actor = String(db.prepare("SELECT id FROM users WHERE role='admin'").get()?.id);
    const paid = recordPayment(db, fixture.records.invoices.B, { amount: 1000, currency: 'INR', method: 'cash', paymentDate: '2026-11-09', note: 'Synthetic upgrade witness', idempotencyKey: randomUUID() }, actor, fixture.clock());
    assert.equal(paid.invoice.amountPaid, 1000); assert.equal(paid.invoice.outstanding, 109000); assert.equal(paid.invoice.paymentCount, 1);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
    db.close(); db = openDatabase(path);
    assert.equal(db.prepare('SELECT count(*) AS count FROM schema_migrations WHERE version=11').get()?.count, 1);
  } finally {
    db.close();
    const actual = realpathSync(directory);
    assert.equal(dirname(actual).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
    assert.ok(basename(actual).startsWith('subtrack-index-upgrade-'));
    rmSync(actual, { recursive: true, force: true });
  }
});
