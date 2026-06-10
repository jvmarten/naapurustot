import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDeleteConfirmation, buildExportPayload, validateWizardProfile } from './auth.js';

// CF-13: focused unit tests for the pure GDPR helpers. No DB required — these
// cover the validation/branching that guards account deletion and the shape of
// the personal-data export payload.

test('validateDeleteConfirmation accepts the exact "DELETE" token', () => {
  assert.deepEqual(validateDeleteConfirmation('DELETE'), { ok: true });
});

test('validateDeleteConfirmation rejects anything else', () => {
  for (const bad of [undefined, null, '', 'delete', 'Delete', 'DELETE ', 'yes', 0, true, {}]) {
    const result = validateDeleteConfirmation(bad);
    assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(bad)}`);
    if (!result.ok) assert.equal(typeof result.error, 'string');
  }
});

test('buildExportPayload maps an account row to camelCase fields', () => {
  const payload = buildExportPayload({
    user: {
      id: 'u1',
      username: 'tester',
      email: 'a@b.fi',
      display_name: 'Test',
      trust_level: 0,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-02-02T00:00:00Z',
    },
    favorites: ['00100', '00200'],
    shortlist: ['00300'],
    notes: { '00100': 'nice area' },
    preferences: { filterPresets: [{ name: 'p1', criteria: [] }], qualityWeights: { income: 50 } },
  });

  assert.equal(payload.account?.id, 'u1');
  assert.equal(payload.account?.username, 'tester');
  assert.equal(payload.account?.email, 'a@b.fi');
  assert.equal(payload.account?.displayName, 'Test');
  assert.deepEqual(payload.favorites, ['00100', '00200']);
  assert.deepEqual(payload.shortlist, ['00300']);
  assert.deepEqual(payload.notes, { '00100': 'nice area' });
  assert.deepEqual(payload.filterPresets, [{ name: 'p1', criteria: [] }]);
  assert.deepEqual(payload.qualityWeights, { income: 50 });
  assert.equal(typeof payload.exportedAt, 'string');
});

test('buildExportPayload uses documented empty defaults for missing rows', () => {
  const payload = buildExportPayload({
    user: { id: 'u2', username: 'min', email: null, display_name: null, trust_level: 0, created_at: 'x', updated_at: 'y' },
    favorites: undefined,
    shortlist: undefined,
    notes: undefined,
    preferences: undefined,
  });

  assert.equal(payload.account?.email, null);
  assert.equal(payload.account?.displayName, null);
  assert.deepEqual(payload.favorites, []);
  assert.deepEqual(payload.shortlist, []);
  assert.deepEqual(payload.notes, {});
  assert.deepEqual(payload.filterPresets, []);
  assert.deepEqual(payload.qualityWeights, {});
});

test('buildExportPayload yields a null account when the user row is absent', () => {
  const payload = buildExportPayload({
    user: undefined,
    favorites: undefined,
    shortlist: undefined,
    notes: undefined,
    preferences: undefined,
  });
  assert.equal(payload.account, null);
});

test('buildExportPayload includes wizardProfile (IN-3)', () => {
  const payload = buildExportPayload({
    user: undefined, favorites: undefined, shortlist: undefined, notes: undefined,
    preferences: { wizardProfile: { transitImportance: 5, hasChildren: true } },
  });
  assert.deepEqual(payload.wizardProfile, { transitImportance: 5, hasChildren: true });
  // Defaults to {} when no preferences row exists.
  const empty = buildExportPayload({
    user: undefined, favorites: undefined, shortlist: undefined, notes: undefined, preferences: undefined,
  });
  assert.deepEqual(empty.wizardProfile, {});
});

test('validateWizardProfile accepts a well-formed profile (IN-3)', () => {
  const v = validateWizardProfile({
    transitImportance: 4, quietPreference: 'quiet', budgetMin: 1000, budgetMax: 6000,
    sizePreference: 'medium', tenurePreference: 'either', hasChildren: true,
    schoolImportance: 5, healthcareImportance: 3,
  });
  assert.equal(v.ok, true);
});

test('validateWizardProfile rejects non-objects, unknown keys, oversized + non-finite values (IN-3)', () => {
  for (const bad of [null, undefined, 'x', 42, [1, 2]]) {
    assert.equal(validateWizardProfile(bad).ok, false, `expected rejection for ${JSON.stringify(bad)}`);
  }
  assert.equal(validateWizardProfile({ evilKey: 1 }).ok, false);
  assert.equal(validateWizardProfile({ quietPreference: 'x'.repeat(21) }).ok, false);
  assert.equal(validateWizardProfile({ transitImportance: Infinity }).ok, false);
  assert.equal(validateWizardProfile({ hasChildren: { nested: true } }).ok, false);
});
