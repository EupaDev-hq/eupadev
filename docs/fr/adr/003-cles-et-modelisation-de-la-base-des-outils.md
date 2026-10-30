---
adr: 003
title: Clés et modélisation de la base des outils
status: proposé
date:
decision-makers: Ilan
supersedes:
related: [ADR-002, ADR-004]
controle: prévu
---
## Contexte
Des agents écrivent, cycle après cycle, le schéma de la base PostgreSQL de
chaque outil. Sans règles communes, les erreurs connues se répètent
(identifiant interne exposé, unicité qui empêche de recréer une ligne
supprimée, valeur impossible à retirer d'une liste). Ces bases gardent des
données personnelles : le RGPD exige une durée de conservation fixée par le
client et son DPO, et un identifiant rattachable à une personne (par
l'annuaire) reste une donnée personnelle pseudonymisée. Un audit en ajout seul
qui recopierait des noms devrait être gardé pour toujours ou réécrit.
PostgreSQL 18 fournit `uuidv7()` : préfixé par l'heure à la milliseconde,
strictement croissant dans une connexion, sans ordre garanti entre deux.
Sources : `docs/reflexions/recherche-2026-10-11/06-modelisation-et-adr-fable.md`,
`docs/reflexions/2026-10-13-adr-details.md` (PostgreSQL, RGPD, Code civil).

## Décision
Modéliser la base de chaque outil généré selon les règles suivantes.
- **Clés** : entités du contrat en `id uuid DEFAULT uuidv7()`, seul
  identifiant interne et public ; tables en ajout seul en `bigint` identity ;
  référentiels à code en clé `text`. PostgreSQL 18 minimum.
- **Nommage** anglais, `snake_case`, tables au pluriel, `<singulier>_id`.
  **Colonnes** `timestamptz`, `created_at`, `updated_at`, `deleted_at`,
  `deleted_by`, `version bigint` ; `updated_at` et `version` par un trigger.
- **Types** : listes fermées en `CHECK (... IN ...)`, jamais `ENUM` ; `jsonb`
  pour les objets libres du contrat et les événements sortants seulement.
- **Contraintes** : unicités partielles `WHERE deleted_at IS NULL` ; audit en
  `SELECT, INSERT` pour le compte applicatif. Listes triées `created_at, id`.
- **Données personnelles à part** (noms, coordonnées, textes libres), dans des
  tables référencées par identifiant : suppression logique, puis purge
  planifiée réelle (supprimé logiquement ou durée dépassée).
- **Audit sans donnée personnelle en clair** : `actor_id` (identifiant OIDC
  stable), entités, action, horodatage, listes fermées ; ni nom, ni texte
  libre, ni `jsonb`. Jamais modifié, même à la purge d'une personne. C'est une
  pseudonymisation, pas une anonymisation.
- **Durées** fixées par le client et son DPO pour chaque catégorie, et deux
  pour les traces : le **journal de traçabilité** `audit_log` (qui a fait
  quoi, quand ; 6 à 12 mois proposés, recommandation de la CNIL sur la
  journalisation) et l'**historique métier** `<entité>_history` (états
  successifs ; 5 ans proposés, prescription de droit commun) : questions
  obligatoires de la Gate 1, paramètres sans valeur par défaut (décision
  d'Ilan du 2026-10-19, R12 de la recherche sur le socle).
- **Compte de purge** dédié : supprime des lignes, ne modifie jamais l'audit.

## Alternatives écartées
- `bigint` + identifiant public séparé — jointures doublées, « mauvais exposé ».
- `uuid` v4 — ne se trie pas par date, disperse les insertions dans l'index.
- `ENUM` — ne sait ni retirer ni renommer une valeur.
- `UNIQUE` pleine avec suppression logique — bloque la recréation.
- Suppression physique directe — aucune restauration après une erreur.
- Audit gardé pour toujours — il reste une donnée personnelle.
- Noms dans l'audit effacés par `UPDATE` — casse l'ajout seul, et ne fait
  qu'une pseudonymisation.
- Effacer l'audit d'une personne à sa purge — perd « qui a validé quoi ».
- Durée par défaut silencieuse — décide à la place du responsable du
  traitement.

## Conséquences
- Un seul identifiant partout (URL, `If-Match`, audit, autre outil), unique,
  trié par temps, non énumérable en pratique.
- **Limites de `uuidv7`** : il révèle l'heure de création (exception validée,
  `uuid` aléatoire, si elle est sensible) ; son ordre n'est strict que par
  connexion, d'où le tri `created_at, id` et le `bigint` des journaux.
- PostgreSQL 18 exclut un PostgreSQL plus ancien de la DSI : la base vit sur
  celui de la VM, tenu par EupaDev.
- **Purge** : une ligne purgée ne revient que d'une sauvegarde, et les
  sauvegardes comptent dans la durée réelle de conservation ; un compte et
  une tâche de plus par outil.
- **L'audit reste une donnée personnelle** tant qu'il est gardé (registre des
  traitements) ; l'annuaire peut encore nommer un acteur purgé.
- La Gate 1 d'un outil à données personnelles attend souvent le DPO : délai
  voulu.

## Vérification
Un test du kit appliquera les migrations sur une base PostgreSQL 18 jetable
et interrogera le catalogue : `uuidv7()` par défaut, ni `ENUM` ni `timestamp`
sans fuseau, colonnes et trigger du socle, unicités partielles, droits
d'audit (`SELECT, INSERT` applicatif ; `SELECT, DELETE`, jamais `UPDATE`, pour
la purge), audit sans `jsonb` ni texte hors liste fermée et `actor_id`. Une
règle Opengrep refusera `serial`, `gen_random_uuid()` et `uuid_generate_v4()`
hors exception. Un test de purge, exigé de chaque outil, vérifiera ce qui
disparaît et que le reste de l'audit est identique octet pour octet.
L'orchestrateur refusera une Gate 1 sans durées. Nommage, tri, usage de
`jsonb` et classement des colonnes personnelles ne se vérifient qu'en partie ;
le reste revient au relecteur qualité, la valeur des durées au client.
