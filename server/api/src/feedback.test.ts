import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { parseFeedback, MAX_MESSAGE_LENGTH } from './feedback.js';
import { renderFeedbackEmail } from './mailer.js';

process.env.NODE_ENV = 'test';
const ORIGIN = 'https://naapurustot.fi';
const ORIGINAL_KEY = process.env.RESEND_API_KEY;
afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = ORIGINAL_KEY;
});

test('parseFeedback requires a message and caps its length', () => {
  assert.equal(parseFeedback({}).ok, false);
  assert.equal(parseFeedback({ message: '   ' }).ok, false);
  assert.equal(parseFeedback({ message: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) }).ok, false);
  const ok = parseFeedback({ message: '  Great map  ', lang: 'en' });
  assert.ok(ok.ok);
  assert.deepEqual(ok.ok && ok.feedback, { message: 'Great map', email: null, page: null, lang: 'en' });
});

test('parseFeedback validates an optional reply address', () => {
  assert.equal(parseFeedback({ message: 'hi', email: 'not-an-address' }).ok, false);
  const ok = parseFeedback({ message: 'hi', email: ' Someone@Example.com ' });
  assert.equal(ok.ok && ok.feedback.email, 'someone@example.com');
  assert.equal(parseFeedback({ message: 'hi', email: '' }).ok, true, 'blank means no address');
});

test("parseFeedback keeps only the site's own pages", () => {
  const page = (p: unknown) => { const r = parseFeedback({ message: 'hi', page: p }); return r.ok ? r.feedback.page : 'ERR'; };
  assert.equal(page('https://naapurustot.fi/?city=lahti&layer=employment_rate'), 'https://naapurustot.fi/?city=lahti&layer=employment_rate');
  assert.equal(page('https://www.naapurustot.fi/fi/alue/00100/'), 'https://www.naapurustot.fi/fi/alue/00100/');
  assert.equal(page('https://evil.example/phish'), null);
  assert.equal(page('http://localhost:5173/'), null);
  assert.equal(page('javascript:alert(1)'), null);
  assert.equal(page('not a url'), null);
  assert.equal(page(42), null);
});

test('renderFeedbackEmail escapes visitor text and keeps the subject to one line', () => {
  const { subject, html, text } = renderFeedbackEmail({
    message: 'Hello <script>x</script>\r\nBcc: someone@example.com',
    email: 'a@b.fi',
    page: 'https://naapurustot.fi/?a=1&b=2',
    lang: 'fi',
  });
  assert.ok(!/[\r\n]/.test(subject));
  assert.ok(!subject.includes('Bcc'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('a=1&amp;b=2'));
  assert.ok(text.includes('a@b.fi'));
});

test('POST /feedback: 400 on a bad body, 403 cross-origin, 503 when mail is not configured', async () => {
  delete process.env.RESEND_API_KEY;
  process.env.JWT_SECRET ??= 'test-jwt-secret-for-feedback';
  const { createApp } = await import('./app.js');
  const app = createApp();

  const bad = await request(app).post('/feedback').set('Origin', ORIGIN).send({ message: '' });
  assert.equal(bad.status, 400);

  const cross = await request(app).post('/feedback').set('Origin', 'https://evil.example').send({ message: 'hi' });
  assert.equal(cross.status, 403);

  // No Turnstile secret outside production passes verification; no Resend key means
  // the message cannot go anywhere, which must not be reported as sent.
  const off = await request(app).post('/feedback').set('Origin', ORIGIN).send({ message: 'hi' });
  assert.equal(off.status, 503);
});
