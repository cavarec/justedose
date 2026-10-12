import type { Cycle, DetergentType, HardnessCategory, Profile, Soil } from '../../shared/types';

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown, max = 200): x is string => typeof x === 'string' && x.length > 0 && x.length <= max;
const isNum = (x: unknown, min: number, max: number): x is number =>
  typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max;

const SOILS: Soil[] = ['light', 'normal', 'heavy'];
const TYPES: DetergentType[] = ['liquid', 'powder', 'capsules'];
const CATEGORIES: HardnessCategory[] = ['soft', 'medium', 'hard'];
const UNITS = ['mL', 'g', 'capsule'] as const;

export function parseCycle(x: unknown): Cycle | null {
  if (!isObj(x)) return null;
  if (!isStr(x.id, 64) || !/^[\w-]+$/.test(x.id)) return null;
  if (!isNum(x.startedAt, 0, 4_102_444_800_000)) return null;
  if (!isNum(x.durationMin, 5, 600)) return null;
  if (!isNum(x.weightKg, 1, 30)) return null;
  if (!SOILS.includes(x.soil as Soil)) return null;
  if (!isNum(x.dose, 0, 5000)) return null;
  if (!UNITS.includes(x.doseUnit as (typeof UNITS)[number])) return null;
  if (!isNum(x.costEur, 0, 1000)) return null;
  if (!isNum(x.savedDose, 0, 5000)) return null;
  if (!isNum(x.savedEur, 0, 1000)) return null;
  if (!isNum(x.savedMl, 0, 50000)) return null;
  if (!isStr(x.productLabel, 120)) return null;
  return {
    id: x.id,
    startedAt: Math.round(x.startedAt),
    durationMin: Math.round(x.durationMin),
    weightKg: Math.round(x.weightKg),
    soil: x.soil as Soil,
    dose: x.dose,
    doseUnit: x.doseUnit as Cycle['doseUnit'],
    costEur: x.costEur,
    savedDose: x.savedDose,
    savedEur: x.savedEur,
    savedMl: x.savedMl,
    productLabel: x.productLabel,
  };
}

export function parseProfile(x: unknown): Profile | null {
  if (!isObj(x) || !isObj(x.water) || !isObj(x.product)) return null;
  const w = x.water;
  const p = x.product;
  if (typeof w.postalCode !== 'string' || !/^\d{5}$/.test(w.postalCode)) return null;
  if (!isNum(w.hardnessF, 0, 100)) return null;
  if (!CATEGORIES.includes(w.category as HardnessCategory)) return null;
  if (!isNum(x.machineKg, 1, 30)) return null;
  if (!isStr(p.id, 80) || !isStr(p.brand, 80) || !isStr(p.name, 80)) return null;
  if (!TYPES.includes(p.type as DetergentType)) return null;
  if (!isNum(p.packSize, 1, 100000) || !isNum(p.packWashes, 1, 1000) || !isNum(p.packPriceEur, 0.01, 1000)) return null;
  return {
    water: { postalCode: w.postalCode, hardnessF: w.hardnessF, category: w.category as HardnessCategory },
    machineKg: Math.round(x.machineKg),
    product: {
      id: p.id,
      brand: p.brand,
      name: p.name,
      type: p.type as DetergentType,
      packSize: p.packSize,
      packWashes: p.packWashes,
      packPriceEur: p.packPriceEur,
      verified: p.verified === true,
      custom: p.custom === true ? true : undefined,
    },
  };
}

export interface PushSub {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function parseSubscription(x: unknown): PushSub | null {
  if (!isObj(x) || !isObj(x.keys)) return null;
  if (!isStr(x.endpoint, 2000) || !x.endpoint.startsWith('https://')) return null;
  if (!isStr(x.keys.p256dh, 200) || !isStr(x.keys.auth, 100)) return null;
  return { endpoint: x.endpoint, p256dh: x.keys.p256dh, auth: x.keys.auth };
}
