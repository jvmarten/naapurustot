/**
 * CLI to manually manage a user's prepaid Lightning PRO window, matched by email.
 *
 * Lightning payments are automated end-to-end (a settled charge credits the window via the
 * provider webhook), so this is only for the cases that have no automated path:
 *   - a goodwill grant / comp-via-Lightning:  extend N days
 *   - a goodwill refund:                        revoke the window (Lightning is irreversible,
 *                                               so returning the sats is a separate outbound
 *                                               payment you make from your wallet)
 *
 * Usage (compiled, on the droplet):
 *   docker compose exec api npm run grant-lightning  -- someone@example.com 365
 *   docker compose exec api npm run revoke-lightning -- someone@example.com
 * or: node dist/scripts/lightning.js grant  someone@example.com 365
 *     node dist/scripts/lightning.js revoke someone@example.com
 *
 * In dev: npx tsx src/scripts/lightning.ts grant someone@example.com 365
 *
 * Exit codes: 0 success · 1 no such account / runtime error · 2 bad usage.
 */
import { extendLightningByEmail, revokeLightningByEmail } from '../lightning.js';
import { closePool } from '../db.js';

async function main(): Promise<void> {
  const [action, email, daysArg] = process.argv.slice(2);

  if (action !== 'grant' && action !== 'revoke') {
    console.error('Usage: lightning <grant|revoke> <email> [days]');
    process.exitCode = 2;
    return;
  }
  if (!email) {
    console.error('Usage: lightning <grant|revoke> <email> [days]');
    process.exitCode = 2;
    return;
  }

  try {
    if (action === 'grant') {
      const days = Number(daysArg);
      if (!Number.isInteger(days) || days <= 0) {
        console.error('grant needs a positive integer number of days');
        process.exitCode = 2;
        return;
      }
      const r = await extendLightningByEmail(email, days);
      if (!r.updated) {
        console.error(`No account found with email: ${email}`);
        process.exitCode = 1;
        return;
      }
      console.log(`Extended Lightning PRO for ${email} by ${days} days (until ${r.until})`);
    } else {
      const r = await revokeLightningByEmail(email);
      if (!r.updated) {
        console.error(`No account found with email: ${email}`);
        process.exitCode = 1;
        return;
      }
      console.log(`Revoked Lightning PRO window for ${email}`);
    }
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error('lightning script failed:', err);
  process.exitCode = 1;
});
