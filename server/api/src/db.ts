/**
 * Database connection pool and schema initialization.
 *
 * Tables are created with IF NOT EXISTS on startup, so the schema is
 * always up to date without requiring a separate migration step.
 */
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  console.error('Unexpected idle client error:', err.message);
});

/** Create tables if they don't exist. Safe to call on every startup. */
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
  console.log('Database initialized');
}

export default pool;
