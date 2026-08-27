import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCatalog,
  sanitizeAssistOutput,
  buildSystemPrompt,
  isAssistConfigured,
  type CatalogEntry,
} from './assist.js';

// The model call itself needs the network + an API key, so these tests cover the
// two pure trust boundaries instead: request-catalog validation and model-output
// sanitisation. Everything the client ends up acting on passes through these.

const CATALOG: CatalogEntry[] = [
  { id: 'tree_canopy', label: 'Tree cover', higherIsBetter: true },
  { id: 'crime_rate', label: 'Crime', higherIsBetter: false },
  { id: 'rental_price', label: 'Rent', higherIsBetter: false },
];
const IDS = new Set(CATALOG.map((c) => c.id));

test('parseCatalog accepts a well-formed catalog and defaults higherIsBetter to true', () => {
  const out = parseCatalog([{ id: 'a', label: 'A' }, { id: 'b', label: 'B', higherIsBetter: false }]);
  assert.ok(out);
  assert.equal(out!.length, 2);
  assert.equal(out![0].higherIsBetter, true, 'missing flag defaults to true');
  assert.equal(out![1].higherIsBetter, false);
});

test('parseCatalog rejects empty, oversized, and malformed input', () => {
  assert.equal(parseCatalog(null), null);
  assert.equal(parseCatalog([]), null);
  assert.equal(parseCatalog('nope'), null);
  assert.equal(parseCatalog([{ id: 123, label: 'x' }]), null, 'non-string id yields nothing usable');
  assert.equal(parseCatalog([{ id: 'x' }]), null, 'missing label');
  const huge = Array.from({ length: 201 }, (_v, i) => ({ id: `l${i}`, label: 'x' }));
  assert.equal(parseCatalog(huge), null, 'over the 200-entry cap');
});

test('parseCatalog drops duplicates and over-long fields but keeps the good ones', () => {
  const out = parseCatalog([
    { id: 'a', label: 'A' },
    { id: 'a', label: 'A again' },
    { id: 'b', label: 'x'.repeat(500) },
    { id: 'x'.repeat(100), label: 'ok' },
    { id: 'c', label: 'C' },
  ]);
  assert.deepEqual(out!.map((e) => e.id), ['a', 'c']);
});

test('sanitize keeps only catalog layers and normalises ranks', () => {
  const res = sanitizeAssistOutput(
    {
      title: 'Green and quiet',
      explanation: 'Favoured high tree cover and low crime.',
      criteria: [
        { layer_id: 'tree_canopy', min_percentile: 60, max_percentile: 100 },
        { layer_id: 'crime_rate', min_percentile: 0, max_percentile: 30 },
        { layer_id: 'not_a_layer', min_percentile: 0, max_percentile: 50 },
      ],
      similar_to: null,
      unmatched: [],
    },
    IDS,
    'en',
  );
  assert.equal(res.criteria.length, 2, 'unknown layer dropped');
  assert.deepEqual(res.criteria[0], { layerId: 'tree_canopy', min: 60, max: 100, mode: 'percentile' });
  assert.equal(res.title, 'Green and quiet');
  assert.equal(res.similarTo, null);
});

test('sanitize clamps out-of-range ranks, repairs reversed bounds, and drops no-op full ranges', () => {
  const res = sanitizeAssistOutput(
    {
      criteria: [
        { layer_id: 'rental_price', min_percentile: 200, max_percentile: -5 }, // clamps to 100/0 -> swap -> 0/100 -> dropped as no-op
        { layer_id: 'tree_canopy', min_percentile: 80, max_percentile: 40 }, // reversed -> 40/80
        { layer_id: 'crime_rate', min_percentile: 0, max_percentile: 100 }, // no-op, dropped
      ],
    },
    IDS,
    'fi',
  );
  assert.equal(res.criteria.length, 1);
  assert.deepEqual(res.criteria[0], { layerId: 'tree_canopy', min: 40, max: 80, mode: 'percentile' });
});

test('sanitize is defensive against garbage input and falls back to a localised title', () => {
  const res = sanitizeAssistOutput({ criteria: 'not-an-array', unmatched: [1, 'near the sea', null] }, IDS, 'sv');
  assert.deepEqual(res.criteria, []);
  assert.deepEqual(res.unmatched, ['near the sea'], 'only string entries survive');
  assert.equal(res.title, 'Föreslagen sökning', 'Swedish default title');

  const empty = sanitizeAssistOutput(null, IDS, 'en');
  assert.deepEqual(empty.criteria, []);
  assert.equal(empty.title, 'Suggested search');
});

test('sanitize caps the number of criteria at 8', () => {
  const many = Array.from({ length: 20 }, () => ({ layer_id: 'tree_canopy', min_percentile: 10, max_percentile: 90 }));
  const res = sanitizeAssistOutput({ criteria: many }, IDS, 'en');
  assert.equal(res.criteria.length, 8);
});

test('buildSystemPrompt lists the catalog and states the no-statistics rule', () => {
  const prompt = buildSystemPrompt(CATALOG, 'fi');
  assert.match(prompt, /tree_canopy: Tree cover/);
  assert.match(prompt, /crime_rate: Crime/);
  assert.match(prompt, /NEVER state a statistic/i);
  assert.match(prompt, /Finnish/, 'names the output language');
});

test('isAssistConfigured tracks the API key env', () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(isAssistConfigured(), false);
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  assert.equal(isAssistConfigured(), true);
  if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = prev;
});
