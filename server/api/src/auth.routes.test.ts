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
      email TEXT,
      password TEXT,
      display_name TEXT,
      trust_level SMALLINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`
    CREATE TABLE user_favorites (
      user_id UUID PRIMARY KEY,
      favorites JSONB NOT NULL DEFAULT '[]',
      updated_at TIMESTAMPTZ DEFAULT NOW()
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
