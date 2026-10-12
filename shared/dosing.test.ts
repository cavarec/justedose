import { describe, expect, it } from 'vitest';
import { computeDose, hardnessFactor, loadFactor, referenceDose, tableDose } from './dosing';
import { CATALOG, doseTableFor, searchCatalog } from './catalog';
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
    expect(r.dose).toBeLessThanOrEqual(35); // plancher : 70 % de la dose de référence
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

  it('borne la dose entre 70 % et 200 % de la référence', () => {
    const p: Product = { ...ariel };
    const lo = computeDose({ product: p, weightKg: 2, soil: 'light', hardnessF: 3, machineKg: 8 });
    const hi = computeDose({ product: p, weightKg: 8, soil: 'heavy', hardnessF: 60, machineKg: 8 });
    expect(lo.dose).toBeGreaterThanOrEqual(35);
    expect(hi.dose).toBeLessThanOrEqual(100);
  });
});

describe('tableau de dosage du fabricant (Le Chat Excellence)', () => {
  const lechat = CATALOG.find((p) => p.id === 'le-chat-excellence-liquide')!;
  const table = doseTableFor(lechat)!;
  const dose = (kg: number, soil: 'light' | 'normal' | 'heavy', h: number, machineKg = 8) =>
    computeDose({ product: lechat as unknown as Product, weightKg: kg, soil, hardnessF: h, machineKg });

  it('existe et sert de base de calcul', () => {
    expect(table.bands).toHaveLength(2);
    expect(dose(5, 'light', 10).basis).toBe('table');
  });

  it("reprend le tableau tel quel dans chaque tranche, sans dépasser sa dose maximale", () => {
    for (const kg of [4, 4.5, 5]) expect(tableDose(table, kg, 'heavy', 10)).toBe(70);
    for (const kg of [6, 7, 8]) expect(tableDose(table, kg, 'heavy', 10)).toBe(90);
    expect(computeDose({ product: lechat as unknown as Product, weightKg: 8, soil: 'heavy', hardnessF: 10, machineKg: 8 }).dose).toBe(90);
  });

  it('passe progressivement d\'une tranche à l\'autre (5 → 6 kg) et diminue sous 4 kg', () => {
    expect(tableDose(table, 5.5, 'light', 10)).toBeCloseTo(57.5);
    expect(tableDose(table, 3, 'light', 10)).toBeLessThan(45);
    expect(tableDose(table, 3, 'light', 10)).toBeGreaterThan(25);
  });

  it("restitue les valeurs du tableau aux centres des tranches (eau douce/moyenne)", () => {
    expect(tableDose(table, 4.5, 'light', 10)).toBe(45);
    expect(tableDose(table, 4.5, 'heavy', 10)).toBe(70);
    expect(tableDose(table, 7, 'light', 10)).toBe(70);
    expect(tableDose(table, 7, 'heavy', 10)).toBe(90);
  });

  it('restitue les valeurs du tableau en eau dure (≥ 35 °f)', () => {
    expect(tableDose(table, 4.5, 'light', 40)).toBe(70);
    expect(tableDose(table, 4.5, 'heavy', 40)).toBe(90);
    expect(tableDose(table, 7, 'light', 40)).toBe(90);
    expect(tableDose(table, 7, 'heavy', 40)).toBe(140);
  });

  it('ajoute 50 mL pour 9-10 kg', () => {
    expect(tableDose(table, 9.5, 'heavy', 10)).toBe(140);
    expect(tableDose(table, 9.5, 'light', 40)).toBe(140);
  });

  it('« normal » est entre « peu sale » et « très sale » ; la transition de dureté est progressive', () => {
    expect(tableDose(table, 7, 'normal', 10)).toBe(80);
    const mid = tableDose(table, 7, 'light', 30);
    expect(mid).toBeGreaterThan(70);
    expect(mid).toBeLessThan(90);
  });

  it("n'est jamais décroissante avec la charge, la salissure ni la dureté", () => {
    for (const soil of ['light', 'normal', 'heavy'] as const) {
      for (const h of [5, 20, 30, 40]) {
        let prev = 0;
        for (let kg = 2; kg <= 10; kg += 0.5) {
          const v = tableDose(table, kg, soil, h);
          expect(v).toBeGreaterThanOrEqual(prev);
          prev = v;
        }
      }
    }
    expect(tableDose(table, 6, 'light', 10)).toBeLessThanOrEqual(tableDose(table, 6, 'heavy', 10));
    expect(tableDose(table, 6, 'normal', 10)).toBeLessThanOrEqual(tableDose(table, 6, 'normal', 40));
  });

  it("calcule l'économie contre la dose du fabricant pour un tambour plein (8 kg, normal, eau moyenne = 80 mL)", () => {
    const r = dose(4, 'light', 10, 8);
    expect(r.baselineDose).toBe(80);
    expect(r.savedDose).toBe(r.baselineDose - r.dose);
    expect(r.savedDose).toBeGreaterThan(30);
  });

  it("pas d'économie fictive : charge pleine très sale en eau dure → dose pleine", () => {
    expect(dose(8, 'heavy', 40, 8).savedDose).toBe(0);
  });

  it('une lessive sans tableau reste en modèle générique', () => {
    expect(computeDose({ product: ariel, weightKg: 5, soil: 'normal', hardnessF: 22, machineKg: 8 }).basis).toBe('model');
  });
});

describe('dureté : coefficient recalé', () => {
  it('suit les repères connus', () => {
    expect(hardnessFactor(5)).toBe(0.8);
    expect(hardnessFactor(22)).toBe(1);
    expect(hardnessFactor(30)).toBeCloseTo(1.2);
    expect(hardnessFactor(45)).toBeCloseTo(1.5);
    expect(hardnessFactor(80)).toBeCloseTo(1.5);
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
