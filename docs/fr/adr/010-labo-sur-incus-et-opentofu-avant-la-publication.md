---
adr: 010
title: Labo sur Incus et OpenTofu avant la publication
status: proposé
date:
decision-makers: Ilan
supersedes:
related: [ADR-001, ADR-007]
controle: prévu
---
## Contexte
Le labo de développement tourne sur une machine : VM LXD 5.21 (snap
Canonical) créées par Terraform (provider `terraform-lxd/lxd`), configurées
par Ansible, reconstructibles de zéro. Sa recette fera partie du dépôt
publié : c'est elle qu'un contributeur suivra. LXD est passé d'Apache 2.0 à
l'AGPLv3 avec CLA Canonical (5.20, décembre 2023) ; son fork Incus (Apache 2.0,
7.0 LTS jusqu'en juin 2031, provider `lxc/incus` sous MPL 2.0) est suivi par
l'écosystème communautaire, mais repose sur une petite équipe, quand LXD a
Canonical derrière lui. Terraform est sous BSL depuis la 1.6 (août 2023) ;
OpenTofu (MPL 2.0, Linux Foundation) lit les mêmes fichiers. La règle de
licences (ADR-007) tolère un outil du seul labo : **la licence seule n'oblige
pas à changer**. Chez un client, la DSI fournit les VM (ADR-001) : ni LXD ni
Incus. Source : `docs/reflexions/recherche-2026-10-12/recherche-forge-labo.md`.

## Décision
Passer le labo de LXD à Incus et de Terraform à OpenTofu, en un seul
chantier, avant la publication du dépôt.
- Par reconstruction depuis le code (OpenTofu crée les VM Incus, Ansible les
  configure, les sauvegardes sont restaurées), pas par `lxd-to-incus`.
- Lié à la publication, pas au premier client.
- `infra/terraform` devient `infra/tofu` dans le même chantier : le dossier
  nomme l'outil réel, et le contrôle n'a pas à tolérer un nom périmé.

## Alternatives écartées
- Garder LXD et Terraform — permis, mais deux outils d'éditeurs uniques qui
  ont déjà changé de licence, et un mauvais signal dans la recette publique.
- Convertir en place (`lxd-to-incus`) — ne prouve pas la reconstruction de
  zéro, que la publication doit garantir.
- Le faire avant le premier client — sans effet chez lui (VM fournies).

## Conséquences
- **Raison honnête** : pas la licence, mais la pérennité et le signal d'un
  dépôt public. On échange le risque « un éditeur change les règles » contre
  « une petite équipe s'arrête » ; ce second risque se surveille (rythme des
  versions, contributeurs) et le retour reste un changement de provider.
- Pourquoi pas la tolérance accordée à k6 ou Renovate (AGPL lancés à côté) :
  Incus et OpenTofu sont des forks quasi identiques, peu coûteux à adopter ;
  remplacer k6 ou Renovate changerait d'outil et de méthode.
- Réécriture de `infra/tofu` (`incus_*` au lieu de `lxd_*`), des chemins qui
  le citent et de la procédure (`infra/README.md`), reconstruction complète.
- Le piège « le pare-feu de Docker coupe Internet aux VM » est à retester :
  Incus utilise nftables.

## Vérification
- Une reconstruction complète du labo depuis zéro (OpenTofu, Ansible,
  restauration), suivie des workflows `verify-*` (forge, CI, sauvegardes),
  prouvera le changement.
- Un contrôle de motifs dans la CI GitHub refusera, dans `infra/`, ce qui fait
  tourner les anciens outils : provider `terraform-lxd/lxd`, ressources
  `lxd_*`, appel du binaire `terraform` en début de commande, installation du
  snap `lxd` ; pas le mot « terraform » en général (état, bloc
  `terraform {}` gardé par OpenTofu, documentation).
