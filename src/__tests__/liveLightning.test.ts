import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseLightning,
  lightningUrl,
  fetchLightning,
  mergeStrikes,
  strikesIn,
  newestStrikeAt,
  STRIKE_WINDOW_MS,
  STRIKE_WINDOW_MINUTES,
  LIGHTNING_POLL_MS,
  type Strike,
} from '../live/lightning';

/**
 * Located lightning.
 *
 * This is the only feed on the page that reads FMI's COVERAGE encoding rather
 * than the `simple` one, so none of the traps pinned in liveObservations.test.ts
 * carry over — the parser is a different parser. What it shares is the axis
 * order, and what it adds is a positions block whose third column is a Unix
 * second and a value block joined to it by index alone. Both of those fail
 * silently and plausibly when they fail, which is what these tests are for.
 */

/** A response in FMI's shape: n positions, n×2 values, fields named in order. */
function doc(
  rows: [lat: string, lon: string, seconds: string, current: string, indicator: string][],
  fields = ['peak_current', 'cloud_indicator'],
) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<wfs:FeatureCollection numberMatched="1" numberReturned="1"
  xmlns:wfs="http://www.opengis.net/wfs/2.0"
  xmlns:gml="http://www.opengis.net/gml/3.2"
  xmlns:gmlcov="http://www.opengis.net/gmlcov/1.0"
  xmlns:swe="http://www.opengis.net/swe/2.0">
  <wfs:member>
    <gmlcov:MultiPointCoverage>
      <gml:MultiPoint srsName="http://www.opengis.net/def/crs/EPSG/0/4258">
        <gmlcov:positions>
${rows.map((r) => `${r[0]} ${r[1]} ${r[2]}`).join('\n')}
        </gmlcov:positions>
      </gml:MultiPoint>
      <gml:rangeSet>
        <gml:DataBlock>
          <gml:doubleOrNilReasonTupleList>
${rows.map((r) => `${r[3]} ${r[4]}`).join('\n')}
          </gml:doubleOrNilReasonTupleList>
        </gml:DataBlock>
      </gml:rangeSet>
      <gmlcov:rangeType>
        <swe:DataRecord>
${fields.map((f) => `<swe:field name="${f}"/>`).join('\n')}
        </swe:DataRecord>
      </gmlcov:rangeType>
    </gmlcov:MultiPointCoverage>
  </wfs:member>
</wfs:FeatureCollection>`;
}

/** What FMI actually answers for a window with no strikes in it. */
const EMPTY_DOC = `<?xml version="1.0" encoding="UTF-8"?>
<wfs:FeatureCollection numberMatched="0" numberReturned="0"
  xmlns:wfs="http://www.opengis.net/wfs/2.0">
</wfs:FeatureCollection>`;

describe('parseLightning', () => {
  it('reads a flash with latitude first and a Unix second', () => {
    // Both halves of this matter and both fail plausibly. Read lon/lat and every
    // Finnish flash lands off Somalia; read the third column as an altitude and
    // every flash gets the time of whatever else happened to be parsed.
    const [s] = parseLightning(doc([['62.24170', '25.74720', '1786869572', '-26', '0']]));
    expect(s.lat).toBeCloseTo(62.2417, 4);
    expect(s.lon).toBeCloseTo(25.7472, 4);
    expect(s.at).toBe(1786869572 * 1000);
    expect(s.kiloamps).toBe(-26);
    expect(s.ground).toBe(true);
  });

  it('treats cloud_indicator 1 as a cloud flash and 0 as a ground flash', () => {
    // Established from the data rather than assumed — see lightning.ts. It is
    // the distinction the two marks draw, so getting it backwards would state
    // that 82 % of a storm reached the ground.
    const out = parseLightning(
      doc([
        ['62.0', '25.0', '1786869572', '-26', '0'],
        ['62.1', '25.1', '1786869573', '-5', '1'],
      ]),
    );
    expect(out.map((s) => s.ground)).toEqual([true, false]);
  });

  it('reads the field order from the response rather than assuming it', () => {
    // The tuple list is bare numbers whose meaning lives entirely in the field
    // names. Swapped, every flash becomes a ground strike carrying 0 or 1 kA.
    const [s] = parseLightning(
      doc([['62.0', '25.0', '1786869572', '1', '-26']], ['cloud_indicator', 'peak_current']),
    );
    expect(s.kiloamps).toBe(-26);
    expect(s.ground).toBe(false);
  });

  it('keeps the sign of the peak current', () => {
    // Negative is the ordinary polarity for a ground flash, so a positive one is
    // the notable case. Taking a magnitude would erase exactly that.
    const out = parseLightning(
      doc([
        ['62.0', '25.0', '1786869572', '-26', '0'],
        ['62.1', '25.1', '1786869573', '43', '0'],
      ]),
    );
    expect(out.map((s) => s.kiloamps)).toEqual([-26, 43]);
  });

  it('reports a missing current as null, never as zero', () => {
    // `Number('')` is 0 and NaN is a value FMI does publish; either one would
    // print "0 kA" in the panel as though a flash carrying no current had been
    // measured. The flash itself was still located, so it is kept.
    const out = parseLightning(
      doc([
        ['62.0', '25.0', '1786869572', 'NaN', '0'],
        ['62.1', '25.1', '1786869573', '-9', '1'],
      ]),
    );
    expect(out).toHaveLength(2);
    expect(out[0].kiloamps).toBeNull();
    expect(out[1].kiloamps).toBe(-9);
  });

  it('drops a flash whose type is not one of the two published values', () => {
    // The mark IS the type. There is no neutral flash mark to fall back to, so
    // drawing one would be inventing which kind it was.
    const out = parseLightning(
      doc([
        ['62.0', '25.0', '1786869572', '-26', '2'],
        ['62.1', '25.1', '1786869573', '-9', 'NaN'],
        ['62.2', '25.2', '1786869574', '-9', '1'],
      ]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].lat).toBeCloseTo(62.2, 4);
  });

  it('drops a position that is not on the globe', () => {
    const out = parseLightning(
      doc([
        ['620.0', '25.0', '1786869572', '-26', '0'],
        ['62.1', '2500', '1786869573', '-9', '0'],
        ['62.2', '25.2', '1786869574', '-9', '0'],
      ]),
    );
    expect(out).toHaveLength(1);
  });

  it('reads a strike-free window as no strikes, not as a failure', () => {
    // The common case: two of the ten August days measured in lightning.ts had
    // none at all, and most of the year is like that. FMI answers with a bare
    // FeatureCollection carrying no coverage.
    expect(parseLightning(EMPTY_DOC)).toEqual([]);
  });

  it('throws when the two blocks disagree about how many strikes there are', () => {
    // They are joined by index alone. A seam would give every flash after it
    // somebody else's current and polarity — a fabricated measurement wearing a
    // real one's coordinates — so there is no partial answer worth keeping.
    const xml = doc([
      ['62.0', '25.0', '1786869572', '-26', '0'],
      ['62.1', '25.1', '1786869573', '-9', '1'],
    ]).replace('-9 1\n', '');
    expect(() => parseLightning(xml)).toThrow(/disagree/);
  });

  it('throws on a response that does not describe its own fields', () => {
    const xml = doc([['62.0', '25.0', '1786869572', '-26', '0']], ['multiplicity', 'ellipse_major']);
    expect(() => parseLightning(xml)).toThrow(/fields/);
  });

  it('throws on a malformed document rather than reading it as a quiet sky', () => {
    // DOMParser does not throw — it hands back a document containing
    // <parsererror>, so an unchecked parse reads a truncated response as
    // "nothing struck Finland".
    expect(() => parseLightning('<wfs:FeatureCollection><oops')).toThrow();
  });

  it('throws on a document that is not a WFS FeatureCollection', () => {
    expect(() => parseLightning('<html><body>502 Bad Gateway</body></html>')).toThrow(
      /FeatureCollection/,
    );
  });
});

describe('the lightning request', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks the coverage query, over Finland, for both fields it draws', () => {
    const url = lightningUrl(
      Date.parse('2026-08-17T00:00:00Z'),
      Date.parse('2026-08-17T12:00:00Z'),
    );
    expect(url).toContain('fmi%3A%3Aobservations%3A%3Alightning%3A%3Amultipointcoverage');
    expect(url).toContain('bbox=19%2C59%2C32%2C71');
    expect(url).toContain('parameters=peak_current%2Ccloud_indicator');
    expect(url).toContain('starttime=2026-08-17T00%3A00%3A00Z');
    expect(url).toContain('endtime=2026-08-17T12%3A00%3A00Z');
  });

  it('never thins the window with a timestep', () => {
    // `timestep` selects observations that fall on a step. For a station series
    // that is a thinning of redundant readings; for events it would silently
    // drop real strikes and draw a storm as a fraction of itself.
    expect(lightningUrl(0, 1)).not.toContain('timestep');
  });

  it('rejects a bad response instead of reporting an empty sky', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503 }) as unknown as Response),
    );
    return expect(fetchLightning(0, 1)).rejects.toThrow(/503/);
  });

  it('polls often enough to be worth calling live', () => {
    expect(LIGHTNING_POLL_MS).toBeLessThanOrEqual(STRIKE_WINDOW_MS);
  });
});

/* --------------------------------------------------------------- the store */

const strike = (at: number, ground = true, kiloamps: number | null = -20): Strike => ({
  lon: 25,
  lat: 62,
  at,
  kiloamps,
  ground,
});

describe('mergeStrikes', () => {
  it('appends a polled window to what is already held', () => {
    const held = [strike(1000), strike(2000)];
    expect(mergeStrikes(held, [strike(3000), strike(4000)]).map((s) => s.at)).toEqual([
      1000, 2000, 3000, 4000,
    ]);
  });

  it('keeps the result ascending, which the binary search depends on', () => {
    const out = mergeStrikes([strike(1000), strike(2000)], [strike(2000, false), strike(9000)]);
    for (let i = 1; i < out.length; i++) expect(out[i].at).toBeGreaterThanOrEqual(out[i - 1].at);
  });

  it('keeps other strikes from the boundary second rather than trimming them', () => {
    // FMI's window is inclusive and its resolution is one second, and the
    // observed peak is 151 strikes a minute — so flashes routinely share the
    // second the poll starts from. "Strictly newer" would drop them.
    const held = [strike(2000, true, -20)];
    const polled = [strike(2000, true, -20), strike(2000, false, -4), strike(2500)];
    expect(mergeStrikes(held, polled).map((s) => s.at)).toEqual([2000, 2000, 2500]);
  });

  it('does not re-add a strike it already holds', () => {
    const held = [strike(1000), strike(2000, true, -20)];
    expect(mergeStrikes(held, [strike(2000, true, -20)])).toHaveLength(2);
  });

  it('drops anything before the boundary, which the day request already covered', () => {
    expect(mergeStrikes([strike(5000)], [strike(1000), strike(6000)]).map((s) => s.at)).toEqual([
      5000, 6000,
    ]);
  });

  it('handles an empty side either way', () => {
    expect(mergeStrikes([], [strike(1)])).toHaveLength(1);
    expect(mergeStrikes([strike(1)], [])).toHaveLength(1);
  });
});

describe('strikesIn', () => {
  const day = [1, 2, 3, 4, 5].map((n) => strike(n * 1000));

  it('returns the window inclusive of both ends', () => {
    expect(strikesIn(day, 2000, 4000).map((s) => s.at)).toEqual([2000, 3000, 4000]);
  });

  it('is empty when the window falls in a gap', () => {
    expect(strikesIn(day, 5001, 9000)).toEqual([]);
    expect(strikesIn(day, 0, 999)).toEqual([]);
  });

  it('handles an empty store', () => {
    expect(strikesIn([], 0, 10_000)).toEqual([]);
  });

  it('finds the window in a day-sized list', () => {
    // The real store reaches 46,000 entries on a storm day and this runs once a
    // repaint, which is why it is a binary search rather than a filter.
    const many = Array.from({ length: 46_000 }, (_, i) => strike(i * 1000));
    expect(strikesIn(many, 20_000_000, 20_003_000).map((s) => s.at)).toEqual([
      20_000_000, 20_001_000, 20_002_000, 20_003_000,
    ]);
  });
});

describe('newestStrikeAt', () => {
  it('is where the next poll starts, or null while empty', () => {
    expect(newestStrikeAt([])).toBeNull();
    expect(newestStrikeAt([strike(1000), strike(7000)])).toBe(7000);
  });
});

describe('the drawn window', () => {
  it('states the same span in both units the page uses', () => {
    // The readout prints the minutes; the store slices with the milliseconds. A
    // drift between them would put a number in the sentence that is not the
    // window the marks came from.
    expect(STRIKE_WINDOW_MINUTES * 60_000).toBe(STRIKE_WINDOW_MS);
  });
});
