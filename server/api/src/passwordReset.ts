/**
 * Password-reset primitives: token generation/hashing, credential validation and
 * reset-link construction.
 *
 * Kept free of Express and `pg` so every rule here is unit-testable in isolation
 * (see passwordReset.test.ts) — the route handlers in auth.ts are then thin.
 */
import crypto from 'crypto';

/** How long a reset link stays usable. Short enough that a token leaked from an
 *  inbox/proxy log has a narrow window, long enough to survive a slow mail hop. */
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Minimum password length — must stay in sync with signup (auth.ts) and the
 *  client's `minLength={12}` inputs. */
export const MIN_PASSWORD_LENGTH = 12;

/** Upper bound on password length. bcrypt hashing time grows with input size, so
 *  an unbounded password is a CPU-exhaustion vector (same cap as signup/login). */
export const MAX_PASSWORD_LENGTH = 1000;

/** RFC 5321 caps an address at 254 characters. */
export const MAX_EMAIL_LENGTH = 254;

// Bounded by the length check above before it ever runs, so the ambiguous
// `[^\s@]+\.[^\s@]+` alternation cannot backtrack pathologically (ReDoS).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The UI languages the reset email is written in. */
export type MailLang = 'fi' | 'en' | 'sv';

const LANGS: readonly string[] = ['fi', 'en', 'sv'];

/** Coerce arbitrary client input to a supported mail language (Finnish default). */
export function normalizeLang(value: unknown): MailLang {
  return typeof value === 'string' && LANGS.includes(value) ? (value as MailLang) : 'fi';
}

/**
 * Mint a reset token.
 *
 * Returns the raw token (emailed to the user, never stored) and its SHA-256 hash
 * (stored, never emailed). Storing only the hash means a leaked database dump
 * cannot be replayed against the reset endpoint — the same reason the password
 * column holds a bcrypt hash rather than the password.
 *
 * 32 random bytes ≈ 256 bits of entropy, so the token is not guessable and needs
 * no additional rate-limit protection at the verification step (there is one
 * anyway). SHA-256 is the right primitive here rather than bcrypt: the input is
 * already high-entropy, so slow hashing buys nothing and would cost a full KDF
 * run per verification attempt.
 */
export function generateResetToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashResetToken(token) };
}

/** SHA-256 (hex) of a raw reset token — the form stored in password_reset_tokens. */
export function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Shape-check a raw token before it is hashed and looked up.
 *
 * base64url of 32 bytes is always 43 characters from that alphabet. Rejecting
 * anything else keeps junk (and oversized strings) out of the hash + query path.
 */
export function isWellFormedResetToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

/** Validate a new/changed password. Mirrors the signup rules exactly. */
export function validatePassword(password: unknown): ValidationResult {
  if (!password || typeof password !== 'string') {
    return { ok: false, error: 'Password is required' };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at most ${MAX_PASSWORD_LENGTH} characters` };
  }
  return { ok: true };
}

/** Validate an email address. Length is checked before the regex (see EMAIL_RE). */
export function validateEmail(email: unknown): ValidationResult {
  if (typeof email !== 'string' || email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) {
    return { ok: false, error: 'Invalid email format' };
  }
  return { ok: true };
}

/** Lowercase + trim, matching how signup stores addresses (so lookups align). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Build the link that goes in the email.
 *
 * A single path for all three languages, with the UI language as a query param:
 * GitHub Pages serves `dist/uusi-salasana/index.html` for it, and the SPA reads
 * both params client-side. (The 404 fallback in public/404.html redirects unknown
 * paths to `/` and DROPS the path, so the route must be a real prerendered
 * directory — see scripts/prerender.mjs.)
 */
export function buildResetUrl(baseUrl: string, token: string, lang: MailLang): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/uusi-salasana/?token=${encodeURIComponent(token)}&lang=${lang}`;
}

/** Expiry instant for a token minted now. */
export function resetTokenExpiry(now: number = Date.now()): Date {
  return new Date(now + RESET_TOKEN_TTL_MS);
}
