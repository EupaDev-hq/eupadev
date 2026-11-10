---
adr: 027
title: Un agent de diagnostic en lecture seule tourne avant l'ouverture de la porte « durcissement bloqué »
status: proposed
date:
decision-makers: Ilan
supersedes:
related: [ADR-018, ADR-020, ADR-021]
check: in-place
---
> Traduction de `docs/adr/027-diagnosis-agent-before-the-hardening-blocked-gate.md` ; la version anglaise fait foi.

## Contexte
La porte « durcissement bloqué » (`gate_hardening_blocked`) s'ouvre sur un
dépassement de budget ou sur une escalade (stagnation, plafond de tours,
durée). L'admin qui y décide n'est pas développeur ; la porte lui montre
la raison du moteur (quel écart, depuis combien de tours, combien dépensé)
et trois boutons : continuer avec une rallonge, préciser, refuser. Le
cycle 5 du labo (l'outil EPI, premier run payant, 2026-11-02) a ouvert
cette porte par stagnation à 30,12 $ sur 40 : `tests` bloqué au tour 1
(5,30 $), deux relecteurs payés pour relire un dépôt que le builder n'avait
jamais touché (tour 2, 1,39 $ et 1,56 $, « The builder has not built
anything »), le builder arrêté deux fois à son plafond de budget (tours 3
et 4, 8,39 $ et 8,35 $, 79 et 90 tours) et aucune branche builder sur la
forge. La raison affichée (« rapport invalide ou manquant du rôle builder
depuis 2 tours ») était vraie et inutile à l'admin : une rallonge aurait
payé le même échec une fois de plus, et seul le mainteneur pouvait lire
les rapports des tâches et conclure que la plateforme elle-même était en
cause (une tâche coupée par son plafond jetait son bundle ; corrigé
depuis). La porte a besoin d'un verdict en mots simples : pourquoi c'est
bloqué et quel bouton presser.

Le cycle 9 payant (equipment-management, du 2026-11-04 au 2026-11-06,
115,83 $ jusqu'à la Prod) a montré la seconde moitié du problème : le
verdict arrivait trop tard. Des tours ont été payés pour des échecs
qu'aucun agent ne pouvait corriger, chacun vu par le moteur comme un
contrôle rouge ordinaire : les contrôles de sécurité de la Preview, à la
plateforme, ont atteint leur propre limite de débit (429) pendant cinq
tours, environ 10 $ ; pa11y a audité la redirection vers la connexion en
pleine navigation et le disque du runner CI était plein, un tour d'environ
2,40 $ par mauvaise hypothèse ; le YAML du contrat a cassé l'image au
démarrage, payé jusqu'à la porte d'escalade. Le moteur n'a aucun signal
déterministe qui distingue ces cas d'un défaut du code des agents : le
guetteur de la forge fait de chaque job échoué un contrôle rouge, ajoute
un `pipeline` rouge synthétique seulement quand un run échoue sans job
rouge, et ne lisait le journal d'un job que pour deux contrôles
(`acceptance`, `analysis`) ; la raison d'échec d'une tâche est du texte
libre. Lire ensemble le journal du contrôle rouge et les rapports du tour,
c'est ce que fait le diagnostic ; il doit tourner avant le tour payant
suivant, pas après trois.

## Décision
Lancer une tâche d'agent `diagnosis` en lecture seule avant l'ouverture de
la porte « durcissement bloqué », et montrer son verdict sur la porte ; la
lancer aussi après le premier tour échoué pour une raison que les agents
n'ont pas produite, et arrêter le cycle sur un verdict « plateforme » ou
« demande imprécise » avant le tour payant suivant.
- **Déclenchement à la porte** : chaque transition vers
  `gate_hardening_blocked` (budget dépassé à l'entrée du tour, escalade à
  l'entrée du tour ou à l'évaluation). Un diagnostic par situation : le
  dernier est réutilisé tant qu'aucune tâche de durcissement n'a tourné
  depuis (porte rouverte par le même dépassement) ; jamais un par visite.
- **Déclenchement au premier tour échoué** : à l'entrée d'un tour (là où
  les compteurs sont vérifiés, D15), quand le tour qui vient de finir
  porte un échec que les agents n'ont pas produit — un contrôle rouge de
  la CI ou du pipeline de Preview (écart sur `pipeline`), une tâche
  échouée sans avoir été arrêtée à son plafond ni refusée par le schéma
  (lanceur, moteur, conteneur), ou une tâche `blocked` sur un point
  ouvert. Une fois par situation : jamais quand une tâche `diagnosis` a
  été créée depuis la première tâche de durcissement du premier tour
  compté depuis la dernière remise à zéro des compteurs ; ensuite, la
  règle de stagnation de D20 s'applique telle quelle. Jamais pour un tour
  joué avant cette remise à zéro : la porte qui a remis les compteurs à
  zéro l'a diagnostiqué, un second diagnostic avant le premier tour du
  nouveau périmètre paierait deux fois la même situation.
- **Bloqué sur le contrat** (2026-11-09) : un rôle de code qui finit
  `blocked` avec au moins un constat dont l'`owner_role` est `contract`
  arrête le tour dans le tour lui-même : pas d'écart `report:<role>`, pas
  de relance, `hardening_execution --[guard:escalation]-->
  gate_hardening_blocked` aussitôt ; le diagnostic de la porte y tourne,
  une fois. La raison cite le constat (règle, fichier, preuve, chacun
  borné comme `taskFact` borne un rapport, texte non fiable montré comme
  du texte) et recommande la sortie « Changer le périmètre » ; l'admin
  choisit, le moteur ne présélectionne rien. Un simple `blocked` (une
  raison, pas de tel constat) garde le chemin ci-dessus : le point ouvert
  peut être celui des agents, le tour suivant ou le diagnostic du premier
  tour échoué le tranche.
- **Entrées, en données** : les tâches du cycle (étape, rôle, tour,
  statut, coût, ce que dit le rapport, borné), les écarts par tour, la
  raison de l'escalade, le budget, les commits en avance sur main de la
  branche de chaque rôle de code lus sur la forge, la conversation, les
  contrôles rouges depuis la dernière remise à zéro avec la fin du journal
  de chaque job (le guetteur lit les 40 dernières lignes non vides de
  chaque job rouge, horodatages, couleurs et caractères de contrôle
  retirés, chaque ligne coupée à 300 caractères, rangées dans
  `pipeline_results.details.log_tail` ; réutilisables comme données pour
  d'autres rôles si une décision ultérieure le dit), et une
  pré-vérification déterministe calculée par le moteur (rôle de code
  arrêté deux fois à son plafond sans commit, rôle qui n'a jamais livré,
  tâche bloquée et son point). Le contrat est lu dans son clone (main).
  Comme `overlap`, il n'a que `Read` (ADR-020 : pas de shell) ; comme tout
  rôle, ses consignes viennent de l'image du moteur (ADR-018).
- **Sortie** : un champ `diagnosis` du rapport commun, validé par le schéma
  et lu par le moteur : `cause` parmi {`slow_progress`, `unclear_request`,
  `platform_or_impossible`}, une explication de deux à quatre phrases pour
  un non-développeur, des lignes de preuve, et une recommandation qui doit
  correspondre à la cause (une rallonge en USD, la question exacte pour le
  demandeur, ou aucune des deux : refuser et transmettre le rapport aux
  mainteneurs d'EupaDev). Une incohérence vaut « indisponible », jamais un
  verdict.
- **Verdict au premier tour échoué** : `platform_or_impossible` ou
  `unclear_request` → `hardening_execution --[guard:escalation]-->
  gate_hardening_blocked` aussitôt, la raison nommant le tour et les
  lignes du verdict ; la porte réutilise ce diagnostic et ses boutons
  sont les sorties (continuer, correction, changement de périmètre,
  refuser ; la question pour le demandeur est entre les mains de l'admin,
  la machine n'a pas de transition du durcissement vers le demandeur).
  `slow_progress`, ou pas de verdict utilisable : le tour démarre comme
  avant.
- **Jamais d'impasse** : un diagnostic échoué, bloqué, hors délai ou
  illisible ajoute une ligne « diagnostic indisponible » et la porte
  s'ouvre avec la raison seule ; au premier tour échoué, il laisse le tour
  démarrer.
- **Coût** : plafond 2 $, 25 tours, 15 minutes, Sonnet ; dépensé par le
  cycle (mesures, tableau de bord) mais jamais compté par les garde-fous
  du durcissement (vérification du budget, durée de travail des agents),
  pour qu'il ne puisse pas rouvrir la porte qu'il sert. Au plus une tâche
  de plus par situation pour le premier tour échoué.
- **Base** : la contrainte `tasks.role` admet `diagnosis` par une nouvelle
  migration qui garde les anciennes valeurs.

## Alternatives écartées
- Des règles seules, sans agent — la pré-vérification nomme les faits
  qu'elle sait calculer (plafonds, commits, points bloquants) ; distinguer
  une demande imprécise d'une demande impossible demande de lire ensemble
  les rapports et la conversation, ce que fait l'agent. La
  pré-vérification reste, comme faits que l'agent cite.
- Un arrêt déterministe au premier tour échoué (contrôle `pipeline` rouge,
  exceptions du lanceur) — il se déclenche zéro fois sur les trois échecs
  du cycle 9, tous apparus comme des jobs rouges de la CI du modèle, comme
  l'aurait fait un défaut du code.
- Un diagnostic à chaque porte — les autres portes bloquées (cadrage,
  contrat, livraison, prod) montrent un échec technique unique que l'admin
  peut lire ; seule la porte de durcissement agrège tours, rapports et
  écarts.
- Un diagnostic après chaque tour non conforme — jusqu'à 25 × 2 $ par
  périmètre ; le premier échec que les agents n'ont pas produit est là où
  les tours ont été perdus, la règle de stagnation couvre le reste.
- Arrêter aussi sur `slow_progress` — un tour que les agents pouvaient
  gagner serait escaladé ; le verdict dit qu'ils avancent.
- Compter le diagnostic dans la vérification du budget — avec une rallonge
  égale à la suggestion de l'agent, le coût du diagnostic lui-même
  rouvrirait la porte.
- Relancer un diagnostic échoué à chaque réouverture — le coût borné
  l'emporte : une tentative par situation, l'admin décide avec la raison
  seule.

## Conséquences
L'admin lit une cause et une recommandation dans ses mots ; un défaut de
plateforme part chez les mainteneurs au lieu d'être payé une fois de plus,
après un tour au lieu de trois ; un point ouvert du contrat est demandé
après un tour au lieu de payer des relectures d'un dépôt vide. Chaque
porte bloquée coûte jusqu'à 2 $ de plus, et un tour échoué par le propre
code des agents peut payer une tâche de 2 $ de plus avant le tour 2 ; le
verdict est l'avis d'un agent, donc le moteur en vérifie la forme (cause
fermée, recommandation cohérente) et l'admin garde la décision. Un verdict
faux coûte une décision ; les lignes de pré-vérification, déterministes,
et les fins de journal des contrôles rouges restent visibles pour le
contredire. Le guetteur lit un journal de plus par job rouge (fin bornée).

## Vérification
La CI du moteur vérifie : par `tests/diagnosis.test.ts`, sur les données
du cycle 5 du labo, l'assemblage des données de la tâche, la ligne de
pré-vérification nommant le builder arrêté deux fois sans commit, la
lecture d'un rapport `platform_or_impossible` et sa ligne de porte dans
les deux langues, le refus d'un rapport dont la recommandation contredit
la cause, le déclenchement du premier tour échoué (contrôle rouge, tâche
échouée sans plafond ni rapport invalide, tâche bloquée ; jamais sur les
seuls constats des relecteurs ; une fois par situation, de nouveau après
une remise à zéro) et les contrôles rouges bornés dans les données ; par
les scénarios Gherkin de `features/hardening-review.feature` (ADR-027 à
ADR-027 septies), avec le moteur factice, que le diagnostic tourne avant
l'ouverture de la porte avec la pré-vérification dans son contexte, que
son verdict atteint la notification de l'admin, qu'un diagnostic échoué
ouvre quand même la porte avec la ligne « indisponible », que son coût est
hors de la vérification du budget, qu'une porte rouverte par le même
dépassement ne crée pas de seconde tâche, qu'un contrôle de Preview rouge
au tour 1 suivi d'un verdict « plateforme » ouvre la porte avant toute
tâche du tour 2 avec la fin de journal dans le contexte du diagnostic,
qu'une tâche bloquée au tour 1 suivie d'un verdict « demande imprécise »
fait de même avec la question, qu'un verdict « progression lente » laisse
démarrer le tour 2 et ne paie pas de second diagnostic anticipé au tour 2,
et qu'un diagnostic anticipé échoué laisse démarrer le tour 2 ; par
`tests/instructions.test.ts`, que le rôle a ses consignes sous le plafond
de mots ; par `tests/gitea-forge.test.ts`, que la forge compte les commits
de chaque branche de rôle et range la fin de journal bornée de chaque job
rouge ; par `tests/mutations/mutations.ts` (`ADR027-…`), que chacune de
ces règles a une mutation tuée par son test.
