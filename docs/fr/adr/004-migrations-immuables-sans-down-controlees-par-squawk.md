---
adr: 004
title: Migrations immuables, sans Down, contrôlées par Squawk
status: proposé
date:
decision-makers: Ilan
supersedes:
related: [ADR-002, ADR-003]
controle: partiel
---
## Contexte
Des agents, parfois en parallèle, font évoluer la base des outils avec
node-pg-migrate. Risques : un DDL qui attend un verrou bloque l'outil ; une
migration modifiée après application laisse des bases différentes sous un
même numéro ; un « Down » jamais exécuté ne marche pas le jour venu ; deux
branches prennent le même numéro. Mesuré (node-pg-migrate 9.0.0) :
`checkOrder` refuse un fichier rangé avant un fichier déjà appliqué, pas
l'inverse ; le SQL tourne toujours en transaction, hors transaction seulement
en JavaScript (`pgm.noTransaction()`), où `SET LOCAL` est sans effet. Squawk
(Apache 2.0) signale les instructions dangereuses. Sources :
`docs/reflexions/recherche-2026-10-11/brut/K-experiences-bdd.md`,
`docs/reflexions/2026-10-13-adr-details.md`.

## Décision
Écrire les migrations des outils comme des fichiers SQL immuables, sans
retour arrière, contrôlés par Squawk.
- **Fichiers** `db/migrations/NNNN_intention.sql` (4 chiffres, une intention),
  immuables une fois sur la branche principale, sans `-- Down Migration`,
  `SET LOCAL lock_timeout` et `statement_timeout` en tête. Numéro déjà pris :
  la branche fusionnée en second renumérote avant sa fusion.
- **Squawk** : `.squawk.toml` protégé ; `prefer-robust-stmts` et
  `require-concurrent-index-*` désactivées, les autres bloquantes (dont
  `ban-drop-*`, `renaming-*`) ; `squawk-ignore` interdit hors exception.
- **Expand/contract** : ajouter le nouveau en gardant l'ancien ; supprimer ou
  renommer dans un cycle ultérieur, par un fichier `NNNN_contract-intention.sql`
  qu'analyse une configuration Squawk dédiée, protégée, qui ne permet en plus
  que suppression et renommage. Le champ a quitté le contrat OpenAPI dans un
  cycle antérieur ; les tests d'acceptation passent sur la base migrée ; le
  fichier exige sa ligne dans `.gitea/exceptions.txt`, écrite par un humain
  par la voie des exceptions (branche `exception/**` qu'il fusionne).
- **Exception non transactionnelle** (index sur une grosse table) :
  `NNNN_intention.js` avec `pgm.noTransaction()` et seulement
  `SET lock_timeout = '5s'`, un seul `CREATE` ou `DROP INDEX CONCURRENTLY`,
  `RESET lock_timeout` ; pas de `statement_timeout` ; ligne du registre exigée.

## Alternatives écartées
- Down obligatoire — jamais testé, et déclenche `ban-drop-*` partout.
- `squawk-ignore` sur les suppressions — l'agent le poserait n'importe où.
- `CONCURRENTLY` pour tout index — interdit en transaction, inutile sur une
  petite table ; l'exception `.js` couvre la grosse.
- Refuser un `-contract-` si le nom reste dans le code — faux sur `name`,
  `status`…, aveugle aux noms dynamiques : simple aide au relecteur.
- `SET LOCAL` dans l'exception `.js` — sans transaction, ignoré.
- Horodatage au lieu du numéro — ordre d'écriture et non de fusion :
  `checkOrder` refuserait en production plutôt qu'en revue.

## Conséquences
- Un fichier appliqué ne change plus ; `checkOrder` refuse au déploiement une
  migration rangée avant la dernière appliquée. Deux agents en parallèle
  prennent le même numéro : le contrôle de diff le voit avant la fusion, le
  second renumérote et repasse la CI.
- Expand/contract n'est pas un retour arrière : revenir, c'est une nouvelle
  migration. Une migration qui abîme des données ne se répare que par
  restauration, avec la perte depuis la sauvegarde (24 h en standard, ADR-002).
- Chaque suppression ou renommage passe par un humain : voulu. La ligne du
  registre expire (un an au plus) sans rien casser, seuls les fichiers
  nouveaux étant contrôlés.
- Sans `CONCURRENTLY`, un index verrouille les écritures pendant sa
  construction (négligeable sur une petite table ; `lock_timeout` échoue
  plutôt que bloquer). Un `CONCURRENTLY` raté laisse un index invalide à
  supprimer.

## Vérification
Dans la CI de chaque outil :
- Squawk analysera tout fichier nouveau de `db/migrations/` (configuration
  générale, ou dédiée pour un `-contract-`) ; le job des garde-fous refusera un
  `squawk-ignore` sans ligne du registre ;
- un contrôle de diff refusera une migration de la branche principale
  modifiée ou supprimée, un numéro pris, un Down, un SQL sans
  `SET LOCAL lock_timeout` en tête, un `-contract-` ou `.js` nouveau sans
  ligne dans `.gitea/exceptions.txt` (lu sur la branche principale), et un
  `.js` hors des trois instructions permises ;
- pour un `-contract-`, oasdiff (Apache 2.0) refusera un retrait de champ du
  contrat dans la même PR, et les tests d'acceptation sur la base migrée
  échoueront si l'API lit encore la colonne, sur les routes couvertes ;
- un test du kit appliquera les migrations depuis zéro sur une base jetable.
