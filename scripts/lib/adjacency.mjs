/**
 * CF-12: derive a postal-code adjacency graph from region TopoJSON files.
 *
 * TopoJSON encodes shared borders as shared *arcs*: when two polygons abut,
 * the boundary between them is a single arc that both geometries reference
 * (one forwards, one as its bitwise-NOT reversal `~i`). So two postal codes
 * are neighbours iff they share at least one arc index. This is exact, needs
 * no geometry math, and is a byproduct of the topology geo2topo already built.
 *
 * The graph is keyed by `postinumeroalue` (the 5-digit postal code). Postal
 * codes are globally unique across regions, so a single flat object is safe
 * and we only ever record *within-region* neighbours (cross-region adjacency
 * would require a combined topology we deliberately don't ship — see CF-5).
 *
 * This module is imported by both scripts/build_region_data.mjs (so future
 * data builds re-emit the artifact) and the standalone CF-12 generator that
 * reads the already-committed TopoJSON without re-running build:data.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Yield every (possibly negative) arc index in an arbitrarily-nested arc array. */
function* flattenArcs(arcs) {
  if (typeof arcs === 'number') {
    yield arcs;
    return;
  }
  for (const a of arcs) yield* flattenArcs(a);
}

/**
 * Build the postal-code adjacency map for a single parsed TopoJSON topology.
 * Mutates and returns `into` (a plain object pno -> Set<pno>) so a caller can
 * accumulate across many regions.
 */
export function accumulateAdjacencyFromTopology(topology, into = {}) {
  const objectName = Object.keys(topology.objects)[0];
  const geometries = topology.objects[objectName]?.geometries ?? [];

  // Region TopoJSONs store their properties once per file, column-major, leaving
  // each geometry with just a row index — so the postal code has to be resolved
  // through that block. Reading `geom.properties.postinumeroalue` directly would
  // find nothing, silently emit an EMPTY adjacency graph, and still be perfectly
  // deterministic, so the build:data idempotency gate would happily commit it.
  const columnar = topology.propertiesColumnar;
  const pnoColumn = columnar
    ? columnar.cols[columnar.keys.indexOf('postinumeroalue')]
    : null;
  const pnoOf = (geom) => (pnoColumn
    ? pnoColumn[geom.properties?.i]
    : geom.properties?.postinumeroalue);

  if (columnar && !pnoColumn) {
    throw new Error('adjacency: region TopoJSON has no postinumeroalue column');
  }

  // arc index -> Set of postal codes that reference it
  const arcToPnos = new Map();
  for (const geom of geometries) {
    const pno = pnoOf(geom);
    if (!pno) continue;
    for (const a of flattenArcs(geom.arcs)) {
      const idx = a < 0 ? ~a : a;
      let set = arcToPnos.get(idx);
      if (!set) arcToPnos.set(idx, (set = new Set()));
      set.add(pno);
    }
  }

  for (const pnos of arcToPnos.values()) {
    if (pnos.size < 2) continue; // arc on a single polygon = outer coastline/hole
    const arr = [...pnos];
    for (const a of arr) {
      let neighbors = into[a];
      if (!neighbors) into[a] = neighbors = new Set();
      for (const b of arr) if (a !== b) neighbors.add(b);
    }
  }
  return into;
}

/**
 * Read every src/data/regions/<region>.topojson and build the full adjacency
 * map. Returns a plain object pno -> sorted string[] with deterministically
 * sorted keys, so the committed artifact has a stable diff.
 */
export function buildAdjacencyFromRegions(regionsDir) {
  const files = readdirSync(regionsDir)
    .filter((f) => f.endsWith('.topojson'))
    .sort();

  const acc = {};
  for (const file of files) {
    const topology = JSON.parse(readFileSync(join(regionsDir, file), 'utf-8'));
    accumulateAdjacencyFromTopology(topology, acc);
  }

  const out = {};
  for (const pno of Object.keys(acc).sort()) {
    out[pno] = [...acc[pno]].sort();
  }
  return out;
}
