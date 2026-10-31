import type { DatabaseSync } from 'node:sqlite';
import { transaction } from './database.js';

/** P8 measured global lists sorted wide snapshots without a matching order index. */
export function migrateMeasuredListIndexes(db: DatabaseSync): void {
  transaction(db, () => {
    if (db.prepare('SELECT 1 FROM schema_migrations WHERE version=11').get()) return;
    db.exec(`
      CREATE INDEX subscriptions_created_page ON subscriptions(created_at DESC,id);
      CREATE INDEX invoices_created_page ON invoices(created_at DESC,id);
      INSERT INTO schema_migrations VALUES(11,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    `);
  });
}
