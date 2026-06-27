const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET || '';
const IS_PROD = process.env.NODE_ENV === 'production';
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
// Network timeout for the siteverify call. A hung connection to Cloudflare would
// otherwise block the signup handler indefinitely (Node's fetch has no default
// timeout); failing closed after this window is far better than stalling.
const VERIFY_TIMEOUT_MS = 5000;

// A missing secret in production must NOT silently allow-all (bot protection off) —
// but it also must NOT take the whole API down. This used to `throw` at module load,
// which crash-looped the entire server (issue #45): login, logout, sync and the GDPR
// endpoints all died over one optional feature's misconfiguration, even though only
// signup calls verifyTurnstile(). Instead we fail closed on signup (see below) and
// log loudly here so the misconfiguration is visible in logs/Sentry at startup.
if (IS_PROD && !TURNSTILE_SECRET) {
  console.error(
    'TURNSTILE_SECRET is not set in production — signup is refused (fail-closed) until ' +
    'it is configured. All other endpoints (login, sync, GDPR) are unaffected.',
  );
}

// Optional, opt-in hostname binding. When set (e.g. "naapurustot.fi,www.naapurustot.fi"),
// a solved token is only accepted if Cloudflare reports it was issued for one of
// these hostnames — preventing token reuse from a phishing clone or another page
// embedding the same public site key. Unset → no hostname check (dev/staging).
const ALLOWED_HOSTNAMES = (process.env.TURNSTILE_ALLOWED_HOSTNAMES || '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

/**
 * Verify a Cloudflare Turnstile token against the siteverify API.
 * With no secret configured: allow-all in dev/staging (every request passes without
 * contacting Cloudflare) but fail closed in production (never silently disable bot
 * protection). With a secret: fails closed on rejection, hostname-allowlist mismatch,
 * or any network/parse error.
 */
export async function verifyTurnstile(token: string, ip?: string): Promise<boolean> {
  // No secret configured: allow-all in dev/staging, fail closed in production.
  if (!TURNSTILE_SECRET) return !IS_PROD;

  try {
    const body = new URLSearchParams({ secret: TURNSTILE_SECRET, response: token });
    if (ip) body.set('remoteip', ip);

    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      // Abort (and fail closed via the catch below) if Cloudflare doesn't respond.
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });

    const data = await res.json() as { success: boolean; hostname?: string };
    if (data.success !== true) return false;
    // Enforce hostname binding only when an allowlist is configured.
    if (ALLOWED_HOSTNAMES.length > 0) {
      const host = (data.hostname || '').toLowerCase();
      if (!host || !ALLOWED_HOSTNAMES.includes(host)) {
        console.warn('Turnstile hostname mismatch:', data.hostname);
        return false;
      }
    }
    return true;
  } catch (err) {
    console.error('Turnstile verification failed:', err);
    return false;
  }
}
