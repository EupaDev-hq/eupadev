---
adr: 016
title: Registre npm en lecture seule pour les agents, miroir Verdaccio
status: proposé
date:
decision-makers: Ilan
supersedes:
related: [ADR-005, ADR-007]
controle: prévu
---
## Contexte
Les agents codent dans des conteneurs isolés de la VM « agents », sans route
vers Internet sauf par Smokescreen, proxy CONNECT à liste de domaines, qui
n'autorise que `registry.npmjs.org` pour `pnpm install`. Smokescreen voit le
nom demandé, pas le contenu chiffré : dans ce tunnel, un agent compromis
(injection de consigne) peut publier un paquet contenant du code ou des
données (`npm publish`, avec un jeton trouvé ou un compte créé pour
l'occasion), puis le relire de n'importe où ; `unpublish`, `dist-tag` et
`PUT` bruts passent aussi. Depuis décembre 2025, npm exige la 2FA pour
publier, ce qui réduit ce risque sans l'annuler. OpenAI (Codex cloud) limite
les méthodes à `GET`, `HEAD`, `OPTIONS`. Par ailleurs, l'âge minimal de
publication (`minimumReleaseAge`, 1 jour) est un réglage de pnpm, donc du
client : un agent compromis peut le remettre à zéro. Or 1 jour est un
plancher (pnpm 11, Yarn 4.10, npm 11.10) : Dependabot attend 3 jours par
défaut, et Shai-Hulud 2.0, publié du 21 au 23 novembre 2025, n'a été
signalé largement que le 24. L'âge ne protège pas d'un attaquant patient
(xz-utils, event-stream) : il faut aussi refuser les paquets malveillants
connus (OpenSSF S2C2F, ING-3 et SCA-4).
Faits relevés le 2026-10-15 : Verdaccio (MIT, 6.10.5 du 2026-10-03) est un
registre npm à cache amont ; une règle de paquet sans `publish` « ne
correspond à personne » ; une faille de septembre 2026 (GHSA-vjgw-2g79-p7w7,
corrigée en 6.10.1) contournait ces règles. Verdaccio embarque son greffon
`@verdaccio/package-filter` (MIT, jeune : mars 2026), qui masque les
versions récentes et refuse leurs archives, mais **en échec ouvert** : une
erreur du greffon sert le manifeste ou l'archive sans filtre. Un faux
greffon Verdaccio voleur d'identifiants a circulé en août 2026. Smokescreen
sans certificat client applique la même règle à tous ses clients. Nexus CE
n'offre npm que sous EULA Sonatype, plafonné ; Artifactory OSS n'a pas npm.
Détail et sources :
`docs/reflexions/2026-10-15-recherche-registre-npm-lecture-seule.md`.

## Décision
Faire passer toutes les installations npm des agents par un miroir Verdaccio
en lecture seule sur la VM agents, seul à joindre `registry.npmjs.org`.
- **Miroir** : Verdaccio ≥ 6.10.1, image officielle désignée par empreinte,
  version de `@verdaccio/package-filter` embarquée figée ; aucun greffon
  ajouté, hors portée `@verdaccio` ; scannée et signée comme les autres.
- **Lecture seule, deux barrières** : un Caddy devant Verdaccio ne laisse
  passer que `GET` et `HEAD` (405 sinon) et refuse `/-/user/`,
  `/-/v1/login` et l'audit ; derrière, une seule règle `'**'` avec
  `access: $all` et `proxy: npmjs`, sans `publish` ni `unpublish`,
  inscription coupée (`max_users: -1`), interface web et `audit` coupés.
- **Âge minimal imposé par le miroir** : 3 jours (`minAgeDays: 3`) ; un
  correctif urgent passe par la liste `allow` du greffon, modifiée
  seulement après validation humaine. pnpm garde son réglage à 1 jour.
- **Paquets malveillants connus** : `osv-scanner` en CI sur le fichier de
  verrouillage (base OSV, fiches `MAL-` d'OpenSSF) fait échouer la CI.
- **Miroir ouvert filtré**, pas de liste fermée : toute nouvelle dépendance
  directe est contrôlée en CI et relue par un humain ; scripts
  d'installation bloqués (`strictDepBuilds`), et une modification de
  `allowBuilds` par un agent exige une relecture humaine en CI.
- **Réseau** : le miroir (son Caddy) est branché sur chaque réseau de tâche
  comme les proxys (désigné par IP, `ip_forward=0`) ; l'agent reçoit
  `npm_config_registry=http://<IP>:4873/` et l'IP dans `NO_PROXY`.
  `registry.npmjs.org` sort de la liste du Smokescreen des agents ; le
  miroir sort par une deuxième instance Smokescreen, à lui seul, limitée à
  `registry.npmjs.org` (IP privées refusées).
- **Échec fermé** : miroir arrêté = installation impossible, aucun repli
  direct ; greffon absent ou configuration invalide = miroir non démarré
  ou refusé par le test de filtrage, jamais servi sans filtre. Cache sur un
  volume Docker, jamais sauvegardé (reproductible).

## Alternatives écartées
- Garder l'accès direct par Smokescreen — l'écriture vers npm reste ouverte.
- Règles de Verdaccio seules contre l'écriture — elles ont déjà été
  contournées (GHSA-vjgw-2g79-p7w7).
- Âge de 1 jour au miroir — plancher du marché, plus court que le délai de
  détection de Shai-Hulud 2.0 ; 7 jours retarderait trop les correctifs.
- Liste fermée de paquets — chaque dépendance demanderait une validation ;
  la pratique (S2C2F ENF-2, JFrog Curation, Sonatype Firewall) est un miroir
  ouvert filtré par politiques.
- Nexus Repository CE — npm hors du cœur libre, EULA, plafonds.
- Artifactory OSS — sans npm, AGPL-3.0.
- Registre de paquets de Gitea — pas de cache amont npm, sur la forge.
- npm-registry-firewall — sans publication depuis novembre 2023.
- Interception TLS pour filtrer les méthodes — une autorité de
  certification dans chaque conteneur.
- Magasin pnpm prérempli, agents hors ligne — plus d'ajout de dépendance.
- Faire sortir le miroir par le Smokescreen des agents — règle commune : les
  agents garderaient l'accès à npm.

## Conséquences
- Plus aucune écriture vers npm depuis les agents ; l'âge minimal ne dépend
  plus du client. Le cache accélère les installations répétées.
- Une version de moins de 3 jours est indisponible : un correctif urgent
  attend une validation humaine.
- Un Caddy, un service, une instance Smokescreen de plus à maintenir ; un
  disque qui grandit (pas d'expiration des archives) : purge à prévoir.
- Le filtre d'âge repose sur un greffon jeune, en échec ouvert : seul le
  test le rend fiable, à refaire à chaque mise à jour de Verdaccio.
- Une faille d'écriture de Verdaccio permettrait d'empoisonner le cache
  commun ; le fichier de verrouillage (`integrity`) protège les versions
  déjà verrouillées.
- Restent des canaux très faibles : compteurs publics de téléchargement,
  noms demandés vus par npm. Les vérifications de provenance dépendent de ce
  que le miroir transmet.

## Vérification
`verify-agents.yml` contrôlera au labo, sous runc et runsc : `pnpm install`
du template par le miroir ; réponse 405 du Caddy à toute méthode autre que
`GET`/`HEAD` ; refus de `npm publish`, `unpublish`, `dist-tag`, `deprecate`,
`adduser`, `PUT` et `DELETE` bruts, y compris avec un nom à portée suivi de
`/`, et rien d'écrit dans le stockage ; refus (407) d'un CONNECT vers
`registry.npmjs.org` par le Smokescreen des agents ; refus d'une version de
moins de 3 jours dans le manifeste et en `GET` direct de son archive (curl,
et `pnpm install --frozen-lockfile` avec un lockfile qui la désigne), cache
froid et chaud, même avec `minimumReleaseAge=0` ; greffon mal nommé ou
configuration invalide → miroir non démarré ou test en échec ; refus par le
Smokescreen du miroir de tout autre nom et des IP privées ; échec de
l'installation miroir arrêté. La CI des outils lancera `osv-scanner` sur le
fichier de verrouillage et signalera tout changement de `allowBuilds`.
L'image sera désignée par empreinte (ADR-005) et scannée par Trivy. Non
vérifiable mécaniquement : l'absence d'autre canal de sortie vers npm, la
justesse de la liste `allow`.
