/**
 * Database connection pool and schema initialization.
 *
 * Tables are created with IF NOT EXISTS on startup. Column changes to an existing
 * table go through the IN-3 forward-only migration runner below (no more manual
 * ALTERs against the live database).
 */
import pg from 'pg';

// IN-5: the pool is created lazily (on first getPool) rather than at module load so
// tests can inject a pg-mem-backed Pool via setPool() before any query runs, without
// reaching for a real DATABASE_URL or Docker.
let poolInstance: pg.Pool | null = null;

/** Return the shared connection pool, creating it on first use. */
export function getPool(): pg.Pool {
  if (!poolInstance) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is required');
    }
    poolInstance = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
    });
  }
  return poolInstance;
}

/** TEST ONLY: replace the pool (e.g. with a pg-mem-backed Pool) before any query runs. */
export function setPool(p: pg.Pool): void {
  poolInstance = p;
}

/** Close the pool if one was ever created (else a no-op). Lets short-lived processes
 *  (the comp CLI) exit cleanly without getPool() lazily creating a pool just to end it. */
export async function closePool(): Promise<void> {
  if (poolInstance) {
    const p = poolInstance;
    poolInstance = null;
    await p.end();
  }
}

// IN-5: an arbitrary fixed key identifying the migration-runner advisory lock. Any
// process that starts up serializes on this key, so a crash-loop relaunch or a
// future second replica can't run runMigrations concurrently.
const MIGRATION_LOCK_KEY = 4815162342;

/**
 * IN-3: forward-only schema migrations. Each entry is applied once, in order,
 * inside its own transaction, and recorded in schema_migrations so it never
 * re-runs. ADD COLUMN IF NOT EXISTS keeps each step idempotent even if the
 * ledger is ever lost. Append new migrations; never edit a shipped one.
 */
const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: '001_user_preferences_wizard_profile',
    sql: `ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS wizard_profile JSONB NOT NULL DEFAULT '{}'`,
  },
  {
    // Session invalidation for password resets. JWTs are stateless and live 7
    // days, so without a server-side generation counter a completed reset would
    // leave an attacker's existing cookie working — defeating the main reason
    // people reset a password. The token carries `tv`; resolveUser (auth.ts)
    // compares it against this column and rejects the stale generation.
    // DEFAULT 0 matches the `tv` fallback for tokens issued before this shipped,
    // so the deploy does not sign every existing user out.
    id: '002_users_token_version',
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0`,
  },
  {
    // Supporter subscription state, one row per paying user. Written ONLY by the
    // Stripe webhook (billing.ts); everything else derives a boolean from it. The
    // CASCADE drops it with the account — Stripe retains the invoices it must keep
    // for tax, so nothing legally required is lost, and account deletion first
    // cancels the live subscription (see DELETE /auth/account) so a deleted account
    // stops being billed. Each column stays single-statement so pg-mem (the test
    // backend) runs the migration exactly as Postgres does.
    id: '003_user_billing',
    sql: `CREATE TABLE IF NOT EXISTS user_billing (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      provider VARCHAR(20) NOT NULL DEFAULT 'stripe',
      plan VARCHAR(40),
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      status VARCHAR(20),
      current_period_end TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  },
  {
    // Webhook idempotency ledger: an event id is recorded after it is processed, and
    // a re-delivery of the same id is skipped (Stripe retries deliveries).
    id: '004_stripe_events',
    sql: `CREATE TABLE IF NOT EXISTS stripe_events (
      id TEXT PRIMARY KEY,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  },
  {
    // The webhook attributes an unlabelled event by matching customer/subscription id.
    id: '005_user_billing_customer_idx',
    sql: `CREATE INDEX IF NOT EXISTS idx_user_billing_customer ON user_billing (stripe_customer_id)`,
  },
  {
    id: '006_user_billing_subscription_idx',
    sql: `CREATE INDEX IF NOT EXISTS idx_user_billing_subscription ON user_billing (stripe_subscription_id)`,
  },
  {
    // Manual "comp" PRO grant, set ONLY server-side by the grant-pro/revoke-pro CLI
    // (comp.ts) — never client-asserted, so the "a client cannot mint its own PRO"
    // invariant holds. The entitlement layer (auth.ts formatUser → deriveSupporter)
    // ORs this with the Stripe-derived flag, so a comped account shows PRO with no
    // subscription. It lives on the users row, NOT user_billing — the webhook upserts
    // user_billing and would clobber a grant kept there; on the users row Stripe events
    // never touch it. Single statement + IF NOT EXISTS so pg-mem and a re-run apply it
    // identically to Postgres.
    id: '007_users_comp_supporter',
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS comp_supporter BOOLEAN NOT NULL DEFAULT FALSE`,
  },
];

async function runMigrations(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // IN-5: hold a session-level advisory lock for the whole runner so two startups
  // (a crash-loop relaunch, or a future second replica) can't apply migrations at
  // once — the loser would otherwise read an empty schema_migrations, re-run a
  // migration, and crash on the schema_migrations PK (23505). The lock is acquired
  // BEFORE reading the ledger and released in finally; it also auto-releases if the
  // session dies. The migration steps keep their own per-step transactions.
  const lockClient = await pool.connect();
  try {
    await lockClient.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.id));
    for (const m of MIGRATIONS) {
      if (applied.has(m.id)) continue;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [m.id]);
        await client.query('COMMIT');
        console.log(`Applied migration ${m.id}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
  } finally {
    // Release explicitly; swallow errors so a hiccup here never masks a real failure.
    await lockClient.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {});
    lockClient.release();
  }
}

/** Create tables if they don't exist, then run any pending forward-only migrations.
 *  Safe (idempotent) to call on every startup. */
export async function initDb(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username VARCHAR(20) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE,
      password VARCHAR(255) NOT NULL,
      display_name VARCHAR(255),
      trust_level SMALLINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_favorites (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      favorites JSONB NOT NULL DEFAULT '[]',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_notes (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      notes JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      filter_presets JSONB NOT NULL DEFAULT '[]',
      quality_weights JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // QW-2b: durable shortlist sync (mirrors user_favorites).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_shortlist (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      shortlist JSONB NOT NULL DEFAULT '[]',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Password-reset tokens. Only the SHA-256 hash of a token is stored, so a
  // database dump cannot be replayed against /auth/reset-password. Rows are
  // single-use (used_at) and time-limited (expires_at); the CASCADE drops them
  // with the account.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Supports both hot paths: invalidating a user's outstanding tokens on a
  // successful reset, and the periodic purge of expired rows.
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_prt_user_id ON password_reset_tokens (user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_prt_expires_at ON password_reset_tokens (expires_at)`);
  await runMigrations();
  console.log('Database initialized');
}
