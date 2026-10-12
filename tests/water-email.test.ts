// Teste, avec une vraie base SQLite (migrations D1) et des API externes simulées :
//  - la dureté communale (worker/src/water.ts et la route /api/water, avec son cache) ;
//  - la connexion par code email (demande, vérification, récupération sur un autre appareil).
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../worker/src/index';
import { fetchWater, median, summarizeSamples } from '../worker/src/water';
import type { Bindings } from '../worker/src/env';

function fakeD1(db: DatabaseSync) {
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(args as never[])).changes) } }),
    first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
  });
  return { prepare: (sql: string) => stmt(sql) } as unknown as Bindings['DB'];
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** API officielles simulées : deux communes pour 29260, dureté 15 °f à Lesneven. */
function officialApis(opts: { hubeauDown?: boolean } = {}) {
  return vi.fn(async (url: string) => {
    const u = new URL(url);
    if (u.host === 'geo.api.gouv.fr') {
      if (u.searchParams.get('codePostal') === '29260')
        return json([
          { nom: 'Kernilis', code: '29093', population: 1407 },
          { nom: 'Lesneven', code: '29124', population: 7566 },
        ]);
      return json([]);
    }
    if (u.host === 'hubeau.eaufrance.fr') {
      if (opts.hubeauDown) return json({ error: 'down' }, 503);
      const data =
        u.searchParams.get('code_commune') === '29124'
          ? [15, 15, 16, 14.9, 15].map((v, i) => ({ resultat_numerique: v, date_prelevement: `2026-0${i + 1}-10T09:00:00Z` }))
          : [];
      return json({ count: data.length, data });
    }
    throw new Error(`appel inattendu : ${url}`);
  });
}

describe('dureté communale', () => {
  it('médiane et filtrage des mesures aberrantes', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    const s = summarizeSamples([
      { resultat_numerique: 15, date_prelevement: '2026-03-01T10:00:00Z' },
      { resultat_numerique: 16, date_prelevement: '2026-05-02T10:00:00Z' },
      { resultat_numerique: 900, date_prelevement: '2026-06-02T10:00:00Z' }, // aberrante
      { resultat_numerique: null, date_prelevement: '2026-06-03T10:00:00Z' },
    ]);
    expect(s).toEqual({ hardnessF: 16, samples: 2, lastSampleAt: '2026-05-02' }); // médiane de 15 et 16 = 15,5 → 16
  });

  it('propose la commune la plus peuplée ayant des mesures', async () => {
    const r = await fetchWater('29260', officialApis() as never, Date.parse('2026-10-12'));
    expect(r?.suggested).toMatchObject({ commune: 'Lesneven', hardnessF: 15, category: 'medium', source: 'commune' });
    expect(r?.communes.map((c) => c.name)).toEqual(['Lesneven', 'Kernilis']); // tri par population
    expect(r?.communes[1].hardnessF).toBeNull();
  });

  it("retombe sur l'estimation départementale si Hub'Eau est en panne", async () => {
    const r = await fetchWater('29260', officialApis({ hubeauDown: true }) as never);
    expect(r?.suggested.source).toBe('department');
    expect(r?.suggested.hardnessF).toBe(8);
  });

  it('refuse un code postal invalide', async () => {
    expect(await fetchWater('2926', officialApis() as never)).toBeNull();
  });
});

let env: Bindings;
const call = (path: string, init?: RequestInit & { token?: string }) =>
  app.fetch(
    new Request(`https://api.test${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.token ? { Authorization: `Bearer ${init.token}` } : {}) },
    }),
    env,
  );
const post = (path: string, body: unknown, token?: string) => call(path, { method: 'POST', body: JSON.stringify(body), token });

async function newAccount() {
  return (await (await post('/api/auth/anonymous', {})).json()) as { token: string; userId: string };
}

beforeEach(() => {
  const db = new DatabaseSync(':memory:');
  for (const f of ['0001_init.sql', '0002_water_and_login.sql']) db.exec(readFileSync(new URL(`../worker/migrations/${f}`, import.meta.url), 'utf8'));
  env = { DB: fakeD1(db), DEV_ECHO_CODE: '1', ALLOWED_ORIGINS: '' } as unknown as Bindings;
  vi.unstubAllGlobals();
});

describe('/api/water', () => {
  it('répond et met en cache (un seul aller-retour vers les API officielles)', async () => {
    const f = officialApis();
    vi.stubGlobal('fetch', f);
    const a = await (await call('/api/water?postalCode=29260')).json();
    const callsAfterFirst = f.mock.calls.length;
    const b = await (await call('/api/water?postalCode=29260')).json();
    expect(a.suggested.commune).toBe('Lesneven');
    expect(b).toEqual(a);
    expect(f.mock.calls.length).toBe(callsAfterFirst);
  });

  it("n'enregistre pas un repli départemental (panne passagère)", async () => {
    const f = officialApis({ hubeauDown: true });
    vi.stubGlobal('fetch', f);
    expect((await (await call('/api/water?postalCode=29260')).json()).suggested.source).toBe('department');
    const before = f.mock.calls.length;
    await call('/api/water?postalCode=29260');
    expect(f.mock.calls.length).toBeGreaterThan(before); // pas de cache → on réessaie
  });

  it('400 si le code postal est invalide', async () => {
    expect((await call('/api/water?postalCode=abc')).status).toBe(400);
  });
});

describe('connexion par code email', () => {
  it("sans email configuré, la fonction est indisponible (503) et l'app peut le savoir", async () => {
    env = { ...env, DEV_ECHO_CODE: undefined } as Bindings;
    expect((await (await call('/api/health')).json()).emailLogin).toBe(false);
    expect((await post('/api/auth/email/request', { email: 'a@b.fr', purpose: 'recover' })).status).toBe(503);
  });

  it("associe un email, puis retrouve le compte sur un autre appareil", async () => {
    const phone = await newAccount();
    await call('/api/profile', {
      method: 'PUT',
      token: phone.token,
      body: JSON.stringify({
        water: { postalCode: '29260', hardnessF: 15, category: 'medium', commune: 'Lesneven', source: 'commune' },
        machineKg: 8,
        product: { id: 'p', brand: 'Ariel', name: 'Original', type: 'liquid', packSize: 1530, packWashes: 34, packPriceEur: 9, verified: true },
      }),
    });

    const req = await (await post('/api/auth/email/request', { email: ' Ronan@Example.FR ', purpose: 'secure' }, phone.token)).json();
    expect(req.devCode).toMatch(/^\d{6}$/);
    const ok = await post('/api/auth/email/verify', { email: 'ronan@example.fr', code: req.devCode, purpose: 'secure' }, phone.token);
    expect((await ok.json()).email).toBe('ronan@example.fr');
    expect((await (await call('/api/me', { token: phone.token })).json()).email).toBe('ronan@example.fr');

    // Autre appareil : aucun jeton, seulement l'adresse.
    const rec = await (await post('/api/auth/email/request', { email: 'ronan@example.fr', purpose: 'recover' })).json();
    const ver = await (await post('/api/auth/email/verify', { email: 'ronan@example.fr', code: rec.devCode, purpose: 'recover' })).json();
    expect(ver.userId).toBe(phone.userId);
    expect(ver.token).not.toBe(phone.token);
    const me = await (await call('/api/me', { token: ver.token })).json();
    expect(me.profile.water.commune).toBe('Lesneven');
    // L'ancien appareil reste connecté.
    expect((await call('/api/me', { token: phone.token })).status).toBe(200);
  });

  it('un code ne sert qu\'une fois, et 5 essais ratés l\'invalident', async () => {
    const a = await newAccount();
    const { devCode } = await (await post('/api/auth/email/request', { email: 'x@y.fr', purpose: 'secure' }, a.token)).json();
    await post('/api/auth/email/verify', { email: 'x@y.fr', code: devCode, purpose: 'secure' }, a.token);

    const r1 = await (await post('/api/auth/email/request', { email: 'x@y.fr', purpose: 'recover' })).json();
    expect((await post('/api/auth/email/verify', { email: 'x@y.fr', code: r1.devCode, purpose: 'recover' })).status).toBe(200);
    expect((await post('/api/auth/email/verify', { email: 'x@y.fr', code: r1.devCode, purpose: 'recover' })).status).toBe(400);

    const r2 = await (await post('/api/auth/email/request', { email: 'x@y.fr', purpose: 'recover' })).json();
    const wrong = r2.devCode === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect((await post('/api/auth/email/verify', { email: 'x@y.fr', code: wrong, purpose: 'recover' })).status).toBe(400);
    expect((await post('/api/auth/email/verify', { email: 'x@y.fr', code: r2.devCode, purpose: 'recover' })).status).toBe(400); // bloqué
  });

  it("ne révèle pas si une adresse a un compte, et limite à 3 demandes par heure", async () => {
    const unknown = await (await post('/api/auth/email/request', { email: 'nobody@y.fr', purpose: 'recover' })).json();
    expect(unknown).toEqual({ ok: true }); // pas de code, même réponse qu'une adresse connue (hors mode dev)

    const a = await newAccount();
    for (let i = 0; i < 3; i++) expect((await post('/api/auth/email/request', { email: 'lim@y.fr', purpose: 'secure' }, a.token)).status).toBe(200);
    expect((await post('/api/auth/email/request', { email: 'lim@y.fr', purpose: 'secure' }, a.token)).status).toBe(429);
  });

  it("une adresse déjà liée à un autre compte ne reçoit pas de code d'association", async () => {
    const a = await newAccount();
    const { devCode } = await (await post('/api/auth/email/request', { email: 'dup@y.fr', purpose: 'secure' }, a.token)).json();
    await post('/api/auth/email/verify', { email: 'dup@y.fr', code: devCode, purpose: 'secure' }, a.token);

    const b = await newAccount();
    const res = await (await post('/api/auth/email/request', { email: 'dup@y.fr', purpose: 'secure' }, b.token)).json();
    expect(res.devCode).toBeUndefined();
  });

  it('exige d\'être connecté pour associer une adresse, et refuse un email invalide', async () => {
    expect((await post('/api/auth/email/request', { email: 'a@b.fr', purpose: 'secure' })).status).toBe(401);
    expect((await post('/api/auth/email/request', { email: 'pas-un-email', purpose: 'recover' })).status).toBe(400);
  });
});
