---
adr: 006
title: Moteur d'agent interchangeable derrière un contrat fixe, Claude Code d'abord
status: remplacé par ADR-013
date: 2026-10-13
decision-makers: Ilan
supersedes:
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
(Apache 2.0) ne peut pas le redistribuer ; il s'installe depuis npm
(`@anthropic-ai/claude-code`) et celui qui l'installe accepte ces conditions.
Le choix d'un modèle et d'un effort par rôle est une décision distincte, qui
utilise ce contrat sans en faire partie.

## Décision
Faire appeler par le lanceur d'agents un moteur d'agent derrière un contrat
d'entrée/sortie fixe, avec Claude Code comme moteur n°1.
- **Entrée** : dépôt, consigne, règles, plafond de budget, paramètres du
  lanceur transmis tels quels (modèle, effort) ; **sortie** : code modifié,
  rapport JSON commun, coût et tokens.
- **Claude Code jamais livré par EupaDev** : aucune image publiée par
  EupaDev ne le contient. L'image du lanceur est construite par la CI de la
  forge du client, dont le Dockerfile télécharge Claude Code depuis npm en
  version exacte : le client accepte lui-même les conditions et utilise sa
  clé. Une montée de version est une modification relue de ce Dockerfile.
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
- Chaque client construit son image du lanceur : dépendance à l'accès npm de
  sa forge, et deux clients peuvent avoir deux versions, figées chacune dans
  le Dockerfile.

## Vérification
- Le contrat est une interface typée (`MoteurAgent`,
  `orchestrateur/src/exterieur/contrats.ts`) : le compilateur refuse un moteur
  qui ne la respecte pas.
- La CI du moteur fera tourner la chaîne de bout en bout avec le moteur
  factice, et une règle de motif y refusera tout lancement de `claude` hors de
  l'adaptateur Claude Code.
- La CI de EupaDev cherchera `@anthropic-ai/claude-code` dans les images
  qu'elle publie et refusera la publication s'il y est.
- Le lanceur vérifiera la signature de son image avant de lancer un agent ;
  un test le prouvera avec une image non signée.
