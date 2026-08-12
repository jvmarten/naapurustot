/**
 * Live air quality for /live/, from the Finnish Meteorological Institute.
 *
 * Source: FMI open data WFS, CC BY 4.0, no API key. Shares ./fmi.ts with the
 * temperature feed — same response shape, same traps.
 *
 * THE `urban::` NETWORK, NOT `fmi::`. Both publish the same hourly index, and
 * they are not the same size. Measured against the live service:
 *
 *   fmi::observations::airquality::hourly::simple      7 stations   0.8 kB gz
 *   urban::observations::airquality::hourly::simple   82 stations   3.7 kB gz
 *
 * Seven stations is a national background network — real, but too sparse to read
 * as a map. The urban collection is the municipal monitoring network and is where
 * air quality is actually measured and actually matters. That is also why this
 * feed is registered as `urban` coverage rather than `national`: 82 stations in
 * towns is not the whole country, and the sidebar says so rather than implying
 * otherwise.
 *
 * THE VALUE IS AN INDEX, NOT A CONCENTRATION. `AQINDEX_PT1H_avg` is FMI's hourly
 * air quality index on a five-point scale — 1 good, 2 satisfactory, 3 fair,
 * 4 poor, 5 very poor. It is categorical, so it is drawn as colour rather than as
 * a number: "3" means nothing to a reader without the scale beside it, while a
 * position on a green-to-red ramp is legible at a glance and needs no legend.
 * The band names are what the readout states.
 */
import { fetchFmiSimple, fmiSimpleUrl, parseFmiSimple, type FmiReading } from './fmi';

/** One station's most recent air quality index. */
export interface AirQuality {
  lon: number;
  lat: number;
  /** FMI hourly index, 1 (good) to 5 (very poor). */
  index: number;
  /** When it was measured, ms since the epoch. */
  at: number;
}

const STORED_QUERY = 'urban::observations::airquality::hourly::simple';
const PARAMETER = 'AQINDEX_PT1H_avg';

/**
 * How far back to ask, in minutes.
 *
 * The index is HOURLY, so a window shorter than an hour returns only the
 * stations that happened to publish inside it. Three hours covers a station that
 * has skipped an update without dragging in a day of history.
 */
const WINDOW_MINUTES = 180;

/** How often we ask, in ms. The index updates hourly; a quarter of that is ample. */
export const AIR_QUALITY_POLL_MS = 900_000;

/**
 * Colour per index band, taken from the ramp the map's own air-quality layer
 * already uses (`colorScales.ts`), so the two surfaces of the site agree.
 *
 * Five stops from that eight-stop scale rather than a new palette: the map's
 * layer is a continuous modelled index over a different range, so its stops
 * cannot be reused directly, but its COLOURS can — which keeps "green is clean"
 * consistent across the app without inventing anything.
 */
export const AQ_COLORS: Record<number, string> = {
  1: '#1a9850',
  2: '#a6d96a',
  3: '#fee08b',
  4: '#f46d43',
  5: '#d73027',
};

/** i18n key for an index band, for the readout. */
export function aqBandKey(index: number): string {
  const band = Math.min(5, Math.max(1, Math.round(index)));
  return `live.air_quality.band_${band}`;
}

/** The request URL for a given instant. Exported so a test can read it. */
export function airQualityUrl(now: number): string {
  return fmiSimpleUrl(STORED_QUERY, PARAMETER, now, WINDOW_MINUTES);
}

const toAirQuality = (r: FmiReading): AirQuality => ({
  lon: r.lon,
  lat: r.lat,
  index: r.value,
  at: r.at,
});

/**
 * Parse an air-quality response, keeping only readings on the published scale.
 *
 * An index outside 1..5 is not a worse reading, it is a value this feed does not
 * define — and since the value is rendered as a COLOUR, an out-of-range number
 * would silently clamp to "very poor" and put a red dot on the map with nothing
 * behind it. Dropped instead.
 */
export function parseAirQuality(xml: string): AirQuality[] {
  return parseFmiSimple(xml)
    .filter((r) => r.value >= 1 && r.value <= 5)
    .map(toAirQuality);
}

/** Current air quality index at every reporting urban station. */
export async function fetchAirQuality(signal?: AbortSignal): Promise<AirQuality[]> {
  const readings = await fetchFmiSimple(STORED_QUERY, PARAMETER, WINDOW_MINUTES, signal);
  return readings.filter((r) => r.value >= 1 && r.value <= 5).map(toAirQuality);
}
