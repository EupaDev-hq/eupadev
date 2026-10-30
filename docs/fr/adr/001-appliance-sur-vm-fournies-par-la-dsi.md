---
adr: 001
title: Appliance sur des VM fournies par la DSI (option C)
status: proposé
date:
decision-makers: Ilan
supersedes:
related: [ADR-002, ADR-007]
controle: prévu
---
## Contexte
Cible : une entreprise de plus de 200 salariés dont la DSI compte deux
généralistes débordés (VMware, Hyper-V ou Proxmox ; peu de Linux et de
Docker). EupaDev doit y être installé et exploité dans la durée, à
distance, par une seule personne (l'exploitant, prestataire), sans que la DSI
apprenne une plateforme ni perde la main. Trois voies : se brancher sur
l'existant (A), apporter sa virtualisation (B), demander des VM Linux standard
et tout installer dedans (C). Source :
`docs/reflexions/2026-10-10-strategie-deploiement-et-exploitation.md`.

## Décision
Installer EupaDev comme une appliance sur des VM Linux standard fournies
par la DSI, sans jamais accéder à l'hyperviseur.
- **Responsabilités** : *sous* les VM (hyperviseur, réseau, DNS, annuaire,
  sauvegarde des VM) = DSI ; *dans* les VM (EupaDev, outils, mises à jour,
  sauvegardes applicatives, surveillance) = exploitant. Une fiche de
  prérequis (`docs/prerequis-client.md`) dit ce que fournit la DSI : VM Ubuntu
  vierge, clé SSH, flux réseau listés par nom de domaine.
- **Outils** en conteneurs sur des VM « outils » ; un outil sensible (RH,
  paie, données personnelles) a sa VM, décidé au cadrage.
- **Accès** par le VPN ou le bastion du client, nominatif, MFA, journalisé ;
  jamais ouvert sur Internet. **Poste de l'exploitant** : une clé SSH par
  client, jamais partagée, protégée (phrase de passe ou support matériel) ;
  disque chiffré, mises à jour, session verrouillée, MFA sur tout accès client.
- **Réversibilité** : tout est décrit en code (Ansible, Compose) et documenté,
  pour qu'un autre exploitant ou la DSI reprenne depuis les VM vierges,
  l'inventaire, le coffre remis au client et les sauvegardes ; le contrat
  laisse au client, en fin de contrat, les briques du dépôt privé avec leur
  code.
- **IA** : code des outils et échanges de cadrage partent vers le fournisseur
  d'IA, sous la clé du client, qui l'accepte avant l'installation ; jamais de
  donnée de production (code et données fictives seulement). Ce que le
  demandeur tape dans le chat y part, sous sa responsabilité (mention
  affichée).
- Terraform/OpenTofu est facultatif chez le client : les VM existent déjà.

## Alternatives écartées
- A, l'existant tel quel — intégration et support refaits chez chaque client.
- B, sa propre virtualisation (OpenNebula…) — refus d'un hyperviseur de plus ;
  l'exploitant deviendrait éditeur d'un cloud, trop lourd pour une personne.

## Conséquences
- Même environnement chez chaque client ; la DSI garde la main sous les VM et
  peut couper l'accès à tout moment.
- **Une seule personne** : pas d'astreinte 24 h/24 ; heures de service et
  délai d'intervention au contrat ; la DSI sait redémarrer ou restaurer une
  VM. La reconstruction depuis le code réduit ce risque sans le supprimer.
- **Confidentialité** : un client qui refuse l'envoi à l'IA ne peut pas
  utiliser EupaDev tel quel (sauf modèle hébergé chez lui, ADR-006) ; la
  mention du chat responsabilise, elle ne filtre rien.
- **Poste de l'exploitant** : compromis, il ouvre tous les clients ; des clés
  distinctes limitent la réparation au retrait des clés, pas l'attaque. Ses
  exigences sont des engagements contractuels.
- **Isolation** : des conteneurs partagent le noyau de la VM ; d'où non-root,
  quotas, réseau, base et compte PostgreSQL par outil, VM dédiée si sensible.
- Clause de reprise des briques privées : coût commercial accepté. Les
  prérequis (proxy, certificats, DNS) varient : EupaDev s'y adapte.

## Vérification
- Une recette Ansible de prérequis vérifiera la VM (système, ressources, flux
  de la fiche) et refusera d'installer s'il manque quelque chose.
- Par construction, l'inventaire client ne contiendra que des VM et aucun code
  installé ne parlera à une API d'hyperviseur (le code du labo n'y va pas).
- La réversibilité se prouvera par une reconstruction complète depuis des VM
  vierges, le code et la dernière sauvegarde.
- Non vérifiable mécaniquement : responsabilités, accès, poste, clause de
  reprise, accord sur l'IA et mention du chat (contrat, relecture du cadrage).
