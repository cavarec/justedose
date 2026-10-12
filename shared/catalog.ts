import raw from './products.json';
import type { Product } from './types';

export const CATALOG: Product[] = (raw.products as Product[]).map((p) => ({ ...p }));

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Recherche tolérante (accents, casse) sur « marque + référence ». */
export function searchCatalog(query: string, products: Product[] = CATALOG): Product[] {
  const q = normalize(query);
  if (!q) return products;
  const terms = q.split(/\s+/);
  return products.filter((p) => {
    const hay = normalize(`${p.brand} ${p.name}`);
    return terms.every((t) => hay.includes(t));
  });
}

export function productLabel(p: Product): string {
  return `${p.brand} ${p.name}`.trim();
}
