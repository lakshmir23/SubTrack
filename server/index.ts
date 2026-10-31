import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';
import { createApp } from './app.js';
import express from 'express';

const settings = config();
const production = process.env.NODE_ENV === 'production' || process.argv.includes('--production');
const app = createApp({ ...settings, production });
const productionAssets = resolve('dist/client');
if (production) {
  if (!existsSync(resolve(productionAssets, 'index.html'))) throw new Error('Run npm run build before starting production.');
  app.use(express.static(productionAssets));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve(productionAssets, 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
const server = app.listen(settings.port, '127.0.0.1', () => {
  console.log(`SubTrack available at ${settings.appUrl}`);
});
const mailTimer = setInterval(() => { void app.locals.deliverPending().catch(() => console.error('Email worker interrupted. Check delivery status before requesting another message.')); }, 1000);
mailTimer.unref();
let stopping = false;
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  clearInterval(mailTimer);
  server.close(() => {
    void Promise.allSettled([
      Promise.resolve().then(() => app.locals.deliverPending.stop()),
      Promise.resolve().then(() => app.locals.billingWorker.stop()),
    ]).then(results => {
      const failed = results.some(result => result.status === 'rejected');
      if (failed) console.error('A worker stopped with an error. Review persisted delivery and billing outcomes before retrying.');
      app.locals.db.close();
      process.exit(failed ? 1 : 0);
    });
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
