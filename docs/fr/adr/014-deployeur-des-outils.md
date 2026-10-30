---
adr: 014
title: Déployeur des outils, SSH à commande forcée vers un modèle Compose de la plateforme
status: remplacé par ADR-022
date: 2026-10-14
decision-makers: Ilan
supersedes:
related: [ADR-005, ADR-009]
controle: prévu
---
## Contexte
Le moteur de EupaDev déploie chaque outil généré à trois endroits : la
maquette de cadrage (ADR-009), une Preview que le demandeur juge, puis la
Prod. L'image d'un outil contient du code écrit par des agents, non fiable
par principe ; le moteur, lui, est la pièce la plus exposée de la plateforme.
Il faut donc qu'un moteur compromis ne puisse ni lancer une image d'ailleurs,
ni obtenir Docker ou un shell sur une cible, et qu'une image hostile soit
enfermée. Il n'y a pas de Kubernetes : des VM fournies par la DSI (ADR-001).
Faits relevés le 2026-10-14 : sur une VM sans Kubernetes, Kamal et Coolify
poussent par SSH, mais en root ou avec le groupe `docker`, et la doc Docker
rappelle que l'accès au socket vaut root ; OpenSSH (sshd(8)) permet, par clé,
une commande forcée (`command=`, la demande du client arrive dans
`SSH_ORIGINAL_COMMAND`), une adresse source imposée (`from=`) et `restrict`
(ni redirection, ni terminal) ; Docker Content Trust est retiré, rien ne
vérifie une signature hors Kubernetes sauf un appel explicite à cosign ;
l'autorité interne de Caddy délivre un certificat générique et Caddy accepte
un espace réservé (`{labels.N}`) dans l'adresse amont, évalué à chaque
requête (essai local de Caddy 2.11.6). Les plateformes de Previews (Vercel,
Netlify, GitHub Pages) servent le contenu non fiable sous un domaine séparé
inscrit sur la Public Suffix List : sinon une Preview peut poser des cookies
sur le domaine parent, que `SameSite` ne bloque pas. Sources :
`docs/reflexions/2026-10-14-note-e5-deployeur.md` (état de l'art, sources),
`ROADMAP.md` §8.16 (décision M3 du 2026-10-13).

## Décision
Déployer les outils par une connexion SSH à commande forcée vers un script
de la plateforme, qui ne lance que des images signées par empreinte, dans un
modèle Compose fixé par la plateforme, derrière un Caddy générique.
- **Accès** : clé SSH dédiée du moteur, acceptée seulement depuis la VM du
  moteur, sur un compte hors du groupe `docker`, avec `restrict` et une
  commande forcée `sudo -n` vers un seul script ; une seule règle sudo, ce
  script sans argument (la demande passe par `SSH_ORIGINAL_COMMAND`).
  Fichiers de clés à root. Le moteur lui-même reste déployé par Ansible.
- **Script** (code de EupaDev, le même sur chaque cible) : commandes
  `deployer`, `arreter`, `retirer`, `servi` ; ligne découpée sans shell,
  chaque argument validé par un motif strict avant toute action ;
  environnements limités à ceux de la VM ; nom d'outil borné (40 caractères)
  et hors des noms réservés de la plateforme ; image acceptée seulement en
  `<registre de la configuration>/eupadev/<outil>@sha256:<64 hex>` (le
  registre n'est jamais un argument). Chaque appel écrit dans `journald`.
  Verrou `flock` par (environnement, outil), état lu dans Docker (étiquettes),
  aucun fichier d'état : chaque commande est rejouable. `arreter` et `retirer`
  ne touchent que ce que le cycle demandeur a déployé.
- **Signature** : cosign vérifié par le script avant le téléchargement, avec
  une **clé propre aux outils**, distincte de celle des images de la
  plateforme (moteur, agents).
- **Modèle Compose de la plateforme** : la cible ne lit jamais le Compose ni
  le Dockerfile de l'outil. Elle lance l'image dans un modèle fixe : non-root,
  système de fichiers en lecture seule, aucune capacité, `no-new-privileges`,
  plafonds de mémoire, de CPU et de processus, aucun port publié ni volume de
  l'hôte, réseau interne sans sortie, un réseau par Preview.
- **Routage** : un seul bloc Caddy générique par VM, `*.preview.<domaine>`
  vers le conteneur `preview-<outil>` et `*.<domaine>` vers `prod-<outil>`,
  le nom venant de l'hôte demandé ; un certificat générique par bloc ; aucun
  fichier Caddy écrit par le script, aucun rechargement, API d'administration
  coupée.
- **Emplacements** : maquette et Previews sur la VM CI, Prod sur une VM
  « outils » dédiée, jamais à côté des Previews ni du code des agents. Au
  labo, cette VM a 2 vCPU et 2 à 3 Gio.
- **Prod sans coupure**, à la manière de Kamal : la nouvelle version démarre à
  côté, ne reçoit le trafic qu'une fois saine, puis l'ancienne est vidée et
  arrêtée ; si la nouvelle échoue, l'ancienne n'a jamais cessé de servir. La
  version précédente reste arrêtée sur place pour un retour arrière. Preview :
  remplacement simple.
- **Champ `servie`** : sur un échec, la réponse donne l'empreinte tentée et,
  à part, celle qui répond encore ; « sain » veut dire que l'empreinte rendue
  est celle servie.
- **Previews** : pas de durée de vie automatique ; un quota de Previews par
  VM, refus au-delà avec la raison. Le cycle de l'outil décide de leur retrait.
- **Domaine des Previews** : cookies de session en préfixe `__Host-`
  obligatoires dans le template des outils ; un domaine séparé pour les
  Previews et la maquette est recommandé, pas exigé, dans la fiche de
  prérequis du client.

## Alternatives écartées
- Kamal, Coolify — accès root ou socket Docker sur la cible.
- Komodo, Portainer — un agent avec l'accès Docker sur chaque cible.
- Dokploy — partie propriétaire. Watchtower — archivé, suit des étiquettes.
- Modèle « pull » (Argo CD, Flux, doco-cd) — un agent root par cible, et
  l'écriture dans le dépôt de déploiement devient le droit de déployer ;
  doco-cd reste la réserve d'un client sans connexion entrante.
- Lancer le Compose de l'outil — un agent pourrait demander `privileged`, le
  socket Docker ou un port.
- Un fichier Caddy par outil puis rechargement — de la configuration produite
  à partir d'arguments, pour le même résultat.
- Prod sur la VM CI — un même noyau pour du code non approuvé et la Prod.
- Durée de vie des Previews — le cycle pilote déjà leur vie ; le quota borne
  la place.
- Domaine séparé exigé — tous les clients ne peuvent pas l'obtenir.
- Une seule clé de signature — une CI qui construit du code d'agent pourrait
  signer une image de moteur.

## Conséquences
- Un moteur compromis peut déployer, arrêter ou retirer des images signées
  par la CI des outils, rien d'autre : ni autre registre, ni shell, ni Docker,
  ni environnement d'une autre VM.
- Une image hostile tourne non-root, sans capacités, sans écriture ni sortie
  réseau, plafonnée, isolée des autres Previews ; sur la VM CI, déjà zone du
  code non approuvé.
- Une VM de plus au labo et chez le client ; DNS et certificat génériques
  internes nécessaires (`*.preview.<domaine>`, `*.<domaine>`).
- **Limite** : sans domaine séparé, une Preview reste *same-site* avec la
  forge et la Prod ; `__Host-` protège les cookies des outils, pas ceux de
  Gitea, qui reste exposé : à dire au client.
- **Limite** : aucune connexion devant les Previews avant l'arrivée du
  fournisseur d'identité ; elles ne sont joignables que du réseau interne.
- **Limite** : clé SSH fixe, régénérée par l'installation ; pas de
  certificats SSH à durée limitée.
- Une Preview oubliée occupe une place du quota jusqu'à la décision de l'admin.
- Le contrat `Deployeur` du moteur gagne le champ `servie`.

## Vérification
- Un test réel `verify-deployeur-acces.yml` prouvera, avec la clé du moteur,
  que shell, injection, chemin, environnement d'une autre VM, nom réservé ou
  trop long, image par étiquette ou d'un autre registre, redirections, scp et
  sftp sont refusés, que la même clé est refusée depuis une autre VM, que le
  compte est hors du groupe `docker` avec une seule règle sudo, et que chaque
  appel est dans `journald` ; des tests unitaires du script rejoueront la
  validation des entrées.
- Un test réel du déploiement refusera une image non signée, signée par une
  autre clé ou par la clé de la plateforme ; vérifiera le modèle (non-root,
  lecture seule, sans capacités, sans sortie réseau), l'idempotence, le quota,
  la reprise après l'arrêt brutal du script, `retirer` sans effet sur un autre
  cycle, et que `servi` lit l'empreinte réelle.
- Un test réel de bascule enverra des requêtes continues pendant un
  déploiement de Prod (aucune réponse en erreur attendue) et une version
  malade (l'ancienne sert toujours, `servie` renseigné).
- Les tests du template refuseront un cookie de session sans `__Host-`.
- Non vérifiable mécaniquement : le domaine séparé chez le client, et la
  complétude du modèle Compose face à une nouvelle option de Docker
  (relecture).
