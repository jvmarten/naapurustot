/**
 * Runtime decoder for the columnar area-properties artifact.
 *
 * `region_properties.json` ships as `{ format, keys, cols }` rather than an
 * array of 3,018 objects repeating the same 198 key names — 2,088,611 B gzipped
 * became 1,005,079 B. See scripts/lib/columnar.mjs for the encoder and the
 * measurements behind the format choice.
 *
 * Kept deliberately small: this runs on the all-Finland path, and it counts
 * against the gzipped JS budget.
 */

export interface ColumnarPayload {
  format?: string;
  keys: string[];
  cols: unknown[][];
}

/**
 * Rehydrate a columnar payload into records.
 *
 * A plain array passes through untouched, so a cached or older artifact — and
 * every test fixture written against the previous shape — still loads.
 */
export function decodeColumnar<T = Record<string, unknown>>(
  payload: ColumnarPayload | T[],
): T[] {
  if (Array.isArray(payload)) return payload;
  const { keys, cols } = payload;
  if (!Array.isArray(keys) || !Array.isArray(cols)) return [];
  const length = cols[0]?.length ?? 0;
  const out: T[] = new Array(length);
  for (let i = 0; i < length; i++) {
    const record: Record<string, unknown> = {};
    for (let k = 0; k < keys.length; k++) record[keys[k]] = cols[k][i];
    out[i] = record as T;
  }
  return out;
}
