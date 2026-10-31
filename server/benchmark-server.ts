import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import { createApp } from './app.js';
import { processLifecycleDue } from './lifecycle.js';
import type { BenchmarkManifest } from './benchmark-data.js';
import { performance } from 'node:perf_hooks';

// Separate process: synchronous database work cannot share the timing driver's loop.
const [manifestPath, databasePath, portText] = process.argv.slice(2);
if (!manifestPath || !databasePath || !portText) throw new Error('The benchmark server requires manifest, isolated runtime database and port.');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BenchmarkManifest;
const port = Number(portText);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid benchmark port.');
const assets = resolve('dist/client');
if (!existsSync(resolve(assets, 'index.html'))) throw new Error('Build production assets before benchmarking.');
const clock = () => new Date(manifest.instant);
const app = createApp({ databasePath, clock, appUrl: `http://localhost:${port}`, production: true, mailMode: 'outbox', demoLabel: 'Synthetic performance fixture · 9 November 2026' });
app.use(express.static(assets));
app.get('/{*path}', (_req, res) => res.sendFile(resolve(assets, 'index.html')));
let stopping = false;
const apply = () => {
  if (stopping) return;
  const startedAt = new Date().toISOString(); const start = performance.now();
  processLifecycleDue(app.locals.db, clock(), 100);
  process.send?.({ type: 'benchmark-job', kind: 'lifecycle', startedAt, milliseconds: performance.now() - start });
};
const timer = setInterval(apply, 10000);
timer.unref();
const server = app.listen(port, '127.0.0.1', () => { apply(); console.log('BENCHMARK_READY'); });
const shutdown = () => {
  if (stopping) return;
  stopping = true; clearInterval(timer);
  server.close(() => { void Promise.allSettled([app.locals.billingWorker.stop(), app.locals.deliverPending.stop()]).then(() => { app.locals.db.close(); process.exit(0); }); });
};
server.once('error', error => { console.error(error.message); shutdown(); });
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('message', message => { if (message === 'shutdown') shutdown(); });
