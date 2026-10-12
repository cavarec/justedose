import { useEffect, useState } from 'react';
import type { Product, WaterInfo } from '@shared/types';
import { Header, Screen, Tagline } from '../components/ui';
import { api } from '../lib/api';
import { getState, saveProfile } from '../lib/store';
import { Button } from '../components/ui';
import { EmailFlow } from './Account';
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
  const [recovering, setRecovering] = useState(false);
  const [emailLogin, setEmailLogin] = useState(false);

  useEffect(() => {
    api.health().then((h) => setEmailLogin(h.emailLogin), () => setEmailLogin(false));
  }, []);

  // Nouvel appareil : retrouver son compte évite de tout ressaisir.
  if (recovering) {
    return (
      <Screen>
        <Header title="Retrouver mon compte" subtitle="Saisissez l'adresse email associée à votre compte." onBack={() => setRecovering(false)} />
        <EmailFlow
          purpose="recover"
          onDone={() => {
            setRecovering(false);
            if (getState().profile) onDone();
          }}
        />
        <Tagline />
      </Screen>
    );
  }

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

      {step === 0 && emailLogin && (
        <Button variant="ghost" className="mt-2 h-14 text-base" onClick={() => setRecovering(true)}>
          J'ai déjà un compte
        </Button>
      )}
      <Tagline />
    </Screen>
  );
}
