---
adr: 026
title: Format et cycle de vie des ADR, v3
status: accepted
date: 2026-10-28
decision-makers: Ilan
supersedes: ADR-011
related: [ADR-025]
check: planned
---
> Traduction destinée aux lecteurs humains. La version anglaise `docs/adr/026-adr-format-and-lifecycle-v3.md` fait foi.

## Contexte
Un ADR (Architecture Decision Record) enregistre une décision de la
plateforme : quoi, quand, pourquoi, et ce qui a été écarté. Il n'a de valeur
que s'il n'est pas réécrit après coup. ADR-011 (accepté le 2026-10-13) fige
donc le titre et le corps de tout ADR qui a quitté le statut proposé, fautes
de frappe comprises, interdit de renommer un fichier d'ADR, et est appliqué
par un script de CI qui compare chaque ADR au commit de base et génère le
registre des ADR de `ROADMAP.md`. ADR-011 écrit son vocabulaire en
français : statuts, champ de contrôle et ses valeurs, titres de sections,
marqueurs du registre. ADR-025 fait de l'anglais la langue d'origine du
dépôt, avec une traduction française pour les documents lus hors de
l'équipe, ADR compris. Le 2026-10-28, 22 des 25 ADR sont écrits en français
et 3 en anglais avec des statuts et des titres de sections en français ; 17
ont quitté le statut proposé et sont figés ; 23 noms de fichiers sont en
français ou portent un mot français, et apparaissent dans des liens et dans
le registre. Le vérificateur d'ADR-011 refuse tout changement d'un titre ou
d'un corps figé et tout renommage, donc une traduction a besoin d'une
exception explicite ; il date aussi une proposition par le commit qui a
ajouté le fichier sans suivre les renommages, donc un renommage relancerait
le décompte des 30 jours. Source :
`docs/reflexions/2026-10-20-note-english-switch.md`.

## Décision
Chaque décision de la plateforme EupaDev est un ADR autonome et immuable
dans `docs/adr/`, écrit en anglais, selon les règles suivantes.
- **Lieu** : `docs/adr/NNN-kebab-title.md`, `NNN` séquentiel sur 3 chiffres,
  jamais réutilisé ; le fichier n'est jamais renommé, sauf une fois par la
  traduction ci-dessous. Décisions de plateforme seulement (un outil généré a
  son propre `docs/DECISIONS.md`).
- **Format** : frontmatter plat et sections de `docs/adr/template.md` :
  Context, Decision, Rejected alternatives, Consequences, Verification ;
  **Rejection**, facultative, écrite dans le commit qui rejette. Un ADR
  remplacé ne reçoit pas de section. Commentaires du frontmatter seulement en
  début de ligne.
- **Langue** (ADR-025) : l'anglais, qui fait foi. La traduction française
  d'un ADR se trouve sous `docs/fr/adr/` avec le nom de fichier anglais ; elle
  n'est pas figée et peut être corrigée. Les originaux français copiés par la
  traduction ci-dessous y gardent leur nom de fichier d'origine et ne sont pas
  modifiés.
- **Autonome et court** : décision, contexte et raisons écrits dans l'ADR,
  en une page environ ; une note peut être citée comme source et contenir le
  détail (mesures, citations), jamais servir d'explication.
- **Pas d'état d'avancement dans le corps** (« fait le », « à ce jour »,
  bloquants) : la section Verification décrit le mécanisme, au futur s'il
  n'existe pas encore ; l'avancement vit dans `ROADMAP.md`.
- **`check`** : `in-place`, `partial`, `planned` ou `none` ; obligatoire, seul
  champ qui change encore après l'acceptation. Déclaratif : la CI vérifie sa
  présence et sa valeur, la relecture humaine sa justesse. Écrit seulement
  dans l'ADR, affiché par le registre.
- **Date** = date de la décision : vide tant que proposé, remplie à
  l'acceptation ou au rejet, jamais dans le futur.
- **Statuts** : `proposed` → `accepted` ou `rejected` ; `accepted` →
  `superseded by ADR-NNN` ou `withdrawn`.
- **Acceptation** : un décideur de `decision-makers` relit l'ADR (autonomie,
  pas d'avancement, vérification honnête), puis l'accepte dans un commit
  dédié « Accept ADR-NNN » qui ne change que le statut et la date.
- **Pas de proposition qui traîne** : un ADR proposé depuis plus de 30 jours,
  comptés depuis le commit qui a ajouté le fichier, renommages suivis, est
  signalé par un ticket unique tenu par un workflow hebdomadaire ; aucune pull
  request n'est bloquée.
- **Immuabilité** : dès qu'un ADR n'est plus proposé, son titre et son corps
  sont figés (fautes de frappe comprises), ainsi que `adr`, `date`,
  `decision-makers`, `supersedes`, `related` ; seuls le statut (transitions
  ci-dessus) et `check` changent. Un ADR proposé se modifie librement, sauf
  son nom de fichier.
- **Remplacement** : Y déclare `supersedes: ADR-X` ; X devient
  `superseded by ADR-Y` seulement quand Y est accepté, dans le même commit.
- **Jamais supprimé** ; le **registre** est généré dans `ROADMAP.md` entre
  `<!-- adr-registry:start -->` et `<!-- adr-registry:end -->` par le
  `--write` du vérificateur, jamais écrit à la main.
- **Traduction ponctuelle** : un seul commit, relu par Ilan avant d'être
  fait, (1) copie les ADR écrits en français, inchangés, dans
  `docs/fr/adr/` ; (2) traduit chaque ADR sur place en anglais : titre,
  corps, statuts, valeurs de `check`, titres de sections, noms cités selon
  `docs/glossary.md` ; (3) renomme les fichiers selon les noms anglais du
  glossaire ; (4) fait passer le template, le vérificateur et le registre à
  ce vocabulaire ; (5) ajoute la traduction française des ADR écrits en
  anglais. Pour ce commit seulement, le vérificateur fait correspondre les
  anciens noms de fichiers et le vocabulaire français de la base aux
  nouveaux, vérifie que numéros, statuts, champs figés et remplacements
  concordent toujours, et laisse changer titres et corps (la relecture couvre
  la traduction) ; la correspondance ne s'applique qu'à un fichier de la base
  qui a encore le vocabulaire français, donc ensuite tout changement du titre
  ou du corps d'un ADR accepté est de nouveau refusé.
- **Renommage ponctuel du produit** : le produit recevra un nouveau nom
  avant la publication. Un seul commit, relu par Ilan, remplace l'ancien nom
  du produit et les identifiants construits dessus (la famille
  `eupadev`/`EupaDev`) dans chaque ADR, figés compris, et peut renommer
  les fichiers qui le portent. Pour ce commit seulement, le vérificateur
  accepte un titre ou un corps figé dont les seules différences sont cette
  substitution : il remplace l'ancien nom par le nouveau dans le texte de la
  base et exige une correspondance exacte ; toute autre différence est
  refusée comme avant.
- **Jusqu'au commit de traduction**, le vocabulaire et le vérificateur
  d'ADR-011 restent en vigueur pour tout ADR, celui-ci compris.

## Alternatives écartées
- Garder les ADR français figés et ajouter des traductions anglaises à côté
  (`docs/adr/en/`) — le texte qui fait foi resterait français, contre
  ADR-025, et citerait des noms qui n'existent plus dans le code.
- Remplacer chaque ADR figé par un ADR anglais — 17 nouveaux ADR qui
  répètent les mêmes décisions, chacun à accepter de nouveau, pour un simple
  changement de langue.
- Garder les noms de fichiers français — chaque lien et le registre
  porteraient des noms français, que `check-english.py` signale, pour
  toujours.
- Vocabulaire anglais pour les nouveaux ADR seulement — le vérificateur
  accepterait deux vocabulaires pour toujours.
- Modifier ADR-011 sur place — il est accepté, donc figé par sa propre règle.

## Conséquences
- La promesse « figé, fautes de frappe comprises » est rompue deux fois,
  ouvertement, chaque fois dans un seul commit relu (traduction, puis nom du
  produit) ; les originaux français restent lisibles sous `docs/fr/adr/` et
  dans l'historique.
- Une erreur de traduction trouvée dans un ADR accepté après ce commit
  reste, comme une faute de frappe ; si elle rend la décision ambiguë, un
  nouvel ADR le remplace.
- Changer d'avis coûte toujours un nouvel ADR : voulu.
- Les traductions françaises peuvent prendre du retard et se corrigent
  librement ; le texte anglais décide.
- Le registre montre les contrôles manquants (`planned`, `partial`), mais
  **`check` peut être faux sans que la CI le voie** : seule la relecture, à
  l'acceptation et à chaque changement du champ, le rattrape.
- Le ticket des propositions est un rappel (au plus une semaine de retard),
  pas une contrainte. Une branche rebasée avant la fusion repart de la date
  du rebase ; sur la branche principale, la date ne bouge plus.
- **« Refusé » veut dire « CI rouge »** tant que le dépôt n'a pas de
  protection de branche : un push qui modifie un ADR accepté est fait, puis
  signalé, et doit être défait ; les protections de branche rendront le refus
  effectif.

## Vérification
Le vérificateur des ADR, renommé `.github/scripts/verify-adr.py`, testé par
`test_verify_adr.py` et lancé par `.github/workflows/adr.yml` à chaque push
et pull request qui touche un ADR, `ROADMAP.md` ou le contrôle lui-même,
comparera l'arbre au commit de base (base de la pull request, sinon commit
précédent du push, sinon point de départ depuis la branche principale ; sur
la branche principale, pas de base = rouge). Il fera échouer la CI sur : un
ADR supprimé ou renommé hors de la correspondance de traduction ; hors
proposé, un champ figé, un titre ou un corps modifié, ou une transition de
statut interdite ; un numéro en double ou différent du nom de fichier ; un
statut inconnu ; une date sur un ADR proposé, ou absente, mal formée ou
future ailleurs ; un `check` inconnu, ou absent d'un ADR proposé, nouveau ou
qui quitte proposé ; un remplacement incohérent ; un registre différent de
celui généré. Ses tests couvriront la correspondance de traduction et la
substitution du nom du produit, et refuseront un changement ultérieur d'un
ADR accepté traduit ainsi que tout commit de renommage qui change plus que
le nom.
`.github/workflows/adr-proposals.yml`, hebdomadaire et manuel, appellera le
mode `--proposals` du vérificateur (âge compté avec `git log --follow`) et
ouvrira, mettra à jour ou fermera le ticket unique, avec un jeton limité à
`issues: write`. `check-english.py` signale les titres de sections ou le
vocabulaire en français dans un ADR. Non vérifiable mécaniquement : l'autonomie,
l'absence d'avancement, la justesse de `check`, la présence des sections, la
fidélité d'une traduction, les originaux français laissés intacts, et la
relecture avant acceptation (le commit « Accept ADR-NNN » montre qui et
quand, pas que la relecture a eu lieu).
