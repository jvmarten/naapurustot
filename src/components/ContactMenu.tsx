import React, { useEffect, useRef, useState } from 'react';
import { t, useI18nVersion } from '../utils/i18n';

const CONTACT_EMAIL = 'info@naapurustot.fi';

interface ContactMenuProps {
  /** Classes applied to the trigger so it visually matches the surrounding footer link. */
  className?: string;
}

/**
 * Footer "Contact" control. Replaces a bare `mailto:` link — which hijacks the
 * click straight into an external mail client — with a small popover that reveals
 * the address and offers copy-to-clipboard. The address sits in the DOM as
 * selectable text, so it still works where the clipboard API is unavailable
 * (insecure contexts, denied permission). Closes on outside-click or Escape.
 */
export const ContactMenu: React.FC<ContactMenuProps> = ({ className }) => {
  useI18nVersion();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL);
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — the address is still visible as selectable text.
    }
  };

  return (
    <span className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`cursor-pointer bg-transparent border-0 p-0 m-0 align-baseline [font:inherit] [color:inherit] ${className ?? ''}`}
      >
        {t('footer.contact')}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t('footer.contact')}
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-max max-w-[80vw]
                     rounded-xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700/40
                     shadow-2xl px-3 py-2.5 text-left"
        >
          <div className="text-[11px] font-medium text-surface-500 dark:text-surface-400 mb-1">
            {t('contact.email_label')}
          </div>
          <div className="flex items-center gap-2">
            <span className="select-all text-xs font-semibold text-surface-800 dark:text-surface-100">
              {CONTACT_EMAIL}
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="shrink-0 rounded-md border border-surface-200 dark:border-surface-700/40 px-1.5 py-0.5
                         text-[11px] text-surface-600 dark:text-surface-300
                         hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
            >
              {copied ? t('contact.copied') : t('contact.copy')}
            </button>
          </div>
        </div>
      )}
    </span>
  );
};

export default ContactMenu;
