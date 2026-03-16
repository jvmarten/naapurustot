import React, { useState } from 'react';
import { LAYERS, type LayerId } from '../utils/colorScales';
import { t } from '../utils/i18n';

interface LayerSelectorProps {
  activeLayer: LayerId;
  onLayerChange: (id: LayerId) => void;
}

type LayerGroup = {
  labelKey: string;
  ids: LayerId[];
};

const LAYER_GROUPS: LayerGroup[] = [
  { labelKey: 'layers.quality', ids: ['quality_index', 'transit_access', 'air_quality'] },
  { labelKey: 'layers.demographics', ids: ['avg_age', 'population_density', 'child_ratio', 'student_share', 'foreign_lang', 'pensioners'] },
  { labelKey: 'layers.economy', ids: ['median_income', 'unemployment', 'education', 'property_price'] },
  { labelKey: 'layers.housing', ids: ['ownership', 'rental', 'apt_size', 'detached_houses'] },
];

export const LayerSelector: React.FC<LayerSelectorProps> = ({ activeLayer, onLayerChange }) => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggleGroup = (labelKey: string) => {
    setCollapsed((prev) => ({ ...prev, [labelKey]: !prev[labelKey] }));
  };

  return (
    <div className="absolute top-4 right-4 z-10 w-52 max-h-[80vh] overflow-y-auto">
      <div className="rounded-xl bg-white/90 dark:bg-surface-900/90 backdrop-blur-md border border-surface-200 dark:border-surface-700/40 shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-surface-200 dark:border-surface-700/40">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
            {t('layers.title')}
          </h3>
        </div>
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
                  className="w-full flex items-center justify-between px-3 pt-2 pb-1 group cursor-pointer"
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
                    <button
                      key={layer.id}
                      onClick={() => onLayerChange(layer.id)}
                      className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-all duration-150 ${
                        isActive
                          ? 'bg-brand-500/15 dark:bg-brand-600/20 text-brand-600 dark:text-brand-300 font-medium'
                          : 'text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800/60 hover:text-surface-900 dark:hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{
                            backgroundColor: isActive ? layer.colors[5] || layer.colors[3] : '#94a3b8',
                          }}
                        />
                        {t(layer.labelKey)}
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
