import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './password.js';
import { transaction } from './database.js';

export async function seedDemo(db: DatabaseSync): Promise<void> {
  const passwordHash = await hashPassword('Brightloop!2026');
  transaction(db, () => {
    const insert = db.prepare('INSERT OR IGNORE INTO users (id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)');
    for (const [name, email, role] of [
      ['Alex Morgan', 'admin@brightloop.test', 'admin'],
      ['Sam Rivera', 'staff@brightloop.test', 'staff'],
      ['Maya Shah', 'maya@brightloop.test', 'customer'],
      ['Arun Nair', 'arun@brightloop.test', 'customer'],
    ]) {
      const existing = db.prepare('SELECT role FROM users WHERE email=?').get(email);
      if (existing && existing.role !== role) throw new Error('A reserved synthetic email is already assigned to a different role. Seed canceled; existing accounts were preserved. Use a fresh demo database.');
      insert.run(randomUUID(), name, email, passwordHash, role, new Date().toISOString());
    }
  });
}
