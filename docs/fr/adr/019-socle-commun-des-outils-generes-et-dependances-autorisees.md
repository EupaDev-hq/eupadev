---
adr: 019
title: Socle commun des outils générés et dépendances autorisées
status: accepté
date: 2026-10-17
decision-makers: Ilan
supersedes:
related: [ADR-002, ADR-003, ADR-004, ADR-007, ADR-014, ADR-016, ADR-017]
controle: prévu
---
## Contexte
Le modèle d'outil (`template-outil-ia/`) fournit 206 lignes (en-têtes,
enveloppe d'erreur, lecture de corps JSON, gardes de rôle, logger) et aucune
dépendance ; ses règles demandent aux agents d'écrire eux-mêmes OIDC,
sessions, CSRF, limitation de débit, validation du contrat et audit, qui sont
les classes de code que les études mesurent comme les plus ratées par les
modèles (authentification et identité jusqu'à 83 % de programmes
vulnérables, ICSE 2026). Faits relevés le 2026-10-17 : le `Dockerfile` du
modèle appartient au rôle backend et installe sans `--ignore-scripts`, donc
un agent peut exécuter du code à la construction de l'image livrée, CI
verte ; l'image tourne avec `/app` inscriptible par le processus ; les
conteneurs d'agents n'atteignent que `registry.npmjs.org`, jamais une adresse
privée, et ne portent aucun jeton. Mesures : Fastify 5 complet installe 69
paquets contre 26 pour `node:http` avec les mêmes briques ; ses quatre avis
HIGH de septembre 2026 ne s'appliquent pas à une configuration figée ;
openapi-backend fait 1 972 lignes pour le seul routage dérivé du contrat ;
Lucia (dépréciée en 2025) renvoie à un fichier de référence de 190 lignes
pour les sessions ; Rails 8.2 (`:header_only`) n'est pas publié ; Mantle ne
supporte pas les profils d'inférence géographiques. Détail, sources et
revues : `docs/reflexions/2026-10-17-recherche-socle-commun.md`.

## Décision
Livrer à chaque outil généré un socle commun versionné, fermé par défaut,
que les agents utilisent sans pouvoir le réécrire ni le contourner sans
qu'un contrôle mécanique le voie.
- **Paquet versionné** `@eupadev/socle` (Apache-2.0, semver, migrations
  incluses en expansion seule, table de suivi séparée) : routeur dérivé
  d'`openapi.yaml`, validation Ajv 2020-12 des requêtes et des réponses
  (schémas fermés), erreurs RFC 9457, OIDC par `openid-client` (code + PKCE,
  callback GET, back-channel logout), sessions en PostgreSQL (jeton
  `id.secret` haché, 30 min / 8 h, `token_version`), CSRF par
  `Sec-Fetch-Site` et en-tête statique sans jeton, CSP avec Trusted Types,
  limitation de débit en base, audit sans `jsonb`, modules front servis
  depuis le paquet, point d'entrée du socle (`CMD` fixe).
- **Défaut fermé** : le processus refuse de démarrer si une opération du
  contrat n'a pas de `x-roles` ou de `security`, ou si un handler n'a pas
  d'`operationId` ; une route hors contrat n'existe pas ; `tx()` paramétré
  est le seul accès à la base ; RLS en option par table, plomberie toujours
  posée, obligatoire en profil renforcé.
- **Dépendances autorisées** : liste fermée des `name@version` du lockfile
  (socle : ajv, ajv-formats, yaml, openid-client, pg, `@fastify/busboy`, puis
  `fastify` 5.12.5 ou plus, `@fastify/cookie`, pino ;
  node-pg-migrate hors de l'image web ; `nodemailer`, `dompurify`,
  `file-type` sur besoin du contrat par exception), dépendances directes de
  l'outil = socle ∪ exceptions, cliquet sur le nombre, plafond 85 sur l'image web, `allowBuilds` vide,
  `packageManager` exact, `devEngines` refusé.
- **Distribution** : archive `vendor/eupadev-socle-<version>.tgz`
  (`file:`) protégée dans chaque dépôt, référence vérifiée par la CI ;
  publication publique sur `registry.npmjs.org` à la publication du projet ;
  miroir ADR-016 en cache ensuite ; jamais le registre de la forge.
- **Image** : `Dockerfile` fixe de la plateforme (`.gitea/image/`), hors
  périmètre des agents, `--ignore-scripts --ignore-pnpmfile`, `/app` non
  inscriptible, exécution en lecture seule avec `tmpfs` et volume `/data`.
- **Serveur HTTP** : Fastify 5 (5.12.5 ou plus) à configuration fermée figée
  dans le paquet : validateur et sérialiseur remplacés par Ajv 2020-12 pour
  chaque partie de la requête et pour les réponses, `removeAdditional`
  désactivé, `requestTimeout` et `connectionTimeout` fixés, `trustProxy`
  explicite, pino comme journal. Les handlers `(ctx) → {status, body}` ne
  voient jamais Fastify ; changer de serveur ne touche pas aux outils.

## Alternatives écartées
- Code copié dans chaque outil — les correctifs ne se propagent pas (Laravel :
  « no need to update the starter kit itself »).
- `node:http` et routeur maison (essai comparatif proposé par la recherche,
  non retenu par Ilan) — plus de code de sécurité maison, un seul mainteneur,
  personne ne le fuzze ; Fastify est audité et ses défauts se figent une fois.
- Zéro dépendance — des mois de travail pour une personne, et un code de
  sécurité que personne ne fuzze.
- Hono, openapi-backend — un mainteneur, 7 avis HIGH dont le routage pour
  l'un, 38 paquets dont lodash et aucun audit pour l'autre.
- ORM ou constructeur de requêtes — tous ont des CVE d'échappement
  d'identifiants en 2026 ; `postgres` est sous Unlicense, hors liste.
- Jeton CSRF — état et clé que les agents gèrent mal ; Go 1.25 s'en passe.
- Passerelle OIDC devant l'outil (oauth2-proxy) — deux CVE critical en 2026,
  session hors de la base de l'outil.
- Registre npm de la forge ou socle dans la golden image — inaccessible aux
  agents sans ouvrir une adresse privée et un jeton ; version liée à l'image.
- Mantle pour l'UE — pas de profil géographique, absent de Paris.

## Conséquences
- Les agents n'écrivent plus que handlers, SQL paramétré, migrations et front ;
  les règles passent de « écris ceci » à « utilise ceci ».
- Le socle a un seul mainteneur et aucun audit : maintenance d'environ six
  jours par trimestre, audit externe avant la 1.0, migration Fastify 6 à
  prévoir si ce serveur est retenu.
- Un bug du socle touche tous les outils ; il se corrige en une publication
  et un cycle de maintenance par outil.
- Le verrou du paquet garantit l'équivalence test/livraison et un diff
  visible, pas l'usage correct du socle : l'autorisation métier et le code
  écrit « de zéro » restent au kit SEC-*, aux relecteurs et aux gates.
- Fabrication UE possible par `bedrock-runtime` et un profil `eu.`, pas avec
  Fable 5.1 aujourd'hui.
- Construction estimée à 30-33 jours-personne (sans essai comparatif), puis
  7,5 à 9 semaines en
  parallèle du volet agents avant le premier vrai cycle.

## Vérification
Dans la CI de chaque outil : le job des garde-fous refusera toute dépendance
hors liste, toute hausse du nombre de paquets, une référence du socle autre
que l'archive attendue (spécificateur et intégrité du lockfile), un
`Dockerfile` ou un `index.js` à la racine, un script de cycle de vie, un
`.pnpmfile`, un `devEngines` ; Opengrep refusera dans le code de l'outil les
imports réservés (`pg`, `openid-client`, `jose`, `cookie`, `ajv`,
`node:http`, `fastify`), `createRequire`, `import.meta.resolve`,
`createServer`, `Set-Cookie`, le SQL interpolé et, dans `db/`, la
désactivation de la RLS, des triggers d'audit et les `GRANT`/`ALTER ROLE` ;
le job d'image construira avec le `Dockerfile` de la plateforme, démarrera le
conteneur en lecture seule et y lancera le kit SEC-* et Schemathesis contre
un Keycloak de test. Dans la CI du socle : tests unitaires, rejeu permanent
des avis de Fastify et find-my-way, test de catalogue PostgreSQL, test
« deux instances », outil d'exemple complet. Au labo : `verify-template`
installera un outil depuis l'archive sous Smokescreen, construira l'image et
testera le socle dedans. Non vérifiable mécaniquement : l'usage correct du
socle par un handler (autorisation métier), relu aux gates.
