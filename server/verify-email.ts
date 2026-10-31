import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { config } from './config.js';
import { openDatabase } from './database.js';
import { emailSchema } from '../shared/validation.js';

// An explicit controlled-delivery command, never part of automated regression.
if (!process.argv.includes('--send-reset')) throw new Error('This command requires --send-reset and sends a real test email.');
const settings = config();
if (settings.mailConfig.mode !== 'smtp') throw new Error('Set MAIL_MODE=smtp before running this explicit delivery check.');
const recipient = emailSchema.parse(settings.mailConfig.allowedRecipients[0]);
const db = openDatabase(settings.databasePath);
try {
  const existing = db.prepare('SELECT id FROM users WHERE email=?').get(recipient);
  if (!existing) {
    const response = await fetch(`${settings.appUrl}/api/auth/signup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Controlled delivery test', email: recipient, password: `Verify!${randomBytes(24).toString('hex')}` }),
    });
    if (!response.ok) throw new Error('Could not register the approved delivery-test account. No email test was performed.');
  }
  const previous = db.prepare('SELECT count(*) AS count FROM outbox WHERE recipient=?').get(recipient)?.count;
  const response = await fetch(`${settings.appUrl}/api/auth/forgot-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: recipient }) });
  if (!response.ok) throw new Error('The reset request failed. No delivery claim is made.');
  const next = db.prepare('SELECT count(*) AS count FROM outbox WHERE recipient=?').get(recipient)?.count;
  if (next === previous) throw new Error('No new reset message was generated. Check the registered test account.');
  const row = db.prepare('SELECT id FROM outbox WHERE recipient=? ORDER BY rowid DESC LIMIT 1').get(recipient)!;
  let status = 'generated';
  let issue: string | null = null;
  for (let attempt = 0; attempt < 45; attempt++) {
    const result = db.prepare('SELECT status,error FROM outbox WHERE id=?').get(row.id)!;
    status = String(result.status);
    issue = result.error ? String(result.error) : null;
    if (status !== 'generated') break;
    await delay(1000);
  }
  console.log(JSON.stringify({ messageId: row.id, kind: 'password_reset', registeredRecipient: true, status, issue, inboxArrivalVerified: false }));
  if (status !== 'accepted') process.exitCode = 1;
} finally { db.close(); }
