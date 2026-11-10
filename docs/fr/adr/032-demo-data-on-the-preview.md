---
adr: 032
title: Données de démonstration sur la Preview, un jeu livré avec l'outil et chargé par la plateforme après les migrations
status: accepted
date: 2026-11-10
decision-makers: Ilan
supersedes:
related: [ADR-004, ADR-017, ADR-022]
check: partial
---
> Traduction de `docs/adr/032-demo-data-on-the-preview.md` ; la version anglaise fait foi.

## Contexte
Un demandeur qui ouvre pour la première fois la Preview d'un outil socle
voit des listes, tableaux de bord et graphiques vides : rien ne dit si
l'outil répond au besoin avant que quelqu'un ait saisi des données à la
main. La base de la Preview est vidée à chaque nouveau digest d'image
(décision du 2026-10-26, conservée : le déployeur supprime et recrée le
schéma `app`, puis lance la migration comme service Compose ponctuel avec
l'image de l'outil et le compte propriétaire, avant tout trafic, ADR-022 ;
la Prod n'est jamais vidée). Toute écriture métier exige un acteur et un
identifiant de requête (`audit_row()`, ADR-004), et une personne n'obtient
son acteur qu'à sa première connexion (ADR-017) : aucun fichier ne peut
rattacher des lignes aux personas de la Preview ; les écrans propres à une
persona (« mes demandes ») ne se remplissent que par les lignes de la suite
d'acceptation ou par les clics du demandeur. Au cycle 9, l'agent de tests a
inventé un nettoyage qui supprimait ses lignes après chaque passage, alors
que le template disait déjà « chaque scénario crée ses données ». Le
dossier `db/` de l'outil est copié dans l'image signée : un fichier de
données livré là fait partie de ce qui a été vérifié, et reste inerte en
Prod. Modifier le `bin/migrate.js` du socle suppose une publication du
socle et un nouvel épinglage (ADR-023).

## Décision
Chaque outil socle livre ses données de démonstration dans
`db/seed/demo.sql`, écrit par le constructeur, chargé par la plateforme sur
la Preview juste après les migrations d'un schéma qu'elle vient de vider,
jamais en Prod.
- **Contenu** : le constructeur l'écrit après les migrations, sur le modèle
  de l'outil de référence : un acteur `machine` `demo-seed` et le préambule
  `set_config('app.actor_id' …)` / `set_config('app.request_id' …)`, puis
  10 à 20 lignes par entité principale, chaque ligne de référence utilisée,
  chaque statut de chaque flux représenté, en passant par les déclencheurs
  de transition, des dates relatives à `now()`. INSERT et UPDATE seulement.
  Personnes, fournisseurs et adresses sont manifestement fictifs (noms de la
  liste du jeu de référence, mails `@example.com`, aucune vraie société).
- **Chargement** : le déployeur lance le service ponctuel `seed` du modèle
  Compose socle quand, et seulement quand, il vient de vider le schéma
  (nouveau digest sur la Preview) : même image, même uid, même compte
  propriétaire que la migration, jamais le superutilisateur qui a vidé le
  schéma. Le script est celui de la plateforme (`seed.mjs`, installé par
  Ansible, monté en lecture seule), il utilise le socle et `pg` de l'image,
  applique le fichier en une transaction avec les délais des migrations, et
  refuse un fichier qui modifie visiblement le schéma, supprime des lignes,
  exécute un bloc ou une méta-commande psql : un contrôle de discipline (un
  filtre de mots-clés, que des guillemets échappés peuvent tromper), pas une
  frontière ; la frontière de privilèges est le compte propriétaire, le même
  que pour les migrations que les agents écrivent déjà. Une Preview en échec
  garde le schéma de l'ancienne image, migré mais sans jeu de démonstration.
  Sans le fichier, rien n'est fait. Un
  chargement en échec suit le chemin d'une migration en échec : rien n'est
  démarré, la Preview précédente continue de servir. La Prod ne se vide
  jamais, donc ne se charge jamais ; un redéploiement du même digest garde
  ses données.
- **Vérifié au push** : la vérification de démarrage du template (même
  image, PostgreSQL jetable) est rouge quand un outil a des migrations et
  pas de jeu, quand le jeu est refusé, quand il échoue, ou quand une table
  de l'outil (schéma `app` moins les tables du socle, les journaux de
  migration et `*_history`) reste sans ligne.
- **Les tests ne remettent jamais la Preview à zéro** : pas de nettoyage,
  pas de fixture de suppression ; les lignes de la suite restent (ce sont
  elles qui remplissent les écrans propres à une persona), les lignes de
  démonstration ne sont pas à la suite de les lire ; les scénarios
  vérifient les lignes qu'ils ont créées, jamais une liste vide ni un total.
- Le mode découverte (ADR-028) utilise un faux déployeur : rien à charger.

## Alternatives écartées
- Le chargement dans le `bin/migrate.js` du socle — une publication du
  socle et un nouvel épinglage pour chaque outil avant que la première
  Preview montre des données ; gardé pour une publication ultérieure, où
  `seed.mjs` y disparaîtra.
- Laisser la suite d'acceptation remplir la Preview — elle ne crée que les
  lignes dont ses scénarios ont besoin, au nom des personas, et rien à la
  première visite avant son passage.
- Un nettoyage après la suite — il viderait les écrans propres à une
  persona que le jeu ne peut pas remplir, et la Preview partagée est déjà
  remise à zéro à chaque digest.
- Rattacher les lignes de démonstration aux personas — une persona n'a pas
  d'acteur avant sa première connexion (ADR-017) ; créer des acteurs par
  mail contournerait l'identité (issuer, subject).
- Garder les données de la Preview d'un digest à l'autre — une migration
  écrite pour un schéma vide rencontrerait d'anciennes lignes, et une
  Preview périmée montrerait des données que le nouveau contrat n'a plus.
- Des données générées façon Faker — des noms aléatoires ont l'air vrais,
  ne se cherchent pas par grep, et changent à chaque déploiement ; un
  fichier fixe se relit comme du code.

## Conséquences
- Une persona admin ou gestionnaire voit dès la première visite des lignes
  sur chaque liste, tableau de bord et graphique ; les vérifications
  d'accessibilité et de performance de la Preview auditent des pages
  remplies.
- Les lignes qu'un demandeur saisit sur la Preview disparaissent toujours à
  chaque nouveau digest (comportement actuel, inchangé).
- Une suite qui vérifiait une liste vide ou un total passe au rouge à son
  premier passage sur la Preview et est corrigée par la boucle de constats :
  un tour au plus.
- Un jeu qui viole un déclencheur ou une contrainte est attrapé au push par
  la vérification de démarrage, jamais sur la Preview.
- La règle des données fictives est de la prose : un mail d'apparence réelle
  hors `example.com` n'est pas attrapé mécaniquement.
- La Preview ne remplit pas les écrans propres à une persona à la première
  visite ; les clics du demandeur ou les lignes de la suite le font.

## Vérification
`infra/ansible/roles/deployer/files/test_deployer.py` vérifie qu'un nouveau
digest sur la Preview enchaîne vidage, migration, chargement, puis
démarrage ; qu'un redéploiement du même digest et un déploiement en Prod ne
lancent jamais le chargement ; qu'un chargement en échec répond comme une
migration en échec, rien démarré.
`tool-template/.gitea/checks/boot-check.sh`, lancé par le `check.yml` de
l'outil et par `.github/workflows/template-rules.yml`, applique le jeu d'un
outil à migrations comme propriétaire sur la base jetable, refuse un jeu
avec changements de schéma ou suppressions, et est rouge quand une table de
l'outil n'a aucune ligne. `examples/requests/tests/db.test.js` applique le
jeu de référence sur le PostgreSQL jetable du kit et vérifie chaque statut,
chaque catégorie et chaque table. Non vérifié mécaniquement : que les
lignes apparaissent sur chaque écran d'une Preview déployée (le cycle
gratuit sur le lab le montre), la règle des données fictives, et qu'une
suite ne remet jamais la Preview à zéro.
