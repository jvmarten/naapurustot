import React from 'react';
import { t, useI18nVersion } from '../utils/i18n';

interface TimeSliderProps {
  /** Sorted ascending list of available years. */
  years: number[];
  /** Currently displayed year (must be a member of `years`). */
  currentYear: number;
  /** Called when the user scrubs to a year (also pauses playback). */
  onYearChange: (year: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
}

/**
 * PO-2: Time slider for historical playback. Appears below the legend only when
 * a time-series metric is active; scrubbing animates the choropleth across years.
 */
export const TimeSlider: React.FC<TimeSliderProps> = ({ years, currentYear, onYearChange, playing, onTogglePlay }) => {
  useI18nVersion();
  const idx = Math.max(0, years.indexOf(currentYear));
  const minYear = years[0];
  const maxYear = years[years.length - 1];

  return (
    <div className="fixed md:absolute bottom-5 md:bottom-8 left-1/2 -translate-x-1/2 z-10">
      <div className="flex items-center gap-3 rounded-xl bg-white/90 dark:bg-surface-900/90 backdrop-blur-md
                     border border-surface-200 dark:border-surface-700/40 shadow-2xl px-3 py-2">
        <button
          onClick={onTogglePlay}
          aria-label={playing ? t('time.pause') : t('time.play')}
          title={playing ? t('time.pause') : t('time.play')}
          className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg
                     bg-brand-500/15 dark:bg-brand-600/20 text-brand-600 dark:text-brand-300
                     hover:bg-brand-500/25 dark:hover:bg-brand-600/30 transition-colors"
        >
          {playing ? (
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
          ) : (
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          )}
        </button>
        <div className="flex flex-col gap-0.5">
          <input
            type="range"
            min={0}
            max={years.length - 1}
            step={1}
            value={idx}
            onChange={(e) => onYearChange(years[Number(e.target.value)])}
            aria-label={t('time.year')}
            aria-valuetext={String(currentYear)}
            className="w-40 md:w-52 h-1 accent-brand-500 cursor-pointer"
          />
          <div className="flex justify-between text-[10px] tabular-nums text-surface-400 dark:text-surface-500">
            <span>{minYear}</span>
            <span className="font-semibold text-surface-700 dark:text-surface-200">{currentYear}</span>
            <span>{maxYear}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
