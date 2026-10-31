import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { migrateCatalog } from './catalog-schema.js';
import { migrateSubscriptions } from './subscriptions-schema.js';
import { migrateBilling } from './billing-schema.js';
import { migrateBillingWorkbench } from './billing-workbench-schema.js';
import { migratePayments, migratePaymentFactsGuard } from './payments-schema.js';
import { migrateLifecycle } from './lifecycle-schema.js';
import { migrateMeasuredListIndexes } from './performance-schema.js';
import { migrateAiQuotes } from './ai-quote-schema.js';

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 1000; PRAGMA synchronous = FULL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 100),
      email TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(email = lower(trim(email))),
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','staff','customer')),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS users_role_created ON users(role, created_at DESC, id);
    INSERT OR IGNORE INTO schema_migrations VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf_token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS password_resets_user ON password_resets(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('generated','accepted','failed')),
      error TEXT,
      provider_id TEXT,
      claimed_at TEXT
    ) STRICT;
    CREATE INDEX IF NOT EXISTS outbox_status ON outbox(status, created_at);
    CREATE TABLE IF NOT EXISTS auth_limits (
      key TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL CHECK(attempts >= 0),
      window_start INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      actor_id TEXT REFERENCES users(id),
      kind TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS audit_subject ON audit_events(subject_id, created_at);
    INSERT OR IGNORE INTO schema_migrations VALUES (2, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  `);
  transaction(db, () => {
    if (db.prepare('SELECT 1 FROM schema_migrations WHERE version=3').get()) return;
    db.exec(`
      CREATE TABLE outbox_v3 (
        id TEXT PRIMARY KEY, recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
        created_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('generated','accepted','failed','unknown')),
        error TEXT, provider_id TEXT, claimed_at TEXT
      ) STRICT;
      INSERT INTO outbox_v3 SELECT * FROM outbox;
      DROP TABLE outbox;
      ALTER TABLE outbox_v3 RENAME TO outbox;
      CREATE INDEX outbox_status ON outbox(status, created_at);
      INSERT INTO schema_migrations VALUES(3,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    `);
  });
  migrateCatalog(db);
  migrateSubscriptions(db);
  migrateBilling(db);
  migrateBillingWorkbench(db);
  migratePayments(db);
  migrateLifecycle(db);
  migratePaymentFactsGuard(db);
  migrateMeasuredListIndexes(db);
  migrateAiQuotes(db);
  return db;
}

export function transaction<T>(db: DatabaseSync, work: () => T, mode: 'write' | 'read' = 'write'): T {
  db.exec(mode === 'read' ? 'BEGIN' : 'BEGIN IMMEDIATE');
  try { const result = work(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
