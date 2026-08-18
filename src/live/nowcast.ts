/**
 * The rain FORECAST for /live/, from MET Norway's Nordic radar nowcast.
 *
 * Source: `thredds.met.no/thredds/wms/radarnowcasting/…nordiclcc-1000.<run>.nc`,
 * layer `lwe_precipitation_rate`, NLOD and CC BY 4.0, no API key,
 * `Access-Control-Allow-Origin: *` on GetCapabilities, GetMap and the catalogue.
 * One kilometre, five-minute steps, **115 minutes ahead of its own analysis**,
 * republished every five minutes about seven minutes after the scan it starts
 * from. MET's terms ask that the name "Yr" and its logo are not used, so neither
 * appears anywhere in this codebase or on the page.
 *
 * WHY A SECOND PUBLISHER AT ALL. FMI has no rain forecast a browser can draw —
 * radar.ts records the enumeration — and the alternative to a second publisher is
 * not "no forecast", it is US extrapolating FMI's composite forward, which is a
 * model of our own making dressed as data. This file exists so that the answer to
 * "will it rain here in an hour" is somebody's published forecast or nothing.
 *
 * AND WHY THIS ONE. The nowcast is built on a Nordic radar mosaic whose node list
 * is `norsg,noand,…,fianj,fikan,fikes,fikor,fikuo,filuo,finur,fipet,fiuta,fivih,
 * fivim,seang,…` — every one of FMI's eleven radars is in it. Over Finland this
 * is therefore the forward continuation of the very measurement the page already
 * draws, made by the agency that runs the joint Nordic model, and not a third
 * party's re-analysis of somebody's pictures. It carries MET's own advection
 * fields (`rev_u_displacement`, `rev_v_displacement`) and a
 * `forecast_reference_time`, which is the instant this page prints as the scan
 * the forecast was made from.
 *
 * MEASURED BEATS FORECAST OUTRIGHT, and the seam is at the wall clock rather
 * than at whichever picture happens to be nearer — the same rule, for the same
 * reason, as `sampleTimeline`'s. The reel asks FMI for every instant at or before
 * now and asks this for every instant after it; the run's window opens at its own
 * analysis, a few minutes in the past, and that overlap is deliberately never
 * used. A model's picture of a minute that has already happened is superseded
 * data, not a second opinion.
 *
 * THE PALETTE IS MET'S OWN (`metnoprecipitation`), for the same reason FMI's grey
 * wash is kept: the publisher has already decided how their field should read,
 * and it happens to be nothing like FMI's cyan dBZ ramp, so the two halves of
 * this layer are told apart at a glance without anything invented here. Measured
 * by GetFeatureInfo against the rendered pixels: 0.12 mm/h is white, 0.17 teal,
 * 0.21 blue, 0.29 indigo, 0.42 violet, 0.56 purple, 0.75 magenta, and it runs on
 * to red. What IS ours is the floor — `colorscalerange` starts at 0.1 mm/h with
 * `belowmincolor=transparent`, because ncWMS's default paints every value
 * including zero and a layer that fills the map with "no rain" is not a map.
 * 0.1 mm/h is the conventional threshold for measurable precipitation.
 *
 * FOUR FAILURE SHAPES, ALL OF WHICH LOOK LIKE SUCCESS IF UNCHECKED:
 *  - a run that has not been published yet answers **HTTP 500 with an 11 kB
 *    Tomcat HTML page**, not a WMS ServiceException, so the status and the
 *    content type both have to be read;
 *  - an instant outside a published run's window answers **HTTP 400** with a
 *    proper ServiceException — a different thing, and not an error;
 *  - `…/radarnowcasting/latest.xml` answers 500, so there is no stable alias and
 *    the run has to be found by walking the five-minute grid backwards;
 *  - and ncWMS SNAPS a requested time to the nearest step, so 08:01 and 08:02
 *    return byte-identical images. Quantising before asking is not politeness
 *    here, it is the only way the request count means anything.
 *
 * thredds.met.no is a shared research service whose own catalogue page asks
 * callers not to open parallel sessions, and a Finland-sized GetMap measured 1–2
 * seconds against FMI's sub-second. Hence {@link RadarReel.forecastInflight},
 * which holds this to one request at a time, and the run cache below, which holds
 * the capabilities lookup to one per {@link NOWCAST_RUN_TTL_MS}.
 */
import {
  frameBounds,
  mercatorBboxParam,
  radarFrameAt,
  RADAR_STEP_MS,
  type RadarFrame,
  type RadarSize,
} from './radar';
import type { Bbox } from './shadows';

const ENDPOINT = 'https://thredds.met.no/thredds/wms/radarnowcasting';
const LAYER = 'lwe_precipitation_rate';
/** The dataset's own name, minus the run stamp this appends. */
const DATASET = 'yrwms-nordic.mos.pcappi-0-rr.noclass-clfilter-novpr-clcorr-block.nordiclcc-1000';

/**
 * How far back to look for a published run, in five-minute steps.
 *
 * Publication latency measured at about seven minutes (the 07:10Z run appeared
 * at 07:16:54Z), so two steps usually finds it and six covers a service that has
 * fallen half an hour behind. Past that there is no useful nowcast to draw and
 * the page says so rather than walking the whole morning.
 */
const RUN_SEARCH_STEPS = 6;

/** How long a resolved run is reused before the catalogue is asked again. */
export const NOWCAST_RUN_TTL_MS = 600_000;

/** One published nowcast run: which scan it starts from, and how far it reaches. */
export interface NowcastRun {
  /** `forecast_reference_time` — the radar picture this was extrapolated from. */
  analysis: number;
  /** The run's first and last valid instants, as its capabilities state them. */
  from: number;
  to: number;
}

/** `20260818T071500Z`, the run stamp in the dataset's filename. */
function runStamp(analysis: number): string {
  return `${new Date(analysis).toISOString().slice(0, 16).replace(/[-:]/g, '')}00Z`;
}

function datasetUrl(analysis: number): string {
  return `${ENDPOINT}/${DATASET}.${runStamp(analysis)}.nc`;
}

/**
 * The newest published run, resolved by walking the five-minute grid backwards.
 *
 * Reads the run's OWN capabilities rather than assuming the horizon, so the
 * window this page offers is the one MET states — `2026-08-18T07:15:00.000Z/
 * 2026-08-18T09:10:00.000Z/PT5M` on the run measured while writing this. The
 * document is 4.7 kB and uncompressed on the wire, against 14.7 kB for the
 * catalogue listing that is the other way to find the same thing, and unlike the
 * catalogue it answers the horizon question too.
 *
 * Cached module-side, because the clock crossing "now" flips this on and off and
 * a reader scrubbing either side of the present would otherwise re-resolve the
 * same run several times a minute.
 */
let cached: { run: NowcastRun; at: number } | null = null;

export async function fetchNowcastRun(now: number, signal?: AbortSignal): Promise<NowcastRun> {
  if (cached && now - cached.at < NOWCAST_RUN_TTL_MS && cached.run.to > now) return cached.run;

  for (let i = 0; i <= RUN_SEARCH_STEPS; i++) {
    const analysis = radarFrameAt(now) - i * RADAR_STEP_MS;
    const res = await fetch(
      `${datasetUrl(analysis)}?service=WMS&version=1.3.0&request=GetCapabilities`,
      { signal },
    );
    // An unpublished run is a Tomcat HTML 500, which is why this cannot simply
    // trust `res.ok`, and why a non-XML body is treated as "not this one" rather
    // than as a broken service.
    if (!res.ok) continue;
    const extent = /<Dimension name="time"[^>]*>([^<]+)</.exec(await res.text())?.[1];
    // TRIMMED PER PART, and it is not tidiness. ncWMS pretty-prints the extent
    // onto its own indented line, so the captured text is
    // `"\n            2026-08-18T07:40:00.000Z/…/PT5M\n        "` — and
    // `Date.parse` of an ISO string with leading whitespace is NaN, not a date.
    // Unhandled, that made every run in the walk look unpublished and the
    // forecast half of this layer report "could not load" against a service
    // answering 200.
    const [from, to] = (extent ?? '').split('/').map((p) => p.trim());
    const fromMs = Date.parse(from ?? '');
    const toMs = Date.parse(to ?? '');
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) continue;
    const run = { analysis: fromMs, from: fromMs, to: toMs };
    cached = { run, at: now };
    return run;
  }
  throw new Error('nowcast: no published run');
}

/** The GetMap URL for one nowcast step. Exported so a test can read it. */
export function nowcastUrl(
  run: NowcastRun,
  bbox: Bbox,
  size: RadarSize,
  at: number,
): string {
  const q = new URLSearchParams({
    service: 'WMS',
    version: '1.3.0',
    request: 'GetMap',
    layers: LAYER,
    // ncWMS names a style as `<plot type>/<palette>`; `default-scalar` is the
    // plain filled raster, which is the only one of the four that reads as a
    // rain field rather than as a chart.
    styles: 'default-scalar/metnoprecipitation',
    format: 'image/png',
    transparent: 'true',
    crs: 'EPSG:3857',
    bbox: mercatorBboxParam(bbox),
    width: String(size.width),
    height: String(size.height),
    // Below 0.1 mm/h nothing is drawn; above 20 the top of the ramp holds. Log,
    // because rain rate is: drizzle and a cloudburst are two orders apart and a
    // linear ramp spends the whole palette on the top one.
    colorscalerange: '0.1,20',
    logscale: 'true',
    belowmincolor: 'transparent',
    abovemaxcolor: 'extend',
    time: new Date(at).toISOString().replace(/\.\d{3}Z$/, '.000Z'),
  });
  return `${datasetUrl(run.analysis)}?${q}`;
}

/**
 * ONE nowcast step, for ONE instant. `null` means the run does not hold it.
 *
 * Same contract as `fetchRadarFrame`, and for the same reason: "MET's run does
 * not reach 10:30" is an answer, not a failure, and printing it as "could not
 * load" would be a lie about a service that is working. A transport failure
 * still throws.
 *
 * Both non-success shapes collapse to null on purpose. HTTP 400 is the run
 * refusing an instant outside its window; HTTP 500 is the run's file having
 * rotated out from under us, which the next {@link fetchNowcastRun} will notice.
 * Neither is worth an amber sentence.
 */
export async function fetchNowcastFrame(
  run: NowcastRun,
  bbox: Bbox,
  size: RadarSize,
  at: number,
  signal?: AbortSignal,
): Promise<RadarFrame | null> {
  if (at < run.from || at > run.to) return null;
  const res = await fetch(nowcastUrl(run, bbox, size, at), { signal });
  if (res.status === 400 || res.status === 500) return null;
  if (!res.ok) throw new Error(`nowcast ${res.status}`);
  if (!(res.headers.get('content-type') ?? '').includes('image')) return null;
  const image = await createImageBitmap(await res.blob());
  return { image, at, ...frameBounds(bbox), bbox, forecast: true, runAt: run.analysis };
}
