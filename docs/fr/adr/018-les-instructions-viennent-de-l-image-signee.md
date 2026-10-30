---
adr: 018
title: Les instructions viennent de l'image signée ; le dépôt, la tâche et la base sont des données
status: accepté
date: 2026-10-16
decision-makers: Ilan
supersedes:
related: [ADR-006, ADR-013]
controle: partiel
---
## Contexte
Chaque tâche d'agent reçoit des consignes (le prompt de son rôle) et des
données (chat, écarts, catalogue, dépôt). Jusqu'au 15 octobre 2026, le chef
d'orchestre passait une phrase d'une ligne comme consigne ; l'agent lisait son
vrai prompt dans `agents/<rôle>.md` **du dépôt cloné**, invité par une phrase
de repli de la charte. Or tout ce qui est dans ce dépôt a pu être écrit par un
agent au tour précédent : un agent manipulé qui réécrit `agents/backend.md`
réécrirait le prompt des tours suivants. Les fichiers protégés de la forge
bloquent ce chemin, mais c'est une configuration, pas une propriété du code.
Deux constats mesurés (essai gratuit au faux serveur amont, Claude Code 2.1.287,
note `docs/reflexions/2026-10-15-note-consignes-agents.md`) : sous `--bare`
seul, le bloc `env` d'un `.claude/settings.json` écrit dans le clone détourne la
session entière vers l'adresse qu'il désigne, clé comprise (le vecteur de
CVE-2026-21852) ; `--restricted` l'empêche. Et `.pnpmfile.cjs` est exécuté
par `pnpm install --ignore-scripts`. Le rôle `overlap` tourne avant que le
dépôt de l'outil existe ; il n'a pas de source de consigne dans un clone.
Les sources extérieures convergent : OWASP LLM01 (séparer et signaler le
contenu non fiable), Beurer-Kellner et al. 2025 (les instructions viennent
d'une source de confiance fixée avant toute lecture de données), règle de
deux de Meta (un agent qui lit des entrées non fiables ne doit pas, en plus,
changer l'état et accéder à du sensible sans contrôle).

## Décision
Les instructions d'un agent viennent exclusivement de l'image signée du moteur ;
tout le reste est une donnée.
- Consignes d'un rôle = `AGENTS.md` + `agents/<rôle>.md` + règles de domaine
  du rôle, copiés du dépôt EupaDev dans l'image du moteur, lus au démarrage
  (fichier manquant, vide ou contenant un caractère Unicode invisible = refus
  de démarrer), passés tels quels à chaque tâche ; l'empreinte enregistrée par
  tâche est celle de ce texte. Aucun prompt ne renvoie à un fichier du dépôt.
- Le dépôt cloné, le fichier de tâche et la base sont des données : le clone
  est lu en `--bare --restricted` (ni settings du projet ou de l'utilisateur,
  ni hooks, ni CLAUDE.md, ni MCP), `dontAsk` pour tous les rôles, outils
  nommés ; l'image des agents porte un `managed-settings.json` (root, racine
  en lecture seule) généré depuis la même liste de chemins interdits que le
  lanceur.
- Le lanceur refuse, avant toute poussée, tout bundle qui touche un chemin
  interdit, sort du périmètre du rôle, contient un lien symbolique, un
  sous-module ou un nom de fichier avec caractère de contrôle ou invisible.
  La forge refuse la même liste à la poussée ; c'est une ceinture, le lanceur
  est la garantie.
- `overlap` tourne sans dépôt : son catalogue d'outils lui est donné en
  données ; un verdict « plausible » doit désigner un outil de ce catalogue,
  sinon il vaut « à vérifier ».
- Les textes libres qui atteignent ce canal (commentaire de gate, chat, noms
  de fichiers) sont refusés s'ils portent un caractère invisible.

## Alternatives écartées
- Lire les consignes dans le dépôt de l'outil, protégé par la forge — une
  seule couche, de configuration ; une erreur la rend silencieuse.
- Créer le dépôt avant `overlap` — un dépôt créé puis archivé par demande
  refusée, pour un rôle qui n'a besoin d'aucun fichier.
- Garder `bypassPermissions` pour les rôles de code — la doc le dit sans
  protection contre l'injection ; `--restricted` le refuse ; le travail
  normal passe en `dontAsk` avec Bash et Edit autorisés.
- `--bare` sans `--restricted` — mesuré : la session part chez l'adresse du
  `.claude/settings.json` du clone.
- Marquer les données (datamarking, Spotlighting) — contourné en attaque
  adaptative ; l'enjeu d'`overlap` est un verdict qu'un humain relit.

## Conséquences
- Une version de consignes = une version d'image : les empreintes de tâches
  sont comparables entre outils ; les copies `agents/*.md` des dépôts
  d'outils ne servent plus qu'aux humains.
- Sous `--bare`, Claude Code n'expose que Bash, Read et Edit : un rôle de
  code crée ses fichiers par Bash. Si cela gêne le travail réel, le repli est
  `--restricted` sans `--bare`, mesuré sain au même essai.
- Trois listes à garder égales (lanceur, image des agents, forge) : une seule
  constante, un test qui échoue si l'une diverge ; la liste de la forge n'est
  appliquée qu'au prochain passage d'Ansible.
- Le harnais reste une ceinture : `node -e "fs.writeFileSync('.claude/…')"`
  passe en `dontAsk` ; c'est le contrôle du bundle qui le refuse.

## Vérification
Tests du moteur (`orchestrateur/tests/consignes.test.ts`,
`chemins-interdits.test.ts`, `claude-sortie.test.ts`, `moteur-claude.test.ts`
avec un faux `claude` et le vrai Docker, scénarios Gherkin des features
`lanceur` et `entree-chevauchement`), mutations CONS-…, OV-…, E4-… tuées par
ces tests ; la CI de l'image du moteur vérifie un fichier de consignes par
rôle ; la CI de l'image des agents rejoue la ligne de commande sans réseau ;
l'essai au faux amont (`images/agent/controle/essai-amont/`) prouve, sans
appel payant, qu'aucun contenu du clone n'atteint le modèle et que les
chemins interdits sont refusés — il est lancé à la main, sa place dans la CI
de l'image des agents et dans `verify-agents.yml` reste à faire. Non
vérifiable mécaniquement : le respect du périmètre par le modèle et la
qualité des verdicts (evals promptfoo prévues).
