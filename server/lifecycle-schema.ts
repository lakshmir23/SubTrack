import type { DatabaseSync } from 'node:sqlite';
import { transaction } from './database.js';

export function migrateLifecycle(db: DatabaseSync): void {
  if (db.prepare('SELECT 1 FROM schema_migrations WHERE version=9').get()) return;
  // SQLite cannot alter a CHECK constraint. Keep the original table name on every
  // referencing FK: drop the old parent only with FK enforcement temporarily off,
  // then rename the replacement parent. Never rename the old parent first.
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    transaction(db, () => {
      if (db.prepare('SELECT 1 FROM schema_migrations WHERE version=9').get()) return;
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='subscriptions_v9'").get()) throw new Error('The lifecycle migration temporary table name is already in use.');
      const table = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='subscriptions'").get() as { sql: string };
      const dependent = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='subscriptions' AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY type,name").all() as { sql: string }[];
      const needle = "(stage IN ('Draft','Quotation','Confirmed') AND service_state='Running')";
      if (!table?.sql.includes(needle)) throw new Error('The subscription state constraint changed; review the lifecycle migration before continuing.');
      const rebuilt = table.sql.replace(/^CREATE TABLE\s+(?:"subscriptions"|`subscriptions`|\[subscriptions\]|subscriptions)\s*\(/i, 'CREATE TABLE subscriptions_v9 (')
        .replace(needle, "(stage IN ('Draft','Quotation') AND service_state='Running') OR (stage='Confirmed' AND service_state IN ('Running','TermEnded'))");
      if (rebuilt === table.sql || !rebuilt.includes('subscriptions_v9')) throw new Error('Could not prepare the lifecycle parent-table migration.');
      db.exec(rebuilt);
      db.exec('INSERT INTO subscriptions_v9 SELECT * FROM subscriptions; DROP TABLE subscriptions; ALTER TABLE subscriptions_v9 RENAME TO subscriptions;');
      for (const item of dependent) db.exec(item.sql);
      db.exec(`
        ALTER TABLE subscriptions ADD COLUMN closure_cause TEXT CHECK(closure_cause IS NULL OR closure_cause IN ('early','expiry'));
        ALTER TABLE subscriptions ADD COLUMN early_close_effective TEXT CHECK(early_close_effective IS NULL OR
          (length(early_close_effective)=10 AND early_close_effective BETWEEN '1900-01-01' AND '9999-12-31' AND date(early_close_effective) IS NOT NULL AND date(early_close_effective)=early_close_effective));
        CREATE TABLE lifecycle_events (
          id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL REFERENCES subscriptions(id), actor_id TEXT REFERENCES users(id),
          kind TEXT NOT NULL CHECK(kind IN ('pause','resume','closeEarly','closeTerm','renew','expiry','termEnded','addonEnabled','addonDisabled')),
          requested_date TEXT NOT NULL CHECK(length(requested_date)=10 AND requested_date BETWEEN '1900-01-01' AND '9999-12-31' AND date(requested_date) IS NOT NULL AND date(requested_date)=requested_date),
          effective_date TEXT NOT NULL CHECK(length(effective_date)=10 AND effective_date BETWEEN '1900-01-01' AND '9999-12-31' AND date(effective_date) IS NOT NULL AND date(effective_date)=effective_date),
          status TEXT NOT NULL CHECK(status IN ('scheduled','applied')), created_at TEXT NOT NULL, applied_at TEXT,
          line_id TEXT, enabled INTEGER CHECK(enabled IS NULL OR enabled IN (0,1)), previous_expiry TEXT, new_expiry TEXT,
          message TEXT NOT NULL CHECK(length(message)<=500),
          CHECK((status='scheduled' AND applied_at IS NULL) OR (status='applied' AND applied_at IS NOT NULL)),
          CHECK((kind IN ('addonEnabled','addonDisabled') AND line_id IS NOT NULL AND enabled IS NOT NULL) OR (kind NOT IN ('addonEnabled','addonDisabled') AND line_id IS NULL AND enabled IS NULL))
        ) STRICT;
        CREATE INDEX lifecycle_events_due ON lifecycle_events(status,effective_date,subscription_id);
        CREATE INDEX lifecycle_events_subscription ON lifecycle_events(subscription_id,effective_date,created_at,id);
        CREATE UNIQUE INDEX lifecycle_one_expiry_outcome ON lifecycle_events(subscription_id,kind,effective_date) WHERE kind IN ('expiry','termEnded');
        CREATE TABLE lifecycle_requests (
          idempotency_key TEXT PRIMARY KEY CHECK(length(idempotency_key)=36), actor_id TEXT NOT NULL REFERENCES users(id),
          subscription_id TEXT NOT NULL REFERENCES subscriptions(id), action TEXT NOT NULL, payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
          event_id TEXT NOT NULL REFERENCES lifecycle_events(id), created_at TEXT NOT NULL
        ) STRICT;
        CREATE TRIGGER lifecycle_event_facts_immutable BEFORE UPDATE OF subscription_id,actor_id,kind,requested_date,effective_date,created_at,line_id,enabled,previous_expiry,new_expiry,message ON lifecycle_events
          BEGIN SELECT RAISE(ABORT,'Recorded lifecycle intent and effective facts are immutable'); END;
        CREATE TRIGGER lifecycle_event_transition BEFORE UPDATE OF status ON lifecycle_events
          WHEN NEW.status<>OLD.status AND NOT (OLD.status='scheduled' AND NEW.status='applied')
          BEGIN SELECT RAISE(ABORT,'Applied lifecycle history cannot be reversed'); END;
        CREATE TRIGGER lifecycle_event_no_delete BEFORE DELETE ON lifecycle_events BEGIN SELECT RAISE(ABORT,'Lifecycle history cannot be deleted'); END;
        INSERT INTO schema_migrations VALUES(9,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      `);
      if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Lifecycle migration found a foreign-key inconsistency and was rolled back.');
    });
  } finally { db.exec('PRAGMA foreign_keys=ON'); }
}
