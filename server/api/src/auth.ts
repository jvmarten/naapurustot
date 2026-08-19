import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { getPool } from './db.js';
import { getClientIp, rateLimit } from './rateLimit.js';
import { verifyTurnstile } from './turnstile.js';
import { sendPasswordResetEmail } from './mailer.js';
import {
  buildResetUrl,
  generateResetToken,
  hashResetToken,
  isWellFormedResetToken,
  normalizeEmail,
  normalizeLang,
  resetTokenExpiry,
  validateEmail,
  validatePassword,
} from './passwordReset.js';
import { billingRouter, cancelSubscriptionForUser, deriveSupporter } from './billing.js';

/**
 * Auth + user-data router, mounted at /auth by index.ts. Covers signup/login/
 * logout/me, per-user sync (favorites, shortlist, notes, preferences), and GDPR
 * export/deletion. All routes except signup/login/logout require the JWT cookie.
 */
const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'dev-secret-change-me');
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable must be set in production');
}
const SALT_ROUNDS = 12;
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

// A valid bcrypt hash (cost 12) of an arbitrary string. Used only to spend
// equivalent CPU time in the login "user not found" branch so response timing
// does not reveal whether a username exists (username enumeration). The value
// itself is irrelevant — it just has to be a well-formed $2b$12$ hash.
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO3ROOkvI7r5/Apx5OAtNgWZ6lyHkVqzG';

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,20}$/;

/**
 * Read the userId resolved by `resolveUser` (which runs on every router request
 * and does the actual JWT + token-version verification).
 *
 * When `res` is provided and a cookie was present but did not resolve to a live
 * session — expired, tampered, user deleted, or a generation revoked by a
 * password reset — clear it so the client stops re-sending a dead token.
 */
function authenticateToken(req: Request, res?: Response): string | null {
  const r = req as AuthedRequest;
  if (r.userId) return r.userId;
  if (res && r.hadToken) res.clearCookie('token', CLEAR_COOKIE_OPTS);
  return null;
}

/** Sign a session JWT. `tv` pins the token to the user's current credential
 *  generation — see the token_version migration in db.ts. */
function signSessionToken(userId: string, tokenVersion: unknown): string {
  const tv = typeof tokenVersion === 'number' ? tokenVersion : 0;
  return jwt.sign({ userId, tv }, JWT_SECRET, { expiresIn: '7d' });
}

function setTokenCookie(res: Response, token: string): void {
  res.cookie('token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });
}

function formatUser(row: Record<string, unknown>) {
  // `billing_status` / `billing_period_end` come from the LEFT JOIN in the routes
  // that return a supporter-aware user (login, /me, credential changes); absent on a
  // plain users row (e.g. a fresh signup), deriveSupporter yields a non-supporter.
  const { supporter, supporterUntil } = deriveSupporter(row.billing_status, row.billing_period_end);
  return {
    id: row.id,
    username: row.username,
    email: row.email || null,
    displayName: row.display_name || null,
    trustLevel: row.trust_level,
    createdAt: row.created_at,
    supporter,
    supporterUntil,
  };
}

/** Fetch a user joined with billing state, shaped for formatUser. Used by the routes
 *  that return the user object so `supporter` reflects the current subscription. */
async function selectUserRow(userId: string): Promise<Record<string, unknown> | undefined> {
  const result = await getPool().query(
    `SELECT u.id, u.username, u.email, u.display_name, u.trust_level, u.created_at,
            b.status AS billing_status, b.current_period_end AS billing_period_end
       FROM users u LEFT JOIN user_billing b ON b.user_id = u.id
      WHERE u.id = $1`,
    [userId],
  );
  return result.rows[0];
}

// IN-5: per-user rate limiting. A request carrying a valid JWT gets a SECOND
// fixed-window bucket keyed on its userId, in addition to the per-IP limiter
// mounted in index.ts. This closes the CGNAT false-throttle (many users sharing
// one NAT IP would otherwise share a single per-IP bucket) and the
// IP-rotation-per-account abuse gap (rotating source IPs no longer multiplies a
// single account's write budget). Generous enough that normal use never hits it
// (the client debounces saves ~1 s apart).
interface AuthedRequest extends Request { userId?: string | null; hadToken?: boolean }

// A signed token always carries a UUID userId, but check the shape before it
// reaches the query: a malformed value would make Postgres raise 22P02
// (invalid input syntax for uuid) and turn a bad cookie into a 500.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Resolve the request's user once, and stash it so the per-user limiter below and
 * every handler read the same answer.
 *
 * Two things happen here. The JWT is verified (signature + expiry), and then its
 * `tv` claim is checked against `users.token_version`. That second step is what
 * makes a password reset actually end other sessions: JWTs are stateless and
 * valid for 7 days, so without a server-side generation counter an attacker's
 * stolen cookie would keep working for a week after the victim reset their
 * password — the exact scenario a reset exists to stop. The cost is one indexed
 * primary-key lookup per authenticated request.
 *
 * Tokens issued before token_version shipped have no `tv` claim; those are read
 * as generation 0, which matches the column default, so the deploy does not sign
 * existing users out.
 */
async function resolveUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const r = req as AuthedRequest;
  const token = req.cookies?.token;
  r.hadToken = Boolean(token);
  r.userId = null;
  if (!token) { next(); return; }

  let payload: { userId?: unknown; tv?: unknown };
  try {
    payload = jwt.verify(token, JWT_SECRET) as { userId?: unknown; tv?: unknown };
  } catch {
    next();
    return;
  }
  if (typeof payload?.userId !== 'string' || !UUID_RE.test(payload.userId)) { next(); return; }

  const result = await getPool().query('SELECT token_version FROM users WHERE id = $1', [payload.userId]);
  if (result.rows.length === 0) { next(); return; }

  const claimed = typeof payload.tv === 'number' ? payload.tv : 0;
  const current = result.rows[0].token_version ?? 0;
  if (Number(current) !== claimed) { next(); return; }

  r.userId = payload.userId;
  next();
}

const perUserLimiter = rateLimit(120, 60_000, 'authuser', (req) => (req as AuthedRequest).userId ?? null);

/** Apply the per-user limiter to state-changing requests and the heavy GET /export
 *  (the routes the spec calls out); plain GET reads rely on the per-IP limiter. */
function perUserLimited(req: Request, res: Response, next: NextFunction): void {
  const isWrite = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
  if (isWrite || req.path === '/export') {
    perUserLimiter(req, res, next);
    return;
  }
  next();
}

router.use(resolveUser, perUserLimited);

// Supporter subscription (Stripe). Mounted here so the checkout/portal endpoints run
// behind resolveUser (which sets req.userId), the per-user limiter, and the
// same-origin CSRF guard that app.ts applies to /auth. The Stripe webhook is NOT here
// — it is a raw-body route registered in app.ts, since Stripe sends no allowed Origin.
router.use('/billing', billingRouter);

// Signup: 3 per IP per day
router.post('/signup', rateLimit(3, 24 * 60 * 60 * 1000, 'signup'), async (req: Request, res: Response): Promise<void> => {
  const { username, password, email, displayName, turnstileToken } = req.body;

  if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  if (!USERNAME_RE.test(username)) {
    res.status(400).json({ error: 'Username must be 3-20 characters (letters, numbers, _ or -)' });
    return;
  }

  // Length floor + the bcrypt-DoS cap (hashing a multi-MB string costs minutes of
  // CPU). Shared with /reset-password so the two paths can never drift apart.
  const passwordCheck = validatePassword(password);
  if (!passwordCheck.ok) {
    res.status(400).json({ error: passwordCheck.error });
    return;
  }

  // RFC 5321 caps an address at 254 chars; validateEmail enforces that (and string
  // type) before its regex runs, which also bounds the input so the ambiguous
  // [^\s@]+\.[^\s@]+ alternation can't backtrack on a long string (ReDoS).
  if (email !== undefined && email !== null && email !== '') {
    const emailCheck = validateEmail(email);
    if (!emailCheck.ok) {
      res.status(400).json({ error: emailCheck.error });
      return;
    }
  }

  // Verify Turnstile (skipped in dev when no secret is configured)
  const turnstileOk = await verifyTurnstile(turnstileToken || '', req.ip);
  if (!turnstileOk) {
    res.status(403).json({ error: 'Bot verification failed. Please try again.' });
    return;
  }

  try {
    const existing = await getPool().query(
      'SELECT id FROM users WHERE username = $1',
      [username.toLowerCase()]
    );
    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'Username already taken' });
      return;
    }

    if (email) {
      const emailExists = await getPool().query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
      if (emailExists.rows.length > 0) {
        res.status(409).json({ error: 'Email already registered' });
        return;
      }
    }

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await getPool().query(
      `INSERT INTO users (username, password, email, display_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, email, display_name, trust_level, created_at, token_version`,
      [username.toLowerCase(), hash, email?.toLowerCase() || null, displayName || null]
    );

    const user = result.rows[0];
    setTokenCookie(res, signSessionToken(user.id, user.token_version));

    res.status(201).json({ user: formatUser(user) });
  } catch (err: unknown) {
    // Handle unique constraint violations from concurrent signups (TOCTOU race
    // between the SELECT check and INSERT). The username/email UNIQUE constraints
    // in the database are the actual guarantees; the SELECT checks above are just
    // for better error messages under normal conditions.
    const pgErr = err as { code?: string; constraint?: string };
    if (pgErr.code === '23505') {
      const msg = pgErr.constraint?.includes('email')
        ? 'Email already registered'
        : 'Username already taken';
      res.status(409).json({ error: msg });
      return;
    }
    throw err;
  }
});

// Login: 10 per IP per 15 minutes
router.post('/login', rateLimit(10, 15 * 60 * 1000, 'login'), async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body;

  if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  // Same bcrypt DoS protection as signup — reject absurdly long passwords. Spend
  // comparable bcrypt time on a truncated copy first (the cap still prevents the
  // DoS) so this branch isn't a ~1 ms fast-path that timing can distinguish from a
  // real wrong-password attempt, which would partially defeat the enumeration defense.
  if (password.length > 1000) {
    await bcrypt.compare(password.slice(0, 1000), DUMMY_HASH);
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }

  const result = await getPool().query(
    `SELECT u.id, u.username, u.email, u.password, u.display_name, u.trust_level, u.created_at, u.token_version,
            b.status AS billing_status, b.current_period_end AS billing_period_end
       FROM users u LEFT JOIN user_billing b ON b.user_id = u.id
      WHERE u.username = $1`,
    [username.toLowerCase()]
  );

  if (result.rows.length === 0) {
    // Spend comparable bcrypt time so a non-existent username can't be told apart
    // from a wrong password by response latency (defeats username enumeration).
    await bcrypt.compare(password, DUMMY_HASH);
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }

  const user = result.rows[0];
  const valid = await bcrypt.compare(password, user.password);

  if (!valid) {
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }

  setTokenCookie(res, signSessionToken(user.id, user.token_version));

  res.json({ user: formatUser(user) });
});

router.post('/logout', (_req: Request, res: Response): void => {
  res.clearCookie('token', { httpOnly: true, secure: true, sameSite: 'none', path: '/' });
  res.json({ ok: true });
});

// ── Password reset ──

/** The one answer /forgot-password ever gives. See the handler for why. */
const FORGOT_RESPONSE = { ok: true } as const;

/** Every failure mode of /reset-password collapses to this. Distinguishing
 *  "wrong token" from "expired" from "already used" would tell an attacker
 *  holding a guessed or stale token which part to vary. */
const RESET_FAILED = 'Invalid or expired reset link';

/**
 * Step 1 of the reset: request a link.
 *
 * Responds `{ ok: true }` *before* doing any work, unconditionally. That is the
 * whole design: the response body, status and latency must be identical whether
 * or not the address belongs to an account, otherwise this endpoint becomes an
 * oracle for "is this person a user of naapurustot.fi?" — the same enumeration
 * defence the login route buys with its DUMMY_HASH bcrypt compare. Doing the
 * lookup and the ~hundreds-of-ms mail send after responding means no branch here
 * is observable from outside.
 *
 * Consequence: nothing after res.json() may touch `res`, and every error must be
 * swallowed into a log line rather than thrown.
 */
router.post('/forgot-password', rateLimit(5, 60 * 60 * 1000, 'forgot'), async (req: Request, res: Response): Promise<void> => {
  const { email, lang } = req.body ?? {};
  const mailLang = normalizeLang(lang);
  const emailCheck = validateEmail(email);

  res.json(FORGOT_RESPONSE);

  if (!emailCheck.ok) return;

  try {
    const normalized = normalizeEmail(email as string);
    const found = await getPool().query(
      'SELECT id, username, email FROM users WHERE email = $1',
      [normalized]
    );
    if (found.rows.length === 0) return;
    const user = found.rows[0];

    const { token, tokenHash } = generateResetToken();

    // Opportunistic purge — the table is tiny and expires_at is indexed, and the
    // 5/hour limiter bounds how often this runs. Cheaper than a cron container.
    await getPool().query('DELETE FROM password_reset_tokens WHERE expires_at < NOW()');
    // Only the newest link works: supersede any outstanding token for this user
    // so a request made because an earlier mail was suspected of interception
    // actually retires that earlier link.
    await getPool().query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);
    await getPool().query(
      'INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
      [tokenHash, user.id, resetTokenExpiry()]
    );

    const baseUrl = process.env.APP_BASE_URL || 'https://naapurustot.fi';
    const result = await sendPasswordResetEmail(user.email, buildResetUrl(baseUrl, token, mailLang), user.username, mailLang);
    if (!result.ok && !result.disabled) {
      // The address is PII and this line goes to container logs — record that the
      // send failed and why, never who it was for.
      console.error('password reset email failed:', result.error);
    }
  } catch (err) {
    console.error('password reset request failed:', err);
  }
});

/**
 * Step 2 of the reset: redeem a link and set the new password.
 *
 * The token is consumed by a single conditional UPDATE ... RETURNING rather than
 * a SELECT-then-UPDATE. That one statement is atomic, so two requests racing with
 * the same token cannot both observe `used_at IS NULL` and both succeed — and it
 * needs no explicit row lock.
 */
router.post('/reset-password', rateLimit(10, 60 * 60 * 1000, 'reset'), async (req: Request, res: Response): Promise<void> => {
  const { token, password } = req.body ?? {};

  if (!isWellFormedResetToken(token)) {
    res.status(400).json({ error: RESET_FAILED });
    return;
  }
  const passwordCheck = validatePassword(password);
  if (!passwordCheck.ok) {
    res.status(400).json({ error: passwordCheck.error });
    return;
  }

  // Hash before opening the transaction: bcrypt at cost 12 takes a few hundred ms
  // and there is no reason to hold a pooled connection across it.
  const hash = await bcrypt.hash(password, SALT_ROUNDS);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const claimed = await client.query(
      `UPDATE password_reset_tokens SET used_at = NOW()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
        RETURNING user_id`,
      [hashResetToken(token)]
    );
    if (claimed.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: RESET_FAILED });
      return;
    }
    const userId = claimed.rows[0].user_id;

    // Bumping token_version is what ends every existing session for this account
    // (see resolveUser). A reset is often triggered *because* someone else has
    // access; leaving their 7-day cookie alive would make the reset cosmetic.
    const updated = await client.query(
      'UPDATE users SET password = $1, token_version = token_version + 1, updated_at = NOW() WHERE id = $2',
      [hash, userId]
    );
    if (updated.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: RESET_FAILED });
      return;
    }
    await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Deliberately no new session cookie. Whoever completed this proved control of
  // the mailbox, not knowledge of the account — so they sign in with the password
  // they just set, like everyone else. Clear any cookie they arrived with: it
  // belongs to the generation just revoked.
  res.clearCookie('token', CLEAR_COOKIE_OPTS);
  res.json({ ok: true });
});

// ── Credential management (email address, password) ──

/**
 * Shared limiter for the two routes that verify the CURRENT password
 * (`PATCH /email`, `PATCH /password`).
 *
 * Both are reachable only with a session, so the per-user limiter in this router
 * already applies — but at 120/min it is far too generous here. An attacker who
 * has stolen a session cookie but does NOT know the password can otherwise sit on
 * these endpoints and brute-force it, and success escalates a borrowed session
 * into a permanently owned account (change the password, or repoint the reset
 * address). 10 attempts an hour leaves ample room for a genuine typo.
 *
 * Keyed on the userId when there is one, falling back to the client IP so an
 * unauthenticated flood can't bypass the bucket by simply omitting the cookie.
 */
const credentialLimiter = rateLimit(
  10,
  60 * 60 * 1000,
  'credential',
  (req) => (req as AuthedRequest).userId ?? getClientIp(req),
);

/**
 * Set, change or clear the account's email address.
 *
 * Requires the current password even though the caller is already authenticated.
 * The email is the reset channel, so an attacker sitting on a stolen session
 * could otherwise point it at their own mailbox and take the account
 * permanently — re-authenticating here keeps a stolen cookie from escalating
 * into a stolen account.
 */
router.patch('/email', credentialLimiter, async (req: Request, res: Response): Promise<void> => {
  const userId = authenticateToken(req, res);
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const { email, password } = req.body ?? {};
  if (!password || typeof password !== 'string' || password.length > 1000) {
    res.status(400).json({ error: 'Current password is required' });
    return;
  }

  // `null` / `''` removes the address (and with it the ability to self-recover —
  // the client warns about that before sending).
  const clearing = email === null || email === '';
  if (!clearing) {
    const emailCheck = validateEmail(email);
    if (!emailCheck.ok) {
      res.status(400).json({ error: emailCheck.error });
      return;
    }
  }

  const current = await getPool().query('SELECT password FROM users WHERE id = $1', [userId]);
  if (current.rows.length === 0) {
    res.clearCookie('token', CLEAR_COOKIE_OPTS);
    res.status(401).json({ error: 'User not found' });
    return;
  }
  if (!(await bcrypt.compare(password, current.rows[0].password))) {
    res.status(403).json({ error: 'Incorrect password' });
    return;
  }

  try {
    const result = await getPool().query(
      `UPDATE users SET email = $1, updated_at = NOW() WHERE id = $2
       RETURNING id, username, email, display_name, trust_level, created_at`,
      [clearing ? null : normalizeEmail(email as string), userId]
    );
    // Re-select with the billing join so the returned user keeps its supporter flag —
    // the client adopts this object, and a bare RETURNING would blank the badge.
    res.json({ user: formatUser((await selectUserRow(userId)) ?? result.rows[0]) });
  } catch (err: unknown) {
    // The email UNIQUE constraint is the real guarantee (a concurrent PATCH could
    // otherwise slip between a check and this write).
    if ((err as { code?: string }).code === '23505') {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }
    throw err;
  }
});

/**
 * Change the password from an authenticated session.
 *
 * Distinct from /reset-password, and the differences are deliberate:
 *
 *  - **A new cookie IS issued here.** Both routes bump `token_version` to revoke
 *    every other session, which would otherwise kill the caller's own session
 *    too — so this one re-signs the caller's cookie with the new generation. On
 *    the reset path we intentionally do not: whoever redeems a mailed token has
 *    proved control of a mailbox, not knowledge of the account, so they sign in
 *    afresh. Here the caller already authenticated, and logging them out of the
 *    tab they are standing in would read as a bug.
 *
 *  - **Reuse is rejected here.** On the reset path it is not: people reset
 *    because they forgot, and a fair number remember the password partway
 *    through — refusing it there is friction on the common case for a threat
 *    that barely applies (a stolen *cookie* never revealed the password, and
 *    the token_version bump already killed it). Someone deliberately rotating a
 *    password has no such excuse, and silently accepting a no-op change would
 *    tell them they had rotated when they had not.
 */
router.patch('/password', credentialLimiter, async (req: Request, res: Response): Promise<void> => {
  const userId = authenticateToken(req, res);
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const { currentPassword, newPassword } = req.body ?? {};
  if (!currentPassword || typeof currentPassword !== 'string' || currentPassword.length > 1000) {
    res.status(400).json({ error: 'Current password is required' });
    return;
  }
  const passwordCheck = validatePassword(newPassword);
  if (!passwordCheck.ok) {
    res.status(400).json({ error: passwordCheck.error });
    return;
  }

  const current = await getPool().query('SELECT password FROM users WHERE id = $1', [userId]);
  if (current.rows.length === 0) {
    res.clearCookie('token', CLEAR_COOKIE_OPTS);
    res.status(401).json({ error: 'User not found' });
    return;
  }
  const currentHash = current.rows[0].password;

  if (!(await bcrypt.compare(currentPassword, currentHash))) {
    res.status(403).json({ error: 'Incorrect password' });
    return;
  }
  // Checked against the stored hash rather than by comparing the two plaintexts,
  // so it still catches reuse when the client sends them in different forms.
  if (await bcrypt.compare(newPassword, currentHash)) {
    res.status(400).json({ error: 'New password must be different from the current one' });
    return;
  }

  const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  const updated = await getPool().query(
    `UPDATE users SET password = $1, token_version = token_version + 1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, username, email, display_name, trust_level, created_at, token_version`,
    [hash, userId]
  );
  if (updated.rows.length === 0) {
    res.clearCookie('token', CLEAR_COOKIE_OPTS);
    res.status(401).json({ error: 'User not found' });
    return;
  }

  // Re-issue against the NEW generation — see the note above.
  const user = updated.rows[0];
  setTokenCookie(res, signSessionToken(user.id, user.token_version));
  // Re-select with the billing join so the returned user keeps its supporter flag.
  res.json({ user: formatUser((await selectUserRow(userId)) ?? user) });
});

// ── IN-4: request-hardening helpers (wired into index.ts; pure + testable) ──

/**
 * Routes whose JSON body is legitimately large (notes: up to 500 × 5000 chars ≈ 2.5 MB;
 * preferences: presets + weights + wizard profile). The global 16 KB json parser SKIPS
 * these and a 1 MB parser is mounted instead — otherwise a heavy note-taker's payload
 * exceeds 16 KB and they can never sync again (the body parser 413s before the handler).
 */
export const LARGE_BODY_ROUTES = new Set(['/auth/notes', '/auth/preferences']);

/** Read an Express/body-parser error's HTTP status (PayloadTooLargeError → 413), else 500.
 *  The fallback error handler used a hardcoded 500, masking 413 as a generic server error. */
export function httpErrorStatus(err: unknown): number {
  if (err && typeof err === 'object') {
    const e = err as { status?: unknown; statusCode?: unknown };
    if (typeof e.status === 'number') return e.status;
    if (typeof e.statusCode === 'number') return e.statusCode;
  }
  return 500;
}

// ── GDPR: account deletion + personal-data export (CF-13) ──

const CLEAR_COOKIE_OPTS = { httpOnly: true, secure: true, sameSite: 'none' as const, path: '/' };

/**
 * Validate the confirmation a client must send to delete its account.
 * Requires the literal string "DELETE" so a misrouted/accidental request can
 * never wipe an account. Pure (no DB) so it can be unit-tested in isolation.
 */
export function validateDeleteConfirmation(confirm: unknown): { ok: true } | { ok: false; error: string } {
  if (confirm !== 'DELETE') {
    return { ok: false, error: 'Account deletion requires confirmation' };
  }
  return { ok: true };
}

/**
 * Assemble the full personal-data export payload from the rows the API stores
 * for a user. Pure (no DB) so the export shape is unit-testable. Any table
 * with no row for the user contributes its documented empty default.
 */
export function buildExportPayload(parts: {
  user: Record<string, unknown> | undefined;
  favorites: string[] | undefined;
  shortlist: string[] | undefined;
  notes: Record<string, string> | undefined;
  preferences: { filterPresets?: unknown; qualityWeights?: unknown; wizardProfile?: unknown } | undefined;
  // The account's own copy of its supporter-subscription state (null when never a
  // supporter). Stripe holds the invoices themselves and retains them for the legally
  // required period; this is the subscription status we store alongside the account.
  billing?: Record<string, unknown> | null;
}) {
  const u = parts.user;
  return {
    exportedAt: new Date().toISOString(),
    account: u
      ? {
          id: u.id,
          username: u.username,
          email: u.email ?? null,
          displayName: u.display_name ?? null,
          trustLevel: u.trust_level,
          createdAt: u.created_at,
          updatedAt: u.updated_at,
        }
      : null,
    favorites: parts.favorites ?? [],
    shortlist: parts.shortlist ?? [],
    notes: parts.notes ?? {},
    filterPresets: parts.preferences?.filterPresets ?? [],
    qualityWeights: parts.preferences?.qualityWeights ?? {},
    wizardProfile: parts.preferences?.wizardProfile ?? {},
    billing: parts.billing ?? null,
  };
}

// Export the full stored record so the user can download all data we hold.
router.get('/export', async (req: Request, res: Response): Promise<void> => {
  const userId = authenticateToken(req, res);
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  // Run all five reads on one connection inside a REPEATABLE READ transaction so
  // the export is a single consistent snapshot. As independent pool queries, a
  // concurrent edit between them could yield a mix that never existed at any instant.
  const client = await getPool().connect();
  let rows;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    rows = await Promise.all([
      client.query(
        'SELECT id, username, email, display_name, trust_level, created_at, updated_at FROM users WHERE id = $1',
        [userId]
      ),
      client.query('SELECT favorites FROM user_favorites WHERE user_id = $1', [userId]),
      client.query('SELECT shortlist FROM user_shortlist WHERE user_id = $1', [userId]),
      client.query('SELECT notes FROM user_notes WHERE user_id = $1', [userId]),
      client.query('SELECT filter_presets, quality_weights, wizard_profile FROM user_preferences WHERE user_id = $1', [userId]),
      client.query('SELECT provider, plan, status, current_period_end, stripe_customer_id, updated_at FROM user_billing WHERE user_id = $1', [userId]),
    ]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  const [user, favorites, shortlist, notes, preferences, billing] = rows;

  if (user.rows.length === 0) {
    res.clearCookie('token', CLEAR_COOKIE_OPTS);
    res.status(401).json({ error: 'User not found' });
    return;
  }

  const payload = buildExportPayload({
    user: user.rows[0],
    favorites: favorites.rows[0]?.favorites,
    shortlist: shortlist.rows[0]?.shortlist,
    notes: notes.rows[0]?.notes,
    preferences: preferences.rows[0]
      ? {
          filterPresets: preferences.rows[0].filter_presets,
          qualityWeights: preferences.rows[0].quality_weights,
          wizardProfile: preferences.rows[0].wizard_profile,
        }
      : undefined,
    billing: billing.rows[0]
      ? {
          provider: billing.rows[0].provider,
          plan: billing.rows[0].plan,
          status: billing.rows[0].status,
          currentPeriodEnd: billing.rows[0].current_period_end,
          stripeCustomerId: billing.rows[0].stripe_customer_id,
          updatedAt: billing.rows[0].updated_at,
        }
      : null,
  });

  res.setHeader('Content-Disposition', 'attachment; filename="naapurustot-data.json"');
  res.json(payload);
});

// Permanently delete the account. The ON DELETE CASCADE FKs on user_favorites,
// user_shortlist, user_notes and user_preferences remove all dependent rows.
router.delete('/account', async (req: Request, res: Response): Promise<void> => {
  const userId = authenticateToken(req, res);
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const confirmation = validateDeleteConfirmation(req.body?.confirm);
  if (!confirmation.ok) {
    res.status(400).json({ error: confirmation.error });
    return;
  }

  // Cancel any live subscription at Stripe FIRST, so a deleted account stops being
  // billed — the CASCADE below would otherwise drop our record while Stripe kept
  // charging. Best-effort (no-op when billing is unconfigured or the user never paid).
  await cancelSubscriptionForUser(userId);

  // Deleting the users row cascades to all user_* tables via ON DELETE CASCADE.
  const result = await getPool().query('DELETE FROM users WHERE id = $1', [userId]);
  if (result.rowCount === 0) {
    res.clearCookie('token', CLEAR_COOKIE_OPTS);
    res.status(401).json({ error: 'User not found' });
    return;
  }

  res.clearCookie('token', CLEAR_COOKIE_OPTS);
  res.json({ ok: true });
});

// Goes through authenticateToken (rather than verifying the JWT inline) so the
// token_version revocation check in resolveUser applies here too — otherwise a
// session killed by a password reset would still report itself as signed in, and
// the client would keep believing it was authenticated.
router.get('/me', async (req: Request, res: Response): Promise<void> => {
  const userId = authenticateToken(req, res);
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const row = await selectUserRow(userId);

  if (!row) {
    res.clearCookie('token', { httpOnly: true, secure: true, sameSite: 'none', path: '/' });
    res.status(401).json({ error: 'User not found' });
    return;
  }

  res.json({ user: formatUser(row) });
});

// ── Favorites sync ──

router.get('/favorites', async (req: Request, res: Response): Promise<void> => {
  const userId = authenticateToken(req, res);
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const result = await getPool().query(
    'SELECT favorites, updated_at FROM user_favorites WHERE user_id = $1',
    [userId]
  );
  const favorites: string[] = result.rows.length > 0 ? result.rows[0].favorites : [];
  // IN-6: surface the server's last-write time so the client can resolve a diverged
  // conflict by last-write-wins against its own per-store edit timestamp.
  res.json({ favorites, updatedAt: result.rows[0]?.updated_at ?? null });
});

router.put('/favorites', async (req: Request, res: Response): Promise<void> => {
  const userId = authenticateToken(req, res);
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const { favorites } = req.body;
  if (!Array.isArray(favorites) || !favorites.every((v: unknown) => typeof v === 'string')) {
    res.status(400).json({ error: 'favorites must be an array of strings' });
    return;
  }
  if (favorites.length > 200) {
    res.status(400).json({ error: 'Too many favorites (max 200)' });
    return;
  }
  // Validate that each entry is a plausible identifier (5-digit postal code
  // or region ID like "helsinki_metro"). Reject arbitrary strings to prevent
  // storing XSS payloads or other junk data that might be rendered by
  // future features.
  const FAVORITE_RE = /^[a-z0-9_]{1,30}$/;
  if (favorites.some((v: string) => !FAVORITE_RE.test(v))) {
    res.status(400).json({ error: 'Invalid favorite entry format' });
    return;
  }

  await getPool().query(
    `INSERT INTO user_favorites (user_id, favorites, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET favorites = $2, updated_at = NOW()`,
    [userId, JSON.stringify(favorites)]
  );
  res.json({ favorites });
});

// ── Shortlist sync (QW-2b) ──

router.get('/shortlist', async (req: Request, res: Response): Promise<void> => {
  const userId = authenticateToken(req, res);
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const result = await getPool().query(
    'SELECT shortlist, updated_at FROM user_shortlist WHERE user_id = $1',
    [userId]
  );
  const shortlist: string[] = result.rows.length > 0 ? result.rows[0].shortlist : [];
  // IN-6: surface the server's last-write time for last-write-wins conflict merges.
  res.json({ shortlist, updatedAt: result.rows[0]?.updated_at ?? null });
});

router.put('/shortlist', async (req: Request, res: Response): Promise<void> => {
  const userId = authenticateToken(req, res);
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const { shortlist } = req.body;
  if (!Array.isArray(shortlist) || !shortlist.every((v: unknown) => typeof v === 'string')) {
    res.status(400).json({ error: 'shortlist must be an array of strings' });
    return;
  }
  if (shortlist.length > 200) {
    res.status(400).json({ error: 'Too many shortlist entries (max 200)' });
    return;
  }
  // Same identifier constraint as favorites (5-digit postal code or region ID like
  // "helsinki_metro") — reject arbitrary strings to prevent storing junk/XSS payloads.
  const SHORTLIST_RE = /^[a-z0-9_]{1,30}$/;
  if (shortlist.some((v: string) => !SHORTLIST_RE.test(v))) {
    res.status(400).json({ error: 'Invalid shortlist entry format' });
    return;
  }

  await getPool().query(
    `INSERT INTO user_shortlist (user_id, shortlist, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET shortlist = $2, updated_at = NOW()`,
    [userId, JSON.stringify(shortlist)]
  );
  res.json({ shortlist });
});

// ── Notes sync (QW-6) ──

const PNO_RE = /^\d{5}$/;
const MAX_NOTE_LEN = 5000;
const MAX_NOTES = 500;

router.get('/notes', async (req: Request, res: Response): Promise<void> => {
  const userId = authenticateToken(req, res);
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const result = await getPool().query(
    'SELECT notes, updated_at FROM user_notes WHERE user_id = $1',
    [userId]
  );
  const notes: Record<string, string> = result.rows.length > 0 ? result.rows[0].notes : {};
  // IN-6: surface the store's last-write time; the client resolves per-note conflicts
  // by comparing it against each note's local last-edit timestamp (last write wins).
  res.json({ notes, updatedAt: result.rows[0]?.updated_at ?? null });
});

router.put('/notes', async (req: Request, res: Response): Promise<void> => {
  const userId = authenticateToken(req, res);
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const { notes } = req.body;
  if (!notes || typeof notes !== 'object' || Array.isArray(notes)) {
    res.status(400).json({ error: 'notes must be an object keyed by postal code' });
    return;
  }
  const entries = Object.entries(notes);
  if (entries.length > MAX_NOTES) {
    res.status(400).json({ error: 'Too many notes (max 500)' });
    return;
  }
  const sanitized: Record<string, string> = {};
  for (const [key, val] of entries) {
    if (!PNO_RE.test(key)) {
      res.status(400).json({ error: 'Invalid note key (must be 5-digit postal code)' });
      return;
    }
    if (typeof val !== 'string') {
      res.status(400).json({ error: 'Note values must be strings' });
      return;
    }
    if (val.length > MAX_NOTE_LEN) {
      res.status(400).json({ error: `Note too long (max ${MAX_NOTE_LEN} chars)` });
      return;
    }
    if (val.trim()) sanitized[key] = val;
  }

  await getPool().query(
    `INSERT INTO user_notes (user_id, notes, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET notes = $2, updated_at = NOW()`,
    [userId, JSON.stringify(sanitized)]
  );
  res.json({ notes: sanitized });
});

// ── Preferences sync (CF-2): filter presets + quality weights ──

const MAX_FILTER_PRESETS = 50;
const MAX_PRESET_NAME_LEN = 100;
const MAX_CRITERIA_PER_PRESET = 30;
const LAYER_ID_RE = /^[a-z0-9_]{1,50}$/;
const FACTOR_ID_RE = /^[a-z0-9_]{1,50}$/;

function validateFilterPresets(value: unknown): { ok: true; value: unknown[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: 'filterPresets must be an array' };
  if (value.length > MAX_FILTER_PRESETS) return { ok: false, error: `Too many filter presets (max ${MAX_FILTER_PRESETS})` };
  for (const preset of value) {
    if (!preset || typeof preset !== 'object') return { ok: false, error: 'Each preset must be an object' };
    const p = preset as Record<string, unknown>;
    if (typeof p.name !== 'string' || !p.name || p.name.length > MAX_PRESET_NAME_LEN) {
      return { ok: false, error: 'Each preset must have a non-empty name (max 100 chars)' };
    }
    if (!Array.isArray(p.criteria)) return { ok: false, error: 'Each preset must have a criteria array' };
    if (p.criteria.length > MAX_CRITERIA_PER_PRESET) return { ok: false, error: 'Too many criteria in preset' };
    for (const c of p.criteria) {
      if (!c || typeof c !== 'object') return { ok: false, error: 'Each criterion must be an object' };
      const r = c as Record<string, unknown>;
      if (typeof r.layerId !== 'string' || !LAYER_ID_RE.test(r.layerId)) {
        return { ok: false, error: 'Invalid layerId in criterion' };
      }
      if (typeof r.min !== 'number' || typeof r.max !== 'number' || !isFinite(r.min) || !isFinite(r.max)) {
        return { ok: false, error: 'Criterion min/max must be finite numbers' };
      }
      if (r.min > r.max) return { ok: false, error: 'Criterion min must be <= max' };
    }
  }
  return { ok: true, value };
}

function validateQualityWeights(value: unknown): { ok: true; value: Record<string, number> } | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'qualityWeights must be an object' };
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 200) return { ok: false, error: 'Too many quality factors' };
  const result: Record<string, number> = {};
  for (const [k, v] of entries) {
    if (!FACTOR_ID_RE.test(k)) return { ok: false, error: 'Invalid factor id in quality weights' };
    if (typeof v !== 'number' || !isFinite(v)) return { ok: false, error: 'Quality weight values must be finite numbers' };
    if (v < -100 || v > 100) return { ok: false, error: 'Quality weight values must be between -100 and 100' };
    result[k] = v;
  }
  return { ok: true, value: result };
}

// IN-3: the wizard priority profile is a fixed-shape blob (re-sanitized client-side
// by sanitizeWizardAnswers on read). Validate it size-capped + key-allowlisted so the
// authed PUT can't be used to stuff arbitrary JSON into the column.
const WIZARD_PROFILE_KEYS = new Set([
  'transitImportance', 'quietPreference', 'budgetAdvanced', 'budgetMin', 'budgetMax',
  'sizePreference', 'tenurePreference', 'hasChildren', 'schoolImportance',
  'healthcareImportance', 'foreignersPreference', 'skipped',
]);

// The per-question skip flags the profile's `skipped` object may carry (mirrors the
// client's WIZARD_QUESTION_KEYS). `skipped` is the one nested object in the profile —
// validate it key-allowlisted + boolean-valued so the authed PUT still can't stuff
// arbitrary JSON into the column.
const WIZARD_SKIP_KEYS = new Set([
  'transit', 'quiet', 'foreigners', 'budget', 'size', 'tenure', 'children', 'school', 'healthcare',
]);

export function validateWizardProfile(value: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'wizardProfile must be an object' };
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > WIZARD_PROFILE_KEYS.size) return { ok: false, error: 'Too many wizardProfile keys' };
  const result: Record<string, unknown> = {};
  for (const [k, v] of entries) {
    if (!WIZARD_PROFILE_KEYS.has(k)) return { ok: false, error: `Unknown wizardProfile key: ${k}` };
    if (k === 'skipped') {
      // The only allowed nested object: a bounded map of known question keys → boolean.
      if (!v || typeof v !== 'object' || Array.isArray(v)) {
        return { ok: false, error: 'wizardProfile skipped must be an object' };
      }
      const skipEntries = Object.entries(v as Record<string, unknown>);
      if (skipEntries.length > WIZARD_SKIP_KEYS.size) return { ok: false, error: 'Too many skipped keys' };
      for (const [sk, sv] of skipEntries) {
        if (!WIZARD_SKIP_KEYS.has(sk)) return { ok: false, error: `Unknown skipped key: ${sk}` };
        if (typeof sv !== 'boolean') return { ok: false, error: 'skipped values must be boolean' };
      }
      result[k] = v;
      continue;
    }
    if (typeof v === 'number') {
      if (!isFinite(v)) return { ok: false, error: 'wizardProfile number must be finite' };
    } else if (typeof v === 'string') {
      if (v.length > 20) return { ok: false, error: 'wizardProfile string too long' };
    } else if (typeof v !== 'boolean') {
      return { ok: false, error: 'wizardProfile values must be number, string, or boolean' };
    }
    result[k] = v;
  }
  return { ok: true, value: result };
}

router.get('/preferences', async (req: Request, res: Response): Promise<void> => {
  const userId = authenticateToken(req, res);
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const result = await getPool().query(
    'SELECT filter_presets, quality_weights, wizard_profile, updated_at FROM user_preferences WHERE user_id = $1',
    [userId]
  );
  if (result.rows.length === 0) {
    res.json({ filterPresets: [], qualityWeights: {}, wizardProfile: {}, updatedAt: null });
    return;
  }
  // IN-6: surface the row's last-write time so the client can resolve diverged
  // quality-weights / wizard-profile conflicts by last-write-wins. (The row carries
  // a single timestamp covering presets + weights + profile.)
  res.json({
    filterPresets: result.rows[0].filter_presets ?? [],
    qualityWeights: result.rows[0].quality_weights ?? {},
    wizardProfile: result.rows[0].wizard_profile ?? {},
    updatedAt: result.rows[0].updated_at ?? null,
  });
});

router.put('/preferences', async (req: Request, res: Response): Promise<void> => {
  const userId = authenticateToken(req, res);
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const { filterPresets, qualityWeights, wizardProfile } = req.body ?? {};

  // Allow partial updates: only validate fields that were sent.
  let presetsJson: string | null = null;
  if (filterPresets !== undefined) {
    const v = validateFilterPresets(filterPresets);
    if (!v.ok) { res.status(400).json({ error: v.error }); return; }
    presetsJson = JSON.stringify(v.value);
  }
  let weightsJson: string | null = null;
  if (qualityWeights !== undefined) {
    const v = validateQualityWeights(qualityWeights);
    if (!v.ok) { res.status(400).json({ error: v.error }); return; }
    weightsJson = JSON.stringify(v.value);
  }
  // IN-3: wizardProfile is now a first-class preference. Before this, a
  // wizardProfile-only PUT (what useWizardProfile sends) failed the
  // "provide at least one" check below with a 400 — a guaranteed retry loop
  // for every signed-in user who touched the wizard.
  let wizardJson: string | null = null;
  if (wizardProfile !== undefined) {
    const v = validateWizardProfile(wizardProfile);
    if (!v.ok) { res.status(400).json({ error: v.error }); return; }
    wizardJson = JSON.stringify(v.value);
  }

  if (presetsJson === null && weightsJson === null && wizardJson === null) {
    res.status(400).json({ error: 'Provide filterPresets, qualityWeights, or wizardProfile' });
    return;
  }

  // COALESCE keeps unspecified fields at their existing values.
  await getPool().query(
    `INSERT INTO user_preferences (user_id, filter_presets, quality_weights, wizard_profile, updated_at)
     VALUES ($1, COALESCE($2::jsonb, '[]'::jsonb), COALESCE($3::jsonb, '{}'::jsonb), COALESCE($4::jsonb, '{}'::jsonb), NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       filter_presets = COALESCE($2::jsonb, user_preferences.filter_presets),
       quality_weights = COALESCE($3::jsonb, user_preferences.quality_weights),
       wizard_profile = COALESCE($4::jsonb, user_preferences.wizard_profile),
       updated_at = NOW()`,
    [userId, presetsJson, weightsJson, wizardJson]
  );

  const result = await getPool().query(
    'SELECT filter_presets, quality_weights, wizard_profile FROM user_preferences WHERE user_id = $1',
    [userId]
  );
  res.json({
    filterPresets: result.rows[0]?.filter_presets ?? [],
    qualityWeights: result.rows[0]?.quality_weights ?? {},
    wizardProfile: result.rows[0]?.wizard_profile ?? {},
  });
});

export default router;
