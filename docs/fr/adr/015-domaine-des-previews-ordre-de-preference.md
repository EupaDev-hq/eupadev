---
adr: 015
title: Domaine des Previews et de la maquette, ordre de préférence selon le client
status: accepté
date: 2026-10-14
decision-makers: Ilan
supersedes:
related: [ADR-014, ADR-009]
controle: partiel
---
## Contexte
Les Previews et la maquette (ADR-009) servent du code écrit par des agents,
qu'aucun humain n'a encore approuvé. Le navigateur range les cookies par site
(domaine enregistrable), pas par machine : sous `preview.entreprise.fr`, une
Preview peut poser un cookie valable pour tout `entreprise.fr` (forge,
intranet, connexion d'entreprise), et `SameSite` ne l'empêche pas, puisque
c'est le même site (« cookie tossing »). Le préfixe `__Host-` protège les
cookies qui le portent, pas ceux des autres applications du domaine. Faits
relevés le 2026-10-14 :
- GitHub, Vercel, Netlify servent le contenu non fiable sous un domaine
  enregistrable séparé (GitHub a quitté `github.com` pour `github.io` pour
  cette raison).
- La Public Suffix List refuse les usages internes, les labos et les projets
  de moins de quelques milliers d'utilisateurs ; une entrée acceptée met des
  mois, voire des années, à atteindre les navigateurs.
- L'ICANN a réservé `.internal` à l'usage privé (juillet 2024) : jamais
  délégué, sans certificat public possible ; il faut un DNS interne et une
  autorité de certification interne.
- Une PME sans service informatique a rarement un DNS interne ou une autorité
  installée sur ses postes, mais peut acheter un domaine en quelques minutes ;
  une grande DSI a l'inverse (procédure d'achat longue, AD avec DNS et
  autorité de certification déjà déployés).
Sources : `docs/reflexions/2026-10-14-note-e5-deployeur.md` (section
« Domaine des Previews »).

## Décision
Servir les Previews et la maquette sous un site différent du domaine de
l'entreprise, choisi dans cet ordre selon ce que le client peut fournir.
1. **Domaine enregistrable séparé** (par défaut) : par exemple
   `preview-outils.fr`, certificats publics génériques (Let's Encrypt, défi
   DNS-01 par l'API de l'hébergeur DNS, aucun accès entrant).
2. **`<nom>.internal`** : pour un client qui ne peut pas acheter de domaine
   mais a un DNS interne et une autorité de certification déployée sur les
   postes.
3. **Sous-domaine du domaine de l'entreprise** (dernier recours) : risque
   restant écrit dans la fiche de prérequis et accepté par le client.
- Dans tous les cas : cookies `__Host-` imposés dans le template (ADR-014),
  et le Caddy des Previews et de la maquette retire l'attribut `Domain` de
  chaque `Set-Cookie` qu'il relaie.
- La Prod reste sous le domaine de l'entreprise : son code a passé les gates.

## Alternatives écartées
- Public Suffix List — refusée pour un usage interne, propagation incontrôlée.
- `.internal` par défaut — demande un DNS et une autorité interne que les
  petits clients n'ont pas ; un domaine acheté est plus simple pour eux.
- Domaine séparé exigé — certaines DSI ne peuvent pas en obtenir.
- Même domaine sans autre mesure — un cookie posé par une Preview atteint la
  forge et toutes les applications de l'entreprise.
- `sandbox` CSP sans `allow-same-origin` — casse le stockage local et les
  requêtes authentifiées des outils.

## Conséquences
- Options 1 et 2 : une Preview ne peut plus toucher aux cookies de
  l'entreprise, de la forge ni de la Prod ; les Previews restent du même site
  entre elles, d'où `__Host-` maintenu.
- Option 1 : un domaine à renouveler et une clé d'API DNS à conserver dans un
  coffre ; Caddy doit embarquer le module de l'hébergeur DNS.
- Option 2 : l'autorité interne du client doit être installée sur chaque
  poste qui ouvre une Preview.
- Option 3 : le JavaScript d'une Preview peut encore poser un cookie sur le
  domaine parent ; le retrait de `Domain` par Caddy ne couvre que les cookies
  envoyés par le serveur.
- La maquette et les Previews changent de domaine de base : une variable de
  plus dans l'installation (`domaine_previews`).

## Vérification
- Les tests du template refuseront un cookie sans `__Host-` ou avec `Domain`
  (règle Opengrep et ses cas de test).
- Un test réel du déploiement d'une Preview vérifiera qu'un `Set-Cookie` avec
  `Domain` sort de Caddy sans cet attribut.
- Non vérifiable mécaniquement : l'option choisie chez le client et
  l'acceptation écrite du risque pour l'option 3 (relecture de la fiche de
  prérequis signée).
