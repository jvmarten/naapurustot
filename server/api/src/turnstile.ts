const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET || '';
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile(token: string, ip?: string): Promise<boolean> {
  // Skip verification if no secret is configured (dev mode)
  if (!TURNSTILE_SECRET) return true;

  try {
    const params = new URLSearchParams();
    params.set('secret', TURNSTILE_SECRET);
    params.set('response', token);
    if (ip) params.set('remoteip', ip);

    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const data = await res.json() as { success: boolean };
    return data.success === true;
  } catch (err) {
    console.error('Turnstile verification failed:', err);
    return false;
  }
}
