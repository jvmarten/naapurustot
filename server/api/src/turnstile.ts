const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET || '';
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

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
