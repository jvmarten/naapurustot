/**
 * IN-6: shared, importable + unit-testable prerender helpers.
 *
 * The ~9,000-page prerender is the entire SEO distribution and its most fragile
 * build step: CLAUDE.md documents that the first-match head-token regexes in
 * prerender.mjs silently corrupt EVERY page if a `<title>`/`<noscript>`/`</head>`
 * token ever appears twice in the head. `assertHeadIntegrity` turns that silent
 * corruption into a loud build-time failure — prerender.mjs calls it on every page
 * before writing, and prerenderOutput.test.ts pins the invariants on fixtures.
 *
 * Importing this module has no side effects (unlike prerender.mjs, whose top-level
 * code reads the 39 MB GeoJSON and writes files), so it is safe to load under Vitest.
 */

/** HTML-escape text for safe interpolation into attributes / text nodes. */
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const count = (html, re) => (html.match(re) || []).length;

/**
 * Strip the home-route-only critical-chunk preloads that vite.config.ts's
 * `injectHomePreloads` plugin adds to dist/index.html — the App + maplibre
 * modulepreloads and the maplibre CSS preload, each tagged `data-home-preload`.
 *
 * prerender.mjs clones dist/index.html for the ~9,000 profile pages plus the
 * data-sources / privacy pages. None of those routes load the App shell or the full
 * map (profiles render a lazy MiniMap that re-injects maplibre on demand), so
 * preloading the ~263 KB maplibre chunk and its CSS on them is pure waste — and the
 * CSS preload would warm a resource those pages may never use. Matching on the
 * `data-home-preload` marker keeps this decoupled from chunk hashes and from how many
 * such tags exist; a 0-match no-op is safe, so it stays correct if the injected set
 * changes (or the plugin is ever removed).
 */
export function stripHomeOnlyPreloads(html) {
  return html.replace(/[ \t]*<link\b[^>]*\bdata-home-preload\b[^>]*>\r?\n?/g, '');
}

/**
 * Validate the integrity of a fully-assembled page's <head>. Throws an Error
 * (prefixed with `context`) on any violation, so a malformed clone fails the build
 * instead of shipping ~9,000 corrupted pages.
 *
 * @param {string} html  the complete page HTML
 * @param {object} [opts]
 * @param {string} [opts.context]   label for the error (e.g. the slug)
 * @param {boolean} [opts.expectFaq] require exactly one FAQPage block (profiles)
 * @param {boolean} [opts.expectProfilePayload] require a parseable __naapurustot_profile__
 */
export function assertHeadIntegrity(html, opts = {}) {
  const ctx = opts.context ? `[${opts.context}] ` : '';
  const fail = (msg) => { throw new Error(`${ctx}prerender head-integrity: ${msg}`); };

  const titles = count(html, /<title>[\s\S]*?<\/title>/g);
  if (titles !== 1) fail(`expected exactly 1 <title>, found ${titles}`);

  const heads = count(html, /<\/head>/g);
  if (heads !== 1) fail(`expected exactly 1 </head>, found ${heads}`);

  const canonical = count(html, /<link\s+rel="canonical"/g);
  if (canonical !== 1) fail(`expected exactly 1 canonical link, found ${canonical}`);

  const ogUrl = count(html, /<meta\s+property="og:url"/g);
  if (ogUrl > 1) fail(`expected at most 1 og:url, found ${ogUrl}`);

  // A self-referential hreflang must not be the only one (the cluster needs the
  // other languages); just assert at least one hreflang link exists when any do.
  const hreflang = count(html, /hreflang="/g);
  if (hreflang === 1) fail('found a single hreflang link (cluster is incomplete)');

  // Every JSON-LD block must parse — a broken block poisons structured data.
  const ldBlocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const [, json] of ldBlocks) {
    try { JSON.parse(json); } catch (e) { fail(`unparseable JSON-LD block: ${e.message}`); }
  }

  if (opts.expectFaq) {
    const faq = ldBlocks.filter(([, j]) => /"@type"\s*:\s*"FAQPage"/.test(j)).length;
    if (faq !== 1) fail(`expected exactly 1 FAQPage JSON-LD, found ${faq}`);
  }

  if (opts.expectProfilePayload) {
    // Embedded as the text content of <script id="__naapurustot_profile__"
    // type="application/json">{…}</script> (any literal `<` already escaped to
    // <, a valid JSON escape, so JSON.parse handles the raw text directly).
    const m = html.match(/<script id="__naapurustot_profile__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) fail('missing embedded __naapurustot_profile__ payload');
    let payload;
    try { payload = JSON.parse(m[1]); }
    catch (e) { fail(`unparseable __naapurustot_profile__: ${e.message}`); }
    if (!payload || typeof payload.p !== 'object' || payload.p === null) {
      fail('__naapurustot_profile__ payload missing its `p` (area properties) object');
    }
  }

  return true;
}

/**
 * Replace exactly one occurrence of `re` in `html`, throwing if it matches zero or
 * more than one time — so a head-token that unexpectedly appears 0 or 2+ times
 * fails loudly instead of silently no-op-ing or double-injecting.
 */
export function replaceOnce(html, re, replacement, context = '') {
  const n = count(html, new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'));
  if (n !== 1) {
    throw new Error(`${context ? `[${context}] ` : ''}replaceOnce: expected 1 match for ${re}, found ${n}`);
  }
  return html.replace(re, replacement);
}
