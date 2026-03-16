import React, { useState, useRef, useCallback } from 'react';
import { LAYERS, type LayerId } from '../utils/colorScales';
import { t } from '../utils/i18n';

interface LayerSelectorProps {
  activeLayer: LayerId;
  onLayerChange: (id: LayerId) => void;
  onCustomizeQuality?: () => void;
  isCustomWeights?: boolean;
}

type LayerGroup = {
  labelKey: string;
  ids: LayerId[];
};

const LAYER_GROUPS: LayerGroup[] = [
  { labelKey: 'layers.quality', ids: ['quality_index', 'walkability', 'transit_access', 'air_quality', 'crime_rate', 'noise_level'] },
  { labelKey: 'layers.demographics', ids: ['avg_age', 'population_density', 'child_ratio', 'student_share', 'foreign_lang', 'pensioners', 'population_growth', 'single_person_hh', 'seniors_alone', 'kela_benefits'] },
  { labelKey: 'layers.economy', ids: ['median_income', 'taxable_income', 'unemployment', 'education', 'property_price', 'rental_price', 'income_inequality'] },
  { labelKey: 'layers.housing', ids: ['ownership', 'rental', 'apt_size', 'detached_houses', 'building_age', 'energy_class'] },
  { labelKey: 'layers.services', ids: ['restaurant_density', 'grocery_access', 'daycare_density', 'school_density', 'healthcare_access', 'green_space'] },
  { labelKey: 'layers.mobility', ids: ['commute_time', 'car_ownership', 'cycling_infra'] },
];

export const LayerSelector: React.FC<LayerSelectorProps> = ({ activeLayer, onLayerChange, onCustomizeQuality, isCustomWeights = false }) => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(
    Object.fromEntries(LAYER_GROUPS.map((g) => [g.labelKey, true]))
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const toggleGroup = (labelKey: string) => {
    setCollapsed((prev) => ({ ...prev, [labelKey]: !prev[labelKey] }));
  };

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
    setIsDragging(true);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (dragStartY.current == null) return;
    const delta = e.touches[0].clientY - dragStartY.current;
    // Only allow downward drag when open
    if (mobileOpen && delta > 0) {
      setDragOffset(delta);
    }
    // Allow upward drag when closed
    if (!mobileOpen && delta < -30) {
      setMobileOpen(true);
    }
  }, [mobileOpen]);

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
    dragStartY.current = null;
    if (dragOffset > 80) {
      setMobileOpen(false);
    }
    setDragOffset(0);
  }, [dragOffset]);

  const layerList = (
    <div className="p-2 space-y-1">
      {LAYER_GROUPS.map((group) => {
        const groupLayers = group.ids
          .map((id) => LAYERS.find((l) => l.id === id))
          .filter(Boolean);
        if (groupLayers.length === 0) return null;
        const isCollapsed = !!collapsed[group.labelKey];
        const hasActiveLayer = group.ids.includes(activeLayer);

        return (
          <div key={group.labelKey}>
            <button
              onClick={() => toggleGroup(group.labelKey)}
              className="w-full flex items-center justify-between px-3 pt-2 pb-1 group cursor-pointer min-h-[44px] md:min-h-0"
            >
              <span className={`text-[10px] font-semibold uppercase tracking-wider ${
                hasActiveLayer && isCollapsed
                  ? 'text-brand-500 dark:text-brand-400'
                  : 'text-surface-400 dark:text-surface-500'
              }`}>
                {t(group.labelKey)}
              </span>
              <svg
                className={`w-3 h-3 text-surface-400 dark:text-surface-500 transition-transform duration-200 ${
                  isCollapsed ? '-rotate-90' : ''
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {!isCollapsed && groupLayers.map((layer) => {
              if (!layer) return null;
              const isActive = layer.id === activeLayer;
              return (
                <React.Fragment key={layer.id}>
                  <button
                    onClick={() => {
                      onLayerChange(layer.id);
                      setMobileOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2.5 md:py-1.5 rounded-lg text-sm transition-all duration-150 min-h-[44px] md:min-h-0 ${
                      isActive
                        ? 'bg-brand-500/15 dark:bg-brand-600/20 text-brand-600 dark:text-brand-300 font-medium'
                        : 'text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800/60 hover:text-surface-900 dark:hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 md:w-2.5 md:h-2.5 rounded-full flex-shrink-0"
                        style={{
                          backgroundColor: isActive ? layer.colors[5] || layer.colors[3] : '#94a3b8',
                        }}
                      />
                      {t(layer.labelKey)}
                    </div>
                  </button>
                  {layer.id === 'quality_index' && onCustomizeQuality && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCustomizeQuality();
                      }}
                      className={`w-full text-left px-3 py-2 md:py-1 ml-1 rounded-lg text-xs font-medium transition-colors min-h-[40px] md:min-h-0 flex items-center gap-1.5 ${
                        isCustomWeights
                          ? 'text-brand-500 dark:text-brand-400 hover:bg-brand-500/15'
                          : 'text-surface-400 dark:text-surface-500 hover:text-surface-600 dark:hover:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800/60'
                      }`}
                    >
                      <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                      </svg>
                      {t('custom_quality.customize_qi')}
                    </button>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      {/* Desktop: top-right dropdown */}
      <div className="hidden md:block absolute top-4 right-4 z-10 w-52 max-h-[80vh] overflow-y-auto">
        <div className="rounded-xl bg-white/90 dark:bg-surface-900/90 backdrop-blur-md border border-surface-200 dark:border-surface-700/40 shadow-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-surface-200 dark:border-surface-700/40">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
              {t('layers.title')}
            </h3>
          </div>
          {layerList}
        </div>
      </div>

      {/* Mobile: bottom-right FAB + swipe-up sheet */}
      <div className="md:hidden">
        {/* FAB trigger */}
        {!mobileOpen && (
          <button
            onClick={() => setMobileOpen(true)}
            className="fixed bottom-5 right-4 z-30 w-14 h-14 rounded-2xl
                       bg-white/95 dark:bg-surface-900/95 backdrop-blur-md
                       border border-surface-200 dark:border-surface-700/40
                       shadow-2xl flex items-center justify-center
                       active:scale-95 transition-transform"
            aria-label={t('layers.title')}
          >
            <div className="flex flex-col items-center gap-0.5">
              <svg className="w-5 h-5 text-surface-600 dark:text-surface-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              <span className="text-[8px] font-semibold uppercase text-surface-500 dark:text-surface-400 tracking-wider">
                {t('layers.title')}
              </span>
            </div>
          </button>
        )}

        {/* Backdrop */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/20 dark:bg-black/40"
            onClick={() => setMobileOpen(false)}
            style={{
              opacity: isDragging ? Math.max(0, 1 - dragOffset / 200) : 1,
              transition: isDragging ? 'none' : 'opacity 0.2s',
            }}
          />
        )}

        {/* Sheet */}
        {mobileOpen && (
          <div
            ref={sheetRef}
            className="fixed bottom-0 left-0 right-0 z-40
                       bg-white/95 dark:bg-surface-950/95 backdrop-blur-xl
                       border-t border-surface-200 dark:border-surface-800/50
                       shadow-[0_-4px_30px_rgba(0,0,0,0.15)] rounded-t-2xl
                       max-h-[70vh] overflow-hidden"
            style={{
              transform: `translateY(${dragOffset}px)`,
              transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)',
            }}
          >
            {/* Drag handle */}
            <div
              className="flex items-center justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing touch-none"
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              <div className="w-10 h-1.5 rounded-full bg-surface-300 dark:bg-surface-600" />
            </div>

            <div className="px-4 py-2 border-b border-surface-200 dark:border-surface-700/40 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
                {t('layers.title')}
              </h3>
              <button
                onClick={() => setMobileOpen(false)}
                className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-400"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="overflow-y-auto max-h-[calc(70vh-5rem)] pb-safe">
              {layerList}
            </div>
          </div>
        )}
      </div>
    </>
  );
};
