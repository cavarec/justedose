import type { DoseInput, DoseResult, DetergentType, Product, Soil } from './types';

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
 * Référence d'économie : la dose standard de l'emballage pour un TAMBOUR PLEIN du
 * lave-linge de l'utilisateur (linge normalement sale, dureté neutre). L'économie est
 * donc ce qu'on évite de verser par rapport à « je dose pour la machine, pas pour le linge ».
 */

export const REFERENCE_LOAD_KG = 5;
export const MIN_DOSE_FACTOR = 0.4; // jamais moins de 40 % de la dose de référence
export const MAX_DOSE_FACTOR = 2.0; // jamais plus du double

/** Charge : la lessive ne croît pas strictement avec le poids (une base fixe est nécessaire). */
export function loadFactor(kg: number): number {
  return 0.35 + 0.65 * (kg / REFERENCE_LOAD_KG);
}

export function soilFactor(soil: Soil): number {
  switch (soil) {
    case 'light':
      return 0.75;
    case 'normal':
      return 1;
    case 'heavy':
      return 1.25;
  }
}

/**
 * Dureté (°f) → facteur, par interpolation linéaire :
 * ≤ 5 °f → 0,80 · 22 °f → 1,00 (eau moyenne, référence emballage) · ≥ 45 °f → 1,25.
 */
export function hardnessFactor(hardnessF: number): number {
  const points: Array<[number, number]> = [
    [5, 0.8],
    [22, 1],
    [45, 1.25],
  ];
  if (hardnessF <= points[0][0]) return points[0][1];
  if (hardnessF >= points[2][0]) return points[2][1];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    if (hardnessF >= x0 && hardnessF <= x1) {
      return y0 + ((y1 - y0) * (hardnessF - x0)) / (x1 - x0);
    }
  }
  return 1;
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
  };
}
