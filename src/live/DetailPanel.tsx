import React, { useEffect, useState } from 'react';
import { t } from '../utils/i18n';
import { clockSeconds, clockTime, isoDate } from './timeControl';
import { AQ_COLORS, aqBandKey, type AirQuality } from './airquality';
import type { Observation } from './observations';
import type { Incident } from './incidents';
import type { Train } from './trains';
import type { ScheduledTrain } from './trainSchedule';
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
  | { kind: 'observation'; item: Observation }
  | { kind: 'air_quality'; item: AirQuality }
  | { kind: 'incident'; item: Incident };

interface DetailPanelProps {
  selection: Selection;
  /** The page's clock — what the panel reports for. */
  when: Date;
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
          <p className="pt-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
            {t('live.detail.cancelled')}
          </p>
        )}
      </div>

      {failed && !detail && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
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
                  } ${s.passed && i !== nextIndex ? 'text-surface-400 dark:text-surface-500' : 'text-surface-700 dark:text-surface-200'}`}
                >
                  <span className="w-[5ch] shrink-0 tabular-nums">{clockTime(time)}</span>
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  {s.track && (
                    <span className="shrink-0 text-[10px] text-surface-400 dark:text-surface-500">
                      {t('live.detail.platform').replace('{n}', s.track)}
                    </span>
                  )}
                  {late && (
                    <span
                      className={`shrink-0 text-[10px] ${
                        s.lateMinutes && s.lateMinutes > 0
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-surface-400 dark:text-surface-500'
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
      <p className="mt-3 text-[10px] text-surface-400 dark:text-surface-500">
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
      <p className="pt-1 text-[10px] text-surface-400 dark:text-surface-500">
        {t(forecast ? 'live.detail.source_ecmwf' : 'live.detail.source_fmi')}
      </p>
    </div>
  );
};

export const DetailPanel: React.FC<DetailPanelProps> = ({ selection, when, onClose, onTrack }) => {
  const title =
    selection.kind === 'train'
      ? t('live.detail.train').replace('{n}', String(selection.item.number))
      : selection.kind === 'observation'
        ? t('live.detail.weather_station')
        : selection.kind === 'air_quality'
          ? t('live.detail.aq_station')
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

      {selection.kind === 'observation' && <StationBody station={selection.item} />}

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
          <Row label={t('live.detail.measured_at')}>{clockTime(selection.item.at)}</Row>
          <Row label={t('live.detail.coords')}>
            {selection.item.lat.toFixed(3)}, {selection.item.lon.toFixed(3)}
          </Row>
          <p className="pt-1 text-[10px] text-surface-400 dark:text-surface-500">
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
            <Row label={t('live.detail.in_effect')}>
              {selection.item.since ? clockTime(selection.item.since) : '—'}
              {' – '}
              {selection.item.until
                ? clockTime(selection.item.until)
                : t('live.detail.open_ended')}
            </Row>
            {selection.item.since && (
              <Row label={t('live.detail.since_date')}>
                {isoDate(new Date(selection.item.since))}
              </Row>
            )}
          </div>
          <p className="text-[10px] text-surface-400 dark:text-surface-500">
            {t('live.detail.source_road')}
          </p>
        </div>
      )}
    </aside>
  );
};
