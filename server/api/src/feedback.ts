/**
 * Visitor feedback: POST /feedback → one email to the site's own inbox.
 *
 * Nothing is stored. The message goes out through the same Resend path as the
 * password-reset mail (mailer.ts), so the only new trust boundary is the request
 * body, validated here by `parseFeedback` (pure, unit-tested). Spam is held off by
 * Turnstile (fail-closed in production, like signup) and a per-IP limit; the
 * router is mounted behind the same-origin guard in app.ts.
 */
import { Router, Request, Response } from 'express';
import { rateLimit } from './rateLimit.js';
import { verifyTurnstile } from './turnstile.js';
import { sendFeedbackEmail, type Feedback } from './mailer.js';
import { normalizeLang, validateEmail, normalizeEmail } from './passwordReset.js';

export const MAX_MESSAGE_LENGTH = 4000;
const MAX_PAGE_LENGTH = 2000;
/** Only the app's own pages are attached — the link lands in an inbox where it will
 *  be clicked. */
const PAGE_ORIGINS = ['https://naapurustot.fi', 'https://www.naapurustot.fi'];

/** Validate a request body into a Feedback, or name what is wrong with it. */
export function parseFeedback(body: unknown): { ok: true; feedback: Feedback } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const message = typeof b.message === 'string' ? b.message.trim() : '';
  if (!message) return { ok: false, error: 'Message is required' };
  if (message.length > MAX_MESSAGE_LENGTH) return { ok: false, error: 'Message is too long' };

  let email: string | null = null;
  if (typeof b.email === 'string' && b.email.trim()) {
    const check = validateEmail(b.email.trim());
    if (!check.ok) return { ok: false, error: check.error };
    email = normalizeEmail(b.email.trim());
  }

  // Any other page (a dev server, a clone, a crafted link) is dropped, not refused:
  // the message itself is still worth delivering.
  let page: string | null = null;
  if (typeof b.page === 'string' && b.page.length <= MAX_PAGE_LENGTH) {
    try {
      const url = new URL(b.page);
      if (PAGE_ORIGINS.includes(url.origin)) page = url.href;
    } catch { /* not a URL: no page */ }
  }

  return { ok: true, feedback: { message, email, page, lang: normalizeLang(b.lang) } };
}

const router = Router();

router.post('/', rateLimit(5, 60 * 60 * 1000, 'feedback'), async (req: Request, res: Response): Promise<void> => {
  const parsed = parseFeedback(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const token = typeof req.body?.turnstileToken === 'string' ? req.body.turnstileToken : '';
  if (!(await verifyTurnstile(token, req.ip))) {
    res.status(403).json({ error: 'Bot verification failed. Please try again.' });
    return;
  }

  const sent = await sendFeedbackEmail(parsed.feedback);
  if (!sent.ok) {
    // `disabled` (no RESEND_API_KEY) is a deploy that cannot deliver: say so rather
    // than report success for a message that went nowhere.
    console.error('feedback: send failed:', sent.error);
    res.status(503).json({ error: 'Feedback is unavailable right now' });
    return;
  }
  res.json({ ok: true });
});

export default router;
