/**
 * Columnar encoding for the geometry-stripped area-properties artifact.
 *
 * `region_properties.json` was an array of 3,018 objects that each repeat the
 * same 198 key names. Measured on the committed file: 12,492,657 B raw, of which
 * 8,913,381 B (71.4 %) is nothing but those key names, repeated 3,018 times.
 *
 * Storing the keys once and the values column-major cuts it to 3,604,233 B raw
 * and 1,005,079 B gzipped — a 1,083,532 B (51.9 %) saving on the wire for every
 * consumer that fetches it. Column-major beats row-major by a wide margin here
 * (1,005,079 vs 1,243,132 gz) because it puts like-typed, similarly-shaped
 * values next to each other, which is exactly what DEFLATE's window rewards.
 *
 * Keys keep the order the pipeline first emitted them in, rather than being
 * sorted. Both are deterministic, so either satisfies the build:data
 * idempotency gate — but consumers that iterate a decoded record inherit its key
 * order, and sorting reshuffled every key in national_ranges.json for no reason.
 * First-seen order also keeps related columns adjacent, which is what DEFLATE
 * rewards.
 *
 * Absent keys decode to `null`. Only three keys are ever absent in practice
 * (property_price_history, crime_index_history, crime_index_change_pct) and all
 * three are typed `… | null` already, so nothing distinguishes "absent" from
 * "explicitly null" — no consumer uses `in` or `hasOwnProperty` on them.
 */

export const COLUMNAR_FORMAT = 'columnar/1';

/** Encode an array of flat records as `{ format, keys, cols }`. */
export function encodeColumnar(records) {
  const keys = [...new Set(records.flatMap((r) => Object.keys(r || {})))];
  const cols = keys.map((k) => records.map((r) => {
    const v = r?.[k];
    return v === undefined ? null : v;
  }));
  return { format: COLUMNAR_FORMAT, keys, cols };
}

/**
 * Decode `{ format, keys, cols }` back into an array of records.
 *
 * Accepts a plain array unchanged, so a consumer reading a not-yet-migrated
 * artifact (or a hand-written fixture) keeps working.
 */
export function decodeColumnar(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || !Array.isArray(payload.keys) || !Array.isArray(payload.cols)) {
    throw new TypeError('decodeColumnar: expected an array or a {keys, cols} payload');
  }
  const { keys, cols } = payload;
  if (keys.length !== cols.length) {
    throw new TypeError(
      `decodeColumnar: ${keys.length} keys but ${cols.length} columns`,
    );
  }
  const length = cols[0]?.length ?? 0;
  const out = new Array(length);
  for (let i = 0; i < length; i++) {
    const record = {};
    for (let k = 0; k < keys.length; k++) record[keys[k]] = cols[k][i];
    out[i] = record;
  }
  return out;
}
