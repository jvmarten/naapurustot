import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { newDb, type IMemoryDb } from 'pg-mem';
import type { Request, Response } from 'express';

// Price a plan so lightningConfigured() can be true once a provider is injected.
process.env.LIGHTNING_PRICE_EUR_MONTH = '500';
process.env.LIGHTNING_PRICE_EUR_YEAR = '5000';

import {
  extendWindow,
  listPlans,
  lightningConfigured,
  creditLightningPayment,
  setLightningProvider,
  lightningWebhookHandler,
  type LightningProvider,
} from './lightning.js';

const DAY = 24 * 60 * 60 * 1000;
const USER = '11111111-1111-1111-1111-111111111111';

// ── extendWindow (pure) ──

test('extendWindow: a fresh purchase starts from now', () => {
  const now = Date.UTC(2026, 0, 1);
  assert.equal(extendWindow(null, now, 30).getTime(), now + 30 * DAY);
});

test('extendWindow: renewing early STACKS onto the remaining window', () => {
  const now = Date.UTC(2026, 0, 1);
  const current = new Date(now + 10 * DAY); // 10 days still left
  assert.equal(extendWindow(current, now, 30).getTime(), now + 40 * DAY);
});

test('extendWindow: renewing after lapse starts fresh from now', () => {
  const now = Date.UTC(2026, 0, 1);
  const lapsed = new Date(now - 5 * DAY);
  assert.equal(extendWindow(lapsed, now, 30).getTime(), now + 30 * DAY);
});

// ── plans / config (env-driven) ──

test('listPlans reflects the priced plans', () => {
  const plans = listPlans();
  assert.deepEqual(plans.map((p) => p.id), ['month', 'year']);
  assert.equal(plans[0].amountEurCents, 500);
  assert.equal(plans[0].windowDays, 30);
  assert.equal(plans[1].windowDays, 365);
});

test('lightningConfigured requires both a provider and a priced plan', () => {
  setLightningProvider(null);
  assert.equal(lightningConfigured(), false, 'no provider → not configured');
  setLightningProvider(fakeProvider('paid'));
  assert.equal(lightningConfigured(), true);
  setLightningProvider(undefined); // reset to env fallback
});

// ── credit path (pg-mem) ──

let pool: import('pg').Pool;
let mem: IMemoryDb;

function fakeProvider(status: 'paid' | 'pending'): LightningProvider {
  return {
    id: 'fake',
    async createCharge() {
      return { id: 'charge-x', hostedUrl: 'https://pay.example/charge-x' };
    },
    verifyWebhook(req: Request) {
      const body = (req.body ?? {}) as { id?: string };
      return body.id ?? null;
    },
    async fetchChargeStatus() {
      return { status, amountEurCents: 500 };
    },
  };
}

async function insertPending(id: string, userId: string | null, windowDays: number): Promise<void> {
  await pool.query(
    `INSERT INTO lightning_grants (id, user_id, provider, plan, window_days, amount_eur_cents, buyer_country, status)
     VALUES ($1, $2, 'fake', 'month', $3, 500, 'FI', 'pending')`,
    [id, userId, windowDays],
  );
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
      lightning_supporter_until TIMESTAMPTZ,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`
    CREATE TABLE lightning_grants (
      id TEXT PRIMARY KEY,
      user_id UUID,
      provider VARCHAR(20) NOT NULL DEFAULT 'lightning',
      plan VARCHAR(40),
      window_days INTEGER NOT NULL,
      amount_eur_cents INTEGER,
      amount_sats BIGINT,
      buyer_country VARCHAR(2),
      granted_until TIMESTAMPTZ,
      status VARCHAR(20) NOT NULL DEFAULT 'paid',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
});

beforeEach(async () => {
  await pool.query('DELETE FROM lightning_grants');
  await pool.query('DELETE FROM users');
  await pool.query('INSERT INTO users (id, username) VALUES ($1, $2)', [USER, 'tester']);
});

test('creditLightningPayment: a settled charge opens the window and marks the row paid', async () => {
  const now = Date.UTC(2026, 0, 1);
  await insertPending('c1', USER, 30);
  const r = await creditLightningPayment('c1', now);
  assert.equal(r.credited, true);
  assert.equal(r.grantedUntil, new Date(now + 30 * DAY).toISOString());

  const user = await pool.query('SELECT lightning_supporter_until FROM users WHERE id = $1', [USER]);
  assert.equal(new Date(user.rows[0].lightning_supporter_until).getTime(), now + 30 * DAY);
  const grant = await pool.query('SELECT status FROM lightning_grants WHERE id = $1', ['c1']);
  assert.equal(grant.rows[0].status, 'paid');
});

test('creditLightningPayment: re-delivering the same charge is a no-op (idempotent)', async () => {
  const now = Date.UTC(2026, 0, 1);
  await insertPending('c1', USER, 30);
  await creditLightningPayment('c1', now);
  const again = await creditLightningPayment('c1', now + DAY);
  assert.equal(again.credited, false);
  assert.equal(again.reason, 'duplicate');
  // The window was not extended a second time.
  const user = await pool.query('SELECT lightning_supporter_until FROM users WHERE id = $1', [USER]);
  assert.equal(new Date(user.rows[0].lightning_supporter_until).getTime(), now + 30 * DAY);
});

test('creditLightningPayment: two distinct charges STACK the window', async () => {
  const now = Date.UTC(2026, 0, 1);
  await insertPending('c1', USER, 30);
  await insertPending('c2', USER, 365);
  await creditLightningPayment('c1', now);
  const second = await creditLightningPayment('c2', now + DAY); // a day later, still within the first window
  assert.equal(second.credited, true);
  // 30 days from now, then +365 stacked onto that remaining time.
  assert.equal(new Date(second.grantedUntil!).getTime(), now + 30 * DAY + 365 * DAY);
});

test('creditLightningPayment: an unknown charge id credits nothing', async () => {
  const r = await creditLightningPayment('nope', Date.UTC(2026, 0, 1));
  assert.equal(r.credited, false);
  assert.equal(r.reason, 'unknown-charge');
});

test('creditLightningPayment: a charge whose account was deleted marks paid but grants nothing', async () => {
  const now = Date.UTC(2026, 0, 1);
  await insertPending('c1', null, 30); // user_id nulled by ON DELETE SET NULL
  const r = await creditLightningPayment('c1', now);
  assert.equal(r.credited, false);
  assert.equal(r.reason, 'account-gone');
  const grant = await pool.query('SELECT status FROM lightning_grants WHERE id = $1', ['c1']);
  assert.equal(grant.rows[0].status, 'paid'); // settled so a retry does not reprocess
});

// ── webhook handler ──

function mockRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

test('lightningWebhookHandler: 503 when no provider is configured', async () => {
  setLightningProvider(null);
  const res = mockRes();
  await lightningWebhookHandler({ body: { id: 'c1' } } as unknown as Request, res);
  assert.equal(res.statusCode, 503);
  setLightningProvider(undefined);
});

test('lightningWebhookHandler: a verified, paid charge credits its window', async () => {
  const now = Date.now();
  setLightningProvider(fakeProvider('paid'));
  await insertPending('c1', USER, 30);
  const res = mockRes();
  await lightningWebhookHandler({ body: { id: 'c1' } } as unknown as Request, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { received: true });
  const user = await pool.query('SELECT lightning_supporter_until FROM users WHERE id = $1', [USER]);
  assert.ok(new Date(user.rows[0].lightning_supporter_until).getTime() > now);
  setLightningProvider(undefined);
});

test('lightningWebhookHandler: an unverifiable delivery is rejected (400) and credits nothing', async () => {
  setLightningProvider(fakeProvider('paid'));
  await insertPending('c1', USER, 30);
  const res = mockRes();
  await lightningWebhookHandler({ body: {} } as unknown as Request, res); // no id → verifyWebhook returns null
  assert.equal(res.statusCode, 400);
  const grant = await pool.query('SELECT status FROM lightning_grants WHERE id = $1', ['c1']);
  assert.equal(grant.rows[0].status, 'pending');
  setLightningProvider(undefined);
});
