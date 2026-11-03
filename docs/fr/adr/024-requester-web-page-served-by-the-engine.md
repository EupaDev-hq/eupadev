---
adr: 024
title: Page web du demandeur servie par le moteur, session OIDC côté serveur avec le client eupadev-web, deep-chat embarqué par empreinte de contenu, CSP sans Trusted Types sur cette page
status: proposed
date:
decision-makers: Ilan
supersedes:
related: [ADR-001, ADR-005, ADR-017, ADR-018, ADR-019]
check: planned
---
> Traduction destinée aux lecteurs humains. La version anglaise `docs/adr/024-requester-web-page-served-by-the-engine.md` fait foi.

## Contexte
Aujourd'hui, une demandeuse parle au moteur par la CLI
`orchestrator/scripts/eupadev.py` derrière un tunnel SSH : elle soumet
une demande, répond à l'agent de cadrage, donne son avis sur la maquette et
la Preview. La conversation existe déjà dans le moteur : la table `messages`
est en ajout seul, indexée par cycle, écrite avant tout e-mail, et lue par
l'agent de cadrage comme le chat du cycle. L'API du moteur (`node:http`,
sans framework) écoute sur `127.0.0.1:8080`, exige un `Host` localhost et
l'en-tête `X-EupaDev: 1` (un navigateur ne peut pas l'envoyer en
cross-origin : une protection CSRF), et authentifie chaque appel avec un
jeton d'accès Keycloak vérifié par `jose` (ADR-017 : `(iss, sub)` → acteur,
casquettes tirées des rôles du client `eupadev-api`). Faits réunis le
2026-10-25 : la RFC 10017
(OAuth 2.0 for Browser-Based Apps) nomme trois architectures et recommande
le backend-for-frontend pour les applications métier qui traitent des
données personnelles ; un client public dans le navigateur garde un jeton
en mémoire JavaScript, où toute XSS le vole. deep-chat 2.5.1 (MIT, bundle
unique de 387 Ko, sha256 épinglé) est le seul composant web de chat
maintenu et sans framework trouvé : il précharge un historique, remplace
son appel HTTP par un handler, accepte des messages poussés et rend le
Markdown avec `html: false` ; mais il a 30 sinks `innerHTML` et lit les
attributs de type fonction avec `new Function()`, donc il ne peut pas
tourner sous `require-trusted-types-for 'script'`, la politique des outils
générés (ADR-019). Le socle (`core/`) contient déjà une connexion OIDC côté
serveur éprouvée avec `openid-client`, un cookie `__Host-session` adossé à
une table PostgreSQL, et le schéma « une dépendance servie depuis
`node_modules`, épinglée, jamais copiée dans le dépôt » (DOMPurify). Les
alternatives ont été mesurées à ces éléments : un backend médiateur de
jeton, un proxy OAuth devant (oauth2-proxy avec `forward_auth` de Caddy),
Caddy servant la page, un conteneur statique séparé, NLUX et les kits de
chat React.

## Décision
Donner aux demandeurs une page web servie par le processus du moteur, avec
une connexion faite par le moteur lui-même, construite sur un deep-chat
embarqué, avec sa propre CSP.
- **Servie par le moteur** : les quelques fichiers statiques de la page
  (HTML, JavaScript, dictionnaires, composant embarqué) sont livrés dans
  l'image signée du moteur et servis par le même processus `node:http` que
  l'API, sur la même origine : pas de CORS, cookie same-site, un seul
  endroit pour les en-têtes de sécurité. Pas de deuxième conteneur, pas de
  fichier copié sur la VM hors de l'image. La garde `Host` de l'API accepte
  le nom propre de la page (`DASHBOARD_URL`) en plus des noms de loopback ;
  rien d'autre.
- **Session OIDC côté serveur (BFF)** : le moteur est le client OIDC,
  confidentiel, nommé `eupadev-web` : code d'autorisation + PKCE S256 +
  `state` + `nonce` avec `openid-client` (la bibliothèque et la version du
  socle). Le jeton d'accès que Keycloak renvoie est vérifié par les mêmes
  règles qu'un Bearer de la CLI (at+jwt, audience `eupadev-api`,
  casquettes tirées de ses rôles de client) et résolu vers le même acteur ;
  ensuite aucun jeton n'est gardé. Le navigateur ne reçoit qu'un cookie
  `__Host-session` (HttpOnly, Secure, SameSite=Lax, Path=/) dont la valeur
  aléatoire de 32 octets est stockée hachée (SHA-256) dans une table
  `sessions`, 30 minutes d'inactivité, 8 heures au plus ; la déconnexion
  supprime la ligne et efface le cookie. `authenticate()` accepte le cookie
  ou le Bearer : la CLI ne change pas. Tout appel d'API fait avec le cookie
  exige toujours `X-EupaDev: 1` ; seules les trois navigations de
  connexion (`/auth/login`, `/auth/callback`, `/auth/logout`) en sont
  exemptées. Sans le client web configuré, `/auth/*` répond 503 et le reste
  de l'API fonctionne. `/auth/login` transmet la langue de la page à
  Keycloak comme `ui_locales` (`fr` ou `en` seulement ; le realm propose les
  deux, le français par défaut).
- **deep-chat embarqué par empreinte de contenu** : `deep-chat` est une
  dépendance de développement à une version exacte, avec l'intégrité du
  lockfile ; son bundle est copié dans l'image à la construction et servi à
  un chemin qui porte les premiers octets de son sha256 ; il n'est jamais
  récupéré à l'exécution (esprit d'ADR-005) ni copié dans le dépôt. Les
  messages sont du texte brut : le type de message `html` du composant n'est
  jamais utilisé, le Markdown est rendu avec `html: false`, la configuration
  passe par des propriétés JavaScript, jamais par des attributs HTML.
- **CSP sans Trusted Types sur cette page** : la page de chat reçoit
  `script-src 'self'; style-src 'self'; object-src 'none'; frame-ancestors
  'none'` sans `require-trusted-types-for`, contrairement aux outils
  générés. Les liens `javascript:` dans le texte d'un agent restent inertes
  sous `script-src 'self'`. Les outils générés gardent la politique
  d'ADR-019.
- **Lectures limitées au propriétaire** : une conversation et l'état d'un
  cycle ne sont lisibles que par le demandeur de l'outil ou un admin, la
  règle que suivent déjà les avis ; « mes demandes » ne liste que les outils
  du demandeur.

## Alternatives écartées
- PKCE dans le navigateur (client public, jeton en mémoire JavaScript) —
  toute XSS vole un jeton, et le composant choisi a des sinks `innerHTML`.
- Backend médiateur de jeton (RFC 10017 §6.2) — le backend se connecte mais
  remet quand même le jeton à la page : aucun gain sur le BFF ici.
- Proxy OAuth devant (oauth2-proxy, `forward_auth` de Caddy) — un conteneur
  de plus, une identité portée par des en-têtes auxquels le moteur doit se
  fier (une erreur de configuration fait de n'importe qui n'importe qui),
  deux systèmes de session à côté du Bearer de la CLI ; Keycloak Gatekeeper
  est déprécié, `caddy-security` demande une construction de Caddy sur
  mesure.
- Caddy servant la page, en proxy de l'API — des fichiers livrés sur la VM
  hors de l'image signée, deux choses à versionner.
- Un conteneur statique séparé — une deuxième image à construire, signer et
  déployer par empreinte, pour quatre fichiers.
- Charger deep-chat depuis un CDN — une dépendance d'exécution hors de
  l'image signée (ADR-005).
- Trusted Types sur la page de chat — `innerHTML` et `new Function()` de
  deep-chat le rendent impossible sans patcher le bundle embarqué.
- NLUX — licence signalée comme une MPL-2.0 modifiée qu'on ne peut pas
  cerner ; modèle d'adaptateur construit autour du streaming ; pas de mise
  en place sans bundler documentée.
- assistant-ui, Ant Design X, MUI X Chat, prompt-kit, AI Elements,
  @chatscope — React ou liés à un framework, demandent une étape de build.

## Conséquences
- Aucun jeton n'atteint jamais le navigateur ; une valeur de cookie volée
  est inutile une fois la ligne supprimée, et la base ne contient jamais de
  cookie utilisable.
- Une table `sessions` et les premières instructions `DELETE` du moteur
  (déconnexion, expiration) ; les casquettes sont figées pour la durée de la
  session (8 heures au plus).
- Le processus du moteur sert aussi des fichiers statiques et un parcours de
  connexion tourné vers le navigateur : une surface plus grande dans le
  composant le plus exposé, même origine que l'API, couverte par les gardes
  existantes de l'API.
- La page de chat exécute un composant tiers sans Trusted Types : accepté
  pour une page dont les messages sont du texte brut et dont les scripts
  sont `'self'` seulement ; l'accessibilité du composant est faible et doit
  être vérifiée mécaniquement.
- Keycloak reçoit un client confidentiel avec une URL de redirection
  exacte ; l'URL du tunnel du labo d'abord, le nom d'hôte public plus tard
  (une deuxième entrée `redirect_uris`, rien d'autre).
- Limite : pas de rafraîchissement des casquettes pendant une session ; un
  changement de rôle s'applique à la connexion suivante.
- Limite : une organisation des endpoints de jeton propre à Keycloak est
  supposée (l'endpoint de jeton est déduit de l'URL JWKS).

## Vérification
Les tests d'API `node:test` du moteur vérifieront, avec un fournisseur
d'identité factice : la redirection de connexion porte `state`, `nonce` et
un challenge PKCE S256 ; un callback avec un `state` falsifié ou sans son
cookie de transaction est refusé ; le cookie donne le même acteur qu'un
Bearer ; un cookie inconnu ou expiré reçoit 401 et est effacé ; la
déconnexion invalide la valeur du cookie ; un POST fait avec le cookie mais
sans `X-EupaDev` est refusé ; le cookie d'un demandeur ne peut pas lire
le cycle d'un autre demandeur (403) ; la base ne contient que le hash de la
valeur du cookie ; `/auth/*` répond 503 quand le client web n'est pas
configuré — une mutation par règle (vérification de `state`, expiration,
suppression à la déconnexion, exemption d'en-tête). Playwright (Chromium)
chargera la page avec le composant embarqué et vérifiera zéro
`securitypolicyviolation`, des charges XSS inertes (`<img onerror>`,
`[x](javascript:…)`), zéro violation axe-core, et qu'un double clic envoie
une seule requête. La CI du moteur refusera une référence à `deep-chat` qui
n'est pas une version exacte et un bundle servi dont le hash diffère de
l'intégrité du lockfile. `verify-keycloak.yml` comparera les clients du
realm à la liste déclarée (`eupadev-web` compris, `at+jwt`, PKCE S256,
URL de redirection exacte). Non vérifiable mécaniquement : qu'une future
page n'utilise jamais le type de message `html` du composant (relecture du
code de la page).
