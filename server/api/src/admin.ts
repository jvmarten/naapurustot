/**
 * Private operator dashboard — a read-only view of every registered account and
 * its supporter (PRO) tier, gated to an env-configured allowlist of admin usernames.
 *
 * Design:
 *
 *  - **Access is env-gated, never client-asserted.** `ADMIN_USERNAMES` is a
 *    comma-separated allowlist read from the server environment (like `JWT_SECRET`
 *    and the Stripe keys). A request must carry a valid session (resolveUser has set
 *    `req.userId`) AND resolve to a username on that list. There is no HTTP path to
 *    grant admin — the same "a client cannot mint its own privilege" invariant the
 *    comp-grant CLI holds.
 *
 *  - **Off by default.** With `ADMIN_USERNAMES` unset, every request — signed in or
 *    not — is refused, so shipping this never exposes account data until the operator
 *    opts in by setting the env var.
 *
 *  - **The tier is server-derived** with the very same `deriveSupporter()` the rest
 *    of the API uses, so "PRO" here means exactly what the badge means everywhere
 *    else: a live Stripe subscription (active/trialing/past_due-in-grace) OR a manual
 *    comp grant. The source is attributed so the operator can tell the two apart.
 *
 *  - **The HTML page is self-contained and XSS-safe.** No external assets (a strict
 *    per-response CSP with a nonce forbids them). The data is embedded as JSON with
 *    `<` escaped so it can never break out of the `<script>`, and the inline renderer
 *    writes every cell via `textContent` — display names are free-form user input and
 *    must never reach `innerHTML`.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { randomBytes } from 'node:crypto';
import { getPool } from './db.js';
import { deriveSupporter } from './billing.js';

interface AuthedRequest extends Request { userId?: string | null }

// ── Access control ──

/**
 * Parse the `ADMIN_USERNAMES` allowlist into a lowercased Set. Comma-separated,
 * whitespace-trimmed, empties dropped. Pure + exported for tests. Usernames are
 * stored lowercased (auth.ts), so matching is lowercased on both sides.
 */
export function parseAdminUsernames(raw: string | undefined): Set<string> {
  const set = new Set<string>();
  if (!raw) return set;
  for (const part of raw.split(',')) {
    const name = part.trim().toLowerCase();
    if (name) set.add(name);
  }
  return set;
}

/**
 * True when `username` is on the `ADMIN_USERNAMES` allowlist. Reads the env on each
 * call (the env is fixed for a process and the parse is trivial) so tests can vary it
 * per-case. An empty/unset allowlist admits nobody.
 */
export function isAdminUsername(
  username: string | null | undefined,
  raw: string | undefined = process.env.ADMIN_USERNAMES,
): boolean {
  if (!username) return false;
  return parseAdminUsernames(raw).has(username.toLowerCase());
}

/** Prefer an HTML error only for a browser navigation (Accept prefers text/html). */
function wantsHtml(req: Request): boolean {
  return req.accepts(['json', 'html']) === 'html';
}

function deny(req: Request, res: Response, status: number, message: string): void {
  if (wantsHtml(req)) {
    res.status(status).type('html').send(renderErrorPage(status, message));
  } else {
    res.status(status).json({ error: message });
  }
}

/**
 * Router gate: require a signed-in session whose username is on `ADMIN_USERNAMES`.
 * Runs behind `resolveUser` (mounted in auth.ts), which sets `req.userId`.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req as AuthedRequest).userId;
  if (!userId) {
    deny(req, res, 401, 'Sign in at naapurustot.fi first, then reload this page.');
    return;
  }
  const { rows } = await getPool().query('SELECT username FROM users WHERE id = $1', [userId]);
  const username = rows[0]?.username as string | undefined;
  if (!isAdminUsername(username)) {
    deny(req, res, 403, 'This account is not an administrator.');
    return;
  }
  next();
}

// ── Data ──

/** One joined users ⋈ user_billing row, as read by LIST_SQL. */
export interface AdminUserRow {
  id: unknown;
  username: unknown;
  email: unknown;
  display_name: unknown;
  trust_level: unknown;
  created_at: unknown;
  comp_supporter: unknown;
  billing_status: unknown;
  billing_period_end: unknown;
}

/** The dashboard's per-user shape (what the JSON endpoint and the page render). */
export interface AdminUserSummary {
  id: string;
  username: string;
  email: string | null;
  displayName: string | null;
  trustLevel: number | null;
  createdAt: string | null;
  /** Combined entitlement — 'pro' when comp OR a live Stripe subscription. */
  tier: 'pro' | 'free';
  /** Manual PRO grant on the users row (comp_supporter). */
  comp: boolean;
  /** Currently entitled via a Stripe subscription (independent of comp). */
  stripe: boolean;
  proSource: 'comp' | 'stripe' | 'comp+stripe' | null;
  /** Raw Stripe status, if the user has a billing row (active/past_due/canceled/…). */
  billingStatus: string | null;
  /** Renewal date — Stripe subscriptions only; a comp grant has none. */
  supporterUntil: string | null;
}

function toIso(v: unknown): string | null {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Reduce one joined row to the dashboard's per-user shape. Pure (takes `now`) so the
 * tier derivation is unit-testable. `deriveSupporter` is called twice: once with
 * `comp=false` to isolate the Stripe-only entitlement (so the source is attributable),
 * once with the real comp flag for the combined answer that drives the badge.
 */
export function summariseUser(row: AdminUserRow, now: number = Date.now()): AdminUserSummary {
  const comp = row.comp_supporter === true;
  const stripe = deriveSupporter(row.billing_status, row.billing_period_end, now, false).supporter;
  const combined = deriveSupporter(row.billing_status, row.billing_period_end, now, comp);
  let proSource: AdminUserSummary['proSource'] = null;
  if (comp && stripe) proSource = 'comp+stripe';
  else if (comp) proSource = 'comp';
  else if (stripe) proSource = 'stripe';
  return {
    id: String(row.id),
    username: String(row.username),
    email: (row.email as string) || null,
    displayName: (row.display_name as string) || null,
    trustLevel: row.trust_level == null ? null : Number(row.trust_level),
    createdAt: toIso(row.created_at),
    tier: combined.supporter ? 'pro' : 'free',
    comp,
    stripe,
    proSource,
    billingStatus: (row.billing_status as string) || null,
    supporterUntil: combined.supporterUntil,
  };
}

const LIST_SQL = `
  SELECT u.id, u.username, u.email, u.display_name, u.trust_level, u.created_at, u.comp_supporter,
         b.status AS billing_status, b.current_period_end AS billing_period_end
    FROM users u LEFT JOIN user_billing b ON b.user_id = u.id
   ORDER BY u.created_at DESC`;

export interface AdminUsersPayload {
  generatedAt: string;
  counts: { total: number; pro: number; free: number; comp: number; stripe: number; withEmail: number };
  users: AdminUserSummary[];
}

/** Read every account joined with its billing state and summarise for the dashboard. */
export async function buildAdminUsersPayload(now: number = Date.now()): Promise<AdminUsersPayload> {
  const { rows } = await getPool().query(LIST_SQL);
  const users = rows.map((r) => summariseUser(r as AdminUserRow, now));
  const counts = {
    total: users.length,
    pro: users.filter((u) => u.tier === 'pro').length,
    free: users.filter((u) => u.tier === 'free').length,
    comp: users.filter((u) => u.comp).length,
    stripe: users.filter((u) => u.stripe).length,
    withEmail: users.filter((u) => u.email !== null).length,
  };
  return { generatedAt: new Date(now).toISOString(), counts, users };
}

// ── HTML rendering (self-contained, XSS-safe) ──

/** HTML-escape a string for text/attribute context. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Serialise the payload for embedding inside a `<script>` block. `JSON.stringify` on
 * its own is NOT safe there: a display name of `</script>` would close the tag. Escaping
 * `<` (and the JS line/paragraph separators) neutralises every breakout while staying
 * valid JSON that `JSON.parse`/a JS literal reads back identically.
 */
export function escapeJsonForScript(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// Rendered client-side. Written without template literals (no backticks / `${`) so it
// embeds cleanly in the outer template string below. Every cell is set via textContent,
// so free-form display names cannot inject markup.
const CLIENT_JS = [
  '(function () {',
  '  var data = window.__ADMIN_DATA__ || { users: [], counts: {}, generatedAt: "" };',
  '  var users = data.users || [];',
  '  var sortKey = "createdAt";',
  '  var sortDir = -1;', // -1 desc, 1 asc
  '  var COLS = [',
  '    { key: "username", label: "Username", cls: "mono" },',
  '    { key: "displayName", label: "Display name" },',
  '    { key: "email", label: "Email", cls: "mono" },',
  '    { key: "tier", label: "Tier" },',
  '    { key: "billingStatus", label: "Billing status" },',
  '    { key: "supporterUntil", label: "Renews" },',
  '    { key: "createdAt", label: "Registered" }',
  '  ];',
  '  function fmtDate(iso) {',
  '    if (!iso) return "\\u2014";',
  '    var d = new Date(iso);',
  '    return isNaN(d.getTime()) ? "\\u2014" : d.toISOString().slice(0, 10);',
  '  }',
  '  function tierLabel(u) {',
  '    if (u.tier !== "pro") return "Free";',
  '    if (u.proSource === "comp+stripe") return "PRO (comp + Stripe)";',
  '    if (u.proSource === "comp") return "PRO (comp)";',
  '    if (u.proSource === "stripe") return "PRO (Stripe)";',
  '    return "PRO";',
  '  }',
  '  function cellText(u, key) {',
  '    if (key === "tier") return tierLabel(u);',
  '    if (key === "supporterUntil" || key === "createdAt") return fmtDate(u[key]);',
  '    return u[key];',
  '  }',
  '  function matches(u, q) {',
  '    if (!q) return true;',
  '    q = q.toLowerCase();',
  '    return (u.username && u.username.toLowerCase().indexOf(q) >= 0) ||',
  '           (u.email && u.email.toLowerCase().indexOf(q) >= 0) ||',
  '           (u.displayName && u.displayName.toLowerCase().indexOf(q) >= 0);',
  '  }',
  '  function cmp(a, b) {',
  '    var av = a[sortKey], bv = b[sortKey];',
  '    if (av == null) av = "";',
  '    if (bv == null) bv = "";',
  '    if (typeof av === "string") av = av.toLowerCase();',
  '    if (typeof bv === "string") bv = bv.toLowerCase();',
  '    if (av < bv) return -1 * sortDir;',
  '    if (av > bv) return 1 * sortDir;',
  '    return 0;',
  '  }',
  '  function td(text, cls) {',
  '    var el = document.createElement("td");',
  '    if (cls) el.className = cls;',
  '    el.textContent = (text == null || text === "") ? "\\u2014" : String(text);',
  '    return el;',
  '  }',
  '  var searchInput, tierSel, tbody, shown, thead;',
  '  function render() {',
  '    var q = searchInput.value.trim();',
  '    var tier = tierSel.value;',
  '    var rows = users.filter(function (u) {',
  '      if (tier === "pro" && u.tier !== "pro") return false;',
  '      if (tier === "free" && u.tier !== "free") return false;',
  '      return matches(u, q);',
  '    }).slice().sort(cmp);',
  '    tbody.textContent = "";',
  '    for (var i = 0; i < rows.length; i++) {',
  '      var u = rows[i];',
  '      var tr = document.createElement("tr");',
  '      for (var c = 0; c < COLS.length; c++) {',
  '        var col = COLS[c];',
  '        var cls = col.cls || "";',
  '        if (col.key === "tier") cls = (u.tier === "pro" ? "tier pro" : "tier free");',
  '        tr.appendChild(td(cellText(u, col.key), cls));',
  '      }',
  '      tbody.appendChild(tr);',
  '    }',
  '    shown.textContent = String(rows.length);',
  '    var ths = thead.querySelectorAll("th");',
  '    for (var j = 0; j < ths.length; j++) {',
  '      var base = COLS[j].label;',
  '      ths[j].textContent = COLS[j].key === sortKey ? base + (sortDir === 1 ? " \\u25B2" : " \\u25BC") : base;',
  '    }',
  '  }',
  '  function buildHead() {',
  '    var tr = document.createElement("tr");',
  '    for (var c = 0; c < COLS.length; c++) {',
  '      (function (col) {',
  '        var th = document.createElement("th");',
  '        th.textContent = col.label;',
  '        th.addEventListener("click", function () {',
  '          if (sortKey === col.key) { sortDir = -sortDir; } else { sortKey = col.key; sortDir = 1; }',
  '          render();',
  '        });',
  '        tr.appendChild(th);',
  '      })(COLS[c]);',
  '    }',
  '    thead.appendChild(tr);',
  '  }',
  '  document.addEventListener("DOMContentLoaded", function () {',
  '    searchInput = document.getElementById("search");',
  '    tierSel = document.getElementById("tier");',
  '    tbody = document.getElementById("tbody");',
  '    shown = document.getElementById("shown");',
  '    thead = document.getElementById("thead");',
  '    buildHead();',
  '    searchInput.addEventListener("input", render);',
  '    tierSel.addEventListener("change", render);',
  '    render();',
  '  });',
  '})();',
].join('\n');

const STYLES = [
  ':root{color-scheme:light dark;--bg:#f6f7f9;--fg:#1a1d21;--muted:#6b7280;--card:#fff;--border:#e2e5ea;--accent:#2563eb;--pro-bg:#e7f5ec;--pro-fg:#116330;--free-bg:#eef0f3;--free-fg:#4b5563;}',
  '@media (prefers-color-scheme:dark){:root{--bg:#0f1216;--fg:#e6e8eb;--muted:#9aa3af;--card:#171b21;--border:#272c34;--accent:#5b9bff;--pro-bg:#123122;--pro-fg:#5fd499;--free-bg:#1d232b;--free-fg:#9aa3af;}}',
  '*{box-sizing:border-box}',
  'body{margin:0;font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}',
  'header{padding:20px 24px;border-bottom:1px solid var(--border);background:var(--card)}',
  'h1{margin:0 0 4px;font-size:18px}',
  '.sub{color:var(--muted);font-size:12px}',
  '.tiles{display:flex;flex-wrap:wrap;gap:12px;margin-top:16px}',
  '.tile{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 16px;min-width:96px}',
  '.tile .n{font-size:22px;font-weight:650}',
  '.tile .l{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}',
  '.controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:16px 24px}',
  'input,select{font:inherit;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--fg)}',
  'input#search{min-width:240px;flex:1}',
  '.count{color:var(--muted);font-size:12px;margin-left:auto}',
  '.wrap{overflow-x:auto;padding:0 24px 40px}',
  'table{border-collapse:collapse;width:100%;background:var(--card);border:1px solid var(--border);border-radius:10px;overflow:hidden}',
  'th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--border);white-space:nowrap}',
  'th{position:sticky;top:0;background:var(--card);cursor:pointer;user-select:none;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em}',
  'tbody tr:hover{background:color-mix(in srgb,var(--accent) 7%,transparent)}',
  'td.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}',
  'td.tier{font-weight:600}',
  'td.tier.pro{color:var(--pro-fg)}',
  'td.tier.free{color:var(--free-fg)}',
  '.empty{padding:40px;text-align:center;color:var(--muted)}',
].join('\n');

function tile(n: number, label: string): string {
  return `<div class="tile"><div class="n">${n}</div><div class="l">${escapeHtml(label)}</div></div>`;
}

/** Render the full self-contained dashboard page. `nonce` authorises the two inline blocks. */
export function renderDashboard(payload: AdminUsersPayload, nonce: string): string {
  const c = payload.counts;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Users · naapurustot admin</title>
<style nonce="${nonce}">${STYLES}</style>
</head>
<body>
<header>
  <h1>Registered users</h1>
  <div class="sub">${payload.counts.total} accounts · generated ${escapeHtml(payload.generatedAt)}</div>
  <div class="tiles">
    ${tile(c.total, 'Total')}
    ${tile(c.pro, 'PRO')}
    ${tile(c.free, 'Free')}
    ${tile(c.comp, 'Comp')}
    ${tile(c.stripe, 'Stripe')}
    ${tile(c.withEmail, 'With email')}
  </div>
</header>
<div class="controls">
  <input id="search" type="search" placeholder="Search username, email, or display name" autocomplete="off" spellcheck="false">
  <select id="tier" aria-label="Filter by tier">
    <option value="all">All tiers</option>
    <option value="pro">PRO only</option>
    <option value="free">Free only</option>
  </select>
  <span class="count"><span id="shown">0</span> shown</span>
</div>
<div class="wrap">
  <table>
    <thead id="thead"></thead>
    <tbody id="tbody"></tbody>
  </table>
</div>
<script nonce="${nonce}">window.__ADMIN_DATA__ = ${escapeJsonForScript(payload)};</script>
<script nonce="${nonce}">${CLIENT_JS}</script>
</body>
</html>`;
}

/** Minimal static error page (no user data, no script). */
export function renderErrorPage(status: number, message: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${status} · naapurustot admin</title>
<style>
  body{margin:0;font:15px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1216;color:#e6e8eb;display:grid;place-items:center;min-height:100vh}
  .box{max-width:420px;padding:32px;text-align:center}
  h1{font-size:44px;margin:0 0 8px}
  p{color:#9aa3af;margin:0}
</style>
</head>
<body>
  <div class="box"><h1>${status}</h1><p>${escapeHtml(message)}</p></div>
</body>
</html>`;
}

// ── Routes ──

/** Admin router, mounted at /auth/admin by auth.ts (behind resolveUser + the /auth
 *  per-IP limiter + the same-origin guard, which only affects non-GET). */
export const adminRouter = Router();

adminRouter.use(requireAdmin);

/** JSON: the account list + tier counts, for programmatic use (curl, scripts). */
adminRouter.get('/users', async (_req: Request, res: Response): Promise<void> => {
  const payload = await buildAdminUsersPayload();
  res.setHeader('Cache-Control', 'no-store');
  res.json(payload);
});

/** HTML: the interactive dashboard page. */
adminRouter.get('/', async (_req: Request, res: Response): Promise<void> => {
  const payload = await buildAdminUsersPayload();
  const nonce = randomBytes(16).toString('base64');
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'`,
  );
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(renderDashboard(payload, nonce));
});
