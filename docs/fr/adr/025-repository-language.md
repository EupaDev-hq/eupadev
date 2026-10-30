---
adr: 025
title: Langue du dépôt
status: accepted
date: 2026-10-28
decision-makers: Ilan
supersedes:
related: [ADR-004, ADR-019, ADR-026]
check: planned
---
> Traduction destinée aux lecteurs humains. La version anglaise `docs/adr/025-repository-language.md` fait foi.

## Contexte
Le dépôt EupaDev sera publié en open core (Apache 2.0) : des
développeurs extérieurs à l'équipe doivent pouvoir le lire et y contribuer.
L'essentiel en est écrit en français. Mesuré sur le commit `77e6d10`
(2026-10-28), `check-english.py` (voir Vérification) signale 37 287 lignes
françaises dans les fichiers suivis, notes privées exclues : identifiants,
noms de fichiers et de répertoires, objets SQL et valeurs stockées, routes
d'API et champs JSON, variables d'environnement, noms d'infrastructure,
messages de logs et de CI, commentaires, documents et 22 des 25 ADR. Depuis
le 2026-10-20, le texte nouveau a été écrit en anglais pendant que le reste
attendait, si bien que des fichiers mélangent les deux langues. Beaucoup de
noms franchissent une frontière de fichier ou de processus : un export du
socle est utilisé par le template d'outil et par le moteur, un identifiant
d'état est stocké dans la base du moteur et lu par les playbooks du labo,
un identifiant de job de CI est stocké comme nom de contrôle. Traduire une
seule extrémité casse les autres, souvent sans bruit (un filtre de chemins
de CI qui ne correspond plus cesse simplement de s'exécuter). Le 2026-10-28,
Ilan a décidé que rien de ce qui est stocké ou publié sur le labo n'est
conservé : ses bases, le contenu de la forge, les versions publiées du socle
et les secrets peuvent être recréés, donc le labo peut être reconstruit au
lieu d'être migré. Sources : `docs/reflexions/2026-10-20-note-english-switch.md`
(inventaire, couplages, plan), `docs/glossary.md`.

## Décision
L'anglais est la langue d'origine du dépôt ; le français est une
traduction.
- **Code et texte machine : anglais uniquement.** Identifiants, noms de
  fichiers et de répertoires, formats d'échange (routes, paramètres, champs
  JSON, valeurs stockées, codes d'erreur, champs de logs), messages destinés
  aux développeurs et aux exploitants (linters, CLI, logs, sorties de CI,
  erreurs de base de données), commentaires, messages de commit, et texte
  destiné aux agents (prompts, fichiers de tâche, instructions).
- **Documents : anglais, qui fait foi.** Une traduction française n'existe
  que pour les documents lus hors de l'équipe : README, CONTRIBUTING,
  architecture, gouvernance, déploiement, prérequis client, ADR et
  instructions du template d'outil ; fichiers racine en `X.fr.md`, les autres
  sous un `docs/fr/` qui reproduit le chemin et le nom de fichier anglais.
  La feuille de route, les fichiers `CLAUDE.md`, les README des composants
  et le document de la machine à états sont en anglais uniquement.
- **Texte pour l'utilisateur final** (écrans des outils, mails du moteur,
  page du demandeur) : dictionnaires i18n `lang/en.json` et `lang/fr.json`
  à côté du code qui les affiche, avec des clés anglaises ; un réglage du
  déploiement choisit la langue, le français sur le labo. Une valeur stockée
  n'est jamais affichée telle quelle.
- **Notes privées** (`docs/reflexions/`) : restent en français dans le dépôt
  privé et ne sont jamais publiées ; les nouvelles notes sont écrites en
  anglais. Les liens vers elles sont permis tant que le dépôt est privé et
  retirés avant la publication.
- **Un seul glossaire** : `docs/glossary.md` est la seule correspondance
  français → anglais (termes du domaine, un dictionnaire de mots, chaque nom
  qui franchit une frontière). Un nom qui y manque y est ajouté avant d'être
  renommé ; changer un choix anglais change d'abord le glossaire. Une
  modification qui touche un nom français écrit son nom anglais final, jamais
  un nom à moitié traduit.
- **Orthographe** : anglais britannique (`organisation`, `licence`,
  `catalogue`).
- **Aucune compatibilité conservée** : les migrations du socle, de l'outil
  d'exemple et du moteur sont réécrites en anglais sur place, une seule fois,
  par exception à « expansion seule » (ADR-019) et à l'immuabilité des
  migrations (ADR-004) ; les noms de l'infrastructure en service (projets
  Compose, unités systemd, chemins des VM, noms Gitea et Keycloak, fichiers
  du coffre) sont renommés directement et le labo est reconstruit de zéro :
  pas de migration de renommage, pas de mise à jour des données, pas d'alias.
- **Nom du produit** : hors périmètre ; le nom actuel et les identifiants
  construits dessus sont changés par une passe de renommage distincte.

## Alternatives écartées
- Garder le français dans le code, ne traduire que les documents — les
  identifiants, les valeurs stockées et les messages restent illisibles pour
  les contributeurs.
- L'anglais pour le texte nouveau seulement (la règle du 2026-10-20) — les
  fichiers mélangent les deux langues indéfiniment, et un nom traduit à une
  extrémité casse ses autres extrémités.
- Traduire chaque zone sans correspondance partagée — un même mot français
  reçoit plusieurs noms anglais dans des zones dont les noms doivent
  concorder.
- Une migration de renommage des bases, avec une mise à jour des données
  après avoir vidé les workflows en cours — elle garde l'historique français
  dans chaque base et casse « expansion seule » sur chaque installation,
  pour préserver des données que personne ne garde.
- Renommer les noms en service un par un, avec une étape de migration Ansible
  et des copies de volumes — le même travail, pour un état du labo que la
  reconstruction remet à zéro.
- Traduire `docs/reflexions/` — 117 fichiers, 23 659 lignes de notes de
  travail privées qui ne seront pas publiées.

## Conséquences
- Un seul grand changement, ponctuel, dans toutes les zones, découpé selon
  les couplages plutôt que selon les répertoires ; le labo est reconstruit de
  zéro et tout ce qui y est stocké ou publié est perdu volontairement (bases,
  dépôts d'outils créés depuis l'ancien template, versions publiées du
  socle) ; les valeurs des secrets sont saisies de nouveau.
- Les ADR acceptés sont traduits une fois sur place (ADR-026) : le gel de
  leur texte est rompu une fois.
- Les contributeurs lisent et écrivent une seule langue ; les utilisateurs
  francophones gardent des écrans, des mails et des documents clés en
  français grâce aux traductions, qui peuvent être en retard sur l'anglais.
- Chaque texte pour l'utilisateur final passe par un dictionnaire : deux
  fichiers par texte, et une clé dérivée d'un texte rendu (la
  déduplication des mails du moteur utilise le sujet) doit utiliser la clé
  du message à la place.
- Limite : le contrôle utilise des listes de mots, pas un détecteur de
  langue ; une phrase française faite seulement de mots non listés et
  d'homographes anglais lui échappe, et une ligne anglaise qui cite un mot
  français listé doit être autorisée avec une raison.

## Vérification
`.github/scripts/check-english.py`, testé par `test_check_english.py`,
signale chaque ligne suivie qui contient encore du français : une lettre
accentuée ou un guillemet français, des mots-outils français, un mot
français de la table de mots du glossaire, seul ou dans un identifiant, un
nom composé français du glossaire. Autorisés : les traductions françaises,
les notes privées, les dictionnaires français et les entrées de
`check-english-allow.txt`, chacune avec une raison. Un workflow
`english.yml` l'exécutera à chaque push et pull request, sans filtre de
chemins, sur les lignes ajoutées depuis le commit de base et sur tout le
dépôt ; l'analyse complète échouera tant qu'une ligne française restera hors
des chemins autorisés. Non vérifiable mécaniquement : la qualité d'une
traduction, les choix anglais au-delà du glossaire, l'orthographe
britannique, la concordance d'une traduction française avec son document
anglais.
