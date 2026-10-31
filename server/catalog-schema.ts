import type { DatabaseSync } from 'node:sqlite';
import { transaction } from './database.js';

export function migrateCatalog(db: DatabaseSync): void {
  transaction(db, () => {
    if (db.prepare('SELECT 1 FROM schema_migrations WHERE version=4').get()) return;
    db.exec(`
      CREATE TABLE products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 100),
        type TEXT NOT NULL CHECK(type IN ('software','service','addon')),
        sales_price INTEGER NOT NULL CHECK(sales_price BETWEEN 0 AND 1000000000000),
        cost_price INTEGER NOT NULL CHECK(cost_price BETWEEN 0 AND 1000000000000),
        notes TEXT NOT NULL CHECK(length(notes)<=2000),
        active INTEGER NOT NULL CHECK(active IN (0,1)),
        version INTEGER NOT NULL CHECK(version>=1),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX products_active_name ON products(active,name COLLATE NOCASE,id);
      CREATE TABLE product_variants (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id),
        name TEXT NOT NULL COLLATE NOCASE CHECK(length(trim(name)) BETWEEN 2 AND 100),
        adjustment INTEGER NOT NULL CHECK(adjustment BETWEEN -1000000000000 AND 1000000000000),
        active INTEGER NOT NULL CHECK(active IN (0,1)),
        UNIQUE(product_id,name), UNIQUE(product_id,id)
      ) STRICT;
      CREATE INDEX variants_product ON product_variants(product_id,active);
      CREATE TABLE plans (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 100),
        primary_product_id TEXT NOT NULL REFERENCES products(id),
        price INTEGER NOT NULL CHECK(price BETWEEN 0 AND 1000000000000),
        interval TEXT NOT NULL CHECK(interval IN ('daily','weekly','monthly','yearly')),
        min_quantity INTEGER NOT NULL CHECK(min_quantity BETWEEN 1 AND 10000),
        available_from TEXT CHECK(available_from IS NULL OR (length(available_from)=10 AND available_from BETWEEN '1900-01-01' AND '9999-12-31' AND date(available_from) IS NOT NULL AND date(available_from)=available_from)),
        available_to TEXT CHECK(available_to IS NULL OR (length(available_to)=10 AND available_to BETWEEN '1900-01-01' AND '9999-12-31' AND date(available_to) IS NOT NULL AND date(available_to)=available_to)),
        auto_close INTEGER NOT NULL CHECK(auto_close IN (0,1)),
        allow_pause INTEGER NOT NULL CHECK(allow_pause IN (0,1)),
        allow_renew INTEGER NOT NULL CHECK(allow_renew IN (0,1)),
        allow_early_close INTEGER NOT NULL CHECK(allow_early_close IN (0,1)),
        active INTEGER NOT NULL CHECK(active IN (0,1)),
        version INTEGER NOT NULL CHECK(version>=1),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        CHECK(available_from IS NULL OR available_to IS NULL OR available_from<=available_to)
      ) STRICT;
      CREATE INDEX plans_active_name ON plans(active,name COLLATE NOCASE,id);
      CREATE INDEX plans_primary_product ON plans(primary_product_id);
      CREATE TABLE tax_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 100),
        rate_bps INTEGER NOT NULL CHECK(rate_bps BETWEEN 0 AND 10000),
        product_id TEXT REFERENCES products(id),
        priority INTEGER NOT NULL CHECK(priority BETWEEN 0 AND 10000),
        active INTEGER NOT NULL CHECK(active IN (0,1)),
        version INTEGER NOT NULL CHECK(version>=1),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX taxes_selection ON tax_rules(active,priority,product_id,id);
      CREATE TABLE quotation_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 100),
        plan_id TEXT NOT NULL REFERENCES plans(id),
        valid_days INTEGER NOT NULL CHECK(valid_days BETWEEN 1 AND 3650),
        active INTEGER NOT NULL CHECK(active IN (0,1)),
        version INTEGER NOT NULL CHECK(version>=1),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX templates_active_name ON quotation_templates(active,name COLLATE NOCASE,id);
      CREATE INDEX templates_plan ON quotation_templates(plan_id);
      CREATE TABLE quotation_template_lines (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL REFERENCES quotation_templates(id),
        position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 49),
        product_id TEXT NOT NULL REFERENCES products(id),
        variant_id TEXT,
        quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 10000),
        UNIQUE(template_id,position),
        FOREIGN KEY(product_id,variant_id) REFERENCES product_variants(product_id,id)
      ) STRICT;
      CREATE INDEX template_lines_template ON quotation_template_lines(template_id,position);
      INSERT INTO schema_migrations VALUES(4,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    `);
  });
}
