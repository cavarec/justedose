import type { DoseResult, Profile } from '@shared/types';
import { productLabel } from '@shared/catalog';
import { computeStats } from '@shared/stats';
import { Button, Card, Header, Muted, Screen, Tagline } from '../components/ui';
import { IconCheck } from '../components/icons';
import { HARDNESS_LABEL, SOIL_LABEL, fmtDose, fmtEuro, fmtNumber } from '../lib/format';
import { useStore } from '../lib/store';
import type { WashInput } from './Home';

function CheckRow({ title, detail }: { title: string; detail: string }) {
  return (
    <li className="flex items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
        <IconCheck width={18} height={18} />
      </span>
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-slate-600 dark:text-slate-400">{detail}</span>
      </span>
    </li>
  );
}

export function Result({
  profile,
  input,
  result,
  onBack,
  onLaunch,
}: {
  profile: Profile;
  input: WashInput;
  result: DoseResult;
  onBack: () => void;
  onLaunch: () => void;
}) {
  const cycles = useStore((s) => s.cycles);
  const past = computeStats(cycles);
  // Cumul « avec ce lavage » : montre d'emblée ce que ce lavage ajoute aux économies.
  const cumulativeEur = past.savedEur + result.savedEur;
  const { product, water, machineKg } = profile;

  const amount = result.unit === 'capsule' ? String(result.dose) : fmtNumber(result.dose);
  const unit = result.unit === 'capsule' ? (result.dose > 1 ? 'capsules' : 'capsule') : result.unit;
  const saved = result.savedDose > 0;

  return (
    <Screen>
      <Header title="Votre lavage" onBack={onBack} />

      <section
        aria-label="Dose recommandée"
        className="animate-pop rounded-3xl bg-linear-to-br from-teal-700 to-teal-600 p-6 text-center text-white shadow-md dark:from-teal-900 dark:to-teal-800"
      >
        <p className="text-base font-medium text-teal-50">Dose recommandée</p>
        <p className="tabular mt-1" aria-label={fmtDose(result.dose, result.unit)}>
          <span className="text-7xl font-extrabold tracking-tight">{amount}</span>
          <span className="ml-2 text-3xl font-bold">{unit}</span>
        </p>
      </section>

      <ul className="animate-rise my-5 flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <CheckRow title="Adaptée à votre eau" detail={`Eau ${HARDNESS_LABEL[water.category]} · ${water.hardnessF} °f`} />
        <CheckRow title="Adaptée à votre lessive" detail={productLabel(product)} />
        <CheckRow
          title="Adaptée à votre charge"
          detail={`${input.weightKg} kg · ${SOIL_LABEL[input.soil].toLowerCase()} · lave-linge ${machineKg} kg`}
        />
      </ul>

      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">Coût estimé</p>
          <p className="tabular mt-1 text-2xl font-bold">{fmtEuro(result.costEur)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">Économisé</p>
          {saved ? (
            <>
              <p className="tabular mt-1 text-2xl font-bold text-emerald-700 dark:text-emerald-300">{fmtDose(result.savedDose, result.unit)}</p>
              <p className="tabular text-sm text-slate-600 dark:text-slate-400">≈ {fmtEuro(result.savedEur)}</p>
            </>
          ) : (
            <p className="mt-1 text-base font-semibold text-slate-700 dark:text-slate-300">Dose pleine, bien adaptée</p>
          )}
        </Card>
      </div>

      <Card className="mt-3 flex items-center justify-between gap-3 p-4">
        <div>
          <p className="text-sm text-slate-600 dark:text-slate-400">Économies cumulées</p>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {past.totalWashes > 0 ? `avec ce lavage · ${past.totalWashes + 1} au total` : 'avec ce premier lavage'}
          </p>
        </div>
        <p className="tabular text-3xl font-extrabold text-emerald-700 dark:text-emerald-300">{fmtEuro(cumulativeEur)}</p>
      </Card>

      <Muted className="mt-4">
        Économie calculée par rapport à la dose standard de l'emballage pour un tambour plein. Estimation indicative : en cas de
        doute, suivez les indications de votre lessive.
        {!product.verified && ' Contenance et nombre de lavages de cette lessive ne sont pas confirmés (modifiables dans Réglages).'}
      </Muted>

      <div className="mt-auto pt-6">
        <Button onClick={onLaunch}>Lavage lancé</Button>
      </div>
      <Tagline />
    </Screen>
  );
}
