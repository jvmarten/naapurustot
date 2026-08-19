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
  for (const status of ['canceled', 'past_due', 'unpaid', 'incomplete', 'incomplete_expired', null, undefined, '']) {
    const r = deriveSupporter(status, new Date('2030-01-01T00:00:00Z'));
    assert.equal(r.supporter, false, `expected non-supporter for ${JSON.stringify(status)}`);
    assert.equal(r.supporterUntil, null);
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
