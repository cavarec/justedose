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
  /** false = valeurs non confirmées (ex. saisie non relue), à vérifier avec l'emballage. */
  verified: boolean;
  /** true = ajoutée par l'utilisateur. */
  custom?: boolean;
}

/**
 * Lessive du catalogue. Contenance et nombre de lavages viennent d'une fiche produit
 * (voir sourceUrl / checkedAt). Le prix, qui varie selon l'enseigne, n'est PAS fourni :
 * l'utilisateur saisit ce qu'il a payé.
 */
/**
 * Tableau de dosage publié par le fabricant : dose (mL ou g) par tranche de charge, selon la
 * salissure (peu sale / très sale) et la dureté (douce-moyenne / dure).
 */
export interface DoseTable {
  /** Tranches de charge, de la plus légère à la plus lourde. */
  bands: Array<{
    minKg: number;
    maxKg: number;
    soft: { light: number; heavy: number };
    hard: { light: number; heavy: number };
  }>;
  /** Au-delà de la dernière tranche, jusqu'à `upToKg` : dose de la dernière tranche + `addDose`. */
  overflow?: { upToKg: number; addDose: number };
}

export interface CatalogProduct extends Omit<Product, 'packPriceEur'> {
  /** Tableau de dosage du fabricant, quand il a pu être relevé (sinon : modèle générique). */
  dosing?: DoseTable;
  /** Page où le tableau a été relevé, et date (AAAA-MM-JJ). */
  dosingSourceUrl?: string;
  dosingCheckedAt?: string;
  /** Prix indicatif, s'il est sourcé. Absent = à saisir par l'utilisateur. */
  packPriceEur?: number;
  ean?: string;
  /** Fiche produit consultée pour contenance et nombre de lavages. */
  sourceUrl?: string;
  /** Date de vérification (AAAA-MM-JJ). */
  checkedAt?: string;
}

export interface WaterInfo {
  postalCode: string;
  /** Dureté en degrés français (°f). */
  hardnessF: number;
  category: HardnessCategory;
  /** Commune retenue quand la dureté vient d'une mesure communale. */
  commune?: string;
  /** Origine de la valeur : mesure communale, estimation départementale ou choix manuel. */
  source?: 'commune' | 'department' | 'manual';
}

/** Dureté mesurée pour une commune (données officielles du contrôle sanitaire). */
export interface CommuneWater {
  code: string;
  name: string;
  population: number;
  /** Médiane des mesures récentes (°f), ou null s'il n'y en a pas. */
  hardnessF: number | null;
  samples: number;
  /** Date de la mesure la plus récente (AAAA-MM-JJ). */
  lastSampleAt: string | null;
}

/** Réponse de GET /api/water. */
export interface WaterLookup {
  postalCode: string;
  /** Communes du code postal, les plus peuplées d'abord. */
  communes: CommuneWater[];
  /** Valeur proposée par défaut (commune la plus peuplée ayant des mesures, sinon département). */
  suggested: WaterInfo;
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
  /** D'où vient la dose : tableau du fabricant, ou modèle générique de JusteDose. */
  basis: 'table' | 'model';
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
