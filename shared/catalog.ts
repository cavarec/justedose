import raw from './products.json';
import type { CatalogProduct, DoseTable } from './types';

export const CATALOG: CatalogProduct[] = (raw.products as CatalogProduct[]).map((p) => ({ ...p }));

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // « X-tra » se trouve aussi en tapant « xtra »
    .trim();
}

/** Recherche tolérante (accents, casse) sur « marque + référence ». */
export function searchCatalog(query: string, products: CatalogProduct[] = CATALOG): CatalogProduct[] {
  const q = normalize(query);
  if (!q) return products;
  const terms = q.split(/\s+/);
  return products.filter((p) => {
    const hay = normalize(`${p.brand} ${p.name}`);
    return terms.every((t) => hay.includes(t));
  });
}

export function productLabel(p: { brand: string; name: string }): string {
  return `${p.brand} ${p.name}`.trim();
}

/** Tableau de dosage du fabricant pour cette lessive, s'il existe (les doses ne dépendent pas de la taille du paquet). */
export function doseTableFor(product: { id: string }): DoseTable | undefined {
  return CATALOG.find((c) => c.id === product.id)?.dosing;
}
