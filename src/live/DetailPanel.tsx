import React, { useEffect, useState } from 'react';
import { t } from '../utils/i18n';
import { clockSeconds, clockTime, timeOnDay } from './timeControl';
import { AQ_COLORS, aqBandKey, type AirQuality } from './airquality';
import { formatOktas, isObscured, oktaKey, type CloudStation } from './clouds';
import type { Observation } from './observations';
import { windCompassKey, type WindTimelineSample } from './wind';
import { formatSealevelCm, type SealevelTimelineSample } from './sealevel';
import type { Incident } from './incidents';
import type { Strike } from './lightning';
import type { Train } from './trains';
import type { ScheduledTrain } from './trainSchedule';
import {
  shipCategoryKey,
  navStatusKey,
  isMakingWay,
  type Ship,
  type VesselMeta,
  type VesselMetaMap,
} from './ships';
import {
  fetchTrainDetail,
  fetchTrainTrack,
  fixAt,
  type TrainDetail,
  type TrainFix,
} from './trainDetail';

/**
 * What one marker on /live/ actually is, when you ask it.
 *
 * The map's own panels answer this from data already in memory. This one mostly
 * cannot: the national feeds are deliberately thin — the train feed is 2.4 kB for
 * the whole country precisely BECAUSE it carries a number and a speed and nothing
 * else — so the depth is fetched per selection and only when a selection exists.
 * A hundred trains' timetables is 3.9 MB; one train's is 2.4 kB.
 *
 * IT ANSWERS FOR THE CLOCK, NOT FOR THE CLICK. The station rows are the values
 * the page's timeline holds for whatever instant the bar is showing — the caller
 * re-resolves the selection as the clock moves — so scrubbing changes the number
 * in the panel at the same moment it changes the number on the map, and the row
 * beside it states which instant that number belongs to.
 *
 * WHAT IT WILL NOT DO. Every line in here is something a publisher published. A
 * forecast is drawn from ECMWF's published series and is labelled a forecast in
 * the row and again in the note under it; a timetable position is Fintraffic's
 * published times at its own control points, and the panel names the two it sits
 * between; a stop with no reported time shows no time. Nothing here averages,
 * extrapolates, or prints a derived value in the same voice as a measured one.
 */

export type Selection =
  | { kind: 'train'; item: Train }
  | { kind: 'ship'; item: Ship }
  | { kind: 'observation'; item: Observation }
  | { kind: 'air_quality'; item: AirQuality }
  | { kind: 'clouds'; item: CloudStation }
  | { kind: 'wind'; item: WindTimelineSample }
  | { kind: 'sea_level'; item: SealevelTimelineSample }
  | { kind: 'incident'; item: Incident }
  | { kind: 'lightning'; item: Strike };

interface DetailPanelProps {
  selection: Selection;
  /** The page's clock — what the panel reports for. */
  when: Date;
  /**
   * The vessel register, so a selected ship can be named and typed.
   *
   * Kept out of the position feed and joined here by MMSI, so the panel shows the
   * name and declared destination the vessel is broadcasting NOW rather than
   * whatever a scrubbed snapshot happened to carry. Undefined until it loads.
   */
  shipMeta?: VesselMetaMap;
  onClose: () => void;
  /**
   * The selected train's measured track for its departure date.
   *
   * Handed up rather than kept here because the MAP needs it: it draws the route
   * as a line and places the train at the scrubbed instant from it. Null clears.
   */
  onTrack: (track: TrainFix[] | null) => void;
}

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex gap-2 text-xs">
    <span className="shrink-0 text-surface-500 dark:text-surface-400">{label}</span>
    <span className="ml-auto text-right font-medium text-surface-800 dark:text-surface-100">
      {children}
    </span>
  </div>
);

/**
 * Fintraffic's delay figure, in words.
 *
 * Their `differenceInMinutes`, not a subtraction of the two timestamps a client
 * can see: those differ against the working timetable in ways only the operator
 * knows about. Zero is stated as "on time" rather than as "0 min", because a
 * bare zero next to a station reads as a missing value.
 */
function delayText(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (minutes === 0) return t('live.detail.ontime');
  const key = minutes > 0 ? 'live.detail.late' : 'live.detail.early';
  return t(key).replace('{n}', String(Math.abs(minutes)));
}

/** True when this train was placed from the timetable rather than from a fix. */
const isScheduled = (train: Train): train is ScheduledTrain =>
  (train as ScheduledTrain).scheduled === true;

/** The train's timetable and measured track, fetched on selection. */
const TrainBody: React.FC<{ train: Train; when: Date; onTrack: DetailPanelProps['onTrack'] }> = ({
  train,
  when,
  onTrack,
}) => {
  const [detail, setDetail] = useState<TrainDetail | null>(null);
  const [track, setTrack] = useState<TrainFix[] | null>(null);
  const [failed, setFailed] = useState(false);
  // The departure date is what makes the number identify a train (see
  // trains.ts). Without it there is nothing to ask, so the panel says what it
  // knows from the position feed and stops there.
  const date = train.date;
  const number = train.number;

  useEffect(() => {
    if (!date) return;
    const ac = new AbortController();
    setDetail(null);
    setTrack(null);
    setFailed(false);
    // Separate promises rather than Promise.all: the timetable is 2.4 kB and the
    // track is 52 kB, so waiting for both would hold a fast answer behind a slow
    // one — and either failing alone should not blank the other.
    fetchTrainDetail(number, date, ac.signal)
      .then(setDetail)
      .catch((e: unknown) => {
        if ((e as Error)?.name !== 'AbortError') setFailed(true);
      });
    fetchTrainTrack(number, date, ac.signal)
      .then((fixes) => {
        setTrack(fixes);
        onTrack(fixes);
      })
      .catch(() => {
        /* the timetable alone is a useful panel */
      });
    return () => {
      ac.abort();
      onTrack(null);
    };
  }, [number, date, onTrack]);

  const atWhen = track ? fixAt(track, when.getTime()) : null;
  const stops = detail?.stops ?? [];
  // The next stop the train has not reached, which is the row a reader wants
  // first. Past the last one this is undefined and the list simply starts at the
  // top, which is right for a completed run.
  const nextIndex = stops.findIndex((s) => !s.passed);

  return (
    <>
      <div className="space-y-1">
        {detail && (
          <Row label={t('live.detail.type')}>
            {[detail.type, detail.line || null, detail.category].filter(Boolean).join(' · ')}
          </Row>
        )}
        {detail?.operator && (
          <Row label={t('live.detail.operator')}>{detail.operator.toUpperCase()}</Row>
        )}
        {train.speed !== null && (
          <Row label={t('live.detail.speed')}>{Math.round(train.speed)} km/h</Row>
        )}
        {isScheduled(train) ? (
          /* THE DOT ON THE MAP IS NOT A FIX AND THIS IS WHERE IT SAYS SO. The
             segment is named because that is the whole content of the claim —
             the train is published as passing these two control points at these
             two times, and the diamond sits between them in proportion. Whether
             those times are measured passings or the plan is the difference
             between an interpolation bounded by measurements and a picture of
             the timetable, so it gets its own line rather than a footnote. */
          <>
            <Row label={t('live.detail.position_from')}>
              {t(train.fromActual ? 'live.detail.between_actual' : 'live.detail.between_planned')
                .replace('{from}', train.fromCode)
                .replace('{to}', train.toCode)}
            </Row>
            <p className="pt-1 text-[10px] leading-snug text-surface-500 dark:text-surface-400">
              {t('live.detail.schedule_note')}
            </p>
          </>
        ) : (
          <Row label={t('live.detail.measured_at')}>{clockSeconds(train.at)}</Row>
        )}
        {/* The scrubbed-time answer, and it is allowed to be "we do not know".
            Fixes land about every five seconds while a train moves, so a gap
            means a tunnel, a yard, or a train that had not departed — none of
            which is a reason to draw a position. */}
        {track && (
          <Row label={t('live.detail.at_clock').replace('{time}', clockTime(when))}>
            {atWhen ? (
              <>
                {clockSeconds(atWhen.at)}
                {atWhen.speed !== null && ` · ${Math.round(atWhen.speed)} km/h`}
              </>
            ) : (
              <span className="text-surface-500 dark:text-surface-400">
                {t('live.detail.no_fix')}
              </span>
            )}
          </Row>
        )}
        {track && (
          <Row label={t('live.detail.fixes')}>{track.length}</Row>
        )}
        {detail?.cancelled && (
          <p className="pt-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
            {t('live.detail.cancelled')}
          </p>
        )}
      </div>

      {failed && !detail && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          {t('live.detail.failed')}
        </p>
      )}
      {!detail && !failed && date && (
        <p className="mt-2 text-xs text-surface-500 dark:text-surface-400">
          {t('live.detail.loading')}
        </p>
      )}

      {stops.length > 0 && (
        <>
          <h4 className="mt-3 text-[11px] font-bold uppercase tracking-wider text-surface-500 dark:text-surface-400">
            {t('live.detail.stops')}
          </h4>
          <ol className="mt-1 space-y-0.5">
            {stops.map((s, i) => {
              const time = s.departure ?? s.arrival;
              const late = delayText(s.lateMinutes);
              return (
                <li
                  key={`${s.code}-${i}`}
                  className={`flex items-baseline gap-2 text-xs ${
                    i === nextIndex ? 'font-semibold text-surface-900 dark:text-white' : ''
                  } ${s.passed && i !== nextIndex ? 'text-surface-500 dark:text-surface-400' : 'text-surface-700 dark:text-surface-200'}`}
                >
                  <span className="w-[5ch] shrink-0 tabular-nums">{clockTime(time)}</span>
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  {s.track && (
                    <span className="shrink-0 text-[10px] text-surface-500 dark:text-surface-400">
                      {t('live.detail.platform').replace('{n}', s.track)}
                    </span>
                  )}
                  {late && (
                    <span
                      className={`shrink-0 text-[10px] ${
                        s.lateMinutes && s.lateMinutes > 0
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-surface-500 dark:text-surface-400'
                      }`}
                    >
                      {late}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
      <p className="mt-3 text-[10px] text-surface-500 dark:text-surface-400">
        {t('live.detail.source_rail')}
      </p>
    </>
  );
};

/**
 * A weather station, as of the clock: what it measured, or what is forecast.
 *
 * ONE NUMBER, NOT TWO. This used to print the measurement it was clicked with
 * and then, for a future clock, fetch a separate point forecast and print that
 * underneath — two temperatures for one station, from two different models, one
 * of them describing an instant the reader was no longer looking at. Now the
 * page's timeline already holds ECMWF's forecast for this station and hour (see
 * observations.ts), so the panel prints the same value the map is drawing, and
 * the LABELS change with it: what it is called, when it is for, and the note
 * underneath.
 */
const StationBody: React.FC<{ station: Observation }> = ({ station }) => {
  const forecast = station.forecast === true;
  return (
    <div className="space-y-1">
      <Row label={t(forecast ? 'live.detail.forecast' : 'live.detail.temperature')}>
        {station.celsius.toFixed(1)} °C
      </Row>
      {/* The value's OWN instant, which is not the clock's: the series is hourly
          and the reader is entitled to know they are looking at 14:00's number
          under a playhead sitting at 14:23. */}
      <Row label={t(forecast ? 'live.detail.forecast_for' : 'live.detail.measured_at')}>
        {clockTime(station.at)}
      </Row>
      <Row label={t('live.detail.coords')}>
        {station.lat.toFixed(3)}, {station.lon.toFixed(3)}
      </Row>
      {forecast && (
        <p className="pt-1 text-[10px] leading-snug text-surface-500 dark:text-surface-400">
          {t('live.detail.forecast_note')}
        </p>
      )}
      <p className="pt-1 text-[10px] text-surface-500 dark:text-surface-400">
        {t(forecast ? 'live.detail.source_ecmwf' : 'live.detail.source_fmi')}
      </p>
    </div>
  );
};

/**
 * Cloud amount at a station, as of the sample under the clock.
 *
 * FMI's own `n_man` in oktas — eighths of the sky covered — printed as the fraction
 * and named in the conventional band beside it, because "5/8" is what a reader can
 * check and "mostly cloudy" is what they think in. A sky the observer could not see
 * (okta 9) says exactly that rather than a spurious eighth. Nothing here is derived;
 * the band is a labelling of the published count, not a second measurement.
 */
const CloudBody: React.FC<{ station: CloudStation }> = ({ station }) => {
  const obscured = isObscured(station.oktas);
  return (
    <div className="space-y-1">
      <Row label={t('live.detail.cloud_cover')}>
        {obscured
          ? t('live.clouds.band_obscured')
          : `${formatOktas(station.oktas)} · ${t(oktaKey(station.oktas))}`}
      </Row>
      {/* The value's OWN instant — cloud amount is reported on the stations'
          ten-minute cycle and the reader is entitled to know they are looking at
          14:00's sky under a playhead at 14:23. */}
      <Row label={t('live.detail.measured_at')}>{clockTime(station.at)}</Row>
      <Row label={t('live.detail.coords')}>
        {station.lat.toFixed(3)}, {station.lon.toFixed(3)}
      </Row>
      <p className="pt-1 text-[10px] text-surface-500 dark:text-surface-400">
        {t('live.detail.source_fmi')}
      </p>
    </div>
  );
};

/**
 * Wind at a station, as of the sample under the clock.
 *
 * Everything is FMI's own measurement: the 10-minute mean speed, its gust, and
 * the direction it blows FROM (`wd_10min`, meteorological convention) — stated in
 * words and degrees, because "southwesterly" is what a reader thinks in and the
 * number is what they can check. km/h is derived beside the published m/s, the
 * one unit conversion, exact. A calm or variable station reports no bearing, so
 * the direction row says so rather than printing a spurious compass point.
 */
const WindBody: React.FC<{ wind: WindTimelineSample }> = ({ wind }) => {
  return (
    <div className="space-y-1">
      <Row label={t('live.detail.wind')}>
        {wind.speed.toFixed(1)} m/s · {Math.round(wind.speed * 3.6)} km/h
      </Row>
      {wind.gust !== null && (
        <Row label={t('live.detail.gust')}>
          {wind.gust.toFixed(1)} m/s · {Math.round(wind.gust * 3.6)} km/h
        </Row>
      )}
      <Row label={t('live.detail.wind_from')}>
        {wind.dir === null
          ? t('live.wind.dir.variable')
          : `${t(windCompassKey(wind.dir))} · ${Math.round(wind.dir)}°`}
      </Row>
      {/* The value's OWN instant — the series is 10-minutely and the reader is
          entitled to know they are looking at 14:00's wind under a playhead at
          14:23. */}
      <Row label={t('live.detail.measured_at')}>{clockTime(wind.at)}</Row>
      <Row label={t('live.detail.coords')}>
        {wind.lat.toFixed(3)}, {wind.lon.toFixed(3)}
      </Row>
      <p className="pt-1 text-[10px] text-surface-500 dark:text-surface-400">
        {t('live.detail.source_fmi')}
      </p>
    </div>
  );
};

/**
 * Sea level at a tide gauge, as of the sample under the clock.
 *
 * The headline is the water level as a signed anomaly — FMI's WATLEV, the height
 * above this gauge's theoretical mean water — because that is the number that
 * says "the sea is high" or "the sea is low", and the note under it states the
 * reference in words so the sign is not left to guess. The N2000 height and the
 * hourly sea-water temperature are FMI's own two other readings from the same
 * gauge, shown only when reported; nothing here is derived. cm from the published
 * mm is the one conversion, exact.
 */
const SealevelBody: React.FC<{ sample: SealevelTimelineSample }> = ({ sample }) => {
  return (
    <div className="space-y-1">
      <Row label={t('live.detail.sea_level')}>{formatSealevelCm(sample.level)} cm</Row>
      <p className="text-[10px] leading-snug text-surface-500 dark:text-surface-400">
        {t('live.detail.sea_level_ref')}
      </p>
      {sample.n2000 !== null && (
        <Row label={t('live.detail.sea_level_n2000')}>{(sample.n2000 / 10).toFixed(0)} cm</Row>
      )}
      {sample.temp !== null && (
        <Row label={t('live.detail.sea_temp')}>{sample.temp.toFixed(1)} °C</Row>
      )}
      {/* The value's OWN instant — the gauges report hourly and the reader is
          entitled to know they are looking at 14:00's level under a playhead at
          14:23. */}
      <Row label={t('live.detail.measured_at')}>{clockTime(sample.at)}</Row>
      <Row label={t('live.detail.coords')}>
        {sample.lat.toFixed(3)}, {sample.lon.toFixed(3)}
      </Row>
      <p className="pt-1 text-[10px] text-surface-500 dark:text-surface-400">
        {t('live.detail.source_fmi')}
      </p>
    </div>
  );
};

/**
 * A vessel, as of the fix under the clock: what AIS measured, joined to the
 * register's name and type.
 *
 * Everything here is broadcast — the position, course and speed off the
 * transponder, the name and declared destination out of the vessel register — so
 * nothing is derived except the two units printed beside a measured one (knots to
 * km/h, decimetres to metres, both exact). The destination is reproduced verbatim
 * for the same reason a road announcement is: it is an AIS free-text field the
 * skipper typed, and rewriting "SE GVX" into prose would be inventing wording
 * nobody broadcast. A position too old to trust still prints its exact age rather
 * than being smoothed into "now".
 */
const ShipBody: React.FC<{ ship: Ship; meta: VesselMeta | null }> = ({ ship, meta }) => {
  const status = navStatusKey(ship.navStat);
  return (
    <div className="space-y-1">
      <Row label={t('live.detail.type')}>{t(`live.ship.type.${shipCategoryKey(meta?.shipType ?? null)}`)}</Row>
      {ship.sog !== null && (
        <Row label={t('live.detail.speed')}>
          {ship.sog.toFixed(1)} kn · {Math.round(ship.sog * 1.852)} km/h
        </Row>
      )}
      {/* Course only for a vessel making way — see isMakingWay: a moored hull's
          reported course is not a bearing it is travelling on. */}
      {ship.cog !== null && isMakingWay(ship.sog) && (
        <Row label={t('live.detail.course')}>{Math.round(ship.cog)}°</Row>
      )}
      {status && <Row label={t('live.detail.status')}>{t(`live.ship.status.${status}`)}</Row>}
      {meta?.destination && (
        <Row label={t('live.detail.destination')}>{meta.destination}</Row>
      )}
      {meta?.draughtM !== null && meta?.draughtM !== undefined && (
        <Row label={t('live.detail.draught')}>{meta.draughtM.toFixed(1)} m</Row>
      )}
      <Row label={t('live.detail.mmsi')}>{ship.mmsi}</Row>
      {/* The fix's OWN instant. A vessel that lost coverage keeps its last
          position in the feed, so the age is the difference between "here now"
          and "here when we last heard". */}
      <Row label={t('live.detail.measured_at')}>{clockSeconds(ship.at)}</Row>
      <Row label={t('live.detail.coords')}>
        {ship.lat.toFixed(3)}, {ship.lon.toFixed(3)}
      </Row>
      <p className="pt-1 text-[10px] text-surface-500 dark:text-surface-400">
        {t('live.detail.source_marine')}
      </p>
    </div>
  );
};

export const DetailPanel: React.FC<DetailPanelProps> = ({
  selection,
  when,
  shipMeta,
  onClose,
  onTrack,
}) => {
  // Escape closes it, matching the sidebar (FeedSidebar binds the same key). The
  // panel is a non-modal inspector — it does not trap focus — but a keyboard or
  // AT user still needs a dismiss that is not a mouse click on empty map. Both
  // overlays closing on one Escape is expected and fine.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const shipMetaEntry =
    selection.kind === 'ship' ? shipMeta?.get(selection.item.mmsi) ?? null : null;
  const title =
    selection.kind === 'train'
      ? t('live.detail.train').replace('{n}', String(selection.item.number))
      : selection.kind === 'ship'
        ? shipMetaEntry?.name ?? t('live.detail.vessel')
        : selection.kind === 'observation'
          ? t('live.detail.weather_station')
          : selection.kind === 'air_quality'
            ? t('live.detail.aq_station')
            : selection.kind === 'clouds'
              ? t('live.detail.cloud_station')
              : selection.kind === 'wind'
              ? t('live.detail.wind_station')
              : selection.kind === 'sea_level'
                ? t('live.detail.sea_level_station')
                : selection.kind === 'lightning'
                  ? t('live.detail.strike')
                  : t('live.detail.announcement');

  return (
    <aside
      // A dialog would trap focus and demand dismissal; this is an inspector
      // beside the map, and the map stays usable while it is open — clicking
      // another marker simply replaces its contents.
      aria-label={title}
      className="absolute right-3 top-3 z-10 max-h-[min(70vh,32rem)] w-[19rem] max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-lg bg-white/95 p-3 shadow-lg ring-1 ring-surface-200 backdrop-blur dark:bg-surface-950/95 dark:ring-surface-800"
    >
      <div className="mb-2 flex items-start gap-2">
        <h3 className="min-w-0 flex-1 text-sm font-bold text-surface-900 dark:text-white">
          {title}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('live.detail.close')}
          className="-mr-1 -mt-1 shrink-0 rounded px-1.5 py-0.5 text-surface-500 hover:text-surface-900 dark:text-surface-400 dark:hover:text-white"
        >
          ×
        </button>
      </div>

      {selection.kind === 'train' && (
        <TrainBody train={selection.item} when={when} onTrack={onTrack} />
      )}

      {selection.kind === 'ship' && <ShipBody ship={selection.item} meta={shipMetaEntry} />}

      {selection.kind === 'observation' && <StationBody station={selection.item} />}

      {selection.kind === 'clouds' && <CloudBody station={selection.item} />}

      {selection.kind === 'wind' && <WindBody wind={selection.item} />}

      {selection.kind === 'sea_level' && <SealevelBody sample={selection.item} />}

      {selection.kind === 'air_quality' && (
        <div className="space-y-1">
          <Row label={t('live.detail.index')}>
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-full"
                style={{
                  backgroundColor:
                    AQ_COLORS[Math.min(5, Math.max(1, Math.round(selection.item.index)))],
                }}
              />
              {selection.item.index.toFixed(0)} · {t(aqBandKey(selection.item.index))}
            </span>
          </Row>
          {/* NOT "Measured at". `AQINDEX_PT1H_avg` is what the name says — an
              average over an hour — and labelling a period's mean with a single
              clock time and the word "measured" states an instantaneous reading
              this station never took. The stamp itself is FMI's own and stays
              exactly as published; only the claim about what it is changes. No
              hour RANGE is printed, because whether the stamp marks the start or
              the end of its hour is not something this page has confirmed, and
              guessing it would swap one misstatement for another. */}
          <Row label={t('live.detail.aq_hour')}>{clockTime(selection.item.at)}</Row>
          <Row label={t('live.detail.coords')}>
            {selection.item.lat.toFixed(3)}, {selection.item.lon.toFixed(3)}
          </Row>
          <p className="pt-1 text-[10px] text-surface-500 dark:text-surface-400">
            {t('live.detail.source_fmi')}
          </p>
        </div>
      )}

      {selection.kind === 'lightning' && (
        <div className="space-y-1">
          {/* THE SECOND, NOT THE MINUTE. A flash is an instant, and it is the one
              thing on this page whose timestamp is worth reading to the second —
              the map's window is half an hour wide, so "14:23" would place it
              anywhere in a minute during which a cell can produce a dozen more. */}
          <Row label={t('live.detail.struck_at')}>{clockSeconds(selection.item.at)}</Row>
          <Row label={t('live.detail.strike_type')}>
            {t(selection.item.ground ? 'live.detail.type_ground' : 'live.detail.type_cloud')}
          </Row>
          {/* SIGNED, AND THE SIGN IS THE DATA. Negative is the ordinary polarity
              for a ground flash — 89 % of them in the sample lightning.ts
              measured — so printing the magnitude alone would throw away the
              distinction that makes a positive flash notable. Null when the
              network located the flash but published no current, which prints
              nothing rather than a zero. */}
          {selection.item.kiloamps !== null && (
            <Row label={t('live.detail.peak_current')}>
              {selection.item.kiloamps.toFixed(0)} kA
            </Row>
          )}
          <Row label={t('live.detail.coords')}>
            {selection.item.lat.toFixed(3)}, {selection.item.lon.toFixed(3)}
          </Row>
          <p className="pt-1 text-[10px] leading-snug text-surface-500 dark:text-surface-400">
            {t('live.detail.strike_note')}
          </p>
          <p className="pt-1 text-[10px] text-surface-500 dark:text-surface-400">
            {t('live.detail.source_fmi')}
          </p>
        </div>
      )}

      {selection.kind === 'incident' && (
        <div className="space-y-2">
          {/* Reproduced as published, Finnish, whatever the app's locale — see
              incidents.ts. Machine-translating an official traffic announcement
              would be inventing wording nobody issued. */}
          <p className="text-xs leading-snug text-surface-800 dark:text-surface-100">
            {selection.item.title}
          </p>
          {selection.item.notes.length > 0 && (
            <ul className="list-inside list-disc space-y-0.5 text-xs text-surface-700 dark:text-surface-200">
              {selection.item.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <div className="space-y-1">
            {selection.item.municipality && (
              <Row label={t('live.detail.municipality')}>{selection.item.municipality}</Row>
            )}
            {/* Both ends carry their date when they are not on the day under
                the playhead. A closure from the 14th to the 18th used to read
                "21:00 – 05:00", which is not an incomplete statement of a
                four-day closure — it is a complete statement of an overnight
                one. The separate `since_date` row that used to sit below is
                gone with it: it dated only the start, never the end, and the
                window now says it in the place it is read. */}
            <Row label={t('live.detail.in_effect')}>
              {timeOnDay(selection.item.since ?? null, when)}
              {' – '}
              {selection.item.until
                ? timeOnDay(selection.item.until, when)
                : t('live.detail.open_ended')}
            </Row>
          </div>
          <p className="text-[10px] text-surface-500 dark:text-surface-400">
            {t('live.detail.source_road')}
          </p>
        </div>
      )}
    </aside>
  );
};
