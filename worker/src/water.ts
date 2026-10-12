import { POSTAL_CODE_RE, categoryFromHardness, lookupWater } from '../../shared/water';
import type { CommuneWater, WaterLookup } from '../../shared/types';

/**
 * Dureté de l'eau PAR COMMUNE, à partir de sources officielles ouvertes :
 *  - geo.api.gouv.fr : code postal → communes ;
 *  - Hub'Eau « qualité de l'eau potable » (données du contrôle sanitaire des ARS) :
 *    paramètre 1345 = titre hydrotimétrique (TH), en °f.
 * Si aucune mesure récente n'existe, on retombe sur l'estimation départementale.
 */

const GEO_URL = 'https://geo.api.gouv.fr/communes';
const HUBEAU_URL = 'https://hubeau.eaufrance.fr/api/v1/qualite_eau_potable/resultats_dis';
const TH_PARAM = '1345';
const MAX_COMMUNES = 8; // un code postal rural couvre souvent 5 à 10 communes
const SAMPLES_PER_COMMUNE = 20;
const WINDOW_DAYS = 730; // mesures des 2 dernières années
const TIMEOUT_MS = 5000;

type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

async function getJson<T>(fetchFn: FetchFn, url: string): Promise<T> {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${new URL(url).host} → ${res.status}`);
  return (await res.json()) as T;
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

interface HubEauRow {
  resultat_numerique?: unknown;
  date_prelevement?: unknown;
}

/** Garde les mesures plausibles (0–80 °f) : une valeur aberrante ne doit pas fausser la dose. */
export function summarizeSamples(rows: HubEauRow[]): Pick<CommuneWater, 'hardnessF' | 'samples' | 'lastSampleAt'> {
  const good = rows.filter(
    (r): r is { resultat_numerique: number; date_prelevement: string } =>
      typeof r.resultat_numerique === 'number' &&
      Number.isFinite(r.resultat_numerique) &&
      r.resultat_numerique >= 0 &&
      r.resultat_numerique <= 80 &&
      typeof r.date_prelevement === 'string',
  );
  if (!good.length) return { hardnessF: null, samples: 0, lastSampleAt: null };
  const last = good.map((r) => r.date_prelevement).sort().at(-1)!;
  return {
    hardnessF: Math.round(median(good.map((r) => r.resultat_numerique))),
    samples: good.length,
    lastSampleAt: last.slice(0, 10),
  };
}

export async function fetchWater(postalCode: string, fetchFn: FetchFn = fetch, now = Date.now()): Promise<WaterLookup | null> {
  if (!POSTAL_CODE_RE.test(postalCode)) return null;

  let geo: Array<{ nom: string; code: string; population?: number }> = [];
  try {
    geo = await getJson(fetchFn, `${GEO_URL}?codePostal=${postalCode}&fields=nom,code,population`);
  } catch (err) {
    console.warn('geo.api.gouv.fr indisponible', err);
  }
  const top = geo
    .filter((c) => typeof c.code === 'string' && typeof c.nom === 'string')
    .sort((a, b) => (b.population ?? 0) - (a.population ?? 0))
    .slice(0, MAX_COMMUNES);

  const since = new Date(now - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const communes: CommuneWater[] = await Promise.all(
    top.map(async (c) => {
      const base = { code: c.code, name: c.nom, population: c.population ?? 0 };
      try {
        const url =
          `${HUBEAU_URL}?code_commune=${c.code}&code_parametre=${TH_PARAM}&size=${SAMPLES_PER_COMMUNE}` +
          `&sort=desc&fields=resultat_numerique,date_prelevement&date_min_prelevement=${since}`;
        const { data } = await getJson<{ data?: HubEauRow[] }>(fetchFn, url);
        return { ...base, ...summarizeSamples(data ?? []) };
      } catch (err) {
        console.warn(`Hub'Eau indisponible pour ${c.code}`, err);
        return { ...base, hardnessF: null, samples: 0, lastSampleAt: null };
      }
    }),
  );

  const best = communes.find((c) => c.hardnessF !== null); // déjà triées par population décroissante
  if (best && best.hardnessF !== null) {
    return {
      postalCode,
      communes,
      suggested: {
        postalCode,
        hardnessF: best.hardnessF,
        category: categoryFromHardness(best.hardnessF),
        commune: best.name,
        source: 'commune',
      },
    };
  }
  const dept = lookupWater(postalCode);
  if (!dept) return communes.length ? { postalCode, communes, suggested: { postalCode, hardnessF: 20, category: 'medium', source: 'manual' } } : null;
  return { postalCode, communes, suggested: { ...dept, source: 'department' } };
}

// ---------------------------------------------------------------- Cache D1 (30 jours)
const CACHE_TTL_MS = 30 * 86_400_000;

export async function cachedWater(db: D1Database, postalCode: string, fetchFn: FetchFn = fetch): Promise<WaterLookup | null> {
  const now = Date.now();
  const hit = await db
    .prepare('SELECT payload, fetched_at FROM water_cache WHERE postal_code = ?1')
    .bind(postalCode)
    .first<{ payload: string; fetched_at: number }>();
  if (hit && now - hit.fetched_at < CACHE_TTL_MS) return JSON.parse(hit.payload) as WaterLookup;

  const fresh = await fetchWater(postalCode, fetchFn, now);
  // Ne mémorise pas un repli départemental : il provient souvent d'une panne passagère des API.
  if (fresh && fresh.suggested.source === 'commune') {
    await db
      .prepare(
        `INSERT INTO water_cache (postal_code, payload, fetched_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(postal_code) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
      )
      .bind(postalCode, JSON.stringify(fresh), now)
      .run();
  }
  // En cas de panne et de repli, une ancienne valeur communale vaut mieux que le département.
  if ((!fresh || fresh.suggested.source !== 'commune') && hit) return JSON.parse(hit.payload) as WaterLookup;
  return fresh;
}
