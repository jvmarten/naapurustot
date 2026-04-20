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

  getFavorites: () =>
    request<{ favorites: string[] }>('/auth/favorites'),

  saveFavorites: (favorites: string[]) =>
    request<{ favorites: string[] }>('/auth/favorites', {
      method: 'PUT',
      body: JSON.stringify({ favorites }),
    }),
};
