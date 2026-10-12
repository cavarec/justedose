-- JusteDose — schéma initial (Cloudflare D1 / SQLite)

-- Compte anonyme : le jeton secret reste sur l'appareil, seul son hash est stocké.
-- La colonne `email` est prévue pour l'évolution « email magique » (non implémentée dans le MVP).
CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  email       TEXT UNIQUE,
  created_at  INTEGER NOT NULL
);

CREATE TABLE profiles (
  user_id            TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  postal_code        TEXT NOT NULL,
  hardness_f         REAL NOT NULL,
  hardness_category  TEXT NOT NULL CHECK (hardness_category IN ('soft','medium','hard')),
  machine_kg         INTEGER NOT NULL,
  product_json       TEXT NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE TABLE cycles (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at     INTEGER NOT NULL,
  duration_min   INTEGER NOT NULL,
  weight_kg      INTEGER NOT NULL,
  soil           TEXT NOT NULL CHECK (soil IN ('light','normal','heavy')),
  dose           REAL NOT NULL,
  dose_unit      TEXT NOT NULL CHECK (dose_unit IN ('mL','g','capsule')),
  cost_eur       REAL NOT NULL,
  saved_dose     REAL NOT NULL,
  saved_eur      REAL NOT NULL,
  saved_ml       REAL NOT NULL,
  product_label  TEXT NOT NULL,
  created_at     INTEGER NOT NULL
);
CREATE INDEX idx_cycles_user_started ON cycles (user_id, started_at DESC);

CREATE TABLE push_subscriptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_push_user ON push_subscriptions (user_id);

-- Notifications à envoyer (lues chaque minute par le cron du Worker).
CREATE TABLE scheduled_notifications (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cycle_id  TEXT NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  send_at   INTEGER NOT NULL,
  title     TEXT NOT NULL,
  body      TEXT NOT NULL,
  attempts  INTEGER NOT NULL DEFAULT 0,
  sent_at   INTEGER
);
CREATE INDEX idx_notif_due ON scheduled_notifications (sent_at, send_at);
