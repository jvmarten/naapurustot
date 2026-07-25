import { Script } from 'node:vm';

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

/** The localStorage key the FOUC theme guard in index.html reads — the same key
 *  src/hooks/useTheme.tsx writes, and the marker that identifies the guard in a
 *  cloned page. */
const THEME_STORAGE_KEY = 'naapurustot-theme';

/**
 * Every inline `<script>` the browser EXECUTES, as it appears in the finished page.
 *
 * Only classic scripts (no `type`, or an explicit JavaScript type) are returned:
 * `application/ld+json` and the `application/json` profile payload are inert data
 * — they are validated as JSON elsewhere and must NOT be parsed as JavaScript
 * (`{"@context": …}` is not a valid statement). Inline `type="module"` scripts are
 * skipped too: the template has none, and `import`/`export` at the top level is a
 * syntax error for the classic-script parser used below.
 */
function inlineClassicScripts(html) {
  const out = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    const [, attrs, body] = m;
    // Quoted either way, or bare — a missing/empty type means a classic script.
    const type = attrs.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/);
    const mime = (type ? (type[1] ?? type[2] ?? type[3]) : '').trim();
    if (mime && !/^(text|application)\/javascript$/i.test(mime)) continue;
    if (body.trim()) out.push(body);
  }
  return out;
}

/**
 * Every inline event-handler attribute (index.html's `onload="this.media='all'"` and
 * anything added later), decoded back from escapeHtml'd text. These are executable
 * JavaScript that a browser attributes to the page URL exactly like an inline
 * `<script>`, so they are held to the same standard. Script bodies are removed before
 * scanning so an `on…="…"` substring inside JSON-LD text can't be mistaken for markup.
 */
function inlineEventHandlers(html) {
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  const out = [];
  for (const m of markup.matchAll(/\son[a-z]+\s*=\s*"([^"]*)"/gi)) {
    const code = m[1]
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
    if (code.trim()) out.push(code);
  }
  return out;
}

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
 * @param {boolean} [opts.expectThemeGuard] require index.html's inline theme guard to
 *   have survived the clone (pages built from the dist/index.html template)
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

  // Every inline script the browser runs must still parse. This file's regexes
  // rewrite the cloned template by first match and delete whole
  // `<script type="application/ld+json">` blocks; one that ever over-matched would
  // truncate the template's own inline JavaScript (the theme guard sits directly
  // below the styles the JSON-LD blocks precede) into a syntax error on ~9,000
  // pages. Browsers attribute an inline parse failure to the page URL, not to a
  // script file — the exact shape of foreign-injected noise that
  // src/utils/sentryFilters.ts now drops in production — so this has to fail here
  // instead. Compile-only: `new Script` parses without running anything.
  for (const src of inlineClassicScripts(html)) {
    try { new Script(src); }
    catch (e) { fail(`inline <script> does not parse as JavaScript: ${e.message}`); }
  }
  for (const src of inlineEventHandlers(html)) {
    // Wrapped so a handler body may legally `return`, as the DOM allows.
    try { new Script(`(function(event){${src}\n})`); }
    catch (e) { fail(`inline event handler does not parse as JavaScript: ${e.message} — ${src}`); }
  }

  if (opts.expectThemeGuard) {
    // Pages cloned from dist/index.html carry its FOUC guard, which applies the
    // stored/preferred theme before first paint. Losing it to a regex is invisible
    // in the markup but flashes a light page at every dark-mode visitor.
    const guards = inlineClassicScripts(html).filter((s) => s.includes(THEME_STORAGE_KEY));
    if (guards.length !== 1) {
      fail(`expected exactly 1 inline theme guard reading '${THEME_STORAGE_KEY}', found ${guards.length}`);
    }
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
