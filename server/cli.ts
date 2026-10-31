import { config } from './config.js';
import { openDatabase } from './database.js';
import { seedDemo } from './seed.js';

const settings = config();
const db = openDatabase(settings.databasePath);
try {
  const command = process.argv[2];
  if (command === 'seed') { await seedDemo(db); console.log('Synthetic demo identities seeded. Existing accounts were preserved.'); }
  else if (command === 'migrate') console.log(`Database schema version ${String(db.prepare('SELECT max(version) AS version FROM schema_migrations').get()?.version)} applied.`);
  else throw new Error('Usage: npm run db:migrate or npm run db:seed');
} finally { db.close(); }
