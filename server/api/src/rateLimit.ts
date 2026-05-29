import { Request, Response, NextFunction } from 'express';

interface RateBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateBucket>();

// Clean up expired entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 10 * 60 * 1000).unref();

function getClientIp(req: Request): string {
  // index.ts sets `app.set('trust proxy', 1)` in production, so Express already
  // derives req.ip as the genuine client IP by trusting exactly one hop (the Caddy
  // reverse proxy). Caddy APPENDS the connecting peer to X-Forwarded-For rather than
  // overwriting it, so the leftmost header entry is attacker-controlled — parsing it
  // by hand (split(',')[0]) let anyone forge a fresh rate-limit bucket per request
  // and bypass the signup/login limits. Always defer to the trust-proxy-aware req.ip.
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Rate limiter factory.
 * @param maxRequests - Maximum requests allowed in the window
 * @param windowMs - Window duration in milliseconds
 * @param prefix - Key prefix to separate different limiters
 */
export function rateLimit(maxRequests: number, windowMs: number, prefix: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = getClientIp(req);
    const key = `${prefix}:${ip}`;
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
