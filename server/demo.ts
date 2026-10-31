import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import { buildNovemberDemo, type DemoSettlement } from './demo-fixture.js';
import { processLifecycleDue } from './lifecycle.js';

const args = process.argv.slice(2);
if (args.some(value => !/^--(?:settlement|port)=/.test(value))) throw new Error('Usage: npm run demo -- --settlement=settled|partial|unpaid --port=3003');
const settlement = args.find(value => value.startsWith('--settlement='))?.slice('--settlement='.length) || 'settled';
if (!['unpaid', 'partial', 'settled'].includes(settlement)) throw new Error('Choose --settlement=settled, partial or unpaid.');
const port = Number(args.find(value => value.startsWith('--port='))?.slice('--port='.length) || 3003);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Choose a valid local demo port.');
const assets = resolve('dist/client');
if (!existsSync(resolve(assets, 'index.html'))) throw new Error('Run npm run build before starting the November demo.');
const databasePath = resolve('data', `november-demo-${new Date().toISOString().replace(/[^0-9]/g, '')}-${randomUUID().slice(0, 8)}.sqlite`);
const appUrl = `http://localhost:${port}`;
const { app, clock } = await buildNovemberDemo(databasePath, { settlement: settlement as DemoSettlement, appUrl });
app.use(express.static(assets));
app.get('/{*path}', (_req, res) => res.sendFile(resolve(assets, 'index.html')));
let stopping = false;
const applyServiceChanges = () => {
  if (stopping) return;
  try { processLifecycleDue(app.locals.db, clock(), 100); }
  catch { console.error('Demo service processing needs review; saved history is preserved.'); }
};
const timer = setInterval(applyServiceChanges, 10000);
timer.unref();
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Synthetic November demo available at ${appUrl}`);
  console.log(`Business date: 9 November 2026. Settlement fixture: ${settlement}. No real email or money movement.`);
  console.log(`Fresh synthetic database retained at ${databasePath}`);
  console.log('Demo sign-in accounts and the walkthrough are in README.md.');
});
setImmediate(applyServiceChanges);
const close = async () => {
  await Promise.allSettled([app.locals.billingWorker.stop(), app.locals.deliverPending.stop()]);
  app.locals.db.close();
};
server.once('error', () => {
  stopping = true; clearInterval(timer);
  console.error('The demo could not bind its local port. Existing services and the synthetic database were preserved; choose another --port.');
  void close().finally(() => process.exit(1));
});
const shutdown = () => {
  if (stopping) return;
  stopping = true; clearInterval(timer);
  server.close(() => { void close().finally(() => process.exit(0)); });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
