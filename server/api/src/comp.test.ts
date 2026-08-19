import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { newDb, type IMemoryDb } from 'pg-mem';
import { setCompSupporter } from './comp.js';

// pg-mem-backed tests for the manual comp grant. No Docker / real DATABASE_URL.

let pool: import('pg').Pool;
let mem: IMemoryDb;

const USER_ID = '22222222-2222-2222-2222-222222222222';

before(async () => {
  mem = newDb();
  const pgAdapter = mem.adapters.createPg();
  pool = new pgAdapter.Pool();
  const { setPool } = await import('./db.js');
  setPool(pool);
  await pool.query(`
    CREATE TABLE users (
      id UUID PRIMARY KEY,
      username TEXT UNIQUE,
      email TEXT UNIQUE,
      password TEXT,
      comp_supporter BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
});

beforeEach(async () => {
  await pool.query('DELETE FROM users');
  await pool.query(
    `INSERT INTO users (id, username, email, password) VALUES ($1, 'alice', 'alice@example.com', 'x')`,
    [USER_ID],
  );
});

test('setCompSupporter grants and persists, matching email case-insensitively', async () => {
  const r = await setCompSupporter('ALICE@Example.com', true);
  assert.equal(r.updated, true);
  assert.equal(r.user?.comp_supporter, true);
  assert.equal(r.user?.id, USER_ID);

  const persisted = await pool.query('SELECT comp_supporter FROM users WHERE id = $1', [USER_ID]);
  assert.equal(persisted.rows[0].comp_supporter, true);
});

test('setCompSupporter revokes an existing grant', async () => {
  await setCompSupporter('alice@example.com', true);
  const r = await setCompSupporter('alice@example.com', false);
  assert.equal(r.updated, true);
  assert.equal(r.user?.comp_supporter, false);

  const persisted = await pool.query('SELECT comp_supporter FROM users WHERE id = $1', [USER_ID]);
  assert.equal(persisted.rows[0].comp_supporter, false);
});

test('setCompSupporter reports updated:false for an unknown email (no user touched)', async () => {
  const r = await setCompSupporter('nobody@example.com', true);
  assert.equal(r.updated, false);
  assert.equal(r.user, undefined);

  // The real user was left alone.
  const persisted = await pool.query('SELECT comp_supporter FROM users WHERE id = $1', [USER_ID]);
  assert.equal(persisted.rows[0].comp_supporter, false);
});
