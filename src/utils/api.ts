/**
 * API client for the optional naapurustot backend (auth + favorites sync).
 *
 * All requests use credentials: 'include' for cross-origin cookie-based JWT auth.
 * Server error messages are mapped to i18n keys for localized display.
 * When the server is unreachable, errors are returned as ApiResponse.error strings.
 */

import { t } from './i18n';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.naapurustot.fi';

/** User profile returned by the auth API. */
export interface ApiUser {
  id: string;
  username: string;
  email: string | null;
  displayName: string | null;
  /** Trust level for future moderation features (0 = default). */
  trustLevel: number;
  createdAt: string;
  /** Supporter (paid) tier. Server-derived from the Stripe subscription status —
   *  the client never asserts it. Optional so older responses/mocks stay valid. */
  supporter?: boolean;
  /** ISO end of the current paid period, for display ("renews …"). Null when not a supporter. */
  supporterUntil?: string | null;
}

interface ApiResponse<T> {
  data?: T;
  error?: string;
  status?: number;
}

/** Map known server error messages to i18n keys for localised display. */
const SERVER_ERROR_KEYS: Record<string, string> = {
  'Username and password are required': 'auth.error.fields_required',
  'Username must be 3-20 characters (letters, numbers, _ or -)': 'auth.error.invalid_username',
  'Password must be at least 12 characters': 'auth.error.password_too_short',
  'Invalid email format': 'auth.error.invalid_email',
  'Bot verification failed. Please try again.': 'auth.error.bot_check_failed',
  'Username already taken': 'auth.error.username_taken',
  'Email already registered': 'auth.error.email_taken',
  'Invalid username or password': 'auth.error.invalid_credentials',
  'Too many requests. Please try again later.': 'auth.error.rate_limited',
  'Internal server error': 'auth.error.server_error',
  'Payload too large': 'auth.error.too_large',
  'Invalid or expired reset link': 'auth.error.reset_link_invalid',
  'Current password is required': 'auth.error.password_required',
  'Incorrect password': 'auth.error.password_incorrect',
  'New password must be different from the current one': 'auth.error.password_unchanged',
  'Billing not configured': 'supporter.error.unavailable',
  'Could not start checkout': 'supporter.error.checkout_failed',
  'Could not open billing portal': 'supporter.error.portal_failed',
  'No subscription': 'supporter.error.no_subscription',
};

function localiseError(message: string): string {
  const key = SERVER_ERROR_KEYS[message];
  return key ? t(key) : message;
}

async function request<T>(path: string, options?: RequestInit): Promise<ApiResponse<T>> {
  let res: Response;
  try {
    const { headers: extraHeaders, ...rest } = options ?? {};
    res = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      ...rest,
      headers: { 'Content-Type': 'application/json', ...extraHeaders as Record<string, string> },
    });
  } catch {
    return { error: t('auth.error.network') };
  }

  try {
    const body = await res.json();
    if (!res.ok) {
      return { error: localiseError(body.error || `${res.status}`), status: res.status };
    }
    return { data: body };
  } catch {
    // Server returned a non-JSON response (e.g. HTML error page from reverse proxy)
    return { error: t('auth.error.server_error') };
  }
}

/**
 * REST client for the backend. Every method resolves to `{ data }` on success or
 * `{ error }` (a localised message) on failure — it never rejects, so callers
 * branch on `res.error` rather than wrapping calls in try/catch.
 */
type PreferencesPayload = {
  filterPresets: unknown[];
  qualityWeights: Record<string, number>;
  wizardProfile?: unknown;
  // IN-6: server's last-write time for the preferences row (presets + weights +
  // profile share one timestamp), used for last-write-wins conflict resolution.
  updatedAt?: string | null;
};

// CF-7: single-flight cache for GET /auth/preferences. The three preferences-backed
// hooks (quality weights, filter presets, wizard profile) each fire this on the same
// login transition — without deduping, that's three identical requests. The promise is
// shared only while in flight and cleared the moment it settles, so a later login (or a
// post-save refetch) always pulls fresh server state. Mirrors loadAllData's cache shape.
let preferencesInFlight: Promise<ApiResponse<PreferencesPayload>> | null = null;

export const api = {
  signup: (username: string, password: string, turnstileToken: string, email?: string, displayName?: string) =>
    request<{ user: ApiUser }>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ username, password, turnstileToken, email, displayName }),
    }),

  login: (username: string, password: string) =>
    request<{ user: ApiUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  logout: () =>
    request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),

  me: () =>
    request<{ user: ApiUser }>('/auth/me'),

  // Request a reset link. The server deliberately answers 200 for every address —
  // known, unknown or malformed — so callers must NOT try to infer whether the
  // account exists, and the UI must show the same confirmation either way.
  forgotPassword: (email: string, lang: string) =>
    request<{ ok: boolean }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email, lang }),
    }),

  // Redeem a token from the emailed link. On success the server does NOT sign the
  // user in — proving mailbox control isn't proving knowledge of the account — so
  // the caller sends them to the login form with the password they just set.
  resetPassword: (token: string, password: string) =>
    request<{ ok: boolean }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),

  // Set, change or (with email: null) clear the account's address. Requires the
  // current password: the email is the reset channel, so a stolen session must not
  // be enough to redirect it.
  updateEmail: (email: string | null, password: string) =>
    request<{ user: ApiUser }>('/auth/email', {
      method: 'PATCH',
      body: JSON.stringify({ email, password }),
    }),

  // Rotate the password from a signed-in session. The server revokes every OTHER
  // session and hands back a replacement cookie for this one, so the caller stays
  // logged in — unlike resetPassword, which deliberately issues nothing.
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ user: ApiUser }>('/auth/password', {
      method: 'PATCH',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  getFavorites: () =>
    request<{ favorites: string[]; updatedAt?: string | null }>('/auth/favorites'),

  saveFavorites: (favorites: string[]) =>
    request<{ favorites: string[] }>('/auth/favorites', {
      method: 'PUT',
      body: JSON.stringify({ favorites }),
    }),

  // QW-2b: shortlist cloud sync (mirrors favorites).
  getShortlist: () =>
    request<{ shortlist: string[]; updatedAt?: string | null }>('/auth/shortlist'),

  saveShortlist: (shortlist: string[]) =>
    request<{ shortlist: string[] }>('/auth/shortlist', {
      method: 'PUT',
      body: JSON.stringify({ shortlist }),
    }),

  getNotes: () =>
    request<{ notes: Record<string, string>; updatedAt?: string | null }>('/auth/notes'),

  saveNotes: (notes: Record<string, string>) =>
    request<{ notes: Record<string, string> }>('/auth/notes', {
      method: 'PUT',
      body: JSON.stringify({ notes }),
    }),

  getPreferences: (): Promise<ApiResponse<PreferencesPayload>> => {
    if (preferencesInFlight) return preferencesInFlight;
    const p = request<PreferencesPayload>('/auth/preferences');
    preferencesInFlight = p;
    void p.finally(() => {
      if (preferencesInFlight === p) preferencesInFlight = null;
    });
    return p;
  },

  // CF-4 / IN-3: wizardProfile is an opaque blob (validated client-side by
  // sanitizeWizardAnswers, and server-side by validateWizardProfile) carried alongside
  // the preset/weights preferences sync. The server now stores it in the
  // user_preferences.wizard_profile column and returns it from GET/PUT (added via the
  // db.ts migration runner), so a wizardProfile-only PUT persists and cross-syncs.
  savePreferences: (data: { filterPresets?: unknown[]; qualityWeights?: Record<string, number>; wizardProfile?: unknown }) =>
    request<{ filterPresets: unknown[]; qualityWeights: Record<string, number>; wizardProfile?: unknown }>('/auth/preferences', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  // CF-13 (GDPR): download the full stored record as JSON.
  exportData: () =>
    request<Record<string, unknown>>('/auth/export'),

  // CF-13 (GDPR): permanently delete the account (cascades to all user data).
  // Requires the literal "DELETE" confirmation the server validates.
  deleteAccount: () =>
    request<{ ok: boolean }>('/auth/account', {
      method: 'DELETE',
      body: JSON.stringify({ confirm: 'DELETE' }),
    }),

  // Supporter subscription (Stripe). Both return a URL to redirect the browser to —
  // Stripe-hosted Checkout for a new subscription, or the customer portal to manage an
  // existing one. Card data and SCA never touch this static site.
  startCheckout: () =>
    request<{ url: string }>('/auth/billing/checkout', { method: 'POST', body: JSON.stringify({}) }),

  openBillingPortal: () =>
    request<{ url: string }>('/auth/billing/portal', { method: 'POST', body: JSON.stringify({}) }),
};
