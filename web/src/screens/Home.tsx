import { useState } from 'react';
import type { Profile, Soil } from '@shared/types';
import { productLabel } from '@shared/catalog';
import { Button, Chip, Header, Screen, Tagline } from '../components/ui';
import { IconCheck } from '../components/icons';
import { HARDNESS_LABEL, SOIL_LABEL } from '../lib/format';
import { useStore } from '../lib/store';

const WEIGHTS = [2, 3, 4, 5, 6, 7, 8];
const SOILS: Soil[] = ['light', 'normal', 'heavy'];

export interface WashInput {
  weightKg: number;
  soil: Soil;
}

export function Home({ profile, notice, onCalculate }: { profile: Profile; notice: string | null; onCalculate: (i: WashInput) => void }) {
  const last = useStore((s) => s.last);
  const maxKg = Math.min(profile.machineKg, 8);
  // Pré-rempli avec le dernier lavage : le cas courant se résume à « Calculer ».
  const [weightKg, setWeightKg] = useState(Math.min(last.weightKg, maxKg));
  const [soil, setSoil] = useState<Soil>(last.soil);

  return (
    <Screen withTabs>
      <Header brand title="Combien de linge allez-vous laver ?" />

      {notice && (
        <p role="status" className="animate-rise mb-4 flex items-center gap-2 rounded-2xl bg-emerald-100 px-4 py-3 font-medium text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-100">
          <IconCheck width={20} height={20} /> {notice}
        </p>
      )}

      <div className="grid grid-cols-4 gap-2" role="group" aria-label="Poids du linge">
        {WEIGHTS.map((kg) => (
          <Chip
            key={kg}
            selected={weightKg === kg}
            disabled={kg > profile.machineKg}
            onClick={() => setWeightKg(kg)}
            className="tabular text-xl"
            aria-label={`${kg} kilos`}
          >
            {kg} kg
          </Chip>
        ))}
      </div>

      <h2 className="mt-8 mb-3 text-xl font-bold">Niveau de salissure</h2>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Niveau de salissure">
        {SOILS.map((s) => (
          <Chip key={s} selected={soil === s} onClick={() => setSoil(s)} className="text-base">
            {SOIL_LABEL[s]}
          </Chip>
        ))}
      </div>

      <div className="mt-8">
        <Button onClick={() => onCalculate({ weightKg, soil })}>Calculer</Button>
      </div>

      <p className="mt-4 text-center text-sm text-slate-600 dark:text-slate-400">
        {productLabel(profile.product)} · eau {HARDNESS_LABEL[profile.water.category]} · lave-linge {profile.machineKg} kg
      </p>

      <div className="mt-auto">
        <Tagline />
      </div>
    </Screen>
  );
}
