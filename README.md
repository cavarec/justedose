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

La dureté de l'eau est estimée **par département** ([`shared/water.ts`](shared/water.ts)) ; l'utilisateur peut corriger la catégorie. Pour une précision communale, brancher une source officielle (données ARS) dans `lookupWater`.

## Ajouter une lessive

Ajouter un objet dans [`shared/products.json`](shared/products.json) (`id` unique, marque, référence, `type`, `packSize`, `packWashes`, `packPriceEur`), puis `npm run validate:products`. Les 7 références actuelles sont des **valeurs de démonstration** (`verified: false`) : prix et dosages à remplacer par les vraies données. L'utilisateur peut aussi saisir sa propre lessive depuis l'app.

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

## Notifications — ce qu'il faut savoir

- Les notifications sont **programmées côté serveur** à l'enregistrement du cycle : fin du cycle puis +15 min. Elles fonctionnent donc téléphone verrouillé / app fermée.
- Précision : le cron tourne à la minute, une notification peut arriver jusqu'à ~1 min après l'heure prévue.
- **iPhone/iPad** : le Web Push exige que l'app soit **ajoutée à l'écran d'accueil** (iOS 16.4+). L'app l'indique à l'utilisateur.
- Hors ligne au moment du « Démarrer » : le cycle est gardé en local et envoyé au retour du réseau ; les notifications dont l'heure est déjà passée (à la minute près) ne sont pas envoyées.

## Limites connues / suites logiques

- **Auth** : compte anonyme uniquement. L'« email magique » n'est pas implémenté (la colonne `users.email` est prête) ; sans lui, un compte ne se récupère pas sur un autre appareil.
- **Scan code-barres** : bouton « placeholder » (message « bientôt »).
- **Anti-abus** : la création de compte anonyme n'est pas limitée en débit ; ajouter une règle de rate limiting Cloudflare sur `POST /api/auth/anonymous`.
- **Statistiques** : `lessive économisée` agrège des mL ; la poudre est comptée 1 g ≈ 1 mL et une capsule ≈ 25 mL (voir `mlPerUnit`).
