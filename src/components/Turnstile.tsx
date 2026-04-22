import React, { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../utils/i18n';

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      remove: (widgetId: string) => void;
    };
    onTurnstileLoad?: () => void;
  }
}

interface TurnstileProps {
  onToken: (token: string) => void;
}

let scriptLoaded = false;
let scriptLoading = false;
let scriptFailed = false;
const loadCallbacks: ((success: boolean) => void)[] = [];

function ensureScript(): Promise<boolean> {
  if (scriptLoaded) return Promise.resolve(true);
  if (scriptFailed) return Promise.resolve(false);
  return new Promise((resolve) => {
    loadCallbacks.push(resolve);
    if (scriptLoading) return;
    scriptLoading = true;
    window.onTurnstileLoad = () => {
      scriptLoaded = true;
      for (const cb of loadCallbacks) cb(true);
      loadCallbacks.length = 0;
    };
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad';
    s.async = true;
    s.onerror = () => {
      scriptLoading = false;
      scriptFailed = true;
      const cbs = loadCallbacks.splice(0);
      for (const cb of cbs) cb(false);
    };
    document.head.appendChild(s);
  });
}

// Module-scoped widget tracking (only one Turnstile instance at a time)
let activeWidgetId: string | null = null;

function cleanupWidget() {
  if (activeWidgetId && window.turnstile) {
    window.turnstile.remove(activeWidgetId);
    activeWidgetId = null;
  }
}

export const Turnstile: React.FC<TurnstileProps> = ({ onToken }) => {
  const onTokenRef = useRef(onToken);
  useEffect(() => { onTokenRef.current = onToken; }, [onToken]);
  const [error, setError] = useState(false);

  const callbackRef = useCallback((container: HTMLDivElement | null) => {
    cleanupWidget();
    if (!container || !SITE_KEY) return;

    ensureScript().then((success) => {
      if (!success || !window.turnstile) {
        setError(true);
        return;
      }
      if (!container.isConnected) return;
      activeWidgetId = window.turnstile.render(container, {
        sitekey: SITE_KEY,
        callback: (token: string) => onTokenRef.current(token),
        theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
        size: 'flexible',
      });
    });
  }, []);

  if (!SITE_KEY) return null;

  if (error) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400 text-center py-2">
        {t('auth.error.bot_check_failed')}
      </p>
    );
  }

  return <div ref={callbackRef} className="flex justify-center" />;
};
