---
adr: 020
title: Relecteurs en lecture seule par le harnais, avec un shell réduit au jeu read-only
status: accepté
date: 2026-10-24
decision-makers: Ilan
supersedes:
related: [ADR-018]
controle: en-place
---
## Contexte
Les deux relecteurs de l'usine (sécurité, qualité) recevaient `--tools Read`
seul, comme la recherche de chevauchement (`overlap`). Leurs consignes leur
demandent d'élargir un écart à toute sa classe et de lancer « la plus petite
commande en lecture qui pourrait les contredire » (un `grep`) : avec `Read`
seul, et sans Glob ni Grep sous `--bare`, ces étapes sont inexécutables. La
ROADMAP (E25) les dit « déjà montés en lecture seule » : c'est faux. Leur
dépôt est un clone ordinaire, inscriptible ; ce qui jette leurs écritures,
c'est le lanceur, qui ne récupère aucun bundle pour ces rôles. Claude Code,
en `--permission-mode dontAsk`, n'exécute sans autorisation que son jeu de
commandes en lecture (`cat`, `grep`, `find`, `git` en lecture…) et refuse
tout le reste (doc permissions). La revue critique craignait que ce jeu lise
hors des dossiers de travail ; l'essai au faux amont du 2026-10-18 (Claude
Code 2.1.287, ligne de commande du moteur) montre que non : `cat /etc/passwd`
et `grep` dans `~/.claude` sont refusés, `grep` dans le clone et `cat` dans
`/tmp/tache` passent, une redirection, `node -e` et `Edit` sont refusés. Le
réglage `blockReadsOutsideWorkingDirectories` du managed settings n'ajoute
rien pour les relecteurs et refuse le Bash autorisé des rôles de code dès
qu'une commande nomme un chemin hors du clone. Le remplacement de ce réglage,
prévu par la recherche, par le confinement de la ligne de commande vérifié
par l'essai (variante `relecteur`) a été validé par Ilan le 2026-10-18.
Détail : note
`docs/reflexions/2026-10-18-note-relecteurs-plafonds.md`, recherche
`docs/reflexions/2026-10-17-recherche-agents.md` §5.

## Décision
Donner aux relecteurs Bash et Read sans aucune autorisation, pour que le
harnais réduise leur shell au jeu en lecture, confiné aux dossiers de travail.
- Relecteurs : `--tools Bash,Read`, `--allowedTools` limité à la lecture des
  données de la tâche, `dontAsk` comme tous les rôles.
- `overlap` garde `Read` seul (liste distincte) : ni dépôt, ni besoin de
  chercher.
- Écritures refusées par le harnais, et jetées par le lanceur si l'une
  passait : aucun bundle n'est récupéré pour un rôle en lecture.
- Lectures confinées au clone et à `/tmp/tache` par la ligne de commande du
  moteur ; pas de `blockReadsOutsideWorkingDirectories` dans le managed
  settings, qui gênerait les rôles de code.
- Repli si le confinement cesse de tenir : ce réglage passé aux seuls
  relecteurs par `--settings` ; à défaut, `Read` seul et consignes amputées
  des étapes « élargir » et « prouver le contraire ».

## Alternatives écartées
- `Read` seul — les étapes de vérification des consignes restent
  inexécutables, et un relecteur qui ne peut pas se contredire rapporte plus
  de faux constats.
- `blockReadsOutsideWorkingDirectories` dans le managed settings — sans effet
  mesuré sur les relecteurs, et il refuse `cd /tmp/… && pnpm install` ou
  `head /etc/passwd` aux rôles de code dont Bash est autorisé (essai).
- Dépôt rendu non inscriptible — le clone est fait dans le conteneur par
  l'utilisateur de l'agent ; le rendre non inscriptible demanderait un
  montage ou un propriétaire différent par rôle, pour une protection que le
  lanceur assure déjà en ne prenant aucun bundle.

## Conséquences
Les relecteurs peuvent chercher dans tout le dépôt et vérifier leurs
constats. Le parseur du jeu read-only devient une surface : une faille qui y
laisserait passer une écriture (CVE-2025-66032, corrigée en 1.0.93) reste
sans effet sur l'outil, puisque rien n'est poussé, et bornée par gVisor et
un conteneur sans secret ; il faut suivre `CLAUDE_CODE_VERSION`. Le
confinement des lectures repose sur un comportement de Claude Code constaté,
pas sur un réglage : il est revérifié à chaque version.

## Vérification
L'essai au faux amont de la CI de l'image des agents (variante `relecteur`)
échoue si un relecteur reçoit Edit, si une écriture ou une commande hors du
jeu read-only passe, ou si une lecture hors des dossiers de travail réussit ;
la variante `code` échoue si le Bash autorisé d'un rôle de code ne lit plus
hors du clone. Les tests du moteur échouent si la ligne de commande d'un
relecteur n'est plus `--tools Bash,Read` sans autorisation, si `overlap`
reçoit Bash, ou si un bundle de relecteur est poussé.
