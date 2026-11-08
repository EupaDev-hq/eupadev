---
adr: 030
title: Boîte à outils des agents, la vraie erreur d'une CI rouge donnée au tour suivant, Bash en lecture seule pour les rôles qui lisent, mots d'état refusés
status: proposed
date:
decision-makers: Ilan
supersedes:
related: [ADR-018, ADR-020, ADR-021, ADR-027]
check: planned
---
> Traduction de `docs/adr/030-agent-toolkit-skills-tools-and-error-feedback.md` ; la version anglaise fait foi.

## Contexte
Chaque agent de rôle exécute Claude Code sans interface, `claude --bare
--restricted -p` (`orchestrator/src/external/claude-engine.ts`), avec
`--tools` nommant ce qui existe : `Bash,Read,Edit` pour les rôles de code,
`Bash,Read` pour les relecteurs (Bash réduit à l'ensemble en lecture seule
de Claude Code sous `dontAsk`, ADR-020), `Read` seul pour `overlap` et
`diagnosis` (`READ_TOOLS`). Ce qu'un rôle sait, ce sont ses consignes,
lues dans l'image du moteur (ADR-018), et son fichier de tâche, `task.md`,
avec les écarts du tour précédent.

Le cycle 9 du labo (2026-11-04) a montré trois manques. L'agent de contrat
a écrit du YAML que le validateur strict du socle a refusé au démarrage de
l'outil, dans le job `image` de la CI ; le tour de durcissement suivant a
reçu l'écart `ci:image` et rien d'autre, parce que le moteur transforme un
job rouge en `ci:<check>` et ne lit les détails d'un job que pour deux
d'entre eux (échecs d'`acceptance`, SARIF d'`analysis` ; `toolCycle.ts`,
`pipelineDeviations`) : le constructeur ne pouvait pas savoir quoi
corriger. Depuis l'ADR-027, l'observateur de la forge garde la fin du
journal de chaque job rouge (`logTail()` de `gitea-forge.ts` : les 40
dernières lignes non vides, couleurs, horodatages et caractères de
contrôle retirés, chacune coupée à 300 caractères, `LOG_TAIL`), rangée
dans `pipeline_results.details.log_tail` et lue par le seul diagnostic ;
le diagnostic, avec `Read` seul, ne peut pas faire `grep` dans le clone
sur lequel on l'interroge. Et l'agent de cadrage a dit au demandeur que la
maquette était « approuvée » quand le demandeur avait écrit « Mockup is
good » et n'avait cliqué sur rien : le contrôle des mots refusés
(`agent-engine/jargon.ts`, `jargon.words` de `lang/*.json`) attrape les
mots techniques, pas les mots qui affirment un état du moteur, et rien
d'autre dans le moteur ne le fait.

## Décision
Trois petits changements, chacun réutilisant un mécanisme que le moteur a
déjà.
- **La vraie erreur d'une CI rouge va au tour suivant.** L'extrait de
  journal que l'observateur range déjà pour chaque job rouge (ADR-027 :
  `logTail()`, `details.log_tail`, 40 lignes de 300 caractères, une seule
  règle, pas de seconde taille) est écrit dans le `task.md` du tour de
  durcissement suivant, comme donnée, sous l'écart `ci:<check>` ou
  `preview:<check>` auquel il appartient, pour les rôles de code de ce
  tour. Rien de nouveau n'est récupéré ni rangé ; un contrôle sans extrait
  se lit comme aujourd'hui.
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
- Une seconde taille pour l'extrait donné au constructeur (80 lignes,
  8 Kio) — deux bornes pour un seul texte ; la borne de l'observateur
  (ADR-027) est ce que lit le diagnostic et suffit au premier regard d'un
  développeur.
- Donner au constructeur le journal entier du job — sans borne, et la
  sortie des dépendances et des outils est un texte qu'un attaquant peut
  façonner ; un extrait borné donné comme donnée est ce qu'un développeur
  lit en premier de toute façon.
- Laisser l'agent récupérer le journal sur la forge — les conteneurs
  d'agents ne peuvent pas atteindre la forge, à dessein (ADR-016).
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
Une CI rouge dit au tour suivant ce qui a échoué, avec le texte que le
diagnostic lit déjà ; le diagnostic lit le clone au lieu de deviner ; un
demandeur lit ce qu'il peut faire, jamais un état que le moteur n'a pas
atteint. Le coût : quelques centaines de jetons d'entrée par extrait dans
la tâche d'un constructeur ; deux listes d'outils au lieu de trois ; une
nouvelle liste de mots à tenir en deux langues, avec les faux refus d'un
mot employé innocemment (une tâche de cadrage renvoyée une fois avec le
mot pour raison). Limites acceptées : un extrait de journal est un texte
que l'agent lit comme donnée et peut encore mal lire ; la liste des mots
d'état attrape les mots qu'elle connaît ; le manque de connaissance de
l'agent de contrat (du YAML que le validateur strict refuse) n'est pas
comblé par cet ADR.

## Vérification
La CI du moteur vérifiera : par `tests/claude-engine.test.ts`, que
`roleOptions` renvoie `Bash,Read` sans permission pour `overlap`,
`diagnosis` et les relecteurs et `Bash,Read,Edit` pour les rôles de code ;
par les scénarios Gherkin de
`orchestrator/features/hardening-review.feature`, avec le moteur factice,
que le tour qui suit un job `image` rouge a l'extrait de journal de
l'observateur sous `ci:image` dans le `task.md` du constructeur, borné
comme le dit `LOG_TAIL`, et qu'un job rouge sans extrait laisse l'écart
tel quel ; par `orchestrator/features/scoping.feature`, qu'un
`requester_message` contenant « approved » renvoie la tâche de cadrage
avec ce mot pour raison et compte dans les échecs du cadrage ; par
`tests/a-r6.test.ts`, la liste des mots d'état dans les deux langues ; par
`tests/mutations/mutations.ts`, une mutation tuée par chacun de ces tests.
La CI de l'image des agents (`images/agent/check`) rejouera la ligne de
commande générée avec les deux listes d'outils. Non vérifiable
mécaniquement : le choix des mots d'état, et si un constructeur lit bien
l'extrait.
