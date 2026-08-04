/**
 * Transactional email via the Resend REST API.
 *
 * Deliberately dependency-free — Node 22 has global `fetch`, so this adds nothing
 * to the audit surface (`npm run audit:check`) and nothing to the image.
 *
 * Two rules this module exists to enforce:
 *
 *  1. **Nothing is read at module load.** `turnstile.ts` once threw while being
 *     evaluated and put the whole API into a crash-loop (issue #45). Every value
 *     here is read inside the send call, so a missing/blank `RESEND_API_KEY`
 *     degrades to "mail disabled", never to a dead container.
 *  2. **Nothing throws.** Callers get `{ ok }`. A Resend outage must not turn a
 *     password-reset request into a 500 (which would also leak, via the status
 *     code, that the address matched an account).
 *
 * The sending domain (naapurustot.fi) is already DKIM-verified in Resend with an
 * EU (eu-west-1) return path, so mail authenticates against the apex domain and
 * passes DMARC via DKIM. Inbound mail is unrelated — Cloudflare Email Routing
 * forwards info@naapurustot.fi — hence the Reply-To below.
 */
import type { MailLang } from './passwordReset.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 10_000;

/** Address replies land on: Cloudflare Email Routing forwards it to a real inbox. */
const REPLY_TO = 'info@naapurustot.fi';

export interface MailResult {
  ok: boolean;
  /** Set when the send did not happen. `disabled` = no API key configured. */
  error?: string;
  disabled?: boolean;
}

/** True when an API key is configured. Lets callers log "mail disabled" once at
 *  startup instead of silently dropping every message. */
export function isMailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

function fromAddress(): string {
  // Display name + address. Falls back to the verified apex domain so a missing
  // MAIL_FROM cannot produce an unverified sender (which Resend would reject).
  const addr = process.env.MAIL_FROM || 'noreply@naapurustot.fi';
  return `naapurustot.fi <${addr}>`;
}

interface Copy {
  subject: string;
  heading: string;
  intro: string;
  button: string;
  fallback: string;
  expiry: string;
  ignore: string;
}

const RESET_COPY: Record<MailLang, Copy> = {
  fi: {
    subject: 'Salasanan palautus – naapurustot.fi',
    heading: 'Palauta salasanasi',
    intro: 'Saimme pyynnön palauttaa tunnuksesi salasanan. Aseta uusi salasana alta.',
    button: 'Aseta uusi salasana',
    fallback: 'Jos painike ei toimi, kopioi tämä osoite selaimeesi:',
    expiry: 'Linkki on voimassa yhden tunnin ja toimii vain kerran.',
    ignore: 'Jos et pyytänyt salasanan palautusta, voit jättää tämän viestin huomiotta — salasanasi ei muutu.',
  },
  en: {
    subject: 'Password reset – naapurustot.fi',
    heading: 'Reset your password',
    intro: 'We received a request to reset the password for your account. Set a new one below.',
    button: 'Set a new password',
    fallback: "If the button doesn't work, copy this address into your browser:",
    expiry: 'The link is valid for one hour and can only be used once.',
    ignore: "If you didn't request a password reset, you can ignore this message — your password will not change.",
  },
  sv: {
    subject: 'Återställning av lösenord – naapurustot.fi',
    heading: 'Återställ ditt lösenord',
    intro: 'Vi fick en begäran om att återställa lösenordet för ditt konto. Ange ett nytt nedan.',
    button: 'Ange ett nytt lösenord',
    fallback: 'Om knappen inte fungerar, kopiera den här adressen till din webbläsare:',
    expiry: 'Länken är giltig i en timme och kan endast användas en gång.',
    ignore: 'Om du inte begärde en återställning kan du ignorera det här meddelandet — ditt lösenord ändras inte.',
  },
};

/** Escape for interpolation into the HTML body. The URL and username are the only
 *  interpolated values, but both are attacker-influenced (a username is chosen at
 *  signup), so neither goes in raw. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Render the reset email. Exported so a test can assert the link appears in both
 *  the HTML and the plain-text part without performing a network call. */
export function renderResetEmail(resetUrl: string, username: string, lang: MailLang): {
  subject: string;
  html: string;
  text: string;
} {
  const c = RESET_COPY[lang];
  const url = escapeHtml(resetUrl);
  const name = escapeHtml(username);

  const html = `<!doctype html>
<html lang="${lang}">
  <body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2933">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
      <p style="margin:0 0 24px;font-size:15px;font-weight:600;color:#3b5bdb">naapurustot.fi</p>
      <h1 style="margin:0 0 16px;font-size:21px;line-height:1.3">${escapeHtml(c.heading)}</h1>
      <p style="margin:0 0 8px;font-size:15px;line-height:1.6">${escapeHtml(c.intro)}</p>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#5c6773">${name}</p>
      <p style="margin:0 0 24px">
        <a href="${url}" style="display:inline-block;background:#3b5bdb;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600">${escapeHtml(c.button)}</a>
      </p>
      <p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:#5c6773">${escapeHtml(c.fallback)}</p>
      <p style="margin:0 0 24px;font-size:13px;line-height:1.6;word-break:break-all"><a href="${url}" style="color:#3b5bdb">${url}</a></p>
      <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#5c6773">${escapeHtml(c.expiry)}</p>
      <p style="margin:0;font-size:13px;line-height:1.6;color:#5c6773">${escapeHtml(c.ignore)}</p>
    </div>
  </body>
</html>`;

  const text = [
    c.heading,
    '',
    c.intro,
    username,
    '',
    resetUrl,
    '',
    c.expiry,
    c.ignore,
    '',
    'naapurustot.fi',
  ].join('\n');

  return { subject: c.subject, html, text };
}

/**
 * Send the password-reset email. Resolves `{ ok: false, disabled: true }` when no
 * API key is configured (dev, tests, and any deploy that hasn't set the secret),
 * which callers treat as a no-op rather than an error.
 */
export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string,
  username: string,
  lang: MailLang,
): Promise<MailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, disabled: true, error: 'mail not configured' };

  const { subject, html, text } = renderResetEmail(resetUrl, username, lang);

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [to],
        reply_to: REPLY_TO,
        subject,
        html,
        text,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!res.ok) {
      // Read the body for the log only — it can name the recipient, so it must
      // never reach the HTTP response.
      const detail = await res.text().catch(() => '');
      return { ok: false, error: `resend ${res.status}: ${detail.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'send failed' };
  }
}
