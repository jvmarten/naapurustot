/**
 * /live/uv/ — the theoretical clear-sky UV index through the year, worldwide.
 *
 * A companion to the /live/ map's `uv_theory` row, at the scale of a year rather
 * than a day: a band map of the solar-noon index by latitude for the chosen date,
 * a day-of-year slider (and a date picker), and a comparison table the reader
 * fills by searching for cities anywhere on Earth. Everything here is computed
 * — sun geometry plus the clear-sky parameterisation in uvTheory.ts — so it is
 * exact for any date and place, and the page says it is theory, not weather.
 *
 * The coastline is a simplified world outline served as a static text asset
 * (worldLand.txt, ~6 kB gzipped) rather than bundled, per the bundle budget's
 * "keep data out of JS".
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { getLang, setLang, t, useI18nVersion, type Lang } from '../utils/i18n';
import { solarFrame } from '../utils/sun';
import {
  clearSkyUvi,
  geocode,
  sunDistanceFactor,
  theoryDay,
  uvTheoryRgb,
  UV_THEORY_RAMP,
  type Place,
} from './uvTheory';
import landUrl from './worldLand.txt?url';

const DAY_MS = 86_400_000;
const W = 1400;
const H = 700;
const STORE_KEY = 'live.uv.places';
const DEFAULT_PLACES: Place[] = [{ name: 'Helsinki', where: '', lat: 60.17, lon: 24.94 }];

const rgb = (c: readonly number[]) => `rgb(${c})`;
const lat2y = (la: number) => ((90 - la) / 180) * H;
const lon2x = (lo: number) => ((lo + 180) / 360) * W;

/** UTC noon of a calendar date — the instant a "day" is asked at. */
function noonOf(year: number, dayOfYear: number): number {
  return Date.UTC(year, 0, dayOfYear, 12);
}
function daysIn(year: number): number {
  return (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY_MS;
}
function dayOfYear(ms: number): number {
  const d = new Date(ms);
  return Math.round((ms - Date.UTC(d.getUTCFullYear(), 0, 0, 12)) / DAY_MS);
}

function loadPlaces(): Place[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Place[];
      if (Array.isArray(v)) return v.filter((p) => p && typeof p.name === 'string' && Number.isFinite(p.lat) && Number.isFinite(p.lon));
    }
  } catch {
    /* storage unavailable — fall through to the default */
  }
  return DEFAULT_PLACES;
}

function parseLand(text: string): [number, number][][] {
  return text
    .trim()
    .split(';')
    .map((r) => r.split(' ').map((p) => p.split(',').map(Number) as [number, number]));
}

const fmtLat = (la: number) => `${Math.abs(la).toFixed(1)}°${la < 0 ? 'S' : la > 0 ? 'N' : ''}`;
const fmtLon = (lo: number) => `${Math.abs(lo).toFixed(1)}°${lo < 0 ? 'W' : lo > 0 ? 'E' : ''}`;

export function UvPage({ lang }: { lang?: Lang }) {
  useI18nVersion();
  useEffect(() => {
    if (lang && getLang() !== lang) void setLang(lang);
  }, [lang]);
  useEffect(() => {
    document.title = t('live.uvp.title');
  });

  const thisYear = new Date().getUTCFullYear();
  const [year, setYear] = useState(thisYear);
  const [day, setDay] = useState(() => dayOfYear(Date.now()));
  const [ozone, setOzone] = useState(300);
  const [playing, setPlaying] = useState(false);
  const [places, setPlaces] = useState<Place[]>(loadPlaces);
  const [land, setLand] = useState<[number, number][][] | null>(null);
  const [probe, setProbe] = useState<{ lat: number; lon: number } | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[] | null>(null);
  const [searchFailed, setSearchFailed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [shownWidth, setShownWidth] = useState(W);

  const total = daysIn(year);
  const dateMs = noonOf(year, Math.min(day, total));

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(places));
    } catch {
      /* not persisted — the list still works for this visit */
    }
  }, [places]);

  useEffect(() => {
    const ac = new AbortController();
    fetch(landUrl, { signal: ac.signal })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((txt) => setLand(parseLand(txt)))
      .catch(() => {
        /* the bands still draw; only the coastline is missing */
      });
    return () => ac.abort();
  }, []);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setDay((d) => (d % total) + 1), 55);
    return () => clearInterval(id);
  }, [playing, total]);

  // Same debounce-and-abort as the /live/ row: one request per pause in typing.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setSearchFailed(false);
      return;
    }
    const ac = new AbortController();
    const id = setTimeout(() => {
      geocode(q, getLang(), ac.signal)
        .then((r) => {
          setResults(r);
          setSearchFailed(false);
        })
        .catch(() => {
          if (!ac.signal.aborted) setSearchFailed(true);
        });
    }, 300);
    return () => {
      clearTimeout(id);
      ac.abort();
    };
  }, [query]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setShownWidth(cv.clientWidth || W));
    ro.observe(cv);
    return () => ro.disconnect();
  }, []);

  const frame = useMemo(() => solarFrame(new Date(dateMs)), [dateMs]);
  const dec = (Math.asin(frame.sinDec) * 180) / Math.PI;
  const dist = sunDistanceFactor(dateMs);
  const noonUvi = (lat: number) => clearSkyUvi(90 - Math.abs(lat - dec), dist, ozone);

  const rows = useMemo(
    () => places.map((p) => ({ p, d: theoryDay(p.lat, p.lon, dateMs, ozone) })),
    [places, dateMs, ozone],
  );

  // The map. Bands are horizontal because nothing in the model varies with
  // longitude at solar noon — one atmosphere everywhere.
  useEffect(() => {
    const cv = canvasRef.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const k = W / (shownWidth || W);
    for (let y = 0; y < H; y++) {
      ctx.fillStyle = rgb(uvTheoryRgb(noonUvi(90 - ((y + 0.5) / H) * 180)));
      ctx.fillRect(0, y, W, 1);
    }
    ctx.strokeStyle = 'rgba(20,25,32,.20)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let la = -60; la <= 60; la += 30) {
      ctx.moveTo(0, lat2y(la));
      ctx.lineTo(W, lat2y(la));
    }
    for (let lo = -150; lo <= 150; lo += 30) {
      ctx.moveTo(lon2x(lo), 0);
      ctx.lineTo(lon2x(lo), H);
    }
    ctx.stroke();

    if (land) {
      ctx.strokeStyle = 'rgba(14,19,25,.78)';
      ctx.lineWidth = Math.max(1.4, 1.1 * k);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (const ring of land) {
        let prev: number | null = null;
        for (const [lo, la] of ring) {
          // A ring crossing the antimeridian lifts the pen rather than drawing
          // a line across the whole map.
          if (prev === null || Math.abs(lo - prev) > 180) ctx.moveTo(lon2x(lo), lat2y(la));
          else ctx.lineTo(lon2x(lo), lat2y(la));
          prev = lo;
        }
      }
      ctx.stroke();
    }

    ctx.setLineDash([7 * k, 7 * k]);
    ctx.strokeStyle = 'rgba(14,19,25,.45)';
    ctx.lineWidth = Math.max(1.2, k);
    ctx.beginPath();
    for (const la of [23.44, 0, -23.44]) {
      ctx.moveTo(0, lat2y(la));
      ctx.lineTo(W, lat2y(la));
    }
    ctx.stroke();
    ctx.setLineDash([]);

    const fs = Math.round(13 * k);
    const sy = lat2y(dec);
    ctx.strokeStyle = 'rgba(255,255,255,.92)';
    ctx.lineWidth = Math.max(2, 1.6 * k);
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(W, sy);
    ctx.stroke();
    ctx.fillStyle = 'rgba(14,19,25,.85)';
    ctx.font = `600 ${fs}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText(`${t('live.uvp.sun_overhead')}  ${dec.toFixed(1)}°`, 10 * k, sy - 8 * k);

    // The compared places, where they actually are.
    ctx.font = `600 ${fs}px ui-sans-serif, system-ui, sans-serif`;
    for (const { name, lat, lon } of places) {
      const x = lon2x(lon);
      const y = lat2y(lat);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(14,19,25,.9)';
      ctx.lineWidth = Math.max(1.5, 1.2 * k);
      ctx.beginPath();
      ctx.arc(x, y, 4 * k, 0, 7);
      ctx.fill();
      ctx.stroke();
      const right = x > W - 200 * k;
      ctx.textAlign = right ? 'right' : 'left';
      ctx.lineWidth = 3 * k;
      ctx.strokeStyle = 'rgba(255,255,255,.75)';
      const tx = x + (right ? -8 : 8) * k;
      ctx.strokeText(name, tx, y + fs * 0.34);
      ctx.fillStyle = 'rgba(14,19,25,.95)';
      ctx.fillText(name, tx, y + fs * 0.34);
      ctx.textAlign = 'left';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [land, places, dec, dist, ozone, shownWidth]);

  const onMove = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    setProbe({
      lat: 90 - ((ev.clientY - r.top) / r.height) * 180,
      lon: ((ev.clientX - r.left) / r.width) * 360 - 180,
    });
  };

  const add = (p: Place) => {
    setPlaces((ps) =>
      ps.some((q) => Math.abs(q.lat - p.lat) < 1e-3 && Math.abs(q.lon - p.lon) < 1e-3) ? ps : [...ps, p],
    );
    setQuery('');
    setResults(null);
  };

  const locale = getLang() === 'en' ? 'en-GB' : getLang();
  const dateLabel = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(dateMs);
  const isoDate = new Date(dateMs).toISOString().slice(0, 10);
  const chips: [string, number][] = [
    ['live.uvp.eq_mar', 80],
    ['live.uvp.sol_jun', 172],
    ['live.uvp.eq_sep', 266],
    ['live.uvp.sol_dec', 355],
  ];
  const btn =
    'rounded-sm border border-[#2a333f] px-2.5 py-1 text-[12.5px] text-[#8e9bab] hover:border-[#3d4a59] hover:text-[#e6ebf1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e6008e]';
  const probeAlt = probe ? 90 - Math.abs(probe.lat - dec) : 0;
  const livePath = lang && lang !== 'fi' ? `/${lang}/live/` : '/live/';

  return (
    <div className="min-h-screen bg-[#0e1319] text-[15px] leading-normal text-[#e6ebf1] antialiased">
      <div className="mx-auto max-w-[1040px] px-3.5 pb-12 pt-5 sm:px-5 sm:pt-7">
        <header className="mb-4 flex flex-wrap items-baseline justify-between gap-5">
          <div>
            <a href={livePath} className="text-[13px] text-[#8e9bab] hover:text-[#e6ebf1]">
              {t('live.uvp.back')}
            </a>
            <h1 className="m-0 text-[22px] font-semibold tracking-tight">{t('live.uvp.title')}</h1>
            <p className="mt-0.5 max-w-[60ch] text-[13.5px] text-[#8e9bab]">{t('live.uvp.subtitle')}</p>
          </div>
          <div className="whitespace-nowrap text-[13px] tabular-nums text-[#8e9bab]">
            {t('live.uvp.day_of').replace('{n}', String(day)).replace('{total}', String(total))}
          </div>
        </header>

        <div className="relative overflow-hidden rounded-[3px] border border-[#2a333f] bg-[#161c24]">
          <canvas
            ref={canvasRef}
            width={W}
            height={H}
            className="block h-auto w-full cursor-crosshair touch-none"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setProbe(null)}
          />
          {probe && (
            <div className="pointer-events-none absolute left-2.5 top-2.5 rounded-sm border border-[#2a333f] bg-[rgba(10,14,19,.86)] px-3 py-2 text-[12.5px] tabular-nums text-[#8e9bab]">
              <strong className="block text-[19px] font-semibold leading-tight text-[#e6ebf1]">
                UVI {noonUvi(probe.lat).toFixed(1)}
              </strong>
              {fmtLat(probe.lat)} {fmtLon(probe.lon)} ·{' '}
              {probeAlt > 0
                ? t('live.uvp.probe_up').replace('{alt}', probeAlt.toFixed(0))
                : t('live.uvp.probe_below')}
            </div>
          )}
        </div>

        <div className="mt-3.5 flex border border-[#2a333f]" aria-hidden="true">
          {UV_THEORY_RAMP.map((c, i) => (
            <div key={i} className="h-[15px] flex-1" style={{ background: rgb(c) }} />
          ))}
        </div>
        <div className="mt-0.5 flex" aria-hidden="true">
          {UV_THEORY_RAMP.map((_, i) => (
            <span key={i} className="flex-1 text-center text-[10.5px] tabular-nums text-[#8e9bab]">
              {i === 17 ? '17+' : i}
            </span>
          ))}
        </div>

        <div className="mt-6 grid gap-x-5 gap-y-3.5 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2 sm:flex-nowrap sm:gap-4">
            <span className="min-w-[150px] text-[20px] font-semibold tabular-nums">{dateLabel}</span>
            <input
              type="range"
              min={1}
              max={total}
              value={day}
              onChange={(e) => {
                setPlaying(false);
                setDay(Number(e.target.value));
              }}
              aria-label={t('live.uvp.slider')}
              className="w-full accent-[#e6ebf1]"
            />
            <button type="button" className={`${btn} min-w-[64px] whitespace-nowrap text-[#e6ebf1]`} onClick={() => setPlaying((p) => !p)}>
              {playing ? t('live.uvp.pause') : t('live.uvp.play')}
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {chips.map(([key, d]) => (
              <button
                key={key}
                type="button"
                className={btn}
                onClick={() => {
                  setPlaying(false);
                  setDay(d);
                }}
              >
                {t(key)}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[13px] text-[#8e9bab]">
            {t('live.uvp.date')}
            <input
              type="date"
              value={isoDate}
              onChange={(e) => {
                const ms = Date.parse(`${e.target.value}T12:00:00Z`);
                if (!Number.isFinite(ms)) return;
                setPlaying(false);
                setYear(new Date(ms).getUTCFullYear());
                setDay(dayOfYear(ms));
              }}
              className="rounded-sm border border-[#2a333f] bg-transparent px-2 py-1 text-[#e6ebf1] [color-scheme:dark]"
            />
          </label>

          <div className="flex items-center gap-3 border-t border-[#2a333f] pt-4 text-[13px] text-[#8e9bab] sm:col-span-2">
            <label htmlFor="uvp-oz">{t('live.uvp.ozone')}</label>
            <input
              id="uvp-oz"
              type="range"
              min={220}
              max={400}
              step={5}
              value={ozone}
              onChange={(e) => setOzone(Number(e.target.value))}
              className="max-w-[240px] flex-1 accent-[#e6ebf1]"
            />
            <b className="min-w-[76px] font-semibold tabular-nums text-[#e6ebf1]">{ozone} DU</b>
          </div>
        </div>

        <div className="relative mt-7">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results?.[0]) add(results[0]);
            }}
            placeholder={t('live.uvp.search')}
            aria-label={t('live.uvp.search')}
            className="w-full rounded-sm border border-[#2a333f] bg-[#161c24] px-3 py-2 text-[#e6ebf1] placeholder:text-[#8e9bab] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e6008e]"
          />
          {query.trim().length >= 2 && (searchFailed || results) && (
            <ul className="absolute z-10 mt-1 w-full divide-y divide-[#1e252e] rounded-sm border border-[#2a333f] bg-[#161c24] shadow-lg">
              {searchFailed ? (
                <li className="px-3 py-2 text-amber-400">{t('live.uvt.failed')}</li>
              ) : results!.length === 0 ? (
                <li className="px-3 py-2 text-[#8e9bab]">{t('live.uvt.no_results')}</li>
              ) : (
                results!.map((r, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => add(r)}
                      className="w-full px-3 py-2 text-left hover:bg-[#1e252e]"
                    >
                      <span className="font-medium">{r.name}</span>
                      {r.where && <span className="text-[#8e9bab]"> · {r.where}</span>}
                      <span className="ml-2 text-[11.5px] tabular-nums text-[#8e9bab]">{fmtLat(r.lat)}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>

        <table className="mt-5 w-full border-collapse text-[13px] sm:text-[13.5px]">
          <caption className="pb-2 text-left text-[13px] text-[#8e9bab]">
            {t('live.uvp.caption').replace('{date}', dateLabel).replace('{oz}', String(ozone))}
          </caption>
          <thead>
            <tr className="border-b border-[#2a333f] text-left text-[12px] font-medium text-[#8e9bab]">
              <th className="pb-1.5 pr-2.5 font-medium">{t('live.uvp.col_place')}</th>
              <th className="hidden pb-1.5 pr-2.5 text-right font-medium sm:table-cell">{t('live.uvp.col_noon_sun')}</th>
              <th className="pb-1.5 pr-2.5 text-right font-medium">{t('live.uvp.col_uvi')}</th>
              <th className="pb-1.5 pr-2.5 text-right font-medium">{t('live.uvp.col_daylight')}</th>
              <th className="pb-1.5 pr-2.5 text-right font-medium">{t('live.uvp.col_dose')}</th>
              <th className="w-8 pb-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-3 text-[#8e9bab]">
                  {t('live.uvp.empty')}
                </td>
              </tr>
            )}
            {rows.map(({ p, d }, i) => (
              <tr key={`${p.lat},${p.lon}`} className="border-b border-[#1e252e]">
                <td className="py-1.5 pr-2.5">
                  <span
                    className="mr-2 inline-block h-[9px] w-[9px] rounded-full"
                    style={{ background: rgb(uvTheoryRgb(d.peak)) }}
                  />
                  {p.name}
                  <i className="ml-1 block text-[11.5px] not-italic tabular-nums text-[#8e9bab] sm:inline">
                    {fmtLat(p.lat)}
                    {p.where && ` · ${p.where}`}
                  </i>
                </td>
                <td className="hidden pr-2.5 text-right tabular-nums sm:table-cell">
                  {d.noonAltitude > 0 ? `${d.noonAltitude.toFixed(0)}°` : t('live.uvp.below')}
                </td>
                <td className="pr-2.5 text-right text-[15px] font-semibold tabular-nums">{d.peak.toFixed(1)}</td>
                <td className="pr-2.5 text-right tabular-nums">{d.daylight.toFixed(1)} h</td>
                <td className="pr-2.5 text-right text-[15px] font-semibold tabular-nums">{d.sed.toFixed(1)}</td>
                <td className="text-right">
                  <button
                    type="button"
                    aria-label={t('live.uvp.remove').replace('{name}', p.name)}
                    title={t('live.uvp.remove').replace('{name}', p.name)}
                    onClick={() => setPlaces((ps) => ps.filter((_, j) => j !== i))}
                    className="px-1.5 text-[#8e9bab] hover:text-[#e6ebf1]"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <footer className="mt-7 max-w-[74ch] space-y-1.5 text-[12.5px] text-[#8e9bab]">
          <p>{t('live.uvp.foot_bands')}</p>
          <p>
            UVI = <code className="text-[12px] text-[#b9c4d1]">12.0 · cos(z)^2.42 · (Ω/300)^−1.23 · d</code>{' '}
            {t('live.uvp.foot_formula')}
          </p>
          <p>{t('live.uvp.foot_scale')}</p>
          <p>{t('live.uvp.foot_sources')}</p>
        </footer>
      </div>
    </div>
  );
}
