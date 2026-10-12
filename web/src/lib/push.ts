import { api } from './api';
import { getToken } from './store';

/**
 * État des notifications push :
 *  - enabled        : autorisées et abonnées
 *  - default        : pas encore demandées
 *  - denied         : refusées dans le navigateur
 *  - needs-install  : iPhone/iPad hors écran d'accueil (iOS n'autorise le push que pour une app installée)
 *  - unsupported    : navigateur sans Web Push
 *  - unavailable    : serveur ou réseau indisponible
 */
export type PushStatus = 'enabled' | 'default' | 'denied' | 'needs-install' | 'unsupported' | 'unavailable';

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

function supported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function baseStatus(): PushStatus | null {
  if (!supported()) return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return null;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 5000));
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

export async function getPushStatus(): Promise<PushStatus> {
  const blocked = baseStatus();
  if (blocked) return blocked;
  if (Notification.permission === 'default') return 'default';
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'enabled' : 'default';
}

function urlBase64ToUint8Array(b64: string): Uint8Array {
  const padded = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function sameKey(existing: ArrayBuffer | null, expected: Uint8Array): boolean {
  if (!existing) return false;
  const a = new Uint8Array(existing);
  return a.length === expected.length && a.every((v, i) => v === expected[i]);
}

/**
 * Demande l'autorisation puis abonne l'appareil.
 * À appeler directement depuis un geste utilisateur (clic) : aucune attente avant requestPermission.
 */
export async function enablePush(): Promise<PushStatus> {
  const blocked = baseStatus();
  if (blocked) return blocked;

  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission === 'denied') return 'denied';
  if (permission !== 'granted') return 'default';

  try {
    const reg = await registration();
    if (!reg) return 'unavailable';
    const token = await getToken();
    if (!token) return 'unavailable';

    const { publicKey } = await api.pushKey();
    const key = urlBase64ToUint8Array(publicKey);

    let sub = await reg.pushManager.getSubscription();
    // Abonnement créé avec une autre clé VAPID (rotation des clés) : inutilisable, on repart de zéro.
    if (sub && !sameKey(sub.options.applicationServerKey, key)) {
      await sub.unsubscribe();
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource });

    // Ré-enregistre à chaque fois : idempotent côté serveur, et rattache l'appareil au compte courant.
    await api.subscribePush(token, sub.toJSON());
    return 'enabled';
  } catch {
    return 'unavailable';
  }
}

export async function disablePush(): Promise<void> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const token = await getToken();
  if (token) await api.unsubscribePush(token, sub.endpoint).catch(() => {});
  await sub.unsubscribe();
}
