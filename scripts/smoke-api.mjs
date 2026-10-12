// Test de fumée de l'API : parcourt le cycle de vie complet d'un compte anonyme.
// Prérequis : `npm run dev:worker` (migrations locales appliquées) tourne sur le port 8787.
// Usage : npm run smoke
import { webcrypto } from 'node:crypto';

const BASE = process.env.API_URL ?? 'http://localhost:8787';
const ORIGIN = 'http://localhost:5173';
let failures = 0;

function check(name, cond, extra = '') {
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : ` ${extra}`}`);
  if (!cond) failures++;
}

async function call(method, path, { token, body, origin } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, headers: res.headers };
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

// --- sécurité de base
check('santé', (await call('GET', '/api/health')).json?.ok === true);
check('401 sans jeton', (await call('GET', '/api/me')).status === 401);
check('401 jeton invalide', (await call('GET', '/api/me', { token: 'x'.repeat(43) })).status === 401);

const cors = await call('GET', '/api/health', { origin: ORIGIN });
check('CORS : origine autorisée', cors.headers.get('access-control-allow-origin') === ORIGIN);
const evil = await call('GET', '/api/health', { origin: 'https://evil.example' });
check('CORS : origine inconnue refusée', !evil.headers.get('access-control-allow-origin'));

// --- compte anonyme
const auth = await call('POST', '/api/auth/anonymous');
const token = auth.json?.token;
check('compte anonyme créé', auth.status === 201 && typeof token === 'string' && token.length >= 32);

const empty = await call('GET', '/api/me', { token });
check('profil vide au départ', empty.json?.profile === null && empty.json?.cycles.length === 0);

// --- profil
const profile = {
  water: { postalCode: '29260', hardnessF: 8, category: 'soft' },
  machineKg: 8,
  product: { id: 'ariel-liquide', brand: 'Ariel', name: 'Liquide', type: 'liquid', packSize: 1500, packWashes: 30, packPriceEur: 9.5, verified: false },
};
check('profil invalide refusé', (await call('PUT', '/api/profile', { token, body: { ...profile, machineKg: -2 } })).status === 400);
check('profil enregistré', (await call('PUT', '/api/profile', { token, body: profile })).status === 200);
const me = await call('GET', '/api/me', { token });
check('profil relu à l\'identique', me.json?.profile?.water.postalCode === '29260' && me.json.profile.product.id === 'ariel-liquide' && me.json.profile.machineKg === 8);

// --- cycle + notifications programmées
const now = Date.now();
const cycle = (over = {}) => ({
  id: crypto.randomUUID(), startedAt: now, durationMin: 60, weightKg: 4, soil: 'normal', dose: 38, doseUnit: 'mL',
  costEur: 0.24, savedDose: 17, savedEur: 0.11, savedMl: 17, productLabel: 'Ariel Liquide', ...over,
});
const c1 = cycle();
const r1 = await call('POST', '/api/cycles', { token, body: c1 });
check('cycle enregistré, 2 notifications programmées', r1.status === 201 && r1.json?.notifications?.length === 2, JSON.stringify(r1.json));
check('notification n°2 = fin + 15 min', r1.json?.notifications?.[1] - r1.json?.notifications?.[0] === 15 * 60_000);
const r1b = await call('POST', '/api/cycles', { token, body: c1 });
check('renvoi du même cycle : idempotent', r1b.status === 200 && r1b.json?.duplicate === true);
check('cycle invalide refusé', (await call('POST', '/api/cycles', { token, body: cycle({ soil: 'boue' }) })).status === 400);
check('cycle négatif refusé', (await call('POST', '/api/cycles', { token, body: cycle({ dose: -5 }) })).status === 400);
const list = await call('GET', '/api/me', { token });
check('historique : 1 cycle', list.json?.cycles.length === 1 && list.json.cycles[0].dose === 38);

// --- Web Push : clé publique + abonnement + envoi (cron)
const key = await call('GET', '/api/push/key');
check('clé VAPID publique exposée', typeof key.json?.publicKey === 'string' && key.json.publicKey.length > 60, JSON.stringify(key.json));

const kp = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const p256dh = b64url(await webcrypto.subtle.exportKey('raw', kp.publicKey));
const auth16 = b64url(webcrypto.getRandomValues(new Uint8Array(16)));
const sub = { endpoint: 'https://push.example.invalid/send/abc', expirationTime: null, keys: { p256dh, auth: auth16 } };
check('abonnement invalide refusé', (await call('POST', '/api/push/subscribe', { token, body: { endpoint: 'http://x', keys: {} } })).status === 400);
check('abonnement enregistré', (await call('POST', '/api/push/subscribe', { token, body: sub })).status === 201);

// Cycle déjà terminé depuis 30 s → notification immédiatement exigible pour le cron.
const due = cycle({ startedAt: now - 5.5 * 60_000, durationMin: 5 });
const rd = await call('POST', '/api/cycles', { token, body: due });
check('cycle presque fini : notification exigible', rd.status === 201 && rd.json?.notifications?.[0] <= Date.now());
// Le cron est déclenché à titre informatif : en local, le faux serveur push (.invalid) fait échouer
// la résolution DNS dans workerd, qui remonte une erreur interne (statut 500) propre au runtime local.
// La logique d'envoi (succès, 410, réessais…) est vérifiée par tests/push.test.ts.
const cron = await fetch(BASE + '/cdn-cgi/handler/scheduled');
console.log(`ℹ cron déclenché manuellement (statut ${cron.status}, voir tests/push.test.ts pour la logique d'envoi)`);

// --- effacement du compte
check('suppression du compte', (await call('DELETE', '/api/me', { token })).status === 200);
check('jeton invalide après suppression', (await call('GET', '/api/me', { token })).status === 401);

console.log(failures ? `\n${failures} échec(s)` : '\nTout est OK');
process.exit(failures ? 1 : 0);
