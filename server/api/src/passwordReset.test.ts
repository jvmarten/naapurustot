import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildResetUrl,
  generateResetToken,
  hashResetToken,
  isWellFormedResetToken,
  MAX_EMAIL_LENGTH,
  normalizeEmail,
  normalizeLang,
  RESET_TOKEN_TTL_MS,
  resetTokenExpiry,
  validateEmail,
  validatePassword,
} from './passwordReset.js';

test('generateResetToken mints a unique, well-formed token and its hash', () => {
  const a = generateResetToken();
  const b = generateResetToken();

  assert.ok(isWellFormedResetToken(a.token), 'token matches the expected shape');
  assert.notEqual(a.token, b.token, 'tokens are not repeated');
  assert.equal(a.tokenHash, hashResetToken(a.token), 'hash matches the raw token');
  assert.equal(a.tokenHash.length, 64, 'SHA-256 hex is 64 chars');

  // The stored form must not reveal the emailed form.
  assert.ok(!a.tokenHash.includes(a.token));
});

test('hashResetToken is deterministic and diverges on any change', () => {
  assert.equal(hashResetToken('abc'), hashResetToken('abc'));
  assert.notEqual(hashResetToken('abc'), hashResetToken('abd'));
});

test('isWellFormedResetToken rejects wrong lengths, alphabets and non-strings', () => {
  const { token } = generateResetToken();
  assert.ok(isWellFormedResetToken(token));

  assert.ok(!isWellFormedResetToken(token.slice(0, 42)), 'too short');
  assert.ok(!isWellFormedResetToken(token + 'x'), 'too long');
  assert.ok(!isWellFormedResetToken('a'.repeat(42) + '+'), 'non-base64url character');
  assert.ok(!isWellFormedResetToken(undefined));
  assert.ok(!isWellFormedResetToken(null));
  assert.ok(!isWellFormedResetToken(12345));
  assert.ok(!isWellFormedResetToken({}));
});

test('validatePassword mirrors the signup rules', () => {
  assert.deepEqual(validatePassword('a'.repeat(12)), { ok: true });
  assert.deepEqual(validatePassword('a'.repeat(1000)), { ok: true });

  const short = validatePassword('a'.repeat(11));
  assert.equal(short.ok, false);
  assert.match((short as { error: string }).error, /at least 12/);

  // The cap exists to bound bcrypt CPU time, not to be user-friendly.
  const long = validatePassword('a'.repeat(1001));
  assert.equal(long.ok, false);
  assert.match((long as { error: string }).error, /at most 1000/);

  assert.equal(validatePassword('').ok, false);
  assert.equal(validatePassword(undefined).ok, false);
  assert.equal(validatePassword(12345678901234).ok, false);
});

test('validateEmail enforces shape and the RFC 5321 length cap', () => {
  assert.deepEqual(validateEmail('user@example.com'), { ok: true });
  assert.deepEqual(validateEmail('a.b+tag@sub.example.co.uk'), { ok: true });

  assert.equal(validateEmail('no-at-sign').ok, false);
  assert.equal(validateEmail('no@tld').ok, false);
  assert.equal(validateEmail('spaces in@example.com').ok, false);
  assert.equal(validateEmail(undefined).ok, false);
  assert.equal(validateEmail(null).ok, false);
  assert.equal(validateEmail(42).ok, false);

  const atCap = `${'a'.repeat(MAX_EMAIL_LENGTH - '@example.com'.length)}@example.com`;
  assert.equal(atCap.length, MAX_EMAIL_LENGTH);
  assert.deepEqual(validateEmail(atCap), { ok: true });
  assert.equal(validateEmail(`a${atCap}`).ok, false, 'one over the cap is refused');
});

test('normalizeEmail lowercases and trims so lookups match what signup stored', () => {
  assert.equal(normalizeEmail('  User@Example.COM '), 'user@example.com');
});

test('normalizeLang falls back to Finnish for anything unsupported', () => {
  assert.equal(normalizeLang('fi'), 'fi');
  assert.equal(normalizeLang('en'), 'en');
  assert.equal(normalizeLang('sv'), 'sv');
  assert.equal(normalizeLang('de'), 'fi');
  assert.equal(normalizeLang(undefined), 'fi');
  assert.equal(normalizeLang(null), 'fi');
  assert.equal(normalizeLang(7), 'fi');
});

test('resetTokenExpiry is one hour ahead of the supplied instant', () => {
  const now = 1_700_000_000_000;
  assert.equal(resetTokenExpiry(now).getTime(), now + RESET_TOKEN_TTL_MS);
  assert.equal(RESET_TOKEN_TTL_MS, 60 * 60 * 1000);
});

test('buildResetUrl targets the prerendered directory route and encodes the token', () => {
  const url = buildResetUrl('https://naapurustot.fi', 'abc-123_XYZ', 'en');
  assert.equal(url, 'https://naapurustot.fi/uusi-salasana/?token=abc-123_XYZ&lang=en');

  // A trailing slash on the base must not produce a double slash — the path has
  // to match the prerendered directory exactly, or Pages falls through to the SPA
  // 404 shell and the link answers 404 instead of 200.
  assert.equal(
    buildResetUrl('https://naapurustot.fi/', 'tok', 'fi'),
    'https://naapurustot.fi/uusi-salasana/?token=tok&lang=fi',
  );

  // Real tokens are base64url, but encode anyway: a '+' or '/' would otherwise
  // decode to a different string on arrival.
  assert.ok(buildResetUrl('https://x.fi', 'a+b/c=', 'sv').includes('token=a%2Bb%2Fc%3D'));
});
