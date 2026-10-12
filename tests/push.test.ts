// Teste la logique d'envoi des notifications (worker/src/push.ts) avec :
//  - une vraie base SQLite construite à partir de la migration D1 (node:sqlite),
//  - un fetch simulé qui joue le rôle du service push (201, 410, 503…).
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendDueNotifications } from '../worker/src/push';
import type { Bindings } from '../worker/src/env';

const b64url = (buf: ArrayBuffer | Uint8Array) => Buffer.from(buf as ArrayBuffer).toString('base64url');

/** Adaptateur minimal D1 → node:sqlite (juste ce que push.ts utilise). */
function fakeD1(db: DatabaseSync) {
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(args as never[])).changes) } }),
    first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
  });
  return { prepare: (sql: string) => stmt(sql) } as unknown as Bindings['DB'];
}

async function vapid() {
  const kp = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return {
    pub: b64url(new Uint8Array(await webcrypto.subtle.exportKey('raw', kp.publicKey))),
    priv: (await webcrypto.subtle.exportKey('jwk', kp.privateKey)).d!,
  };
}

async function clientKeys() {
  const kp = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return {
    p256dh: b64url(new Uint8Array(await webcrypto.subtle.exportKey('raw', kp.publicKey))),
    auth: b64url(webcrypto.getRandomValues(new Uint8Array(16))),
  };
}

const NOW = 1_800_000_000_000;
let db: DatabaseSync;
let env: Bindings;
let fetchMock: ReturnType<typeof vi.fn>;

async function addSubscription(endpoint: string) {
  const k = await clientKeys();
  db.prepare('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)').run(
    'u1', endpoint, k.p256dh, k.auth, NOW,
  );
}

function addNotification(sendAt: number) {
  return Number(
    db
      .prepare('INSERT INTO scheduled_notifications (user_id, cycle_id, send_at, title, body) VALUES (?, ?, ?, ?, ?)')
      .run('u1', 'c1', sendAt, 'Lavage terminé', 'Votre cycle est probablement terminé.').lastInsertRowid,
  );
}

const row = (id: number) =>
  db.prepare('SELECT attempts, sent_at FROM scheduled_notifications WHERE id = ?').get(id) as { attempts: number; sent_at: number | null };

beforeEach(async () => {
  db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../worker/migrations/0001_init.sql', import.meta.url), 'utf8'));
  db.prepare('INSERT INTO users (id, token_hash, created_at) VALUES (?, ?, ?)').run('u1', 'h', NOW);
  db.prepare(
    `INSERT INTO cycles (id, user_id, started_at, duration_min, weight_kg, soil, dose, dose_unit, cost_eur,
       saved_dose, saved_eur, saved_ml, product_label, created_at) VALUES ('c1','u1',?,60,4,'normal',38,'mL',0.2,10,0.06,10,'Ariel Liquide',?)`,
  ).run(NOW, NOW);

  const v = await vapid();
  env = { DB: fakeD1(db), VAPID_PUBLIC_KEY: v.pub, VAPID_PRIVATE_KEY: v.priv, VAPID_SUBJECT: 'mailto:test@example.com', ALLOWED_ORIGINS: '' };
  fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('sendDueNotifications', () => {
  it('envoie une notification chiffrée et la marque envoyée', async () => {
    await addSubscription('https://push.test/a');
    const id = addNotification(NOW - 1000);
    await sendDueNotifications(env, NOW);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: Uint8Array }];
    expect(url).toBe('https://push.test/a');
    expect(init.headers.authorization).toMatch(/^vapid /i);
    expect(init.headers['content-encoding']).toBe('aes128gcm');
    expect(init.body.byteLength).toBeGreaterThan(50);
    expect(row(id).sent_at).toBe(NOW);
  });

  it("n'envoie rien avant l'échéance", async () => {
    await addSubscription('https://push.test/a');
    const id = addNotification(NOW + 60_000);
    await sendDueNotifications(env, NOW);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(row(id).sent_at).toBeNull();
  });

  it('supprime un abonnement expiré (410) et clôt la notification', async () => {
    await addSubscription('https://push.test/gone');
    fetchMock.mockResolvedValue(new Response(null, { status: 410 }));
    const id = addNotification(NOW - 1000);
    await sendDueNotifications(env, NOW);
    expect(db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get()).toEqual({ n: 0 });
    expect(row(id).sent_at).toBe(NOW);
  });

  it('réessaie sur erreur serveur, puis abandonne après 3 tentatives', async () => {
    await addSubscription('https://push.test/flaky');
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    const id = addNotification(NOW - 1000);

    await sendDueNotifications(env, NOW);
    expect(row(id)).toEqual({ attempts: 1, sent_at: null });
    await sendDueNotifications(env, NOW);
    await sendDueNotifications(env, NOW);
    expect(row(id)).toEqual({ attempts: 3, sent_at: null });

    fetchMock.mockClear();
    await sendDueNotifications(env, NOW);
    expect(fetchMock).not.toHaveBeenCalled(); // plus de tentative
  });

  it('réessaie aussi quand le réseau échoue', async () => {
    await addSubscription('https://push.test/offline');
    fetchMock.mockRejectedValue(new TypeError('network'));
    const id = addNotification(NOW - 1000);
    await sendDueNotifications(env, NOW);
    expect(row(id)).toEqual({ attempts: 1, sent_at: null });
  });

  it('clôt sans envoyer quand aucun appareil n\'est abonné', async () => {
    const id = addNotification(NOW - 1000);
    await sendDueNotifications(env, NOW);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(row(id).sent_at).toBe(NOW);
  });

  it('abandonne une notification en retard de plus de 2 h', async () => {
    await addSubscription('https://push.test/a');
    const id = addNotification(NOW - 3 * 3600_000);
    await sendDueNotifications(env, NOW);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(row(id).sent_at).toBe(NOW);
  });

  it('notifie tous les appareils du compte', async () => {
    await addSubscription('https://push.test/phone');
    await addSubscription('https://push.test/tablet');
    addNotification(NOW - 1000);
    await sendDueNotifications(env, NOW);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ne fait rien si VAPID n'est pas configuré", async () => {
    await addSubscription('https://push.test/a');
    const id = addNotification(NOW - 1000);
    await sendDueNotifications({ ...env, VAPID_PRIVATE_KEY: '' }, NOW);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(row(id).sent_at).toBeNull();
  });
});
