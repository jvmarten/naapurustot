import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// The API reads process.env directly (no dotenv), so a variable reaches the container
// only if docker-compose.yml names it under the api service's `environment:`. Setting
// it in server/.env alone does nothing. The Lightning tier and the AI assistant were
// both read here and never forwarded, so in production they stayed off whatever
// server/.env said, with nothing anywhere reporting why.

const SRC = __dirname;
const COMPOSE = path.join(__dirname, '..', '..', 'docker-compose.yml');

// Direct reads, plus lightning.ts's envInt('NAME') helper. A new indirect reader
// needs its pattern added here, or the variables it reads go unchecked.
const READ_PATTERNS = [
  /process\.env\.([A-Z][A-Z0-9_]*)/g,
  /process\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g,
  /envInt\(\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\)/g,
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

function variablesReadByTheApi(): Set<string> {
  const names = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of READ_PATTERNS) {
      for (const match of text.matchAll(pattern)) names.add(match[1]);
    }
  }
  return names;
}

function variablesForwardedByCompose(): Set<string> {
  const compose = readFileSync(COMPOSE, 'utf8');
  const start = compose.search(/^ {2}api:\s*$/m);
  assert.ok(start >= 0, 'docker-compose.yml has an api service');
  const rest = compose.slice(start + 1);
  const next = rest.search(/^ {2}[a-z][\w-]*:\s*$/m);
  const apiBlock = next >= 0 ? rest.slice(0, next) : rest;
  return new Set([...apiBlock.matchAll(/^ {6}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]));
}

test('every environment variable the API reads is forwarded by docker-compose.yml', () => {
  const read = variablesReadByTheApi();
  const forwarded = variablesForwardedByCompose();
  assert.ok(read.size > 10, `found only ${read.size} variables; the scan is broken`);
  const missing = [...read].filter((name) => !forwarded.has(name)).sort();
  assert.deepEqual(
    missing,
    [],
    `read by server/api/src but not passed to the api container: ${missing.join(', ')}`,
  );
});
