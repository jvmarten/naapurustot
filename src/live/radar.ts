/**
 * Weather radar for /live/, from the Finnish Meteorological Institute.
 *
 * Source: FMI's open WMS (`openwms.fmi.fi/geoserver/Radar`), CC BY 4.0, no API
 * key, `Access-Control-Allow-Origin: *` on both GetCapabilities and GetMap. The
 * layer is `suomi_dbz_eureffin` — the national composite of Finland's ten
 * weather radars, published every five minutes with about seven days of history
 * behind it.
 *
 * THE FIRST RASTER FEED ON THIS PAGE, which changes two things about how it
 * answers the clock.
 *
 * 1. IT CANNOT LOAD ITS DAY UP FRONT. Every other measured feed here fetches the
 *    whole day once and samples it locally, because a national day of station
 *    readings is ~20 kB (see timeline.ts, and the invariant it is written under:
 *    "the time slider is not a request"). A day of radar is 288 images and about
 *    25 MB, so this one genuinely is a request per frame. What keeps it honest
 *    is that the request is for a PUBLISHED INSTANT rather than for "now": the
 *    frame is asked for by its own timestamp, and the readout prints that
 *    timestamp rather than the playhead's. Frames are also the one thing here
 *    the browser cache can hold — FMI serves them `max-age=86400`, so scrubbing
 *    back and forth over a window costs the network nothing after the first
 *    pass.
 *
 * 2. IT HAS NO VALUE TO DROP. A station outside tolerance is left off the map;
 *    a raster is all-or-nothing, so the tolerance is applied to the FRAME: if
 *    the newest composite at or before the playhead is more than
 *    {@link RADAR_TOLERANCE_MS} old, nothing is drawn and the readout says why.
 *    That is the same rule the temperature layer applies per station, moved up
 *    a level because the data is.
 *
 * THE GREY WASH IS THE PUBLISHER'S, AND IT IS DATA. FMI's own style paints
 * everything outside the radars' range as a faint grey — measured at
 * `rgba(204,204,204,0.2)` — while ground inside the range with no echo is fully
 * transparent. So the image already draws this project's own distinction
 * between "no rain" and "we cannot see", and it is kept rather than filtered
 * out: over the Baltic, northern Norway and the Russian side, that wash is the
 * edge of what the network measures. The readout names it, because a haze
 * nobody explained reads as a rendering fault.
 *
 * REFLECTIVITY, NOT MILLIMETRES. `suomi_dbz_eureffin` is the dBZ composite and
 * `suomi_rr_eureffin` the rain-rate one; they were compared frame for frame and
 * the dBZ product is the one drawn, because its style ramps ALPHA with
 * intensity (light echo is faint, a core is opaque) where the rain-rate style
 * has three alphas and nothing between them. On a page that draws everything
 * over a basemap, a product that fades where the signal is weak is the one that
 * stays a map. The value is not printed as a number anywhere, so the unit never
 * has to be explained: colour carries it, which is the same call the air quality
 * feed makes for its index.
 */
import { lonLatToMercator, type Bbox } from './shadows';

const ENDPOINT = 'https://openwms.fmi.fi/geoserver/Radar/wms';
const LAYER = 'suomi_dbz_eureffin';

/**
 * The composite's publishing interval, in ms.
 *
 * Not a polling choice — it is the grid the archive is indexed on. Asking for
 * any instant that is not a multiple of this answers `InvalidDimensionValue`,
 * so every request here is floored onto it first.
 */
export const RADAR_STEP_MS = 300_000;

/**
 * How old the newest available composite may be and still be drawn, in ms.
 *
 * Three steps. FMI publishes a frame a few minutes after the scan it is made
 * from, so at "now" the newest one is routinely five to ten minutes back — draw
 * only the exact step under the playhead and the layer would be empty most of
 * the time it is live. Beyond fifteen minutes the picture is a different weather
 * situation, and this feed's whole subject is where the rain is at the moment.
 */
export const RADAR_TOLERANCE_MS = 3 * RADAR_STEP_MS;

/**
 * The composite's own cell size on the ground, in metres.
 *
 * Measured rather than taken from documentation: the same 100 km box requested
 * in EPSG:3067 at 250 m/px came back with a modal run of two identical pixels
 * across, and at 125 m/px with a modal run of four to five. Both put the cell at
 * 500 m. It matters because it is the point past which asking for more pixels
 * buys nothing — GeoServer resamples with nearest neighbour, so a 4x request is
 * the same picture in four times the bytes.
 */
const RADAR_CELL_M = 500;

/**
 * Hard cap on either side of a requested frame, in pixels.
 *
 * A national view at screen resolution is ~100 kB of PNG; this bounds what a
 * very large display can ask a free public service for. Above it the frame is
 * scaled up on the canvas, which at that zoom is well below one screen pixel per
 * radar cell anyway.
 */
const MAX_RADAR_PX = 1400;

/** Half the equator in EPSG:3857 metres — the Mercator unit square's span. */
const MERC_SPAN = 40_075_016.6856;

/** One composite, decoded, with the ground it covers and the instant it is. */
export interface RadarFrame {
  image: ImageBitmap;
  /**
   * The composite's OWN instant, on the five-minute grid.
   *
   * Never the playhead's. The page prints this, and the gap between the two is
   * exactly the thing a reader has to be told about a layer that lags its clock.
   */
  at: number;
  /** Mercator unit-square bounds of the image, west/north to east/south. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** The lon/lat box it was requested for, so a later view can reuse it. */
  bbox: Bbox;
}

/** Requested pixel dimensions for a frame. */
export interface RadarSize {
  width: number;
  height: number;
}

/**
 * Thrown when FMI has no composite for any instant in range.
 *
 * A distinct type because it is not a failure: at the leading edge it means the
 * newest scan has not been published yet, and past the archive's end it means
 * the rain has not happened. Both are sentences the page can say, and neither is
 * "could not load", which is what a bare rejection would have been read as.
 */
export class RadarUnpublished extends Error {}

/** The newest published instant at or before `ms`. */
export function radarFrameAt(ms: number): number {
  return Math.floor(ms / RADAR_STEP_MS) * RADAR_STEP_MS;
}

/**
 * Pixel size to request for a box, capped by the data and by courtesy.
 *
 * `pxPerMerc` is the camera's own scale, so at a street zoom the request is the
 * viewport's size and at a country zoom it is much smaller than the data would
 * allow. The aspect ratio always follows the Mercator box rather than the canvas
 * — under rotation the ground box that covers the screen is neither the screen's
 * shape nor its size, and a frame requested at the canvas's aspect would land on
 * the map stretched.
 */
export function radarRequestSize(
  bbox: Bbox,
  pxPerMerc: number,
  cap = MAX_RADAR_PX,
): RadarSize {
  const [x0, y0] = lonLatToMercator(bbox.west, bbox.north);
  const [x1, y1] = lonLatToMercator(bbox.east, bbox.south);
  const mw = Math.max(x1 - x0, 1e-9);
  const mh = Math.max(y1 - y0, 1e-9);

  const midLat = ((bbox.north + bbox.south) / 2) * (Math.PI / 180);
  const groundM = mw * MERC_SPAN * Math.cos(midLat);
  // Never finer than the composite's own grid, never larger than the cap, and
  // never so coarse that a wide box collapses to a handful of pixels.
  const width = Math.max(16, Math.min(mw * pxPerMerc, groundM / RADAR_CELL_M, cap));
  const height = Math.min(width * (mh / mw), cap);
  return { width: Math.round(width), height: Math.round(Math.max(16, height)) };
}

/** The GetMap URL for one frame. Exported so a test can read it. */
export function radarUrl(bbox: Bbox, size: RadarSize, at: number): string {
  const [x0, y0] = lonLatToMercator(bbox.west, bbox.north);
  const [x1, y1] = lonLatToMercator(bbox.east, bbox.south);
  // EPSG:3857 rather than 4326, for two reasons: the page's whole overlay is an
  // affine map from Mercator to screen, so a Mercator raster lands on it without
  // a warp — and WMS 1.3.0 reads a 4326 bbox as lat,lon, an axis-order trap this
  // codebase has already been bitten by once at the two HSY/Helsinki servers.
  const bboxParam = [
    (x0 - 0.5) * MERC_SPAN,
    (0.5 - y1) * MERC_SPAN,
    (x1 - 0.5) * MERC_SPAN,
    (0.5 - y0) * MERC_SPAN,
  ]
    .map((v) => v.toFixed(1))
    .join(',');
  const q = new URLSearchParams({
    service: 'WMS',
    version: '1.3.0',
    request: 'GetMap',
    layers: LAYER,
    styles: '',
    format: 'image/png',
    transparent: 'true',
    crs: 'EPSG:3857',
    bbox: bboxParam,
    width: String(size.width),
    height: String(size.height),
    time: new Date(at).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  });
  return `${ENDPOINT}?${q}`;
}

/**
 * One composite, at the newest published instant at or before `wantAt`.
 *
 * WALKS BACK, because the leading edge is ragged. A GetMap for an instant the
 * mosaic does not hold answers HTTP 200 with an `InvalidDimensionValue`
 * ServiceException — a text/xml body, which is how this tells a missing frame
 * from a broken request without parsing anything: an image response is an image.
 * The walk is bounded by {@link RADAR_TOLERANCE_MS} rather than by a retry
 * count, so the same constant that decides what may be DRAWN decides what may be
 * asked for, and the two cannot drift apart.
 *
 * `haveAt` is the instant the caller already holds a frame for, over ground that
 * still covers the view. Reaching it ends the walk with `null` — "yours is still
 * the newest" — which is what makes the live case cheap: the page's clock steps
 * onto 18:05 a minute or two before FMI publishes it, so without this every step
 * would re-download and re-decode the 18:00 frame already on screen. What is
 * NOT skipped is the probe for the newer instants above it, because whether one
 * has appeared yet is the entire question being asked.
 */
export async function fetchRadarFrame(
  bbox: Bbox,
  size: RadarSize,
  wantAt: number,
  signal?: AbortSignal,
  haveAt: number | null = null,
): Promise<RadarFrame | null> {
  const newest = radarFrameAt(wantAt);
  const oldest = radarFrameAt(wantAt - RADAR_TOLERANCE_MS);
  for (let at = newest; at >= oldest; at -= RADAR_STEP_MS) {
    if (at === haveAt) return null;
    const res = await fetch(radarUrl(bbox, size, at), { signal });
    if (!res.ok) throw new Error(`radar ${res.status}`);
    // The exception report is served as 200 text/xml; anything that is not an
    // image is one of those, and means this instant is not in the mosaic.
    if (!(res.headers.get('content-type') ?? '').includes('image')) continue;
    const image = await createImageBitmap(await res.blob());
    const [x0, y0] = lonLatToMercator(bbox.west, bbox.north);
    const [x1, y1] = lonLatToMercator(bbox.east, bbox.south);
    return { image, at, x0, y0, x1, y1, bbox };
  }
  throw new RadarUnpublished('no composite in range');
}

/**
 * Whether a composite of instant `at` may be drawn under a playhead at `when`.
 *
 * ONE RULE, READ BY BOTH SIDES — the effect that decides what to fetch and the
 * draw that decides what to blit. They were briefly two copies, which is how a
 * layer ends up drawing a frame the sentence beside it has already disowned.
 * Never forward of the playhead, and never further behind it than the tolerance.
 */
export function radarInRange(at: number, when: number): boolean {
  return at <= when && when - at <= RADAR_TOLERANCE_MS;
}
