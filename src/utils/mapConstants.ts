function envNum(key: string, fallback: number): number {
  const raw = import.meta.env[key];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return isFinite(n) ? n : fallback;
}

const MAP_CENTER_LNG = envNum('VITE_MAP_CENTER_LNG', 24.94);
const MAP_CENTER_LAT = envNum('VITE_MAP_CENTER_LAT', 60.17);
const MAP_ZOOM = envNum('VITE_MAP_ZOOM', 10.5);

export const DEFAULT_CENTER: [number, number] = [MAP_CENTER_LNG, MAP_CENTER_LAT];
export const DEFAULT_ZOOM = MAP_ZOOM;
