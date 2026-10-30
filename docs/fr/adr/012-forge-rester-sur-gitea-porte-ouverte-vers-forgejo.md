---
adr: 012
title: Forge, rester sur Gitea en gardant la porte ouverte vers Forgejo
status: accepté
date: 2026-10-13
decision-makers: Ilan
supersedes:
related: [ADR-001, ADR-007, ADR-008]
controle: partiel
---
## Contexte
La forge héberge les dépôts des outils, leur CI et leur registre, et porte
les garde-fous de la gouvernance (un agent ne fusionne pas seul, n'affaiblit
pas une gate, ne touche pas aux fichiers de contrôle ; toute exception passe
par un humain désigné). Elle est Gitea 28.1.0 (MIT) avec Gitea Runner 5.0.0.
Forgejo, fork communautaire (Codeberg e.V., GPLv3 depuis sa v9), a été
comparé le 2026-10-13 en lisant le code des deux forges, sur les quinze
fonctions utilisées : dix identiques, une renommée, une partielle, et quatre
absentes de Forgejo, toutes de gouvernance — le **compte Bot** (jeton
seulement, sans connexion interactive), le **journal d'audit** `audit_event`
(protections, jetons, équipes), le **contournement nominatif** (un humain non
administrateur fusionne une PR qui touche un fichier protégé) et l'**ordre
explicite des règles de protection** (`priority`, que Forgejo perd à la
génération depuis un modèle). Le reste se reporte sans perte. Forgejo offre
une LTS de 15 mois et un argument de souveraineté ; Gitea n'a de LTS que
payante, ne corrige que sa dernière version, publie beaucoup d'avis de
sécurité (dont une faille exploitée en 2026), mais les failles du code commun
touchent les deux, et Forgejo en a corrigé une critique des mois après Gitea.
Aucune montée directe d'un Gitea récent vers Forgejo : bascule = réinstaller
et porter les recettes. Sources :
`docs/reflexions/recherche-2026-10-13/recherche-forgejo-gitea.md`,
`docs/reflexions/2026-10-13-adr-details.md`.

## Décision
Garder Gitea comme forge de EupaDev, et ne dépendre de Gitea que là où
Forgejo n'offre pas d'équivalent, avec un repli documenté pour chaque
dépendance.
- **Replis Forgejo** : Bot → compte ordinaire au mot de passe aléatoire jeté
  (connexion possible s'il fuit) ; audit → contrôle de dérive planifié par
  l'API (protections, équipes, jetons) et journaux du proxy, sans « qui a fait
  quoi » ; contournement nominatif → l'humain devient administrateur des
  dépôts, ou l'administrateur d'instance tranche ; `priority` → l'orchestrateur
  recrée la règle `**` après la génération ; `EGRESS_MODE=strict`,
  `block_admin_merge_override` et `docker_host` → leurs équivalents Forgejo
  (liste dans la note de détail).
- **Le commun d'abord** : le contrat « forge » de l'orchestrateur n'utilise que
  des routes et réglages présents dans les deux ; les workflows utilisent
  `${{ github.* }}`, pas `${{ gitea.* }}`.
- **Licence** : la GPLv3 de Forgejo n'est ni AGPL, ni SSPL, ni BSL (ADR-007) ;
  forge lancée à côté, parlée par HTTP et Git : une bascule resterait permise.
- **Suivre vite chaque version** de Gitea et de son runner, majeures
  comprises, faute de LTS libre.
- **Réévaluer** si : Gitea change de licence ou retire de l'édition libre une
  fonction utilisée ; un client exige Forgejo ; Forgejo livre audit et
  contournement nominatif ; les majeures de Gitea deviennent trop fréquentes
  ou cassantes pour une personne ; l'absence de LTS devient bloquante ; une
  faille critique exploitée reste sans correctif Gitea 14 jours après la
  publicité de son exploitation (inscription au KEV de la CISA, par exemple).
  14 jours : délai imposé par la CISA aux administrations américaines (BOD
  22-01) et double du rythme observé de Gitea.

## Alternatives écartées
- Migrer vers Forgejo maintenant — 7 à 10 jours de portage, et surtout la
  perte durable des quatre briques de gouvernance.
- Migrer à la prochaine LTS de Forgejo — même perte tant qu'il n'a ni audit ni
  contournement nominatif : c'est un déclencheur, pas une date.
- Gitea Enterprise pour la LTS — lierait l'appliance à une licence
  commerciale tierce.
- Code commun aux deux forges dès maintenant — double maintenance pour une
  bascule sans date ; la liste des replis suffit à la chiffrer.

## Conséquences
- Les quatre briques de gouvernance restent disponibles et prouvables.
- Pas de LTS : chaque version, majeures cassantes comprises, est appliquée
  vite ; le suivi automatique des versions les met en priorité.
- Dépendance à une entreprise (Gitea Ltd) ; le mouvement observé va de
  l'Enterprise vers l'édition libre (audit arrivé dans Gitea 28 libre).
- L'audit se lit en SQL dans `audit_event` (pas d'API REST libre) : un
  changement de schéma peut casser cette lecture.
- Une bascule reste chiffrée (7 à 10 jours), pièges connus (`docker_host`
  inversé, ordre des règles, configuration déplacée en v15), sans obligation
  de licence nouvelle.

## Vérification
- `infra/ansible/verify-forge.yml` prouve sur la forge réelle que les comptes
  de service sont de type Bot et que la création de jetons s'inscrit dans
  `audit_event` ; une version de Gitea qui retirerait l'une ou l'autre le fait
  échouer (premier déclencheur de réévaluation).
- Le suivi rapide reposera sur Renovate, une fois son application installée :
  `renovate.json` fait de Gitea, Gitea Runner et l'image de ses jobs un groupe
  proposé dès la publication ; chaque PR, relue et fusionnée par un humain,
  sera prouvée par les `verify-*` du labo. Sans l'application, rien ne part.
- Non vérifiable mécaniquement : l'usage exclusif des routes communes, celui
  de `${{ github.* }}` et les déclencheurs (dont les 14 jours) ; relecture à
  chaque majeure de Gitea et à chaque avis critique.
