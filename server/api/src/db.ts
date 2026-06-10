/**
 * Database connection pool and schema initialization.
 *
 * Tables are created with IF NOT EXISTS on startup. Column changes to an existing
 * table go through the IN-3 forward-only migration runner below (no more manual
 * ALTERs against the live database).
 */
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
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
}

/** Create tables if they don't exist. Safe to call on every startup; never alters existing tables (no migrations). */
export async function initDb(): Promise<void> {
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

export default pool;
