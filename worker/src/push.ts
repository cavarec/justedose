import { buildPushPayload } from '@block65/webcrypto-web-push';
import type { Bindings } from './env';

interface DueRow {
  id: number;
  user_id: string;
  cycle_id: string;
  send_at: number;
  title: string;
  body: string;
  attempts: number;
}

interface SubRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

const MAX_ATTEMPTS = 3;
/** Au-delà de ce retard, une notification n'a plus de sens : on l'abandonne. */
const MAX_LATENESS_MS = 2 * 60 * 60 * 1000;

/** Envoie les notifications arrivées à échéance. Appelé par le cron (toutes les minutes). */
export async function sendDueNotifications(env: Bindings, now = Date.now()): Promise<void> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    console.warn('VAPID non configuré : aucune notification envoyée.');
    return;
  }

  const { results: due } = await env.DB.prepare(
    `SELECT id, user_id, cycle_id, send_at, title, body, attempts
       FROM scheduled_notifications
      WHERE sent_at IS NULL AND send_at <= ?1 AND attempts < ?2
      ORDER BY send_at LIMIT 100`,
  )
    .bind(now, MAX_ATTEMPTS)
    .all<DueRow>();

  for (const n of due) {
    if (now - n.send_at > MAX_LATENESS_MS) {
      await markSent(env, n.id, now);
      continue;
    }

    const { results: subs } = await env.DB.prepare(
      'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?1',
    )
      .bind(n.user_id)
      .all<SubRow>();

    if (subs.length === 0) {
      await markSent(env, n.id, now); // personne à notifier
      continue;
    }

    let delivered = 0;
    let transientFailure = false;
    for (const sub of subs) {
      const outcome = await deliver(env, sub, n);
      if (outcome === 'ok') delivered++;
      else if (outcome === 'gone') {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?1').bind(sub.id).run();
      } else transientFailure = true;
    }

    if (delivered > 0 || !transientFailure) await markSent(env, n.id, now);
    else await env.DB.prepare('UPDATE scheduled_notifications SET attempts = attempts + 1 WHERE id = ?1').bind(n.id).run();
  }

  // Ménage : on ne garde pas l'historique des notifications envoyées.
  await env.DB.prepare('DELETE FROM scheduled_notifications WHERE sent_at IS NOT NULL AND sent_at < ?1')
    .bind(now - 7 * 24 * 60 * 60 * 1000)
    .run();
}

async function markSent(env: Bindings, id: number, now: number) {
  await env.DB.prepare('UPDATE scheduled_notifications SET sent_at = ?1 WHERE id = ?2').bind(now, id).run();
}

async function deliver(env: Bindings, sub: SubRow, n: DueRow): Promise<'ok' | 'gone' | 'retry'> {
  try {
    const payload = await buildPushPayload(
      {
        data: { title: n.title, body: n.body, tag: n.cycle_id, url: '/' },
        options: { ttl: 3600, urgency: 'high' },
      },
      { endpoint: sub.endpoint, expirationTime: null, keys: { auth: sub.auth, p256dh: sub.p256dh } },
      { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY },
    );
    const res = await fetch(sub.endpoint, payload);
    if (res.ok) return 'ok';
    if (res.status === 404 || res.status === 410) return 'gone'; // abonnement expiré
    console.warn(`push refusé (${res.status}) pour l'abonnement ${sub.id}`);
    return res.status >= 500 || res.status === 429 ? 'retry' : 'gone';
  } catch (err) {
    console.warn('push en erreur', err);
    return 'retry';
  }
}
