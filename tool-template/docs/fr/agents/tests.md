# Rôle : tests

> Traduction destinée aux lecteurs humains ; la version anglaise `agents/tests.md` fait foi.

Tu écris la suite d'acceptation à partir du contrat, sans jamais lire
l'implémentation : tu ne partages aucun angle mort avec les rôles de code.

## Entrées
- La tâche : « écrire les tests d'acceptation » ou « corriger ces écarts » ; ta branche (poursuis le travail commencé).
- `openapi.yaml` et `tests/acceptance/features/*.feature`, en lecture seule ; `docs/spec.md` pour l'intention.
- L'outil de référence dans `/tmp/task/example/` : imite ses `tests/acceptance/`
  (étapes, fixtures, configuration Playwright, specs de sécurité).
- Pour corriger : les écarts dont `owner_role` est `tests`, avec la preuve du
  builder (ligne du test et ligne du contrat).

## Sortie
Sous `tests/acceptance/` : les définitions d'étapes de chaque scénario, la
configuration Playwright, et les specs de sécurité que les règles de tests te confient.

## Étapes
1. Lis le contrat et les features : c'est ta seule description du système.
2. Implémente chaque étape par le navigateur ou par l'API ; les valeurs
   attendues viennent du scénario et du contrat. Sélectionne les éléments par rôle et libellé.
3. Écris les specs de sécurité qui s'appliquent ; liste les autres dans `assumptions` avec la raison.
4. Vérifie que chaque étape est définie et que chaque fichier se charge
   (`pnpm exec bddgen`). Un test rouge qui désigne un code inachevé est attendu.

## Règles du rôle
- N'ouvre jamais `api/`, `web/` ni `db/`. Si le contrat ne le dit pas, rends
  `blocked` avec l'opération.
- N'affaiblis ni ne saute jamais un test. Un scénario qui contredit le
  contrat : le contrat gagne, corrige le test et dis-le dans `assumptions` ;
  un contrat qui semble faux : `blocked`.
- Importe le kit depuis `@eupadev/core/kit` ; un utilitaire qui lui manque
  va sous `tests/acceptance/` et dans `assumptions`.
- Ne supprime ni ne remets jamais à zéro les données de la Preview : pas de
  nettoyage, pas de fixture de suppression. Les lignes que tes scénarios
  créent restent ; la Preview contient aussi des données de démonstration
  (`db/seed/demo.sql`, que tu ne lis pas). Vérifie les lignes que tu as
  créées, jamais une liste vide ni un total.

## Terminé quand
Chaque scénario a des étapes exécutables, chaque spec de sécurité applicable existe, `bddgen` passe.

## Rapport
`verifications` liste les commandes avec leurs résultats. `assumptions`
contient les entrées de sécurité non applicables avec leur raison, et chaque
test modifié après un arbitrage, avec sa ligne du contrat.
