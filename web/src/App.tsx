import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computeDose } from '@shared/dosing';
import { TabBar, type TabRoute } from './components/ui';
import { useStore } from './lib/store';
import { Cycle } from './screens/Cycle';
import { Home, type WashInput } from './screens/Home';
import { Onboarding } from './screens/Onboarding';
import { Result } from './screens/Result';
import { Settings } from './screens/Settings';
import { Stats } from './screens/Stats';

type Route = TabRoute | 'result' | 'cycle';

interface HistoryState {
  route: Route;
  /** Nombre d'écrans empilés depuis l'accueil (pour y revenir en un geste). */
  depth: number;
}

export default function App() {
  const profile = useStore((s) => s.profile);
  const [route, setRoute] = useState<Route>('home');
  const [input, setInput] = useState<WashInput | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const depth = useRef(0);

  // Le bouton « retour » du téléphone parcourt les écrans du lavage au lieu de quitter l'app.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const s = e.state as HistoryState | null;
      setRoute(s?.route ?? 'home');
      depth.current = s?.depth ?? 0;
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const push = useCallback((r: Route) => {
    depth.current += 1;
    history.pushState({ route: r, depth: depth.current } satisfies HistoryState, '');
    setRoute(r);
  }, []);

  const goTab = useCallback((r: TabRoute) => {
    depth.current = 0;
    history.replaceState({ route: r, depth: 0 } satisfies HistoryState, '');
    setRoute(r);
  }, []);

  const backHome = useCallback(() => {
    if (depth.current > 0) history.go(-depth.current);
    else goTab('home');
  }, [goTab]);

  // Dose du lavage en cours (calculée une fois, partagée entre « Résultat » et « Cycle »).
  const result = useMemo(
    () =>
      profile && input
        ? computeDose({
            product: profile.product,
            weightKg: input.weightKg,
            soil: input.soil,
            hardnessF: profile.water.hardnessF,
            machineKg: profile.machineKg,
          })
        : null,
    [profile, input],
  );

  // Fin de la notice « Configuration terminée ».
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  if (!profile) {
    return <Onboarding onDone={() => setNotice('Configuration terminée.')} />;
  }

  // Un rechargement sur « Résultat » ou « Cycle » a perdu le lavage en cours : retour à l'accueil.
  const screen: Route = (route === 'result' || route === 'cycle') && !result ? 'home' : route;
  const isTab = screen === 'home' || screen === 'stats' || screen === 'settings';

  return (
    <>
      {screen === 'home' && (
        <Home
          profile={profile}
          notice={notice}
          onCalculate={(i) => {
            setInput(i);
            push('result');
          }}
        />
      )}
      {screen === 'result' && result && input && (
        <Result profile={profile} input={input} result={result} onBack={() => history.back()} onLaunch={() => push('cycle')} />
      )}
      {screen === 'cycle' && result && input && (
        <Cycle profile={profile} input={input} result={result} onBack={() => history.back()} onDone={backHome} />
      )}
      {screen === 'stats' && <Stats />}
      {screen === 'settings' && <Settings />}

      {isTab && <TabBar current={screen as TabRoute} onNavigate={goTab} />}
    </>
  );
}
