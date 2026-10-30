---
adr: 000
title: Format et cycle de vie des ADR
status: remplacé par ADR-011
date: 2026-10-12
decision-makers: Ilan
supersedes:
related:
---
## Contexte
Les décisions de la plateforme sont dispersées dans `ROADMAP.md` §8, en prose
qu'on retouche au fil du temps : on ne sait plus ce qui a été décidé, quand,
ni ce qui a remplacé quoi. Un enregistrement de décision n'a de valeur que
s'il n'est pas réécrit après coup (ROADMAP §8.15, D-9 et D-10).

## Décision
Chaque décision de la plateforme EupaDev est un ADR immuable dans `docs/adr/`.
- **Lieu et nom** : `docs/adr/NNN-titre-kebab.md`, `NNN` séquentiel sur 3
  chiffres, jamais réutilisé ni renuméroté. Décisions de plateforme seulement :
  les choix d'un outil généré restent dans son `docs/DECISIONS.md`.
- **Format** : MADR allégé, frontmatter de `docs/adr/gabarit.md` et ses cinq
  sections (Contexte, Décision, Alternatives écartées, Conséquences,
  Vérification).
- **Statuts** : `proposé` → `accepté` ou `rejeté` ; `accepté` →
  `remplacé par ADR-NNN` ou `retiré` (plus d'objet, sans remplaçant).
- **Immuabilité** : le corps et le titre d'un ADR qui n'est plus `proposé` ne
  changent plus, même pour corriger une faute de frappe (les fautes restent). Pour
  changer une décision, on écrit un nouvel ADR qui déclare
  `supersedes: ADR-NNN`, et l'ancien reçoit le statut `remplacé par ADR-MMM`.
  Un ADR `proposé` se modifie librement.
- **Jamais supprimé** : un ADR rejeté, retiré ou remplacé reste dans le dépôt.
- **Registre** : `ROADMAP.md` §8.11 contient un registre des ADR généré depuis
  les frontmatters ; on ne l'écrit jamais à la main.

## Alternatives écartées
- Tout garder en prose dans `ROADMAP.md` — rien n'empêche de réécrire une
  décision passée sans trace visible.
- adr-tools, log4brains — sans release depuis 2018 et 2024, et aucun ne
  refuse la modification d'un ADR accepté.
- Tolérer les corrections de fautes (règle « correction minime » mesurée en
  mots et en lettres) — zone grise : « peut » → « veut » passerait ; écarté
  par Ilan le 2026-10-12 au profit de la règle la plus simple.

## Conséquences
- Changer d'avis coûte un nouvel ADR : c'est voulu, l'historique reste lisible.
- Une faute reste ; si elle rend une décision ambiguë, elle appelle un ADR
  de remplacement.
- Le registre de §8.11 se régénère à chaque ajout ou changement de statut.

## Vérification
`.github/scripts/verifier-adr.py`, lancé par `.github/workflows/adr.yml` à
chaque push et PR, contre le commit de base. Il refuse :
- la suppression ou le renommage d'un ADR ;
- sur un ADR qui n'était pas `proposé` : un changement de `adr`, `date`,
  `decision-makers` ou `supersedes`, un statut autre que `accepté` →
  `retiré` / `remplacé par ADR-NNN`, et toute modification du titre ou du
  corps ;
- un numéro en double ou différent du nom de fichier, un statut inconnu ;
- un remplacement incohérent (`remplacé par ADR-Y` sans `supersedes` en face
  dans Y, ou ADR accepté qui remplace X sans que X soit marqué remplacé) ;
- un registre de `ROADMAP.md` §8.11 différent de celui généré.
