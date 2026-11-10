---
adr: 030
title: La vraie erreur d'une CI rouge, l'extrait de journal de l'observateur, donnée au constructeur du tour suivant
status: accepted
date: 2026-11-10
decision-makers: Ilan
supersedes:
related: [ADR-018, ADR-021, ADR-027, ADR-033]
check: in-place
---
> Traduction de `docs/adr/030-agent-toolkit-skills-tools-and-error-feedback.md` ; la version anglaise fait foi.

## Contexte
Chaque agent de rôle exécute Claude Code sans interface, `claude --bare
--restricted -p` (`orchestrator/src/external/claude-engine.ts`). Ce qu'un
rôle sait, ce sont ses consignes, lues dans l'image du moteur (ADR-018),
et son fichier de tâche, `task.md`, avec les écarts du tour précédent.

Cycle 9 du labo (2026-11-04) : l'agent de contrat a écrit du YAML que le
validateur strict du socle a refusé au démarrage de l'outil, dans le job
`image` de la CI ; le tour de durcissement suivant a reçu l'écart
`ci:image` et rien d'autre, parce que le moteur transforme un job rouge en
`ci:<check>` et ne lit les détails d'un job que pour deux d'entre eux
(échecs d'`acceptance`, SARIF d'`analysis` ; `toolCycle.ts`,
`pipelineDeviations`) : le constructeur ne pouvait pas savoir quoi
corriger, et la virgule fautive a été trouvée au tour 17. Depuis
l'ADR-027, l'observateur de la forge garde la fin du journal de chaque job
rouge (`logTail()` de `gitea-forge.ts` : les 40 dernières lignes non
vides, couleurs, horodatages et caractères de contrôle retirés, chacune
coupée à 300 caractères, `LOG_TAIL`), rangée dans
`pipeline_results.details.log_tail` et lue par le seul diagnostic. Un
journal de job est un texte écrit par les dépendances et les contrôles de
l'outil : il peut porter des secrets (identifiants de registre dans une
URL, un jeton dans une ligne d'environnement) et des traces de pile
d'`api/`, que le rôle tests ne doit jamais lire (ADR-021). Les deux autres
manques montrés par le cycle 9, un diagnostic sans Bash et un agent de
cadrage qui affirme un état du moteur, sont décidés dans l'ADR-033.

## Décision
Donner au constructeur du tour de durcissement suivant l'extrait de
journal que l'observateur range déjà pour chaque job rouge, comme donnée,
sous les écarts que ce job a produits.
- **Un seul extrait, celui de l'observateur** (ADR-027 : `logTail()`,
  `details.log_tail`, 40 lignes de 300 caractères, une seule règle, pas de
  seconde taille) : rien de nouveau n'est récupéré ni rangé ; un contrôle
  rouge sans extrait se lit comme aujourd'hui, l'écart seul.
- **Le constructeur seul** (ADR-021 : le rôle tests ne lit jamais le code,
  et un journal de job porte des traces de pile d'`api/`) ; les contrôles
  rouges du dernier tour seulement, chaque entrée nommant le contrôle et
  les écarts qu'il a produits (`ci:<check>`, `ci:<check>:<test>`,
  `ci:opengrep:<id>`, `preview:<check>`, la correspondance de l'évaluation
  elle-même).
- **Les secrets masqués avant toute écriture**
  (`hardening/log-feedback.ts`) : identifiants dans une URL, jetons bearer,
  la valeur de tout nom ressemblant à token/password/secret/key en forme
  `=`, `:` ou JSON, blocs de clé privée.
- **Plafonné** : le champ `ci_logs` entier d'une tâche à 20 Ko de JSON, les
  lignes les plus anciennes retirées d'abord et marquées `truncated` ; un
  plafond sur le champ de la tâche, pas une seconde taille d'extrait.
- **Écrit comme donnée** dans le bloc JSON de `task.md` ; une clôture de
  bloc (trois accents graves) dans une ligne de journal est neutralisée
  d'abord.

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
- Donner l'extrait à tous les rôles de code — le rôle tests lirait les
  traces de pile du code, que l'ADR-021 lui interdit.

## Conséquences
Une CI rouge dit au tour suivant ce qui a échoué, avec le texte que le
diagnostic lit déjà. Le coût : quelques centaines de jetons d'entrée par
extrait dans la tâche d'un constructeur, et une liste de masquage à
tenir. Limites acceptées : un extrait de journal est un texte que l'agent
lit comme donnée et peut encore mal lire ; le masquage attrape les formes
qu'il connaît ; le manque de connaissance de l'agent de contrat (du YAML
que le validateur strict refuse) n'est pas comblé par cet ADR.

## Vérification
La CI du moteur (`.github/workflows/engine.yml`) vérifie : par le
scénario « ADR-030 » de `orchestrator/features/hardening-review.feature`,
avec le moteur factice, que le tour qui suit un job `image` rouge a
l'extrait de journal de l'observateur sous `ci:image` dans le `task.md`
du constructeur, masqué (identifiants d'URL, jeton bearer, variable
d'allure secrète), jamais dans la tâche du rôle tests, et qu'un job rouge
sans extrait (`lint`) n'a pas d'entrée ; par `tests/log-feedback.test.ts`,
le masquage (identifiants d'URL, jetons bearer, clés d'allure secrète en
forme `=`, `:` et JSON, blocs de clé privée ; lignes ordinaires intactes),
la clôture de bloc neutralisée, et le plafond (les lignes les plus
anciennes du contrôle le plus ancien d'abord, `truncated`, le contrôle le
plus récent garde son extrait) ; par `tests/mutations/mutations.ts`,
quatre mutations tuées par ces tests (extrait retenu, extrait donné au
rôle tests, pas de masquage, pas de plafond). La borne de l'extrait
lui-même est celle de l'observateur et se vérifie avec l'ADR-027. Non
vérifiable mécaniquement : si un constructeur lit bien l'extrait, et un
secret d'une forme que le masquage ne connaît pas.
