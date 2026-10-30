---
adr: 021
title: Un seul agent builder écrit le code ; tests écrits avant, relecteurs à contexte frais
status: accepté
date: 2026-10-19
decision-makers: Ilan
supersedes:
related: [ADR-006, ADR-013, ADR-018]
controle: prévu
---
## Contexte
Le durcissement d'un outil lance trois rôles de code sur trois branches :
`backend` (`api/`, `db/`), `frontend` (`web/`) et `tests`
(`tests/acceptation/`), chacun dans son conteneur, sans se voir ; un rôle
`integration` est prévu pour les conflits de fusion mais n'est jamais lancé
par le moteur (seule l'opération de forge « intégrer » existe). Faits relevés
le 2026-10-17 sur le moteur : la file des tâches a une concurrence de 1 par
défaut, donc le « parallélisme » back / front / tests s'exécute en série dans
l'ordre de la liste et ne fait gagner aucun temps ; le front code contre la
forme du contrat, jamais contre une API qui répond, et la première
confrontation a lieu à l'intégration, relue par des relecteurs qui ne lancent
rien ; les fichiers communs (`package.json`, lockfile, `README.md`) sont
écrits deux fois, un ajout de dépendance de chaque côté est un conflit sur le
lockfile ; aucun canal n'existe entre back et front et aucun oracle exécutable
ne tranche entre eux. Les sources convergent sur trois conditions pour
plusieurs écrivains : unités indépendantes par fichiers, oracle exécutable
quasi parfait, canal de coordination ; nous n'avons que la première. Anthropic
range « frontend, backend, tests, each owned by a different teammate » parmi
les cas des *agent teams*, qui supposent des coéquipiers qui se parlent et
ne tournent pas en mode `-p` (le nôtre) ; Cognition (avril 2026) : les
systèmes multi-agents marchent quand « writes stay single-threaded » ; les
bonnes pratiques Claude Code : « have one Claude write tests, then another
write code to pass them », « a fresh context improves code review ».
Détail, sources et chiffrage : `docs/reflexions/2026-10-17-recherche-agents.md`
(§2, §3) et `docs/reflexions/2026-10-17-note-constructeur-unique.md`.

## Décision
Un seul agent, le rôle `builder`, écrit tout le code de l'outil ; le rôle
`tests` écrit la suite d'acceptation avant lui, sans lire le code ; deux
relecteurs à contexte frais relisent le résultat.
- **Rôles** : `overlap`, `scoping`, `contract`, `tests`, `builder`,
  `security-reviewer`, `quality-reviewer`. Les rôles `backend` et `frontend`
  disparaissent, remplacés par `builder` ; le rôle `integration` est retiré
  (consignes, traduction, schéma du rapport).
- **Périmètres d'écriture**, contrôlés par le lanceur avant la poussée et par
  la fusion avec la même définition : `builder` possède `api/`, `db/`, `web/`,
  `public/`, `tests/unit/` et peut aussi écrire `README.md`, `.env.example`,
  `docs/DECISIONS.md`, `package.json`, `pnpm-lock.yaml` ; `tests` possède
  `tests/acceptation/` ; `contract`, `scoping` et les relecteurs sont
  inchangés ; le `Dockerfile` n'appartient à personne.
- **Un tour de durcissement** : tâche `tests`, puis tâche `builder` (ordre
  explicite, pas un effet de la file), intégration des deux branches,
  relecteurs. Le `builder` reçoit la suite d'acceptation **en lecture seule**
  dans `/tmp/tache/`, jamais dans son clone de travail ; `tests/acceptation/`
  lui reste refusé à la poussée.
- **Relance par écarts** : un écart sur un fichier va à son propriétaire
  (`api/`, `web/`, `tests/unit/` → `builder` ; `tests/acceptation/` →
  `tests`) ; un rôle relancé repart avec un contexte neuf.
- **Consignes** : `agents/builder.md` fusionne les prompts back et front ; les
  règles de domaine gardent leurs noms (`backend.md` = règles d'API,
  `frontend.md` = règles d'interface) et sont toutes deux incluses dans les
  consignes du `builder`.
- **Base** : les contraintes `CHECK` sur les rôles admettent `builder` par une
  migration nouvelle qui garde les anciennes valeurs ; les lignes historiques
  restent lisibles, aucune n'est réécrite.
- **Conflits** : entre `builder` et `tests` ils sont impossibles par
  construction (périmètres disjoints) ; un conflit entre une branche de rôle
  et `main` reste traité par l'écart `integration:conflit`, renvoyé au
  `builder`.

## Alternatives écartées
- Statu quo (back ∥ front ∥ tests) — à concurrence 1 le gain de temps est nul
  et le front n'a jamais d'API qui répond ; les communs sont écrits deux fois.
- `backend` puis `frontend` en série sur une même branche — garde deux
  contextes qui ne se voient pas et deux prompts à maintenir, pour le même
  temps de mur ; ne supprime ni les communs écrits deux fois ni l'absence
  d'oracle.
- Agent teams (coéquipiers Claude Code) — expérimentaux, désactivés par
  défaut, et « in non-interactive mode with the `-p` flag … Claude doesn't
  spawn teammates » : notre mode d'exécution.
- Redécoupage par capacité métier avec plusieurs constructeurs — exige
  l'oracle exécutable (suite câblée en CI) et une concurrence supérieure à 1,
  qui n'existent pas encore ; voie documentée pour plus tard.
- Garder `integration` comme filet — jamais lancé par le moteur, les conflits
  qu'il visait (back ↔ front) deviennent impossibles ; du poids mort dans les
  consignes et le schéma.

## Conséquences
- Un seul agent lit contrat, features, maquette et suite, et écrit trois
  dossiers : contexte plus long, atténué par le prompt système, la relance à
  contexte neuf et le socle commun ; à mesurer avant de régler.
- Les consignes du `builder` (charte + rôle + quatre règles) font environ
  3 800 mots jusqu'à leur réécriture pour le socle : le prompt de rôle le plus
  long de la plateforme, accepté comme état transitoire.
- Le plafond de tâche unique (15 min / 40 tours / 3 $) coupera un `builder`
  qui fait le travail de deux rôles : les plafonds par rôle et la mesure
  viennent d'une décision séparée ; aucun cycle réel n'a de sens avant.
- Une migration de plus, les anciennes valeurs restant admises : un retour
  arrière ne demande qu'une migration et le code précédent.
- Consignes, schéma du rapport et contrôle de l'image des agents changent :
  image du moteur reconstruite et signée, contrôle `images/agent/controle/`
  régénéré.
- Le recoupement des rôles qui n'a jamais servi (`integration`) disparaît ;
  l'écart `integration:conflit` et la fusion de `main` dans la branche avant
  de travailler couvrent le risque restant.

## Vérification
La CI du moteur (`.github/workflows/moteur.yml`) vérifiera : par les
scénarios Gherkin, qu'un tour de durcissement lance `tests` puis `builder` et
jamais `backend` ni `frontend`, et qu'un écart sur `web/x.js` est routé à
`builder` ; par les tests de base, que la migration accepte une tâche
`builder`, refuse un rôle inconnu et laisse lisible une ligne `backend`
historique ; par `tests/consignes.test.ts`, que les consignes chargées
couvrent exactement les rôles du moteur (fail-closed sur un fichier manquant)
; par `tests/claude-sortie.test.ts`, que le schéma embarqué dans le contrôle
de l'image des agents est celui du template ; par les mutations, que remettre
le fan-out ou router `web/` vers `tests` est détecté. Le lanceur refusera
avant la poussée tout fichier hors périmètre du rôle, et la fusion appliquera
la même définition du périmètre. Non vérifiable mécaniquement : la qualité du
code produit par un seul constructeur par rapport à deux (mesurée par les
conflits d'intégration, les tours avant premier push vert et le coût par tour,
relus par Ilan).
