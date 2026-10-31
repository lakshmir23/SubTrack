import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { assertNoSecrets, demoPassword, fixture, signIn } from './fixtures.js';

test('AUTH-01/AUTH-04: signup persists normalized customer identity and a revocable session', async t => {
  const { app, db } = await fixture(t, { seeded: false });
  const agent = request.agent(app);
  assert.deepEqual((await agent.get('/api/session')).body, { user: null, csrfToken: null });
  const signup = await agent.post('/api/auth/signup').send({ name: 'Nine Character', email: '  NINE@EXAMPLE.TEST ', password: 'Abcdefgh!' });
  assert.equal(signup.status, 201);
  const cookies = signup.headers['set-cookie'] as unknown as string[];
  assert.ok(cookies.some(cookie => cookie.includes('HttpOnly')));
  assert.ok(cookies.some(cookie => /SameSite=(Lax|Strict)/i.test(cookie)));
  const originalCookie = cookies.map(cookie => cookie.split(';')[0]).join('; ');
  const session = await agent.get('/api/session');
  assert.equal(session.body.user.email, 'nine@example.test');
  assert.equal(session.body.user.role, 'customer');
  assert.equal(session.body.user.name, 'Nine Character');
  assert.ok(session.body.csrfToken);
  assertNoSecrets(session.body);
  const stored = db.prepare('SELECT password_hash FROM users WHERE email = ?').get('nine@example.test');
  assert.ok(stored?.password_hash);
  assert.notEqual(stored?.password_hash, 'Abcdefgh!');
  const duplicate = await request(app).post('/api/auth/signup').send({ name: 'Duplicate Customer', email: 'NINE@example.test', password: 'Abcdefgh!' });
  assert.equal(duplicate.status, 409);
  const logout = await agent.post('/api/auth/logout').set('X-CSRF-Token', session.body.csrfToken).send({});
  assert.ok(logout.status >= 200 && logout.status < 300);
  assert.equal((await agent.get('/api/session')).body.user, null);
  assert.equal((await request(app).get('/api/session').set('Cookie', originalCookie)).body.user, null, 'Logout must revoke the token, not only clear the browser cookie.');
  assert.equal((await agent.get('/api/workspace')).status, 401);
  const login = await agent.post('/api/auth/login').send({ email: 'NINE@example.test', password: 'Abcdefgh!' });
  assert.equal(login.status, 200);
  assert.equal((await agent.get('/api/session')).body.user.email, 'nine@example.test');
});

test('AUTH-02/AUTH-05: HTTP validation rejects missing classes, eight characters and elevated signup', async t => {
  const { app, db } = await fixture(t, { seeded: false });
  for (const password of ['Abcdefg!', 'abcdefgh!', 'ABCDEFGH!', 'Abcdefghi']) {
    const response = await request(app).post('/api/auth/signup').send({ name: 'Invalid Customer', email: 'invalid@example.test', password });
    assert.equal(response.status, 400, `Password ${password} must be rejected.`);
    assert.ok(response.body.error.message);
    assert.ok(response.body.error.fields?.password);
  }
  const injection = await request(app).post('/api/auth/signup').send({ name: 'Role Injection', email: 'injected@example.test', password: 'Abcdefgh!', role: 'admin' });
  assert.equal(injection.status, 400);
  assert.equal(db.prepare('SELECT count(*) AS count FROM users').get()?.count, 0);
});

test('AUTH-05: only admin can list or add fixed-role staff; failures never insert users', async t => {
  const { app, db } = await fixture(t);
  const body = { name: 'Additional Staff', email: 'additional@brightloop.test', password: demoPassword };
  const originalCount = db.prepare('SELECT count(*) AS count FROM users').get()?.count;
  assert.equal((await request(app).post('/api/staff').send(body)).status, 401);
  for (const email of ['staff@brightloop.test', 'maya@brightloop.test']) {
    const signed = await signIn(app, email);
    assert.equal((await signed.agent.get('/api/staff')).status, 403);
    assert.equal((await signed.agent.post('/api/staff').set('X-CSRF-Token', signed.csrfToken).send(body)).status, 403);
  }
  assert.equal(db.prepare('SELECT count(*) AS count FROM users').get()?.count, originalCount);
  const admin = await signIn(app);
  const created = await admin.agent.post('/api/staff').set('X-CSRF-Token', admin.csrfToken).send(body);
  assert.equal(created.status, 201);
  const list = await admin.agent.get('/api/staff');
  assert.equal(list.status, 200);
  assert.ok(list.body.items.some((user: { email: string; role: string }) => user.email === body.email && user.role === 'staff'));
  assertNoSecrets(created.body);
  assertNoSecrets(list.body);
  const changedRole = await admin.agent.post('/api/staff').set('X-CSRF-Token', admin.csrfToken).send({ ...body, email: 'other@brightloop.test', role: 'admin' });
  assert.equal(changedRole.status, 400);
});

test('AUTH-04: workspace and customer directory require the correct role and serialize only safe fields', async t => {
  const { app } = await fixture(t);
  assert.equal((await request(app).get('/api/customers')).status, 401);
  assert.equal((await request(app).get('/api/workspace')).status, 401);
  const customer = await signIn(app, 'maya@brightloop.test');
  assert.equal((await customer.agent.get('/api/customers')).status, 403);
  assert.equal((await customer.agent.get('/api/deliveries')).status, 403);
  const ownWorkspace = await customer.agent.get('/api/workspace');
  assert.equal(ownWorkspace.status, 200);
  assertNoSecrets(ownWorkspace.body);
  assert.equal(JSON.stringify(ownWorkspace.body).includes('arun@brightloop.test'), false);
  const staff = await signIn(app, 'staff@brightloop.test');
  const directory = await staff.agent.get('/api/customers').query({ page: 1, pageSize: 1 });
  assert.equal(directory.status, 200);
  assert.equal(directory.body.items.length, 1);
  assert.ok(directory.body.total >= 2);
  assert.equal(directory.body.pageSize, 1);
  assertNoSecrets(directory.body);
  const search = await staff.agent.get('/api/customers').query({ search: 'maya', pageSize: 20 });
  assert.equal(search.status, 200);
  assert.ok(search.body.items.length >= 1);
  assert.ok(search.body.items.every((user: { email: string }) => user.email.includes('maya')));
  assert.equal((await staff.agent.get('/api/deliveries')).status, 403);
});

test('AUTH-04: missing/incorrect CSRF, cross-origin auth and malformed JSON fail safely', async t => {
  const { app } = await fixture(t);
  const admin = await signIn(app);
  const body = { name: 'CSRF Staff', email: 'csrf@brightloop.test', password: demoPassword };
  assert.equal((await admin.agent.post('/api/staff').send(body)).status, 403);
  assert.equal((await admin.agent.post('/api/staff').set('X-CSRF-Token', 'incorrect').send(body)).status, 403);
  const crossOrigin = await request(app).post('/api/auth/signup').set('Origin', 'https://unrelated.example').send({ name: 'Injected Customer', email: 'csrf@example.test', password: 'Abcdefgh!' });
  assert.equal(crossOrigin.status, 403);
  const malformed = await request(app).post('/api/auth/signup').set('Content-Type', 'application/json').send('{');
  assert.equal(malformed.status, 400);
  assert.ok(malformed.body.error.message);
  assert.ok(malformed.body.error.requestId);
});

test('AUTH-04: invalid credentials remain generic and login abuse is rate-limited', async t => {
  const { app } = await fixture(t);
  const unknown = await request(app).post('/api/auth/login').send({ email: 'unknown@brightloop.test', password: demoPassword });
  const wrongPassword = await request(app).post('/api/auth/login').send({ email: 'admin@brightloop.test', password: 'WrongPassword!' });
  assert.equal(unknown.status, 401);
  assert.equal(wrongPassword.status, 401);
  assert.equal(unknown.body.error.message, wrongPassword.body.error.message);
  let limited = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await request(app).post('/api/auth/login').send({ email: 'abuse@brightloop.test', password: 'WrongPassword!' });
    if (response.status === 429) { limited = true; break; }
  }
  assert.ok(limited, 'Repeated failed logins must reach a bounded rate limit.');
});

test('AUTH-02: HTTP password validation counts Unicode characters consistently through signup and login', async t => {
  const { app } = await fixture(t, { seeded: false });
  for (const password of ['Abcdefghé', 'AbcdeF!😀', `Aa!${'😀'.repeat(126)}`]) {
    const rejected = await request(app).post('/api/auth/signup').send({ name: 'Unicode Customer', email: 'rejected@example.test', password });
    assert.equal(rejected.status, 400);
    assert.ok(rejected.body.error.fields?.password);
  }
  const passwords = ['Ébcdefgh!', 'ABCDEFGé!', `Aa!${'😀'.repeat(125)}`];
  for (const [index, password] of passwords.entries()) {
    const email = `unicode${index}@example.test`;
    assert.equal((await request(app).post('/api/auth/signup').send({ name: 'Unicode Customer', email, password })).status, 201);
    assert.equal((await request(app).post('/api/auth/login').send({ email, password })).status, 200);
  }
  const tooLong = await request(app).post('/api/auth/login').send({ email: 'unicode2@example.test', password: `Aa!${'😀'.repeat(126)}` });
  assert.equal(tooLong.status, 400);
  assert.ok(tooLong.body.error.fields?.password);
});
