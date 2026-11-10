# Installer EupaDev

> **État (2026-11-09).** Le mode découverte tourne de bout en bout **depuis
> un clone du dépôt** : installation, connexion des deux comptes, une demande
> jusqu'à son premier mail de gate, relance, désinstallation, le tout joué
> pour de vrai sur une machine et par le job CI
> `.github/workflows/install.yml` à chaque push. Reste à venir
> ([ADR-028](../adr/028-one-step-installation-signed-script-discovery-and-enterprise-modes.md)) :
> la première release `v*` (script signé, section 1) et l'image publiée et
> signée du moteur ; d'ici là le script dit « signature non vérifiée » et
> construit l'image lui-même. Le mode entreprise reste la recette du labo,
> [`infra/README.md`](../../infra/README.md) (section 3 plus bas). Le détail
> du chemin « depuis un clone » est dans la version anglaise,
> [`docs/install.md`](../install.md), section 2.

EupaDev s'installe par un seul script, `install.sh`, publié signé avec
chaque release. Il a deux modes : **découverte**, une machine avec Docker,
des agents factices, pas de clé d'IA, pour voir le cycle en dix minutes
environ ; et **entreprise**, la recette Terraform + Ansible qui construit
la vraie plateforme. Quel que soit le mode, commencez par la section 1.

## 1. Vérifier avant de lancer

Un script lancé depuis Internet est du code que personne chez vous n'a lu.
Chaque release contient trois fichiers, et l'ordre ci-dessous est le cœur
du projet : vérifier, lire, puis lancer. Il n'y a pas de ligne
`curl … | sh` sur cette page, volontairement.

1. **Téléchargez les trois fichiers** de la release voulue depuis
   `https://github.com/EupaDev-hq/eupadev/releases` : `install.sh`,
   `install.sh.sha256` et `install.sh.sigstore.json`. Notez le tag
   téléchargé :

   ```sh
   VERSION=v0.1.0   # le tag de la release téléchargée
   ```

2. **Récupérez cosign depuis sa propre release, vérifié par sa somme de
   contrôle publiée** (même version et même somme que la CI du dépôt) :

   ```sh
   curl -fsSLO https://github.com/sigstore/cosign/releases/download/v3.1.3/cosign-linux-amd64
   echo "4629c757b7618056f8ddd7e2625ae9fdd94c0372a65049520bc7d9df9efc7f71  cosign-linux-amd64" | sha256sum -c -
   chmod 0755 cosign-linux-amd64 && sudo mv cosign-linux-amd64 /usr/local/bin/cosign
   ```

3. **Vérifiez la signature.** La signature est sans clé (Sigstore) : il n'y
   a aucune clé de projet à croire, l'identité est le workflow de release du
   dépôt public à ce tag, et la signature est inscrite dans le journal
   public de transparence. La commande échoue si le fichier n'a pas été
   signé par ce workflow à ce tag :

   ```sh
   cosign verify-blob \
     --bundle install.sh.sigstore.json \
     --certificate-oidc-issuer https://token.actions.githubusercontent.com \
     --certificate-identity "https://github.com/EupaDev-hq/eupadev/.github/workflows/release.yml@refs/tags/$VERSION" \
     install.sh
   ```

4. **Vérifiez la somme de contrôle** (une seconde preuve, indépendante, que
   le fichier est celui publié par la release) :

   ```sh
   sha256sum -c install.sh.sha256
   ```

5. **Lisez-le.** Environ deux cents lignes de shell POSIX, pas de bash. Ce
   qu'il faut y chercher : il n'écrit que sous `~/.eupadev/discovery/` (ou
   `--dir`), il ne télécharge que le fichier Compose de la découverte de son
   propre tag et le refuse si sa somme ne correspond pas à celle gravée dans
   le script, il vérifie la signature de l'image du moteur avec la même
   identité de workflow avant de démarrer quoi que ce soit, il n'écoute que
   sur l'adresse de bouclage, et son `uninstall` ne retire que ce qu'il a
   créé.

   ```sh
   less install.sh
   ```

6. Puis lancez-le (section 2 ou 3).

Ce que prouve la signature : que ce fichier exact a été produit par le
workflow de release de `EupaDev-hq/eupadev` au tag que vous nommez, et que
l'événement figure dans le journal public où chacun peut le retrouver. Ce
qu'elle ne prouve pas : que le code est bon. C'est pour cela que l'étape 5
existe.

## 2. Mode découverte : une machine, dix minutes, pas de clé d'IA

**Ce que vous obtenez.** Le moteur avec son PostgreSQL, la page du
demandeur, un service de connexion local avec deux comptes (`requester` et
`admin`), un attrape-mails pour les courriels des gates, et la forge, le
déployeur et le moteur d'agents factices. Vous voyez le cycle : une demande,
l'étape de maquette, les gates et leurs décisions, Preview, Production, avec
des agents factices et sans coût.

**Ce que vous n'obtenez pas.** De vrais agents et leur isolation (gVisor, un
réseau par tâche, proxy de sortie), une VM forge, CI ou outils séparée,
Keycloak, TLS, des sauvegardes, un outil qui tourne. Le mode découverte est
une démonstration du cycle, pas le produit ; sa page le dit, et il refuse
d'écouter ailleurs que sur l'adresse de bouclage.

**Prérequis.** Linux (macOS devrait fonctionner ; non testé), Docker Engine
avec le plugin Compose, cosign (section 1), environ 2 Gio de RAM libres,
5 Gio de disque, les ports 8080, 8081 et 8025 libres, et Chrome ou Firefox
(voir la note Safari plus bas). Vérifier sans rien changer :

```sh
sh install.sh check
```

**Installer.** Le script s'arrête au premier prérequis manquant, avant toute
écriture. Puis il télécharge le fichier Compose de son tag, le compare à la
somme gravée dans le script, vérifie la signature de l'image du moteur,
écrit `~/.eupadev/discovery/` (un fichier Compose et un fichier
d'environnement lisible par vous seul, avec des secrets aléatoires), et
démarre les conteneurs sur `127.0.0.1` :

```sh
sh install.sh discovery
```

Ensuite :

- la page du demandeur est `http://localhost:8080/`, l'attrape-mails
  `http://localhost:8025/`, où arrivent les courriels que l'usine envoie à
  chaque gate (rien ne sort de votre machine) ;
- les mots de passe des deux comptes, `requester` et `admin`, sont générés
  par le script et affichés **une fois** sur votre terminal, à la fin de la
  première installation (ADR-028) : notez-les. Ils ne sont jamais écrits
  dans le journal d'un conteneur ; le conteneur de connexion n'en garde que
  des empreintes en mémoire. Ils restent dans le fichier
  `~/.eupadev/discovery/.env`, lisible par vous seul, avec les autres
  secrets, pour qu'une relance garde les mêmes comptes ;
- connectez-vous en `requester` pour décrire un outil, puis en `admin` pour
  décider aux gates : la règle des quatre yeux du moteur s'applique comme en
  entreprise, un compte ne peut pas approuver sa propre demande.

**Safari.** Les cookies de session du moteur sont `Secure` (ADR-024), et la
page de découverte est en simple `http://localhost`. Chrome et Firefox
traitent `localhost` comme un contexte sécurisé et les acceptent ; Safari
peut les refuser, et la connexion revient alors au formulaire. Utilisez
Chrome ou Firefox pour le mode découverte ; il n'y a pas de correction dans
le code, volontairement (le mode entreprise est toujours derrière HTTPS).

**Relancer** ne change rien : les secrets sont conservés, le fichier Compose
est comparé, Compose ne recrée rien. Pour mettre `127.0.0.1` dans les URL
au lieu de `localhost` (`--address 127.0.0.1`) ou pour un autre dossier
(`--dir`), désinstallez d'abord ; toute autre adresse est refusée, ces deux
noms étant les seuls que le moteur accepte en mode découverte.

**Désinstaller** retire les conteneurs, leurs volumes (vos données de
découverte) et les deux fichiers écrits par le script, rien d'autre, après
une confirmation (`--yes` la saute) :

```sh
sh install.sh uninstall
```

## 3. Mode entreprise : la vraie plateforme

Le mode entreprise est la recette de [`infra/README.md`](../../infra/README.md),
« Rebuild everything from scratch » : Terraform crée les VM (LXD sur votre
propre machine), Ansible les configure, Docker Compose lance les services,
et les playbooks `verify-*.yml` prouvent le résultat sur les vraies
machines. Il demande votre domaine et votre DNS, Keycloak pour l'identité,
une clé Anthropic pour les agents, et il construit et signe ses propres
images sur sa propre forge : aucun service public n'est à croire.
Dimensionnement et ce qu'une installation demande à une entreprise :
[`deployment.md`](deployment.md) et
[`client-prerequisites.md`](client-prerequisites.md). Première connexion
après l'installation : `infra/README.md`, section « Keycloak ».

Dit simplement :

- `install.sh enterprise` **n'est pas encore construit** : aujourd'hui le
  script n'ordonne rien pour ce mode ; suivez les étapes numérotées de
  `infra/README.md`.
- **Des VM fournies par une DSI : pas encore.** Les recettes supposent le
  labo LXD (disque de données repéré par son nom LXD, DNS du réseau du labo,
  pas de proxy sortant, pas de certificat fourni). La liste des bloquants
  est dans [`deployment.md`](deployment.md), « Ce qui manque avant un vrai
  client ». Tant qu'ils ne sont pas levés, le mode entreprise signifie : un
  hôte Linux avec LXD, Terraform (ou OpenTofu) et Ansible, qui déroule la
  recette du labo.
