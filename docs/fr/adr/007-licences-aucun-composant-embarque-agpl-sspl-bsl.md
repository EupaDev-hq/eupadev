---
adr: 007
title: Licences, jamais de composant embarqué AGPL, SSPL ou BSL
status: accepté
date: 2026-10-13
decision-makers: Ilan
supersedes:
related: [ADR-006, ADR-010]
controle: prévu
---
## Contexte
EupaDev sera publié en open core sous Apache 2.0, installé chez des
clients, peut-être revendu. Certaines licences y sont incompatibles :
l'**AGPL** impose de distribuer l'œuvre qui intègre le composant sous AGPL et
de donner le code d'une version modifiée à ses utilisateurs réseau ; la
**SSPL** étend l'obligation à tout le logiciel qui sert le service ; la
**BSL** interdit certains usages (souvent l'usage commercial concurrent)
jusqu'à une bascule vers une licence libre des années plus tard. Ces
obligations naissent pour l'essentiel quand on **embarque** le composant
(redistribuer, lier, modifier), pas quand on lance à côté, sans le modifier,
un programme distinct.

## Décision
Ne jamais embarquer dans EupaDev de composant AGPL, SSPL ou BSL, ni les
composants listés ci-dessous ; un tel composant reste toléré s'il est lancé
à côté.
- **Embarqué = interdit** : dans le dépôt ou une image livrée, dépendance de
  notre code, ou version modifiée.
- **Lancé à côté = toléré** : programme séparé, non modifié, en ligne de
  commande ou service séparé (k6, Renovate dans la CI), ou outil du seul labo,
  jamais livré.
- **Jamais embarqués, quelle que soit leur licence** : un ITSM (GLPI, iTop,
  Zammad) ; Claude Code ou l'Agent SDK d'Anthropic (conditions
  commerciales) ; les règles officielles Semgrep (interdites dans un produit
  revendu).
- **Claude Code** : jamais dans une image livrée par EupaDev ; l'image du
  lanceur est construite par la forge du client, qui le télécharge depuis npm,
  accepte les conditions et fournit sa clé. Le dépôt ne contient que ce
  Dockerfile.
- Chaque nouveau composant est vérifié (licence et conditions d'usage) à son
  adoption.

## Alternatives écartées
- Semgrep et ses règles officielles — remplacé par Opengrep (LGPL, même
  format) avec nos propres règles.
- Zitadel — AGPL depuis la v3 ; Keycloak (Apache 2.0) retenu.
- SonarQube dans la boucle des agents — sa licence exclut l'analyse de ses
  résultats par une IA extérieure.
- Interdire aussi l'AGPL lancé à côté — priverait la CI de k6 ou Renovate pour
  une obligation qui ne s'applique pas à cet usage.

## Conséquences
- Le dépôt reste sous Apache 2.0, installable sans obligation cachée.
- La frontière « embarqué / à côté » demande un jugement à chaque adoption :
  un outil toléré redevient interdit dès qu'il entre dans une image livrée ou
  qu'on le modifie.
- Les outils du labo (LXD sous AGPL, Terraform sous BSL) sont permis ; les
  remplacer relève d'autres raisons (ADR-010).
- Une licence peut changer à une nouvelle version (LXD, Terraform, Zitadel
  l'ont fait) : une mise à jour peut faire basculer un composant adopté.

## Vérification
- Dans la CI GitHub du dépôt, Trivy analysera les licences
  (`trivy fs --scanners license`) avec une liste autorisée : toute dépendance
  hors liste fera échouer la CI.
- Les images publiées par EupaDev seront analysées avant publication : la
  présence de `@anthropic-ai/claude-code` fera échouer la publication.
- Le scan ne voit que les licences déclarées ; les conditions d'usage (Claude
  Code, Semgrep, Sonar) et la frontière « embarqué / à côté » ne sont pas
  vérifiables mécaniquement : relecture humaine à chaque adoption.
