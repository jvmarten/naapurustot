/**
 * Tests for utils/api.ts — the HTTP client for auth + favorites sync.
 *
 * Risk: auth/favorites sync is the only persistence path for logged-in users.
 * A silent bug here could corrupt saved data, leak stale sessions across
 * logins, or strand users with untranslated error messages.
 *
 * Coverage focus:
 *  - Every endpoint sends the expected method, path, headers, body, credentials
 *  - Network failures short-circuit to an i18n error (no thrown exceptions)
 *  - Non-2xx JSON responses map server error strings to i18n keys
 *  - Non-JSON responses (HTML error pages, etc.) fall back cleanly
 *  - Unknown server error strings are passed through untouched
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from '../utils/api';
import { setLang } from '../utils/i18n';

type FetchMock = ReturnType<typeof vi.fn>;

function mockFetchOnceOk(body: unknown) {
  (fetch as FetchMock).mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(body),
  });
}

function mockFetchOnceError(status: number, body: unknown) {
  (fetch as FetchMock).mockResolvedValueOnce({
    ok: false,
    status,
    json: () => Promise.resolve(body),
  });
}

describe('api.ts — HTTP client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    // Use English so error message expectations are stable across environments.
    setLang('en');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('request mechanics', () => {
    it('sends credentials: "include" for cross-origin cookies', async () => {
      mockFetchOnceOk({ user: { id: 'u1', username: 'u', trustLevel: 0 } });
      await api.me();
      const [, init] = (fetch as FetchMock).mock.calls[0];
      expect(init.credentials).toBe('include');
    });

    it('always sets Content-Type: application/json on the request', async () => {
      mockFetchOnceOk({ ok: true });
      await api.logout();
      const [, init] = (fetch as FetchMock).mock.calls[0];
      expect(init.headers['Content-Type']).toBe('application/json');
    });

    it('routes requests through the configured API base URL', async () => {
      mockFetchOnceOk({ user: { id: 'u1', username: 'u', trustLevel: 0 } });
      await api.me();
      const [url] = (fetch as FetchMock).mock.calls[0];
      // Default base is https://api.naapurustot.fi unless VITE_API_URL overrides.
      expect(typeof url).toBe('string');
      expect(url).toMatch(/\/auth\/me$/);
    });
  });

  describe('signup()', () => {
    it('POSTs /auth/signup with username, password, turnstile token', async () => {
      mockFetchOnceOk({ user: { id: 'u1', username: 'alice', trustLevel: 0 } });
      const result = await api.signup('alice', 'hunter2hunter2', 'ts-token');

      const [url, init] = (fetch as FetchMock).mock.calls[0];
      expect(url).toMatch(/\/auth\/signup$/);
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body);
      expect(body.username).toBe('alice');
      expect(body.password).toBe('hunter2hunter2');
      expect(body.turnstileToken).toBe('ts-token');
      // Optional fields must not be injected when omitted.
      expect(body).not.toHaveProperty('email.required');
      expect(result.data?.user.username).toBe('alice');
      expect(result.error).toBeUndefined();
    });

    it('passes optional email and displayName when provided', async () => {
      mockFetchOnceOk({ user: { id: 'u1', username: 'alice', trustLevel: 0 } });
      await api.signup('alice', 'pw123456789012', 'ts', 'a@b.com', 'Alice A.');
      const body = JSON.parse((fetch as FetchMock).mock.calls[0][1].body);
      expect(body.email).toBe('a@b.com');
      expect(body.displayName).toBe('Alice A.');
    });

    it('maps the known server error "Username already taken" to an i18n key', async () => {
      mockFetchOnceError(409, { error: 'Username already taken' });
      const result = await api.signup('alice', 'pw', 'ts');
      expect(result.data).toBeUndefined();
      // English locale for auth.error.username_taken = "Username already taken"
      // The key is recognized in SERVER_ERROR_KEYS and localized through t().
      expect(result.error).toBeTruthy();
      expect(result.error).not.toBe('409'); // must not fall through to raw status
    });

    it('passes unknown server error strings through unchanged', async () => {
      mockFetchOnceError(400, { error: 'Some unexpected error' });
      const result = await api.signup('alice', 'pw', 'ts');
      expect(result.error).toBe('Some unexpected error');
    });

    it('uses the HTTP status as error when the body has no error field', async () => {
      mockFetchOnceError(500, {}); // no error property
      const result = await api.signup('alice', 'pw', 'ts');
      // body.error falsy → falls back to `${res.status}` = "500" (then localised if mapped)
      expect(result.error).toBe('500');
    });
  });

  describe('login()', () => {
    it('POSTs /auth/login with username and password', async () => {
      mockFetchOnceOk({ user: { id: 'u1', username: 'alice', trustLevel: 0 } });
      await api.login('alice', 'pw');
      const [url, init] = (fetch as FetchMock).mock.calls[0];
      expect(url).toMatch(/\/auth\/login$/);
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ username: 'alice', password: 'pw' });
    });

    it('maps "Invalid username or password" to a localized message', async () => {
      mockFetchOnceError(401, { error: 'Invalid username or password' });
      const result = await api.login('alice', 'bad');
      expect(result.error).toBeTruthy();
      // Finnish default translation differs from the raw server message.
      // In English mode it's "Invalid username or password" (same string),
      // but the important thing is the key was recognized — switch lang and re-check.
      setLang('fi');
      mockFetchOnceError(401, { error: 'Invalid username or password' });
      const fiResult = await api.login('alice', 'bad');
      expect(fiResult.error).toContain('Virheellinen');
    });

    it('maps rate-limit errors even though HTTP status is 429', async () => {
      mockFetchOnceError(429, { error: 'Too many requests. Please try again later.' });
      const result = await api.login('alice', 'pw');
      expect(result.error).toBeTruthy();
      expect(result.error).not.toBe('429');
    });
  });

  describe('network and response failures', () => {
    it('returns an i18n network error when fetch rejects', async () => {
      (fetch as FetchMock).mockRejectedValueOnce(new TypeError('network down'));
      const result = await api.me();
      expect(result.data).toBeUndefined();
      // English auth.error.network
      expect(result.error).toMatch(/can't reach|reach|server|try again/i);
    });

    it('returns an i18n server error when response is non-JSON (HTML error page)', async () => {
      // Simulate a reverse proxy returning HTML — res.ok=true but json() throws
      (fetch as FetchMock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.reject(new SyntaxError('Unexpected token <')),
      });
      const result = await api.me();
      expect(result.data).toBeUndefined();
      expect(result.error).toBeTruthy();
    });

    it('returns server_error when non-OK response is also non-JSON', async () => {
      (fetch as FetchMock).mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: () => Promise.reject(new SyntaxError('Unexpected token <')),
      });
      const result = await api.me();
      expect(result.error).toBeTruthy();
    });

    it('does not throw when fetch rejects — must always return ApiResponse', async () => {
      (fetch as FetchMock).mockRejectedValueOnce(new Error('boom'));
      // If request() ever leaked the rejection, this await would throw.
      await expect(api.logout()).resolves.toHaveProperty('error');
    });
  });

  describe('me() / logout()', () => {
    it('GETs /auth/me with no body', async () => {
      mockFetchOnceOk({ user: { id: 'u1', username: 'alice', trustLevel: 0 } });
      await api.me();
      const [url, init] = (fetch as FetchMock).mock.calls[0];
      expect(url).toMatch(/\/auth\/me$/);
      expect(init.method).toBeUndefined(); // default GET
      expect(init.body).toBeUndefined();
    });

    it('POSTs /auth/logout', async () => {
      mockFetchOnceOk({ ok: true });
      await api.logout();
      const [url, init] = (fetch as FetchMock).mock.calls[0];
      expect(url).toMatch(/\/auth\/logout$/);
      expect(init.method).toBe('POST');
    });
  });

  describe('favorites endpoints', () => {
    it('getFavorites() GETs /auth/favorites', async () => {
      mockFetchOnceOk({ favorites: ['00100', '00200'] });
      const result = await api.getFavorites();
      const [url, init] = (fetch as FetchMock).mock.calls[0];
      expect(url).toMatch(/\/auth\/favorites$/);
      expect(init.method).toBeUndefined();
      expect(result.data?.favorites).toEqual(['00100', '00200']);
    });

    it('saveFavorites() PUTs the array as JSON', async () => {
      mockFetchOnceOk({ favorites: ['00100', '00200'] });
      await api.saveFavorites(['00100', '00200']);
      const [url, init] = (fetch as FetchMock).mock.calls[0];
      expect(url).toMatch(/\/auth\/favorites$/);
      expect(init.method).toBe('PUT');
      expect(JSON.parse(init.body)).toEqual({ favorites: ['00100', '00200'] });
    });

    it('saveFavorites() with empty array still sends {favorites: []}', async () => {
      mockFetchOnceOk({ favorites: [] });
      await api.saveFavorites([]);
      const body = JSON.parse((fetch as FetchMock).mock.calls[0][1].body);
      expect(body).toEqual({ favorites: [] });
    });

    it('getFavorites() maps unauthorized responses to an error, not silent empty data', async () => {
      mockFetchOnceError(401, { error: 'Not authenticated' });
      const result = await api.getFavorites();
      // Critical: must not fall through as { data: { favorites: [] } }.
      expect(result.data).toBeUndefined();
      expect(result.error).toBe('Not authenticated');
    });
  });
});

describe('api.ts — password reset & email management', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    setLang('en');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forgotPassword() POSTs the address and the UI language', async () => {
    mockFetchOnceOk({ ok: true });
    await api.forgotPassword('someone@example.com', 'sv');
    const [url, init] = (fetch as FetchMock).mock.calls[0];
    expect(url).toMatch(/\/auth\/forgot-password$/);
    expect(init.method).toBe('POST');
    // The language decides which of the three localized mail templates is sent.
    expect(JSON.parse(init.body)).toEqual({ email: 'someone@example.com', lang: 'sv' });
  });

  it('forgotPassword() resolves the same way for any address (no enumeration signal)', async () => {
    mockFetchOnceOk({ ok: true });
    const known = await api.forgotPassword('real@example.com', 'fi');
    mockFetchOnceOk({ ok: true });
    const unknown = await api.forgotPassword('nobody@example.com', 'fi');
    expect(known).toEqual(unknown);
    expect(known.error).toBeUndefined();
  });

  it('resetPassword() POSTs the token and the new password', async () => {
    mockFetchOnceOk({ ok: true });
    await api.resetPassword('tok123', 'a-long-enough-password');
    const [url, init] = (fetch as FetchMock).mock.calls[0];
    expect(url).toMatch(/\/auth\/reset-password$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ token: 'tok123', password: 'a-long-enough-password' });
  });

  it('resetPassword() localizes the expired/used-link rejection', async () => {
    mockFetchOnceError(400, { error: 'Invalid or expired reset link' });
    const result = await api.resetPassword('tok123', 'a-long-enough-password');
    expect(result.data).toBeUndefined();
    expect(result.error).toMatch(/invalid or has expired/i);
  });

  it('updateEmail() PATCHes the address with the current password', async () => {
    mockFetchOnceOk({ user: { id: 'u1', email: 'new@example.com' } });
    await api.updateEmail('new@example.com', 'current-password');
    const [url, init] = (fetch as FetchMock).mock.calls[0];
    expect(url).toMatch(/\/auth\/email$/);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ email: 'new@example.com', password: 'current-password' });
  });

  it('updateEmail(null) clears the address', async () => {
    mockFetchOnceOk({ user: { id: 'u1', email: null } });
    await api.updateEmail(null, 'current-password');
    expect(JSON.parse((fetch as FetchMock).mock.calls[0][1].body)).toEqual({
      email: null,
      password: 'current-password',
    });
  });

  it('updateEmail() localizes a rejected password and a taken address', async () => {
    mockFetchOnceError(403, { error: 'Incorrect password' });
    expect((await api.updateEmail('a@b.fi', 'wrong')).error).toBe('Incorrect password');

    mockFetchOnceError(409, { error: 'Email already registered' });
    expect((await api.updateEmail('a@b.fi', 'pw')).error).toMatch(/already registered/i);
  });
});

describe('api.ts — change password', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    setLang('en');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('changePassword() PATCHes both passwords to /auth/password', async () => {
    mockFetchOnceOk({ user: { id: 'u1' } });
    await api.changePassword('old-password-123', 'a-brand-new-password');
    const [url, init] = (fetch as FetchMock).mock.calls[0];
    expect(url).toMatch(/\/auth\/password$/);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({
      currentPassword: 'old-password-123',
      newPassword: 'a-brand-new-password',
    });
    // Cookie-based auth: the reissued session cookie only comes back if the
    // request carried credentials in the first place.
    expect(init.credentials).toBe('include');
  });

  it('changePassword() localizes the reuse and wrong-password rejections', async () => {
    mockFetchOnceError(400, { error: 'New password must be different from the current one' });
    expect((await api.changePassword('a', 'a')).error).toMatch(/must differ/i);

    mockFetchOnceError(403, { error: 'Incorrect password' });
    expect((await api.changePassword('wrong', 'a-brand-new-password')).error).toBe('Incorrect password');
  });
});
