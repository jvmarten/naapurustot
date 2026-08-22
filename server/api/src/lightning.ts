/**
 * Bitcoin / Lightning PRO — a PREPAID, TIME-BOXED supporter entitlement.
 *
 * Why this is shaped differently from Stripe (billing.ts):
 *
 *  - **Bitcoin has no recurring subscription.** A Lightning payment is one-shot and
 *    irreversible (there are no chargebacks). So Lightning PRO cannot be an auto-renewing
 *    subscription: a payment buys a fixed WINDOW of PRO (a plan's `windowDays`) and it
 *    lapses on its own once the window passes, unless the user pays again. Renewing early
 *    STACKS the remaining time (see `extendWindow`).
 *
 *  - **The window lives on the users row, not user_billing.** `users.lightning_supporter_until`
 *    (migration 008) is OR'd into `deriveSupporter` as a fourth, time-boxed source — exactly
 *    like `comp_supporter`, and for the same reason: the Stripe webhook's clobbering upsert
 *    owns `user_billing`. Expiry needs no cron; `deriveSupporter` recomputes `> now` on read.
 *
 *  - **Entitlement is server-derived, never client-asserted.** The window is written ONLY
 *    by a settled, re-fetched-and-confirmed payment (the webhook below) or the operator CLI
 *    — never by anything the browser sends.
 *
 *  - **Provider-agnostic.** The concrete processor (a custodial one like OpenNode, or a
 *    self-hosted BTCPay Server) is a `LightningProvider` behind this interface, chosen by
 *    `LIGHTNING_PROVIDER`. Adding a second provider is a new adapter, not a change here.
 *
 *  - **Optional, like the whole server.** With no provider configured, `lightningConfigured()`
 *    is false: checkout and the webhook answer 503 and the free app (and Stripe) are untouched.
 */
import { Router, Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getPool } from './db.js';

/** Plan id — the two windows we sell. A plan exists only when its price is configured. */
export type LightningPlanId = 'month' | 'year';

export interface LightningPlan {
  id: LightningPlanId;
  /** Days of PRO one payment buys. */
  windowDays: number;
  /** Price in euro cents, VAT-inclusive (the price lives in env, never hard-coded). */
  amountEurCents: number;
}

const APP_BASE_URL = process.env.APP_BASE_URL || 'https://naapurustot.fi';
export const LIGHTNING_PLAN_NAME = 'lightning';

// ── Plans (from the environment) ──

function envInt(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The configured plans, in display order. A plan is offered only when its EUR price is
 * set; the window length falls back to a sensible default (30 / 365 days) when its own
 * var is unset. Returns [] when neither plan is priced.
 */
export function listPlans(): LightningPlan[] {
  const plans: LightningPlan[] = [];
  const month = envInt('LIGHTNING_PRICE_EUR_MONTH');
  if (month !== null) {
    plans.push({ id: 'month', windowDays: envInt('LIGHTNING_WINDOW_DAYS_MONTH') ?? 30, amountEurCents: month });
  }
  const year = envInt('LIGHTNING_PRICE_EUR_YEAR');
  if (year !== null) {
    plans.push({ id: 'year', windowDays: envInt('LIGHTNING_WINDOW_DAYS_YEAR') ?? 365, amountEurCents: year });
  }
  return plans;
}

function findPlan(id: unknown): LightningPlan | null {
  if (id !== 'month' && id !== 'year') return null;
  return listPlans().find((p) => p.id === id) ?? null;
}

// ── Provider interface ──

export interface LightningCharge {
  /** The provider's own charge/settlement id — our idempotency + ledger key. */
  id: string;
  /** A hosted invoice/checkout page (with the BTC/Lightning QR); we redirect the browser here. */
  hostedUrl: string;
}

export interface LightningChargeStatus {
  status: 'paid' | 'pending' | 'expired' | 'unknown';
  /** The amount the provider recorded, in euro cents, when it can report it. */
  amountEurCents: number | null;
}

/**
 * A payment processor. Everything money-critical (crediting, idempotency, stacking) lives
 * in this module; a provider only mints a hosted charge, authenticates its own webhook to
 * a charge id, and answers the source-of-truth status re-fetch.
 */
export interface LightningProvider {
  readonly id: string;
  createCharge(params: {
    chargeDescription: string;
    amountEurCents: number;
    successUrl: string;
  }): Promise<LightningCharge>;
  /** Authenticate an inbound webhook request and return the charge id it refers to, or
   *  null if it fails verification. NEVER trusts the body beyond the id it authenticates. */
  verifyWebhook(req: Request): Promise<string | null> | string | null;
  /** Re-fetch a charge's settlement state from the provider — the trust root for crediting
   *  (a webhook body is only ever trusted for the id it is signed over). */
  fetchChargeStatus(chargeId: string): Promise<LightningChargeStatus>;
}

let injectedProvider: LightningProvider | null | undefined;

/** TEST ONLY: inject a fake provider (or reset with undefined to fall back to the env). */
export function setLightningProvider(p: LightningProvider | null | undefined): void {
  injectedProvider = p;
}

/**
 * Resolve the configured provider from `LIGHTNING_PROVIDER`, or null when none is set.
 * A test-injected provider (setLightningProvider) wins, mirroring billing.ts's setStripe.
 */
export function getLightningProvider(): LightningProvider | null {
  if (injectedProvider !== undefined) return injectedProvider;
  switch ((process.env.LIGHTNING_PROVIDER || '').toLowerCase()) {
    case 'opennode':
      return openNodeProvider();
    // A self-hosted BTCPay Server adapter drops in here as a second case implementing
    // LightningProvider (create via its Greenfield API, verify the BTCPAY-SIG HMAC over
    // the raw body, re-fetch the invoice). It needs a raw-body webhook route in app.ts.
    default:
      return null;
  }
}

/** True when a provider is resolvable AND at least one plan is priced. */
export function lightningConfigured(): boolean {
  return getLightningProvider() !== null && listPlans().length > 0;
}

// ── OpenNode adapter (reference custodial provider) ──
//
// NOTE: this HTTP integration is not exercised by CI (a fake provider is injected in
// tests, exactly as Stripe's client is). Verify it against OpenNode's live API in their
// dev environment before enabling it in production.

function openNodeProvider(): LightningProvider | null {
  const apiKey = process.env.OPENNODE_API_KEY;
  if (!apiKey) return null;
  const base = process.env.OPENNODE_BASE_URL || 'https://api.opennode.com';
  const callbackUrl = `${(process.env.API_BASE_URL || 'https://api.naapurustot.fi').replace(/\/$/, '')}/billing/lightning/webhook`;
  return {
    id: 'opennode',
    async createCharge({ chargeDescription, amountEurCents, successUrl }) {
      const res = await fetch(`${base.replace(/\/$/, '')}/v1/charges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: apiKey },
        body: JSON.stringify({
          amount: amountEurCents / 100, // OpenNode takes a major-unit amount
          currency: 'EUR',
          description: chargeDescription,
          callback_url: callbackUrl,
          success_url: successUrl,
          ttl: 30,
        }),
      });
      if (!res.ok) throw new Error(`OpenNode charge create failed: ${res.status}`);
      const body = (await res.json()) as { data?: { id?: string; hosted_checkout_url?: string } };
      const id = body.data?.id;
      const hostedUrl = body.data?.hosted_checkout_url;
      if (!id || !hostedUrl) throw new Error('OpenNode charge create returned no id/url');
      return { id, hostedUrl };
    },
    verifyWebhook(req: Request): string | null {
      // OpenNode posts form-encoded fields incl. `id` and `hashed_order` =
      // HMAC-SHA256(id, api_key). The HMAC authenticates ONLY the id, so we trust nothing
      // else from the body — the status/amount come from fetchChargeStatus below.
      const body = (req.body ?? {}) as Record<string, unknown>;
      const id = typeof body.id === 'string' ? body.id : '';
      const provided = typeof body.hashed_order === 'string' ? body.hashed_order : '';
      if (!id || !provided) return null;
      const expected = createHmac('sha256', apiKey).update(id).digest('hex');
      const a = Buffer.from(expected);
      const b = Buffer.from(provided);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
      return id;
    },
    async fetchChargeStatus(chargeId: string): Promise<LightningChargeStatus> {
      const res = await fetch(`${base.replace(/\/$/, '')}/v1/charges/${encodeURIComponent(chargeId)}`, {
        headers: { Authorization: apiKey },
      });
      if (!res.ok) throw new Error(`OpenNode charge fetch failed: ${res.status}`);
      const body = (await res.json()) as { data?: { status?: string; fiat_value?: number } };
      const raw = body.data?.status;
      const status: LightningChargeStatus['status'] =
        raw === 'paid' || raw === 'processing' ? 'paid'
        : raw === 'expired' || raw === 'refunded' ? 'expired'
        : raw === 'unpaid' || raw === 'underpaid' ? 'pending'
        : 'unknown';
      const fiat = body.data?.fiat_value;
      return { status, amountEurCents: typeof fiat === 'number' ? Math.round(fiat * 100) : null };
    },
  };
}

// ── Window math (pure, unit-tested) ──

/**
 * Extend a prepaid window: renewing early STACKS onto the remaining time, renewing after
 * it has lapsed starts fresh from now. `max(now, currentUntil) + windowDays`.
 */
export function extendWindow(currentUntil: unknown, now: number, windowDays: number): Date {
  const current = currentUntil instanceof Date ? currentUntil : currentUntil ? new Date(currentUntil as string) : null;
  const base = current && !Number.isNaN(current.getTime()) && current.getTime() > now ? current.getTime() : now;
  return new Date(base + windowDays * 24 * 60 * 60 * 1000);
}

// ── Crediting (the single writer of a paid window) ──

export interface CreditResult {
  credited: boolean;
  /** Why nothing was credited, for logging/tests: an unknown or already-settled charge. */
  reason?: 'unknown-charge' | 'duplicate' | 'account-gone';
  grantedUntil?: string | null;
}

/**
 * Apply a SETTLED charge to its user's prepaid window. Idempotent and safe against
 * out-of-order / retried deliveries:
 *
 *   - the pending ledger row (written at checkout, keyed by the provider charge id) is the
 *     idempotency key — a charge already 'paid' is a no-op, like the stripe_events ledger;
 *   - userId and windowDays come from THAT row (which we wrote), never from the callback;
 *   - the user row is locked FOR UPDATE so two concurrent settlements STACK rather than
 *     collapse into one window.
 *
 * Only ever called after the provider's own re-fetch confirmed 'paid'.
 */
export async function creditLightningPayment(chargeId: string, now: number = Date.now()): Promise<CreditResult> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const grant = await client.query(
      'SELECT user_id, window_days, status FROM lightning_grants WHERE id = $1 FOR UPDATE',
      [chargeId],
    );
    if (grant.rows.length === 0) {
      await client.query('ROLLBACK');
      return { credited: false, reason: 'unknown-charge' };
    }
    const row = grant.rows[0];
    if (row.status === 'paid') {
      await client.query('ROLLBACK');
      return { credited: false, reason: 'duplicate' };
    }
    if (!row.user_id) {
      // Account deleted between checkout and settlement — nothing to grant. Mark the row
      // settled so a retry doesn't reprocess it; the (anonymised) row stays for VAT.
      await client.query(`UPDATE lightning_grants SET status = 'paid' WHERE id = $1`, [chargeId]);
      await client.query('COMMIT');
      return { credited: false, reason: 'account-gone' };
    }
    const user = await client.query(
      'SELECT lightning_supporter_until FROM users WHERE id = $1 FOR UPDATE',
      [row.user_id],
    );
    const current = user.rows[0]?.lightning_supporter_until ?? null;
    const until = extendWindow(current, now, row.window_days);
    await client.query('UPDATE users SET lightning_supporter_until = $1, updated_at = NOW() WHERE id = $2', [
      until,
      row.user_id,
    ]);
    await client.query(`UPDATE lightning_grants SET status = 'paid', granted_until = $1 WHERE id = $2`, [
      until,
      chargeId,
    ]);
    await client.query('COMMIT');
    return { credited: true, grantedUntil: until.toISOString() };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── Operator CLI helpers (manual grant / refund; there are no chargebacks) ──

/** Manually extend a user's window by N days (comp-via-Lightning), matched by email. */
export async function extendLightningByEmail(email: string, days: number): Promise<{ updated: boolean; until?: string }> {
  const now = Date.now();
  const { rows } = await getPool().query('SELECT id, lightning_supporter_until FROM users WHERE lower(email) = lower($1)', [email]);
  if (rows.length === 0) return { updated: false };
  const until = extendWindow(rows[0].lightning_supporter_until, now, days);
  await getPool().query('UPDATE users SET lightning_supporter_until = $1, updated_at = NOW() WHERE id = $2', [until, rows[0].id]);
  return { updated: true, until: until.toISOString() };
}

/** Manually clear a user's Lightning window (a goodwill refund — Lightning is irreversible,
 *  so this only revokes the entitlement; returning the sats is a separate outbound payment). */
export async function revokeLightningByEmail(email: string): Promise<{ updated: boolean }> {
  const { rowCount } = await getPool().query(
    'UPDATE users SET lightning_supporter_until = NULL, updated_at = NOW() WHERE lower(email) = lower($1)',
    [email],
  );
  return { updated: (rowCount ?? 0) > 0 };
}

// ── Routes ──

interface AuthedReq extends Request { userId?: string | null }

/** Authenticated Lightning router, mounted under /auth/billing/ln (behind resolveUser +
 *  CSRF + the per-user limiter, like billingRouter). */
export const lightningRouter = Router();

/** The plans on offer (empty when unconfigured) so the modal can render the options. GET,
 *  so it is safe to answer 200 with `configured:false` rather than 503. */
lightningRouter.get('/plans', (_req: Request, res: Response): void => {
  res.json({ configured: lightningConfigured(), plans: lightningConfigured() ? listPlans() : [] });
});

lightningRouter.post('/checkout', async (req: Request, res: Response): Promise<void> => {
  const userId = (req as AuthedReq).userId;
  if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

  const provider = getLightningProvider();
  if (!provider || !lightningConfigured()) { res.status(503).json({ error: 'Billing not configured' }); return; }

  const plan = findPlan(req.body?.plan);
  if (!plan) { res.status(400).json({ error: 'Unknown plan' }); return; }

  try {
    const charge = await provider.createCharge({
      chargeDescription: `naapurustot PRO — ${plan.windowDays} days`,
      amountEurCents: plan.amountEurCents,
      successUrl: `${APP_BASE_URL}/?supporter=success`,
    });
    // Record a PENDING ledger row keyed by the provider charge id BEFORE redirecting, so
    // the webhook maps id → (userId, windowDays, amount) from data WE wrote, not the
    // callback. buyer_country is 'FI': the Lightning tier launches Finland-only, so the
    // single 25.5% VAT rate makes the fixed EUR price genuinely VAT-inclusive.
    await getPool().query(
      `INSERT INTO lightning_grants (id, user_id, provider, plan, window_days, amount_eur_cents, buyer_country, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'FI', 'pending')
       ON CONFLICT (id) DO NOTHING`,
      [charge.id, userId, provider.id, plan.id, plan.windowDays, plan.amountEurCents],
    );
    res.json({ url: charge.hostedUrl });
  } catch (err) {
    console.error('lightning checkout failed:', err);
    res.status(502).json({ error: 'Could not start Lightning checkout' });
  }
});

/**
 * Provider webhook. Registered in app.ts alongside the Stripe webhook — OUTSIDE /auth (the
 * provider sends no browser Origin, so the same-origin CSRF guard must not apply) and with
 * its own body parser. Authenticates to a charge id, then re-fetches the live status from
 * the provider and credits only on a confirmed 'paid'. Trusts the callback for the id only.
 */
export async function lightningWebhookHandler(req: Request, res: Response): Promise<void> {
  const provider = getLightningProvider();
  if (!provider || !lightningConfigured()) { res.status(503).json({ error: 'Billing not configured' }); return; }

  const chargeId = await provider.verifyWebhook(req);
  if (!chargeId) { res.status(400).json({ error: 'Invalid signature' }); return; }

  try {
    const status = await provider.fetchChargeStatus(chargeId);
    if (status.status === 'paid') {
      await creditLightningPayment(chargeId);
    }
    res.json({ received: true });
  } catch (err) {
    console.error('lightning webhook processing failed:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}
