import React, { useEffect, useRef } from 'react';
import { t, useI18nVersion } from '../utils/i18n';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface ShortcutsOverlayProps {
  onClose: () => void;
}

/** Keyboard shortcut → label key. Keys are rendered as <kbd> chips. */
const SHORTCUTS: { keys: string[]; labelKey: string }[] = [
  { keys: ['/'], labelKey: 'shortcuts.focus_search' },
  { keys: ['F'], labelKey: 'shortcuts.filter' },
  { keys: ['R'], labelKey: 'shortcuts.ranking' },
  { keys: ['W'], labelKey: 'shortcuts.wizard' },
  { keys: ['C'], labelKey: 'shortcuts.customize_quality' },
  { keys: ['S'], labelKey: 'shortcuts.split_map' },
  { keys: ['G'], labelKey: 'shortcuts.geolocation' },
  { keys: ['L'], labelKey: 'shortcuts.sign_in' },
  { keys: ['[', ']'], labelKey: 'shortcuts.step_results' },
  { keys: ['?'], labelKey: 'shortcuts.help' },
  { keys: ['Esc'], labelKey: 'shortcuts.escape' },
];

/**
 * QW-2: A modal listing the app's power-user keyboard shortcuts. Toggled with
 * `?` (or from Settings). Doubles as feature discovery for tools that live
 * behind dropdown menus.
 */
export const ShortcutsOverlay: React.FC<ShortcutsOverlayProps> = ({ onClose }) => {
  useI18nVersion();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // PO-3: contain Tab focus within the dialog (it declares aria-modal).
  useFocusTrap(dialogRef);

  // Move focus into the dialog so the close button is the first stop and the
  // dialog is announced. App's global Escape handler closes it.
  useEffect(() => { closeRef.current?.focus(); }, []);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('shortcuts.title')}
        className="w-full max-w-md rounded-2xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700/40 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-100 dark:border-surface-700/40">
          <h2 className="text-sm font-semibold text-surface-900 dark:text-white">{t('shortcuts.title')}</h2>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label={t('aria.close')}
            title={t('aria.close')}
            className="p-1.5 rounded-lg text-surface-400 hover:text-surface-900 dark:hover:text-white hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <ul className="py-2 max-h-[70vh] overflow-y-auto">
          {SHORTCUTS.map((s) => (
            <li key={s.labelKey} className="flex items-center justify-between gap-4 px-5 py-2">
              <span className="text-sm text-surface-700 dark:text-surface-200">{t(s.labelKey)}</span>
              <span className="flex items-center gap-1 flex-shrink-0">
                {s.keys.map((k, i) => (
                  <React.Fragment key={k}>
                    {i > 0 && <span className="text-surface-400 text-xs">/</span>}
                    <kbd className="min-w-[1.5rem] text-center px-1.5 py-0.5 rounded-md text-xs font-semibold
                                   bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-200
                                   border border-surface-200 dark:border-surface-700/50 shadow-sm">
                      {k}
                    </kbd>
                  </React.Fragment>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
