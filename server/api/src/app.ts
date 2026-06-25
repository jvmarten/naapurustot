/**
 * Express app factory for naapurustot.fi.
 *
 * Split out of index.ts (IN-5) so the app can be constructed without binding a
 * port or touching the database — the route-level integration tests import
 * createApp() and drive it with a pg-mem-backed pool. index.ts wires the real
 * Sentry instrumentation, runs initDb(), and calls app.listen().
 */
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import * as Sentry from '@sentry/node';
import authRouter, { LARGE_BODY_ROUTES, httpErrorStatus } from './auth.js';
import { rateLimit } from './rateLimit.js';

export const ALLOWED_ORIGINS = [
  'https://naapurustot.fi',
  'https://www.naapurustot.fi',
  'https://jvmarten.github.io',
];

if (process.env.NODE_ENV !== 'production') {
  ALLOWED_ORIGINS.push('http://localhost:5173');
}

// IN-4: defend the SameSite=None auth cookie against CSRF. Browsers always send Origin
// on state-changing (non-GET) requests; a missing or non-allowlisted Origin on a
// POST/PUT/DELETE is a forged cross-site request (e.g. a drive-by POST /auth/logout).
function sameOriginOnly(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') { next(); return; }
  const origin = req.get('origin');
  if (origin && ALLOWED_ORIGINS.includes(origin)) { next(); return; }
  res.status(403).json({ error: 'Invalid origin' });
}

// Strip C0 control characters (incl. CR/LF) and DEL from user-controlled strings
// before logging, so a crafted request line cannot forge or split log entries.
function stripControlChars(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code > 31 && code !== 127) { out += ch; }
  }
  return out;
}

/** Build the Express app (middleware + routes). Does not listen or init the DB. */
export function createApp() {
  const app = express();

  if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  // Don't advertise the framework (reduces trivial fingerprinting).
  app.disable('x-powered-by');

  // Baseline security headers for a JSON-only API. We set the few that are
  // meaningful here explicitly rather than pulling in helmet (whose HTML-oriented
  // defaults — CSP, COEP — don't apply to a pure data API): block MIME sniffing,
  // forbid framing, suppress the Referer, and pin HSTS in production (Caddy
  // terminates TLS in front of this and passes the header through).
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    }
    next();
  });

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        // Reject by omitting CORS headers (the browser still blocks the response)
        // rather than throwing — a thrown error propagates to the Sentry/error
        // handler and returns a misleading 500, drowning real errors in noise.
        callback(null, false);
      }
    },
    credentials: true,
  }));

  // IN-4: a tight 16 KB limit for nearly every route, but the notes/preferences PUTs
  // carry legitimately large payloads. Stacking a second express.json() doesn't work —
  // the first parser to run consumes the stream — so dispatch to the right parser here.
  const jsonSmall = express.json({ limit: '16kb' });
  const jsonLarge = express.json({ limit: '1mb' });
  app.use((req: Request, res: Response, next: NextFunction) => {
    return (LARGE_BODY_ROUTES.has(req.path) ? jsonLarge : jsonSmall)(req, res, next);
  });
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // IN-4: a modest per-IP fixed-window limit across the authed API (writes + the heavy
  // GET /auth/export). Generous enough that real use never hits it; signup/login keep
  // their own stricter limiters (separate buckets) inside the router, and IN-5 adds a
  // per-user limiter inside the router too.
  app.use('/auth', rateLimit(300, 60_000, 'auth'), sameOriginOnly, authRouter);

  // Must be registered after routes — captures errors thrown from handlers.
  Sentry.setupExpressErrorHandler(app);

  // Final fallback: format unhandled errors as JSON. Sentry has already
  // captured them via the handler above. Stack traces and PII stay in
  // Sentry — the client only sees a generic message.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    // Pass user-controlled request fields as %s data arguments (never as the format
    // string itself) and strip control chars, to avoid tainted-format-string and
    // log-injection via a crafted method/URL.
    console.error('%s %s error:', stripControlChars(String(req.method)), stripControlChars(String(req.url)), err);
    if (!res.headersSent) {
      // IN-4: honor a body-parser 413 (payload too large) so the client can show the
      // right message instead of a misleading 500. Other errors stay generic (no leak).
      const status = httpErrorStatus(err);
      if (status === 413) {
        res.status(413).json({ error: 'Payload too large' });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });

  return app;
}
