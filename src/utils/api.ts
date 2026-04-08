const API_BASE = import.meta.env.VITE_API_URL || 'https://api.naapurustot.fi';

export interface ApiUser {
  id: string;
  email: string;
  name: string | null;
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
  signup: (email: string, password: string, name?: string) =>
    request<{ user: ApiUser }>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    }),

  login: (email: string, password: string) =>
    request<{ user: ApiUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  logout: () =>
    request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),

  me: () =>
    request<{ user: ApiUser }>('/auth/me'),
};
