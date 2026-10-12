import type { DoseResult, HardnessCategory, Soil } from '@shared/types';

const nf = new Intl.NumberFormat('fr-FR');
const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

export const fmtEuro = (n: number) => euro.format(n);
export const fmtNumber = (n: number) => nf.format(Math.round(n));

export function fmtDose(dose: number, unit: DoseResult['unit']): string {
  if (unit === 'capsule') return `${dose} capsule${dose > 1 ? 's' : ''}`;
  return `${fmtNumber(dose)} ${unit}`;
}

export const fmtMl = (ml: number) => `${fmtNumber(ml)} mL`;

export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

export const fmtTime = (ts: number) =>
  new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export const SOIL_LABEL: Record<Soil, string> = {
  light: 'Peu sale',
  normal: 'Normal',
  heavy: 'Très sale',
};

export const HARDNESS_LABEL: Record<HardnessCategory, string> = {
  soft: 'douce',
  medium: 'moyenne',
  hard: 'dure',
};

export const TYPE_LABEL = { liquid: 'Liquide', powder: 'Poudre', capsules: 'Capsules' } as const;

/** Description courte d'un paquet : « 1,5 L · 30 lavages ». */
export function fmtPack(type: keyof typeof TYPE_LABEL, size: number, washes: number): string {
  if (type === 'capsules') return `${size} capsules`;
  const amount =
    type === 'liquid'
      ? size >= 1000
        ? `${(size / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} L`
        : `${fmtNumber(size)} mL`
      : size >= 1000
        ? `${(size / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} kg`
        : `${fmtNumber(size)} g`;
  return `${amount} · ${washes} lavages`;
}
