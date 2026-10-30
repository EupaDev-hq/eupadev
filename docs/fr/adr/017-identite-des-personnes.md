---
adr: 017
title: Identité des personnes, (émetteur, sujet) sous Keycloak, deux casquettes et quatre yeux
status: accepté
date: 2026-10-16
decision-makers: Ilan
supersedes:
related: [ADR-003, ADR-007]
controle: partiel
---
## Contexte
Le moteur enregistre qui agit dans des tables d'audit en ajout seul gardées
trois ans (`outils_historique`, `approbations`, `messages`). Jusqu'ici l'API
locale croyait le nom que l'appelant écrivait dans le corps (`acteur`,
`auteur`), la personne était désignée par son mail (`outils.demandeur`),
aucune gate ne contrôlait qui décidait, et une clé d'idempotence valait pour
tout le monde. Tant que seul Ilan appelle l'API par un tunnel SSH, ce n'est
pas un trou ; dès qu'un deuxième humain arrive, chaque ligne d'audit écrite
dans cette forme est perdue pour de bon (jamais réécrite) et chaque outil
généré copierait l'erreur classique « l'utilisateur, c'est son mail ».
Faits relevés le 2026-10-15 sur les sources primaires (Keycloak 26.8,
OpenID Connect Core 1.0 §5.7, RFC 9068, RFC 8725, RFC 9700) : seul le couple
`(iss, sub)` est stable et unique ; le mail change (mariage, fusion de
domaines) et se réattribue ; le `sub` Keycloak change dans des cas réalistes
(fédération LDAP sans import et renommage, suppression du composant de
fédération, restauration d'une sauvegarde antérieure, client recréé), ce qui
interdit une clé unique directement sur la table des personnes ; les rôles de
realm fuient dans tous les jetons alors que les rôles de client restent dans
l'audience ; un jeton d'accès RFC 9068 porte `typ: at+jwt`, et Keycloak ne le
pose que si on le lui demande par client. Détail et sources :
`docs/reflexions/2026-10-15-analyse-keycloak.md` (D1 à D15) et
`docs/reflexions/2026-10-15-note-identite-I0.md`.

## Décision
Désigner toute personne par un identifiant interne lié à sa clé OIDC
`(émetteur, sujet)`, Keycloak étant le seul émetteur, et faire porter les
droits par deux casquettes lues dans le jeton.
- **Table `acteurs`** (`id uuid`, genre humain ou machine, mail et nom
  comme attributs de contact rafraîchis à chaque requête, jamais clés) et
  **table de liaison en ajout seul** `acteurs_identites (emetteur, sujet) →
  acteur_id, depuis, motif`. Un sujet qui change se rattache par un INSERT
  d'un administrateur, avec son motif ; jamais par un UPDATE, jamais par le
  mail. Les tables d'audit portent `acteur_id` et gardent le nom affiché au
  moment des faits ; les lignes antérieures restent lisibles telles quelles.
- **Jeton d'accès vérifié par le moteur** : signature par le JWKS interne,
  `alg` dans une liste fermée (RS256, ES256), `typ: at+jwt`, `iss` égal à
  l'émetteur public figé (`https://auth.<domaine>/realms/eupadev`),
  `aud` contenant `eupadev-api`, non expiré ; un jeton lié à une clé
  (`cnf`) est refusé tant que la preuve n'est pas vérifiée. L'identité ne
  vient jamais du corps de la requête ; sans jeton, 401 ; sans casquette, 403.
- **Deux casquettes**, rôles du client `eupadev-api` lus dans
  `resource_access.eupadev-api.roles` et jamais stockés : `demandeur` et
  `admin`. Décision de gate et annulation exigent `admin` ; avis, abandon et
  message sont réservés au demandeur de l'outil (ou à un `admin`) ; une
  demande exige l'une des deux casquettes et une adresse mail connue. Une
  évolution fait de son auteur le demandeur de l'outil.
- **Quatre yeux à la Gate 2** : l'approbation d'une livraison n'est pas prise
  par le demandeur de l'outil, règle appliquée par le moteur et par la base.
  Seule exception : le sujet désigné par `QUATRE_YEUX_DEROGATION_SUJET`
  (vide par défaut) ; chaque usage est inscrit dans
  `approbations.derogation_quatre_yeux`, à côté de la casquette utilisée
  (`approbations.role`).
- **Idempotence par personne** : la clé d'un appel vaut pour son auteur
  (`api-<acteur>-<clé>`), jamais pour un autre.
- Les comptes de service de vérification (`verif-demandeur`, `verif-admin`)
  n'existent qu'au labo.

## Alternatives écartées
- Garder le mail comme identité, avec Keycloak devant — le mail change et se
  réattribue (OpenID Connect Core §5.7) ; l'audit désignerait une boîte aux
  lettres, pas une personne.
- `UNIQUE (emetteur, sujet)` directement sur `acteurs` — au premier `sub`
  changé, la même personne devient deux acteurs et trois ans d'audit ne se
  rapprochent plus sans UPDATE d'une table figée.
- Émetteur provisoire local (`urn:eupadev:local`) en attendant Keycloak —
  un deuxième contrat d'identité à migrer ensuite ; Keycloak est une recette
  Ansible de plus, pas un obstacle.
- Rôles de realm, ou rôles stockés dans la base du moteur — les premiers
  fuient dans tous les jetons ; les seconds survivent à la révocation dans
  l'annuaire, à l'inverse de l'exigence « départ = désactivation partout ».
- Quatre yeux seulement dans le code — un UPDATE direct en base le
  contournerait ; le trigger le refuse aussi, dérogation tracée ou rien.
- Rattachement automatique d'un nouveau `sub` par le mail — c'est l'auto-link
  que Keycloak lui-même qualifie de dangereux ; un admin et un motif.

## Conséquences
- Tout appelant de l'API a besoin d'un jeton Keycloak : les cycles de
  vérification du labo passent par des comptes de service, et les cycles en
  cours au moment du déploiement sont annulés (messages DBOS de l'ancienne
  forme, pas de double lecture).
- Une personne connectée avec un nouveau `sub` avant son rattachement devient
  un second acteur que la clé primaire interdit de rattacher ensuite : les
  deux restent lisibles, l'audit n'est pas touché ; coût accepté tant que le
  cas ne s'est pas produit.
- Un jeton sans `email` permet de se connecter mais pas de déposer une
  demande : les notifications partent par mail.
- La liste des casquettes est fermée ; un référent métier ou un rôle
  sécurité viendra par un nouvel ADR, pas par une colonne libre.
- Les outils générés hériteront de la même règle (`(iss, sub)`, jamais le
  mail) dans la brique OIDC du template, objet d'une étape à part.

## Vérification
Tests du moteur (CI GitHub, `.github/workflows/moteur.yml`) :
`tests/auth.test.ts` refuse `typ JWT`, `alg none` et HS256, `aud` absente,
`iss` différent, `cnf`, jeton expiré, et ne relit le JWKS qu'une fois par
pause pour un `kid` inconnu ; `tests/db.test.ts` prouve deux sujets = deux
acteurs, liaison par INSERT = même acteur, UPDATE et DELETE refusés, même
mail sans fusion, droits du moteur limités au contact, refus par la base de
l'auto-approbation de la Gate 2 sans dérogation ; `tests/service.test.ts`
prouve 401 sans jeton, 403 sans casquette, 403 pour un demandeur qui décide,
un tiers qui juge ou le demandeur qui approuve sa Gate 2, dérogation tracée,
clé d'idempotence distincte par personne ; scénarios Gherkin I0-1 et I0-2 ;
mutations `ID-…` (`tests/mutations/mutations.ts`) tuées par ces tests, sous
le cliquet. Au labo, `verify-keycloak.yml` vérifiera l'émetteur découvert,
`typ at+jwt` et l'audience de chaque client émetteur, l'absence de
`verif-*` hors labo ; `verify-moteur.yml` conduira un cycle avec deux
identités (avis par `verif-demandeur`, décisions par `verif-admin`) et
contrôlera la casquette enregistrée. Non vérifiable mécaniquement : le
motif d'un rattachement manuel, et le fait que `QUATRE_YEUX_DEROGATION_SUJET`
reste vide hors du labo.
