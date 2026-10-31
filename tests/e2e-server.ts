import express from 'express';
import { resolve } from 'node:path';
import { createApp } from '../server/app.js';
import { seedDemo } from '../server/seed.js';
import type { AiQuoteOptions } from '../server/ai-quote.js';

// Deliberately never loads .env or real SMTP settings. Each test run has a fresh DB.
if (!process.env.E2E_DATABASE_PATH) throw new Error('Run through playwright.config.ts for an isolated test database.');
const stubFetch: NonNullable<AiQuoteOptions['fetch']> = async (_url, init) => {
  const body = JSON.parse(String(init?.body)) as { input: { content: string }[] };
  const data = JSON.parse(body.input[0].content) as { request: string; catalog: { products: { id: string; variants: { id: string }[] }[]; plans: { id: string; primaryProductId: string }[]; templates: { id: string; planId: string }[] } };
  if (/timeout/i.test(data.request)) return new Promise<Response>(() => {});
  if (/refusal/i.test(data.request)) return Response.json({ status: 'completed', usage: { input_tokens: 100, output_tokens: 20 }, output: [{ content: [{ type: 'refusal' }] }] });
  const plan = data.catalog.plans[0]; const product = data.catalog.products.find(item => item.id === plan?.primaryProductId);
  const template = /template/i.test(data.request) ? data.catalog.templates[0] : undefined;
  const fields = { schema_version: 'quote-proposal-v1', template_id: template?.id || null, plan_id: template?.planId || plan?.id || null, lines: !template && product ? [{ product_id: product.id, variant_id: product.variants[0]?.id || null, quantity: 2 }] : [], requested_start_date: '2026-11-01', clarifications: [] };
  return Response.json({ status: 'completed', usage: { input_tokens: 100, output_tokens: 50 }, output: [{ content: [{ type: 'output_text', text: JSON.stringify(/invalid/i.test(data.request) ? { ...fields, unit_price: 1 } : fields) }] }] });
};
const app = createApp({ databasePath: process.env.E2E_DATABASE_PATH, appUrl: 'http://localhost:3100', mailMode: 'outbox', production: true,
  aiQuote: { enabled: true, apiKey: 'synthetic-stub-only', budgetUsd: 5, fetch: stubFetch, timeoutMs: 300 } });
await seedDemo(app.locals.db);
const client = resolve('dist/client');
app.use(express.static(client));
app.get('/{*path}', (_req, res) => res.sendFile(resolve(client, 'index.html')));
const server = app.listen(3100, '127.0.0.1');
const stop = () => server.close(() => { app.locals.db.close(); process.exit(0); });
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
