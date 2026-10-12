import { doseTableFor } from './catalog';
import type { DoseInput, DoseResult, DoseTable, DetergentType, Product, Soil } from './types';

/**
 * Modèle de dosage de JusteDose.
 *
 *   dose = doseRéférence × facteurCharge × facteurSalissure × facteurDureté
 *
 * - doseRéférence : dose « standard » de l'emballage (contenance ÷ nombre de lavages
 *   annoncé), valable pour ~5 kg de linge normalement sale en eau moyennement dure.
 * - Les coefficients sont des estimations prudentes, PAS des données constructeur.
 *   Ils sont regroupés ici pour être ajustés au même endroit.
 *
 * Recalage du 12/10/2026 : le tableau de dosage de Le Chat Excellence (seul relevé en ligne) donne,
 * pour la même lessive, de 45 mL (4-5 kg, peu sale, eau douce) à 140 mL (6-8 kg, très sale, eau dure),
 * alors que « contenance ÷ lavages » = 45 mL. La dose de l'emballage y correspond donc au cas le plus léger,
 * et l'ancien modèle (qui la prenait pour un cas « normal ») sous-dosait de 30 à 45 %. Chez X-tra, au contraire,
 * 45 mL est annoncé pour du linge « normalement sale » : la convention varie selon les marques. Par prudence,
 * les produits SANS tableau reçoivent des coefficients relevés (salissure, dureté) et un plancher à 70 %,
 * et l'app indique que la dose est estimée. À remplacer par le tableau du fabricant dès qu'il est relevé.
 *
 * Référence d'économie : la dose standard de l'emballage pour un TAMBOUR PLEIN du
 * lave-linge de l'utilisateur (linge normalement sale, dureté neutre). L'économie est
 * donc ce qu'on évite de verser par rapport à « je dose pour la machine, pas pour le linge ».
 */

export const REFERENCE_LOAD_KG = 5;
export const MIN_DOSE_FACTOR = 0.7; // jamais moins de 70 % de la dose de référence (voir la note de recalage ci-dessous)
export const MAX_DOSE_FACTOR = 2.0; // jamais plus du double

/** Charge : la lessive ne croît pas strictement avec le poids (une base fixe est nécessaire). */
export function loadFactor(kg: number): number {
  return 0.35 + 0.65 * (kg / REFERENCE_LOAD_KG);
}

export function soilFactor(soil: Soil): number {
  switch (soil) {
    case 'light':
      return 0.85;
    case 'normal':
      return 1;
    case 'heavy':
      return 1.35;
  }
}

/**
 * Dureté (°f) → facteur, par interpolation linéaire :
 * ≤ 5 °f → 0,80 · 22 °f → 1,00 (eau moyenne, référence emballage) · 30 °f → 1,20 · ≥ 45 °f → 1,50.
 *
 * Recalé le 12/10/2026 sur le tableau de dosage de Le Chat Excellence, qui prévoit +30 % à +55 %
 * en eau dure : l'ancien plafond (×1,25 à 45 °f) sous-dosait, ce qui est le pire des deux risques
 * (linge mal lavé, calcaire). Une seule marque a pu être relevée : à affiner avec d'autres tableaux.
 */
export function hardnessFactor(hardnessF: number): number {
  const points: Array<[number, number]> = [
    [5, 0.8],
    [22, 1],
    [30, 1.2],
    [45, 1.5],
  ];
  const last = points.length - 1;
  if (hardnessF <= points[0][0]) return points[0][1];
  if (hardnessF >= points[last][0]) return points[last][1];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    if (hardnessF >= x0 && hardnessF <= x1) {
      return y0 + ((y1 - y0) * (hardnessF - x0)) / (x1 - x0);
    }
  }
  return 1;
}

// ---------------------------------------------------------------- Tableau du fabricant

/** Dureté à partir de laquelle on bascule sur la colonne « eau dure » (transition progressive sur ±5 °f). */
const HARD_FROM_F = 30; // hypothèse : le seuil exact du fabricant n'est pas indiqué sur la fiche relevée

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Dose lue dans le tableau du fabricant.
 *  - à l'intérieur d'une tranche de charge, la dose du tableau est reprise telle quelle (c'est ce que dit l'emballage) ;
 *  - entre deux tranches (ex. 5,5 kg entre « 4-5 kg » et « 6-8 kg »), on passe progressivement de l'une à l'autre ;
 *  - sous la première tranche, la dose baisse comme dans le modèle générique ; au-delà de la dernière, elle reste constante ;
 *  - « normal » = milieu entre « peu sale » et « très sale » (le tableau n'a que ces deux colonnes) ;
 *  - dureté : passage progressif de la colonne douce-moyenne à la colonne dure autour de HARD_FROM_F.
 */
export function tableDose(t: DoseTable, kg: number, soil: Soil, hardnessF: number): number {
  const w = clamp01((hardnessF - (HARD_FROM_F - 5)) / 10);
  const pick = (c: { light: number; heavy: number }) => (soil === 'light' ? c.light : soil === 'heavy' ? c.heavy : (c.light + c.heavy) / 2);
  const value = (b: DoseTable['bands'][number]) => (1 - w) * pick(b.soft) + w * pick(b.hard);

  const bands = t.bands.map((b) => ({ minKg: b.minKg, maxKg: b.maxKg, v: value(b) }));
  if (t.overflow) {
    const last = bands[bands.length - 1];
    bands.push({ minKg: last.maxKg + 1, maxKg: t.overflow.upToKg, v: last.v + t.overflow.addDose });
  }

  const first = bands[0];
  if (kg < first.minKg) return (first.v * loadFactor(kg)) / loadFactor(first.minKg);
  for (let i = 0; i < bands.length; i++) {
    const cur = bands[i];
    if (kg <= cur.maxKg) return cur.v; // dans la tranche (ou à sa limite haute)
    const next = bands[i + 1];
    if (next && kg < next.minKg) {
      return cur.v + ((next.v - cur.v) * (kg - cur.maxKg)) / (next.minKg - cur.maxKg);
    }
  }
  return bands[bands.length - 1].v;
}

/** Dose standard d'un lavage (mL, g ou capsules) selon l'emballage. */
export function referenceDose(p: Product): number {
  return p.type === 'capsules' ? 1 : p.packSize / p.packWashes;
}

/** Prix par unité de dose (€/mL, €/g ou €/capsule). */
export function unitCost(p: Product): number {
  return p.packPriceEur / p.packSize;
}

export function doseUnit(type: DetergentType): DoseResult['unit'] {
  return type === 'liquid' ? 'mL' : type === 'powder' ? 'g' : 'capsule';
}

/**
 * Équivalent en mL d'une unité de dose, pour agréger des statistiques.
 * Approximation assumée : 1 g de poudre ≈ 1 mL ; une capsule ≈ 25 mL.
 */
export function mlPerUnit(type: DetergentType): number {
  return type === 'capsules' ? 25 : 1;
}

/** mL et g à l'unité près ; capsules entières (1 minimum). */
function roundDose(raw: number): number {
  return Math.max(1, Math.round(raw));
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function computeDose(input: DoseInput): DoseResult {
  const { product, weightKg, soil, hardnessF, machineKg } = input;
  const ref = referenceDose(product);
  const table = product.type === 'capsules' ? undefined : doseTableFor(product);

  if (table) {
    // Dose du fabricant ; référence d'économie = sa dose pour un tambour plein, linge normal, eau moyenne.
    const dose = roundDose(tableDose(table, weightKg, soil, hardnessF));
    const baselineDose = roundDose(tableDose(table, machineKg, 'normal', 20));
    const savedDose = Math.max(0, baselineDose - dose);
    const perUnit = unitCost(product);
    return {
      dose,
      unit: doseUnit(product.type),
      costEur: round3(dose * perUnit),
      baselineDose,
      savedDose,
      savedEur: round3(savedDose * perUnit),
      savedMl: round3(savedDose * mlPerUnit(product.type)),
      basis: 'table',
    };
  }

  const rawFactor = loadFactor(weightKg) * soilFactor(soil) * hardnessFactor(hardnessF);
  const factor = Math.min(MAX_DOSE_FACTOR, Math.max(MIN_DOSE_FACTOR, rawFactor));
  const dose = roundDose(ref * factor);

  const baselineDose = roundDose(ref * loadFactor(machineKg));
  const savedDose = Math.max(0, baselineDose - dose);

  const perUnit = unitCost(product);
  return {
    dose,
    unit: doseUnit(product.type),
    costEur: round3(dose * perUnit),
    baselineDose,
    savedDose,
    savedEur: round3(savedDose * perUnit),
    savedMl: round3(savedDose * mlPerUnit(product.type)),
    basis: 'model',
  };
}
