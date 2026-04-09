/**
 * Express API server for naapurustot.fi.
 *
 * Provides user authentication (signup/login/logout) and favorites sync.
 * Runs behind Caddy reverse proxy at api.naapurustot.fi.
 * Database tables are auto-created on startup via initDb().
 */
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authRouter from './auth.js';
import { initDb } from './db.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

const ALLOWED_ORIGINS = [
  'https://naapurustot.fi',
  'https://www.naapurustot.fi',
  'https://jvmarten.github.io',
];

if (process.env.NODE_ENV !== 'production') {
  ALLOWED_ORIGINS.push('http://localhost:5173');
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

app.use(express.json());
app.use(cookieParser());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/auth', authRouter);

async function start(): Promise<void> {
  await initDb();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`API server running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
