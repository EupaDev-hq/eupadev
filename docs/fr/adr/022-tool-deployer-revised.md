---
adr: 022
title: Déployeur des outils, SSH à commande forcée vers un modèle Compose de la plateforme (révision d'ADR-014)
status: accepted
date: 2026-10-21
decision-makers: Ilan
supersedes: ADR-014
related: [ADR-009, ADR-015, ADR-019]
check: partial
---
> Traduction destinée aux lecteurs humains. La version anglaise `docs/adr/022-tool-deployer-revised.md` fait foi.

## Contexte
Le moteur EupaDev déploie chaque outil généré trois fois : la maquette de
cadrage (ADR-009), une Preview que le demandeur juge, puis la Production.
Une image d'outil contient du code écrit par des agents, non fiable par
principe ; le moteur est la partie la plus exposée de la plateforme. Un
moteur compromis ne doit pas lancer une image venue d'ailleurs, ni obtenir
Docker ou un shell sur une cible, et une image hostile doit rester
enfermée. Il n'y a pas de Kubernetes : des VM fournies par la DSI
(ADR-001). Faits (2026-10-14) : Kamal et Coolify poussent par SSH, mais en
root ou avec le groupe `docker`, ce qui revient à root ; OpenSSH offre des
commandes forcées par clé, `from=` et `restrict` ; rien ne vérifie une
signature hors de Kubernetes à moins d'appeler cosign explicitement ; Caddy
évalue un espace réservé (`{labels.N}`) dans l'adresse amont à chaque
requête, donc un seul bloc générique route chaque outil sans rechargement.
ADR-014 a décidé cette conception le 2026-10-14. Depuis : les outils bâtis
sur le socle (ADR-019) ont besoin d'une base PostgreSQL avec une étape de
migration lancée par la même image, et d'une sortie vers le seul
fournisseur d'identité ; le moteur traite déjà un déploiement raté comme
« empreinte tentée, échec », donc le champ `served` supplémentaire d'ADR-014
n'est pas nécessaire ; les décisions d'Ilan du 2026-10-21 (D-E1 à D-E6)
suppriment l'alias de maquette par cycle et le conteneur de Prod arrêté
conservé. Le chemin de la Preview a été construit et mesuré au labo le
2026-10-21 (déploiement d'une petite image ≈ 2 s ; un appel tué en cours de
route puis rejoué converge). Sources :
`docs/reflexions/2026-10-14-note-e5-deployeur.md`,
`docs/reflexions/2026-10-21-note-e5-refresh.md`.

## Décision
Déployer les outils par une connexion SSH à commande forcée vers un seul
script de la plateforme, qui ne lance que des images désignées par
empreinte et signées avec la clé des outils, dans un modèle Compose fixé
par la plateforme, derrière un Caddy générique.
- **Accès** : clé dédiée du moteur, acceptée seulement depuis la VM du
  moteur, sur un compte hors du groupe `docker`, avec `restrict` et un
  `sudo -n` forcé vers un seul script sans arguments (la requête arrive
  dans `SSH_ORIGINAL_COMMAND`). Le moteur vérifie strictement les clés
  d'hôte des cibles ; la clé et les clés d'hôte sont chiffrées au repos sur
  la VM du moteur.
- **Script** (le même sur chaque cible) : `deploy`, `stop`, `remove`,
  `served` ; ligne découpée sans shell, chaque argument comparé à un motif
  strict avant toute action ; image seulement sous la forme
  `<configured registry>/eupadev/<tool>@sha256:<64 hex>` ; un `flock`
  par (environnement, outil) ; état lu dans les labels Docker, pas de
  fichier d'état ; `stop` et `remove` ne touchent qu'à ce que le cycle
  appelant a déployé. Code de sortie 2 = refus (jamais réessayé par le
  moteur), 255 = échec SSH (nouvel essai borné, sans danger car chaque
  commande converge).
- **Signature et pull** : cosign vérifié avec la **clé des outils**
  (distincte de la clé de la plateforme) avant le pull. La cible lit le
  registre avec un jeton durable en lecture seule qui lui est propre,
  chiffré au repos et déchiffré pour un seul appel.
- **Modèle Compose** : jamais le Compose ni le Dockerfile de l'outil. Non
  root, système de fichiers racine en lecture seule, aucune capability,
  `no-new-privileges`, limites de mémoire, de CPU et de processus, aucun
  port publié, aucun volume de l'hôte, un réseau interne par outil sans
  l'adresse du pont. La sortie, quand un outil a besoin du fournisseur
  d'identité, passe seulement par un Smokescreen par VM qui autorise cet
  hôte. Un outil du socle reçoit sa base sur le PostgreSQL de la VM, créée
  par le script, et sa migration tourne d'abord comme service ponctuel de
  la même image.
- **Routage** : un bloc Caddy générique par VM (`*.preview.<domain>` →
  `preview-<tool>`, `*.<domain>` → `prod-<tool>`), aucun fichier écrit par
  le script, aucun rechargement, API d'administration coupée ; le bloc des
  Previews retire `Domain` de chaque `Set-Cookie` (ADR-015).
- **Emplacements** : maquette et Previews sur la VM de CI, Prod sur une VM
  d'outils dédiée.
- **Preview** : simple remplacement ; un quota par VM, refus au-delà avec la
  raison ; pas de durée de vie automatique, le cycle de l'outil la retire.
- **Prod** : la nouvelle version démarre à côté de l'ancienne et ne reçoit
  le trafic qu'une fois saine ; en cas d'échec, l'ancienne n'a jamais cessé
  de servir et la réponse est l'empreinte tentée avec `failure`. Retour
  arrière = redéployer l'empreinte précédente (encore locale, ou dans le
  registre). Aucune copie arrêtée conservée, aucune preuve de charge sans
  erreur.
- **Réponse** : `health: ok` ⇒ `digest` est l'empreinte réellement servie
  (RepoDigests de l'image qui tourne) ; `failure` ⇒ celle qui a été tentée.
- **Maquette** (amende ADR-009) : fichiers statiques du dossier `web/`
  seulement, pas d'alias par cycle ; le moteur envoie par courriel le lien
  par empreinte à chaque maquette.

## Alternatives écartées
- Kamal, Coolify — root ou socket Docker sur la cible.
- Komodo, Portainer — un agent avec accès à Docker sur chaque cible.
- Modèle pull (Argo CD, Flux, doco-cd) — un agent root par cible ; doco-cd
  reste le repli pour un client sans connexion entrante.
- Lancer le Compose de l'outil — un agent pourrait demander `privileged`, la
  socket Docker ou un port.
- Un fichier Caddy par outil et un rechargement — une configuration produite
  à partir d'arguments, pour le même résultat.
- Un jeton de registre jetable par passage d'Ansible sur la cible — les
  déploiements ont lieu à tout moment, en dehors d'Ansible.
- Un conteneur de Prod arrêté conservé, un drainage de 30 s, un test de
  charge sans erreur — redéployer l'empreinte précédente donne le même
  retour arrière avec moins de code ; quelques secondes de chevauchement
  sont acceptables pour des outils internes.
- Un alias de maquette par cycle — le moteur envoie déjà un lien neuf.
- Le champ `served` — W1 enregistre une nouvelle Prod malade comme un simple
  échec.

## Conséquences
- Un moteur compromis peut déployer, arrêter ou retirer des images signées
  par la CI des outils, rien d'autre : aucun autre registre, aucun shell,
  aucun Docker, aucun environnement d'une autre VM.
- Une image hostile tourne en non root, sans capabilities, sans droit
  d'écriture ni sortie (sauf vers le fournisseur d'identité par Smokescreen
  pour les outils du socle), plafonnée et isolée des autres Previews.
- Une VM de plus, et un DNS et des certificats wildcard chez le client.
- Limite : sans domaine de Preview séparé, une Preview reste same-site avec
  la forge (ADR-015).
- Limite : clés SSH fixes, régénérées par l'installation ; pas de
  certificats SSH à courte durée de vie.
- Limite : une Preview oubliée occupe une place du quota jusqu'à son
  retrait.
- Limite : pendant une bascule de Prod, l'ancienne et la nouvelle version
  répondent toutes deux pendant quelques secondes ; les migrations doivent
  être expand/contract.

## Vérification
- `verify-deployer-access.yml` : shell, injection, autre environnement, nom
  réservé ou long, étiquette ou registre étranger, redirection
  (forwarding), scp et sftp refusés ; clé refusée depuis une autre VM ; une
  seule règle sudo ; entrées journald.
- `verify-deployer.yml` : images non signées, signées par une autre clé ou
  par la clé de la plateforme refusées sans que rien ne démarre ; modèle
  appliqué (uid, lecture seule, aucune capability, aucun port, aucun montage
  de l'hôte, aucune sortie) ; la même empreinte deux fois ne touche à rien ;
  un autre cycle n'a aucun effet ; `Domain` retiré ; un script tué puis
  rejoué converge ; retrait complet ; les mêmes appels faits par le
  `SshDeployer` du moteur depuis l'image du moteur.
- Tests unitaires du script (`test_deployer.py`) et de `SshDeployer`, avec
  mutations (empreinte servie, refus non réessayé, clés d'hôte strictes).
- Un test de bascule de Prod vérifiera qu'une image malade laisse
  l'ancienne servir et qu'une empreinte précédente se redéploie sans
  téléchargement ; un test du socle vérifiera la création de la base,
  l'échec de migration et le refus de sortie.
- Non vérifiable mécaniquement : la complétude du modèle Compose face à une
  nouvelle option de Docker (relecture).
