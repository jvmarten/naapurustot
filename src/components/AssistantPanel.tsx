import React, { useState, useRef, useEffect, useCallback } from 'react';
import { t, useI18nVersion, type Lang } from '../utils/i18n';
import { api, type AssistResult } from '../utils/api';
import { buildAssistCatalog, assistCriteriaToFilters } from '../utils/assistCatalog';
import type { FilterCriterion } from '../utils/filterUtils';
import { trackEvent } from '../utils/analytics';

interface AssistantPanelProps {
  lang: Lang;
  /** Apply the proposed filters to the map + open the filter panel. */
  onApply: (filters: FilterCriterion[], title: string) => void;
  onClose: () => void;
}

const MAX_QUERY_LEN = 500;
const EXAMPLE_KEYS = ['assist.example_1', 'assist.example_2', 'assist.example_3'] as const;

/**
 * AS-1: the AI housing assistant. A free-text box that turns "where do I want to
 * live" wishes into map filters. It is a natural-language front door to the
 * existing FilterPanel: on success it hands the proposed FilterCriterion[] up to
 * App, which applies them (setFilters + open the filter panel), so the real
 * matches are highlighted on the map and ranked in the filter list.
 *
 * The assistant never invents a statistic — it only picks which layers to filter
 * on; every figure the user sees is computed from the loaded data. Rendered as a
 * floating card with no dimming backdrop so the map and results stay interactive.
 */
export const AssistantPanel: React.FC<AssistantPanelProps> = ({ lang, onApply, onClose }) => {
  useI18nVersion();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AssistResult | null>(null);
  const [appliedCount, setAppliedCount] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Close on Escape from anywhere in the panel.
  const handleKeyDownCapture = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  }, [onClose]);

  const submit = useCallback(async () => {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    trackEvent('assistant-query');
    const res = await api.assist(q, lang, buildAssistCatalog());
    setLoading(false);
    if (res.error || !res.data) {
      setError(res.error ?? t('auth.error.server_error'));
      return;
    }
    const filters = assistCriteriaToFilters(res.data.criteria);
    setResult(res.data);
    setAppliedCount(filters.length);
    if (filters.length > 0) {
      onApply(filters, res.data.title);
    }
  }, [query, loading, lang, onApply]);

  const handleTextareaKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter submits; Shift+Enter inserts a newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }, [submit]);

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={t('assist.title')}
      onKeyDownCapture={handleKeyDownCapture}
      className="fixed top-20 left-1/2 -translate-x-1/2 z-40 w-[calc(100vw-1.5rem)] max-w-lg
                 rounded-2xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700/50
                 shadow-2xl backdrop-blur-md overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-100 dark:border-surface-800">
        <svg className="w-5 h-5 text-brand-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
        </svg>
        <div className="flex flex-col min-w-0">
          <h2 className="text-sm font-semibold text-surface-900 dark:text-white leading-tight">{t('assist.title')}</h2>
          <p className="text-[11px] text-surface-500 dark:text-surface-400 leading-tight">{t('assist.subtitle')}</p>
        </div>
        <button
          onClick={onClose}
          aria-label={t('assist.close')}
          className="ml-auto p-1.5 rounded-lg text-surface-400 hover:text-surface-700 dark:hover:text-white
                     hover:bg-surface-100 dark:hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="p-4 space-y-3">
        <textarea
          ref={textareaRef}
          value={query}
          onChange={(e) => setQuery(e.target.value.slice(0, MAX_QUERY_LEN))}
          onKeyDown={handleTextareaKeyDown}
          rows={3}
          maxLength={MAX_QUERY_LEN}
          placeholder={t('assist.placeholder')}
          className="w-full resize-none rounded-xl border border-surface-200 dark:border-surface-700
                     bg-surface-50 dark:bg-surface-800 px-3 py-2 text-sm text-surface-900 dark:text-white
                     placeholder:text-surface-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        />

        {/* Example prompts */}
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLE_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => { setQuery(t(k)); textareaRef.current?.focus(); }}
              className="text-[11px] px-2 py-1 rounded-full border border-surface-200 dark:border-surface-700
                         text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-white/10
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {t(k)}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void submit()}
            disabled={loading || query.trim().length === 0}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2
                       text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-600
                       disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {t('assist.loading')}
              </>
            ) : (
              t('assist.submit')
            )}
          </button>
        </div>

        {error && (
          <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
        )}

        {result && (
          <div className="space-y-2 rounded-xl bg-surface-50 dark:bg-surface-800/60 p-3">
            {result.explanation && (
              <p className="text-sm text-surface-800 dark:text-surface-100">{result.explanation}</p>
            )}

            {appliedCount > 0 ? (
              <p className="text-[12px] text-surface-500 dark:text-surface-400">{t('assist.result_applied')}</p>
            ) : (
              <p className="text-[12px] text-surface-500 dark:text-surface-400">{t('assist.result_none')}</p>
            )}

            {result.similarTo && (
              <p className="text-[12px] text-surface-500 dark:text-surface-400">
                {t('assist.similar_note')} <span className="font-medium text-surface-700 dark:text-surface-200">{result.similarTo}</span>
              </p>
            )}

            {result.unmatched.length > 0 && (
              <p className="text-[12px] text-amber-700 dark:text-amber-400">
                {t('assist.unmatched_label')} {result.unmatched.join(', ')}
              </p>
            )}

            {appliedCount > 0 && (
              <button
                onClick={onClose}
                className="mt-1 w-full rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-1.5 text-sm
                           font-medium text-brand-700 dark:text-brand-300 hover:bg-brand-500/20
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {t('assist.view_results')}
              </button>
            )}
          </div>
        )}

        <p className="text-[10px] leading-snug text-surface-400 dark:text-surface-500">{t('assist.disclaimer')}</p>
      </div>
    </div>
  );
};
