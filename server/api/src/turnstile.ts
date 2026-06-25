const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET || '';
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
// Network timeout for the siteverify call. A hung connection to Cloudflare would
// otherwise block the signup handler indefinitely (Node's fetch has no default
// timeout); failing closed after this window is far better than stalling.
const VERIFY_TIMEOUT_MS = 5000;

// Mirror the JWT_SECRET guard in auth.ts: in production a missing secret would
// make verifyTurnstile() allow-all and silently disable bot protection, so fail
// loudly at startup instead. Dev/staging (no secret) intentionally skips this.
if (process.env.NODE_ENV === 'production' && !TURNSTILE_SECRET) {
  throw new Error('TURNSTILE_SECRET environment variable must be set in production');
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
 * Allow-all when TURNSTILE_SECRET is unset (dev/staging — every request
 * passes without contacting Cloudflare). Otherwise fails closed: returns
 * false on rejection, hostname-allowlist mismatch, or any network/parse error.
 */
export async function verifyTurnstile(token: string, ip?: string): Promise<boolean> {
  // Skip verification if no secret is configured (dev mode)
  if (!TURNSTILE_SECRET) return true;

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
