import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAuth } from '../hooks/useAuth';

const sampleUser = { id: 'u1', username: 'a', email: null, displayName: null, trustLevel: 0, createdAt: 'x' };
const meMock = vi.fn(() => Promise.resolve({ data: { user: sampleUser } }));

vi.mock('../utils/api', () => ({
  api: {
    me: () => meMock(),
    logout: () => Promise.resolve({ data: { ok: true } }),
    login: vi.fn(),
    signup: vi.fn(),
    exportData: vi.fn(),
    deleteAccount: vi.fn(),
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
