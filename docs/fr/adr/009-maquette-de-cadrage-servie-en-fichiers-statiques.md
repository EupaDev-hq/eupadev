---
adr: 009
title: Maquette de cadrage servie en fichiers statiques
status: accepté
date: 2026-10-14
decision-makers: Ilan
supersedes:
related: [ADR-005]
controle: prévu
---
## Contexte
Au cadrage, un agent produit une maquette (pages HTML sur le design system,
sans back) sur une branche d'agent, refaite à chaque correction, que le
demandeur ouvre dans son navigateur d'entreprise. La publier comme image
donnerait l'écriture au registre à un pipeline qui exécute du code d'agent
(« pipeline empoisonné »). Ce code est hostile par principe (faux écran de
connexion, lecture du stockage). Vérifié le 2026-10-13 : la CSP `sandbox`
sans `allow-same-origin` donne une origine opaque ; aucune directive d'une
page ne borne sa propre navigation, mais le `frame-src` de la page qui
**contient** un cadre bloque toute navigation de ce cadre vers une autre
origine (mesuré dans Chromium et Firefox ; hors cadre, la page navigue
librement) ; l'en-tête `Sec-Fetch-Dest` posé par le navigateur dit si une page
est demandée pour un cadre (`iframe`) ou comme page principale (`document`).
Sources : `docs/reflexions/recherche-2026-10-13/recherche-decisions-B.md`
(décision 4), `docs/reflexions/2026-10-13-adr-details.md` (mesures, parade).

## Décision
Servir la maquette de cadrage comme des fichiers statiques du commit de
cadrage, sans construire ni publier d'image, sous un seul nom d'hôte, isolée
dans le navigateur par la CSP.
- **Source** : le moteur lit l'archive du commit par l'API de la forge et la
  passe, avec son sha256, au script de déploiement de la VM CI (commande SSH
  forcée), qui revérifie l'empreinte. Aucun droit nouveau.
- **Extraction** (code de EupaDev) : archive entière refusée, avant toute
  écriture, pour un lien symbolique ou physique, un fichier spécial, un chemin
  absolu ou en `..`, ou au-delà des plafonds réglables (défaut 50 Mo, 2 000
  fichiers) ; seul le sous-dossier convenu, sans les droits d'origine, dans un
  dossier neuf renommé en place si tout réussit.
- **Adresses** : `maquette.<domaine>/<empreinte>/` (certificat ordinaire), et
  un alias par cycle `maquette.<domaine>/<outil>-<cycle>/` vers la dernière
  version. Caddy `file_server`, un seul bloc, sans rechargement.
- **CSP des pages** : `sandbox allow-scripts allow-forms; default-src 'self';
  connect-src 'none'; form-action 'none'; frame-ancestors 'self'` (ni
  `allow-same-origin`, ni `allow-top-navigation`, ni `allow-popups`). Aucun
  cookie sur `maquette.<domaine>` ni sur le domaine parent.
- **Page cadre** de EupaDev : bandeau « Maquette — données fictives » posé
  par le serveur, pages de l'agent dessous dans un `iframe sandbox`, et
  `frame-src 'self'` dans sa CSP.
- **Pages servies seulement dans le cadre** : une page de maquette n'est
  servie que si `Sec-Fetch-Dest` vaut `iframe` ; une navigation de premier
  niveau (`document` : nouvel onglet, adresse copiée) ou une requête sans
  l'en-tête est redirigée vers la page cadre. Les ressources chargées par une
  page (script, style, image, police) restent servies.
- **Retrait** du dossier et de l'alias d'un cycle terminé. **Pas de
  promotion** : la maquette est remplacée par l'image de la branche principale.

## Alternatives écartées
- Image publiée hors branche principale — écriture au registre pour du code
  d'agent, deuxième publication, serveur Node pour du HTML.
- Artefact de pipeline — droit de lecture des pipelines, et rien à
  construire (front sans étape de construction).
- Plateforme de prévisualisation (Coolify, pages de Codeberg) — une
  plateforme de plus ; socket Docker ; EUPL et fin de vie.
- Un sous-domaine par maquette — certificat et DNS génériques chez chaque
  client, alors que l'origine opaque isole déjà chaque page.
- Bandeau inséré dans les pages — l'agent pourrait le masquer.
- Supprimer les liens après extraction — déjà créés et suivis entre-temps.

## Conséquences
- Rien d'agent exécuté côté serveur, aucune image ni droit de plus, pas de
  back montré (voulu). Le JavaScript de l'agent tourne chez le demandeur : la
  CSP est indispensable. Navigation, formulaire, requête et chargement de ressource
  vers l'extérieur sont fermés dans le cadre ; restent des canaux détournés
  non mesurés (WebRTC, résolution DNS anticipée).
- **Sortie du cadre fermée par `Sec-Fetch-Dest`** : une page ouverte seule,
  qui pourrait naviguer librement, n'est plus servie. **Limite** : un
  navigateur qui n'enverrait pas l'en-tête voit la maquette refusée (sûr par
  défaut, maquette inaccessible) ; un client qui forge l'en-tête obtient la
  page, sans risque (rien de secret, aucune saisie du demandeur).
- Mesuré dans Chromium et Firefox seulement (Safari non mesuré). Liens et
  ressources relatifs obligatoires (servis sous `/<empreinte>/`), imposés à
  l'agent de cadrage. La surveillance retire les maquettes des cycles finis.
- Si le front des outils exige un jour une étape de construction, décision à
  revoir (l'artefact de pipeline redevient la piste).

## Vérification
Des tests réels au labo, rejoués par un workflow `verify-*`, avec le
déployeur réel, prouveront que : deux maquettes sous deux chemins, sans
recharger Caddy, ne lisent pas le stockage l'une de l'autre ; l'alias désigne
la dernière version ; une archive piégée (liens, fichier spécial, `../`,
absolu, plafonds) ou d'empreinte fausse est refusée sans rien écrire ;
`document.cookie`, `localStorage`, `fetch` externe, fenêtre et navigation de
la page principale sont bloqués ; un faux formulaire de connexion n'envoie
rien ; une page dans le cadre qui navigue vers une autre origine
(`location.href`, lien, `meta refresh`) est bloquée sans requête reçue de
l'autre côté, dans Chromium et Firefox ; une page de maquette demandée comme
page principale, ou sans `Sec-Fetch-Dest`, est redirigée vers la page cadre ;
le bandeau résiste à une tentative de masquage ; une même empreinte
redéployée ne change rien, et l'empreinte rapportée comme servie est celle du
dossier réellement en place.
