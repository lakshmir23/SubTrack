import { test as base, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { basename, dirname, resolve, sep } from 'node:path';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';

// Each journey gets an independent abuse window. Production limits and attempts
// within each journey are unchanged; only this guarded synthetic DB is touched.
export const test = base.extend<{ _rateWindow: void }>({
  _rateWindow: [async ({ baseURL }, use) => {
    const path = process.env.E2E_DATABASE_PATH;
    if (!path || baseURL !== 'http://localhost:3100') throw new Error('The browser suite requires its isolated local test server.');
    const actual = realpathSync(path);
    const parent = dirname(actual);
    if (basename(actual) !== 'test.sqlite' || !basename(parent).startsWith('subtrack-e2e-') || !parent.toLowerCase().startsWith(`${resolve(tmpdir()).toLowerCase()}${sep}`)) throw new Error('Refusing to change rate counters outside the isolated temporary browser fixture.');
    const db = new DatabaseSync(actual);
    try { db.exec('PRAGMA busy_timeout=1000; DELETE FROM auth_limits;'); }
    finally { db.close(); }
    await use();
  }, { auto: true }],
});
export { expect };
