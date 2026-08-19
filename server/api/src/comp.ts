/**
 * Manual "comp" PRO grants — a supporter entitlement handed out by the operator,
 * independent of Stripe.
 *
 * Why this exists and how it stays safe:
 *  - The `comp_supporter` flag lives on the `users` row (migration 007), NOT in
 *    `user_billing`. The Stripe webhook upserts `user_billing` on every event, so a
 *    grant kept there would be clobbered; on the users row, Stripe never touches it.
 *  - It is written ONLY here, and this is invoked ONLY by the server-side CLI
 *    (scripts/comp.ts). There is no HTTP path to set it, so the "a client cannot mint
 *    its own PRO" invariant in billing.ts holds.
 *  - The entitlement layer (auth.ts `formatUser` → `deriveSupporter`) ORs the flag with
 *    the Stripe-derived supporter status, so a comped account shows PRO with no
 *    subscription and no renewal date.
 */
import { getPool } from './db.js';

export interface CompResult {
  /** True when a user with that email existed and was updated. */
  updated: boolean;
  /** The affected row, present only when updated. */
  user?: { id: string; username: string; email: string | null; comp_supporter: boolean };
}

/**
 * Grant (value=true) or revoke (value=false) a manual PRO entitlement, matched on the
 * account's email case-insensitively (stored emails are lowercased, but lower() on both
 * sides is robust regardless, and NULL emails never match). At most one row matches —
 * `email` is UNIQUE. Returns `updated: false` when no account has that email.
 */
export async function setCompSupporter(email: string, value: boolean): Promise<CompResult> {
  const { rows } = await getPool().query(
    `UPDATE users SET comp_supporter = $1, updated_at = NOW()
       WHERE lower(email) = lower($2)
     RETURNING id, username, email, comp_supporter`,
    [value, email],
  );
  if (rows.length === 0) return { updated: false };
  return { updated: true, user: rows[0] };
}
