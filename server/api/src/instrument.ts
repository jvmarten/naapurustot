import * as Sentry from '@sentry/node';

// Imported as the first line of index.ts. Must run before express is required
// so Sentry's auto-instrumentation can wrap the module on load. No-op without
// SENTRY_DSN — local dev and CI builds don't initialize Sentry.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    environment: process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE,
  });
}
