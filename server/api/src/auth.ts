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

  if (!username || !password) {
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

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Invalid email format' });
    return;
  }

  // Verify Turnstile (skipped in dev when no secret is configured)
  const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.ip;
  const turnstileOk = await verifyTurnstile(turnstileToken || '', ip);
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
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login: 10 per IP per 15 minutes
router.post('/login', rateLimit(10, 15 * 60 * 1000, 'login'), async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
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

export default router;
