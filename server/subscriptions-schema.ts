import type { DatabaseSync } from 'node:sqlite';
import { transaction } from './database.js';

export function migrateSubscriptions(db: DatabaseSync): void {
  transaction(db, () => {
    if (db.prepare('SELECT 1 FROM schema_migrations WHERE version=5').get()) return;
    db.exec(`
      CREATE TABLE reference_counters (
        kind TEXT PRIMARY KEY, value INTEGER NOT NULL CHECK(value BETWEEN 1 AND 999999999999)
      ) STRICT;
      CREATE TABLE subscriptions (
        id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE,
        customer_id TEXT NOT NULL REFERENCES users(id), customer_name TEXT NOT NULL, customer_email TEXT NOT NULL,
        plan_id TEXT NOT NULL REFERENCES plans(id), template_id TEXT REFERENCES quotation_templates(id), template_name TEXT,
        start_date TEXT NOT NULL CHECK(length(start_date)=10 AND start_date BETWEEN '1900-01-01' AND '9999-12-31' AND date(start_date) IS NOT NULL AND date(start_date)=start_date),
        expiry_date TEXT NOT NULL CHECK(length(expiry_date)=10 AND expiry_date BETWEEN '1900-01-01' AND '9999-12-31' AND date(expiry_date) IS NOT NULL AND date(expiry_date)=expiry_date),
        term_periods INTEGER NOT NULL CHECK(term_periods BETWEEN 1 AND 100000),
        payment_term_days INTEGER NOT NULL CHECK(payment_term_days BETWEEN 0 AND 365),
        valid_days INTEGER NOT NULL CHECK(valid_days BETWEEN 1 AND 3650),
        stage TEXT NOT NULL CHECK(stage IN ('Draft','Quotation','Confirmed','Active','Closed')),
        service_state TEXT NOT NULL CHECK(service_state IN ('Running','Paused','TermEnded','Closed')),
        version INTEGER NOT NULL CHECK(version>=1),
        terms_json TEXT NOT NULL CHECK(json_valid(terms_json) AND json_type(terms_json)='object'),
        offered_terms_json TEXT CHECK(offered_terms_json IS NULL OR (json_valid(offered_terms_json) AND json_type(offered_terms_json)='object')),
        accepted_terms_json TEXT CHECK(accepted_terms_json IS NULL OR (json_valid(accepted_terms_json) AND json_type(accepted_terms_json)='object')),
        issued_date TEXT, valid_until TEXT, accepted_at TEXT,
        next_period_index INTEGER NOT NULL CHECK(next_period_index BETWEEN 0 AND 100000),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        CHECK(expiry_date>start_date),
        CHECK((stage='Closed' AND service_state='Closed') OR (stage='Active' AND service_state IN ('Running','Paused','TermEnded')) OR (stage IN ('Draft','Quotation','Confirmed') AND service_state='Running')),
        CHECK((stage='Draft' AND offered_terms_json IS NULL AND issued_date IS NULL AND valid_until IS NULL AND accepted_terms_json IS NULL AND accepted_at IS NULL)
          OR (stage='Quotation' AND offered_terms_json IS NOT NULL AND issued_date IS NOT NULL AND valid_until IS NOT NULL AND accepted_terms_json IS NULL AND accepted_at IS NULL)
          OR (stage IN ('Confirmed','Active','Closed') AND offered_terms_json IS NOT NULL AND issued_date IS NOT NULL AND valid_until IS NOT NULL AND accepted_terms_json IS NOT NULL AND accepted_at IS NOT NULL))
      ) STRICT;
      CREATE INDEX subscriptions_customer_created ON subscriptions(customer_id,created_at DESC,id);
      CREATE INDEX subscriptions_stage_start ON subscriptions(stage,start_date,id);
      CREATE INDEX subscriptions_plan ON subscriptions(plan_id);
      CREATE INDEX subscriptions_expiry ON subscriptions(stage,expiry_date,id);
      CREATE TABLE subscription_requests (
        idempotency_key TEXT PRIMARY KEY CHECK(length(idempotency_key)=36),
        actor_id TEXT NOT NULL REFERENCES users(id), payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
        subscription_id TEXT NOT NULL UNIQUE REFERENCES subscriptions(id), created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE subscription_history (
        id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL REFERENCES subscriptions(id), actor_id TEXT REFERENCES users(id),
        kind TEXT NOT NULL, created_at TEXT NOT NULL,
        from_stage TEXT CHECK(from_stage IS NULL OR from_stage IN ('Draft','Quotation','Confirmed','Active','Closed')),
        to_stage TEXT NOT NULL CHECK(to_stage IN ('Draft','Quotation','Confirmed','Active','Closed')),
        message TEXT NOT NULL CHECK(length(message)<=500), request_version INTEGER,
        UNIQUE(subscription_id,kind,request_version)
      ) STRICT;
      CREATE INDEX subscription_history_order ON subscription_history(subscription_id,created_at,id);
      CREATE TRIGGER subscription_offer_immutable BEFORE UPDATE OF terms_json,offered_terms_json ON subscriptions
        WHEN OLD.stage<>'Draft' AND (NEW.terms_json IS NOT OLD.terms_json OR NEW.offered_terms_json IS NOT OLD.offered_terms_json)
        BEGIN SELECT RAISE(ABORT,'Issued commercial terms are immutable'); END;
      CREATE TRIGGER subscription_accepted_immutable BEFORE UPDATE OF accepted_terms_json ON subscriptions
        WHEN OLD.accepted_terms_json IS NOT NULL AND NEW.accepted_terms_json IS NOT OLD.accepted_terms_json
        BEGIN SELECT RAISE(ABORT,'Accepted commercial terms are immutable'); END;
      CREATE TRIGGER subscription_commercial_immutable BEFORE UPDATE OF customer_id,customer_name,customer_email,plan_id,template_id,template_name,start_date,payment_term_days,valid_days ON subscriptions
        WHEN OLD.stage<>'Draft' AND (NEW.customer_id IS NOT OLD.customer_id OR NEW.customer_name IS NOT OLD.customer_name OR NEW.customer_email IS NOT OLD.customer_email
          OR NEW.plan_id IS NOT OLD.plan_id OR NEW.template_id IS NOT OLD.template_id OR NEW.template_name IS NOT OLD.template_name OR NEW.start_date IS NOT OLD.start_date
          OR NEW.payment_term_days IS NOT OLD.payment_term_days OR NEW.valid_days IS NOT OLD.valid_days)
        BEGIN SELECT RAISE(ABORT,'Issued commercial identity and terms are immutable'); END;
      CREATE TRIGGER subscription_issue_dates_immutable BEFORE UPDATE OF issued_date,valid_until,accepted_at ON subscriptions
        WHEN (OLD.issued_date IS NOT NULL AND (NEW.issued_date IS NOT OLD.issued_date OR NEW.valid_until IS NOT OLD.valid_until))
          OR (OLD.accepted_at IS NOT NULL AND NEW.accepted_at IS NOT OLD.accepted_at)
        BEGIN SELECT RAISE(ABORT,'Recorded agreement dates are immutable'); END;
      INSERT INTO schema_migrations VALUES(5,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    `);
  });
}
