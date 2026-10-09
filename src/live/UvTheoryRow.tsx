/**
 * The theoretical clear-sky UV row of the readout: a worldwide city search and
 * the computed index for the chosen place (or the map centre), with the ramp
 * the map wash is drawn in. See uvTheory.ts for what the number is — and is not.
 */
import { useEffect, useMemo, useState } from 'react';
import { getLang, t } from '../utils/i18n';
import { geocode, theoryDay, theoryUviAt, UV_THEORY_RAMP, type Place } from './uvTheory';

const fmt = (v: number) => v.toFixed(1);

export function UvTheoryRow({
  whenMs,
  center,
  onPick,
}: {
  whenMs: number;
  /** Map centre, [lon, lat]. */
  center: [number, number];
  onPick: (p: Place) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<Place | null>(null);

  // Debounced, and the previous request aborted, so typing "Buenos Aires" is
  // one request rather than twelve racing each other back.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setFailed(false);
      return;
    }
    const ac = new AbortController();
    const id = setTimeout(() => {
      geocode(q, getLang(), ac.signal)
        .then((r) => {
          setResults(r);
          setFailed(false);
        })
        .catch(() => {
          if (!ac.signal.aborted) setFailed(true);
        });
    }, 300);
    return () => {
      clearTimeout(id);
      ac.abort();
    };
  }, [query]);

  const lat = picked ? picked.lat : center[1];
  const lon = picked ? picked.lon : center[0];
  const now = theoryUviAt(lat, lon, whenMs);
  // The day only changes with the place or the date, not with every scrub step.
  const hourMs = Math.floor(whenMs / 3_600_000) * 3_600_000;
  const day = useMemo(() => theoryDay(lat, lon, hourMs), [lat, lon, hourMs]);
  const place = picked ? picked.name : t('live.uvt.here');

  const choose = (p: Place) => {
    setPicked(p);
    setQuery('');
    onPick(p);
  };

  return (
    <div className="space-y-1">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results?.[0]) choose(results[0]);
        }}
        placeholder={t('live.uvt.search')}
        aria-label={t('live.uvt.search')}
        className="w-full rounded border border-surface-300 bg-white px-2 py-1 text-surface-900 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-100"
      />
      {failed ? (
        <p className="text-amber-700 dark:text-amber-400">{t('live.uvt.failed')}</p>
      ) : (
        results &&
        query.trim().length >= 2 &&
        (results.length === 0 ? (
          <p className="text-surface-600 dark:text-surface-300">{t('live.uvt.no_results')}</p>
        ) : (
          <ul className="divide-y divide-surface-200 rounded border border-surface-200 dark:divide-surface-700 dark:border-surface-700">
            {results.map((r, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => choose(r)}
                  className="w-full px-2 py-1 text-left hover:bg-surface-100 dark:hover:bg-surface-700"
                >
                  <span className="font-medium text-surface-900 dark:text-surface-100">{r.name}</span>
                  {r.where && <span className="text-surface-500 dark:text-surface-400"> · {r.where}</span>}
                </button>
              </li>
            ))}
          </ul>
        ))
      )}
      <p className="text-surface-600 dark:text-surface-300">
        {day.noonAltitude <= 0
          ? t('live.uvt.dark').replace('{place}', place)
          : t('live.uvt.reading')
              .replace('{place}', place)
              .replace('{v}', fmt(now))
              .replace('{peak}', fmt(day.peak))
              .replace('{alt}', day.noonAltitude.toFixed(0))
              .replace('{sed}', fmt(day.sed))}
        {picked && (
          <>
            {' '}
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="underline hover:text-surface-900 dark:hover:text-surface-100"
            >
              {t('live.uvt.clear')}
            </button>
          </>
        )}
      </p>
      <div className="flex h-2 overflow-hidden rounded-sm" aria-hidden="true">
        {UV_THEORY_RAMP.map((c, i) => (
          <div key={i} className="flex-1" style={{ background: `rgb(${c})` }} />
        ))}
      </div>
      {/* Labelled at the WHO band edges, under their own cells. */}
      <div className="flex text-center text-[10px] text-surface-500 dark:text-surface-400" aria-hidden="true">
        {UV_THEORY_RAMP.map((_, i) => (
          <span key={i} className="flex-1">
            {i === 17 ? '17+' : [0, 3, 6, 8, 11].includes(i) ? i : ''}
          </span>
        ))}
      </div>
      <p className="text-surface-500 dark:text-surface-400">{t('live.uvt.note')}</p>
    </div>
  );
}
