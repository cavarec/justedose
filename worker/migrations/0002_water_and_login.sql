-- Cache de la dureté communale (réponse agrégée par code postal).
CREATE TABLE water_cache (
  postal_code TEXT PRIMARY KEY,
  payload     TEXT NOT NULL,
  fetched_at  INTEGER NOT NULL
);

-- Commune et origine de la dureté, conservées avec le profil.
ALTER TABLE profiles ADD COLUMN commune TEXT;
ALTER TABLE profiles ADD COLUMN water_source TEXT;

-- Connexion par email : code à 6 chiffres saisi dans l'app (un lien s'ouvrirait dans Safari,
-- pas dans la PWA installée). Seul le hash du code est conservé.
CREATE TABLE login_codes (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  purpose     TEXT NOT NULL CHECK (purpose IN ('secure','recover')),
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_login_codes_email ON login_codes (email, created_at);

-- Appareils connectés à un compte récupéré (un compte peut avoir plusieurs jetons).
CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions (user_id);
