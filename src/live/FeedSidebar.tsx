import React, { useEffect, useState } from 'react';
import { FEED_GROUPS, type Feed } from './feeds';
import { t } from '../utils/i18n';

/**
 * The /live/ feed switchboard.
 *
 * Rendered entirely from FEED_GROUPS — no feed is named in this file — so a new
 * realtime source appears here by editing the registry and the locale files.
 *
 * Three things it refuses to do quietly:
 *  - a `planned` feed renders as a disabled row with an explicit badge, so the
 *    list can show where the page is heading without a dead toggle implying that
 *    data is already there;
 *  - an `urban` feed says so on the row, because a national map that silently
 *    draws only Helsinki is the exact failure this project keeps legislating
 *    against;
 *  - every row states how far the time slider carries it. The bar at the bottom
 *    moves one clock and the whole page answers for it, but the feeds do not
 *    reach equally far — the sun is exact in both directions, FMI serves its
 *    archive, the trains have only what this session watched. That is `time` in
 *    the registry, and it belongs on the row for the same reason `coverage`
 *    does: it is a limit of the data, and the reader finds out either here or
 *    by being misled.
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

  // Escape closes it, which the overlay form makes an obligation rather than a
  // nicety: below `md` this panel covers the map, and the only other way out is
  // a single glyph in its own corner.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

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
      {/* One line, and NOT in caps. Two tags stacked in a wrapping flex row
          turned "cities only" + "any time" into four ragged lines; keeping the
          caps then truncated the half that carries the new information, because
          uppercase plus letter-spacing costs about a third of the width in a
          sidebar this narrow. Sentence case fits both. */}
      <span className="truncate text-[11px] text-surface-500 dark:text-surface-400">
        {feed.coverage === 'urban' && <>{t('live.coverage.urban')} · </>}
        {feed.coverage === 'coastal' && <>{t('live.coverage.coastal')} · </>}
        {t(`live.time_model.${feed.time}`)}
      </span>
    </span>
  );

  return (
    <>
    {/* A scrim, only where the panel floats. Tapping beside a sheet to dismiss
        it is the phone idiom, and without it the single × in the corner is the
        only way back to the map this panel is covering. `md:hidden` because
        above the breakpoint the sidebar is a column that covers nothing. */}
    <button
      type="button"
      aria-label={t('live.filters.close')}
      onClick={onClose}
      className="absolute inset-0 z-10 cursor-default bg-black/30 md:hidden"
    />
    <aside
      // AN OVERLAY BELOW `md`, A COLUMN AT AND ABOVE IT. In flow this is a fixed
      // 256 px column, which on a 390 px phone leaves about 134 px of map — a
      // page about a map, mostly not showing one. Above the breakpoint the
      // column is the right shape and the map has room for both; below it, the
      // switchboard is something you open, use and close, so it sits over the
      // map (`absolute inset-y-0 left-0 z-20`) and gives every pixel back when
      // it closes. `shadow-xl` only where it floats, because a panel that
      // overlaps needs an edge and a panel that abuts does not.
      className="absolute inset-y-0 left-0 z-20 flex h-full w-64 shrink-0 flex-col border-r border-surface-200 bg-surface-50 text-surface-900 shadow-xl md:relative md:z-auto md:shadow-none dark:border-surface-800 dark:bg-surface-950/95 dark:text-surface-100"
      aria-label={t('live.filters.title')}
    >
      {/* The three header controls carry padding rather than sitting at their
          glyph size. The × in particular was about 9 × 19 px of hit area — well
          under WCAG 2.5.8's 24 × 24 minimum — which was survivable while this
          was a desktop column and is not now that it is the dismissal for a
          panel covering a phone's whole map. The row's own padding shrinks to
          compensate, so the header is the same height it was. */}
      <div className="flex items-center gap-1 px-3 py-2">
        <h2 className="mr-auto pl-1 text-base font-semibold">{t('live.filters.title')}</h2>
        <button
          type="button"
          onClick={() => onSetAll(true)}
          className="rounded px-2 py-1.5 text-xs text-brand-700 hover:underline dark:text-brand-400"
        >
          {t('live.filters.all')}
        </button>
        <span className="text-surface-500" aria-hidden="true">|</span>
        <button
          type="button"
          onClick={() => onSetAll(false)}
          className="rounded px-2 py-1.5 text-xs text-surface-600 hover:underline dark:text-surface-400"
        >
          {t('live.filters.clear')}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('live.filters.close')}
          className="grid h-8 w-8 place-items-center rounded text-lg leading-none text-surface-600 hover:bg-surface-200 hover:text-surface-900 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:text-white"
        >
          ×
        </button>
      </div>

      {/* One line explaining the second tag on every row, because "this session"
          under a train feed means nothing without it. */}
      <p className="px-4 pb-2 text-[11px] leading-snug text-surface-500 dark:text-surface-400">
        {t('live.time_model.note')}
      </p>

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
                {/* TWO INKS, PICKED BY THEME. The bright accent is chosen to
                    survive a dark map and the night wash; as 12 px bold text on
                    the sidebar's near-white it measures 2.05:1. The custom
                    properties are what let one element carry both without a
                    theme prop — Tailwind's `dark:` variant switches between
                    them, and both class names are complete literals, which is
                    the constraint that keeps `accent` a raw hex in the first
                    place (see feeds.ts). */}
                <span
                  className="mr-auto text-xs font-bold uppercase tracking-wider text-[color:var(--group-ink)] dark:text-[color:var(--group-ink-dark)]"
                  style={
                    {
                      '--group-ink': group.accentText,
                      '--group-ink-dark': group.accent,
                    } as React.CSSProperties
                  }
                >
                  {t(group.labelKey)}
                </span>
                <span className="text-[11px] text-surface-500 dark:text-surface-400">
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
    </>
  );
};
