import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadEnvironment(): void {
  if (existsSync(resolve('.env'))) process.loadEnvFile(resolve('.env'));
}
export function config() {
  loadEnvironment();
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  if (process.env.MAIL_MODE && !['smtp', 'outbox'].includes(process.env.MAIL_MODE)) throw new Error('MAIL_MODE must be smtp or outbox.');
  return { port, databasePath: resolve(process.env.DATABASE_PATH || './data/subtrack.sqlite'), appUrl: process.env.APP_ORIGIN || `http://localhost:${port}`,
    aiQuote: { enabled: process.env.AI_QUOTE_ENABLED === 'true', apiKey: process.env.OPENAI_API_KEY, budgetUsd: Number(process.env.AI_QUOTE_BUDGET_USD || 0) },
    mailConfig: { mode: (process.env.MAIL_MODE || 'outbox') as 'smtp' | 'outbox', host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true', user: process.env.SMTP_USER, password: process.env.SMTP_PASSWORD, from: process.env.MAIL_FROM, allowedRecipients: (process.env.MAIL_ALLOWED_RECIPIENTS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean) },
  };
}
