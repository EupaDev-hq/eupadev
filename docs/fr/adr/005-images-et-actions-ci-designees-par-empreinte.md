---
adr: 005
title: Images et actions de CI désignées par empreinte
status: accepté
date: 2026-10-13
decision-makers: Ilan
supersedes:
related: [ADR-007]
controle: partiel
---
## Contexte
Une étiquette d'image ou d'action de CI (`trivy:0.75.0`, `actions/checkout@v4`)
n'est qu'un nom : l'éditeur, ou qui lui vole son compte, peut la faire
pointer vers un contenu piégé sans que notre dépôt change (arrivé à
`tj-actions/changed-files` en mars 2025). Une empreinte (`sha256` d'image, SHA
de commit) désigne un contenu précis. Les golden images (bases des outils)
sont reconstruites chaque semaine par la forge de l'installation pour recevoir
les correctifs, et désignées par des variables d'organisation
(`BASE_IMAGE_BUILD`, `BASE_IMAGE_RUN`, `CI_IMAGE`) ; dans Gitea 28.1.0, écrire
ces variables exige d'être propriétaire de l'organisation, droit qui permet
aussi de modifier toutes ses protections de branche, alors que la CI
(`svc-ci`) n'a que la lecture du code et l'écriture du registre. Détails :
`docs/reflexions/2026-10-13-adr-details.md`.

## Décision
Désigner toute image et toute action de CI par une empreinte de contenu,
jamais par une étiquette seule, sauf l'exception encadrée des golden images,
et signer nos propres images.
- **Images** : `nom:étiquette@sha256:…` (index multi-architecture) partout
  (Compose, `FROM`, `docker run`, `docker://` du runner) ; l'étiquette est
  pour le lecteur, seule l'empreinte compte.
- **Actions** : `propriétaire/dépôt@<SHA de 40 caractères> # vX.Y.Z` pour tout
  `uses:` ; exceptions : action locale `./…` et `docker://…@sha256:…`.
- **Golden images, seule exception** : désignées par étiquette
  (`base-node:build-22`), pour qu'un correctif atteigne chaque outil à sa
  construction suivante sans commit. En échange, la construction de l'outil
  1. résout l'étiquette en empreinte une fois, puis n'utilise que celle-ci ;
  2. vérifie sa signature cosign avec la clé de l'installation, et refuse de
     construire si elle manque ou vient d'une autre clé ;
  3. inscrit l'empreinte dans les labels OCI `org.opencontainers.image.base.*`
     et la SBOM de l'image produite.
- **Variables en position d'image** : seules `BASE_IMAGE_BUILD`,
  `BASE_IMAGE_RUN` et `CI_IMAGE` (liste fermée), valant l'étiquette d'une
  golden image du registre de l'installation ; toute autre est refusée.
- **Signature de nos images** par cosign, avec la clé de qui les construit :
  EupaDev pour l'image du moteur ; l'installation du client pour ce que sa
  forge construit (golden images, lanceur). Signature vérifiée avant tout
  usage ; non signée ou autre clé = refusée.

## Alternatives écartées
- Étiquette seule — déplaçable sans trace dans le dépôt.
- Signatures seules, sans empreinte — prouvent qui a construit, pas que c'est
  le contenu relu, et la plupart des images publiques ne sont pas signées ;
  les deux se complètent, d'où les deux pour nos images.
- Golden images par empreinte, écrite dans les variables par la CI — même
  compte qui publie et écrit (aucune sécurité en plus), droit de propriétaire
  qui permet d'affaiblir les gates, et aucune trace dans le dépôt.
- Golden images par étiquette sans garde-fou — ni origine vérifiée, ni trace
  de la base utilisée.

## Conséquences
- Une mise à jour d'image ou d'action est un diff relu, au format que
  Renovate sait tenir à jour.
- **L'empreinte garantit l'intégrité, pas la confiance** : un contenu piégé
  quand on a relevé l'empreinte le reste (rôle de Trivy et de la relecture).
- **Golden images** : deux constructions d'un même commit peuvent partir de
  bases différentes (voulu, et chaque image dit laquelle). Une base cassée,
  ou piégée mais signée par la clé de l'installation, se propage ; une image
  déposée sans la clé est refusée.
- **Limite** : `CI_IMAGE` est tirée par le runner avant le job, hors des trois
  garde-fous ; elle repose sur le contrôle d'accès du registre (seule la CI de
  la branche principale y publie).
- Une clé cosign de plus par installation, dans le coffre ; perdue, elle
  bloque constructions et déploiements jusqu'à une nouvelle signature.
- **Limite du contrôle** : il lit par motifs (`image:`, `FROM`, `uses:`,
  `docker run`, `docker://`) ; une autre forme lui échappe, et la valeur d'une
  variable se vérifie à la construction.

## Vérification
- `.github/scripts/verifier-empreintes.py` (testé par
  `test_verifier_empreintes.py`, lancé par `images-empreinte.yml` à chaque
  push et PR) fait échouer la CI sur toute image ou action sans empreinte ; il
  refusera aussi une variable d'image hors de la liste fermée.
- La CI des outils résoudra et vérifiera chaque golden image (refus si
  signature absente ou étrangère, prouvé par un test du kit avec une base non
  signée), puis refusera de publier si l'empreinte de la base manque ou
  diffère dans les labels ou la SBOM.
- Le déploiement vérifiera la signature sur la machine cible et refusera une
  image non signée (test du déployeur).
- Les workflows `verify-*` du labo prouvent que les images par empreinte se
  téléchargent et tournent.
