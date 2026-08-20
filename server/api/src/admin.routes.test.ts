import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { newDb, type IMemoryDb } from 'pg-mem';

/**
 * Route-level integration tests for the private operator dashboard (admin.ts),
 * driving the real Express app (createApp) over a pg-mem Postgres — no Docker.
 *
 * JWT_SECRET and ADMIN_USERNAMES must be set before app.ts (→ auth.ts → admin.ts) is
 * first evaluated, so the app is pulled in via a dynamic import inside before().
 */
const JWT_SECRET = 'test-jwt-secret-for-admin';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';
process.env.ADMIN_USERNAMES = 'admin';

const ADMIN_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const XSS_ID = '33333333-3333-3333-3333-333333333333';
const ORIGIN = 'https://naapurustot.fi';

let app: ReturnType<typeof import('./app.js').createApp>;
let pool: import('pg').Pool;
let mem: IMemoryDb;

function cookie(userId: string): string {
  return `token=${jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' })}`;
}

before(async () => {
  mem = newDb();
  const pgAdapter = mem.adapters.createPg();
  pool = new pgAdapter.Pool();
  const { setPool } = await import('./db.js');
  setPool(pool);
  await pool.query(`
    CREATE TABLE users (
      id UUID PRIMARY KEY,
      username TEXT UNIQUE,
      email TEXT UNIQUE,
      password TEXT,
      display_name TEXT,
      trust_level SMALLINT NOT NULL DEFAULT 0,
      token_version INTEGER NOT NULL DEFAULT 0,
      comp_supporter BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`
    CREATE TABLE user_billing (
      user_id UUID PRIMARY KEY,
      status VARCHAR(20),
      current_period_end TIMESTAMPTZ
    )`);
  const { createApp } = await import('./app.js');
  app = createApp();
});

beforeEach(async () => {
  await pool.query('DELETE FROM user_billing');
  await pool.query('DELETE FROM users');
  await pool.query(
    `INSERT INTO users (id, username, password, comp_supporter, created_at) VALUES
       ($1, 'admin',   'x', TRUE,  '2026-01-01'),
       ($2, 'regular', 'x', FALSE, '2026-02-01')`,
    [ADMIN_ID, USER_ID],
  );
});

test('GET /auth/admin/users without a session is 401', async () => {
  const res = await request(app).get('/auth/admin/users');
  assert.equal(res.status, 401);
  assert.ok(res.body.error);
});

test('GET /auth/admin/users as a non-admin is 403', async () => {
  const res = await request(app).get('/auth/admin/users').set('Cookie', cookie(USER_ID));
  assert.equal(res.status, 403);
});

test('GET /auth/admin/users as an admin returns the account list with tiers', async () => {
  const res = await request(app).get('/auth/admin/users').set('Cookie', cookie(ADMIN_ID));
  assert.equal(res.status, 200);
  assert.equal(res.body.counts.total, 2);
  assert.equal(res.body.counts.pro, 1); // admin is comp
  assert.equal(res.body.counts.free, 1);
  assert.equal(res.body.counts.comp, 1);
  const byName = Object.fromEntries(res.body.users.map((u: { username: string }) => [u.username, u]));
  assert.equal(byName.admin.tier, 'pro');
  assert.equal(byName.admin.proSource, 'comp');
  assert.equal(byName.regular.tier, 'free');
  // No password/hash ever leaves the server.
  assert.ok(!('password' in byName.admin));
});

test('GET /auth/admin/users reflects a live Stripe subscription as PRO (stripe)', async () => {
  await pool.query(
    `INSERT INTO user_billing (user_id, status, current_period_end) VALUES ($1, 'active', $2)`,
    [USER_ID, new Date('2035-01-01T00:00:00Z')],
  );
  const res = await request(app).get('/auth/admin/users').set('Cookie', cookie(ADMIN_ID));
  assert.equal(res.status, 200);
  const byName = Object.fromEntries(res.body.users.map((u: { username: string }) => [u.username, u]));
  assert.equal(byName.regular.tier, 'pro');
  assert.equal(byName.regular.proSource, 'stripe');
  assert.equal(byName.regular.supporterUntil, '2035-01-01T00:00:00.000Z');
});

test('GET /auth/admin serves the HTML dashboard to an admin, with a nonce CSP', async () => {
  const res = await request(app).get('/auth/admin').set('Cookie', cookie(ADMIN_ID));
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.headers['content-security-policy'], /script-src 'nonce-/);
  assert.ok(res.text.includes('Registered users'));
  assert.ok(res.text.includes('window.__ADMIN_DATA__'));
});

test('GET /auth/admin returns an HTML error page (not JSON) for a browser navigation without a session', async () => {
  const res = await request(app).get('/auth/admin').set('Accept', 'text/html');
  assert.equal(res.status, 401);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.ok(res.text.includes('Sign in at naapurustot.fi'));
});

test('the dashboard neutralises a malicious display name (stored XSS)', async () => {
  const payload = '</script><script>alert(1)</script>';
  await pool.query(
    `INSERT INTO users (id, username, password, display_name, created_at) VALUES ($1, 'evil', 'x', $2, '2026-03-01')`,
    [XSS_ID, payload],
  );
  const res = await request(app).get('/auth/admin').set('Cookie', cookie(ADMIN_ID));
  assert.equal(res.status, 200);
  assert.ok(!res.text.includes(payload), 'the raw </script> breakout does not survive');
  assert.ok(res.text.includes('\\u003c/script'), 'the < is escaped in the embedded data');
});

test('signup refuses an allowlisted admin username (reserved — closes the re-registration path to admin)', async () => {
  const res = await request(app)
    .post('/auth/signup')
    .set('Origin', ORIGIN)
    .send({ username: 'Admin', password: 'a-strong-password-123', email: 'grabber@example.com' });
  assert.equal(res.status, 409); // same 409 as a taken name (no disclosure), matched case-insensitively
  // No account was created — the reservation short-circuits before any INSERT.
  const { rows } = await pool.query(`SELECT count(*) AS n FROM users WHERE email = 'grabber@example.com'`);
  assert.equal(Number(rows[0].n), 0);
});

test('with ADMIN_USERNAMES unset the dashboard is disabled even for a would-be admin', async () => {
  const saved = process.env.ADMIN_USERNAMES;
  delete process.env.ADMIN_USERNAMES;
  try {
    const res = await request(app).get('/auth/admin/users').set('Cookie', cookie(ADMIN_ID));
    assert.equal(res.status, 403);
  } finally {
    process.env.ADMIN_USERNAMES = saved;
  }
});
