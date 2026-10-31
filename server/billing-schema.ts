import type { DatabaseSync } from 'node:sqlite';
import { transaction } from './database.js';

export function migrateBilling(db: DatabaseSync): void {
  transaction(db, () => {
    if (db.prepare('SELECT 1 FROM schema_migrations WHERE version=6').get()) return;
    db.exec(`
      CREATE TABLE discount_rules (
        id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 100),
        kind TEXT NOT NULL CHECK(kind IN ('fixed','percentage')),
        amount_minor INTEGER CHECK(amount_minor BETWEEN 0 AND 1000000000000), percent_bps INTEGER CHECK(percent_bps BETWEEN 0 AND 10000),
        min_amount INTEGER CHECK(min_amount BETWEEN 0 AND 1000000000000), min_quantity INTEGER CHECK(min_quantity BETWEEN 1 AND 500000),
        start_date TEXT CHECK(start_date IS NULL OR (length(start_date)=10 AND start_date BETWEEN '1900-01-01' AND '9999-12-31' AND date(start_date) IS NOT NULL AND date(start_date)=start_date)),
        end_date TEXT CHECK(end_date IS NULL OR (length(end_date)=10 AND end_date BETWEEN '1900-01-01' AND '9999-12-31' AND date(end_date) IS NOT NULL AND date(end_date)=end_date)),
        max_uses INTEGER CHECK(max_uses BETWEEN 1 AND 1000000000), priority INTEGER NOT NULL CHECK(priority BETWEEN 0 AND 10000),
        active INTEGER NOT NULL CHECK(active IN (0,1)), scope TEXT NOT NULL CHECK(scope IN ('subscription','products')),
        subscription_id TEXT REFERENCES subscriptions(id), version INTEGER NOT NULL CHECK(version>=1), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        CHECK((kind='fixed' AND amount_minor IS NOT NULL AND percent_bps IS NULL) OR (kind='percentage' AND percent_bps IS NOT NULL AND amount_minor IS NULL)),
        CHECK(start_date IS NULL OR end_date IS NULL OR start_date<=end_date)
      ) STRICT;
      CREATE INDEX discounts_selection ON discount_rules(active,priority,id);
      CREATE INDEX discounts_subscription ON discount_rules(subscription_id);
      CREATE TABLE discount_targets (
        rule_id TEXT NOT NULL REFERENCES discount_rules(id), product_id TEXT NOT NULL REFERENCES products(id), PRIMARY KEY(rule_id,product_id)
      ) STRICT;
      CREATE TABLE logical_charges (
        id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
        period_start TEXT NOT NULL CHECK(length(period_start)=10 AND period_start BETWEEN '1900-01-01' AND '9999-12-31' AND date(period_start) IS NOT NULL AND date(period_start)=period_start),
        period_end TEXT NOT NULL CHECK(length(period_end)=10 AND period_end BETWEEN '1900-01-01' AND '9999-12-31' AND date(period_end) IS NOT NULL AND date(period_end)=period_end),
        kind TEXT NOT NULL CHECK(kind='recurring'), outcome TEXT NOT NULL CHECK(outcome IN ('invoiced','nonbillable','failed')), reason TEXT,
        current_invoice_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(subscription_id,period_start,period_end,kind), UNIQUE(id,subscription_id,period_start,period_end),
        FOREIGN KEY(id,current_invoice_id) REFERENCES invoices(logical_charge_id,id),
        CHECK(period_end>period_start), CHECK(outcome<>'invoiced' OR current_invoice_id IS NOT NULL)
      ) STRICT;
      CREATE INDEX charges_subscription_period ON logical_charges(subscription_id,period_start);
      CREATE INDEX charges_outcome ON logical_charges(outcome,period_start,id);
      CREATE TABLE invoices (
        id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, logical_charge_id TEXT NOT NULL REFERENCES logical_charges(id),
        revision_number INTEGER NOT NULL CHECK(revision_number>=1), predecessor_id TEXT REFERENCES invoices(id),
        subscription_id TEXT NOT NULL REFERENCES subscriptions(id), subscription_number TEXT NOT NULL,
        customer_id TEXT NOT NULL REFERENCES users(id), customer_name TEXT NOT NULL, customer_email TEXT NOT NULL,
        period_start TEXT NOT NULL, period_end TEXT NOT NULL,
        issue_date TEXT NOT NULL CHECK(length(issue_date)=10 AND issue_date BETWEEN '1900-01-01' AND '9999-12-31' AND date(issue_date) IS NOT NULL AND date(issue_date)=issue_date),
        due_date TEXT NOT NULL CHECK(length(due_date)=10 AND due_date BETWEEN '1900-01-01' AND '9999-12-31' AND date(due_date) IS NOT NULL AND date(due_date)=due_date),
        currency TEXT NOT NULL CHECK(currency='INR'), status TEXT NOT NULL CHECK(status IN ('Draft','Confirmed','Paid','Canceled')),
        subtotal INTEGER NOT NULL CHECK(subtotal BETWEEN 0 AND 1000000000000),
        discount INTEGER NOT NULL CHECK(discount BETWEEN 0 AND subtotal), tax INTEGER NOT NULL CHECK(tax BETWEEN 0 AND 1000000000000),
        total INTEGER NOT NULL CHECK(total BETWEEN 0 AND 1000000000000 AND total=subtotal-discount+tax),
        amount_paid INTEGER NOT NULL CHECK(amount_paid BETWEEN 0 AND total), payment_count INTEGER NOT NULL CHECK(payment_count>=0),
        discount_snapshot_json TEXT CHECK(discount_snapshot_json IS NULL OR (json_valid(discount_snapshot_json) AND json_type(discount_snapshot_json)='object')),
        discount_reason TEXT NOT NULL, discount_decisions_json TEXT NOT NULL CHECK(json_valid(discount_decisions_json) AND json_type(discount_decisions_json)='array'),
        discount_decisions_truncated INTEGER NOT NULL CHECK(discount_decisions_truncated IN (0,1)),
        version INTEGER NOT NULL CHECK(version>=1), created_at TEXT NOT NULL, confirmed_at TEXT, canceled_at TEXT, settled_at TEXT, settlement_reason TEXT,
        UNIQUE(logical_charge_id,revision_number), UNIQUE(logical_charge_id,id),
        FOREIGN KEY(logical_charge_id,subscription_id,period_start,period_end) REFERENCES logical_charges(id,subscription_id,period_start,period_end),
        CHECK(period_end>period_start AND due_date>=issue_date),
        CHECK((amount_paid=0 AND payment_count=0) OR (amount_paid>0 AND payment_count>0)),
        CHECK((status IN ('Draft','Canceled') AND amount_paid=0 AND payment_count=0) OR (status='Confirmed' AND amount_paid<total) OR (status='Paid' AND amount_paid=total)),
        CHECK((status='Draft' AND confirmed_at IS NULL AND canceled_at IS NULL AND settled_at IS NULL)
          OR (status='Confirmed' AND confirmed_at IS NOT NULL AND canceled_at IS NULL AND settled_at IS NULL)
          OR (status='Paid' AND confirmed_at IS NOT NULL AND canceled_at IS NULL AND settled_at IS NOT NULL AND settlement_reason IS NOT NULL)
          OR (status='Canceled' AND canceled_at IS NOT NULL AND settled_at IS NULL))
      ) STRICT;
      CREATE UNIQUE INDEX one_live_invoice_per_charge ON invoices(logical_charge_id) WHERE status<>'Canceled';
      CREATE INDEX invoices_customer_created ON invoices(customer_id,created_at DESC,id);
      CREATE INDEX invoices_status_due ON invoices(status,due_date,id);
      CREATE INDEX invoices_subscription ON invoices(subscription_id,period_start,id);
      CREATE INDEX invoices_issue ON invoices(issue_date,id);
      CREATE TABLE invoice_lines (
        id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id), position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 49),
        subscription_line_id TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES products(id), product_name TEXT NOT NULL,
        variant_id TEXT, variant_name TEXT, quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 10000),
        base_unit_price INTEGER NOT NULL CHECK(base_unit_price BETWEEN 0 AND 1000000000000),
        variant_adjustment INTEGER NOT NULL CHECK(variant_adjustment BETWEEN -1000000000000 AND 1000000000000),
        unit_price INTEGER NOT NULL CHECK(unit_price BETWEEN 0 AND 1000000000000 AND unit_price=base_unit_price+variant_adjustment),
        subtotal INTEGER NOT NULL CHECK(subtotal BETWEEN 0 AND 1000000000000 AND subtotal=unit_price*quantity),
        discount INTEGER NOT NULL CHECK(discount BETWEEN 0 AND subtotal), taxable_amount INTEGER NOT NULL CHECK(taxable_amount=subtotal-discount),
        tax_rule_id TEXT REFERENCES tax_rules(id), tax_rule_name TEXT, tax_rule_version INTEGER,
        tax_rate_bps INTEGER NOT NULL CHECK(tax_rate_bps BETWEEN 0 AND 10000),
        tax INTEGER NOT NULL CHECK(tax BETWEEN 0 AND 1000000000000 AND tax=(taxable_amount*tax_rate_bps+5000)/10000),
        total INTEGER NOT NULL CHECK(total BETWEEN 0 AND 1000000000000 AND total=taxable_amount+tax),
        UNIQUE(invoice_id,position), UNIQUE(invoice_id,subscription_line_id),
        FOREIGN KEY(product_id,variant_id) REFERENCES product_variants(product_id,id)
      ) STRICT;
      CREATE INDEX invoice_lines_invoice ON invoice_lines(invoice_id,position);
      CREATE TABLE discount_applications (
        id TEXT PRIMARY KEY, rule_id TEXT NOT NULL REFERENCES discount_rules(id), invoice_id TEXT NOT NULL UNIQUE REFERENCES invoices(id),
        rule_version INTEGER NOT NULL CHECK(rule_version>=1), state TEXT NOT NULL CHECK(state IN ('reserved','consumed','released')),
        amount INTEGER NOT NULL CHECK(amount BETWEEN 0 AND 1000000000000), created_at TEXT NOT NULL, consumed_at TEXT, released_at TEXT,
        CHECK((state='reserved' AND consumed_at IS NULL AND released_at IS NULL) OR (state='consumed' AND consumed_at IS NOT NULL AND released_at IS NULL) OR (state='released' AND consumed_at IS NULL AND released_at IS NOT NULL))
      ) STRICT;
      CREATE INDEX discount_applications_usage ON discount_applications(rule_id,state,invoice_id);
      CREATE TABLE invoice_generation_requests (
        idempotency_key TEXT PRIMARY KEY CHECK(length(idempotency_key)=36), actor_id TEXT NOT NULL REFERENCES users(id),
        payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64), logical_charge_id TEXT NOT NULL REFERENCES logical_charges(id), created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE invoice_history (
        id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id), actor_id TEXT REFERENCES users(id), kind TEXT NOT NULL,
        created_at TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL, message TEXT NOT NULL CHECK(length(message)<=500), request_version INTEGER,
        UNIQUE(invoice_id,kind,request_version)
      ) STRICT;
      CREATE INDEX invoice_history_invoice ON invoice_history(invoice_id,created_at,id);
      CREATE TRIGGER invoice_financial_snapshot_immutable BEFORE UPDATE OF number,logical_charge_id,revision_number,predecessor_id,subscription_id,subscription_number,
        customer_id,customer_name,customer_email,period_start,period_end,issue_date,due_date,currency,subtotal,discount,tax,total,discount_snapshot_json,discount_reason,discount_decisions_json,discount_decisions_truncated,created_at ON invoices
        BEGIN SELECT RAISE(ABORT,'Generated invoice financial snapshots are immutable'); END;
      CREATE TRIGGER invoice_no_delete BEFORE DELETE ON invoices BEGIN SELECT RAISE(ABORT,'Invoice history cannot be deleted'); END;
      CREATE TRIGGER invoice_line_no_update BEFORE UPDATE ON invoice_lines BEGIN SELECT RAISE(ABORT,'Generated invoice lines are immutable'); END;
      CREATE TRIGGER invoice_line_no_delete BEFORE DELETE ON invoice_lines BEGIN SELECT RAISE(ABORT,'Generated invoice lines cannot be deleted'); END;
      CREATE TRIGGER invoice_no_paid_cancel BEFORE UPDATE OF status ON invoices
        WHEN NEW.status='Canceled' AND (OLD.status='Paid' OR OLD.payment_count>0 OR OLD.amount_paid>0)
        BEGIN SELECT RAISE(ABORT,'A settled or paid-into invoice cannot be canceled'); END;
      CREATE TRIGGER invoice_confirmation_date_immutable BEFORE UPDATE OF confirmed_at ON invoices
        WHEN OLD.confirmed_at IS NOT NULL AND NEW.confirmed_at IS NOT OLD.confirmed_at
        BEGIN SELECT RAISE(ABORT,'Invoice confirmation date is immutable'); END;
      CREATE TRIGGER charge_identity_immutable BEFORE UPDATE OF subscription_id,period_start,period_end,kind ON logical_charges
        BEGIN SELECT RAISE(ABORT,'Logical charge identity is immutable'); END;
      CREATE TRIGGER charge_no_delete BEFORE DELETE ON logical_charges BEGIN SELECT RAISE(ABORT,'Logical charge history cannot be deleted'); END;
      CREATE TRIGGER discount_capacity_insert BEFORE INSERT ON discount_applications
        WHEN NEW.state IN ('reserved','consumed') AND (SELECT max_uses FROM discount_rules WHERE id=NEW.rule_id) IS NOT NULL
          AND (SELECT count(*) FROM discount_applications WHERE rule_id=NEW.rule_id AND state IN ('reserved','consumed')) >= (SELECT max_uses FROM discount_rules WHERE id=NEW.rule_id)
        BEGIN SELECT RAISE(ABORT,'Discount usage limit exhausted'); END;
      CREATE TRIGGER discount_limit_update BEFORE UPDATE OF max_uses ON discount_rules
        WHEN NEW.max_uses IS NOT NULL AND NEW.max_uses < (SELECT count(*) FROM discount_applications WHERE rule_id=OLD.id AND state IN ('reserved','consumed'))
        BEGIN SELECT RAISE(ABORT,'Discount limit is below its reserved and consumed uses'); END;
      CREATE TRIGGER discount_application_immutable BEFORE UPDATE OF rule_id,invoice_id,rule_version,amount,created_at ON discount_applications
        BEGIN SELECT RAISE(ABORT,'Saved discount applications are immutable'); END;
      CREATE TRIGGER discount_application_transition BEFORE UPDATE OF state ON discount_applications
        WHEN NEW.state<>OLD.state AND NOT (OLD.state='reserved' AND NEW.state IN ('consumed','released'))
        BEGIN SELECT RAISE(ABORT,'Discount usage cannot be replayed or restored'); END;
      CREATE TRIGGER discount_application_no_delete BEFORE DELETE ON discount_applications BEGIN SELECT RAISE(ABORT,'Discount application history cannot be deleted'); END;
      INSERT INTO schema_migrations VALUES(6,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    `);
  });
}
