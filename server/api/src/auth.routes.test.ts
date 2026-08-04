import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import express from 'express';
import { newDb, type IMemoryDb } from 'pg-mem';
import { rateLimit } from './rateLimit.js';

/**
 * IN-5: first route-level integration tests for the auth/sync API. They drive the
 * real Express app (createApp) backed by a pg-mem in-memory Postgres — no Docker,
 * no real DATABASE_URL — exercising a credentialed GET/PUT round-trip, the 16 KB
 * body-limit 413, the same-origin (CSRF) 403, and the rate-limit 429.
 *
 * JWT_SECRET must be set before app.ts (→ auth.ts) is first evaluated, so the app
 * is pulled in via a dynamic import inside before() rather than a static import.
 */
const JWT_SECRET = 'test-jwt-secret-for-routes';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const ORIGIN = 'https://naapurustot.fi';

let app: ReturnType<typeof import('./app.js').createApp>;
let pool: import('pg').Pool;
let mem: IMemoryDb;

function authCookie(userId: string = USER_ID): string {
  return `token=${jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' })}`;
}

async function createSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE users (
      id UUID PRIMARY KEY,
      username TEXT UNIQUE,
      email TEXT UNIQUE,
      password TEXT,
      display_name TEXT,
      trust_level SMALLINT NOT NULL DEFAULT 0,
      token_version INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`
    CREATE TABLE user_favorites (
      user_id UUID PRIMARY KEY,
      favorites JSONB NOT NULL DEFAULT '[]',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`
    CREATE TABLE password_reset_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id UUID NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query(
    `INSERT INTO users (id, username, password) VALUES ($1, 'tester', 'x')`,
    [USER_ID],
  );
}

before(async () => {
  mem = newDb();
  const pgAdapter = mem.adapters.createPg();
  pool = new pgAdapter.Pool();
  const { setPool } = await import('./db.js');
  setPool(pool);
  await createSchema();
  const { createApp } = await import('./app.js');
  app = createApp();
});

beforeEach(() => {
  // Reset the favorites row between tests so each starts from a known state.
  mem.public.none(`DELETE FROM user_favorites`);
});

test('credentialed GET/PUT favorites round-trip persists and reads back', async () => {
  const cookie = authCookie();

  const get1 = await request(app).get('/auth/favorites').set('Cookie', cookie);
  assert.equal(get1.status, 200);
  assert.deepEqual(get1.body.favorites, []);

  const put = await request(app)
    .put('/auth/favorites')
    .set('Cookie', cookie)
    .set('Origin', ORIGIN)
    .send({ favorites: ['00100', '00200'] });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body.favorites, ['00100', '00200']);

  const get2 = await request(app).get('/auth/favorites').set('Cookie', cookie);
  assert.equal(get2.status, 200);
  assert.deepEqual(get2.body.favorites, ['00100', '00200']);
  // IN-6: the GET also surfaces the server's last-write timestamp for LWW merges.
  assert.ok(get2.body.updatedAt, 'GET favorites surfaces updatedAt');
});

test('GET without a valid token is rejected with 401', async () => {
  const res = await request(app).get('/auth/favorites');
  assert.equal(res.status, 401);
});

test('rejects an oversized JSON body with 413 (16 KB limit)', async () => {
  const big = 'x'.repeat(20_000);
  const res = await request(app)
    .put('/auth/favorites')
    .set('Cookie', authCookie())
    .set('Origin', ORIGIN)
    .set('Content-Type', 'application/json')
    .send(JSON.stringify({ favorites: [big] }));
  assert.equal(res.status, 413);
});

test('rejects a state-changing request without an allowed Origin with 403 (CSRF)', async () => {
  const res = await request(app)
    .put('/auth/favorites')
    .set('Cookie', authCookie())
    .send({ favorites: ['00100'] });
  assert.equal(res.status, 403);
});

test('rejects a state-changing request with a foreign Origin with 403 (CSRF)', async () => {
  const res = await request(app)
    .put('/auth/favorites')
    .set('Cookie', authCookie())
    .set('Origin', 'https://evil.example')
    .send({ favorites: ['00100'] });
  assert.equal(res.status, 403);
});

test('rate limiter returns 429 once the per-key window is exhausted', async () => {
  // Exercises the IN-5 generalized rateLimit with a custom (per-user) key extractor
  // and a low limit, so the 429 path is covered without firing hundreds of requests
  // against the real app's generous limits.
  const mini = express();
  mini.get('/x', rateLimit(2, 60_000, 'test429', () => 'user-abc'), (_req, res) => {
    res.json({ ok: true });
  });

  assert.equal((await request(mini).get('/x')).status, 200);
  assert.equal((await request(mini).get('/x')).status, 200);
  const third = await request(mini).get('/x');
  assert.equal(third.status, 429);
  assert.ok(third.headers['retry-after'], 'sets a Retry-After header');
});

test('rate limiter with a null key skips limiting (unauthenticated per-user bucket)', async () => {
  const mini = express();
  mini.get('/y', rateLimit(1, 60_000, 'testnull', () => null), (_req, res) => {
    res.json({ ok: true });
  });
  for (let i = 0; i < 5; i++) {
    assert.equal((await request(mini).get('/y')).status, 200);
  }
});

// ── Password reset ──
//
// Tokens are inserted directly rather than minted through /forgot-password: that
// route is limited to 5 requests per IP per hour and the limiter's buckets are
// module state shared by every test in this process, so driving it repeatedly
// would make later tests fail on a 429 rather than on their own assertion.

const RESET_USER = '22222222-2222-2222-2222-222222222222';
const RESET_EMAIL = 'reset-user@example.com';
const RESET_PASSWORD = 'original-password-123';

/** Seed the reset fixture user with a real bcrypt hash of RESET_PASSWORD. */
async function seedResetUser(): Promise<void> {
  const bcrypt = (await import('bcrypt')).default;
  const hash = await bcrypt.hash(RESET_PASSWORD, 4); // low cost: this is a fixture
  await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [RESET_USER]);
  await pool.query('DELETE FROM users WHERE id = $1', [RESET_USER]);
  await pool.query(
    `INSERT INTO users (id, username, email, password) VALUES ($1, 'resetuser', $2, $3)`,
    [RESET_USER, RESET_EMAIL, hash],
  );
}

/** Insert a reset token for RESET_USER and return the raw (emailable) token. */
async function seedResetToken(expiresAt: Date): Promise<string> {
  const { generateResetToken } = await import('./passwordReset.js');
  const { token, tokenHash } = generateResetToken();
  await pool.query(
    'INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [tokenHash, RESET_USER, expiresAt],
  );
  return token;
}

test('POST /auth/forgot-password answers identically for a known and an unknown address', async () => {
  await seedResetUser();

  const unknown = await request(app)
    .post('/auth/forgot-password')
    .set('Origin', ORIGIN)
    .send({ email: 'nobody-at-all@example.com' });
  const known = await request(app)
    .post('/auth/forgot-password')
    .set('Origin', ORIGIN)
    .send({ email: RESET_EMAIL });

  // Identical status AND body: any difference is an account-enumeration oracle.
  assert.equal(unknown.status, 200);
  assert.equal(known.status, 200);
  assert.deepEqual(unknown.body, { ok: true });
  assert.deepEqual(known.body, { ok: true });

  // A malformed address is accepted just as blandly.
  const invalid = await request(app)
    .post('/auth/forgot-password')
    .set('Origin', ORIGIN)
    .send({ email: 'not-an-email' });
  assert.equal(invalid.status, 200);
  assert.deepEqual(invalid.body, { ok: true });
});

test('POST /auth/reset-password sets the new password, and the token cannot be reused', async () => {
  await seedResetUser();
  const token = await seedResetToken(new Date(Date.now() + 60 * 60 * 1000));

  const before = await pool.query('SELECT password, token_version FROM users WHERE id = $1', [RESET_USER]);

  const ok = await request(app)
    .post('/auth/reset-password')
    .set('Origin', ORIGIN)
    .send({ token, password: 'a-brand-new-password' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { ok: true });

  const after = await pool.query('SELECT password, token_version FROM users WHERE id = $1', [RESET_USER]);
  assert.notEqual(after.rows[0].password, before.rows[0].password, 'password hash changed');
  assert.equal(
    Number(after.rows[0].token_version),
    Number(before.rows[0].token_version) + 1,
    'token_version bumped so existing sessions are revoked',
  );

  // Single use: replaying the same link fails.
  const replay = await request(app)
    .post('/auth/reset-password')
    .set('Origin', ORIGIN)
    .send({ token, password: 'yet-another-password' });
  assert.equal(replay.status, 400);
});

test('POST /auth/reset-password refuses an expired token', async () => {
  await seedResetUser();
  const token = await seedResetToken(new Date(Date.now() - 1000));

  const res = await request(app)
    .post('/auth/reset-password')
    .set('Origin', ORIGIN)
    .send({ token, password: 'a-brand-new-password' });
  assert.equal(res.status, 400);

  // The password must be untouched.
  const bcrypt = (await import('bcrypt')).default;
  const row = await pool.query('SELECT password FROM users WHERE id = $1', [RESET_USER]);
  assert.ok(await bcrypt.compare(RESET_PASSWORD, row.rows[0].password), 'password unchanged');
});

test('POST /auth/reset-password rejects a malformed token and a too-short password', async () => {
  await seedResetUser();
  const token = await seedResetToken(new Date(Date.now() + 60 * 60 * 1000));

  const malformed = await request(app)
    .post('/auth/reset-password')
    .set('Origin', ORIGIN)
    .send({ token: 'not-a-real-token', password: 'a-brand-new-password' });
  assert.equal(malformed.status, 400);

  const short = await request(app)
    .post('/auth/reset-password')
    .set('Origin', ORIGIN)
    .send({ token, password: 'short' });
  assert.equal(short.status, 400);
  assert.match(short.body.error, /at least 12/);
});

test('a completed reset invalidates sessions issued before it', async () => {
  await seedResetUser();
  // A cookie for the pre-reset generation (tv 0), as login would have issued.
  const staleCookie = `token=${jwt.sign({ userId: RESET_USER, tv: 0 }, JWT_SECRET, { expiresIn: '7d' })}`;

  const beforeReset = await request(app).get('/auth/me').set('Cookie', staleCookie);
  assert.equal(beforeReset.status, 200, 'session valid before the reset');

  const token = await seedResetToken(new Date(Date.now() + 60 * 60 * 1000));
  const reset = await request(app)
    .post('/auth/reset-password')
    .set('Origin', ORIGIN)
    .send({ token, password: 'a-brand-new-password' });
  assert.equal(reset.status, 200);

  const afterReset = await request(app).get('/auth/me').set('Cookie', staleCookie);
  assert.equal(afterReset.status, 401, 'the pre-reset session is dead');
});

// ── Email management ──

test('PATCH /auth/email requires the correct current password', async () => {
  await seedResetUser();
  const cookie = `token=${jwt.sign({ userId: RESET_USER, tv: 0 }, JWT_SECRET, { expiresIn: '7d' })}`;

  const noPassword = await request(app)
    .patch('/auth/email')
    .set('Cookie', cookie)
    .set('Origin', ORIGIN)
    .send({ email: 'new@example.com' });
  assert.equal(noPassword.status, 400);

  const wrongPassword = await request(app)
    .patch('/auth/email')
    .set('Cookie', cookie)
    .set('Origin', ORIGIN)
    .send({ email: 'new@example.com', password: 'definitely-wrong-password' });
  assert.equal(wrongPassword.status, 403);

  const ok = await request(app)
    .patch('/auth/email')
    .set('Cookie', cookie)
    .set('Origin', ORIGIN)
    .send({ email: 'New@Example.com', password: RESET_PASSWORD });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.email, 'new@example.com', 'stored lowercased');
});

test('PATCH /auth/email without a session is rejected with 401', async () => {
  const res = await request(app)
    .patch('/auth/email')
    .set('Origin', ORIGIN)
    .send({ email: 'x@example.com', password: RESET_PASSWORD });
  assert.equal(res.status, 401);
});
