/**
 * PO-5: derive real "data updated" events by diffing two build_metadata metric maps.
 *
 * Pure + side-effect-free so build_region_data.mjs can append genuine build events
 * to src/data/data_updates.json and a test can pin the behaviour. Only emits an
 * event when a metric's vintage changes, or its coverage moves by >= 0.5 pp — never
 * fabricates dates or values (the date is the real build date passed in).
 */

const COVERAGE_EPSILON = 0.5;

/** @returns array of { date, metric, type, from, to, title } newest-meaningful events. */
export function computeDataUpdateEvents(prevMetrics, newMetrics, date) {
  const events = [];
  for (const metric of Object.keys(newMetrics).sort()) {
    const next = newMetrics[metric];
    const prev = prevMetrics[metric];
    if (!prev) continue; // a brand-new metric is an addition, not a "refresh" — skip the noise
    if (String(prev.vintage) !== String(next.vintage)) {
      events.push({
        date, metric, type: 'vintage', from: prev.vintage ?? null, to: next.vintage ?? null,
        title: `${metric} refreshed to ${next.vintage} vintage`,
      });
    } else if (Math.abs((Number(prev.coverage_pct) || 0) - (Number(next.coverage_pct) || 0)) >= COVERAGE_EPSILON) {
      events.push({
        date, metric, type: 'coverage', from: prev.coverage_pct ?? null, to: next.coverage_pct ?? null,
        title: `${metric} coverage changed to ${next.coverage_pct}%`,
      });
    }
  }
  return events;
}

/** Merge new events ahead of the existing log (newest first), bounded. */
export function mergeDataUpdates(existing, newEvents, cap = 200) {
  if (newEvents.length === 0) return existing;
  return [...newEvents, ...existing].slice(0, cap);
}
