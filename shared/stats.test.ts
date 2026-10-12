import { describe, expect, it } from 'vitest';
import { computeStats } from './stats';
import type { Cycle } from './types';

const cycle = (over: Partial<Cycle> = {}): Cycle => ({
  id: crypto.randomUUID(), startedAt: 0, durationMin: 60, weightKg: 4, soil: 'normal', dose: 40, doseUnit: 'mL',
  costEur: 0.25, savedDose: 20, savedEur: 0.12, savedMl: 20, productLabel: 'Ariel Liquide', ...over,
});

describe('computeStats', () => {
  it('renvoie des zéros sans lavage', () => {
    expect(computeStats([])).toEqual({ totalWashes: 0, savedMl: 0, savedEur: 0, totalCostEur: 0, avgCostEur: 0 });
  });

  it('additionne les économies et calcule le coût moyen', () => {
    const s = computeStats([cycle(), cycle({ costEur: 0.35, savedMl: 30, savedEur: 0.2 })]);
    expect(s.totalWashes).toBe(2);
    expect(s.savedMl).toBe(50);
    expect(s.savedEur).toBeCloseTo(0.32, 5);
    expect(s.avgCostEur).toBeCloseTo(0.3, 5);
  });
});
