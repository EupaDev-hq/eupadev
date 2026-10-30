# Règles de sécurité (code)

> Traduction destinée aux lecteurs humains ; la version anglaise `.claude/rules/security.md` fait foi.

Le socle applique, à partir du contrat : les sessions OIDC et leur cookie,
`x-roles`, la validation fermée, la protection CSRF (`Sec-Fetch-Site` et un
en-tête fixe), les limites de débit, les en-têtes de sécurité, les erreurs
problem+json, les fichiers statiques et les types d'envoi de fichiers. Ta
part est ce que le contrat ne peut pas dire.

## Authentification et sessions
- `x-roles` dit qui peut appeler une opération, jamais à quelles lignes elle touche : c'est le travail du handler.
- Ni formulaire de connexion, ni contournement de test, ni route de test : il n'en existe aucun, même dans les tests.

## Requêtes
- Restreins chaque requête à l'appelant dans le SQL lui-même (propriétaire,
  ou règle de visibilité de l'outil de référence) ; hors périmètre répond 404 comme une ligne absente.
- SQL uniquement par `ctx.db.tx` avec des paramètres ; jamais une requête construite par du texte.
- Une cible de redirection est un chemin relatif de cet outil. Un appel sortant
  passe par `ctx.fetch` vers un hôte que nomme le contrat.
- Ni `eval`, ni `new Function`, ni commande shell construite par du texte ; identifiants et jetons issus de `crypto`.

## Réponses
- Chaque refus est `throw new Problem(statut, CODE, détail)` avec un code que
  liste le contrat ; jamais de message d'erreur, de pile ni de texte de la base.
- Journaux par `ctx.log` : des identifiants seulement, ni donnée personnelle, ni secret, ni corps complet.

## Fichiers statiques et code du navigateur
- Le texte atteint la page par `textContent` ou le module de rendu du socle ;
  jamais `innerHTML` avec des données, ni script ou style en ligne (la CSP et
  Trusted Types les refusent).
- Aucune clé tierce dans ce qui est servi ; un appel qui en a besoin passe par une opération.

## Envois de fichiers
- Les types et la taille acceptés sont déclarés dans le contrat (`x-max-bytes`) ;
  le handler ne décide que qui et quand. Un téléchargement est toujours une pièce jointe.
