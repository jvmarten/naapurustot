/**
 * Express API server for naapurustot.fi.
 *
 * Provides user authentication (signup/login/logout/me), per-user data sync
 * (favorites, shortlist, notes, preferences), and GDPR export/deletion.
 * Runs behind Caddy reverse proxy at api.naapurustot.fi.
 * Database tables are auto-created on startup via initDb().
 */
import './instrument.js';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import * as Sentry from '@sentry/node';
import authRouter, { LARGE_BODY_ROUTES, httpErrorStatus } from './auth.js';
import { rateLimit } from './rateLimit.js';
import { initDb } from './db.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

const ALLOWED_ORIGINS = [
  'https://naapurustot.fi',
  'https://www.naapurustot.fi',
  'https://jvmarten.github.io',
];

if (process.env.NODE_ENV !== 'production') {
  ALLOWED_ORIGINS.push('http://localhost:5173');
}

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

// IN-4: defend the SameSite=None auth cookie against CSRF. Browsers always send Origin
// on state-changing (non-GET) requests; a missing or non-allowlisted Origin on a
// POST/PUT/DELETE is a forged cross-site request (e.g. a drive-by POST /auth/logout).
function sameOriginOnly(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') { next(); return; }
  const origin = req.get('origin');
  if (origin && ALLOWED_ORIGINS.includes(origin)) { next(); return; }
  res.status(403).json({ error: 'Invalid origin' });
}

// IN-4: a modest per-IP fixed-window limit across the authed API (writes + the heavy
// GET /auth/export). Generous enough that real use never hits it; signup/login keep
// their own stricter limiters (separate buckets) inside the router.
app.use('/auth', rateLimit(300, 60_000, 'auth'), sameOriginOnly, authRouter);

// Must be registered after routes — captures errors thrown from handlers.
Sentry.setupExpressErrorHandler(app);

// Final fallback: format unhandled errors as JSON. Sentry has already
// captured them via the handler above. Stack traces and PII stay in
// Sentry — the client only sees a generic message.
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  console.error(`${req.method} ${req.url} error:`, err);
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

async function start(): Promise<void> {
  await initDb();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`API server running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
