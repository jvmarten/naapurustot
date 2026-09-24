import { t } from '../utils/i18n';

const CLOSE_ICON = (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const BTN = 'flex-1 px-3 min-h-[44px] md:min-h-[32px] rounded-lg text-sm font-semibold whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';

interface RegionSwitchPromptProps {
  /** Region id the user tapped (a seutukunta not currently on the map). */
  region: string;
  /** How many regions are on the map now — 1 offers "show both", more "add to map". */
  shownCount: number;
  onSwitch: () => void;
  onAdd: () => void;
  onClose: () => void;
}

/**
 * Card offered after a tap on a neighbouring seutukunta in a region view: switch the
 * map to it, or show its postal-code areas alongside the current ones. The name gets a
 * row of its own so a long one ("Saarijärven–Viitasaaren seutu") is never truncated on
 * a phone. A labelled group, not a dialog — it never takes focus from the map
 * (arrow-key panning), and App announces it through the shared live region.
 */
export function RegionSwitchPrompt({ region, shownCount, onSwitch, onAdd, onClose }: RegionSwitchPromptProps) {
  return (
    <div
      role="group"
      aria-labelledby="region-switch-name"
      className="pointer-events-auto w-72 max-w-[92vw] p-2 pt-1 rounded-xl shadow-2xl
                 bg-white dark:bg-surface-900 text-surface-900 dark:text-white ring-1 ring-surface-200 dark:ring-surface-700"
    >
      <div className="flex items-center gap-2 pl-1">
        <span id="region-switch-name" className="flex-1 min-w-0 truncate text-sm font-semibold">{t('city.' + region)}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('aria.close')}
          className="shrink-0 -mr-1 flex items-center justify-center min-w-[44px] min-h-[44px] md:min-w-[32px] md:min-h-[32px] rounded-lg text-surface-500 hover:text-surface-800 dark:text-surface-400 dark:hover:text-white"
        >
          {CLOSE_ICON}
        </button>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onSwitch} className={`${BTN} bg-brand-600 hover:bg-brand-700 text-white`}>
          {t('region_switch.switch')}
        </button>
        <button
          type="button"
          onClick={onAdd}
          className={`${BTN} bg-surface-100 hover:bg-surface-200 text-surface-700 dark:bg-surface-800 dark:hover:bg-surface-700 dark:text-surface-200`}
        >
          {t(shownCount > 1 ? 'region_switch.add' : 'region_switch.show_both')}
        </button>
      </div>
    </div>
  );
}

interface RegionChipsProps {
  /** Regions added alongside the primary one (the primary is the CitySelector's value). */
  regions: string[];
  onRemove: (region: string) => void;
}

/** Removable chips for the regions shown alongside the primary, under the search bar. */
export function RegionChips({ regions, onRemove }: RegionChipsProps) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {regions.map((r) => {
        const name = t('city.' + r);
        return (
          <span
            key={r}
            className="inline-flex items-center max-w-full pl-2.5 rounded-full text-xs font-medium shadow
                       bg-white dark:bg-surface-900 text-surface-800 dark:text-surface-100 ring-1 ring-surface-200 dark:ring-surface-700"
          >
            <span className="truncate">{name}</span>
            <button
              type="button"
              onClick={() => onRemove(r)}
              aria-label={t('region_switch.remove').replace('{city}', name)}
              className="shrink-0 flex items-center justify-center min-w-[32px] min-h-[32px] rounded-full text-surface-500 hover:text-surface-800 dark:text-surface-400 dark:hover:text-white"
            >
              {CLOSE_ICON}
            </button>
          </span>
        );
      })}
    </div>
  );
}
