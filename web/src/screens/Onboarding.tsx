import { useState } from 'react';
import type { Product, WaterInfo } from '@shared/types';
import { Header, Screen, Tagline } from '../components/ui';
import { saveProfile } from '../lib/store';
import { MachineStep, ProductStep, WaterStep } from './steps';

const STEPS = [
  { title: 'Quel est votre code postal ?', subtitle: "La dureté de l'eau change la dose de lessive nécessaire." },
  { title: 'Quelle lessive utilisez-vous ?', subtitle: 'Sa dose et son prix servent à calculer vos économies.' },
  { title: 'Quelle capacité a votre lave-linge ?', subtitle: 'Dernier choix : ensuite, deux infos par lavage suffisent.' },
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [water, setWater] = useState<WaterInfo>();
  const [product, setProduct] = useState<Product>();

  return (
    <Screen>
      <Header
        brand={step === 0}
        title={STEPS[step].title}
        subtitle={STEPS[step].subtitle}
        onBack={step > 0 ? () => setStep(step - 1) : undefined}
      />

      <div className="mb-5 flex gap-2" role="img" aria-label={`Étape ${step + 1} sur ${STEPS.length}`}>
        {STEPS.map((_, i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-teal-700 dark:bg-teal-400' : 'bg-slate-200 dark:bg-slate-800'}`} />
        ))}
      </div>

      {step === 0 && (
        <WaterStep
          initial={water}
          cta="Continuer"
          onSubmit={(w) => {
            setWater(w);
            setStep(1);
          }}
        />
      )}
      {step === 1 && (
        <ProductStep
          initial={product}
          cta="Continuer"
          onSubmit={(p) => {
            setProduct(p);
            setStep(2);
          }}
        />
      )}
      {step === 2 && water && product && (
        <MachineStep
          cta="Terminer la configuration"
          onSubmit={(machineKg) => {
            saveProfile({ water, product, machineKg });
            onDone();
          }}
        />
      )}

      <Tagline />
    </Screen>
  );
}
