import React, { useCallback, useEffect, useRef } from 'react';

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
const loadCallbacks: (() => void)[] = [];

function ensureScript(): Promise<void> {
  if (scriptLoaded) return Promise.resolve();
  return new Promise((resolve) => {
    loadCallbacks.push(resolve);
    if (scriptLoading) return;
    scriptLoading = true;
    window.onTurnstileLoad = () => {
      scriptLoaded = true;
      for (const cb of loadCallbacks) cb();
      loadCallbacks.length = 0;
    };
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad';
    s.async = true;
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
  useEffect(() => { onTokenRef.current = onToken; });

  const callbackRef = useCallback((container: HTMLDivElement | null) => {
    cleanupWidget();
    if (!container || !SITE_KEY) return;

    ensureScript().then(() => {
      if (!window.turnstile) return;
      activeWidgetId = window.turnstile.render(container, {
        sitekey: SITE_KEY,
        callback: (token: string) => onTokenRef.current(token),
        theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
        size: 'flexible',
      });
    });
  }, []);

  if (!SITE_KEY) return null;

  return <div ref={callbackRef} className="flex justify-center" />;
};
