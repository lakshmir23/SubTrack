import type { DatabaseSync } from 'node:sqlite';
import nodemailer from 'nodemailer';
import { transaction } from './database.js';

export interface MailConfig {
  mode: 'outbox' | 'smtp'; host?: string; port?: number; secure?: boolean;
  user?: string; password?: string; from?: string; allowedRecipients?: string[];
}
export function createMailDelivery(db: DatabaseSync, config: MailConfig) {
  let current: Promise<void> | null = null;
  let stopping = false;
  async function run() {
    db.prepare("UPDATE outbox SET status='unknown',error=? WHERE status='generated' AND claimed_at IS NOT NULL AND claimed_at < ?").run('Delivery was interrupted. The message may have been accepted; request a new reset link if needed.', new Date(Date.now() - 2 * 60 * 1000).toISOString());
      for (let index = 0; index < 10; index++) {
        if (stopping) break;
        const message = transaction(db, () => {
          const row = db.prepare("SELECT id,recipient,subject,body FROM outbox WHERE status='generated' AND claimed_at IS NULL ORDER BY created_at,id LIMIT 1").get() as { id: string; recipient: string; subject: string; body: string } | undefined;
          if (row) db.prepare('UPDATE outbox SET claimed_at=? WHERE id=?').run(new Date().toISOString(), row.id);
          return row;
        });
        if (!message) break;
        try {
          if (!config.host || !config.from || !config.user || !config.password) throw new Error('CONFIG');
          if (!config.allowedRecipients?.includes(message.recipient)) throw new Error('RECIPIENT');
          const transport = nodemailer.createTransport({
            host: config.host, port: config.port || 587, secure: config.secure || false,
            requireTLS: !config.secure, auth: { user: config.user, pass: config.password },
            connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
            disableFileAccess: true, disableUrlAccess: true,
          });
          try {
            const result = await transport.sendMail({
              from: { name: 'Brightloop · SubTrack', address: config.from },
              to: { address: message.recipient, name: '' }, subject: message.subject, text: message.body,
              disableFileAccess: true, disableUrlAccess: true,
            });
            if (!result.accepted.includes(message.recipient)) throw new Error('REJECTED');
            db.prepare("UPDATE outbox SET status='accepted',error=NULL,provider_id=? WHERE id=?").run(String(result.messageId), message.id);
          } finally { transport.close(); }
        } catch (error) {
          const reason = error instanceof Error && error.message === 'RECIPIENT' ? 'Recipient is not in the approved test allowlist.' : error instanceof Error && error.message === 'CONFIG' ? 'SMTP configuration is incomplete.' : 'SMTP delivery failed. Verify the test account configuration and request a new message.';
          db.prepare("UPDATE outbox SET status='failed',error=? WHERE id=?").run(reason, message.id);
        }
      }
  }
  const deliverPending = () => {
    if (current) return current;
    if (stopping || config.mode !== 'smtp') return Promise.resolve();
    current = run().finally(() => { current = null; });
    return current;
  };
  return Object.assign(deliverPending, { stop: () => { stopping = true; return current || Promise.resolve(); } });
}
