import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Cycle, Profile } from '../../shared/types';
import type { Bindings, Variables } from './env';
import { alreadyLinkedEmail, codeEmail, emailConfigured, emailEnabled, sendEmail } from './email';
import { sendDueNotifications } from './push';
import { parseCycle, parseEmail, parseProfile, parseSubscription } from './validate';
import { cachedWater } from './water';

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

const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/auth/anonymous',
  '/api/auth/email/request', // authentification facultative (voir la route)
  '/api/auth/email/verify', // idem
  '/api/push/key',
  '/api/water',
]);

/** Utilisateur du jeton « Bearer », ou null. Un compte récupéré par email a un jeton par appareil (table sessions). */
async function userFromRequest(c: { req: { header(n: string): string | undefined }; env: Bindings }): Promise<string | null> {
  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (token.length < 32) return null;
  const hash = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    'SELECT id AS user_id FROM users WHERE token_hash = ?1 UNION SELECT user_id FROM sessions WHERE token_hash = ?1',
  )
    .bind(hash)
    .first<{ user_id: string }>();
  return row?.user_id ?? null;
}

app.use('/api/*', async (c, next) => {
  if (PUBLIC_PATHS.has(c.req.path) || c.req.method === 'OPTIONS') return next();
  const userId = await userFromRequest(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);
  c.set('userId', userId);
  return next();
});

app.get('/api/health', (c) => c.json({ ok: true, emailLogin: emailEnabled(c.env) }));

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
    'SELECT postal_code, hardness_f, hardness_category, commune, water_source, machine_kg, product_json FROM profiles WHERE user_id = ?1',
  )
    .bind(userId)
    .first<{
      postal_code: string;
      hardness_f: number;
      hardness_category: Profile['water']['category'];
      commune: string | null;
      water_source: NonNullable<Profile['water']['source']> | null;
      machine_kg: number;
      product_json: string;
    }>();

  const profile: Profile | null = p
    ? {
        water: {
          postalCode: p.postal_code,
          hardnessF: p.hardness_f,
          category: p.hardness_category,
          ...(p.commune ? { commune: p.commune } : {}),
          ...(p.water_source ? { source: p.water_source } : {}),
        },
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

  const user = await c.env.DB.prepare('SELECT email FROM users WHERE id = ?1').bind(userId).first<{ email: string | null }>();
  return c.json({ profile, cycles: results.map(toCycle), email: user?.email ?? null });
});

app.put('/api/profile', async (c) => {
  const profile = parseProfile(await c.req.json().catch(() => null));
  if (!profile) return c.json({ error: 'invalid_profile' }, 400);
  await c.env.DB.prepare(
    `INSERT INTO profiles (user_id, postal_code, hardness_f, hardness_category, commune, water_source, machine_kg, product_json, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
     ON CONFLICT(user_id) DO UPDATE SET
       postal_code = excluded.postal_code, hardness_f = excluded.hardness_f,
       hardness_category = excluded.hardness_category, commune = excluded.commune,
       water_source = excluded.water_source, machine_kg = excluded.machine_kg,
       product_json = excluded.product_json, updated_at = excluded.updated_at`,
  )
    .bind(
      c.get('userId'),
      profile.water.postalCode,
      profile.water.hardnessF,
      profile.water.category,
      profile.water.commune ?? null,
      profile.water.source ?? null,
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

// ---------------------------------------------------------------- Dureté de l'eau (par commune)
/** Code postal → communes + dureté mesurée (données officielles, mises en cache 30 jours). */
app.get('/api/water', async (c) => {
  const postalCode = c.req.query('postalCode') ?? '';
  if (!/^\d{5}$/.test(postalCode)) return c.json({ error: 'invalid_postal_code' }, 400);
  const result = await cachedWater(c.env.DB, postalCode);
  if (!result) return c.json({ error: 'unknown_postal_code' }, 404);
  return c.json(result);
});

// ---------------------------------------------------------------- Compte : email (code à 6 chiffres)
const CODE_TTL_MS = 10 * 60_000;
const CODE_MAX_ATTEMPTS = 5;
const CODES_PER_HOUR = 3;

function randomCode(): string {
  const n = new Uint32Array(1);
  do crypto.getRandomValues(n);
  while (n[0] >= 4_294_000_000); // tirage sans biais : 4 294 000 000 est un multiple de 10^6
  return String(n[0] % 1_000_000).padStart(6, '0');
}

const codeHash = (id: string, code: string) => sha256Hex(`${id}:${code}`);

/**
 * Demande d'un code.
 *  - purpose « secure » (connecté) : associer une adresse au compte courant, pour pouvoir le retrouver.
 *  - purpose « recover » : retrouver le compte lié à l'adresse (nouvel appareil, téléphone perdu).
 * La réponse est identique que l'adresse soit connue ou non (pas de fuite d'existence de compte).
 */
app.post('/api/auth/email/request', async (c) => {
  if (!emailEnabled(c.env)) return c.json({ error: 'email_not_configured' }, 503);
  const body = (await c.req.json().catch(() => null)) as { email?: unknown; purpose?: unknown } | null;
  const email = parseEmail(body?.email);
  const purpose = body?.purpose;
  if (!email || (purpose !== 'secure' && purpose !== 'recover')) return c.json({ error: 'invalid_request' }, 400);

  const db = c.env.DB;
  const now = Date.now();
  const recent = await db
    .prepare('SELECT COUNT(*) AS n FROM login_codes WHERE email = ?1 AND created_at > ?2')
    .bind(email, now - 3_600_000)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= CODES_PER_HOUR) return c.json({ error: 'too_many_requests' }, 429);

  const owner = await db.prepare('SELECT id FROM users WHERE email = ?1').bind(email).first<{ id: string }>();
  let userId: string | null = null;
  let mail: { subject: string; text: string; html: string } | null = null;
  let code: string | null = null;

  if (purpose === 'secure') {
    const me = await userFromRequest(c);
    if (!me) return c.json({ error: 'unauthorized' }, 401);
    if (owner && owner.id === me) return c.json({ ok: true, alreadyLinked: true }); // déjà fait
    if (owner) mail = alreadyLinkedEmail();
    else userId = me;
  } else if (owner) {
    userId = owner.id;
  }

  if (userId) {
    code = randomCode();
    const id = crypto.randomUUID();
    await db
      .prepare('INSERT INTO login_codes (id, email, purpose, user_id, code_hash, expires_at, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)')
      .bind(id, email, purpose, userId, await codeHash(id, code), now + CODE_TTL_MS, now)
      .run();
    mail = codeEmail(code, purpose);
  } else if (mail) {
    // Compte tiers : on enregistre quand même la demande pour que la limite horaire s'applique.
    await db
      .prepare('INSERT INTO login_codes (id, email, purpose, user_id, code_hash, expires_at, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)')
      .bind(crypto.randomUUID(), email, purpose, owner!.id, 'none', now, now)
      .run();
  }

  if (mail) {
    if (c.env.DEV_ECHO_CODE === '1' && !emailConfigured(c.env)) return c.json(code ? { ok: true, devCode: code } : { ok: true });
    try {
      await sendEmail(c.env, email, mail.subject, mail.text, mail.html);
    } catch (err) {
      // On ne révèle pas l'échec (cela dévoilerait qu'un compte existe) : il est visible dans les journaux.
      console.error('envoi du code impossible', err);
    }
  }
  return c.json({ ok: true });
});

/** Vérifie le code. « secure » : lie l'adresse au compte courant. « recover » : renvoie un nouveau jeton d'appareil. */
app.post('/api/auth/email/verify', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { email?: unknown; code?: unknown; purpose?: unknown } | null;
  const email = parseEmail(body?.email);
  const purpose = body?.purpose;
  const code = typeof body?.code === 'string' ? body.code.replace(/\s/g, '') : '';
  if (!email || !/^\d{6}$/.test(code) || (purpose !== 'secure' && purpose !== 'recover')) return c.json({ error: 'invalid_request' }, 400);

  const db = c.env.DB;
  const now = Date.now();
  const row = await db
    .prepare(
      `SELECT id, user_id FROM login_codes
        WHERE email = ?1 AND purpose = ?2 AND used_at IS NULL AND expires_at > ?3 AND attempts < ?4 AND code_hash != 'none'
        ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(email, purpose, now, CODE_MAX_ATTEMPTS)
    .first<{ id: string; user_id: string }>();
  if (!row) return c.json({ error: 'invalid_code' }, 400);

  // Compte l'essai AVANT de comparer : 5 essais maximum par code, même en rafale.
  const attempt = await db
    .prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?1 AND attempts < ?2 RETURNING code_hash')
    .bind(row.id, CODE_MAX_ATTEMPTS)
    .first<{ code_hash: string }>();
  if (!attempt || attempt.code_hash !== (await codeHash(row.id, code))) return c.json({ error: 'invalid_code' }, 400);

  const consumed = await db.prepare('UPDATE login_codes SET used_at = ?2 WHERE id = ?1 AND used_at IS NULL').bind(row.id, now).run();
  if (!consumed.meta.changes) return c.json({ error: 'invalid_code' }, 400);

  if (purpose === 'secure') {
    const me = await userFromRequest(c);
    if (!me || me !== row.user_id) return c.json({ error: 'unauthorized' }, 401);
    try {
      await db.prepare('UPDATE users SET email = ?2 WHERE id = ?1').bind(me, email).run();
    } catch {
      return c.json({ error: 'email_taken' }, 409);
    }
    return c.json({ ok: true, email });
  }

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await db
    .prepare('INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?1, ?2, ?3)')
    .bind(await sha256Hex(token), row.user_id, now)
    .run();
  return c.json({ ok: true, token, userId: row.user_id });
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
