---
adr: 008
title: Garder Gitea (pas Forgejo), passer à Incus et OpenTofu avant la publication
status: rejeté
date: 2026-10-12
decision-makers: Ilan
supersedes:
related: [ADR-007, ADR-010]
---
## Contexte
La forge est Gitea 1.27.3 et le labo tourne sur LXD 5.21 avec Terraform. LXD
est passé de Apache 2.0 à AGPLv3 avec CLA Canonical (5.20) et Terraform sous
BSL depuis la 1.6 (`docs/reflexions/recherche-2026-10-12/recherche-forge-labo.md` ;
`ROADMAP.md` §8.14 C et §8.15, « Forge et labo »).

## Décision
Rester sur Gitea, et passer le labo à Incus avec OpenTofu en un seul chantier
« labo libre », avant la publication.
- Gitea (MIT) monte en 28, qui apporte comptes bots, journal d'audit et
  approbation CODEOWNERS.
- Forgejo reste branchable derrière le contrat « forge » de l'orchestrateur,
  pour un client qui l'exigerait.
- Incus (Apache 2.0) remplace LXD par reconstruction (IaC), pas par
  `lxd-to-incus` ; OpenTofu remplace Terraform.
- Ordre : pour un vrai client, puis avant la publication, après Gitea 28
  (§8.15, ordre de travail n°5).

## Alternatives écartées
- Migrer vers Forgejo — migration directe bouchée depuis Gitea 1.23
  (réinstallation et migration dépôt par dépôt) ; GPLv3 depuis la v9, plus
  frileuse pour certains services juridiques que MIT.
- Garder LXD — piloté par Canonical (AGPL + CLA), l'écosystème communautaire
  (provider `lxc/*`, OpenTofu) a basculé côté Incus ; une recette publique qui
  demande un snap AGPL est un mauvais signal pour un dépôt open core.
- Garder Terraform — sous licence BSL depuis la 1.6 (§8.14 C).

## Conséquences
- Réécriture de `infra/terraform` (ressources `incus_*`) et reconstruction du
  labo ; piège Docker/réseau des VM à retester avec Incus (nftables).
- Point de réévaluation de Gitea : si Gitea Ltd retire une fonction vers son
  offre Enterprise ou change de licence.

## Vérification
Aucun contrôle automatique à ce jour (les `verify-*` prouveront la forge et le
labo après chaque étape).

## Rejet
Rejeté le 2026-10-13 tel que rédigé ci-dessus (texte de la proposition
conservé, dans le format de l'époque), pour trois raisons :
- il réunissait deux décisions indépendantes, le choix de la forge (Gitea
  ou Forgejo) et celui des outils du labo (Incus et OpenTofu), qui n'ont ni
  le même calendrier ni le même degré de certitude ;
- il liait le changement du labo à l'arrivée d'un vrai client, alors que
  chez le client la DSI fournit les VM (pas de LXD ni d'Incus) et
  qu'OpenTofu y est facultatif : ce changement ne concerne que la
  publication du dépôt ;
- le choix entre Gitea et Forgejo demande une recherche comparative que
  cette proposition ne contenait pas.

Le labo fait l'objet d'ADR-010. Le choix de la forge fera l'objet d'un ADR
distinct, après cette recherche.
