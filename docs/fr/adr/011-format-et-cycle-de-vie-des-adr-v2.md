---
adr: 011
title: Format et cycle de vie des ADR, v2
status: remplacé par ADR-026
date: 2026-10-13
decision-makers: Ilan
supersedes: ADR-000
related:
controle: en-place
---
## Contexte
Un ADR (Architecture Decision Record) enregistre une décision de la
plateforme : quoi, quand, pourquoi, ce qui a été écarté. Il n'a de valeur que
s'il n'est pas réécrit après coup ; d'où la règle d'ADR-000 : un ADR accepté
ne change plus, on le remplace par un nouveau. Deux relectures critiques, le
2026-10-13, ont montré ses défauts : des ADR qui renvoient ailleurs au lieu
d'expliquer (faux le jour où la source change) ; de l'état d'avancement dans
le corps, qui devient faux une fois figé, sans moyen de voir si le contrôle
promis existe ; une date ambiguë sur un ADR proposé, modifiable pour
repousser l'alerte des 30 jours ; des propositions qui traînent, mais un
contrôle qui punirait une PR sans rapport ; un contrôle incomplet (`related`
modifiable, remplaçant jamais accepté, « # » qui tronquait une valeur,
force-push sur la branche principale comparé à lui-même). Le dépôt, privé et
gratuit jusqu'à sa publication, n'a pas de protection de branche : seule la
CI, après le push, peut signaler. Détail :
`docs/reflexions/2026-10-13-adr-details.md`.

## Décision
Chaque décision de la plateforme EupaDev est un ADR autonome et immuable
dans `docs/adr/`, selon les règles suivantes.
- **Lieu** : `docs/adr/NNN-titre-kebab.md`, `NNN` séquentiel sur 3 chiffres,
  jamais réutilisé, fichier jamais renommé. Décisions de plateforme seulement
  (un outil généré a son `docs/DECISIONS.md`).
- **Format** : frontmatter plat et sections de `docs/adr/gabarit.md` (Contexte,
  Décision, Alternatives écartées, Conséquences, Vérification ; **Rejet**,
  facultative, écrite dans le commit qui rejette). Un ADR remplacé ne reçoit
  pas de section. Commentaire du frontmatter seulement en début de ligne.
- **Autonome et court** : décision, contexte et raisons écrits dans l'ADR,
  en une page environ ; une note peut être citée comme source et recevoir le
  détail (mesures, citations), jamais servir d'explication (« voir §… »).
- **Pas d'état d'avancement dans le corps** (« fait le… », « à ce jour »,
  bloquants) : la Vérification décrit le mécanisme, au futur s'il n'existe pas
  encore ; l'avancement vit dans `ROADMAP.md`.
- **`controle`** : `en-place`, `partiel`, `prévu` ou `aucun` ; obligatoire,
  seul champ qui change encore après l'acceptation. **Déclaratif** : la CI
  vérifie sa présence et sa valeur, la relecture humaine sa justesse. Écrit
  seulement dans l'ADR, repris par le registre, pas répété dans `ROADMAP.md`.
- **Date** = date de la décision : vide tant que `proposé`, remplie à
  l'acceptation ou au rejet, jamais future.
- **Statuts** : `proposé` → `accepté` ou `rejeté` ; `accepté` →
  `remplacé par ADR-NNN` ou `retiré`.
- **Acceptation** : un décideur de `decision-makers` relit l'ADR (autonomie,
  pas d'avancement, vérification honnête) puis l'accepte dans un commit dédié
  « Accepter ADR-NNN » qui ne change que le statut et la date.
- **Pas de proposition qui traîne** : un ADR `proposé` depuis plus de 30 jours,
  comptés depuis le commit qui ajoute le fichier, est signalé par un ticket
  unique tenu par un workflow hebdomadaire ; aucune PR n'est bloquée.
- **Immuabilité** : hors `proposé`, titre et corps figés (fautes comprises),
  ainsi que `adr`, `date`, `decision-makers`, `supersedes`, `related` ; seuls
  le statut (transitions ci-dessus) et `controle` évoluent. Un ADR `proposé`
  se modifie librement, sauf son nom de fichier.
- **Remplacement** : Y déclare `supersedes: ADR-X` ; X passe à
  `remplacé par ADR-Y` seulement si Y est accepté, dans le même commit.
- **Jamais supprimé** ; **registre** généré dans `ROADMAP.md` entre
  `<!-- registre-adr:debut -->` et `<!-- registre-adr:fin -->`
  (`verifier-adr.py --ecrire`), jamais écrit à la main.
- **Application immédiate** : la CI applique cette règle dès son arrivée sur
  la branche principale, avant l'acceptation de cet ADR (sinon les ADR en
  cours n'auraient pas de garde-fou) ; rejetée, elle ramènerait le contrôle à
  ADR-000.

## Alternatives écartées
- Corriger ADR-000 en place — il est accepté, donc figé par sa propre règle.
- Tolérer les « corrections minimes » — zone grise (« peut » → « veut ») ;
  seule la règle stricte se contrôle sans jugement.
- Avancement dans le corps — il change, l'ADR non : l'un des deux ment.
- `controle` recopié dans `ROADMAP.md`, ou vérifié contre le dépôt — deux
  copies qui ne prouvent que leur accord, ou une deuxième description par ADR.
- Dater un ADR proposé, ou compter les 30 jours depuis la date de l'auteur
  (`%as`) — l'une et l'autre se fixent librement et repoussent l'alerte.
- Faire échouer les PR après 30 jours — punit une PR sans rapport ; sans
  limite du tout, rien n'est jamais tranché (30 jours est un choix).
- `related` libre après acceptation — le lien nouveau va dans l'ADR récent.
- adr-tools, log4brains — sans release depuis 2018 et 2024, aucun ne refuse
  la modification d'un ADR accepté.

## Conséquences
- Changer d'avis coûte un nouvel ADR : voulu. Une faute reste ; si elle rend
  la décision ambiguë, elle appelle un remplacement.
- Un ADR se lit seul et reste juste quand la feuille de route change ; son
  détail sourcé est dans une note, qui peut évoluer sans lui.
- Le registre montre les contrôles absents (`prévu`, `partiel`), mais
  **`controle` peut être faux sans que la CI le voie** : seule la relecture,
  à l'acceptation et à chaque changement du champ, le rattrape.
- Un ADR écrit après coup arrive directement `accepté` ou `rejeté`, daté.
- Le ticket des propositions est un rappel (au plus une semaine de retard),
  pas une contrainte. Une branche rebasée avant fusion repart de la date du
  rebase ; sur la branche principale, la date ne bouge plus.
- **« Refusé » veut dire « CI rouge »** tant que le dépôt n'a pas de
  protection de branche : un push qui modifie un ADR accepté, ou dont le
  commit précédent est introuvable, est fait puis signalé, et doit être
  défait. Les protections, à la publication, rendront le refus effectif.

## Vérification
`.github/scripts/verifier-adr.py`, testé par `test_verifier_adr.py` et lancé
par `.github/workflows/adr.yml` à chaque push et PR qui touche un ADR,
`ROADMAP.md` ou le contrôle, compare l'arbre au commit de base (base de la PR,
sinon commit précédent du push, sinon point de départ depuis la branche
principale ; sur elle, base introuvable = CI rouge). Il fait échouer la CI
sur : un ADR supprimé ou renommé ; hors `proposé`, un champ figé, le titre ou
le corps modifié, ou une transition de statut interdite ; un numéro en double
ou différent du nom de fichier, un statut inconnu ; une date sur un ADR
`proposé`, ou absente, mal formée ou future ailleurs ; un `controle` inconnu,
ou absent d'un ADR proposé, nouveau ou qui quitte `proposé` ; un
remplacement incohérent (sans `supersedes` en face, remplaçant `proposé` ou
`rejeté`, ancien non marqué) ; un registre différent de celui généré.
`.github/workflows/adr-propositions.yml`, hebdomadaire et manuel, appelle
`verifier-adr.py --propositions` et ouvre, met à jour ou ferme le ticket
unique, avec un jeton limité à `issues: write`. Non vérifiable
mécaniquement : l'autonomie, l'absence d'avancement, la justesse de
`controle`, le tableau d'avancement de `ROADMAP.md` et la relecture avant
acceptation (le commit « Accepter ADR-NNN » montre qui et quand, pas que la
relecture a eu lieu).
