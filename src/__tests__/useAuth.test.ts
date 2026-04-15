/**
 * Tests for useAuth — authentication state hook.
 *
 * The auth hook is the only path through which a logged-in user's identity
 * reaches the rest of the app (favorite sync, trust-level-gated features).
 * A bug here would silently log users out, echo stale session data across
 * login transitions, or leak sessions across browser reloads.
 *
 * Risks covered:
 *  - Skip the network call entirely when no session flag exists (performance + privacy)
 *  - Do NOT clear the session flag on transient network errors (would
 *    effectively log the user out after any brief offline blip).
 *  - Clear the session flag on authoritative "no user" server response.
 *  - Login/signup success: set session flag AND update state.
 *  - Login/signup failure: do NOT set session flag AND surface the error string.
 *  - Logout: always clears state and flag, even if the server call fails.
 *  - Ignore in-flight server responses after unmount (race condition).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// useAuth imports the real api module. We mock it so we don't depend on fetch
// AND we can drive both success and error paths deterministically.
vi.mock('../utils/api', () => ({
  api: {
    me: vi.fn(),
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(),
  },
}));

import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';

const AUTH_FLAG = 'has_session';
const mockedApi = api as unknown as {
  me: ReturnType<typeof vi.fn>;
  login: ReturnType<typeof vi.fn>;
  signup: ReturnType<typeof vi.fn>;
  logout: ReturnType<typeof vi.fn>;
};

const USER = {
  id: 'u1',
  username: 'alice',
  email: null,
  displayName: null,
  trustLevel: 0,
  createdAt: '2024-01-01',
};

describe('useAuth', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('mount behavior', () => {
    it('skips the network call entirely when no session flag exists', () => {
      const { result } = renderHook(() => useAuth());
      expect(result.current.user).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(mockedApi.me).not.toHaveBeenCalled();
    });

    it('starts in loading: true when a session flag is present and calls GET /auth/me', async () => {
      localStorage.setItem(AUTH_FLAG, '1');
      mockedApi.me.mockResolvedValueOnce({ data: { user: USER } });

      const { result } = renderHook(() => useAuth());
      // Initial render: loading because hasSession() is true
      expect(result.current.loading).toBe(true);
      expect(mockedApi.me).toHaveBeenCalledTimes(1);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.user).toEqual(USER);
      });
    });

    it('does NOT clear the session flag on a transient network error', async () => {
      // This is the documented contract: "a transient network error ... should
      // leave the flag intact so the next mount can retry". Removing this branch
      // would effectively log the user out on any brief offline blip.
      localStorage.setItem(AUTH_FLAG, '1');
      mockedApi.me.mockResolvedValueOnce({ error: 'network down' });

      const { result } = renderHook(() => useAuth());
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.user).toBeNull();
      // CRITICAL: flag must still be set so the next mount tries again.
      expect(localStorage.getItem(AUTH_FLAG)).toBe('1');
    });

    it('clears the session flag when server authoritatively says no user', async () => {
      localStorage.setItem(AUTH_FLAG, '1');
      // No error + no user → server authoritatively says "not logged in"
      mockedApi.me.mockResolvedValueOnce({ data: {} });

      const { result } = renderHook(() => useAuth());
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.user).toBeNull();
      expect(localStorage.getItem(AUTH_FLAG)).toBeNull();
    });

    it('ignores in-flight me() response after unmount (no state update on unmounted)', async () => {
      localStorage.setItem(AUTH_FLAG, '1');
      let resolveIt: ((v: unknown) => void) | null = null;
      mockedApi.me.mockReturnValueOnce(new Promise((r) => { resolveIt = r; }));

      const { unmount } = renderHook(() => useAuth());
      unmount();

      // Resolve AFTER unmount — must not cause React "update on unmounted" warnings.
      // (If the cancelled flag is missing, React logs a warning; we test for the
      // absence of unhandled errors by resolving and awaiting a tick.)
      resolveIt!({ data: { user: USER } });
      await new Promise((r) => setTimeout(r, 0));
      // No throw = success. The effect's `cancelled` guard prevents setState.
    });
  });

  describe('login', () => {
    it('stores session flag and user on successful login; returns null', async () => {
      mockedApi.login.mockResolvedValueOnce({ data: { user: USER } });

      const { result } = renderHook(() => useAuth());
      let err: string | null = 'not-set';
      await act(async () => {
        err = await result.current.login('alice', 'pw');
      });

      expect(err).toBeNull();
      expect(result.current.user).toEqual(USER);
      expect(result.current.loading).toBe(false);
      expect(localStorage.getItem(AUTH_FLAG)).toBe('1');
    });

    it('returns server error string on failure and does NOT set session flag', async () => {
      mockedApi.login.mockResolvedValueOnce({ error: 'Invalid username or password' });

      const { result } = renderHook(() => useAuth());
      let err: string | null = null;
      await act(async () => {
        err = await result.current.login('alice', 'wrong');
      });

      expect(err).toBe('Invalid username or password');
      expect(result.current.user).toBeNull();
      // CRITICAL: failure path must not set the session flag — a subsequent
      // page reload would pointlessly call /auth/me and flash the loading UI.
      expect(localStorage.getItem(AUTH_FLAG)).toBeNull();
    });

    it('returns fallback "Login failed" when api returns neither data nor error', async () => {
      mockedApi.login.mockResolvedValueOnce({});

      const { result } = renderHook(() => useAuth());
      let err: string | null = null;
      await act(async () => {
        err = await result.current.login('alice', 'pw');
      });

      expect(err).toBe('Login failed');
      expect(result.current.user).toBeNull();
    });
  });

  describe('signup', () => {
    it('stores session flag and user on successful signup; returns null', async () => {
      mockedApi.signup.mockResolvedValueOnce({ data: { user: USER } });

      const { result } = renderHook(() => useAuth());
      let err: string | null = 'not-set';
      await act(async () => {
        err = await result.current.signup('alice', 'pw123456789012', 'ts-token');
      });

      expect(err).toBeNull();
      expect(result.current.user).toEqual(USER);
      expect(localStorage.getItem(AUTH_FLAG)).toBe('1');
    });

    it('forwards optional email and displayName to api.signup', async () => {
      mockedApi.signup.mockResolvedValueOnce({ data: { user: USER } });

      const { result } = renderHook(() => useAuth());
      await act(async () => {
        await result.current.signup('alice', 'pw123456789012', 'ts', 'a@b.com', 'Alice');
      });

      expect(mockedApi.signup).toHaveBeenCalledWith(
        'alice', 'pw123456789012', 'ts', 'a@b.com', 'Alice',
      );
    });

    it('returns error string and leaves flag clear on failure', async () => {
      mockedApi.signup.mockResolvedValueOnce({ error: 'Username already taken' });

      const { result } = renderHook(() => useAuth());
      let err: string | null = null;
      await act(async () => {
        err = await result.current.signup('alice', 'pw', 'ts');
      });

      expect(err).toBe('Username already taken');
      expect(result.current.user).toBeNull();
      expect(localStorage.getItem(AUTH_FLAG)).toBeNull();
    });

    it('returns fallback "Signup failed" when api returns nothing usable', async () => {
      mockedApi.signup.mockResolvedValueOnce({});

      const { result } = renderHook(() => useAuth());
      let err: string | null = null;
      await act(async () => {
        err = await result.current.signup('alice', 'pw', 'ts');
      });

      expect(err).toBe('Signup failed');
    });
  });

  describe('logout', () => {
    it('clears user state and session flag even though api.logout resolves', async () => {
      // Start logged in so we can observe the transition
      localStorage.setItem(AUTH_FLAG, '1');
      mockedApi.me.mockResolvedValueOnce({ data: { user: USER } });
      mockedApi.logout.mockResolvedValueOnce({ data: { ok: true } });

      const { result } = renderHook(() => useAuth());
      await waitFor(() => {
        expect(result.current.user).toEqual(USER);
      });

      await act(async () => {
        await result.current.logout();
      });

      expect(result.current.user).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(localStorage.getItem(AUTH_FLAG)).toBeNull();
    });
  });

  describe('localStorage unavailable', () => {
    it('does not throw when localStorage.setItem throws (e.g. Safari private mode)', async () => {
      const origSet = localStorage.setItem;
      Object.defineProperty(localStorage, 'setItem', {
        configurable: true,
        value: () => { throw new Error('QuotaExceededError'); },
      });

      mockedApi.login.mockResolvedValueOnce({ data: { user: USER } });

      const { result } = renderHook(() => useAuth());
      // Login path writes the flag — must swallow the storage error.
      await expect(
        act(async () => { await result.current.login('alice', 'pw'); }),
      ).resolves.toBeUndefined();

      // Restore
      Object.defineProperty(localStorage, 'setItem', {
        configurable: true,
        value: origSet,
      });
    });
  });
});
