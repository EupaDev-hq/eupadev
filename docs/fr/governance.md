> Traduction destinée aux lecteurs humains. La version anglaise `docs/governance.md` fait foi.

# Gouvernance de EupaDev (v2)

Qui décide quoi, et quand, autour d'un outil fabriqué par l'usine. C'est un
point de départ : chaque organisation qui installe EupaDev adapte les rôles,
les seuils et les délais à ses propres règles (dernière section). Ce que le
code impose dans tous les cas est dans `docs/fr/architecture.md`.

Statut : les gates, garde-fous et tables ci-dessous sont conçus (`ROADMAP.md`
§8.3 à §8.8, §8.15). L'orchestrateur qui les porte existe en code et en tests
(gates, garde-fous, budget) mais ne tourne pas encore en service ; le tableau
de bord n'est pas encore construit. Les droits des comptes robots sont
construits et testés.

## Rôles humains

| Rôle | Qui | Décide |
|---|---|---|
| Demandeur | N'importe quel collaborateur, développeur ou non. Parle à l'agent de cadrage, essaie la maquette et la Preview. | Le périmètre ; si la Preview répond au besoin. Ne touche jamais au code. |
| Référent métier | Une personne désignée par le métier dans l'organisation. | Gate 1 et Gate 2. |
| DSI | La direction informatique de l'organisation. | Prévenue ; **veto** sur les outils sensibles et sur les outils à profil d'exploitation renforcé. |
| Administrateur / propriétaire produit | La personne ou l'équipe qui exploite la plateforme. | Chevauchement avec un outil existant ; dépassements de budget ; décommissionnement. |
| Sécurité | Un référent sécurité quand l'organisation en a un ; sinon l'administrateur. | Lit les résultats des contrôles de Preview avant la Gate 2 ; peut opposer un veto à une empreinte. |

Un outil appartient à un service ou à un rôle, jamais à une personne nommée :
un outil qui appartient à une personne ne survit pas à son départ.

**Deux casquettes, lues dans le jeton de connexion** (ADR-017). Le moteur
connaît aujourd'hui deux casquettes, portées comme rôles du client Keycloak
`eupadev-api` et données par des groupes : `requester` et `admin`. Une
personne est désignée par le couple stable (émetteur, sujet) de son jeton,
jamais par son mail, simple attribut de contact. Ce que chaque casquette
peut faire :

| Action | Qui |
|---|---|
| Déposer une demande (création ou évolution) | `requester` ou `admin`, avec une adresse mail connue |
| Juger la maquette ou la Preview, abandonner, écrire dans le chat | le demandeur **de cet outil** (ou un `admin`) |
| Décider à une gate, annuler un cycle | `admin` |
| Approuver la Gate 2 | un `admin` qui n'est **pas** le demandeur de l'outil (quatre yeux) |

**Quatre yeux à la Gate 2** : la personne qui a demandé l'outil (ou sa
dernière évolution) ne peut pas approuver sa livraison ; le moteur le refuse,
la base le refuse encore. Seule exception : un sujet désigné dans la
configuration du moteur (`FOUR_EYES_EXEMPTION_SUBJECT`, vide par défaut ;
utilisée au labo, où une seule personne joue tous les rôles) ; chaque usage
est écrit dans `approvals.four_eyes_exemption`, à côté de la casquette
utilisée (`approvals.role`). Référent métier, DSI et sécurité ci-dessus ne
sont pas encore des casquettes : elles viendront par un nouvel ADR, pas par
une colonne libre.

## Gates

| Gate | Quand | Ce qui est approuvé | Montré à l'approbateur |
|---|---|---|---|
| Gate 1 | Après la première fusion dans `main`, avant que quoi que ce soit soit joignable hors du bac à sable. **Une fois par outil.** | Le nom de l'outil et son nom de domaine, et les contrôles ci-dessous. | Nom, demandeur, service propriétaire, résumé de la spécification. |
| Gate 2 | Après le passage des contrôles de Preview et l'acceptation de la Preview par le demandeur. **Une fois par release.** | **Une empreinte d'image précise**, jamais « l'outil ». | L'empreinte, les résultats des contrôles enregistrés contre elle, l'acceptation du demandeur. |

Contrôles à la Gate 1 :

- **Outil sensible ?** (RH, paie, données personnelles) : un outil sensible a
  sa propre VM.
- **L'outil utilise-t-il l'IA pour un usage RH ?** Si oui, il est à haut
  risque au sens de l'AI Act européen.
- **Dépendances envers d'autres outils** déclarées : un outil n'en appelle un
  autre que par son API HTTPS, derrière le reverse proxy, avec un contrat
  OpenAPI.
- **Profil d'exploitation** (standard / renforcé), réévalué à chaque Gate 1.
- **Durées de conservation** — question obligatoire, pour tout outil (chacun
  enregistre qui a agi) : une durée par catégorie de données personnelles, et
  une pour l'audit (5 ans proposés). Fixées par le client avec son délégué à
  la protection des données (DPO), écrites dans les décisions de l'outil.
  Sans réponse, la Gate 1 ne passe pas : aucune durée par défaut de la
  plateforme ne s'applique en silence.

Fonctionnement d'une gate : l'orchestrateur envoie un email pour prévenir, la
décision se prend sur une page du tableau de bord derrière une connexion OIDC
(aujourd'hui : l'API locale avec un jeton d'accès Keycloak), et elle est
écrite dans la table `approvals` avec l'acteur (identifiant interne, nom au
moment des faits), la casquette utilisée, l'empreinte et un commentaire. Aucune réponse à un email n'est jamais interprétée. Le workflow
attend durablement : un redémarrage pendant une attente d'une semaine ne perd
rien. Après 24 heures sans réponse, une relance est envoyée.

C'est l'approbation d'une empreinte en Gate 2 qui rend la chaîne fiable : ce qui
tourne en Production est bit pour bit ce qui a été contrôlé en Preview.

## Ce qu'aucun agent ne peut faire

- Fusionner dans `main`, publier une image, déployer, approuver une gate.
- Modifier ses propres règles, les prompts de rôle, les règles d'analyse ou la
  CI : refusé au moment du push par la forge.
- Écrire dans les dossiers d'un autre rôle, ou dans les tests d'acceptation
  quand il écrit du code : refusé à la fusion par l'orchestrateur.
- Affaiblir un test, une règle ou une étape de CI pour la faire passer ;
  modifier un test pour qu'il passe.
- Ouvrir une nouvelle destination réseau, exécuter un fichier téléchargé,
  stocker un secret.
- Décider des itérations ou du budget : il rend `done`, `blocked` ou
  `failed` ; l'orchestrateur décide de la suite.
- S'accorder une exception (`nosemgrep`, test sauté, fichier d'exception d'un
  scanner…) : la CI plafonne chaque marque d'exception par le registre daté
  `.gitea/exceptions.txt`.

L'orchestrateur non plus : il ne modifie jamais `.gitea/` ni un fichier
d'exception (refusé par la forge sur toutes les branches), et il se retire le
droit d'administration de chaque outil juste après l'avoir généré.

## Exceptions validées par un humain

Un vrai faux positif (ou une CVE acceptée pour un temps) bloque l'agent et
remonte à la gate. Si l'humain l'accepte, il pousse une branche `exception/**`
(seuls l'humain désigné et l'admin de secours le peuvent) avec une ligne datée
dans `.gitea/exceptions.txt` (ou `.trivyignore.yaml`, 30 jours au plus), ouvre
la PR et la fusionne lui-même : lui seul peut faire entrer dans `main` une
modification d'un fichier protégé. La ligne expire d'elle-même (un an au plus) ;
le journal d'audit de la forge trace la fusion. Note de conception :
`docs/reflexions/2026-10-13-note-exceptions.md`.

## Budget et garde-fous

| Garde-fou | Règle | Note |
|---|---|---|
| Plafond d'itérations | Un nombre maximal de tours code / review par outil (de l'ordre de 10 à 15 en Durcissement, moins en Cadrage). | Atteint : l'outil s'arrête, l'administrateur est alerté. |
| Stagnation | Le même écart signalé sur plusieurs tours consécutifs. | Traité comme le plafond. |
| Timeout | Une durée maximale par outil (de l'ordre de 1 à 2 heures de travail d'agent). | L'attente d'un humain ne compte pas. |
| Budget par outil | Un plafond de coût, comparé à la **somme des coûts réels** enregistrés par tâche dans la table `tasks`, jamais à un compteur à part. | Dépassement : escalade humaine, jamais un arrêt silencieux. |
| Concurrence | Au plus N agents en même temps sur la plateforme, et 3 pour un même outil. | N est une configuration, mesurée sur la vraie machine. |
| Budget par tâche | Le moteur reçoit lui-même un plafond de coût pour la tâche. | Option native du moteur. |

**Décision ouverte : comment cadrer le budget quand le périmètre gonfle.**
L'expérience v1 a montré que le plafond par outil est atteint non pas à cause
d'une étape coûteuse, mais parce que le demandeur ajoute une story après
l'autre, chacune plus chère que la précédente, et que l'administrateur est
alerté tard, sur un outil déjà avancé. Le problème est le périmètre qui gonfle,
pas l'argent. Pistes à l'étude, à trancher en construisant l'orchestrateur :

1. Un prix annoncé avant chaque story (petite / moyenne / grande, calibré sur
   les coûts réels enregistrés), avec le total en cours affiché dans le chat.
2. Un plafond de stories par version (par exemple cinq pour la première) ; le
   reste va dans une liste « version suivante » qui repasse par le cycle.
3. Des alertes graduées : demandeur à 50 % et 80 %, administrateur à 100 % avec
   le coût par story.
4. Un choix d'organisation : afficher le coût au demandeur, ou le facturer à
   son service.

## Après la Production

- **Évolutions et corrections** repassent par le cycle complet : cadrage si le
  besoin change, sinon contrat, durcissement, review, fusion, Preview, Gate 2.
- **Retour arrière** : une décision de l'administrateur ; redéployer
  l'empreinte de la release précédente, sans reconstruction, sans agent.
- **Décommissionnement.** Le registre enregistre le dernier accès réel de
  chaque outil (d'après les logs du reverse proxy, pas la date de création).
  Sans accès pendant plusieurs semaines : relances graduées au service
  propriétaire, puis notification officielle, puis mise en quarantaine douce.
  Tout accès réel remet le compteur à zéro. Les délais sont des paramètres de
  l'installation.

## Erreurs connues

Un problème rencontré lors d'un vrai passage n'est conservé que sous forme
générique : symptôme, cause racine, règle ajoutée aux règles de domaine des
agents, et contrôle automatique (CI, règle d'analyse, protection de branche) qui
l'attrape désormais quand c'est possible. La plateforme n'accumule pas
d'anecdotes : une règle vérifiable mécaniquement devient un contrôle, le reste
reste court.

## Propriété intellectuelle et données client

- Le code d'un outil généré vit dans la forge de l'organisation. Rien à son
  sujet (code, données, conversations, coûts) n'est envoyé aux auteurs de
  EupaDev.
- **Chaque installation garde sa propre mémoire** : ses outils, ses décisions,
  ses erreurs connues, ses données de calibration. Seules des règles
  génériques, sans trace de l'organisation, peuvent être reversées au moteur
  commun.
- Le moteur d'agent est installé et licencié par l'organisation (sa propre clé
  d'API de modèle) ; EupaDev ne livre ni moteur ni modèle.
- **Conditions de Claude Code.** L'organisation installe Claude Code, accepte
  les conditions commerciales d'Anthropic et s'authentifie avec son propre
  identifiant (clé d'API Anthropic, ou son propre compte Amazon Bedrock /
  Google Vertex AI). Le binaire est utilisé sans modification. Les auteurs de
  EupaDev ne paient, ne revendent ni n'intermédient jamais l'usage du
  modèle pour le compte de l'organisation
  (code.claude.com/docs/en/legal-and-compliance, lu le 2026-10-16).
- **Où vont les données de fabrication.** EupaDev est souverain sur
  l'*exécution* des outils (ils tournent sur les serveurs de l'organisation),
  pas sur leur *fabrication* : la demande, la spécification et le code écrit
  par les agents sont envoyés au fournisseur du modèle. Avec l'API directe
  d'Anthropic, le traitement peut avoir lieu hors de l'UE et les données sont
  stockées aux États-Unis, conservées 30 jours par défaut (zéro rétention sur
  demande), jamais utilisées pour l'entraînement sous conditions
  commerciales. Une organisation qui exige un traitement dans l'UE utilise
  Claude via Amazon Bedrock (profils d'inférence UE) ou Google Vertex AI
  (région UE), tous deux pris en charge par Claude Code ; le fournisseur cloud
  est alors le sous-traitant des données (platform.claude.com, pages
  « data residency » et « data retention », lues le 2026-10-16).
- La plateforme n'embarque aucun composant sous une licence qui interdit la
  redistribution dans un produit (AGPL, SSPL, BSL) ; un outil lancé en ligne de
  commande dans la CI est acceptable, l'embarquer ne l'est pas.
- Les secrets n'apparaissent jamais dans le code, les logs, les commits ou les
  rapports ; la CI bloque un push qui en contient un.

## À adapter par organisation

| Élément | Défaut | Où |
|---|---|---|
| Qui tient la Gate 1 et la Gate 2 | la casquette `admin` (groupe du client Keycloak `eupadev-api`) ; quatre yeux à la Gate 2 | groupes Keycloak ; `FOUR_EYES_EXEMPTION_SUBJECT` (labo seulement) |
| Budget par outil, plafond d'itérations, timeout | voir ci-dessus | configuration de l'orchestrateur |
| Concurrence N | 1 | variable d'environnement |
| Délais de décommissionnement | plusieurs semaines, gradués | configuration de l'orchestrateur |
| Fournisseur d'identité | Keycloak (utilisateurs en comptes propres, LDAP/AD ou tout fournisseur OIDC/SAML) | configuration, sans changement de code |
| Moteur d'agent | Claude Code | configuration du lanceur ; un second moteur est branché à la demande |
| Domaines de Preview et de Production | `<outil>.<domaine>` | variables d'organisation de la forge |
| Délai de relance d'une gate en attente | 24 heures | configuration de l'orchestrateur |

L'agent de cadrage peut enregistrer, par outil, une exception à un défaut de la
plateforme (par exemple des comptes locaux à la place d'OIDC) dans le
`docs/DECISIONS.md` de cet outil ; l'exception est visible de l'approbateur à
la Gate 1.
