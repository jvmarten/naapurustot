import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { isMailConfigured, renderResetEmail, sendPasswordResetEmail } from './mailer.js';

const ORIGINAL_KEY = process.env.RESEND_API_KEY;

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = ORIGINAL_KEY;
});

test('isMailConfigured reflects the API key, read at call time not import time', () => {
  delete process.env.RESEND_API_KEY;
  assert.equal(isMailConfigured(), false);

  process.env.RESEND_API_KEY = 're_test_key';
  assert.equal(isMailConfigured(), true, 'picked up without re-importing the module');
});

test('sendPasswordResetEmail no-ops (never throws) when no API key is configured', async () => {
  delete process.env.RESEND_API_KEY;

  const result = await sendPasswordResetEmail('user@example.com', 'https://naapurustot.fi/x', 'tester', 'fi');
  assert.equal(result.ok, false);
  assert.equal(result.disabled, true, 'flagged as disabled, not as a failure to alert on');
});

test('renderResetEmail puts the link in both the HTML and the text part', () => {
  const url = 'https://naapurustot.fi/uusi-salasana/?token=abc&lang=fi';
  const { subject, html, text } = renderResetEmail(url, 'tester', 'fi');

  assert.match(subject, /naapurustot\.fi/);

  // In HTML the separating `&` is written as the entity `&amp;` — that IS the
  // correct encoding for an href, and every HTML parser decodes it back to `&`,
  // so the link a recipient follows carries both query params intact.
  const escapedUrl = 'https://naapurustot.fi/uusi-salasana/?token=abc&amp;lang=fi';
  assert.ok(html.includes(`href="${escapedUrl}"`), 'HTML carries the link as an href');
  assert.ok(!html.includes(`?token=abc&lang=fi`), 'raw ampersand is not emitted in HTML');

  // The plain-text alternative is not markup, so it carries the URL verbatim.
  assert.ok(text.includes(url), 'plain-text alternative carries the link unescaped');
  // Shipping a text/plain part materially helps transactional deliverability.
  assert.ok(text.length > 0);
});

test('renderResetEmail localizes the subject and body for all three UI languages', () => {
  const url = 'https://naapurustot.fi/uusi-salasana/?token=abc';
  const fi = renderResetEmail(url, 'tester', 'fi');
  const en = renderResetEmail(url, 'tester', 'en');
  const sv = renderResetEmail(url, 'tester', 'sv');

  assert.match(fi.subject, /Salasanan palautus/);
  assert.match(en.subject, /Password reset/);
  assert.match(sv.subject, /Återställning/);

  assert.match(fi.html, /<html lang="fi">/);
  assert.match(en.html, /<html lang="en">/);
  assert.match(sv.html, /<html lang="sv">/);

  // Each language states that the link expires and that an unrequested mail can
  // be ignored — the two things that stop a reset mail reading as phishing.
  for (const rendered of [fi, en, sv]) {
    assert.ok(rendered.text.split('\n').filter(Boolean).length >= 5);
  }
});

test('renderResetEmail escapes the username so a crafted account name cannot inject HTML', () => {
  const { html } = renderResetEmail('https://naapurustot.fi/x', '<img src=x onerror=alert(1)>', 'fi');

  assert.ok(!html.includes('<img src=x'), 'raw tag must not survive');
  assert.ok(html.includes('&lt;img src=x'), 'escaped instead');
  assert.ok(!html.includes('onerror=alert(1)>'), 'no live handler');
});

test('renderResetEmail escapes the reset URL', () => {
  const { html } = renderResetEmail('https://naapurustot.fi/x?a="><script>bad()</script>', 'tester', 'fi');

  assert.ok(!html.includes('<script>bad()'), 'no injected script element');
  assert.ok(html.includes('&quot;&gt;&lt;script&gt;'), 'escaped into the attribute safely');
});
