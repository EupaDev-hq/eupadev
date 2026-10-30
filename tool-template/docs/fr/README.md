> Traduction destinée aux lecteurs humains. La version anglaise `README.md` (racine du dépôt) fait foi.

# <!-- Nom de l'outil — rempli au Cadrage -->

<!-- Un paragraphe, rempli au Cadrage et tenu à jour par le rôle
builder : ce que fait l'outil, pour qui, quel service en est propriétaire. -->

Généré par EupaDev. Ce fichier s'adresse aux personnes qui exploitent et
maintiennent l'outil. Les règles que suivent les agents sont dans `AGENTS.md` ;
la plateforme elle-même est décrite dans le dépôt EupaDev
(`docs/fr/architecture.md`).

## Lancer en local

L'outil tourne sur `@eupadev/core` (version exacte dans `package.json`,
depuis le registre npm de la forge) : le socle est le serveur. Il lit
`openapi.yaml`, charge un handler par opération depuis `api/`, sert `web/`,
et a besoin de sa base PostgreSQL et du fournisseur d'identité. L'outil de
référence est `examples/requests` dans le dépôt EupaDev.

```sh
pnpm install
node node_modules/@eupadev/core/bin/start.js --verify     # contrat et handlers, sans base
pnpm test                                                        # tests unitaires (node --test)
```

## Variables d'environnement

Posées par la plateforme en Preview et en Production (modèle Compose du
déployeur), jamais par l'outil : `APP_URL`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`,
`OIDC_CLIENT_SECRET_FILE`, `DATABASE_URL_FILE`, `DATABASE_CA_FILE`,
`TRUST_PROXY`, le proxy de sortie ; `RETENTION_*` pour la purge, fixées à la
Gate 1. Ajouter à cette section chaque variable propre à l'outil, reprise dans
`.env.example` avec une valeur fictive, jamais une vraie.

## Vérifications

| Commande | Lance |
|---|---|
| `pnpm test` | tests unitaires (`node --test`) |
| `pnpm run verify` | les contrôles de la CI en local, mêmes commandes : `pnpm install --frozen-lockfile --ignore-scripts`, `node --test`, contrôle du contrat, Opengrep, gitleaks, garde-fous |

## Structure du dépôt

| Chemin | Contenu | Rôle propriétaire |
|---|---|---|
| `openapi.yaml` | le contrat : routes, rôles, schémas ; figé après le Cadrage | contract |
| `api/` | un handler par `operationId` ; `api/lib/` pour le code partagé de l'outil | builder |
| `db/` | migrations versionnées (`db/migrations/`), purge (`db/purge.sql`) | builder |
| `web/` | pages, scripts, styles, sans étape de build | builder |
| `tests/unit/` | tests unitaires | le rôle propriétaire du code |
| `tests/acceptance/` | features Gherkin, étapes, specs de sécurité | contract (features), tests |
| `tests/perf/` | scénario k6 joué contre la Preview déployée | adapter l'exemple |
| `docs/spec.md`, `docs/DECISIONS.md` | périmètre et décisions propres à l'outil | scoping, puis chaque rôle |
| `design/` | design system partagé, copié tel quel dans `web/styles/` | protégé |
| `AGENTS.md`, `agents/`, `.claude/`, `.opengrep/`, `.gitea/`, `pnpm-workspace.yaml` | charte des agents, prompts des rôles, règles d'analyse, CI, réglages pnpm | protégé |
| `docs/fr/` | traductions françaises pour les lecteurs humains (l'anglais fait foi) | — |

Qui peut écrire où, et quels fichiers sont protégés : `AGENTS.md`.

## CI et livraison

Chaque push lance `.gitea/workflows/check.yml` : recherche de secrets, tests,
analyse statique, garde-fous, construction de l'image avec le
`.gitea/image/Dockerfile` fixe de la plateforme (non modifiable) à partir de
la golden image EupaDev, recherche de failles, puis l'image est démarrée en
lecture seule avec une base jetable (migration par la même image) et interrogée sur `/health`. Sur `main` uniquement, cette même image est publiée dans le registre
de la forge et son empreinte enregistrée : la Preview et la Production
reçoivent exactement cette empreinte, rien n'est reconstruit.
`preview-check.yml` joue les contrôles de performance, d'accessibilité et de
sécurité dynamique contre la Preview déployée ; c'est l'orchestrateur qui le lance.
