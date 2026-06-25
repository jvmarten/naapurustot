/**
 * Express API server entry point for naapurustot.fi.
 *
 * Provides user authentication (signup/login/logout/me), per-user data sync
 * (favorites, shortlist, notes, preferences), and GDPR export/deletion.
 * Runs behind Caddy reverse proxy at api.naapurustot.fi.
 * Database tables are auto-created on startup via initDb().
 *
 * The Express app itself lives in app.ts (createApp) so it can be constructed for
 * tests without binding a port or hitting the database; this file owns the Sentry
 * instrumentation, DB init, and listen().
 */
import './instrument.js';
import * as Sentry from '@sentry/node';
import type { Server } from 'http';
import { createApp } from './app.js';
import { initDb, getPool } from './db.js';

const PORT = parseInt(process.env.PORT || '3001', 10);

// Last-resort handlers so a stray rejection/exception in a background task (e.g.
// an unawaited promise, a setTimeout callback) is logged — and captured to Sentry
// when configured — before the process exits, instead of dying silently. In prod
// Sentry installs its own, but dev/CI have none, leaving the process unprotected.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
  }
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  if (process.env.SENTRY_DSN) Sentry.captureException(err);
  process.exit(1);
});

/** Drain in-flight requests, then close the DB pool, then exit. */
function shutdown(signal: string, server: Server): void {
  console.log(`${signal} received, shutting down gracefully...`);
  // Stop accepting new connections and wait for in-flight requests to finish.
  server.close(() => {
    getPool().end()
      .then(() => { console.log('Database pool closed'); process.exit(0); })
      .catch((err) => { console.error('Error closing pool:', err); process.exit(1); });
  });
  // Don't hang forever if a connection refuses to drain.
  setTimeout(() => { console.error('Forced shutdown after timeout'); process.exit(1); }, 10_000).unref();
}

async function start(): Promise<void> {
  await initDb();
  const app = createApp();
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`API server running on port ${PORT}`);
  });
  process.on('SIGTERM', () => shutdown('SIGTERM', server));
  process.on('SIGINT', () => shutdown('SIGINT', server));
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
