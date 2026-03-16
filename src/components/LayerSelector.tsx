import React from 'react';
import { LAYERS, type LayerId } from '../utils/colorScales';
import { t } from '../utils/i18n';

interface LayerSelectorProps {
  activeLayer: LayerId;
  onLayerChange: (id: LayerId) => void;
}

export const LayerSelector: React.FC<LayerSelectorProps> = ({ activeLayer, onLayerChange }) => {
  return (
    <div className="absolute top-4 right-4 z-10 w-52">
      <div className="rounded-xl bg-surface-900/90 backdrop-blur-md border border-surface-700/40 shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-surface-700/40">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-400">
            {t('layers.title')}
          </h3>
        </div>
        <div className="p-2 space-y-0.5">
          {LAYERS.map((layer) => {
            const isActive = layer.id === activeLayer;
            return (
              <button
                key={layer.id}
                onClick={() => onLayerChange(layer.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all duration-150 ${
                  isActive
                    ? 'bg-brand-600/20 text-brand-300 font-medium'
                    : 'text-surface-300 hover:bg-surface-800/60 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{
                      backgroundColor: isActive ? layer.colors[5] || layer.colors[3] : '#475569',
                    }}
                  />
                  {t(layer.labelKey)}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
