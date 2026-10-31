import type { DatabaseSync } from 'node:sqlite';
import type { SubscriptionTerms } from '../shared/subscriptions.js';
import { transaction } from './database.js';
import { periodBoundary } from './calendar.js';

export function migrateBillingWorkbench(db: DatabaseSync): void {
  transaction(db, () => {
    if (db.prepare('SELECT 1 FROM schema_migrations WHERE version=7').get()) return;
    db.exec(`
      ALTER TABLE subscriptions ADD COLUMN next_billing_date TEXT CHECK(next_billing_date IS NULL OR
        (length(next_billing_date)=10 AND next_billing_date BETWEEN '1900-01-01' AND '9999-12-31' AND date(next_billing_date) IS NOT NULL AND date(next_billing_date)=next_billing_date));
      CREATE INDEX subscriptions_due_cursor ON subscriptions(next_billing_date,id) WHERE accepted_terms_json IS NOT NULL;
      CREATE TABLE billing_runs (
        id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, actor_id TEXT NOT NULL REFERENCES users(id),
        idempotency_key TEXT NOT NULL UNIQUE CHECK(length(idempotency_key)=36), payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
        requested_limit INTEGER NOT NULL CHECK(requested_limit BETWEEN 1 AND 500),
        scope_json TEXT CHECK(scope_json IS NULL OR (json_valid(scope_json) AND json_type(scope_json)='array')),
        retry_of TEXT REFERENCES billing_runs(id), fixed_items_json TEXT CHECK(fixed_items_json IS NULL OR (json_valid(fixed_items_json) AND json_type(fixed_items_json)='array')),
        status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed')),
        processed INTEGER NOT NULL DEFAULT 0 CHECK(processed BETWEEN 0 AND 500),
        created_count INTEGER NOT NULL DEFAULT 0 CHECK(created_count>=0), existing_count INTEGER NOT NULL DEFAULT 0 CHECK(existing_count>=0),
        nonbillable_count INTEGER NOT NULL DEFAULT 0 CHECK(nonbillable_count>=0), failed_count INTEGER NOT NULL DEFAULT 0 CHECK(failed_count>=0),
        remaining_due_subscriptions INTEGER NOT NULL DEFAULT 0 CHECK(remaining_due_subscriptions>=0),
        worker_token TEXT, claimed_at TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, error TEXT,
        CHECK(processed=created_count+existing_count+nonbillable_count+failed_count)
      ) STRICT;
      CREATE INDEX billing_runs_recovery ON billing_runs(status,claimed_at,id);
      CREATE TABLE billing_run_items (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES billing_runs(id), position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 500),
        subscription_id TEXT NOT NULL REFERENCES subscriptions(id), subscription_number TEXT NOT NULL, customer_name TEXT NOT NULL,
        period_start TEXT NOT NULL, period_end TEXT NOT NULL, generation_key TEXT NOT NULL UNIQUE CHECK(length(generation_key)=36),
        outcome TEXT NOT NULL CHECK(outcome IN ('processing','created','alreadyExisting','nonbillable','failed')),
        invoice_id TEXT REFERENCES invoices(id), logical_charge_id TEXT REFERENCES logical_charges(id), reason TEXT NOT NULL,
        retryable INTEGER NOT NULL CHECK(retryable IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(run_id,position), UNIQUE(run_id,subscription_id,period_start,period_end), CHECK(period_end>period_start)
      ) STRICT;
      CREATE INDEX billing_run_items_outcomes ON billing_run_items(run_id,outcome,position);
      CREATE TABLE invoice_replacement_requests (
        idempotency_key TEXT PRIMARY KEY CHECK(length(idempotency_key)=36), actor_id TEXT NOT NULL REFERENCES users(id),
        payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64), logical_charge_id TEXT NOT NULL REFERENCES logical_charges(id),
        predecessor_id TEXT NOT NULL REFERENCES invoices(id), created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE invoice_send_requests (
        idempotency_key TEXT PRIMARY KEY CHECK(length(idempotency_key)=36), actor_id TEXT NOT NULL REFERENCES users(id),
        invoice_id TEXT NOT NULL REFERENCES invoices(id), payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
        outbox_id TEXT NOT NULL UNIQUE REFERENCES outbox(id), created_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO schema_migrations VALUES(7,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    `);
    const rows = db.prepare('SELECT id,start_date,expiry_date,next_period_index,accepted_terms_json FROM subscriptions WHERE accepted_terms_json IS NOT NULL').all() as {
      id: string; start_date: string; expiry_date: string; next_period_index: number; accepted_terms_json: string;
    }[];
    const update = db.prepare('UPDATE subscriptions SET next_billing_date=? WHERE id=?');
    for (const row of rows) {
      const terms = JSON.parse(row.accepted_terms_json) as SubscriptionTerms;
      const date = periodBoundary(row.start_date, terms.plan.interval, row.next_period_index);
      update.run(date < row.expiry_date ? date : null, row.id);
    }
  });
}
