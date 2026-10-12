# JusteDose

> **Moins de gaspillage, plus d'économies.**
> Web app mobile (PWA) qui calcule la dose de lessive adaptée à votre eau, votre lessive, votre lave-linge et votre linge — puis vous prévient à la fin du cycle.

Configuration unique (code postal → lessive → capacité du lave-linge), puis **2 informations par lavage** : poids du linge et niveau de salissure.

## Stack

| Couche | Techno |
|---|---|
| Frontend | React 19, Vite, TypeScript, Tailwind CSS v4 (PWA, clair/sombre) |
| Backend | Cloudflare Workers + [Hono](https://hono.dev) |
| Base de données | Cloudflare D1 (SQLite) |
| Auth | Compte anonyme (jeton secret sur l'appareil, seul son hash est stocké) |
| Notifications | Web Push (VAPID) envoyées par un cron du Worker |
| Déploiement | Cloudflare Pages (frontend) + Workers (API) |

```
justedose/
├─ shared/          Code commun front/back : types, calcul de dose, dureté de l'eau, catalogue, stats
│  └─ products.json   ← catalogue de lessives (ajouter une référence = ajouter un objet)
├─ web/             Application React (src/screens, src/lib, public/sw.js)
├─ worker/          API Cloudflare (src/index.ts, src/push.ts, migrations/)
├─ scripts/         vapid, validation du catalogue, test de fumée de l'API, icônes
└─ tests/           Tests de la logique d'envoi des notifications
```

## Démarrage en local

```bash
npm install

# 1. Clés VAPID (notifications) → worker/.dev.vars
npm run vapid                       # copier les 2 lignes dans worker/.dev.vars (voir .dev.vars.example)

# 2. Base locale + API
npm run db:migrate:local
npm run dev:worker                  # http://localhost:8787

# 3. Front (dans un autre terminal) — /api est proxifié vers le Worker
npm run dev:web                     # http://localhost:5173
```

Vérifications : `npm test` · `npm run typecheck` · `npm run validate:products` · `npm run smoke` (API lancée).

## Comment la dose est calculée

```
dose = doseDeRéférence × facteurCharge × facteurSalissure × facteurDureté      (bornée à 40 %–200 %)
```

- **Dose de référence** = contenance ÷ nombre de lavages annoncé sur l'emballage (capsules : 1).
- **Charge** : `0,35 + 0,65 × kg / 5` — la lessive ne croît pas strictement avec le poids.
- **Salissure** : peu sale ×0,75 · normal ×1 · très sale ×1,25.
- **Dureté** (interpolée en °f) : ≤ 5 → ×0,80 · 22 → ×1,00 · ≥ 45 → ×1,25.
- **Économie** = dose standard de l'emballage pour un *tambour plein* de votre machine − dose recommandée (jamais négative).
- Capsules : nombre entier (minimum 1). Poudre : grammes.

> ⚠️ **Ces coefficients sont des estimations prudentes, pas des données constructeur.** Ils sont regroupés dans [`shared/dosing.ts`](shared/dosing.ts) pour être affinés (idéalement avec les tableaux de dosage officiels des marques). L'app le rappelle à l'utilisateur.

### Dureté de l'eau : par commune, sources officielles

`GET /api/water?postalCode=29260` ([`worker/src/water.ts`](worker/src/water.ts)) :

1. [geo.api.gouv.fr](https://geo.api.gouv.fr) donne les communes du code postal ;
2. [Hub'Eau « qualité de l'eau potable »](https://hubeau.eaufrance.fr/page/api-qualite-eau-potable) (contrôle sanitaire des ARS) donne le titre hydrotimétrique (paramètre 1345, en °f) : **médiane des 20 dernières mesures des 2 dernières années**, valeurs hors 0–80 °f écartées ;
3. si plusieurs communes partagent le code postal, l'app propose la plus peuplée et laisse choisir ; l'utilisateur peut toujours corriger la catégorie ;
4. réponse mise en cache 30 jours dans D1 (`water_cache`) ; en cas de panne ou de commune sans mesure, repli sur l'**estimation départementale** ([`shared/water.ts`](shared/water.ts)), non mise en cache.

Le profil mémorise la commune et l'origine de la valeur (`commune`, `département` ou `manuelle`).

## Ajouter une lessive

Ajouter un objet dans [`shared/products.json`](shared/products.json) (`id` unique, marque, référence, `type`, `packSize`, `packWashes`, `sourceUrl`, `checkedAt`, `verified`), puis `npm run validate:products`.

Les 7 références actuelles reprennent **contenance et nombre de lavages** de fiches produits d'enseignes (colonnes `sourceUrl` et `checkedAt`, relevées le 12/10/2026). **Les prix ne sont volontairement pas renseignés** : ils varient selon le magasin et aucune source ouverte fiable n'a été trouvée ; l'utilisateur saisit le prix payé (un `packPriceEur` n'est accepté dans le catalogue qu'avec une source datée). L'utilisateur peut aussi saisir sa propre lessive depuis l'app.

> Les fiches montrent que les tableaux de dosage des marques varient avec la charge, la salissure et la dureté (ex. Le Chat Excellence : de 45 à 140 mL selon le cas). Le modèle de JusteDose reste une estimation générique ; l'étape suivante est de le calibrer produit par produit sur ces tableaux.

## Déploiement Cloudflare

### 1. API (Worker + D1)

```bash
cd worker
npx wrangler d1 create justedose            # reporter database_id dans wrangler.toml
npm run db:migrate:remote
npm run vapid --prefix ..                   # génère la paire de clés VAPID
#   → VAPID_PUBLIC_KEY dans wrangler.toml [vars]   (et VAPID_SUBJECT = "mailto:vous@exemple.fr")
npx wrangler secret put VAPID_PRIVATE_KEY
#   → ALLOWED_ORIGINS dans wrangler.toml : ajouter l'URL Cloudflare Pages
npx wrangler deploy
```

Le cron (`* * * * *`) est déclaré dans `wrangler.toml` : il envoie les notifications arrivées à échéance.

### 2. Frontend (Pages)

Projet Pages relié au dépôt : racine `/`, commande de build `npm ci && npm run build -w web`, dossier de sortie `web/dist`, variable `VITE_API_URL` = URL du Worker (voir `web/.env.example`).

## Connexion par email (facultative)

Réglages → **Sécuriser mon compte par email** : l'app envoie un **code à 6 chiffres** (valable 10 min, 5 essais, 3 demandes/heure/adresse) à saisir dans l'app. Sur un nouvel appareil : **J'ai déjà un compte** → même procédure, et le profil + l'historique reviennent. On utilise un code plutôt qu'un lien car, sur iPhone, un lien s'ouvre dans Safari et non dans la PWA installée (stockages séparés). Seul le hash du code est stocké ; la réponse ne révèle jamais si une adresse a un compte.

**Activation** — l'envoi passe par [Cloudflare Email Service](https://developers.cloudflare.com/email-service/) et exige **un domaine à vous** validé pour l'envoi (impossible depuis `workers.dev`) :

```bash
cd worker
npx wrangler email sending enable votre-domaine.fr
```

puis dans `worker/wrangler.toml` :

```toml
[[send_email]]
name = "EMAIL"

[vars]
EMAIL_FROM = "connexion@votre-domaine.fr"   # à ajouter aux variables existantes
```

et `npx wrangler deploy`. En local, `DEV_ECHO_CODE=1` dans `.dev.vars` renvoie le code dans la réponse au lieu d'envoyer un email.

À ajouter en production : une règle de rate limiting Cloudflare sur `POST /api/auth/email/request` (par IP).

## Notifications — ce qu'il faut savoir

- Les notifications sont **programmées côté serveur** à l'enregistrement du cycle : fin du cycle puis +15 min. Elles fonctionnent donc téléphone verrouillé / app fermée.
- Précision : le cron tourne à la minute, une notification peut arriver jusqu'à ~1 min après l'heure prévue.
- **iPhone/iPad** : le Web Push exige que l'app soit **ajoutée à l'écran d'accueil** (iOS 16.4+). L'app l'indique à l'utilisateur.
- Hors ligne au moment du « Démarrer » : le cycle est gardé en local et envoyé au retour du réseau ; les notifications dont l'heure est déjà passée (à la minute près) ne sont pas envoyées.

## Limites connues / suites logiques

- **Auth** : compte anonyme par défaut ; l'email (facultatif) permet de le retrouver sur un autre appareil — voir ci-dessous. Tant que l'envoi d'emails n'est pas configuré, l'app masque cette fonction.
- **Scan code-barres** : bouton « placeholder » (message « bientôt »).
- **Anti-abus** : la création de compte anonyme n'est pas limitée en débit ; ajouter une règle de rate limiting Cloudflare sur `POST /api/auth/anonymous`.
- **Migrations** : `0002_water_and_login.sql` (cache de dureté, commune du profil, codes de connexion, sessions) à appliquer avant de déployer (`npm run db:migrate:remote`).
- **Statistiques** : `lessive économisée` agrège des mL ; la poudre est comptée 1 g ≈ 1 mL et une capsule ≈ 25 mL (voir `mlPerUnit`).
