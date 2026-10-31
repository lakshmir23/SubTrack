import express from 'express';
import { resolve } from 'node:path';
import { createApp } from '../server/app.js';
import { seedDemo } from '../server/seed.js';

// Deliberately never loads .env or real SMTP settings. Each test run has a fresh DB.
if (!process.env.E2E_DATABASE_PATH) throw new Error('Run through playwright.config.ts for an isolated test database.');
const app = createApp({ databasePath: process.env.E2E_DATABASE_PATH, appUrl: 'http://localhost:3100', mailMode: 'outbox', production: true });
await seedDemo(app.locals.db);
const client = resolve('dist/client');
app.use(express.static(client));
app.get('/{*path}', (_req, res) => res.sendFile(resolve(client, 'index.html')));
const server = app.listen(3100, '127.0.0.1');
const stop = () => server.close(() => { app.locals.db.close(); process.exit(0); });
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
