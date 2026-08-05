import React, { useState } from 'react';
import { FEED_GROUPS, type Feed } from './feeds';
import { t } from '../utils/i18n';

/**
 * The /live/ feed switchboard.
 *
 * Rendered entirely from FEED_GROUPS — no feed is named in this file — so a new
 * realtime source appears here by editing the registry and the locale files.
 *
 * Two things it refuses to do quietly:
 *  - a `planned` feed renders as a disabled row with an explicit badge, so the
 *    list can show where the page is heading without a dead toggle implying that
 *    data is already there;
 *  - an `urban` feed says so on the row, because a national map that silently
 *    draws only Helsinki is the exact failure this project keeps legislating
 *    against.
 */

interface FeedSidebarProps {
  enabled: Set<string>;
  onToggle: (feedId: string) => void;
  onSetAll: (on: boolean) => void;
  onClose: () => void;
}

/** A single row's switch. Colour comes from the group, so groups read as families. */
const Toggle: React.FC<{ on: boolean; accent: string; disabled: boolean }> = ({ on, accent, disabled }) => (
  <span
    aria-hidden="true"
    className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${
      disabled ? 'opacity-40' : ''
    } ${on ? '' : 'bg-surface-300 dark:bg-surface-600'}`}
    style={on ? { backgroundColor: accent } : undefined}
  >
    <span
      className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform"
      style={{ transform: on ? 'translateX(1.125rem)' : 'translateX(0.125rem)' }}
    />
  </span>
);

export const FeedSidebar: React.FC<FeedSidebarProps> = ({ enabled, onToggle, onSetAll, onClose }) => {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleGroup = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rowLabel = (feed: Feed) => (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-sm text-surface-800 dark:text-surface-100">{t(feed.labelKey)}</span>
      {feed.coverage === 'urban' && (
        <span className="text-[10px] uppercase tracking-wide text-surface-500 dark:text-surface-400">
          {t('live.coverage.urban')}
        </span>
      )}
    </span>
  );

  return (
    <aside
      className="flex h-full w-64 shrink-0 flex-col border-r border-surface-200 bg-surface-50 text-surface-900 dark:border-surface-800 dark:bg-surface-950/95 dark:text-surface-100"
      aria-label={t('live.filters.title')}
    >
      <div className="flex items-center gap-2 px-4 py-3">
        <h2 className="mr-auto text-base font-semibold">{t('live.filters.title')}</h2>
        <button
          type="button"
          onClick={() => onSetAll(true)}
          className="text-xs text-brand-600 hover:underline dark:text-brand-400"
        >
          {t('live.filters.all')}
        </button>
        <span className="text-surface-600" aria-hidden="true">|</span>
        <button
          type="button"
          onClick={() => onSetAll(false)}
          className="text-xs text-surface-500 hover:underline dark:text-surface-400"
        >
          {t('live.filters.clear')}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('live.filters.close')}
          className="ml-1 text-surface-500 hover:text-surface-900 dark:text-surface-400 dark:hover:text-white"
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {FEED_GROUPS.map((group) => {
          const isCollapsed = collapsed.has(group.id);
          const liveCount = group.feeds.filter((f) => f.status === 'live').length;
          const onCount = group.feeds.filter((f) => enabled.has(f.id)).length;
          return (
            <section key={group.id} className="mb-1">
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                aria-expanded={!isCollapsed}
                className="flex w-full items-center gap-2 px-4 py-2 text-left"
              >
                <span
                  className="text-[10px] transition-transform"
                  style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'none' }}
                  aria-hidden="true"
                >
                  ▼
                </span>
                <span
                  className="mr-auto text-xs font-bold uppercase tracking-wider"
                  style={{ color: group.accent }}
                >
                  {t(group.labelKey)}
                </span>
                <span className="text-[11px] text-surface-400 dark:text-surface-500">
                  {onCount}/{liveCount}
                </span>
              </button>

              {!isCollapsed && (
                <ul>
                  {group.feeds.map((feed) => {
                    const disabled = feed.status !== 'live';
                    const on = enabled.has(feed.id);
                    return (
                      <li key={feed.id}>
                        <button
                          type="button"
                          disabled={disabled}
                          aria-pressed={on}
                          onClick={() => onToggle(feed.id)}
                          className={`flex w-full items-center gap-3 px-4 py-1.5 text-left ${
                            disabled ? 'cursor-not-allowed' : 'hover:bg-surface-100 dark:hover:bg-surface-900'
                          }`}
                        >
                          <Toggle on={on} accent={group.accent} disabled={disabled} />
                          {rowLabel(feed)}
                          {disabled && (
                            <span className="ml-auto shrink-0 rounded bg-surface-200 px-1.5 py-0.5 text-[10px] text-surface-600 dark:bg-surface-800 dark:text-surface-400">
                              {t('live.status.planned')}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
};
