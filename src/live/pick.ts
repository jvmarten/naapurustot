/**
 * Which feed marker did the user just click?
 *
 * The feeds are painted on a 2D canvas over the map rather than as MapLibre
 * layers (see the note above `paintTrains` for why — a GeoJSON source would put
 * a realtime feed UNDERNEATH the night wash). That decision buys legibility and
 * costs `queryRenderedFeatures`, so hit-testing is done here, against the same
 * projection the painters use.
 *
 * TWO RULES, AND THEY PULL AGAINST EACH OTHER.
 *
 * Nearest wins, but not across kinds at the same distance. The paint order puts
 * temperature labels on top of air-quality discs on top of trains on top of
 * closure lines, because that is the order that keeps each legible. Picking in
 * that same order would make a train dot unselectable whenever a station label
 * happened to be written across it — the label is 14 px of text, the dot is a
 * 4.5 px circle, and the text wins on area every time. So a tie is broken
 * towards the SMALLER, more precisely-placed mark, which is also the one the
 * user was more plausibly aiming at.
 *
 * A line is not a point. A road closure can be ten kilometres long, and testing
 * only its anchor would make the other 9.99 km of it dead to the pointer. Lines
 * are tested segment by segment, which is the same reason `paintIncidents` draws
 * them as lines in the first place.
 */

export type PickKind = 'train' | 'ship' | 'air_quality' | 'observation' | 'incident' | 'lightning';

export interface Picked {
  kind: PickKind;
  /** Index into the array the caller passed for that kind. */
  index: number;
}

/** A screen point, in CSS pixels. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Grab radius per kind, in CSS pixels.
 *
 * Larger than the mark, deliberately: Fitts's law does not care that a train dot
 * is 4.5 px across, and a 14 px target is the smallest thing a finger can be
 * expected to hit. They differ because the marks differ in how densely they
 * cluster — trains stack in a terminus throat, so an over-generous radius there
 * would make the wrong one selectable from further away than the right one.
 */
const GRAB_PX: Record<PickKind, number> = {
  train: 12,
  // The same as a train: a small directional mark that clusters in a port throat
  // the way trains cluster in a terminus, so an over-generous radius there makes
  // the wrong hull selectable from further than the right one.
  ship: 12,
  air_quality: 12,
  observation: 16,
  incident: 14,
  // The tightest on the page, and it has to be. A storm puts a few thousand
  // flashes in the window, dense enough that neighbours are often a pixel or two
  // apart — a generous radius there does not make the layer easier to hit, it
  // makes which flash you get arbitrary. Eight pixels is still twice the mark.
  lightning: 8,
};

/**
 * Tie-break weight: lower wins when two candidates are the same distance away.
 *
 * Ordered by how precisely each mark states a position, which is the inverse of
 * the paint order — see the file header.
 */
const PRIORITY: Record<PickKind, number> = {
  train: 0,
  // Alongside the train: both are small directional marks, and a coastal tie
  // between a hull and a dot should go to whichever is nearer, not to a fixed
  // winner. They almost never coincide — one is on water, the other on rail.
  ship: 1,
  air_quality: 2,
  incident: 3,
  observation: 4,
  // LAST, which is the opposite of what its mark size would suggest. The rule
  // above is "the smaller, more precisely-placed mark wins a tie", and a flash
  // is the smallest thing here — but it is also drawn UNDER everything else and
  // arrives in thousands, so a tie-break in its favour would make a train dot
  // standing in a thunderstorm unselectable. Being painted at the bottom of the
  // stack, it loses ties at the bottom too, and the two orders stay consistent.
  lightning: 5,
};

/** Squared distance from `p` to the segment `a`–`b`, in pixels. */
function segmentDistSq(p: ScreenPoint, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len > 0 ? ((p.x - ax) * dx + (p.y - ay) * dy) / len : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx - p.x;
  const qy = ay + t * dy - p.y;
  return qx * qx + qy * qy;
}

/** Anything with a position, which is all the point-shaped feeds have in common. */
export interface Located {
  lon: number;
  lat: number;
}

/** A road incident: an anchor plus, sometimes, the stretch of road it covers. */
export interface LocatedLines extends Located {
  lines: [number, number][][];
}

export interface PickInput {
  trains?: Located[];
  ships?: Located[];
  airQuality?: Located[];
  observations?: Located[];
  incidents?: LocatedLines[];
  lightning?: Located[];
}

/**
 * The marker nearest `point`, within its kind's grab radius, or null.
 *
 * `project` is passed in rather than a MapLibre map so this is testable without
 * a renderer — and because the caller already holds one for the draw loop.
 */
export function pickFeature(
  point: ScreenPoint,
  layers: PickInput,
  project: (lon: number, lat: number) => ScreenPoint,
): Picked | null {
  let best: Picked | null = null;
  let bestDistSq = Infinity;
  let bestPriority = Infinity;

  const consider = (kind: PickKind, index: number, distSq: number) => {
    const grab = GRAB_PX[kind];
    if (distSq > grab * grab) return;
    const priority = PRIORITY[kind];
    // A clear win on distance beats priority; priority only settles a near-tie.
    // The 4 px² slack is what stops two marks a pixel apart from being decided
    // by rounding rather than by what the user aimed at.
    if (distSq < bestDistSq - 4 || (distSq < bestDistSq + 4 && priority < bestPriority)) {
      best = { kind, index };
      bestDistSq = distSq;
      bestPriority = priority;
    }
  };

  const points = (kind: PickKind, list: Located[] | undefined) => {
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const p = project(list[i].lon, list[i].lat);
      const dx = p.x - point.x;
      const dy = p.y - point.y;
      consider(kind, i, dx * dx + dy * dy);
    }
  };

  points('train', layers.trains);
  points('ship', layers.ships);
  points('air_quality', layers.airQuality);
  points('observation', layers.observations);
  points('lightning', layers.lightning);

  const incidents = layers.incidents;
  if (incidents) {
    for (let i = 0; i < incidents.length; i++) {
      const incident = incidents[i];
      const anchor = project(incident.lon, incident.lat);
      let dSq = (anchor.x - point.x) ** 2 + (anchor.y - point.y) ** 2;
      for (const line of incident.lines) {
        // Already inside the grab radius — refining the distance cannot change
        // the answer, and the whole set is ~14 announcements, so this loop is
        // not worth a spatial index.
        if (dSq <= GRAB_PX.incident * GRAB_PX.incident) break;
        let prev = project(line[0][0], line[0][1]);
        for (let v = 1; v < line.length; v++) {
          const next = project(line[v][0], line[v][1]);
          const d = segmentDistSq(point, prev.x, prev.y, next.x, next.y);
          if (d < dSq) dSq = d;
          prev = next;
        }
      }
      consider('incident', i, dSq);
    }
  }

  return best;
}
