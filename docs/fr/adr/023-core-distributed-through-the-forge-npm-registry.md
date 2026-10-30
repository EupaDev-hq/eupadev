---
adr: 023
title: Socle distribué par le registre npm de la forge
status: proposed
date:
decision-makers: Ilan
supersedes:
related: [ADR-005, ADR-016, ADR-019]
check: planned
---
> Traduction destinée aux lecteurs humains. La version anglaise `docs/adr/023-core-distributed-through-the-forge-npm-registry.md` fait foi.

## Contexte
ADR-019 (accepté) fait de `@eupadev/core` la base commune de tout outil
généré et, dans son point *Distribution*, le livre sous forme d'archive
protégée `vendor/eupadev-core-<version>.tgz` dans chaque dépôt d'outil,
référencée par `file:` et vérifiée par la CI, « jamais le registre de la
forge ». Il écartait le registre npm de la forge parce que les agents ne
pouvaient pas l'atteindre : leurs conteneurs ne sortent que par Smokescreen,
qui autorise `registry.npmjs.org` et refuse les adresses privées même
derrière un nom autorisé, et ils ne portent aucun jeton. L'archive coûte une
copie par outil, une vérification des octets et un script de maintenance
pour diffuser un nouveau socle.

Gitea, notre forge, a un registre npm intégré
(`https://<forge>/api/packages/<org>/npm/`). Vérifié sur Gitea 28.1.0 (la
version du labo) le 2026-10-22 : une version n'est jamais écrasée (une
republication reçoit 409) ; la lecture demande un badge de membre avec
`read:package` (les anonymes et les non-membres reçoivent 401) ; un badge
`read:package` ne peut pas publier (401) ; l'URL de l'archive a la forme de
npmjs, et pnpm 12 l'écrit dans le lockfile de l'outil avec son intégrité.
pnpm 12 refuse aussi, même avec `--frozen-lockfile`, une version publiée il
y a moins de 24 heures (`minimumReleaseAge` par défaut). Gitea n'a pas de
droit par paquet : un paquet appartient à un propriétaire, et l'écriture se
donne par propriétaire (propriétaires, ou équipes dont l'unité paquets a
l'écriture ; doc « Packages, Access Restrictions », issue
go-gitea/gitea#19270, `services/context/package.go` en v28.1.0), donc le
badge d'écriture des outils (il publie leurs images) pourrait publier
`@eupadev/core` dans `eupadev`. Le scope npm n'est pas comparé au
propriétaire (`/api/packages/{owner}/npm/`,
`modules/packages/npm/creator.go`) : vérifié en local, un `@eupadev/core`
publié sous un autre propriétaire y est accepté. Une organisation « limited »
est lisible par tout compte connecté. Renovate, utilisé pour les mises à
jour de dépendances, prend en charge un registre npm privé par des host
rules. Installer les paquets privés avant le démarrage d'un agent, les
secrets ayant disparu quand il démarre, est le schéma documenté des agents
de code hébergés (scripts de setup d'OpenAI Codex, `copilot-setup-steps.yml`
de GitHub Copilot, scripts de setup cloud de Claude Code) ; pnpm documente
`pnpm fetch` (paquets depuis le seul lockfile, dans le store) suivi d'une
installation hors ligne (https://pnpm.io/cli/fetch). Aucun ne documente un
registre interne derrière un proxy de sortie avec un badge que l'agent ne
voit jamais : un essai local (Gitea 28.1.0, pnpm 12.9.1) a montré qu'un
store rempli par `pnpm fetch` dans un autre conteneur permet à un conteneur
sans aucune route vers la forge de lancer `pnpm install --frozen-lockfile`,
sans que le badge figure dans aucun de ses fichiers.
Détail et sources : `docs/reflexions/2026-10-22-note-socle-registry.md`.

## Décision
Distribuer le socle par le registre npm de la forge, à une version exacte
par outil ; cela remplace le point *Distribution* d'ADR-019 (et son option
écartée « registre npm de la forge »), le reste d'ADR-019 tient.
- **Propriétaire** : le socle est publié sous sa propre organisation
  `eupadev-core` (limited), dont le seul membre ayant l'écriture sur les
  paquets est le robot `svc-core` ; `svc-core` n'est dans aucune équipe de `eupadev`.
- **Publication** : un dépôt de plateforme `core` dont le pipeline teste le
  socle, puis publie la version de son `package.json` sauf si elle existe
  déjà. Badge de `svc-core` (`write:package`), rangé dans les secrets de ce
  seul dépôt, jamais dans ceux de l'organisation.
- **Référence** : le `package.json` de l'outil nomme `@eupadev/core` à
  une version exacte ; son lockfile le résout depuis le seul registre de la
  forge (intégrité, archive sous `/api/packages/eupadev-core/npm/`, le
  registre de scope de chaque consommateur : CI, construction de l'image,
  lanceur, Renovate). Pas d'archive `vendor/`, pas de référence `file:`.
- **CI de l'outil** : le badge en lecture seule (`read:package`) n'est donné
  qu'aux étapes qui installent, dans une config utilisateur pnpm temporaire
  rattachée à l'adresse du registre ; jamais à l'étape qui exécute le code
  de l'agent. La construction de l'image le reçoit comme secret BuildKit,
  jamais dans une couche.
- **Âge de publication** : le `pnpm-workspace.yaml` protégé du template
  exempte `@eupadev/core`, et lui seul, de l'âge minimal de publication
  de pnpm.
- **Mises à jour** : Renovate propose chaque nouvelle version du socle comme
  une branche testée par la CI de l'outil, jamais fusionnée automatiquement.
  Décision A (Ilan, 2026-10-27, après que le cycle 43 a perdu un tour à
  cause d'une montée de version faite en pleine tâche par le builder) : au
  début de chaque cycle d'**évolution**, avant qu'un agent travaille, la
  plateforme elle-même passe l'outil à la dernière version publiée (côté
  moteur, dans un conteneur comme celui du fetch : badge de lecture, route
  vers le registre, `pnpm add @eupadev/core@latest --lockfile-only` ; la
  forge commite les deux fichiers dans main, avec un message qui saute la
  CI). Seule l'entrée du socle change ; déjà à la dernière version → pas de
  commit ; registre injoignable → le cycle continue avec sa version actuelle, demandeur et
  admin prévenus. Compromis accepté : une évolution peut apporter un
  changement de socle que personne n'a demandé ; les tests, la CI et la
  Preview du tour le vérifient avant la Prod.
- **Accès des agents** : la sortie réseau des agents ne change pas
  (Smokescreen, aucune adresse privée, aucun badge dans un conteneur de
  tâche). Avant qu'un agent qui installe des dépendances démarre sur un
  outil dont le lockfile nomme le socle, le lanceur vérifie ce lockfile
  (résolutions par registre seulement, archives seulement sous le registre
  de la forge) et lance `pnpm fetch` dans un conteneur séparé à courte durée
  de vie : même image d'agent vérifiée et même durcissement, son propre
  réseau avec une route directe vers la forge, un badge en lecture seule
  dédié sur sa seule entrée standard. Il remplit le store pnpm du volume de
  la tâche ; l'agent installe ensuite depuis ce store, la forge étant
  injoignable pour toute autre version du socle. Un échec du fetch arrête la
  tâche avec un message clair.
- **Outil de migration** : `node-pg-migrate` est une dépendance d'exécution
  du socle (Ilan, 2026-10-21, note de l'étape 9), la même image lançant
  `bin/migrate.js` avant que le trafic bascule ; cela remplace
  « node-pg-migrate hors de l'image web » dans le point *Dépendances
  autorisées* d'ADR-019. Le plafond de paquets de production vérifié par
  `core.yml` passe de 85 à 95 (91 mesurés avec node-pg-migrate et `pg`,
  2026-10-24).

## Alternatives écartées
- Archive `vendor/*.tgz` par outil (ADR-019) — une copie, une vérification
  des octets et un script de diffusion par outil, là où un registre donne
  gratuitement l'immuabilité et les mises à jour Renovate.
- Socle dans la golden image — la version du socle suivrait la
  reconstruction hebdomadaire de l'image au lieu du lockfile de l'outil.
- `registry.npmjs.org` public dès maintenant — publie avant que le projet
  soit public ; reste possible à la publication.
- Badge de publication dans les secrets de l'organisation — chaque pipeline
  d'outil le recevrait.
- Un robot de publication dédié dans `eupadev` — le badge d'écriture des
  outils publierait quand même le socle (droits par propriétaire, pas par
  paquet).
- Forge joignable depuis les agents (Smokescreen autorisant son adresse
  privée, badge dans le conteneur de tâche) — ce qu'ADR-019 refusait ; un
  agent pourrait lire tous les paquets de l'organisation.
- Verdaccio (ADR-016) en proxy de la forge pour `@eupadev/*` — un
  deuxième amont et un badge dans un service de longue durée, pour un seul
  paquet.
- Des agents qui n'installent jamais le socle (CI seulement) — le builder ne
  pourrait pas lancer contre le socle les tests qu'il écrit.
- Garder l'âge minimal de publication de 24 heures pour le socle — il
  protège contre les paquets publics compromis ; le socle vient de notre
  propre CI, et le délai mettrait la CI de chaque outil au rouge pendant un
  jour après chaque version.

## Conséquences
- Une copie de chaque version du socle, immuable ; un outil change de
  version par un changement de lockfile relu, comme toute dépendance.
- Les lockfiles portent le domaine de la forge : un outil déplacé vers une
  autre installation régénère son lockfile.
- Un agent n'installe que la version du socle de la base de sa tâche ;
  changer cette version est un changement de lockfile relu fait hors de
  l'agent (son installation échoue clairement). Le conteneur de fetch
  récupère tout le lockfile par une route directe, hors de Smokescreen : ses
  requêtes sont limitées aux registres que nomme le lockfile vérifié.
- Seuls `svc-core`, les propriétaires de `eupadev-core` et les
  administrateurs du site de la forge peuvent publier une version du socle
  (accepté : ils administrent la forge de toute façon). Un faux
  `@eupadev/core` publié sous `eupadev` par un pipeline d'outil n'est
  jamais installé : le registre de scope nomme le propriétaire du socle, et
  la garde G4 refuse un lockfile qui le résout ailleurs.
- Une deuxième organisation à administrer ; son nom est fixé par convention
  (`<org>-core`), les pipelines le déduisent de leur dépôt.
- Renovate doit tourner contre la forge pour que des mises à jour soient
  proposées ; d'ici là, les mises à jour du socle sont des changements de
  lockfile manuels.
- Le registre est dans la sauvegarde de la forge (`gitea dump` inclut les
  paquets).

## Vérification
Le pipeline du socle échouera sur un test en échec et sautera, sans erreur,
une version déjà publiée ; Gitea refuse tout écrasement (409).
`verify-core.yml` vérifiera, au labo : pipeline vert ; version présente avec
une archive sous le registre de la forge ; le badge de lecture lit mais ne
peut pas publier ; lecture anonyme refusée ; republication refusée (409) ;
badge de publication présent dans les secrets du dépôt `core` et absent de
ceux de l'organisation ; relance verte sans publication ; `svc-core` membre
d'aucune équipe de `eupadev` ; le badge d'écriture des outils refusé sous
le propriétaire du socle ; un faux publié sous `eupadev` jamais servi par
lui. Dans la CI de chaque outil, la garde G4 (`.gitea/checks/package.mjs`,
job guard-rails) refusera une référence au socle qui n'est pas une version
exacte ou pas résolue depuis `/api/packages/eupadev-core/npm/`. Dans les
tests du moteur (Docker factice), le conteneur de fetch s'exécutera avant
celui de l'agent, le badge n'apparaîtra que sur son entrée standard, un
fetch échoué arrêtera la tâche avec le badge masqué, et un lockfile avec une
archive ailleurs sera refusé avant tout conteneur ; une mutation par règle.
Non vérifiable mécaniquement : qu'aucun futur workflow ne donne le badge de
lecture à une étape qui exécute du code d'agent (relecture du `.gitea/`
protégé).
