import type { Cycle } from './types';

export interface Stats {
  totalWashes: number;
  /** Lessive économisée, en mL équivalents (voir `mlPerUnit`). */
  savedMl: number;
  savedEur: number;
  totalCostEur: number;
  /** Coût moyen par lavage (0 s'il n'y a aucun lavage). */
  avgCostEur: number;
}

export function computeStats(cycles: Cycle[]): Stats {
  let savedMl = 0;
  let savedEur = 0;
  let totalCostEur = 0;
  for (const c of cycles) {
    savedMl += c.savedMl;
    savedEur += c.savedEur;
    totalCostEur += c.costEur;
  }
  const totalWashes = cycles.length;
  return {
    totalWashes,
    savedMl,
    savedEur,
    totalCostEur,
    avgCostEur: totalWashes ? totalCostEur / totalWashes : 0,
  };
}
