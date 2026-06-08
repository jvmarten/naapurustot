/// <reference types="vite/client" />

// Injected by Vite `define` (see vite.config.ts) — the data-freshness timestamp
// from src/data/build_metadata.json, inlined as a string literal at build time so
// the full metadata table stays out of the budgeted index chunk.
declare const __BUILD_DATE__: string;

// PO-2: Injected by Vite `define` (see vite.config.ts) — a compact
// { property: coverage_pct } map distilled from src/data/build_metadata.json, so the
// per-layer coverage UI (sources page, legend caption, low-coverage banner) reads real
// coverage without bundling the full per-metric metadata table.
declare const __COVERAGE_PCT__: Record<string, number>;
