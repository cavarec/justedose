// Types partagés entre le frontend (web/) et le backend (worker/).

export type DetergentType = 'liquid' | 'powder' | 'capsules';
export type Soil = 'light' | 'normal' | 'heavy';
export type HardnessCategory = 'soft' | 'medium' | 'hard';

/**
 * Une lessive. Les quantités sont exprimées dans l'unité naturelle du type :
 *  - liquid   → mL
 *  - powder   → g
 *  - capsules → nombre de capsules
 */
export interface Product {
  id: string;
  brand: string;
  /** Référence / nom du produit, ex. « Liquide ». */
  name: string;
  type: DetergentType;
  /** Contenance du paquet : mL, g ou nombre de capsules. */
  packSize: number;
  /** Nombre de lavages annoncé sur l'emballage (= packSize pour des capsules). */
  packWashes: number;
  /** Prix du paquet en euros. */
  packPriceEur: number;
  /** false = valeurs de démonstration, à confirmer avec l'emballage. */
  verified: boolean;
  /** true = ajoutée par l'utilisateur. */
  custom?: boolean;
}

export interface WaterInfo {
  postalCode: string;
  /** Dureté en degrés français (°f). */
  hardnessF: number;
  category: HardnessCategory;
}

export interface DoseInput {
  product: Product;
  weightKg: number;
  soil: Soil;
  hardnessF: number;
  /** Capacité du lave-linge en kg (« 10 kg et + » = 10). */
  machineKg: number;
}

export interface DoseResult {
  /** Dose recommandée (mL, g ou capsules). */
  dose: number;
  unit: 'mL' | 'g' | 'capsule';
  costEur: number;
  /** Dose standard de l'emballage pour un tambour plein (référence d'économie). */
  baselineDose: number;
  savedDose: number;
  savedEur: number;
  /** Économie convertie en « mL équivalents » pour les statistiques. */
  savedMl: number;
}

export interface Cycle {
  /** UUID généré côté client : rend l'envoi au serveur idempotent. */
  id: string;
  startedAt: number; // epoch ms
  durationMin: number;
  weightKg: number;
  soil: Soil;
  dose: number;
  doseUnit: 'mL' | 'g' | 'capsule';
  costEur: number;
  savedDose: number;
  savedEur: number;
  savedMl: number;
  productLabel: string;
}

export interface Profile {
  water: WaterInfo;
  product: Product;
  machineKg: number;
}
