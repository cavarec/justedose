import { useSyncExternalStore } from 'react';
import type { Cycle, Profile, Soil } from '@shared/types';
import { api, ApiError } from './api';

/**
 * Magasin unique de l'application.
 *
 * Principe « local d'abord » : toutes les actions écrivent immédiatement dans le
 * localStorage (l'app reste utilisable hors ligne), puis `sync()` rattrape le serveur
 * (profil modifié, cycles non envoyés) dès que le réseau est disponible.
 */

export type Theme = 'system' | 'light' | 'dark';

export interface State {
  /** Jeton du compte anonyme (secret, jamais affiché). */
  token: string | null;
  /** Adresse liée au compte (récupération sur un autre appareil), si elle a été confirmée. */
  email: string | null;
  profile: Profile | null;
  profileDirty: boolean;
  /** Historique, du plus récent au plus ancien. */
  cycles: Cycle[];
  /** Ids des cycles que le serveur n'a pas encore acceptés. */
  pending: string[];
  /** Dernières valeurs saisies : pré-remplies pour limiter les clics. */
  last: { weightKg: number; soil: Soil; durationMin: number };
  theme: Theme;
}

const KEY = 'justedose:v1';

const initial: State = {
  token: null,
  email: null,
  profile: null,
  profileDirty: false,
  cycles: [],
  pending: [],
  last: { weightKg: 4, soil: 'normal', durationMin: 90 },
  theme: 'system',
};

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return initial;
    const parsed = JSON.parse(raw) as Partial<State>;
    return { ...initial, ...parsed, last: { ...initial.last, ...parsed.last } };
  } catch {
    return initial;
  }
}

let state: State = load();
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* stockage plein ou désactivé : l'app continue en mémoire */
  }
  listeners.forEach((l) => l());
}

export const getState = () => state;
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

// ---------------------------------------------------------------- Actions

export function saveProfile(profile: Profile) {
  set({ profile, profileDirty: true });
  void sync();
}

export function addCycle(cycle: Cycle) {
  set({
    cycles: [cycle, ...state.cycles],
    pending: [...state.pending, cycle.id],
    last: { weightKg: cycle.weightKg, soil: cycle.soil, durationMin: cycle.durationMin },
  });
  void sync();
}

export function setTheme(theme: Theme) {
  set({ theme });
  applyTheme();
}

/** Efface le compte côté serveur (si possible) puis toutes les données locales. */
export async function deleteEverything(): Promise<void> {
  const token = state.token;
  if (token) {
    try {
      await api.deleteAccount(token);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) throw e; // 401 = déjà inexistant
    }
  }
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  state = initial;
  listeners.forEach((l) => l());
  applyTheme();
}

// ---------------------------------------------------------------- Thème

export function applyTheme() {
  const t = state.theme;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function initTheme() {
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
}

// ---------------------------------------------------------------- Synchronisation

let tokenRequest: Promise<string | null> | null = null;

/**
 * Retourne le jeton du compte anonyme, en le créant au besoin. null = hors ligne.
 * Un seul appel réseau à la fois : sans cela, la synchronisation et l'activation des
 * notifications pourraient créer deux comptes au premier lancement.
 */
export function getToken(): Promise<string | null> {
  if (state.token) return Promise.resolve(state.token);
  tokenRequest ??= api
    .createAnonymousAccount()
    .then(({ token }) => {
      set({ token });
      return token;
    })
    .catch(() => null)
    .finally(() => {
      tokenRequest = null;
    });
  return tokenRequest;
}

/** Adresse confirmée par le serveur (après vérification du code). */
export function setEmail(email: string | null) {
  set({ email });
}

/**
 * Bascule cet appareil sur un compte retrouvé par email. Sans perte : le profil du compte
 * l'emporte (s'il existe), et les lavages déjà présents ici sont fusionnés avec ceux du compte.
 */
export async function adoptAccount(token: string, email: string): Promise<void> {
  const remote = await api.me(token);
  const known = new Set(remote.cycles.map((c) => c.id));
  const localOnly = state.cycles.filter((c) => !known.has(c.id));
  set({
    token,
    email,
    cycles: [...remote.cycles, ...localOnly].sort((a, b) => b.startedAt - a.startedAt),
    pending: localOnly.map((c) => c.id),
    profile: remote.profile ?? state.profile,
    profileDirty: !remote.profile && !!state.profile,
  });
  void sync();
}

let inflight: Promise<void> | null = null;

/** Rattrape le serveur. Sans effet de bord si le réseau est absent : on réessaiera. */
export function sync(): Promise<void> {
  if (!inflight) {
    inflight = doSync(true).finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

async function doSync(retryOnUnauthorized: boolean): Promise<void> {
  const token = await getToken();
  if (!token) return;

  try {
    // 1. Profil
    const profileAtStart = state.profile;
    if (profileAtStart && state.profileDirty) {
      await api.putProfile(token, profileAtStart);
      // Ne purge le drapeau que si le profil n'a pas changé pendant l'envoi.
      if (state.profile === profileAtStart) set({ profileDirty: false });
    }

    // 2. Cycles en attente
    for (const id of [...state.pending]) {
      const cycle = state.cycles.find((c) => c.id === id);
      if (cycle) {
        try {
          await api.postCycle(token, cycle);
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 400)) throw e; // 400 = rejeté pour de bon : on abandonne
        }
      }
      set({ pending: state.pending.filter((p) => p !== id) });
    }

    // 3. Fusion avec le serveur (cycles absents en local, profil si on n'en a pas)
    const remote = await api.me(token);
    const known = new Set(state.cycles.map((c) => c.id));
    const missing = remote.cycles.filter((c) => !known.has(c.id));
    const patch: Partial<State> = {};
    if (missing.length) patch.cycles = [...state.cycles, ...missing].sort((a, b) => b.startedAt - a.startedAt);
    if (!state.profile && remote.profile) patch.profile = remote.profile;
    if (remote.email !== state.email) patch.email = remote.email;
    if (Object.keys(patch).length) set(patch);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && retryOnUnauthorized) {
      // Compte inconnu du serveur (base réinitialisée…) : nouveau compte, puis tout renvoyer.
      set({ token: null, profileDirty: !!state.profile, pending: state.cycles.map((c) => c.id) });
      return doSync(false);
    }
    // Réseau absent ou erreur serveur : on réessaiera au prochain déclencheur.
  }
}

/** Déclenche une synchronisation au démarrage, au retour du réseau et au retour au premier plan. */
export function startAutoSync() {
  void sync();
  window.addEventListener('online', () => void sync());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sync();
  });
}
