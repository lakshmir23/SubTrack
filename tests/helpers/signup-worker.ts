import request from 'supertest';
import { createApp } from '../../server/app.js';
import type { DatabaseSync } from 'node:sqlite';

const app = await createApp({ databasePath: process.argv[2], mailMode: 'outbox' });
process.send?.({ type: 'ready' });
process.once('message', async () => {
  try {
    const response = await request(app).post('/api/auth/signup').send({
      name: 'Concurrent Customer', email: ' CONCURRENT@EXAMPLE.TEST ', password: 'Abcdefgh!',
    });
    process.send?.({ type: 'result', status: response.status, body: response.body });
  } catch (error) {
    process.send?.({ type: 'error', message: error instanceof Error ? error.message : 'Worker failed.' });
    process.exitCode = 1;
  } finally {
    await app.locals.billingWorker?.stop();
    await app.locals.deliverPending?.stop();
    (app.locals.db as DatabaseSync).close();
    process.disconnect();
  }
});
