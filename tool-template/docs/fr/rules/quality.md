# Règles de qualité

> Traduction destinée aux lecteurs humains ; la version anglaise `.claude/rules/quality.md` fait foi.

## API
- Toute liste non bornée est paginée (`limit` 50 par défaut, 200 au plus, et
  un curseur), les deux écrits dans le contrat.
- Chaque colonne de tri ou de filtre d'une liste paginée a un index ; aucune requête dans une boucle.

## Données et migrations
- Une fois déployées, les migrations ne font qu'étendre : ajouter, basculer le code, retirer dans une version suivante.
- Chaque ligne d'historique enregistre qui a agi : l'acteur de la session, ou `system`.

## Données personnelles
- Les données personnelles vivent dans des tables dédiées, purgées avec leur
  entité ; l'historique ne garde que des identifiants et des valeurs de listes fermées, jamais de nom ni de texte libre.
- Chaque durée de conservation est une variable `RETENTION_*` lue par
  `db/purge.sql`, sans valeur par défaut, fixée à la Gate 1 ; n'en choisis jamais une.
- La purge et la restauration d'une ligne supprimée logiquement ont chacune un test.

## Dépendances
- Le lockfile vient de `pnpm install`, jamais modifié à la main. Licences de
  la liste autorisée seulement : MIT, BSD-2/3, Apache-2.0, ISC, MPL-2.0, 0BSD, CC0, BlueOak-1.0.0 (vérifié par la CI).

## Accessibilité
- Les pages principales passent un audit axe sans violation critique ni sérieuse (suite d'acceptation).

## Tests
- Un test de concurrence lance ses requêtes avec `Promise.all` ; aucun double
  de test pour ce qui peut tourner en CI.
