import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Cycle, Profile } from '../../shared/types';
import type { Bindings, Variables } from './env';
import { sendDueNotifications } from './push';
import { parseCycle, parseProfile, parseSubscription } from './validate';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ---------------------------------------------------------------- CORS
app.use(
  '/api/*',
  cors({
    origin: (origin, c) => {
      const allowed = String(c.env.ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((s: string) => s.trim());
      return allowed.includes(origin) ? origin : null;
    },
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  }),
);

// ---------------------------------------------------------------- Auth (compte anonyme)
async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const PUBLIC_PATHS = new Set(['/api/health', '/api/auth/anonymous', '/api/push/key']);

app.use('/api/*', async (c, next) => {
  if (PUBLIC_PATHS.has(c.req.path) || c.req.method === 'OPTIONS') return next();
  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (token.length < 32) return c.json({ error: 'unauthorized' }, 401);
  const row = await c.env.DB.prepare('SELECT id FROM users WHERE token_hash = ?1')
    .bind(await sha256Hex(token))
    .first<{ id: string }>();
  if (!row) return c.json({ error: 'unauthorized' }, 401);
  c.set('userId', row.id);
  return next();
});

app.get('/api/health', (c) => c.json({ ok: true }));

/** Crée un compte anonyme. Le jeton n'est renvoyé qu'une fois ; seul son hash est conservé. */
app.post('/api/auth/anonymous', async (c) => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const userId = crypto.randomUUID();
  await c.env.DB.prepare('INSERT INTO users (id, token_hash, created_at) VALUES (?1, ?2, ?3)')
    .bind(userId, await sha256Hex(token), Date.now())
    .run();
  return c.json({ token, userId }, 201);
});

// ---------------------------------------------------------------- Données utilisateur
interface CycleRow {
  id: string;
  started_at: number;
  duration_min: number;
  weight_kg: number;
  soil: Cycle['soil'];
  dose: number;
  dose_unit: Cycle['doseUnit'];
  cost_eur: number;
  saved_dose: number;
  saved_eur: number;
  saved_ml: number;
  product_label: string;
}

const toCycle = (r: CycleRow): Cycle => ({
  id: r.id,
  startedAt: r.started_at,
  durationMin: r.duration_min,
  weightKg: r.weight_kg,
  soil: r.soil,
  dose: r.dose,
  doseUnit: r.dose_unit,
  costEur: r.cost_eur,
  savedDose: r.saved_dose,
  savedEur: r.saved_eur,
  savedMl: r.saved_ml,
  productLabel: r.product_label,
});

/** Profil + historique : un seul appel pour resynchroniser un appareil. */
app.get('/api/me', async (c) => {
  const userId = c.get('userId');
  const p = await c.env.DB.prepare(
    'SELECT postal_code, hardness_f, hardness_category, machine_kg, product_json FROM profiles WHERE user_id = ?1',
  )
    .bind(userId)
    .first<{ postal_code: string; hardness_f: number; hardness_category: Profile['water']['category']; machine_kg: number; product_json: string }>();

  const profile: Profile | null = p
    ? {
        water: { postalCode: p.postal_code, hardnessF: p.hardness_f, category: p.hardness_category },
        machineKg: p.machine_kg,
        product: JSON.parse(p.product_json),
      }
    : null;

  const { results } = await c.env.DB.prepare(
    `SELECT id, started_at, duration_min, weight_kg, soil, dose, dose_unit, cost_eur,
            saved_dose, saved_eur, saved_ml, product_label
       FROM cycles WHERE user_id = ?1 ORDER BY started_at DESC LIMIT 1000`,
  )
    .bind(userId)
    .all<CycleRow>();

  return c.json({ profile, cycles: results.map(toCycle) });
});

app.put('/api/profile', async (c) => {
  const profile = parseProfile(await c.req.json().catch(() => null));
  if (!profile) return c.json({ error: 'invalid_profile' }, 400);
  await c.env.DB.prepare(
    `INSERT INTO profiles (user_id, postal_code, hardness_f, hardness_category, machine_kg, product_json, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(user_id) DO UPDATE SET
       postal_code = excluded.postal_code, hardness_f = excluded.hardness_f,
       hardness_category = excluded.hardness_category, machine_kg = excluded.machine_kg,
       product_json = excluded.product_json, updated_at = excluded.updated_at`,
  )
    .bind(
      c.get('userId'),
      profile.water.postalCode,
      profile.water.hardnessF,
      profile.water.category,
      profile.machineKg,
      JSON.stringify(profile.product),
      Date.now(),
    )
    .run();
  return c.json({ ok: true });
});

/**
 * Enregistre un cycle (idempotent sur l'id) et programme les 2 notifications :
 * fin de cycle, puis rappel « étendre le linge » 15 minutes plus tard.
 */
app.post('/api/cycles', async (c) => {
  const cycle = parseCycle(await c.req.json().catch(() => null));
  if (!cycle) return c.json({ error: 'invalid_cycle' }, 400);

  const userId = c.get('userId');
  const now = Date.now();

  const insert = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO cycles
       (id, user_id, started_at, duration_min, weight_kg, soil, dose, dose_unit, cost_eur,
        saved_dose, saved_eur, saved_ml, product_label, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
  )
    .bind(
      cycle.id, userId, cycle.startedAt, cycle.durationMin, cycle.weightKg, cycle.soil, cycle.dose,
      cycle.doseUnit, cycle.costEur, cycle.savedDose, cycle.savedEur, cycle.savedMl, cycle.productLabel, now,
    )
    .run();

  // Déjà connu (renvoi après une coupure réseau) : rien à reprogrammer.
  if (!insert.meta.changes) return c.json({ ok: true, duplicate: true });

  // Horloge du téléphone peu fiable ? On borne le départ à [now − 1 h ; now + 5 min].
  const start = Math.min(Math.max(cycle.startedAt, now - 3_600_000), now + 300_000);
  const endAt = start + cycle.durationMin * 60_000;
  const planned = [
    { at: endAt, title: 'Lavage terminé', body: 'Votre cycle est probablement terminé.' },
    { at: endAt + 15 * 60_000, title: 'Linge à étendre', body: 'Pensez à étendre votre linge.' },
  ].filter((n) => n.at >= now - 60_000); // inutile de notifier un cycle fini depuis longtemps

  if (planned.length) {
    await c.env.DB.batch(
      planned.map((n) =>
        c.env.DB.prepare(
          'INSERT INTO scheduled_notifications (user_id, cycle_id, send_at, title, body) VALUES (?1, ?2, ?3, ?4, ?5)',
        ).bind(userId, cycle.id, n.at, n.title, n.body),
      ),
    );
  }
  return c.json({ ok: true, notifications: planned.map((n) => n.at) }, 201);
});

// ---------------------------------------------------------------- Web Push
app.get('/api/push/key', (c) => {
  if (!c.env.VAPID_PUBLIC_KEY) return c.json({ error: 'push_not_configured' }, 503);
  return c.json({ publicKey: c.env.VAPID_PUBLIC_KEY });
});

app.post('/api/push/subscribe', async (c) => {
  const sub = parseSubscription(await c.req.json().catch(() => null));
  if (!sub) return c.json({ error: 'invalid_subscription' }, 400);
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
  )
    .bind(c.get('userId'), sub.endpoint, sub.p256dh, sub.auth, Date.now())
    .run();
  return c.json({ ok: true }, 201);
});

app.delete('/api/push/subscribe', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { endpoint?: unknown } | null;
  if (typeof body?.endpoint !== 'string') return c.json({ error: 'invalid_request' }, 400);
  await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ?1 AND endpoint = ?2')
    .bind(c.get('userId'), body.endpoint)
    .run();
  return c.json({ ok: true });
});

/** Droit à l'effacement : supprime le compte et, en cascade, toutes ses données. */
app.delete('/api/me', async (c) => {
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?1').bind(c.get('userId')).run();
  return c.json({ ok: true });
});

app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'server_error' }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(sendDueNotifications(env));
  },
} satisfies ExportedHandler<Bindings>;
