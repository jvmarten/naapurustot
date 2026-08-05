/**
 * Solar position and daylight times.
 *
 * The one realtime input that needs no API, no key and no coverage caveat: the
 * sun's position is pure astronomy, exact everywhere in Finland, and identical
 * whether you are in Helsinki or Utsjoki. Everything on the /live/ page that
 * depends on the sun — the shadow simulation, the daylight readout, the time
 * scrubber — resolves through this module.
 *
 * Implements the standard low-precision NOAA/Meeus solar position algorithm
 * (accurate to well under a degree, which is far finer than a shadow raster or
 * a building-height estimate can use). Angles are radians internally and
 * DEGREES at every exported boundary, because every consumer — MapLibre bearing,
 * CSS rotation, the readout — wants degrees.
 *
 * POLAR DAY AND NIGHT ARE NOT AN EDGE CASE HERE. A quarter of Finland lies above
 * the Arctic Circle; Utsjoki (69.9°N) has ~73 days without a sunset and ~51
 * without a sunrise. `sunTimes` therefore returns `sunrise: null` /
 * `sunset: null` together with an explicit `polar` discriminator, and callers
 * MUST branch on it rather than formatting a null date. Treating the missing
 * sunrise as "unknown" instead of "the sun does not rise today" is the specific
 * bug this shape exists to prevent.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Obliquity of the ecliptic. */
const OBLIQUITY = 23.4397 * RAD;
/** Longitude of perihelion of Earth's orbit. */
const PERIHELION = 102.9372 * RAD;

const MS_PER_DAY = 86_400_000;
const J1970 = 2440588;
const J2000 = 2451545;

/** Leading fraction of a Julian day used by the sunrise/sunset solve. */
const J0 = 0.0009;

/**
 * Sun altitudes (degrees) that delimit the daylight phases we report.
 *
 * -0.833° rather than 0° for sunrise/sunset is the conventional correction for
 * atmospheric refraction plus the sun's angular radius — it is the moment the
 * upper limb touches the horizon, which is what "sunrise" means in every
 * almanac and what an observer actually sees.
 */
const HORIZON = -0.833;
const CIVIL_TWILIGHT = -6;
const GOLDEN_HOUR = 6;

export type PolarState = 'day' | 'night' | null;

export interface SunPosition {
  /** Degrees above the horizon. Negative when the sun has set. */
  altitude: number;
  /** Compass bearing in degrees: 0 = north, 90 = east, clockwise. */
  azimuth: number;
}

export interface SunTimes {
  sunrise: Date | null;
  sunset: Date | null;
  /** Sun at its highest — always defined, even during polar night. */
  solarNoon: Date;
  /** Civil dawn/dusk (sun 6° below the horizon). */
  dawn: Date | null;
  dusk: Date | null;
  /** Start of the evening golden hour and end of the morning one (sun at 6°). */
  goldenHourStart: Date | null;
  goldenHourEnd: Date | null;
  /** Hours between sunrise and sunset. 24 during midnight sun, 0 during polar night. */
  dayLength: number;
  /**
   * `'day'` = the sun does not set today, `'night'` = it does not rise,
   * `null` = an ordinary day with both a sunrise and a sunset.
   */
  polar: PolarState;
}

function toJulian(date: Date): number {
  return date.valueOf() / MS_PER_DAY - 0.5 + J1970;
}

function fromJulian(j: number): Date {
  return new Date((j + 0.5 - J1970) * MS_PER_DAY);
}

/** Days since the J2000.0 epoch. */
function toDays(date: Date): number {
  return toJulian(date) - J2000;
}

/** Solar mean anomaly, radians. */
function meanAnomaly(d: number): number {
  return RAD * (357.5291 + 0.98560028 * d);
}

/** Apparent ecliptic longitude of the sun, radians. */
function eclipticLongitude(m: number): number {
  // Equation of the centre, truncated after the third harmonic.
  const c = RAD * (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m));
  return m + c + PERIHELION + Math.PI;
}

function declination(l: number): number {
  return Math.asin(Math.sin(OBLIQUITY) * Math.sin(l));
}

function rightAscension(l: number): number {
  return Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY), Math.cos(l));
}

/** Greenwich mean sidereal time, corrected for longitude (radians). */
function siderealTime(d: number, lw: number): number {
  return RAD * (280.16 + 360.9856235 * d) - lw;
}

/**
 * Where the sun is, as seen from `lat`/`lon`, at `date`.
 *
 * Azimuth is returned as a COMPASS bearing (north = 0, clockwise) rather than
 * the south-referenced convention the underlying algorithm produces, because
 * every consumer — the shadow projection, a compass rose, a MapLibre bearing —
 * works in compass degrees. Getting this wrong flips shadows 180°, so the
 * conversion lives here once instead of at each call site.
 */
export function sunPosition(date: Date, lat: number, lon: number): SunPosition {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(date);

  const m = meanAnomaly(d);
  const l = eclipticLongitude(m);
  const dec = declination(l);
  const ra = rightAscension(l);
  const h = siderealTime(d, lw) - ra;

  const altitude = Math.asin(
    Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h),
  );
  // atan2 form is south-referenced and increases westward; +180 lands it on the
  // compass convention. Normalising into [0, 360) keeps consumers from having to.
  const azimuthFromSouth = Math.atan2(
    Math.sin(h),
    Math.cos(h) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi),
  );
  const azimuth = (azimuthFromSouth * DEG + 180 + 360) % 360;

  return { altitude: altitude * DEG, azimuth };
}

/** Julian cycle since J2000 for the given day and longitude. */
function julianCycle(d: number, lw: number): number {
  return Math.round(d - J0 - lw / (2 * Math.PI));
}

function approxTransit(ht: number, lw: number, n: number): number {
  return J0 + (ht + lw) / (2 * Math.PI) + n;
}

function solarTransitJ(ds: number, m: number, l: number): number {
  return J2000 + ds + 0.0053 * Math.sin(m) - 0.0069 * Math.sin(2 * l);
}

/**
 * Hour angle at which the sun sits at altitude `h`, or NaN when it never does.
 *
 * The NaN is the polar signal: `acos` leaves its domain exactly when the sun's
 * daily circle misses that altitude entirely — the midnight sun and the polar
 * night. Callers must test it; silently propagating NaN into a Date yields
 * `Invalid Date`, which is the failure mode this comment exists to prevent.
 */
function hourAngle(h: number, phi: number, dec: number): number {
  const cosH = (Math.sin(h) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosH > 1 || cosH < -1) return NaN;
  return Math.acos(cosH);
}

/**
 * Daylight times for the calendar day containing `date`, at `lat`/`lon`.
 *
 * All returned times are absolute instants (`Date`), not wall-clock strings —
 * formatting in the user's zone is the caller's job.
 */
export function sunTimes(date: Date, lat: number, lon: number): SunTimes {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(date);

  const n = julianCycle(d, lw);
  const ds = approxTransit(0, lw, n);
  const m = meanAnomaly(ds);
  const l = eclipticLongitude(m);
  const dec = declination(l);

  const jNoon = solarTransitJ(ds, m, l);
  const solarNoon = fromJulian(jNoon);

  /** The rising/setting pair for a given altitude, or [null, null] at the poles. */
  function pairAt(altitudeDeg: number): [Date | null, Date | null] {
    const w = hourAngle(altitudeDeg * RAD, phi, dec);
    if (Number.isNaN(w)) return [null, null];
    const jSet = solarTransitJ(approxTransit(w, lw, n), m, l);
    const jRise = jNoon - (jSet - jNoon);
    return [fromJulian(jRise), fromJulian(jSet)];
  }

  const [sunrise, sunset] = pairAt(HORIZON);
  const [dawn, dusk] = pairAt(CIVIL_TWILIGHT);
  const [goldenHourEnd, goldenHourStart] = pairAt(GOLDEN_HOUR);

  // No sunrise/sunset means one of the two polar states. Which one is decided by
  // the sun's altitude at its HIGHEST point: above the horizon at local noon and
  // it never sets, below it and it never rises. Deriving it from the noon
  // altitude rather than from latitude+season keeps the twilight bands and the
  // discriminator from ever disagreeing.
  let polar: PolarState = null;
  let dayLength = 0;
  if (sunrise && sunset) {
    dayLength = (sunset.valueOf() - sunrise.valueOf()) / 3_600_000;
  } else {
    const noonAltitude = sunPosition(solarNoon, lat, lon).altitude;
    polar = noonAltitude > HORIZON ? 'day' : 'night';
    dayLength = polar === 'day' ? 24 : 0;
  }

  return {
    sunrise,
    sunset,
    solarNoon,
    dawn,
    dusk,
    goldenHourStart,
    goldenHourEnd,
    dayLength,
    polar,
  };
}

/**
 * How long a shadow an object of height 1 casts, given the sun's altitude.
 *
 * Multiply by the object's height for the shadow's ground length in the same
 * unit. Returns `null` when the sun is at or below the horizon: the shadow is
 * then unbounded, and `Infinity` would silently poison any geometry built from
 * it. A caller that has not handled sunset has to notice.
 *
 * The near-horizon values are real but enormous (a 20 m building at 1° casts
 * ~1.1 km), so consumers that draw them should clamp for display rather than
 * pretend the geometry is wrong.
 */
export function shadowLengthRatio(altitudeDeg: number): number | null {
  if (altitudeDeg <= 0) return null;
  return 1 / Math.tan(altitudeDeg * RAD);
}

/**
 * Compass bearing the shadow points along, given the sun's azimuth.
 *
 * Shadows fall directly away from the sun, so this is a plain 180° opposition —
 * named rather than inlined because the sign error is invisible in code review
 * and obvious only on screen.
 */
export function shadowBearing(sunAzimuthDeg: number): number {
  return (sunAzimuthDeg + 180) % 360;
}
