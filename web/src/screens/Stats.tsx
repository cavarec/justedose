import { useMemo } from 'react';
import { computeStats } from '@shared/stats';
import { Card, Header, Screen, Tagline } from '../components/ui';
import { fmtEuro, fmtMl, fmtNumber } from '../lib/format';
import { useStore } from '../lib/store';

function StatCard({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-slate-600 dark:text-slate-400">{label}</p>
      <p className={`tabular mt-1 text-2xl font-extrabold ${accent ? 'text-emerald-700 dark:text-emerald-300' : ''}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </Card>
  );
}

export function Stats() {
  const cycles = useStore((s) => s.cycles);
  const stats = useMemo(() => computeStats(cycles), [cycles]);
  const empty = stats.totalWashes === 0;

  return (
    <Screen withTabs>
      <Header brand title="Vos économies" subtitle={empty ? 'Lancez un premier lavage pour voir vos économies grandir.' : undefined} />

      <Card className="animate-pop mb-3 bg-linear-to-br from-emerald-50 to-white text-center dark:from-emerald-950/60 dark:to-slate-900">
        <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Économies réalisées</p>
        <p className="tabular mt-1 text-5xl font-extrabold text-emerald-700 dark:text-emerald-300">{fmtEuro(stats.savedEur)}</p>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Lavages" value={fmtNumber(stats.totalWashes)} />
        <StatCard label="Coût moyen" value={fmtEuro(stats.avgCostEur)} hint="par lavage" />
        <div className="col-span-2">
          <StatCard label="Lessive économisée" value={fmtMl(stats.savedMl)} accent />
        </div>
      </div>

      <div className="mt-auto pt-6">
        <Tagline />
      </div>
    </Screen>
  );
}
