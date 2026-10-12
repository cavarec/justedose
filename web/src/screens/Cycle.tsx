import { useState } from 'react';
import type { Cycle as CycleRecord, DoseResult, Profile } from '@shared/types';
import { productLabel } from '@shared/catalog';
import { Button, Card, Chip, Header, Muted, Screen, Tagline } from '../components/ui';
import { IconBell, IconCheck } from '../components/icons';
import { fmtDose, fmtDuration, fmtEuro, fmtTime } from '../lib/format';
import { enablePush, type PushStatus } from '../lib/push';
import { addCycle, getState, sync, useStore } from '../lib/store';
import type { WashInput } from './Home';

const DURATIONS = [30, 60, 90, 120, 150, 180];

export const PUSH_MESSAGE: Partial<Record<PushStatus, string>> = {
  denied: 'Les notifications sont bloquées. Autorisez-les dans les réglages de votre navigateur pour être prévenu.',
  'needs-install': "Sur iPhone, ajoutez JusteDose à l'écran d'accueil (Partager → Sur l'écran d'accueil), puis activez les notifications.",
  unsupported: 'Ce navigateur ne gère pas les notifications.',
  unavailable: "Impossible d'activer les notifications pour le moment (connexion ?).",
};

export function Cycle({
  profile,
  input,
  result,
  onBack,
  onDone,
}: {
  profile: Profile;
  input: WashInput;
  result: DoseResult;
  onBack: () => void;
  onDone: () => void;
}) {
  const lastDuration = useStore((s) => s.last.durationMin);
  const [duration, setDuration] = useState(DURATIONS.includes(lastDuration) ? lastDuration : 90);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [push, setPush] = useState<PushStatus | 'pending'>('pending');
  const [scheduled, setScheduled] = useState<boolean | null>(null);

  function start() {
    const now = Date.now();
    const record: CycleRecord = {
      id: crypto.randomUUID(),
      startedAt: now,
      durationMin: duration,
      weightKg: input.weightKg,
      soil: input.soil,
      dose: result.dose,
      doseUnit: result.unit,
      costEur: result.costEur,
      savedDose: result.savedDose,
      savedEur: result.savedEur,
      savedMl: result.savedMl,
      productLabel: productLabel(profile.product),
    };

    // Le clic « Démarrer » est le geste utilisateur qui permet de demander l'autorisation de notifier :
    // la demande doit partir immédiatement, avant toute attente.
    const pushRequest = enablePush();
    addCycle(record);
    setStartedAt(now);

    void Promise.all([pushRequest, sync()]).then(([status]) => {
      setPush(status);
      // Si le serveur n'a pas encore reçu le cycle (hors ligne), la notification n'est pas encore programmée.
      setScheduled(!getState().pending.includes(record.id));
    });
  }

  async function retryPush() {
    setPush('pending');
    setPush(await enablePush());
  }

  // ------------------------------------------------------------ Lavage enregistré
  if (startedAt !== null) {
    const endsAt = startedAt + duration * 60_000;
    return (
      <Screen>
        <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
          <span className="animate-pop flex size-24 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            <IconCheck width={52} height={52} />
          </span>
          <div className="animate-rise">
            <h1 className="text-3xl font-bold">Lavage enregistré</h1>
            <p className="mt-2 text-lg text-slate-600 dark:text-slate-400">
              Fin prévue vers <strong className="tabular text-slate-900 dark:text-slate-100">{fmtTime(endsAt)}</strong>
            </p>
          </div>

          <Card className="w-full text-left">
            <p className="flex items-start gap-3">
              <IconBell className="mt-0.5 shrink-0 text-teal-700 dark:text-teal-300" />
              <span>
                {push === 'pending' && 'Activation des notifications…'}
                {push === 'enabled' &&
                  (scheduled === false
                    ? 'Notifications activées. Vous êtes hors ligne : elles seront programmées dès le retour du réseau.'
                    : 'Nous vous prévenons à la fin du cycle, puis 15 minutes plus tard pour penser à étendre le linge.')}
                {push === 'default' && 'Activez les notifications pour être prévenu à la fin du lavage.'}
                {PUSH_MESSAGE[push as PushStatus]}
              </span>
            </p>
            {(push === 'default' || push === 'unavailable') && (
              <Button variant="secondary" className="mt-4 h-14 text-base" onClick={retryPush}>
                {push === 'default' ? 'Activer les notifications' : 'Réessayer'}
              </Button>
            )}
          </Card>

          <Muted>
            {fmtDose(result.dose, result.unit)} · {fmtEuro(result.costEur)}
            {result.savedDose > 0 && ` · ${fmtDose(result.savedDose, result.unit)} économisés (≈ ${fmtEuro(result.savedEur)})`}
          </Muted>
        </div>

        <Button onClick={onDone}>Terminé</Button>
        <Tagline />
      </Screen>
    );
  }

  // ------------------------------------------------------------ Choix de la durée
  return (
    <Screen>
      <Header title="Durée du programme" subtitle="Pour vous prévenir quand le lavage est fini." onBack={onBack} />

      <div className="grid grid-cols-2 gap-3" role="group" aria-label="Durée du programme">
        {DURATIONS.map((m) => (
          <Chip key={m} selected={duration === m} onClick={() => setDuration(m)} className="min-h-20 text-2xl">
            {fmtDuration(m)}
          </Chip>
        ))}
      </div>

      <div className="mt-auto pt-6">
        <Button onClick={start}>Démarrer</Button>
      </div>
      <Tagline />
    </Screen>
  );
}
