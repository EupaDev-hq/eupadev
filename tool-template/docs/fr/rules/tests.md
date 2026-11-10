# Règles de tests

> Traduction destinée aux lecteurs humains ; la version anglaise `.claude/rules/tests.md` fait foi.

## Outillage et arborescence
- Tests unitaires : `node --test` sous `tests/unit/`, par le propriétaire du code.
- Acceptation : Playwright et playwright-bdd sous `tests/acceptance/`, comme l'outil de référence.
- Importe le kit, `@eupadev/core/kit` (deux utilisateurs, navigateur) ; ne le copie jamais.
- Gherkin seulement pour un comportement qu'un demandeur lit.

## Exécution
- Face à l'image dans la pile du socle, en se connectant par le vrai formulaire de connexion.
- Chaque scénario crée ses propres données et ne supprime jamais celles de la Preview.
- Chaque page visitée passe axe ; erreurs de page et violations de CSP font échouer.

## Catalogue des scénarios de sécurité
Générés à partir du contrat par la plateforme, jamais à la main :
- **SEC-AUTH** — sans session → 401.
- **SEC-ROLE** — rôle le moins privilégié → 403, rien d'écrit.
- **SEC-VALID** — corps ou requête invalide → 400 `VALIDATION_FAILED`.
- **SEC-MASS** — clé inconnue → 400.
- **SEC-CSRF** — écriture intersite → 403.
- **SEC-HEAD** — en-têtes de sécurité, valeurs exactes.
- **SEC-COOKIE** — attributs du cookie de session.
- **SEC-RATE** — limite + 5 en parallèle → 429 avec `Retry-After`.
- **SEC-ERR** — panne provoquée → 500, aucun détail interne.
- **SEC-STATIC** — fichiers sources → 404.
- **SEC-BYPASS** — marqueurs de test → 401.
- **SEC-UPLOAD** — fichier mauvais, déguisé ou trop gros → 415 ou 413.

Écrits par le rôle tests quand ils s'appliquent :
- **SEC-IDOR** — l'utilisateur A sur la ligne de B (`kit/two-users.js`) → 404, B inchangé.
- **SEC-URL** — un lien copié ouvert anonymement ou par un autre utilisateur → refusé.
- **SEC-XSS** — `<img src=x onerror=…>` enregistré puis affiché → ne s'exécute jamais.
- **SEC-SQLI** — `' OR '1'='1` dans un filtre et un identifiant → jamais 500 ni toutes les lignes.
- **SEC-REDIR** — cibles de redirection externes → `/`.
- **SEC-SSRF** — URL privées ou non listées → 400, rien n'est récupéré.
- **SEC-PATH** — noms avec remontée de dossier → 400 ou 404.
