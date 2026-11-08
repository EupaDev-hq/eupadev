---
adr: 031
title: Commandes du chat en mots simples, un petit modèle ramène une phrase à une action permise ou à « pas clair »
status: proposed
date:
decision-makers: Ilan
supersedes:
related: [ADR-013, ADR-017, ADR-018, ADR-024, ADR-027]
check: planned
---
> Traduction de `docs/adr/031-chat-commands-in-plain-words.md` ; la version anglaise fait foi.

## Contexte
Tout ce qu'une personne peut faire dans un cycle est l'un de six messages
d'API strictement validés : l'avis du demandeur sur la maquette (satisfait,
correction) et sur la Preview (satisfait, bug, nouvelle capacité), son
abandon et son message libre, la décision de l'admin à une porte
(approuvé, correction, refusé, changement de périmètre, avec une rallonge
facultative aux quatre portes dont la phase a une enveloppe et le digest
candidat à la porte 2) et l'annulation. L'identité, la casquette et la
règle des quatre yeux sont appliquées par le serveur depuis le jeton,
jamais depuis le corps (ADR-017). Sur la page web du demandeur (ADR-024,
commit 6f9261d), un texte tapé n'agit jamais seul : une phrase faite
uniquement de mots d'accord (listes `YES` et `FILLER` de
`orchestrator/web/app.js`) demande « vouliez-vous approuver ? », toute
autre phrase demande de quel avis il s'agit, et chaque issue est un clic ;
l'admin décide à une porte par une carte avec une zone de commentaire, une
zone de rallonge et un bouton par issue, la saisie du chat désactivée.
Ilan l'a testé le 2026-11-06 : « tout synonyme de OK doit être compris
comme OK ; tu dis "j'approuve", ça approuve ; tu dis "je rallonge le
budget", ça rallonge le budget, simplement, ça ne doit pas approuver ni
lancer une correction à la place ». Des listes de mots ne distinguent pas
« ok mais le filtre manque » de « ok, super », ni « approuve avec 20 de
plus » de « 20 tours et toujours rien, refuse », sans devenir une
grammaire que personne ne maintient. La seule route vers le fournisseur
d'IA est le proxy IA de la VM agents, qui ajoute la clé depuis un fichier
et ne publie aucun port ; la VM moteur (pilote, API, page) n'a ni route IA
ni clé. Un petit modèle appelé par la plateforme elle-même a un
précédent : la tâche de diagnostic (ADR-027) et le rôle `overlap` sur
Haiku. Source : `docs/reflexions/2026-11-07-note-chat-natural-commands.md`.

## Décision
Comprendre une phrase tapée avec un petit modèle qui ne peut répondre que
l'une des actions que l'état courant permet à la casquette de la personne,
ou « pas clair », et laisser le propre message d'API de la personne porter
la décision.
- **Énumération bornée** : pour chaque phrase, le moteur calcule l'ensemble
  permis depuis la machine à états (`gateOutcomes`, les événements d'avis
  des états d'attente, `topUpEnvelope` pour le nom de la rallonge, les
  états d'abandon) ; la réponse du modèle est un objet JSON
  `{ intent, amount_usd? }` dont `intent` est une énumération de cet
  ensemble plus `unclear`. Un demandeur à une porte, ou quiconque dans un
  état qui n'attend rien, a un ensemble vide et le modèle n'est pas appelé.
- **Revalidation serveur** : une réponse hors de l'ensemble, un nom de
  rallonge sans montant, un montant avec un autre nom, au-dessus du
  plafond (`MAX_TOP_UP_USD`) ou à une porte sans enveloppe devient
  `unclear`. Le modèle n'écrit rien qu'un humain lise et ne réécrit jamais
  la phrase : le texte de l'humain, tel quel, est le `text` ou le `comment`
  du message.
- **La décision reste celle de la personne** : le point d'entrée d'intention
  (`POST /requests/<id>/intent`, cookie ou Bearer, en-tête `X-EupaDev`,
  limite d'appels par acteur) renvoie l'intention comprise et si elle est
  payante ; la page poste ensuite exactement le message qu'un bouton aurait
  construit, par `POST /messages`, sous l'acteur et la casquette de la
  personne, avec toutes les vérifications existantes (quatre yeux, digest,
  règles du commentaire et de l'enveloppe). Chaque phrase, son ensemble
  permis, la réponse, le modèle et son coût sont enregistrés dans la table
  `intents`.
- **Politique de confirmation** : une action gratuite agit tout de suite ;
  une action payante (correction, bug, nouvelle capacité, changement de
  périmètre, rallonge, approbation qui relance des agents) montre ce qui a
  été compris et un seul bouton « Approuver », rien n'est dépensé avant le
  clic ; une seule question, seulement quand la phrase n'est pas nette, sur
  toute action, jamais deux questions de suite ; une rallonge lue dans une
  phrase est une rallonge, elle n'approuve ni ne lance une correction par
  elle-même ; chaque phrase reçoit une réponse en mots, une phrase pour une
  autre casquette ou un autre endroit se voit dire où aller.
- **Route C** : l'appel tourne sur l'exécuteur (VM agents) comme workflow
  DBOS sur sa propre file, atteignant le proxy IA par un réseau interne
  dédié ; le pilote lance le workflow et attend avec une échéance. La VM
  moteur ne reçoit ni route IA ni clé. L'identifiant du modèle et l'effort
  sont de la configuration, le prompt est livré dans l'image du moteur
  (ADR-018).
- **Mode dégradé** : modèle injoignable, exécuteur en pause, délai dépassé,
  réponse malformée ou `unclear` → la page retombe sur les listes de mots
  et la question avec boutons, et l'admin est prévenu quand la
  compréhension elle-même a échoué. Jamais une supposition sur une action
  payante ou irréversible.
- **Lecteur factice** : le lecteur est derrière un contrat
  (`IntentReader` : casquette, état, ensemble permis, langue, question en
  attente, texte → intention, montant) avec un factice bâti sur les listes
  de mots, pour que chaque test tourne sans appel d'IA (esprit de
  l'ADR-013) et qu'un autre fournisseur reste possible.

## Alternatives écartées
- Les listes de mots seules, étendues — négation, contraste, intentions
  mêlées à des nombres et deux langues font de chaque nouveau mot un
  commit, et un faux positif agit pour de vrai ; gardées comme mode dégradé
  seulement.
- Des réponses en texte libre du modèle — un texte du modèle montré à un
  humain ou posté comme message est une surface d'injection ; l'énumération
  et les chaînes du dictionnaire ne lui en laissent aucune.
- Le pilote appelle le proxy IA par le réseau du labo (route A) — le proxy
  qui ajoute la clé écouterait sur un port de VM depuis lequel quiconque
  l'atteint peut dépenser.
- Un second proxy IA ou la clé sur la VM moteur (route B) — la clé à deux
  endroits, sur le composant le plus exposé.
- Zéro confirmation sur les actions payantes — une correction mal lue lance
  des agents pour de vrai ; un clic après la phrase comprise coûte moins que
  l'exécution.
- Une règle « toujours une question sur les actions irréversibles » — un
  « je refuse » net serait toujours demandé deux fois ; la question est
  réservée à une phrase qui n'est pas nette.

## Conséquences
- La personne parle ; les boutons deviennent le repli et la carte de porte
  une information. Chaque phrase coûte une fraction de centime et une à
  trois secondes, comptées par le cycle, jamais par les garde-fous de budget.
- La compréhension a besoin de la VM agents allumée : sinon la page demande
  avec des boutons, comme aujourd'hui, et l'admin l'apprend.
- Une mauvaise classification parmi les intentions permises reste possible ;
  son dégât est borné par le clic sur les actions payantes et la question
  sur les phrases qui ne sont pas nettes ; refus, abandon et porte 2 restent
  irréversibles par nature.
- Les boutons ne sont retirés qu'après qu'un jeu d'évaluation de quarante
  phrases par casquette atteint 100 % de correct-ou-pas-clair sur les lignes
  payantes et irréversibles, sur le labo, avec le vrai modèle ; ce jeu est
  ensuite la preuve du prompt et du câblage à chaque changement de prompt.

## Vérification
La CI du moteur vérifiera, sans base de données : l'ensemble permis par état
et casquette (un demandeur à une porte reçoit un ensemble vide, le nom de la
rallonge n'existe qu'aux quatre portes à enveloppe, la porte incident offre
réessayer et refuser) et la revalidation (hors de l'ensemble, montant
au-dessus du plafond, rallonge sans montant, montant avec un autre nom →
`unclear` ; une réponse de rallonge n'est jamais transformée en
approbation), une mutation par règle. Contre un PostgreSQL jetable : le
point d'entrée refuse un en-tête manquant, un jeton manquant et un inconnu,
limite les appels par acteur, enregistre chaque phrase dans `intents`, que
le moteur ne peut ni modifier ni supprimer. Par la page (Playwright, lecteur
factice) : « j'approuve » poste l'avis, « ok mais le filtre manque »
demande, un « approuve la porte 2 avec 100 000 » d'un demandeur ne poste
jamais de décision, une intention payante attend le clic. Sur le labo : une
recette Ansible fera passer une phrase par la route de l'exécuteur avec un
amont factice, vérifiera que le conteneur exécuteur n'atteint rien d'autre
de nouveau et que `PAUSE_AGENTS=1` donne le repli. Non vérifiable
mécaniquement : la justesse du modèle (mesurée par le jeu d'évaluation,
consignée dans la note) et la netteté d'une phrase.
