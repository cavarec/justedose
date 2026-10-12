import { useEffect, useState, type ReactNode } from 'react';
import { productLabel } from '@shared/catalog';
import { Button, Card, Chip, Header, Muted, Screen, Tagline } from '../components/ui';
import { HARDNESS_LABEL } from '../lib/format';
import { disablePush, enablePush, getPushStatus, type PushStatus } from '../lib/push';
import { deleteEverything, saveProfile, setTheme, useStore, type Theme } from '../lib/store';
import { PUSH_MESSAGE } from './Cycle';
import { MachineStep, ProductStep, WaterStep } from './steps';

type Editing = 'water' | 'product' | 'machine' | null;

const THEMES: Array<{ value: Theme; label: string }> = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Clair' },
  { value: 'dark', label: 'Sombre' },
];

function Row({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-16 w-full items-center justify-between gap-3 rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-left transition hover:border-slate-300 active:scale-[0.98] dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600"
    >
      <span>
        <span className="block text-sm text-slate-600 dark:text-slate-400">{label}</span>
        <span className="block text-lg font-semibold">{value}</span>
      </span>
      <span className="text-sm font-semibold text-teal-800 dark:text-teal-300">Modifier</span>
    </button>
  );
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="mb-6">
    <h2 className="mb-2 text-sm font-bold tracking-wide text-slate-600 uppercase dark:text-slate-400">{title}</h2>
    {children}
  </section>
);

export function Settings() {
  const profile = useStore((s) => s.profile);
  const theme = useStore((s) => s.theme);
  const [editing, setEditing] = useState<Editing>(null);
  const [push, setPush] = useState<PushStatus | 'pending'>('pending');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState(false);

  useEffect(() => {
    void getPushStatus().then(setPush);
  }, []);

  if (!profile) return null;
  const done = () => setEditing(null);

  // ------------------------------------------------------------ Édition d'une étape
  if (editing) {
    const title = { water: 'Votre eau', product: 'Votre lessive', machine: 'Votre lave-linge' }[editing];
    return (
      <Screen withTabs>
        <Header title={title} onBack={done} />
        {editing === 'water' && (
          <WaterStep initial={profile.water} cta="Enregistrer" onSubmit={(water) => (saveProfile({ ...profile, water }), done())} />
        )}
        {editing === 'product' && (
          <ProductStep initial={profile.product} cta="Enregistrer" onSubmit={(product) => (saveProfile({ ...profile, product }), done())} />
        )}
        {editing === 'machine' && (
          <MachineStep initial={profile.machineKg} cta="Enregistrer" onSubmit={(machineKg) => (saveProfile({ ...profile, machineKg }), done())} />
        )}
      </Screen>
    );
  }

  async function toggleNotifications() {
    if (push === 'enabled') {
      await disablePush();
      setPush(await getPushStatus());
    } else {
      setPush('pending');
      setPush(await enablePush());
    }
  }

  async function wipe() {
    setDeleteError(false);
    try {
      await deleteEverything();
    } catch {
      setDeleteError(true);
    }
  }

  const canToggle = push === 'enabled' || push === 'default' || push === 'unavailable';

  return (
    <Screen withTabs>
      <Header brand title="Réglages" />

      <Section title="Ma configuration">
        <div className="flex flex-col gap-2">
          <Row label="Eau" value={`${profile.water.postalCode} · ${HARDNESS_LABEL[profile.water.category]} (≈ ${profile.water.hardnessF} °f)`} onClick={() => setEditing('water')} />
          <Row label="Lessive" value={productLabel(profile.product)} onClick={() => setEditing('product')} />
          <Row label="Lave-linge" value={profile.machineKg >= 10 ? '10 kg et +' : `${profile.machineKg} kg`} onClick={() => setEditing('machine')} />
        </div>
      </Section>

      <Section title="Notifications">
        <Card>
          <p>
            {push === 'pending' && 'Vérification…'}
            {push === 'enabled' && 'Activées : vous êtes prévenu à la fin de chaque lavage.'}
            {push === 'default' && 'Désactivées.'}
            {PUSH_MESSAGE[push as PushStatus]}
          </p>
          {canToggle && (
            <Button variant="secondary" className="mt-4 h-14 text-base" onClick={toggleNotifications}>
              {push === 'enabled' ? 'Désactiver' : 'Activer les notifications'}
            </Button>
          )}
        </Card>
      </Section>

      <Section title="Apparence">
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Thème">
          {THEMES.map((t) => (
            <Chip key={t.value} selected={theme === t.value} onClick={() => setTheme(t.value)} className="min-h-14 text-base">
              {t.label}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Mes données">
        <Card>
          <Muted>
            Vos lavages sont enregistrés sur un compte anonyme (aucun email, aucune publicité). Vous pouvez tout effacer à tout
            moment.
          </Muted>
          {!confirmDelete ? (
            <Button variant="secondary" className="mt-4 h-14 text-base" onClick={() => setConfirmDelete(true)}>
              Effacer mes données
            </Button>
          ) : (
            <div className="mt-4 flex flex-col gap-2">
              <p className="font-semibold">Tout effacer, y compris vos statistiques ?</p>
              {deleteError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">Échec de la suppression : vérifiez votre connexion et réessayez.</p>}
              <Button className="h-14 bg-red-700 text-base hover:bg-red-800 dark:bg-red-400 dark:text-slate-950 dark:hover:bg-red-300" onClick={wipe}>
                Oui, tout effacer
              </Button>
              <Button variant="ghost" className="h-14 text-base" onClick={() => setConfirmDelete(false)}>
                Annuler
              </Button>
            </div>
          )}
        </Card>
      </Section>

      <div className="mt-auto">
        <Tagline />
      </div>
    </Screen>
  );
}
