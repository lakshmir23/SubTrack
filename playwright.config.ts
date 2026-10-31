import { defineConfig, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.E2E_DATABASE_PATH ||= join(tmpdir(), `subtrack-e2e-${randomUUID()}`, 'test.sqlite');
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, retries: 0,
  timeout: 30000, expect: { timeout: 8000 },
  use: { baseURL: 'http://localhost:3100', trace: 'off', screenshot: 'only-on-failure' },
  reporter: [['list'], ['html', { open: 'never' }]],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node --import tsx tests/e2e-server.ts', url: 'http://localhost:3100/api/health',
    reuseExistingServer: false, timeout: 30000,
    env: { E2E_DATABASE_PATH: process.env.E2E_DATABASE_PATH },
  },
});
