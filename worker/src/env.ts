/** Liaison Cloudflare Email Service (`[[send_email]]` dans wrangler.toml). Absente tant qu'aucun domaine n'est configuré. */
export interface EmailSender {
  send(message: { to: string; from: string | { email: string; name?: string }; subject: string; text: string; html?: string }): Promise<{ messageId?: string }>;
}

export interface Bindings {
  DB: D1Database;
  VAPID_PUBLIC_KEY: string;
  /** Secret : `wrangler secret put VAPID_PRIVATE_KEY` */
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
  ALLOWED_ORIGINS: string;
  /** Envoi d'emails (code de connexion). Optionnel : sans lui, la connexion par email est désactivée. */
  EMAIL?: EmailSender;
  /** Expéditeur, sur un domaine validé dans Email Service (ex. « JusteDose <connexion@exemple.fr> » → connexion@exemple.fr). */
  EMAIL_FROM?: string;
  /** Local uniquement (.dev.vars) : « 1 » renvoie le code dans la réponse au lieu d'envoyer un email. */
  DEV_ECHO_CODE?: string;
}

export interface Variables {
  userId: string;
}
