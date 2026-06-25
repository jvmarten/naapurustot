import { Request, Response, NextFunction } from 'express';

interface RateBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateBucket>();

// Sweep expired entries periodically. Most windows are short (60 s for the authed
// limiters), so a long sweep interval lets expired buckets pile up between runs —
// under an IP/userId-rotation flood that is wasted memory. Sweeping every minute
// keeps peak accumulation bounded; the O(n) pass over a few thousand keys is cheap.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60 * 1000).unref();

/**
 * Derive the rate-limit identity from a request. Returns the identity string, or
 * `null` to skip limiting for this request (e.g. a by-userId limiter on an
 * unauthenticated request — there is no user to key on).
 */
export type RateKeyFn = (req: Request) => string | null;

export function getClientIp(req: Request): string {
  // index.ts sets `app.set('trust proxy', 1)` in production, so Express already
  // derives req.ip as the genuine client IP by trusting exactly one hop (the Caddy
  // reverse proxy). Caddy APPENDS the connecting peer to X-Forwarded-For rather than
  // overwriting it, so the leftmost header entry is attacker-controlled — parsing it
  // by hand (split(',')[0]) let anyone forge a fresh rate-limit bucket per request
  // and bypass the signup/login limits. Always defer to the trust-proxy-aware req.ip.
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Rate limiter factory: fixed-window counter, kept in process memory (resets on
 * restart, not shared across instances). Requests over the limit get 429 with a
 * Retry-After header.
 *
 * IN-5: the identity is configurable via `keyFn`. The default keys on client IP
 * (the per-IP limiter). Passing a userId-deriving keyFn yields a SECOND, per-user
 * bucket — closing the CGNAT false-throttle (many users behind one NAT IP would
 * otherwise share a single bucket) and the IP-rotation-per-account abuse gap. A
 * keyFn returning null skips the request (e.g. an unauthenticated call on a
 * by-userId limiter), leaving it to the other limiters.
 * @param maxRequests - Maximum requests allowed in the window
 * @param windowMs - Window duration in milliseconds
 * @param prefix - Key prefix to separate different limiters
 * @param keyFn - Identity extractor (defaults to client IP)
 */
export function rateLimit(maxRequests: number, windowMs: number, prefix: string, keyFn: RateKeyFn = getClientIp) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const id = keyFn(req);
    if (id === null) { next(); return; }
    const key = `${prefix}:${id}`;
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count++;

    if (bucket.count > maxRequests) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      res.status(429).json({ error: 'Too many requests. Please try again later.' });
      return;
    }

    next();
  };
}
