import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { newDb, type IMemoryDb } from 'pg-mem';
import {
  parseAdminUsernames,
  isAdminUsername,
  summariseUser,
  buildAdminUsersPayload,
  escapeHtml,
  escapeJsonForScript,
  renderDashboard,
  type AdminUserRow,
} from './admin.js';

// A fixed "now" so grace-period math is deterministic.
const NOW = Date.parse('2026-08-20T12:00:00Z');
const FUTURE = new Date('2026-09-20T00:00:00Z');
const PAST = new Date('2026-08-01T00:00:00Z');

function row(overrides: Partial<AdminUserRow>): AdminUserRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    username: 'user',
    email: null,
    display_name: null,
    trust_level: 0,
    created_at: new Date('2026-01-01T00:00:00Z'),
    comp_supporter: false,
    billing_status: null,
    billing_period_end: null,
    ...overrides,
  };
}

// ── parseAdminUsernames / isAdminUsername ──

test('parseAdminUsernames: undefined/empty yields an empty set', () => {
  assert.equal(parseAdminUsernames(undefined).size, 0);
  assert.equal(parseAdminUsernames('').size, 0);
  assert.equal(parseAdminUsernames('  ,  , ').size, 0);
});

test('parseAdminUsernames: trims, lowercases, and dedupes', () => {
  const set = parseAdminUsernames(' Alice , BOB ,alice,, carol ');
  assert.deepEqual([...set].sort(), ['alice', 'bob', 'carol']);
});

test('isAdminUsername: case-insensitive membership; empty allowlist admits nobody', () => {
  assert.equal(isAdminUsername('Alice', 'alice,bob'), true);
  assert.equal(isAdminUsername('alice', 'Alice,Bob'), true);
  assert.equal(isAdminUsername('mallory', 'alice,bob'), false);
  assert.equal(isAdminUsername('alice', ''), false);
  assert.equal(isAdminUsername('alice', undefined), false);
  assert.equal(isAdminUsername(null, 'alice'), false);
  assert.equal(isAdminUsername('', 'alice'), false);
});

// ── summariseUser: tier derivation + source attribution ──

test('summariseUser: a plain account is Free with no source', () => {
  const u = summariseUser(row({}), NOW);
  assert.equal(u.tier, 'free');
  assert.equal(u.comp, false);
  assert.equal(u.stripe, false);
  assert.equal(u.proSource, null);
  assert.equal(u.billingStatus, null);
  assert.equal(u.supporterUntil, null);
});

test('summariseUser: comp grant is PRO (comp) with no renewal date', () => {
  const u = summariseUser(row({ comp_supporter: true }), NOW);
  assert.equal(u.tier, 'pro');
  assert.equal(u.comp, true);
  assert.equal(u.stripe, false);
  assert.equal(u.proSource, 'comp');
  assert.equal(u.supporterUntil, null); // a comp grant has no subscription
});

test('summariseUser: an active Stripe subscription is PRO (stripe) with a renewal date', () => {
  const u = summariseUser(row({ billing_status: 'active', billing_period_end: FUTURE }), NOW);
  assert.equal(u.tier, 'pro');
  assert.equal(u.stripe, true);
  assert.equal(u.comp, false);
  assert.equal(u.proSource, 'stripe');
  assert.equal(u.billingStatus, 'active');
  assert.equal(u.supporterUntil, FUTURE.toISOString());
});

test('summariseUser: past_due keeps PRO within the paid grace window, lapses after it', () => {
  const inGrace = summariseUser(row({ billing_status: 'past_due', billing_period_end: FUTURE }), NOW);
  assert.equal(inGrace.tier, 'pro');
  assert.equal(inGrace.stripe, true);

  const lapsed = summariseUser(row({ billing_status: 'past_due', billing_period_end: PAST }), NOW);
  assert.equal(lapsed.tier, 'free');
  assert.equal(lapsed.stripe, false);
  assert.equal(lapsed.billingStatus, 'past_due'); // raw status still surfaced
});

test('summariseUser: a canceled subscription is Free', () => {
  const u = summariseUser(row({ billing_status: 'canceled', billing_period_end: PAST }), NOW);
  assert.equal(u.tier, 'free');
  assert.equal(u.proSource, null);
});

test('summariseUser: comp AND an active subscription attribute to both sources', () => {
  const u = summariseUser(
    row({ comp_supporter: true, billing_status: 'active', billing_period_end: FUTURE }),
    NOW,
  );
  assert.equal(u.tier, 'pro');
  assert.equal(u.comp, true);
  assert.equal(u.stripe, true);
  assert.equal(u.proSource, 'comp+stripe');
});

test('summariseUser: normalises fields (createdAt ISO, empty email → null, trust number)', () => {
  const u = summariseUser(
    row({ email: '', display_name: 'Alice', trust_level: 2, created_at: new Date('2026-05-01T10:00:00Z') }),
    NOW,
  );
  assert.equal(u.email, null);
  assert.equal(u.displayName, 'Alice');
  assert.equal(u.trustLevel, 2);
  assert.equal(u.createdAt, '2026-05-01T10:00:00.000Z');
});

// ── HTML rendering / XSS safety ──

test('escapeHtml escapes the five significant characters', () => {
  assert.equal(escapeHtml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
});

test('escapeJsonForScript neutralises a </script> breakout in embedded data', () => {
  const encoded = escapeJsonForScript({ name: '</script><img src=x onerror=alert(1)>' });
  assert.ok(!encoded.includes('</script'), 'no raw </script token survives');
  assert.ok(encoded.includes('\\u003c/script'), '< is escaped to \\u003c');
  // Round-trips back to the original value.
  assert.equal(JSON.parse(encoded).name, '</script><img src=x onerror=alert(1)>');
});

test('renderDashboard keeps a malicious display name inert (no breakout, no unescaped markup)', () => {
  const payload = {
    generatedAt: '2026-08-20T12:00:00.000Z',
    counts: { total: 1, pro: 0, free: 1, comp: 0, stripe: 0, withEmail: 0 },
    users: [
      summariseUser(row({ username: 'evil', display_name: '</script><script>alert(1)</script>' }), NOW),
    ],
  };
  const html = renderDashboard(payload, 'test-nonce');
  // The data block must not let the attacker's </script> close the tag.
  assert.ok(!html.includes('</script><script>alert(1)</script>'), 'attacker markup does not appear raw');
  assert.ok(html.includes('window.__ADMIN_DATA__'), 'embeds the data');
  assert.ok(html.includes('nonce="test-nonce"'), 'applies the CSP nonce to inline blocks');
  // Exactly the two legitimate closing </script> tags (data block + renderer).
  assert.equal(html.split('</script>').length - 1, 2);
});

// ── buildAdminUsersPayload against a pg-mem-backed pool ──

let pool: import('pg').Pool;
let mem: IMemoryDb;

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
      display_name TEXT,
      trust_level SMALLINT NOT NULL DEFAULT 0,
      comp_supporter BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`
    CREATE TABLE user_billing (
      user_id UUID PRIMARY KEY,
      status VARCHAR(20),
      current_period_end TIMESTAMPTZ
    )`);
});

beforeEach(async () => {
  await pool.query('DELETE FROM user_billing');
  await pool.query('DELETE FROM users');
});

test('buildAdminUsersPayload: counts tiers and sources across a mixed set', async () => {
  await pool.query(
    `INSERT INTO users (id, username, email, comp_supporter, created_at) VALUES
       ('a0000000-0000-0000-0000-000000000001', 'alice', 'alice@example.com', TRUE,  '2026-01-01'),
       ('a0000000-0000-0000-0000-000000000002', 'bob',   'bob@example.com',   FALSE, '2026-02-01'),
       ('a0000000-0000-0000-0000-000000000003', 'carol', NULL,               FALSE, '2026-03-01'),
       ('a0000000-0000-0000-0000-000000000004', 'dave',  'dave@example.com',  FALSE, '2026-04-01')`,
  );
  await pool.query(
    `INSERT INTO user_billing (user_id, status, current_period_end) VALUES
       ('a0000000-0000-0000-0000-000000000002', 'active',   '2026-09-20'),
       ('a0000000-0000-0000-0000-000000000004', 'canceled', '2026-08-01')`,
  );

  const payload = await buildAdminUsersPayload(NOW);
  assert.equal(payload.counts.total, 4);
  assert.equal(payload.counts.pro, 2); // alice (comp) + bob (stripe active)
  assert.equal(payload.counts.free, 2); // carol (none) + dave (canceled)
  assert.equal(payload.counts.comp, 1);
  assert.equal(payload.counts.stripe, 1);
  assert.equal(payload.counts.withEmail, 3);

  const byName = Object.fromEntries(payload.users.map((u) => [u.username, u]));
  assert.equal(byName.alice.proSource, 'comp');
  assert.equal(byName.bob.proSource, 'stripe');
  assert.equal(byName.carol.tier, 'free');
  assert.equal(byName.dave.tier, 'free');
  assert.equal(byName.dave.billingStatus, 'canceled');
});

test('buildAdminUsersPayload: empty database yields all-zero counts', async () => {
  const payload = await buildAdminUsersPayload(NOW);
  assert.deepEqual(payload.counts, { total: 0, pro: 0, free: 0, comp: 0, stripe: 0, withEmail: 0 });
  assert.deepEqual(payload.users, []);
});
