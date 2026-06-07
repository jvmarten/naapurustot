/// <reference types="vite/client" />

// Injected by Vite `define` (see vite.config.ts) — the data-freshness timestamp
// from src/data/build_metadata.json, inlined as a string literal at build time so
// the full metadata table stays out of the budgeted index chunk.
declare const __BUILD_DATE__: string;
