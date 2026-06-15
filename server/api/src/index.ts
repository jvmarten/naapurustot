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
import { createApp } from './app.js';
import { initDb } from './db.js';

const PORT = parseInt(process.env.PORT || '3001', 10);

async function start(): Promise<void> {
  await initDb();
  const app = createApp();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`API server running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
