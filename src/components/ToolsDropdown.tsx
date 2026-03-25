import React, { useState, useRef, useEffect } from 'react';
import { t, type Lang } from '../utils/i18n';

interface ToolsDropdownProps {
  showFilter: boolean;
  showRanking: boolean;
  onToggleFilter: () => void;
  onToggleRanking: () => void;
  onOpenWizard: () => void;
  onPrint?: () => void;
  wizardHighlightActive?: boolean;
  onClearWizardHighlight?: () => void;
  splitMode?: boolean;
  onToggleSplitMode?: () => void;
  drawMode?: boolean;
  hasPolygon?: boolean;
  onToggleDraw?: () => void;
  onClearDraw?: () => void;
  selectMode?: boolean;
  onToggleSelectMode?: () => void;
  /** Pass current language to trigger re-render on language change */
  lang?: Lang;
}

export const ToolsDropdown: React.FC<ToolsDropdownProps> = React.memo(({
  showFilter,
  showRanking,
  onToggleFilter,
  onToggleRanking,
  onOpenWizard,
  onPrint,
  wizardHighlightActive,
  onClearWizardHighlight,
  splitMode,
  onToggleSplitMode,
  drawMode,
  hasPolygon,
  onToggleDraw,
  onClearDraw,
  selectMode,
  onToggleSelectMode,
  lang: _lang,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const anyActive = showFilter || showRanking || drawMode || selectMode;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex px-2.5 py-2 rounded-lg text-xs font-semibold transition-all items-center justify-center
                   min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0
                   ${open || anyActive
                     ? 'bg-brand-500/20 text-brand-600 dark:text-brand-300 border border-brand-500/30'
                     : 'text-surface-600 dark:text-white/70 hover:text-surface-900 dark:hover:text-white hover:bg-surface-100 dark:hover:bg-white/10 border border-transparent'
                   }`}
        aria-label={t('tools.title')}
        title={t('tools.title')}
      >
        {/* Wrench icon */}
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 w-56 rounded-xl bg-white dark:bg-surface-900
                       border border-surface-200 dark:border-surface-700/40 shadow-2xl backdrop-blur-md
                       py-1 z-50">
          {/* Neighborhood Wizard */}
          <button
            onClick={() => { onOpenWizard(); setOpen(false); }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-surface-700 dark:text-surface-200
                       hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <span>{t('wizard.open')}</span>
          </button>

          {/* CF-6: Draw area */}
          {onToggleDraw && (
            <button
              onClick={() => { onToggleDraw(); setOpen(false); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-surface-700 dark:text-surface-200
                         hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-1a1 1 0 01-1-1v-4zM5 10v4a1 1 0 001 1h4M15 14v-4a1 1 0 00-1-1h-4" />
              </svg>
              <span>{t('draw.toggle')}</span>
              {drawMode && (
                <svg className="w-4 h-4 ml-auto text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          )}

          {/* Select areas (tap neighborhoods) */}
          {onToggleSelectMode && (
            <button
              onClick={() => { onToggleSelectMode(); setOpen(false); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-surface-700 dark:text-surface-200
                         hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
              </svg>
              <span>{t('draw.select_areas')}</span>
              {selectMode && (
                <svg className="w-4 h-4 ml-auto text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          )}

          {/* Clear drawn/selected area */}
          {hasPolygon && onClearDraw && (
            <button
              onClick={() => { onClearDraw(); setOpen(false); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-rose-500 dark:text-rose-400
                         hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              <span>{t('draw.clear')}</span>
            </button>
          )}

          {/* Clear wizard highlights */}
          {wizardHighlightActive && onClearWizardHighlight && (
            <button
              onClick={() => { onClearWizardHighlight(); setOpen(false); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-amber-600 dark:text-amber-400
                         hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              <span>{t('wizard.clear_highlights')}</span>
            </button>
          )}

          {/* Filter */}
          <button
            onClick={() => { onToggleFilter(); setOpen(false); }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-surface-700 dark:text-surface-200
                       hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            <span>{t('filter.toggle')}</span>
            {showFilter && (
              <svg className="w-4 h-4 ml-auto text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>

          {/* Ranking */}
          <button
            onClick={() => { onToggleRanking(); setOpen(false); }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-surface-700 dark:text-surface-200
                       hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9M3 12h5m4 0l4-4m0 0l4 4m-4-4v12" />
            </svg>
            <span>{t('ranking.toggle')}</span>
            {showRanking && (
              <svg className="w-4 h-4 ml-auto text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>

          {/* QW-4: Compare layers (split map) */}
          {onToggleSplitMode && (
            <button
              onClick={() => { onToggleSplitMode(); setOpen(false); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-surface-700 dark:text-surface-200
                         hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
              </svg>
              <span>{t('tools.compare_layers')}</span>
              {splitMode && (
                <svg className="w-4 h-4 ml-auto text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          )}

          {/* Divider */}
          <div className="border-t border-surface-200 dark:border-surface-700/40 my-1" />

          {/* Print / Screenshot */}
          <button
            onClick={() => {
              setOpen(false);
              if (onPrint) onPrint();
              else window.print();
            }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-surface-700 dark:text-surface-200
                       hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            <span>{t('tools.print')}</span>
          </button>
        </div>
      )}
    </div>
  );
});
