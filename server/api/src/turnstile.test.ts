import { test, before } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Regression test for issue #45 (the live API crash-looped on every deploy).
 *
 * turnstile.ts used to `throw` at module-load time when TURNSTILE_SECRET was unset in
 * production, which took the WHOLE server down (login, logout, sync and the GDPR
 * endpoints all died) even though only signup calls verifyTurnstile(). The fix keeps
 * the security intent — never silently allow-all in production — by failing closed on
 * signup instead of crashing the process.
 *
 * turnstile.ts reads NODE_ENV + TURNSTILE_SECRET once at evaluation time, so the env is
 * set before the dynamic import (mirrors auth.routes.test.ts). `node --test` isolates
 * each test file in its own process, so this env mutation does not leak to other suites.
 */
process.env.NODE_ENV = 'production';
delete process.env.TURNSTILE_SECRET;

let verifyTurnstile: (token: string, ip?: string) => Promise<boolean>;

before(async () => {
  // Must not throw — the old module-load guard crash-looped the container here.
  ({ verifyTurnstile } = await import('./turnstile.js'));
});

test('production with no secret fails closed instead of allowing all (issue #45)', async () => {
  assert.equal(await verifyTurnstile('any-token'), false);
  assert.equal(await verifyTurnstile(''), false);
});
