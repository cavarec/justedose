import { describe, expect, it } from 'vitest';
import { computeDose, hardnessFactor, loadFactor, referenceDose } from './dosing';
import { CATALOG, searchCatalog } from './catalog';
import { categoryFromHardness, lookupWater } from './water';
import type { Product } from './types';

// Fixtures figées : les tests de calcul ne dépendent pas du catalogue (dont les valeurs évoluent).
const ariel: Product = { id: 'fx-liquide', brand: 'Test', name: 'Liquide', type: 'liquid', packSize: 1500, packWashes: 30, packPriceEur: 9.5, verified: true };
const capsules: Product = { id: 'fx-capsules', brand: 'Test', name: 'Capsules', type: 'capsules', packSize: 30, packWashes: 30, packPriceEur: 9, verified: true };

describe('computeDose', () => {
  it('donne la dose de référence pour 5 kg, normal, eau à 22 °f', () => {
    const r = computeDose({ product: ariel, weightKg: 5, soil: 'normal', hardnessF: 22, machineKg: 8 });
    expect(referenceDose(ariel)).toBe(50);
    expect(r.dose).toBe(50);
    expect(r.unit).toBe('mL');
  });

  it('réduit la dose pour peu de linge, peu sale, eau douce', () => {
    const r = computeDose({ product: ariel, weightKg: 3, soil: 'light', hardnessF: 8, machineKg: 8 });
    expect(r.dose).toBeLessThan(30);
    expect(r.savedDose).toBeGreaterThan(20);
    expect(r.savedEur).toBeGreaterThan(0);
  });

  it('augmente la dose pour du linge très sale en eau dure', () => {
    const base = computeDose({ product: ariel, weightKg: 5, soil: 'normal', hardnessF: 22, machineKg: 8 });
    const hard = computeDose({ product: ariel, weightKg: 5, soil: 'heavy', hardnessF: 40, machineKg: 8 });
    expect(hard.dose).toBeGreaterThan(base.dose);
  });

  it("ne renvoie jamais d'économie négative", () => {
    const r = computeDose({ product: ariel, weightKg: 8, soil: 'heavy', hardnessF: 45, machineKg: 6 });
    expect(r.savedDose).toBe(0);
    expect(r.savedEur).toBe(0);
  });

  it('est monotone en poids, salissure et dureté', () => {
    const d = (kg: number) => computeDose({ product: ariel, weightKg: kg, soil: 'normal', hardnessF: 22, machineKg: 10 }).dose;
    for (let kg = 2; kg < 8; kg++) expect(d(kg + 1)).toBeGreaterThanOrEqual(d(kg));
    expect(hardnessFactor(10)).toBeLessThan(hardnessFactor(30));
    expect(loadFactor(8)).toBeGreaterThan(loadFactor(2));
  });

  it('calcule le coût au prorata du prix du paquet', () => {
    const r = computeDose({ product: ariel, weightKg: 5, soil: 'normal', hardnessF: 22, machineKg: 8 });
    expect(r.costEur).toBeCloseTo((9.5 / 1500) * 50, 3);
  });

  it('gère les capsules par nombre entier (minimum 1)', () => {
    const small = computeDose({ product: capsules, weightKg: 2, soil: 'light', hardnessF: 8, machineKg: 8 });
    expect(small.dose).toBe(1);
    expect(small.unit).toBe('capsule');
    const big = computeDose({ product: capsules, weightKg: 8, soil: 'heavy', hardnessF: 35, machineKg: 10 });
    expect(Number.isInteger(big.dose)).toBe(true);
    expect(big.dose).toBeGreaterThanOrEqual(2);
  });

  it('borne la dose entre 40 % et 200 % de la référence', () => {
    const p: Product = { ...ariel };
    const lo = computeDose({ product: p, weightKg: 2, soil: 'light', hardnessF: 3, machineKg: 8 });
    const hi = computeDose({ product: p, weightKg: 8, soil: 'heavy', hardnessF: 60, machineKg: 8 });
    expect(lo.dose).toBeGreaterThanOrEqual(20);
    expect(hi.dose).toBeLessThanOrEqual(100);
  });
});

describe('water', () => {
  it('trouve la dureté par département', () => {
    expect(lookupWater('29260')?.category).toBe('soft');
    expect(lookupWater('75011')?.category).toBe('hard');
    expect(lookupWater('97100')).not.toBeNull();
    expect(lookupWater('20000')).not.toBeNull();
  });
  it('rejette les codes invalides', () => {
    expect(lookupWater('2926')).toBeNull();
    expect(lookupWater('abcde')).toBeNull();
    expect(lookupWater('99999')).toBeNull();
  });
  it('catégorise', () => {
    expect(categoryFromHardness(14)).toBe('soft');
    expect(categoryFromHardness(15)).toBe('medium');
    expect(categoryFromHardness(25)).toBe('medium');
    expect(categoryFromHardness(26)).toBe('hard');
  });
});

describe('catalogue', () => {
  it('couvre les cinq marques demandées, avec les trois types de lessive', () => {
    for (const brand of ['Ariel', 'Persil', 'Le Chat', 'X-tra', 'Maison Verte']) {
      expect(CATALOG.some((p) => p.brand === brand)).toBe(true);
    }
    for (const type of ['liquid', 'powder', 'capsules']) expect(CATALOG.some((p) => p.type === type)).toBe(true);
  });
  it('chaque référence vérifiée porte sa source et sa date ; aucun prix non sourcé', () => {
    for (const p of CATALOG) {
      if (p.verified) expect(p.sourceUrl && /^\d{4}-\d{2}-\d{2}$/.test(p.checkedAt ?? '')).toBeTruthy();
      if (p.packPriceEur !== undefined) expect(p.sourceUrl && p.checkedAt).toBeTruthy();
    }
  });
  it('recherche sans tenir compte des accents ni de la casse', () => {
    expect(searchCatalog('LE CHAT').every((p) => p.brand === 'Le Chat')).toBe(true);
    expect(searchCatalog('fraicheur ete').some((p) => p.brand === 'Maison Verte')).toBe(true);
    expect(searchCatalog('xtra').some((p) => p.brand === 'X-tra')).toBe(true);
    expect(searchCatalog('zzz')).toHaveLength(0);
  });
});
