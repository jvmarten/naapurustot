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
import { useNavigate } from 'react-router-dom';
import { getLang, setLang, t, useI18nVersion, type Lang } from '../utils/i18n';
import { solarFrame } from '../utils/sun';
import {
  clearSkyUvi,
  geocode,
  reverseGeocode,
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

/** Dark or light ink on a ramp colour, by perceived luminance. */
const inkOn = ([r, g, b]: readonly number[]) => (0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#0e1319' : '#fff');

/** The WHO bands over the 18-cell ramp: low 0–2, moderate 3–5, high 6–7, very high 8–10, extreme 11+. */
const BANDS: [string, number][] = [
  ['live.uv.band_low', 3],
  ['live.uv.band_moderate', 3],
  ['live.uv.band_high', 2],
  ['live.uv.band_very_high', 3],
  ['live.uv.band_extreme', 7],
];
const bandKey = (v: number) => (v < 3 ? 0 : v < 6 ? 1 : v < 8 ? 2 : v < 11 ? 3 : 4);

const LANGS: Lang[] = ['fi', 'en', 'sv'];
const uvPath = (l: Lang) => (l === 'fi' ? '/live/uv/' : `/${l}/live/uv/`);

/** A point the reader clicked on the map, waiting to be added. */
interface Pick {
  lat: number;
  lon: number;
  /** Position in the map box, as fractions — the popup is placed by these. */
  fx: number;
  fy: number;
  place: { name: string; where: string } | null | 'loading';
}

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
  const [pick, setPick] = useState<Pick | null>(null);
  const navigate = useNavigate();
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

  // Name the clicked point. Keyed on the coordinates so a second click cancels
  // the first one's request rather than racing it.
  const pickKey = pick ? `${pick.lat},${pick.lon}` : '';
  useEffect(() => {
    if (!pick || pick.place !== 'loading') return;
    const ac = new AbortController();
    reverseGeocode(pick.lat, pick.lon, getLang(), ac.signal)
      .catch(() => null)
      .then((place) => {
        if (!ac.signal.aborted) setPick((p) => (p ? { ...p, place } : p));
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickKey]);

  useEffect(() => {
    if (!pick) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPick(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pick]);

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

    if (pick) {
      const x = lon2x(pick.lon);
      const y = lat2y(pick.lat);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2.5 * k;
      ctx.beginPath();
      ctx.arc(x, y, 9 * k, 0, 7);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(14,19,25,.9)';
      ctx.lineWidth = 1.2 * k;
      ctx.beginPath();
      ctx.arc(x, y, 11 * k, 0, 7);
      ctx.stroke();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [land, places, dec, dist, ozone, shownWidth, pickKey]);

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
    setPick(null);
  };

  const onPick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const fx = (ev.clientX - r.left) / r.width;
    const fy = (ev.clientY - r.top) / r.height;
    setPick({ lat: 90 - fy * 180, lon: fx * 360 - 180, fx, fy, place: 'loading' });
  };

  const goToday = () => {
    setPlaying(false);
    setYear(thisYear);
    setDay(dayOfYear(Date.now()));
  };
  const isToday = year === thisYear && day === dayOfYear(Date.now());

  const lng = getLang();
  const locale = lng === 'en' ? 'en-GB' : lng;
  const dateLabel = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(dateMs);
  const isoDate = new Date(dateMs).toISOString().slice(0, 10);
  const monthFmt = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
  const chips: [string, number][] = [
    ['live.uvp.eq_mar', 80],
    ['live.uvp.sol_jun', 172],
    ['live.uvp.eq_sep', 266],
    ['live.uvp.sol_dec', 355],
  ];
  const ring = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f59e0b]';
  const pill = `rounded-full border px-3 py-1 text-[12.5px] transition-colors ${ring}`;
  const pillOff = 'border-white/10 bg-white/[.03] text-[#9aa7b6] hover:border-white/25 hover:text-white';
  const pillOn = 'border-amber-400/60 bg-amber-400/15 text-amber-200';
  const card = 'rounded-2xl border border-white/[.07] bg-[#121922]/90 shadow-[0_10px_40px_-12px_rgba(0,0,0,.6)]';
  const range =
    'h-5 w-full cursor-pointer appearance-none bg-transparent [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-white/15 [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-white/15 [&::-webkit-slider-thumb]:-mt-[5px] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_0_0_4px_rgba(245,158,11,.35)] ' +
    ring;
  const probeAlt = probe ? 90 - Math.abs(probe.lat - dec) : 0;
  const livePath = lang && lang !== 'fi' ? `/${lang}/live/` : '/live/';
  const peakOnEarth = noonUvi(dec);
  const pickName =
    pick && pick.place !== 'loading' && pick.place ? pick.place : null;
  const pickLabel = pick ? `${fmtLat(pick.lat)} ${fmtLon(pick.lon)}` : '';

  const stats: [string, string][] = [
    [t('live.uvp.stat_subsolar'), fmtLat(dec)],
    [t('live.uvp.stat_peak'), peakOnEarth.toFixed(1)],
    [t('live.uvp.slider'), `${day} / ${total}`],
  ];

  return (
    <div className="min-h-screen bg-[#0b1016] bg-[radial-gradient(ellipse_80%_45%_at_50%_-10%,rgba(245,158,11,.14),transparent_70%)] text-[15px] leading-normal text-[#e6ebf1] antialiased">
      <div className="mx-auto max-w-[1080px] px-3.5 pb-14 pt-4 sm:px-6 sm:pt-6">
        <nav className="mb-6 flex items-center justify-between gap-3">
          <a href={livePath} className={`rounded-full px-1 text-[13px] text-[#9aa7b6] hover:text-white ${ring}`}>
            {t('live.uvp.back')}
          </a>
          <div role="group" aria-label={t('live.uvp.lang')} className="flex rounded-full border border-white/10 bg-white/[.03] p-0.5">
            {LANGS.map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={lng === l}
                onClick={() => {
                  void setLang(l);
                  navigate(uvPath(l));
                }}
                className={`rounded-full px-3 py-1 text-[12px] font-semibold uppercase tracking-wide ${ring} ${
                  lng === l ? 'bg-white text-[#0b1016]' : 'text-[#9aa7b6] hover:text-white'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </nav>

        <header className="mb-5">
          <h1 className="m-0 flex items-center gap-3 text-[26px] font-bold tracking-tight sm:text-[32px]">
            <span
              aria-hidden="true"
              className="inline-block h-7 w-7 shrink-0 rounded-full bg-[radial-gradient(circle_at_35%_35%,#fde68a,#f59e0b_55%,#e6008e)] shadow-[0_0_24px_rgba(245,158,11,.55)] sm:h-8 sm:w-8"
            />
            {t('live.uvp.title')}
          </h1>
          <p className="mt-1.5 max-w-[62ch] text-[14px] text-[#9aa7b6]">{t('live.uvp.subtitle')}</p>
        </header>

        <dl className="mb-4 grid grid-cols-3 gap-2.5 sm:gap-3">
          {stats.map(([label, value]) => (
            <div key={label} className={`${card} px-3 py-2.5 sm:px-4 sm:py-3`}>
              <dt className="text-[10px] uppercase leading-tight tracking-wider text-[#8e9bab] sm:text-[11.5px]">{label}</dt>
              <dd className="m-0 whitespace-nowrap text-[17px] font-semibold tabular-nums sm:text-[24px]">{value}</dd>
            </div>
          ))}
        </dl>

        <section className={`${card} overflow-hidden p-2 sm:p-3`}>
          <div className="relative overflow-hidden rounded-xl">
            <canvas
              ref={canvasRef}
              width={W}
              height={H}
              className="block h-auto w-full cursor-crosshair touch-manipulation"
              onPointerMove={onMove}
              onPointerLeave={() => setProbe(null)}
              onClick={onPick}
            />
            {probe && !pick && (
              <div className="pointer-events-none absolute left-2.5 top-2.5 rounded-lg border border-white/10 bg-[rgba(10,14,19,.86)] px-3 py-2 text-[12.5px] tabular-nums text-[#9aa7b6] backdrop-blur">
                <strong className="block text-[19px] font-semibold leading-tight text-white">
                  UVI {noonUvi(probe.lat).toFixed(1)}
                </strong>
                {fmtLat(probe.lat)} {fmtLon(probe.lon)} ·{' '}
                {probeAlt > 0
                  ? t('live.uvp.probe_up').replace('{alt}', probeAlt.toFixed(0))
                  : t('live.uvp.probe_below')}
              </div>
            )}
            {pick && (
              <div
                role="dialog"
                aria-label={pickName?.name ?? pickLabel}
                // Beside the point from `sm` up; on a phone the map is too
                // small to hold it, so it sits under the map instead.
                className="mt-2 rounded-xl border border-white/15 bg-[rgba(12,17,23,.95)] p-3 text-[13px] shadow-2xl backdrop-blur sm:absolute sm:left-[var(--px)] sm:top-[var(--py)] sm:z-10 sm:mt-0 sm:w-[260px] sm:[transform:var(--tx)]"
                style={
                  {
                    '--px': `${pick.fx * 100}%`,
                    '--py': `${pick.fy * 100}%`,
                    '--tx': `translate(${pick.fx > 0.6 ? 'calc(-100% - 14px)' : '14px'}, ${pick.fy > 0.55 ? '-100%' : '0'})`,
                  } as React.CSSProperties
                }
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold text-white">
                      {pick.place === 'loading' ? t('live.uvp.pick_loading') : (pickName?.name ?? pickLabel)}
                    </div>
                    <div className="truncate text-[11.5px] tabular-nums text-[#8e9bab]">
                      {pickName ? `${pickLabel}${pickName.where ? ` · ${pickName.where}` : ''}` : pickLabel}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={t('live.uvp.pick_close')}
                    onClick={() => setPick(null)}
                    className={`-mr-1 -mt-1 rounded-full px-2 text-[18px] leading-none text-[#8e9bab] hover:text-white ${ring}`}
                  >
                    ×
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-2 text-[#9aa7b6]">
                  <span
                    className="rounded-md px-2 py-0.5 text-[13px] font-bold tabular-nums"
                    style={{ background: rgb(uvTheoryRgb(noonUvi(pick.lat))), color: inkOn(uvTheoryRgb(noonUvi(pick.lat))) }}
                  >
                    {noonUvi(pick.lat).toFixed(1)}
                  </span>
                  {t('live.uvp.col_uvi')}
                </div>
                <button
                  type="button"
                  disabled={pick.place === 'loading'}
                  onClick={() =>
                    add({
                      name: pickName?.name ?? pickLabel,
                      where: pickName?.where ?? '',
                      lat: Math.round(pick.lat * 100) / 100,
                      lon: Math.round(pick.lon * 100) / 100,
                    })
                  }
                  className={`mt-3 w-full rounded-lg bg-amber-400 px-3 py-1.5 text-[13px] font-semibold text-[#1a1306] hover:bg-amber-300 disabled:opacity-60 ${ring}`}
                >
                  + {t('live.uvp.pick_add')}
                </button>
              </div>
            )}
          </div>

          <div className="px-1 pb-1 pt-3" aria-hidden="true">
            <div className="flex overflow-hidden rounded-full">
              {UV_THEORY_RAMP.map((c, i) => (
                <div key={i} className="h-2.5 flex-1" style={{ background: rgb(c) }} />
              ))}
            </div>
            <div className="mt-1 flex">
              {UV_THEORY_RAMP.map((_, i) => (
                <span key={i} className="flex-1 text-center text-[10px] tabular-nums text-[#8e9bab]">
                  {i === 17 ? '17+' : i}
                </span>
              ))}
            </div>
            <div className="mt-0.5 flex border-t border-white/[.06] pt-1">
              {BANDS.map(([key, cells]) => (
                <span key={key} style={{ flexGrow: cells, flexBasis: 0 }} className="truncate px-0.5 text-center text-[10.5px] text-[#9aa7b6]">
                  {t(key)}
                </span>
              ))}
            </div>
          </div>
          <p className="px-1 pb-1 pt-2 text-[12px] text-[#8e9bab]">{t('live.uvp.click_hint')}</p>
        </section>

        <section className={`${card} mt-4 p-4 sm:p-5`}>
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="min-w-0 flex-1 truncate text-[20px] font-semibold tabular-nums sm:text-[24px]">{dateLabel}</span>
            <button
              type="button"
              disabled={isToday}
              onClick={goToday}
              className={`${pill} shrink-0 whitespace-nowrap ${isToday ? 'border-white/10 text-[#5d6875]' : pillOff}`}
            >
              {t('live.uvp.today')}
            </button>
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              aria-pressed={playing}
              aria-label={playing ? t('live.uvp.pause') : t('live.uvp.play')}
              className={`${pill} shrink-0 whitespace-nowrap font-semibold sm:min-w-[96px] ${playing ? pillOn : 'border-white/20 bg-white text-[#0b1016] hover:bg-white/90'}`}
            >
              {playing ? '❚❚' : '▶'}
              <span className="hidden sm:inline"> {playing ? t('live.uvp.pause') : t('live.uvp.play')}</span>
            </button>
          </div>

          <div className="mt-3">
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
              aria-valuetext={dateLabel}
              className={range}
            />
            <div className="relative mt-1 h-4 text-[10.5px] text-[#8e9bab]" aria-hidden="true">
              {Array.from({ length: 12 }, (_, m) => {
                const at = (Date.UTC(year, m, 1) - Date.UTC(year, 0, 1)) / DAY_MS / (total - 1);
                return (
                  <span
                    key={m}
                    className={`absolute -translate-x-1/2 ${m % 2 ? 'hidden sm:inline' : ''}`}
                    style={{ left: `calc(8px + ${at} * (100% - 16px))` }}
                  >
                    {monthFmt.format(Date.UTC(year, m, 1)).replace('.', '')}
                  </span>
                );
              })}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {chips.map(([key, d]) => (
              <button
                key={key}
                type="button"
                aria-pressed={day === d}
                className={`${pill} ${day === d ? pillOn : pillOff}`}
                onClick={() => {
                  setPlaying(false);
                  setDay(d);
                }}
              >
                {t(key)}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-2 text-[13px] text-[#9aa7b6]">
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
                className={`rounded-lg border border-white/10 bg-white/[.04] px-2 py-1 text-white [color-scheme:dark] ${ring}`}
              />
            </label>
          </div>

          <div className="mt-4 flex items-center gap-3 border-t border-white/[.07] pt-4 text-[13px] text-[#9aa7b6]">
            <label htmlFor="uvp-oz" className="whitespace-nowrap">
              {t('live.uvp.ozone')}
            </label>
            <input
              id="uvp-oz"
              type="range"
              min={220}
              max={400}
              step={5}
              value={ozone}
              onChange={(e) => setOzone(Number(e.target.value))}
              className={`${range} max-w-[260px] flex-1`}
            />
            <b className="min-w-[64px] font-semibold tabular-nums text-white">{ozone} DU</b>
          </div>
        </section>

        <section className={`${card} mt-4 p-4 sm:p-5`}>
          <h2 className="m-0 mb-3 text-[17px] font-semibold">{t('live.uvp.compare')}</h2>
          <div className="relative">
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 fill-none stroke-[#8e9bab] stroke-2"
            >
              <circle cx="8.5" cy="8.5" r="5.5" />
              <path d="m13 13 4.5 4.5" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && results?.[0]) add(results[0]);
              }}
              placeholder={t('live.uvp.search')}
              aria-label={t('live.uvp.search')}
              className={`w-full rounded-xl border border-white/10 bg-white/[.04] py-2.5 pl-9 pr-3 text-white placeholder:text-[#8e9bab] ${ring}`}
            />
            {query.trim().length >= 2 && (searchFailed || results) && (
              <ul className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-xl border border-white/10 bg-[#121922] shadow-2xl">
                {searchFailed ? (
                  <li className="px-3 py-2 text-amber-400">{t('live.uvt.failed')}</li>
                ) : results!.length === 0 ? (
                  <li className="px-3 py-2 text-[#8e9bab]">{t('live.uvt.no_results')}</li>
                ) : (
                  results!.map((r, i) => (
                    <li key={i}>
                      <button type="button" onClick={() => add(r)} className="w-full px-3 py-2 text-left hover:bg-white/[.06]">
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

          <div className="-mx-1 mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-[13px] sm:text-[13.5px]">
              <caption className="px-1 pb-2 text-left text-[12.5px] text-[#8e9bab]">
                {t('live.uvp.caption').replace('{date}', dateLabel).replace('{oz}', String(ozone))}
              </caption>
              <thead>
                <tr className="border-b border-white/10 text-left text-[11.5px] uppercase tracking-wider text-[#8e9bab]">
                  <th className="px-1 pb-2 font-medium">{t('live.uvp.col_place')}</th>
                  <th className="hidden px-1 pb-2 text-right font-medium sm:table-cell">{t('live.uvp.col_noon_sun')}</th>
                  <th className="px-1 pb-2 text-right font-medium">{t('live.uvp.col_uvi')}</th>
                  <th className="px-1 pb-2 text-right font-medium">{t('live.uvp.col_daylight')}</th>
                  <th className="px-1 pb-2 text-right font-medium">{t('live.uvp.col_dose')}</th>
                  <th className="w-8 pb-2" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-1 py-4 text-[#8e9bab]">
                      {t('live.uvp.empty')}
                    </td>
                  </tr>
                )}
                {rows.map(({ p, d }, i) => {
                  const c = uvTheoryRgb(d.peak);
                  return (
                    <tr key={`${p.lat},${p.lon}`} className="border-b border-white/[.05] hover:bg-white/[.025]">
                      <td className="px-1 py-2">
                        <span className="font-medium">{p.name}</span>
                        <span className="block text-[11.5px] tabular-nums text-[#8e9bab]">
                          {fmtLat(p.lat)}
                          {p.where && ` · ${p.where}`}
                        </span>
                      </td>
                      <td className="hidden px-1 text-right tabular-nums sm:table-cell">
                        {d.noonAltitude > 0 ? `${d.noonAltitude.toFixed(0)}°` : t('live.uvp.below')}
                      </td>
                      <td className="px-1 text-right">
                        <span
                          className="inline-block min-w-[3.2em] rounded-md px-2 py-0.5 text-center text-[14px] font-bold tabular-nums"
                          style={{ background: rgb(c), color: inkOn(c) }}
                        >
                          {d.peak.toFixed(1)}
                        </span>
                        <span className="mt-0.5 block text-[10.5px] text-[#8e9bab]">{t(BANDS[bandKey(d.peak)][0])}</span>
                      </td>
                      <td className="px-1 text-right tabular-nums">{d.daylight.toFixed(1)} h</td>
                      <td className="px-1 text-right text-[15px] font-semibold tabular-nums">{d.sed.toFixed(1)}</td>
                      <td className="text-right">
                        <button
                          type="button"
                          aria-label={t('live.uvp.remove').replace('{name}', p.name)}
                          title={t('live.uvp.remove').replace('{name}', p.name)}
                          onClick={() => setPlaces((ps) => ps.filter((_, j) => j !== i))}
                          className={`rounded-full px-2 text-[16px] text-[#8e9bab] hover:bg-white/10 hover:text-white ${ring}`}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="mt-8 max-w-[74ch] space-y-1.5 px-1 text-[12.5px] text-[#8e9bab]">
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
