# Règles backend

> Traduction destinée aux lecteurs humains ; la version anglaise `.claude/rules/backend.md` fait foi.

Les handlers et les données du builder. L'outil de référence (`api/`, `db/`) montre chaque façon de faire.

## Handlers
- Un fichier par opération, `api/<operationId>.js`, qui exporte
  `async (ctx) => ({ status, body })`. `ctx` contient les `params`, `query`
  et `body` validés, la `session` (`actorId`, `roles`), `log`, `db.tx` et
  `fetch`. `api/lib/` ne contient que le code partagé de cet outil.
- Ne réponds que ce que le contrat déclare : un statut ou un champ non déclaré échoue à l'exécution.
- Un corps de fichier arrive en `ctx.body = { type, body }` ; un téléchargement
  rend `{ status: 200, file: { name, type, body } }`.

## Données
- Jamais de lecture puis écriture pour un compteur, un quota ou un statut : une
  instruction atomique, ou `SELECT … FOR UPDATE` dans la même transaction.
- Les invariants vivent aussi dans le schéma : `CHECK`, clés uniques et
  étrangères, déclencheurs pour les changements de statut autorisés.
- L'historique est en ajout seul et écrit par la base ; la suppression est
  logique (`deleted_at`) avec une restauration ; `db/purge.sql` efface ce que la conservation permet.
- Les migrations sont des fichiers SQL numérotés sous `db/migrations/`.

## Configuration
- Les réglages propres à l'outil sont des variables d'environnement, aucune
  avec une valeur par défaut pour un secret ou une durée de conservation,
  listées dans `.env.example` et `README.md`.
- Les liens absolus sont construits depuis `APP_URL`, jamais depuis la requête.

## Intégrations
- Un autre système seulement par son API documentée et authentifiée, via `ctx.fetch` ; jamais sa base.
