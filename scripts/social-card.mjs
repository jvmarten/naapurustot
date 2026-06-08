/**
 * PO-13: dynamic per-area social card (templated OG image).
 *
 * A single, dependency-free SVG-templating helper that renders one 1200×630
 * social card from real area values: the area name + postal code, its quality
 * index in a score-coloured badge, a verifiable "top X%" percentile badge, and
 * two or three key stats. Used by scripts/prerender.mjs to emit one hashed SVG
 * per profile into the build output (dist/og/), referenced as og:image and
 * twitter:image on each profile page (replacing the shared site card).
 *
 * Kept SVG (not a rasteriser) so the build stays dependency-free and fast: no
 * headless browser, no font binaries, no client-bundle weight. The same helper
 * is reused by CF-11's runtime shortlist card, so it takes plain pre-formatted
 * strings rather than reaching into GeoJSON itself.
 */

/** Quality-index colour ramp (mirrors src/utils/colorScales.ts `quality_index`). */
const QI_COLORS = ['#7c3aed', '#a855f7', '#ef4444', '#f97316', '#facc15', '#84cc16', '#22c55e', '#14b8a6'];
const QI_STOPS = [0, 14, 28, 43, 57, 71, 86, 100];

/** Pick the score-band colour for a 0–100 quality index (nearest lower stop). */
export function qualityColor(score) {
  if (score == null || !Number.isFinite(Number(score))) return '#64748b';
  const v = Number(score);
  let color = QI_COLORS[0];
  for (let i = 0; i < QI_STOPS.length; i++) {
    if (v >= QI_STOPS[i]) color = QI_COLORS[i];
  }
  return color;
}

/** Escape the five XML-significant characters for safe interpolation into SVG text. */
export function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Truncate a display string to a character budget, appending an ellipsis when
 * cut. SVG text has no wrapping, so over-long names must be clipped to stay on
 * the card. The budget is conservative for the 64px area-name line.
 */
function clamp(str, max) {
  const s = String(str);
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Render one social card as an SVG string.
 *
 * All textual fields are pre-formatted, pre-localized strings (the caller owns
 * number formatting and i18n) so this helper stays pure and reusable.
 *
 * @param {object} o
 * @param {string} o.name      Area display name (e.g. "Töölö").
 * @param {string} [o.pno]     Postal code, shown next to the name.
 * @param {string} [o.region]  Region / sub-region label, shown as a kicker.
 * @param {number|null} [o.quality] Quality index 0–100 (drives the score badge + colour).
 * @param {string} [o.qualityLabel] Localized "Quality index" caption under the score.
 * @param {string|null} [o.badge] Localized percentile badge text (e.g. "Top 5% nationally"). Omitted when null.
 * @param {Array<{label:string,value:string}>} [o.stats] 2–3 key stats (label + pre-formatted value).
 * @param {string} [o.brand]   Brand wordmark (defaults to "naapurustot.fi").
 * @returns {string} A complete `<svg>…</svg>` document.
 */
export function buildSocialCardSvg(o) {
  const W = 1200;
  const H = 630;
  const name = escapeXml(clamp(o.name ?? '', 26));
  const pno = o.pno ? escapeXml(String(o.pno)) : '';
  // Uppercase BEFORE escaping — uppercasing escaped text would corrupt entities
  // (e.g. `&amp;` → `&AMP;`). The kicker is rendered in caps for visual contrast.
  const region = o.region ? escapeXml(clamp(o.region, 40).toUpperCase()) : '';
  const brand = escapeXml(o.brand ?? 'naapurustot.fi');
  const hasQuality = o.quality != null && Number.isFinite(Number(o.quality));
  const qColor = qualityColor(o.quality);
  const qText = hasQuality ? String(Math.round(Number(o.quality))) : '—';
  const qLabel = escapeXml(o.qualityLabel ?? '');
  const badge = o.badge ? escapeXml(clamp(o.badge, 38)) : '';
  const stats = (Array.isArray(o.stats) ? o.stats : []).slice(0, 3);

  // Left column holds the headline + stats; the score badge sits top-right.
  const headingY = badge ? 250 : 270;
  const statsTop = 360;
  const statRows = stats
    .map((s, i) => {
      const y = statsTop + i * 76;
      return (
        `    <text x="80" y="${y}" font-family="system-ui, sans-serif" font-size="26" fill="#94a3b8">${escapeXml(s.label)}</text>\n` +
        `    <text x="80" y="${y + 34}" font-family="system-ui, sans-serif" font-weight="700" font-size="40" fill="#f8fafc">${escapeXml(s.value)}</text>`
      );
    })
    .join('\n');

  // Percentile badge — a rounded pill under the headline. Width scales with the
  // text length so short and long superlatives both sit snugly.
  const badgePill = badge
    ? `    <rect x="80" y="282" width="${Math.min(40 + badge.length * 15, 760)}" height="50" rx="25" fill="${qColor}" opacity="0.18"/>\n` +
      `    <rect x="80" y="282" width="${Math.min(40 + badge.length * 15, 760)}" height="50" rx="25" fill="none" stroke="${qColor}" stroke-width="2"/>\n` +
      `    <text x="105" y="314" font-family="system-ui, sans-serif" font-weight="600" font-size="24" fill="${qColor}">${badge}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0f2440"/>
      <stop offset="1" stop-color="#1e3a5f"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect x="24" y="24" width="${W - 48}" height="${H - 48}" rx="24" fill="#0f2440" stroke="#2d5a8e" stroke-width="2"/>
  <g opacity="0.12" stroke="#4a90d9" stroke-width="1">
    <line x1="80" y1="120" x2="80" y2="540"/>
    <line x1="230" y1="120" x2="230" y2="540"/>
    <line x1="380" y1="120" x2="380" y2="540"/>
    <line x1="80" y1="270" x2="380" y2="270"/>
    <line x1="80" y1="420" x2="380" y2="420"/>
  </g>
${region ? `  <text x="80" y="110" font-family="system-ui, sans-serif" font-weight="600" font-size="26" fill="#60a5fa" letter-spacing="2">${region}</text>` : ''}
  <text x="80" y="${headingY - 90}" font-family="system-ui, sans-serif" font-weight="800" font-size="64" fill="#ffffff">${name}</text>
${pno ? `  <text x="80" y="${headingY - 42}" font-family="system-ui, sans-serif" font-weight="500" font-size="30" fill="#94a3b8">${pno}</text>` : ''}
${badgePill}
${statRows}
  <g>
    <circle cx="980" cy="230" r="135" fill="${qColor}" opacity="0.16"/>
    <circle cx="980" cy="230" r="135" fill="none" stroke="${qColor}" stroke-width="6"/>
    <text x="980" y="252" font-family="system-ui, sans-serif" font-weight="800" font-size="100" fill="#ffffff" text-anchor="middle">${qText}</text>
    <text x="980" y="410" font-family="system-ui, sans-serif" font-weight="600" font-size="26" fill="#94a3b8" text-anchor="middle">${qLabel}</text>
  </g>
  <text x="80" y="565" font-family="system-ui, sans-serif" font-weight="700" font-size="30" fill="#ffffff">${brand}</text>
</svg>
`;
}
