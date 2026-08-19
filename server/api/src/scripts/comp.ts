/**
 * CLI to grant or revoke a manual PRO ("comp") entitlement by email.
 *
 * Usage (compiled — this is how it runs on the droplet, where devDeps incl. tsx are
 * pruned from the image):
 *
 *   docker compose exec api npm run grant-pro  -- someone@example.com
 *   docker compose exec api npm run revoke-pro -- someone@example.com
 *
 * or directly:
 *
 *   docker compose exec api node dist/scripts/comp.js grant  someone@example.com
 *   docker compose exec api node dist/scripts/comp.js revoke someone@example.com
 *
 * In dev (source, no build): npx tsx src/scripts/comp.ts grant someone@example.com
 *
 * Exit codes: 0 success · 1 no such account / runtime error · 2 bad usage.
 */
import { setCompSupporter } from '../comp.js';
import { closePool } from '../db.js';

async function main(): Promise<void> {
  const [action, email] = process.argv.slice(2);

  if ((action !== 'grant' && action !== 'revoke') || !email) {
    console.error('Usage: comp <grant|revoke> <email>');
    process.exitCode = 2;
    return; // pool never opened — nothing to close
  }

  try {
    const result = await setCompSupporter(email, action === 'grant');
    if (!result.updated) {
      console.error(`No account found with email: ${email}`);
      process.exitCode = 1;
      return;
    }
    const u = result.user!;
    console.log(
      `${action === 'grant' ? 'Granted' : 'Revoked'} PRO for ${u.username} <${u.email ?? ''}> ` +
        `(comp_supporter=${u.comp_supporter})`,
    );
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error('comp script failed:', err);
  process.exitCode = 1;
});
