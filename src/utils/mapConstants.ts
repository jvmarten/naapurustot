const MAP_CENTER_LNG = Number(import.meta.env.VITE_MAP_CENTER_LNG) || 24.94;
const MAP_CENTER_LAT = Number(import.meta.env.VITE_MAP_CENTER_LAT) || 60.17;
const MAP_ZOOM = Number(import.meta.env.VITE_MAP_ZOOM) || 10.5;

export const DEFAULT_CENTER: [number, number] = [MAP_CENTER_LNG, MAP_CENTER_LAT];
export const DEFAULT_ZOOM = MAP_ZOOM;
