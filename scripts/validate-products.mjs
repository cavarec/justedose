// Valide shared/products.json (ids uniques, types, nombres positifs).
// Usage : npm run validate:products
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'shared', 'products.json');
const { products } = JSON.parse(readFileSync(file, 'utf8'));

const TYPES = new Set(['liquid', 'powder', 'capsules']);
const errors = [];
const ids = new Set();

for (const [i, p] of products.entries()) {
  const where = `products[${i}] (${p.id ?? '?'})`;
  if (!p.id || typeof p.id !== 'string') errors.push(`${where}: id manquant`);
  else if (ids.has(p.id)) errors.push(`${where}: id en double`);
  else ids.add(p.id);
  if (!p.brand) errors.push(`${where}: brand manquant`);
  if (!p.name) errors.push(`${where}: name manquant`);
  if (!TYPES.has(p.type)) errors.push(`${where}: type invalide (${p.type})`);
  for (const k of ['packSize', 'packWashes', 'packPriceEur']) {
    if (typeof p[k] !== 'number' || !(p[k] > 0)) errors.push(`${where}: ${k} doit être un nombre > 0`);
  }
  if (typeof p.verified !== 'boolean') errors.push(`${where}: verified doit être un booléen`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`✓ ${products.length} lessives valides`);
