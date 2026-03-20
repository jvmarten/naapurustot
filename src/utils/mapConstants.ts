const MAP_CENTER_LNG = Number(import.meta.env.VITE_MAP_CENTER_LNG);
const MAP_CENTER_LAT = Number(import.meta.env.VITE_MAP_CENTER_LAT);
const MAP_ZOOM = Number(import.meta.env.VITE_MAP_ZOOM);

export const DEFAULT_CENTER: [number, number] = [MAP_CENTER_LNG, MAP_CENTER_LAT];
export const DEFAULT_ZOOM = MAP_ZOOM;
