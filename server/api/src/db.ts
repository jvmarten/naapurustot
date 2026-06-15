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

/** Create tables if they don't exist. Safe to call on every startup; never alters existing tables (no migrations). */
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
  await runMigrations();
  console.log('Database initialized');
}
