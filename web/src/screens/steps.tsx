import { useMemo, useState, type ReactNode } from 'react';
import type { DetergentType, HardnessCategory, Product, WaterInfo } from '@shared/types';
import { CATALOG, searchCatalog } from '@shared/catalog';
import { HARDNESS_OF_CATEGORY, POSTAL_CODE_RE, lookupWater } from '@shared/water';
import { Button, Card, Chip, Muted, cx } from '../components/ui';
import { IconCheck, IconScan } from '../components/icons';
import { HARDNESS_LABEL, TYPE_LABEL, fmtPack } from '../lib/format';

/* Chaque étape est autonome : elle affiche ses champs et son bouton principal.
   L'onboarding les enchaîne ; les Réglages en ouvrent une seule. */

const StepBody = ({ children }: { children: ReactNode }) => <div className="flex flex-1 flex-col gap-5">{children}</div>;
const Footer = ({ children }: { children: ReactNode }) => <div className="mt-auto pt-4">{children}</div>;

const inputClass =
  'h-14 w-full rounded-xl border-2 border-slate-300 bg-white px-4 text-lg placeholder:text-slate-400 ' +
  'focus:border-teal-700 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:placeholder:text-slate-500 dark:focus:border-teal-400';

// ================================================================ Étape 1 — Eau

const CATEGORIES: HardnessCategory[] = ['soft', 'medium', 'hard'];

export function WaterStep({ initial, cta, onSubmit }: { initial?: WaterInfo; cta: string; onSubmit: (w: WaterInfo) => void }) {
  const [postal, setPostal] = useState(initial?.postalCode ?? '');
  // Correction manuelle de la catégorie détectée (ou choix obligatoire si le code est inconnu).
  const [override, setOverride] = useState<HardnessCategory | null>(
    initial && lookupWater(initial.postalCode)?.category !== initial.category ? initial.category : null,
  );

  const complete = POSTAL_CODE_RE.test(postal);
  const found = complete ? lookupWater(postal) : null;
  const category = override ?? found?.category ?? null;
  const hardnessF = category ? (found && category === found.category ? found.hardnessF : HARDNESS_OF_CATEGORY[category]) : null;

  return (
    <StepBody>
      <div>
        <label htmlFor="postal" className="mb-2 block text-sm font-semibold">
          Code postal
        </label>
        <input
          id="postal"
          className={cx(inputClass, 'text-2xl tracking-widest tabular')}
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={5}
          placeholder="29260"
          value={postal}
          onChange={(e) => {
            setPostal(e.target.value.replace(/\D/g, '').slice(0, 5));
            setOverride(null);
          }}
        />
      </div>

      {complete && (
        <Card className="animate-rise">
          {found ? (
            <p className="text-lg">
              Eau <strong>{HARDNESS_LABEL[found.category]}</strong> dans votre secteur{' '}
              <span className="whitespace-nowrap text-slate-600 tabular dark:text-slate-400">(≈ {found.hardnessF} °f)</span>
            </p>
          ) : (
            <p className="text-lg">Code postal non reconnu. Indiquez la dureté de votre eau :</p>
          )}
          <div className="mt-4 grid grid-cols-3 gap-2" role="group" aria-label="Dureté de l'eau">
            {CATEGORIES.map((c) => (
              <Chip key={c} selected={category === c} onClick={() => setOverride(c)} className="capitalize">
                {HARDNESS_LABEL[c]}
              </Chip>
            ))}
          </div>
          <Muted className="mt-3">
            {found
              ? "Estimation d'après votre département. Corrigez-la si vous connaissez la dureté de votre eau (indiquée sur votre facture d'eau)."
              : "La dureté de l'eau est indiquée sur votre facture d'eau ; à défaut, choisissez « moyenne »."}
          </Muted>
        </Card>
      )}

      <Footer>
        <Button
          disabled={!complete || !category || hardnessF === null}
          onClick={() => category && hardnessF !== null && onSubmit({ postalCode: postal, hardnessF, category })}
        >
          {cta}
        </Button>
      </Footer>
    </StepBody>
  );
}

// ================================================================ Étape 2 — Lessive

interface Draft {
  id: string;
  brand: string;
  name: string;
  type: DetergentType;
  packSize: string;
  packWashes: string;
  packPriceEur: string;
  /** Référence catalogue d'origine (null = lessive saisie à la main). */
  origin: Product | null;
}

const toDraft = (p: Product): Draft => ({
  id: p.id,
  brand: p.brand,
  name: p.name,
  type: p.type,
  packSize: String(p.packSize),
  packWashes: String(p.packWashes),
  packPriceEur: String(p.packPriceEur).replace('.', ','),
  origin: CATALOG.find((c) => c.id === p.id) ?? null,
});

const blankDraft = (): Draft => ({
  id: `custom-${crypto.randomUUID()}`,
  brand: '',
  name: '',
  type: 'liquid',
  packSize: '',
  packWashes: '',
  packPriceEur: '',
  origin: null,
});

const num = (s: string) => Number(s.replace(',', '.').trim());

const SIZE_LABEL: Record<DetergentType, string> = {
  liquid: 'Contenance du flacon (mL)',
  powder: 'Contenance du paquet (g)',
  capsules: 'Nombre de capsules',
};

function draftToProduct(d: Draft): Product | null {
  const packSize = num(d.packSize);
  const price = num(d.packPriceEur);
  const washes = d.type === 'capsules' ? packSize : num(d.packWashes);
  if (!d.brand.trim() || !d.name.trim()) return null;
  if (![packSize, price, washes].every((n) => Number.isFinite(n) && n > 0)) return null;

  const o = d.origin;
  const unchanged = o && o.packSize === packSize && o.packWashes === washes && o.packPriceEur === price;
  return {
    id: d.id,
    brand: d.brand.trim(),
    name: d.name.trim(),
    type: d.type,
    packSize,
    packWashes: Math.round(washes),
    packPriceEur: price,
    // Valeurs démo conservées telles quelles = non vérifiées ; saisies ou corrigées par l'utilisateur = vérifiées.
    verified: unchanged ? o.verified : true,
    custom: o ? undefined : true,
  };
}

export function ProductStep({ initial, cta, onSubmit }: { initial?: Product; cta: string; onSubmit: (p: Product) => void }) {
  const [draft, setDraft] = useState<Draft | null>(initial ? toDraft(initial) : null);
  const [query, setQuery] = useState('');
  const [scanNote, setScanNote] = useState(false);
  const results = useMemo(() => searchCatalog(query), [query]);

  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const product = draft ? draftToProduct(draft) : null;

  if (!draft) {
    return (
      <StepBody>
        <div>
          <Button variant="secondary" onClick={() => setScanNote(true)}>
            <IconScan /> Scanner le code-barres
          </Button>
          {scanNote && (
            <Muted className="animate-rise mt-2">Le scan arrive bientôt. En attendant, choisissez votre lessive dans la liste.</Muted>
          )}
        </div>

        <div>
          <label htmlFor="search" className="mb-2 block text-sm font-semibold">
            Rechercher une lessive
          </label>
          <input
            id="search"
            className={inputClass}
            type="search"
            placeholder="Ex. Ariel, Persil…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <ul className="flex flex-col gap-2">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setDraft(toDraft(p))}
                className="flex min-h-16 w-full items-center justify-between gap-3 rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-left transition hover:border-slate-300 active:scale-[0.98] dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600"
              >
                <span>
                  <span className="block text-lg font-semibold">
                    {p.brand} {p.name}
                  </span>
                  <span className="block text-sm text-slate-600 dark:text-slate-400">
                    {TYPE_LABEL[p.type]} · {fmtPack(p.type, p.packSize, p.packWashes)}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {results.length === 0 && <Muted>Aucune lessive trouvée pour « {query} ».</Muted>}
        </ul>

        <Button variant="ghost" onClick={() => setDraft(blankDraft())}>
          Ma lessive n'est pas dans la liste
        </Button>
      </StepBody>
    );
  }

  const custom = draft.origin === null;
  return (
    <StepBody>
      <Card className="flex flex-col gap-4">
        {custom ? (
          <>
            <div>
              <label htmlFor="brand" className="mb-2 block text-sm font-semibold">
                Marque
              </label>
              <input id="brand" className={inputClass} placeholder="Ex. Ariel" value={draft.brand} onChange={(e) => patch({ brand: e.target.value })} />
            </div>
            <div>
              <label htmlFor="ref" className="mb-2 block text-sm font-semibold">
                Référence
              </label>
              <input id="ref" className={inputClass} placeholder="Ex. Original liquide" value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
            </div>
            <div role="group" aria-label="Type de lessive">
              <span className="mb-2 block text-sm font-semibold">Type</span>
              <div className="grid grid-cols-3 gap-2">
                {(['liquid', 'powder', 'capsules'] as const).map((t) => (
                  <Chip key={t} selected={draft.type === t} onClick={() => patch({ type: t })} className="min-h-14 text-base">
                    {TYPE_LABEL[t]}
                  </Chip>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xl font-bold">
                {draft.brand} {draft.name}
              </p>
              <Muted>{TYPE_LABEL[draft.type]}</Muted>
            </div>
            <button
              type="button"
              className="min-h-12 shrink-0 rounded-xl px-3 text-sm font-semibold text-teal-800 hover:bg-slate-100 dark:text-teal-300 dark:hover:bg-slate-800"
              onClick={() => setDraft(null)}
            >
              Changer
            </button>
          </div>
        )}

        {draft.origin && !draft.origin.verified && (
          <p className="rounded-xl bg-amber-100 px-3 py-2 text-sm text-amber-950 dark:bg-amber-950/60 dark:text-amber-100">
            Prix et dosage de démonstration : vérifiez-les avec votre emballage pour un calcul juste.
          </p>
        )}

        <div>
          <label htmlFor="size" className="mb-2 block text-sm font-semibold">
            {SIZE_LABEL[draft.type]}
          </label>
          <input id="size" className={inputClass} inputMode="decimal" value={draft.packSize} onChange={(e) => patch({ packSize: e.target.value })} />
        </div>
        {draft.type !== 'capsules' && (
          <div>
            <label htmlFor="washes" className="mb-2 block text-sm font-semibold">
              Nombre de lavages annoncé
            </label>
            <input id="washes" className={inputClass} inputMode="numeric" placeholder="Ex. 30" value={draft.packWashes} onChange={(e) => patch({ packWashes: e.target.value })} />
          </div>
        )}
        <div>
          <label htmlFor="price" className="mb-2 block text-sm font-semibold">
            Prix payé (€)
          </label>
          <input id="price" className={inputClass} inputMode="decimal" placeholder="Ex. 9,50" value={draft.packPriceEur} onChange={(e) => patch({ packPriceEur: e.target.value })} />
        </div>
        <Muted>Ces informations figurent sur l'emballage. Elles servent à calculer le coût de chaque lavage.</Muted>
      </Card>

      <Footer>
        <Button disabled={!product} onClick={() => product && onSubmit(product)}>
          {cta}
        </Button>
      </Footer>
    </StepBody>
  );
}

// ================================================================ Étape 3 — Lave-linge

const MACHINES = [
  { kg: 6, label: '6 kg' },
  { kg: 7, label: '7 kg' },
  { kg: 8, label: '8 kg' },
  { kg: 9, label: '9 kg' },
  { kg: 10, label: '10 kg et +' },
];

export function MachineStep({ initial, cta, onSubmit }: { initial?: number; cta: string; onSubmit: (kg: number) => void }) {
  const [kg, setKg] = useState<number | null>(initial ?? null);
  return (
    <StepBody>
      <div className="flex flex-col gap-2" role="group" aria-label="Capacité du lave-linge">
        {MACHINES.map((m) => (
          <Chip key={m.kg} selected={kg === m.kg} onClick={() => setKg(m.kg)} className="justify-between px-5">
            {m.label}
            {kg === m.kg && <IconCheck width={22} height={22} />}
          </Chip>
        ))}
      </div>
      <Footer>
        <Button disabled={kg === null} onClick={() => kg !== null && onSubmit(kg)}>
          {cta}
        </Button>
      </Footer>
    </StepBody>
  );
}
