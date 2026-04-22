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
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Internal server error' });
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

  try {
    const result = await pool.query(
      'SELECT id, username, email, password, display_name, trust_level, created_at FROM users WHERE username = $1',
      [username.toLowerCase()]
    );

    if (result.rows.length === 0) {
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
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
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

  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
    const result = await pool.query(
      'SELECT id, username, email, display_name, trust_level, created_at FROM users WHERE id = $1',
      [payload.userId]
    );

    if (result.rows.length === 0) {
      res.clearCookie('token', { httpOnly: true, secure: true, sameSite: 'none', path: '/' });
      res.status(401).json({ error: 'User not found' });
      return;
    }

    res.json({ user: formatUser(result.rows[0]) });
  } catch {
    res.clearCookie('token', { httpOnly: true, secure: true, sameSite: 'none', path: '/' });
    res.status(401).json({ error: 'Invalid token' });
  }
});

// ── Favorites sync ──

router.get('/favorites', async (req: Request, res: Response): Promise<void> => {
  const userId = authenticateToken(req);
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    const result = await pool.query(
      'SELECT favorites FROM user_favorites WHERE user_id = $1',
      [userId]
    );
    const favorites: string[] = result.rows.length > 0 ? result.rows[0].favorites : [];
    res.json({ favorites });
  } catch (err) {
    console.error('Get favorites error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
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

  try {
    await pool.query(
      `INSERT INTO user_favorites (user_id, favorites, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET favorites = $2, updated_at = NOW()`,
      [userId, JSON.stringify(favorites)]
    );
    res.json({ favorites });
  } catch (err) {
    console.error('Put favorites error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
