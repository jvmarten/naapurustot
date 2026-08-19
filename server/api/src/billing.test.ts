import { test } from 'node:test';
import assert from 'node:assert/strict';
import type Stripe from 'stripe';
import { deriveSupporter, readPeriodEnd, normaliseSubscription, billingConfigured } from './billing.js';

// Pure unit tests for the entitlement derivation and the Stripe→row mapping. No DB or
// network — these cover the logic the webhook and the user-response path depend on.

test('deriveSupporter treats active and trialing as entitled', () => {
  const end = new Date('2030-01-01T00:00:00Z');
  assert.equal(deriveSupporter('active', end).supporter, true);
  assert.equal(deriveSupporter('trialing', end).supporter, true);
  // Surfaces the period end as an ISO string for display.
  assert.equal(deriveSupporter('active', end).supporterUntil, '2030-01-01T00:00:00.000Z');
});

test('deriveSupporter denies every non-active status', () => {
  // past_due is handled separately (dunning grace window) — everything else is out.
  for (const status of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', null, undefined, '']) {
    const r = deriveSupporter(status, new Date('2030-01-01T00:00:00Z'));
    assert.equal(r.supporter, false, `expected non-supporter for ${JSON.stringify(status)}`);
    assert.equal(r.supporterUntil, null);
  }
});

test('deriveSupporter keeps a past_due supporter through the paid period (dunning grace)', () => {
  const now = Date.UTC(2026, 0, 10);
  const periodEnd = new Date(Date.UTC(2026, 0, 20)); // still inside the paid period
  const r = deriveSupporter('past_due', periodEnd, now);
  assert.equal(r.supporter, true);
  assert.equal(r.supporterUntil, periodEnd.toISOString());
});

test('deriveSupporter drops a past_due supporter once the paid period has ended', () => {
  const now = Date.UTC(2026, 0, 25);
  const periodEnd = new Date(Date.UTC(2026, 0, 20)); // period already lapsed
  const r = deriveSupporter('past_due', periodEnd, now);
  assert.equal(r.supporter, false);
  assert.equal(r.supporterUntil, null);
});

test('deriveSupporter denies past_due with no (or invalid) period end — no grace evidence', () => {
  for (const end of [null, undefined, 'not-a-date']) {
    assert.equal(deriveSupporter('past_due', end).supporter, false);
  }
});

test('deriveSupporter yields a null until for a missing or invalid period end', () => {
  assert.equal(deriveSupporter('active', null).supporterUntil, null);
  assert.equal(deriveSupporter('active', undefined).supporterUntil, null);
  assert.equal(deriveSupporter('active', 'not-a-date').supporterUntil, null);
  // Still a supporter — only the display value is dropped.
  assert.equal(deriveSupporter('active', 'not-a-date').supporter, true);
});

test('deriveSupporter accepts a period end passed as an epoch string or Date', () => {
  assert.equal(deriveSupporter('active', new Date('2031-06-01T00:00:00Z')).supporterUntil, '2031-06-01T00:00:00.000Z');
  assert.equal(deriveSupporter('active', '2031-06-01T00:00:00.000Z').supporterUntil, '2031-06-01T00:00:00.000Z');
});

test('deriveSupporter treats a comp grant as entitled regardless of Stripe status', () => {
  // No subscription at all, or an explicitly non-entitling status — comp still wins.
  for (const status of [null, undefined, 'canceled', 'unpaid', 'incomplete_expired']) {
    const r = deriveSupporter(status, null, Date.now(), true);
    assert.equal(r.supporter, true, `comp should entitle despite status ${JSON.stringify(status)}`);
  }
});

test('deriveSupporter: a comp-only user has no renewal date (supporterUntil null)', () => {
  // Comp carries no period end; even a stale/leftover date is ignored unless the
  // subscription itself is entitling.
  assert.equal(deriveSupporter('canceled', new Date('2035-01-01T00:00:00Z'), Date.now(), true).supporterUntil, null);
  assert.equal(deriveSupporter(null, null, Date.now(), true).supporterUntil, null);
});

test('deriveSupporter: comp defaults off, so existing (comp-less) callers are unchanged', () => {
  assert.equal(deriveSupporter('canceled', null).supporter, false);
  assert.equal(deriveSupporter('active', new Date('2030-01-01T00:00:00Z')).supporter, true);
});

test('deriveSupporter: comp AND an active subscription still surfaces the sub renewal date', () => {
  const end = new Date('2030-01-01T00:00:00Z');
  const r = deriveSupporter('active', end, Date.now(), true);
  assert.equal(r.supporter, true);
  assert.equal(r.supporterUntil, '2030-01-01T00:00:00.000Z');
});

test('readPeriodEnd reads a top-level Unix seconds value', () => {
  const secs = Math.floor(Date.UTC(2030, 0, 1) / 1000);
  const d = readPeriodEnd({ current_period_end: secs });
  assert.equal(d?.toISOString(), '2030-01-01T00:00:00.000Z');
});

test('readPeriodEnd falls back to the first subscription item (newer API versions)', () => {
  const secs = Math.floor(Date.UTC(2030, 5, 15) / 1000);
  const d = readPeriodEnd({ items: { data: [{ current_period_end: secs }] } });
  assert.equal(d?.toISOString(), '2030-06-15T00:00:00.000Z');
});

test('readPeriodEnd returns null when neither location has a value', () => {
  assert.equal(readPeriodEnd({}), null);
  assert.equal(readPeriodEnd({ items: { data: [] } }), null);
});

test('normaliseSubscription maps the columns we store, incl. the metadata userId', () => {
  const secs = Math.floor(Date.UTC(2030, 0, 1) / 1000);
  const sub = {
    id: 'sub_123',
    customer: 'cus_456',
    status: 'active',
    current_period_end: secs,
    metadata: { userId: 'user-789' },
  } as unknown as Stripe.Subscription;
  const n = normaliseSubscription(sub);
  assert.equal(n.subscriptionId, 'sub_123');
  assert.equal(n.customerId, 'cus_456');
  assert.equal(n.status, 'active');
  assert.equal(n.userId, 'user-789');
  assert.equal(n.periodEnd?.toISOString(), '2030-01-01T00:00:00.000Z');
});

test('normaliseSubscription reads a customer object id and a missing userId', () => {
  const sub = {
    id: 'sub_1',
    customer: { id: 'cus_obj' },
    status: 'canceled',
    metadata: {},
  } as unknown as Stripe.Subscription;
  const n = normaliseSubscription(sub);
  assert.equal(n.customerId, 'cus_obj');
  assert.equal(n.userId, null);
  assert.equal(n.periodEnd, null);
});

test('billingConfigured requires both the secret key and the price id', () => {
  const key = process.env.STRIPE_SECRET_KEY;
  const price = process.env.STRIPE_PRICE_ID;
  try {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PRICE_ID;
    assert.equal(billingConfigured(), false);
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    assert.equal(billingConfigured(), false, 'key alone is not enough');
    process.env.STRIPE_PRICE_ID = 'price_x';
    assert.equal(billingConfigured(), true);
  } finally {
    if (key === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = key;
    if (price === undefined) delete process.env.STRIPE_PRICE_ID; else process.env.STRIPE_PRICE_ID = price;
  }
});
