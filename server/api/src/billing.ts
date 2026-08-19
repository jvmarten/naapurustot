/**
 * Supporter subscription (Stripe) — checkout, customer portal, webhook, and the
 * entitlement derivation the rest of the API reads.
 *
 * Design notes:
 *
 *  - **Billing is optional, like the whole server.** With no STRIPE_SECRET_KEY /
 *    STRIPE_PRICE_ID configured, `billingConfigured()` is false: the checkout and
 *    portal routes answer 503, the webhook answers 503, and `getSupporterStatus`
 *    reports "not a supporter". The app (and the rest of the auth API) run exactly
 *    as before — a supporter tier never becomes load-bearing for the free product.
 *
 *  - **Entitlement is server-derived, never client-asserted.** The only writer of
 *    `user_billing` is the Stripe webhook (below). Everything else reads it and
 *    derives a boolean via `deriveSupporter` — a client cannot mint its own PRO.
 *
 *  - **The webhook is idempotent.** Stripe retries deliveries, so each event id is
 *    recorded in `stripe_events` and re-deliveries are skipped; the underlying
 *    writes are upserts, so even a missed dedup converges to Stripe's truth.
 */
import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { getPool } from './db.js';

/** The one plan we sell. Stored on the row so a future second plan is a data change. */
export const SUPPORTER_PLAN = 'supporter';

const APP_BASE_URL = process.env.APP_BASE_URL || 'https://naapurustot.fi';

let stripeInstance: Stripe | null = null;

/** Lazily build the Stripe client from the environment. Returns null when billing
 *  is not configured, so the server runs (and tests import this module) without keys. */
export function getStripe(): Stripe | null {
  // A `setStripe`-injected instance (tests) wins over the env, mirroring db.ts's setPool.
  if (stripeInstance) return stripeInstance;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  stripeInstance = new Stripe(key);
  return stripeInstance;
}

/** True when both the secret key and the price to sell are configured. */
export function billingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
}

/** TEST ONLY: inject a fake Stripe (or reset with null). */
export function setStripe(s: Stripe | null): void {
  stripeInstance = s;
}

/**
 * Derive the public entitlement from a `user_billing` row (or its absence).
 *
 * `active` / `trialing` is Stripe's own truth for "currently entitled" — an active
 * subscription's `current_period_end` is always in the future, and a failed payment
 * moves the status to `past_due`/`canceled` via webhook — so the boolean keys on
 * status, not on the clock, and cannot falsely revoke a paying supporter in the brief
 * window around a renewal. `current_period_end` is surfaced for display only.
 */
export function deriveSupporter(
  status: unknown,
  currentPeriodEnd: unknown,
): { supporter: boolean; supporterUntil: string | null } {
  const supporter = status === 'active' || status === 'trialing';
  let supporterUntil: string | null = null;
  if (supporter && currentPeriodEnd) {
    const d = currentPeriodEnd instanceof Date ? currentPeriodEnd : new Date(currentPeriodEnd as string);
    if (!Number.isNaN(d.getTime())) supporterUntil = d.toISOString();
  }
  return { supporter, supporterUntil };
}

/** Read a user's supporter status. Cheap indexed PK lookup; safe when unconfigured. */
export async function getSupporterStatus(
  userId: string,
): Promise<{ supporter: boolean; supporterUntil: string | null }> {
  const { rows } = await getPool().query(
    'SELECT status, current_period_end FROM user_billing WHERE user_id = $1',
    [userId],
  );
  if (rows.length === 0) return { supporter: false, supporterUntil: null };
  return deriveSupporter(rows[0].status, rows[0].current_period_end);
}

/** The billing fields for the GDPR export. Stripe holds the invoices themselves (and
 *  retains them for the legally required period); this is the account's own copy of
 *  the subscription state we store. */
export async function getBillingExport(userId: string): Promise<Record<string, unknown> | null> {
  const { rows } = await getPool().query(
    `SELECT provider, plan, status, current_period_end, stripe_customer_id, updated_at
       FROM user_billing WHERE user_id = $1`,
    [userId],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    provider: r.provider,
    plan: r.plan,
    status: r.status,
    currentPeriodEnd: r.current_period_end,
    stripeCustomerId: r.stripe_customer_id,
    updatedAt: r.updated_at,
  };
}

/**
 * Cancel a user's Stripe subscription immediately — called from account deletion so a
 * deleted account stops being billed. Best-effort: swallow errors (the row is about to
 * be cascade-deleted regardless, and Stripe stays the source of truth for the invoice
 * history it must retain). No-op when billing is unconfigured or the user never paid.
 */
export async function cancelSubscriptionForUser(userId: string): Promise<void> {
  const stripe = getStripe();
  if (!stripe) return;
  const { rows } = await getPool().query(
    'SELECT stripe_subscription_id FROM user_billing WHERE user_id = $1',
    [userId],
  );
  const subId = rows[0]?.stripe_subscription_id;
  if (!subId) return; // never subscribed — nothing to cancel
  try {
    const sub = await stripe.subscriptions.retrieve(subId);
    if (sub.status === 'canceled') return; // already ended (e.g. via the portal)
    await stripe.subscriptions.cancel(subId);
  } catch (err) {
    if ((err as { code?: string }).code === 'resource_missing') return; // gone at Stripe
    // Transient/unknown failure — PROPAGATE so the caller aborts the account deletion
    // rather than deleting our only record of a subscription that is still billing.
    throw err;
  }
}

// ── Webhook helpers (pure-ish, so the mapping is unit-testable) ──

/** Read `current_period_end` wherever the installed API version keeps it (top-level on
 *  older versions, on the first item on newer ones), as a Date or null. */
export function readPeriodEnd(sub: unknown): Date | null {
  const s = sub as { current_period_end?: number; items?: { data?: Array<{ current_period_end?: number }> } };
  const secs = s.current_period_end ?? s.items?.data?.[0]?.current_period_end;
  return typeof secs === 'number' ? new Date(secs * 1000) : null;
}

/** Normalise a Stripe Subscription into the columns we store. */
export function normaliseSubscription(sub: Stripe.Subscription): {
  subscriptionId: string;
  customerId: string | null;
  status: string;
  periodEnd: Date | null;
  userId: string | null;
} {
  return {
    subscriptionId: sub.id,
    customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null,
    status: sub.status,
    periodEnd: readPeriodEnd(sub),
    userId: (sub.metadata?.userId as string | undefined) || null,
  };
}

/** Attribute an event to a user: prefer the metadata userId we stamped at checkout,
 *  else match an existing row by subscription or customer id. */
async function resolveUserId(
  metadataUserId: string | null,
  subscriptionId: string | null,
  customerId: string | null,
): Promise<string | null> {
  if (metadataUserId) return metadataUserId;
  const { rows } = await getPool().query(
    `SELECT user_id FROM user_billing
       WHERE ($1::text IS NOT NULL AND stripe_subscription_id = $1)
          OR ($2::text IS NOT NULL AND stripe_customer_id = $2)
       LIMIT 1`,
    [subscriptionId, customerId],
  );
  return rows[0]?.user_id ?? null;
}

/** Upsert a subscription's current state for a user. The webhook is the sole caller. */
async function writeBilling(
  userId: string,
  data: { subscriptionId: string | null; customerId: string | null; status: string; periodEnd: Date | null },
): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO user_billing
         (user_id, provider, plan, stripe_customer_id, stripe_subscription_id, status, current_period_end, updated_at)
       VALUES ($1, 'stripe', $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, user_billing.stripe_customer_id),
         stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, user_billing.stripe_subscription_id),
         status = EXCLUDED.status,
         current_period_end = EXCLUDED.current_period_end,
         updated_at = NOW()`,
      [userId, SUPPORTER_PLAN, data.customerId, data.subscriptionId, data.status, data.periodEnd],
    );
  } catch (err) {
    // 23503 = FK violation: the user was deleted between the event and now (e.g. a late
    // subscription.deleted after account deletion). Nothing left to bill — treat as a
    // no-op so the webhook acks 200 instead of 500-looping Stripe's retries for days.
    if ((err as { code?: string }).code === '23503') return;
    throw err;
  }
}

/** Apply one Stripe subscription object to `user_billing`. Exported for testing. */
export async function applySubscription(sub: Stripe.Subscription): Promise<void> {
  const n = normaliseSubscription(sub);
  const userId = await resolveUserId(n.userId, n.subscriptionId, n.customerId);
  if (!userId) return; // can't attribute — ignore rather than guess
  await writeBilling(userId, n);
}

// ── Routes ──

/** Authenticated billing router, mounted under /auth/billing by auth.ts so it runs
 *  behind resolveUser (which sets req.userId) and the CSRF/rate-limit middleware. */
export const billingRouter = Router();

interface AuthedReq extends Request { userId?: string | null }

billingRouter.post('/checkout', async (req: Request, res: Response): Promise<void> => {
  const userId = (req as AuthedReq).userId;
  if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

  const stripe = getStripe();
  if (!stripe || !billingConfigured()) { res.status(503).json({ error: 'Billing not configured' }); return; }

  // Reuse an existing Stripe customer if the user has paid before; otherwise let
  // Checkout collect the email (needed for the receipt and VAT location evidence),
  // seeded from the account address when there is one.
  const [billing, account] = await Promise.all([
    getPool().query('SELECT stripe_customer_id FROM user_billing WHERE user_id = $1', [userId]),
    getPool().query('SELECT email FROM users WHERE id = $1', [userId]),
  ]);
  const customerId: string | undefined = billing.rows[0]?.stripe_customer_id ?? undefined;
  const accountEmail: string | undefined = account.rows[0]?.email ?? undefined;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
      client_reference_id: userId,
      // Stamp the userId on the subscription so every later webhook can attribute it.
      subscription_data: { metadata: { userId } },
      allow_promotion_codes: true,
      // EU VAT (OSS): enable in Stripe once registered — gated so an unconfigured Tax
      // setup can't make checkout throw before that.
      ...(process.env.STRIPE_TAX_ENABLED === 'true' ? { automatic_tax: { enabled: true } } : {}),
      ...(customerId ? { customer: customerId } : accountEmail ? { customer_email: accountEmail } : {}),
      success_url: `${APP_BASE_URL}/?supporter=success`,
      cancel_url: `${APP_BASE_URL}/?supporter=cancelled`,
    });
    if (!session.url) { res.status(502).json({ error: 'Billing not configured' }); return; }
    res.json({ url: session.url });
  } catch (err) {
    console.error('checkout session create failed:', err);
    res.status(502).json({ error: 'Could not start checkout' });
  }
});

billingRouter.post('/portal', async (req: Request, res: Response): Promise<void> => {
  const userId = (req as AuthedReq).userId;
  if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

  const stripe = getStripe();
  if (!stripe || !billingConfigured()) { res.status(503).json({ error: 'Billing not configured' }); return; }

  const { rows } = await getPool().query(
    'SELECT stripe_customer_id FROM user_billing WHERE user_id = $1',
    [userId],
  );
  const customerId = rows[0]?.stripe_customer_id;
  if (!customerId) { res.status(400).json({ error: 'No subscription' }); return; }

  try {
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${APP_BASE_URL}/?supporter=portal`,
    });
    res.json({ url: portal.url });
  } catch (err) {
    console.error('portal session create failed:', err);
    res.status(502).json({ error: 'Could not open billing portal' });
  }
});

/**
 * Stripe webhook. Registered in app.ts with a RAW body parser BEFORE the JSON parser
 * (signature verification needs the exact bytes) and OUTSIDE /auth (Stripe sends no
 * allowlisted Origin, so the CSRF guard would 403 it).
 */
export async function stripeWebhookHandler(req: Request, res: Response): Promise<void> {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) { res.status(503).json({ error: 'Billing not configured' }); return; }

  const sig = req.headers['stripe-signature'];
  let event: Stripe.Event;
  try {
    // req.body is a Buffer here (express.raw). constructEvent both verifies the
    // signature and parses — a forged or tampered body throws.
    event = stripe.webhooks.constructEvent(req.body as Buffer, sig as string, secret);
  } catch (err) {
    console.error('stripe webhook signature verification failed:', (err as Error).message);
    res.status(400).json({ error: 'Invalid signature' });
    return;
  }

  // Idempotency: skip an event we've already recorded (Stripe retries deliveries).
  try {
    const seen = await getPool().query('SELECT 1 FROM stripe_events WHERE id = $1', [event.id]);
    if (seen.rows.length > 0) { res.json({ received: true, duplicate: true }); return; }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === 'subscription' && session.subscription) {
          const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
          const sub = await stripe.subscriptions.retrieve(subId);
          // Ensure attribution even if metadata didn't propagate: prefer the session's
          // client_reference_id.
          if (!sub.metadata?.userId && session.client_reference_id) {
            sub.metadata = { ...sub.metadata, userId: session.client_reference_id };
          }
          await applySubscription(sub);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        // Re-fetch the live subscription rather than trusting the event's embedded
        // snapshot. Stripe does not guarantee event ordering (and retries reorder
        // freely), so applying a stale snapshot could overwrite newer state — a
        // retried `past_due` landing after `active` (wrong revoke), or an old `active`
        // after `deleted` (wrong grant). A retrieve at processing time always returns
        // Stripe's current truth, so out-of-order deliveries converge correctly.
        const embedded = event.data.object as Stripe.Subscription;
        const fresh = await stripe.subscriptions.retrieve(embedded.id);
        await applySubscription(fresh);
        break;
      }
      default:
        break; // ignore everything else
    }

    // Record only after successful processing so a mid-processing failure lets Stripe
    // retry (the writes above are idempotent, so a retry is safe).
    await getPool().query('INSERT INTO stripe_events (id) VALUES ($1) ON CONFLICT DO NOTHING', [event.id]);
    res.json({ received: true });
  } catch (err) {
    console.error('stripe webhook processing failed:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}
