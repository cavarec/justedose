import type { HardnessCategory, WaterInfo } from './types';

/**
 * Dureté de l'eau (°f) PAR DÉPARTEMENT — valeurs typiques arrondies.
 *
 * ⚠ Approximation : la dureté réelle varie d'une commune à l'autre (et selon la
 * ressource du réseau). L'application affiche la valeur détectée et laisse
 * l'utilisateur ajuster la catégorie. Pour une précision communale, remplacer
 * `lookupWater` par un appel à une source officielle (ex. données ARS / SISE-Eaux).
 */
const HARDNESS_BY_DEPARTMENT: Record<string, number> = {
  '01': 25, '02': 28, '03': 12, '04': 22, '05': 22, '06': 22, '07': 10, '08': 25, '09': 15,
  '10': 30, '11': 22, '12': 12, '13': 17, '14': 25, '15': 6, '16': 28, '17': 28, '18': 24,
  '19': 7, '2A': 12, '2B': 12, '21': 28, '22': 9, '23': 5, '24': 26, '25': 28, '26': 25,
  '27': 30, '28': 32, '29': 8, '30': 25, '31': 20, '32': 28, '33': 18, '34': 25, '35': 12,
  '36': 24, '37': 28, '38': 22, '39': 28, '40': 12, '41': 28, '42': 12, '43': 8, '44': 16,
  '45': 28, '46': 28, '47': 25, '48': 8, '49': 18, '50': 12, '51': 30, '52': 30, '53': 15,
  '54': 28, '55': 30, '56': 10, '57': 28, '58': 20, '59': 25, '60': 30, '61': 18, '62': 28,
  '63': 12, '64': 15, '65': 14, '66': 22, '67': 22, '68': 22, '69': 22, '70': 22, '71': 22,
  '72': 22, '73': 20, '74': 22, '75': 30, '76': 28, '77': 32, '78': 32, '79': 28, '80': 30,
  '81': 20, '82': 24, '83': 22, '84': 20, '85': 18, '86': 26, '87': 8, '88': 12, '89': 30,
  '90': 22, '91': 32, '92': 30, '93': 30, '94': 30, '95': 32,
  // Outre-mer (3 premiers chiffres)
  '971': 12, '972': 10, '973': 5, '974': 8, '976': 12,
};

export const POSTAL_CODE_RE = /^\d{5}$/;

/** Échelle usuelle : < 15 °f douce · 15–25 °f moyenne · > 25 °f dure. */
export function categoryFromHardness(hardnessF: number): HardnessCategory {
  if (hardnessF < 15) return 'soft';
  if (hardnessF <= 25) return 'medium';
  return 'hard';
}

/** Dureté représentative d'une catégorie (utilisée quand l'utilisateur corrige à la main). */
export const HARDNESS_OF_CATEGORY: Record<HardnessCategory, number> = {
  soft: 10,
  medium: 20,
  hard: 32,
};

function departmentOf(postalCode: string): string | null {
  if (postalCode.startsWith('97')) return postalCode.slice(0, 3);
  if (postalCode.startsWith('20')) {
    // Corse : 200xx–201xx = Corse-du-Sud (2A), 202xx+ = Haute-Corse (2B)
    return Number(postalCode.slice(0, 3)) <= 201 ? '2A' : '2B';
  }
  return postalCode.slice(0, 2);
}

/** Retourne la dureté estimée pour un code postal, ou null s'il est inconnu/invalide. */
export function lookupWater(postalCode: string): WaterInfo | null {
  if (!POSTAL_CODE_RE.test(postalCode)) return null;
  const dept = departmentOf(postalCode);
  const hardnessF = dept ? HARDNESS_BY_DEPARTMENT[dept] : undefined;
  if (hardnessF === undefined) return null;
  return { postalCode, hardnessF, category: categoryFromHardness(hardnessF) };
}
