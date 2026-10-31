import type { DatabaseSync } from 'node:sqlite';
import { transaction } from './database.js';

export function migratePayments(db: DatabaseSync): void {
  transaction(db, () => {
    if (db.prepare('SELECT 1 FROM schema_migrations WHERE version=8').get()) return;
    db.exec(`
      CREATE TABLE payments (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL REFERENCES invoices(id),
        amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 1000000000000),
        currency TEXT NOT NULL CHECK(currency='INR'),
        method TEXT NOT NULL CHECK(method IN ('bank_transfer','cash','card','cheque','other')),
        payment_date TEXT NOT NULL CHECK(length(payment_date)=10 AND payment_date BETWEEN '1900-01-01' AND '9999-12-31'
          AND date(payment_date) IS NOT NULL AND date(payment_date)=payment_date),
        note TEXT NOT NULL CHECK(length(note)<=2000),
        actor_id TEXT NOT NULL REFERENCES users(id),
        recorded_by_name TEXT NOT NULL CHECK(length(trim(recorded_by_name)) BETWEEN 2 AND 100),
        idempotency_key TEXT NOT NULL UNIQUE CHECK(length(idempotency_key)=36),
        payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX payments_invoice_date ON payments(invoice_id,payment_date,created_at,id);
      CREATE INDEX payments_event_date ON payments(payment_date,invoice_id,id);
      CREATE TRIGGER payment_allocation_guard BEFORE INSERT ON payments
        WHEN NOT EXISTS (
          SELECT 1 FROM invoices i JOIN logical_charges c ON c.id=i.logical_charge_id
          WHERE i.id=NEW.invoice_id AND c.current_invoice_id=i.id AND i.status='Confirmed' AND i.currency=NEW.currency
            AND i.amount_paid=coalesce((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id=i.id),0)
            AND i.payment_count=(SELECT count(*) FROM payments p WHERE p.invoice_id=i.id)
            AND i.amount_paid+NEW.amount<=i.total
        )
        BEGIN SELECT RAISE(ABORT,'Payment allocation requires a current confirmed invoice and cannot exceed its outstanding balance'); END;
      CREATE TRIGGER payment_apply_allocation AFTER INSERT ON payments
        BEGIN
          UPDATE invoices SET amount_paid=amount_paid+NEW.amount,payment_count=payment_count+1,
            status=CASE WHEN amount_paid+NEW.amount=total THEN 'Paid' ELSE 'Confirmed' END,
            settled_at=CASE WHEN amount_paid+NEW.amount=total THEN NEW.created_at ELSE NULL END,
            settlement_reason=CASE WHEN amount_paid+NEW.amount=total THEN 'fully paid' ELSE NULL END,
            version=version+1
          WHERE id=NEW.invoice_id;
        END;
      CREATE TRIGGER payment_no_update BEFORE UPDATE ON payments
        BEGIN SELECT RAISE(ABORT,'Recorded payments are immutable; corrections require a separate authorized reversal'); END;
      CREATE TRIGGER payment_no_delete BEFORE DELETE ON payments
        BEGIN SELECT RAISE(ABORT,'Recorded payment history cannot be deleted'); END;
      INSERT INTO schema_migrations VALUES(8,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    `);
  });
}

/** Forward-only hardening for databases that already ran the initial payment migration. */
export function migratePaymentFactsGuard(db: DatabaseSync): void {
  transaction(db, () => {
    if (db.prepare('SELECT 1 FROM schema_migrations WHERE version=10').get()) return;
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS invoice_payment_facts_guard BEFORE UPDATE OF amount_paid,payment_count,status ON invoices
        WHEN EXISTS (SELECT 1 FROM payments WHERE invoice_id=OLD.id) AND (
          NEW.amount_paid<>(SELECT sum(amount) FROM payments WHERE invoice_id=OLD.id)
          OR NEW.payment_count<>(SELECT count(*) FROM payments WHERE invoice_id=OLD.id)
          OR NEW.status IN ('Draft','Canceled')
        )
        BEGIN SELECT RAISE(ABORT,'Invoice allocations must match immutable payment facts'); END;
      INSERT INTO schema_migrations VALUES(10,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    `);
  });
}
