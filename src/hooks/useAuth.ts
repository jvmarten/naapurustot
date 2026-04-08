import { useState, useEffect, useCallback } from 'react';
import { api, type ApiUser } from '../utils/api';

interface AuthState {
  user: ApiUser | null;
  loading: boolean;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });

  useEffect(() => {
    api.me().then(({ data }) => {
      setState({ user: data?.user ?? null, loading: false });
    });
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<string | null> => {
    const { data, error } = await api.login(username, password);
    if (data?.user) {
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
      setState({ user: data.user, loading: false });
      return null;
    }
    return error ?? 'Signup failed';
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setState({ user: null, loading: false });
  }, []);

  return { user: state.user, loading: state.loading, login, signup, logout };
}
