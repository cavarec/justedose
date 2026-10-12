export interface Bindings {
  DB: D1Database;
  VAPID_PUBLIC_KEY: string;
  /** Secret : `wrangler secret put VAPID_PRIVATE_KEY` */
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
  ALLOWED_ORIGINS: string;
}

export interface Variables {
  userId: string;
}
