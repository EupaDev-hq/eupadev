> Traduction destinée aux lecteurs humains. La version anglaise `docs/client-prerequisites.md` fait foi.

# Prérequis d'installation de EupaDev (pour la DSI du client)

Ce que votre DSI fournit avant l'installation de EupaDev, qui fait quoi
ensuite, et ce qui sort de votre réseau. Écrit pour une petite DSI plutôt
Microsoft : aucune connaissance de Linux ou de Docker n'est nécessaire pour y
répondre. Décisions à l'origine de cette page : `ROADMAP.md` §8.15
(« Installation at the client »).

**Statut de cette page.** EupaDev est en construction. Chaque point porte
un statut :

- **En place** : construit, et prouvé par un test réel sur les VM du labo
  (`infra/ansible/verify-*.yml`). Le labo tourne sur des VM KVM (LXD).
- **Prévu** : décidé, pas encore construit. Ce n'est pas un engagement tant
  que ce n'est pas marqué en place.
- **Ouvert** : pas encore décidé ou pas vérifié ; à régler avec vous.

Les tailles sont des estimations, **à confirmer par mesure** lors des
premières exécutions réelles.

## En cinq lignes

1. Vous fournissez **4 VM Ubuntu 24.04 vierges** sur votre propre hyperviseur,
   avec notre clé SSH publique. Nous n'accédons jamais à l'hyperviseur.
2. Nous installons et exploitons tout **dans** les VM, à distance, via votre
   VPN ou votre bastion, avec des recettes automatisées (Ansible).
3. Vos utilisateurs accèdent à EupaDev en HTTPS (port 443) sur votre réseau
   interne. Rien n'est publié sur Internet.
4. Le seul flux qui emporte du contenu métier à l'extérieur est l'appel à
   l'**API du fournisseur d'IA** (Anthropic), avec une clé à **votre** nom.
   Aucune donnée de production ne lui est jamais envoyée.
5. La sauvegarde a deux étages : vous sauvegardez les VM entières, EupaDev
   sauvegarde ses propres données. Tout se reconstruit à partir des recettes
   et des sauvegardes.

## Qui fait quoi

| Sous les VM : **votre DSI** | Dans les VM : **l'exploitant EupaDev** |
|---|---|
| Hyperviseur, stockage, création et redimensionnement des VM | Configuration du système, mises à jour de sécurité, redémarrages |
| Réseau, VLAN, pare-feu entre zones, proxy | Pare-feu local de chaque VM |
| Enregistrements DNS, NTP, autorité de certification interne | EupaDev, les outils générés, leurs bases |
| Annuaire (Active Directory / Entra ID) | Service d'identité (Keycloak) relié à votre annuaire |
| Sauvegarde des VM entières (étage 1) | Sauvegardes applicatives et tests de restauration (étage 2) |
| VPN ou bastion, et l'accès de l'exploitant | Surveillance et alertes des services |
| Approbation des outils sensibles (veto) | Traitement des incidents, reconstruction |

Au départ, la plateforme est **exploitée par l'exploitant EupaDev**
(décision n°2). Aucun agent logiciel n'est installé sur votre hyperviseur ni
ailleurs dans votre réseau.

## 1. Les machines virtuelles

| VM | Rôle | vCPU | RAM | Disques (système + données) |
|---|---|---|---|---|
| Plateforme | Forge Git et registre d'images, orchestrateur, identité (Keycloak), reverse proxy (Caddy), surveillance | 4 | 14 Go | 40 + 200 Go |
| CI | Contrôles automatiques du code et Previews (code pas encore validé) | 4 | 8 Go | 40 + 100 Go |
| Outils jeunes | Nouveaux outils pendant leurs 4 semaines de quarantaine, avec leur base | 2-4 | 8 Go | 40 + 100 Go |
| Outils matures | Outils stables, avec leur base | 4 | 12-16 Go | 40 + 150 Go |
| **Total** | | **14-16** | **42-46 Go** | **≈ 700 Go** |

Tous les chiffres sont **à confirmer par mesure**. Pour comparaison, le labo
tourne aujourd'hui sur 5 petites VM (forge, CI, orchestrateur, agents IA, et
une VM outils pour la Prod des outils générés) ; le découpage en 4 VM ci-dessus est **prévu**. Un outil qui traite des données
sensibles (RH, paie, données personnelles) peut demander une **cinquième VM
dédiée**, décidée à l'approbation de l'outil (Gate 1).

**Contrat d'installation, par VM** (le même pour tous les hyperviseurs) :

- Ubuntu Server **24.04 LTS**, installé depuis l'**ISO officielle**, rien
  d'autre (ni Docker, ni paquet supplémentaire : les recettes installent ce
  qu'il faut).
- Serveur OpenSSH activé ; **notre clé SSH publique** (fournie, dédiée à votre
  installation) déposée sur un compte nommé `ansible` qui a les droits `sudo`
  **sans mot de passe** (les recettes en ont besoin ; commandes en annexe).
- Une adresse IP fixe (statique ou réservation DHCP), vos serveurs DNS et
  votre serveur NTP configurés.
- **Deux disques** : un pour le système, un pour les données. Le disque de
  données porte les conteneurs, les bases et les sauvegardes locales
  (`/var/lib/docker`). Le provisionnement fin convient ; le disque de données
  doit pouvoir être agrandi sans réinstallation. Merci de ne pas laisser un
  instantané (snapshot) d'hyperviseur en place plus de 72 heures (les
  instantanés longs dégradent les performances).
- Si vous installez un agent de sécurité (antivirus, EDR) sur les serveurs
  Linux, dites-nous lequel avant l'installation.

**Hyperviseurs.** VMware vSphere, Microsoft Hyper-V et Proxmox VE sont
acceptés. Seul KVM a été testé à ce jour (labo) ; un **test Hyper-V est
prévu**. Sur Hyper-V, une VM de génération 2 avec le démarrage sécurisé réglé
sur le modèle « Microsoft UEFI Certificate Authority » devrait être
nécessaire (**à vérifier**).

**cloud-init est facultatif.** Si vous préférez déployer à partir d'une image
cloud Ubuntu (OVA, VHDX, qcow2), nous pouvons fournir un fichier cloud-init
qui crée le compte et dépose la clé. L'installation depuis l'ISO reste la
référence.

**Statut :** la configuration des VM par les recettes (pare-feu, SSH, fichier
d'échange, mises à jour de sécurité automatiques, Docker sur le disque de
données) est **en place** au labo. La détection du disque de données sur
VMware et Hyper-V est **prévue** (la recette ne connaît aujourd'hui que le
nom du disque du labo).

## 2. Réseau

**Une seule question sur le réseau de l'hyperviseur :** voulez-vous un VLAN
dédié (ou un port group / commutateur virtuel) pour les 4 VM ? Tout le reste
est dans la matrice des flux ci-dessous.

**DNS.** Des enregistrements génériques (ADR-014, ADR-015 ; en place au
labo) :

| Nom | Pointe vers |
|---|---|
| `*.<domaine>` | VM outils (Prod des outils générés, un nom par outil, approuvé à la Gate 1) |
| `*.<domaine des Previews>` et `mockup.<domaine des Previews>` | VM CI (Previews et maquettes de cadrage) |
| `git.<domaine>` | La forge (VM Plateforme) |
| `auth.<domaine>` | Connexion, Keycloak (VM Plateforme) |
| `chat.<domaine>` | La page des demandeurs (VM Plateforme) |

**Domaine des Previews : à choisir dans cet ordre (ADR-015).** Les Previews
et la maquette font tourner du code qu'aucun humain n'a encore approuvé. Le
navigateur range les cookies par domaine, pas par machine : sous votre
domaine principal, une Preview pourrait poser un cookie valable pour lui et
toutes vos applications (forge, intranet, connexion d'entreprise), et
`SameSite` ne l'empêche pas. C'est pourquoi GitHub, Vercel et Netlify servent
ce contenu sous un domaine à part.

1. **Un domaine séparé, acheté pour l'occasion** (choix par défaut) : par
   exemple `preview-outils.fr`, quelques euros par an. Certificats publics
   automatiques (Let's Encrypt, validés par le DNS : il nous faut un accès à
   l'API de votre hébergeur DNS, aucun accès entrant depuis Internet). Rien
   à installer sur les postes. C'est le plus simple sans service
   informatique.
2. **Un nom en `.internal`** (par exemple `outils.internal`), réservé par
   l'ICANN à l'usage privé : rien à acheter, mais il faut un DNS interne et
   une autorité de certification interne installée sur les postes (souvent
   déjà là avec Active Directory). Pour une DSI qui ne peut pas acheter de
   domaine.
3. **Un sous-domaine de votre domaine principal** (`preview.<domaine>`),
   en dernier recours : les outils générés restent protégés (cookies en
   préfixe `__Host-` imposé, attribut `Domain` retiré des cookies par la
   plateforme), mais du JavaScript d'une Preview peut encore poser un cookie
   sur votre domaine principal. Ce risque doit être accepté par écrit.

La Prod des outils reste sous votre domaine : son code a passé les
validations humaines. Sources : `docs/reflexions/2026-10-14-note-e5-deployeur.md`.

**Certificats HTTPS : ouvert.** Votre réseau est interne : des certificats
publics automatiques (Let's Encrypt) demanderaient un accès entrant depuis
Internet, que nous ne demandons pas. La réponse probable est un certificat de
votre autorité de certification interne (ou un certificat générique que vous
fournissez) ; la prise en charge d'un certificat fourni est **prévue**
(aujourd'hui, les recettes savent faire un certificat auto-fabriqué de labo
ou Let's Encrypt seulement).

**Proxy.** Tout le trafic sortant peut passer par votre proxy HTTP(S), y
compris un proxy qui **inspecte le TLS** : dans ce cas, fournissez-nous le
certificat de votre autorité interne pour que les VM et les conteneurs lui
fassent confiance. La prise en charge du proxy par les recettes (paquets
système, Docker, tâches de CI) est **prévue** ; la recette de vérification des
prérequis testera chaque domaine sortant **à travers votre proxy**.

### Matrice des flux

Les flux sortants sont donnés en **noms de domaine**, jamais en adresses IP.
Port 443 = HTTPS à travers votre proxy.

**Entrants et internes**

| # | Source | Destination | Port | Usage | Statut |
|---|---|---|---|---|---|
| 1 | Postes des utilisateurs | VM Plateforme | 443/TCP (80 redirige vers 443) | Interface web de la forge ; plus tard portail, chat, pages des gates, connexion | En place (forge) ; prévu (portail) |
| 2 | Postes des utilisateurs | VM Outils | 443/TCP | Utilisation des outils générés | Prévu ; acheminement (un point d'entrée unique ou un par VM) **ouvert** |
| 3 | Votre VPN ou bastion | Les 4 VM | 22/TCP | Administration par l'exploitant (Ansible par SSH) | En place (SSH par clé seulement) |
| 4 | VM CI | VM Plateforme | 443/TCP | Les runners de CI récupèrent le travail, tirent et publient les images | En place |
| 5 | VM Outils | VM Plateforme | 443/TCP | Récupération des images approuvées dans le registre de la forge ; appels entre outils | Prévu |
| 6 | VM Plateforme | Toutes les VM | 443/TCP | Contrôles de santé (Gatus) | Prévu |

**Sortants**

| # | Source | Destination (domaine) | Port | Usage | Statut |
|---|---|---|---|---|---|
| 7 | Toutes les VM | Vos serveurs DNS et NTP | 53, 123/UDP | Résolution de noms, heure | Obligatoire |
| 8 | Toutes les VM | `archive.ubuntu.com`, `security.ubuntu.com` (ou votre miroir Ubuntu) | 80/443 | Paquets système, mises à jour de sécurité quotidiennes ; Docker vient des paquets d'Ubuntu | En place |
| 9 | Toutes les VM | `registry-1.docker.io`, `auth.docker.io`, `production.cloudflare.docker.com` | 443 | Images de conteneurs publiques (PostgreSQL, Caddy, Gitea, runners de CI, scanner), toutes figées par empreinte | En place |
| 10 | VM CI | `ghcr.io`, `pkg-containers.githubusercontent.com`, `mirror.gcr.io` | 443 | Image du scanner de sécurité dynamique (contrôles de Preview) ; base des vulnérabilités du scanner (Trivy) | En place pour Trivy ; contrôles de Preview écrits, jamais exécutés ; domaines exacts **à confirmer** par la recette de vérification |
| 11 | VM CI | `github.com`, `objects.githubusercontent.com`, `release-assets.githubusercontent.com`, `proxy.golang.org`, `sum.golang.org`, `deb.debian.org` | 443 | Briques de CI figées et reconstruction hebdomadaire de l'image de base (outils de sécurité, paquets Debian) | En place |
| 12 | VM CI | `registry.npmjs.org` | 443 | Paquets JavaScript des outils et de l'image de base | En place |
| 13 | VM Plateforme (agents) | `api.anthropic.com` | 443 | Appels au modèle d'IA, clé à votre nom | Prévu |
| 14 | VM Plateforme | Votre annuaire : AD en LDAPS (636/TCP), ou Entra ID (`login.microsoftonline.com`, 443) | 636 / 443 | Connexion de vos utilisateurs via Keycloak | Prévu |
| 15 | VM Plateforme | Votre relais SMTP | 25 ou 587 | Notifications par e-mail (gates, alertes). Microsoft 365 : l'authentification SMTP simple est retirée (fin 2026, à confirmer auprès de Microsoft) — prévoir un relais par IP ou certificat, ou OAuth2 | Prévu, facultatif |
| 16 | Toutes les VM | Votre cible de sauvegarde (compatible S3, SFTP ou NFS) | 443 / 22 / 2049 | Copie des sauvegardes applicatives hors des VM | Prévu |
| 17 | VM Plateforme | Alertes de l'exploitant et sonde externe | 443 | Alertes vers l'exploitant ; contrôle de vie depuis l'extérieur | Prévu ; sens et domaine **ouverts** |

**Jamais exposé** (en place, sauf mention) :

- Rien n'est publié sur Internet ; aucun flux entrant depuis Internet n'est
  nécessaire.
- Le pare-feu de chaque VM refuse tout trafic entrant sauf SSH (22), plus
  HTTPS (80/443) sur la VM qui sert le trafic web.
- SSH : par clé seulement, sans mot de passe, sans connexion root.
- Les bases PostgreSQL ne publient aucun port ; le port interne de la forge
  n'écoute que sur la VM elle-même (`127.0.0.1`).
- L'accès Git se fait en HTTPS avec jeton seulement ; la forge n'a pas de
  serveur SSH.
- L'API Docker n'est jamais joignable depuis le réseau ; les tâches de CI qui
  exécutent du code écrit par des agents n'ont aucun accès à Docker.
- Le coffre des secrets (OpenBao, **prévu**) ne sera jamais exposé non plus.

## 3. Comptes et accès

**Accès de l'exploitant (administration à distance).**

- Par **votre VPN ou votre bastion**, **nominatif**, avec **MFA**, et
  **journalisé** de votre côté. Vous l'ouvrez et pouvez le couper à tout
  moment. Aligné sur le guide ANSSI PA-022 (administration sécurisée).
- Une clé SSH dédiée par client, conservée sur un poste d'administration
  dédié ; les VM n'acceptent que les clés (en place).
- Un inventaire et un coffre de secrets chiffré par client du côté de
  l'exploitant (en place au labo).

**Comptes sur les VM.**

- `ansible` : le compte d'administration décrit plus haut (en place).
- `diagnostic` : compte SSH en lecture seule, sans droits d'administration,
  pour lancer des recettes de diagnostic en lecture seule (**prévu**). Les
  corrections sont toujours appliquées par l'exploitant, jamais par ce compte.

**Votre annuaire.**

- Les utilisateurs se connectent via **Keycloak** (OIDC standard), relié à
  votre Active Directory (LDAPS, compte de service en lecture seule) ou à
  Entra ID (une inscription d'application) (**prévu**).
- Nous ne demandons **aucun compte à privilèges** dans votre annuaire : un
  compte de service en lecture seule (AD) ou une inscription d'application
  (Entra ID), et trois groupes que vous gérez : demandeurs, valideurs,
  administrateurs.
- Les approbations (gates) sont données par un **référent métier** ; votre DSI
  est prévenue et dispose d'un **veto** sur les outils sensibles ou au profil
  renforcé (décision n°12 ; les pages des gates sont **prévues**).

## 4. Sauvegarde, PRA, réversibilité

**Deux étages, écrits noir sur blanc.**

| Étage | Qui | Quoi | Statut |
|---|---|---|---|
| 1. VM entières | Votre DSI, avec votre outil habituel (Veeam, Hyper-V, Proxmox Backup Server…) | Les 4 VM | Votre périmètre ; utile quand tout est perdu |
| 2. Données applicatives | EupaDev | Forge (dépôts, registre, base) par `gitea dump`, base de l'orchestrateur par `pg_dump` ; chaque nuit à 02:30 UTC ; 7 conservées ; restauration réelle testée automatiquement | En place au labo, **stockées sur la VM seulement** |
| 2b. Copie hors des VM | EupaDev, vers une cible que vous fournissez (compatible S3, SFTP ou NFS) | Copie chiffrée de l'étage 2 (restic) | **Prévu** |
| 2c. Bases des outils | EupaDev | Une base par outil | **Prévu** |

Pourquoi deux étages : la sauvegarde « à chaud » d'une VM qui contient une
base n'est pas garantie cohérente ; la sauvegarde applicative l'est. Merci de
planifier vos sauvegardes de VM hors du créneau de 02:30 UTC (la forge
s'arrête alors une trentaine de secondes).

**PRA.** Reconstruire = des VM Ubuntu vierges neuves (section 1) + les
recettes Ansible + la restauration de la dernière sauvegarde applicative. La
procédure de restauration est documentée (`infra/README.md`) et la
restauration est testée à chaque fois dans des conteneurs jetables (en
place). Un exercice de reconstruction complète sans l'exploitant habituel est
**prévu**. Perte de données maximale : une journée (sauvegarde de nuit).
Durée de reprise : **pas encore mesurée**, aucun chiffre promis.

**Réversibilité.** Tout est reconstructible et dans des formats standard : le
code des outils est dans **votre** forge (Git ordinaire), leurs images dans
**votre** registre, les bases sont des exports PostgreSQL standard, et les
recettes sont open source (Apache 2.0). La remise du coffre de secrets propre
au client en fin de contrat est un point **ouvert** (il est indispensable
pour restaurer une sauvegarde).

## 5. Données et IA

- **La clé de l'IA est à votre nom.** Vous contractez directement avec le
  fournisseur d'IA (Anthropic) ; il est votre sous-traitant, l'exploitant
  n'est pas intermédiaire sur ce flux (décision n°11).
- **Ce qui est envoyé à l'IA :** la conversation de cadrage, le code des
  outils et des données de test fictives. **Aucune donnée de production n'est
  jamais envoyée à l'IA** (décision n°15 ; les contrôles qui l'imposent sont
  **prévus**).
- **Plafonds de dépense** par appel, par outil et par mois (**prévu**).
- **Contrat de sous-traitance :** un DPA (RGPD art. 28) est signé entre vous et
  l'exploitant, qui administre des VM contenant des données personnelles.
- **Diagnostic assisté par une IA** (facultatif) : recettes en lecture seule,
  données personnelles masquées, corrections appliquées par l'exploitant,
  seulement avec votre accord écrit dans le DPA ; pas proposé aux clients
  très sensibles (décision n°10, **prévu**).
- **Transparence :** le chat de cadrage indique aux utilisateurs qu'ils
  parlent à une IA (AI Act art. 50) ; la Gate 1 demande si un outil utilise
  l'IA pour un usage RH (haut risque) (**prévu**).
- **Ouvert : hébergement UE de l'API de l'IA.** Le traitement des données dans
  l'UE par l'API du fournisseur, et à quelles conditions, **n'a pas été
  vérifié** ; à contrôler à la source avant l'offre. La possibilité d'utiliser
  à la place un accès hébergé dans l'UE au même modèle **n'est pas vérifiée**
  non plus.

Cette section n'est pas un avis juridique.

## 6. Points ouverts

| Point | Responsable |
|---|---|
| Hébergement UE de l'API de l'IA, conditions de transfert du fournisseur | Exploitant, à la source, avant l'offre |
| Certificats HTTPS sur un réseau interne (AC interne, certificat générique fourni) | Exploitant + votre DSI |
| Accès des utilisateurs aux outils des VM Outils (point d'entrée unique ou un par VM) | Exploitant, conception |
| Proxy avec inspection TLS : prise en charge par les recettes, test à travers votre proxy | Exploitant (prévu) |
| Compatibilité Hyper-V et VMware (détection des disques, démarrage sécurisé) | Exploitant, test au labo |
| Sens de la sonde de surveillance externe (entrante ou sortante) | Exploitant + votre DSI |
| Remise du coffre de secrets pour la réversibilité | Contrat |
| Tailles des VM | Mesurées lors des premières exécutions réelles |

## 7. Checklist « prêt pour l'installation »

- [ ] 4 VM créées, tailles convenues (section 1), chacune avec un disque
      système et un disque de données.
- [ ] Ubuntu Server 24.04 LTS installé depuis l'ISO officielle, rien d'ajouté.
- [ ] Compte `ansible` avec `sudo` sans mot de passe et notre clé SSH publique
      (annexe).
- [ ] Adresses IP fixes, DNS et NTP configurés ; liste des IP envoyée à
      l'exploitant.
- [ ] VLAN / port group décidé.
- [ ] Domaine des Previews choisi (section 2, ADR-015) : domaine séparé,
      `.internal` ou sous-domaine avec le risque accepté par écrit ; noms DNS
      génériques créés.
- [ ] Choix du certificat fait (AC interne ou certificat générique fourni) ;
      certificat de l'AC interne envoyé si besoin.
- [ ] Adresse du proxy envoyée ; domaines sortants de la matrice autorisés ;
      certificat de l'AC interne envoyé si le proxy inspecte le TLS.
- [ ] Flux entrants 1 à 6 et flux internes ouverts entre les VM.
- [ ] Accès nominatif, protégé par MFA et journalisé, via votre VPN ou bastion,
      ouvert pour l'exploitant.
- [ ] Annuaire : compte de service en lecture seule (AD) ou inscription
      d'application (Entra ID) ; groupes demandeurs / valideurs /
      administrateurs créés.
- [ ] Référent métier des gates désigné ; veto de la DSI sur les outils
      sensibles convenu.
- [ ] Sauvegarde des VM (étage 1) planifiée hors de 02:30 UTC ; cible de
      sauvegarde de l'étage 2 fournie (quand elle sera disponible).
- [ ] Compte et clé du fournisseur d'IA à votre nom ; DPA signé avec
      l'exploitant.
- [ ] Agent de sécurité (EDR) sous Linux, s'il y en a un, annoncé.

La **recette de vérification des prérequis** (Ansible, **prévue**) contrôlera
ces points automatiquement et produira un rapport « OK / manquant » à joindre
au procès-verbal d'installation.

## Annexe : créer le compte `ansible`

Après l'installation depuis l'ISO, connecté sur la console de la VM avec le
compte créé pendant l'installation, une commande à la fois (remplacer le nom
du fichier par celui de la clé que nous vous envoyons, copiée au préalable sur la VM, par exemple
avec `scp` depuis un poste) :

```sh
sudo adduser --disabled-password --gecos "" ansible
echo "ansible ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/ansible
sudo chmod 440 /etc/sudoers.d/ansible
sudo install -d -m 700 -o ansible -g ansible /home/ansible/.ssh
sudo install -m 600 -o ansible -g ansible eupadev-client.pub /home/ansible/.ssh/authorized_keys
```

Les recettes désactivent ensuite la connexion SSH par mot de passe et la
connexion root.
