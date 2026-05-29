import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from './db.js';
import { rateLimit } from './rateLimit.js';
import { verifyTurnstile } from './turnstile.js';

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

/** Extract and verify JWT from cookie; returns userId or null. */
function authenticateToken(req: Request): string | null {
  const token = req.cookies?.token;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
    return payload.userId;
  } catch {
    return null;
  }
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
  return {
    id: row.id,
    username: row.username,
    email: row.email || null,
    displayName: row.display_name || null,
    trustLevel: row.trust_level,
    createdAt: row.created_at,
  };
}

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

  if (password.length < 12) {
    res.status(400).json({ error: 'Password must be at least 12 characters' });
    return;
  }

  // Cap password length to prevent bcrypt DoS — hashing a multi-MB string
  // can take minutes of CPU time. 1000 chars is far beyond any realistic
  // password while still blocking abuse.
  if (password.length > 1000) {
    res.status(400).json({ error: 'Password must be at most 1000 characters' });
    return;
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Invalid email format' });
    return;
  }

  // Verify Turnstile (skipped in dev when no secret is configured)
  const turnstileOk = await verifyTurnstile(turnstileToken || '', req.ip);
  if (!turnstileOk) {
    res.status(403).json({ error: 'Bot verification failed. Please try again.' });
    return;
  }

  try {
    const existing = await pool.query(
      'SELECT id FROM users WHERE username = $1',
      [username.toLowerCase()]
    );
    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'Username already taken' });
      return;
    }

    if (email) {
      const emailExists = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
      if (emailExists.rows.length > 0) {
        res.status(409).json({ error: 'Email already registered' });
        return;
      }
    }

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await pool.query(
      `INSERT INTO users (username, password, email, display_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, email, display_name, trust_level, created_at`,
      [username.toLowerCase(), hash, email?.toLowerCase() || null, displayName || null]
    );

    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    setTokenCookie(res, token);

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

  // Same bcrypt DoS protection as signup — reject absurdly long passwords
  // before calling bcrypt.compare().
  if (password.length > 1000) {
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }

  const result = await pool.query(
    'SELECT id, username, email, password, display_name, trust_level, created_at FROM users WHERE username = $1',
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

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
  setTokenCookie(res, token);

  res.json({ user: formatUser(user) });
});

router.post('/logout', (_req: Request, res: Response): void => {
  res.clearCookie('token', { httpOnly: true, secure: true, sameSite: 'none', path: '/' });
  res.json({ ok: true });
});

router.get('/me', async (req: Request, res: Response): Promise<void> => {
  const token = req.cookies?.token;
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  let userId: string;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
    userId = payload.userId;
  } catch {
    res.clearCookie('token', { httpOnly: true, secure: true, sameSite: 'none', path: '/' });
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  const result = await pool.query(
    'SELECT id, username, email, display_name, trust_level, created_at FROM users WHERE id = $1',
    [userId]
  );

  if (result.rows.length === 0) {
    res.clearCookie('token', { httpOnly: true, secure: true, sameSite: 'none', path: '/' });
    res.status(401).json({ error: 'User not found' });
    return;
  }

  res.json({ user: formatUser(result.rows[0]) });
});

// ── Favorites sync ──

router.get('/favorites', async (req: Request, res: Response): Promise<void> => {
  const userId = authenticateToken(req);
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const result = await pool.query(
    'SELECT favorites FROM user_favorites WHERE user_id = $1',
    [userId]
  );
  const favorites: string[] = result.rows.length > 0 ? result.rows[0].favorites : [];
  res.json({ favorites });
});

router.put('/favorites', async (req: Request, res: Response): Promise<void> => {
  const userId = authenticateToken(req);
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

  await pool.query(
    `INSERT INTO user_favorites (user_id, favorites, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET favorites = $2, updated_at = NOW()`,
    [userId, JSON.stringify(favorites)]
  );
  res.json({ favorites });
});

// ── Notes sync (QW-6) ──

const PNO_RE = /^\d{5}$/;
const MAX_NOTE_LEN = 5000;
const MAX_NOTES = 500;

router.get('/notes', async (req: Request, res: Response): Promise<void> => {
  const userId = authenticateToken(req);
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const result = await pool.query(
    'SELECT notes FROM user_notes WHERE user_id = $1',
    [userId]
  );
  const notes: Record<string, string> = result.rows.length > 0 ? result.rows[0].notes : {};
  res.json({ notes });
});

router.put('/notes', async (req: Request, res: Response): Promise<void> => {
  const userId = authenticateToken(req);
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

  await pool.query(
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

router.get('/preferences', async (req: Request, res: Response): Promise<void> => {
  const userId = authenticateToken(req);
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const result = await pool.query(
    'SELECT filter_presets, quality_weights FROM user_preferences WHERE user_id = $1',
    [userId]
  );
  if (result.rows.length === 0) {
    res.json({ filterPresets: [], qualityWeights: {} });
    return;
  }
  res.json({
    filterPresets: result.rows[0].filter_presets ?? [],
    qualityWeights: result.rows[0].quality_weights ?? {},
  });
});

router.put('/preferences', async (req: Request, res: Response): Promise<void> => {
  const userId = authenticateToken(req);
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const { filterPresets, qualityWeights } = req.body ?? {};

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

  if (presetsJson === null && weightsJson === null) {
    res.status(400).json({ error: 'Provide filterPresets or qualityWeights' });
    return;
  }

  // COALESCE keeps unspecified fields at their existing values.
  await pool.query(
    `INSERT INTO user_preferences (user_id, filter_presets, quality_weights, updated_at)
     VALUES ($1, COALESCE($2::jsonb, '[]'::jsonb), COALESCE($3::jsonb, '{}'::jsonb), NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       filter_presets = COALESCE($2::jsonb, user_preferences.filter_presets),
       quality_weights = COALESCE($3::jsonb, user_preferences.quality_weights),
       updated_at = NOW()`,
    [userId, presetsJson, weightsJson]
  );

  const result = await pool.query(
    'SELECT filter_presets, quality_weights FROM user_preferences WHERE user_id = $1',
    [userId]
  );
  res.json({
    filterPresets: result.rows[0]?.filter_presets ?? [],
    qualityWeights: result.rows[0]?.quality_weights ?? {},
  });
});

export default router;
