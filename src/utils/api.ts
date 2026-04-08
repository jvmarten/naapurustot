const API_BASE = import.meta.env.VITE_API_URL || 'https://api.naapurustot.fi';

export interface ApiUser {
  id: string;
  username: string;
  email: string | null;
  displayName: string | null;
  trustLevel: number;
  createdAt: string;
}

interface ApiResponse<T> {
  data?: T;
  error?: string;
}

async function request<T>(path: string, options?: RequestInit): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });

    const body = await res.json();

    if (!res.ok) {
      return { error: body.error || `Request failed (${res.status})` };
    }

    return { data: body };
  } catch {
    return { error: 'Network error' };
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
};
