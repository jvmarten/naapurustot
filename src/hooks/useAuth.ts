import { useState, useEffect, useCallback } from 'react';
import { api, type ApiUser } from '../utils/api';

const AUTH_FLAG = 'has_session';

function hasSession(): boolean {
  try { return localStorage.getItem(AUTH_FLAG) === '1'; } catch { return false; }
}

function setSessionFlag(active: boolean): void {
  try {
    if (active) localStorage.setItem(AUTH_FLAG, '1');
    else localStorage.removeItem(AUTH_FLAG);
  } catch { /* localStorage unavailable */ }
}

interface AuthState {
  user: ApiUser | null;
  loading: boolean;
}

/**
 * Manages authentication state via the optional backend API.
 *
 * Uses a localStorage flag (`has_session`) to avoid a network call on mount
 * when the user has never logged in. On mount with a flag, calls GET /auth/me
 * to restore the session from the httpOnly JWT cookie.
 *
 * Returns `{ user, loading, login, signup, logout }`.
 * - `login` / `signup` return null on success or an error string on failure.
 * - Auth is fully optional — when the server is unreachable, the app works normally.
 */
export function useAuth() {
  // If no session flag, skip the network call entirely — user never logged in
  const [state, setState] = useState<AuthState>({ user: null, loading: hasSession() });

  useEffect(() => {
    if (!hasSession()) return;
    api.me().then(({ data }) => {
      if (!data?.user) setSessionFlag(false);
      setState({ user: data?.user ?? null, loading: false });
    });
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<string | null> => {
    const { data, error } = await api.login(username, password);
    if (data?.user) {
      setSessionFlag(true);
      setState({ user: data.user, loading: false });
      return null;
    }
    return error ?? 'Login failed';
  }, []);

  const signup = useCallback(async (
    username: string,
    password: string,
    turnstileToken: string,
    email?: string,
    displayName?: string,
  ): Promise<string | null> => {
    const { data, error } = await api.signup(username, password, turnstileToken, email, displayName);
    if (data?.user) {
      setSessionFlag(true);
      setState({ user: data.user, loading: false });
      return null;
    }
    return error ?? 'Signup failed';
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setSessionFlag(false);
    setState({ user: null, loading: false });
  }, []);

  return { user: state.user, loading: state.loading, login, signup, logout };
}
