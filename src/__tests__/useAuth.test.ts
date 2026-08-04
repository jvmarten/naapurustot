import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAuth } from '../hooks/useAuth';

const sampleUser = { id: 'u1', username: 'a', email: null, displayName: null, trustLevel: 0, createdAt: 'x' };
const meMock = vi.fn(() => Promise.resolve({ data: { user: sampleUser } }));
const updateEmailMock = vi.fn();

vi.mock('../utils/api', () => ({
  api: {
    me: () => meMock(),
    logout: () => Promise.resolve({ data: { ok: true } }),
    login: vi.fn(),
    signup: vi.fn(),
    exportData: vi.fn(),
    deleteAccount: vi.fn(),
    updateEmail: (...args: unknown[]) => updateEmailMock(...args),
  },
}));

describe('useAuth — CF-6 cross-tab session sync', () => {
  beforeEach(() => {
    localStorage.clear();
    meMock.mockClear();
  });

  it('restores the session on mount when has_session is set', async () => {
    localStorage.setItem('has_session', '1');
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.user?.username).toBe('a'));
  });

  it('clears the user when has_session is removed in another tab (cross-tab logout)', async () => {
    localStorage.setItem('has_session', '1');
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.user).not.toBeNull());

    act(() => {
      localStorage.removeItem('has_session');
      window.dispatchEvent(new StorageEvent('storage', { key: 'has_session', newValue: null }));
    });
    expect(result.current.user).toBeNull();
  });

  it('restores the session when has_session appears in another tab (cross-tab login)', async () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.user).toBeNull();
    meMock.mockClear();

    act(() => {
      localStorage.setItem('has_session', '1');
      window.dispatchEvent(new StorageEvent('storage', { key: 'has_session', newValue: '1' }));
    });
    await waitFor(() => expect(result.current.user?.username).toBe('a'));
    expect(meMock).toHaveBeenCalled();
  });

  it('ignores storage events for unrelated keys', async () => {
    localStorage.setItem('has_session', '1');
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.user).not.toBeNull());

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'naapurustot-favorites', newValue: null }));
    });
    expect(result.current.user).not.toBeNull();
  });
});

describe('useAuth — recovery email', () => {
  beforeEach(() => {
    localStorage.clear();
    meMock.mockClear();
    updateEmailMock.mockReset();
  });

  it('adopts the updated user so the menu reflects the new address immediately', async () => {
    localStorage.setItem('has_session', '1');
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.user?.email).toBeNull());

    updateEmailMock.mockResolvedValue({ data: { user: { ...sampleUser, email: 'new@example.com' } } });

    let err: string | null = 'unset';
    await act(async () => {
      err = await result.current.updateEmail('new@example.com', 'current-password');
    });

    expect(err).toBeNull();
    expect(updateEmailMock).toHaveBeenCalledWith('new@example.com', 'current-password');
    expect(result.current.user?.email).toBe('new@example.com');
  });

  it('returns the error and leaves the user untouched when the password is rejected', async () => {
    localStorage.setItem('has_session', '1');
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.user).not.toBeNull());

    updateEmailMock.mockResolvedValue({ error: 'Incorrect password' });

    let err: string | null = null;
    await act(async () => {
      err = await result.current.updateEmail('new@example.com', 'wrong');
    });

    expect(err).toBe('Incorrect password');
    expect(result.current.user?.email).toBeNull();
  });
});
