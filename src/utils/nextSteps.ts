/**
 * CF-4: "Next steps" outbound links — closing the decide→act gap. Once a household
 * has chosen an area, point them at actual homes (national housing portals, keyed by
 * municipality) and at planning a visit (the national journey planner, keyed by the
 * area centroid). Pure URL builders, outbound links only — the real-data rule is
 * untouched. Municipality name + WGS84 centroid are baked into the feature
 * properties at build:data (build_region_data.mjs).
 */

export type NextStepKind = 'sale' | 'rent' | 'visit';

export interface NextStep {
  /** i18n key for the link label */
  labelKey: string;
  href: string;
  kind: NextStepKind;
}

/** Slugify a Finnish municipality name for portal city paths (ä→a, ö→o, å→a). */
export function citySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/å/g, 'a')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface NextStepsInput {
  municipality?: string | null;
  lat?: number | null;
  lon?: number | null;
  nimi?: string | null;
}

export function buildNextSteps(props: NextStepsInput): NextStep[] {
  const steps: NextStep[] = [];
  const muni = props.municipality?.trim();
  if (muni) {
    const slug = citySlug(muni);
    if (slug) {
      // Oikotie uses a lowercase city slug; Vuokraovi uses the city name.
      steps.push({ labelKey: 'nextsteps.buy', kind: 'sale', href: `https://asunnot.oikotie.fi/myytavat-asunnot/${slug}` });
      steps.push({ labelKey: 'nextsteps.rent', kind: 'rent', href: `https://www.vuokraovi.com/vuokra-asunnot/${encodeURIComponent(muni)}` });
    }
  }
  if (typeof props.lat === 'number' && typeof props.lon === 'number' && isFinite(props.lat) && isFinite(props.lon)) {
    // National journey planner (Digitransit / opas.matka.fi) destination pin.
    const label = encodeURIComponent(props.nimi ?? muni ?? '');
    steps.push({ labelKey: 'nextsteps.visit', kind: 'visit', href: `https://opas.matka.fi/?to=${label}::${props.lat},${props.lon}` });
  }
  return steps;
}
