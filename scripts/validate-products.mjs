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
  for (const k of ['packSize', 'packWashes']) {
    if (typeof p[k] !== 'number' || !(p[k] > 0)) errors.push(`${where}: ${k} doit être un nombre > 0`);
  }
  // Le prix est facultatif (à saisir par l'utilisateur) mais, s'il est présent, il doit être sourcé.
  if (p.packPriceEur !== undefined) {
    if (typeof p.packPriceEur !== 'number' || !(p.packPriceEur > 0)) errors.push(`${where}: packPriceEur doit être un nombre > 0`);
    if (!p.sourceUrl || !p.checkedAt) errors.push(`${where}: un prix exige sourceUrl et checkedAt`);
  }
  if (p.verified === true && (!p.sourceUrl || !/^\d{4}-\d{2}-\d{2}$/.test(p.checkedAt ?? ''))) {
    errors.push(`${where}: verified exige sourceUrl et checkedAt (AAAA-MM-JJ)`);
  }
  if (p.dosing !== undefined) {
    const t = p.dosing;
    const okNum = (n) => typeof n === 'number' && n > 0;
    if (p.type === 'capsules') errors.push(`${where}: dosing n'a pas de sens pour des capsules`);
    if (!p.dosingSourceUrl || !/^\d{4}-\d{2}-\d{2}$/.test(p.dosingCheckedAt ?? '')) errors.push(`${where}: dosing exige dosingSourceUrl et dosingCheckedAt`);
    if (!Array.isArray(t.bands) || t.bands.length === 0) errors.push(`${where}: dosing.bands manquant`);
    else {
      let prevMax = 0;
      for (const [j, b] of t.bands.entries()) {
        const w = `${where} bands[${j}]`;
        if (!(b.minKg > prevMax - 1 && b.maxKg >= b.minKg)) errors.push(`${w}: tranches de charge incohérentes`);
        prevMax = b.maxKg;
        for (const c of ['soft', 'hard']) {
          if (!okNum(b[c]?.light) || !okNum(b[c]?.heavy)) errors.push(`${w}: ${c}.light/heavy doivent être des nombres > 0`);
          else if (b[c].heavy < b[c].light) errors.push(`${w}: ${c}.heavy < ${c}.light`);
        }
        if (okNum(b.soft?.light) && okNum(b.hard?.light) && (b.hard.light < b.soft.light || b.hard.heavy < b.soft.heavy)) errors.push(`${w}: l'eau dure ne peut pas demander moins que l'eau douce`);
        if (j > 0 && okNum(b.soft?.light) && b.soft.light < t.bands[j - 1].soft.light) errors.push(`${w}: la dose doit croître avec la charge`);
      }
    }
    if (t.overflow && !(okNum(t.overflow.addDose) && t.overflow.upToKg > (t.bands.at(-1)?.maxKg ?? 0))) errors.push(`${where}: dosing.overflow invalide`);
  }
  if (p.type === 'capsules' && p.packSize !== p.packWashes) errors.push(`${where}: capsules → packWashes doit égaler packSize`);
  if (typeof p.verified !== 'boolean') errors.push(`${where}: verified doit être un booléen`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`✓ ${products.length} lessives valides`);
