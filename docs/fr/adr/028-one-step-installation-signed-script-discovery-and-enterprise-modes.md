---
adr: 028
title: Installation en une étape par un script signé et versionné, en mode découverte ou entreprise
status: proposed
date:
decision-makers: Ilan
supersedes:
related: [ADR-001, ADR-005, ADR-010, ADR-017, ADR-018, ADR-024]
check: planned
---
> Traduction de `docs/adr/028-one-step-installation-signed-script-discovery-and-enterprise-modes.md` ; la version anglaise fait foi.

## Contexte
Installer EupaDev aujourd'hui, c'est suivre les dix étapes numérotées de
`infra/README.md` : LXD, Terraform, Ansible et ses collections sur la
machine hôte, une clé SSH dédiée, `terraform apply`, `init-vault.sh`
(secrets aléatoires, clé cosign de l'installation, clé Anthropic collée
dans un fichier), `site.yml`, puis une quinzaine de playbooks
`verify-*.yml`. Le résultat est un labo de cinq VM (forge, CI,
orchestrateur, agents IA, outils) estimé à 14 à 16 vCPU et 42 à 46 Go de
RAM (`docs/deployment.md`) ; mesurées sur le labo le 2026-11-08, les cinq
VM au repos utilisent environ 4,7 Go de RAM en tout : les chiffres
documentés sont les tailles données aux VM, pas ce dont le moteur a
besoin, et l'obstacle est le nombre de pièces, pas la mémoire. Chaque
cycle appelle un modèle payant. C'est la bonne forme pour une entreprise,
et le mauvais premier contact pour la publication en open source :
quelqu'un qui veut voir ce que fait EupaDev ne peut pas lui donner un
après-midi, cinq VM et une clé IA. Le moteur tourne déjà sans rien de tout
cela : dans le labo, ses adaptateurs (forge, déployeur, moteur d'agents)
sont factices tant qu'on ne les active pas (`EUPADEV_EXTERNAL`,
`orchestrator_real_world`), et la suite Gherkin fait tourner des cycles
entiers sur le moteur factice. Deux pièces séparent encore un nouveau venu
de ce cycle. La connexion : le moteur refuse tout appel sans jeton de son
émetteur OIDC (ADR-017, `OIDC_ISSUER` et `OIDC_JWKS_URL` exigés au
démarrage, `orchestrator/src/config.ts`), et cet émetteur est Keycloak, un
conteneur de plus, un realm à importer et une console d'administration à
apprendre ; les tests font déjà tourner toute l'API contre un émetteur
factice qui parle le protocole de Keycloak
(`orchestrator/tests/helpers/fake-oidc.ts` : les chemins de Keycloak sous
un realm, code d'autorisation avec PKCE, `typ at+jwt`, audience et rôles
du client). L'image : les images de la plateforme sont signées par cosign
avec une clé créée par installation par `init-vault.sh` (ADR-018,
`images/engine/README.md`) et construites par la forge propre à
l'installation (`images/engine/.gitea/workflows/publish.yml`) : cette clé
et cette forge n'existent pas avant l'installation, elles ne peuvent donc
signer ni le script qui la démarre ni l'image qu'elle exécute. Le projet
s'adresse aux équipes sécurité : `curl … | sh` comme seule entrée exécute
du code que personne n'a vu, l'inverse de ce que promet le reste du dépôt.

## Décision
Publier, avec chaque version, un seul script d'installation versionné,
signé par la chaîne de publication, qui installe EupaDev dans l'un de deux
modes.
- **Un artefact par version** : `install.sh`, `install.sh.sha256` et
  leurs signatures Sigstore (`cosign sign-blob`, sans clé : l'identité est
  le workflow de publication du dépôt public, inscrite dans le journal de
  transparence public). Aucune clé de projet à long terme à protéger ; la
  clé propre à l'installation continue de signer les images (ADR-018).
- **La vérification d'abord** : `docs/install.md` montre, dans cet ordre,
  comment télécharger le script, vérifier sa signature contre l'identité
  du workflow du dépôt et sa somme de contrôle, le lire, puis l'exécuter.
  Une commande sur une ligne peut être donnée ensuite par commodité,
  jamais comme seule voie.
- **Mode découverte** (`install.sh discovery`) : une machine, Docker
  Compose, le moteur avec son PostgreSQL, la page du demandeur et un
  attrape-courriels local, la forge, le déployeur et le moteur d'agents
  factices ; pas de clé IA, pas de coût, une dizaine de minutes. Il montre
  le cycle (demande, maquette, portes, Preview, Production) avec des
  agents simulés. Il ne donne **pas** : de vrais agents, leur isolation
  (gVisor, un réseau par tâche, proxy de sortie), de VM séparées pour la
  forge, la CI ou les outils, Keycloak, TLS, les sauvegardes. Il n'écoute
  que sur l'adresse de bouclage, refuse un domaine ou une adresse publique,
  et sa page comme son API portent une mention visible « découverte, pas
  pour la production ».
- **Connexion du mode découverte par un émetteur local, pas Keycloak** :
  un petit émetteur OIDC dérivé de l'aide de test `fake-oidc.ts`, lancé
  comme un conteneur du fichier Compose de découverte, sur l'adresse de
  bouclage seulement. Il sert la disposition de Keycloak sous un realm
  (`/protocol/openid-connect/auth`, `token`, `certs`, `logout`), le code
  d'autorisation avec PKCE et le client web confidentiel (ADR-024), et
  émet le jeton d'accès que le moteur vérifie déjà (ES256, `typ at+jwt`,
  `aud eupadev-api`, `resource_access.eupadev-api.roles`, `email`,
  `name`). Il tient exactement deux comptes, `requester` et `admin`, une
  casquette chacun, avec des mots de passe générés à l'installation et
  affichés une fois sur le terminal de l'installateur, jamais écrits dans
  un journal ; deux comptes sont ce qu'exige la règle des quatre yeux de
  la porte 2. **Le moteur ne change pas** : `OIDC_ISSUER`,
  `OIDC_JWKS_URL` et les variables `OIDC_WEB_*` pointent vers l'émetteur
  local, et chaque règle de l'ADR-017 (jeton vérifié, identité par
  `(émetteur, sujet)`, casquettes lues dans le jeton, 401 et 403)
  s'applique comme en entreprise. L'ADR-017 nomme Keycloak seul émetteur
  et a rejeté un émetteur local temporaire parce qu'il aurait été un
  second contrat d'identité à migrer ensuite ; cette décision est une
  **exception délimitée, pour le mode découverte seulement** : le contrat
  d'identité est le même (mêmes revendications, même code de
  vérification, mêmes casquettes), l'URL de l'émetteur était déjà un
  réglage par installation, et rien n'est migré puisqu'une installation
  de découverte est jetée par `uninstall`. Le mode entreprise garde
  Keycloak, ADR-017 inchangé.
- **Le mode découverte exécute une image de moteur publiée** : le
  workflow de publication du dépôt public
  (`.github/workflows/release.yml`, sur une étiquette `v*` seulement,
  jamais sur un push, actions épinglées par empreinte selon l'ADR-005 ;
  son premier job, permissions `contents: read`, `packages: write`,
  `id-token: write`) construit `orchestrator/Dockerfile`, pousse l'image
  vers `ghcr.io/eupadev-hq/eupadev-engine`, relève son empreinte et la
  signe sans clé avec cosign : l'identité est ce workflow à cette
  étiquette, l'émetteur du certificat est le service de jetons de GitHub,
  la signature va dans le journal de transparence public. Le second job
  estampille cette empreinte dans le script qu'il signe, le fichier
  Compose recevant le nom de l'image du script ; l'installateur lance
  `cosign verify` contre l'identité du workflow avant `docker compose
  up` ; une signature qui ne se vérifie pas arrête l'installation. Une
  seule identité à vérifier, pour le script et pour l'image. **Le mode
  entreprise continue de construire et de signer ses propres images**
  avec la clé de l'installation, sur sa propre forge, sans aucun service
  public (ADR-018 et `images/engine/publish.yml` inchangés).
- **Mode entreprise** (`install.sh enterprise`) : la recette d'aujourd'hui,
  pilotée depuis la machine hôte : prérequis, `terraform apply` quand les
  VM sont à créer localement (LXD, l'ADR-010 a rejeté le passage à Incus),
  ou un inventaire de VM fournies par la DSI (ADR-001), `init-vault.sh`,
  `site.yml`, les playbooks `verify-*.yml`. Rien de ce que fait la recette
  aujourd'hui n'est retiré ni caché ; le script l'ordonne.
- **Les deux modes** : un contrôle des prérequis qui s'arrête avant de
  rien changer (Docker et son plugin Compose, cosign ; ou LXD, Terraform
  ou OpenTofu, Ansible, RAM et disque libres) ; idempotent (une seconde
  exécution ne signale aucun changement) ; secrets générés localement,
  écrits dans des fichiers lisibles par le seul propriétaire ou dans le
  coffre, jamais affichés, sauf les deux mots de passe de découverte
  montrés une fois ; `install.sh uninstall` retire ce que le mode choisi a
  créé, données comprises après une confirmation explicite, et rien
  d'autre.

## Alternatives rejetées
- Un paquet de distribution (apt, brew, snap) — EupaDev est un ensemble de
  VM et de conteneurs configurés par Ansible, pas un binaire ; un paquet
  installerait l'installateur.
- `curl … | sh` comme seule voie — du code non vu au premier contact, sans
  version ni signature : un mauvais signal pour un projet qui met la
  sécurité d'abord.
- Signer le script ou l'image publiée avec la clé cosign de
  l'installation — créée par `init-vault.sh`, elle n'existe donc pas avant
  l'installation.
- Une clé de signature de projet à long terme — un secret de plus à
  protéger et à faire tourner dans un projet public ; une signature sans
  clé nomme le workflow qui a produit la version et chacun peut la
  vérifier dans le journal public.
- Deux scripts (démo, production) — deux chemins de code à garder égaux ;
  le contrôle des prérequis, l'idempotence et la désinstallation sont le
  même travail dans les deux.
- Un mode découverte avec de vrais agents et une clé fournie par
  l'utilisateur — un premier contact qui coûte de l'argent et atteint
  l'API du modèle depuis une machine non isolée ; les factices existent
  déjà et montrent le cycle.
- Une démo hébergée au lieu d'un mode découverte — un service à faire
  tourner et à protéger ; il ne montre rien de l'installation sur ses
  propres machines.
- Keycloak en mode découverte — un conteneur de plus, un import de realm
  et une console d'administration au premier contact, pour deux comptes
  qui ne changent jamais.
- Une découverte sans connexion — le moteur aurait besoin d'un
  contournement de l'ADR-017, un chemin de code qu'aucune entreprise
  n'exécute et qui devrait rester inoffensif pour toujours ; l'émetteur
  local garde le moteur identique dans les deux modes.
- Construire l'image du moteur sur la machine du nouveau venu — dix
  minutes deviennent trente, et ce qu'il faut vérifier devient une
  arborescence de sources au lieu d'une empreinte et d'une signature.

## Conséquences
Un nouveau venu voit un cycle en dix minutes sans clé IA, sans cinq VM et
sans Keycloak ; une équipe sécurité vérifie qui a produit le script et
l'image avant de les exécuter, par une seule identité ; la voie entreprise
reste la recette documentée, avec sa propre clé et sans service public. Le
coût : une chaîne de publication à construire (image, signatures, sommes
de contrôle), un émetteur local à entretenir (l'aide de test plus un
formulaire de connexion et deux comptes, un morceau de code de plus qui ne
doit jamais écouter au-delà de la boucle locale), un fichier Compose pour
le mode découverte et un job de CI qui l'installe, le relance et le
désinstalle à chaque changement ; la commande sur une ligne reste
possible et certains l'utiliseront. Le mode découverte fait confiance au
service de jetons de GitHub et aux services publics de Sigstore pour les
signatures, ce que le mode entreprise ne fait pas ; l'image publiée est
publique, ce qu'un moteur destiné à l'open source accepte. Le mode
découverte sera pris pour le produit : ses limites sont listées dans la
doc et sur sa page, et il refuse une adresse publique ; il ne peut pas
empêcher quelqu'un de l'exposer derrière son propre proxy, et les deux
mots de passe affichés sont alors le seul verrou. Vérifier demande cosign
installé, récupéré depuis sa propre publication avec sa somme de contrôle
publiée. À construire, dans cet ordre : le workflow de publication avec
les signatures sans clé du script et de l'image ; le script avec son
contrôle des prérequis, les deux modes et la désinstallation ; l'émetteur
local ; le fichier Compose de découverte et la mention dans le moteur ;
`docs/install.md` ; le job de CI.

## Vérification
Un workflow GitHub exécutera le script en mode découverte sur un runner
avec Docker : installation, ouverture de la page du demandeur et lecture
de la mention de découverte, connexion comme `requester` puis comme
`admin` par l'émetteur local avec les mots de passe affichés par
l'installateur, approbation d'une livraison avec `admin` (quatre yeux),
contrôle que l'émetteur et le moteur n'écoutent que sur l'adresse de
bouclage, seconde exécution et contrôle que rien n'a changé, `uninstall`
et contrôle qu'aucun conteneur, volume ou réseau d'EupaDev ne reste ; il
refusera `discovery` avec un domaine ou une adresse publique, et refusera
une image dont la signature ne correspond pas à l'identité du workflow.
Le workflow de publication vérifiera ses propres signatures et sommes de
contrôle avant de publier : `cosign verify-blob` pour le script, `cosign
verify` avec l'identité du workflow et l'émetteur de certificats de
GitHub pour l'image ; ses actions passent `verify-digests.py` comme tout
workflow du dépôt. Les tests du moteur continuent de prouver, sur
l'émetteur factice, les règles de l'ADR-017 sur lesquelles l'émetteur
local s'appuie. Pour le mode entreprise, `verify-*.yml` reste la preuve,
lancée à la main sur le labo, et `ansible-playbook site.yml` lancé deux
fois signale `changed=0`. Non vérifiable mécaniquement : que la
documentation montre la vérification avant la commande sur une ligne,
qu'aucun secret autre que les deux mots de passe n'est affiché par un
chemin que la CI n'a pas exercé, et que l'image publiée est bien celle
que décrit l'étiquette de version au-delà de ce qu'affirme la signature.
