---
adr: 013
title: Moteur d'agent interchangeable derrière un contrat fixe, Claude Code d'abord, installé depuis son binaire signé
status: accepté
date: 2026-10-13
decision-makers: Ilan
supersedes: ADR-006
related: [ADR-001, ADR-005, ADR-007]
controle: partiel
---
## Contexte
Le lanceur d'agents fait travailler un agent de code autonome sur le dépôt
d'un outil (cadrer, coder, relire, corriger). Claude Code est aujourd'hui le
plus fiable pour ce travail mais n'exécute officiellement que des modèles
Claude ; certaines entreprises ont un autre fournisseur sous contrat ou
exigent un modèle hébergé chez elles. Tester toute la chaîne avec de vrais
agents coûte des appels d'IA à chaque essai. Claude Code est distribué sous
les conditions commerciales d'Anthropic, pas sous licence libre : EupaDev
(Apache 2.0) ne peut pas le redistribuer ; celui qui l'installe accepte ces
conditions. Le choix d'un modèle et d'un effort par rôle est une décision
distincte, qui utilise ce contrat sans en faire partie.

Anthropic publie Claude Code de deux façons : le paquet npm
`@anthropic-ai/claude-code`, et un binaire autonome par plateforme
(`downloads.claude.ai/claude-code-releases/<version>/`). Pour le binaire,
chaque version publie un `manifest.json` (sha256 de chaque binaire) signé par
la clé GPG de publication de Claude Code, dont l'empreinte figure dans la
documentation d'Anthropic (code.claude.com/docs/en/setup, « Binary integrity
and code signing »). La variante de construction des golden images n'a plus
npm : il faisait échouer l'analyse Trivy. Le binaire n'existe pour Linux
qu'en x86_64 et arm64, et ne dépend d'aucun gestionnaire de paquets.

## Décision
Faire appeler par le lanceur d'agents un moteur d'agent derrière un contrat
d'entrée/sortie fixe, avec Claude Code comme moteur n°1, installé depuis son
binaire signé.
- **Entrée** : dépôt, consigne, règles, plafond de budget, paramètres du
  lanceur transmis tels quels (modèle, effort) ; **sortie** : code modifié,
  rapport JSON commun, coût et tokens.
- **Claude Code jamais livré par EupaDev** : aucune image publiée par
  EupaDev ne le contient. L'image du lanceur est construite par la CI de la
  forge du client, dont le Dockerfile télécharge le binaire de Claude Code en
  version exacte : le client accepte lui-même les conditions et utilise sa
  clé. Une montée de version est une modification relue de ce Dockerfile.
- **Téléchargement vérifié** : empreinte de la clé de publication figée dans
  le Dockerfile ; signature du manifeste par cette clé ; version du manifeste
  égale à la version figée ; sha256 du binaire égal à celui du manifeste ; un
  seul écart arrête la construction. Les outils du téléchargement (curl, gpg)
  restent dans une étape jetable, hors de l'image finale.
- **Signature** : cette image est signée par la clé cosign de l'installation
  du client (pas par EupaDev, qui ne la voit pas) et vérifiée avant chaque
  lancement ; non signée ou autre clé = refusée.
- Un 2e moteur agnostique du modèle (candidat : OpenHands, MIT) n'est branché
  que si un client le demande.
- Règles des agents neutres dans `AGENTS.md` ; le propre à Claude Code
  (`.claude/agents/`) est isolé pour être traduit.
- Un **moteur factice**, derrière le même contrat, dépose code et rapport
  préparés : il teste toute la chaîne sans appel d'IA.

## Alternatives écartées
- Installer depuis npm (`npm install -g @anthropic-ai/claude-code`) — remet
  npm dans l'image de construction, et l'intégrité repose sur le registre npm,
  pas sur une signature de l'éditeur vérifiée à la construction.
- Installer par le script `curl … | bash` d'Anthropic — il télécharge la
  dernière version au lieu d'une version figée.
- Appeler Claude Code directement — ferme la porte aux autres fournisseurs et
  au moteur factice.
- Claude Code vers un autre modèle par `ANTHROPIC_BASE_URL` et une passerelle
  — non pris en charge par l'éditeur, comportement non garanti à chaque mise
  à jour ; écarté comme solution de fond, possible comme essai avant un
  2e moteur.
- Frameworks d'agents (LangGraph, Mastra, CrewAI) — une couche de plus sans
  rien apporter que DBOS et un agent en ligne de commande ne fassent déjà.

## Conséquences
- Un autre moteur se branche par un adaptateur, sans réécrire l'orchestrateur.
- **Limite** : contrat dessiné avec une seule implémentation réelle et un
  factice ; il sera sans doute retouché au 2e moteur (champs propres à Claude,
  format du coût, reprise de session).
- **Limite** : un modèle hébergé chez le client code aujourd'hui moins bien en
  autonomie (plus d'itérations, de temps et de budget par tâche).
- Avec Claude Code, code et échanges partent vers le fournisseur (ADR-001).
- Chaque client construit son image du lanceur : dépendance à l'accès de sa
  forge à `downloads.claude.ai`, et deux clients peuvent avoir deux versions,
  figées chacune dans le Dockerfile.
- Si Anthropic change sa clé de publication, la construction échoue jusqu'à
  la mise à jour relue de l'empreinte figée : échec sûr, voulu.
- Trivy n'analyse pas l'intérieur du binaire : son intégrité repose sur la
  signature d'Anthropic.

## Vérification
- Le contrat est une interface typée (`MoteurAgent`,
  `orchestrateur/src/exterieur/contrats.ts`) : le compilateur refuse un moteur
  qui ne la respecte pas.
- La construction de l'image refuse un manifeste non signé par la clé figée,
  une autre version ou un binaire d'une autre empreinte.
- Le test réel de l'image des agents (`infra/ansible/verify-image-agent.yml`)
  vérifie la signature cosign de l'image publiée et que `claude --version`
  répond la version figée.
- La CI du moteur fera tourner la chaîne de bout en bout avec le moteur
  factice, et une règle de motif y refusera tout lancement de `claude` hors de
  l'adaptateur Claude Code.
- La CI de EupaDev cherchera le binaire `claude` et le paquet
  `@anthropic-ai/claude-code` dans les images qu'elle publie et refusera la
  publication s'ils y sont.
- Le lanceur vérifiera la signature de son image avant de lancer un agent ;
  un test le prouvera avec une image non signée.
