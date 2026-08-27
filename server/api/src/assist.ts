/**
 * AI housing assistant (AS-1).
 *
 * Turns a free-text housing wish ("somewhere green and safe near good transit,
 * budget around 3500 e/m2") into a set of map FILTER criteria the frontend then
 * runs against its own real data. The model NEVER emits a statistic about any
 * area — it only picks which of the site's data layers to filter on and in which
 * direction. Every number the user ends up seeing still comes from the loaded
 * dataset (see docs/ARCHITECTURE.md — the data-integrity rule applies here too).
 *
 * Criteria are expressed as PERCENTILE ranks (0-100) over the national
 * distribution, so the model never needs to know real euro/value ranges: the
 * frontend resolves each rank against the actual data via
 * `resolveCriterionBounds` (src/utils/filterUtils.ts).
 *
 * The endpoint is OPTIONAL, exactly like the rest of this server: with no
 * ANTHROPIC_API_KEY set, GET /assist reports { configured: false } and the
 * frontend hides the feature — the app is unaffected. Free tier is per-IP rate
 * limited; a future Pro tier can lift the limit by branching on the user's
 * entitlement inside the POST handler.
 */
import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { rateLimit } from './rateLimit.js';

// Default to Anthropic's most capable model. For this workload (a short
// intent->filter extraction) a cheaper, faster model is usually the better
// choice on a free, high-volume endpoint — set ASSIST_MODEL=claude-haiku-4-5
// (or claude-sonnet-5) in the environment to switch. Model choice is a cost
// decision, so it lives in config, never hard-coded.
const MODEL = process.env.ASSIST_MODEL || 'claude-opus-5';

const MAX_QUERY_LEN = 500;
const MAX_CATALOG_ENTRIES = 200;
const MAX_ID_LEN = 64;
const MAX_LABEL_LEN = 120;
const MAX_CRITERIA = 8;

const LANGS = new Set(['fi', 'en', 'sv']);

/** One selectable data layer, as sent by the frontend (built from LAYERS + i18n labels). */
export interface CatalogEntry {
  id: string;
  label: string;
  /** false when LOW raw values are the desirable end (crime, noise, unemployment). */
  higherIsBetter: boolean;
}

/** A resolved filter criterion the frontend can hand straight to computeMatchingPnos. */
export interface AssistCriterion {
  layerId: string;
  min: number;
  max: number;
  mode: 'percentile';
}

export interface AssistResult {
  /** Short label for the search, in the user's language. */
  title: string;
  /** 1-2 sentences describing which factors were used and their direction. No statistics. */
  explanation: string;
  criteria: AssistCriterion[];
  /** A place name if the user asked for "areas like X"; else null. */
  similarTo: string | null;
  /** Aspects of the request that no layer could express (kept honest, shown to the user). */
  unmatched: string[];
}

/** True when the assistant can actually call the model. Gates the whole feature. */
export function isAssistConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Construct the client lazily: with no API key `new Anthropic()` throws, and we
// must not crash the whole server at import time just because the optional
// assistant is unconfigured.
let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

/**
 * Validate and normalise the layer catalog from an untrusted request body.
 * Returns null when nothing usable is present (the caller answers 400).
 */
export function parseCatalog(raw: unknown): CatalogEntry[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_CATALOG_ENTRIES) return null;
  const out: CatalogEntry[] = [];
  const seen = new Set<string>();
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const id = (e as Record<string, unknown>).id;
    const label = (e as Record<string, unknown>).label;
    if (typeof id !== 'string' || typeof label !== 'string') continue;
    if (!id || id.length > MAX_ID_LEN || !label || label.length > MAX_LABEL_LEN) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label, higherIsBetter: (e as Record<string, unknown>).higherIsBetter !== false });
  }
  return out.length ? out : null;
}

function clampPct(n: number): number {
  const v = Math.round(n);
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}

function trimStr(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

const DEFAULT_TITLE: Record<string, string> = {
  fi: 'Ehdotettu haku',
  en: 'Suggested search',
  sv: 'Föreslagen sökning',
};

/**
 * Turn the model's raw tool input into a trusted AssistResult. Drops any
 * criterion referencing a layer the client didn't offer, clamps ranks to
 * [0,100], repairs reversed bounds, and discards no-op full-range criteria.
 * This is the trust boundary — the frontend re-validates layer ids again too.
 */
export function sanitizeAssistOutput(
  input: unknown,
  catalogIds: Set<string>,
  lang: string,
): AssistResult {
  const obj = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const criteria: AssistCriterion[] = [];
  if (Array.isArray(obj.criteria)) {
    for (const c of obj.criteria) {
      if (!c || typeof c !== 'object') continue;
      const rec = c as Record<string, unknown>;
      const layerId = rec.layer_id;
      if (typeof layerId !== 'string' || !catalogIds.has(layerId)) continue;
      const rawMin = Number(rec.min_percentile);
      const rawMax = Number(rec.max_percentile);
      if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax)) continue;
      let min = clampPct(rawMin);
      let max = clampPct(rawMax);
      if (min > max) [min, max] = [max, min];
      // A 0-100 criterion matches everything — the model expressing "no preference".
      if (min === 0 && max === 100) continue;
      criteria.push({ layerId, min, max, mode: 'percentile' });
      if (criteria.length >= MAX_CRITERIA) break;
    }
  }

  const unmatched: string[] = Array.isArray(obj.unmatched)
    ? obj.unmatched
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .slice(0, 10)
        .map((x) => trimStr(x, MAX_LABEL_LEN))
    : [];

  const similar = trimStr(obj.similar_to, 80);

  return {
    title: trimStr(obj.title, 80) || (DEFAULT_TITLE[lang] ?? DEFAULT_TITLE.fi),
    explanation: trimStr(obj.explanation, 600),
    criteria,
    similarTo: similar || null,
    unmatched,
  };
}

/** Build the (cacheable) system prompt: rules + the layer catalog as a reference table. */
export function buildSystemPrompt(catalog: CatalogEntry[], lang: string): string {
  const langName = lang === 'en' ? 'English' : lang === 'sv' ? 'Swedish' : 'Finnish';
  const lines = catalog
    .map((c) => `- ${c.id}: ${c.label} (${c.higherIsBetter ? 'higher = more of it' : 'lower = better/less of it'})`)
    .join('\n');
  return [
    'You help someone decide where to live in Finland by translating their plain-language',
    'wishes into map filters over postal-code-area statistics. You do NOT have the data',
    'values yourself and you must NEVER state a statistic, ranking, or number about any',
    'specific area or postal code — the application computes the real matches from your',
    'filters. Your only job is to choose which data layers to filter on and in which',
    'direction.',
    '',
    'Express every criterion as a PERCENTILE RANGE from 0 to 100 over the national',
    'distribution of that layer, where 0 is the lowest observed value and 100 is the',
    'highest. Direction is up to you:',
    '- To favour a HIGH value (e.g. "lots of green" -> tree cover), use a high range like 60-100.',
    '- To favour a LOW value (e.g. "quiet" -> noise, "safe" -> crime), use a low range like 0-30.',
    '- "Moderate"/"average" maps to a middle band like 35-65.',
    'Use the layer\'s stated direction only to understand its meaning, not to flip the user\'s',
    'intent: the percentile range you give is always about the raw value of that layer.',
    '',
    'Pick only the few layers that genuinely match the request (typically 1-5). Do not add',
    'unrelated layers. If part of the request cannot be expressed by any available layer',
    '(e.g. "close to my mother", "nice neighbours"), list it in `unmatched` instead of forcing',
    'a bad layer. If the user asks for areas similar to a named place, put that place name in',
    '`similar_to`.',
    '',
    `Write \`title\`, \`explanation\` and any \`unmatched\` entries in ${langName}. The`,
    'explanation should say, in one or two sentences, which factors you used and their',
    'direction — never any figure about a place.',
    '',
    'Available data layers (id: description):',
    lines,
  ].join('\n');
}

// Structured output schema — the model must return exactly this shape. Using
// structured outputs (rather than forcing a tool call) keeps the request portable
// across models: it never collides with a model's default thinking mode, which a
// forced tool_choice can. Ranks are 0-100 percentile bounds; the frontend resolves
// them against real data.
const ProposeSearchSchema = z.object({
  title: z.string(),
  explanation: z.string(),
  criteria: z.array(
    z.object({
      layer_id: z.string(),
      min_percentile: z.number().int(),
      max_percentile: z.number().int(),
    }),
  ),
  similar_to: z.string().nullable(),
  unmatched: z.array(z.string()),
});

async function runAssist(query: string, lang: string, catalog: CatalogEntry[]): Promise<AssistResult> {
  const message = await getClient().messages.parse({
    model: MODEL,
    max_tokens: 1024,
    // Low effort: this is a short intent -> filter extraction, not a reasoning task.
    // Keeps latency and cost down, and on thinking-by-default models bounds the depth.
    output_config: {
      effort: 'low',
      format: zodOutputFormat(ProposeSearchSchema),
    },
    system: [{ type: 'text', text: buildSystemPrompt(catalog, lang), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: query }],
  });
  if (!message.parsed_output) {
    throw new Error('assistant returned no parsable output');
  }
  return sanitizeAssistOutput(message.parsed_output, new Set(catalog.map((c) => c.id)), lang);
}

const router = Router();

// Availability probe — the frontend calls this to decide whether to show the
// feature at all, mirroring the Lightning `configured` pattern.
router.get('/', (_req: Request, res: Response) => {
  res.json({ configured: isAssistConfigured() });
});

// Free tier: a modest per-IP burst limit plus a daily cap. A future Pro tier
// would branch here on the authenticated user's entitlement to lift these.
router.post(
  '/query',
  rateLimit(15, 60_000, 'assist'),
  rateLimit(200, 24 * 60 * 60_000, 'assist-day'),
  async (req: Request, res: Response) => {
    if (!isAssistConfigured()) {
      res.status(503).json({ error: 'Assistant not configured' });
      return;
    }
    const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    if (!query || query.length > MAX_QUERY_LEN) {
      res.status(400).json({ error: 'Invalid query' });
      return;
    }
    const langRaw = typeof req.body?.lang === 'string' ? req.body.lang : 'fi';
    const lang = LANGS.has(langRaw) ? langRaw : 'fi';
    const catalog = parseCatalog(req.body?.catalog);
    if (!catalog) {
      res.status(400).json({ error: 'Invalid catalog' });
      return;
    }

    try {
      const result = await runAssist(query, lang, catalog);
      res.json(result);
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) {
        res.status(429).json({ error: 'Too many requests. Please try again later.' });
        return;
      }
      // Never leak provider internals to the client; Sentry (wired in app.ts) keeps the detail.
      console.error('assist error:', err instanceof Error ? err.message : String(err));
      res.status(502).json({ error: 'Assistant unavailable' });
    }
  },
);

export default router;
