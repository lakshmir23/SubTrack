import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { arch, cpus, freemem, platform, release, totalmem } from 'node:os';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { chromium, request, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { BenchmarkManifest } from './benchmark-data.js';
import { buildBenchmarkPages, buildBenchmarkActions, type BenchmarkRole } from './benchmark-pages.js';

const args = process.argv.slice(2);
const value = (name: string, fallback = '') => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const manifestPath = resolve(value('manifest'));
if (!value('manifest') || !existsSync(manifestPath)) throw new Error('Usage: npm run benchmark -- --manifest=data/<fixture>.sqlite.manifest.json [--samples=50] [--label=baseline] [--only=pattern]');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BenchmarkManifest;
if (!manifest.validation.passed) throw new Error('Refusing to benchmark a dataset that failed validation.');
const samples = Number(value('samples', '50'));
if (!Number.isInteger(samples) || samples < 1 || samples > 200) throw new Error('Samples must be 1–200.');
const label = value('label', 'baseline').replace(/[^a-z0-9-]/gi, '-');
const only = value('only') ? new RegExp(value('only')) : null;
const port = Number(value('port', '3004'));
const origin = `http://localhost:${port}`;
const dimensions = value('viewport', '1440x1000').split('x').map(Number);
if (dimensions.length !== 2 || dimensions.some(size => !Number.isInteger(size) || size < 320 || size > 4000)) throw new Error('Viewport must be WIDTHxHEIGHT, each 320–4000.');
const viewport = { width: dimensions[0], height: dimensions[1] };
const stamp = `${new Date().toISOString().replace(/[^0-9]/g, '')}-${randomUUID().slice(0, 8)}`;
const directory = resolve('data', `benchmark-${label}-${stamp}`);
mkdirSync(directory, { recursive: true });
const runtimePath = resolve(directory, 'runtime.sqlite');
copyFileSync(manifest.databasePath, runtimePath);
const resultPath = resolve(directory, 'results.json');
interface Observation { id: string; kind: string; role: string; path: string; sample: number; milliseconds: number; error?: string; status?: number; bytes?: number }
const observations: Observation[] = [];
const snapshot = (path: string) => {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return {
      counts: Object.fromEntries(['users', 'subscriptions', 'invoices', 'invoice_lines', 'payments', 'logical_charges', 'lifecycle_events'].filter(table => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)).map(table => [table, db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n])),
      stages: db.prepare('SELECT stage,count(*) AS n FROM subscriptions GROUP BY stage').all(),
      sqlite: db.prepare('SELECT sqlite_version() AS version').get(),
      pragmas: { journalMode: db.prepare('PRAGMA journal_mode').get(), synchronous: db.prepare('PRAGMA synchronous').get(), busyTimeout: 'runtime sets 1000 ms', foreignKeys: 'runtime ON' },
      indexes: db.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name").all(),
    };
  } finally { db.close(); }
};
const metadata = {
  label, startedAt: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  worktree: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim(), node: process.version,
  hardware: { cpu: cpus()[0]?.model, logicalCpus: cpus().length, ramBytes: totalmem(), freeRamAtStart: freemem(), platform: platform(), release: release(), arch: arch() },
  origin, viewport, network: 'HTTP loopback; headless Chromium; no network or CPU throttling', samples,
  fixture: { ...manifest, accounts: Object.fromEntries(Object.entries(manifest.accounts).map(([role, account]) => [role, { id: account.id, email: account.email }])) },
  databaseBytes: statSync(runtimePath).size, startSnapshot: snapshot(runtimePath),
  productionAssets: ['index.html', ...readdirSync(resolve('dist/client/assets')).filter(name => /\.(?:js|css)$/.test(name)).map(name => `assets/${name}`)].map(name => ({ name, bytes: statSync(resolve('dist/client', name)).size, sha256: createHash('sha256').update(readFileSync(resolve('dist/client', name))).digest('hex') })),
  protocol: {
    warm: 'Hard navigation in reused role context, cached assets after one unrecorded preparation. Timer begins before goto and ends after destination data/controls, fonts.ready and two animation frames.',
    cold: 'One navigation per destination in a new browser context with only authenticated cookies copied. Browser HTTP cache empty; server and OS filesystem caches are not flushed.',
    api: 'Whole HTTP GET through response-body read. First probe after a fresh server process per endpoint, then warm samples; persisted role cookies/session checks included. Normal startup lifecycle processing retained. OS filesystem caches are not flushed.',
    action: 'Setup outside timer; timer includes user action, debounce if applicable, response and ready result with fonts/two frames.',
    concurrency: 'Separate five authenticated browser contexts navigate simultaneously through mixed-role destinations; customers use their own workspace where internal finance is denied. Not mixed into single-user samples.',
    target: 'Every observed first-usable page/action below 2000 ms; percentile summaries never hide breaches.',
  },
};
const summarize = () => {
  const groups = new Map<string, Observation[]>();
  for (const row of observations) { const key = `${row.kind}:${row.id}`; const group = groups.get(key) || []; group.push(row); groups.set(key, group); }
  return [...groups].map(([key, rows]) => {
    const times = rows.map(row => row.milliseconds).sort((a, b) => a - b);
    return { key, count: rows.length, errors: rows.filter(row => row.error).length, median: times[Math.floor(times.length / 2)], p95: times[Math.max(0, Math.ceil(times.length * .95) - 1)], max: times.at(-1), breaches: rows.filter(row => row.milliseconds >= 2000).length };
  });
};
let completion: Record<string, unknown> = { state: 'running' };
const evidenceValue = (key: string, value: unknown) => {
  if (['password', 'csrfToken', 'resetToken'].includes(key)) return '[synthetic credential omitted]';
  return typeof value === 'string' ? value.replace(/([#?&]token=)[a-f0-9]+/gi, '$1[synthetic-token-omitted]') : value;
};
const persist = () => writeFileSync(resultPath, JSON.stringify({ metadata, completion, summary: summarize(), breaches: observations.filter(row => row.milliseconds >= 2000), observations }, evidenceValue, 2));
const settle = async (page: Page) => { await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))); }); };
const startServer = async (databasePath: string) => {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/benchmark-server.ts', manifestPath, databasePath, String(port)], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  let output = '';
  child.stdout!.on('data', chunk => { output += String(chunk); });
  child.stderr!.on('data', chunk => { output += String(chunk); });
  const deadline = performance.now() + 30000;
  while (!output.includes('BENCHMARK_READY')) {
    if (child.exitCode !== null || performance.now() > deadline) throw new Error(`Benchmark server did not start: ${output.slice(-2000)}`);
    await new Promise(done => setTimeout(done, 50));
  }
  return child;
};
const stopServer = async (child: ChildProcess) => {
  if (child.exitCode !== null) return;
  await new Promise<void>((done, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Benchmark server did not stop gracefully.')); }, 15000);
    child.once('exit', () => { clearTimeout(timer); done(); }); child.send('shutdown');
  });
};
let server: ChildProcess | undefined;
let browser: Browser | undefined;
const contexts = new Map<BenchmarkRole, BrowserContext>();
const states = new Map<BenchmarkRole, Awaited<ReturnType<BrowserContext['storageState']>>>();
const contextFor = async (role: BenchmarkRole, cold = false) => {
  if (!browser) throw new Error('Browser not started.');
  if (!cold && contexts.has(role)) return contexts.get(role)!;
  const context = await browser.newContext({ baseURL: origin, viewport, storageState: states.get(role) });
  context.setDefaultTimeout(10000);
  context.setDefaultNavigationTimeout(15000);
  if (!states.has(role) && role !== 'public') {
    const account = manifest.accounts[role];
    const response = await context.request.post('/api/auth/login', { data: { email: account.email, password: account.password }, headers: { Origin: origin } });
    if (!response.ok()) throw new Error(`Synthetic ${role} login failed (${response.status()}).`);
    states.set(role, await context.storageState());
  }
  if (!cold) contexts.set(role, context);
  return context;
};
const observe = async (row: Omit<Observation, 'milliseconds'>, action: () => Promise<void>) => {
  const start = performance.now();
  try { await action(); observations.push({ ...row, milliseconds: performance.now() - start }); }
  catch (error) { observations.push({ ...row, milliseconds: performance.now() - start, error: error instanceof Error ? error.message.slice(0, 1500) : String(error) }); }
};
try {
  server = await startServer(runtimePath);
  browser = await chromium.launch({ headless: true });
  Object.assign(metadata, { browser: browser.version() });
  const pages = buildBenchmarkPages(manifest).filter(item => !only || only.test(item.id));
  const actions = buildBenchmarkActions(manifest).filter(item => !only || only.test(item.id));
  Object.assign(metadata, { inventory: pages.map(({ id, role, path, category, readiness, apiPaths }) => ({ id, role, path, category, readiness, apiPaths })), actionInventory: actions.map(({ id, role, path, category, readiness, apiPaths }) => ({ id, role, path, category, readiness, apiPaths })) });
  persist();
  const apiSeen = new Set<string>();
  for (const item of [...pages, ...actions]) {
    for (const path of item.apiPaths) {
      const key = `${item.role}:${path}`;
      if (apiSeen.has(key)) continue;
      apiSeen.add(key);
      const context = await contextFor(item.role);
      await stopServer(server); server = await startServer(runtimePath);
      for (let sample = 0; sample <= samples; sample++) {
        const row: Omit<Observation, 'milliseconds'> = { id: key, kind: sample === 0 ? 'api-cold-server' : 'api-warm', role: item.role, path, sample };
        await observe(row, async () => { const response = await context.request.get(path); row.status = response.status(); row.bytes = (await response.body()).length; if (!response.ok()) throw new Error(`HTTP ${response.status()}`); });
      }
      persist();
    }
  }
  for (const item of pages) {
    const cold = await contextFor(item.role, true);
    const coldPage = await cold.newPage();
    if (item.prepare) await item.prepare(coldPage);
    await observe({ id: item.id, kind: 'page-cold-browser', role: item.role, path: item.path, sample: 0 }, async () => { await coldPage.goto(item.path, { waitUntil: 'domcontentloaded' }); await item.ready(coldPage); await settle(coldPage); });
    await cold.close();
    const context = await contextFor(item.role);
    const page = await context.newPage();
    await page.goto(item.path, { waitUntil: 'domcontentloaded' }); await item.ready(page); await settle(page);
    for (let sample = 1; sample <= samples; sample++) {
      if (item.prepare) await item.prepare(page);
      await observe({ id: item.id, kind: 'page-warm', role: item.role, path: item.path, sample }, async () => { await page.goto(item.path, { waitUntil: 'domcontentloaded' }); await item.ready(page); await settle(page); });
      if (observations.slice(-3).every(row => row.id === item.id && !!row.error)) throw new Error(`Repeated readiness failure: ${item.id}`);
    }
    await page.close(); persist();
    console.log(`Measured ${item.id}: ${samples} warm + cold browser navigation.`);
  }
  for (const item of actions) {
    const page = await (await contextFor(item.role)).newPage();
    for (let sample = 1; sample <= samples; sample++) {
      await page.goto(item.path, { waitUntil: 'domcontentloaded' });
      if (item.prepare) await item.prepare(page);
      await observe({ id: item.id, kind: 'action-warm', role: item.role, path: item.path, sample }, async () => { await item.run(page); await item.ready(page); await settle(page); });
      if (observations.slice(-3).every(row => row.id === item.id && !!row.error)) throw new Error(`Repeated action failure: ${item.id}`);
    }
    await page.close(); persist(); console.log(`Measured action ${item.id}: ${samples} samples.`);
  }
  if (!args.includes('--skip-concurrent') && !only) {
    const selections = ['admin', 'staff', 'customer', 'staff', 'customer'] as BenchmarkRole[];
    const concurrent = await Promise.all(selections.map(async role => ({ role, context: await contextFor(role, true) })));
    for (const id of ['subscriptions', 'finance', 'invoices']) {
      const work = concurrent.map(async ({ role, context }, index) => {
        const item = pages.find(page => page.role === role && page.id.includes(id)) || pages.find(page => page.role === role && page.category === 'workspace');
        if (!item) return;
        const page = await context.newPage();
        for (let sample = 1; sample <= 10; sample++) await observe({ id: `five-users:${id}:${role}:${index}`, kind: 'page-concurrent', role, path: item.path, sample }, async () => { await page.goto(item.path, { waitUntil: 'domcontentloaded' }); await item.ready(page); await settle(page); });
        await page.close();
      });
      await Promise.all(work); persist();
    }
    await Promise.all(concurrent.map(({ context }) => context.close()));
  }
  await browser.close(); browser = undefined;
  await stopServer(server); server = undefined;
  Object.assign(metadata, { endSnapshot: snapshot(runtimePath) });
  if (!args.includes('--skip-batch') && !only) {
    const batchPath = resolve(directory, 'batch.sqlite');
    copyFileSync(manifest.databasePath, batchPath);
    server = await startServer(batchPath);
    const client = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
    try {
      const login = await client.post('/api/auth/login', { data: { email: manifest.accounts.admin.email, password: manifest.accounts.admin.password } });
      if (!login.ok()) throw new Error('Batch fixture login failed.');
      const { csrfToken } = await login.json() as { csrfToken: string };
      const key = randomUUID();
      const before = snapshot(batchPath);
      const started = performance.now();
      const accepted = await client.post('/api/billing/runs', { data: { limit: 250, idempotencyKey: key }, headers: { 'X-CSRF-Token': csrfToken } });
      const acknowledgmentMs = performance.now() - started;
      if (accepted.status() !== 202) throw new Error(`Batch acknowledgment HTTP ${accepted.status()}`);
      const run = await accepted.json() as { id: string; status: string };
      let final = run;
      const probes: { path: string; milliseconds: number; status: number }[] = [];
      while (!['completed', 'failed'].includes(final.status)) {
        if (performance.now() - started > 120000) throw new Error('Batch did not finish within the two-minute observation window.');
        const probeStart = performance.now();
        const probe = await client.get('/api/finance/summary');
        await probe.body(); probes.push({ path: '/api/finance/summary', milliseconds: performance.now() - probeStart, status: probe.status() });
        const polled = await client.get(`/api/billing/runs/${run.id}`);
        if (!polled.ok()) throw new Error('Persisted batch progress could not be read.');
        final = await polled.json() as typeof run;
        if (!['completed', 'failed'].includes(final.status)) await new Promise(done => setTimeout(done, 20));
      }
      const completionMs = performance.now() - started;
      const items = await (await client.get(`/api/billing/runs/${run.id}/items?pageSize=100`)).json() as unknown;
      const replay = await client.post('/api/billing/runs', { data: { limit: 250, idempotencyKey: key }, headers: { 'X-CSRF-Token': csrfToken } });
      const replayRun = await replay.json() as { id: string };
      if (replayRun.id !== run.id) throw new Error('Batch replay produced a different run.');
      const duplicatesDb = new DatabaseSync(batchPath, { readOnly: true });
      let duplicates;
      try { duplicates = duplicatesDb.prepare('SELECT subscription_id,period_start,count(*) AS n FROM logical_charges GROUP BY subscription_id,period_start HAVING count(*)>1').all(); }
      finally { duplicatesDb.close(); }
      Object.assign(metadata, { batch: { isolatedDatabase: batchPath, acknowledgmentMs, completionMs, run: final, firstItemsPage: items, probes, replaySameRun: true, duplicatePeriods: duplicates, before, after: snapshot(batchPath) } });
      if (duplicates.length) throw new Error('Duplicate logical periods found after benchmark batch.');
    } finally { await client.dispose(); await stopServer(server); server = undefined; }
  }
  completion = { state: 'complete', finishedAt: new Date().toISOString(), errors: observations.filter(row => row.error).length, breaches: observations.filter(row => row.milliseconds >= 2000).length };
  persist();
  console.log(`Raw evidence: ${resultPath}`);
  console.log(JSON.stringify(completion));
} catch (error) {
  completion = { state: 'failed', error: error instanceof Error ? error.message : String(error), finishedAt: new Date().toISOString() };
  persist(); throw error;
} finally {
  if (browser) await browser.close();
  if (server) await stopServer(server);
}
