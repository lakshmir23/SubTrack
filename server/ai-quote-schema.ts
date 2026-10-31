import type { DatabaseSync } from 'node:sqlite';
import { transaction } from './database.js';
export function migrateAiQuotes(db: DatabaseSync): void {
  transaction(db, () => {
    if (db.prepare('SELECT 1 FROM schema_migrations WHERE version=12').get()) return;
    db.exec(`
      CREATE TABLE ai_quote_requests (
        id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES users(id),customer_id TEXT NOT NULL REFERENCES users(id),
        status TEXT NOT NULL CHECK(status IN ('inflight','succeeded','failed','unknown')),
        reserved_microusd INTEGER NOT NULL CHECK(reserved_microusd=20000),
        charged_microusd INTEGER CHECK(charged_microusd BETWEEN 0 AND reserved_microusd),
        input_tokens INTEGER,output_tokens INTEGER,outcome_code TEXT,latency_ms INTEGER,
        created_at TEXT NOT NULL,finished_at TEXT,
        CHECK((status='inflight' AND charged_microusd IS NULL AND finished_at IS NULL) OR (status<>'inflight' AND charged_microusd IS NOT NULL AND finished_at IS NOT NULL))
      ) STRICT;
      CREATE INDEX ai_quote_actor_recent ON ai_quote_requests(actor_id,created_at,status);
      CREATE TABLE ai_quote_proposals (
        id TEXT PRIMARY KEY REFERENCES ai_quote_requests(id),actor_id TEXT NOT NULL REFERENCES users(id),customer_id TEXT NOT NULL REFERENCES users(id),
        proposal_json TEXT NOT NULL CHECK(json_valid(proposal_json)),labels_json TEXT NOT NULL CHECK(json_valid(labels_json)),created_at TEXT NOT NULL,expires_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE ai_quote_reviews (
        review_hash TEXT PRIMARY KEY CHECK(length(review_hash)=64),proposal_id TEXT NOT NULL REFERENCES ai_quote_proposals(id),
        actor_id TEXT NOT NULL REFERENCES users(id),customer_id TEXT NOT NULL REFERENCES users(id),preview_hash TEXT NOT NULL CHECK(length(preview_hash)=64),created_at TEXT NOT NULL,expires_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO schema_migrations VALUES(12,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    `);
  });
}
