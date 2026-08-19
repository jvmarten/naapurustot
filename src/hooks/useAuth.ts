import { useState, useEffect, useCallback } from 'react';
import { api, type ApiUser } from '../utils/api';
import { t } from '../utils/i18n';

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
    let cancelled = false;
    api.me().then(({ data, error, status }) => {
      if (cancelled) return;
      // Clear the session flag when the server authoritatively says the user
      // is not authenticated: either a successful response with no user, or a
      // 401 (expired token, deleted user). Transient network errors (no status)
      // leave the flag intact so the next mount can retry.
      if ((!error && !data?.user) || status === 401) setSessionFlag(false);
      setState({ user: data?.user ?? null, loading: false });
    });
    return () => { cancelled = true; };
  }, []);

  // CF-6: cross-tab auth sync. Without this, logging out in one tab leaves other tabs
  // believing they're authenticated — they keep PUTing with a now-cleared cookie into
  // the 401 path. Mirror the `has_session` flag the same way the six data hooks do:
  // when it's removed in another tab, drop the user here; when it appears (a login),
  // restore the session via /auth/me.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== AUTH_FLAG) return;
      if (e.newValue === '1') {
        api.me().then(({ data }) => setState({ user: data?.user ?? null, loading: false }));
      } else {
        setState({ user: null, loading: false });
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<string | null> => {
    const { data, error } = await api.login(username, password);
    if (data?.user) {
      setSessionFlag(true);
      setState({ user: data.user, loading: false });
      return null;
    }
    return error ?? t('auth.error.server_error'); // ER-6: localized, not raw English
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
    return error ?? t('auth.error.server_error'); // ER-6: localized, not raw English
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setSessionFlag(false);
    setState({ user: null, loading: false });
  }, []);

  // Re-pull the authoritative user from GET /auth/me. Used after returning from Stripe
  // Checkout, where the entitlement is written by an async webhook and may land a
  // moment after the redirect back — a couple of refreshes catch it up.
  const refresh = useCallback(async () => {
    if (!hasSession()) return;
    const { data } = await api.me();
    if (data?.user) setState({ user: data.user, loading: false });
  }, []);

  // CF-13 (GDPR): fetch the full stored record. Returns the payload on success
  // or an error string on failure; never mutates auth state.
  const exportData = useCallback(async (): Promise<{ data?: Record<string, unknown>; error?: string }> => {
    const { data, error } = await api.exportData();
    return { data, error: error ?? undefined };
  }, []);

  // CF-13 (GDPR): permanently delete the account. On success the server clears
  // the cookie; we mirror logout by clearing the local session. Returns null on
  // success or an error string on failure.
  const deleteAccount = useCallback(async (): Promise<string | null> => {
    const { data, error } = await api.deleteAccount();
    if (data?.ok) {
      setSessionFlag(false);
      setState({ user: null, loading: false });
      return null;
    }
    return error ?? t('auth.error.server_error'); // ER-6: localized, not raw English
  }, []);

  // Set, change or clear the account email — the address a password-reset link is
  // sent to. Requires the current password (the server re-checks it), so a stolen
  // session can't quietly repoint the recovery channel. Returns null on success or
  // an error string, matching login/signup.
  const updateEmail = useCallback(async (email: string | null, password: string): Promise<string | null> => {
    const { data, error } = await api.updateEmail(email, password);
    if (data?.user) {
      setState({ user: data.user, loading: false });
      return null;
    }
    return error ?? t('auth.error.server_error');
  }, []);

  // Rotate the password from a signed-in session. The server bumps token_version
  // (killing every other session) and returns a replacement cookie for this one,
  // so no local auth state needs clearing — we just adopt the returned user.
  const changePassword = useCallback(async (currentPassword: string, newPassword: string): Promise<string | null> => {
    const { data, error } = await api.changePassword(currentPassword, newPassword);
    if (data?.user) {
      setState({ user: data.user, loading: false });
      return null;
    }
    return error ?? t('auth.error.server_error');
  }, []);

  return { user: state.user, loading: state.loading, login, signup, logout, exportData, deleteAccount, updateEmail, changePassword, refresh };
}
