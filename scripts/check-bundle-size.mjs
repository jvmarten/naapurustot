#!/usr/bin/env node
/**
 * Single source of truth for the gzipped app-JS bundle budget (IN-1).
 *
 * Called by BOTH `.github/workflows/ci.yml` and `.github/workflows/auto-merge.yml`
 * so the budget constant and the measurement logic live in exactly one place —
 * before this, the two workflows carried independent copies of the 280,000-byte
 * check that could silently drift apart.
 *
 * It sums the gzipped size of every app JS chunk in dist/assets EXCEPT maplibre-*
 * (the irreducible third-party map renderer, the only excluded chunk). Lazy
 * chunks are included — lazy-loading does NOT exempt code from the budget.
 *
 * Side effects:
 *   - Writes `bundle-size.json` ({ js, css, total }) for baseline caching and
 *     cross-job forwarding (auto-merge saves it as the new main baseline).
 *   - If GITHUB_STEP_SUMMARY is set, appends a per-chunk table plus, when a
 *     `base-bundle-size.json` (restored from the main cache) is present, the
 *     exact gzip delta of this branch vs main.
 *   - Exits non-zero (with a ::error:: annotation) when the budget is exceeded.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

// Budget history: 160KB → 210KB (react-router-dom + @turf/union + auth/profile)
// → 235KB (first FEATURE_ROADMAP batch) → 256000 B (second) → 280000 B (third
// batch: 36-item roadmap completion + UX-review batch) → 282000 B (2026-06-11:
// the 2026-06-10 roadmap added three new map layers — radon, morbidity, flood —
// plus the transit-reachability grid and next-steps links, exhausting the 280 KB
// budget; raised to land the last roadmap items, mirroring 256→280) → 287000 B
// (2026-06-11: implemented all 44 remaining docs/UX_REVIEW.md findings — focus
// traps, ARIA names, a non-blocking region-switch progress bar, address-search
// region resolution, a signed-out favorites surface, a unified toast stack,
// language auto-detection, a touch peek bar, reduced-motion sheets, and more —
// adding ~4.4 KB of genuine UI logic + the bundled fi.json strings; data stays
// out of JS, so the heavy assets are unaffected) → 291000 B (2026-06-15: roadmap
// Batch 2 centerpiece — the kaavat & hankkeet map overlay (CF-2: usePlanningData
// + Map overlay/popup + PlanningControls + URL flag), the in-panel planning list
// (CF-3), and the expanded similarity picker (QW-3), ~3.2 KB of UI + bundled
// fi.json labels. Batch 1 first freed ~2 KB via the fi-extra split + orphan
// prune; this raise covers the remaining overflow. All planning DATA stays a
// lazy static shard — zero bundle bytes.
// → 295000 B (2026-06-16: implemented the 2026-06-13 docs/UX_REVIEW.md — 55 of 56
// findings, all but the lone Manual-Setup payment item DX-3. Adds ~3.4 KB of genuine
// UI logic + bundled fi.json strings: the all-Finland favorites/shortlist/filter/wizard
// scope fixes (ES-1, DT-1/DT-2, LP-1), search Enter/recents/address-error handling
// (SN-1/SN-3/ER-1/LP-4), shared-device logout reset (AC-2), responsive split view +
// touch readout (MO-1), an auth show-password toggle, a shortcuts on/off toggle, an
// embed attribution line, ARIA/role corrections, and ~25 trilingual copy/key edits.
// A few stale findings (AY-6 skip link, ON-4 dead key) were already shipped.
//
// Measurement basis: this sums Node `zlib.gzipSync` lengths — the honest gzip
// payload, with no embedded filename/mtime header. The previous inline shell
// gate used `find … -exec gzip -c`, whose per-file FNAME+MTIME headers inflated
// the total by ~2 KB across the ~108 chunks. So the number printed here reads
// ~2 KB BELOW the old gate at the same real bundle; the 280000 B budget is
// unchanged, which means ~2 KB more genuine headroom than the old method showed.
// → 297000 B (2026-06-25: top-3 impact batch. (1) National filtering on the default
// ?city=all view — App opt-in national load on first filter + FilterPanel ranks the
// full 3,018-area set with national-aware banner copy; (3) accent-insensitive +
// municipality-aware search — a shared fold() factored out of slug.ts applied to a
// pre-folded index plus a `muni` predicate. ~0.3 KB of genuine UI/predicate logic over
// the prior ~0.3 KB headroom. The SEO half of the batch (municipality hub pages,
// keyword-rich profile titles) is all build-time HTML — zero bundle bytes.
// → 300000 B (2026-06-26: "Fit for you" persistent match score + bare ?pno= deep-link
// region routing. The score reuses the wizard's per-area scorer, extracted into a
// shared, pure utils/fitScore.ts (region ranges for the wizard, stable national ranges
// for the badge), surfaced as a small FitForYouBadge on the panel header, the profile
// page hero, and a comparison row. ~2.5 KB of genuine UI/scoring logic + 4 bundled
// fi.json `fit.*` strings. The deep-link routing is pure App.tsx control flow (no
// payload) and is itself a perf win — bare ?pno= now loads a ~355 KB region file
// instead of the 10.6 MB national set.
// → 301500 B (2026-06-27: profile→app conversion + layer-honesty batch. (1) Profile-page
// mobile sticky CTA bar (Explore-on-map + Fit finder deep-links) + one-tap local Save
// (reuses useFavorites; merges to the cloud on next sign-in); (2) pre-click coverage /
// proxy / staleness signals on every LayerSelector row (reuses getCoveragePct / isProxy /
// vintageFreshness — 4 bundled fi.json `layer_signal.*` strings). ~1.5 KB of genuine UI
// over the prior ~2.4 KB headroom. The third feature — a cross-region "similar areas
// elsewhere" link mesh + isSimilarTo JSON-LD on the 9k profile pages — is computed in
// prerender.mjs at build time, so it adds ZERO bundle bytes.
// → 303000 B (2026-06-29: funnel-impact batch. Item 2 "Finder front door" is the
// designated bumper: a standing header CTA opening the wizard, one-tap intent presets
// in the wizard's first step, an onboarding terminus that drops the user into the finder
// (new OnboardingTour finder step + onLaunchFinder), and ~10 bundled fi.json strings.
// Also +~0.1 KB from the requestIdleCallback search-index defer (cold-load HM). The SEO
// prerender mesh (muni rankings + X-vs-Y) and the topojson shrink / mobile-attribution
// fixes are all build-time / data / CSS → ZERO bundle bytes.)
// → 313000 B (2026-07-07: code-split the App shell off the entry chunk (src/main.tsx
// makes App a lazy import; a vite.config injectHomePreloads plugin re-adds the home-route
// App + maplibre preloads, which prerender.mjs strips from the ~9,000 cloned profile /
// sources / privacy pages). This drops the entry from ~85 KB to ~20 KB gzipped and removes
// maplibre's modulepreload + render-blocking CSS from every profile page — a large win on
// the primary organic-landing surface. It is NOT new code: the App shell + its ~15 formerly
// entry-inlined dependencies simply relocate into an App chunk plus shared chunks. That
// finer-grained splitting costs ~7.2 KB of gzip fragmentation overhead (many small chunks
// compress worse than one large one; Rolldown exposes no minChunkSize knob to reclaim it),
// which the summed-all-chunks budget counts. The trade — +7 KB to the total (borne mostly
// by map-route users, who load it lazily anyway) for -65 KB on the profile critical path —
// is strongly net-positive for the SEO surface. Headroom set to ~2.7 KB.
// CF-3 (this batch's designated bumper): +1 KB for the multi-series comparison
// radar + mobile chart parity + winner synthesis, plus the batch's UX-review
// fixes (search municipality labels, filterable region list, sync/session
// recovery, tour keyboard handling). Headroom restored to ~1.2 KB.
// Payload batch (2026-07-27, this batch's designated bumper): +2 KB for the
// columnar decoder (src/utils/columnar.ts, used by both the all-Finland
// properties fetch and every region TopoJSON) and the DPR-aware basemap URL
// helper. Both BUY payload far larger than they cost: region_properties.json
// drops 1,095,405 B gzipped (-52.4 %), the 69 region TopoJSONs drop 935,444 B
// gzipped (-23.2 %, and -33 % on helsinki_metro), and a DPR-1 screen fetches
// 776,271 B fewer basemap tiles on the landing view. Those are ?url assets and
// tiles, so none of it shows up here — this gate only ever sees the cost side
// of a payload optimisation, which is worth remembering before refusing a bump.
// Password reset (2026-08-04): +4 KB for a feature that did not exist at all —
// the /uusi-salasana page chunk, the forgot-password branch of AuthModal, the
// recovery-email editor in UserMenu, and their fi.json strings. The page chunk is
// lazy but still counted (this gate deliberately includes lazy chunks), and it
// cannot be avoided: the link needs a real route rather than a query param on `/`,
// and the page is prerendered so it answers 200 + noindex instead of the SPA
// fallback's 404 + `index, follow` (see scripts/prerender.mjs).
// Services honesty (2026-08-05): +1 KB. The polarity merge landed at 324,801 —
// 199 B of headroom, which is below the noise floor for an unrelated change and
// would have made the next branch fail the gate for no reason of its own. This
// batch itself costs ~100 B (a two-significant-figure number format for service
// densities, which now span 0.0001-237/km² instead of being rounded to one
// decimal); the rest restores headroom to ~1.2 KB.
// Supporter tier (2026-08-19): +4 KB for a feature that did not exist at all — the
// Stripe supporter subscription. SupporterModal (the pitch / manage / activating
// states + Checkout+portal redirect), the supporter row and badge in UserMenu, the
// two api.ts billing calls, useAuth.refresh, App's return-from-Checkout handling, and
// their 22 fi.json strings in the always-loaded i18n chunk. The modal is lazy but,
// like the password-reset page chunk above, still counted — and cannot be exempted:
// it is reached from the map app's header, not from /live/. It pushed the measured
// total past the old 321,000 budget (a few hundred bytes of headroom) to 323,482 — so
// ~2.5-3 KB of genuine feature; headroom set to ~1.5 KB (above the noise floor, per the
// Services-honesty note) rather than to a hair.
const BUDGET = 325_000;
const ASSETS_DIR = 'dist/assets';

// Second budget: the /live/ realtime sub-app.
//
// Matched by the `LivePage-` chunk prefix, which is Rolldown's NATURAL name for
// the route's lazy chunk — deliberately not a manualChunks group. Grouping
// src/live/* explicitly was tried first and backfired twice: the named group
// swallowed the `maplibre` chunk (LivePage statically imported it, so the whole
// ~1 MB renderer moved inside and the map route began importing /live/ to get
// it), and it then acted as a magnet for shared modules, understating the map
// budget by ~21 KB. Left alone, Rolldown folds every module that ONLY the live
// route reaches — sun, shadows, feeds, the sidebar — into this one chunk, which
// is exactly the set this budget should cover.
//
// If a future live-only module gets split into its own chunk it will be named
// after itself and counted against the map budget instead. That is the safe
// direction: it over-reports the map surface and fails loudly, rather than
// quietly exempting code from every budget.
//
// Why a separate number rather than one raised total. The budget above exists to
// protect the MAP's critical path, and its governing rule — "lazy chunks are
// included; lazy-loading does not exempt code" — was written when every chunk was
// map-adjacent, so any new chunk really did threaten the map's load. /live/ breaks
// that assumption: it is a different route with its own entry, and the map never
// imports it, so a kilobyte there costs a map visitor nothing.
//
// The two honest alternatives were to keep bumping a total that no longer means
// "what the map loads", or to emit the live chunks somewhere this gate does not
// look (`readdirSync` is non-recursive, so `dist/live/assets/` would sail past
// unmeasured) — which is not a budget, it is an evasion. Measuring both surfaces
// separately keeps every byte counted while letting each number mean something.
//
// The split is enforced by reachability, not by naming: Rolldown only folds a
// module in here when the live route is its ONLY importer. Anything /live/ shares
// with the map — i18n, utils, react, maplibre — stays in the shared chunks and
// keeps counting against BUDGET, so this cannot be used to smuggle map code out
// of the main allowance.
//
// Measured at 5,661 B on introduction (sun engine, shadow geometry, feed registry,
// sidebar, page). Set with room for the feeds the registry already lists.
// → 28,000 B (2026-08-12: the page's clock became the PAGE'S rather than the
// sun's. Adds the shademap-style bottom bar (a twilight ribbon sampled from the
// real solar altitude, a draggable role=slider playhead, date stepping,
// playback), time travel for every feed that can honestly follow it (FMI's
// archive behind an `endtime`, a session-recorded train buffer, validity-window
// filtering for road announcements), and a click-through detail panel with the
// per-train timetable and measured track. Measured 16,428 → 22,976 B, ~6.5 kB
// of genuine feature. The remaining 1 kB of headroom is below the noise floor
// for an unrelated change — the same reason the map budget was moved off 199 B
// — and the registry still lists two unwired feeds this budget exists to hold,
// so headroom is restored to ~5 kB rather than to a hair. Every byte here is
// reached only by /live/; the map route never imports it.
// → 34,000 B (2026-08-17: located lightning, the page's fifth measured feed and
// the first whose data is EVENTS rather than the state of a station — FMI's
// national detection network read from the coverage encoding, held as a day and
// drawn as a trailing half-hour window, with a clickable per-flash panel. Plus a
// batch of /live/ corrections: `sunTimes` asked for the day rather than for the
// instant, day-failure split from poll-failure across all three measured feeds,
// announcements culled on their whole extent rather than on their first vertex,
// the recorded-train span reported as contiguous runs, the ARIA slider's missing
// vertical arrows, a focus ring on the date control, and the mobile layout —
// `h-dvh` and a sidebar that overlays rather than eating two thirds of a phone.
//
// Measured 26,975 → 29,103 B, ~2.1 kB, of which the whole lightning feed is
// ~1.7 kB. Headroom is set to ~4.9 kB for exactly the reason the previous bump
// gives: the registry still lists two unwired feeds this budget exists to hold,
// and a hair's headroom fails the next branch for no reason of its own.
// → 40,000 B (2026-08-19: live vessel positions, the page's sixth measured feed
// and its first at sea — Fintraffic's national AIS network read as ~1,000 hulls,
// drawn as bow triangles pointed along each vessel's own course over ground,
// with a recorded-history buffer for the time slider and a clickable per-vessel
// panel joined to the ship register (name, type, destination, draught). The
// snapshot ring that trains and ships now share was lifted into positionBuffer.ts.
//
// Measured 33,306 → 34,904 B, ~1.6 kB, the whole of it the ships feed. Headroom
// restored to ~5.1 kB on the same principle as every bump above: the registry
// still lists two unwired feeds this budget exists to hold, and a hair's headroom
// fails the next branch for no reason of its own.
const LIVE_BUDGET = 40_000;

const fmtKB = (b) => (b / 1024).toFixed(2);

const allFiles = readdirSync(ASSETS_DIR);
const isLive = (f) => f.startsWith('LivePage-');
const jsFiles = allFiles.filter((f) => f.endsWith('.js') && !f.startsWith('maplibre-'));

let jsTotal = 0;
let liveTotal = 0;
const rows = [];
const liveRows = [];
for (const f of jsFiles) {
  const gz = gzipSync(readFileSync(join(ASSETS_DIR, f))).length;
  if (isLive(f)) {
    liveTotal += gz;
    liveRows.push({ name: f, gz });
  } else {
    jsTotal += gz;
    rows.push({ name: f, gz });
  }
}
rows.sort((a, b) => b.gz - a.gz);
liveRows.sort((a, b) => b.gz - a.gz);

let cssTotal = 0;
for (const f of allFiles.filter((f) => f.endsWith('.css'))) {
  cssTotal += gzipSync(readFileSync(join(ASSETS_DIR, f))).length;
}

const headroom = BUDGET - jsTotal;
const liveHeadroom = LIVE_BUDGET - liveTotal;
console.log(
  `Map-route JS excluding maplibre and live (gzipped): ${jsTotal} bytes ` +
    `(budget ${BUDGET}, headroom ${headroom})`,
);
console.log(
  `/live/ sub-app JS (gzipped): ${liveTotal} bytes ` +
    `(budget ${LIVE_BUDGET}, headroom ${liveHeadroom})`,
);

writeFileSync(
  'bundle-size.json',
  JSON.stringify({ js: jsTotal, live: liveTotal, css: cssTotal, total: jsTotal + liveTotal + cssTotal }) + '\n',
);

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
  let base = null;
  if (existsSync('base-bundle-size.json')) {
    try {
      base = JSON.parse(readFileSync('base-bundle-size.json', 'utf8'));
    } catch {
      /* malformed cache — fall through to no-baseline path */
    }
  }
  const lines = ['### 📦 Bundle Size Report', ''];
  if (base && typeof base.js === 'number') {
    const diff = jsTotal - base.js;
    const sign = diff > 0 ? '+' : '';
    const pct = base.js > 0 ? ` (${sign}${((diff / base.js) * 100).toFixed(1)}%)` : '';
    lines.push('| App JS (excl. maplibre) | This branch | main | Delta |');
    lines.push('|---|---|---|---|');
    lines.push(
      `| Gzipped | ${fmtKB(jsTotal)} KB | ${fmtKB(base.js)} KB | ${sign}${fmtKB(diff)} KB${pct} |`,
    );
  } else {
    lines.push(`**App JS (excl. maplibre), gzipped:** ${fmtKB(jsTotal)} KB`);
    lines.push('');
    lines.push('> _No baseline from main yet — delta will appear once a main build is cached._');
  }
  lines.push('');
  lines.push(`**Map-route budget:** ${fmtKB(BUDGET)} KB · **Headroom:** ${fmtKB(headroom)} KB`);
  lines.push('');
  lines.push(
    `**/live/ budget:** ${fmtKB(LIVE_BUDGET)} KB · ` +
      `**Used:** ${fmtKB(liveTotal)} KB · **Headroom:** ${fmtKB(liveHeadroom)} KB`,
  );
  lines.push('');
  lines.push('<details><summary>Per-chunk breakdown</summary>', '');
  lines.push('| Chunk | Gzipped |', '|---|---|');
  for (const r of rows) lines.push(`| ${r.name} | ${fmtKB(r.gz)} KB |`);
  for (const r of liveRows) lines.push(`| ${r.name} _(live)_ | ${fmtKB(r.gz)} KB |`);
  lines.push('', '</details>');
  writeFileSync(summaryPath, lines.join('\n') + '\n', { flag: 'a' });
}

let failed = false;
// A BUDGET THAT MEASURED NOTHING IS NOT A BUDGET THAT PASSED. `isLive` matches
// on a chunk NAME, and the name is Rolldown's, so a rename of LivePage.tsx, a
// change to the lazy-import shape in main.tsx, or a Rolldown naming change all
// produce zero matches — and this script would then report "0 bytes, headroom
// 34000" and exit 0, having checked nothing at all, in the direction that never
// gets noticed. The map budget cannot fail this way (an empty assets dir is not
// a state the build reaches), which is exactly why only this one needs saying.
if (liveRows.length === 0) {
  console.error(
    '::error::no LivePage-* chunk found — the /live/ budget measured nothing. ' +
      'Check the chunk name against `isLive` in this script.',
  );
  failed = true;
}
if (jsTotal > BUDGET) {
  console.error(
    `::error::Map-route JS exceeds ${fmtKB(BUDGET)} KB gzipped budget (${jsTotal} bytes)`,
  );
  failed = true;
}
// Reported independently of the map budget so a breach names the surface that
// actually overspent — a single combined failure would send someone hunting
// through map chunks for bytes that are all in /live/.
if (liveTotal > LIVE_BUDGET) {
  console.error(
    `::error::/live/ sub-app JS exceeds ${fmtKB(LIVE_BUDGET)} KB gzipped budget (${liveTotal} bytes)`,
  );
  failed = true;
}
if (failed) process.exit(1);
