---
adr: 033
title: Bash en lecture seule pour les rôles qui lisent, mots d'état refusés dans ce qu'un agent écrit pour le demandeur
status: proposed
date:
decision-makers: Ilan
supersedes:
related: [ADR-018, ADR-020, ADR-027, ADR-030]
check: planned
---
> Traduction de `docs/adr/033-read-only-bash-for-the-reading-roles-and-state-words-refused.md` ; la version anglaise fait foi.

## Contexte
Chaque agent de rôle exécute Claude Code sans interface, `claude --bare
--restricted -p` (`orchestrator/src/external/claude-engine.ts`), avec
`--tools` nommant ce qui existe : `Bash,Read,Edit` pour les rôles de code,
`Bash,Read` pour les relecteurs (Bash réduit à l'ensemble en lecture seule
de Claude Code sous `dontAsk`, ADR-020), `Read` seul pour `overlap` et
`diagnosis` (`READ_TOOLS`). Ce qu'un rôle sait, ce sont ses consignes,
lues dans l'image du moteur (ADR-018), et son fichier de tâche, `task.md`.

Le cycle 9 du labo (2026-11-04) a montré trois manques. Le premier, une CI
rouge dont la vraie erreur n'atteignait jamais le constructeur, est décidé
dans l'ADR-030. Les deux autres : le diagnostic (ADR-027) lit l'extrait de
journal d'un job rouge, mais avec `Read` seul il ne peut pas faire `grep`
dans le clone sur lequel on l'interroge, ni lire son `git log`. Et l'agent
de cadrage a dit au demandeur que la maquette était « approuvée » quand le
demandeur avait écrit « Mockup is good » et n'avait cliqué sur rien : le
contrôle des mots refusés (`agent-engine/jargon.ts`, `jargon.words` de
`lang/*.json`) attrape les mots techniques, pas les mots qui affirment un
état du moteur, et rien d'autre dans le moteur ne le fait.

## Décision
Deux petits changements, chacun réutilisant un mécanisme que le moteur a
déjà.
- **Bash en lecture seule pour chaque rôle qui lit.** `READ_TOOLS`
  disparaît : `overlap` et `diagnosis` reçoivent la liste des relecteurs,
  `Bash,Read` sans permission (ADR-020 : Bash réduit à l'ensemble en
  lecture seule, écritures refusées par le harnais et jetées par le
  lanceur). Le diagnostic peut faire `grep` dans le contrat et `git log`
  dans son clone au lieu de deviner ; `overlap` tourne dans un dossier
  vide et n'y gagne qu'une liste de moins.
- **Les mots d'état appartiennent au moteur.** Une seconde liste de mots
  refusés, `state.words` dans `lang/*.json` (approuvé, validé, accepté,
  envoyé, déployé, fusionné, publié, et leurs formes anglaises), vérifiée
  par le même mécanisme de mot entier que `jargon.words` sur chaque texte
  qu'un agent écrit pour le demandeur (`requester_message` du rôle de
  cadrage) ; une correspondance fait échouer la tâche avec le mot pour
  raison, comme un mot de jargon, et les compteurs d'échec du cadrage la
  comptent. Les consignes disent quoi écrire à la place : ce que le
  demandeur peut faire ensuite (le bouton, le lien), jamais ce que le
  moteur a fait.

## Alternatives rejetées
- Un modèle qui juge si un message affirme un état du moteur — payant et
  non reproductible ; une liste de mots est un changement relu et un test
  unitaire, comme `jargon.words`.
- Reporté, **les compétences de rôle** (fichiers Markdown de savoir-faire
  dans l'image du moteur, lus à la demande, ou chargés nativement par
  `Skill`) — le chargement natif n'est pas testé sous `--bare
  --restricted` (que `Skill` survive à `--restricted` et à `--tools` n'est
  pas documenté), et une lecture explicite depuis `/tmp/task` est un
  second chemin non testé ; à décider après un essai dans la CI de l'image
  des agents, dans son propre ADR.
- Reporté, **un banc d'évaluation des agents** rejouant de vraies archives
  de tâches à la main et noté par du code — à fusionner plus tard avec les
  cas de non-régression du diagnostic que l'ADR-027 ajoute par cycle
  bloqué, pour qu'un seul banc tienne les deux.
- Abandonner `--bare` pour que les compétences et CLAUDE.md soient
  découverts — la découverte lirait le clone de l'outil, qu'un agent
  écrit ; `--bare --restricted` est la cage que l'ADR-018 a mesurée.

## Conséquences
Le diagnostic lit le clone au lieu de deviner ; un demandeur lit ce qu'il
peut faire, jamais un état que le moteur n'a pas atteint. Le coût : deux
listes d'outils au lieu de trois ; une nouvelle liste de mots à tenir en
deux langues, avec les faux refus d'un mot employé innocemment (une tâche
de cadrage renvoyée une fois avec le mot pour raison). Limite acceptée :
la liste des mots d'état attrape les mots qu'elle connaît.

## Vérification
La CI du moteur vérifiera : par `tests/claude-engine.test.ts`, que
`roleOptions` renvoie `Bash,Read` sans permission pour `overlap`,
`diagnosis` et les relecteurs et `Bash,Read,Edit` pour les rôles de code ;
par `orchestrator/features/scoping.feature`, qu'un `requester_message`
contenant « approved » renvoie la tâche de cadrage avec ce mot pour raison
et compte dans les échecs du cadrage ; par `tests/a-r6.test.ts`, la liste
des mots d'état dans les deux langues ; par `tests/mutations/mutations.ts`,
une mutation tuée par chacun de ces tests. La CI de l'image des agents
(`images/agent/check`) rejouera la ligne de commande générée avec les deux
listes d'outils. Non vérifiable mécaniquement : le choix des mots d'état.
