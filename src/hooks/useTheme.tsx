import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';

type ThemeMode = 'system' | 'dark' | 'light';
type ResolvedTheme = 'dark' | 'light';

interface ThemeContextValue {
  mode: ThemeMode;
  theme: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'system',
  theme: 'dark',
  setMode: () => {},
});

const STORAGE_KEY = 'naapurustot-theme';

function getStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // localStorage may be unavailable (e.g. private browsing)
  }
  return 'system';
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<ThemeMode>(getStoredMode);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(mode));

  // Listen for system theme changes when in system mode
  useEffect(() => {
    if (mode !== 'system') {
      setResolved(mode);
      return;
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setResolved(e.matches ? 'dark' : 'light');
    setResolved(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mode]);

  // Apply dark class and persist, with smooth transition
  const hasInitialized = React.useRef(false);
  useEffect(() => {
    const root = document.documentElement;

    // Enable transition class only after initial render (skip first paint)
    if (hasInitialized.current) {
      root.classList.add('theme-transition');
    }
    hasInitialized.current = true;

    if (resolved === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    // Remove transition class after animation completes
    const timer = setTimeout(() => {
      root.classList.remove('theme-transition');
    }, 350);

    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // localStorage may be unavailable
    }

    return () => clearTimeout(timer);
  }, [resolved, mode]);

  const setMode = useCallback((m: ThemeMode) => setModeState(m), []);

  // Stable context value — without useMemo, every ThemeProvider render would
  // produce a new object reference, forcing every consumer (Map, SplitMapView,
  // SettingsDropdown, etc.) to re-render even when mode/resolved didn't change.
  const value = useMemo(() => ({ mode, theme: resolved, setMode }), [mode, resolved, setMode]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components -- custom hook co-located with provider
export const useTheme = () => useContext(ThemeContext);
