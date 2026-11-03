# Glossary — French → English

Step 0 of the English switch, 2026-10-28, built on commit `77e6d10`. This file is **the** French → English mapping:
every later step follows it. A name that is not here is added here, with its English form, in the commit that renames
it; changing an English choice changes this file first. The French column is the name before the switch, and the
Where column the files as they were then (commit `77e6d10`); the English column is the final name.

- One row per French term: French | English | Where (representative files) | Notes.
- **Words** is the word dictionary: any name not listed is translated word by word with it, then put in English
  word order (Rules). The area sections list the concrete names with their final form; when a row departs from
  Words it says why (`override:`).
- Rows marked "not checked" are English homographs or function words that `check-english.py` does not report alone.
- `check-english.py` reads this file: the Words table (unaccented French words, matched alone or inside
  identifiers) and the compound French terms of the other tables (matched whole).

## Method and counts

How the term list was built, so that completeness can be checked:

1. **Scan** of the 573 tracked files outside the private notes (lockfiles excluded): JS/TS parsed with the
   TypeScript compiler API (declarations, exports, parameters, object keys, property accesses, string literals,
   `process.env`); Python with `ast`; YAML with PyYAML (keys, scalars, Jinja expressions, paths, SQL and options inside
   commands); SQL by statement (tables, columns, functions, triggers, constraints, indexes, roles, CHECK values,
   `RAISE`); JSON keys and values; Gherkin quoted values and tags; HTML/CSS attributes, ids and classes;
   identifiers of shell, Dockerfile, Caddyfile, Jinja templates and the other files; every path component.
   125,252 name occurrences.
2. **Words.** Names split into words (camelCase, snake_case, kebab-case), each word classified with the French and
   American English word lists of `/usr/share/dict`, homographs and abbreviations reviewed by hand: 1,422 French
   words found in names; the Words table has 1,453 rows after the curators' additions (senses, abbreviations).
3. **Inventory.** 6,002 distinct names contain a French word. Per area, a curator read the code and kept a row
   for every name that crosses a file or process boundary (path, export, shared identifier, option key, object
   shape, environment variable, route, SQL object, stored value, log field, error code, infra name, wire format);
   one-file locals, Ansible `register:` names, task names, test titles, mutation ids and prose are renamed by rule
   (each area's Rules gives them with counts).
4. **Consistency**, checked by script: every row follows Words or says `override:`; no French term has two English
   forms unless the notes give the two senses; no two French terms share one English name inside a section.

| Section | Rows |
|---|---|
| Domain terms | 83 |
| Words | 1,453 |
| Core and example tool | 373 |
| Tool template and agent image | 172 |
| Engine | 1,530 |
| Infra | 443 |
| CI, scripts, docs and ADRs | 99 |
| **Total** | **4,153** |

French lines reported by `check-english.py` on `77e6d10` with this glossary (allowed paths excluded), per top-level
directory:

| Directory | Lines |
|---|---|
| `orchestrateur/` | 16,989 |
| `infra/` | 10,359 |
| `socle/` | 3,951 |
| `docs/` | 2,030 |
| `exemples/` | 1,125 |
| `images/` | 731 |
| root files | 706 |
| `.github/` | 617 |
| `template-outil-ia/` | 614 |
| `agent-runner/` | 97 |
| `tests/` | 68 |
| **total** | **37,287** |

## Rules

- **Word order**: English puts modifiers before the head noun (`cycleOutil` → `toolCycle`, `outils_historique` →
  `tool_history`, `postgres-jetable.ts` → `throwaway-postgres.ts`); a French plural used as a modifier becomes
  singular (`acteurs_identites` → `actor_identities`); a verb first stays first (`generer-transitions.ts` →
  `generate-transitions.ts`).
- **Families stay families**: SQL objects keep `<table>_<purpose>` with the translated table name; state ids keep
  the `gate_`, `waiting_`, `hardening_`, `end_` prefixes; Ansible variables keep their translated `<role>_` prefix.
- **Forms**: timestamps `*_le` → `*_at`; predicates `estX` → `isX`; `sans` in a name → `no` (`*_sans_truncate` →
  `*_no_truncate`); French "base (de données)" → `db`.
- **Casing and separators** are kept (camelCase, snake_case, kebab-case, UPPER_SNAKE); abbreviations stay short
  (`dir`, `repo`, `db`, `env`).
- **Spelling**: British English, as the existing English documents (`organisation`, `licence`, `catalogue`).
- **Decisions of 2026-10-28**: L1 `socle` → `core` (`@eupadev/core`, `core/`, `/core/…`); L2 and L3 the
  migrations of the core and of the example tool rewritten in place (every database carrying them is rebuilt); L5
  `demandeur` → `requester`, `lecteur` → `reader`, `gestionnaire` → `manager`, `admin` stays; L8 `orchestrateur/` →
  `orchestrator/`, `template-outil-ia/` → `tool-template/`, `exemples/` → `examples/`, Gitea repos `moteur` → `engine`,
  `image-base` → `base-image`; L9 live names renamed directly (the lab is rebuilt); L10 human-facing texts in
  `lang/en.json` + `lang/fr.json` next to the code that shows them, English keys; L6 the ADRs' vocabulary and file
  names translated once (ADR-026); L7 the private notes keep their French names and are not published (ADR-025).
- **Final names only**: a step that touches a name writes its final English name, never a half-translated one.
- **Product name**: renamed by the product rename pass (step 9) in its three casings, see Product name below.
- **Not renamed**: third-party names (Gitea and Keycloak API fields, DBOS API, npm packages of others, HTTP
  headers); the private notes (L7).
- **French copies**: root files `X.fr.md`; everywhere else `docs/fr/` mirroring the English path and file name.
- **Prose** (comments, messages, documents, test titles) is translated, not listed; its domain words follow Domain
  terms below.

## Product name

Step 9 (product rename pass) replaced the former product name by `EupaDev` everywhere outside the private notes:
prose, npm scope, Docker labels, paths, systemd units, environment variables, Gitea organisation, Keycloak realm and
clients, HTTP header, VM names. Only its three casings existed; each keeps its casing. These rows, the ADR checker
(`--new-product-name`, ADR-026) and its test are the only places where the former name remains.

| Former | New | Where | Notes |
|---|---|---|---|
| `ForgeAgent` | `EupaDev` | prose, titles | display form; not checked (not French) |
| `forgeagent` | `eupadev` | `@eupadev/*`, `/opt/eupadev`, `eupadev-*` units and VMs, Gitea organisation, Keycloak realm and `eupadev-*` clients, `x-eupadev` header, `eupadev.*` labels | identifiers; not checked (not French) |
| `FORGEAGENT` | `EUPADEV` | `EUPADEV_*` environment variables, `EUPADEV-*` frame markers | upper case; not checked (not French) |

## Domain terms

The vocabulary of the platform. Every identifier, file name, message and document uses these English words for
these concepts (prose, identifiers and wire values alike).

| French | English | Where | Notes |
|---|---|---|---|
| `outil` | `tool` | everywhere | a generated business application |
| `outil généré` | `generated tool` | ADR-019, template | |
| `socle` | `core` | `socle/`, `@eupadev/socle` | L1: the shared runtime library of the tools (`@eupadev/core`, `core/`, `/core/…`) |
| `moteur` | `engine` | `orchestrateur/`, Gitea repo `moteur`, `images/moteur/` | the platform engine; also the agent engine (`moteur d'agent` → agent engine) |
| `orchestrateur` | `orchestrator` | `orchestrateur/`, `svc-orchestrateur` | L8: the engine process that drives cycles ("chef d'orchestre" → orchestrator) |
| `pilote` | `pilot` | `EUPADEV_ROLE=pilote` | the engine role that runs workflows, as opposed to the executor |
| `exécuteur` | `executor` | `executeur`, `executeur-agents` | the engine role that runs agent tasks |
| `lanceur` | `launcher` | `lanceur.feature`, architecture.md | agent launcher |
| `déployeur` | `deployer` | `deployeur.py`, ADR-022 | the deployment target script |
| `cycle` | `cycle` | `cycles` | unchanged: one creation or evolution of a tool |
| `création` / `évolution` | `creation` / `evolution` | `cycles.type` | cycle kinds, unchanged spelling |
| `demande` | `request` | `/demandes`, `demande_recue` | a person's request for a tool (an HTTP request is also `request`; say "tool request" when ambiguous) |
| `demandeur` | `requester` | Keycloak role, `auteur_type` | L5 |
| `lecteur` | `reader` | test realm, tool roles | L5 |
| `gestionnaire` | `manager` | test realm, tool roles | L5 |
| `casquette` | `hat` | ADR-017, `CASQUETTES` | a person's role on the platform (requester or admin) |
| `quatre yeux` | `four eyes` | Gate 2, `QUATRE_YEUX_DEROGATION_SUJET` | |
| `dérogation` | `exemption` | `derogation_quatre_yeux` | |
| `cadrage` | `scoping` | state `cadrage`, role `scoping` | |
| `maquette` | `mock-up` (prose), `mockup` (names) | `deploiement_maquette`, `maquette.<domain>` | |
| `chevauchement` | `overlap` | `gate_chevauchement`, role `overlap` | |
| `contrat` | `contract` | state `contrat`, `contrat.js` | OpenAPI + Gherkin contract of a tool |
| `durcissement` | `hardening` | `durcissement_*` | |
| `livraison` | `delivery` | phase `livraison` | |
| `revue` / `relecture` | `review` | `durcissement_revue` | |
| `relecteur` | `reviewer` | `security-reviewer` | |
| `tour` | `round` | `plafond_tours` | a hardening round; an agent's model turn is `turn` |
| `tâche` | `task` | `taches`, `tacheAgent` | one agent run |
| `écart` | `deviation` | `ecarts` | a gap found by a reviewer, the CI or a guard |
| `constat` | `finding` | `constats` | |
| `avis` | `feedback` | `avis_cadrage`, `avis_preview` | the requester's answer on a mock-up or Preview |
| `rallonge` | `top-up` (prose), `top_up` (names) | `rallonge_budget_usd` | budget added at a gate |
| `enveloppe` | `envelope` | budget envelope | |
| `plafond` | `cap` | `plafond_tours` | |
| `seuil` | `threshold` | `SEUILS_PAR_DEFAUT` | |
| `garde` | `guard` | trigger `garde:<outcome>` | an automatic check of the state machine |
| `garde-fou` | `guard-rail` | `garde-fous.sh`, `GARDE-FOU` | |
| `escalade` | `escalation` | `garde:escalade` | |
| `relance` | `reminder` | `relances` | reminder sent to a human (24/48/72 h) |
| `reprise` | `resume` | `reprise:<state>` | resuming after an incident |
| `annulation` | `cancellation` | trigger and topic `annulation` | |
| `abandon` | `abandonment` | `fin_abandon` | |
| `refus` | `refusal` | `fin_refus` | |
| `issue` (d'une gate) | `outcome` | `IssueGate`, `issue` | not the Gitea/GitHub "issue" (ticket), which stays `issue` |
| `état` | `state` | `etats` | |
| `déclencheur` | `trigger` | `dernier_declencheur` | |
| `guetteur` | `watcher` | DBOS workflow `guetteur` | |
| `surveillance` | `monitoring` | DBOS workflow `surveillance` | |
| `empreinte` | `digest` | image digests | "fingerprint" only for the stagnation rule's `empreinte fine` |
| `étiquette` | `tag` | image tags | a GitHub/Gitea label is `label` |
| `jeton` | `token` | `FORGE_JETON_FILE` | |
| `clé` | `key` | | |
| `badge` | `badge` | CI badges (registry tokens) | unchanged |
| `dépôt` | `repository` (prose), `repo` (names) | `creation_depot` | |
| `registre` | `registry` | npm/container registry, tool registry, ADR registry | |
| `acteur` | `actor` | `acteurs` | |
| `identité` | `identity` | `acteurs_identites` | |
| `émetteur` / `sujet` | `issuer` / `subject` | OIDC | |
| `fusion` | `merge` | state `fusion`, `acteurs_fusions` | git merge and actor merge |
| `intégration` | `integration` | `durcissement_integration` | unchanged |
| `déploiement` | `deployment` | `deploiements` | |
| `sauvegarde` | `backup` | role `sauvegarde` | |
| `nettoyage` | `cleanup` | `nettoyage-registre` | |
| `purge` | `purge` | `bin/purger.js` | unchanged noun; verb `purger` → `purge` |
| `arrêt d'urgence` | `emergency stop` | `arret-urgence.yml`, `ARRET-URGENCE` | |
| `labo` | `lab` | | |
| `essai` | `trial` | `outil-essai`, `essai-*.ts` | a sample used to try the real thing |
| `factice` | `fake` | `factices.ts`, `MoteurFactice` | test double |
| `jetable` | `throwaway` | `postgres-jetable.ts` | |
| `banc` | `bench` | `tests/aides/banc.ts` | test bench |
| `sonde` | `probe` | `sonde-reseau.js` | |
| `panne` | `fault` | `panne simulée` | injected fault |
| `cliquet` | `ratchet` | `cliquet.ts` | mutation ratchet |
| `consignes` | `instructions` | `consignes.ts`, `/app/consignes` | agent instructions |
| `charte` | `charter` | | |
| `rapport` | `report` | `report.schema.json` | |
| `périmètre` | `scope` | `hors_perimetre` | |
| `santé` | `health` | `/sante` | |
| `tableau de bord` | `dashboard` | `URL_TABLEAU_DE_BORD` | |
| `gabarit` | `template` | `docs/adr/gabarit.md` | the tool template stays `tool template` |
| `vert` / `rouge` | `green` / `red` | CI results | |
| `golden image` | `golden image` | | unchanged |
| `Gate 1`, `Gate 2`, `Preview`, `Prod` | unchanged | | |

## Words

The word dictionary. Every identifier is translated word by word with it, then put in English word order (Rules). "not checked": English homograph or function word, not matched alone by `check-english.py`.

| French | English | Where | Notes |
|---|---|---|---|
| `aaaammjj` | `yyyymmdd` | `images/base-node/README.md` | date pattern in image tag examples (`build-24-AAAAMMJJ` → `build-24-YYYYMMDD`) |
| `abandon` | `abandonment` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/migrations/0012_machine-etats.sql` | not checked: English word or function word; state `fin_abandon` → `end_abandonment`; event `abandon_demandeur` → `requester_abandonment` |
| `abandonne` | `abandoned` | `exemples/demandes/tests/db.test.js` |  |
| `abandonner` | `abandon` | `orchestrateur/features/cadrage.feature`, `orchestrateur/web/lang/fr.json` | verb |
| `abandonnée` | `abandoned` |  |  |
| `absent` | `missing` | `infra/ansible/verify-template.yml`, `images/agent/controle/essai-amont/essai.sh` | not checked: English word or function word; when it means "not there" (`CI-image-absente` → `CI-missing-image`); `absent` in English code stays |
| `absente` | `missing` | `infra/ansible/verify-moteur-integration.yml`, `infra/ansible/init-vault.sh` |  |
| `absentes` | `missing` | `orchestrateur/features/support/hooks.ts` |  |
| `absents` | `missing` | `infra/ansible/roles/deployeur/files/test_deployeur.py` | not checked: English word or function word |
| `absolu` | `absolute` | `infra/ansible/roles/deployeur/files/test_deployeur.py` |  |
| `absorbe` | `absorbed` | `orchestrateur/migrations/0010_fusion-acteurs.sql`, `orchestrateur/src/api.ts` | `acteur_absorbe` → `absorbed_actor` (actor merge) |
| `acceptation` | `acceptance` | `orchestrateur/tests/forge-gitea.test.ts`, `infra/ansible/verify-moteur-preview.yml` | `tests/acceptation/` → `tests/acceptance/` |
| `accepte` | `accepted` | `orchestrateur/tests/service.test.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `acceptee` | `accepted` | `orchestrateur/tests/mutations/mutations.ts` |  |
| `acceptees` | `accepted` | `infra/ansible/roles/deployeur/files/test_deployeur.py` |  |
| `acceptes` | `accepted` | `orchestrateur/src/api.ts` |  |
| `accepté` | `accepted` | `orchestrateur/tests/service.test.ts`, `orchestrateur/src/workflows/cycleOutil.ts` | ADR status (L6) |
| `acceptés` | `accepted` | `orchestrateur/src/api.ts` |  |
| `acces` | `access` | `infra/ansible/tasks/deployeur-acces-cible.yml`, `ROADMAP.md` |  |
| `accessibilite` | `accessibility` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/src/exterieur/factices.ts` |  |
| `accordee` | `granted` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/migrations/0012_machine-etats.sql` | `gate1_deja_accordee` → `gate1_already_granted` |
| `accueil` | `home` | `infra/ansible/verify-moteur-chat.yml` | Caddy site block name in `group_vars` |
| `accès` | `access` | `infra/ansible/tasks/deployeur-acces-cible.yml`, `ROADMAP.md` |  |
| `acteur` | `actor` | `orchestrateur/migrations/0008_acteurs.sql`, `orchestrateur/tests/robustesse.test.ts` |  |
| `acteurs` | `actors` | `orchestrateur/migrations/0008_acteurs.sql`, `orchestrateur/migrations/0010_fusion-acteurs.sql` | as a modifier → `actor` (`acteurs_identites` → `actor_identities`) |
| `actif` | `active` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/migrations/0002_machine-etats.sql` | state kind (`nature: 'actif'`) → `active` |
| `actifs` | `active` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/tests/surveillance.test.ts` |  |
| `actives` | `active` | `exemples/demandes/api/listCategories.js`, `exemples/demandes/tests/kit.test.js` | query parameter `actives` → `active` |
| `actuel` | `current` | `infra/ansible/roles/pki_base/tasks/main.yml` |  |
| `actuelle` | `current` | `orchestrateur/features/entree-chevauchement.feature` |  |
| `adaptateur` | `adapter` | `orchestrateur/tests/mails.test.ts` |  |
| `admise` | `allowed` | `template-outil-ia/.gitea/controles/garde-fous.sh` |  |
| `adresse` | `address` | `orchestrateur/src/config.ts`, `infra/compose/orchestrateur/compose.yml` |  |
| `adresses` | `addresses` | `infra/README.md`, `infra/ansible/group_vars/orchestrateur/keycloak.yml` |  |
| `affiche` | `displayed` | `orchestrateur/migrations/0008_acteurs.sql`, `socle/migrations/0001_socle.sql` | `nom_affiche` → `display_name` |
| `afficher` | `display` | `socle/tests/exemple/web/app.js` |  |
| `agir` | `act` | `infra/ansible/roles/deployeur/files/deployeur.py` |  |
| `aides` | `helpers` | `orchestrateur/README.md`, `orchestrateur/features/support/hooks.ts` | `tests/aides/` → `tests/helpers/` |
| `ailleurs` | `elsewhere` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/tests/socle-moteur.test.ts` |  |
| `ajout` | `append` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/tests/mutations/mutations.ts` | `*_ajout_seul` triggers → `*_append_only` |
| `ajoutee` | `added` | `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `ajouter` | `add` | `orchestrateur/features/gates-livraison.feature`, `socle/kit/sec.js` |  |
| `aleatoire` | `random` | `template-outil-ia/.opengrep/regles-depart.yml` |  |
| `alerte` | `alert` | `orchestrateur/tests/remplacement.test.ts`, `orchestrateur/tests/robustesse.test.ts` |  |
| `alerter` | `alert` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `alertes` | `alerts` | `orchestrateur/tests/remplacement.test.ts` |  |
| `algorithmes` | `algorithms` | `orchestrateur/src/auth.ts`, `socle/src/auth.js` |  |
| `alimente` | `fed` | `orchestrateur/tests/mutations/mutations.ts` |  |
| `aller` | `outbound` | `orchestrateur/tests/db.test.ts`, `socle/tests/auth.test.js` | `aller_retour` → `round_trip` |
| `alors` | `then` | `template-outil-ia/.gitea/controles/garde-fous.sh` |  |
| `altere` | `tampered` | `socle/tests/auth.test.js` |  |
| `amont` | `upstream` | `images/agent/controle/essai-amont/lancer.sh`, `images/agent/controle/essai-amont/amont.js` | `essai-amont/` → `upstream-trial/` |
| `amorcage` | `bootstrap` | `infra/ansible/roles/keycloak/tasks/amorcage.yml`, `infra/ansible/roles/keycloak/tasks/main.yml` |  |
| `analyse` | `analysis` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/tests/surveillance.test.ts` |  |
| `analyser` | `parse` | `socle/src/contrat.js`, `socle/src/index.js` | `analyserContrat` → `parseContract`; "analyse" (study) stays analysis |
| `ancien` | `old` | `orchestrateur/tests/chemins-interdits.test.ts`, `orchestrateur/tests/claude-sortie.test.ts` |  |
| `ancienne` | `old` | `infra/ansible/roles/deployeur/files/test_deployeur.py`, `exemples/demandes/tests/db.test.js` |  |
| `anciens` | `old` | `infra/ansible/roles/deployeur/files/deployeur.py` |  |
| `ancre` | `anchor` | `orchestrateur/tests/mutations/mutations.ts` |  |
| `annoncer` | `announce` | `socle/web/form.js` |  |
| `annuaire` | `directory` | `orchestrateur/migrations/0008_acteurs.sql`, `socle/migrations/0001_socle.sql` | user directory (LDAP); `annuaire_id` → `directory_id` |
| `annulation` | `cancellation` | `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` | trigger `annulation` → `cancellation`; topic `annulation` → `cancellation` |
| `annule` | `cancelled` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/tests/robustesse.test.ts` |  |
| `annulee` | `cancelled` | `exemples/demandes/web/app.js`, `exemples/demandes/db/migrations/0001_demandes.sql` | request status → `cancelled` (L3) |
| `annuler` | `cancel` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/surveillance.test.ts` |  |
| `annulé` | `cancelled` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/tests/robustesse.test.ts` |  |
| `annulée` | `cancelled` | `exemples/demandes/web/app.js`, `exemples/demandes/db/migrations/0001_demandes.sql` |  |
| `anonyme` | `anonymous` | `infra/ansible/verify-socle.yml`, `socle/tests/front.test.js` |  |
| `apiculteur` | `beekeeper` | `orchestrateur/tests/a-r6.test.ts` | test fixture word |
| `appel` | `call` | `orchestrateur/src/exterieur/forge-gitea.ts`, `infra/ansible/files/nettoyage-registre.py` |  |
| `appelant` | `caller` | `infra/ansible/roles/deployeur/files/deployeur.py` |  |
| `appeler` | `call` | `exemples/demandes/web/app.js`, `orchestrateur/src/exterieur/deployeur-ssh.ts` | `appelerDepuis` → `callFrom` |
| `appels` | `calls` | `infra/ansible/roles/deployeur/files/test_deployeur.py`, `orchestrateur/tests/socle-moteur.test.ts` |  |
| `applicabilite` | `applicability` | `orchestrateur/tests/mutations/verif-applicabilite.ts` |  |
| `applique` | `applied` | `infra/ansible/tasks/nettoyage-registre.yml`, `infra/ansible/files/nettoyage-registre.py` |  |
| `appliquee` | `applied` | `orchestrateur/src/db.ts` |  |
| `appliquer` | `apply` | `infra/ansible/nettoyage-registre.yml`, `infra/ansible/tasks/nettoyage-registre.yml` |  |
| `approbation` | `approval` | `orchestrateur/tests/service.test.ts` |  |
| `approbations` | `approvals` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/features/gates-livraison.feature` | table `approbations` → `approvals` |
| `approuve` | `approved` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/migrations/0012_machine-etats.sql` | gate outcome `approuve` → `approved` |
| `approuvee` | `approved` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/src/db.ts` |  |
| `approuver` | `approve` | `orchestrateur/tests/db.test.ts`, `orchestrateur/tests/remplacement.test.ts` |  |
| `approuvée` | `approved` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/src/db.ts` |  |
| `apres` | `after` | `socle/tests/kit.test.js`, `orchestrateur/tests/machine.test.ts` |  |
| `après` | `after` | `socle/tests/kit.test.js`, `orchestrateur/tests/machine.test.ts` |  |
| `arbre` | `tree` | `orchestrateur/src/workflows/tacheAgent.ts`, `orchestrateur/features/steps/actions.ts` | `arbre_hash` → `tree_hash` |
| `arbres` | `trees` | `orchestrateur/src/durcissement/stagnation.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `archivage` | `archiving` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `archiver` | `archive` | `ROADMAP.md` |  |
| `archivé` | `archived` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/migrations/0001_schema.sql` |  |
| `arret` | `stop` | `infra/ansible/arret-urgence.yml`, `infra/ansible/roles/orchestrateur/tasks/main.yml` | `ARRET-URGENCE` → `EMERGENCY-STOP`; "arrêt propre" → clean shutdown |
| `arrete` | `stopped` | `orchestrateur/src/orchestrateur.ts` |  |
| `arretee` | `stopped` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/features/steps/verifications.ts` |  |
| `arretees` | `stopped` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/features/steps/verifications.ts` |  |
| `arreter` | `stop` | `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/src/main.ts` |  |
| `arrêter` | `stop` | `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/src/main.ts` |  |
| `arrêté` | `stopped` | `orchestrateur/src/orchestrateur.ts` |  |
| `assaini` | `sanitized` | `socle/tests/front.test.js`, `socle/tests/exemple/web/app.js` |  |
| `assembler` | `assemble` | `orchestrateur/src/moteur/consignes.ts`, `orchestrateur/tests/consignes.test.ts` | not checked: English homograph (French verb in `assemblerAuth` → `assembleAuth`) |
| `assez` | `enough` | `orchestrateur/tests/auth.test.ts` |  |
| `assignee` | `assignee` | `exemples/demandes/db/migrations/0001_demandes.sql` | not checked: English word or function word; English word already (SQL column `assignee_id`); not French |
| `attaquant` | `attacker` | `orchestrateur/tests/service.test.ts` |  |
| `atteint` | `reached` | `infra/ansible/files/nettoyage-registre.py` |  |
| `attendre` | `wait` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/features/steps/verifications.ts` | `attendreEtat` → `waitForState` |
| `attendu` | `expected` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/features/steps/actions.ts` |  |
| `attendue` | `expected` | `infra/ansible/verify-moteur-integration.yml` |  |
| `attendues` | `expected` | `orchestrateur/features/steps/lanceur.ts`, `orchestrateur/tests/couverture-features.test.ts` |  |
| `attendus` | `expected` | `infra/ansible/verify-keycloak.yml`, `infra/ansible/verify-moteur.yml` |  |
| `attente` | `waiting` | `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` | state prefix `attente_` → `waiting_`; "wait" as a noun in prose |
| `attentes` | `waits` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/tests/robustesse.test.ts` |  |
| `attributs` | `attributes` | `socle/kit/sec.js`, `socle/kit/navigateur.js` |  |
| `au` | `at` | `template-outil-ia/.gitea/controles/garde-fous.sh`, `orchestrateur/src/orchestrateur.ts` | not checked: English word or function word; dropped when it only links words (`auDemarrage` → `atStartup`) |
| `aucun` | `no` | `infra/ansible/roles/gitea_org/tasks/depot-plateforme.yml`, `orchestrateur/features/durcissement-review.feature` | `AUCUN_CHANGEMENT` → `NO_CHANGE` |
| `aucune` | `no` | `socle/kit/compose.test.yml`, `infra/ansible/verify-moteur-mails.yml` |  |
| `aujourdhui` | `today` | `.github/scripts/verifier-adr.py`, `.github/scripts/test_verifier_adr.py` | `--aujourdhui` → `--today` |
| `aussi` | `also` | `orchestrateur/features/erreurs-connues-v1.feature` |  |
| `auteur` | `author` | `orchestrateur/tests/service.test.ts`, `orchestrateur/src/db.ts` |  |
| `authentificateur` | `authenticator` | `orchestrateur/src/api.ts`, `orchestrateur/src/auth.ts` |  |
| `authentification` | `authentication` | `orchestrateur/features/gates-livraison.feature` |  |
| `authentifier` | `authenticate` | `orchestrateur/src/api.ts` |  |
| `automatiques` | `automatic` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/src/exterieur/monde.ts` |  |
| `autorisation` | `authorization` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/api.ts` |  |
| `autorisations` | `authorizations` | `orchestrateur/src/exterieur/moteur-claude.ts`, `images/agent/controle/essai-amont/essai.sh` | `permissions` for Claude Code permission rules (`FA_AUTORISATIONS` → `FA_PERMISSIONS`) |
| `autorise` | `allowed` | `orchestrateur/src/orchestrateur.ts`, `socle/kit/sec.js` |  |
| `autorisees` | `allowed` | `orchestrateur/migrations/0001_schema.sql`, `template-outil-ia/.gitea/controles/garde-fous.sh` | `transitions_autorisees` → `allowed_transitions` |
| `autoriser` | `allow` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/aides/oidc-factice.ts` |  |
| `autorises` | `allowed` | `orchestrateur/tests/mutations/mutations.ts` |  |
| `autorisée` | `allowed` |  |  |
| `autorité` | `authority` |  |  |
| `autre` | `other` | `orchestrateur/tests/db.test.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `autres` | `others` | `infra/ansible/roles/deployeur/files/test_deployeur.py`, `infra/ansible/roles/deployeur/files/deployeur.py` |  |
| `aux` | `to the` | `orchestrateur/features/entree-chevauchement.feature`, `exemples/demandes/tests/kit.test.js` | not checked: English word or function word; dropped when it only links words |
| `avance` | `advance` | `orchestrateur/tests/robustesse.test.ts` |  |
| `avant` | `before` | `socle/tests/kit.test.js`, `orchestrateur/features/steps/actions.ts` |  |
| `avec` | `with` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/migrations/0001_schema.sql` | not checked: English word or function word |
| `avis` | `feedback` | `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` | the requester's feedback (`avis_cadrage` → `scoping_feedback`); "avis de sécurité" → advisory (`rejeu-avis.test.js` → `advisory-replay.test.js`) |
| `avoir` | `have` | `template-outil-ia/.gitea/controles/garde-fous.sh` | not checked: English word or function word |
| `bac` | `box` | `orchestrateur/features/durcissement-review.feature` | "bac à sable" → sandbox |
| `balayage` | `sweep` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/surveillance.test.ts` |  |
| `balayer` | `sweep` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/surveillance.test.ts` |  |
| `banc` | `bench` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/features/steps/verifications.ts` | test bench: `tests/aides/banc.ts` → `tests/helpers/bench.ts` |
| `barre` | `bar` | `socle/web/svg-chart.js` |  |
| `barres` | `bars` | `socle/tests/exemple/web/app.js`, `socle/web/svg-chart.js` |  |
| `bas` | `bottom` | `socle/web/svg-chart.js`, `infra/ansible/files/mesure-ressources.sh` |  |
| `bascule` | `switch` | `infra/ansible/verify-prod-bascule.yml`, `ROADMAP.md` | `verify-prod-bascule.yml` → `verify-prod-switch.yml` |
| `base` | `db` | `orchestrateur/tests/robustesse.test.ts`, `socle/tests/http.test.js` | not checked: English homograph. French "base (de données)" → `db` (`pki_base` → `pki_db`, `vider_base` → `empty_db`, `eupadev-pare-feu-base` → `eupadev-db-firewall`), `Database` in type names (`class Base` → `Database`); "image de base" → base image |
| `basse` | `low` | `exemples/demandes/tests/kit.test.js`, `exemples/demandes/tests/acceptation/securite/xss.spec.js` | request urgency `basse` → `low` |
| `besoin` | `need` | `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/robustesse.test.ts` |  |
| `bibliothèque` | `library` |  |  |
| `bientôt` | `soon` |  |  |
| `binaire` | `binary` | `infra/ansible/roles/proxys_agents/tasks/main.yml`, `docs/adr/013-moteur-d-agent-interchangeable-claude-code-binaire-signe.md` |  |
| `bloc` | `block` | `images/agent/controle/essai-amont/amont.js`, `template-outil-ia/.gitea/controles/paquet.mjs` |  |
| `blocage` | `blocking` | `infra/ansible/verify-keycloak.yml` |  |
| `bloquants` | `blocking` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0009_mesure-cycles.sql` |  |
| `bloque` | `blocked` | `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` | `gate_cadrage_bloque` → `gate_scoping_blocked` |
| `bloquee` | `blocked` | `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` |  |
| `bloquees` | `blocked` | `orchestrateur/migrations/0009_mesure-cycles.sql`, `orchestrateur/tests/db.test.ts` |  |
| `boite` | `mailbox` | `infra/ansible/verify-moteur-mails.yml`, `orchestrateur/tests/robustesse.test.ts` | `boiteVide` → `emptyMailbox` (mail tests) |
| `bon` | `good` | `infra/ansible/verify-orchestrateur.yml`, `infra/ansible/files/verif-keycloak.py` |  |
| `bonjour` | `hello` | `infra/ansible/verify-moteur-claude.yml` |  |
| `bonne` | `good` | `orchestrateur/tests/moteur-claude.test.ts`, `infra/ansible/roles/deployeur/files/test_deployeur.py` |  |
| `booleen` | `boolean` | `socle/kit/index.js` |  |
| `bord` | `board` | `orchestrateur/src/config.ts`, `infra/ansible/roles/executeur/defaults/main.yml` | "tableau de bord" → dashboard (`URL_TABLEAU_DE_BORD` → `DASHBOARD_URL`) |
| `borne` | `bound` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/tests/machine.test.ts` | not checked: English word or function word; bounded retry (`borne?: number` → `bound`) |
| `bornes` | `bounds` | `orchestrateur/src/workflows/tacheAgent.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `boucle` | `loop` | `orchestrateur/src/db.ts`, `orchestrateur/migrations/0001_schema.sql` |  |
| `boum` | `boom` | `socle/tests/db.test.js` |  |
| `bout` | `end` | `orchestrateur/tests/remplacement.test.ts` | not checked: English word or function word; `auBout` → `atEnd` |
| `bouton` | `button` | `socle/tests/exemple/web/app.js`, `socle/web/form.js` |  |
| `branche` | `branch` | `orchestrateur/tests/moteur-claude.test.ts`, `infra/ansible/verify-template.yml` |  |
| `brancher` | `wire` | `orchestrateur/features/exploitation.feature`, `orchestrateur/features/erreurs-connues-v1.feature` | `@a-brancher` tag → `@to-wire`; `exemplesABrancher` → `examplesToWire` |
| `brouillon` | `draft` | `exemples/demandes/db/migrations/0001_demandes.sql`, `exemples/demandes/tests/db.test.js` | request status → `draft` |
| `brut` | `raw` | `orchestrateur/tests/forge-gitea.test.ts`, `socle/kit/sec.js` |  |
| `cadrage` | `scoping` | `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` |  |
| `cadre` | `frame` | `infra/ansible/verify-maquette.yml`, `orchestrateur/src/exterieur/moteur-claude.ts` | CSP `frame-ancestors` checks (`verif_csp_cadre` → `check_csp_frame`) |
| `calendaire` | `calendar` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0009_mesure-cycles.sql` | `duree_calendaire` → `calendar_duration` |
| `canari` | `canary` | `images/agent/controle/essai-amont/verifier.mjs`, `images/agent/controle/essai-amont/essai.sh` |  |
| `canaris` | `canaries` | `images/agent/controle/essai-amont/verifier.mjs` |  |
| `canonique` | `canonical` | `orchestrateur/migrations/0010_fusion-acteurs.sql`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `capacite` | `capability` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/src/messages.ts` | `nouvelle_capacite` → `new_capability` |
| `caractere` | `character` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/src/messages.ts` |  |
| `carte` | `map` | `infra/ansible/files/mesure-ressources.sh` |  |
| `cas` | `case` | `orchestrateur/tests/moteur-claude.test.ts`, `exemples/demandes/tests/kit.test.js` | `genererCas` → `generateCases` |
| `casquette` | `hat` | `infra/ansible/verify-moteur.yml`, `orchestrateur/src/orchestrateur.ts` | role "hat" (ADR-017); `CASQUETTES` → `HATS` |
| `casquettes` | `hats` | `orchestrateur/src/auth.ts`, `orchestrateur/src/db.ts` |  |
| `casse` | `broken` | `orchestrateur/src/exterieur/notifications-smtp.ts` |  |
| `catalogue` | `catalogue` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/mutations/mutations.ts` | not checked: identical in British English (`generer-catalogue-rapport.js` → `generate-report-catalogue.js`) |
| `categorie` | `category` | `orchestrateur/src/durcissement/stagnation.ts`, `orchestrateur/tests/stagnation.test.ts` |  |
| `catégorie` | `category` | `orchestrateur/src/durcissement/stagnation.ts`, `orchestrateur/tests/stagnation.test.ts` |  |
| `ce` | `this` | `socle/tests/http.test.js`, `orchestrateur/src/workflows/cycleOutil.ts` | not checked: English word or function word |
| `ceci` | `this` | `orchestrateur/tests/aides/claude-factice/claude` |  |
| `cellule` | `cell` | `exemples/demandes/api/exportRequests.js`, `exemples/demandes/tests/unit/csv.test.js` |  |
| `cellules` | `cells` | `orchestrateur/tests/aides/features.ts` |  |
| `certificat` | `certificate` | `infra/ansible/init-vault.sh`, `infra/ansible/verify-orchestrateur.yml` |  |
| `cette` | `this` | `orchestrateur/migrations/0001_schema.sql` | `transition_dans_cette_transaction` → `transition_in_this_transaction` |
| `chaine` | `string` | `orchestrateur/migrations/0010_fusion-acteurs.sql`, `orchestrateur/tests/forge-gitea.test.ts` | `chaine` (text value in SQL tests) → `string` |
| `champ` | `field` | `exemples/demandes/web/index.html`, `socle/tests/exemple/web/index.html` | `data-champ` → `data-field` |
| `champs` | `fields` | `exemples/demandes/api/updateRequest.js`, `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `changee` | `changed` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/surveillance.test.ts` |  |
| `changement` | `change` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/machine.test.ts` | `changement_perimetre` → `scope_change` |
| `charge` | `load` | `template-outil-ia/.gitea/workflows/controle-preview.yml`, `LICENSE` | not checked: English homograph. Load test: `tests/perf/charge.k6.js` → `tests/perf/load.k6.js`; the outbox payload `evenements.charge` → `payload` |
| `charger` | `load` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/features/steps/lanceur.ts` | `chargerHandlers` → `loadHandlers` |
| `charte` | `charter` | `orchestrateur/src/moteur/consignes.ts`, `orchestrateur/tests/consignes.test.ts` |  |
| `chef` | `lead` | `infra/ansible/verify-moteur-mails.yml` |  |
| `chemin` | `path` | `orchestrateur/src/config.ts`, `orchestrateur/tests/forge-gitea.test.ts` |  |
| `chemins` | `paths` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/tests/chemins-interdits.test.ts` |  |
| `chevauchement` | `overlap` | `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` |  |
| `chiffres` | `encrypted` | `infra/ansible/roles/orchestrateur/tasks/systemd-creds.yml` | `orchestrateur_secrets_chiffres` → `orchestrator_secrets_encrypted` |
| `chiffré` | `encrypted` |  |  |
| `chloé` | `Chloé` | `exemples/demandes/tests/kit.test.js`, `socle/tests/auth.test.js` | person name in a test fixture: replace by an English fixture name |
| `choisies` | `chosen` | `orchestrateur/tests/mutations/lancer.ts` |  |
| `choisis` | `chosen` | `orchestrateur/tests/service.test.ts` |  |
| `choix` | `choice` | `orchestrateur/src/exterieur/monde.ts` |  |
| `cible` | `target` | `orchestrateur/migrations/0010_fusion-acteurs.sql`, `orchestrateur/src/db.ts` |  |
| `cibles` | `targets` | `infra/ansible/roles/lab_ca/tasks/main.yml`, `orchestrateur/features/steps/actions.ts` |  |
| `citee` | `cited` | `orchestrateur/tests/mutations/mutations.ts` |  |
| `citée` | `cited` | `orchestrateur/tests/mutations/mutations.ts` |  |
| `clair` | `light` | `infra/ansible/verify-orchestrateur.yml`, `infra/ansible/verify-template.yml` | theme value `clair` → `light`; "en clair" (plain text) → `plain` |
| `cle` | `key` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/tests/mails.test.ts` |  |
| `cles` | `keys` | `infra/ansible/verify-keycloak.yml`, `orchestrateur/src/exterieur/factices.ts` |  |
| `cliquet` | `ratchet` | `.github/workflows/moteur.yml`, `orchestrateur/tests/mutations/cliquet.ts` | `tests/mutations/cliquet.ts` → `ratchet.ts` |
| `cloner` | `clone` | `orchestrateur/src/exterieur/forge-gitea.ts`, `exemples/demandes/web/app.js` |  |
| `clé` | `key` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/tests/mails.test.ts` |  |
| `clés` | `keys` | `infra/ansible/verify-keycloak.yml`, `orchestrateur/src/exterieur/factices.ts` |  |
| `coeur` | `heart` | `socle/README.md` | only in a note file name |
| `coffre` | `vault` | `infra/ansible/init-vault.sh` |  |
| `collaborateur` | `employee` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/src/exterieur/forge-gitea.ts` | test fixture word |
| `collecte` | `collect` | `infra/ansible/files/mesure-ressources.sh`, `infra/ansible/mesure-ressources.yml` | subcommand of `mesure-ressources.sh` |
| `colonne` | `column` | `orchestrateur/features/durcissement-review.feature`, `orchestrateur/features/steps/actions.ts` |  |
| `colonnes` | `columns` | `socle/migrations/0001_socle.sql`, `socle/migrations/0003_audit_cle.sql` |  |
| `commande` | `command` | `orchestrateur/tests/mutations/lancer.ts`, `.github/scripts/verifier-empreintes.py` |  |
| `commandes` | `commands` | `infra/ansible/roles/deployeur/files/test_deployeur.py`, `orchestrateur/tests/mutations/lancer.ts` |  |
| `commentaire` | `comment` | `orchestrateur/src/messages.ts`, `orchestrateur/features/steps/actions.ts` |  |
| `commentee` | `commented` | `orchestrateur/migrations/0001_schema.sql` |  |
| `commun` | `common` | `orchestrateur/tests/forge-gitea.test.ts`, `infra/ansible/roles/keycloak/tasks/realm.yml` | Docker stage `commun` → `common` |
| `communs` | `common` | `orchestrateur/src/exterieur/contrats.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `comparer` | `compare` | `template-outil-ia/.gitea/controles/garde-fous.sh`, `.github/scripts/verifier-adr.py` |  |
| `compiler` | `compile` | `socle/src/http.js`, `socle/src/validation.js` | not checked: English homograph (French verb in the core's `compiler` → `compile`) |
| `complet` | `complete` | `infra/ansible/files/verif-keycloak.py`, `infra/ansible/verify-keycloak.yml` |  |
| `composant` | `component` | `docs/adr/007-licences-aucun-composant-embarque-agpl-sspl-bsl.md` |  |
| `compte` | `account` | `orchestrateur/src/exterieur/forge-gitea.ts`, `infra/ansible/verify-moteur.yml` | `compte_de_service` → `service_account`; verb "count" in `compter` |
| `compter` | `count` | `socle/tests/debit.test.js`, `socle/src/auth.js` |  |
| `comptes` | `accounts` | `infra/ansible/verify-sauvegarde.yml`, `infra/ansible/roles/gitea_org/tasks/main.yml` |  |
| `compteur` | `counter` | `orchestrateur/src/durcissement/stagnation.ts`, `orchestrateur/tests/aides/banc.ts` |  |
| `compteurs` | `counters` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/features/steps/verifications.ts` |  |
| `concernes` | `concerned` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/mutations/mutations.ts` | `rolesConcernes` → `affectedRoles` |
| `concurrence` | `concurrency` | `orchestrateur/src/config.ts`, `infra/ansible/roles/executeur/defaults/main.yml` | (English homograph) `CONCURRENCE_AGENTS` → `AGENT_CONCURRENCY` |
| `concurrents` | `competitors` | `ROADMAP.md` |  |
| `conduire` | `drive` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/tests/surveillance.test.ts` | `conduireJusqua` → `driveUntil` |
| `confidentielle` | `confidential` | `socle/tests/db.test.js` |  |
| `configurer` | `configure` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/workflows/deps.ts` |  |
| `confirmer` | `confirm` | `ROADMAP.md`, `infra/ansible/arret-urgence.yml` |  |
| `confirmes` | `confirmed` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0009_mesure-cycles.sql` |  |
| `conflit` | `conflict` | `infra/ansible/verify-moteur-integration.yml`, `orchestrateur/tests/forge-gitea.test.ts` |  |
| `conflits` | `conflicts` | `orchestrateur/src/exterieur/forge-gitea.ts` |  |
| `conforme` | `compliant` | `orchestrateur/features/durcissement-review.feature`, `orchestrateur/migrations/0012_machine-etats.sql` | predicates → `isCompliant`; `garde:non_conforme` → `guard:non_compliant`; `signatureConforme` → `signatureMatches` |
| `conges` | `leave` | `infra/ansible/roles/deployeur/files/test_deployeur.py`, `orchestrateur/tests/deployeur-ssh.test.ts` | test tool name `conges` (time-off requests) → `leave` |
| `connecte` | `signed_in` | `exemples/demandes/tests/acceptation/steps/fixtures.js`, `exemples/demandes/tests/kit.test.js` | `contexteConnecte` → `signedInContext` |
| `connecter` | `sign_in` | `socle/tests/auth.test.js`, `exemples/demandes/tests/kit.test.js` | `se_connecter` → `sign_in` |
| `connexion` | `connection` | `socle/src/auth.js`, `socle/tests/auth.test.js` | user session start: `sign_in` (events `connexion`/`deconnexion` → `sign_in`/`sign_out`); network: `connection` |
| `connexions` | `connections` | `infra/ansible/verify-deployeur-socle.yml`, `socle/kit/sec.js` |  |
| `connu` | `known` | `orchestrateur/src/db.ts`, `socle/src/erreurs.js` |  |
| `connues` | `known` | `orchestrateur/features/erreurs-connues-v1.feature`, `docs/scenarios-orchestrateur.md` |  |
| `conserver` | `keep` | `orchestrateur/src/orchestrateur.ts` |  |
| `consigne` | `instruction` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/remplacement.test.ts` |  |
| `consignes` | `instructions` | `orchestrateur/features/steps/lanceur.ts`, `orchestrateur/tests/moteur-claude.test.ts` | `src/moteur/consignes.ts` → `src/engine/instructions.ts` |
| `consomme` | `consumed` | `orchestrateur/tests/robustesse.test.ts` |  |
| `constat` | `finding` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/db.test.ts` |  |
| `constats` | `findings` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/image-fixe.test.ts` |  |
| `constructeur` | `builder` | `ROADMAP.md`, `docs/adr/021-un-seul-agent-builder-ecrit-le-code.md` |  |
| `construction` | `build` | `images/keycloak/Dockerfile` | not checked: English word or function word; Docker stage `construction` → `build` |
| `constructions` | `builds` | `infra/ansible/verify-forge.yml`, `infra/ansible/files/nettoyage-registre.py` | not checked: English word or function word |
| `construire` | `build` | `orchestrateur/src/api.ts`, `orchestrateur/src/statique.ts` |  |
| `contenant` | `containing` | `infra/ansible/init-vault.sh` |  |
| `conteneur` | `container` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/aides/postgres-jetable.ts` |  |
| `conteneurs` | `containers` | `infra/ansible/roles/deployeur/files/test_deployeur.py`, `infra/ansible/files/mesure-ressources.sh` |  |
| `contenu` | `content` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/features/steps/verifications.ts` |  |
| `contexte` | `context` | `orchestrateur/features/steps/verifications.ts`, `orchestrateur/tests/robustesse.test.ts` |  |
| `contextes` | `contexts` | `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `contient` | `contains` | `infra/ansible/verify-maquette.yml` |  |
| `contournement` | `bypass` | `infra/ansible/verify-template.yml` |  |
| `contournements` | `bypasses` | `infra/ansible/verify-template.yml` |  |
| `contrainte` | `constraint` | `orchestrateur/tests/mutations/mutations.ts` |  |
| `contraintes` | `constraints` | `socle/tests/front-unitaire.test.js`, `socle/web/form.js` |  |
| `contrat` | `contract` | `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` |  |
| `contrats` | `contracts` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/db.ts` |  |
| `contre` | `counter` | `infra/ansible/verify-moteur.yml` | `orchestrateur_contre_epreuve` → `orchestrator_counter_test` |
| `controle` | `check` | `.github/scripts/test_verifier_adr.py`, `orchestrateur/tests/forge-gitea.test.ts` | `controle.yml` → `check.yml`; ADR field `controle` → `check` (L6) |
| `controlees` | `checked` | `docs/adr/004-migrations-immuables-sans-down-controlees-par-squawk.md` |  |
| `controles` | `checks` | `orchestrateur/src/exterieur/forge-gitea.ts`, `orchestrateur/tests/mutations/mutations.ts` | `.gitea/controles/` → `.gitea/checks/` |
| `contrôle` | `check` | `.github/scripts/test_verifier_adr.py`, `orchestrateur/tests/forge-gitea.test.ts` |  |
| `contrôles` | `checks` | `orchestrateur/src/exterieur/forge-gitea.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `converti` | `converted` | `orchestrateur/tests/claude-sortie.test.ts` |  |
| `copie` | `copy` | `infra/ansible/tasks/deployeur-acces-cible.yml`, `orchestrateur/tests/consignes.test.ts` |  |
| `corps` | `body` | `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/forge-gitea.test.ts` |  |
| `correspondre` | `match` | `socle/tests/front-unitaire.test.js`, `socle/web/router.js` |  |
| `cote` | `side` | `orchestrateur/tests/aides/claude-factice/claude` |  |
| `couche` | `layer` | `infra/ansible/files/registre-essai.py` |  |
| `couleur` | `color` | `socle/web/svg-chart.js` |  |
| `coupe` | `cut` | `socle/tests/http.test.js`, `socle/src/http.js` | `fichier_coupe` → `file_truncated` (a download cut short) |
| `coupee` | `cut` | `orchestrateur/tests/db.test.ts`, `orchestrateur/tests/remplacement.test.ts` |  |
| `coupure` | `cut` | `orchestrateur/tests/robustesse.test.ts` |  |
| `coupures` | `cuts` | `orchestrateur/tests/robustesse.test.ts` |  |
| `coupé` | `cut` | `socle/tests/http.test.js`, `socle/src/http.js` |  |
| `courant` | `current` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/tests/db.test.ts` |  |
| `courante` | `current` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/workflows/deps.ts` |  |
| `cours` | `progress` | `exemples/demandes/web/app.js`, `orchestrateur/features/steps/verifications.ts` | "en cours" → `in_progress` |
| `cout` | `cost` | `orchestrateur/tests/db.test.ts`, `orchestrateur/features/steps/actions.ts` |  |
| `couts` | `costs` | `orchestrateur/tests/db.test.ts` |  |
| `couvertes` | `covered` | `orchestrateur/tests/couverture-features.test.ts` |  |
| `couverture` | `coverage` | `orchestrateur/tests/couverture-features.test.ts`, `docs/scenarios-orchestrateur.md` |  |
| `couvre` | `covers` | `orchestrateur/features/entree-chevauchement.feature` |  |
| `creation` | `creation` | `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` | not checked: English word or function word; cycle kind `creation` stays `creation`; state `creation_depot` → `repo_creation` |
| `cree` | `created` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/migrations/0008_acteurs.sql` | `cree_le` → `created_at` |
| `creee` | `created` | `infra/ansible/roles/gitea_org/tasks/org-socle.yml`, `exemples/demandes/tests/kit.test.js` |  |
| `creer` | `create` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/tests/forge-gitea.test.ts` |  |
| `crees` | `created` | `exemples/demandes/tests/kit.test.js` |  |
| `creneau` | `slot` | `infra/ansible/verify-systeme.yml` |  |
| `croissance` | `growth` | `ROADMAP.md`, `docs/adr/002-une-seule-pile-et-deux-profils-d-exploitation.md` |  |
| `cryptographique` | `cryptographic` | `template-outil-ia/.opengrep/regles-depart.yml` |  |
| `création` | `creation` | `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` |  |
| `créé` | `created` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/migrations/0008_acteurs.sql` |  |
| `cumule` | `cumulative` | `orchestrateur/features/steps/verifications.ts`, `orchestrateur/src/db.ts` |  |
| `curseur` | `cursor` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/features/steps/verifications.ts` |  |
| `curseurs` | `cursors` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/features/support/hooks.ts` |  |
| `côté` | `side` | `orchestrateur/tests/aides/claude-factice/claude` |  |
| `dangereux` | `dangerous` | `socle/src/contrat.js` |  |
| `dans` | `in` | `orchestrateur/tests/aides/banc.ts`, `orchestrateur/migrations/0001_schema.sql` | not checked: English word or function word |
| `datee` | `dated` | `infra/ansible/verify-template.yml` |  |
| `de` | `of` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/tests/machine.test.ts` | not checked: function word, dropped when it only links words (`mot_de_passe` → `password`); transition endpoint `de` → `from` (SQL `from_state`) |
| `debit` | `rate` | `socle/kit/sec.js`, `socle/tests/debit.test.js` | rate limiting: `socle/src/debit.js` → `core/src/rate-limit.js`, `DEBIT_DEFAUT` → `DEFAULT_RATE` |
| `deborde` | `overflows` | `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `debut` | `start` | `orchestrateur/features/support/hooks.ts`, `orchestrateur/scripts/generer-mermaid.ts` | ADR registry marker `registre-adr:debut` → `adr-registry:start` |
| `decide` | `decided` | `orchestrateur/migrations/0010_fusion-acteurs.sql`, `orchestrateur/tests/service.test.ts` | not checked: English word or function word; `decide_par` → `decided_by` |
| `decider` | `decide` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `declencheur` | `trigger` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/tests/machine.test.ts` |  |
| `declencheurs` | `triggers` | `orchestrateur/tests/service.test.ts` |  |
| `decommissionnement` | `decommissioning` | `ROADMAP.md` |  |
| `deconnecter` | `sign_out` | `socle/web/api.js`, `exemples/demandes/web/app.js` |  |
| `deconnexion` | `sign_out` | `socle/src/auth.js`, `socle/tests/auth.test.js` | user session end (event `deconnexion` → `sign_out`) |
| `decouverte` | `discovery` | `infra/ansible/verify-keycloak.yml` |  |
| `dedans` | `inside` | `orchestrateur/tests/aides/repro-planificateur.ts` |  |
| `dedoublonner` | `deduplicate` | `orchestrateur/src/durcissement/stagnation.ts`, `orchestrateur/tests/stagnation.test.ts` |  |
| `defaut` | `default` | `orchestrateur/features/steps/actions.ts`, `infra/ansible/group_vars/orchestrateur/keycloak.yml` | `coutParDefaut` → `defaultCost` |
| `defauts` | `defaults` | `infra/ansible/verify-image-agent.yml`, `infra/ansible/verify-moteur-claude.yml` |  |
| `defi` | `challenge` | `infra/ansible/files/verif-keycloak.py`, `socle/tests/keycloak.test.js` |  |
| `definitif` | `permanent` | `orchestrateur/tests/mutations/mutations.ts` | `ErreurDefinitive` → `PermanentError` |
| `definitive` | `permanent` | `orchestrateur/src/db.ts`, `orchestrateur/src/workflows/deps.ts` | not checked: English word or function word |
| `deja` | `already` | `orchestrateur/src/db.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `delai` | `timeout` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/migrations/0012_machine-etats.sql` | a deadline → `timeout` (`DELAI_TACHE_MS` → `TASK_TIMEOUT_MS`, `delai_depasse` → `timeout_exceeded`); a wait between two actions → `delay` (`DELAI_RELANCE_MS` → `REMINDER_DELAY_MS`); registry cleanup age → `grace` |
| `delais` | `timeouts` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/config.ts` |  |
| `delà` | `beyond` |  |  |
| `demande` | `request` | `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` |  |
| `demandee` | `requested` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `demander` | `ask` | `orchestrateur/tests/reprise/enfant.ts`, `orchestrateur/src/exterieur/factices.ts` |  |
| `demandes` | `requests` | `orchestrateur/tests/service.test.ts`, `exemples/demandes/tests/kit.test.js` | `exemples/demandes/` → `examples/requests/` |
| `demandeur` | `requester` | `orchestrateur/tests/service.test.ts`, `orchestrateur/src/workflows/cycleOutil.ts` | (L5) |
| `demandeurs` | `requesters` | `orchestrateur/tests/aides/banc.ts`, `infra/ansible/group_vars/orchestrateur/keycloak.yml` |  |
| `demandeuse` | `requester` | `orchestrateur/features/support/web.ts` |  |
| `demandé` | `requested` | `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` |  |
| `demarrage` | `startup` | `orchestrateur/src/orchestrateur.ts`, `infra/ansible/verify-moteur-mails.yml` |  |
| `demarre` | `started` | `infra/ansible/roles/deployeur/files/test_deployeur.py` |  |
| `demarree` | `started` | `orchestrateur/features/steps/verifications.ts`, `orchestrateur/tests/robustesse.test.ts` |  |
| `demarrer` | `start` | `orchestrateur/tests/service.test.ts`, `orchestrateur/features/support/hooks.ts` | `socle/bin/demarrer.js` → `core/bin/start.js` |
| `depart` | `starter` | `.github/workflows/template-regles.yml`, `socle/tests/auth.test.js` | not checked: English word or function word; `regles-depart.yml` → `starter-rules.yml` |
| `depasse` | `exceeded` | `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` |  |
| `dependance` | `dependency` | `infra/ansible/verify-template.yml` |  |
| `dependances` | `dependencies` | `orchestrateur/Dockerfile`, `docs/adr/019-socle-commun-des-outils-generes-et-dependances-autorisees.md` |  |
| `deploiement` | `deployment` | `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` |  |
| `deploiements` | `deployments` | `orchestrateur/migrations/0001_schema.sql`, `ROADMAP.md` |  |
| `deploye` | `deployed` | `orchestrateur/migrations/0001_schema.sql` | `deploye_le` → `deployed_at` |
| `deployeur` | `deployer` | `infra/ansible/roles/deployeur/tasks/main.yml`, `infra/ansible/verify-deployeur.yml` |  |
| `deposee` | `dropped` | `orchestrateur/tests/robustesse.test.ts` |  |
| `deposes` | `dropped` | `orchestrateur/tests/robustesse.test.ts` |  |
| `depot` | `repo` | `orchestrateur/tests/forge-gitea.test.ts`, `infra/ansible/roles/gitea_org/tasks/depot-plateforme.yml` | `repo` in identifiers and paths, "repository" in prose |
| `depots` | `repos` | `orchestrateur/tests/forge-gitea.test.ts`, `infra/ansible/group_vars/forge/vars.yml` |  |
| `depuis` | `from` | `orchestrateur/features/durcissement-review.feature`, `orchestrateur/src/workflows/cycleOutil.ts` | `appelerDepuis` → `callFrom`; "since" in durations (`ecartsDepuis` → `deviationsSince`) |
| `dereferenceur` | `dereferencer` | `socle/src/contrat.js` |  |
| `dernier` | `last` | `orchestrateur/migrations/0008_acteurs.sql`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `derniere` | `last` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `dernieres` | `last` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/src/exterieur/factices.ts` |  |
| `derogation` | `exemption` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/config.ts` | `QUATRE_YEUX_DEROGATION_SUJET` → `FOUR_EYES_EXEMPTION_SUBJECT` |
| `derriere` | `behind` | `orchestrateur/tests/robustesse.test.ts` |  |
| `des` | `of the` | `orchestrateur/features/entree-chevauchement.feature`, `template-outil-ia/.gitea/controles/garde-fous.sh` | not checked: English word or function word; dropped when it only links words |
| `designees` | `designated` | `docs/adr/005-images-et-actions-ci-designees-par-empreinte.md` |  |
| `destinataire` | `recipient` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/tests/mails.test.ts` |  |
| `deterministe` | `deterministic` | `orchestrateur/migrations/0001_schema.sql` |  |
| `detruire` | `destroy` | `socle/src/auth.js`, `socle/src/sessions.js` |  |
| `dette` | `debt` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0009_mesure-cycles.sql` |  |
| `deux` | `two` | `orchestrateur/tests/config.test.ts`, `orchestrateur/tests/service.test.ts` |  |
| `deuxieme` | `second` | `orchestrateur/tests/reprise.test.ts`, `infra/ansible/verify-moteur.yml` |  |
| `deuxième` | `second` | `orchestrateur/tests/reprise.test.ts`, `infra/ansible/verify-moteur.yml` |  |
| `devant` | `in front` | `template-outil-ia/.gitea/controles/garde-fous.sh` |  |
| `differe` | `deferred` | `infra/ansible/roles/gitea_org/tasks/protections-template.yml` |  |
| `directes` | `direct` | `infra/ansible/verify-agents.yml` |  |
| `directs` | `direct` | `infra/ansible/verify-keycloak.yml` | not checked: English word or function word |
| `dispo` | `availability` | `infra/ansible/files/mesure-ressources.sh` | abbreviation |
| `disponibilite` | `availability` | `orchestrateur/src/machine/etats.ts` |  |
| `disponible` | `available` | `orchestrateur/features/chat.feature`, `orchestrateur/features/cadrage.feature` |  |
| `disque` | `disk` | `orchestrateur/features/incident-technique.feature`, `infra/ansible/files/mesure-ressources.sh` |  |
| `distribue` | `distributed` | `orchestrateur/migrations/0001_schema.sql` |  |
| `distribuer` | `dispatch` | `orchestrateur/migrations/0001_schema.sql` | `evenements_a_distribuer` → `events_to_dispatch` |
| `dit` | `says` | `orchestrateur/features/durcissement-review.feature` |  |
| `doit` | `must` | `orchestrateur/features/gates-livraison.feature`, `template-outil-ia/.gitea/controles/garde-fous.sh` |  |
| `domaine` | `domain` | `infra/terraform/main.tf`, `orchestrateur/src/exterieur/factices.ts` |  |
| `donnees` | `data` | `images/agent/controle/essai-amont/verifier.mjs`, `orchestrateur/tests/robustesse.test.ts` |  |
| `donnes` | `given` | `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `données` | `data` | `images/agent/controle/essai-amont/verifier.mjs`, `orchestrateur/tests/robustesse.test.ts` |  |
| `dont` | `whose` | `docs/adr/018-les-instructions-viennent-de-l-image-signee.md`, `orchestrateur/tests/moteur-claude.test.ts` | not checked: English word or function word; not French in `dontAsk` (Claude permission mode) or Python `dont_write_bytecode`: unchanged |
| `dormante` | `dormant` | `socle/tests/sessions.test.js` |  |
| `dormir` | `sleep` | `orchestrateur/tests/moteur-claude.test.ts`, `orchestrateur/tests/aides/claude-factice/claude` |  |
| `dossier` | `dir` | `infra/ansible/verify-deployeur-socle.yml`, `infra/ansible/verify-maquette.yml` | `dir` in identifiers, "directory" in prose |
| `doublon` | `duplicate` | `exemples/demandes/tests/kit.test.js` |  |
| `doublons` | `duplicates` | `orchestrateur/tests/reprise.test.ts` |  |
| `drapeau` | `flag` | `orchestrateur/src/config.ts` |  |
| `droite` | `right` | `socle/web/svg-chart.js` |  |
| `droits` | `grants` | `infra/ansible/verify-sauvegarde.yml`, `orchestrateur/tests/mutations/mutations.ts` | `0003_droits.sql` → `0003_grants.sql`; "rights" in prose |
| `du` | `of the` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/robustesse.test.ts` | not checked: English word or function word; dropped when it only links words (`messagesDuCycle` → `cycleMessages`) |
| `durci` | `hardened` | `infra/ansible/verify-image-agent.yml`, `infra/ansible/verify-agents.yml` |  |
| `durcissement` | `hardening` | `orchestrateur/features/durcissement-review.feature`, `orchestrateur/migrations/0012_machine-etats.sql` |  |
| `duree` | `duration` | `orchestrateur/src/workflows/tacheAgent.ts`, `orchestrateur/tests/db.test.ts` |  |
| `durees` | `durations` | `socle/src/auth.js`, `exemples/demandes/tests/db.test.js` |  |
| `durée` | `duration` | `orchestrateur/src/workflows/tacheAgent.ts`, `orchestrateur/tests/db.test.ts` |  |
| `durées` | `durations` | `socle/src/auth.js`, `exemples/demandes/tests/db.test.js` |  |
| `dynamique` | `dynamic` | `template-outil-ia/.opengrep/regles-depart.yml` |  |
| `début` | `start` | `orchestrateur/features/support/hooks.ts`, `orchestrateur/scripts/generer-mermaid.ts` |  |
| `déchiffrés` | `decrypted` |  |  |
| `décide` | `decides` | `orchestrateur/migrations/0010_fusion-acteurs.sql`, `orchestrateur/tests/service.test.ts` |  |
| `décision` | `decision` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/features/steps/actions.ts` |  |
| `déconnexion` | `sign_out` | `socle/src/auth.js`, `socle/tests/auth.test.js` |  |
| `déconnexions` | `sign_outs` |  |  |
| `dédié` | `dedicated` |  |  |
| `déjà` | `already` | `orchestrateur/src/db.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `démarrage` | `startup` | `orchestrateur/src/orchestrateur.ts`, `infra/ansible/verify-moteur-mails.yml` |  |
| `démarré` | `started` | `infra/ansible/roles/deployeur/files/test_deployeur.py` |  |
| `démarrée` | `started` | `orchestrateur/features/steps/verifications.ts`, `orchestrateur/tests/robustesse.test.ts` |  |
| `dépendance` | `dependency` | `infra/ansible/verify-template.yml` |  |
| `dépendances` | `dependencies` | `orchestrateur/Dockerfile`, `docs/adr/019-socle-commun-des-outils-generes-et-dependances-autorisees.md` |  |
| `dépôt` | `repository` | `orchestrateur/tests/forge-gitea.test.ts`, `infra/ansible/roles/gitea_org/tasks/depot-plateforme.yml` |  |
| `désolé` | `sorry` |  |  |
| `ecart` | `deviation` | `orchestrateur/src/durcissement/stagnation.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `ecarts` | `deviations` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/migrations/0001_schema.sql` | table `ecarts` → `deviations` |
| `echange` | `exchange` | `infra/ansible/files/verif-keycloak.py` |  |
| `echappe` | `escaped` | `socle/tests/exemple/web/app.js`, `socle/tests/exemple/web/index.html` |  |
| `echeance` | `deadline` | `orchestrateur/src/workflows/cycleOutil.ts`, `socle/tests/front-unitaire.test.js` |  |
| `echeances` | `deadlines` | `orchestrateur/tests/surveillance.test.ts` |  |
| `echec` | `failure` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/exterieur/factices.ts` | noun; the value `echec` → `failed` (stored `deployments.health` and the deployer's `health` answer that feeds it) |
| `echecs` | `failures` | `orchestrateur/src/workflows/cycleOutil.ts`, `infra/ansible/verify-keycloak.yml` |  |
| `echelle` | `scale` | `socle/tests/front-unitaire.test.js`, `socle/web/svg-chart.js` |  |
| `echoue` | `fails` | `infra/ansible/verify-template.yml` |  |
| `echouee` | `failed` | `orchestrateur/tests/mutations/mutations.ts` |  |
| `echouees` | `failed` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0009_mesure-cycles.sql` |  |
| `echouer` | `fail` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/db.test.ts` |  |
| `echu` | `expired` | `orchestrateur/tests/moteur-claude.test.ts` |  |
| `ecoule` | `elapsed` | `orchestrateur/src/workflows/tacheAgent.ts` |  |
| `ecoute` | `listen` | `orchestrateur/tests/mutations/mutations.ts`, `infra/ansible/verify-agents.yml` |  |
| `ecrire` | `write` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/db.ts` |  |
| `ecrit` | `writes` | `orchestrateur/tests/aides/claude-factice/claude`, `infra/ansible/roles/deployeur/files/test_deployeur.py` | `ECRIT_API` → `WRITES_API` |
| `ecriture` | `write` | `infra/ansible/verify-socle.yml`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `efface` | `erased` | `infra/ansible/files/nettoyage-registre.py`, `infra/ansible/tasks/nettoyage-registre.yml` |  |
| `effacer` | `erase` | `infra/ansible/tasks/nettoyage-registre.yml` |  |
| `effaces` | `erased` | `infra/ansible/files/nettoyage-registre.py` |  |
| `effacé` | `erased` | `infra/ansible/files/nettoyage-registre.py`, `infra/ansible/tasks/nettoyage-registre.yml` |  |
| `effacées` | `erased` |  |  |
| `effet` | `effect` | `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `electricite` | `electricity` | `exemples/demandes/tests/kit.test.js` | test fixture category |
| `elle` | `she` | `template-outil-ia/.gitea/controles/garde-fous.sh` | not checked: English word or function word |
| `embarque` | `embedded` | `docs/adr/007-licences-aucun-composant-embarque-agpl-sspl-bsl.md` |  |
| `emetteur` | `issuer` | `orchestrateur/tests/config.test.ts`, `orchestrateur/tests/auth.test.ts` | OIDC issuer: `OIDC_EMETTEUR` → `OIDC_ISSUER` |
| `emetteurs` | `issuers` | `infra/ansible/verify-keycloak.yml` |  |
| `empreinte` | `digest` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/features/steps/actions.ts` | image digest; "fingerprint" only in the stagnation rule (`empreinte fine` → `fine fingerprint`) |
| `empreintes` | `digests` | `orchestrateur/tests/remplacement.test.ts`, `infra/ansible/roles/deployeur/files/deployeur.py` |  |
| `en` | `in` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/migrations/0001_schema.sql` | not checked: English word or function word; dropped when it only links words; `en_cours` → `in_progress` |
| `enfant` | `child` | `orchestrateur/tests/reprise.test.ts`, `orchestrateur/tests/roles.test.ts` |  |
| `enfants` | `children` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/workflows/deps.ts` |  |
| `enregistrer` | `register` | `infra/ansible/roles/deployeur/files/test_deployeur.py`, `orchestrateur/src/workflows/tacheAgent.ts` | `enregistrer-outils.yml` → `register-tools.yml`; a UI "Enregistré." → "Saved." |
| `enregistré` | `registered` |  |  |
| `entete` | `header` | `infra/ansible/verify-maquette.yml`, `infra/ansible/verify-template.yml` |  |
| `entetes` | `headers` | `orchestrateur/tests/service.test.ts`, `socle/kit/sec.js` | `kit/entetes.js` → `kit/headers.js` |
| `entier` | `integer` | `orchestrateur/src/config.ts`, `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `entre` | `between` | `orchestrateur/tests/aides/repro-planificateur.ts` |  |
| `entree` | `entry` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/src/exterieur/moteur-claude.ts` | phase `entree` → `entry`; task input → `input` (`tokens_entree` → `input_tokens`, `entree.bundle` → `input.bundle`) |
| `entrees` | `entries` | `orchestrateur/tests/machine.test.ts`, `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `entreprise` | `company` | `docs/adr/015-domaine-des-previews-ordre-de-preference.md` |  |
| `entrer` | `enter` | `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `entrée` | `entry` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `enveloppe` | `envelope` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/db.ts` | budget envelope |
| `envelopper` | `wrap` | `socle/src/http.js` |  |
| `environ` | `about` | `infra/ansible/init-vault.sh`, `orchestrateur/scripts/eupadev.py` | not checked: English word or function word; not French in Python `os.environ`: unchanged |
| `environnement` | `environment` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/migrations/0008_acteurs.sql` |  |
| `environnements` | `environments` | `orchestrateur/src/orchestrateur.ts` |  |
| `envoi` | `send` | `orchestrateur/tests/service.test.ts`, `exemples/demandes/tests/kit.test.js` |  |
| `envoie` | `sends` | `orchestrateur/tests/mutations/mutations.ts` |  |
| `envois` | `sends` | `orchestrateur/src/exterieur/factices.ts`, `socle/kit/sec.js` |  |
| `envoye` | `sent` | `orchestrateur/migrations/0007_notifications-envoyees.sql` | `envoye_le` → `sent_at` |
| `envoyees` | `sent` | `orchestrateur/migrations/0007_notifications-envoyees.sql`, `orchestrateur/README.md` | `notifications_envoyees` → `sent_notifications` |
| `envoyer` | `send` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/features/steps/actions.ts` |  |
| `envoyes` | `sent` | `orchestrateur/src/exterieur/factices.ts` |  |
| `epi` | `ppe` | `infra/ansible/group_vars/all/outils-socle.yml` | personal protective equipment |
| `epreuve` | `test` | `infra/ansible/verify-moteur.yml` |  |
| `epuisees` | `exhausted` | `orchestrateur/tests/machine.test.ts`, `orchestrateur/migrations/0012_machine-etats.sql` |  |
| `equipe` | `team` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/src/exterieur/forge-gitea.ts` |  |
| `equipes` | `teams` | `infra/ansible/roles/gitea_org/tasks/org-socle.yml`, `infra/ansible/verify-executeur-claude.yml` |  |
| `erreur` | `error` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `erreurs` | `errors` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/src/exterieur/forge-gitea.ts` |  |
| `escalade` | `escalation` | `orchestrateur/features/durcissement-review.feature`, `orchestrateur/tests/stagnation.test.ts` |  |
| `espaces` | `spaces` | `images/agent/controle/essai-amont/essai.sh`, `images/agent/controle/essai-amont/lancer.sh` |  |
| `espionner` | `spy` | `orchestrateur/tests/reprise/enfant.ts` |  |
| `essai` | `trial` | `infra/ansible/verify-sauvegarde.yml`, `infra/ansible/verify-moteur-claude.yml` | `outil-essai` → `trial-tool`; `essai-ci.ts` → `trial-ci.ts` |
| `essais` | `trials` | `infra/ansible/verify-orchestrateur.yml`, `infra/ansible/verify-moteur-ci.yml` | retry counts → `attempts` (`OptionsDeployeurSsh.essais` → `attempts`) |
| `est` | `is` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/workflows/cycleOutil.ts` | not checked: English word or function word |
| `et` | `and` | `ROADMAP.md`, `orchestrateur/features/chat.feature` | not checked: English word or function word |
| `etape` | `step` | `orchestrateur/features/steps/verifications.ts`, `orchestrateur/src/config.ts` |  |
| `etapes` | `steps` | `socle/tests/auth.test.js`, `infra/ansible/verify-moteur-preview.yml` |  |
| `etat` | `state` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/migrations/0001_schema.sql` |  |
| `etats` | `states` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/README.md` |  |
| `etiquette` | `tag` | `orchestrateur/src/exterieur/moteur-claude.ts`, `infra/ansible/verify-forge.yml` | image tag (`etiquette` → `tag`); label in Gitea/GitHub → `label` |
| `etiquettes` | `tags` | `orchestrateur/tests/aides/features.ts`, `infra/ansible/files/nettoyage-registre.py` |  |
| `etre` | `be` | `orchestrateur/tests/db.test.ts`, `orchestrateur/tests/robustesse.test.ts` | not checked: English word or function word |
| `evalue` | `evaluated` | `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `evaluer` | `evaluate` | `orchestrateur/src/durcissement/stagnation.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `evenement` | `event` | `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` |  |
| `evenements` | `events` | `orchestrateur/migrations/0001_schema.sql`, `infra/ansible/verify-keycloak.yml` |  |
| `evol` | `evolution` | `orchestrateur/tests/robustesse.test.ts` | abbreviation in mutation ids |
| `evolution` | `evolution` | `orchestrateur/tests/db.test.ts`, `orchestrateur/features/steps/actions.ts` | not checked: English word or function word; cycle kind `evolution` stays |
| `exacte` | `exact` | `template-outil-ia/.gitea/controles/paquet.mjs`, `orchestrateur/tests/db.test.ts` |  |
| `executer` | `execute` | `infra/ansible/roles/deployeur/files/test_deployeur.py`, `orchestrateur/tests/moteur-claude.test.ts` |  |
| `executeur` | `executor` | `infra/ansible/roles/executeur/tasks/main.yml`, `infra/compose/executeur/compose.yml` |  |
| `executeurs` | `executors` | `infra/ansible/verify-moteur.yml` |  |
| `exemple` | `example` | `socle/kit/compose.test.yml`, `orchestrateur/tests/config.test.ts` | `exemple.test` domain → `example.test` |
| `exemples` | `examples` | `orchestrateur/tests/aides/features.ts`, `.github/workflows/exemples-demandes.yml` | `exemples/` → `examples/` (L8) |
| `exige` | `requires` | `orchestrateur/features/durcissement-review.feature`, `socle/src/auth.js` |  |
| `exiger` | `require` | `orchestrateur/src/exterieur/forge-gitea.ts`, `orchestrateur/src/orchestrateur.ts` |  |
| `existant` | `existing` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/tests/moteur-claude.test.ts` |  |
| `existante` | `existing` | `orchestrateur/src/exterieur/forge-gitea.ts`, `infra/ansible/roles/gitea_org/tasks/protections-template.yml` |  |
| `existants` | `existing` | `socle/web/render.js` |  |
| `existe` | `exists` | `infra/ansible/roles/gitea_org/tasks/depot-plateforme.yml`, `infra/ansible/roles/keycloak/tasks/master.yml` |  |
| `expediteur` | `sender` | `orchestrateur/src/exterieur/notifications-smtp.ts`, `orchestrateur/src/exterieur/monde.ts` | mail sender variable → `MAIL_FROM` (as the core already names it) |
| `expiree` | `expired` | `socle/tests/db.test.js` |  |
| `expiré` | `expired` | `template-outil-ia/.gitea/controles/garde-fous.sh`, `infra/ansible/verify-template.yml` |  |
| `expirée` | `expired` | `socle/tests/db.test.js` |  |
| `explicites` | `explicit` | `orchestrateur/src/machine/etats.ts` |  |
| `exploitation` | `operations` | `docs/adr/002-une-seule-pile-et-deux-profils-d-exploitation.md`, `orchestrateur/features/exploitation.feature` | not checked: English word or function word |
| `exterieur` | `external` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/tests/config.test.ts` | `src/exterieur/` → `src/external/` |
| `externe` | `external` | `orchestrateur/src/workflows/cycleOutil.ts`, `ROADMAP.md` |  |
| `extraire` | `extract` | `infra/ansible/roles/deployeur/files/deployeur.py` |  |
| `extrait` | `excerpt` | `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `exécute` | `runs` | `orchestrateur/migrations/0001_schema.sql`, `exemples/demandes/db/migrations/0001_demandes.sql` |  |
| `factice` | `fake` | `orchestrateur/tests/config.test.ts`, `orchestrateur/tests/surveillance.test.ts` |  |
| `factices` | `fakes` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/tests/aides/banc.ts` |  |
| `facultatif` | `optional` | `orchestrateur/src/messages.ts` |  |
| `faire` | `do` | `infra/ansible/init-vault.sh`, `template-outil-ia/.gitea/controles/garde-fous.sh` |  |
| `fais` | `do` | `images/agent/controle/essai-amont/essai.sh` |  |
| `fait` | `done` | `infra/ansible/roles/deployeur/files/deployeur.py`, `infra/ansible/roles/deployeur/files/test_deployeur.py` |  |
| `faite` | `done` | `orchestrateur/src/db.ts`, `orchestrateur/src/orchestrateur.ts` |  |
| `faits` | `facts` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/service.test.ts` |  |
| `falsifie` | `forged` | `socle/tests/auth-unitaire.test.js` |  |
| `faudrait` | `should` | `orchestrateur/features/gates-livraison.feature` |  |
| `fausse` | `fake` | `infra/ansible/roles/deployeur/files/test_deployeur.py`, `orchestrateur/tests/robustesse.test.ts` |  |
| `faut` | `needs` | `orchestrateur/features/cadrage.feature`, `orchestrateur/features/erreurs-connues-v1.feature` |  |
| `faute` | `fault` | `infra/ansible/verify-moteur-preview.yml`, `infra/ansible/verify-template.yml` |  |
| `fautes` | `faults` | `.github/scripts/verifier-adr.py`, `.github/scripts/verifier-empreintes.py` |  |
| `fautif` | `faulty` | `orchestrateur/tests/forge-gitea.test.ts`, `infra/ansible/verify-moteur-integration.yml` |  |
| `fautive` | `faulty` | `template-outil-ia/.gitea/controles/garde-fous.sh` |  |
| `faux` | `fake` | `orchestrateur/tests/moteur-claude.test.ts`, `orchestrateur/tests/socle-moteur.test.ts` | `FAUX_SOCLE_ECHEC` → `FAKE_CORE_FAILURE`; "false" for a boolean |
| `fenetre` | `window` | `orchestrateur/features/steps/verifications.ts`, `socle/src/auth.js` |  |
| `fermer` | `close` | `socle/tests/http.test.js`, `socle/tests/db.test.js` |  |
| `fermés` | `closed` |  |  |
| `feu` | `fire` | `infra/ansible/roles/orchestrateur/tasks/tls-base.yml`, `infra/ansible/roles/orchestrateur/templates/eupadev-pare-feu-base.service.j2` | "pare-feu" → firewall |
| `fiche` | `detail` | `orchestrateur/features/durcissement-review.feature` | `web/fiche.js` (detail screen) → `web/detail.js` |
| `fichier` | `file` | `orchestrateur/tests/mutations/mutations.ts`, `infra/ansible/roles/sauvegarde/templates/eupadev-sauvegarde.sh.j2` |  |
| `fichiers` | `files` | `orchestrateur/tests/forge-gitea.test.ts`, `socle/tests/contrat.test.js` | reserved path `/fichiers/` → `/files/` |
| `fictives` | `fictitious` | `infra/ansible/roles/deployeur/templates/Caddyfile.j2` |  |
| `fige` | `frozen` | `orchestrateur/tests/mutations/mutations.ts` | frozen ADR fields (`FIGES` → `FROZEN`); a pinned version → `pinned` ("pnpm figé" → pinned pnpm) |
| `figee` | `pinned` | `.github/scripts/verifier-empreintes.py` | `ACTION_FIGEE` → `PINNED_ACTION` (action pinned by SHA) |
| `figes` | `frozen` | `.github/scripts/verifier-adr.py` | `FIGES` → `FROZEN` (frozen ADR fields) |
| `filet` | `net` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/tests/mutations/mutations.ts` | `FILET_MESURE` → `MEASUREMENT_NET` (wide safety net) |
| `filiation` | `lineage` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `filtre` | `filter` | `orchestrateur/features/cadrage.feature`, `orchestrateur/features/erreurs-connues-v1.feature` |  |
| `filtres` | `filtered` | `orchestrateur/tests/mutations/mutations.ts` | `compteurs-non-filtres` → `counters-unfiltered` |
| `fin` | `end` | `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` | noun (phase and states `fin_*` → `end_*`); adjective "fine" in the stagnation rule's "empreinte fine" (`Compteurs.fin` → `fine`); EXIT trap function `fin` → `cleanup` |
| `finale` | `final` | `infra/ansible/verify-moteur-mails.yml` |  |
| `fini` | `finished` | `images/agent/controle/essai-amont/amont.js`, `orchestrateur/src/db.ts` |  |
| `finir` | `finish` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/surveillance.test.ts` |  |
| `fins` | `ends` | `orchestrateur/tests/machine.test.ts`, `orchestrateur/scripts/generer-mermaid.ts` |  |
| `fixe` | `fixed` | `template-outil-ia/.gitea/controles/garde-fous.sh`, `orchestrateur/tests/image-fixe.test.ts` | "Dockerfile fixe" → fixed Dockerfile; a pinned tool version → `pinned` (`pnpm_fixe` → `pinned_pnpm`) |
| `fois` | `time` | `orchestrateur/tests/surveillance.test.ts` |  |
| `fonctionnalité` | `feature` |  |  |
| `forcer` | `force` | `orchestrateur/tests/db.test.ts`, `infra/ansible/roles/executeur/tasks/demarrer.yml` |  |
| `forme` | `formed` | `infra/ansible/verify-template.yml` | `registre_mal_forme` → `registry_malformed` |
| `formulaire` | `form` | `socle/src/http.js`, `socle/src/auth.js` |  |
| `fou` | `rail` | `infra/ansible/verify-template.yml`, `template-outil-ia/.gitea/controles/garde-fous.sh` | "garde-fou" → guard-rail |
| `fournies` | `provided` | `docs/adr/001-appliance-sur-vm-fournies-par-la-dsi.md` |  |
| `fous` | `rails` | `infra/ansible/verify-template.yml`, `orchestrateur/tests/mutations/mutations.ts` | `garde-fous.sh` → `guard-rails.sh` |
| `fuite` | `leak` | `infra/ansible/verify-template.yml`, `infra/ansible/verify-agents.yml` |  |
| `fuites` | `leaks` | `infra/ansible/verify-agents.yml`, `socle/kit/sec.js` |  |
| `fusion` | `merge` | `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` | state `fusion` → `merge`; `acteurs_fusions` → `actor_merges` |
| `fusionne` | `merged` | `orchestrateur/tests/forge-gitea.test.ts`, `infra/ansible/verify-moteur-integration.yml` |  |
| `fusionnee` | `merged` | `orchestrateur/tests/mutations/mutations.ts` |  |
| `fusionner` | `merge` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/features/steps/actions.ts` |  |
| `fusionnée` | `merged` | `orchestrateur/tests/mutations/mutations.ts` |  |
| `fusions` | `merges` | `orchestrateur/migrations/0010_fusion-acteurs.sql`, `orchestrateur/tests/service.test.ts` |  |
| `gabarit` | `template` | `docs/adr/gabarit.md`, `docs/adr/000-format-et-cycle-de-vie-des-adr.md` | `docs/adr/gabarit.md` → `docs/adr/template.md` |
| `garde` | `guard` | `infra/ansible/verify-template.yml`, `orchestrateur/migrations/0012_machine-etats.sql` | noun (trigger `garde:<outcome>` → `guard:<outcome>`); "garde-fou" → guard-rail; the verb "garder" → keep (`garde` list of kept items → `kept`) |
| `gardees` | `kept` | `infra/ansible/files/nettoyage-registre.py`, `infra/ansible/roles/deployeur/files/test_deployeur.py` |  |
| `garder` | `keep` | `infra/ansible/files/nettoyage-registre.py`, `infra/ansible/roles/sauvegarde/templates/eupadev-sauvegarde.sh.j2` |  |
| `gardes` | `guards` | `infra/ansible/files/nettoyage-registre.py`, `infra/ansible/roles/deployeur/files/deployeur.py` |  |
| `gauche` | `left` | `socle/web/svg-chart.js` |  |
| `gel` | `freeze` | `orchestrateur/tests/aides/banc.ts` |  |
| `geler` | `freeze` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/tests/aides/banc.ts` |  |
| `gels` | `freezes` | `orchestrateur/tests/aides/banc.ts`, `orchestrateur/features/steps/actions.ts` |  |
| `genere` | `generated` | `infra/ansible/verify-forge.yml` |  |
| `generer` | `generate` | `orchestrateur/tests/machine.test.ts`, `orchestrateur/scripts/generer-mermaid.ts` |  |
| `generes` | `generated` | `docs/adr/019-socle-commun-des-outils-generes-et-dependances-autorisees.md` |  |
| `genre` | `type` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/features/steps/actions.ts` | `acteurs.genre` → `actors.type` (same as `audit_log.actor_type`) |
| `gere` | `manages` | `exemples/demandes/tests/unit/transitions.test.js`, `exemples/demandes/api/updateRequest.js` |  |
| `gestion` | `management` | `orchestrateur/features/gates-livraison.feature`, `infra/ansible/group_vars/all/outils-socle.yml` |  |
| `gestionnaire` | `manager` | `socle/tests/http.test.js`, `exemples/demandes/openapi.yaml` | (L5) |
| `gestionnaires` | `managers` | `socle/tests/keycloak/realm-test.json`, `exemples/demandes/api/updateRequest.js` |  |
| `gouvernance` | `governance` | `README.fr.md`, `docs/fr/gouvernance.md` |  |
| `graduations` | `ticks` | `socle/web/svg-chart.js` |  |
| `graine` | `seed` | `socle/src/auth.js`, `orchestrateur/src/exterieur/factices.ts` |  |
| `graphique` | `chart` | `socle/tests/exemple/web/style.css`, `socle/web/svg-chart.js` |  |
| `gros` | `large` | `socle/tests/http.test.js` |  |
| `groupe` | `group` | `infra/ansible/group_vars/orchestrateur/keycloak.yml`, `infra/ansible/roles/keycloak/tasks/realm.yml` |  |
| `groupes` | `groups` | `infra/ansible/verify-keycloak.yml`, `infra/ansible/verify-deployeur-acces.yml` |  |
| `guet` | `watch` | `orchestrateur/tests/surveillance.test.ts` | `guet-fautif` → `watch-faulty` |
| `guets` | `watches` | `infra/ansible/verify-moteur-ci.yml` |  |
| `guetter` | `watch` | `orchestrateur/src/orchestrateur.ts` |  |
| `guetteur` | `watcher` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/config.ts` | DBOS workflow `guetteur` → `watcher` |
| `guichet` | `switchboard` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/src/exterieur/factices.ts` | the fakes' request/answer desk (`Guichet`, `forge.guichet`) |
| `gère` | `manages` | `exemples/demandes/tests/unit/transitions.test.js`, `exemples/demandes/api/updateRequest.js` |  |
| `hacher` | `hash` | `socle/src/sessions.js` |  |
| `harnais` | `harness` | `docs/adr/020-relecteurs-en-lecture-seule-par-le-harnais.md` |  |
| `haut` | `top` | `socle/tests/front-unitaire.test.js`, `socle/web/svg-chart.js` |  |
| `haute` | `high` | `exemples/demandes/tests/kit.test.js`, `exemples/demandes/web/app.js` | request urgency `haute` → `high` |
| `hauteur` | `height` | `socle/web/svg-chart.js` |  |
| `hebdo` | `weekly` | `orchestrateur/tests/mutations/mutations.ts`, `ROADMAP.md` |  |
| `hebdomadaire` | `weekly` | `orchestrateur/features/exploitation.feature` |  |
| `herite` | `inherited` | `orchestrateur/src/durcissement/stagnation.ts`, `orchestrateur/tests/stagnation.test.ts` |  |
| `heure` | `hour` | `infra/ansible/inventory/lab.yml`, `infra/CLAUDE.md` | `sauvegarde_heure` → `backup_hour` |
| `heures` | `hours` | `orchestrateur/features/steps/actions.ts` |  |
| `heureuse` | `happy` | `orchestrateur/tests/aides/banc.ts`, `orchestrateur/features/support/hooks.ts` | `reponseHeureuse` → `happyResponse` |
| `heureux` | `happy` | `orchestrateur/tests/aides/banc.ts`, `orchestrateur/src/exterieur/factices.ts` |  |
| `histoire` | `story` | `orchestrateur/tests/aides/claude-factice/claude` |  |
| `historique` | `history` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/migrations/0008_acteurs.sql` |  |
| `horodatage` | `timestamp` | `infra/ansible/verify-moteur-mails.yml` |  |
| `hors` | `outside` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/tests/forge-gitea.test.ts` | `hors_perimetre` → `out_of_scope` |
| `hote` | `host` | `infra/ansible/verify-deployeur-socle.yml`, `infra/ansible/verify-deployeur.yml` |  |
| `hotes` | `hosts` | `orchestrateur/src/api.ts`, `orchestrateur/src/exterieur/monde.ts` |  |
| `humain` | `human` | `infra/ansible/verify-moteur-forge.yml`, `orchestrateur/src/messages.ts` | actor type value `humain` → `human` |
| `humaine` | `human` | `infra/ansible/verify-forge.yml`, `orchestrateur/tests/service.test.ts` |  |
| `humains` | `humans` | `infra/ansible/roles/gitea_org/tasks/main.yml`, `infra/ansible/group_vars/forge/vars.yml` |  |
| `hérité` | `inherited` | `orchestrateur/src/durcissement/stagnation.ts`, `orchestrateur/tests/stagnation.test.ts` |  |
| `ia` | `ai` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/exterieur/moteur-claude.ts` | French acronym (IA = AI): `proxy-ia` → `proxy-ai`, `vault-ia.yml` → `vault-ai.yml`, `AGENT_PROXY_IA` → `AGENT_PROXY_AI` |
| `ici` | `here` | `images/agent/controle/essai-amont/lancer.sh`, `orchestrateur/tests/moteur-claude.test.ts` |  |
| `identifiants` | `credentials` | `infra/ansible/verify-keycloak.yml` |  |
| `identite` | `identity` | `docs/adr/017-identite-des-personnes.md`, `orchestrateur/src/db.ts` |  |
| `identites` | `identities` | `orchestrateur/migrations/0008_acteurs.sql`, `socle/migrations/0001_socle.sql` |  |
| `ignoré` | `ignored` | `infra/ansible/roles/deployeur/files/deployeur.py`, `template-outil-ia/scripts/verify.sh` |  |
| `il` | `it` | `orchestrateur/features/cadrage.feature`, `orchestrateur/features/erreurs-connues-v1.feature` | not checked: English word or function word |
| `illisible` | `unreadable` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/features/entree-chevauchement.feature` | `rapport_illisible` → `unreadable_report` |
| `immuable` | `immutable` | `orchestrateur/src/statique.ts` |  |
| `immuables` | `immutable` | `docs/adr/004-migrations-immuables-sans-down-controlees-par-squawk.md` |  |
| `implémentation` | `implementation` |  |  |
| `imposee` | `imposed` | `orchestrateur/tests/forge-gitea.test.ts` |  |
| `inachevé` | `unfinished` |  |  |
| `inactivite` | `inactivity` | `socle/kit/sec.js`, `exemples/demandes/tests/kit.test.js` |  |
| `inchange` | `unchanged` | `orchestrateur/features/durcissement-review.feature`, `orchestrateur/tests/stagnation.test.ts` | `code:inchange:<role>` → `code:unchanged:<role>` |
| `inchangee` | `unchanged` | `infra/ansible/roles/deployeur/files/test_deployeur.py` |  |
| `inchanges` | `unchanged` | `orchestrateur/src/durcissement/stagnation.ts`, `orchestrateur/tests/stagnation.test.ts` |  |
| `inconnu` | `unknown` | `socle/tests/protections.test.js`, `exemples/demandes/tests/kit.test.js` |  |
| `inconnue` | `unknown` | `orchestrateur/tests/aides/oidc-factice.ts`, `orchestrateur/tests/auth.test.ts` |  |
| `inconnues` | `unknown` | `orchestrateur/tests/mutations/lancer.ts` |  |
| `indisponible` | `unavailable` | `orchestrateur/features/durcissement-review.feature` |  |
| `inexistant` | `nonexistent` | `socle/kit/sec.js`, `socle/tests/db.test.js` |  |
| `inexistante` | `nonexistent` | `socle/kit/sec.js` |  |
| `informatique` | `it` | `orchestrateur/features/gates-livraison.feature` | "parc informatique" → IT fleet |
| `injoignable` | `unreachable` | `orchestrateur/features/entree-chevauchement.feature`, `template-outil-ia/.gitea/controles/garde-fous.sh` |  |
| `inscription` | `registration` | `infra/ansible/verify-deployeur-socle.yml`, `infra/ansible/roles/runner/tasks/main.yml` |  |
| `inscrit` | `registered` | `infra/ansible/verify-deployeur-socle.yml` |  |
| `inserer` | `insert` | `orchestrateur/tests/db.test.ts`, `orchestrateur/tests/aides/banc.ts` |  |
| `installe` | `installed` | `infra/ansible/roles/gvisor/tasks/main.yml` |  |
| `instantane` | `instant` | `orchestrateur/tests/robustesse.test.ts` |  |
| `intacte` | `intact` | `infra/ansible/roles/deployeur/files/test_deployeur.py` |  |
| `integrations` | `integrations` | `images/agent/controle/report.schema.json`, `template-outil-ia/agents/report.schema.json` | not checked: English word or function word; English word in `backend.md#Integrations`: unchanged |
| `integre` | `integrated` | `orchestrateur/tests/moteur-claude.test.ts`, `orchestrateur/src/exterieur/forge-gitea.ts` |  |
| `integrer` | `integrate` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/scripts/essai-integration.ts` |  |
| `integres` | `built_in` | `infra/ansible/verify-keycloak.yml`, `infra/ansible/group_vars/orchestrateur/keycloak.yml` | Keycloak built-in clients/flows (`keycloak_clients_integres` → `keycloak_builtin_clients`) |
| `interdit` | `forbidden` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `interdite` | `forbidden` | `template-outil-ia/.gitea/controles/garde-fous.sh` |  |
| `interdits` | `forbidden` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/tests/chemins-interdits.test.ts` | `chemins-interdits.ts` → `forbidden-paths.ts` |
| `interne` | `internal` | `orchestrateur/features/gates-livraison.feature`, `socle/tests/contrat.test.js` |  |
| `internes` | `internal` | `infra/ansible/verify-keycloak.yml` |  |
| `interrompu` | `interrupted` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/tests/surveillance.test.ts` |  |
| `intervalle` | `interval` | `orchestrateur/src/exterieur/forge-gitea.ts`, `orchestrateur/src/config.ts` |  |
| `introuvable` | `not_found` | `orchestrateur/tests/forge-gitea.test.ts`, `socle/tests/exemple/web/app.js` |  |
| `intrus` | `intruder` | `socle/tests/db.test.js` |  |
| `invalide` | `invalid` | `orchestrateur/features/cadrage.feature`, `exemples/demandes/tests/kit.test.js` | `TRANSITION_INVALIDE` → `INVALID_TRANSITION` |
| `invalides` | `invalid` | `orchestrateur/tests/robustesse.test.ts`, `socle/kit/index.js` |  |
| `inventaire` | `inventory` | `orchestrateur/features/cadrage.feature`, `orchestrateur/features/chat.feature` | test fixture tool name |
| `invente` | `made_up` | `orchestrateur/features/entree-chevauchement.feature` |  |
| `invisibles` | `invisible` | `socle/src/validation.js` |  |
| `jamais` | `never` | `infra/ansible/verify-template.yml`, `infra/ansible/roles/deployeur/files/test_deployeur.py` |  |
| `je` | `I` | `orchestrateur/features/chat.feature`, `orchestrateur/features/cadrage.feature` | not checked: English word or function word |
| `jetable` | `throwaway` | `infra/ansible/verify-keycloak.yml`, `orchestrateur/tests/mails.test.ts` |  |
| `jeton` | `token` | `orchestrateur/tests/auth.test.ts`, `orchestrateur/tests/forge-gitea.test.ts` |  |
| `jetons` | `tokens` | `orchestrateur/tests/mutations/mutations.ts`, `infra/ansible/verify-moteur-claude.yml` |  |
| `jeu` | `set` | `infra/ansible/verify-moteur-integration.yml`, `infra/ansible/verify-moteur-ci.yml` | `moteur-pousse.ts` `Jeu`/`JEUX` → `FileSet`/`FILE_SETS` (`Set` would shadow the JS global) |
| `jeux` | `sets` | `orchestrateur/src/exterieur/moteur-pousse.ts` |  |
| `jouees` | `played` | `orchestrateur/features/support/hooks.ts` |  |
| `jouer` | `play` | `orchestrateur/features/steps/actions.ts` |  |
| `jour` | `day` | `orchestrateur/tests/socle-moteur.test.ts`, `orchestrateur/src/exterieur/factices.ts` | "à jour" → up to date (`socleAJour` → `coreUpToDate`); "mise à jour" → update |
| `journal` | `log` | `orchestrateur/tests/forge-gitea.test.ts`, `infra/ansible/verify-template.yml` | not checked: English homograph. The logger and its module → `logger` (`creerJournal` → `createLogger`, `journal.js` → `logger.js`); log records → `log` |
| `journalise` | `logged` | `exemples/demandes/tests/kit.test.js` |  |
| `journaux` | `logs` | `orchestrateur/tests/forge-gitea.test.ts`, `infra/ansible/verify-sauvegarde.yml` |  |
| `jours` | `days` | `infra/ansible/verify-template.yml`, `template-outil-ia/.gitea/controles/garde-fous.sh` |  |
| `jt` | `token` | `infra/ansible/roles/executeur/tasks/jeton.yml`, `infra/ansible/roles/executeur/tasks/main.yml` | abbreviation of `jeton` (`executeur_jt` → `executor_token`) |
| `juges` | `judged` | `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `jusqua` | `until` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/tests/surveillance.test.ts` | `conduireJusqua` → `driveUntil` |
| `justifiée` | `justified` |  |  |
| `la` | `the` | `orchestrateur/features/gates-livraison.feature`, `template-outil-ia/.gitea/controles/garde-fous.sh` | not checked: English word or function word; dropped when it only links words |
| `labo` | `lab` | `docs/adr/010-labo-sur-incus-et-opentofu-avant-la-publication.md`, `infra/ansible/verify-moteur.yml` |  |
| `laisser` | `let` | `orchestrateur/features/steps/verifications.ts`, `orchestrateur/features/steps/actions.ts` | `laisserPasser` → `letThrough` |
| `lance` | `launches` | `orchestrateur/src/orchestrateur.ts`, `infra/ansible/roles/deployeur/files/test_deployeur.py` |  |
| `lancement` | `launch` | `orchestrateur/src/workflows/tacheAgent.ts`, `orchestrateur/tests/forge-gitea.test.ts` |  |
| `lancements` | `launches` | `orchestrateur/tests/surveillance.test.ts` |  |
| `lancer` | `launch` | `infra/ansible/roles/deployeur/files/test_deployeur.py`, `orchestrateur/src/workflows/cycleOutil.ts` | `lancerPipelinePreview` → `launchPreviewPipeline` |
| `lanceur` | `launcher` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/features/lanceur.feature` |  |
| `lancé` | `launched` | `orchestrateur/src/orchestrateur.ts`, `infra/ansible/roles/deployeur/files/test_deployeur.py` |  |
| `langue` | `language` | `orchestrateur/tests/web.test.ts`, `orchestrateur/web/lang/fr.json` |  |
| `largeur` | `width` | `socle/web/svg-chart.js` |  |
| `le` | `the` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/tests/db.test.ts` | not checked: English word or function word; dropped when it only links words; timestamp column suffix `_le` → `_at` (`cree_le` → `created_at`) |
| `lecteur` | `reader` | `socle/tests/http.test.js`, `socle/tests/protections.test.js` | (L5) |
| `lecteurs` | `readers` | `socle/tests/keycloak/realm-test.json` |  |
| `lecture` | `read` | `orchestrateur/tests/mutations/mutations.ts`, `infra/ansible/verify-socle.yml` | `lecture seule` → `read-only` |
| `lectures` | `reads` | `orchestrateur/tests/auth.test.ts`, `orchestrateur/tests/aides/oidc-factice.ts` |  |
| `lent` | `slow` | `socle/tests/protections.test.js`, `orchestrateur/tests/deployeur-ssh.test.ts` | not checked: English word or function word |
| `lente` | `slow` | `orchestrateur/tests/robustesse.test.ts` |  |
| `lenteur` | `slowness` | `orchestrateur/tests/reprise/enfant.ts`, `orchestrateur/tests/roles/enfant.ts` | `LENTEUR_TESTS_MS` → `TESTS_SLOWNESS_MS` |
| `lenteurs` | `slownesses` | `orchestrateur/tests/aides/banc.ts`, `orchestrateur/tests/reprise/enfant.ts` |  |
| `les` | `the` | `orchestrateur/features/chat.feature`, `infra/ansible/group_vars/forge/vars.yml` | not checked: English word or function word; dropped when it only links words |
| `leurs` | `their` | `orchestrateur/features/chat.feature` |  |
| `liaison` | `link` | `orchestrateur/tests/mutations/mutations.ts` |  |
| `liaisons` | `links` | `socle/tests/auth.test.js` |  |
| `libelle` | `label` | `orchestrateur/scripts/generer-mermaid.ts`, `orchestrateur/src/workflows/cycleOutil.ts` | `LIBELLE_PHASE` → `PHASE_LABEL` |
| `liberer` | `release` | `orchestrateur/tests/aides/banc.ts`, `orchestrateur/tests/robustesse.test.ts` |  |
| `liberes` | `freed` | `infra/ansible/files/nettoyage-registre.py`, `infra/ansible/tasks/nettoyage-registre.yml` | `liberes_octets` → `freed_bytes` |
| `libre` | `free` | `orchestrateur/tests/robustesse.test.ts` |  |
| `licence` | `licence` | `infra/ansible/verify-template.yml`, `template-outil-ia/.gitea/controles/garde-fous.sh` | not checked: identical in British English (`files/licence-agpl/` stays) |
| `licences` | `licences` | `template-outil-ia/.gitea/controles/garde-fous.sh`, `docs/adr/007-licences-aucun-composant-embarque-agpl-sspl-bsl.md` | not checked: identical in British English |
| `lien` | `link` | `infra/ansible/roles/gitea_org/tasks/retirer-depot-equipe.yml`, `orchestrateur/tests/aides/claude-factice/claude` |  |
| `lier` | `bind` | `exemples/demandes/web/app.js`, `socle/tests/exemple/web/app.js` |  |
| `lieu` | `location` | `infra/ansible/files/verif-keycloak.py`, `infra/ansible/files/registre-essai.py` | HTTP `Location` value (`lieu` → `location`); "au lieu de" → instead of |
| `ligne` | `line` | `template-outil-ia/.gitea/controles/garde-fous.sh`, `infra/ansible/init-vault.sh` | a database row → `row` (`audit_log_ligne` → `audit_log_row`) |
| `lignes` | `lines` | `socle/tests/http.test.js`, `socle/tests/auth.test.js` | database rows → `rows` |
| `limite` | `limit` | `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/aides/banc.ts` |  |
| `limiter` | `limit` | `orchestrateur/features/entree-chevauchement.feature` | not checked: English homograph (`createLimiter`, the core's rate limiter); French verb → `limit` |
| `limiteur` | `limiter` | `socle/src/http.js`, `socle/src/auth.js` |  |
| `lire` | `read` | `orchestrateur/tests/robustesse.test.ts`, `socle/tests/sessions.test.js` |  |
| `lis` | `read` | `images/agent/controle/essai-amont/essai.sh` |  |
| `liste` | `list` | `orchestrateur/features/durcissement-review.feature`, `orchestrateur/tests/forge-gitea.test.ts` |  |
| `lister` | `list` | `exemples/demandes/web/app.js`, `orchestrateur/tests/surveillance.test.ts` |  |
| `livraison` | `delivery` | `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` |  |
| `livre` | `delivers` | `orchestrateur/tests/db.test.ts` |  |
| `logistique` | `logistics` | `orchestrateur/tests/service.test.ts`, `orchestrateur/scripts/test_eupadev.py` | test fixture category |
| `longue` | `long` | `orchestrateur/src/config.ts`, `orchestrateur/tests/robustesse.test.ts` |  |
| `longueur` | `length` | `infra/ansible/roles/deployeur/files/deployeur.py`, `infra/ansible/roles/deployeur/files/test_deployeur.py` |  |
| `lot` | `batch` | `infra/ansible/files/nettoyage-registre.py` | not checked: English word or function word |
| `lu` | `read` | `infra/ansible/verify-keycloak.yml`, `exemples/demandes/tests/kit.test.js` |  |
| `lue` | `read` | `infra/ansible/verify-executeur-claude.yml`, `infra/ansible/verify-moteur-claude.yml` |  |
| `lues` | `read` | `infra/ansible/verify-keycloak.yml` |  |
| `lus` | `read` | `infra/ansible/verify-moteur-forge.yml`, `infra/ansible/verify-moteur-integration.yml` |  |
| `là` | `there` | `orchestrateur/features/gates-livraison.feature`, `template-outil-ia/.gitea/controles/garde-fous.sh` |  |
| `magasin` | `store` | `socle/tests/exemple/api/createItem.js`, `socle/tests/exemple/api/deleteItem.js` | `tests/exemple/api/lib/magasin.js` → `tests/example/api/lib/store.js` |
| `magasinier` | `storekeeper` | `infra/ansible/group_vars/all/outils-socle.yml` | test fixture word |
| `maintenant` | `now` | `socle/src/sessions.js`, `socle/src/debit.js` |  |
| `mais` | `but` | `orchestrateur/features/erreurs-connues-v1.feature` | not checked: English word or function word |
| `majeure` | `major` | `renovate.json` | Renovate label `postgres-majeure` → `postgres-major` |
| `majuscule` | `uppercase` | `orchestrateur/tests/moteur-claude.test.ts` |  |
| `mal` | `badly` | `docs/adr/016-registre-npm-en-lecture-seule-pour-les-agents.md`, `infra/ansible/verify-template.yml` | `registre_mal_forme` → `registry_malformed` |
| `malade` | `unhealthy` | `infra/ansible/roles/deployeur/files/test_deployeur.py`, `infra/ansible/verify-prod-bascule.yml` |  |
| `malforme` | `malformed` | `socle/tests/auth-unitaire.test.js` |  |
| `manifeste` | `manifest` | `infra/ansible/verify-template.yml` |  |
| `manifestes` | `manifests` | `infra/ansible/verify-image-base.yml`, `infra/ansible/verify-moteur-ci.yml` |  |
| `manquant` | `missing` | `infra/ansible/verify-moteur-ci.yml`, `infra/ansible/verify-moteur-forge.yml` |  |
| `manquantes` | `missing` | `orchestrateur/features/support/hooks.ts`, `orchestrateur/tests/couverture-features.test.ts` |  |
| `manquants` | `missing` | `infra/ansible/files/nettoyage-registre.py`, `infra/ansible/roles/deployeur/files/deployeur.py` |  |
| `manque` | `missing` | `orchestrateur/features/cadrage.feature`, `template-outil-ia/.gitea/controles/garde-fous.sh` |  |
| `manquent` | `missing` | `orchestrateur/features/gates-livraison.feature` |  |
| `maquette` | `mockup` | `infra/ansible/verify-maquette.yml`, `orchestrateur/migrations/0012_machine-etats.sql` | `mockup` in identifiers and paths, "mock-up" in prose |
| `maquettes` | `mockups` | `infra/ansible/roles/deployeur/files/test_deployeur.py`, `infra/ansible/roles/deployeur/files/deployeur.py` |  |
| `marche` | `running` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/src/exterieur/factices.ts` | "en marche" → running (`enMarche` → `running`); "ne marche pas" → does not work |
| `marge` | `margin` | `orchestrateur/tests/mutations/mutations.ts` |  |
| `marque` | `mark` | `infra/ansible/files/registre-essai.py` |  |
| `masque` | `mask` | `infra/ansible/verify-template.yml` |  |
| `masqué` | `masked` | `infra/ansible/verify-template.yml` |  |
| `mauvais` | `bad` | `orchestrateur/tests/forge-gitea.test.ts`, `socle/kit/index.js` |  |
| `mauvaise` | `bad` | `infra/ansible/roles/deployeur/files/test_deployeur.py` |  |
| `mauvaises` | `bad` | `orchestrateur/tests/mutations/lancer.ts` |  |
| `mdp` | `password` | `infra/ansible/verify-keycloak.yml`, `infra/ansible/tasks/outil-socle-cible.yml` | abbreviation of "mot de passe" |
| `mecanisme` | `mechanism` | `orchestrateur/tests/stagnation.test.ts`, `orchestrateur/src/durcissement/stagnation.ts` |  |
| `membre` | `member` | `orchestrateur/tests/forge-gitea.test.ts`, `infra/ansible/verify-socle.yml` |  |
| `membres` | `members` | `infra/ansible/group_vars/forge/vars.yml`, `infra/ansible/roles/deployeur/files/test_deployeur.py` |  |
| `meme` | `same` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/db.ts` |  |
| `memoire` | `memory` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/migrations/0001_schema.sql` | `memoire_cycles` → `cycle_memory` |
| `menage` | `cleanup` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `mes` | `my` | `orchestrateur/tests/mutations/mutations.ts` | not checked: English word or function word; "mes demandes" → my requests; `MES-` mutation id prefix = measure → `MEAS-` |
| `mesure` | `measure` | `infra/ansible/mesure-ressources.yml`, `infra/ansible/verify-agents.yml` | `mesure_cycles` → `cycle_measures` |
| `mesuree` | `measured` | `orchestrateur/tests/db.test.ts` |  |
| `mesures` | `measures` | `infra/ansible/verify-agents.yml`, `infra/ansible/mesure-ressources.yml` |  |
| `methode` | `method` | `socle/kit/sec.js`, `orchestrateur/tests/forge-gitea.test.ts` |  |
| `methodes` | `methods` | `socle/src/contrat.js`, `orchestrateur/src/api.ts` |  |
| `mettre` | `put` | `orchestrateur/src/workflows/cycleOutil.ts` | "mettre à jour" → update (`mettreAJourSocle` → `updateCore`) |
| `miennes` | `mine` | `exemples/demandes/tests/kit.test.js` |  |
| `migree` | `migrated` | `orchestrateur/tests/aides/postgres-jetable.ts`, `orchestrateur/tests/aides/repro-planificateur.ts` |  |
| `migrer` | `migrate` | `socle/kit/compose.test.yml`, `orchestrateur/tests/aides/postgres-jetable.ts` | `socle/bin/migrer.js` → `core/bin/migrate.js` |
| `minuterie` | `timer` | `infra/ansible/verify-forge.yml`, `orchestrateur/src/workflows/tacheAgent.ts` |  |
| `minuteur` | `timer` | `infra/ansible/roles/base/tasks/main.yml`, `infra/ansible/verify-systeme.yml` |  |
| `minuteurs` | `timers` | `orchestrateur/src/config.ts` |  |
| `mis` | `put` | `orchestrateur/features/entree-chevauchement.feature` | "mis à jour" → updated |
| `mise` | `setting` | `orchestrateur/features/support/hooks.ts`, `orchestrateur/features/support/monde.ts` | "mise à jour" → update; "mise en situation" → staging |
| `mobiles` | `movable` | `infra/ansible/files/nettoyage-registre.py`, `infra/ansible/nettoyage-registre.yml` | `etiquettes_mobiles` → `movable_tags` |
| `modele` | `model` | `orchestrateur/features/steps/lanceur.ts`, `orchestrateur/tests/config.test.ts` | `OLD.modele` (agent model) → `model`; "modèle Compose" → Compose model |
| `modeles` | `models` | `orchestrateur/src/config.ts`, `infra/ansible/verify-agents.yml` |  |
| `modelisation` | `modelling` | `docs/adr/003-cles-et-modelisation-de-la-base-des-outils.md`, `ROADMAP.md` |  |
| `modif` | `change` | `exemples/demandes/tests/kit.test.js` | abbreviation |
| `modifiee` | `modified` | `exemples/demandes/tests/kit.test.js` |  |
| `modifs` | `changes` | `socle/tests/kit.test.js` |  |
| `modèle` | `model` | `orchestrateur/features/steps/lanceur.ts`, `orchestrateur/tests/config.test.ts` |  |
| `moins` | `less` | `template-outil-ia/.gitea/controles/garde-fous.sh` |  |
| `monde` | `world` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/features/support/web.ts` | `src/exterieur/monde.ts` → `src/external/world.ts` |
| `montage` | `mount` | `infra/ansible/verify-stockage.yml` |  |
| `morceau` | `chunk` | `orchestrateur/src/exterieur/monde.ts`, `orchestrateur/tests/forge-gitea.test.ts` |  |
| `morceaux` | `chunks` | `images/agent/controle/essai-amont/amont.js`, `orchestrateur/src/api.ts` |  |
| `morts` | `dead` | `orchestrateur/src/orchestrateur.ts` |  |
| `mot` | `word` | `infra/ansible/files/verif-keycloak.py`, `infra/ansible/verify-keycloak.yml` | "mot de passe" → password; `mots` → words |
| `moteur` | `engine` | `infra/ansible/verify-moteur.yml`, `infra/ansible/verify-moteur-deploiement.yml` | platform engine and agent engine (L8: Gitea repo `moteur` → `engine`) |
| `motif` | `reason` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/mutations/mutations.ts` | `motif_gate` → `gate_reason`; regex "motif" → `pattern` |
| `motifs` | `reasons` | `template-outil-ia/.gitea/controles/garde-fous.sh`, `orchestrateur/src/moteur/chemins-interdits.ts` | `motifsGitea` (regex patterns) → `giteaPatterns` |
| `mots` | `words` | `orchestrateur/src/moteur/jargon.ts`, `orchestrateur/tests/consignes.test.ts` |  |
| `mourir` | `die` | `orchestrateur/tests/remplacement.test.ts` |  |
| `moyenne` | `average` | `infra/ansible/files/mesure-ressources.sh` |  |
| `muet` | `silent` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/tests/robustesse.test.ts` |  |
| `mém` | `mem` | `infra/ansible/files/mesure-ressources.sh`, `infra/compose/orchestrateur/compose.yml` |  |
| `mémoire` | `memory` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/migrations/0001_schema.sql` |  |
| `ménage` | `cleanup` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `méthodes` | `methods` | `socle/src/contrat.js`, `orchestrateur/src/api.ts` |  |
| `même` | `same` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/db.ts` |  |
| `naissance` | `birth` | `exemples/demandes/tests/db.test.js` |  |
| `natif` | `native` | `orchestrateur/tests/mutations/mutations.ts` |  |
| `nature` | `kind` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/tests/machine.test.ts` | not checked: English word or function word; state kind `nature` → `kind` (`actif`/`attente`/`gate`/`fin` → `active`/`waiting`/`gate`/`end`) |
| `navigateur` | `browser` | `socle/kit/index.js`, `socle/kit/navigateur.js` | the kit's cookie-jar HTTP client → `httpBrowser` (`kit/navigateur.js` → `kit/http-browser.js`), not Playwright's `browser` |
| `naviguer` | `navigate` | `socle/tests/protections.test.js` |  |
| `ne` | `not` | `template-outil-ia/.gitea/controles/garde-fous.sh`, `orchestrateur/features/gates-livraison.feature` | not checked: English word or function word |
| `nettoie` | `cleans` | `infra/ansible/roles/deployeur/files/test_deployeur.py` |  |
| `nettoyage` | `cleanup` | `infra/ansible/tasks/nettoyage-registre.yml`, `infra/ansible/roles/nettoyage_registre/tasks/main.yml` | `nettoyage-registre` → `registry-cleanup` |
| `nettoyer` | `clean` | `socle/src/validation.js`, `images/agent/controle/essai-amont/lancer.sh` |  |
| `neuf` | `new` | `infra/ansible/roles/deployeur/files/deployeur.py` |  |
| `neuve` | `new` | `orchestrateur/tests/remplacement.test.ts`, `orchestrateur/tests/robustesse.test.ts` | `baseNeuve` → `freshDatabase` |
| `nfichier` | `nfile` | `template-outil-ia/.gitea/controles/garde-fous.sh` | escaped newline + `fichier` in a string: rewrite the sentence |
| `nimporte` | `any` | `socle/tests/front.test.js`, `socle/tests/http.test.js` | `/nimporte/quoi` → `/any/thing` |
| `niveau` | `level` | `infra/ansible/arret-urgence.yml`, `socle/src/index.js` |  |
| `noeud` | `node` | `socle/src/contrat.js` |  |
| `nom` | `name` | `infra/ansible/verify-sauvegarde.yml`, `orchestrateur/migrations/0008_acteurs.sql` | `nom_affiche` → `display_name` |
| `nombre` | `number` | `orchestrateur/src/workflows/cycleOutil.ts`, `template-outil-ia/.gitea/controles/garde-fous.sh` | `nombre` (count) → `count` when it counts; else `number` |
| `nombres` | `numbers` | `orchestrateur/src/durcissement/stagnation.ts`, `orchestrateur/features/steps/verifications.ts` |  |
| `nommé` | `named` |  |  |
| `noms` | `names` | `infra/ansible/roles/deployeur/files/test_deployeur.py`, `orchestrateur/tests/surveillance.test.ts` |  |
| `normale` | `normal` | `exemples/demandes/tests/kit.test.js`, `exemples/demandes/web/app.js` | request urgency `normale` → `normal` |
| `noter` | `note` | `orchestrateur/tests/mutations/lancer.ts` |  |
| `notif` | `notification` | `orchestrateur/tests/robustesse.test.ts` | abbreviation (`derniereNotifAdmin` → `lastAdminNotification`) |
| `notifier` | `notify` | `orchestrateur/tests/mails.test.ts`, `orchestrateur/tests/robustesse.test.ts` |  |
| `notifs` | `notifications` | `orchestrateur/features/steps/verifications.ts` |  |
| `nouveau` | `new` | `socle/tests/front.test.js`, `socle/tests/exemple/web/app.js` |  |
| `nouvelle` | `new` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/tests/aides/banc.ts` |  |
| `nouvelles` | `new` | `socle/tests/protections.test.js` |  |
| `noyau` | `kernel` | `infra/ansible/files/mesure-ressources.sh`, `infra/ansible/verify-agents.yml` |  |
| `nul` | `null` | `socle/src/journal.js`, `socle/src/validation.js` | not checked: English word or function word; `NUL` (U+0000 character) → `NUL`, unchanged |
| `nulle` | `zero` | `orchestrateur/tests/db.test.ts`, `orchestrateur/tests/consignes.test.ts` | `duree_calendaire_nulle` → `calendar_duration_zero`; `/nulle/part` → `/nowhere` |
| `numero` | `number` | `orchestrateur/features/steps/actions.ts`, `infra/ansible/roles/gitea_org/tasks/depot-plateforme.yml` |  |
| `objet` | `object` | `infra/ansible/verify-deployeur.yml`, `orchestrateur/src/api.ts` |  |
| `obligatoire` | `required` | `orchestrateur/features/gates-livraison.feature` |  |
| `obligatoires` | `required` | `orchestrateur/src/config.ts` |  |
| `obtenu` | `obtained` | `infra/ansible/verify-forge.yml` |  |
| `obtenue` | `obtained` | `infra/ansible/verify-forge.yml`, `infra/ansible/verify-moteur-forge.yml` |  |
| `octets` | `bytes` | `infra/ansible/files/nettoyage-registre.py`, `infra/ansible/roles/sauvegarde/templates/eupadev-sauvegarde.sh.j2` | not checked: English word or function word |
| `officielle` | `official` | `orchestrateur/features/exploitation.feature` |  |
| `ont` | `have` | `orchestrateur/src/workflows/cycleOutil.ts` | not checked: English word or function word |
| `optionnels` | `optional` | `infra/ansible/group_vars/orchestrateur/keycloak.yml`, `infra/ansible/roles/keycloak/tasks/realm.yml` |  |
| `orch` | `orch` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/tests/surveillance.test.ts` | abbreviation of orchestrator kept as `orch` (PostgreSQL roles `orch_moteur` → `orch_engine`) |
| `orchestrateur` | `orchestrator` | `orchestrateur/tests/mutations/mutations.ts`, `infra/ansible/roles/orchestrateur/tasks/main.yml` | `orchestrateur/` → `orchestrator/` (L8) |
| `orchestre` | `orchestrates` | `infra/ansible/verify-moteur-mails.yml` |  |
| `ordinateurs` | `computers` | `orchestrateur/features/chat.feature`, `orchestrateur/features/cadrage.feature` | test fixture word |
| `ordre` | `order` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/machine/etats.ts` |  |
| `organisation` | `organisation` | `orchestrateur/src/exterieur/forge-gitea.ts`, `orchestrateur/src/exterieur/moteur-pousse.ts` | not checked: identical in British English (the repository spelling) |
| `origine` | `origin` | `infra/ansible/roles/deployeur/files/test_deployeur.py`, `orchestrateur/src/exterieur/forge-gitea.ts` |  |
| `origines` | `origins` | `infra/ansible/verify-systeme.yml`, `orchestrateur/tests/machine.test.ts` |  |
| `orphelin` | `orphan` | `orchestrateur/tests/robustesse.test.ts`, `socle/tests/contrat.test.js` |  |
| `orphelins` | `orphans` | `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/src/orchestrateur.ts` |  |
| `ou` | `or` | `socle/kit/sec.js`, `socle/src/contrat.js` | not checked: English word or function word |
| `oublie` | `forgotten` | `orchestrateur/tests/mutations/mutations.ts` |  |
| `oui` | `yes` | `orchestrateur/tests/aides/claude-factice/claude`, `orchestrateur/tests/config.test.ts` |  |
| `outil` | `tool` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/migrations/0001_schema.sql` |  |
| `outils` | `tools` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/features/durcissement-review.feature` | as a modifier → `tool` (`resultatsOutils` → `toolResults`); Keycloak realm `outils` → `tools` |
| `ouvert` | `open` | `orchestrateur/tests/db.test.ts`, `orchestrateur/src/orchestrateur.ts` |  |
| `ouverte` | `open` | `orchestrateur/migrations/0009_mesure-cycles.sql`, `exemples/demandes/tests/db.test.js` |  |
| `ouvertes` | `open` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/features/steps/verifications.ts` |  |
| `ouverts` | `open` | `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/src/orchestrateur.ts` |  |
| `ouvreur` | `opener` | `infra/ansible/files/verif-keycloak.py` |  |
| `ouvrir` | `open` | `orchestrateur/features/steps/chat.ts` |  |
| `paire` | `pair` | `infra/ansible/roles/gitea_org/tasks/main.yml`, `infra/ansible/roles/gitea_org/tasks/retirer-depot-equipe.yml` |  |
| `panne` | `fault` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/tests/aides/banc.ts` | injected fault (`panne simulée` → `simulated fault`) |
| `pannes` | `faults` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/tests/aides/banc.ts` |  |
| `paquet` | `package` | `infra/ansible/verify-forge.yml`, `orchestrateur/tests/mutations/mutations.ts` | `.gitea/controles/paquet.mjs` → `.gitea/checks/package.mjs` |
| `paquets` | `packages` | `infra/ansible/files/nettoyage-registre.py`, `orchestrateur/tests/forge-gitea.test.ts` |  |
| `par` | `by` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/features/chat.feature` | not checked: English word or function word; `decide_par` → `decided_by`; "per" for rates (`SEUIL_LOGIN_PAR_IP` → `LOGIN_THRESHOLD_PER_IP`) |
| `parallele` | `parallel` | `orchestrateur/tests/mutations/lancer.ts` |  |
| `paralleles` | `parallel` | `orchestrateur/tests/mutations/lancer.ts` |  |
| `parametres` | `settings` | `infra/ansible/verify-forge.yml`, `infra/ansible/verify-keycloak.yml` | `registre_parametres` → `registry_settings`; "parameters" for function or query parameters |
| `paramètres` | `settings` | `infra/ansible/verify-forge.yml`, `infra/ansible/verify-keycloak.yml` |  |
| `parc` | `fleet` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/features/entree-chevauchement.feature` | test fixture tool name `parc-auto` → `car-fleet` |
| `parcourir` | `walk` | `orchestrateur/src/statique.ts`, `socle/src/statique.js` |  |
| `parcours` | `journey` | `orchestrateur/tests/machine.test.ts` |  |
| `pare` | `fire` | `infra/ansible/roles/orchestrateur/tasks/tls-base.yml`, `infra/ansible/roles/orchestrateur/templates/eupadev-pare-feu-base.service.j2` | "pare-feu" → firewall (`eupadev-pare-feu-base` → `eupadev-base-firewall`) |
| `parlante` | `meaningful` | `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `parmi` | `among` | `orchestrateur/src/messages.ts` |  |
| `partage` | `sharing` | `socle/tests/auth-unitaire.test.js` |  |
| `parti` | `gone` | `infra/ansible/verify-deployeur.yml`, `infra/ansible/verify-maquette.yml` |  |
| `partie` | `part` | `exemples/demandes/tests/db.test.js` |  |
| `partiel` | `partial` | `infra/ansible/roles/sauvegarde/templates/eupadev-sauvegarde.sh.j2`, `ROADMAP.md` | ADR check value `partiel` → `partial` |
| `pas` | `not` | `socle/tests/front-unitaire.test.js`, `orchestrateur/tests/forge-gitea.test.ts` | not checked: English word or function word; `pasPret` → `notReady` |
| `passage` | `pass` | `orchestrateur/tests/db.test.ts`, `orchestrateur/tests/robustesse.test.ts` | not checked: English word or function word; (English homograph) `premier_passage_ci_vert` → `first_green_ci_pass` |
| `passe` | `pass` | `infra/ansible/files/verif-keycloak.py`, `infra/ansible/verify-keycloak.yml` | "mot de passe" → password |
| `passent` | `pass` | `orchestrateur/features/steps/actions.ts` |  |
| `patienter` | `wait` | `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `pendant` | `during` | `orchestrateur/tests/robustesse.test.ts` |  |
| `perdu` | `lost` | `orchestrateur/src/workflows/tacheAgent.ts` |  |
| `perdue` | `lost` | `orchestrateur/features/incident-technique.feature` |  |
| `perime` | `stale` | `orchestrateur/tests/robustesse.test.ts` |  |
| `perimee` | `stale` | `exemples/demandes/tests/kit.test.js` |  |
| `perimetre` | `scope` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `periodique` | `periodic` | `orchestrateur/tests/remplacement.test.ts` |  |
| `permis` | `allowed` | `template-outil-ia/.gitea/controles/garde-fous.sh`, `infra/ansible/verify-template.yml` |  |
| `permises` | `allowed` | `socle/src/http.js` |  |
| `personne` | `person` | `infra/ansible/verify-keycloak.yml`, `infra/ansible/verify-moteur-chat.yml` |  |
| `personnes` | `people` | `infra/ansible/verify-keycloak.yml`, `socle/kit/sec.js` |  |
| `perte` | `loss` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/surveillance.test.ts` |  |
| `pertes` | `losses` | `orchestrateur/tests/aides/banc.ts`, `orchestrateur/tests/surveillance.test.ts` |  |
| `peut` | `can` | `orchestrateur/tests/db.test.ts`, `orchestrateur/tests/robustesse.test.ts` |  |
| `piege` | `trap` | `infra/ansible/verify-maquette.yml`, `socle/tests/exemple/api/exportItems.js` |  |
| `piegees` | `booby_trapped` | `infra/ansible/roles/deployeur/files/test_deployeur.py` |  |
| `pieges` | `traps` | `socle/tests/exemple/api/getItem.js`, `socle/tests/exemple/api/lib/magasin.js` | `PIEGES` → `TRAPS`; "pitfalls" in prose |
| `pile` | `stack` | `orchestrateur/tests/machine.test.ts`, `orchestrateur/src/orchestrateur.ts` | not checked: English word or function word |
| `pilotage` | `control` | `orchestrateur/README.md`, `orchestrateur/src/workflows/deps.ts` | DBOS queue `pilotage` → `control` |
| `pilote` | `pilot` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/features/steps/verifications.ts` | DBOS pilot process (as opposed to executor) |
| `pirate` | `attacker` | `orchestrateur/tests/aides/claude-factice/claude`, `images/agent/controle/essai-amont/verifier.mjs` | `PIRATE` → `ATTACKER` |
| `piraté` | `compromised` | `orchestrateur/tests/aides/claude-factice/claude`, `images/agent/controle/essai-amont/verifier.mjs` |  |
| `piège` | `trap` | `infra/ansible/verify-maquette.yml`, `socle/tests/exemple/api/exportItems.js` |  |
| `plafond` | `cap` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/machine/etats.ts` | `plafond_tours` → `rounds_cap` |
| `plafonds` | `caps` | `orchestrateur/src/db.ts`, `orchestrateur/tests/db.test.ts` |  |
| `plages` | `ranges` | `orchestrateur/src/texte.ts` |  |
| `planif` | `scheduled` | `orchestrateur/tests/mutations/mutations.ts` | abbreviation |
| `planificateur` | `scheduler` | `orchestrateur/tests/aides/repro-planificateur.ts` |  |
| `planifie` | `scheduled` | `orchestrateur/tests/mutations/mutations.ts` |  |
| `planifies` | `scheduled` | `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/src/orchestrateur.ts` |  |
| `plateforme` | `platform` | `images/agent/Dockerfile`, `infra/ansible/roles/gitea_org/tasks/depot-plateforme.yml` |  |
| `plein` | `full` | `orchestrateur/features/incident-technique.feature`, `orchestrateur/features/cadrage.feature` |  |
| `plomberie` | `plumbing` | `exemples/demandes/openapi.yaml`, `socle/tests/db.test.js` |  |
| `pointe` | `points` | `infra/ansible/files/mesure-ressources.sh`, `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `politique` | `policy` | `orchestrateur/src/exterieur/factices.ts`, `socle/web/render.js` |  |
| `pont` | `bridge` | `.github/workflows/template-regles.yml` |  |
| `portables` | `laptops` | `orchestrateur/features/chat.feature`, `orchestrateur/features/cadrage.feature` | test fixture word |
| `porte` | `door` | `exemples/demandes/tests/db.test.js`, `docs/adr/012-forge-rester-sur-gitea-porte-ouverte-vers-forgejo.md` |  |
| `portee` | `scope` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/tests/mutations/mutations.ts` | OAuth scope (`keycloak_portees` → `keycloak_scopes`); `porteePaquets` → `packageScope` |
| `portees` | `scopes` | `infra/ansible/roles/keycloak/tasks/realm.yml`, `infra/ansible/group_vars/orchestrateur/keycloak.yml` |  |
| `porteur` | `bearer` | `orchestrateur/src/api.ts`, `orchestrateur/src/auth.ts` | `jetonPorteur` → `bearerToken` |
| `pose` | `set` | `infra/ansible/roles/pki_base/tasks/main.yml`, `socle/tests/auth-unitaire.test.js` | not checked: English word or function word |
| `posee` | `set` | `exemples/demandes/tests/kit.test.js` |  |
| `poser` | `set` | `socle/tests/auth.test.js`, `orchestrateur/features/steps/actions.ts` |  |
| `positif` | `positive` | `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `pour` | `for` | `orchestrateur/features/steps/verifications.ts`, `orchestrateur/tests/surveillance.test.ts` | not checked: English word or function word |
| `pourquoi` | `why` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `pousse` | `pushes` | `orchestrateur/tests/config.test.ts`, `orchestrateur/src/exterieur/monde.ts` | `moteur-pousse.ts` → `pushing-engine.ts`; `MoteurQuiPousse` → `PushingEngine` |
| `poussent` | `push` | `orchestrateur/tests/forge-gitea.test.ts` |  |
| `pousser` | `push` | `orchestrateur/src/exterieur/forge-gitea.ts`, `orchestrateur/src/exterieur/moteur-pousse.ts` |  |
| `pousses` | `pushed` | `orchestrateur/tests/forge-gitea.test.ts` |  |
| `poussée` | `pushed` |  |  |
| `precedent` | `previous` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0001_schema.sql` | not checked: English word or function word |
| `precedente` | `previous` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/db.ts` |  |
| `precedents` | `previous` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/features/steps/verifications.ts` | not checked: English word or function word |
| `preciser` | `clarify` |  | gate action "préciser" → clarify |
| `precision` | `clarification` | `orchestrateur/features/steps/verifications.ts`, `orchestrateur/src/workflows/cycleOutil.ts` | not checked: English word or function word; (English homograph) the admin's clarification at a gate: `precision_admin` → `admin_clarification` |
| `prefixe` | `prefix` | `infra/ansible/files/nettoyage-registre.py`, `infra/ansible/roles/sauvegarde/templates/eupadev-sauvegarde.sh.j2` |  |
| `premier` | `first` | `orchestrateur/tests/db.test.ts`, `orchestrateur/tests/moteur-claude.test.ts` |  |
| `premiere` | `first` | `orchestrateur/tests/robustesse.test.ts`, `socle/src/auth.js` |  |
| `prendre` | `take` | `orchestrateur/src/orchestrateur.ts` |  |
| `prenom` | `first_name` | `infra/ansible/group_vars/orchestrateur/keycloak.yml`, `infra/ansible/roles/keycloak/tasks/master.yml` |  |
| `preparees` | `prepared` | `orchestrateur/src/exterieur/factices.ts` |  |
| `preparer` | `prepare` | `orchestrateur/tests/aides/banc.ts`, `infra/ansible/roles/deployeur/files/deployeur.py` |  |
| `prerequis` | `prerequisites` | `docs/deployment.md`, `docs/fr/installation.md` |  |
| `pret` | `ready` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/src/orchestrateur.ts` |  |
| `prets` | `ready` | `orchestrateur/tests/service.test.ts` |  |
| `preuve` | `evidence` | `orchestrateur/src/moteur/rapport.ts`, `orchestrateur/tests/a-r6.test.ts` | the report field is already `evidence` |
| `prive` | `private` | `orchestrateur/tests/aides/oidc-factice.ts` |  |
| `privee` | `private` | `infra/ansible/init-vault.sh` |  |
| `privé` | `private` | `orchestrateur/tests/aides/oidc-factice.ts` |  |
| `prix` | `price` | `socle/tests/front-unitaire.test.js` |  |
| `probleme` | `problem` | `socle/src/erreurs.js`, `socle/src/http.js` | socle `Probleme` → `Problem` (RFC 9457 problem details) |
| `processeur` | `processor` | `infra/ansible/files/mesure-ressources.sh` |  |
| `processus` | `process` | `orchestrateur/tests/reprise.test.ts`, `orchestrateur/tests/roles.test.ts` |  |
| `proche` | `near` | `orchestrateur/features/steps/verifications.ts` |  |
| `profils` | `profiles` | `docs/adr/002-une-seule-pile-et-deux-profils-d-exploitation.md` |  |
| `profond` | `deep` | `socle/tests/http.test.js` |  |
| `profondeur` | `depth` | `orchestrateur/migrations/0010_fusion-acteurs.sql` |  |
| `progres` | `progress` | `orchestrateur/src/durcissement/stagnation.ts`, `orchestrateur/tests/stagnation.test.ts` |  |
| `progrès` | `progress` | `orchestrateur/src/durcissement/stagnation.ts`, `orchestrateur/tests/stagnation.test.ts` |  |
| `projet` | `project` | `infra/ansible/files/mesure-pnpm.sh`, `images/agent/controle/essai-amont/verifier.mjs` |  |
| `projets` | `projects` | `infra/ansible/template-lockfile.yml` |  |
| `prolongation` | `extension` | `socle/src/sessions.js` |  |
| `prolongee` | `extended` | `socle/tests/sessions.test.js`, `socle/src/sessions.js` |  |
| `promesse` | `promise` | `orchestrateur/tests/aides/banc.ts`, `socle/web/api.js` |  |
| `propose` | `proposed` | `.github/scripts/verifier-adr.py` | not checked: English word or function word; `DELAI_PROPOSE` → `PROPOSED_DELAY` |
| `proposé` | `proposed` | `.github/scripts/verifier-adr.py` | ADR status (L6) |
| `propre` | `own` | `orchestrateur/tests/mutations/mutations.ts` |  |
| `proprietaire` | `owner` | `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/aides/postgres-jetable.ts` | `orch_proprietaire` → `orch_owner` |
| `proprietaires` | `owners` | `infra/ansible/verify-deployeur-acces.yml` |  |
| `proprietes` | `properties` | `orchestrateur/src/api.ts` |  |
| `protege` | `protected` | `orchestrateur/tests/moteur-claude.test.ts`, `orchestrateur/tests/aides/claude-factice/claude` |  |
| `protegee` | `protected` | `orchestrateur/tests/forge-gitea.test.ts` |  |
| `proteger` | `protect` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/migrations/0008_acteurs.sql` |  |
| `proteges` | `protected` | `infra/ansible/group_vars/forge/vars.yml`, `orchestrateur/README.md` |  |
| `provisoire` | `provisional` | `infra/ansible/roles/deployeur/files/deployeur.py` |  |
| `proxys` | `proxies` | `infra/ansible/roles/proxys_agents/tasks/main.yml`, `infra/ansible/roles/deployeur/tasks/main.yml` | `proxys_agents` → `agent_proxies` |
| `préfixe` | `prefix` | `infra/ansible/files/nettoyage-registre.py`, `infra/ansible/roles/sauvegarde/templates/eupadev-sauvegarde.sh.j2` |  |
| `présent` | `present` | `orchestrateur/migrations/0008_acteurs.sql`, `images/agent/controle/essai-amont/essai.sh` |  |
| `présente` | `present` |  |  |
| `prévu` | `planned` |  | ADR check value `prévu` → `planned` |
| `prévue` | `planned` |  |  |
| `publie` | `published` | `infra/ansible/verify-socle.yml`, `orchestrateur/src/exterieur/contrats.ts` |  |
| `publier` | `publish` | `orchestrateur/tests/forge-gitea.test.ts`, `infra/ansible/verify-socle.yml` | `publier.yml` → `publish.yml` |
| `publique` | `public` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/moteur-claude.test.ts` |  |
| `puce` | `bullet` | `socle/web/svg-chart.js`, `socle/tests/exemple/web/style.css` |  |
| `puis` | `then` | `socle/tests/kit.test.js`, `infra/ansible/roles/deployeur/files/test_deployeur.py` |  |
| `puissance` | `power` | `socle/web/svg-chart.js` |  |
| `purger` | `purge` | `infra/ansible/roles/deployeur/files/deployeur.py`, `orchestrateur/src/orchestrateur.ts` |  |
| `périphérique` | `device` |  |  |
| `qualite` | `quality` | `images/agent/controle/report.schema.json`, `template-outil-ia/agents/report.schema.json` | `.claude/rules/qualite.md` → `quality.md` |
| `quand` | `when` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/tests/remplacement.test.ts` |  |
| `quarantaine` | `quarantine` | `orchestrateur/features/exploitation.feature`, `orchestrateur/migrations/0001_schema.sql` |  |
| `quatre` | `four` | `orchestrateur/tests/service.test.ts`, `orchestrateur/src/config.ts` | "quatre yeux" → four eyes |
| `quatrieme` | `fourth` | `orchestrateur/tests/reprise.test.ts` |  |
| `que` | `that` | `orchestrateur/tests/mails.test.ts`, `infra/ansible/roles/deployeur/templates/Caddyfile.j2` | not checked: English word or function word |
| `qui` | `who` | `infra/ansible/verify-template.yml`, `orchestrateur/tests/service.test.ts` | not checked: English word or function word; `MoteurQuiPousse` → `PushingEngine` |
| `quoi` | `what` | `socle/kit/index.js`, `socle/tests/kit-unitaire.test.js` |  |
| `quotidienne` | `daily` | `infra/ansible/roles/sauvegarde/templates/eupadev-sauvegarde.timer.j2` |  |
| `racine` | `root` | `infra/ansible/template-lockfile.yml`, `orchestrateur/tests/forge-gitea.test.ts` |  |
| `racines` | `roots` | `infra/ansible/roles/lab_ca/tasks/main.yml` |  |
| `rafraichissement` | `refresh` | `infra/ansible/files/verif-keycloak.py` |  |
| `raison` | `reason` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/features/steps/actions.ts` |  |
| `raisons` | `reasons` | `orchestrateur/tests/stagnation.test.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `rallonge` | `top_up` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/tests/robustesse.test.ts` | budget top-up granted at a gate (`rallonge_budget_usd` → `budget_top_up_usd`) |
| `rapide` | `fast` | `orchestrateur/tests/forge-gitea.test.ts` |  |
| `rapidement` | `quickly` | `orchestrateur/tests/a-r6.test.ts` |  |
| `rappel` | `reminder` | `orchestrateur/tests/mails.test.ts`, `infra/ansible/arret-urgence.yml` |  |
| `rappels` | `reminders` | `orchestrateur/features/steps/actions.ts` |  |
| `rapport` | `report` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/tests/moteur-claude.test.ts` |  |
| `rapports` | `reports` | `orchestrateur/features/steps/verifications.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `ratee` | `failed` | `infra/ansible/roles/deployeur/files/test_deployeur.py` |  |
| `rebranche` | `rewired` | `infra/ansible/roles/deployeur/tasks/main.yml`, `infra/ansible/roles/postgres_outils/tasks/main.yml` |  |
| `recente` | `recent` | `exemples/demandes/tests/db.test.js` |  |
| `recevoir` | `receive` | `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `recherche` | `search` | `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` | `recherche_chevauchement` → `overlap_search`; "research" for the research notes |
| `recommencer` | `restart` | `socle/src/auth.js` |  |
| `reconnue` | `recognized` | `template-outil-ia/.gitea/controles/garde-fous.sh` |  |
| `reconsiderer` | `reconsider` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/tests/aides/banc.ts` |  |
| `reconstruire` | `rebuild` | `infra/ansible/verify-image-agent.yml`, `infra/ansible/verify-image-base.yml` |  |
| `recreee` | `recreated` | `orchestrateur/tests/db.test.ts` |  |
| `recreer` | `recreate` | `infra/ansible/roles/orchestrateur/tasks/main.yml`, `infra/ansible/roles/executeur/tasks/main.yml` |  |
| `recu` | `received` | `socle/tests/rejeu-avis.test.js`, `infra/ansible/files/sonde-reseau.js` |  |
| `recue` | `received` | `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` | `demande_recue` → `request_received` |
| `reculer` | `move_back` | `exemples/demandes/tests/db.test.js` |  |
| `recus` | `received` | `orchestrateur/features/steps/verifications.ts` |  |
| `redemande` | `asks_again` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/tests/surveillance.test.ts` |  |
| `redemander` | `ask_again` | `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `redemarrer` | `restart` | `infra/ansible/verify-moteur.yml` |  |
| `redirections` | `redirects` | `infra/ansible/files/verif-keycloak.py`, `infra/ansible/verify-keycloak.yml` |  |
| `redirige` | `redirects` | `orchestrateur/tests/forge-gitea.test.ts` |  |
| `rediriger` | `redirect` | `orchestrateur/src/api.ts`, `socle/web/api.js` |  |
| `reecrit` | `rewritten` | `orchestrateur/tests/moteur-claude.test.ts`, `orchestrateur/tests/aides/claude-factice/claude` |  |
| `reel` | `real` | `infra/ansible/verify-deployeur-socle.yml`, `infra/ansible/verify-keycloak.yml` | `orchestrateur_monde_reel` → `orchestrator_real_world` |
| `reelle` | `real` | `infra/ansible/verify-template.yml`, `orchestrateur/src/exterieur/factices.ts` |  |
| `reelles` | `real` | `infra/ansible/verify-keycloak.yml` |  |
| `reels` | `real` | `infra/ansible/verify-keycloak.yml`, `orchestrateur/src/exterieur/monde.ts` |  |
| `reessai` | `retry` | `orchestrateur/src/config.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `reessais` | `retries` | `orchestrateur/src/config.ts`, `orchestrateur/src/workflows/deps.ts` |  |
| `reessaye` | `retried` | `orchestrateur/tests/mutations/mutations.ts` |  |
| `referer` | `referer` | `socle/tests/protections.test.js`, `ROADMAP.md` | not checked: English word or function word; HTTP header name, unchanged |
| `reflexions` | `reflexions` | `ROADMAP.md`, `socle/README.md` | `docs/reflexions/` stays French and private (L7); links to it are removed before publication |
| `refus` | `refusal` | `orchestrateur/src/exterieur/deployeur-ssh.ts`, `orchestrateur/migrations/0012_machine-etats.sql` | `fin_refus` → `end_refusal` |
| `refuse` | `refused` | `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` | not checked: English word or function word; gate outcome `refuse` → `refused` |
| `refusee` | `refused` | `infra/ansible/roles/deployeur/files/test_deployeur.py`, `socle/src/index.js` |  |
| `refusees` | `refused` | `infra/ansible/roles/deployeur/files/test_deployeur.py`, `socle/kit/sec.js` |  |
| `refuser` | `refuse` | `orchestrateur/migrations/0001_schema.sql`, `socle/src/contrat.js` |  |
| `refusé` | `refused` | `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` |  |
| `refusée` | `refused` | `infra/ansible/roles/deployeur/files/test_deployeur.py`, `socle/src/index.js` |  |
| `regenerer` | `regenerate` | `.github/scripts/test_verifier_adr.py` |  |
| `registre` | `registry` | `infra/ansible/verify-template.yml`, `infra/ansible/verify-forge.yml` | container/npm registry, tool registry and ADR registry |
| `reglages` | `settings` | `orchestrateur/scripts/essai-integration.ts` |  |
| `regle` | `rule` | `images/agent/controle/essai-amont/essai.sh`, `orchestrateur/tests/forge-gitea.test.ts` |  |
| `regles` | `rules` | `.github/workflows/template-regles.yml`, `orchestrateur/src/moteur/consignes.ts` |  |
| `reinitialiser` | `reset` | `socle/tests/kit.test.js`, `exemples/demandes/tests/kit.test.js` |  |
| `rejet` | `rejection` | `exemples/demandes/tests/kit.test.js` |  |
| `rejetee` | `rejected` | `exemples/demandes/web/app.js`, `exemples/demandes/db/migrations/0001_demandes.sql` | request status → `rejected` |
| `rejeter` | `reject` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/src/exterieur/forge-gitea.ts` |  |
| `rejeté` | `rejected` |  | ADR status (L6) |
| `rejeu` | `replay` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/tests/service.test.ts` |  |
| `rejoue` | `replayed` | `orchestrateur/tests/mutations/mutations.ts`, `socle/tests/auth-unitaire.test.js` |  |
| `rejouee` | `replayed` | `orchestrateur/tests/mails.test.ts` |  |
| `relais` | `relay` | `orchestrateur/tests/config.test.ts` |  |
| `relance` | `reminder` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/src/config.ts` | reminder to a human (24/48/72 h); a bounded re-run of the same state is a "retry" (see Open questions) |
| `relancer` | `relaunch` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/src/workflows/cycleOutil.ts` | recording a reminder → `remind` (`Base.relancer` → `Database.remind`) |
| `relances` | `reminders` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/machine/etats.ts` |  |
| `relecteur` | `reviewer` | `images/agent/controle/essai-amont/verifier.mjs`, `images/agent/controle/essai-amont/essai.sh` |  |
| `relecteurs` | `reviewers` | `orchestrateur/tests/mutations/mutations.ts`, `docs/adr/020-relecteurs-en-lecture-seule-par-le-harnais.md` |  |
| `relecture` | `review` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `relever` | `record` | `orchestrateur/tests/web.test.ts`, `socle/tests/front.test.js` |  |
| `relire` | `reread` | `infra/ansible/roles/orchestrateur/tasks/tls-base.yml` |  |
| `relu` | `reviewed` | `orchestrateur/tests/robustesse.test.ts` |  |
| `remettre` | `restore` | `orchestrateur/src/workflows/cycleOutil.ts` | `remettreProd` → `restoreProd` |
| `remise` | `reset` | `orchestrateur/src/db.ts`, `orchestrateur/src/workflows/cycleOutil.ts` | "remise à zéro" → reset (`derniereRemiseAZero` → `lastReset`) |
| `rempl` | `repl` | `orchestrateur/tests/mutations/mutations.ts`, `.github/scripts/verifier-adr.py` | abbreviation of replacement |
| `remplace` | `replaces` | `infra/ansible/roles/deployeur/files/test_deployeur.py` |  |
| `remplacee` | `replaced` | `exemples/demandes/tests/kit.test.js`, `infra/ansible/roles/deployeur/files/test_deployeur.py` |  |
| `remplacees` | `replaced` | `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `remplacement` | `replacement` | `orchestrateur/tests/remplacement.test.ts`, `orchestrateur/README.md` | ADR status "remplacé par" → "superseded by" (L6) |
| `remplacements` | `replacements` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/tests/mutations/lancer.ts` |  |
| `remplir` | `fill` | `exemples/demandes/web/app.js`, `socle/tests/exemple/web/app.js` |  |
| `rendre` | `render` | `socle/tests/exemple/web/app.js`, `socle/web/render.js` | UI rendering (`rendre` → `render`); "rendre" a value → return |
| `rendu` | `render` | `exemples/demandes/web/app.js`, `orchestrateur/tests/moteur-claude.test.ts` |  |
| `renommer` | `rename` | `orchestrateur/features/gates-livraison.feature` |  |
| `renouveler` | `renew` | `infra/ansible/roles/pki_base/tasks/main.yml`, `infra/ansible/roles/pki_base/defaults/main.yml` |  |
| `renseigner` | `fill_in` | `orchestrateur/migrations/0008_acteurs.sql` | `renseigner_nom_acteur` → `fill_in_actor_name` |
| `repli` | `fallback` | `orchestrateur/tests/reprise/enfant.ts`, `orchestrateur/src/exterieur/factices.ts` |  |
| `repondre` | `answer` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/src/exterieur/factices.ts` |  |
| `repondu` | `answered` | `orchestrateur/src/exterieur/factices.ts` |  |
| `reponse` | `response` | `infra/ansible/verify-template.yml`, `orchestrateur/src/exterieur/factices.ts` |  |
| `reponses` | `responses` | `orchestrateur/tests/deployeur-ssh.test.ts`, `socle/tests/contrat.test.js` |  |
| `reprendre` | `resume` | `orchestrateur/tests/reprise.test.ts`, `orchestrateur/tests/mails.test.ts` |  |
| `reprends` | `resume` | `orchestrateur/features/gates-livraison.feature` |  |
| `repris` | `resumed` | `infra/ansible/verify-moteur-forge.yml`, `orchestrateur/tests/forge-gitea.test.ts` |  |
| `reprise` | `resume` | `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` | trigger `reprise:<state>` → `resume:<state>` |
| `reprises` | `resumes` | `infra/ansible/verify-moteur-forge.yml`, `orchestrateur/tests/machine.test.ts` |  |
| `requete` | `request` | `socle/src/contrat.js`, `socle/tests/auth.test.js` | HTTP request (`ajvRequete` → `ajvRequest`); an SQL statement → `query` (`db.requete` → `db.query`) |
| `requetes` | `requests` | `socle/tests/auth-unitaire.test.js`, `socle/tests/protections.test.js` |  |
| `requis` | `required` | `socle/web/form.js`, `orchestrateur/scripts/essai-claude.ts` |  |
| `requise` | `required` | `orchestrateur/features/gates-livraison.feature`, `orchestrateur/migrations/0012_machine-etats.sql` | `gate1_requise` → `gate1_required` |
| `requête` | `request` | `socle/src/contrat.js`, `socle/tests/auth.test.js` |  |
| `reseau` | `network` | `infra/ansible/verify-agents.yml`, `infra/ansible/roles/deployeur/files/deployeur.py` |  |
| `reseaux` | `networks` | `infra/ansible/roles/deployeur/tasks/main.yml`, `infra/ansible/verify-agents.yml` |  |
| `reserves` | `reserved` | `socle/src/contrat.js`, `infra/ansible/roles/deployeur/defaults/main.yml` | not checked: English word or function word |
| `resolue` | `resolved` | `exemples/demandes/tests/db.test.js`, `exemples/demandes/tests/kit.test.js` | request status → `resolved` |
| `resoudre` | `resolve` | `orchestrateur/tests/db.test.ts`, `orchestrateur/src/exterieur/factices.ts` |  |
| `ressources` | `resources` | `infra/ansible/mesure-ressources.yml`, `infra/ansible/files/mesure-ressources.sh` |  |
| `restant` | `remaining` | `infra/ansible/verify-forge.yml` |  |
| `restants` | `remaining` | `infra/ansible/arret-urgence.yml` |  |
| `restaurable` | `restorable` | `exemples/demandes/tests/db.test.js` |  |
| `restauration` | `restore` | `infra/ansible/verify-sauvegarde.yml` |  |
| `restauree` | `restored` | `exemples/demandes/tests/kit.test.js`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `reste` | `rest` | `template-outil-ia/.gitea/controles/garde-fous.sh`, `orchestrateur/tests/robustesse.test.ts` |  |
| `rester` | `stay` | `docs/adr/012-forge-rester-sur-gitea-porte-ouverte-vers-forgejo.md` |  |
| `restes` | `leftovers` | `infra/ansible/verify-moteur-deploiement.yml`, `infra/ansible/verify-moteur-claude.yml` |  |
| `resultat` | `result` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/tests/aides/claude-factice/claude` |  |
| `resultats` | `results` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `resume` | `summary` | `infra/ansible/mesure-ressources.yml`, `orchestrateur/tests/service.test.ts` | not checked: English word or function word; (English homograph) French "résumé": `resumeHebdo` → `weeklySummary`; English `resume` (DBOS) unchanged |
| `retard` | `late` | `.github/workflows/adr-propositions.yml`, `.github/scripts/test_verifier_adr.py` | `retard.md` → `late.md` |
| `retenir` | `retain` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/src/db.ts` |  |
| `retentions` | `retentions` | `infra/ansible/roles/deployeur/files/test_deployeur.py`, `infra/ansible/roles/deployeur/files/deployeur.py` |  |
| `retenue` | `retained` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/tests/surveillance.test.ts` |  |
| `retiree` | `removed` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/features/steps/verifications.ts` |  |
| `retirer` | `remove` | `orchestrateur/tests/surveillance.test.ts`, `infra/ansible/roles/deployeur/files/deployeur.py` |  |
| `retiré` | `withdrawn` | `socle/kit/index.js` | ADR status `retiré` → `withdrawn` (L6); "removed" elsewhere |
| `retirés` | `removed` |  |  |
| `retour` | `return` | `orchestrateur/tests/db.test.ts`, `socle/tests/auth.test.js` | `aller_retour` → `round_trip` |
| `retours` | `returns` | `orchestrateur/tests/machine.test.ts` |  |
| `retrait` | `removal` | `template-outil-ia/.gitea/controles/paquet.mjs`, `infra/ansible/roles/deployeur/files/test_deployeur.py` | text indentation → `indent` (`retraitBloc` → `blockIndent`) |
| `revoque` | `revoked` | `socle/tests/sessions.test.js` |  |
| `revue` | `review` | `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` | `durcissement_revue` → `hardening_review` |
| `riche` | `rich` | `socle/tests/exemple/web/app.js`, `socle/tests/front.test.js` |  |
| `rien` | `nothing` | `infra/ansible/roles/deployeur/files/test_deployeur.py`, `infra/ansible/verify-maquette.yml` |  |
| `robustesse` | `robustness` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/README.md` |  |
| `rouge` | `red` | `infra/ansible/verify-template.yml`, `orchestrateur/features/durcissement-review.feature` | CI result `rouge` → `red` |
| `rouges` | `red` | `infra/ansible/verify-moteur-ci.yml`, `orchestrateur/src/messages.ts` |  |
| `routage` | `routing` | `socle/tests/http.test.js` |  |
| `routeur` | `router` | `exemples/demandes/web/app.js`, `socle/tests/exemple/web/app.js` |  |
| `règle` | `rule` | `images/agent/controle/essai-amont/essai.sh`, `orchestrateur/tests/forge-gitea.test.ts` |  |
| `réparée` | `repaired` |  |  |
| `réponds` | `answer` |  |  |
| `réponses` | `responses` | `orchestrateur/tests/deployeur-ssh.test.ts`, `socle/tests/contrat.test.js` |  |
| `réseau` | `network` | `infra/ansible/verify-agents.yml`, `infra/ansible/roles/deployeur/files/deployeur.py` |  |
| `réser` | `reser` |  | split word "Réser${}vation" in a test string |
| `réservation` | `booking` |  | test fixture word |
| `réservations` | `bookings` |  |  |
| `résultat` | `result` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/tests/aides/claude-factice/claude` |  |
| `résumé` | `summary` | `infra/ansible/mesure-ressources.yml`, `orchestrateur/tests/service.test.ts` |  |
| `révision` | `review` | `ROADMAP.md`, `docs/adr/002-une-seule-pile-et-deux-profils-d-exploitation.md` |  |
| `révocation` | `revocation` |  |  |
| `réécrite` | `rewritten` |  |  |
| `rôle` | `role` | `orchestrateur/features/steps/verifications.ts`, `socle/tests/http.test.js` |  |
| `sain` | `healthy` | `infra/ansible/roles/deployeur/files/deployeur.py` |  |
| `saine` | `healthy` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/src/db.ts` |  |
| `saisie` | `input` | `orchestrateur/features/steps/chat.ts`, `orchestrateur/tests/web.test.ts` |  |
| `saisissez` | `enter` | `infra/ansible/roles/deployeur/templates/Caddyfile.j2` |  |
| `salarie` | `employee` | `infra/ansible/group_vars/all/outils-socle.yml` | test fixture word |
| `sans` | `without` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/tests/mutations/mutations.ts` | not checked: function word. In names → `no` (`*_sans_truncate` → `*_no_truncate`, `SANS_CACHE` → `NO_CACHE`, `cookie-sans-prefixe-host` → `cookie-no-host-prefix`) |
| `sante` | `health` | `infra/ansible/roles/deployeur/files/test_deployeur.py`, `orchestrateur/tests/service.test.ts` | route `/sante` → `/health` |
| `santé` | `health` | `infra/ansible/roles/deployeur/files/test_deployeur.py`, `orchestrateur/tests/service.test.ts` |  |
| `satisfait` | `satisfied` | `orchestrateur/features/gates-livraison.feature`, `orchestrateur/features/steps/actions.ts` | feedback outcome `satisfait` → `satisfied` |
| `sauf` | `except` | `orchestrateur/src/db.ts` |  |
| `saut` | `jump` | `orchestrateur/tests/machine.test.ts` |  |
| `saute` | `skipped` | `infra/ansible/verify-template.yml`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `sauvegarde` | `backup` | `infra/ansible/verify-sauvegarde.yml`, `infra/ansible/roles/sauvegarde/tasks/main.yml` |  |
| `sauvegardes` | `backups` | `infra/README.md`, `infra/ansible/group_vars/all/vars.yml` |  |
| `scalaires` | `scalars` | `socle/src/contrat.js` |  |
| `schema` | `schema` | `exemples/demandes/openapi.yaml`, `orchestrateur/src/exterieur/moteur-claude.ts` | not checked: English word |
| `schemas` | `schemas` | `exemples/demandes/openapi.yaml`, `socle/tests/contrat.test.js` | not checked: English word or function word; English word (`#/components/schemas/`): unchanged |
| `schéma` | `schema` | `exemples/demandes/openapi.yaml`, `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `schémathèque` | `schema_library` |  |  |
| `scripte` | `scripted` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/src/exterieur/factices.ts` | `EcartScripte` → `ScriptedDeviation` |
| `scriptes` | `scripted` | `orchestrateur/features/support/hooks.ts`, `orchestrateur/features/support/monde.ts` |  |
| `scénario` | `scenario` | `orchestrateur/features/support/hooks.ts`, `orchestrateur/tests/aides/claude-factice/claude` |  |
| `se` | `self` | `orchestrateur/features/entree-chevauchement.feature`, `infra/ansible/files/verif-keycloak.py` | not checked: English word or function word; dropped (`se_connecter` → `sign_in`) |
| `secondes` | `seconds` | `socle/tests/front-unitaire.test.js`, `socle/web/api.js` |  |
| `secrete` | `secret` | `orchestrateur/tests/config.test.ts` |  |
| `securite` | `security` | `orchestrateur/features/durcissement-review.feature`, `images/agent/controle/report.schema.json` | `.claude/rules/securite.md` → `security.md` |
| `selon` | `according` | `images/agent/controle/essai-amont/essai.sh` |  |
| `separes` | `separate` | `orchestrateur/tests/roles.test.ts` |  |
| `serrurerie` | `locksmithing` | `exemples/demandes/tests/kit.test.js`, `exemples/demandes/tests/db.test.js` | test fixture category |
| `sert` | `serves` | `infra/ansible/roles/deployeur/files/test_deployeur.py`, `infra/ansible/roles/deployeur/files/deployeur.py` |  |
| `serveur` | `server` | `orchestrateur/tests/forge-gitea.test.ts`, `socle/tests/db.test.js` |  |
| `servi` | `served` | `infra/ansible/verify-deployeur-socle.yml`, `infra/ansible/roles/deployeur/files/deployeur.py` |  |
| `servie` | `served` | `infra/ansible/roles/deployeur/files/test_deployeur.py`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `servir` | `serve` | `images/agent/controle/essai-amont/amont.js`, `orchestrateur/src/api.ts` |  |
| `seuil` | `threshold` | `socle/src/debit.js`, `socle/src/http.js` |  |
| `seuils` | `thresholds` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/config.ts` |  |
| `seul` | `only` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/tests/mutations/mutations.ts` | `*_ajout_seul` → `*_append_only` |
| `seule` | `only` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/db.ts` | `lecture seule` → read-only |
| `seulement` | `only` | `orchestrateur/src/orchestrateur.ts`, `socle/tests/keycloak/realm-test.json` |  |
| `seuls` | `only` | `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `si` | `if` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/migrations/0005_taches-lanceur.sql` | not checked: English word or function word |
| `sienne` | `theirs` | `orchestrateur/src/workflows/deps.ts` |  |
| `signaler` | `report` | `template-outil-ia/.gitea/controles/garde-fous.sh` |  |
| `signalé` | `reported` |  |  |
| `signalée` | `reported` |  |  |
| `signaux` | `signals` | `socle/web/api.js` |  |
| `signe` | `signed` | `docs/adr/013-moteur-d-agent-interchangeable-claude-code-binaire-signe.md` |  |
| `signee` | `signed` | `orchestrateur/tests/moteur-claude.test.ts`, `docs/adr/018-les-instructions-viennent-de-l-image-signee.md` |  |
| `signé` | `signed` | `docs/adr/013-moteur-d-agent-interchangeable-claude-code-binaire-signe.md` |  |
| `simultanee` | `concurrent` | `orchestrateur/tests/mails.test.ts` |  |
| `simultané` | `concurrent` |  |  |
| `simultanés` | `concurrent` |  |  |
| `simulée` | `simulated` |  |  |
| `socle` | `core` | `orchestrateur/src/exterieur/moteur-claude.ts`, `infra/ansible/verify-socle.yml` | (L1) `@eupadev/socle` → `@eupadev/core`, `socle/` → `core/`, `/socle/…` → `/core/…` |
| `socles` | `cores` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/features/steps/actions.ts` |  |
| `som` | `sum` |  | awk variables `msom`/`csom` in `mesure-ressources.sh` → `msum`/`csum` |
| `sombre` | `dark` | `tests/opengrep/regles-depart.js`, `orchestrateur/tests/web.test.ts` | theme value `sombre` → `dark` |
| `somme` | `sum` | `images/agent/Dockerfile` |  |
| `sondage` | `polling` | `orchestrateur/src/config.ts`, `orchestrateur/src/orchestrateur.ts` |  |
| `sonde` | `probe` | `infra/ansible/verify-agents.yml`, `infra/ansible/verify-template.yml` |  |
| `sonder` | `probe` | `orchestrateur/src/exterieur/factices.ts` |  |
| `sortie` | `output` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/deployeur-ssh.test.ts` | `tokens_sortie` → `output_tokens`; "proxy de sortie" → egress proxy |
| `sorties` | `exits` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/tests/machine.test.ts` | gate exits (`sortiesGate` → `gateExits`) |
| `sortir` | `exit` | `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `souhaite` | `wishes` | `orchestrateur/features/cadrage.feature` |  |
| `soumise` | `submitted` | `exemples/demandes/tests/kit.test.js`, `exemples/demandes/tests/unit/transitions.test.js` | request status → `submitted` |
| `sous` | `sub` | `infra/ansible/roles/deployeur/files/deployeur.py`, `orchestrateur/tests/aides/claude-factice/claude` | `sous_module` → `submodule`; `sous_type` → `subtype` |
| `specificateur` | `specifier` | `orchestrateur/tests/mutations/mutations.ts` |  |
| `statique` | `static` | `orchestrateur/src/api.ts`, `orchestrateur/src/statique.ts` |  |
| `statiques` | `static` | `socle/kit/sec.js`, `socle/tests/kit-charge.k6.js` |  |
| `statut` | `status` | `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/forge-gitea.test.ts` |  |
| `statuts` | `statuses` | `orchestrateur/src/workflows/cycleOutil.ts`, `socle/src/contrat.js` |  |
| `stockage` | `storage` | `infra/ansible/verify-stockage.yml`, `orchestrateur/features/cadrage.feature` |  |
| `strategie` | `strategy` | `ROADMAP.md`, `docs/adr/001-appliance-sur-vm-fournies-par-la-dsi.md` |  |
| `succes` | `success` | `orchestrateur/tests/moteur-claude.test.ts`, `orchestrateur/tests/robustesse.test.ts` |  |
| `succès` | `success` | `orchestrateur/tests/moteur-claude.test.ts`, `orchestrateur/tests/robustesse.test.ts` |  |
| `suffixe` | `suffix` | `infra/ansible/enregistrer-outils.yml`, `orchestrateur/scripts/generer-mermaid.ts` |  |
| `suivant` | `next` | `orchestrateur/src/durcissement/stagnation.ts`, `orchestrateur/src/orchestrateur.ts` |  |
| `suivante` | `next` | `orchestrateur/features/steps/verifications.ts`, `orchestrateur/tests/aides/features.ts` |  |
| `suivi` | `tracking` | `socle/src/http.js`, `socle/src/index.js` | "sans suivi de redirection" → no follow (`fetchSansSuivi` → `fetchNoFollow`) |
| `suivre` | `track` | `orchestrateur/features/chat.feature`, `orchestrateur/features/cadrage.feature` |  |
| `sujet` | `subject` | `orchestrateur/tests/auth.test.ts`, `orchestrateur/tests/robustesse.test.ts` | OIDC subject; "topic" only in "sujet de la notification" (see `SUJET_ANNULATION`) |
| `sujets` | `subjects` | `orchestrateur/features/support/web.ts`, `orchestrateur/tests/aides/banc.ts` |  |
| `supplementaires` | `additional` | `infra/ansible/group_vars/forge/vars.yml`, `infra/ansible/roles/gitea_org/tasks/main.yml` |  |
| `supportees` | `supported` | `infra/ansible/group_vars/orchestrateur/keycloak.yml`, `infra/ansible/roles/keycloak/tasks/realm.yml` |  |
| `suppression` | `deletion` | `socle/tests/front.test.js` | not checked: English word or function word |
| `supprime` | `deleted` | `orchestrateur/tests/moteur-claude.test.ts`, `orchestrateur/tests/aides/claude-factice/claude` |  |
| `supprimee` | `deleted` | `exemples/demandes/tests/db.test.js`, `exemples/demandes/tests/kit.test.js` |  |
| `supprimees` | `deleted` | `exemples/demandes/api/listRequests.js`, `exemples/demandes/web/app.js` | query parameter `supprimees` → `deleted` |
| `supprimer` | `delete` | `orchestrateur/tests/aides/mailpit-jetable.ts`, `orchestrateur/tests/aides/postgres-jetable.ts` |  |
| `supprimé` | `deleted` | `orchestrateur/tests/moteur-claude.test.ts`, `orchestrateur/tests/aides/claude-factice/claude` |  |
| `sur` | `on` | `orchestrateur/src/orchestrateur.ts`, `infra/ansible/files/mesure-ressources.sh` | not checked: English word or function word |
| `surcharge` | `overload` | `orchestrateur/tests/mutations/mutations.ts` |  |
| `sures` | `safe` | `socle/src/protections.js` |  |
| `surveillance` | `monitoring` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/tests/surveillance.test.ts` | DBOS workflow `surveillance` → `monitoring` |
| `survit` | `survives` | `orchestrateur/tests/mutations/lancer.ts` |  |
| `symbolique` | `symbolic` | `orchestrateur/tests/moteur-claude.test.ts`, `orchestrateur/tests/aides/claude-factice/claude` |  |
| `synthetiques` | `synthetic` | `template-outil-ia/scripts/generer-catalogue-rapport.js` |  |
| `systeme` | `system` | `infra/ansible/verify-systeme.yml`, `docs/deployment.md` |  |
| `sécurité` | `security` | `orchestrateur/features/durcissement-review.feature`, `images/agent/controle/report.schema.json` |  |
| `séparés` | `separate` | `orchestrateur/tests/roles.test.ts` |  |
| `série` | `series` |  |  |
| `sûr` | `safe` | `orchestrateur/src/orchestrateur.ts`, `infra/ansible/files/mesure-ressources.sh` | `HtmlSur` → `SafeHtml` (not `sur` = on) |
| `sûreté` | `safety` |  |  |
| `tableau` | `table` | `orchestrateur/src/config.ts`, `infra/ansible/roles/executeur/defaults/main.yml` | "tableau de bord" → dashboard; a JS array → `array` (`pas-un-tableau` → `not-an-array`) |
| `tableur` | `spreadsheet` | `orchestrateur/features/cadrage.feature` |  |
| `tache` | `task` | `orchestrateur/tests/moteur-claude.test.ts`, `orchestrateur/features/steps/actions.ts` |  |
| `taches` | `tasks` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/features/cadrage.feature` |  |
| `taille` | `size` | `socle/src/statique.js`, `orchestrateur/src/api.ts` |  |
| `tampon` | `buffer` | `infra/ansible/roles/deployeur/files/test_deployeur.py` |  |
| `tardif` | `late` | `orchestrateur/tests/surveillance.test.ts` |  |
| `tardive` | `late` | `orchestrateur/features/steps/actions.ts` |  |
| `telecharger` | `download` | `exemples/demandes/tests/kit.test.js`, `socle/tests/http.test.js` |  |
| `temoin` | `witness` | `infra/ansible/verify-sauvegarde.yml`, `infra/ansible/verify-template.yml` | `depot_temoin` → `witness_repo` |
| `temporaire` | `temporary` | `infra/ansible/group_vars/orchestrateur/keycloak.yml` |  |
| `tentative` | `attempt` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/src/db.ts` | not checked: English word or function word; (English homograph) `ETAPE_TENTATIVES` → `STEP_ATTEMPTS` |
| `tentatives` | `attempts` | `orchestrateur/src/exterieur/forge-gitea.ts`, `orchestrateur/src/config.ts` |  |
| `tentée` | `attempted` |  |  |
| `tenu` | `kept` | `orchestrateur/features/support/hooks.ts` |  |
| `termine` | `finished` | `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/db.test.ts` | `termine_le` → `finished_at` |
| `terminee` | `finished` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/features/durcissement-review.feature` | `ci_terminee` → `ci_finished` |
| `tes` | `your` | `images/agent/controle/essai-amont/essai.sh` |  |
| `tete` | `header` | `orchestrateur/tests/forge-gitea.test.ts`, `template-outil-ia/.gitea/controles/garde-fous.sh` | "en-tête" → header; `head` in git contexts (`tete=$(git rev-parse HEAD^{tree})`) |
| `tetes` | `headers` | `infra/ansible/files/verif-keycloak.py`, `socle/src/http.js` |  |
| `texte` | `text` | `images/agent/controle/essai-amont/verifier.mjs`, `orchestrateur/features/steps/verifications.ts` |  |
| `textes` | `texts` | `orchestrateur/features/support/hooks.ts` |  |
| `thème` | `theme` | `orchestrateur/web/app.js`, `orchestrateur/web/index.html` |  |
| `tirer` | `pull` | `infra/ansible/roles/deployeur/files/deployeur.py` |  |
| `titre` | `title` | `orchestrateur/tests/aides/features.ts`, `orchestrateur/tests/couverture-features.test.ts` |  |
| `titres` | `titles` | `socle/src/erreurs.js` |  |
| `toujours` | `always` | `infra/ansible/verify-deployeur.yml`, `orchestrateur/tests/forge-gitea.test.ts` |  |
| `tour` | `round` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/features/steps/actions.ts` | hardening round (`plafond_tours` → `rounds_cap`); an agent's model turn is `turn` (`--max-turns`, `PlafondTache.tours` → `turns`) |
| `tourne` | `ran` | `infra/ansible/verify-template.yml`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `tours` | `rounds` | `orchestrateur/features/durcissement-review.feature`, `orchestrateur/src/durcissement/stagnation.ts` | `turns` for model turns, see `tour` |
| `tous` | `all` | `.github/scripts/verifier-adr.py`, `infra/ansible/group_vars/forge/vars.yml` | not checked: English word or function word |
| `tout` | `all` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/config.ts` | not checked: English word or function word; `test:tout` → `test:all` |
| `toute` | `all` | `template-outil-ia/.opengrep/regles-depart.yml` | not checked: English word or function word |
| `toutes` | `all` | `socle/src/http.js`, `infra/ansible/files/mesure-ressources.sh` | not checked: English word or function word |
| `tracees` | `traced` | `orchestrateur/features/support/hooks.ts` |  |
| `trafic` | `traffic` | `infra/ansible/roles/deployeur/files/test_deployeur.py` |  |
| `traite` | `handled` | `orchestrateur/migrations/0001_schema.sql` | `traite_le` → `handled_at` |
| `traiter` | `handle` | `orchestrateur/src/api.ts`, `orchestrateur/tests/forge-gitea.test.ts` |  |
| `transiter` | `transition` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/tests/aides/banc.ts` | verb (`Base.transiter` → `Base.transition`) |
| `transitoire` | `transient` | `orchestrateur/src/exterieur/forge-gitea.ts`, `orchestrateur/tests/forge-gitea.test.ts` |  |
| `transmis` | `transmitted` | `infra/ansible/verify-template.yml`, `orchestrateur/src/orchestrateur.ts` |  |
| `transversal` | `cross_cutting` | `orchestrateur/scripts/generer-mermaid.ts`, `orchestrateur/src/machine/etats.ts` | phase `transversal` → `cross_cutting` |
| `travail` | `work` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/db.test.ts` |  |
| `traverser` | `cross` | `infra/lab/eupadev-lxd-forward.service` |  |
| `tri` | `sort` | `orchestrateur/features/gates-livraison.feature`, `infra/ansible/files/mesure-ressources.sh` |  |
| `trier` | `sort` | `infra/ansible/files/nettoyage-registre.py` |  |
| `troisieme` | `third` | `orchestrateur/tests/reprise.test.ts` |  |
| `troisième` | `third` | `orchestrateur/tests/reprise.test.ts` |  |
| `trop` | `too` | `orchestrateur/tests/claude-sortie.test.ts`, `orchestrateur/tests/consignes.test.ts` | "trop de" → too many; `champ_en_trop` → `extra_field` |
| `trouve` | `found` | `socle/src/validation.js` |  |
| `trouver` | `find` | `infra/ansible/roles/deployeur/files/test_deployeur.py` |  |
| `trouves` | `found` | `template-outil-ia/.gitea/controles/garde-fous.sh`, `infra/ansible/roles/deployeur/files/deployeur.py` |  |
| `trouvé` | `found` | `socle/src/validation.js` |  |
| `tu` | `you` | `images/agent/controle/essai-amont/essai.sh` | not checked: English word or function word |
| `tue` | `killed` | `orchestrateur/tests/roles.test.ts`, `infra/ansible/verify-deployeur.yml` |  |
| `tuees` | `killed` | `.github/workflows/moteur.yml`, `orchestrateur/tests/mutations/cliquet.ts` | `--tuees` → `--killed`; "mutations tuées" → "killed mutations" |
| `tuer` | `kill` | `orchestrateur/tests/reprise/enfant-mails.ts`, `orchestrateur/tests/mails.test.ts` |  |
| `tuée` | `killed` |  |  |
| `tâche` | `task` | `orchestrateur/tests/moteur-claude.test.ts`, `orchestrateur/features/steps/actions.ts` |  |
| `tâches` | `tasks` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/features/cadrage.feature` |  |
| `têtes` | `headers` | `infra/ansible/files/verif-keycloak.py`, `socle/src/http.js` |  |
| `un` | `one` | `socle/kit/index.js`, `orchestrateur/migrations/0001_schema.sql` | not checked: English word or function word; dropped when it is an article |
| `une` | `one` | `template-outil-ia/.gitea/controles/garde-fous.sh`, `orchestrateur/features/durcissement-review.feature` | not checked: English word or function word; dropped when it is an article |
| `unitaire` | `unit` | `socle/tests/auth-unitaire.test.js`, `socle/tests/front-unitaire.test.js` | `*-unitaire.test.js` → `*-unit.test.js` |
| `unite` | `unit` | `infra/ansible/roles/orchestrateur/tasks/systemd-creds.yml`, `infra/ansible/roles/orchestrateur/tasks/tls-base.yml` | systemd unit |
| `unites` | `units` | `infra/ansible/roles/nettoyage_registre/tasks/main.yml`, `infra/ansible/verify-moteur-ci.yml` |  |
| `urgence` | `emergency` | `infra/ansible/arret-urgence.yml`, `infra/README.md` |  |
| `utilisateur` | `user` | `infra/ansible/verify-keycloak.yml`, `infra/ansible/files/verif-keycloak.py` |  |
| `utilisateurs` | `users` | `socle/kit/deux-utilisateurs.js`, `socle/tests/kit-unitaire.test.js` | `kit/deux-utilisateurs.js` → `kit/two-users.js` |
| `utiliser` | `use` | `orchestrateur/features/gates-livraison.feature` |  |
| `utilisé` | `used` |  |  |
| `utilisée` | `used` |  |  |
| `utilitaires` | `utility` | `orchestrateur/features/entree-chevauchement.feature` |  |
| `valable` | `valid` | `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `valeur` | `value` | `socle/kit/index.js`, `infra/ansible/group_vars/orchestrateur/vars.yml` |  |
| `valeurs` | `values` | `socle/web/render.js`, `socle/web/svg-chart.js` |  |
| `validateur` | `validator` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/workflows/deps.ts` |  |
| `valide` | `valid` | `infra/ansible/verify-template.yml`, `orchestrateur/src/moteur/rapport.ts` |  |
| `valider` | `validate` | `orchestrateur/src/moteur/rapport.ts`, `orchestrateur/src/api.ts` |  |
| `variante` | `variant` | `images/agent/controle/essai-amont/essai.sh`, `infra/ansible/files/nettoyage-registre.py` |  |
| `variantes` | `variants` | `infra/ansible/verify-moteur-integration.yml`, `infra/ansible/verify-moteur-ci.yml` |  |
| `verif` | `check` | `infra/ansible/verify-deployeur-socle.yml`, `infra/ansible/verify-deployeur.yml` | `verif_*` Ansible registers → `check_*`; `verif-*` names → `check-*` |
| `verificateur` | `verifier` | `infra/ansible/files/verif-keycloak.py`, `socle/src/auth.js` |  |
| `verifications` | `checks` | `images/agent/controle/report.schema.json`, `template-outil-ia/agents/report.schema.json` | not checked: identical English word (`features/steps/verifications.ts` → `checks.ts`) |
| `verifier` | `verify` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/tests/auth.test.ts` | not checked: English homograph (OAuth `code_verifier`); French verb → `verify` (`verifier-adr.py` → `verify-adr.py`) |
| `verrou` | `lock` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/exterieur/moteur-claude.ts` | advisory lock → `lock`; the pnpm lockfile → `lockfile` (`socleDuVerrou` → `coreFromLockfile`) |
| `verrous` | `locks` | `infra/ansible/roles/deployeur/files/test_deployeur.py`, `infra/ansible/roles/deployeur/files/deployeur.py` |  |
| `vers` | `to` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/tests/machine.test.ts` | not checked: function word; transition endpoint `vers` → `to` (SQL `to_state`) |
| `vert` | `green` | `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/features/steps/actions.ts` | CI result `vert` → `green` |
| `verte` | `green` | `orchestrateur/features/lanceur.feature`, `orchestrateur/features/gates-livraison.feature` |  |
| `verts` | `green` | `orchestrateur/tests/forge-gitea.test.ts` |  |
| `veux` | `want` | `orchestrateur/features/chat.feature`, `orchestrateur/features/cadrage.feature` |  |
| `vidage` | `emptying` | `infra/ansible/roles/deployeur/files/test_deployeur.py` |  |
| `vide` | `empty` | `.github/workflows/template-regles.yml`, `socle/tests/exemple/web/app.js` |  |
| `videe` | `emptied` | `infra/ansible/roles/deployeur/files/test_deployeur.py` |  |
| `vider` | `empty` | `orchestrateur/tests/mails.test.ts`, `infra/ansible/roles/deployeur/files/deployeur.py` |  |
| `vides` | `empty` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/features/support/hooks.ts` |  |
| `vie` | `life` | `orchestrateur/tests/mutations/mutations.ts`, `template-outil-ia/.gitea/controles/paquet.mjs` | "cycle de vie" → lifecycle |
| `viennent` | `come` | `docs/adr/018-les-instructions-viennent-de-l-image-signee.md` |  |
| `vieux` | `old` | `orchestrateur/src/orchestrateur.ts` |  |
| `virgule` | `comma` | `exemples/demandes/tests/kit.test.js` | `pointVirgule` → `semicolon` |
| `vis` | `screw` | `socle/tests/front.test.js`, `socle/tests/front-unitaire.test.js` | test fixture word |
| `vise` | `targets` | `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `visite` | `visit` | `orchestrateur/tests/service.test.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `visiter` | `visit` | `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `vivant` | `alive` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/surveillance.test.ts` |  |
| `voici` | `here_is` | `orchestrateur/features/cadrage.feature` |  |
| `voie` | `way` | `template-outil-ia/.gitea/controles/garde-fous.sh` |  |
| `volontaire` | `deliberate` | `infra/ansible/verify-template.yml` | `echec-volontaire.test.js` → `deliberate-failure.test.js` |
| `votre` | `your` | `orchestrateur/features/chat.feature` |  |
| `vous` | `you` | `infra/ansible/roles/deployeur/templates/Caddyfile.j2` |  |
| `vrai` | `real` | `orchestrateur/tests/surveillance.test.ts`, `ROADMAP.md` |  |
| `vraies` | `real` | `orchestrateur/tests/machine.test.ts` |  |
| `vu` | `seen` | `infra/ansible/verify-template.yml`, `infra/ansible/verify-deployeur-socle.yml` |  |
| `vue` | `view` | `orchestrateur/features/steps/verifications.ts`, `socle/tests/exemple/web/app.js` |  |
| `vues` | `views` | `orchestrateur/src/durcissement/stagnation.ts`, `orchestrateur/tests/machine.test.ts` |  |
| `vulnerables` | `vulnerable` | `infra/ansible/verify-template.yml` |  |
| `vus` | `seen` | `orchestrateur/tests/machine.test.ts`, `exemples/demandes/tests/kit.test.js` |  |
| `véhicule` | `vehicle` |  |  |
| `véhicules` | `vehicles` |  |  |
| `vérifications` | `checks` | `images/agent/controle/report.schema.json`, `template-outil-ia/agents/report.schema.json` |  |
| `vérifier` | `verify` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/tests/auth.test.ts` |  |
| `yeux` | `eyes` | `orchestrateur/tests/service.test.ts`, `orchestrateur/src/config.ts` | "quatre yeux" → four eyes |
| `zéro` | `zero` | `orchestrateur/src/db.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `à` | `to` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/tests/socle-moteur.test.ts` | not checked: English word or function word; dropped when it only links words |
| `écart` | `deviation` | `orchestrateur/src/durcissement/stagnation.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `échange` | `exchange` | `infra/ansible/files/verif-keycloak.py` |  |
| `échantillon` | `sample` |  |  |
| `échantillonneur` | `sampler` |  |  |
| `échantillonnée` | `sampled` |  |  |
| `échantillons` | `samples` |  |  |
| `échec` | `failure` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/exterieur/factices.ts` |  |
| `échoue` | `fails` | `infra/ansible/verify-template.yml` |  |
| `échoué` | `failed` | `infra/ansible/verify-template.yml` |  |
| `écrit` | `written` | `orchestrateur/tests/aides/claude-factice/claude`, `infra/ansible/roles/deployeur/files/test_deployeur.py` |  |
| `écrite` | `written` |  |  |
| `écrou` | `nut` |  | test fixture word |
| `électricité` | `electricity` | `exemples/demandes/tests/kit.test.js` |  |
| `état` | `state` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/migrations/0001_schema.sql` |  |
| `être` | `be` | `orchestrateur/tests/db.test.ts`, `orchestrateur/tests/robustesse.test.ts` | not checked: English word or function word |

## Core and example tool (`socle/`, `exemples/demandes/`)

Scope: `socle/` (src, kit, web, bin, sql, migrations, tests incl. `tests/exemple/` and the test realm), `images/socle/`,
`exemples/demandes/`, and the names of the fixture `infra/ansible/files/outil-socle-essai/`. Spelling: British English.

### Paths

| French | English | Where | Notes |
|---|---|---|---|
| `socle/` | `core/` | repository root | L1 |
| `socle/bin/demarrer.js` | `core/bin/start.js` | `socle/package.json` (`bin`), `template-outil-ia/.gitea/image/Dockerfile:55`, `socle/kit/compose.test.yml` | fixed entry point of every tool image |
| `socle/bin/migrer.js` | `core/bin/migrate.js` | `socle/kit/compose.test.yml`, `template-outil-ia/.gitea/controles/boot-check.sh:48`, `infra/ansible/verify-deployeur-socle.yml:129` | the deployer runs it by path |
| `socle/bin/purger.js` | `core/bin/purge.js` | `infra/ansible/roles/deployeur/files/deployeur.py:483`, `infra/compose/deployeur/outil-socle.compose.yml`, `exemples/demandes/tests/db.test.js:156` | the deployer runs it by path |
| `socle/kit/deux-utilisateurs.js` | `core/kit/two-users.js` | `exemples/demandes/tests/kit.test.js:12`, `infra/ansible/files/acceptance-essai/steps/sign-in.js` | published subpath `@eupadev/core/kit/two-users.js` |
| `socle/kit/entetes.js` | `core/kit/headers.js` | `exemples/demandes/tests/perf/charge.k6.js:6`, `socle/kit/outils.js` | |
| `socle/kit/navigateur.js` | `core/kit/http-browser.js` | `socle/kit/index.js:10` | override: `browser` alone clashes with Playwright's `browser` in the same tests |
| `socle/kit/outils.js` | `core/kit/test-tools.js` | `exemples/demandes/tests/kit.test.js:14`, `socle/tests/kit-unitaire.test.js` | override: the external test tools (Schemathesis, ZAP, k6); `tools` alone reads as generated tools |
| `socle/kit/postgres-jetable.js` | `core/kit/throwaway-postgres.js` | `exemples/demandes/tests/db.test.js:10`, `exemples/demandes/tests/stack.js:6`, `socle/tests/aides/postgres-jetable.js` | word order |
| `socle/migrations/0001_socle.sql` | `core/migrations/0001_core.sql` | `socle/tests/db.test.js` (asserts `0001_socle`) | name stored in `socle_migrations` (rewritten in place, L2; lab rebuilt) |
| `socle/migrations/0003_audit_cle.sql` | `core/migrations/0003_audit_key.sql` | `socle/tests/db.test.js` (asserts `0003_audit_cle`) | same |
| `socle/src/contrat.js` | `core/src/contract.js` | `socle/src/index.js:6`, `socle/kit/index.js:9` | |
| `socle/src/debit.js` | `core/src/rate-limit.js` | `socle/src/index.js:19`, `socle/src/http.js`, `socle/tests/kit.test.js` | override: the module is the rate limiter, `rate.js` alone says nothing |
| `socle/src/erreurs.js` | `core/src/errors.js` | `socle/src/index.js:11` | |
| `socle/src/journal.js` | `core/src/logger.js` | `socle/src/index.js:15`, `socle/src/http.js` | override: it builds the pino logger (see Dictionary requests) |
| `socle/src/statique.js` | `core/src/static.js` | `socle/src/http.js`, `socle/tests/kit.test.js` | |
| `socle/tests/aides/` | `core/tests/helpers/` | `socle/tests/*.test.js`, `.github/workflows/socle.yml:76` | |
| `socle/tests/aides/keycloak-jetable.js` | `core/tests/helpers/throwaway-keycloak.js` | `socle/tests/auth.test.js`, `.github/workflows/socle.yml:76` | |
| `socle/tests/aides/postgres-jetable.js` | `core/tests/helpers/throwaway-postgres.js` | `socle/tests/db.test.js` | |
| `socle/tests/aides/serveur.js` | `core/tests/helpers/server.js` | `socle/tests/*.test.js` | |
| `socle/tests/auth-unitaire.test.js` | `core/tests/auth-unit.test.js` | `socle/package.json` (`test`) | |
| `socle/tests/contrat.test.js` | `core/tests/contract.test.js` | `socle/package.json` | |
| `socle/tests/debit.test.js` | `core/tests/rate-limit.test.js` | `socle/package.json` (`test:db`) | follows `rate-limit.js` |
| `socle/tests/exemple/` | `core/tests/example/` | `socle/kit/compose.test.yml` (`OUTIL_DIR`/`OUTIL_RACINE` defaults), `socle/tsconfig.json`, `.github/workflows/socle.yml:93` | |
| `socle/tests/exemple/api/lib/magasin.js` | `core/tests/example/api/lib/store.js` | `socle/tests/exemple/api/getItem.js` | |
| `socle/tests/front-unitaire.test.js` | `core/tests/front-unit.test.js` | `socle/package.json`, `socle/tsconfig.json`, `socle/tsconfig.web.json` | |
| `socle/tests/kit-charge.k6.js` | `core/tests/kit-load.k6.js` | `socle/tests/kit.test.js` | |
| `socle/tests/kit-unitaire.test.js` | `core/tests/kit-unit.test.js` | `socle/package.json` | |
| `socle/tests/rejeu-avis.test.js` | `core/tests/advisory-replay.test.js` | `socle/package.json` | override: "avis de sécurité" = security advisory, not feedback |
| `images/socle/` | `images/core/` | `infra/ansible/group_vars/forge/vars.yml:264` (`src: images/socle`) | Gitea repo source |
| `images/socle/.gitea/workflows/publier.yml` | `images/core/.gitea/workflows/publish.yml` | | |
| `exemples/` | `examples/` | `.github/workflows/exemples-demandes.yml`, `.github/workflows/moteur.yml:11` | L8 |
| `exemples/demandes/` | `examples/requests/` | `orchestrateur/Dockerfile`, `orchestrateur/Dockerfile.dockerignore`, `orchestrateur/tests/mutations/*` | L8 |
| `exemples/demandes/api/lib/demandes.js` | `examples/requests/api/lib/requests.js` | 9 handlers import `./lib/demandes.js` | |
| `exemples/demandes/db/migrations/0001_demandes.sql` | `examples/requests/db/migrations/0001_requests.sql` | `exemples/demandes/tests/db.test.js` (asserts `0001_demandes`) | rewritten in place (L3) |
| `exemples/demandes/tests/acceptation/` | `examples/requests/tests/acceptance/` | `exemples/demandes/playwright.config.js` | same prescribed path as the template's `tests/acceptation/` |
| `exemples/demandes/tests/acceptation/securite/` | `examples/requests/tests/acceptance/security/` | `exemples/demandes/playwright.config.js` | |
| `exemples/demandes/tests/perf/charge.k6.js` | `examples/requests/tests/perf/load.k6.js` | `exemples/demandes/tests/kit.test.js` | same name in the template |
| `infra/ansible/files/outil-socle-essai/` | `infra/ansible/files/trial-core-tool/` | `infra/ansible/verify-deployeur-socle.yml` | package name `outil-socle-essai` → `trial-core-tool` |
| `infra/ansible/files/outil-socle-essai/migrer.js` | `infra/ansible/files/trial-core-tool/migrate.js` | `infra/ansible/verify-deployeur-socle.yml:129` | stands in for `bin/migrate.js` |
| `infra/ansible/files/outil-socle-essai/migrer-ko.js` | `infra/ansible/files/trial-core-tool/migrate-ko.js` | `infra/ansible/verify-deployeur-socle.yml:156` | |
| `infra/ansible/files/outil-socle-essai/purger.js` | `infra/ansible/files/trial-core-tool/purge.js` | `infra/ansible/verify-deployeur-socle.yml:129` | stands in for `bin/purge.js` |

### Package and distribution

| French | English | Where | Notes |
|---|---|---|---|
| `@eupadev/socle` | `@eupadev/core` | `socle/package.json`, `exemples/demandes/package.json`, `template-outil-ia/package.json`, every `pnpm-lock.yaml` that resolves it, `orchestrateur/src/exterieur/forge-gitea.ts:226` | L1; lockfiles regenerated, never edited (template lockfile: `infra/ansible/template-lockfile.yml`) |
| `eupadev-socle` (bin) | `eupadev-core` | `socle/package.json` (`bin`) | |
| `"@eupadev/socle": "file:../../socle"` | `"@eupadev/core": "file:../../core"` | `exemples/demandes/package.json:20` | |
| `test:tout` | `test:all` | `socle/package.json` | npm script |
| `verifier` | `verify` | `exemples/demandes/package.json:13`, `.github/workflows/exemples-demandes.yml:46` | npm script; runs `bin/start.js --verify` |
| `--verifier` | `--verify` | `socle/bin/demarrer.js`, `template-outil-ia/agents/builder.md:31`, `template-outil-ia/README.md:20` | CLI flag of `bin/start.js` |
| `eupadev.socle` | `eupadev.core` | `template-outil-ia/.gitea/image/Dockerfile:46`, `infra/ansible/roles/deployeur/files/deployeur.py:231,239`, `infra/ansible/verify-template.yml:517` | Docker label (fixed decision) |
| `SOCLE_VERSION` | `CORE_VERSION` | `template-outil-ia/.gitea/image/Dockerfile`, `.github/workflows/template-regles.yml:92` | build argument |
| `eupadev-socle` (Gitea owner, `{{ gitea_org }}-socle`) | `eupadev-core` | `infra/ansible/group_vars/forge/vars.yml:52`, `images/socle/.gitea/workflows/publier.yml:49` (`${GITHUB_REPOSITORY%%/*}-socle`) | registry owner; the infra variable `gitea_socle_org` is in the infra section |
| `svc-socle` | `svc-core` | `infra/ansible/group_vars/forge/vars.yml:54,263` | publication account |
| `socle` (Gitea repo) | `core` | `infra/ansible/group_vars/forge/vars.yml:261` | platform repo built from `images/socle` |
| `socle-publication` (token name) | `core-publication` | `infra/ansible/group_vars/forge/vars.yml:263` | |
| `SOCLE_PUBLISH_TOKEN` | `CORE_PUBLISH_TOKEN` | `images/socle/.gitea/workflows/publier.yml:46` | Gitea repo secret |
| `name: Socle` | `name: Core` | `images/socle/.gitea/workflows/publier.yml:10` | workflow name |
| `/socle/$VERSION` | `/core/$VERSION` | `images/socle/.gitea/workflows/publier.yml:52-62` | registry URL paths, follow the package name |
| `/socle@$VERSION` | `/core@$VERSION` | `images/socle/.gitea/workflows/publier.yml:52-62` | registry URL paths, follow the package name |
| `node_modules/@eupadev/socle/bin/…` | `node_modules/@eupadev/core/bin/…` | `template-outil-ia/.gitea/image/Dockerfile:55`, `infra/compose/deployeur/outil-socle.compose.yml:10,53`, `exemples/demandes/package.json:13` | |
| `socle_migrations` | `core_migrations` | `socle/bin/migrer.js:31`, `socle/tests/db.test.js` | node-pg-migrate table of the core's own migrations (tool table `pgmigrations` stays) |
| `outil-socle-essai` (package) | `trial-core-tool` | `infra/ansible/files/outil-socle-essai/package.json` | |
| `pnpm figé` (step name) | `Pinned pnpm` | `.github/workflows/core.yml`, `.github/workflows/examples-requests.yml` | follows the CI row `pnpm figé` |
| `demandes` (package name, test database and role prefix) | `requests` | `examples/requests/package.json`, `examples/requests/tests/stack.js` | database `requests`, roles `requests_owner`, `requests_app`, `requests_purge` |

### Exports

`src/index.js` exports 25 names; 23 are French (only `safeReturnTo` and `safeEqual` are English).

| French | English | Where | Notes |
|---|---|---|---|
| `Probleme` | `Problem` | `socle/src/erreurs.js:14`, 10 handlers of `exemples/demandes/api/`, `template-outil-ia/agents/builder.md` | the one export a tool imports |
| `corpsProbleme` | `problemBody` | `socle/src/erreurs.js:37`, `socle/src/http.js` | |
| `DetailErreur` (typedef) | `ErrorDetail` | `socle/src/erreurs.js:12` | |
| `ErreurContrat` | `ContractError` | `socle/src/contrat.js:24`, `socle/src/index.js:12` | |
| `analyserContrat` | `parseContract` | `socle/src/contrat.js:61` | |
| `lireContrat` | `readContract` | `socle/src/contrat.js:52`, `socle/kit/index.js:9`, `template-outil-ia/scripts/verify.sh:14` | |
| `Contrat` (typedef) | `Contract` | `socle/src/contrat.js:22` | |
| `CHEMINS_RESERVES` | `RESERVED_PATHS` | `socle/src/contrat.js:36` | regex `^/(health|auth/|socle/)` → `^/(health|auth/|core/)` |
| `TYPES_FICHIER` | `DOWNLOAD_TYPES` | `socle/src/contrat.js:38` | override: these are the media types of `/files/` downloads (`TYPES_UPLOAD` stays) |
| `creerServeur` | `createServer` | `socle/src/http.js:99`, `socle/tests/aides/serveur.js` | |
| `EN_TETES` | `SECURITY_HEADERS` | `socle/src/http.js:37`, `socle/src/index.js:13` | override: avoids two different `HEADERS` exports (see kit `ENTETES`) |
| `enTetes` | `securityHeaders` | `socle/src/http.js:52` | same reason |
| `PLAFOND_FICHIER` | `FILE_CAP` | `socle/src/http.js:61` | |
| `signatureConforme` | `signatureMatches` | `socle/src/http.js:72` | override: predicate reads better than "compliant" |
| `dispositionFichier` | `fileDisposition` | `socle/src/http.js:270` | |
| `creerDb` | `createDb` | `socle/src/db.js:21`, `socle/bin/purger.js`, `exemples/demandes/tests/db.test.js` | |
| `configDbDepuisEnv` | `dbConfigFromEnv` | `socle/src/db.js:82`, `socle/bin/migrer.js`, `socle/bin/purger.js` | word order |
| `optionsSsl` | `sslOptions` | `socle/src/db.js:16`, `socle/bin/migrer.js` | |
| `ConfigDb` (typedef) | `DbConfig` | `socle/src/db.js:8` | |
| `creerJournal` | `createLogger` | `socle/src/journal.js:12`, `socle/src/index.js:15` | see `journal.js` |
| `requestIdDepuis` | `requestIdFrom` | `socle/src/journal.js:27` | |
| `creerAuth` | `createAuth` | `socle/src/auth.js:144` | |
| `assemblerAuth` | `assembleAuth` | `socle/src/auth.js:157` | "assembler" is a French verb here |
| `configAuthDepuisEnv` | `authConfigFromEnv` | `socle/src/auth.js:39` | word order |
| `ConfigAuth` (typedef) | `AuthConfig` | `socle/src/auth.js:24` | |
| `rolesDepuisClaims` | `rolesFromClaims` | `socle/src/auth.js:66` | |
| `creerVerificateurLogout` | `createLogoutVerifier` | `socle/src/auth.js:82` | |
| `resoudreActeur` | `resolveActor` | `socle/src/auth.js:116` | |
| `creerSessions` | `createSessions` | `socle/src/sessions.js:50` | |
| `dureesDepuisEnv` | `durationsFromEnv` | `socle/src/sessions.js:23` | |
| `optionsCookie` | `cookieOptions` | `socle/src/sessions.js:39` | |
| `Durees` (typedef) | `Durations` | `socle/src/sessions.js:14` | |
| `SessionLue` (typedef) | `LoadedSession` | `socle/src/sessions.js:15` | |
| `NouvelleSession` (typedef) | `NewSession` | `socle/src/sessions.js:16` | |
| `fetchSansSuivi` | `fetchNoFollow` | `socle/src/protections.js:98`, `socle/src/http.js` (`ctx.fetch`) | override: "sans suivi (de redirection)" = no redirect following |
| `origineRefusee` | `originRefusal` | `socle/src/protections.js:25` | returns the refusing rule or null |
| `creerGardeOrigine` | `createOriginGuard` | `socle/src/protections.js:42` | |
| `EN_TETE_STATIQUE` | `STATIC_HEADER_VALUE` | `socle/src/protections.js:9` | value `eupadev` of `x-requested-with` |
| `RegleCsrf` (typedef) | `CsrfRule` | `socle/src/protections.js:12` | |
| `SEUIL_DEFAUT_PAR_MINUTE` | `DEFAULT_THRESHOLD_PER_MINUTE` | `socle/src/debit.js:7` | |
| `SEUIL_LECTURE_PAR_MINUTE` | `READ_THRESHOLD_PER_MINUTE` | `socle/src/debit.js:8` | |
| `SEUIL_LOGIN_PAR_IP` | `LOGIN_THRESHOLD_PER_IP` | `socle/src/debit.js:10` | |
| `creerLimiteur` | `createLimiter` | `socle/src/debit.js:19` | |
| `nettoyerTexte` | `cleanText` | `socle/src/validation.js:19` | |
| `ajvRequete` | `ajvRequest` | `socle/src/validation.js:33` | |
| `ajvCorps` | `ajvBody` | `socle/src/validation.js:34` | |
| `compiler` | `compile` | `socle/src/validation.js:80` | French verb |
| `construireStatique` | `buildStatic` | `socle/src/statique.js:26` | |
| `ajouterSocle` | `addCore` | `socle/src/statique.js:60` | |
| `servirStatique` | `serveStatic` | `socle/src/statique.js:70` | |
| `chargerHandlers` | `loadHandlers` | `socle/src/index.js:27` | |
| `demarrer` | `start` | `socle/src/index.js:51`, `socle/bin/demarrer.js` | |
| `connexion` (bin/migrer.js) | `connection` | `socle/bin/migrer.js:17` | |
| `migrer` | `migrate` | `socle/bin/migrer.js:25`, `socle/kit/postgres-jetable.js:12` (re-export) | |
| `purger` | `purge` | `socle/bin/purger.js:22` | |
| `navigateur` | `httpBrowser` | `socle/kit/navigateur.js:8`, `socle/kit/index.js:10`, `exemples/demandes/tests/kit.test.js:11` | override: see `navigateur.js` |
| `ENTETES` | `REQUEST_HEADERS` | `socle/kit/entetes.js:5`, `exemples/demandes/tests/acceptation/securite/xss.spec.js:6`, `exemples/demandes/tests/perf/charge.k6.js:6` | override: the headers a client must send (distinct from `SECURITY_HEADERS`) |
| `conforme` | `isCompliant` | `socle/kit/index.js:29` | predicate (`isX`) |
| `exemple` | `example` | `socle/kit/index.js:42` | |
| `exempleConforme` | `compliantExample` | `socle/kit/index.js:75`, `socle/kit/sec.js` | |
| `invalides` | `invalidValues` | `socle/kit/index.js:88`, `socle/kit/sec.js` | |
| `connecter` | `signIn` | `socle/kit/index.js:133`, `exemples/demandes/tests/kit.test.js:11` | |
| `Personne` (typedef) | `Person` | `socle/kit/index.js:123` | |
| `contexteConnecte` | `signedInContext` | `socle/kit/deux-utilisateurs.js:10`, `exemples/demandes/tests/acceptation/steps/fixtures.js:7`, `infra/ansible/files/acceptance-essai/steps/sign-in.js` | |
| `deuxUtilisateurs` | `twoUsers` | `socle/kit/deux-utilisateurs.js:30` | |
| `anonyme` | `anonymous` | `socle/kit/deux-utilisateurs.js:36` | |
| `appelerDepuis` | `callFrom` | `socle/kit/deux-utilisateurs.js:43`, `exemples/demandes/tests/acceptation/steps/fixtures.js`, `infra/ansible/files/acceptance-essai/steps/sign-in.js` | |
| `demarrerPostgres` | `startPostgres` | `socle/kit/postgres-jetable.js:25`, `exemples/demandes/tests/db.test.js:10` | |
| `requete` (kit/postgres-jetable.js) | `query` | `socle/kit/postgres-jetable.js:61`, `exemples/demandes/tests/stack.js:6`, `exemples/demandes/tests/kit.test.js:13` | override: runs one SQL query (dictionary `requete` → request is the HTTP sense) |
| `PostgresJetable` (typedef) | `ThrowawayPostgres` | `socle/kit/postgres-jetable.js:18` | |
| `lireRealm` | `readRealm` | `socle/kit/realm.js:16`, `exemples/demandes/tests/stack.js:7`, `template-outil-ia/.gitea/controles/sec-preview.mjs` | |
| `REALM_TEST` | `TEST_REALM` | `socle/kit/realm.js:7`, `socle/tests/aides/keycloak-jetable.js:10` | |
| `ClientRealm`, `PersonneRealm` (typedefs) | `RealmClient`, `RealmUser` | `socle/kit/realm.js:9-10` | |
| `EN_TETES_ATTENDUS` | `EXPECTED_HEADERS` | `socle/kit/sec.js:15` | |
| `DEBIT_DEFAUT` | `DEFAULT_RATE` | `socle/kit/sec.js:26` | |
| `DEBIT_LECTURE` | `READ_RATE` | `socle/kit/sec.js:27` | |
| `CLES_MASS` | `MASS_KEYS` | `socle/kit/sec.js:29` | |
| `fichierExemple` | `exampleFile` | `socle/kit/sec.js:41`, `exemples/demandes/tests/acceptation/steps/attachments.js:4`, `exemples/demandes/tests/kit.test.js:15` | |
| `appel` (kit/sec.js, tests/aides/serveur.js) | `call` | `socle/kit/sec.js:72`, `socle/tests/aides/serveur.js:84` | |
| `genererCas` | `generateCases` | `socle/kit/sec.js:124`, `exemples/demandes/tests/kit.test.js:15`, `template-outil-ia/.gitea/controles/sec-preview.mjs:7` | |
| `Cas`, `Reponse` (typedefs) | `Case`, `KitResponse` | `socle/kit/sec.js:52-53` | `Response` would shadow the global |
| `Cible` (typedef) | `Target` | `socle/kit/outils.js:15` | |
| `HtmlSur` | `SafeHtml` | `socle/web/render.js:13`, `socle/tests/front-unitaire.test.js` | override: "sûr" = safe (not "sur" = on) |
| `rendre` | `render` | `socle/web/render.js:51`, `socle/tests/exemple/web/app.js` | |
| `remplir` | `fill` | `socle/web/render.js:68`, `exemples/demandes/web/app.js:6` | |
| `cloner` | `clone` | `socle/web/render.js:81`, `exemples/demandes/web/app.js:6` | |
| `lister` | `list` | `socle/web/render.js:99`, `exemples/demandes/web/app.js:6` | |
| `correspondre` | `match` | `socle/web/router.js:12` | |
| `cheminDuFragment` | `fragmentPath` | `socle/web/router.js:30` | word order |
| `creerRouteur` | `createRouter` | `socle/web/router.js:39`, `exemples/demandes/web/app.js:7` | |
| `Vue` (typedef) | `View` | `socle/web/router.js:4` | |
| `echelle` | `scale` | `socle/web/svg-chart.js:18` | |
| `barres` | `barChart` | `socle/web/svg-chart.js:44`, `socle/tests/exemple/web/app.js:8` | override: function draws a bar chart |
| `contraintes` | `constraints` | `socle/web/form.js:18` | |
| `valeurs` | `values` | `socle/web/form.js:58` | |
| `lierFormulaire` | `bindForm` | `socle/web/form.js:90`, `exemples/demandes/web/app.js:5` | |
| `ErreurApi` | `ApiError` | `socle/web/api.js:9`, `socle/tests/front-unitaire.test.js` | |
| `secondesRetryAfter` | `retryAfterSeconds` | `socle/web/api.js:32` | |
| `messageErreur` | `errorMessage` | `socle/web/api.js:175`, `exemples/demandes/web/app.js:4` | |
| `OperationContrat` (typedef) | `ContractOperation` | `socle/web/api.js:7` | |
| `KeycloakJetable` (typedef), `demarrerKeycloak` | `ThrowawayKeycloak`, `startKeycloak` | `socle/tests/aides/keycloak-jetable.js:13-16` | |
| `serveurTest` | `testServer` | `socle/tests/aides/serveur.js:53` | |
| `dbFactice` | `fakeDb` | `socle/tests/aides/serveur.js:12,21` |  |
| `sessionFactice` | `fakeSession` | `socle/tests/aides/serveur.js:12,21` |  |
| `EXEMPLE` | `EXAMPLE` | `socle/tests/aides/serveur.js:6-7`, `socle/tests/aides/postgres-jetable.js:6` | `OUTIL = 'exemple'` → `TOOL = 'example'` (also the test database and role prefix) |
| `ACTEUR` | `ACTOR` | `socle/tests/aides/serveur.js:6-7`, `socle/tests/aides/postgres-jetable.js:6` | `OUTIL = 'exemple'` → `TOOL = 'example'` (also the test database and role prefix) |
| `OUTIL` | `TOOL` | `socle/tests/aides/serveur.js:6-7`, `socle/tests/aides/postgres-jetable.js:6` | `OUTIL = 'exemple'` → `TOOL = 'example'` (also the test database and role prefix) |
| `PIEGES` | `TRAPS` | `socle/tests/exemple/api/lib/magasin.js`, `socle/tests/http.test.js` | see Dictionary requests (`pieges`) |
| `enTeteInterdit` | `forbiddenHeader` | `socle/tests/exemple/api/lib/magasin.js`, `socle/tests/http.test.js` |  |
| `horsContrat` | `outsideContract` | `socle/tests/exemple/api/lib/magasin.js`, `socle/tests/http.test.js` |  |
| `statutNonDeclare` | `undeclaredStatus` | `socle/tests/exemple/api/lib/magasin.js`, `socle/tests/http.test.js` |  |
| `PERIMETRE` | `SCOPE` | `exemples/demandes/api/lib/demandes.js:10` | |
| `perimetre` | `scope` | `exemples/demandes/api/lib/demandes.js:15`, 5 handlers | |
| `refusTransition` | `transitionRefusal` | `exemples/demandes/api/lib/transitions.js:14`, `exemples/demandes/api/updateRequest.js`, `exemples/demandes/tests/unit/transitions.test.js` | |
| `cellule` | `cell` | `exemples/demandes/api/exportRequests.js`, `socle/tests/exemple/api/exportItems.js`, `exemples/demandes/tests/unit/csv.test.js` | |
| `SOCLE` | `CORE` | `exemples/demandes/tests/stack.js:11`, `socle/tests/kit.test.js` | path of the core checkout |
| `COOKIE_SESSION` | `SESSION_COOKIE` | `core/src/sessions.js`, `core/src/protections.js`, `core/src/auth.js` | |
| `COOKIE_TRANSACTION` | `TRANSACTION_COOKIE` | `core/src/auth.js` | |
| `MOTIF_PREMIERE_CONNEXION` | `FIRST_SIGN_IN_REASON` | `core/src/auth.js` | value `première connexion` → `first sign-in`, stored in `actor_identities.reason` |
| `#chargerSocle`, `#conteneurSocle`, `#sortieSocle`, `#archiveSocle` | `#loadCore`, `#coreContainer`, `#coreOutput`, `#coreArchive` | `orchestrateur/src/exterieur/moteur-claude.ts` | engine side of the core store, private methods |

### Identifiers shared across files, option keys and object shapes

| French | English | Where | Notes |
|---|---|---|---|
| `acteurId` | `actorId` | `socle/src/http.js:15` (`Session`), `socle/src/sessions.js`, `exemples/demandes/api/lib/demandes.js:15` | `ctx.session.acteurId` → `ctx.session.actorId`; tool code uses it |
| `fichier: { nom, type, corps }` | `file: { name, type, body }` | `socle/src/http.js:33-34` (`Fichier`, `Handler`), `exemples/demandes/api/downloadAttachment.js`, `exemples/demandes/api/exportRequests.js` | handler result for a `/files/` download; typedef `Fichier` → `FileDownload` (`File` is a global) |
| `{ type, corps }` (upload body) | `{ type, body }` | `socle/src/http.js:25`, `exemples/demandes/api/uploadAttachment.js` | `ctx.body` of an upload operation |
| `corps` | `body` | `socle/kit/sec.js`, `socle/kit/deux-utilisateurs.js:43`, `socle/src/http.js` | everywhere a payload |
| `operations`, `chemins` (`Contrat`) | `operations`, `paths` | `socle/src/contrat.js:22` | |
| `methode`, `chemin`, `reponses`, `types` (`Operation`) | `method`, `path`, `responses`, `types` | `socle/src/contrat.js:11-18`, `socle/src/index.js:57`, `socle/web/api.js` | |
| `contrat`, `journal`, `delais` (`creerServeur` options) | `contract`, `logger`, `timeouts` | `socle/src/http.js:93-97`, `socle/tests/aides/serveur.js` | |
| `origineIdP` | `idpOrigin` | `socle/src/http.js:93`, `socle/kit/sec.js:60`, `orchestrateur/src/statique.ts` | word order |
| `racine`, `verifierSeulement` (`demarrer` options) | `root`, `verifyOnly` | `socle/src/index.js:49`, `socle/bin/demarrer.js` | |
| `niveau` (`creerJournal` option) | `level` | `socle/src/journal.js:10`, `socle/src/index.js:55` | |
| `config`, `db` (`creerAuth`) / `durees` (`ConfigAuth`) | `config`, `db` / `durations` | `socle/src/auth.js:30,142` | |
| `requete`, `sante`, `fermer` (`Db` methods) | `query`, `health`, `close` | `socle/src/db.js:68-72`, `socle/src/http.js:20` | `requete` → `query`: SQL sense |
| `creer`, `lire`, `detruire`, `detruireParSid`, `detruireParActeur` (sessions) | `create`, `read`, `destroy`, `destroyBySid`, `destroyByActor` | `socle/src/sessions.js:58-111`, `socle/src/auth.js`, `socle/tests/sessions.test.js` | |
| `compter(cle, seuil, maintenant)` (limiter) | `count(key, threshold, now)` | `socle/src/debit.js:29`, `socle/src/http.js`, `socle/src/auth.js` | |
| `chemin`, `type`, `etag`, `taille` (`Entree`) | `path`, `type`, `etag`, `size` (`Entry`) | `socle/src/statique.js:18` | |
| `appeler`, `lien`, `contrat`, `deconnecter` (`api` object) | `call`, `link`, `contract`, `signOut` | `socle/web/api.js:153-169`, `exemples/demandes/web/app.js`, `socle/tests/front.test.js` | |
| `delai`, `rediriger` (`api` options) | `timeout`, `redirect` | `socle/web/api.js:6` | |
| `apres`, `etat` (`lierFormulaire` options) | `after`, `state` | `socle/web/form.js:86`, `exemples/demandes/web/app.js` | |
| `cle`, `rendu`, `maj` (`lister` options) | `key`, `render`, `update` | `socle/web/render.js:97`, `exemples/demandes/web/app.js` | |
| `titre`, `categories`, `series[].nom`, `series[].valeurs`, `unite` (`barres` data) | `title`, `categories`, `series[].name`, `series[].values`, `unit` | `socle/web/svg-chart.js:42`, `socle/tests/exemple/web/app.js` | |
| `focus` | `focus` | `socle/web/router.js:37` | unchanged |
| `nom`, `mdp`, `roles` (`Personne`) | `name`, `password`, `roles` | `socle/kit/index.js:123`, `socle/kit/realm.js`, `template-outil-ia/.gitea/controles/realm-personas.mjs:12` | same shape as the `PREVIEW_PERSONAS` JSON (template, `infra/ansible/enregistrer-outils.yml:241`): move together |
| `personnes`, `secret` (`lireRealm` result) | `people`, `secret` | `socle/kit/realm.js:19`, `exemples/demandes/tests/stack.js:13` | |
| `aller`, `cookie`, `cookies`, `poser` (`navigateur`) | `go`, `cookie`, `cookies`, `set` | `socle/kit/navigateur.js:34-41`, `socle/kit/index.js:134` | |
| `status`, `headers`, `url`, `texte` (`Etape`) | `status`, `headers`, `url`, `text` (`Step`) | `socle/kit/navigateur.js:6` | |
| `quoi`, `valeur` (`invalides` items) | `what`, `value` | `socle/kit/index.js:93-94` | |
| `methode`, `chemin`, `query`, `body`, `brut`, `fichier`, `cookie`, `entetes` (`appel` options) | `method`, `path`, `query`, `body`, `raw`, `file`, `cookie`, `headers` | `socle/kit/sec.js:68,168`, `exemples/demandes/tests/kit.test.js:348` | |
| `texte`, `json` (`Reponse`) | `text`, `json` | `socle/kit/sec.js:53` | |
| `contrat`, `base`, `personnes`, `inactiviteMinutes`, `origineIdP`, `reinitialiser`, `echecs` (`genererCas` options) | `contract`, `base`, `people`, `inactivityMinutes`, `idpOrigin`, `reset`, `failures` | `socle/kit/sec.js:55-62`, `exemples/demandes/tests/kit.test.js`, `template-outil-ia/.gitea/controles/sec-preview.mjs:7-20` | |
| `sec`, `nom`, `verifier` (`Cas`) | `sec`, `name`, `verify` | `socle/kit/sec.js:52`, `template-outil-ia/.gitea/controles/sec-preview.mjs` | |
| `contrat`, `rapport`, `entetes`, `dossier`, `script`, `config`, `options` (kit/outils.js `args*`) | `contract`, `report`, `headers`, `dir`, `script`, `config`, `options` | `socle/kit/outils.js:15-60`, `exemples/demandes/tests/kit.test.js` | |
| `outil`, `dossierOutil` (`demarrerPostgres`) | `tool`, `toolDir` | `socle/kit/postgres-jetable.js:21-25`, `socle/bin/migrer.js:23`, `exemples/demandes/tests/db.test.js` | |
| `admin`, `owner`, `app`, `purge`, `conteneur`, `supprimer` (`PostgresJetable`) | same, `container`, `remove` | `socle/kit/postgres-jetable.js:18` | |
| `base`, `emetteur`, `conteneur`, `supprimer` (`KeycloakJetable`) | `base`, `issuer`, `container`, `remove` | `socle/tests/aides/keycloak-jetable.js:13` | |
| `env`, `fichierOutil` (`purger` options) | `env`, `toolFile` | `socle/bin/purger.js:19`, `socle/tests/db.test.js` | |
| `{ socle, outil }` (purge result) | `{ core, tool }` | `socle/bin/purger.js:42`, `exemples/demandes/tests/db.test.js:202` | printed as a JSON line `{"msg":"purge",…}` read by the deployer's purge (`infra/ansible/roles/deployeur/files/deployeur.py:483`, `verify-deployeur-socle.yml`) |
| `auteur`, `gere`, `de`, `vers`, `note` (`refusTransition`) | `author`, `manages`, `from`, `to`, `note` | `exemples/demandes/api/lib/transitions.js:14`, `exemples/demandes/api/updateRequest.js` | |
| `inactiviteMinutes` | `inactivityMinutes` | `socle/kit/sec.js:59`, `exemples/demandes/tests/kit.test.js` | |
| `formulaire`, `origine` (route `config`) | `form`, `origin` | `core/src/http.js`, `core/src/auth.js`, `core/src/protections.js` | |
| `demarrer`, `aller`, `chemin` (`creerRouteur` result) | `start`, `go`, `path` | `core/web/router.js`, `examples/requests/web/app.js` | override: `aller` is to navigate here (Words `aller` → `outbound` is the network sense) |
| `haut`, `pas` (`echelle` result) | `top`, `step` | `core/web/svg-chart.js` | override: `pas` is a step here, not the negation |
| `texte` (`HtmlSur`) | `text` (`SafeHtml`) | `core/web/render.js` | |
| `jeton` (`sessions.creer` result), `prolongee` (`sessions.lire` result), `durees` (property) | `token`, `extended`, `durations` | `core/src/sessions.js` | |
| `erreurs` (`ErreurContrat`) | `errors` (`ContractError`) | `core/src/contract.js` | |
| `requete` (`navigateur` method) | `request` | `core/kit/http-browser.js` | HTTP sense |
| `status`, `json`, `texte` (`appelerDepuis` result) | `status`, `json`, `text` | `core/kit/two-users.js`, `examples/requests/tests/acceptance/steps/fixtures.js`, `infra/ansible/files/acceptance-essai/steps/sign-in.js` | |
| `lignes`, `fermer` (`serveurTest`); `corps`, `texte` (`appel` result); `requetes`, `compteurs`, `sante` (`dbFactice`) | `lines`, `close`; `body`, `text`; `queries`, `counters`, `health` | `core/tests/helpers/server.js` | |
| `temoin.flux`, `fichiers` (example store) | `witness.stream`, `files` | `core/tests/example/api/lib/store.js` | |
| `MiseAJourSocle` fields `de`, `vers`, `verrou` | `from`, `to`, `lockfile` | `orchestrateur/src/exterieur/contrats.ts`, `orchestrateur/src/exterieur/forge-gitea.ts` | `CoreUpdate { from, to, package_json, lockfile }` |

### HTTP routes, query parameters and reserved paths

| French | English | Where | Notes |
|---|---|---|---|
| `/fichiers/` (reserved prefix) | `/files/` | `socle/src/contrat.js:37,75-86`, `socle/src/http.js:169`, `socle/kit/sec.js` | every download operation of every tool |
| `/socle/…` (static core modules) | `/core/…` | `socle/src/statique.js:56-62`, `exemples/demandes/web/app.js:4-7`, `socle/tests/exemple/web/app.js:4-9` | `/socle/api.js`, `form.js`, `render.js`, `router.js`, `svg-chart.js`, `escape-html.js` |
| `/socle/contrat.json` | `/core/contract.json` | `socle/src/http.js`, `socle/web/api.js:92-94`, `socle/tests/front.test.js` | |
| `/socle/vendor/purify.js` | `/core/vendor/purify.js` | `socle/src/statique.js:62`, `socle/tests/exemple/web/app.js:9` | |
| `/api/demandes` | `/api/requests` | `exemples/demandes/openapi.yaml:91`, `exemples/demandes/tests/kit.test.js`, `exemples/demandes/tests/perf/charge.k6.js` | |
| `/api/demandes/{id}` | `/api/requests/{id}` | `exemples/demandes/openapi.yaml:150`, `exemples/demandes/api/createRequest.js:16` (`Location`) | |
| `/api/demandes/{id}/attachment` | `/api/requests/{id}/attachment` | `exemples/demandes/openapi.yaml:216` | |
| `/fichiers/demandes/{id}/attachment` | `/files/requests/{id}/attachment` | `exemples/demandes/openapi.yaml:266` | |
| `/fichiers/demandes.csv` | `/files/requests.csv` | `exemples/demandes/openapi.yaml:285`, `exemples/demandes/api/exportRequests.js` (`demandes.csv` file name) | |
| `/fichiers/items.csv` | `/files/items.csv` | `socle/tests/exemple/openapi.yaml:112,129`, `socle/tests/http.test.js` |  |
| `/fichiers/items/{id}/attachment` | `/files/items/{id}/attachment` | `socle/tests/exemple/openapi.yaml:112,129`, `socle/tests/http.test.js` |  |
| `actives` | `active` | `exemples/demandes/openapi.yaml:30`, `exemples/demandes/api/listCategories.js` | query parameter |
| `statut` | `status` | `exemples/demandes/openapi.yaml:101,297` | query parameter |
| `categorie` | `category` | `exemples/demandes/openapi.yaml:104,300`, `exemples/demandes/tests/acceptation/steps/requests.js` | query parameter |
| `supprimees` | `deleted` | `exemples/demandes/openapi.yaml:113`, `exemples/demandes/api/listRequests.js:21` | query parameter |
| `piege` | `trap` | `socle/tests/exemple/openapi.yaml:137` | query parameter of the core's example contract |
| `/verif` | `/check` | `infra/ansible/files/outil-socle-essai/index.js` | route of the trial core tool, called by `verify-deployeur-socle.yml` |
| `#/nouveau` | `#/new` | `socle/tests/exemple/web/app.js:105`, `socle/tests/front.test.js` | example screen routes |
| `#/riche` | `#/rich` | `socle/tests/exemple/web/app.js:105`, `socle/tests/front.test.js` | example screen routes |
| `/realms/outils/…` | `/realms/tools/…` | `socle/kit/compose.test.yml`, `socle/tests/aides/keycloak-jetable.js`, `socle/tests/auth.test.js` | follows the realm name |
| `nom`, `plafond` (`piege` values) | `name`, `cap` | `core/tests/example/openapi.yaml` | |
| `/docs/contrat/openapi.yaml` (SEC-STATIC probe) | `/docs/contract/openapi.yaml` | `core/kit/sec.js` | |

### Environment variables

| French | English | Where | Notes |
|---|---|---|---|
| `CONTRAT` | `CONTRACT` | `socle/src/index.js:56` | the only French variable read by the core runtime |
| `OUTIL_NOM` | `TOOL_NAME` | `socle/kit/compose.test.yml`, `exemples/demandes/tests/stack.js:26` | kit test stack |
| `OUTIL_DIR` | `TOOL_DIR` | same | |
| `OUTIL_RACINE` | `TOOL_ROOT` | same | |
| `OUTIL_SOCLE` | `TOOL_CORE` | same | path of the core the tool imports |
| `OUTIL_VARS` | `TOOL_VARS` | same | default file `./aucune.vars` → `./none.vars` |
| `SOCLE_SRC` | `CORE_SRC` | `socle/kit/compose.test.yml`, `socle/tests/kit.test.js` | |
| `KIT_GARDER` | `KIT_KEEP` | `exemples/demandes/tests/stack.js:45`, `socle/tests/kit.test.js:53`, `.github/workflows/exemples-demandes.yml:90` | |
| `MAIL_GESTIONNAIRES` | `MAIL_MANAGERS` | `exemples/demandes/api/updateRequest.js`, `exemples/demandes/tests/stack.vars` | tool variable; set per deployment by the platform |
| `DEMANDES_ADMIN_URL` | `REQUESTS_ADMIN_URL` | `exemples/demandes/tests/acceptation/setup.js`, `exemples/demandes/tests/acceptation/steps/fixtures.js` | |
| `RETENTION_ESSAI` | `RETENTION_TRIAL` | `infra/ansible/files/outil-socle-essai/purger.js`, `infra/ansible/verify-deployeur-socle.yml` | follows purge setting `purge.retention_essai` → `purge.retention_trial` |

### Log events, fields and messages

| French | English | Where | Notes |
|---|---|---|---|
| `evenement` (field) | `event` | `socle/src/auth.js:227`, `socle/src/http.js:305`, `socle/src/protections.js:50` | |
| `connexion` (event) | `sign_in` | `socle/src/auth.js:227`, `socle/tests/auth.test.js` | |
| `deconnexion` (event) | `sign_out` | `socle/src/auth.js:239`, `socle/tests/auth.test.js` | |
| `fichier_coupe` (event) | `file_truncated` | `socle/src/http.js:305`, `socle/tests/http.test.js` | |
| `erreur` (field) | `error` | `socle/src/auth.js:212` | |
| `regle` (field) | `rule` | `socle/src/protections.js:50` | |
| `octets` (field) | `bytes` | `socle/src/http.js:305` | |
| `acteur_id` (field) | `actor_id` | `socle/src/auth.js:227,239` | |
| `requête` | `request` | `socle/src/http.js:153`, `socle/tests/http.test.js` | access log message |
| `requête refusée` | `request refused` | `socle/src/http.js:327` | |
| `erreur interne` | `internal error` | `socle/src/http.js:326` | |
| `table des routes` | `route table` | `socle/src/index.js:57` | |
| `arrêt propre` | `clean shutdown` | `socle/src/index.js:77` | |
| `connexion`, `déconnexion` (messages) | `sign-in`, `sign-out` | `socle/src/auth.js:227,239` | |
| `téléchargement coupé` | `download cut` | `socle/src/http.js:305` | |
| `callback OIDC refusé` | `OIDC callback refused` | `socle/src/auth.js:212` | |
| `requête cross-origin refusée` | `cross-origin request refused` | `socle/src/protections.js:50` | |
| `purge de rate_limits échouée` | `rate_limits purge failed` | `socle/src/debit.js:41` | |
| `sans-en-tetes` (CSRF rule value) | `no-headers` | `socle/src/protections.js:12`, `socle/tests/protections.test.js` | logged as `rule` |
| `[masqué]` (redaction) | `[masked]` | `core/src/logger.js` | pino `censor` |
| `publication du socle sans mise à jour` | `core publication without an update` | `orchestrateur/src/workflows/cycleOutil.ts` | error text |

### Error codes and linter refusals

| French | English | Where | Notes |
|---|---|---|---|
| `TRANSITION_INVALIDE` | `INVALID_TRANSITION` | `exemples/demandes/api/lib/transitions.js:15`, `exemples/demandes/api/updateRequest.js:42`, `exemples/demandes/tests/kit.test.js` | the only French error code in the area; the core's 19 codes and `SEC-*` ids are English |

### SQL objects

Core migrations (`socle/migrations/0001-0004`, rewritten in place, L2), `socle/sql/roles.sql`, `socle/tests/exemple`, example `0001_demandes.sql` (L3) and `purge.sql`.

| French | English | Where | Notes |
|---|---|---|---|
| `acteurs` (table) | `actors` | `socle/migrations/0001_socle.sql`, `exemples/demandes/db/migrations/0001_demandes.sql` (FKs), `socle/src/auth.js` | the engine has its own `acteurs` table: same English name (engine section) |
| `acteurs.genre` | `actors.type` | `socle/migrations/0001_socle.sql`, `socle/migrations/0003_audit_cle.sql`, `exemples/demandes/db/migrations/0001_demandes.sql` | same values as `audit_log.actor_type` |
| `acteurs.nom_affiche` | `actors.display_name` | `socle/migrations/0001_socle.sql`, `socle/src/auth.js` | |
| `acteurs.annuaire_id` | `actors.directory_id` | `socle/migrations/0001_socle.sql` | |
| `acteurs.derniere_connexion` | `actors.last_sign_in_at` | `socle/migrations/0001_socle.sql`, `socle/tests/auth.test.js` | override: timestamp, sign-in sense |
| `acteurs.cree_le` | `actors.created_at` | `socle/migrations/0001_socle.sql` | |
| `acteurs_identites` (table) | `actor_identities` | `socle/migrations/0001_socle.sql`, `socle/src/auth.js` | |
| `acteurs_identites.emetteur` | `actor_identities.issuer` | `socle/migrations/0001_socle.sql` | |
| `acteurs_identites.sujet` | `actor_identities.subject` | same | |
| `acteurs_identites.acteur_id`, `sessions.acteur_id` | `actor_id` | same | |
| `acteurs_identites.depuis` | `actor_identities.since` | same | |
| `acteurs_identites.motif` | `actor_identities.reason` | same | |
| `humain` (value of `genre`, `actor_type`) | `human` | `socle/migrations/0001_socle.sql`, `exemples/demandes/db/migrations/0001_demandes.sql`, `socle/src/auth.js` | stored value |
| `refuser_modification()` | `refuse_modification()` | `socle/migrations/0001_socle.sql`, `exemples/demandes/db/migrations/0001_demandes.sql` | |
| `acteur_courant()` | `current_actor()` | `socle/migrations/0001_socle.sql`, `0003`, `0004`, `exemples/demandes/db/migrations/0001_demandes.sql` | |
| `audit_log_proteger()` | `audit_log_protect()` | `socle/migrations/0001_socle.sql` | |
| `acteurs_proteger()` | `actors_protect()` | `socle/migrations/0001_socle.sql` | |
| `acteurs_protection` (trigger) | `actors_protection` | same | |
| `acteurs_sans_truncate` | `actors_no_truncate` | same | |
| `acteurs_identites_ajout_seul` | `actor_identities_append_only` | same | |
| `acteurs_identites_sans_truncate` | `actor_identities_no_truncate` | same | |
| `audit_log_sans_truncate` | `audit_log_no_truncate` | same | |
| `acteurs_identites_acteur` (index) | `actor_identities_actor` | same | |
| `sessions_acteur` (index) | `sessions_actor` | same | |
| `audit_log_ligne` (constraint) | `audit_log_row` | `socle/migrations/0003_audit_cle.sql` | |
| `socle_app` (PG role) | `core_app` | `socle/sql/roles.sql`, `socle/migrations/0001_socle.sql`, `exemples/demandes/db/migrations/0001_demandes.sql:137`, `exemples/demandes/tests/kit.test.js:331` | fixed decision; infra `postgres_outils` creates them too |
| `socle_purge` (PG role) | `core_purge` | `socle/sql/roles.sql`, `socle/migrations/0001_socle.sql`, `socle/migrations/0004_audit_purge.sql` | |
| `socle.audit_retention` (setting) | `core.audit_retention` | `socle/migrations/0001_socle.sql`, `socle/bin/purger.js:25,38`, `socle/tests/db.test.js:163` | custom GUC |
| `outil`, `mdp_owner`, `mdp_app`, `mdp_purge` (psql variables) | `tool`, `owner_password`, `app_password`, `purge_password` | `socle/sql/roles.sql`, `socle/kit/postgres-jetable.js:51`, `socle/kit/compose.test.yml`, `template-outil-ia/.gitea/controles/boot-check.sh:42-53` | infra roles that run `roles.sql` pass them too |
| `exemple` (test database, `exemple_app`/`_owner`/`_purge` roles) | `example` (`example_app`/`_owner`/`_purge`) | `socle/tests/aides/postgres-jetable.js:6`, `socle/kit/compose.test.yml`, `socle/tests/db.test.js` | |
| `brouillon`, `soumise`, `en_cours`, `resolue`, `rejetee`, `annulee` (`requests.status`, `request_history.from_status/to_status`) | `draft`, `submitted`, `in_progress`, `resolved`, `rejected`, `cancelled` | `exemples/demandes/db/migrations/0001_demandes.sql`, `exemples/demandes/db/purge.sql`, `exemples/demandes/openapi.yaml:364`, `exemples/demandes/web/app.js`, `exemples/demandes/api/lib/*.js` | stored values, enum and screen mapping move together |
| `basse`, `normale`, `haute` (`requests.urgency`) | `low`, `normal`, `high` | same, `exemples/demandes/openapi.yaml:367` | |
| `request_history_par_trigger()` | `request_history_by_trigger()` | `exemples/demandes/db/migrations/0001_demandes.sql` | |
| `request_history_ajout_seul` | `request_history_append_only` | same | |
| `request_history_sans_truncate` | `request_history_no_truncate` | same | |
| `app.essai` (table), `cree` (column) | `app.trial`, `created` | `infra/ansible/files/outil-socle-essai/index.js`, `infra/ansible/files/outil-socle-essai/purger.js`, `infra/ansible/verify-deployeur-socle.yml` | trial core tool |

### Test realm and fixtures

`socle/tests/keycloak/realm-test.json` feeds the lab realm (`verify-keycloak.yml` compares it): every row below moves with
the infra Keycloak names.

| French | English | Where | Notes |
|---|---|---|---|
| `outils` (realm) | `tools` | `socle/tests/keycloak/realm-test.json`, `socle/kit/compose.test.yml` (`OIDC_ISSUER`), `socle/tests/auth.test.js` | same as the lab realm |
| `outil-essai` (client) | `trial-tool` | `socle/tests/keycloak/realm-test.json`, `socle/kit/realm.js:20-25`, `socle/kit/compose.test.yml`, `template-outil-ia/.gitea/controles/realm-personas.mjs:10-11` | |
| `lecteur` (client role) | `reader` | realm, `exemples/demandes/openapi.yaml` (`x-roles`), `socle/tests/exemple/openapi.yaml`, `exemples/demandes/tests/acceptation/features/*.feature` (persona word) | L5 |
| `gestionnaire` (client role) | `manager` | same, `exemples/demandes/api/lib/demandes.js:15` | L5 |
| `outil-essai-lecteurs`, `outil-essai-gestionnaires`, `outil-essai-admins` (groups) | `trial-tool-readers`, `trial-tool-managers`, `trial-tool-admins` | `socle/tests/keycloak/realm-test.json` | |
| `Lecteur`, `Gestionnaire` (last names of alice, bruno) | `Reader`, `Manager` | realm, `exemples/demandes/tests/acceptation/features/create-and-submit.feature` (`"Alice Lecteur"`) | |
| `Chloé` (first name) | `Chloe` | `socle/tests/keycloak/realm-test.json` | see Open questions |
| `roles-du-client-dans-l-id-token` (mapper) | `client-roles-in-id-token` | `socle/tests/keycloak/realm-test.json` | |
| `ci-seulement-*` (test passwords and client secret) | `ci-only-*` (`ci-only-not-a-real-secret`) | `socle/tests/keycloak/realm-test.json` | test credentials, never real |
| `@exemple.test` | `@example.test` | realm, `socle/kit/compose.test.yml` (`MAIL_FROM`), `exemples/demandes/tests/stack.vars` | test domain everywhere (shared with the engine and infra fixtures) |
| `exemple.test` | `example.test` | realm, `socle/kit/compose.test.yml` (`MAIL_FROM`), `exemples/demandes/tests/stack.vars` | test domain everywhere (shared with the engine and infra fixtures) |
| `outil.test` | `tool.test` | `socle/tests/aides/serveur.js:9`, `socle/tests/protections.test.js`, `socle/tests/contrat.test.js` |  |
| `outil.exemple` | `tool.example` | `socle/tests/aides/serveur.js:9`, `socle/tests/protections.test.js`, `socle/tests/contrat.test.js` |  |
| `electricite` | `electricity` | `exemples/demandes/tests/kit.test.js`, `exemples/demandes/tests/db.test.js`, `exemples/demandes/openapi.yaml` | category fixtures; features already use `Locksmith`, `Plumbing` |
| `Électricité` | `Electricity` | `exemples/demandes/tests/kit.test.js`, `exemples/demandes/tests/db.test.js`, `exemples/demandes/openapi.yaml` | category fixtures; features already use `Locksmith`, `Plumbing` |
| `serrurerie` | `locksmith` | `exemples/demandes/tests/kit.test.js`, `exemples/demandes/tests/db.test.js`, `exemples/demandes/openapi.yaml` | category fixtures; features already use `Locksmith`, `Plumbing` |
| `plomberie` | `plumbing` | `exemples/demandes/tests/kit.test.js`, `exemples/demandes/tests/db.test.js`, `exemples/demandes/openapi.yaml` | category fixtures; features already use `Locksmith`, `Plumbing` |
| `Plomberie` | `Plumbing` | `exemples/demandes/tests/kit.test.js`, `exemples/demandes/tests/db.test.js`, `exemples/demandes/openapi.yaml` | category fixtures; features already use `Locksmith`, `Plumbing` |
| `Vis` | `Screw` | `socle/tests/front.test.js`, `socle/tests/http.test.js` | data fixtures |
| `Écrou` | `Nut` | `socle/tests/front.test.js`, `socle/tests/http.test.js` | data fixtures |
| `Riche` | `Rich` | `socle/tests/front.test.js`, `socle/tests/http.test.js` | data fixtures |
| `pas-un-nombre` | `not-a-number` | `socle/kit/index.js:92-100` | values the kit sends; asserted by `socle/tests/kit-unitaire.test.js` |
| `pas-un-booleen` | `not-a-boolean` | `socle/kit/index.js:92-100` | values the kit sends; asserted by `socle/tests/kit-unitaire.test.js` |
| `pas-un-objet` | `not-an-object` | `socle/kit/index.js:92-100` | values the kit sends; asserted by `socle/tests/kit-unitaire.test.js` |
| `pas-un-tableau` | `not-an-array` | `socle/kit/index.js:92-100` | values the kit sends; asserted by `socle/tests/kit-unitaire.test.js` |
| `hors-enum-kit` | `outside-enum-kit` | `socle/kit/index.js:92-100` | values the kit sends; asserted by `socle/tests/kit-unitaire.test.js` |
| `pas-au-format-kit` | `not-kit-format` | `socle/kit/index.js:92-100` | values the kit sends; asserted by `socle/tests/kit-unitaire.test.js` |
| `/api/kit-route-inexistante` | `/api/kit-nonexistent-route` | `socle/kit/sec.js` |  |
| `/kit-chemin-inexistant` | `/kit-nonexistent-path` | `socle/kit/sec.js` |  |
| `migrer`, `outil-1`, `outil-2` (Compose services), `x-outil` | `migrate`, `tool-1`, `tool-2`, `x-tool` | `socle/kit/compose.test.yml`, `socle/tests/kit.test.js`, `exemples/demandes/tests/kit.test.js` | test stack project `eupadev-kit` unchanged |
| `/socle`, `/outil` (container mounts) | `/core`, `/tool` | `socle/kit/compose.test.yml`, `exemples/demandes/tests/stack.js:26`, `.github/workflows/template-regles.yml:90` | |
| `/contrat/…`, `/zap/contrat` (container mounts) | `/contract/…`, `/zap/contract` | `socle/kit/outils.js:29-46` | |
| `aucune.vars` | `none.vars` | `socle/kit/compose.test.yml` | default of `TOOL_VARS` |
| `lignes`, `autre`, `essai` (JSON keys of the trial tool) | `rows`, `other`, `trial` | `infra/ansible/files/outil-socle-essai/index.js`, `infra/ansible/files/outil-socle-essai/purger.js` | read by `verify-deployeur-socle.yml` |
| `personnes` (k6 scenario) | `people` | `core/tests/kit-load.k6.js`, `examples/requests/tests/perf/load.k6.js` | |
| `fuite été.png` | `leak – hall.png` | `examples/requests/tests/kit.test.js` | non-ASCII file-name fixture, kept non-ASCII (en dash) |
| `default-roles-outils` | `default-roles-tools` | `infra/ansible` verify playbooks | Keycloak's default role of realm `tools` |
| `outil:essai` (image tag) | `tool:trial` | `.github/workflows/template-regles.yml` | |

### Web: attributes, classes, ids and i18n strings

| French | English | Where | Notes |
|---|---|---|---|
| `data-champ` | `data-field` | `socle/web/render.js`, `exemples/demandes/web/index.html` (43), `socle/tests/exemple/web/index.html` | |
| `data-cle` | `data-key` | `socle/web/render.js`, `exemples/demandes/web/app.js`, `socle/tests/exemple/web/app.js` | |
| `data-etat` | `data-state` | `socle/web/form.js`, `exemples/demandes/web/index.html`, `exemples/demandes/web/styles/app.css` | |
| `data-lien` | `data-link` | `exemples/demandes/web/index.html`, `socle/tests/exemple/web/index.html` | |
| `en-cours`, `succes`, `erreur` (`data-etat` values) | `in-progress`, `success`, `error` | `socle/web/form.js:112-131`, `exemples/demandes/web/styles/app.css` | |
| `.etat` | `.state` | `exemples/demandes/web/styles/app.css`, `socle/tests/exemple/web/style.css` |  |
| `.statut` | `.status` | `exemples/demandes/web/styles/app.css`, `socle/tests/exemple/web/style.css` |  |
| `.champ` | `.field` | `exemples/demandes/web/styles/app.css`, `socle/tests/exemple/web/style.css` |  |
| `graphique-${}`, `graphique-donnees`, `graphique-puce` (classes and ids) | `chart-${}`, `chart-data`, `chart-bullet` | `socle/web/svg-chart.js`, `socle/tests/exemple/web/style.css` | |
| `${}-titre` (svg-chart ids) | `${}-title` | `socle/web/svg-chart.js:53` | |
| `#attachment-etat` | `#attachment-state` | `exemples/demandes/web/index.html`, `exemples/demandes/web/app.js`, `exemples/demandes/tests/acceptation/steps/attachments.js` |  |
| `#categories-etat` | `#categories-state` | `exemples/demandes/web/index.html`, `exemples/demandes/web/app.js`, `exemples/demandes/tests/acceptation/steps/attachments.js` |  |
| `#detail-etat` | `#detail-state` | `exemples/demandes/web/index.html`, `exemples/demandes/web/app.js`, `exemples/demandes/tests/acceptation/steps/attachments.js` |  |
| `#assaini` | `#sanitized` | `socle/tests/exemple/web/index.html`, `socle/tests/front.test.js` |  |
| `#echappe` | `#escaped` | `socle/tests/exemple/web/index.html`, `socle/tests/front.test.js` |  |
| `#graphique` | `#chart` | `socle/tests/exemple/web/index.html`, `socle/tests/front.test.js` |  |
| `#vide` | `#empty` | `socle/tests/exemple/web/index.html`, `socle/tests/front.test.js` |  |
| `tpl-introuvable` | `tpl-not-found` | `socle/tests/exemple/web/index.html`, `socle/tests/exemple/web/app.js` |  |
| `tpl-liste` | `tpl-list` | `socle/tests/exemple/web/index.html`, `socle/tests/exemple/web/app.js` |  |
| `tpl-nouveau` | `tpl-new` | `socle/tests/exemple/web/index.html`, `socle/tests/exemple/web/app.js` |  |
| `tpl-riche` | `tpl-rich` | `socle/tests/exemple/web/index.html`, `socle/tests/exemple/web/app.js` |  |
| `Erreur HTTP ${status}` | `HTTP error ${status}` | `socle/web/api.js:21` | i18n |
| `Trop de demandes. Réessayez dans ${n} s.` | `Too many requests. Try again in ${n} s.` | `socle/web/api.js:176` | i18n |
| `${detail} (réf. ${id})` | `${detail} (ref. ${id})` | `socle/web/api.js:177` | i18n |
| `Le serveur ne répond pas. Réessayez.` | `The server is not responding. Try again.` | `socle/web/api.js:178` | i18n |
| `Erreur réseau. Réessayez.` | `Network error. Try again.` | `socle/web/api.js:179` | i18n |
| `Envoi en cours…` | `Sending…` | `socle/web/form.js:119` | i18n |
| `Enregistré.` | `Saved.` | `socle/web/form.js:123` | i18n |
| `Diagramme en barres, ${n} série(s) sur ${m} catégorie(s) ; les valeurs sont dans le tableau qui suit.` | `Bar chart, ${n} series over ${m} categories; the values are in the table that follows.` | `socle/web/svg-chart.js:55` | i18n |
| `Série` | `Series` | `socle/web/svg-chart.js:77` | i18n |
| `Items par statut` | `Items by status` | `socle/tests/exemple/web/app.js:86-96` | example screen of the core's tests: i18n or plain English (see Open questions) |
| `Ouverts` | `Open` | `socle/tests/exemple/web/app.js:86-96` | example screen of the core's tests: i18n or plain English (see Open questions) |
| `Fermés` | `Closed` | `socle/tests/exemple/web/app.js:86-96` | example screen of the core's tests: i18n or plain English (see Open questions) |
| `(aucune note)` | `(no note)` | `socle/tests/exemple/web/app.js:86-96` | example screen of the core's tests: i18n or plain English (see Open questions) |
| `Erreur HTTP ${status}` … `Série` (the 9 strings above) | keys `api.httpError`, `api.tooManyRequests`, `api.withReference`, `api.noResponse`, `api.networkError`, `form.sending`, `form.saved`, `chart.description`, `chart.series` | `core/web/lang/en.json`, `core/web/lang/fr.json`, `core/web/i18n.js` (`t`) | L10: language of the page (`lang`), then English |

The example tool's screens (`exemples/demandes/web/`) already show English only; developer error messages of
`socle/web/*.js` (`api.js:50,104,107`, `form.js:93`, `render.js:56,83,87`) are English messages, not i18n.

### Gherkin and test vocabulary (example tool)

| French | English | Where | Notes |
|---|---|---|---|
| `lecteur`, `gestionnaire` (persona word in steps) | `reader`, `manager` | `exemples/demandes/tests/acceptation/features/*.feature` (e.g. `create-and-submit.feature:6`), `exemples/demandes/tests/acceptation/steps/fixtures.js` | `{word}` resolves a person by role: features, steps and realm roles move together |
| `soumise`, `en_cours`, `resolue` (stored statuses set by Given steps) | `submitted`, `in_progress`, `resolved` | `exemples/demandes/tests/acceptation/steps/requests.js` | |
| `"Alice Lecteur"` | `"Alice Reader"` | `exemples/demandes/tests/acceptation/features/create-and-submit.feature`, `delete-and-restore.feature` | display name from the realm |

### Rules (no row per instance)

- Local variables, parameters and PL/pgSQL locals (`acteur`, `requete`, `genre`, `ligne`, `colonnes`, `cle`, `type_cle`,
  `valeur`, `de`…; about 160 one-file names in `socle/` and 28 in `exemples/demandes/`): renamed by Words.
- Test titles and assertion messages (`socle/tests/*.test.js`, `exemples/demandes/tests/**`): translated as prose.
- Imports and relative paths (`./aides/serveur.js`, `@eupadev/socle/kit/…`, 31 import paths): follow the Paths and
  Package rows.
- RAISE messages (`socle/migrations/*`, `0001_demandes.sql`): English prose; the error codes (`ERRCODE`) and constraint
  names stay as listed. Tests assert some of them by regex (`socle/tests/db.test.js:163` `/socle\.audit_retention absent/`):
  update the assertion with the message.
- The 48 contract-linter refusals of `socle/src/contrat.js` (`refuser(…)`) and every `bin/*.js` message: English prose.
- Comments, JSDoc, `socle/README.md` (French copy to `docs/fr/`), `exemples/demandes/README.md`, `docs/spec.md`,
  `docs/DECISIONS.md` (mostly French): prose.
- Migration file names are stored in `socle_migrations` / `pgmigrations`: renamed in place only because every database
  carrying them is rebuilt (L2, L3).

## Tool template and agent image

Scope: `template-outil-ia/` (→ `tool-template/`), `images/agent/`, `tests/opengrep/`. Names owned by the core
(`@eupadev/socle`, kit and `web/` exports, `sql/roles.sql` variables, `bin/*.js`) and by the engine (`/tmp/tache/…`
container protocol, `FA_*` variables) are listed here only where this area uses them; the owning section decides and
this table must agree with it.

### Paths

| French | English | Where | Notes |
|---|---|---|---|
| `template-outil-ia/` | `tool-template/` | `orchestrateur/src/exterieur/forge-gitea.ts:113`, `infra/ansible/group_vars/forge/vars.yml:207`, `.github/workflows/template-regles.yml:14` | L8; also the Gitea repo name |
| `template-outil-ia/.claude/rules/qualite.md` | `tool-template/.claude/rules/quality.md` | `orchestrateur/src/moteur/consignes.ts:25`, `template-outil-ia/agents/quality-reviewer.md:19`, `template-outil-ia/.claude/agents/quality-reviewer.md:3` | file name is also an enum prefix of `report.schema.json` (see Wire formats) |
| `template-outil-ia/.claude/rules/securite.md` | `tool-template/.claude/rules/security.md` | `orchestrateur/src/moteur/consignes.ts:23`, `template-outil-ia/agents/security-reviewer.md:21`, `template-outil-ia/.claude/agents/security-reviewer.md:3` | same |
| `template-outil-ia/docs/fr/rules/qualite.md` | `tool-template/docs/fr/rules/quality.md` | `ROADMAP.md:380` | French copy mirrors the English file name (template convention) |
| `template-outil-ia/docs/fr/rules/securite.md` | `tool-template/docs/fr/rules/security.md` | `ROADMAP.md:380` | same |
| `template-outil-ia/.gitea/controles/` | `tool-template/.gitea/checks/` | `template-outil-ia/.gitea/workflows/controle.yml:125`, `template-outil-ia/scripts/verify.sh:31`, `orchestrateur/tests/image-fixe.test.ts:60` | protected directory |
| `template-outil-ia/.gitea/controles/garde-fous.sh` | `tool-template/.gitea/checks/guard-rails.sh` | `renovate.json:89,173,176`, `infra/ansible/verify-template.yml:186`, `orchestrateur/tests/mutations/mutations.ts:972` | Renovate `fileMatch` regex and `PNPM_VERSION=` manager must move with it |
| `template-outil-ia/.gitea/controles/paquet.mjs` | `tool-template/.gitea/checks/package.mjs` | `template-outil-ia/.gitea/controles/garde-fous.sh:280`, `orchestrateur/tests/image-fixe.test.ts:12,60`, `orchestrateur/tests/mutations/mutations.ts:966` | |
| `template-outil-ia/.gitea/workflows/controle.yml` | `tool-template/.gitea/workflows/check.yml` | `orchestrateur/src/exterieur/forge-gitea.ts:75` (`WORKFLOW_CI`), `infra/ansible/verify-moteur-ci.yml:217`, `orchestrateur/tests/forge-gitea.test.ts:62` | the engine lists its runs by this file name |
| `template-outil-ia/.gitea/workflows/controle-preview.yml` | `tool-template/.gitea/workflows/preview-check.yml` | `orchestrateur/src/exterieur/forge-gitea.ts:77` (`WORKFLOW_PREVIEW`), `infra/ansible/verify-moteur-preview.yml:14`, `orchestrateur/scripts/essai-preview.ts:2` | word order; the engine dispatches it by file name |
| `template-outil-ia/.opengrep/regles-depart.yml` | `tool-template/.opengrep/starter-rules.yml` | `.github/workflows/template-regles.yml:43` | |
| `template-outil-ia/scripts/generer-catalogue-rapport.js` | `tool-template/scripts/generate-report-catalogue.js` | `template-outil-ia/tests/unit/report-schema.test.js:4`, `template-outil-ia/agents/report.schema.json` (description) | the file name is written into both schema copies |
| `template-outil-ia/tests/perf/charge.k6.js` | `tool-template/tests/perf/load.k6.js` | `template-outil-ia/.gitea/workflows/controle-preview.yml:6,50,57,62` | also `/scripts/charge.k6.js` inside the k6 container → `/scripts/load.k6.js` |
| `tests/acceptation/` (prescribed in every tool) | `tests/acceptance/` | `orchestrateur/src/exterieur/contrats.ts:20,26,41`, `template-outil-ia/.gitea/controles/acceptance.sh:25`, `template-outil-ia/AGENTS.md:12` | role path of `tests`; protected at push; also `tests/acceptation/features/`, `tests/acceptation/playwright.config.js` |
| `tests/opengrep/regles-depart.js` | `tests/opengrep/starter-rules.js` | `.github/workflows/template-regles.yml:43` | |
| `images/agent/controle/` | `images/agent/check/` | `orchestrateur/scripts/generer-controle-claude.ts:13`, `images/agent/.gitea/workflows/publier.yml:102`, `orchestrateur/tests/claude-sortie.test.ts:110` | generated content (see Rules) |
| `images/agent/controle/essai-amont/` | `images/agent/check/upstream-trial/` | `images/agent/.gitea/workflows/publier.yml:118` | "essai au faux amont" = fake-upstream trial |
| `images/agent/controle/essai-amont/amont.js` | `images/agent/check/upstream-trial/upstream.js` | `images/agent/controle/essai-amont/lancer.sh:25` | |
| `images/agent/controle/essai-amont/essai.sh` | `images/agent/check/upstream-trial/trial.sh` | `images/agent/controle/essai-amont/lancer.sh:34` | |
| `images/agent/controle/essai-amont/lancer.sh` | `images/agent/check/upstream-trial/launch.sh` | `images/agent/.gitea/workflows/publier.yml:118` | |
| `images/agent/controle/essai-amont/verifier.mjs` | `images/agent/check/upstream-trial/verify.mjs` | `images/agent/controle/essai-amont/lancer.sh:38` | |
| `images/agent/.gitea/workflows/publier.yml` | `images/agent/.gitea/workflows/publish.yml` | Gitea repo `agent` | same rename in every `images/*/.gitea/workflows/` (infra section) |
| `/tmp/tache/` | `/tmp/task/` | `orchestrateur/src/exterieur/moteur-claude.ts:65,82-102`, `images/agent/managed-settings.json:8` (`Read(//tmp/tache/**)`), `template-outil-ia/AGENTS.md:44` | agent-container input dir; engine-owned, generated into managed settings |
| `/tmp/tache/consignes.md` | `/tmp/task/instructions.md` | `orchestrateur/src/exterieur/moteur-claude.ts:87,669`, `images/agent/controle/claude.sh:10` | |
| `/tmp/tache/tache.md` | `/tmp/task/task.md` | `orchestrateur/src/exterieur/moteur-claude.ts:65,667`, `images/agent/controle/essai-amont/amont.js:22` | |
| `/tmp/tache/entree.bundle` | `/tmp/task/input.bundle` | `orchestrateur/src/exterieur/moteur-claude.ts:95,634,669` | override: "entrée" of a task = input (see Dictionary requests) |
| `/tmp/tache/suite/` | `/tmp/task/suite/` | `orchestrateur/src/exterieur/moteur-claude.ts:650,807`, `template-outil-ia/agents/builder.md:9-11` | only the parent dir changes |
| `/tmp/tache/exemple/` | `/tmp/task/example/` | `orchestrateur/src/exterieur/moteur-claude.ts:241,669`, `template-outil-ia/AGENTS.md:44`, `template-outil-ia/agents/tests.md:9` | |
| `/tmp/sortie/` | `/tmp/output/` | `orchestrateur/src/exterieur/moteur-claude.ts:99-112`, `images/agent/controle/claude.sh:9` | agent-container output dir |
| `/tmp/sortie/resultat.json` | `/tmp/output/result.json` | `orchestrateur/src/exterieur/moteur-claude.ts:105,110`, `images/agent/controle/claude.sh:16` | |
| `/tmp/sortie/erreurs.txt` | `/tmp/output/errors.txt` | `orchestrateur/src/exterieur/moteur-claude.ts:105,111`, `images/agent/controle/claude.sh:16` | |
| `/tmp/sortie/sortie.bundle` | `/tmp/output/output.bundle` | `orchestrateur/src/exterieur/moteur-claude.ts:99-100,738` | |
| `$HOME/depot` (agent container) | `$HOME/repo` | `orchestrateur/src/exterieur/moteur-claude.ts:95,99`, `images/agent/controle/claude.sh:11`, `images/agent/controle/essai-amont/amont.js:13` | `/home/agent/depot` |
| `$HOME/travail` (agent container) | `$HOME/work` | `orchestrateur/src/exterieur/moteur-claude.ts:97`, `images/agent/controle/essai-amont/essai.sh:56` | working dir of read-only roles; `/home/agent/travail/x.txt` → `/home/agent/work/x.txt` |
| `/verif` (agent image build stage) | `/check` | `images/agent/Dockerfile:38-40,74` | also `GNUPGHOME=/verif/gnupg` → `/check/gnupg`, `/verif/claude` → `/check/claude` |
| `/tmp/essai` | `/tmp/trial` | `images/agent/controle/essai-amont/lancer.sh:34`, `images/agent/controle/essai-amont/essai.sh:13` | trial inputs inside the agent container |
| `/tmp/essai-amont` | `/tmp/upstream-trial` | `images/agent/controle/essai-amont/lancer.sh:13`, `images/agent/controle/essai-amont/verifier.mjs:7`, `images/agent/.gitea/workflows/publier.yml:118` (`$RUNNER_TEMP/essai-amont`) | default output dir |
| `/tmp/essai-pnpm` | `/tmp/pnpm-trial` | `images/agent/controle/essai-amont/essai.sh:43` | |
| `/tmp/amont/journal.jsonl` | `/tmp/upstream/log.jsonl` | `images/agent/controle/essai-amont/amont.js:11-12`, `images/agent/controle/essai-amont/lancer.sh:36` | |
| `journal-<rôle>.jsonl` | `log-<role>.jsonl` | `images/agent/controle/essai-amont/lancer.sh:36`, `images/agent/controle/essai-amont/verifier.mjs:15` | trial output file; `agent-<role>.log` unchanged |
| `/app/ecriture-essai` | `/app/write-trial` | `template-outil-ia/.gitea/workflows/controle.yml:200` | probe file of the read-only check |

### CI workflows of the template and of the agent image

| French | English | Where | Notes |
|---|---|---|---|
| `Contrôle` (workflow `name:`) | `Check` | `template-outil-ia/.gitea/workflows/controle.yml:30` | |
| `Contrôle Preview` (workflow `name:`) | `Preview check` | `template-outil-ia/.gitea/workflows/controle-preview.yml:31` | |
| `analyse` (job id) | `analysis` | `template-outil-ia/.gitea/workflows/controle.yml:84`, `orchestrateur/src/workflows/cycleOutil.ts:991-1000` (`ci:<job>`) | job ids are the stored check names: the engine writes `ci:analysis` rule ids into `ecarts`; Q5 (step 3): the engine reads the SARIF details of this job (`SARIF_CHECK`, `src/durcissement/stagnation.ts`), not of a job named `opengrep` |
| `Empreinte :`, `Construction :`, `Exceptions Trivy datées transmises` (log lines of `controle.yml`) | `Digest:`, `Build:`, `Dated Trivy exceptions passed on` | `template-outil-ia/.gitea/workflows/controle.yml:153,189,229`, `infra/ansible/verify-template.yml:160,390-396` | matched by the lab test: same change set (added in step 3) |
| `Registre des exceptions :`, `ce commit de main`, `main de la forge` (output of `garde-fous.sh`) | `Exceptions registry:`, `this commit of main`, `the forge's main` | `template-outil-ia/.gitea/controles/garde-fous.sh:79-96`, `infra/ansible/verify-template.yml:187-191,780-782,1204-1206` | every message of `guard-rails.sh` matched by the lab test moves with it (added in step 3) |
| `garde-fous` (job id) | `guard-rails` | `template-outil-ia/.gitea/workflows/controle.yml:107`, `infra/ansible/verify-template.yml` (14 × `pipeline_jobs['garde-fous']`), `orchestrateur/tests/forge-gitea.test.ts:708` | stored as `ci:garde-fous` |
| `publier` (job id, agent image) | `publish` | `images/agent/.gitea/workflows/publier.yml:21` | same job id in `images/*/.gitea/workflows/publier.yml` (infra section) |
| `Image des agents` (workflow `name:`) | `Agent image` | `images/agent/.gitea/workflows/publier.yml:11` | |
| `SANS_CACHE` | `NO_CACHE` | `template-outil-ia/.gitea/workflows/controle.yml:151-153,166` | shell variable |
| `EMPREINTE` | `DIGEST` | `template-outil-ia/.gitea/workflows/controle.yml:228-230,256` | written to `GITHUB_ENV`, read by the signing step |
| `HOTE` | `HOST` | `template-outil-ia/.gitea/workflows/controle-preview.yml:53,71,95`, `template-outil-ia/.gitea/controles/acceptance.sh:26` | |
| `verif/<repo>:<sha>` (local image name) | `check/<repo>:<sha>` | `template-outil-ia/.gitea/workflows/controle.yml:133` (`IMAGE: verif/…`) | never pushed |
| `COSIGN_OUTILS_PRIVATE_KEY` | `COSIGN_TOOLS_PRIVATE_KEY` | `template-outil-ia/.gitea/workflows/controle.yml:247,250`, `infra/ansible/group_vars/forge/vars.yml:296` | org secret set by Ansible: same change set |
| `COSIGN_OUTILS_PASSWORD` | `COSIGN_TOOLS_PASSWORD` | `template-outil-ia/.gitea/workflows/controle.yml:248`, `infra/ansible/group_vars/forge/vars.yml:297` | same |
| `<org>-socle` (npm registry owner in `REG=…`) | `<org>-core` | `template-outil-ia/.gitea/workflows/controle.yml:72,117,159`, `template-outil-ia/.gitea/controles/acceptance.sh:31`, `template-outil-ia/.gitea/controles/paquet.mjs:58` | L1; also `/api/packages/eupadev-socle/npm/` in the lockfile check |
| `svc-deploiement` (registry read user) | `svc-deployment` | `template-outil-ia/.gitea/workflows/controle.yml:40,51,88,111,141`, `images/agent/.gitea/workflows/publier.yml:42` | owned by the infra section (Gitea robot) |
| `GARDE-FOU` (output prefix) | `GUARD-RAIL` | `template-outil-ia/.gitea/controles/garde-fous.sh:73`, `template-outil-ia/.gitea/controles/paquet.mjs:85`, `infra/ansible/verify-template.yml:190,787,846`, `infra/ansible/verify-moteur-preview.yml:346` | the lab tests match this text: same change set |
| `UTILISATEUR` | `USER_ID` | `images/agent/.gitea/workflows/publier.yml:66-68` | override: `USER` would shadow the POSIX variable; it holds `id -u` |
| `Empreinte de l'image agent :` (log line) | `Agent image digest:` | `images/agent/.gitea/workflows/publier.yml:149`, `infra/ansible/verify-image-agent.yml:80` (regex) | parsed by the lab test: same change set |
| `VARIANTES` | `VARIANTS` | `images/agent/.gitea/workflows/publier.yml:118`, `images/agent/controle/essai-amont/lancer.sh:21`, `images/agent/controle/essai-amont/verifier.mjs:34` | values: see Agent image |

### Scripts

| French | English | Where | Notes |
|---|---|---|---|
| `LICENCES_AUTORISEES` | `ALLOWED_LICENSES` | `template-outil-ia/.gitea/controles/garde-fous.sh:49,178` | |
| `DUREE_MAX_JOURS` | `MAX_DURATION_DAYS` | `template-outil-ia/.gitea/controles/garde-fous.sh:50,190,203` | |
| `REGISTRE` | `REGISTRY` | `template-outil-ia/.gitea/controles/garde-fous.sh:51` | holds `.gitea/exceptions.txt` (exceptions registry) |
| `MOTIFS` | `PATTERNS` | `template-outil-ia/.gitea/controles/garde-fous.sh:52,118,155` | motif = grep pattern |
| `rouge` (exit flag) | `red` | `template-outil-ia/.gitea/controles/garde-fous.sh:70,293`, `template-outil-ia/.gitea/controles/acceptance.sh:60` | |
| `signaler` (function) | `report` | `template-outil-ia/.gitea/controles/garde-fous.sh:71` | |
| `fautive` (function) | `faulty_line` | `template-outil-ia/.gitea/controles/garde-fous.sh:101` | |
| `permis` (function and temp file) | `allowed` | `template-outil-ia/.gitea/controles/garde-fous.sh:102,131` | |
| `comparer` (function) | `compare` | `template-outil-ia/.gitea/controles/garde-fous.sh:140` | |
| `pnpm_fixe` (function) | `pinned_pnpm` | `template-outil-ia/.gitea/controles/garde-fous.sh:174` | override: "fixe" = pinned version here |
| `fin_entree` (function) | `end_entry` | `template-outil-ia/.gitea/controles/garde-fous.sh:206` | |
| `verifier_date` (function) | `verify_date` | `template-outil-ia/.gitea/controles/garde-fous.sh:211` | |
| `src_nom` | `src_name` | `template-outil-ia/.gitea/controles/garde-fous.sh:80-91` | |
| `tete` | `head_tree` | `template-outil-ia/.gitea/controles/garde-fous.sh:151`, `:283` | override: "tête" = git head here, not a header |
| `aujourdhui` | `today` | `template-outil-ia/.gitea/controles/garde-fous.sh:98` | |
| `manque` | `missing` | `template-outil-ia/.gitea/controles/garde-fous.sh:139` | |
| `paquet` (shell variable) | `package_version` | `template-outil-ia/.gitea/controles/garde-fous.sh:288` | |
| `$tmp/registre` | `$tmp/registry` | `template-outil-ia/.gitea/controles/garde-fous.sh:93,155,181` | temp files |
| `$tmp/trouves` | `$tmp/found` | `template-outil-ia/.gitea/controles/garde-fous.sh:93,155,181` | temp files |
| `$tmp/licences.json` | `$tmp/licenses.json` | `template-outil-ia/.gitea/controles/garde-fous.sh:93,155,181` | temp files |
| `constats` (export) | `findings` | `template-outil-ia/.gitea/controles/paquet.mjs:26`, `orchestrateur/tests/image-fixe.test.ts:12` | |
| `constatsVerrou` (export) | `lockfileFindings` | `template-outil-ia/.gitea/controles/paquet.mjs:56`, `orchestrateur/tests/image-fixe.test.ts:12,152` | verrou = the pnpm lockfile here |
| `CYCLE_DE_VIE` | `LIFECYCLE` | `template-outil-ia/.gitea/controles/paquet.mjs:19` | |
| `SOCLE` (constant) | `CORE` | `template-outil-ia/.gitea/controles/paquet.mjs:21` | L1 |
| `EXACTE` | `EXACT` | `template-outil-ia/.gitea/controles/paquet.mjs:22` | |
| `duRegistre` | `fromRegistry` | `template-outil-ia/.gitea/controles/paquet.mjs:24` | |
| `retraitBloc` | `blockIndent` | `template-outil-ia/.gitea/controles/paquet.mjs:59-62` |  |
| `retrait` | `indent` | `template-outil-ia/.gitea/controles/paquet.mjs:59-62` |  |
| `'paquet'` (block kind) | `'package'` | `template-outil-ia/.gitea/controles/paquet.mjs:69,74` | `'importer'` unchanged |
| `catalogue` (export) | `catalogue` | `template-outil-ia/scripts/generer-catalogue-rapport.js:17`, `template-outil-ia/tests/unit/report-schema.test.js:4`, `orchestrateur/tests/moteur-claude.test.ts` | |
| `appliquer` (export) | `apply` | `template-outil-ia/scripts/generer-catalogue-rapport.js:36` | |
| `RACINE` | `ROOT` | `template-outil-ia/scripts/generer-catalogue-rapport.js:11` | |
| `DOSSIER_REGLES` | `RULES_DIR` | `template-outil-ia/scripts/generer-catalogue-rapport.js:12` | |
| `CATEGORIES_SYNTHETIQUES` | `SYNTHETIC_CATEGORIES` | `template-outil-ia/scripts/generer-catalogue-rapport.js:15` | values `mechanical`, `data` already English |
| `fin` (EXIT trap function) | `cleanup` | `template-outil-ia/.gitea/controles/boot-check.sh:20,24` | override: a trap handler reads better as `cleanup` |
| `outil` (throwaway database, network alias, container suffix `-outil`) | `tool` | `template-outil-ia/.gitea/controles/boot-check.sh:27,32,46-57` | |
| `outil_owner` | `tool_owner` | `template-outil-ia/.gitea/controles/boot-check.sh:46,52` | derived from the psql variable below |
| `outil_app` | `tool_app` | `template-outil-ia/.gitea/controles/boot-check.sh:46,52` | derived from the psql variable below |
| `outil`, `mdp_owner`, `mdp_app`, `mdp_purge` (psql variables of the core's `sql/roles.sql`) | `tool`, `owner_password`, `app_password`, `purge_password` | `template-outil-ia/.gitea/controles/boot-check.sh:42-43`, `socle/sql/roles.sql:13-36` | owned by the core section; same names in `infra/ansible/roles/postgres_outils` |
| `attendre` (import alias) | `wait` | `template-outil-ia/.gitea/controles/sec-preview.mjs:8,19` | |
| `nettoyer` (function) | `cleanup` | `images/agent/controle/essai-amont/lancer.sh:20` | dictionary: nettoyer → clean; `cleanup` matches the boot-check trap |
| `RESEAU` | `NETWORK` | `images/agent/controle/essai-amont/lancer.sh:12-18` |  |
| `SORTIE` | `OUTPUT` | `images/agent/controle/essai-amont/lancer.sh:12-18` |  |
| `ICI` | `HERE` | `images/agent/controle/essai-amont/lancer.sh:12-18` |  |
| `REGLE_READ` | `READ_RULE` | `images/agent/controle/essai-amont/essai.sh:64-65` | |
| `CANARIS` | `CANARIES` | `images/agent/controle/essai-amont/verifier.mjs:8` | |
| `TOURS` (scripted model turns) | `TURNS` | `images/agent/controle/essai-amont/amont.js:20,88` | override: Claude model turns, not hardening rounds |
| `JOURNAL`, `DEPOT` (constants) | `LOG`, `REPO` | `images/agent/controle/essai-amont/amont.js:12-13` | |
| `servir` (function) | `serve` | `images/agent/controle/essai-amont/amont.js:78` | |
| `resultatsOutils` (function) | `toolResults` | `images/agent/controle/essai-amont/verifier.mjs:22` | word order |

### Wire formats

| French | English | Where | Notes |
|---|---|---|---|
| `# expire;fichier;motif;nombre;raison` (header of `.gitea/exceptions.txt`) | `# expires;file;pattern;count;reason` | `template-outil-ia/.gitea/controles/garde-fous.sh:25,104-106`, `infra/ansible/verify-template.yml:192`, `docs/adr/004-migrations-immuables-sans-down-controlees-par-squawk.md:39` | registry written by humans in tool repos (branch `exception/**`); file name and branch unchanged |
| `fichier` (special pattern of the exceptions registry) | `file` | `template-outil-ia/.gitea/controles/garde-fous.sh:27,118,159` | |
| `non_plausible` (report `verdict` enum value) | `not_plausible` | `template-outil-ia/agents/report.schema.json:144`, `template-outil-ia/agents/overlap.md:20,39`, `orchestrateur/src/moteur/rapport.ts:33`, `orchestrateur/src/workflows/cycleOutil.ts:655` | step 3; the guard outcome `garde:non_plausible` it leads to is a stored state-machine value (Engine section, step 4b) |
| `qualite.md#<section>` (report `rule`/`category` enum values) | `quality.md#<section>` | `template-outil-ia/agents/report.schema.json:38-43,67-72`, `images/agent/controle/report.schema.json`, `orchestrateur/features/durcissement-review.feature`, `orchestrateur/tests/stagnation.test.ts` | 6 values (`API`, `Data and migrations`, `Personal data`, `Dependencies`, `Accessibility`, `Tests`); regenerated, never hand-edited; stored in the engine database (`ecarts.category`, stagnation keys) |
| `securite.md#<section>` | `security.md#<section>` | `template-outil-ia/agents/report.schema.json:44-48,73-77`, `orchestrateur/tests/stagnation.test.ts:7-133`, `template-outil-ia/tests/unit/report-schema.test.js:13` | 5 values; same |
| `'qualite'`, `'securite'` (rule file stems of `REGLES_PAR_ROLE`) | `'quality'`, `'security'` | `orchestrateur/src/moteur/consignes.ts:20-28,58` | engine-owned; listed for the coupling |
| `innerhtml-texte-variable` (Opengrep rule id) | `innerhtml-variable-text` | `template-outil-ia/.opengrep/regles-depart.yml:8`, `socle/web/escape-html.js:2`, `orchestrateur/features/durcissement-review.feature:387-438` | ids appear in SARIF and engine fixtures |
| `eval-ou-function-dynamique` | `dynamic-eval-or-function` | `template-outil-ia/.opengrep/regles-depart.yml:31` | |
| `aleatoire-non-cryptographique` | `non-cryptographic-random` | `template-outil-ia/.opengrep/regles-depart.yml:41` | |
| `commande-systeme-texte-variable` | `system-command-variable-text` | `template-outil-ia/.opengrep/regles-depart.yml:59`, `tests/opengrep/regles-depart.js:62-64` | test annotations `ruleid:`/`ok:` follow |
| `cookie-sans-prefixe-host` | `cookie-no-host-prefix` | `template-outil-ia/.opengrep/regles-depart.yml:107`, `tests/opengrep/regles-depart.js:8-56` | `sans` → `no` in names |
| `nom`, `mdp` (keys of the `PREVIEW_PERSONAS` JSON) | `name`, `password` | `template-outil-ia/.gitea/controles/realm-personas.mjs:1,12`, `infra/ansible/enregistrer-outils.yml:241` | `roles` unchanged; written at Gate 1 by Ansible: same change set |
| `outil-essai` (stub Keycloak client in the personas realm file) | `trial-tool` | `template-outil-ia/.gitea/controles/realm-personas.mjs:10-11`, `socle/kit/realm.js:19-25`, `infra/ansible/enregistrer-outils.yml:53` | same client id as the core test realm (core section) |
| `contrat`, `personnes` (option keys of the core kit's `genererCas`) | `contract`, `people` | `template-outil-ia/.gitea/controles/sec-preview.mjs:13-15` | core-owned; `c.nom` → `c.name`, `c.verifier` → `c.verify` (case fields) |
| `methode`, `chemin`, `entetes`, `corps` (keys of the upstream trial log records) | `method`, `path`, `headers`, `body` | `images/agent/controle/essai-amont/amont.js:83-90`, `images/agent/controle/essai-amont/verifier.mjs:39-41` | `port` unchanged |
| `CONSIGNES-ESSAI-AMONT` (marker) | `UPSTREAM-TRIAL-INSTRUCTIONS` | `images/agent/controle/essai-amont/essai.sh:15`, `images/agent/controle/essai-amont/verifier.mjs:49` | |
| `DONNEES-TACHE-ESSAI` (marker) | `TRIAL-TASK-DATA` | `images/agent/controle/essai-amont/essai.sh:16`, `images/agent/controle/essai-amont/verifier.mjs:69,90,104` | |
| `ECRIT_API` (marker) | `API_WRITTEN` | `images/agent/controle/essai-amont/amont.js:24`, `images/agent/controle/essai-amont/verifier.mjs:71` | override: past participle reads right |
| `LU_HORS` (marker) | `READ_OUTSIDE` | `images/agent/controle/essai-amont/verifier.mjs:85`, `images/agent/controle/essai-amont/amont.js` | |
| `ECRIT`, `ECRIT_USER`, `ECRIT_NODE`, `ECRIT_Z` (markers) | `WRITTEN`, `USER_WRITTEN`, `NODE_WRITTEN`, `Z_WRITTEN` | `images/agent/controle/essai-amont/amont.js:25-43`, `images/agent/controle/essai-amont/verifier.mjs` | same form as `API_WRITTEN` (added in step 3) |
| `faux amont` (console line of `amont.js`, waited for by `lancer.sh`) | `fake upstream` | `images/agent/controle/essai-amont/amont.js:95`, `images/agent/controle/essai-amont/lancer.sh:30` | both ends move together (added in step 3) |
| `=== code de sortie :`, `=== travail :`, `=== dépôt :`, `=== fichiers :` (status lines of `essai.sh`) | `=== exit code:`, `=== work:`, `=== repository:`, `=== files:` | `images/agent/controle/essai-amont/essai.sh:116-122`, `images/agent/controle/essai-amont/verifier.mjs:204-206` | parsed by `verify.mjs` (added in step 3) |
| `CANARI_PROJET_SETTINGS` | `CANARY_PROJECT_SETTINGS` | `images/agent/controle/essai-amont/essai.sh:29`, `images/agent/controle/essai-amont/verifier.mjs:8` | |
| `CANARI_USER_SETTINGS` | `CANARY_USER_SETTINGS` | `images/agent/controle/essai-amont/essai.sh:20,24` |  |
| `CANARI_USER_CLAUDE_MD` | `CANARY_USER_CLAUDE_MD` | `images/agent/controle/essai-amont/essai.sh:20,24` |  |
| `CANARI_CLAUDE_MD` | `CANARY_CLAUDE_MD` | `images/agent/controle/essai-amont/essai.sh:35-36` |  |
| `CANARI_AGENTS_MD` | `CANARY_AGENTS_MD` | `images/agent/controle/essai-amont/essai.sh:35-36` |  |
| `CANARI_REGLE_PATHS` | `CANARY_PATHS_RULE` | `images/agent/controle/essai-amont/essai.sh:34`, `images/agent/controle/essai-amont/verifier.mjs:82` | |
| `CANARI_FICHIER_API` | `CANARY_API_FILE` | `images/agent/controle/essai-amont/essai.sh:38` | |
| `canari` (MCP server name in the trap `.mcp.json`) | `CANARY_MCP` | `images/agent/controle/essai-amont/essai.sh:37`, `images/agent/controle/essai-amont/verifier.mjs:8` | override (step 3): `verify.mjs` fails if the name appears in any request; the English word `canary` could occur in Claude Code's own prompt, so the name is as distinctive as the other canaries |
| `PIRATE` (fake attacker host alias) | `ATTACKER` | `images/agent/controle/essai-amont/lancer.sh:33`, `images/agent/controle/essai-amont/essai.sh:21,30`, `images/agent/controle/essai-amont/verifier.mjs:78`, `orchestrateur/tests/aides/claude-factice/claude` | see Dictionary requests |

### Agent image

| French | English | Where | Notes |
|---|---|---|---|
| `CLAUDE_CODE_CLE` (ARG) | `CLAUDE_CODE_FINGERPRINT` | `images/agent/Dockerfile:31,46-47` | override (step 3): it holds the release-signing key's fingerprint, and `…_KEY=<hex>` reads as a secret to secret scanners (the agent's guard blocks the commit) |
| `CLAUDE_CODE_PLATEFORME` (ARG) | `CLAUDE_CODE_PLATFORM` | `images/agent/Dockerfile:34,49,53` | |
| `DEPOT` (release URL base) | `RELEASE_URL` | `images/agent/Dockerfile:40-53` | override: not a repository |
| `SOMME` | `CHECKSUM` | `images/agent/Dockerfile:49,54` | override: a sha256 checksum |
| `code`, `lecture`, `relecteur` (trial variants and role kinds) | `code`, `read`, `reviewer` | `images/agent/controle/essai-amont/essai.sh:9`, `images/agent/controle/essai-amont/verifier.mjs:36`, `images/agent/.gitea/workflows/publier.yml:118` | mirror the engine's role kinds of `moteur-claude.ts` |
| `code-sans-restricted` | `code-no-restricted` | `images/agent/controle/essai-amont/lancer.sh:21`, `images/agent/controle/essai-amont/essai.sh:11`, `images/agent/controle/essai-amont/verifier.mjs:34` | witness variants |
| `code-sans-bare` | `code-no-bare` | `images/agent/controle/essai-amont/lancer.sh:21`, `images/agent/controle/essai-amont/essai.sh:11`, `images/agent/controle/essai-amont/verifier.mjs:34` | witness variants |
| `code-sans-tools` | `code-no-tools` | `images/agent/controle/essai-amont/lancer.sh:21`, `images/agent/controle/essai-amont/essai.sh:11`, `images/agent/controle/essai-amont/verifier.mjs:34` | witness variants |
| `code-sans-add-dir` | `code-no-add-dir` | `images/agent/controle/essai-amont/lancer.sh:21`, `images/agent/controle/essai-amont/essai.sh:11`, `images/agent/controle/essai-amont/verifier.mjs:34` | witness variants |
| `code-outils-espaces` | `code-tools-spaces` | same | |
| `code-sans-regle-read` | `code-no-read-rule` | same | |
| `AMONT_SCENARIO` | `UPSTREAM_SCENARIO` | `images/agent/controle/essai-amont/lancer.sh:25`, `images/agent/controle/essai-amont/amont.js:14` | |
| `fa-essai-amont-$$` (Docker network) | `fa-upstream-trial-$$` | `images/agent/controle/essai-amont/lancer.sh:17` | |
| `fa-amont-$$` (container) | `fa-upstream-$$` | `images/agent/controle/essai-amont/lancer.sh:20-37` | |
| `FA_MODELE` | `FA_MODEL` | `orchestrateur/src/exterieur/moteur-claude.ts:87-91`, `images/agent/controle/claude.sh:8`, `images/agent/controle/essai-amont/essai.sh:50` | engine-owned (`LIGNE_CLAUDE`), generated into `claude.sh` |
| `FA_OUTILS` | `FA_TOOLS` | same | |
| `FA_AUTORISATIONS` | `FA_PERMISSIONS` | same | override: Claude Code permission rules; see Dictionary requests |
| `FA_TOURS` | `FA_TURNS` | same | override: `--max-turns` |
| `eupadev.tache` (container label) | `eupadev.task` | `orchestrateur/src/exterieur/moteur-claude.ts:66` (`ETIQUETTE`) | engine-owned |
| `travail` (branch of the input bundle) | `work` | `orchestrateur/src/exterieur/moteur-claude.ts:95,633-634` | engine-owned |
| `refs/eupadev/sortie` | `refs/eupadev/output` | `orchestrateur/src/exterieur/moteur-claude.ts:738` | engine-owned |
| `EUPADEV-RESULTAT`, `EUPADEV-ERREURS` (stdout markers) | `EUPADEV-RESULT`, `EUPADEV-ERRORS` | `orchestrateur/src/exterieur/moteur-claude.ts:110-111` | engine-owned; `EUPADEV-BUNDLE` unchanged |
| `fa-tache-` (temp dir prefix) | `fa-task-` | `orchestrateur/src/exterieur/moteur-claude.ts:595` | engine-owned |

### Docker labels and build args

| French | English | Where | Notes |
|---|---|---|---|
| `SOCLE_VERSION` (build arg) | `CORE_VERSION` | `template-outil-ia/.gitea/image/Dockerfile:21,33,40`, `template-outil-ia/.gitea/workflows/controle.yml:164-169`, `.github/workflows/template-regles.yml:77-93` | L1 |
| `eupadev.socle` (image label) | `eupadev.core` | `template-outil-ia/.gitea/image/Dockerfile:46`, `infra/ansible/roles/deployeur/files/deployeur.py:16,228`, `infra/ansible/verify-template.yml:512-535` | read by the deployer, `postgres_outils`, lab tests and `test_deployeur.py`: same change set |
| `@eupadev/socle` (dependency, `minimumReleaseAgeExclude`) | `@eupadev/core` | `template-outil-ia/package.json:15`, `template-outil-ia/pnpm-workspace.yaml:14`, `template-outil-ia/.gitea/image/Dockerfile:30-55` | lockfile regenerated by `infra/ansible/template-lockfile.yml` |
| `node_modules/@eupadev/socle/bin/demarrer.js` | `node_modules/@eupadev/core/bin/start.js` | `template-outil-ia/.gitea/image/Dockerfile:44,55`, `template-outil-ia/.gitea/controles/boot-check.sh:41,48` | core-owned paths |
| `…/bin/migrer.js` | `…/bin/migrate.js` | `template-outil-ia/.gitea/image/Dockerfile:44,55`, `template-outil-ia/.gitea/controles/boot-check.sh:41,48` | core-owned paths |
| `…/sql/roles.sql` | `…/sql/roles.sql` | `template-outil-ia/.gitea/image/Dockerfile:44,55`, `template-outil-ia/.gitea/controles/boot-check.sh:41,48` | core-owned paths |

### Prompt and instruction strings

| French | English | Where | Notes |
|---|---|---|---|
| `PROMPT` text `Lis /tmp/tache/tache.md … Termine par ton rapport.` | English sentence naming `/tmp/task/task.md` | `orchestrateur/src/exterieur/moteur-claude.ts:65`, `images/agent/controle/essai-amont/essai.sh:49` | agent-facing, English (L10: not i18n) |
| `# Tâche <id>` heading and JSON keys `tache_id`, `outil`, `branche`, `contexte` of `tache.md` | `# Task <id>`, `task_id`, `tool`, `branch`, `context` | `orchestrateur/src/exterieur/moteur-claude.ts:801-809` | engine-owned; the agents' instructions name these keys |
| `FA_PROMPT='Réponds « ok ».'`, `Consignes du contrôle.` | English | `orchestrateur/scripts/generer-controle-claude.ts:46`, `images/agent/controle/claude.sh:8,10` | generated |
| `api.appeler`, `api.lien`, `lierFormulaire`, `/socle/api.js`, `/socle/form.js`, `/socle/render.js` (cited in instructions) | `api.call`, `api.link`, `bindForm`, `/core/api.js`, `/core/form.js`, `/core/render.js` | `template-outil-ia/.claude/rules/frontend.md:15-25`, `template-outil-ia/docs/fr/rules/frontend.md:12-22` | core-owned names: follow the core section |
| `lireContrat` (cited and called) | `readContract` | `template-outil-ia/scripts/verify.sh:14`, `template-outil-ia/agents/contract.md`, `template-outil-ia/docs/fr/agents/contract.md:51` | core-owned |
| `bin/demarrer.js --verifier` (cited) | `bin/start.js --verify` | `template-outil-ia/agents/builder.md:31`, `template-outil-ia/README.md:20` | core-owned |
| `exemples/demandes/…` (cited as reference) | `examples/requests/…` | `template-outil-ia/openapi.yaml:3`, `template-outil-ia/db/purge.sql:4`, `template-outil-ia/README.md:16` | L8 |

### Rules (no row per instance)

- Step names: 12 French step names in `controle.yml`, 7 in `images/agent/.gitea/workflows/publier.yml` → English
  (`controle-preview.yml` is already English). Check names are the job ids above, not step names.
- French comments and messages → English (CI output and logs): `garde-fous.sh` (~120 French lines of 303),
  `paquet.mjs` (mixed: ~25 French lines), `controle.yml` (~97 of 267), `regles-depart.yml` rule messages (~35 of 138),
  `gitleaks.toml` (4 of 6), `charge.k6.js` (2), `images/agent/Dockerfile` (~48 of 93), `images/agent/README.md`
  (65, all French), `essai-amont/*` (~135 lines), `publier.yml`. Messages asserted by text in
  `infra/ansible/verify-template.yml` (`:187-190, 726-734, 780-782, 842, 883, 925, 1205-1210, 1290`) and
  `verify-moteur-preview.yml:346` change in the same set.
- Local variables (`verifier.mjs`: `echecs`, `temoin`, `lire`, `amont`, `pirate`, `premier`, `refuse`…; `paquet.mjs`:
  `sortie`, `bloc`, `verrou`, `liste`; `garde-fous.sh` loop variables `expire`, `fichier`, `motif`, `nombre`,
  `raison`, `reste`; `generer-catalogue-rapport.js`: `fichier`, `texte`, `ligne`, `titre`, `entree`) → by Words.
- Generated files, never edited by hand: `images/agent/controle/claude.sh`, `images/agent/controle/report.schema.json`,
  `images/agent/managed-settings.json` (from `orchestrateur/scripts/generer-controle-claude.ts`, checked by
  `claude-sortie.test.ts:110-117`); enums of `template-outil-ia/agents/report.schema.json` (from
  `generate-report-catalog.js`, checked by `report-schema.test.js`, which runs only in tool repos' CI, not on GitHub).
- `template-outil-ia/pnpm-lock.yaml`: regenerated on the lab by `infra/ansible/template-lockfile.yml` after the core
  package rename; not hand-edited.
- `docs/fr/**` and `AGENTS.fr.md` keep French content (translations); only their file names mirror the English ones.
  `AGENTS.fr.md` keeps its name (convention `X.fr.md`), cited in `chemins-interdits.ts:16`, `managed-settings.json:37-38`,
  `group_vars/forge/vars.yml:120-121`.
- Already English, no change: `AGENTS.md`, `CLAUDE.md`, `README.md`, `agents/*.md`, `.claude/agents/*.md`,
  `.claude/rules/{backend,frontend,tests}.md`, `acceptance.sh`, `boot-check.sh`, `realm-personas.mjs`,
  `sec-preview.mjs`, `verify.sh`, `controle-preview.yml` job ids (`perf`, `accessibility-preview`, `pentest-dast`,
  `acceptance`), npm scripts `test`, `verify`, package name `eupadev-tool`. `template-outil-ia/.env.example` was
  not read (blocked by the secrets guard): to check during the template step.

## Engine (`orchestrateur/`, `images/moteur/`)

Built from: AST scan of every `.ts`/`.js` file (exports, declarations, keys, string values), the SQL inventory of `migrations/` and `sql/`, and a read of every source file of the area. Rows follow Words and Rules; a deliberate departure is marked `override:`. Rows that would not change (same word in both languages) are left out unless the note says why they matter.

### Paths

Directories first, then files (full path → new full path). Files inside a renamed directory move with it; only
French file names get their own row.

| French | English | Where | Notes |
|---|---|---|---|
| `orchestrateur/` | `orchestrator/` | `orchestrateur` | L8; Gitea repo `moteur` → `engine` (infra area) |
| `orchestrateur/src/exterieur/` | `orchestrator/src/external/` | `orchestrateur/src/exterieur` |  |
| `orchestrateur/src/durcissement/` | `orchestrator/src/hardening/` | `orchestrateur/src/durcissement` |  |
| `orchestrateur/src/moteur/` | `orchestrator/src/agent-engine/` | `orchestrateur/src/moteur` | override: holds the agent engine's rules (instructions, forbidden paths, report); `src/engine/` inside the engine would be ambiguous (Open questions) |
| `orchestrateur/tests/aides/` | `orchestrator/tests/helpers/` | `orchestrateur/tests/aides` |  |
| `orchestrateur/tests/aides/claude-factice/` | `orchestrator/tests/helpers/fake-claude/` | `orchestrateur/tests/aides/claude-factice` | contents `Dockerfile`, `claude` keep their names |
| `orchestrateur/tests/reprise/` | `orchestrator/tests/resume/` | `orchestrateur/tests/reprise` |  |
| `images/moteur/` | `images/engine/` | `images/moteur` | Gitea repo `moteur` → `engine` (L8); `images/moteur/cosign.pub` is read by path by `images/agent` and `images/keycloak` workflows |
| `images/moteur/.gitea/workflows/publier.yml` | `images/engine/.gitea/workflows/publish.yml` | `images/moteur/.gitea/workflows/publier.yml` |  |
| `orchestrateur/src/exterieur/contrats.ts` | `orchestrator/src/external/contracts.ts` | `orchestrateur/src/exterieur/contrats.ts` |  |
| `orchestrateur/src/exterieur/deployeur-ssh.ts` | `orchestrator/src/external/ssh-deployer.ts` | `orchestrateur/src/exterieur/deployeur-ssh.ts` | word order (class `DeployeurSsh` → `SshDeployer`) |
| `orchestrateur/src/exterieur/factices.ts` | `orchestrator/src/external/fakes.ts` | `orchestrateur/src/exterieur/factices.ts` |  |
| `orchestrateur/src/exterieur/forge-gitea.ts` | `orchestrator/src/external/gitea-forge.ts` | `orchestrateur/src/exterieur/forge-gitea.ts` | word order (class `ForgeGitea` → `GiteaForge`) |
| `orchestrateur/src/exterieur/monde.ts` | `orchestrator/src/external/world.ts` | `orchestrateur/src/exterieur/monde.ts` |  |
| `orchestrateur/src/exterieur/moteur-claude.ts` | `orchestrator/src/external/claude-engine.ts` | `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `orchestrateur/src/exterieur/moteur-pousse.ts` | `orchestrator/src/external/pushing-engine.ts` | `orchestrateur/src/exterieur/moteur-pousse.ts` |  |
| `orchestrateur/src/exterieur/notifications-smtp.ts` | `orchestrator/src/external/smtp-notifications.ts` | `orchestrateur/src/exterieur/notifications-smtp.ts` | word order |
| `orchestrateur/src/machine/etats.ts` | `orchestrator/src/machine/states.ts` | `orchestrateur/src/machine/etats.ts` |  |
| `orchestrateur/src/migrer.ts` | `orchestrator/src/migrate.ts` | `orchestrateur/src/migrer.ts` | image command `node src/migrate.ts` (infra compose and Ansible call it) |
| `orchestrateur/src/moteur/chemins-interdits.ts` | `orchestrator/src/agent-engine/forbidden-paths.ts` | `orchestrateur/src/moteur/chemins-interdits.ts` |  |
| `orchestrateur/src/moteur/consignes.ts` | `orchestrator/src/agent-engine/instructions.ts` | `orchestrateur/src/moteur/consignes.ts` |  |
| `orchestrateur/src/moteur/jargon.ts` | `orchestrator/src/agent-engine/jargon.ts` | `orchestrateur/src/moteur/jargon.ts` | directory only |
| `orchestrateur/src/moteur/rapport.ts` | `orchestrator/src/agent-engine/report.ts` | `orchestrateur/src/moteur/rapport.ts` |  |
| `orchestrateur/src/orchestrateur.ts` | `orchestrator/src/orchestrator.ts` | `orchestrateur/src/orchestrateur.ts` |  |
| `orchestrateur/src/statique.ts` | `orchestrator/src/static.ts` | `orchestrateur/src/statique.ts` |  |
| `orchestrateur/src/texte.ts` | `orchestrator/src/text.ts` | `orchestrateur/src/texte.ts` |  |
| `orchestrateur/src/durcissement/stagnation.ts` | `orchestrator/src/hardening/stagnation.ts` | `orchestrateur/src/durcissement/stagnation.ts` | directory only |
| `orchestrateur/src/workflows/cycleOutil.ts` | `orchestrator/src/workflows/toolCycle.ts` | `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `orchestrateur/src/workflows/tacheAgent.ts` | `orchestrator/src/workflows/agentTask.ts` | `orchestrateur/src/workflows/tacheAgent.ts` |  |
| `orchestrateur/migrations/0002_machine-etats.sql` | `orchestrator/migrations/0002_state-machine.sql` | `orchestrateur/migrations/0002_machine-etats.sql` | generated; `tests/machine.test.ts` finds the LAST `*_machine-etats.sql` by name → `*_state-machine.sql` |
| `orchestrateur/migrations/0003_droits.sql` | `orchestrator/migrations/0003_grants.sql` | `orchestrateur/migrations/0003_droits.sql` |  |
| `orchestrateur/migrations/0004_messages-cle.sql` | `orchestrator/migrations/0004_message-key.sql` | `orchestrateur/migrations/0004_messages-cle.sql` |  |
| `orchestrateur/migrations/0005_taches-lanceur.sql` | `orchestrator/migrations/0005_task-launcher.sql` | `orchestrateur/migrations/0005_taches-lanceur.sql` |  |
| `orchestrateur/migrations/0006_taches-ci-vert.sql` | `orchestrator/migrations/0006_task-green-ci.sql` | `orchestrateur/migrations/0006_taches-ci-vert.sql` |  |
| `orchestrateur/migrations/0007_notifications-envoyees.sql` | `orchestrator/migrations/0007_sent-notifications.sql` | `orchestrateur/migrations/0007_notifications-envoyees.sql` |  |
| `orchestrateur/migrations/0008_acteurs.sql` | `orchestrator/migrations/0008_actors.sql` | `orchestrateur/migrations/0008_acteurs.sql` |  |
| `orchestrateur/migrations/0009_mesure-cycles.sql` | `orchestrator/migrations/0009_cycle-measures.sql` | `orchestrateur/migrations/0009_mesure-cycles.sql` |  |
| `orchestrateur/migrations/0010_fusion-acteurs.sql` | `orchestrator/migrations/0010_actor-merge.sql` | `orchestrateur/migrations/0010_fusion-acteurs.sql` |  |
| `orchestrateur/migrations/0012_machine-etats.sql` | `orchestrator/migrations/0012_state-machine.sql` | `orchestrateur/migrations/0012_machine-etats.sql` | generated |
| `orchestrateur/migrations/0013_ecart-role-cible.sql` | `orchestrator/migrations/0013_deviation-target-role.sql` | `orchestrateur/migrations/0013_ecart-role-cible.sql` |  |
| `orchestrateur/migrations/0015_machine-etats.sql` | `orchestrator/migrations/0015_state-machine.sql` | `orchestrateur/migrations/0015_machine-etats.sql` | generated (the latest: compared byte for byte with `generate-transitions.ts`) |
| `orchestrateur/features/cadrage.feature` | `orchestrator/features/scoping.feature` | `orchestrateur/features/cadrage.feature` |  |
| `orchestrateur/features/durcissement-review.feature` | `orchestrator/features/hardening-review.feature` | `orchestrateur/features/durcissement-review.feature` |  |
| `orchestrateur/features/entree-chevauchement.feature` | `orchestrator/features/entry-overlap.feature` | `orchestrateur/features/entree-chevauchement.feature` |  |
| `orchestrateur/features/erreurs-connues-v1.feature` | `orchestrator/features/known-errors-v1.feature` | `orchestrateur/features/erreurs-connues-v1.feature` |  |
| `orchestrateur/features/exploitation.feature` | `orchestrator/features/operations.feature` | `orchestrateur/features/exploitation.feature` |  |
| `orchestrateur/features/gates-livraison.feature` | `orchestrator/features/delivery-gates.feature` | `orchestrateur/features/gates-livraison.feature` |  |
| `orchestrateur/features/incident-technique.feature` | `orchestrator/features/technical-incident.feature` | `orchestrateur/features/incident-technique.feature` |  |
| `orchestrateur/features/lanceur.feature` | `orchestrator/features/launcher.feature` | `orchestrateur/features/lanceur.feature` |  |
| `orchestrateur/features/steps/lanceur.ts` | `orchestrator/features/steps/launcher.ts` | `orchestrateur/features/steps/lanceur.ts` |  |
| `orchestrateur/features/steps/verifications.ts` | `orchestrator/features/steps/checks.ts` | `orchestrateur/features/steps/verifications.ts` |  |
| `orchestrateur/features/support/monde.ts` | `orchestrator/features/support/world.ts` | `orchestrateur/features/support/monde.ts` | the Cucumber World |
| `orchestrateur/scripts/essai-ci.ts` | `orchestrator/scripts/trial-ci.ts` | `orchestrateur/scripts/essai-ci.ts` |  |
| `orchestrateur/scripts/essai-claude.ts` | `orchestrator/scripts/trial-claude.ts` | `orchestrateur/scripts/essai-claude.ts` |  |
| `orchestrateur/scripts/essai-deploiement.ts` | `orchestrator/scripts/trial-deployment.ts` | `orchestrateur/scripts/essai-deploiement.ts` |  |
| `orchestrateur/scripts/essai-forge.ts` | `orchestrator/scripts/trial-forge.ts` | `orchestrateur/scripts/essai-forge.ts` |  |
| `orchestrateur/scripts/essai-integration.ts` | `orchestrator/scripts/trial-integration.ts` | `orchestrateur/scripts/essai-integration.ts` |  |
| `orchestrateur/scripts/essai-preview.ts` | `orchestrator/scripts/trial-preview.ts` | `orchestrateur/scripts/essai-preview.ts` |  |
| `orchestrateur/scripts/generer-controle-claude.ts` | `orchestrator/scripts/generate-claude-check.ts` | `orchestrateur/scripts/generer-controle-claude.ts` | writes `images/agent/controle/*` and `images/agent/managed-settings.json` |
| `orchestrateur/scripts/generer-mermaid.ts` | `orchestrator/scripts/generate-mermaid.ts` | `orchestrateur/scripts/generer-mermaid.ts` | rewrites the block of `MACHINE.md` |
| `orchestrateur/scripts/generer-transitions.ts` | `orchestrator/scripts/generate-transitions.ts` | `orchestrateur/scripts/generer-transitions.ts` | writes the `*_state-machine.sql` migration |
| `orchestrateur/tests/aides/banc.ts` | `orchestrator/tests/helpers/bench.ts` | `orchestrateur/tests/aides/banc.ts` |  |
| `orchestrateur/tests/aides/mailpit-jetable.ts` | `orchestrator/tests/helpers/throwaway-mailpit.ts` | `orchestrateur/tests/aides/mailpit-jetable.ts` |  |
| `orchestrateur/tests/aides/oidc-factice.ts` | `orchestrator/tests/helpers/fake-oidc.ts` | `orchestrateur/tests/aides/oidc-factice.ts` |  |
| `orchestrateur/tests/aides/postgres-jetable.ts` | `orchestrator/tests/helpers/throwaway-postgres.ts` | `orchestrateur/tests/aides/postgres-jetable.ts` | its `IMAGE` constant is read by `.github/scripts/verifier-empreintes.py` (name must stay `IMAGE`) |
| `orchestrateur/tests/aides/repro-planificateur.ts` | `orchestrator/tests/helpers/scheduler-repro.ts` | `orchestrateur/tests/aides/repro-planificateur.ts` |  |
| `orchestrateur/tests/chemins-interdits.test.ts` | `orchestrator/tests/forbidden-paths.test.ts` | `orchestrateur/tests/chemins-interdits.test.ts` |  |
| `orchestrateur/tests/claude-sortie.test.ts` | `orchestrator/tests/claude-output.test.ts` | `orchestrateur/tests/claude-sortie.test.ts` |  |
| `orchestrateur/tests/consignes.test.ts` | `orchestrator/tests/instructions.test.ts` | `orchestrateur/tests/consignes.test.ts` |  |
| `orchestrateur/tests/couverture-features.test.ts` | `orchestrator/tests/feature-coverage.test.ts` | `orchestrateur/tests/couverture-features.test.ts` |  |
| `orchestrateur/tests/deployeur-ssh.test.ts` | `orchestrator/tests/ssh-deployer.test.ts` | `orchestrateur/tests/deployeur-ssh.test.ts` |  |
| `orchestrateur/tests/forge-gitea.test.ts` | `orchestrator/tests/gitea-forge.test.ts` | `orchestrateur/tests/forge-gitea.test.ts` |  |
| `orchestrateur/tests/image-fixe.test.ts` | `orchestrator/tests/fixed-image.test.ts` | `orchestrateur/tests/image-fixe.test.ts` |  |
| `orchestrateur/tests/moteur-claude.test.ts` | `orchestrator/tests/claude-engine.test.ts` | `orchestrateur/tests/moteur-claude.test.ts` |  |
| `orchestrateur/tests/moteur.test.ts` | `orchestrator/tests/engine.test.ts` | `orchestrateur/tests/moteur.test.ts` |  |
| `orchestrateur/tests/remplacement.test.ts` | `orchestrator/tests/replacement.test.ts` | `orchestrateur/tests/remplacement.test.ts` |  |
| `orchestrateur/tests/reprise.test.ts` | `orchestrator/tests/resume.test.ts` | `orchestrateur/tests/reprise.test.ts` | npm script `test:reprise` → `test:resume` (called by `.github/workflows/moteur.yml`) |
| `orchestrateur/tests/reprise/enfant.ts` | `orchestrator/tests/resume/child.ts` | `orchestrateur/tests/reprise/enfant.ts` |  |
| `orchestrateur/tests/reprise/enfant-mails.ts` | `orchestrator/tests/resume/child-mails.ts` | `orchestrateur/tests/reprise/enfant-mails.ts` |  |
| `orchestrateur/tests/robustesse.test.ts` | `orchestrator/tests/robustness.test.ts` | `orchestrateur/tests/robustesse.test.ts` |  |
| `orchestrateur/tests/roles/enfant.ts` | `orchestrator/tests/roles/child.ts` | `orchestrateur/tests/roles/enfant.ts` |  |
| `orchestrateur/tests/socle-moteur.test.ts` | `orchestrator/tests/engine-core.test.ts` | `orchestrateur/tests/socle-moteur.test.ts` | the engine side of the core (store fetch, bump) |
| `orchestrateur/tests/surveillance.test.ts` | `orchestrator/tests/monitoring.test.ts` | `orchestrateur/tests/surveillance.test.ts` |  |
| `orchestrateur/tests/mutations/cliquet.ts` | `orchestrator/tests/mutations/ratchet.ts` | `orchestrateur/tests/mutations/cliquet.ts` | called by path by `.github/workflows/moteur.yml` |
| `orchestrateur/tests/mutations/lancer.ts` | `orchestrator/tests/mutations/launch.ts` | `orchestrateur/tests/mutations/lancer.ts` | npm script `test:mutations` |
| `orchestrateur/tests/mutations/verif-applicabilite.ts` | `orchestrator/tests/mutations/check-applicability.ts` | `orchestrateur/tests/mutations/verif-applicabilite.ts` |  |

### Exports

Every exported French name of the area (types, classes, functions, constants). English names that keep a French word
ORDER are listed too (note `word order`).

| French | English | Where | Notes |
|---|---|---|---|
| `IdEtat` | `StateId` | `orchestrateur/tests/machine.test.ts`, `orchestrateur/tests/aides/banc.ts`, `orchestrateur/src/db.ts` | `src/machine/etats.ts` (re-exported by `features/steps/verifications.ts`) |
| `nouvelleBase` | `newDatabase` | `orchestrateur/features/support/hooks.ts` | override: `base` = database (Dictionary requests) |
| `SLUG_PAR_DEFAUT` | `DEFAULT_SLUG` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/features/steps/verifications.ts`, `orchestrateur/features/support/monde.ts` |  |
| `Monde` | `World` | `orchestrateur/features/steps/verifications.ts`, `orchestrateur/features/steps/actions.ts`, `orchestrateur/features/steps/lanceur.ts` |  |
| `demarrerWeb` | `startWeb` | `orchestrateur/features/support/hooks.ts`, `orchestrateur/features/support/web.ts` |  |
| `arreterWeb` | `stopWeb` | `orchestrateur/features/support/hooks.ts`, `orchestrateur/features/support/web.ts` |  |
| `fermerWeb` | `closeWeb` | `orchestrateur/features/support/hooks.ts`, `orchestrateur/features/support/web.ts` |  |
| `DOSSIER` | `DIR` | `orchestrateur/tests/deployeur-ssh.test.ts`, `orchestrateur/scripts/generer-controle-claude.ts`, `orchestrateur/tests/aides/features.ts` | `scripts/generer-controle-claude.ts`, `tests/aides/features.ts` |
| `DOSSIER_IMAGE` | `IMAGE_DIR` | `orchestrateur/scripts/generer-controle-claude.ts`, `orchestrateur/tests/claude-sortie.test.ts` |  |
| `genererControle` | `generateCheck` | `orchestrateur/scripts/generer-controle-claude.ts`, `orchestrateur/tests/claude-sortie.test.ts` |  |
| `genererMermaid` | `generateMermaid` | `orchestrateur/scripts/generer-mermaid.ts` |  |
| `genererBloc` | `generateBlock` | `orchestrateur/scripts/generer-mermaid.ts`, `orchestrateur/tests/machine.test.ts` |  |
| `genererSql` | `generateSql` | `orchestrateur/scripts/generer-transitions.ts`, `orchestrateur/tests/machine.test.ts` |  |
| `SCHEMA_DEMANDE` | `REQUEST_SCHEMA` | `orchestrateur/src/api.ts` |  |
| `SCHEMA_MESSAGE` | `MESSAGE_SCHEMA` | `orchestrateur/src/api.ts` | word order |
| `SCHEMA_FUSION` | `MERGE_SCHEMA` | `orchestrateur/src/api.ts` |  |
| `creerApi` | `createApi` | `orchestrateur/tests/service.test.ts`, `orchestrateur/features/support/web.ts`, `orchestrateur/src/main.ts` |  |
| `CASQUETTES` | `HATS` | `orchestrateur/src/auth.ts`, `orchestrateur/src/db.ts` |  |
| `Casquette` | `Hat` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/db.ts`, `orchestrateur/src/auth.ts` |  |
| `JetonRefuse` | `TokenRefused` | `orchestrateur/src/auth.ts`, `orchestrateur/tests/auth.test.ts`, `orchestrateur/src/api.ts` |  |
| `Authentificateur` | `Authenticator` | `orchestrateur/src/api.ts`, `orchestrateur/tests/auth.test.ts`, `orchestrateur/src/web-session.ts` |  |
| `jetonPorteur` | `bearerToken` | `orchestrateur/tests/auth.test.ts`, `orchestrateur/src/api.ts`, `orchestrateur/src/auth.ts` |  |
| `MODELES_PAR_ROLE` | `MODELS_BY_ROLE` | `orchestrateur/src/config.ts`, `orchestrateur/tests/config.test.ts`, `orchestrateur/features/steps/lanceur.ts` |  |
| `Delais` | `Timeouts` | `orchestrateur/src/config.ts` |  |
| `delaiTacheMs` | `taskTimeoutMs` | `orchestrateur/tests/config.test.ts`, `orchestrateur/src/workflows/tacheAgent.ts`, `orchestrateur/src/config.ts` |  |
| `Reessais` | `Retries` | `orchestrateur/src/workflows/deps.ts`, `orchestrateur/src/config.ts` |  |
| `RoleProcessus` | `ProcessRole` | `orchestrateur/src/config.ts`, `orchestrateur/src/orchestrateur.ts` |  |
| `VMID_EXECUTEUR` | `EXECUTOR_VMID` | `orchestrateur/src/config.ts`, `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `lireSecret` | `readSecret` | `orchestrateur/tests/config.test.ts`, `orchestrateur/src/exterieur/monde.ts`, `orchestrateur/src/config.ts` |  |
| `DELAI_MAX_MS` | `MAX_TIMEOUT_MS` | `orchestrateur/src/config.ts` |  |
| `lireConfig` | `readConfig` | `orchestrateur/tests/config.test.ts`, `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/tests/moteur.test.ts` |  |
| `CatalogueOutil` | `ToolCatalogueEntry` | `orchestrateur/src/db.ts` | British spelling (catalogue) |
| `Memoire` | `Memory` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/db.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `memoireVide` | `emptyMemory` | `orchestrateur/src/db.ts` |  |
| `Tache` | `Task` | `orchestrateur/src/db.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `LigneEcart` | `DeviationRow` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/db.ts` | override: a row of `ecarts` (`ligne` = row here) |
| `ACTEUR_ORCHESTRATEUR` | `ORCHESTRATOR_ACTOR` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/db.ts`, `orchestrateur/tests/db.test.ts` |  |
| `ACTEUR_FORGE` | `FORGE_ACTOR` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0008_acteurs.sql` |  |
| `ErreurDefinitive` | `PermanentError` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/db.ts`, `orchestrateur/src/exterieur/notifications-smtp.ts` | its `name` string is also compared (`deps.ts estDefinitive`) |
| `Base` | `Database` | `orchestrateur/tests/db.test.ts`, `orchestrateur/src/orchestrateur.ts`, `orchestrateur/README.md` | override: French "base" = database (the class of `db.ts`); variables `base` → `db` |
| `Fusion` | `Merge` | `orchestrateur/src/db.ts`, `orchestrateur/tests/service.test.ts`, `orchestrateur/MACHINE.md` | row type of `acteurs_fusions` |
| `Ecart` | `Deviation` | `orchestrateur/src/durcissement/stagnation.ts`, `orchestrateur/tests/stagnation.test.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `Compteurs` | `Counters` | `orchestrateur/src/durcissement/stagnation.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/features/steps/verifications.ts` |  |
| `Mecanisme` | `Mechanism` | `orchestrateur/src/durcissement/stagnation.ts` |  |
| `Raison` | `Reason` | `orchestrateur/src/durcissement/stagnation.ts`, `ROADMAP.md`, `docs/adr/010-labo-sur-incus-et-opentofu-avant-la-publication.md` |  |
| `Seuils` | `Thresholds` | `orchestrateur/src/durcissement/stagnation.ts`, `orchestrateur/src/machine/etats.ts`, `ROADMAP.md` |  |
| `SEUILS_STAGNATION` | `STAGNATION_THRESHOLDS` | `orchestrateur/src/durcissement/stagnation.ts` |  |
| `dedoublonner` | `deduplicate` | `orchestrateur/src/durcissement/stagnation.ts`, `orchestrateur/tests/stagnation.test.ts` |  |
| `compteurs` | `counters` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/MACHINE.md`, `orchestrateur/tests/stagnation.test.ts` |  |
| `sansProgres` | `noProgress` | `orchestrateur/tests/stagnation.test.ts`, `orchestrateur/src/durcissement/stagnation.ts` |  |
| `EtatArbres` | `TreeState` | `orchestrateur/src/durcissement/stagnation.ts` |  |
| `arbres` | `trees` | `orchestrateur/tests/stagnation.test.ts`, `orchestrateur/src/durcissement/stagnation.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `ecartsOpengrep` | `opengrepDeviations` | `orchestrateur/tests/stagnation.test.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/durcissement/stagnation.ts` |  |
| `evaluer` | `evaluate` | `orchestrateur/tests/stagnation.test.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/durcissement/stagnation.ts` |  |
| `ROLES_CODE` | `CODE_ROLES` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/exterieur/forge-gitea.ts` | word order |
| `ROLES_REVUE` | `REVIEW_ROLES` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/db.ts`, `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `CHEMINS_PAR_ROLE` | `PATHS_BY_ROLE` | `orchestrateur/src/durcissement/stagnation.ts`, `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/src/exterieur/moteur-pousse.ts` |  |
| `roleProprietaire` | `ownerRole` | `orchestrateur/tests/chemins-interdits.test.ts`, `orchestrateur/src/exterieur/contrats.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `dansPerimetre` | `inScope` | `orchestrateur/tests/chemins-interdits.test.ts`, `orchestrateur/src/exterieur/forge-gitea.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `RolePublie` | `PublishedRole` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/exterieur/contrats.ts` |  |
| `ROLES_CADRAGE` | `SCOPING_ROLES` | `orchestrateur/src/db.ts`, `orchestrateur/src/exterieur/contrats.ts` |  |
| `EntreeTache` | `TaskInput` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/src/exterieur/moteur-pousse.ts` | override: `entree` = input for task data |
| `SortieTache` | `TaskOutput` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/src/exterieur/moteur-pousse.ts` |  |
| `MiseAJourSocle` | `CoreUpdate` | `orchestrateur/src/exterieur/contrats.ts`, `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/src/exterieur/forge-gitea.ts` |  |
| `MoteurAgent` | `AgentEngine` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/src/exterieur/contrats.ts`, `orchestrateur/src/exterieur/factices.ts` |  |
| `ResultatFusion` | `MergeResult` | `orchestrateur/src/exterieur/contrats.ts`, `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/src/exterieur/forge-gitea.ts` |  |
| `ResultatIntegration` | `IntegrationResult` | `orchestrateur/src/exterieur/contrats.ts`, `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/src/exterieur/forge-gitea.ts` |  |
| `ResultatCi` | `CiResult` | `orchestrateur/src/exterieur/forge-gitea.ts`, `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/src/exterieur/contrats.ts` |  |
| `Environnement` | `Environment` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/src/exterieur/deployeur-ssh.ts`, `orchestrateur/src/exterieur/contrats.ts` |  |
| `ResultatDeploiement` | `DeploymentResult` | `orchestrateur/src/exterieur/deployeur-ssh.ts`, `orchestrateur/src/exterieur/contrats.ts`, `orchestrateur/src/exterieur/factices.ts` |  |
| `Deployeur` | `Deployer` | `orchestrateur/src/exterieur/contrats.ts`, `orchestrateur/src/exterieur/deployeur-ssh.ts`, `orchestrateur/src/exterieur/factices.ts` |  |
| `ADRESSE_MAIL` | `MAIL_ADDRESS` | `orchestrateur/src/exterieur/notifications-smtp.ts`, `orchestrateur/src/auth.ts`, `orchestrateur/src/exterieur/contrats.ts` |  |
| `Exterieur` | `External` | `orchestrateur/src/exterieur/monde.ts`, `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/exterieur/factices.ts` |  |
| `OptionsDeployeurSsh` | `SshDeployerOptions` | `orchestrateur/src/exterieur/deployeur-ssh.ts` |  |
| `ErreurDeployeur` | `DeployerError` | `orchestrateur/src/exterieur/deployeur-ssh.ts`, `orchestrateur/tests/deployeur-ssh.test.ts` | its `name` is matched as a string (`ErreurDeployeur`) in `deployeur-ssh.ts` |
| `DeployeurSsh` | `SshDeployer` | `orchestrateur/tests/deployeur-ssh.test.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/exterieur/monde.ts` | word order |
| `empreinte` | `digest` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/features/gates-livraison.feature`, `orchestrateur/tests/db.test.ts` | function of `factices.ts` |
| `Guichet` | `Switchboard` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/tests/robustesse.test.ts` | see Dictionary requests |
| `ReponseMoteur` | `EngineResponse` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/features/steps/actions.ts`, `orchestrateur/tests/aides/banc.ts` |  |
| `ReponseSocle` | `CoreResponse` | `orchestrateur/src/exterieur/factices.ts` |  |
| `MoteurFactice` | `FakeEngine` | `orchestrateur/tests/service.test.ts`, `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/tests/aides/banc.ts` |  |
| `rapportConforme` | `compliantReport` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/tests/claude-sortie.test.ts`, `orchestrateur/src/exterieur/factices.ts` |  |
| `EcartScripte` | `ScriptedDeviation` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/src/exterieur/factices.ts` |  |
| `rapportAvecEcarts` | `reportWithDeviations` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/tests/claude-sortie.test.ts`, `orchestrateur/src/exterieur/factices.ts` |  |
| `rapportBloque` | `blockedReport` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/src/exterieur/factices.ts` |  |
| `rapportChevauchement` | `overlapReport` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/tests/aides/banc.ts`, `orchestrateur/features/steps/lanceur.ts` |  |
| `ReponseForge` | `ForgeResponse` | `orchestrateur/src/exterieur/factices.ts` |  |
| `ForgeFactice` | `FakeForge` | `orchestrateur/tests/config.test.ts`, `orchestrateur/tests/aides/banc.ts`, `orchestrateur/src/exterieur/factices.ts` |  |
| `ReponseDeploiement` | `DeploymentResponse` | `orchestrateur/src/exterieur/factices.ts` |  |
| `DeployeurFactice` | `FakeDeployer` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/tests/aides/banc.ts`, `orchestrateur/tests/config.test.ts` |  |
| `Envoi` | `SentMail` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/tests/aides/banc.ts`, `orchestrateur/web/lang/fr.json` | override: one mail recorded by the fake notifications |
| `NotificationsFactices` | `FakeNotifications` | `orchestrateur/tests/aides/banc.ts`, `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/tests/surveillance.test.ts` |  |
| `reponseHeureuse` | `happyResponse` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/tests/aides/banc.ts`, `orchestrateur/features/support/hooks.ts` |  |
| `signalHeureux` | `happySignal` | `orchestrateur/tests/aides/banc.ts`, `orchestrateur/src/exterieur/factices.ts` |  |
| `facticesAutomatiques` | `automaticFakes` | `orchestrateur/src/exterieur/monde.ts`, `orchestrateur/tests/aides/repro-planificateur.ts`, `orchestrateur/tests/roles/enfant.ts` |  |
| `lancerGuetteurFactice` | `launchFakeWatcher` | `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/src/main.ts` |  |
| `ErreurForge` | `ForgeError` | `orchestrateur/src/exterieur/forge-gitea.ts`, `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `verifierAdresse` | `verifyAddress` | `orchestrateur/src/exterieur/forge-gitea.ts`, `orchestrateur/src/exterieur/moteur-pousse.ts` |  |
| `echecsAcceptance` | `acceptanceFailures` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/src/exterieur/forge-gitea.ts` |  |
| `SortieGit` | `GitOutput` | `orchestrateur/src/exterieur/forge-gitea.ts` |  |
| `DepotGit` | `GitRepo` | `orchestrateur/src/exterieur/forge-gitea.ts`, `orchestrateur/scripts/essai-integration.ts`, `orchestrateur/src/exterieur/moteur-pousse.ts` |  |
| `OptionsDepotGit` | `GitRepoOptions` | `orchestrateur/src/exterieur/forge-gitea.ts` |  |
| `ForgeGitea` | `GiteaForge` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/tests/config.test.ts`, `orchestrateur/src/exterieur/monde.ts` | word order |
| `OptionsForgeGitea` | `GiteaForgeOptions` | `orchestrateur/src/exterieur/forge-gitea.ts` | word order |
| `mondeExterieur` | `externalWorld` | `orchestrateur/tests/config.test.ts`, `orchestrateur/scripts/essai-deploiement.ts`, `orchestrateur/src/main.ts` |  |
| `ROLES_LECTURE` | `READ_ROLES` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `ROLES_SANS_DEPOT` | `ROLES_WITHOUT_REPO` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/README.md` |  |
| `ROLES_EXEMPLE` | `EXAMPLE_ROLES` | `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `ETIQUETTE` | `LABEL` | `orchestrateur/src/exterieur/moteur-claude.ts` | override: a Docker label (`eupadev.tache` → `eupadev.task`) |
| `LIGNE_CLAUDE` | `CLAUDE_LINE` | `orchestrateur/tests/claude-sortie.test.ts`, `orchestrateur/scripts/generer-controle-claude.ts`, `orchestrateur/src/exterieur/moteur-claude.ts` | the Claude Code command line; replayed by `images/agent/controle/claude.sh` |
| `scriptConteneur` | `containerScript` | `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `SCRIPT_CONTENEUR` | `CONTAINER_SCRIPT` | `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `SCRIPT_SOCLE` | `CORE_SCRIPT` | `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `SCRIPT_SOCLE_MAJ` | `CORE_UPDATE_SCRIPT` | `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `packageJsonRefuse` | `packageJsonRefused` | `orchestrateur/tests/socle-moteur.test.ts`, `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `socleDuVerrou` | `coreFromLockfile` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/socle-moteur.test.ts` | override: `verrou` = the pnpm lockfile here, not a lock |
| `verrouRefuse` | `lockfileRefused` | `orchestrateur/tests/socle-moteur.test.ts`, `orchestrateur/src/exterieur/moteur-claude.ts` | override: lockfile |
| `OptionsMoteurClaude` | `ClaudeEngineOptions` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/moteur-claude.test.ts` |  |
| `LectureClaude` | `ClaudeRead` | `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `lireResultatClaude` | `readClaudeResult` | `orchestrateur/tests/claude-sortie.test.ts`, `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `lireCadre` | `readFrame` | `orchestrateur/tests/claude-sortie.test.ts`, `orchestrateur/src/exterieur/moteur-claude.ts` | the framed `EUPADEV-<FIELD>` output |
| `optionsRole` | `roleOptions` | `orchestrateur/tests/claude-sortie.test.ts`, `orchestrateur/scripts/generer-controle-claude.ts`, `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `MoteurClaudeCode` | `ClaudeCodeEngine` | `orchestrateur/tests/socle-moteur.test.ts`, `orchestrateur/tests/moteur-claude.test.ts`, `orchestrateur/scripts/essai-claude.ts` | word order |
| `contenuRefuse` | `contentRefused` | `orchestrateur/tests/claude-sortie.test.ts`, `orchestrateur/README.md`, `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `JEUX` | `FILE_SETS` | `orchestrateur/src/exterieur/moteur-pousse.ts` | override: `Set` would shadow the JS global |
| `Jeu` | `FileSet` | `orchestrateur/src/exterieur/moteur-pousse.ts`, `orchestrateur/scripts/essai-integration.ts` | override: `Set` would shadow the JS global |
| `jeuDuSlug` | `fileSetOfSlug` | `orchestrateur/scripts/essai-integration.ts`, `orchestrateur/src/exterieur/moteur-pousse.ts` |  |
| `fichiersDuJeu` | `fileSetFiles` | `orchestrateur/src/exterieur/moteur-pousse.ts` |  |
| `OptionsMoteurQuiPousse` | `PushingEngineOptions` | `orchestrateur/src/exterieur/moteur-pousse.ts` |  |
| `MoteurQuiPousse` | `PushingEngine` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/scripts/essai-integration.ts`, `orchestrateur/src/exterieur/monde.ts` |  |
| `Nature` | `Kind` | `orchestrateur/scripts/generer-mermaid.ts`, `orchestrateur/src/machine/etats.ts` |  |
| `Declencheur` | `Trigger` | `orchestrateur/src/machine/etats.ts` |  |
| `cleDeclencheur` | `triggerKey` | `orchestrateur/tests/machine.test.ts`, `orchestrateur/scripts/generer-transitions.ts`, `orchestrateur/features/support/hooks.ts` |  |
| `ETATS` | `STATES` | `orchestrateur/tests/machine.test.ts`, `orchestrateur/scripts/generer-mermaid.ts`, `orchestrateur/src/machine/etats.ts` |  |
| `Etat` | `State` | `orchestrateur/src/machine/etats.ts` |  |
| `ETAT_INITIAL` | `INITIAL_STATE` | `orchestrateur/tests/machine.test.ts`, `orchestrateur/scripts/generer-mermaid.ts`, `orchestrateur/src/machine/etats.ts` |  |
| `PlafondTache` | `TaskCap` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `SEUILS_PAR_DEFAUT` | `DEFAULT_THRESHOLDS` | `orchestrateur/src/config.ts`, `orchestrateur/src/machine/etats.ts`, `orchestrateur/tests/machine.test.ts` |  |
| `estDetourIncident` | `isIncidentDetour` | `orchestrateur/tests/machine.test.ts`, `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/machine/etats.ts` |  |
| `issuesDeGate` | `gateOutcomes` | `orchestrateur/tests/machine.test.ts`, `orchestrateur/src/api.ts`, `orchestrateur/src/orchestrateur.ts` |  |
| `enveloppeDeRallonge` | `topUpEnvelope` | `orchestrateur/tests/machine.test.ts`, `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `IssueGate` | `GateOutcome` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/features/steps/actions.ts`, `orchestrateur/src/workflows/cycleOutil.ts` | French `issue` = outcome |
| `ISSUES_GATE` | `GATE_OUTCOMES` | `orchestrateur/tests/machine.test.ts`, `orchestrateur/src/machine/etats.ts` |  |
| `BOITE` | `MAILBOX` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/messages.ts`, `orchestrateur/src/workflows/cycleOutil.ts` | value `'boite'` → `'mailbox'` (DBOS message topic) |
| `Humain` | `Human` | `orchestrateur/src/messages.ts` |  |
| `ControlePipeline` | `PipelineCheck` | `orchestrateur/src/messages.ts`, `orchestrateur/features/steps/actions.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `TYPES_HUMAINS` | `HUMAN_TYPES` | `orchestrateur/src/messages.ts` |  |
| `estHumain` | `isHuman` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/aides/banc.ts`, `orchestrateur/src/messages.ts` |  |
| `ResultatOperation` | `OperationResult` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/messages.ts` |  |
| `cleEvenement` | `eventKey` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/messages.ts` |  |
| `FORMAT_EMPREINTE` | `DIGEST_FORMAT` | `orchestrateur/src/messages.ts`, `orchestrateur/src/api.ts` |  |
| `FORMAT_UUID` | `UUID_FORMAT` | `orchestrateur/src/api.ts`, `orchestrateur/src/messages.ts` | word order |
| `RALLONGE_MAX_USD` | `MAX_TOP_UP_USD` | `orchestrateur/src/messages.ts`, `orchestrateur/src/api.ts` |  |
| `validerMessage` | `validateMessage` | `orchestrateur/tests/consignes.test.ts`, `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/api.ts` |  |
| `ROLE_MOTEUR` | `ENGINE_ROLE` | `orchestrateur/src/migrer.ts` | value `orch_moteur` → `orch_engine` |
| `migrerBase` | `migrateDatabase` | `orchestrateur/src/migrer.ts`, `orchestrateur/tests/aides/postgres-jetable.ts` | override: `base` = database (Dictionary requests) |
| `DOSSIERS_INTERDITS` | `FORBIDDEN_DIRS` | `orchestrateur/src/moteur/chemins-interdits.ts`, `orchestrateur/tests/chemins-interdits.test.ts` |  |
| `FICHIERS_INTERDITS` | `FORBIDDEN_FILES` | `orchestrateur/src/moteur/chemins-interdits.ts`, `orchestrateur/tests/chemins-interdits.test.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `cheminInterdit` | `forbiddenPath` | `orchestrateur/tests/chemins-interdits.test.ts`, `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/src/moteur/chemins-interdits.ts` |  |
| `reglesDenyManaged` | `managedDenyRules` | `orchestrateur/scripts/generer-controle-claude.ts`, `orchestrateur/tests/chemins-interdits.test.ts`, `orchestrateur/tests/claude-sortie.test.ts` |  |
| `motifsGitea` | `giteaPatterns` | `orchestrateur/tests/chemins-interdits.test.ts`, `orchestrateur/src/moteur/chemins-interdits.ts`, `infra/ansible/group_vars/forge/vars.yml` | override: `motif` = pattern here |
| `REGLES_PAR_ROLE` | `RULES_BY_ROLE` | `orchestrateur/tests/consignes.test.ts`, `orchestrateur/src/moteur/consignes.ts`, `orchestrateur/tests/mutations/mutations.ts` | values `securite`, `qualite` → `security`, `quality` (rule file names, template area) |
| `ConsignesParRole` | `InstructionsByRole` | `orchestrateur/src/moteur/consignes.ts`, `orchestrateur/src/workflows/deps.ts` |  |
| `sansFrontmatter` | `withoutFrontmatter` | `orchestrateur/tests/consignes.test.ts`, `orchestrateur/src/moteur/consignes.ts` |  |
| `chargerConsignes` | `loadInstructions` | `orchestrateur/tests/consignes.test.ts`, `orchestrateur/features/steps/lanceur.ts`, `orchestrateur/src/orchestrateur.ts` |  |
| `Rapport` | `Report` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/src/moteur/rapport.ts` |  |
| `PREUVE_RETENUE` | `RETAINED_EVIDENCE` | `orchestrateur/src/moteur/rapport.ts`, `orchestrateur/tests/a-r6.test.ts` | override: the report schema field is already `evidence` |
| `preuveTransmissible` | `transmissibleEvidence` | `orchestrateur/tests/a-r6.test.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/moteur/rapport.ts` | override: `evidence`, as above |
| `ValidateurRapport` | `ReportValidator` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/workflows/deps.ts`, `orchestrateur/src/moteur/rapport.ts` |  |
| `CLE_VERROU_MOTEUR` | `ENGINE_LOCK_KEY` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/tests/surveillance.test.ts` |  |
| `CLE_VERROU_EXECUTEUR` | `EXECUTOR_LOCK_KEY` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `ResultatEnvoi` | `SendResult` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/aides/banc.ts` |  |
| `Acteur` | `Actor` | `orchestrateur/src/api.ts`, `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/aides/banc.ts` |  |
| `ErreurAutorisation` | `AuthorizationError` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/api.ts` | its `name` string is compared in `api.ts` after crossing DBOS |
| `Demande` | `ToolRequest` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/MACHINE.md`, `orchestrateur/src/api.ts` | override: `Request` would shadow the fetch API global type |
| `validerDemande` | `validateRequest` | `orchestrateur/src/api.ts`, `orchestrateur/src/orchestrateur.ts` | `orchestrateur.ts` and `api.ts` |
| `ConflitIdempotence` | `IdempotencyConflict` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/api.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `Orchestrateur` | `Orchestrator` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/api.ts`, `orchestrateur/tests/service.test.ts` |  |
| `Fichier` | `StaticFile` | `orchestrateur/src/statique.ts`, `orchestrateur/src/api.ts`, `orchestrateur/features/support/monde.ts` | override: `File` would shadow the global |
| `construireStatique` | `buildStatic` | `orchestrateur/src/api.ts`, `orchestrateur/src/statique.ts`, `socle/src/http.js` |  |
| `fichierStatique` | `staticFile` | `orchestrateur/src/api.ts`, `orchestrateur/src/statique.ts` |  |
| `servirStatique` | `serveStatic` | `orchestrateur/src/api.ts`, `orchestrateur/src/statique.ts`, `socle/src/http.js` |  |
| `caractereInvisible` | `invisibleCharacter` | `orchestrateur/tests/consignes.test.ts`, `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/src/messages.ts` |  |
| `ROLES_DURCISSEMENT` | `HARDENING_ROLES` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/features/steps/verifications.ts`, `orchestrateur/features/steps/actions.ts` |  |
| `rolesDeLEcart` | `deviationRoles` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `relecteursSeuls` | `reviewersOnly` | `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `CompteursDurcissement` | `HardeningCounters` | `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `compteursDurcissement` | `hardeningCounters` | `orchestrateur/features/steps/verifications.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `creerCycleOutil` | `createToolCycle` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `CycleOutil` | `ToolCycle` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `FILE_TACHES` | `TASK_QUEUE` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/workflows/cycleOutil.ts` | value `taches-agents` → `agent-tasks` |
| `FILE_PILOTAGE` | `CONTROL_QUEUE` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/workflows/cycleOutil.ts` | value `pilotage` → `control` |
| `exigerPilote` | `requirePilot` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/workflows/deps.ts` |  |
| `idWorkflowCycle` | `cycleWorkflowId` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/aides/banc.ts`, `orchestrateur/tests/robustesse.test.ts` | word order |
| `idWorkflowTache` | `taskWorkflowId` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/src/workflows/deps.ts` |  |
| `SUJET_ANNULATION` | `CANCELLATION_TOPIC` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/workflows/deps.ts` | override: a DBOS topic; value `annulation` → `cancellation` |
| `VIVANT` | `ALIVE` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/workflows/deps.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `nouvelleGeneration` | `newGeneration` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/workflows/deps.ts` |  |
| `generationCourante` | `currentGeneration` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/workflows/tacheAgent.ts`, `orchestrateur/src/workflows/deps.ts` |  |
| `vivant` | `alive` | `orchestrateur/migrations/0002_machine-etats.sql`, `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` |  |
| `configurerEtapes` | `configureSteps` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/workflows/deps.ts` |  |
| `arreterEnfants` | `stopChildren` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/workflows/deps.ts` |  |
| `estDefinitive` | `isPermanent` | `orchestrateur/src/workflows/deps.ts` |  |
| `etape` | `step` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/db.test.ts`, `orchestrateur/features/steps/verifications.ts` |  |
| `etapeUnique` | `singleStep` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/workflows/tacheAgent.ts`, `orchestrateur/src/workflows/deps.ts` |  |
| `ETAPE_LANCER_PIPELINE_PREVIEW` | `LAUNCH_PREVIEW_PIPELINE_STEP` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/workflows/deps.ts` | its value is a DBOS step NAME read back by the watcher (see DBOS names) |
| `estErreurDuMoteurDBOS` | `isDbosEngineError` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/workflows/deps.ts` |  |
| `texteErreur` | `errorText` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/workflows/deps.ts` |  |
| `ArgsTache` | `TaskArgs` | `orchestrateur/src/workflows/tacheAgent.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `sortieHorsBornes` | `outputOutOfBounds` | `orchestrateur/src/workflows/tacheAgent.ts` |  |
| `creerTacheAgent` | `createAgentTask` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/workflows/tacheAgent.ts` |  |
| `TacheAgent` | `AgentTask` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/workflows/tacheAgent.ts` |  |
| `DEMANDEUR_MAIL` | `REQUESTER_MAIL` | `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/mails.test.ts`, `orchestrateur/tests/db.test.ts` | `tests/aides/banc.ts` |
| `DEMANDEUR` | `REQUESTER` | `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/aides/banc.ts`, `orchestrateur/tests/robustesse.test.ts` |  |
| `SUJETS` | `SUBJECTS` | `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/aides/banc.ts`, `orchestrateur/features/support/web.ts` |  |
| `casquettes` | `hats` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/tests/aides/banc.ts`, `orchestrateur/tests/service.test.ts` |  |
| `insererActeursDeTest` | `insertTestActors` | `orchestrateur/tests/aides/banc.ts`, `orchestrateur/tests/db.test.ts`, `orchestrateur/tests/mails.test.ts` |  |
| `Banc` | `Bench` | `orchestrateur/tests/roles.test.ts`, `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/tests/aides/banc.ts` |  |
| `Factices` | `Fakes` | `orchestrateur/README.md`, `orchestrateur/tests/aides/banc.ts`, `orchestrateur/tests/reprise/enfant.ts` |  |
| `demarrerBanc` | `startBench` | `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/features/support/hooks.ts` |  |
| `geler` | `freeze` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/tests/remplacement.test.ts`, `orchestrateur/tests/aides/banc.ts` |  |
| `libererGels` | `releaseFreezes` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/tests/aides/banc.ts`, `orchestrateur/tests/remplacement.test.ts` |  |
| `Pilote` | `Pilot` | `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/tests/remplacement.test.ts`, `orchestrateur/tests/robustesse.test.ts` | the bench's test driver class |
| `A_BRANCHER` | `TO_WIRE` | `orchestrateur/tests/aides/features.ts`, `orchestrateur/tests/couverture-features.test.ts` | value `@a-brancher` → `@to-wire` |
| `lireFeature` | `readFeature` | `orchestrateur/tests/aides/features.ts` |  |
| `fichiersFeature` | `featureFiles` | `orchestrateur/tests/aides/features.ts`, `orchestrateur/tests/couverture-features.test.ts` |  |
| `tousLesScenarios` | `allScenarios` | `orchestrateur/tests/aides/features.ts`, `orchestrateur/tests/couverture-features.test.ts` |  |
| `scenariosExecutes` | `executedScenarios` | `orchestrateur/tests/aides/features.ts`, `orchestrateur/tests/couverture-features.test.ts` |  |
| `nombreDExecutions` | `executionCount` | `orchestrateur/features/support/hooks.ts`, `orchestrateur/tests/couverture-features.test.ts`, `orchestrateur/tests/aides/features.ts` |  |
| `MailRecu` | `ReceivedMail` | `orchestrateur/tests/aides/mailpit-jetable.ts` |  |
| `MailpitJetable` | `ThrowawayMailpit` | `orchestrateur/tests/aides/mailpit-jetable.ts`, `orchestrateur/tests/mails.test.ts` |  |
| `demarrerMailpit` | `startMailpit` | `orchestrateur/tests/mails.test.ts`, `orchestrateur/tests/aides/mailpit-jetable.ts` |  |
| `EMETTEUR_TEST` | `TEST_ISSUER` | `orchestrateur/tests/auth.test.ts`, `orchestrateur/tests/aides/oidc-factice.ts`, `orchestrateur/tests/aides/banc.ts` |  |
| `Compte` | `Account` | `orchestrateur/tests/aides/oidc-factice.ts`, `orchestrateur/tests/web.test.ts`, `orchestrateur/tests/service.test.ts` |  |
| `OptionsJeton` | `TokenOptions` | `orchestrateur/tests/aides/oidc-factice.ts` |  |
| `MDP_WEB_TEST` | `WEB_TEST_PASSWORD` | `orchestrateur/tests/aides/oidc-factice.ts`, `orchestrateur/features/support/web.ts`, `orchestrateur/tests/service.test.ts` |  |
| `OidcFactice` | `FakeOidc` | `orchestrateur/features/support/web.ts`, `orchestrateur/tests/aides/oidc-factice.ts`, `orchestrateur/tests/auth.test.ts` |  |
| `demarrerOidcFactice` | `startFakeOidc` | `orchestrateur/features/support/web.ts`, `orchestrateur/tests/auth.test.ts`, `orchestrateur/tests/service.test.ts` |  |
| `PostgresJetable` | `ThrowawayPostgres` | `orchestrateur/tests/aides/postgres-jetable.ts`, `orchestrateur/features/support/hooks.ts`, `orchestrateur/tests/db.test.ts` |  |
| `migrer` | `migrate` | `orchestrateur/README.md`, `orchestrateur/tests/aides/postgres-jetable.ts`, `orchestrateur/tests/db.test.ts` | `tests/aides/postgres-jetable.ts` |
| `creerBase` | `createDatabase` | `orchestrateur/tests/db.test.ts`, `orchestrateur/features/support/hooks.ts`, `orchestrateur/tests/aides/postgres-jetable.ts` | override: `base` = database |
| `migrerTout` | `migrateAll` | `orchestrateur/tests/aides/postgres-jetable.ts`, `orchestrateur/features/support/hooks.ts` |  |
| `baseMigree` | `migratedDatabase` | `orchestrateur/tests/aides/repro-planificateur.ts`, `orchestrateur/tests/mails.test.ts`, `orchestrateur/tests/remplacement.test.ts` | override: `base` = database |
| `demarrerPostgres` | `startPostgres` | `orchestrateur/features/support/hooks.ts`, `orchestrateur/tests/aides/repro-planificateur.ts`, `orchestrateur/tests/db.test.ts` |  |
| `horsProtection` | `unprotected` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/README.md` | override: runs SQL with the protection triggers disabled |

### Identifiers shared across files: database access (`Base` → `Database`, `src/db.ts`)

| French | English | Where | Notes |
|---|---|---|---|
| `retenirCycle` | `retainCycle` | `orchestrateur/src/db.ts`, `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/src/orchestrateur.ts` |  |
| `lireCycle` | `readCycle` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/features/steps/actions.ts`, `orchestrateur/tests/service.test.ts` |  |
| `transiter` | `transition` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/db.test.ts`, `orchestrateur/tests/robustesse.test.ts` | verb; `Base.transiter` → `Database.transition` |
| `ecrireMemoire` | `writeMemory` | `orchestrateur/src/db.ts` |  |
| `lireMemoire` | `readMemory` | `orchestrateur/tests/remplacement.test.ts`, `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/src/db.ts` |  |
| `relances` | `reminders` | `orchestrateur/features/steps/verifications.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/robustesse.test.ts` | method and `SEUILS_PAR_DEFAUT.relances` |
| `relancer` | `remind` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/machine.test.ts` | override: records one reminder (returns `appliquee`/`deja_faite`); `relaunch` would read as restarting |
| `estPassePar` | `hasPassedThrough` | `orchestrateur/src/db.ts`, `orchestrateur/src/workflows/cycleOutil.ts` | override: idiom ("est passé par") |
| `tracer` | `trace` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/README.md`, `orchestrateur/src/db.ts` | writes a history row with a synthetic trigger |
| `creerTaches` | `createTasks` | `orchestrateur/src/db.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `tachesDuTour` | `roundTasks` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/db.ts` |  |
| `verdictCi` | `ciVerdict` | `orchestrateur/migrations/0006_taches-ci-vert.sql`, `orchestrateur/features/steps/lanceur.ts`, `orchestrateur/src/db.ts` |  |
| `lireTache` | `readTask` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/features/steps/verifications.ts`, `orchestrateur/tests/remplacement.test.ts` |  |
| `tachesDuCycle` | `cycleTasks` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/src/db.ts`, `orchestrateur/features/steps/actions.ts` |  |
| `derniereIteration` | `lastIteration` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/db.ts`, `orchestrateur/features/steps/verifications.ts` |  |
| `coutCumule` | `cumulativeCost` | `orchestrateur/src/db.ts`, `orchestrateur/features/steps/verifications.ts`, `orchestrateur/migrations/0009_mesure-cycles.sql` |  |
| `dureeTravailMin` | `workDurationMin` | `orchestrateur/src/db.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/robustesse.test.ts` |  |
| `derniereRemiseAZeroCadrage` | `lastScopingReset` | `orchestrateur/src/db.ts` |  |
| `echouerTachesOuvertes` | `failOpenTasks` | `orchestrateur/tests/db.test.ts`, `orchestrateur/src/db.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `derniereRemiseAZero` | `lastReset` | `orchestrateur/src/db.ts` |  |
| `iterationDeReprise` | `resumeIteration` | `orchestrateur/src/db.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/features/steps/verifications.ts` |  |
| `ecartsDepuis` | `deviationsSince` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/db.ts`, `orchestrateur/features/steps/verifications.ts` |  |
| `arbresParRole` | `treesByRole` | `orchestrateur/src/durcissement/stagnation.ts`, `orchestrateur/src/db.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `ecrireEcarts` | `writeDeviations` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/db.ts`, `orchestrateur/tests/db.test.ts` |  |
| `ecrireResultatsPipeline` | `writePipelineResults` | `orchestrateur/src/db.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/robustesse.test.ts` |  |
| `resultatsPipeline` | `pipelineResults` | `orchestrateur/src/db.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `ecrireMessage` | `writeMessage` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/features/steps/actions.ts`, `orchestrateur/src/db.ts` |  |
| `messagesDuCycle` | `cycleMessages` | `orchestrateur/features/steps/verifications.ts`, `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/src/db.ts` |  |
| `gate1Accordee` | `gate1Granted` | `orchestrateur/src/db.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `empreinteCandidate` | `candidateDigest` | `orchestrateur/tests/service.test.ts`, `orchestrateur/src/db.ts`, `orchestrateur/tests/robustesse.test.ts` | also the `Memoire` key (stored JSON) |
| `derniereProdSaine` | `lastHealthyProd` | `orchestrateur/src/db.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/robustesse.test.ts` |  |
| `origineIncident` | `incidentOrigin` | `orchestrateur/src/db.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `cyclesOuverts` | `openCycles` | `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/src/db.ts`, `orchestrateur/src/orchestrateur.ts` |  |
| `empreinteApprouveeGate2` | `gate2ApprovedDigest` | `orchestrateur/src/db.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/features/steps/actions.ts` |  |
| `ecrireDeploiement` | `writeDeployment` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/db.ts` |  |
| `cycleTermine` | `cycleFinished` | `orchestrateur/src/db.ts`, `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `catalogueOutils` | `toolCatalogue` | `orchestrateur/src/db.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/mutations/mutations.ts` | British spelling |
| `outils` | `tools` | `orchestrateur/features/durcissement-review.feature`, `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0001_schema.sql` | method |
| `creerCycle` | `createCycle` | `orchestrateur/tests/db.test.ts`, `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/tests/surveillance.test.ts` |  |
| `creerDemande` | `createRequest` | `orchestrateur/src/db.ts`, `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/robustesse.test.ts` |  |
| `resoudreActeur` | `resolveActor` | `orchestrateur/tests/db.test.ts`, `orchestrateur/src/api.ts`, `orchestrateur/src/db.ts` |  |
| `acteurParIdentite` | `actorByIdentity` | `orchestrateur/src/db.ts`, `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/db.test.ts` |  |
| `acteurCanonique` | `canonicalActor` | `orchestrateur/src/db.ts`, `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `mailActeur` | `actorMail` | `orchestrateur/src/db.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/orchestrateur.ts` |  |
| `fusionnerActeurs` | `mergeActors` | `orchestrateur/src/db.ts`, `orchestrateur/features/steps/actions.ts`, `orchestrateur/src/api.ts` |  |
| `appliquee` | `applied` | `orchestrateur/src/db.ts` | return value of `relancer`/`transiter` |
| `deja_faite` | `already_done` | `orchestrateur/src/db.ts`, `orchestrateur/tests/mutations/mutations.ts` | return value of `relancer`/`transiter` |

### Identifiers shared across files: orchestrator (`Orchestrateur` → `Orchestrator`, `src/orchestrateur.ts`)

| French | English | Where | Notes |
|---|---|---|---|
| `prendreVerrou` | `takeLock` | `orchestrateur/src/orchestrateur.ts` |  |
| `demarrer` | `start` | `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/src/workflows/tacheAgent.ts` | static `Orchestrateur.demarrer` |
| `arreter` | `stop` | `orchestrateur/tests/service.test.ts`, `orchestrateur/src/main.ts`, `orchestrateur/src/exterieur/deployeur-ssh.ts` |  |
| `estVivant` | `isAlive` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `balayer` | `sweep` | `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/remplacement.test.ts` | the monitoring sweep (`surveillance`) |
| `guetter` | `watch` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/exterieur/forge-gitea.ts`, `orchestrateur/src/exterieur/factices.ts` | the watcher's poll |
| `purgerPlanifies` | `purgeScheduled` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/README.md`, `orchestrateur/tests/surveillance.test.ts` |  |
| `demandeParCle` | `requestByKey` | `orchestrateur/src/api.ts`, `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/surveillance.test.ts` |  |
| `messageParCle` | `messageByKey` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/api.ts` |  |
| `sante` | `health` | `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/db.test.ts`, `orchestrateur/src/exterieur/deployeur-ssh.ts` | method and `/sante` route |
| `nouvelleDemande` | `newRequest` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/src/orchestrateur.ts`, `orchestrateur/README.md` |  |
| `envoyer` | `send` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/features/steps/actions.ts` |  |
| `estAttendu` | `isExpected` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/aides/banc.ts` |  |
| `transmis` | `transmitted` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/MACHINE.md` | `ResultatEnvoi.transmis` |
| `raison` | `reason` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/features/steps/actions.ts`, `orchestrateur/features/cadrage.feature` | `ResultatEnvoi.raison` and many shapes |
| `exterieur` | `external` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/tests/config.test.ts`, `orchestrateur/src/orchestrateur.ts` | field and `Deps.exterieur` |
| `cycleOutil` | `toolCycle` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/workflows/cycleOutil.ts` | field, DBOS workflow |
| `validateur` | `validator` | `orchestrateur/src/api.ts`, `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/workflows/deps.ts` | `Deps.validateur` |
| `consignes` | `instructions` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/tests/consignes.test.ts`, `orchestrateur/tests/moteur-claude.test.ts` | `Deps.consignes`, task input field |
| `casquette` | `hat` | `orchestrateur/tests/service.test.ts`, `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/api.ts` | message field (stored in `approbations.role`) |
| `derogation_quatre_yeux` | `four_eyes_exemption` | `orchestrateur/tests/db.test.ts`, `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/service.test.ts` | message field and SQL column |

### Identifiers shared across files: contracts of the outside world (`src/exterieur/contrats.ts`)

| French | English | Where | Notes |
|---|---|---|---|
| `tache_id` | `task_id` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/tests/moteur-claude.test.ts`, `orchestrateur/src/exterieur/factices.ts` | `EntreeTache` and `tache.md` JSON |
| `outil` | `tool` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0002_machine-etats.sql`, `orchestrateur/migrations/0012_machine-etats.sql` | `EntreeTache.outil` (the tool slug) |
| `contexte` | `context` | `orchestrateur/features/steps/verifications.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/features/cadrage.feature` | data given to the agent |
| `plafond` | `cap` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/machine/etats.ts` | `{ duree_min, tours, budget_usd }` |
| `duree_min` | `duration_min` | `orchestrateur/tests/config.test.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/config.ts` |  |
| `tours` | `turns` | `orchestrateur/features/durcissement-review.feature`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/durcissement/stagnation.ts` | override (`tour` in this shape = an agent model turn, `--max-turns`); a hardening round is `round` |
| `modele` | `model` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/features/steps/lanceur.ts`, `orchestrateur/src/config.ts` |  |
| `branche` | `branch` | `orchestrateur/tests/moteur-claude.test.ts`, `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `rapport` | `report` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/features/durcissement-review.feature`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `erreur` | `error` | `orchestrateur/migrations/0002_machine-etats.sql`, `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` |  |
| `cout_usd` | `cost_usd` | `orchestrateur/src/workflows/tacheAgent.ts`, `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/mutations/mutations.ts` | also SQL column |
| `duree_s` | `duration_s` | `orchestrateur/src/workflows/tacheAgent.ts`, `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/src/db.ts` | also SQL column |
| `entree` | `input` | `orchestrateur/tests/moteur-claude.test.ts`, `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/src/exterieur/moteur-pousse.ts` | override (task data); the phase `entree` is `entry` |
| `sortie` | `output` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/deployeur-ssh.test.ts`, `orchestrateur/src/workflows/tacheAgent.ts` |  |
| `arbre_hash` | `tree_hash` | `orchestrateur/src/workflows/tacheAgent.ts`, `orchestrateur/src/db.ts`, `orchestrateur/features/steps/verifications.ts` | also SQL column |
| `de` | `from` | `orchestrateur/features/durcissement-review.feature`, `orchestrateur/migrations/0015_machine-etats.sql`, `orchestrateur/migrations/0012_machine-etats.sql` | `MiseAJourSocle.de`, `Transition.de`; SQL column `de` → `from_state` (reserved word) |
| `vers` | `to` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/tests/machine.test.ts`, `orchestrateur/tests/db.test.ts` | `MiseAJourSocle.vers`, `Transition.vers`; SQL column `vers` → `to_state` (reserved word) |
| `verrou` | `lockfile` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/socle-moteur.test.ts` | override: `MiseAJourSocle.verrou` is the pnpm lockfile text |
| `executer` | `execute` | `orchestrateur/tests/moteur-claude.test.ts`, `orchestrateur/src/workflows/tacheAgent.ts`, `orchestrateur/tests/forge-gitea.test.ts` | `MoteurAgent.executer` |
| `socleAJour` | `coreUpToDate` | `orchestrateur/tests/socle-moteur.test.ts`, `orchestrateur/src/exterieur/contrats.ts`, `orchestrateur/src/exterieur/factices.ts` |  |
| `resultat` | `result` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/features/steps/actions.ts`, `orchestrateur/tests/aides/claude-factice/claude` | `ResultatFusion`, `ResultatIntegration`, check result |
| `fichiers` | `files` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/src/exterieur/moteur-pousse.ts`, `orchestrateur/src/exterieur/forge-gitea.ts` |  |
| `fichier` | `file` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/tests/config.test.ts`, `orchestrateur/features/durcissement-review.feature` |  |
| `issue` | `outcome` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/features/steps/actions.ts`, `orchestrateur/src/messages.ts` | French `issue`; English `issue` (Gitea ticket) unaffected |
| `controles` | `checks` | `orchestrateur/src/exterieur/forge-gitea.ts`, `orchestrateur/src/messages.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `controle` | `check` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/features/steps/actions.ts` |  |
| `creerDepot` | `createRepo` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/scripts/essai-forge.ts`, `orchestrateur/src/exterieur/contrats.ts` |  |
| `publier` | `publish` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/features/entree-chevauchement.feature` |  |
| `publierSocle` | `publishCore` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/src/exterieur/contrats.ts`, `orchestrateur/src/exterieur/factices.ts` |  |
| `integrer` | `integrate` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/src/exterieur/forge-gitea.ts`, `orchestrateur/src/exterieur/contrats.ts` |  |
| `fusionner` | `merge` | `orchestrateur/tests/db.test.ts`, `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/src/exterieur/forge-gitea.ts` |  |
| `ciTerminee` | `ciFinished` | `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/scripts/essai-ci.ts` |  |
| `lancerPipelinePreview` | `launchPreviewPipeline` | `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/src/exterieur/contrats.ts`, `orchestrateur/src/exterieur/forge-gitea.ts` |  |
| `pipelinePreviewTermine` | `previewPipelineFinished` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/scripts/essai-preview.ts` |  |
| `depuis` | `since` | `orchestrateur/migrations/0002_machine-etats.sql`, `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` |  |
| `deployer` | `deploy` | `orchestrateur/tests/deployeur-ssh.test.ts`, `orchestrateur/src/exterieur/deployeur-ssh.ts`, `orchestrateur/scripts/essai-deploiement.ts` | verb (`Deployeur.deployer`) |
| `retirer` | `remove` | `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/deployeur-ssh.test.ts` |  |
| `servi` | `served` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/deployeur-ssh.test.ts`, `orchestrateur/tests/surveillance.test.ts` |  |
| `notifier` | `notify` | `orchestrateur/tests/mails.test.ts`, `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `destinataire` | `recipient` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/tests/mails.test.ts`, `orchestrateur/src/exterieur/notifications-smtp.ts` |  |
| `sujet` | `subject` | `orchestrateur/tests/auth.test.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/tests/service.test.ts` | mail subject here; OIDC subject in `acteurs_identites` |
| `contenu` | `content` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `cle` | `key` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/mails.test.ts` | idempotency key |
| `moteur` | `engine` | `orchestrateur/README.md`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/features/durcissement-review.feature` | `Exterieur.moteur` |
| `deployeur` | `deployer` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/tests/aides/banc.ts`, `orchestrateur/tests/surveillance.test.ts` | `Exterieur.deployeur` |

### Identifiers shared across files: configuration (`Config`, `Delais`, `Reessais`, `src/config.ts`)

| French | English | Where | Notes |
|---|---|---|---|
| `adresseEscaladeAdmin` | `adminEscalationAddress` | `orchestrateur/src/config.ts` |  |
| `domaineOutils` | `toolDomain` | `orchestrateur/src/config.ts`, `orchestrateur/src/main.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `urlTableauDeBord` | `dashboardUrl` | `orchestrateur/src/api.ts`, `orchestrateur/src/config.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `concurrenceAgents` | `agentConcurrency` | `orchestrateur/src/config.ts`, `orchestrateur/src/main.ts`, `orchestrateur/src/orchestrateur.ts` |  |
| `cheminSchemaRapport` | `reportSchemaPath` | `orchestrateur/src/config.ts`, `orchestrateur/src/orchestrateur.ts` |  |
| `cheminConsignes` | `instructionsPath` | `orchestrateur/src/config.ts`, `orchestrateur/features/steps/lanceur.ts`, `orchestrateur/src/orchestrateur.ts` |  |
| `cheminWeb` | `webPath` | `orchestrateur/src/config.ts`, `orchestrateur/src/api.ts` |  |
| `cheminDeepChat` | `deepChatPath` | `orchestrateur/src/config.ts`, `orchestrateur/src/statique.ts`, `orchestrateur/src/api.ts` |  |
| `surveillanceCron` | `monitoringCron` | `orchestrateur/src/config.ts`, `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `guetteurCron` | `watcherCron` | `orchestrateur/src/config.ts`, `orchestrateur/src/orchestrateur.ts` |  |
| `delais` | `timeouts` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/config.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `reessais` | `retries` | `orchestrateur/src/workflows/deps.ts`, `orchestrateur/src/config.ts`, `orchestrateur/src/orchestrateur.ts` |  |
| `seuils` | `thresholds` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/durcissement/stagnation.ts` |  |
| `modeles` | `models` | `orchestrateur/src/config.ts`, `orchestrateur/src/workflows/tacheAgent.ts` |  |
| `adresse` | `address` | `orchestrateur/src/exterieur/notifications-smtp.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/exterieur/forge-gitea.ts` | `api.adresse` |
| `quatreYeuxDerogationSujet` | `fourEyesExemptionSubject` | `orchestrateur/src/config.ts`, `orchestrateur/tests/config.test.ts`, `orchestrateur/src/orchestrateur.ts` |  |
| `relance_ms` | `reminder_ms` | `orchestrateur/src/config.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `tache_ms` | `task_ms` | `orchestrateur/src/config.ts`, `orchestrateur/tests/config.test.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `attente_longue_ms` | `long_wait_ms` | `orchestrateur/src/config.ts`, `orchestrateur/src/workflows/cycleOutil.ts` | override: `attente` as a noun = wait |
| `relance_longue_ms` | `long_reminder_ms` | `orchestrateur/src/config.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `sondage_ms` | `polling_ms` | `orchestrateur/src/config.ts`, `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/main.ts` |  |
| `reessai_incident_ms` | `incident_retry_ms` | `orchestrateur/src/config.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `tentatives` | `attempts` | `orchestrateur/features/cadrage.feature`, `orchestrateur/src/machine/etats.ts`, `orchestrateur/migrations/0002_machine-etats.sql` |  |
| `intervalle_ms` | `interval_ms` | `orchestrateur/src/config.ts`, `orchestrateur/src/workflows/deps.ts` |  |
| `emetteur` | `issuer` | `orchestrateur/src/db.ts`, `orchestrateur/tests/auth.test.ts`, `orchestrateur/src/auth.ts` | `OptionsOidc.emetteur` |
| `tout-en-un` | `all-in-one` | `orchestrateur/README.md`, `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/config.ts` | `EUPADEV_ROLE` value |
| `pilote` | `pilot` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/tests/roles.test.ts`, `orchestrateur/tests/mutations/mutations.ts` | `EUPADEV_ROLE` value |
| `executeur` | `executor` | `orchestrateur/tests/roles.test.ts`, `orchestrateur/src/config.ts`, `orchestrateur/tests/config.test.ts` | `EUPADEV_ROLE` value |
| `executeur-agents` | `agent-executor` | `orchestrateur/README.md`, `orchestrateur/src/config.ts`, `orchestrateur/tests/config.test.ts` | DBOS `executor_id` of the executor (`VMID_EXECUTEUR`) |

### Identifiers shared across files: thresholds (`SEUILS_PAR_DEFAUT`, `src/machine/etats.ts`)

| French | English | Where | Notes |
|---|---|---|---|
| `cadrage` | `scoping` | `orchestrateur/MACHINE.md`, `orchestrateur/features/cadrage.feature`, `orchestrateur/migrations/0012_machine-etats.sql` | key of the thresholds, of `Memoire` and of the cost envelopes |
| `durcissement` | `hardening` | `orchestrateur/features/durcissement-review.feature`, `orchestrateur/src/machine/etats.ts`, `orchestrateur/MACHINE.md` |  |
| `tache` | `task` | `orchestrateur/tests/moteur-claude.test.ts`, `orchestrateur/src/machine/etats.ts`, `orchestrateur/MACHINE.md` | per-role caps |
| `plafond_tentatives` | `attempts_cap` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/machine.test.ts` |  |
| `duree_travail_agents_min` | `agent_work_duration_min` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `plafond_tours` | `rounds_cap` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `intervalle_h` | `interval_h` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/tests/machine.test.ts`, `orchestrateur/src/config.ts` |  |
| `nombre` | `count` | `orchestrateur/tests/mutations/cliquet.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `pause_apres_h` | `pause_after_h` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/tests/machine.test.ts` |  |
| `pause_archive_apres_jours` | `pause_archive_after_days` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/src/config.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `attente_ci_max_min` | `ci_wait_max_min` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/machine/etats.ts`, `orchestrateur/tests/mutations/mutations.ts` | override: noun = wait |
| `attente_disponibilite_s` | `availability_wait_s` | `orchestrateur/src/machine/etats.ts` | override: noun = wait |
| `ordre_raisons_escalade` | `escalation_reasons_order` | `orchestrateur/src/machine/etats.ts` |  |
| `FILET_MESURE` | `MEASUREMENT_NET` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `CADRAGE` | `SCOPING` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/tests/mutations/mutations.ts` | constant of `etats.ts` |

### Identifiers shared across files: workflow memory (`memoire_cycles.memoire`, stored JSON, `Memoire`)

| French | English | Where | Notes |
|---|---|---|---|
| `memeErreur` | `sameError` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/db.ts` | inside `cadrage` |
| `derniereErreur` | `lastError` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/features/steps/verifications.ts`, `orchestrateur/src/db.ts` | inside `cadrage` |
| `consigne` | `instruction` | `orchestrateur/tests/remplacement.test.ts`, `orchestrateur/migrations/0002_machine-etats.sql`, `orchestrateur/migrations/0012_machine-etats.sql` | human text passed to the next task |
| `precisionAdmin` | `adminClarification` | `orchestrateur/src/db.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `messageEnAttente` | `pendingMessage` | `orchestrateur/src/db.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/mutations/mutations.ts` | override: "en attente" = pending |
| `erreurPrecedente` | `previousError` | `orchestrateur/src/db.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `motifGate` | `gateReason` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/db.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `motifAvantIncident` | `reasonBeforeIncident` | `orchestrateur/src/db.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `revueSeule` | `reviewOnly` | `orchestrateur/src/db.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/robustesse.test.ts` |  |
| `tour` | `round` | `orchestrateur/features/durcissement-review.feature`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/robustesse.test.ts` | `revueSeule.tour` |

### Identifiers shared across files: row shapes (`Cycle`, `Tache`, `LigneEcart`, `CatalogueOutil`)

| French | English | Where | Notes |
|---|---|---|---|
| `outil_id` | `tool_id` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/src/db.ts` |  |
| `nom` | `name` | `orchestrateur/src/config.ts`, `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `demandeur_id` | `requester_id` | `orchestrateur/tests/db.test.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/db.ts` |  |
| `etat` | `state` | `orchestrateur/src/db.ts`, `orchestrateur/tests/db.test.ts`, `orchestrateur/tests/moteur-claude.test.ts` |  |
| `dernier_declencheur` | `last_trigger` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/src/db.ts` |  |
| `budget_cadrage_usd` | `scoping_budget_usd` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `budget_durcissement_usd` | `hardening_budget_usd` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/src/db.ts` |  |
| `termine_le` | `finished_at` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/src/db.ts` |  |
| `visite` | `visit` | `orchestrateur/tests/db.test.ts`, `orchestrateur/src/db.ts`, `orchestrateur/tests/service.test.ts` | the pass identifier in a state (B9) |
| `entree_ms` | `entry_ms` | `orchestrateur/src/db.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/orchestrateur.ts` | first entry in the state |
| `etape` | `step` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/db.test.ts`, `orchestrateur/features/steps/verifications.ts` | `Tache.etape` (state id the task runs for) |
| `statut` | `status` | `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/tests/db.test.ts` |  |
| `constat_id` | `finding_id` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/db.test.ts`, `orchestrateur/src/db.ts` |  |
| `role_cible` | `target_role` | `orchestrateur/migrations/0013_ecart-role-cible.sql`, `orchestrateur/src/db.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `service_proprietaire` | `owner_service` | `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/db.test.ts`, `orchestrateur/tests/robustesse.test.ts` |  |
| `archive` | `archived` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/deployeur-ssh.test.ts`, `orchestrateur/src/exterieur/deployeur-ssh.ts` | `CatalogueOutil.archive` (boolean) |
| `derniere_ms` | `last_ms` | `orchestrateur/src/db.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |

### Identifiers shared across files: data given to agents (`tache.md`, task context)

| French | English | Where | Notes |
|---|---|---|---|
| `donnees` | `data` | `orchestrateur/src/exterieur/deployeur-ssh.ts`, `orchestrateur/src/exterieur/forge-gitea.ts`, `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `precision_admin` | `admin_clarification` | `orchestrateur/features/steps/verifications.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/robustesse.test.ts` |  |
| `catalogue_outils` | `tool_catalogue` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/moteur-claude.test.ts`, `orchestrateur/tests/mutations/mutations.ts` | British spelling |
| `erreur_precedente` | `previous_error` | `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `rapports_precedents` | `previous_reports` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/features/steps/verifications.ts` |  |
| `constats_builder` | `builder_findings` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/features/steps/verifications.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `ecarts` | `deviations` | `orchestrateur/tests/db.test.ts`, `orchestrateur/src/durcissement/stagnation.ts`, `orchestrateur/src/workflows/cycleOutil.ts` | `{ rule, file, category, texte }` → `{ rule, file, category, text }` |
| `ecarts_precedents` | `previous_deviations` | `orchestrateur/features/steps/verifications.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `texte` | `text` | `orchestrateur/features/steps/verifications.ts`, `orchestrateur/features/steps/actions.ts`, `orchestrateur/features/gates-livraison.feature` |  |
| `/tmp/tache/` | `/tmp/task/` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/aides/claude-factice/claude`, `orchestrateur/tests/moteur-claude.test.ts` | agent container; also `images/agent/managed-settings.json`, template instructions |
| `/tmp/tache/tache.md` | `/tmp/task/task.md` | `orchestrateur/tests/aides/claude-factice/claude`, `orchestrateur/src/exterieur/moteur-claude.ts`, `images/agent/controle/essai-amont/verifier.mjs` |  |
| `/tmp/tache/consignes.md` | `/tmp/task/instructions.md` | `orchestrateur/scripts/generer-controle-claude.ts`, `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/aides/claude-factice/claude` |  |
| `/tmp/tache/entree.bundle` | `/tmp/task/input.bundle` | `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `/tmp/tache/suite/` | `/tmp/task/suite/` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/moteur-claude.test.ts`, `template-outil-ia/agents/builder.md` | `suite` already English |
| `/tmp/tache/exemple/` | `/tmp/task/example/` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/moteur-claude.test.ts`, `template-outil-ia/AGENTS.fr.md` |  |
| `/tmp/sortie/` | `/tmp/output/` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/scripts/generer-controle-claude.ts`, `images/agent/controle/claude.sh` |  |
| `sortie.bundle` | `output.bundle` | `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `resultat.json` | `result.json` | `images/agent/controle/essai-amont/essai.sh` |  |
| `erreurs.txt` | `errors.txt` | `images/agent/controle/essai-amont/essai.sh` |  |
| `$HOME/depot` | `$HOME/repo` | `orchestrateur/src/exterieur/moteur-claude.ts`, `images/agent/controle/essai-amont/essai.sh` |  |
| `$HOME/travail` | `$HOME/work` | `orchestrateur/src/exterieur/moteur-claude.ts`, `images/agent/controle/essai-amont/essai.sh` |  |
| `travail` | `work` | `orchestrateur/tests/moteur-claude.test.ts`, `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/src/exterieur/moteur-claude.ts` | the bundle's branch (`refs/heads/travail`) |
| `FA_MODELE` | `FA_MODEL` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/scripts/generer-controle-claude.ts`, `orchestrateur/src/exterieur/moteur-claude.ts` | Claude command-line variable (also `images/agent/controle/claude.sh`) |
| `FA_OUTILS` | `FA_TOOLS` | `orchestrateur/scripts/generer-controle-claude.ts`, `orchestrateur/src/exterieur/moteur-claude.ts`, `images/agent/controle/essai-amont/essai.sh` |  |
| `FA_AUTORISATIONS` | `FA_PERMISSIONS` | `orchestrateur/scripts/generer-controle-claude.ts`, `orchestrateur/src/exterieur/moteur-claude.ts`, `images/agent/controle/essai-amont/essai.sh` | override: Claude Code permission rules |
| `FA_TOURS` | `FA_TURNS` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/scripts/generer-controle-claude.ts`, `orchestrateur/src/exterieur/moteur-claude.ts` | override: `tours` = model turns (`--max-turns`) |
| `FA_SOCLE_REGISTRE` | `FA_CORE_REGISTRY` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/tests/socle-moteur.test.ts`, `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `EUPADEV-RESULTAT` | `EUPADEV-RESULT` | `orchestrateur/src/exterieur/moteur-claude.ts` | framed output line |
| `EUPADEV-ERREURS` | `EUPADEV-ERRORS` | `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `EUPADEV-VERROU` | `EUPADEV-LOCKFILE` | `orchestrateur/src/exterieur/moteur-claude.ts` | override: `verrou` = lockfile (Dictionary requests) |
| `/tmp/socle` | `/tmp/core` | `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `$HOME/.socle-fetch` | `$HOME/.core-fetch` | `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `OUTILS_CODE` | `CODE_TOOLS` | `orchestrateur/src/exterieur/moteur-claude.ts` | Claude tool lists |
| `OUTILS_LECTURE` | `READ_TOOLS` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `OUTILS_RELECTURE` | `REVIEW_TOOLS` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `PART_BUDGET` | `BUDGET_SHARE` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `SORTIE_MAX_OCTETS` | `MAX_OUTPUT_BYTES` | `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `CONTENU_EXEMPLE` | `EXAMPLE_CONTENT` | `orchestrateur/src/exterieur/moteur-claude.ts` |  |

### Identifiers shared across files: fakes and their switchboard (`src/exterieur/factices.ts`)

| French | English | Where | Notes |
|---|---|---|---|
| `guichet` | `switchboard` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/tests/aides/banc.ts` | field of every fake (`forge.guichet`, `moteur.guichet`) |
| `attentes` | `pending` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/MACHINE.md`, `orchestrateur/README.md` | override: pending requests of the switchboard |
| `preparees` | `prepared` | `orchestrateur/src/exterieur/factices.ts` |  |
| `journal` | `log` | `orchestrateur/tests/roles.test.ts`, `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/tests/mails.test.ts` | the switchboard's call log, also `journalForgeAvant`… |
| `demander` | `ask` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/tests/reprise/enfant.ts`, `orchestrateur/tests/robustesse.test.ts` |  |
| `repondre` | `answer` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/src/api.ts`, `orchestrateur/src/exterieur/factices.ts` | override: the switchboard's `repondre` → `answer`; the HTTP helper of `api.ts` → `respond` (other row) |
| `enAttente` | `pendingFor` | `orchestrateur/src/exterieur/factices.ts` | override: method `enAttente(prefixe)` → `pendingFor(prefix)`; `pending` is the property `attentes` of the same class (step 4a) |
| `reconsiderer` | `reconsider` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/tests/aides/banc.ts` |  |
| `reinitialiser` | `reset` | `orchestrateur/src/exterieur/factices.ts`, `exemples/demandes/tests/kit.test.js`, `socle/tests/kit.test.js` |  |
| `clesDeRepli` | `fallbackKeys` | `orchestrateur/src/exterieur/factices.ts` |  |
| `retenir` | `retain` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/tests/aides/banc.ts` |  |
| `politique` | `policy` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/tests/aides/banc.ts` |  |
| `resoudre` | `resolve` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/src/exterieur/forge-gitea.ts`, `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `rejeter` | `reject` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/src/exterieur/forge-gitea.ts`, `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `graine` | `seed` | `orchestrateur/src/exterieur/factices.ts`, `socle/src/auth.js`, `socle/tests/auth-unitaire.test.js` |  |
| `genre` | `type` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/exterieur/factices.ts` | discriminant of fake answers and of `ResultatOperation` |
| `repondu` | `answered` | `orchestrateur/src/exterieur/factices.ts` | return value of `repondre` |
| `prepare` | `prepared` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/tests/image-fixe.test.ts` | return value of `repondre` |
| `soclesPrepares` | `preparedCores` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/features/steps/actions.ts` |  |
| `coutParDefaut` | `defaultCost` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/src/exterieur/factices.ts` |  |
| `dureeParDefaut_s` | `defaultDuration_s` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/src/exterieur/factices.ts` |  |
| `dernieresEmpreintes` | `lastDigests` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/features/steps/actions.ts` |  |
| `appels` | `calls` | `orchestrateur/tests/deployeur-ssh.test.ts`, `orchestrateur/tests/socle-moteur.test.ts`, `orchestrateur/tests/surveillance.test.ts` |  |
| `enCours` | `inProgress` | `orchestrateur/tests/db.test.ts`, `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/tests/robustesse.test.ts` |  |
| `apres_s` | `after_s` | `orchestrateur/src/exterieur/factices.ts` |  |
| `servie` | `served` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/exterieur/factices.ts` |  |
| `actifs` | `active` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/MACHINE.md`, `orchestrateur/scripts/generer-mermaid.ts` |  |
| `envois` | `sent` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/features/durcissement-review.feature` | override: mails sent by the fake |
| `empreinteCi` | `ciDigest` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/tests/remplacement.test.ts`, `orchestrateur/tests/aides/banc.ts` |  |
| `ciReelle` | `realCi` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `previewReelle` | `realPreview` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `sonder` | `poll` | `orchestrateur/src/exterieur/factices.ts` | override: polls the forge |
| `minuteur` | `timer` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/README.md`, `orchestrateur/tests/mutations/lancer.ts` |  |

### Identifiers shared across files: test bench and Cucumber World (`tests/aides/banc.ts`, `features/support/monde.ts`)

| French | English | Where | Notes |
|---|---|---|---|
| `pannes` | `faults` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/tests/aides/banc.ts`, `orchestrateur/tests/robustesse.test.ts` |  |
| `gels` | `freezes` | `orchestrateur/tests/aides/banc.ts`, `orchestrateur/README.md` |  |
| `promesse` | `promise` | `orchestrateur/tests/aides/banc.ts`, `orchestrateur/tests/surveillance.test.ts` |  |
| `liberer` | `release` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/tests/aides/banc.ts`, `orchestrateur/tests/surveillance.test.ts` |  |
| `pertesVerrou` | `lockLosses` | `orchestrateur/tests/aides/banc.ts`, `orchestrateur/tests/surveillance.test.ts` |  |
| `preparer` | `prepare` | `orchestrateur/tests/aides/banc.ts` |  |
| `etat` | `state` | `orchestrateur/src/db.ts`, `orchestrateur/tests/db.test.ts`, `orchestrateur/tests/moteur-claude.test.ts` | method `Pilote.etat` |
| `historique` | `history` | `orchestrateur/migrations/0002_machine-etats.sql`, `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` |  |
| `attendre` | `wait` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/features/steps/verifications.ts`, `orchestrateur/tests/roles.test.ts` |  |
| `attendreEtat` | `waitForState` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/tests/remplacement.test.ts` |  |
| `statutW1` | `statusW1` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/tests/roles.test.ts`, `orchestrateur/tests/remplacement.test.ts` |  |
| `boiteVide` | `mailboxEmpty` | `orchestrateur/tests/aides/banc.ts`, `orchestrateur/features/steps/verifications.ts`, `orchestrateur/tests/robustesse.test.ts` |  |
| `attendreFinWorkflow` | `waitForWorkflowEnd` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/features/steps/actions.ts`, `orchestrateur/tests/surveillance.test.ts` |  |
| `envoyerQuandAttendu` | `sendWhenExpected` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/tests/remplacement.test.ts`, `orchestrateur/tests/robustesse.test.ts` |  |
| `nouvelleEmpreinte` | `newDigest` | `orchestrateur/tests/aides/banc.ts`, `orchestrateur/tests/surveillance.test.ts` |  |
| `messageHeureux` | `happyMessage` | `orchestrateur/tests/aides/banc.ts` |  |
| `conduireJusqua` | `driveUntil` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/tests/remplacement.test.ts` |  |
| `cible` | `target` | `orchestrateur/tests/machine.test.ts`, `orchestrateur/tests/aides/banc.ts`, `orchestrateur/tests/deployeur-ssh.test.ts` |  |
| `lenteurs` | `slownesses` | `orchestrateur/tests/aides/banc.ts`, `orchestrateur/tests/reprise/enfant.ts` |  |
| `panneDans` | `faultIn` | `orchestrateur/tests/aides/banc.ts`, `orchestrateur/features/steps/actions.ts` |  |
| `banc` | `bench` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/features/steps/verifications.ts` |  |
| `pilote` | `pilot` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/tests/roles.test.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `outilId` | `toolId` | `orchestrateur/src/db.ts`, `orchestrateur/features/steps/actions.ts`, `orchestrateur/tests/db.test.ts` |  |
| `curseurs` | `cursors` | `orchestrateur/features/support/monde.ts`, `orchestrateur/features/support/hooks.ts`, `orchestrateur/features/steps/actions.ts` |  |
| `miseEnSituation` | `setup` | `orchestrateur/features/support/hooks.ts`, `orchestrateur/features/support/monde.ts` | override: the "Given" setup lines |
| `debut` | `start` | `orchestrateur/scripts/generer-mermaid.ts`, `orchestrateur/src/exterieur/moteur-pousse.ts`, `orchestrateur/tests/surveillance.test.ts` |  |
| `borne` | `bound` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/tests/machine.test.ts`, `orchestrateur/features/support/hooks.ts` |  |
| `curseurEvaluation` | `evaluationCursor` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/features/support/monde.ts` |  |
| `acteurSecond` | `secondActor` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/features/support/monde.ts` |  |
| `fusionsAvant` | `mergesBefore` | `orchestrateur/features/support/monde.ts`, `orchestrateur/features/steps/actions.ts`, `orchestrateur/features/steps/verifications.ts` |  |
| `journalForgeAvant` | `forgeLogBefore` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/features/steps/verifications.ts`, `orchestrateur/features/support/monde.ts` |  |
| `journalMoteurAvant` | `engineLogBefore` | `orchestrateur/features/support/monde.ts`, `orchestrateur/features/steps/actions.ts`, `orchestrateur/features/steps/verifications.ts` |  |
| `horsPerimetre` | `outOfScope` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/features/support/monde.ts` |  |
| `cibles` | `targets` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/features/steps/actions.ts`, `orchestrateur/features/support/monde.ts` |  |
| `scriptes` | `scripted` | `orchestrateur/features/support/hooks.ts`, `orchestrateur/features/support/monde.ts` |  |
| `deploiements` | `deployments` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/features/gates-livraison.feature` |  |
| `basesVides` | `emptyDatabases` | `orchestrateur/features/support/monde.ts`, `orchestrateur/features/steps/actions.ts`, `orchestrateur/features/support/hooks.ts` |  |
| `tacheEnCours` | `runningTask` | `orchestrateur/features/steps/verifications.ts`, `orchestrateur/features/steps/actions.ts`, `orchestrateur/features/support/monde.ts` | override: idiom ("tâche en cours" = running task) |
| `tachesOuvertes` | `openTasks` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/features/steps/verifications.ts`, `orchestrateur/features/support/monde.ts` |  |
| `precisionVue` | `clarificationSeen` | `orchestrateur/features/steps/verifications.ts`, `orchestrateur/features/support/monde.ts` | override: `vue` = seen (participle) |
| `baseDuDemarrage` | `startupDatabase` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/features/support/monde.ts`, `orchestrateur/features/steps/verifications.ts` | override: `base` = database |
| `cycleDe` | `cycleOf` | `orchestrateur/tests/roles.test.ts`, `orchestrateur/features/steps/chat.ts`, `orchestrateur/features/support/monde.ts` |  |
| `laisserPasser` | `letThrough` | `orchestrateur/features/steps/verifications.ts`, `orchestrateur/features/support/monde.ts`, `orchestrateur/features/steps/actions.ts` |  |
| `idTache` | `taskId` | `orchestrateur/features/steps/verifications.ts`, `orchestrateur/features/steps/lanceur.ts`, `orchestrateur/src/db.ts` |  |
| `dans` | `in` | `orchestrateur/README.md`, `orchestrateur/features/gates-livraison.feature`, `orchestrateur/features/durcissement-review.feature` | key of the detours table in `banc.ts` (`{ dans: 'cadrage', … }`) |

### Identifiers shared across files: option keys of the adapters

| French | English | Where | Notes |
|---|---|---|---|
| `jeton` | `token` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/src/exterieur/forge-gitea.ts`, `orchestrateur/tests/mutations/mutations.ts` | `OptionsForgeGitea`, `OptionsMoteurClaude`, `OptionsMoteurQuiPousse` |
| `equipeAgents` | `agentsTeam` | `orchestrateur/src/exterieur/forge-gitea.ts` |  |
| `compte` | `account` | `orchestrateur/src/exterieur/forge-gitea.ts`, `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/tests/aides/oidc-factice.ts` |  |
| `delaiMs` | `timeoutMs` | `orchestrateur/tests/aides/banc.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/tests/reprise.test.ts` |  |
| `intervalleMs` | `intervalMs` | `orchestrateur/src/exterieur/forge-gitea.ts`, `orchestrateur/src/exterieur/moteur-pousse.ts`, `orchestrateur/src/exterieur/factices.ts` |  |
| `delaiGitMs` | `gitTimeoutMs` | `orchestrateur/src/exterieur/moteur-pousse.ts`, `orchestrateur/src/exterieur/forge-gitea.ts` |  |
| `clePublique` | `publicKey` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/moteur-claude.test.ts`, `orchestrateur/tests/socle-moteur.test.ts` |  |
| `schemaRapport` | `reportSchema` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/socle-moteur.test.ts`, `orchestrateur/scripts/essai-claude.ts` |  |
| `memoire` | `memory` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/db.ts` | container memory limit option |
| `proxys` | `proxies` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/tests/moteur-claude.test.ts` |  |
| `proxyIa` | `aiProxy` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/moteur-claude.test.ts`, `orchestrateur/scripts/essai-claude.ts` |  |
| `proxySortie` | `egressProxy` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/moteur-claude.test.ts`, `orchestrateur/scripts/essai-claude.ts` | override: "proxy de sortie" = egress proxy |
| `socle` | `core` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/image-fixe.test.ts` | option block `{ registre, jeton, reseau, hote, ca }` |
| `registre` | `registry` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/tests/moteur-claude.test.ts` |  |
| `reseau` | `network` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/exterieur/monde.ts` |  |
| `hote` | `host` | `orchestrateur/src/api.ts`, `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/service.test.ts` |  |
| `hotes` | `hosts` | `orchestrateur/src/api.ts`, `orchestrateur/src/exterieur/monde.ts`, `orchestrateur/tests/config.test.ts` |  |
| `essais` | `attempts` | `orchestrateur/src/exterieur/deployeur-ssh.ts`, `orchestrateur/src/exterieur/forge-gitea.ts`, `orchestrateur/tests/forge-gitea.test.ts` | `OptionsDeployeurSsh.essais`; override (retry count, not trials) |
| `exemple` | `example` | `orchestrateur/tests/config.test.ts`, `orchestrateur/tests/db.test.ts`, `orchestrateur/src/exterieur/moteur-claude.ts` | path of the reference tool given to agents |

### DBOS names (recorded in the `dbos` schema; the lab is rebuilt, so no compatibility is kept)

| French | English | Where | Notes |
|---|---|---|---|
| `cycleOutil` | `toolCycle` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/workflows/cycleOutil.ts` | workflow W1 name (`registerWorkflow`, `listWorkflows({ workflowName })`) |
| `tacheAgent` | `agentTask` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/workflows/tacheAgent.ts`, `orchestrateur/src/orchestrateur.ts` | workflow W2 name |
| `operationExterne` | `externalOperation` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/messages.ts`, `ROADMAP.md` | child workflow of W1 |
| `surveillance` | `monitoring` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/README.md`, `orchestrateur/tests/mutations/mutations.ts` | workflow and schedule name (`applySchedules`) |
| `guetteur` | `watcher` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/src/orchestrateur.ts` | workflow and schedule name |
| `apiDemande` | `apiRequest` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/mutations/mutations.ts` | API entry workflow (also compared by name in `#parCle`) |
| `purger` | `purge` | `orchestrateur/src/orchestrateur.ts`, `infra/ansible/roles/deployeur/files/deployeur.py`, `infra/ansible/verify-deployeur-socle.yml` | step of `surveillance` |
| `guetter` | `watch` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/exterieur/forge-gitea.ts`, `orchestrateur/src/exterieur/factices.ts` | step of `guetteur` |
| `envoyer` | `send` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/features/steps/actions.ts` | step of `apiMessage` |
| `demarrer` | `start` | `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/src/workflows/tacheAgent.ts` | step of W2 |
| `executer` | `execute` | `orchestrateur/tests/moteur-claude.test.ts`, `orchestrateur/src/workflows/tacheAgent.ts`, `orchestrateur/tests/forge-gitea.test.ts` | step of W2 |
| `enregistrer` | `record` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/workflows/tacheAgent.ts`, `orchestrateur/tests/robustesse.test.ts` | override: step of W2 that records the result |
| `taches-agents` | `agent-tasks` | `orchestrateur/README.md`, `orchestrateur/src/config.ts`, `orchestrateur/src/orchestrateur.ts` | queue (`FILE_TACHES`); also in `infra/ansible/roles/executeur/defaults/main.yml` comments |
| `pilotage` | `control` | `orchestrateur/README.md`, `orchestrateur/tests/roles.test.ts`, `orchestrateur/tests/mutations/mutations.ts` | queue (`FILE_PILOTAGE`) |
| `boite` | `mailbox` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/src/messages.ts`, `orchestrateur/tests/aides/banc.ts` | message topic (`BOITE`) |
| `annulation` | `cancellation` | `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql`, `orchestrateur/src/workflows/cycleOutil.ts` | topic (`SUJET_ANNULATION`), also message type and trigger |
| `tache-<id>` | `task-<id>` | `orchestrateur/README.md`, `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/src/workflows/deps.ts` | W2 workflow id (`idWorkflowTache`) |
| `api-<acteur>-<cle>` | `api-<actor>-<key>` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/surveillance.test.ts` | placeholders only |
| `orchestrateur` | `orchestrator` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/README.md` | `DBOS.setConfig({ name })` application name |
| `s5-controles-avant-avis` | `s5-checks-before-feedback` | `orchestrateur/src/workflows/cycleOutil.ts` | DBOS patch name (`PATCH_CONTROLES_AVANT_AVIS`) |
| `socle-evolution` | `core-evolution` | `orchestrateur/src/workflows/cycleOutil.ts` | DBOS patch name |
| `e5f-lancer-pipeline-preview` | `e5f-launch-preview-pipeline` | `orchestrateur/src/workflows/cycleOutil.ts` | DBOS patch name |
| `lancer le pipeline Preview` | `launch the Preview pipeline` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/reprise.test.ts`, `orchestrateur/tests/image-fixe.test.ts` | step name read back by name (`ETAPE_LANCER_PIPELINE_PREVIEW`) |
| `opération <op>` | `operation <op>` | `orchestrateur/README.md`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/reprise.test.ts` | step name prefix in `operationExterne` |
| `relance <n> : <état>` | `reminder <n>: <state>` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/tests/machine.test.ts` | step name |
| `transition <de> --[<déclencheur>]--> <vers>` | `transition <from> --[<trigger>]--> <to>` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/src/workflows/cycleOutil.ts` | step name |
| `notifier admin` | `notify admin` | `orchestrateur/tests/mails.test.ts`, `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/src/workflows/cycleOutil.ts` | step name |
| `notifier demandeur` | `notify requester` | `orchestrateur/tests/mails.test.ts`, `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/src/workflows/cycleOutil.ts` | step name |
| `écrire message orchestrateur` | `write orchestrator message` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/features/durcissement-review.feature` | step name |
| `écrire message demandeur` | `write requester message` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/features/durcissement-review.feature` | step name |
| `tracer message ignoré` | `trace ignored message` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/README.md`, `orchestrateur/src/db.ts` | step name |
| `arrêter les tâches et opérations en cours` | `stop running tasks and operations` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/README.md`, `orchestrateur/src/exterieur/contrats.ts` | step name |
| `identifiant opération <op>` | `operation id <op>` | `orchestrateur/README.md`, `orchestrateur/migrations/0008_acteurs.sql`, `orchestrateur/tests/mutations/mutations.ts` | step name |
| `créer tâches <rôles> itération <n>` | `create tasks <roles> iteration <n>` | `orchestrateur/README.md`, `orchestrateur/src/db.ts`, `orchestrateur/src/exterieur/moteur-claude.ts` | step name |
| `clore les tâches arrêtées et lire leur statut` | `close stopped tasks and read their status` | `orchestrateur/src/workflows/cycleOutil.ts` | step name |
| `lire tâche <id>` | `read task <id>` | `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/image-fixe.test.ts`, `orchestrateur/tests/consignes.test.ts` | step name |
| `relances du passage` | `reminders of the pass` | `orchestrateur/features/steps/verifications.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/robustesse.test.ts` | step name |
| `empreinte candidate` | `candidate digest` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/features/gates-livraison.feature`, `orchestrateur/tests/db.test.ts` | step name |
| `origine de l’incident` | `incident origin` | `orchestrateur/migrations/0002_machine-etats.sql`, `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` | step name |
| `lire le cycle après l’incident` | `read the cycle after the incident` | `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/image-fixe.test.ts`, `orchestrateur/tests/consignes.test.ts` | step name |
| `lire la mémoire après l’incident` | `read the memory after the incident` | `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/image-fixe.test.ts`, `orchestrateur/tests/consignes.test.ts` | step name |
| `contrôle de budget <enveloppe>` | `budget check <envelope>` | `orchestrateur/features/gates-livraison.feature`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/features/steps/actions.ts` | step name |
| `itération overlap` | `overlap iteration` | `orchestrateur/features/durcissement-review.feature`, `orchestrateur/features/steps/verifications.ts`, `orchestrateur/features/cadrage.feature` | step name (also `itération scoping`, `itération contract`) |
| `durée de travail` | `work duration` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/migrations/0002_machine-etats.sql`, `orchestrateur/migrations/0012_machine-etats.sql` | step name |
| `enregistrer le déploiement <env>` | `record the <env> deployment` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/workflows/tacheAgent.ts`, `orchestrateur/tests/robustesse.test.ts` | override: step name; records |
| `dernière Prod saine` | `last healthy Prod` | `orchestrateur/migrations/0002_machine-etats.sql`, `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` | step name |
| `tracer la restauration de la Prod` | `trace the Prod restore` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/README.md`, `orchestrateur/src/db.ts` | step name |
| `retirer la Prod servie` | `remove the served Prod` | `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/deployeur-ssh.test.ts` | step name |
| `tracer le retrait de la Prod` | `trace the Prod removal` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/README.md`, `orchestrateur/src/db.ts` | step name |
| `message du cadrage` | `scoping message` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/mutations/mutations.ts` | step name |
| `arrêter la maquette` | `stop the mock-up` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/README.md`, `orchestrateur/src/exterieur/contrats.ts` | step name |
| `compteurs à l’entrée du tour` | `counters at round entry` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/MACHINE.md`, `orchestrateur/tests/stagnation.test.ts` | step name |
| `tour courant` | `current round` | `orchestrateur/features/durcissement-review.feature`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/robustesse.test.ts` | step name |
| `écart d’intégration` | `integration deviation` | `orchestrateur/features/durcissement-review.feature`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/stagnation.test.ts` | step name |
| `écarts du tour` | `round deviations` | `orchestrateur/features/durcissement-review.feature`, `orchestrateur/src/durcissement/stagnation.ts`, `orchestrateur/features/erreurs-connues-v1.feature` | step name |
| `évaluer le tour` | `evaluate the round` | `orchestrateur/src/workflows/cycleOutil.ts` | step name |
| `écarts hors périmètre` | `out-of-scope deviations` | `orchestrateur/features/durcissement-review.feature`, `orchestrateur/src/durcissement/stagnation.ts`, `orchestrateur/features/erreurs-connues-v1.feature` | step name |
| `résultats de la CI` | `CI results` | `orchestrateur/migrations/0015_machine-etats.sql`, `orchestrateur/src/machine/etats.ts`, `orchestrateur/src/workflows/cycleOutil.ts` | step name |
| `Gate 1 déjà accordée ?` | `Gate 1 already granted?` | `orchestrateur/MACHINE.md`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/features/gates-livraison.feature` | step name |
| `empreinte approuvée à la Gate 2` | `digest approved at Gate 2` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/features/gates-livraison.feature`, `orchestrateur/tests/db.test.ts` | step name |
| `résultats du pipeline Preview` | `Preview pipeline results` | `orchestrateur/migrations/0015_machine-etats.sql`, `orchestrateur/src/machine/etats.ts`, `orchestrateur/src/workflows/cycleOutil.ts` | step name |
| `résultats pour la Gate 2` | `results for Gate 2` | `orchestrateur/migrations/0015_machine-etats.sql`, `orchestrateur/src/machine/etats.ts`, `orchestrateur/src/workflows/cycleOutil.ts` | step name |
| `lire le cycle et sa mémoire` | `read the cycle and its memory` | `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/image-fixe.test.ts`, `orchestrateur/tests/consignes.test.ts` | step name |
| `contexte overlap` | `overlap context` | `orchestrateur/features/steps/verifications.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/features/cadrage.feature` | step names of `contexte()` (also `contexte scoping`, `contexte du tour`, `contexte revue`) |
| `retirer la maquette` | `remove the mock-up` | `orchestrator/src/workflows/toolCycle.ts` | step name (also `retirer la Preview`, `retirer la Prod` → `remove the Preview`, `remove the Prod`) |
| `créer la demande` | `create the request` | `orchestrator/src/orchestrator.ts` | step name of `apiRequest` |

### Environment variables

| French | English | Where | Notes |
|---|---|---|---|
| `ADRESSE_ESCALADE_ADMIN` | `ADMIN_ESCALATION_ADDRESS` | `orchestrateur/README.md`, `orchestrateur/src/exterieur/notifications-smtp.ts`, `orchestrateur/tests/config.test.ts` | `src/config.ts`, `src/exterieur/monde.ts`; set by `infra/ansible/roles/orchestrateur/templates/orchestrateur-variables.j2` |
| `DOMAINE_OUTILS` | `TOOL_DOMAIN` | `orchestrateur/README.md`, `orchestrateur/src/config.ts`, `orchestrateur/tests/aides/banc.ts` | `src/config.ts` |
| `URL_TABLEAU_DE_BORD` | `DASHBOARD_URL` | `orchestrateur/README.md`, `orchestrateur/src/api.ts`, `orchestrateur/src/config.ts` | `src/config.ts` |
| `CONCURRENCE_AGENTS` | `AGENT_CONCURRENCY` | `orchestrateur/README.md`, `orchestrateur/src/config.ts`, `orchestrateur/src/orchestrateur.ts` | `src/config.ts` |
| `CHEMIN_SCHEMA_RAPPORT` | `REPORT_SCHEMA_PATH` | `orchestrateur/scripts/essai-claude.ts`, `orchestrateur/src/exterieur/monde.ts`, `orchestrateur/Dockerfile` | `src/config.ts`, `src/exterieur/monde.ts`, `orchestrateur/Dockerfile` (ENV) |
| `CHEMIN_CONSIGNES` | `INSTRUCTIONS_PATH` | `orchestrateur/Dockerfile`, `orchestrateur/README.md`, `orchestrateur/src/config.ts` | `src/config.ts`, `orchestrateur/Dockerfile` (ENV) |
| `CHEMIN_WEB` | `WEB_PATH` | `orchestrateur/src/config.ts`, `orchestrateur/Dockerfile` | `src/config.ts`, `orchestrateur/Dockerfile` (ENV) |
| `CHEMIN_DEEP_CHAT` | `DEEP_CHAT_PATH` | `orchestrateur/src/config.ts`, `orchestrateur/Dockerfile` | `src/config.ts`, `orchestrateur/Dockerfile` (ENV) |
| `CHEMIN_EXEMPLE` | `EXAMPLE_PATH` | `orchestrateur/Dockerfile`, `orchestrateur/src/exterieur/monde.ts` | `src/exterieur/monde.ts`, `orchestrateur/Dockerfile` (ENV) |
| `SURVEILLANCE_CRON` | `MONITORING_CRON` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/tests/remplacement.test.ts`, `orchestrateur/tests/surveillance.test.ts` | `src/config.ts` |
| `GUETTEUR_CRON` | `WATCHER_CRON` | `orchestrateur/README.md`, `orchestrateur/scripts/essai-ci.ts`, `orchestrateur/src/config.ts` | `src/config.ts` |
| `DELAI_RELANCE_MS` | `REMINDER_DELAY_MS` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/README.md`, `orchestrateur/features/steps/actions.ts` | override: a delay between reminders, not a timeout |
| `DELAI_PAUSE_ARCHIVE_MS` | `PAUSE_ARCHIVE_DELAY_MS` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/README.md`, `orchestrateur/features/support/web.ts` | override: delay |
| `DELAI_CI_MAX_MS` | `CI_MAX_TIMEOUT_MS` | `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/README.md`, `orchestrateur/src/config.ts` |  |
| `DELAI_TACHE_MS` | `TASK_TIMEOUT_MS` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/src/config.ts`, `orchestrateur/tests/config.test.ts` |  |
| `DELAI_ATTENTE_LONGUE_MS` | `LONG_WAIT_DELAY_MS` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/README.md`, `orchestrateur/features/steps/verifications.ts` | override: delay |
| `DELAI_RELANCE_LONGUE_MS` | `LONG_REMINDER_DELAY_MS` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/README.md`, `orchestrateur/src/config.ts` | override: delay |
| `DELAI_SONDAGE_MS` | `POLLING_INTERVAL_MS` | `orchestrateur/README.md`, `orchestrateur/src/config.ts`, `orchestrateur/tests/aides/banc.ts` | override: an interval |
| `DELAI_OPERATION_MS` | `OPERATION_TIMEOUT_MS` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/README.md` |  |
| `DELAI_REESSAI_INCIDENT_MS` | `INCIDENT_RETRY_DELAY_MS` | `orchestrateur/README.md`, `orchestrateur/src/config.ts`, `orchestrateur/tests/aides/banc.ts` | override: delay |
| `ETAPE_TENTATIVES` | `STEP_ATTEMPTS` | `orchestrateur/src/config.ts`, `orchestrateur/README.md`, `orchestrateur/tests/aides/banc.ts` | `src/config.ts` |
| `ETAPE_INTERVALLE_MS` | `STEP_INTERVAL_MS` | `orchestrateur/src/config.ts`, `orchestrateur/README.md`, `orchestrateur/tests/aides/banc.ts` |  |
| `PORT_API` | `API_PORT` | `orchestrateur/src/config.ts`, `orchestrateur/tests/config.test.ts`, `orchestrateur/README.md` | `src/config.ts`, `orchestrateur/Dockerfile` (HEALTHCHECK) |
| `ADRESSE_API` | `API_ADDRESS` | `orchestrateur/README.md`, `orchestrateur/Dockerfile`, `orchestrateur/src/config.ts` | `src/config.ts`; set to 0.0.0.0 by the compose file (infra area) |
| `OIDC_EMETTEUR` | `OIDC_ISSUER` | `orchestrateur/tests/config.test.ts`, `orchestrateur/src/config.ts`, `orchestrateur/README.md` | `src/config.ts` |
| `QUATRE_YEUX_DEROGATION_SUJET` | `FOUR_EYES_EXEMPTION_SUBJECT` | `orchestrateur/migrations/0008_acteurs.sql`, `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/service.test.ts` | `src/config.ts` |
| `EUPADEV_EXTERIEUR` | `EUPADEV_EXTERNAL` | `orchestrateur/tests/config.test.ts`, `orchestrateur/README.md`, `orchestrateur/tests/mutations/mutations.ts` | `src/exterieur/monde.ts`; values `factice-auto` → `fake-auto`, `forge=gitea`, `moteur=pousse\|claude` → `engine=pushing\|claude`, `deployeur=ssh` → `deployer=ssh`, `notifications=smtp` |
| `FORGE_JETON` | `FORGE_TOKEN` | `orchestrateur/tests/config.test.ts`, `orchestrateur/src/exterieur/monde.ts`, `orchestrateur/README.md` | also `_FILE` variant |
| `FORGE_JETON_FILE` | `FORGE_TOKEN_FILE` | `orchestrateur/scripts/essai-ci.ts`, `orchestrateur/scripts/essai-forge.ts`, `orchestrateur/scripts/essai-integration.ts` |  |
| `AGENT_JETON` | `AGENT_TOKEN` | `orchestrateur/tests/config.test.ts`, `orchestrateur/src/exterieur/monde.ts`, `orchestrateur/README.md` | also `_FILE` variant |
| `AGENT_JETON_FILE` | `AGENT_TOKEN_FILE` | `orchestrateur/scripts/essai-integration.ts`, `orchestrateur/README.md`, `orchestrateur/src/exterieur/monde.ts` |  |
| `AGENT_FORGE_JETON` | `AGENT_FORGE_TOKEN` | `orchestrateur/src/exterieur/monde.ts`, `orchestrateur/README.md`, `orchestrateur/tests/config.test.ts` | also `_FILE` variant |
| `AGENT_FORGE_JETON_FILE` | `AGENT_FORGE_TOKEN_FILE` | `orchestrateur/scripts/essai-claude.ts`, `orchestrateur/tests/config.test.ts`, `orchestrateur/README.md` |  |
| `AGENT_PROXYS` | `AGENT_PROXIES` | `orchestrateur/scripts/essai-claude.ts`, `orchestrateur/src/exterieur/monde.ts`, `orchestrateur/README.md` |  |
| `AGENT_PROXY_IA` | `AGENT_AI_PROXY` | `orchestrateur/scripts/essai-claude.ts`, `orchestrateur/src/exterieur/monde.ts`, `orchestrateur/README.md` |  |
| `AGENT_PROXY_SORTIE` | `AGENT_EGRESS_PROXY` | `orchestrateur/scripts/essai-claude.ts`, `orchestrateur/src/exterieur/monde.ts`, `orchestrateur/README.md` |  |
| `AGENT_SOCLE_REGISTRE` | `AGENT_CORE_REGISTRY` | `orchestrateur/src/exterieur/monde.ts`, `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/socle-moteur.test.ts` |  |
| `AGENT_SOCLE_JETON` | `AGENT_CORE_TOKEN` | `orchestrateur/src/exterieur/monde.ts`, `orchestrateur/src/exterieur/moteur-claude.ts` | also `_FILE` variant |
| `AGENT_SOCLE_RESEAU` | `AGENT_CORE_NETWORK` | `orchestrateur/src/exterieur/monde.ts`, `orchestrateur/src/exterieur/moteur-claude.ts` |  |
| `AGENT_SOCLE_HOTE` | `AGENT_CORE_HOST` | `orchestrateur/src/exterieur/monde.ts`, `orchestrateur/src/exterieur/moteur-claude.ts`, `infra/compose/executeur/compose.yml` |  |
| `AGENT_SOCLE_CA` | `AGENT_CORE_CA` | `orchestrateur/src/exterieur/monde.ts`, `orchestrateur/src/exterieur/moteur-claude.ts`, `infra/compose/executeur/compose.yml` |  |
| `AGENT_JOURNAL` | `AGENT_LOG` | `orchestrateur/scripts/essai-claude.ts`, `infra/ansible/verify-moteur-claude.yml` | `scripts/essai-claude.ts` |
| `DEPLOYEUR_HOTES` | `DEPLOYER_HOSTS` | `orchestrateur/src/exterieur/monde.ts`, `orchestrateur/tests/config.test.ts`, `orchestrateur/README.md` | value `maquette=<ip>,preview=<ip>,prod=<ip>` → `mockup=…` |
| `DEPLOYEUR_CLE_FILE` | `DEPLOYER_KEY_FILE` | `orchestrateur/tests/config.test.ts`, `orchestrateur/src/exterieur/monde.ts`, `orchestrateur/README.md` |  |
| `DEPLOYEUR_KNOWN_HOSTS_FILE` | `DEPLOYER_KNOWN_HOSTS_FILE` | `orchestrateur/src/exterieur/monde.ts`, `orchestrateur/README.md`, `orchestrateur/scripts/essai-deploiement.ts` |  |
| `MAIL_EXPEDITEUR` | `MAIL_FROM` | `orchestrateur/tests/config.test.ts`, `orchestrateur/src/exterieur/monde.ts`, `orchestrateur/src/exterieur/notifications-smtp.ts` | override: one name per concept, the core and the example already use `MAIL_FROM` |
| `FAUX_JOURNAL` | `FAKE_LOG` | `orchestrateur/tests/socle-moteur.test.ts` | test only (`tests/socle-moteur.test.ts`) |
| `FAUX_SOCLE_ECHEC` | `FAKE_CORE_FAILURE` | `orchestrateur/tests/socle-moteur.test.ts` | test only |
| `FAUX_SOCLE_MAJ_PACKAGE` | `FAKE_CORE_UPDATE_PACKAGE` | `orchestrateur/tests/socle-moteur.test.ts` | test only |
| `FAUX_SOCLE_MAJ_VERROU` | `FAKE_CORE_UPDATE_LOCKFILE` | `orchestrateur/tests/socle-moteur.test.ts` | override: lockfile; test only |
| `JOURNAL` | `LOG` | `orchestrateur/tests/reprise/enfant-mails.ts`, `orchestrateur/tests/reprise/enfant.ts`, `orchestrateur/tests/roles/enfant.ts` | test child processes (`tests/reprise/enfant.ts`, `tests/roles/enfant.ts`) |
| `CIBLE` | `TARGET` | `orchestrateur/tests/reprise/enfant.ts`, `orchestrateur/tests/reprise.test.ts` | test only |
| `CREER` | `CREATE` | `orchestrateur/tests/roles.test.ts`, `orchestrateur/tests/roles/enfant.ts` | test only |
| `ARRET_A` | `STOP_AT` | `orchestrateur/tests/roles.test.ts`, `orchestrateur/tests/roles/enfant.ts` | test only |
| `TUER_APRES` | `KILL_AFTER` | `orchestrateur/tests/reprise/enfant-mails.ts`, `orchestrateur/tests/mails.test.ts` | test only |
| `LENTEUR_TESTS_MS` | `TESTS_SLOWNESS_MS` | `orchestrateur/tests/reprise/enfant.ts`, `orchestrateur/tests/reprise.test.ts` | test only |
| `LENTEUR_PREVIEW_MS` | `PREVIEW_SLOWNESS_MS` | `orchestrateur/tests/reprise/enfant.ts`, `orchestrateur/tests/reprise.test.ts` | test only |
| `LENTEUR_MOTEUR_MS` | `ENGINE_SLOWNESS_MS` | `orchestrateur/tests/roles/enfant.ts`, `orchestrateur/tests/roles.test.ts` | test only |
| `CAPTURES_WEB` | `WEB_SCREENSHOTS` | `orchestrateur/tests/web.test.ts` | test only (`tests/web.test.ts`) |
| — (new in step 4b) | `EUPADEV_LANGUAGE` | `orchestrator/src/config.ts`, `infra/compose/orchestrateur/compose.yml`, `infra/ansible/group_vars/orchestrateur/vars.yml` | language of the end-user texts (`en` default, `fr` on the lab), dictionaries `orchestrator/lang/{en,fr}.json` |
| `NOM_FILE` | `NAME_FILE` | `orchestrator/src/config.ts`, `orchestrator/tests/config.test.ts`, `orchestrator/README.md` | placeholder of the secret convention (`<NAME>` or `<NAME>_FILE`) |

### HTTP API (routes, query parameters, JSON fields)

| French | English | Where | Notes |
|---|---|---|---|
| `/sante` | `/health` | `orchestrateur/tests/service.test.ts`, `orchestrateur/README.md`, `orchestrateur/src/api.ts` | `GET`; also the Dockerfile HEALTHCHECK, verify playbooks, `eupadev.py health` |
| `/demandes` | `/requests` | `orchestrateur/tests/service.test.ts`, `orchestrateur/src/api.ts`, `orchestrateur/scripts/eupadev.py` | `GET` (my requests), `POST` (new request) |
| `/demandes/<cycle>` | `/requests/<cycle>` | `orchestrateur/tests/service.test.ts`, `orchestrateur/Dockerfile`, `orchestrateur/Dockerfile.dockerignore` | `GET` |
| `/demandes/<cycle>/messages` | `/requests/<cycle>/messages` | `orchestrateur/tests/service.test.ts`, `orchestrateur/Dockerfile`, `orchestrateur/Dockerfile.dockerignore` | `GET ?since=<id>` |
| `/acteurs/fusions` | `/actors/merges` | `orchestrateur/tests/service.test.ts`, `orchestrateur/src/api.ts`, `orchestrateur/migrations/0010_fusion-acteurs.sql` | `POST`, admin only |
| `statut` | `status` | `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/tests/db.test.ts` | `GET /sante` answer `{ statut, pause_agents }` |
| `nom` | `name` | `orchestrateur/src/config.ts`, `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/mutations/mutations.ts` | request body and state answer |
| `service_proprietaire` | `owner_service` | `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/db.test.ts`, `orchestrateur/tests/robustesse.test.ts` | request body |
| `besoin` | `need` | `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/src/orchestrateur.ts` | request body (first chat message) |
| `outil_id` | `tool_id` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/src/db.ts` | request body (evolution) and answers |
| `avis_cadrage` | `scoping_feedback` | `orchestrateur/src/messages.ts`, `orchestrateur/tests/service.test.ts`, `orchestrateur/src/workflows/cycleOutil.ts` | message type |
| `avis_preview` | `preview_feedback` | `orchestrateur/features/gates-livraison.feature`, `orchestrateur/src/messages.ts`, `orchestrateur/MACHINE.md` | message type |
| `abandon_demandeur` | `requester_abandonment` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/messages.ts`, `orchestrateur/web/app.js` | message type |
| `message_demandeur` | `requester_message` | `orchestrateur/src/messages.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/scripts/eupadev.py` | message type |
| `annulation` | `cancellation` | `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql`, `orchestrateur/src/workflows/cycleOutil.ts` | message type |
| `issue` | `outcome` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/features/steps/actions.ts`, `orchestrateur/src/messages.ts` | message field |
| `satisfait` | `satisfied` | `orchestrateur/MACHINE.md`, `orchestrateur/src/messages.ts`, `orchestrateur/features/gates-livraison.feature` | feedback outcome |
| `nouvelle_capacite` | `new_capability` | `orchestrateur/src/messages.ts`, `orchestrateur/features/gates-livraison.feature`, `orchestrateur/features/steps/actions.ts` | preview feedback outcome |
| `texte` | `text` | `orchestrateur/features/steps/verifications.ts`, `orchestrateur/features/steps/actions.ts`, `orchestrateur/features/gates-livraison.feature` | message field |
| `commentaire` | `comment` | `orchestrateur/src/messages.ts`, `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/features/steps/actions.ts` | decision field |
| `rallonge_budget_usd` | `budget_top_up_usd` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/src/messages.ts` | decision field and SQL column |
| `empreinte` | `digest` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/features/gates-livraison.feature`, `orchestrateur/tests/db.test.ts` | decision field |
| `acteur_absorbe` | `absorbed_actor` | `orchestrateur/src/db.ts`, `orchestrateur/migrations/0010_fusion-acteurs.sql`, `orchestrateur/src/api.ts` | `POST /acteurs/fusions` body and SQL column |
| `acteur_cible` | `target_actor` | `orchestrateur/migrations/0010_fusion-acteurs.sql`, `orchestrateur/src/db.ts`, `orchestrateur/src/api.ts` | body and SQL column |
| `motif` | `reason` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/db.test.ts` | body and SQL column |
| `etat` | `state` | `orchestrateur/src/db.ts`, `orchestrateur/tests/db.test.ts`, `orchestrateur/tests/moteur-claude.test.ts` | `GET /demandes/<cycle>` answer |
| `visite` | `visit` | `orchestrateur/tests/db.test.ts`, `orchestrateur/src/db.ts`, `orchestrateur/tests/service.test.ts` | answer |
| `termine_le` | `finished_at` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/src/db.ts` | answer |
| `motif_gate` | `gate_reason` | `orchestrateur/README.md`, `orchestrateur/src/api.ts` | answer |
| `empreinte_candidate` | `candidate_digest` | `orchestrateur/tests/service.test.ts`, `orchestrateur/README.md`, `orchestrateur/scripts/eupadev.py` | answer |
| `decisions_possibles` | `possible_decisions` | `orchestrateur/README.md`, `orchestrateur/src/api.ts` | answer |
| `transmis` | `transmitted` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/MACHINE.md` | `POST /messages` answer |
| `raison` | `reason` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/features/steps/actions.ts`, `orchestrateur/features/cadrage.feature` | `POST /messages` answer |
| `nouvelle` | `new` | `orchestrateur/MACHINE.md`, `orchestrateur/README.md`, `orchestrateur/features/gates-livraison.feature` | merge answer flag (internal) |
| `erreurs` | `errors` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/src/exterieur/forge-gitea.ts`, `orchestrateur/src/moteur/rapport.ts` | problem detail extension member of a 400 |

### CLI `scripts/eupadev.py`

| French | English | Where | Notes |
|---|---|---|---|
| `issue` | `outcome` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/features/steps/actions.ts`, `orchestrateur/src/messages.ts` | positional argument of `opinion`, `preview`, `decide`; its choices follow the message outcomes above |
| `satisfait` | `satisfied` | `orchestrateur/MACHINE.md`, `orchestrateur/src/messages.ts`, `orchestrateur/features/gates-livraison.feature` | choice |
| `nouvelle_capacite` | `new_capability` | `orchestrateur/src/messages.ts`, `orchestrateur/features/gates-livraison.feature`, `orchestrateur/features/steps/actions.ts` | choice |
| `approuve` | `approved` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/features/gates-livraison.feature`, `orchestrateur/tests/db.test.ts` | choice |
| `refuse` | `refused` | `orchestrateur/MACHINE.md`, `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` | choice |
| `changement_perimetre` | `scope_change` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/db.test.ts`, `orchestrateur/features/gates-livraison.feature` | choice |

### SQL: database, roles, tables, view

| French | English | Where | Notes |
|---|---|---|---|
| `orchestrateur` | `orchestrator` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/README.md` | database name (and owner of the throwaway test database, `POSTGRES_DB=orchestrateur`); infra creates it |
| `orch_proprietaire` | `orch_owner` | `orchestrateur/README.md`, `orchestrateur/tests/aides/postgres-jetable.ts`, `orchestrateur/sql/roles.sql` | PostgreSQL role, `sql/roles.sql`; also infra vault/credstore names (infra area) |
| `orch_moteur` | `orch_engine` | `orchestrateur/README.md`, `orchestrateur/migrations/0003_droits.sql`, `orchestrateur/tests/mutations/mutations.ts` | PostgreSQL role, `migrations/0003_droits.sql`, `src/migrer.ts` (`ROLE_MOTEUR`), DBOS `applicationRole` |
| `mdp_proprietaire` | `owner_password` | `orchestrateur/sql/roles.sql`, `orchestrateur/README.md`, `orchestrateur/tests/aides/postgres-jetable.ts` | psql variable of `sql/roles.sql` (also `tests/aides/postgres-jetable.ts`) |
| `mdp_moteur` | `engine_password` | `orchestrateur/sql/roles.sql`, `orchestrateur/README.md`, `orchestrateur/tests/aides/postgres-jetable.ts` | psql variable of `sql/roles.sql` |
| `etats` | `states` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/scripts/generer-transitions.ts`, `orchestrateur/tests/db.test.ts` | table |
| `transitions_autorisees` | `allowed_transitions` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0002_machine-etats.sql` | table |
| `outils` | `tools` | `orchestrateur/features/durcissement-review.feature`, `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0001_schema.sql` | table |
| `outils_historique` | `tool_history` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/src/db.ts` | table |
| `taches` | `tasks` | `orchestrateur/tests/db.test.ts`, `orchestrateur/features/cadrage.feature`, `orchestrateur/migrations/0006_taches-ci-vert.sql` | table |
| `approbations` | `approvals` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/features/gates-livraison.feature` | table |
| `deploiements` | `deployments` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/features/gates-livraison.feature` | table |
| `resultats_pipeline` | `pipeline_results` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/migrations/0002_machine-etats.sql` | table |
| `ecarts` | `deviations` | `orchestrateur/tests/db.test.ts`, `orchestrateur/src/durcissement/stagnation.ts`, `orchestrateur/src/workflows/cycleOutil.ts` | table |
| `memoire_cycles` | `cycle_memory` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/tests/db.test.ts`, `orchestrateur/README.md` | table |
| `evenements` | `events` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/migrations/0003_droits.sql`, `orchestrateur/tests/db.test.ts` | table (outbox) |
| `notifications_envoyees` | `sent_notifications` | `orchestrateur/migrations/0007_notifications-envoyees.sql`, `orchestrateur/tests/db.test.ts`, `orchestrateur/tests/mutations/mutations.ts` | table |
| `acteurs` | `actors` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/migrations/0008_acteurs.sql`, `orchestrateur/tests/db.test.ts` | table (same name as the core's table, separate database) |
| `acteurs_identites` | `actor_identities` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0008_acteurs.sql`, `orchestrateur/tests/mutations/mutations.ts` | table |
| `acteurs_fusions` | `actor_merges` | `orchestrateur/migrations/0010_fusion-acteurs.sql`, `orchestrateur/tests/db.test.ts`, `orchestrateur/src/db.ts` | table |
| `mesure_cycles` | `cycle_measures` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0009_mesure-cycles.sql`, `orchestrateur/README.md` | VIEW (`migrations/0009_mesure-cycles.sql`) |

### SQL: columns

| French | English | Where | Notes |
|---|---|---|---|
| `nature` | `kind` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/tests/machine.test.ts`, `orchestrateur/migrations/0001_schema.sql` | `etats.nature` |
| `de` | `from_state` | `orchestrateur/features/durcissement-review.feature`, `orchestrateur/migrations/0015_machine-etats.sql`, `orchestrateur/migrations/0012_machine-etats.sql` | `transitions_autorisees.de`; override: `from` is an SQL reserved word |
| `declencheur` | `trigger` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/tests/machine.test.ts`, `orchestrateur/tests/db.test.ts` | `transitions_autorisees`, `outils_historique` |
| `vers` | `to_state` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/tests/machine.test.ts`, `orchestrateur/tests/db.test.ts` | `transitions_autorisees.vers`; override: reserved word `to` |
| `nom` | `name` | `orchestrateur/src/config.ts`, `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/mutations/mutations.ts` | `outils.nom` |
| `demandeur` | `requester` | `orchestrateur/features/gates-livraison.feature`, `orchestrateur/features/cadrage.feature`, `orchestrateur/migrations/0015_machine-etats.sql` | `outils.demandeur` (text, dropped in 0008 for `demandeur_id`) |
| `demandeur_id` | `requester_id` | `orchestrateur/tests/db.test.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/db.ts` | `outils.demandeur_id` |
| `service_proprietaire` | `owner_service` | `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/db.test.ts`, `orchestrateur/tests/robustesse.test.ts` | `outils` |
| `etat_courant` | `current_state` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/migrations/0008_acteurs.sql` | `outils` |
| `cycle_courant_id` | `current_cycle_id` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0008_acteurs.sql` | `outils` |
| `cree_le` | `created_at` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/src/db.ts`, `orchestrateur/features/steps/verifications.ts` | every table |
| `archive_le` | `archived_at` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/features/steps/verifications.ts` | `outils` |
| `outil_id` | `tool_id` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/src/db.ts` | every table |
| `budget_cadrage_usd` | `scoping_budget_usd` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/tests/mutations/mutations.ts` | `cycles` |
| `budget_durcissement_usd` | `hardening_budget_usd` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/src/db.ts` | `cycles` |
| `etat` | `state` | `orchestrateur/src/db.ts`, `orchestrateur/tests/db.test.ts`, `orchestrateur/tests/moteur-claude.test.ts` | `cycles`, `outils_historique` |
| `dernier_declencheur` | `last_trigger` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/src/db.ts` | `cycles` |
| `dernier_acteur` | `last_actor` | `orchestrateur/migrations/0008_acteurs.sql`, `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/README.md` | `cycles` (text, dropped in 0008) |
| `dernier_acteur_id` | `last_actor_id` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0008_acteurs.sql`, `orchestrateur/src/db.ts` | `cycles` |
| `termine_le` | `finished_at` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/src/db.ts` | `cycles` |
| `etat_precedent` | `previous_state` | `orchestrateur/tests/db.test.ts`, `orchestrateur/src/db.ts`, `orchestrateur/migrations/0001_schema.sql` | `outils_historique` |
| `acteur` | `actor` | `orchestrateur/tests/db.test.ts`, `orchestrateur/src/api.ts`, `orchestrateur/tests/mutations/mutations.ts` | `outils_historique`, `approbations` (text, dropped in 0008) |
| `acteur_id` | `actor_id` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/tests/db.test.ts`, `orchestrateur/tests/service.test.ts` | `outils_historique`, `approbations`, `messages`, `acteurs_identites`, `sessions` |
| `etape` | `step` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/db.test.ts`, `orchestrateur/features/steps/verifications.ts` | `taches` (state the task runs for) |
| `tentative` | `attempt` | `orchestrateur/src/db.ts`, `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/README.md` | `taches` |
| `statut` | `status` | `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/tests/db.test.ts` | `taches`, `evenements` |
| `branche` | `branch` | `orchestrateur/tests/moteur-claude.test.ts`, `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/tests/mutations/mutations.ts` | `taches` |
| `cout_usd` | `cost_usd` | `orchestrateur/src/workflows/tacheAgent.ts`, `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/mutations/mutations.ts` | `taches` |
| `tokens_entree` | `input_tokens` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0009_mesure-cycles.sql`, `orchestrateur/features/steps/lanceur.ts` | `taches`, view |
| `tokens_sortie` | `output_tokens` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0009_mesure-cycles.sql`, `orchestrateur/features/steps/lanceur.ts` | `taches`, view |
| `duree_s` | `duration_s` | `orchestrateur/src/workflows/tacheAgent.ts`, `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/src/db.ts` | `taches` |
| `rapport` | `report` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/features/durcissement-review.feature`, `orchestrateur/src/workflows/cycleOutil.ts` | `taches` |
| `manifeste` | `manifest` | `orchestrateur/tests/forge-gitea.test.ts` | `taches` |
| `empreinte_dependances` | `dependencies_digest` | `orchestrateur/migrations/0001_schema.sql` | `taches` |
| `arbre_hash` | `tree_hash` | `orchestrateur/src/workflows/tacheAgent.ts`, `orchestrateur/src/db.ts`, `orchestrateur/features/steps/verifications.ts` | `taches` |
| `debut_le` | `started_at` | `orchestrateur/src/workflows/tacheAgent.ts`, `orchestrateur/features/steps/verifications.ts`, `orchestrateur/migrations/0001_schema.sql` | override: timestamp column (`*_le` → `*_at`) |
| `fin_le` | `ended_at` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/src/db.ts` | override: timestamp column |
| `modele` | `model` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/features/steps/lanceur.ts`, `orchestrateur/src/config.ts` | `taches` (0005) |
| `consignes_sha256` | `instructions_sha256` | `orchestrateur/migrations/0005_taches-lanceur.sql`, `orchestrateur/features/steps/lanceur.ts`, `orchestrateur/migrations/0006_taches-ci-vert.sql` | `taches` (0005) |
| `ci_vert` | `ci_green` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/migrations/0006_taches-ci-vert.sql`, `orchestrateur/features/steps/lanceur.ts` | `taches` (0006) |
| `empreinte` | `digest` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/features/gates-livraison.feature`, `orchestrateur/tests/db.test.ts` | `approbations`, `deploiements`, `resultats_pipeline` |
| `rallonge_budget_usd` | `budget_top_up_usd` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/src/messages.ts` | `approbations` |
| `commentaire` | `comment` | `orchestrateur/src/messages.ts`, `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/features/steps/actions.ts` | `approbations` |
| `derogation_quatre_yeux` | `four_eyes_exemption` | `orchestrateur/tests/db.test.ts`, `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/service.test.ts` | `approbations` |
| `environnement` | `environment` | `orchestrateur/tests/db.test.ts`, `orchestrateur/README.md`, `orchestrateur/migrations/0001_schema.sql` | `deploiements` |
| `sante` | `health` | `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/db.test.ts`, `orchestrateur/src/exterieur/deployeur-ssh.ts` | `deploiements` |
| `visite` | `visit` | `orchestrateur/tests/db.test.ts`, `orchestrateur/src/db.ts`, `orchestrateur/tests/service.test.ts` | `deploiements`, `resultats_pipeline` |
| `deploye_le` | `deployed_at` | `orchestrateur/migrations/0001_schema.sql` | `deploiements` |
| `controle` | `check_name` | `orchestrator/migrations/0001_schema.sql`, `orchestrator/src/db.ts`, `orchestrator/tests/db.test.ts` | `pipeline_results`; override: `check` is a reserved word of SQL (quoted everywhere otherwise); readers alias it `AS "check"`, so the JSON field stays `check` |
| `resultat` | `result` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/features/steps/actions.ts`, `orchestrateur/tests/aides/claude-factice/claude` | `resultats_pipeline` |
| `constat_id` | `finding_id` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/db.test.ts`, `orchestrateur/src/db.ts` | `ecarts` |
| `role_cible` | `target_role` | `orchestrateur/migrations/0013_ecart-role-cible.sql`, `orchestrateur/src/db.ts`, `orchestrateur/tests/mutations/mutations.ts` | `ecarts` (0013) |
| `auteur_type` | `author_type` | `orchestrateur/tests/service.test.ts`, `orchestrateur/src/db.ts`, `orchestrateur/tests/db.test.ts` | `messages` |
| `auteur` | `author` | `orchestrateur/tests/service.test.ts`, `orchestrateur/src/db.ts`, `orchestrateur/tests/db.test.ts` | `messages` |
| `contenu` | `content` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/src/workflows/cycleOutil.ts` | `messages` |
| `cle` | `key` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/mails.test.ts` | `messages.cle` (0004), `notifications_envoyees.cle` |
| `memoire` | `memory` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/db.ts` | `memoire_cycles` |
| `maj_le` | `updated_at` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/src/db.ts` | `memoire_cycles` |
| `charge` | `payload` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/src/auth.ts` | `evenements.charge`; override (outbox payload, not load) |
| `tentatives` | `attempts` | `orchestrateur/features/cadrage.feature`, `orchestrateur/src/machine/etats.ts`, `orchestrateur/migrations/0002_machine-etats.sql` | `evenements` |
| `traite_le` | `handled_at` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/tests/db.test.ts` | `evenements` |
| `destinataire` | `recipient` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/tests/mails.test.ts`, `orchestrateur/src/exterieur/notifications-smtp.ts` | `notifications_envoyees` |
| `envoye_le` | `sent_at` | `orchestrateur/migrations/0007_notifications-envoyees.sql` | `notifications_envoyees` |
| `genre` | `type` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/exterieur/factices.ts` | `acteurs.genre` (values `humain`/`machine` → `human`/`machine`) |
| `nom_affiche` | `display_name` | `orchestrateur/migrations/0008_acteurs.sql`, `orchestrateur/tests/db.test.ts`, `orchestrateur/src/db.ts` | `acteurs` |
| `annuaire_id` | `directory_id` | `orchestrateur/migrations/0008_acteurs.sql`, `orchestrateur/tests/mutations/mutations.ts`, `socle/migrations/0001_socle.sql` | `acteurs` |
| `derniere_connexion` | `last_sign_in` | `orchestrateur/migrations/0008_acteurs.sql`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/db.ts` | `acteurs` |
| `emetteur` | `issuer` | `orchestrateur/src/db.ts`, `orchestrateur/tests/auth.test.ts`, `orchestrateur/src/auth.ts` | `acteurs_identites` |
| `sujet` | `subject` | `orchestrateur/tests/auth.test.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/tests/service.test.ts` | `acteurs_identites` |
| `depuis` | `since` | `orchestrateur/migrations/0002_machine-etats.sql`, `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` | `acteurs_identites`, `acteurs_fusions` |
| `motif` | `reason` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/db.test.ts` | `acteurs_identites`, `acteurs_fusions` |
| `acteur_absorbe` | `absorbed_actor` | `orchestrateur/src/db.ts`, `orchestrateur/migrations/0010_fusion-acteurs.sql`, `orchestrateur/src/api.ts` | `acteurs_fusions` |
| `acteur_cible` | `target_actor` | `orchestrateur/migrations/0010_fusion-acteurs.sql`, `orchestrateur/src/db.ts`, `orchestrateur/src/api.ts` | `acteurs_fusions` |
| `decide_par` | `decided_by` | `orchestrateur/src/db.ts`, `orchestrateur/migrations/0010_fusion-acteurs.sql`, `orchestrateur/tests/db.test.ts` | `acteurs_fusions` |
| `outil` | `tool` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0002_machine-etats.sql`, `orchestrateur/migrations/0012_machine-etats.sql` | `mesure_cycles` column |
| `duree_calendaire` | `calendar_duration` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0009_mesure-cycles.sql` | view column |
| `cout_total_usd` | `total_cost_usd` | `orchestrateur/tests/db.test.ts`, `orchestrateur/tests/moteur.test.ts`, `orchestrateur/README.md` | view column |
| `cout_cadrage_usd` | `scoping_cost_usd` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0009_mesure-cycles.sql` | view column |
| `cout_durcissement_usd` | `hardening_cost_usd` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0009_mesure-cycles.sql` | view column |
| `duree_travail_min` | `work_duration_min` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0009_mesure-cycles.sql`, `orchestrateur/tests/moteur.test.ts` | view column |
| `taches_echouees` | `failed_tasks` | `orchestrateur/tests/db.test.ts`, `orchestrateur/tests/moteur.test.ts`, `orchestrateur/migrations/0009_mesure-cycles.sql` | view column (`taches` → `tasks`) |
| `taches_bloquees` | `blocked_tasks` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0009_mesure-cycles.sql` | view column |
| `tours_durcissement` | `hardening_rounds` | `orchestrateur/tests/db.test.ts`, `orchestrateur/tests/moteur.test.ts`, `orchestrateur/migrations/0009_mesure-cycles.sql` | view column |
| `premier_passage_ci_vert` | `first_ci_pass_green` | `orchestrateur/tests/db.test.ts`, `orchestrateur/tests/moteur.test.ts`, `orchestrateur/README.md` | view column |
| `ecarts_bloquants_confirmes` | `confirmed_blocking_deviations` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0009_mesure-cycles.sql` | view column |
| `ecarts_dette` | `debt_deviations` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0009_mesure-cycles.sql` | view column |
| `decisions_gates` | `gate_decisions` | `orchestrateur/tests/db.test.ts`, `orchestrateur/tests/moteur.test.ts`, `orchestrateur/README.md` | view column |
| `ouverte` (alias in `cycle_measures`) | `is_open` | `orchestrator/migrations/0009_cycle-measures.sql`, `orchestrator/tests/mutations/mutations.ts` | override: a boolean alias, read as a flag (Words gives `open`) |

### SQL: functions, triggers, constraints, indexes

| French | English | Where | Notes |
|---|---|---|---|
| `refuser_modification` | `refuse_modification` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/migrations/0008_acteurs.sql`, `orchestrateur/migrations/0010_fusion-acteurs.sql` | function |
| `approbations_verifier_gate` | `approvals_verify_gate` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/migrations/0008_acteurs.sql`, `orchestrateur/migrations/0010_fusion-acteurs.sql` | function |
| `transition_dans_cette_transaction` | `transition_in_this_transaction` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/tests/mutations/mutations.ts` | function (params `cycle`, `de`, `declencheur` → `cycle`, `from_state`, `trigger`) |
| `approbations_rallonge_avec_transition` | `approvals_top_up_with_transition` | `orchestrateur/migrations/0001_schema.sql` | function |
| `approbations_appliquer_rallonge` | `approvals_apply_top_up` | `orchestrateur/migrations/0001_schema.sql` | function |
| `deploiements_verifier_prod` | `deployments_verify_prod` | `orchestrateur/migrations/0001_schema.sql` | function |
| `historique_verifier_insertion` | `history_verify_insertion` | `orchestrateur/migrations/0001_schema.sql` | function |
| `cycles_verifier_transition` | `cycles_verify_transition` | `orchestrateur/migrations/0001_schema.sql` | function |
| `cycles_verifier_creation` | `cycles_verify_creation` | `orchestrateur/migrations/0001_schema.sql` | function |
| `cycles_proteger` | `cycles_protect` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/migrations/0008_acteurs.sql` | function |
| `outils_proteger_archivage` | `tools_protect_archiving` | `orchestrateur/migrations/0001_schema.sql` | function |
| `cycles_ecrire_historique` | `cycles_write_history` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/migrations/0008_acteurs.sql` | function |
| `taches_proteger` | `tasks_protect` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/migrations/0005_taches-lanceur.sql`, `orchestrateur/migrations/0006_taches-ci-vert.sql` | function |
| `memoire_avec_transition` | `memory_with_transition` | `orchestrateur/migrations/0001_schema.sql` | function |
| `acteurs_proteger` | `actors_protect` | `orchestrateur/migrations/0008_acteurs.sql`, `socle/migrations/0001_socle.sql` | function |
| `renseigner_nom_acteur` | `fill_in_actor_name` | `orchestrateur/migrations/0008_acteurs.sql` | function (0008, transitional) |
| `acteur_canonique` | `canonical_actor` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/migrations/0010_fusion-acteurs.sql`, `orchestrateur/src/db.ts` | function (0010) |
| `acteurs_fusions_verifier` | `actor_merges_verify` | `orchestrateur/migrations/0010_fusion-acteurs.sql` | function |
| `approbations_ajout_seul` | `approvals_append_only` | `orchestrateur/migrations/0001_schema.sql` | trigger |
| `approbations_gate` | `approvals_gate` | `orchestrateur/migrations/0001_schema.sql` | trigger |
| `approbations_nom_acteur` | `approvals_actor_name` | `orchestrateur/migrations/0008_acteurs.sql` | trigger (0008) |
| `approbations_rallonge` | `approvals_top_up` | `orchestrateur/migrations/0001_schema.sql` | trigger |
| `approbations_rallonge_transition` | `approvals_top_up_transition` | `orchestrateur/migrations/0001_schema.sql` | trigger |
| `approbations_sans_truncate` | `approvals_no_truncate` | `orchestrateur/migrations/0001_schema.sql` | trigger |
| `cycles_historique` | `cycles_history` | `orchestrateur/migrations/0001_schema.sql` | trigger |
| `deploiements_ajout_seul` | `deployments_append_only` | `orchestrateur/migrations/0001_schema.sql` | trigger |
| `deploiements_prod` | `deployments_prod` | `orchestrateur/migrations/0001_schema.sql` | trigger |
| `deploiements_sans_truncate` | `deployments_no_truncate` | `orchestrateur/migrations/0001_schema.sql` | trigger |
| `ecarts_ajout_seul` | `deviations_append_only` | `orchestrateur/migrations/0001_schema.sql` | trigger |
| `ecarts_sans_truncate` | `deviations_no_truncate` | `orchestrateur/migrations/0001_schema.sql` | trigger |
| `historique_insertion` | `history_insertion` | `orchestrateur/migrations/0001_schema.sql` | trigger |
| `memoire_sans_truncate` | `memory_no_truncate` | `orchestrateur/migrations/0001_schema.sql` | trigger |
| `memoire_transition` | `memory_transition` | `orchestrateur/migrations/0001_schema.sql` | trigger |
| `messages_ajout_seul` | `messages_append_only` | `orchestrateur/migrations/0001_schema.sql` | trigger |
| `messages_nom_acteur` | `messages_actor_name` | `orchestrateur/migrations/0008_acteurs.sql` | trigger (0008) |
| `messages_sans_truncate` | `messages_no_truncate` | `orchestrateur/migrations/0001_schema.sql` | trigger |
| `outils_archivage` | `tools_archiving` | `orchestrateur/migrations/0001_schema.sql` | trigger |
| `outils_historique_ajout_seul` | `tool_history_append_only` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/tests/db.test.ts` | trigger |
| `outils_historique_nom_acteur` | `tool_history_actor_name` | `orchestrateur/migrations/0008_acteurs.sql` | trigger (0008) |
| `outils_historique_sans_truncate` | `tool_history_no_truncate` | `orchestrateur/migrations/0001_schema.sql` | trigger |
| `resultats_pipeline_ajout_seul` | `pipeline_results_append_only` | `orchestrateur/migrations/0001_schema.sql` | trigger |
| `resultats_pipeline_sans_truncate` | `pipeline_results_no_truncate` | `orchestrateur/migrations/0001_schema.sql` | trigger |
| `taches_protection` | `tasks_protection` | `orchestrateur/migrations/0001_schema.sql` | trigger |
| `taches_sans_truncate` | `tasks_no_truncate` | `orchestrateur/migrations/0001_schema.sql` | trigger |
| `acteurs_protection` | `actors_protection` | `orchestrateur/migrations/0008_acteurs.sql`, `socle/migrations/0001_socle.sql` | trigger |
| `acteurs_sans_truncate` | `actors_no_truncate` | `orchestrateur/migrations/0008_acteurs.sql`, `socle/migrations/0001_socle.sql` | trigger |
| `acteurs_identites_ajout_seul` | `actor_identities_append_only` | `orchestrateur/migrations/0008_acteurs.sql`, `orchestrateur/tests/mutations/mutations.ts`, `socle/migrations/0001_socle.sql` | trigger |
| `acteurs_identites_sans_truncate` | `actor_identities_no_truncate` | `orchestrateur/migrations/0008_acteurs.sql`, `socle/migrations/0001_socle.sql` | trigger |
| `acteurs_fusions_ajout_seul` | `actor_merges_append_only` | `orchestrateur/migrations/0010_fusion-acteurs.sql`, `orchestrateur/tests/mutations/mutations.ts` | trigger |
| `acteurs_fusions_sans_truncate` | `actor_merges_no_truncate` | `orchestrateur/migrations/0010_fusion-acteurs.sql` | trigger |
| `acteurs_fusions_verification` | `actor_merges_verification` | `orchestrateur/migrations/0010_fusion-acteurs.sql` | trigger |
| `approbations_acteur_id_present` | `approvals_actor_id_present` | `orchestrateur/migrations/0008_acteurs.sql`, `orchestrateur/tests/db.test.ts` | constraint (0008, transitional) |
| `approbations_correction_commentee` | `approvals_correction_commented` | `orchestrateur/tests/db.test.ts`, `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/migrations/0001_schema.sql` | constraint |
| `approbations_gate2_empreinte` | `approvals_gate2_digest` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/tests/db.test.ts` | constraint |
| `approbations_perimetre_gate1` | `approvals_gate1_scope` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/tests/db.test.ts` | constraint |
| `approbations_rallonge_si_approuve` | `approvals_top_up_if_approved` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/tests/db.test.ts` | constraint |
| `cycles_dernier_acteur_check` | `cycles_last_actor_check` | `orchestrateur/migrations/0008_acteurs.sql` | constraint (0008 down) |
| `cycles_dernier_acteur_id_present` | `cycles_last_actor_id_present` | `orchestrateur/migrations/0008_acteurs.sql` | constraint (0008) |
| `deploiements_un_par_operation` | `deployments_one_per_operation` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/src/db.ts`, `orchestrateur/tests/db.test.ts` | constraint |
| `ecarts_previous_id_relecteur` | `deviations_previous_id_reviewer` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/tests/db.test.ts` | constraint |
| `ecarts_role_cible_check` | `deviations_target_role_check` | `orchestrateur/migrations/0013_ecart-role-cible.sql`, `orchestrateur/tests/db.test.ts` | constraint (0013) |
| `ecarts_source_check` | `deviations_source_check` | `orchestrateur/migrations/0011_role-builder.sql`, `orchestrateur/tests/db.test.ts` | constraint |
| `ecarts_un_par_empreinte_et_tour` | `deviations_one_per_digest_and_round` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/src/db.ts`, `orchestrateur/tests/db.test.ts` | constraint |
| `messages_acteur_id_present` | `messages_actor_id_present` | `orchestrateur/migrations/0008_acteurs.sql` | constraint (0008) |
| `outils_cycle_courant_fk` | `tools_current_cycle_fk` | `orchestrateur/migrations/0001_schema.sql` | constraint |
| `outils_demandeur_check` | `tools_requester_check` | `orchestrateur/migrations/0008_acteurs.sql` | constraint (0008 down) |
| `outils_demandeur_id_present` | `tools_requester_id_present` | `orchestrateur/migrations/0008_acteurs.sql`, `orchestrateur/tests/db.test.ts` | constraint (0008) |
| `outils_historique_acteur_id_present` | `tool_history_actor_id_present` | `orchestrateur/migrations/0008_acteurs.sql` | constraint (0008) |
| `resultats_pipeline_empreinte` | `pipeline_results_digest` | `orchestrateur/tests/db.test.ts`, `orchestrateur/features/durcissement-review.feature`, `orchestrateur/migrations/0001_schema.sql` | constraint |
| `resultats_pipeline_un_par_passage` | `pipeline_results_one_per_pass` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/src/db.ts`, `orchestrateur/tests/db.test.ts` | constraint |
| `taches_arbre_hash_role_code` | `tasks_tree_hash_code_role` | `orchestrateur/migrations/0011_role-builder.sql`, `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/tests/db.test.ts` | constraint |
| `taches_blocked_avec_raison` | `tasks_blocked_with_reason` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0001_schema.sql` | constraint |
| `taches_ci_vert_si_ci` | `tasks_ci_green_if_ci` | `orchestrateur/migrations/0006_taches-ci-vert.sql`, `orchestrateur/features/steps/lanceur.ts`, `orchestrateur/tests/mutations/mutations.ts` | constraint (0006) |
| `taches_id_deterministe` | `tasks_deterministic_id` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/tests/db.test.ts` | constraint |
| `taches_rapport_si_terminee` | `tasks_report_if_finished` | `orchestrateur/tests/db.test.ts`, `orchestrateur/migrations/0001_schema.sql` | constraint |
| `taches_role_check` | `tasks_role_check` | `orchestrateur/migrations/0011_role-builder.sql`, `orchestrateur/tests/db.test.ts` | constraint (0011) |
| `taches_verdict_si_done` | `tasks_verdict_if_done` | `orchestrateur/migrations/0005_taches-lanceur.sql` | constraint (0005) |
| `acteurs_fusions_cible` | `actor_merges_target` | `orchestrateur/migrations/0010_fusion-acteurs.sql` | index |
| `acteurs_identites_acteur` | `actor_identities_actor` | `orchestrateur/migrations/0008_acteurs.sql`, `socle/migrations/0001_socle.sql` | index |
| `approbations_acteur` | `approvals_actor` | `orchestrateur/migrations/0008_acteurs.sql` | index |
| `approbations_cycle` | `approvals_cycle` | `orchestrateur/migrations/0001_schema.sql` | index |
| `approbations_outil_gate` | `approvals_tool_gate` | `orchestrateur/migrations/0001_schema.sql` | index |
| `cycles_etat` | `cycles_state` | `orchestrateur/migrations/0001_schema.sql` | index |
| `cycles_un_seul_en_cours` | `cycles_one_in_progress` | `orchestrateur/features/steps/verifications.ts`, `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/tests/db.test.ts` | unique index |
| `deploiements_outil_env` | `deployments_tool_env` | `orchestrateur/migrations/0001_schema.sql` | index |
| `ecarts_cycle_tour` | `deviations_cycle_round` | `orchestrateur/migrations/0001_schema.sql` | index |
| `evenements_a_distribuer` | `events_to_dispatch` | `orchestrateur/migrations/0001_schema.sql` | index |
| `notifications_envoyees_cycle` | `sent_notifications_cycle` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/migrations/0007_notifications-envoyees.sql` | index |
| `outils_historique_acteur` | `tool_history_actor` | `orchestrateur/migrations/0008_acteurs.sql` | index |
| `outils_historique_cycle` | `tool_history_cycle` | `orchestrateur/migrations/0001_schema.sql` | index |
| `outils_historique_outil` | `tool_history_tool` | `orchestrateur/migrations/0001_schema.sql` | index |
| `resultats_pipeline_cycle` | `pipeline_results_cycle` | `orchestrateur/migrations/0001_schema.sql` | index |
| `sessions_acteur` | `sessions_actor` | `orchestrateur/migrations/0014_sessions.sql`, `socle/migrations/0001_socle.sql` | index |
| `taches_cycle` | `tasks_cycle` | `orchestrateur/migrations/0001_schema.sql` | index |
| `taches_outil` | `tasks_tool` | `orchestrateur/migrations/0001_schema.sql` | index |
| `taches_statut` | `tasks_status` | `orchestrateur/migrations/0001_schema.sql` | index |
| `phase_gate` | `gate_phase` | `orchestrateur/migrations/0001_schema.sql` | PL/pgSQL variable in `approbations_appliquer_rallonge` |
| `chaine (acteur, profondeur)` (CTE of `canonical_actor`) | `merge_chain (actor, depth)` | `orchestrator/migrations/0010_actor-merge.sql`, `orchestrator/tests/mutations/mutations.ts` | override: a chain of merges (Words gives `string` for `chaine`) |
| `cycles_dernier_acteur_id_present` | `cycles_last_actor_id_present` | `orchestrator/migrations/0008_actors.sql`, `orchestrator/tests/db.test.ts` | CHECK constraint |
| `acteurs_fusions_pkey` | `actor_merges_pkey` | `orchestrator/tests/db.test.ts` | primary key named by PostgreSQL after the table, asserted by the test |

### SQL: CHECK value lists and stored values (besides the state ids)

| French | English | Where | Notes |
|---|---|---|---|
| `entree` | `entry` | `orchestrateur/tests/moteur-claude.test.ts`, `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/src/exterieur/moteur-pousse.ts` | `etats.phase` (see CONVENTIONS) |
| `livraison` | `delivery` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/migrations/0002_machine-etats.sql`, `orchestrateur/migrations/0012_machine-etats.sql` | `etats.phase` |
| `transversal` | `cross_cutting` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/MACHINE.md`, `orchestrateur/migrations/0001_schema.sql` | `etats.phase` |
| `actif` | `active` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/migrations/0002_machine-etats.sql`, `orchestrateur/migrations/0012_machine-etats.sql` | `etats.nature` |
| `attente` | `waiting` | `orchestrateur/migrations/0002_machine-etats.sql`, `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` | `etats.nature` |
| `fin` | `end` | `orchestrateur/migrations/0002_machine-etats.sql`, `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` | `etats.nature`, `etats.phase` |
| `en_file` | `queued` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/migrations/0005_taches-lanceur.sql`, `orchestrateur/migrations/0006_taches-ci-vert.sql` | `taches.statut` |
| `en_cours` | `in_progress` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/features/steps/actions.ts`, `orchestrateur/migrations/0005_taches-lanceur.sql` | `taches.statut` |
| `en_attente` | `pending` | `orchestrateur/migrations/0001_schema.sql` | override: status value `pending` |
| `distribue` | `dispatched` | `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/tests/db.test.ts` | override: an outbox status (`evenements_a_distribuer` → `events_to_dispatch`) |
| `en_echec` | `failed` | `orchestrateur/migrations/0001_schema.sql`, `ROADMAP.md` | override: status value |
| `maquette` | `mockup` | `orchestrateur/features/cadrage.feature`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/machine/etats.ts` | `deploiements.environnement`; also deployer protocol |
| `quarantaine` | `quarantine` | `orchestrateur/features/exploitation.feature`, `orchestrateur/migrations/0001_schema.sql`, `ROADMAP.md` | `deploiements.environnement` |
| `echec` | `failed` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/exterieur/deployeur-ssh.ts`, `orchestrateur/src/exterieur/factices.ts` | `deploiements.sante`, fake answers, and the `health` answer of `deployeur.py` (the engine stores that verdict as is: one concept, one word); override: an outcome value, `failed` like the task status |
| `inconnu` | `unknown` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/db.ts`, `orchestrateur/tests/db.test.ts` | `deploiements.sante` |
| `inconnue` | `unknown` | `orchestrateur/tests/auth.test.ts`, `orchestrateur/src/api.ts`, `orchestrateur/src/db.ts` | digest value when the target cannot read it (`deployeur-ssh.ts`) |
| `vert` | `green` | `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/features/gates-livraison.feature`, `orchestrateur/features/steps/actions.ts` | `resultats_pipeline.resultat`, CI check result |
| `rouge` | `red` | `orchestrateur/features/durcissement-review.feature`, `orchestrateur/src/messages.ts`, `orchestrateur/tests/forge-gitea.test.ts` | idem; also `ResultatCi.issue` |
| `verte` | `green` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/features/lanceur.feature` | `ResultatCi.issue` (feminine) |
| `humain` | `human` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/src/db.ts` | `acteurs.genre` |
| `demandeur` | `requester` | `orchestrateur/features/gates-livraison.feature`, `orchestrateur/features/cadrage.feature`, `orchestrateur/migrations/0015_machine-etats.sql` | `messages.auteur_type`, `notifications_envoyees.destinataire`, `approbations.role` |
| `orchestrateur` | `orchestrator` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/README.md` | `messages.auteur_type`, `ecarts.source` |

### State machine: state ids, phases, kinds, gate outcomes, trigger types

Source of truth `orchestrateur/src/machine/etats.ts`; stored in `etats.id`, `cycles.etat`, `outils.etat_courant`,
`outils_historique.etat`/`etat_precedent`, `taches.etape`, `approbations.gate`, `memoire_cycles`, the generated
state-machine migrations, `MACHINE.md`, the `@t:` tags of the features, the chat page keys `state.*`, the CLI choices
and the verify playbooks. Prefix families are kept: `gate_`, `waiting_`, `hardening_`, `end_`.

| French | English | Where | Notes |
|---|---|---|---|
| `demande_recue` | `request_received` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/migrations/0015_machine-etats.sql` | initial state |
| `recherche_chevauchement` | `overlap_search` | same | |
| `gate_chevauchement` | `gate_overlap` | same | |
| `creation_depot` | `repo_creation` | same | |
| `cadrage` | `scoping` | same | |
| `gate_budget_cadrage` | `gate_scoping_budget` | same | |
| `gate_cadrage_bloque` | `gate_scoping_blocked` | same | |
| `deploiement_maquette` | `mockup_deployment` | same | |
| `attente_avis_cadrage` | `waiting_scoping_feedback` | same, `orchestrateur/web/lang/en.json` | |
| `pause_cadrage` | `scoping_pause` | same | |
| `contrat` | `contract` | same | |
| `gate_contrat_bloque` | `gate_contract_blocked` | same | |
| `durcissement_execution` | `hardening_execution` | same | |
| `durcissement_integration` | `hardening_integration` | same | |
| `durcissement_revue` | `hardening_review` | same | |
| `durcissement_evaluation` | `hardening_evaluation` | same | |
| `gate_durcissement_bloque` | `gate_hardening_blocked` | same | |
| `fusion` | `merge` | same | |
| `attente_ci` | `waiting_ci` | same | |
| `image_candidate` | `candidate_image` | same | word order |
| `deploiement_preview` | `preview_deployment` | same | |
| `pipeline_preview` | `preview_pipeline` | same | word order |
| `attente_avis_preview` | `waiting_preview_feedback` | same, `orchestrateur/web/lang/en.json` | |
| `deploiement_prod` | `prod_deployment` | same | |
| `gate_livraison_bloquee` | `gate_delivery_blocked` | same | |
| `gate_prod_bloquee` | `gate_prod_blocked` | same | |
| `fin_succes` | `end_success` | same, `orchestrateur/web/lang/en.json` | |
| `fin_abandon` | `end_abandonment` | same | |
| `fin_refus` | `end_refusal` | same | |
| `fin_annulation` | `end_cancellation` | same | |
| `entree` (phase) | `entry` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/migrations/0001_schema.sql` (CHECK) | phases: `gate_1`, `gate_2`, `gate_incident` states and the phase values `contrat`, `cadrage`, `durcissement`, `fin` follow the rows above |
| `livraison` (phase) | `delivery` | same | |
| `transversal` (phase) | `cross_cutting` | same | |
| `actif` (kind, column `nature` → `kind`) | `active` | same | kinds: `actif`, `attente`, `gate`, `fin` → `active`, `waiting`, `gate`, `end` |
| `attente` (kind) | `waiting` | same | |
| `approuve` (gate outcome) | `approved` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/src/api.ts` | `IssueGate` → `GateOutcome`; outcomes `approuve`, `correction`, `refuse`, `changement_perimetre` → `approved`, `correction`, `refused`, `scope_change` |
| `refuse` (gate outcome) | `refused` | same | |
| `changement_perimetre` | `scope_change` | same | |
| `delai_depasse` (trigger type) | `timeout_exceeded` | `orchestrateur/src/machine/etats.ts` | trigger types `tache`, `garde`, `evenement`, `gate`, `delai_depasse`, `annulation`, `incident`, `reprise` → `task`, `guard`, `event`, `gate`, `timeout_exceeded`, `cancellation`, `incident`, `resume` |
| `satisfait` (feedback outcome) | `satisfied` | `orchestrateur/src/messages.ts`, `orchestrateur/src/api.ts` | |

### State machine stored values (besides the state ids above)

Stored in `cycles.dernier_declencheur`, `outils_historique.declencheur`, `transitions_autorisees.declencheur`.

| French | English | Where | Notes |
|---|---|---|---|
| `tache:done` | `task:done` | `orchestrateur/MACHINE.md`, `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` | trigger key |
| `tache:failed` | `task:failed` | `orchestrateur/MACHINE.md`, `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` | trigger key |
| `garde:<issue>` | `guard:<outcome>` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/MACHINE.md` | trigger key family |
| `evenement:<nom>[:<issue>]` | `event:<name>[:<outcome>]` | `orchestrateur/src/machine/etats.ts`, `orchestrateur/MACHINE.md`, `orchestrateur/migrations/0012_machine-etats.sql` | trigger key family |
| `gate:<issue>` | `gate:<outcome>` | `orchestrateur/features/gates-livraison.feature`, `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/migrations/0012_machine-etats.sql` | unchanged prefix; outcomes change |
| `reprise:<état>` | `resume:<state>` | `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql`, `orchestrateur/tests/mutations/mutations.ts` | trigger key family |
| `delai_depasse` | `timeout_exceeded` | `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql`, `orchestrateur/MACHINE.md` | trigger key |
| `annulation` | `cancellation` | `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql`, `orchestrateur/src/workflows/cycleOutil.ts` | trigger key |
| `budget_depasse` | `budget_exceeded` | `orchestrateur/MACHINE.md`, `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` | guard outcome (`garde:budget_depasse`) |
| `conforme` | `compliant` | `orchestrateur/features/durcissement-review.feature`, `orchestrateur/features/cadrage.feature`, `orchestrateur/features/steps/actions.ts` | guard outcome |
| `non_conforme` | `non_compliant` | `orchestrateur/features/durcissement-review.feature`, `orchestrateur/MACHINE.md`, `orchestrateur/migrations/0012_machine-etats.sql` | guard outcome |
| `diff_hors_perimetre` | `diff_out_of_scope` | `orchestrateur/tests/machine.test.ts`, `orchestrateur/MACHINE.md`, `orchestrateur/features/durcissement-review.feature` | guard outcome |
| `echec_technique` | `technical_failure` | `orchestrateur/features/cadrage.feature`, `orchestrateur/MACHINE.md`, `orchestrateur/migrations/0012_machine-etats.sql` | guard outcome |
| `escalade` | `escalation` | `orchestrateur/tests/stagnation.test.ts`, `orchestrateur/MACHINE.md`, `orchestrateur/features/durcissement-review.feature` | guard outcome |
| `rapport_illisible` | `unreadable_report` | `orchestrateur/features/entree-chevauchement.feature`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/MACHINE.md` | guard outcome |
| `relances_epuisees` | `reminders_exhausted` | `orchestrateur/MACHINE.md`, `orchestrateur/features/cadrage.feature`, `orchestrateur/migrations/0012_machine-etats.sql` | guard outcome |
| `non_plausible` | `not_plausible` | `orchestrateur/features/lanceur.feature`, `orchestrateur/features/entree-chevauchement.feature`, `orchestrateur/features/steps/actions.ts` | guard outcome |
| `gate1_requise` | `gate1_required` | `orchestrateur/MACHINE.md`, `orchestrateur/features/gates-livraison.feature`, `orchestrateur/migrations/0012_machine-etats.sql` | guard outcome |
| `gate1_deja_accordee` | `gate1_already_granted` | `orchestrateur/MACHINE.md`, `orchestrateur/features/gates-livraison.feature`, `orchestrateur/migrations/0012_machine-etats.sql` | guard outcome |
| `ci_terminee` | `ci_finished` | `orchestrateur/features/durcissement-review.feature`, `orchestrateur/features/steps/actions.ts`, `orchestrateur/features/gates-livraison.feature` | forge event (message type) — `evenement:ci_terminee:verte\|rouge` → `event:ci_finished:green\|red` |
| `pipeline_preview_termine` | `preview_pipeline_finished` | `orchestrateur/features/gates-livraison.feature`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/machine.test.ts` | forge event — `…:vert\|rouge` → `…:green\|red` |
| `approuve` | `approved` | `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/features/gates-livraison.feature`, `orchestrateur/tests/db.test.ts` | gate outcome |
| `refuse` | `refused` | `orchestrateur/MACHINE.md`, `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` | gate outcome |
| `changement_perimetre` | `scope_change` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/db.test.ts`, `orchestrateur/features/gates-livraison.feature` | gate outcome |
| `nettoyage:prod_restauree` | `cleanup:prod_restored` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/robustesse.test.ts` | traced trigger |
| `nettoyage:prod_retiree` | `cleanup:prod_removed` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/robustesse.test.ts` | traced trigger |
| `controle:budget:<enveloppe>:<depasse\|ok>:<cout>/<plafond>` | `check:budget:<envelope>:<exceeded\|ok>:<cost>/<cap>` | `orchestrateur/features/steps/verifications.ts`, `orchestrateur/tests/moteur.test.ts`, `orchestrateur/README.md` | traced trigger |
| `code:inchange:<rôle>` | `code:unchanged:<role>` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/MACHINE.md`, `orchestrateur/src/durcissement/stagnation.ts` | synthetic deviation rule (`ecarts.rule`) |
| `integration:conflit` | `integration:conflict` | `orchestrateur/src/workflows/cycleOutil.ts`, `docs/adr/021-un-seul-agent-builder-ecrit-le-code.md` | synthetic deviation rule |
| `perimetre:<fichier>` | `scope:<file>` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/exterieur/moteur-pousse.ts` | synthetic deviation rule |
| `rapport:<rôle>` | `report:<role>` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/features/durcissement-review.feature`, `orchestrateur/src/workflows/cycleOutil.ts` | synthetic deviation rule |
| `preview_changee` | `preview_changed` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/surveillance.test.ts` | synthetic red check added by the watcher |
| `M2-fin` | `M2-fine` | `orchestrateur/tests/stagnation.test.ts`, `orchestrateur/src/durcissement/stagnation.ts` | stagnation mechanism id; override: French `fin` = fine-grained here |
| `M2-categorie` | `M2-category` | `orchestrateur/src/durcissement/stagnation.ts`, `orchestrateur/tests/stagnation.test.ts` | stagnation mechanism id |
| `M7-herite` | `M7-inherited` | `orchestrateur/src/durcissement/stagnation.ts`, `orchestrateur/tests/stagnation.test.ts` | stagnation mechanism id |
| `fin` | `fine` | `orchestrateur/migrations/0002_machine-etats.sql`, `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` | `Compteurs.fin` (fine counter by rule and file); override as above |
| `categorie` | `category` | `orchestrateur/src/durcissement/stagnation.ts`, `orchestrateur/tests/stagnation.test.ts`, `orchestrateur/features/steps/actions.ts` | `Compteurs.categorie` |
| `herite` | `inherited` | `orchestrateur/src/durcissement/stagnation.ts`, `orchestrateur/tests/stagnation.test.ts`, `orchestrateur/features/steps/verifications.ts` | `Compteurs.herite` |
| `compteur` | `counter` | `orchestrateur/features/durcissement-review.feature`, `orchestrateur/features/cadrage.feature`, `orchestrateur/features/steps/verifications.ts` | `Compteurs.compteur` |
| `depot` | `repo` | `orchestrateur/src/exterieur/forge-gitea.ts`, `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/moteur-claude.test.ts` | operation name (`ArgsOperation.operation`), in operation workflow ids and fake keys `depot:<slug>` |
| `fusion` | `merge` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` | operation name; fake key `fusion:<slug>` |
| `deploiement` | `deployment` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/reprise.test.ts`, `orchestrateur/tests/reprise/enfant.ts` | operation name; also `ResultatOperation.genre` |
| `socle` | `core` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/image-fixe.test.ts` | operation name; also `ResultatOperation.genre` |
| `publication_socle` | `core_publication` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/MACHINE.md` | operation name |
| `hors_perimetre` | `out_of_scope` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/src/workflows/cycleOutil.ts` | `ResultatFusion.resultat`, `ResultatOperation.genre` |
| `conflit` | `conflict` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/exterieur/moteur-pousse.ts` | `ResultatIntegration.resultat`, `ResultatOperation.genre` |
| `erreur` | `error` | `orchestrateur/migrations/0002_machine-etats.sql`, `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` | `ResultatOperation.genre`, fake answers |
| `a_jour` | `up_to_date` | `orchestrateur/src/exterieur/factices.ts` | fake core answer |
| `maj` | `update` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/tests/socle-moteur.test.ts` | fake core answer |
| `en_marche` | `running` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/tests/robustesse.test.ts`, `orchestrateur/tests/surveillance.test.ts` | fake deployer container state |
| `arretee` | `stopped` | `orchestrateur/src/exterieur/factices.ts`, `orchestrateur/features/steps/verifications.ts` | fake deployer container state |
| `retiree` | `removed` | `orchestrateur/features/steps/verifications.ts`, `orchestrateur/src/exterieur/factices.ts` | fake deployer container state |
| `cycle_cree` | `cycle_created` | `orchestrator/migrations/0001_schema.sql`, `orchestrator/migrations/0008_actors.sql`, `orchestrator/tests/db.test.ts` | `tool_history.trigger` of the first row of a cycle |

### Log events and fields, errors

| French | English | Where | Notes |
|---|---|---|---|
| `ErreurDefinitive` | `PermanentError` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/db.ts`, `orchestrateur/src/exterieur/notifications-smtp.ts` | class name also compared as a string |
| `ErreurAutorisation` | `AuthorizationError` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/api.ts` | class name compared as a string after a DBOS round trip (`api.ts`) |
| `ConflitIdempotence` | `IdempotencyConflict` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/api.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `JetonRefuse` | `TokenRefused` | `orchestrateur/src/auth.ts`, `orchestrateur/tests/auth.test.ts`, `orchestrateur/src/api.ts` |  |
| `ErreurForge` | `ForgeError` | `orchestrateur/src/exterieur/forge-gitea.ts`, `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `ErreurDeployeur` | `DeployerError` | `orchestrateur/src/exterieur/deployeur-ssh.ts`, `orchestrateur/tests/deployeur-ssh.test.ts` | class name also compared as a string |
| `Probleme` | `Problem` | `orchestrateur/src/api.ts`, `orchestrateur/tests/mutations/mutations.ts`, `socle/src/http.js` | `api.ts` internal class (RFC 9457 problem) |
| `entetes` | `headers` | `orchestrateur/src/api.ts`, `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/forge-gitea.test.ts` | `Probleme.entetes` |

### npm scripts and package

| French | English | Where | Notes |
|---|---|---|---|
| `@eupadev/orchestrateur` | `@eupadev/orchestrator` | `orchestrateur/package.json` | `package.json` name (private) |
| `test:reprise` | `test:resume` | `orchestrateur/package.json`, `orchestrateur/README.md`, `.github/workflows/moteur.yml` | called by `.github/workflows/moteur.yml` |
| `test:tout` | `test:all` | `orchestrateur/README.md`, `orchestrateur/package.json`, `socle/package.json` |  |
| `migrer` | `migrate` | `orchestrateur/README.md`, `orchestrateur/tests/aides/postgres-jetable.ts`, `orchestrateur/tests/db.test.ts` | `pnpm migrer` → `node src/migrate.ts` |
| `demarrer` | `start` | `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/src/workflows/tacheAgent.ts` |  |
| `generer` | `generate` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/package.json`, `orchestrateur/scripts/generer-controle-claude.ts` | runs `generate-mermaid.ts` and `generate-claude-check.ts` |
| `commun` | `common` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/Dockerfile`, `orchestrateur/src/workflows/cycleOutil.ts` | Dockerfile stage of `orchestrateur/Dockerfile` |
| `dependances` | `dependencies` | `orchestrateur/Dockerfile`, `ROADMAP.md` | Dockerfile stage |
| `/app/consignes` | `/app/instructions` | `images/moteur/.gitea/workflows/publier.yml`, `orchestrateur/Dockerfile`, `orchestrateur/README.md` | path inside the engine image (ENV `CHEMIN_CONSIGNES`) |
| `/app/exemple` | `/app/example` | `orchestrateur/Dockerfile`, `orchestrateur/src/exterieur/moteur-claude.ts` | path inside the engine image (ENV `CHEMIN_EXEMPLE`) |
| `eupadev-moteur` | `eupadev-engine` | `orchestrateur/README.md`, `orchestrateur/Dockerfile` | local image tag in the Dockerfile header comment |

### Git and container formats produced by the engine

| French | English | Where | Notes |
|---|---|---|---|
| `integration/<cycle>/<tour>` | `integration/<cycle>/<round>` | `orchestrateur/src/exterieur/forge-gitea.ts`, `orchestrateur/tests/moteur-claude.test.ts`, `orchestrateur/tests/forge-gitea.test.ts` | branch pattern; only the placeholder name changes |
| `Publication <rôle> (cycle <n>) [skip ci]` | `Publish <role> (cycle <n>) [skip ci]` | `orchestrateur/src/exterieur/forge-gitea.ts`, `orchestrateur/tests/forge-gitea.test.ts`, `docs/adr/023-socle-distributed-through-the-forge-npm-registry.md` | commit message (`forge-gitea.ts publier`) |
| `Socle @eupadev/socle <v> (cycle <n>) [skip ci]` | `Core @eupadev/core <v> (cycle <n>) [skip ci]` | `orchestrateur/features/entree-chevauchement.feature`, `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/src/workflows/cycleOutil.ts` | commit message (core bump) |
| `Intégration <rôle> (cycle <n>, tour <m>)` | `Integrate <role> (cycle <n>, round <m>)` | `orchestrateur/migrations/0002_machine-etats.sql`, `orchestrateur/migrations/0012_machine-etats.sql`, `orchestrateur/migrations/0015_machine-etats.sql` | merge commit message |
| `Cycle <n>, tour <m>` | `Cycle <n>, round <m>` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/db.ts`, `orchestrateur/src/orchestrateur.ts` | PR title |
| `template-outil-ia` | `tool-template` | `orchestrateur/Dockerfile`, `orchestrateur/src/config.ts` | default template repository name (`OptionsForgeGitea.modele`) |
| `svc-orchestrateur` | `svc-orchestrator` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/scripts/essai-integration.ts`, `orchestrateur/README.md` | default forge account (infra creates it) |
| `eupadev.tache` | `eupadev.task` | `orchestrateur/tests/moteur-claude.test.ts`, `orchestrateur/src/exterieur/moteur-claude.ts`, `infra/ansible/verify-agents.yml` | Docker label of agent containers (`ETIQUETTE`) |
| `fa-tache-` | `fa-task-` | `orchestrateur/src/exterieur/moteur-claude.ts` | agent container name prefix |
| `fa-socle-` | `fa-core-` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/socle-moteur.test.ts` | core fetch container prefix |
| `fa-socle-maj-` | `fa-core-update-` | `orchestrateur/tests/socle-moteur.test.ts`, `orchestrateur/src/exterieur/moteur-claude.ts` | core bump container prefix |
| `refs/eupadev/sortie` | `refs/eupadev/output` | `orchestrateur/src/exterieur/moteur-claude.ts` | ref pushed by the launcher |
| `lanceur@eupadev.invalid` | `launcher@eupadev.invalid` | `orchestrateur/src/exterieur/moteur-claude.ts` | commit author of the launcher |
| `lanceur` | `launcher` | `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/exterieur/contrats.ts` | commit author name |
| `deploiement@<hôte>` | `deployment@<host>` | `infra/ansible/tasks/deployeur-acces-cible.yml`, `infra/ansible/verify-deployeur-acces.yml`, `infra/ansible/verify-deployeur.yml` | SSH account of the deployer targets (infra account `deploiement`) |
| `deployer <env> <slug> <cycle> <ref>` | `deploy <env> <slug> <cycle> <ref>` | `orchestrateur/tests/deployeur-ssh.test.ts`, `orchestrateur/src/exterieur/deployeur-ssh.ts`, `orchestrateur/scripts/essai-deploiement.ts` | SSH forced-command protocol with `infra/ansible/roles/deployeur/files/deployeur.py` |
| `arreter <env> <slug> <cycle>` | `stop <env> <slug> <cycle>` | `orchestrateur/tests/service.test.ts`, `orchestrateur/src/main.ts`, `orchestrateur/src/exterieur/deployeur-ssh.ts` | SSH protocol command |
| `retirer <env> <slug> <cycle>` | `remove <env> <slug> <cycle>` | `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/deployeur-ssh.test.ts` | SSH protocol command |
| `servi <env> <slug>` | `served <env> <slug>` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/tests/deployeur-ssh.test.ts`, `orchestrateur/tests/surveillance.test.ts` | SSH protocol command |
| `refus` | `refusal` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/mutations/mutations.ts` | JSON field of a refused SSH answer (exit code 2) |
| `Empreinte du moteur : <ref>` | `Engine digest: <ref>` | `orchestrateur/src/db.ts`, `orchestrateur/migrations/0001_schema.sql`, `orchestrateur/migrations/0002_machine-etats.sql` | last line of `images/moteur/.gitea/workflows/publier.yml` |
| `publier` | `publish` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/features/entree-chevauchement.feature` | job id of `images/moteur/.gitea/workflows/publier.yml` |
| `Image du moteur` | `Engine image` | `orchestrateur/README.md`, `images/moteur/.gitea/workflows/publier.yml`, `images/moteur/README.md` | workflow `name:` of the same file |
| `<registre>/<org>/moteur` | `<registry>/<org>/engine` |  | engine image path (the Gitea repo name, L8) |

### Web page (`web/`)

| French | English | Where | Notes |
|---|---|---|---|
| `btn.cadrage.ok` | `btn.scoping.ok` | `orchestrateur/web/app.js`, `orchestrateur/web/lang/en.json`, `orchestrateur/web/lang/fr.json` | i18n key (`lang/en.json`, `lang/fr.json`, `app.js`) |
| `btn.cadrage.correction` | `btn.scoping.correction` | `orchestrateur/web/app.js`, `orchestrateur/web/lang/en.json`, `orchestrateur/web/lang/fr.json` | i18n key |
| `conv.placeholder.cadrage` | `conv.placeholder.scoping` | `orchestrateur/web/app.js`, `orchestrateur/web/lang/en.json`, `orchestrateur/web/lang/fr.json` | i18n key |
| `hat.demandeur` | `hat.requester` | `orchestrateur/web/lang/en.json`, `orchestrateur/web/lang/fr.json` | i18n key |
| `state.attente_avis_cadrage` | `state.waiting_scoping_feedback` | `orchestrateur/web/lang/en.json`, `orchestrateur/web/lang/fr.json` | i18n key (built from the state id) |
| `state.attente_avis_preview` | `state.waiting_preview_feedback` | `orchestrateur/web/lang/en.json`, `orchestrateur/web/lang/fr.json` | i18n key |
| `state.pause_cadrage` | `state.scoping_pause` | `orchestrateur/web/lang/en.json`, `orchestrateur/web/lang/fr.json` | i18n key |
| `state.fin_succes` | `state.end_success` | `orchestrateur/web/lang/en.json`, `orchestrateur/web/lang/fr.json` | i18n key |
| `state.fin_abandon` | `state.end_abandonment` | `orchestrateur/web/lang/en.json`, `orchestrateur/web/lang/fr.json` | i18n key |
| `state.fin_refus` | `state.end_refusal` | `orchestrateur/web/lang/en.json`, `orchestrateur/web/lang/fr.json` | i18n key |
| `state.fin_annulation` | `state.end_cancellation` | `orchestrateur/web/lang/en.json`, `orchestrateur/web/lang/fr.json` | i18n key |
| `fin_` | `end_` | `orchestrateur/web/app.js`, `orchestrateur/features/steps/verifications.ts` | prefix tested by `app.js` (`etat.startsWith('fin_')`) and `features/steps/verifications.ts` |
| `lang/fr.json` | `lang/fr.json` | `orchestrateur/tests/web.test.ts` | the French dictionary: values stay French by design (L10) |

### Identifiers shared across files: other methods and names

| French | English | Where | Notes |
|---|---|---|---|
| `archiveCadrage` | `scopingArchive` | `orchestrateur/src/exterieur/forge-gitea.ts`, `orchestrateur/src/exterieur/deployeur-ssh.ts`, `orchestrateur/src/exterieur/monde.ts` | `ForgeGitea` method passed to the SSH deployer (`monde.ts`) |
| `cloner` | `clone` | `orchestrateur/src/exterieur/forge-gitea.ts`, `orchestrateur/scripts/essai-integration.ts`, `orchestrateur/src/exterieur/moteur-pousse.ts` | exported helper of `forge-gitea.ts`, used by the pushing engine and `essai-integration.ts` |
| `alerterAdmin` | `alertAdmin` | `orchestrateur/src/orchestrateur.ts`, `orchestrateur/src/workflows/cycleOutil.ts` |  |
| `arreterGuetteur` | `stopWatcher` | `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/web.test.ts`, `orchestrateur/src/main.ts` | `main.ts` |
| `autoriser` | `authorize` | `orchestrateur/tests/aides/oidc-factice.ts`, `orchestrateur/src/orchestrateur.ts`, `orchestrateur/features/support/web.ts` | override: decides the hat and the four-eyes exemption (not a plain "allow") |
| `decidePar` | `decidedBy` | `orchestrateur/src/db.ts`, `orchestrateur/tests/db.test.ts` |  |
| `demandeurId` | `requesterId` | `orchestrateur/src/db.ts`, `orchestrateur/tests/mails.test.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `charte` | `charter` | `orchestrateur/src/moteur/consignes.ts`, `orchestrateur/tests/consignes.test.ts`, `orchestrateur/tests/mutations/mutations.ts` | `consignes.ts` (the agents' charter `AGENTS.md`) |
| `regles` | `rules` | `orchestrateur/src/moteur/consignes.ts`, `orchestrateur/tests/consignes.test.ts`, `orchestrateur/tests/mutations/mutations.ts` |  |
| `monde` | `world` | `orchestrateur/src/main.ts`, `orchestrateur/README.md`, `orchestrateur/src/exterieur/factices.ts` |  |
| `etatDemande` | `requestState` | `orchestrateur/src/api.ts` | `api.ts` |
| `lireJson` | `readJson` | `orchestrateur/src/api.ts` | `api.ts` |
| `repondre` | `respond` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/src/api.ts`, `orchestrateur/src/exterieur/factices.ts` | override: the HTTP helper of `api.ts` → `respond`; the switchboard's `repondre` → `answer` (other row) |
| `rediriger` | `redirect` | `orchestrateur/src/api.ts`, `socle/web/api.js`, `ROADMAP.md` |  |
| `cleIdempotence` | `idempotencyKey` | `orchestrateur/src/api.ts` |  |
| `refus` | `refusal` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/mutations/mutations.ts` | `api.ts` maps engine errors to problems |
| `principalDuJeton` | `principalFromToken` | `orchestrateur/src/api.ts` |  |
| `acteurAvecCasquette` | `actorWithHat` | `orchestrateur/src/api.ts` |  |
| `authentifier` | `authenticate` | `orchestrateur/src/api.ts`, `docs/adr/024-requester-web-page-served-by-the-engine.md` |  |
| `traiterAuth` | `handleAuth` | `orchestrateur/src/api.ts` |  |
| `hotesAcceptes` | `acceptedHosts` | `orchestrateur/src/api.ts` |  |
| `hoteAttendu` | `expectedHost` | `orchestrateur/src/api.ts` |  |
| `traiter` | `handle` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/features/durcissement-review.feature`, `orchestrateur/src/api.ts` |  |
| `mettreAJourSocle` | `updateCore` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/workflows/cycleOutil.ts` | W1 step function (decision A) |
| `lancerTaches` | `launchTasks` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/mutations/mutations.ts` | W1 |
| `attendreTaches` | `waitForTasks` | `orchestrateur/src/workflows/cycleOutil.ts` | W1 |
| `attendreEnfants` | `waitForChildren` | `orchestrateur/src/workflows/cycleOutil.ts` | W1 |
| `tacheSeule` | `singleTask` | `orchestrateur/src/workflows/cycleOutil.ts` | override: W1 helper launching one task |
| `raisonDe` | `reasonOf` | `orchestrateur/src/workflows/cycleOutil.ts` | W1 |
| `attendreDecision` | `waitForDecision` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/README.md`, `ROADMAP.md` | W1 |
| `budgetDepasse` | `budgetExceeded` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/mutations/mutations.ts` | W1 |
| `texteEcart` | `deviationText` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/mutations/mutations.ts` | W1 |
| `ecartsPipeline` | `pipelineDeviations` | `orchestrateur/src/workflows/cycleOutil.ts` | W1 |
| `cleEffet` | `effectKey` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/workflows/cycleOutil.ts` | W1 (idempotency key of a notification) |
| `estAnnulation` | `isCancellation` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/mutations/mutations.ts` | W1 |
| `annuler` | `cancel` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/orchestrateur.ts`, `orchestrateur/features/cadrage.feature` | W1 |
| `finir` | `finish` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/tests/surveillance.test.ts`, `orchestrateur/src/exterieur/contrats.ts` | W1 |
| `recevoir` | `receive` | `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/features/gates-livraison.feature`, `orchestrateur/tests/aides/banc.ts` | W1 |

### Identifiers added in step 4a (shared across files, no row before)

| French | English | Where | Notes |
|---|---|---|---|
| `cleInconnue` | `unknownKey` | `orchestrator/tests/auth.test.ts`, `orchestrator/tests/helpers/fake-oidc.ts` |  |
| `enMarche` | `running` | `orchestrator/features/steps/checks.ts`, `orchestrator/src/external/fakes.ts`, `orchestrator/tests/engine.test.ts` |  |
| `exemplesExecutes` | `executedExamples` | `orchestrator/tests/feature-coverage.test.ts`, `orchestrator/tests/helpers/features.ts` |  |
| `surPerteVerrou` | `onLockLoss` | `orchestrator/src/orchestrator.ts`, `orchestrator/tests/helpers/bench.ts`, `orchestrator/tests/helpers/scheduler-repro.ts` |  |
| `urlMoteur` | `engineUrl` | `orchestrator/features/support/hooks.ts`, `orchestrator/tests/db.test.ts`, `orchestrator/tests/engine.test.ts` |  |
| `urlProprietaire` | `ownerUrl` | `orchestrator/features/support/hooks.ts`, `orchestrator/tests/db.test.ts`, `orchestrator/tests/engine.test.ts` |  |

### Names chosen in step 4b (wire values, fixtures and files with no row before)

| French | English | Where | Notes |
|---|---|---|---|
| — (new) | `orchestrator/lang/en.json`, `orchestrator/lang/fr.json` | `orchestrator/src/i18n.ts`, `orchestrator/Dockerfile`, `infra/ansible/group_vars/forge/vars.yml` | dictionaries of the end-user texts (L10): mails, chat messages, gate reasons, stagnation reasons; keys `mail.*`, `chat.*`, `gate.*`, `reason.*`, `stagnation.*`, `prod.*`, `end.*`, `deadWorkflow.*`, `orphan.*`, `askAgain.*`, `jargon.words`; the French VALUES stay French |
| `<workflow>#<étape>#<sujet>` | `<workflow>#<step>#<key>#<values JSON>` | `orchestrator/src/workflows/toolCycle.ts`, `orchestrator/migrations/0007_notifications.sql`, `infra/ansible/verify-moteur-mails.yml` | idempotency key of a notification: built from the dictionary key and its values, never from the rendered subject; reminders `cycle-<id>#reminder <n>#<state>#<visit>`, weekly `cycle-<id>#weekly <n>#…` |
| `faux`, `etat`, `consignes`, `tache` (report keys of the fake `claude`) | `fake`, `state`, `instructions`, `task` | `orchestrator/tests/helpers/fake-claude/claude`, `orchestrator/tests/claude-engine.test.ts` | state line `oui`/`non` → `yes`/`no`, `cle=` → `key=`, `fichiers=` → `files=`; clone dir `depot.git` → `repo.git`; image `eupadev-claude-factice` → `eupadev-fake-claude` |
| `succes`, `illisible`, `dormir`, `reecrit`, `fusion`, `arbre_git`, `chemin_invisible`, `ecrit_claude_settings`, `ecrit_npmrc`, `lien_symbolique`, `sous_module`, `supprime_protege`, `sans_commit`, `sans_rapport`, `racine_ro` (scenarios of the fake `claude`) | `success`, `unreadable`, `sleep`, `rewritten`, `merge`, `git_tree`, `invisible_path`, `writes_claude_settings`, `writes_npmrc`, `symbolic_link`, `submodule`, `deletes_protected`, `no_commit`, `no_report`, `root_ro` | `orchestrator/tests/helpers/fake-claude/claude`, `orchestrator/tests/claude-engine.test.ts` | chosen by the test, read by the fake script |
| `essai-<tache>`, `vol-<tache>`, `web/commun.js`, `web/maquette-<tache>.html` | `trial-<task>`, `stolen-<task>`, `web/common.js`, `web/mockup-<task>.html` | `orchestrator/src/external/pushing-engine.ts`, `orchestrator/tests/gitea-forge.test.ts`, `infra/ansible/verify-moteur-integration.yml` | files pushed by the pushing engine (E3) |
| `normal`, `fautif`, `hors-perimetre`, `conflit` (`JEUX`) | `normal`, `faulty`, `out-of-scope`, `conflict` (`FILE_SETS`) | `orchestrator/src/external/pushing-engine.ts`, `orchestrator/scripts/trial-integration.ts`, `infra/ansible/verify-moteur-integration.yml` | file sets of the pushing engine, also the slug suffixes of the verify playbooks |
| `creer`; `deployer`, `servi`, `retirer`; `fait` (trial scripts) | `create`; `deploy`, `served`, `remove`; `done` | `orchestrator/scripts/trial-forge.ts`, `orchestrator/scripts/trial-deployment.ts`, `infra/ansible/verify-moteur-forge.yml` | actions on the command line and default answer; also `verify-moteur-preview.yml`, `verify-maquette.yml`, `verify-deployeur.yml` |
| `attente_s` | `wait_s` | `orchestrator/scripts/trial-ci.ts`, `orchestrator/scripts/trial-preview.ts`, `infra/ansible/verify-moteur-ci.yml` | override: a wait in seconds (Words gives `waiting`); outputs `{ci: {outcome, digest, checks: [{check, result}]}, resume, wait_s}`, `{since, result, wait_s}`, tokens `{input, output}` |
| `ÉCHEC (panne passagère\|refus\|erreur)` | `FAILED (transient fault\|refusal\|error)` | `orchestrator/scripts/trial-*.ts` | stderr of the trial scripts, read by the verify playbooks' failure messages |
| `cle-test-1`, `cle-id-token`, `cle-inconnue-` | `test-key-1`, `id-token-key`, `unknown-key-` | `orchestrator/tests/helpers/fake-oidc.ts`, `orchestrator/tests/auth.test.ts` | `kid` values of the fake IdP |
| `fa-essai-*` | `fa-trial-*` | `orchestrator/tests/claude-engine.test.ts` | container name prefix of the tests (registry, proxies), removed by name |
| `nu()`, `journal-push` | `bare()`, `push-log` | `orchestrator/tests/gitea-forge.test.ts` | helper of the fake Gitea and the log written by its git hook (a script embedded in the test) |
| `MODE` `creer`/`reprendre`; `PRET`/`REFUS`; `*.journal`, `reprise-*` | `create`/`resume`; `READY`/`REFUSED`; `*.log`, `resume-*` | `orchestrator/tests/resume/child.ts`, `orchestrator/tests/roles/child.ts`, `orchestrator/tests/resume.test.ts` | interface of the child processes of the resume and roles tests; `DBOS__VMID` `reprise-test` → `resume-test` |
| `robustesse_`, `remplacement_`, `surveillance_` | `robustness_`, `replacement_`, `monitoring_` | `orchestrator/tests/robustness.test.ts`, `orchestrator/tests/replacement.test.ts`, `orchestrator/tests/monitoring.test.ts` | throwaway database name prefixes |
| `genre_<genre>` (Mermaid classes) | `kind_<kind>` | `orchestrator/scripts/generate-mermaid.ts`, `orchestrator/MACHINE.md` | `classDef` names of the generated block |

### Test fixture values (features, tests, fakes)

| French | English | Where | Notes |
|---|---|---|---|
| `exemple.test` | `example.test` | `orchestrateur/tests/config.test.ts`, `orchestrateur/tests/aides/banc.ts`, `orchestrateur/tests/aides/repro-planificateur.ts` | test domain of every fixture (`DOMAINE_OUTILS`, mails `demandeur@exemple.test` → `requester@example.test`, `admin@exemple.test` → `admin@example.test`) |
| `demandeur@exemple.test` | `requester@example.test` | `orchestrateur/tests/aides/banc.ts`, `orchestrateur/tests/db.test.ts` |  |
| `inventaire` | `inventory` | `orchestrateur/features/cadrage.feature`, `orchestrateur/features/exploitation.feature`, `orchestrateur/features/gates-livraison.feature` | default fixture slug (`SLUG_PAR_DEFAUT`) |
| `parc-auto` | `car-fleet` | `orchestrateur/features/entree-chevauchement.feature`, `orchestrateur/features/exploitation.feature`, `orchestrateur/tests/forge-gitea.test.ts` | fixture tool slug (features `entree-chevauchement`, `exploitation`) |
| `parc` | `fleet` | `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/features/entree-chevauchement.feature`, `orchestrateur/features/exploitation.feature` | fixture slug |
| `outil-invente` | `made-up-tool` | `orchestrateur/features/entree-chevauchement.feature` | fixture slug |
| `outil-essai` | `trial-tool` | `orchestrateur/tests/socle-moteur.test.ts`, `orchestrateur/tests/moteur-claude.test.ts`, `socle/tests/keycloak/realm-test.json` | fixture slug (also the template's Keycloak client: template/infra area) |
| `conges` | `leave` | `orchestrateur/tests/deployeur-ssh.test.ts`, `infra/ansible/roles/deployeur/files/test_deployeur.py` | fixture slug (`deployeur-ssh.test.ts`) |
| `<slug>.cadrage.<domaine>` | `<slug>.scoping.<domain>` |  | the mock-up host name pattern; built by the deployer target (infra `deployeur.py`, Caddy) and by the fake deployer |
| `.cadrage.` | `.scoping.` | `orchestrateur/features/cadrage.feature` | asserted by `features/steps/verifications.ts` |
| `<slug>.preview.<domaine>` | `<slug>.preview.<domain>` |  | unchanged label |
| `J83`, `J90`, `J97`, `J104` | `D83`, `D90`, `D97`, `D104` | `orchestrateur/features/exploitation.feature` | decommissioning steps ("jour" → day), quoted values of the `@to-wire` scenarios 42 to 45 |

### agent-runner (v1, deleted in step 4a, Q7, with the rows that named only its files; the rows left name engine files too)

| French | English | Where | Notes |
|---|---|---|---|
| `cadrage` | `scoping` | `orchestrateur/MACHINE.md`, `orchestrateur/features/cadrage.feature`, `orchestrateur/migrations/0012_machine-etats.sql` | job type and container role |
| `statut` | `status` | `orchestrateur/tests/service.test.ts`, `orchestrateur/tests/forge-gitea.test.ts`, `orchestrateur/tests/db.test.ts` | n8n data table column |
| `rapport` | `report` | `orchestrateur/features/steps/actions.ts`, `orchestrateur/features/durcissement-review.feature`, `orchestrateur/src/workflows/cycleOutil.ts` | n8n data table column |
| `cout_usd` | `cost_usd` | `orchestrateur/src/workflows/tacheAgent.ts`, `orchestrateur/src/exterieur/moteur-claude.ts`, `orchestrateur/tests/mutations/mutations.ts` | n8n data table column |
| `extrait` | `excerpt` | `orchestrateur/src/exterieur/moteur-claude.ts`, `ROADMAP.md` |  |
| `tours` | `turns` | `orchestrateur/features/durcissement-review.feature`, `orchestrateur/src/workflows/cycleOutil.ts`, `orchestrateur/src/durcissement/stagnation.ts` | override (`tour` in this shape = an agent model turn, `--max-turns`); a hardening round is `round` |
| `manifeste` | `manifest` | `orchestrateur/tests/forge-gitea.test.ts` |  |

### Mutations (`tests/mutations/`)

| French | English | Where | Notes |
|---|---|---|---|
| `panne` | `fault` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/features/incident-technique.feature`, `orchestrateur/src/exterieur/forge-gitea.ts` | key of every entry of `MUTATIONS` (338) |
| `fichier` | `file` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/tests/config.test.ts`, `orchestrateur/features/durcissement-review.feature` | key of every entry; the VALUE is a path of the area and follows the Paths section |
| `remplacements` | `replacements` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/tests/mutations/lancer.ts`, `orchestrateur/tests/mutations/verif-applicabilite.ts` | key; its `[before, after]` pairs are exact code text and break on any rename of that code |
| `attendu` | `expected` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/src/messages.ts`, `orchestrateur/src/orchestrateur.ts` | key (regex of the failing test or scenario name) |
| `--paralleles` | `--parallel` | `orchestrateur/tests/mutations/lancer.ts`, `orchestrateur/README.md` | option of `lancer.ts` |
| `--sans-temoin` | `--no-witness` | `orchestrateur/tests/mutations/lancer.ts`, `orchestrateur/README.md` | option of `lancer.ts` |
| `--tuees` | `--killed` | `orchestrateur/tests/mutations/cliquet.ts`, `.github/workflows/moteur.yml` | option of `cliquet.ts`, passed by `.github/workflows/moteur.yml` |
| `mutations tuées` | `mutations killed` | `orchestrateur/README.md`, `orchestrateur/tests/mutations/cliquet.ts`, `orchestrateur/tests/mutations/lancer.ts` | text printed by `lancer.ts` and grepped by `.github/workflows/moteur.yml` (`sed -n 's#^\([0-9]*\)/[0-9]* mutations tuées.*#\1#p'`) |
| `SURVIT` | `SURVIVES` | `orchestrateur/tests/mutations/lancer.ts` | verdict printed by `lancer.ts` |
| `tuée` | `killed` | `orchestrateur/tests/mutations/lancer.ts`, `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/README.md` | verdict |
| `TUÉE POUR UNE AUTRE RAISON` | `KILLED FOR ANOTHER REASON` | `orchestrateur/tests/mutations/lancer.ts` | verdict |
| `ROUGE` | `RED` | `orchestrateur/tests/mutations/lancer.ts`, `infra/ansible/verify-template.yml`, `template-outil-ia/.gitea/controles/garde-fous.sh` | witness run line |
| `mutation-orchestrateur-` | `mutation-orchestrator-` | `orchestrateur/tests/mutations/lancer.ts` | temporary directory prefix |
| `SOCLE-` | `CORE-` | `orchestrateur/tests/mutations/mutations.ts`, `ROADMAP.md` | mutation id prefix (6 ids) |
| `MES-` | `MEAS-` | `orchestrateur/tests/mutations/mutations.ts` | override: mutation id prefix (3 ids), `MES` = measure |
| `CONS-` | `INSTR-` | `orchestrateur/tests/mutations/mutations.ts`, `orchestrateur/README.md`, `docs/adr/018-les-instructions-viennent-de-l-image-signee.md` | mutation id prefix (5 ids, instructions) |
| `REMPL` | `REPL` | `orchestrateur/tests/mutations/mutations.ts` | helper constant of `mutations.ts` (test file `remplacement.test.ts`) |
| `SURV` | `MON` | `orchestrateur/tests/mutations/mutations.ts` | helper constant (`surveillance.test.ts` → `monitoring.test.ts`) |
| `DSSH` | `SSHD` | `orchestrateur/tests/mutations/mutations.ts` | helper constant (`deployeur-ssh.test.ts` → `ssh-deployer.test.ts`) |
| `SORTIE` | `OUTPUT` | `orchestrateur/tests/mutations/mutations.ts`, `images/agent/controle/essai-amont/lancer.sh` | helper constant (`claude-sortie.test.ts`) |
| `CONSIGNES` | `INSTRUCTIONS` | `orchestrateur/tests/mutations/mutations.ts`, `images/agent/controle/essai-amont/essai.sh`, `images/agent/controle/essai-amont/verifier.mjs` | helper constant |
| `CHEMINS` | `PATHS` | `orchestrateur/tests/mutations/mutations.ts` | helper constant |
| `SOCLE` | `CORE` | `orchestrateur/tests/mutations/mutations.ts`, `template-outil-ia/.gitea/controles/paquet.mjs`, `exemples/demandes/tests/stack.js` | helper constant (`socle-moteur.test.ts`) |
| `SOCLE-*`, `A-SOCLE-*`, `G4-verrou-*`, `G4-specificateur`, `G4-*-interdit` (mutation ids) | `CORE-*`, `A-CORE-*`, `G4-lockfile-*`, `G4-specifier`, `G4-*-forbidden` | `orchestrateur/tests/mutations/mutations.ts` | moved in step 2 |

### Gherkin

Keywords: the 9 features start with `# language: fr` and `cucumber.json` sets `"language": "fr"`; both go (English is Cucumber's default). `Fonctionnalité` → `Feature`, `Contexte` → `Background`, `Scénario` → `Scenario`, `Plan du scénario` → `Scenario Outline`, `Exemples` → `Examples`, `Étant donné` → `Given`, `Quand` → `When`, `Alors` → `Then`, `Et` → `And`, `Mais` → `But`. `tests/aides/features.ts` parses the French keywords itself (`Scénario|Plan du [Ss]cénario|Exemple`, `Exemples:`): it changes in the same commit.

| French | English | Where | Notes |
|---|---|---|---|
| `@a-brancher` | `@to-wire` | `orchestrateur/features/exploitation.feature`, `orchestrateur/features/erreurs-connues-v1.feature`, `orchestrateur/features/durcissement-review.feature` | scenarios without step definitions; `cucumber.json` filter `not @a-brancher`, `A_BRANCHER` |
| `@exemple` | `@example` | `orchestrateur/tests/mails.test.ts` |  |
| `@t:<de>--<déclencheur>--><vers>` | `@t:<from>--<trigger>--><to>` | `orchestrateur/features/gates-livraison.feature`, `orchestrateur/features/support/hooks.ts`, `orchestrateur/tests/couverture-features.test.ts` | transition coverage tags (108): they embed state ids and trigger keys, checked by `tests/couverture-features.test.ts` against `etats.ts` |
| `<!-- genere:debut -->` | `<!-- generated:start -->` | `orchestrateur/MACHINE.md`, `orchestrateur/scripts/generer-mermaid.ts` | markers of the generated block of `MACHINE.md` (`scripts/generer-mermaid.ts`) |
| `<!-- genere:fin -->` | `<!-- generated:end -->` | `orchestrateur/MACHINE.md`, `orchestrateur/scripts/generer-mermaid.ts` | idem |

Step definitions (every `Given`/`When`/`Then` expression of `features/steps/*.ts`; the `.feature` files use them verbatim, with quoted state ids, trigger keys and table names that follow the sections above):

| French | English | Where | Notes |
|---|---|---|---|
| `les seuils par défaut` | `the default thresholds` | `features/steps/actions.ts:23` | Given |
| `le moteur d'agent factice` | `the fake agent engine` | `features/steps/actions.ts:24` | Given |
| `un cycle de création dans l'état {string}` | `a creation cycle in state {string}` | `features/steps/actions.ts:53` | Given |
| `un cycle de création dans l'état {string} pour l'outil {string}` | `a creation cycle in state {string} for tool {string}` | `features/steps/actions.ts:56` | Given |
| `un cycle de création dans l'état {string} avec l'empreinte en Preview {string}` | `a creation cycle in state {string} with digest {string} in Preview` | `features/steps/actions.ts:59` | Given |
| `un cycle de création dans l'état {string} pour l'outil {string} avec l'empreinte en Preview {string}` | `a creation cycle in state {string} for tool {string} with digest {string} in Preview` | `features/steps/actions.ts:62` | Given |
| `un cycle de création demandé par l'admin dans l'état {string}` | `a creation cycle requested by the admin in state {string}` | `features/steps/actions.ts:66` | Given |
| `un cycle d'évolution dans l'état {string}` | `an evolution cycle in state {string}` | `features/steps/actions.ts:74` | Given |
| `un cycle d'évolution dans l'état {string} pour cet outil` | `an evolution cycle in state {string} for this tool` | `features/steps/actions.ts:77` | Given |
| `un cycle d'évolution dans l'état {string} pour cet outil avec l'empreinte en Preview {string}` | `an evolution cycle in state {string} for this tool with digest {string} in Preview` | `features/steps/actions.ts:80` | Given |
| `un cycle d'évolution dans l'état {string} pour cet outil avec l'empreinte approuvée {string}` | `an evolution cycle in state {string} for this tool with approved digest {string}` | `features/steps/actions.ts:83` | Given |
| `un cycle de création conduit dans l'état {string} dont la sortie échoue avec l'erreur {string}` | `a creation cycle driven to state {string} whose exit fails with error {string}` | `features/steps/actions.ts:90` | Given |
| `une erreur interne survient à la sortie de l'état {string} avec l'erreur {string}` | `an internal error occurs when leaving state {string} with error {string}` | `features/steps/actions.ts:103` | When |
| `le workflow du cycle meurt pendant que le cycle attend ses tâches` | `the cycle's workflow dies while the cycle waits for its tasks` | `features/steps/actions.ts:110` | When |
| `un cycle de création retenu dans l'état {string}` | `a creation cycle held in state {string}` | `features/steps/actions.ts:115` | Given |
| `la dernière version publiée du socle {string} alors que l'outil est en {string}` | `the latest published core version {string} while the tool is on {string}` | `features/steps/actions.ts:121` | Given |
| `un registre du socle injoignable` | `an unreachable core registry` | `features/steps/actions.ts:124` | Given |
| `un outil en production avec l'empreinte {string}` | `a tool in production with digest {string}` | `features/steps/actions.ts:128` | Given |
| `un outil en production dont le cycle de création a coûté {int} $` | `a tool in production whose creation cycle cost {int} $` | `features/steps/actions.ts:135` | Given |
| `un outil existant {string} approuvé à la Gate 1 avec le commentaire {string}` | `an existing tool {string} approved at Gate 1 with comment {string}` | `features/steps/actions.ts:144` | Given |
| `un outil archivé` | `an archived tool` | `features/steps/actions.ts:151` | Given |
| `un coût cumulé du cycle de {int} $` | `a cumulative cycle cost of {int} $` | `features/steps/actions.ts:172` | Given |
| `une durée de travail des agents cumulée de {int} minutes sur le cycle` | `a cumulative agent work duration of {int} minutes on the cycle` | `features/steps/actions.ts:175` | Given |
| `le demandeur a déjà reçu {int} relances` | `the requester has already received {int} reminders` | `features/steps/actions.ts:178` | Given |
| `le chat du cycle contient le message du demandeur {string}` | `the cycle's chat contains the requester's message {string}` | `features/steps/actions.ts:181` | Given |
| `le chat du cycle contient le message de l'orchestrateur {string}` | `the cycle's chat contains the orchestrator's message {string}` | `features/steps/actions.ts:184` | Given |
| `une tâche d'agent du cycle en cours d'exécution si l'état en lance une` | `an agent task of the cycle running if the state launches one` | `features/steps/actions.ts:187` | Given |
| `la branche d'itération modifie le fichier {string} depuis le rôle {string}` | `the iteration branch changes file {string} from role {string}` | `features/steps/actions.ts:199` | Given |
| `une configuration sans la variable {string}` | `a configuration without variable {string}` | `features/steps/actions.ts:202` | Given |
| `la demande est traitée` | `the request is handled` | `features/steps/actions.ts:221` | When |
| `le moteur factice renvoie pour {string} un rapport conforme` | `the fake engine returns a compliant report for {string}` | `features/steps/actions.ts:222` | When |
| `le moteur factice renvoie un rapport conforme pour les rôles {string}` | `the fake engine returns a compliant report for roles {string}` | `features/steps/actions.ts:225` | When |
| `le moteur factice renvoie pour {string} le verdict {string}` | `the fake engine returns verdict {string} for {string}` | `features/steps/actions.ts:228` | When |
| `le moteur factice renvoie pour {string} le verdict {string} avec la raison {string}` | `the fake engine returns verdict {string} for {string} with reason {string}` | `features/steps/actions.ts:231` | When |
| `le moteur factice renvoie pour {string} le verdict {string} sur l'outil {string} avec la raison {string}` | `the fake engine returns verdict {string} for {string} on tool {string} with reason {string}` | `features/steps/actions.ts:234` | When |
| `le moteur factice renvoie pour {string} un rapport conforme avec le message au demandeur {string}` | `the fake engine returns a compliant report for {string} with the message to the requester {string}` | `features/steps/actions.ts:237` | When |
| `le moteur factice renvoie pour {string} un échec avec la raison {string}` | `the fake engine returns a failure for {string} with reason {string}` | `features/steps/actions.ts:240` | When |
| `le moteur factice renvoie pour {string} un rapport sans verdict dont le résumé commence par {string}` | `the fake engine returns for {string} a report without verdict whose summary starts with {string}` | `features/steps/actions.ts:243` | When |
| `le moteur factice renvoie pour {string} un rapport conforme sans coût déclaré` | `the fake engine returns a compliant report for {string} without a declared cost` | `features/steps/actions.ts:246` | When |
| `le moteur factice renvoie pour {string} un rapport invalide au schéma` | `the fake engine returns a report invalid against the schema for {string}` | `features/steps/actions.ts:249` | When |
| `le moteur factice renvoie pour {string} l'état {string} avec la raison {string}` | `the fake engine returns state {string} for {string} with reason {string}` | `features/steps/actions.ts:252` | When |
| `le moteur factice renvoie pour {string} un rapport avec les écarts :` | `the fake engine returns for {string} a report with the deviations:` | `features/steps/actions.ts:256` | When |
| `le moteur factice renvoie pour {string} l'état {string} avec les écarts :` | `the fake engine returns for {string} state {string} with the deviations:` | `features/steps/actions.ts:260` | When |
| `le moteur factice renvoie pour {string} un rapport avec l'écart {string} sur {string}, étiquette absente de la liste fermée du schéma` | `the fake engine returns for {string} a report with deviation {string} on {string}, a label missing from the schema's closed list` | `features/steps/actions.ts:265` | When |
| `le moteur factice renvoie pour {string} un rapport conforme sans modifier aucun fichier` | `the fake engine returns a compliant report for {string} without changing any file` | `features/steps/actions.ts:268` | When |
| `le moteur factice renvoie pour {string} l'état {string} avec la raison {string} sans modifier aucun fichier` | `the fake engine returns state {string} for {string} with reason {string} without changing any file` | `features/steps/actions.ts:274` | When |
| `le moteur factice renvoie pour {string} un rapport conforme en remettant ses fichiers dans l'état de l'itération {int}` | `the fake engine returns a compliant report for {string}, putting its files back as they were at iteration {int}` | `features/steps/actions.ts:281` | When |
| `le moteur factice ne répond pas pour {string} pendant {int} minutes` | `the fake engine does not answer for {string} for {int} minutes` | `features/steps/actions.ts:286` | When |
| `le moteur factice déclare un coût de {int} $ par tâche` | `the fake engine declares a cost of {int} $ per task` | `features/steps/actions.ts:289` | When |
| `le moteur factice déclare une durée de travail de {int} minutes par tâche` | `the fake engine declares a work duration of {int} minutes per task` | `features/steps/actions.ts:292` | When |
| `le moteur factice déclare une attente en file de {int} minutes par tâche` | `the fake engine declares a queue wait of {int} minutes per task` | `features/steps/actions.ts:295` | When |
| `le tour {int} de durcissement se joue avec, pour {string}, les écarts :` | `hardening round {int} is played with, for {string}, the deviations:` | `features/steps/actions.ts:335` | When |
| `le tour de durcissement suivant se joue avec, pour {string}, les écarts :` | `the next hardening round is played with, for {string}, the deviations:` | `features/steps/actions.ts:339` | When |
| `le tour {int} de durcissement se joue avec, pour {string}, un rapport dont la catégorie {string} est absente de la liste fermée du schéma` | `hardening round {int} is played with, for {string}, a report whose category {string} is missing from the schema's closed list` | `features/steps/actions.ts:343` | When |
| `l'écart {string} sur {string} présent aux 2 derniers tours` | `deviation {string} on {string} present in the last 2 rounds` | `features/steps/actions.ts:348` | Given |
| `24 tours de durcissement déjà joués, chacun avec moins d'écarts que le précédent et tous différents` | `24 hardening rounds already played, each with fewer deviations than the previous one, all different` | `features/steps/actions.ts:351` | Given |
| `la forge crée le dépôt {string}` | `the forge creates repository {string}` | `features/steps/actions.ts:370` | When |
| `la forge refuse la création du dépôt avec l'erreur {string}` | `the forge refuses to create the repository with error {string}` | `features/steps/actions.ts:373` | When |
| `l'intégration des branches de rôle réussit` | `the integration of the role branches succeeds` | `features/steps/actions.ts:376` | When |
| `l'intégration des branches de rôle échoue avec le conflit {string}` | `the integration of the role branches fails with conflict {string}` | `features/steps/actions.ts:379` | When |
| `la forge accepte le squash dans {string}` | `the forge accepts the squash into {string}` | `features/steps/actions.ts:382` | When |
| `la forge est indisponible pendant le squash dans {string}` | `the forge is unavailable during the squash into {string}` | `features/steps/actions.ts:385` | When |
| `le diff de la branche d'itération est contrôlé par rôle` | `the iteration branch diff is checked per role` | `features/steps/actions.ts:388` | When |
| `la maquette répond au contrôle de santé après {int} secondes` | `the mock-up answers the health check after {int} seconds` | `features/steps/actions.ts:391` | When |
| `la maquette ne répond pas au contrôle de santé pendant {int} secondes` | `the mock-up does not answer the health check for {int} seconds` | `features/steps/actions.ts:394` | When |
| `la Preview répond au contrôle de santé après {int} secondes` | `the Preview answers the health check after {int} seconds` | `features/steps/actions.ts:397` | When |
| `la Preview ne répond pas au contrôle de santé pendant {int} secondes` | `the Preview does not answer the health check for {int} seconds` | `features/steps/actions.ts:400` | When |
| `la Prod répond au contrôle de santé après {int} secondes` | `the Prod answers the health check after {int} seconds` | `features/steps/actions.ts:403` | When |
| `la Prod ne répond pas au contrôle de santé pendant {int} secondes` | `the Prod does not answer the health check for {int} seconds` | `features/steps/actions.ts:406` | When |
| `un déploiement Preview sain de l'empreinte {string} est enregistré dans le cycle après l'approbation` | `a healthy Preview deployment of digest {string} is recorded in the cycle after the approval` | `features/steps/actions.ts:410` | When |
| `la forge signale {string} avec le résultat {string} et l'empreinte {string}` | `the forge signals {string} with result {string} and digest {string}` | `features/steps/actions.ts:421` | When |
| `la forge signale {string} avec le résultat {string} et les contrôles en échec :` | `the forge signals {string} with result {string} and the failed checks:` | `features/steps/actions.ts:426` | When |
| `la forge signale {string} avec le résultat {string}` | `the forge signals {string} with result {string}` | `features/steps/actions.ts:433` | When |
| `la forge tente de signaler une CI verte avec l'empreinte {string} et le contrôle rouge {string}` | `the forge tries to signal a green CI with digest {string} and red check {string}` | `features/steps/actions.ts:437` | When |
| `la forge reste silencieuse pendant {int} minutes` | `the forge stays silent for {int} minutes` | `features/steps/actions.ts:441` | When |
| `la livraison jusqu'au pipeline Preview se rejoue avec l'empreinte {string}` | `the delivery up to the Preview pipeline replays with digest {string}` | `features/steps/actions.ts:445` | When |
| `le cycle entre dans la gate {string}` | `the cycle enters gate {string}` | `features/steps/actions.ts:449` | When |
| `le demandeur envoie l'avis cadrage {string}` | `the requester sends scoping feedback {string}` | `features/steps/actions.ts:455` | When |
| `le demandeur envoie l'avis cadrage {string} avec le texte {string}` | `the requester sends scoping feedback {string} with text {string}` | `features/steps/actions.ts:458` | When |
| `le demandeur envoie l'avis preview {string}` | `the requester sends preview feedback {string}` | `features/steps/actions.ts:461` | When |
| `le demandeur envoie l'avis preview {string} avec le texte {string}` | `the requester sends preview feedback {string} with text {string}` | `features/steps/actions.ts:464` | When |
| `le demandeur envoie le message {string}` | `the requester sends message {string}` | `features/steps/actions.ts:467` | When |
| `le demandeur abandonne depuis le chat` | `the requester abandons from the chat` | `features/steps/actions.ts:470` | When |
| `l'admin décide {string} à la gate {string}` | `the admin decides {string} at gate {string}` | `features/steps/actions.ts:483` | When |
| `l'admin décide {string} à la gate {string} avec le texte {string}` | `the admin decides {string} at gate {string} with text {string}` | `features/steps/actions.ts:486` | When |
| `l'admin décide {string} à la gate {string} avec une rallonge de {int} $` | `the admin decides {string} at gate {string} with a top-up of {int} $` | `features/steps/actions.ts:489` | When |
| `l'admin décide {string} à la gate {string} pour l'empreinte {string}` | `the admin decides {string} at gate {string} for digest {string}` | `features/steps/actions.ts:492` | When |
| `l'admin tente d'approuver la gate {string} pour l'empreinte {string}` | `the admin tries to approve gate {string} for digest {string}` | `features/steps/actions.ts:495` | When |
| `l'admin tente d'approuver la gate {string} pour l'empreinte candidate` | `the admin tries to approve gate {string} for the candidate digest` | `features/steps/actions.ts:499` | When |
| `le demandeur tente de décider {string} à la gate {string}` | `the requester tries to decide {string} at gate {string}` | `features/steps/actions.ts:505` | When |
| `le demandeur tente d'annuler le cycle` | `the requester tries to cancel the cycle` | `features/steps/actions.ts:509` | When |
| `l'admin a rattaché par fusion un second acteur au demandeur` | `the admin has merged a second actor into the requester` | `features/steps/actions.ts:514` | Given |
| `le second acteur du demandeur tente d'approuver la gate {string} pour l'empreinte candidate avec la casquette admin` | `the requester's second actor tries to approve gate {string} for the candidate digest with the admin hat` | `features/steps/actions.ts:519` | When |
| `l'admin tente d'approuver la gate {string} sans citer d'empreinte` | `the admin tries to approve gate {string} without citing a digest` | `features/steps/actions.ts:524` | When |
| `l'admin tente de décider {string} à la gate {string} sans commentaire` | `the admin tries to decide {string} at gate {string} without a comment` | `features/steps/actions.ts:528` | When |
| `l'admin annule le cycle` | `the admin cancels the cycle` | `features/steps/actions.ts:532` | When |
| `une demande d'évolution est déposée pour cet outil` | `an evolution request is filed for this tool` | `features/steps/actions.ts:536` | When |
| `{int} heures passent sans réponse du demandeur` | `{int} hours pass without an answer from the requester` | `features/steps/actions.ts:558` | When |
| `{int} heures passent sans réponse de l'admin` | `{int} hours pass without an answer from the admin` | `features/steps/actions.ts:561` | When |
| `une semaine passe sans réponse de l'admin` | `a week passes without an answer from the admin` | `features/steps/actions.ts:565` | When |
| `{int} jours passent sans réponse du demandeur` | `{int} days pass without an answer from the requester` | `features/steps/actions.ts:570` | When |
| `l'orchestrateur démarre` | `the orchestrator starts` | `features/steps/actions.ts:577` | When |
| `le demandeur ouvre la conversation du cycle dans son navigateur` | `the requester opens the cycle's conversation in their browser` | `features/steps/chat.ts:25` | When |
| `le demandeur ouvre sa page dans son navigateur` | `the requester opens their page in their browser` | `features/steps/chat.ts:29` | When |
| `le demandeur ouvre la conversation de l'outil {string}` | `the requester opens the conversation of tool {string}` | `features/steps/chat.ts:33` | When |
| `le demandeur tape dans le chat {string}` | `the requester types {string} in the chat` | `features/steps/chat.ts:38` | When |
| `la page affiche le message {string}` | `the page shows message {string}` | `features/steps/chat.ts:47` | Then |
| `la page n'affiche pas le message {string}` | `the page does not show message {string}` | `features/steps/chat.ts:50` | Then |
| `la page indique {string}` | `the page says {string}` | `features/steps/chat.ts:53` | Then |
| `la liste de ses demandes contient exactement les outils {string} et {string}` | `their list of requests contains exactly tools {string} and {string}` | `features/steps/chat.ts:56` | Then |
| `le moteur factice renvoie pour {string} le verdict {string} avec {int} jetons en entrée et {int} en sortie` | `the fake engine returns verdict {string} for {string} with {int} input tokens and {int} output tokens` | `features/steps/lanceur.ts:26` | When |
| `la tâche {string} de l'itération {int} enregistre le modèle et l'effort de son rôle et l'empreinte des consignes reçues par le moteur` | `task {string} of iteration {int} records its role's model and effort and the digest of the instructions the engine received` | `features/steps/lanceur.ts:30` | Then |
| `les consignes reçues par le moteur pour la tâche {string} de l'itération {int} sont celles du rôle dans le template` | `the instructions the engine received for task {string} of iteration {int} are the role's instructions in the template` | `features/steps/lanceur.ts:40` | Then |
| `le moteur a reçu pour la tâche {string} de l'itération {int} ce modèle, cet effort et la branche {string}` | `the engine received for task {string} of iteration {int} this model, this effort and branch {string}` | `features/steps/lanceur.ts:47` | Then |
| `le moteur a reçu pour la tâche {string} de l'itération {int} les plafonds de son rôle \(durée, tours, budget)` | `the engine received for task {string} of iteration {int} its role's caps \(duration, turns, budget)` | `features/steps/lanceur.ts:58` | Then |
| `la base refuse de changer le modèle, l'effort ou l'empreinte de la tâche {string} de l'itération {int}` | `the database refuses to change the model, the effort or the digest of task {string} of iteration {int}` | `features/steps/lanceur.ts:63` | Then |
| `la tâche {string} de l'itération {int} enregistre {int} jetons en entrée et {int} en sortie` | `task {string} of iteration {int} records {int} input tokens and {int} output tokens` | `features/steps/lanceur.ts:72` | Then |
| `la tâche {string} de l'itération {int} a le verdict {string}` | `task {string} of iteration {int} has verdict {string}` | `features/steps/lanceur.ts:86` | Then |
| `la tâche {string} de l'itération {int} a le verdict {string} et une CI {string}` | `task {string} of iteration {int} has verdict {string} and a {string} CI` | `features/steps/lanceur.ts:90` | Then |
| `la tâche {string} de l'itération {int} n'a pas de verdict` | `task {string} of iteration {int} has no verdict` | `features/steps/lanceur.ts:94` | Then |
| `la base refuse de passer le verdict de la tâche {string} de l'itération {int} à {string} en changeant aussi son coût` | `the database refuses to set the verdict of task {string} of iteration {int} to {string} while also changing its cost` | `features/steps/lanceur.ts:99` | Then |
| `la base refuse de passer le verdict de la tâche {string} de l'itération {int} à {string} sans le résultat de la CI` | `the database refuses to set the verdict of task {string} of iteration {int} to {string} without the CI result` | `features/steps/lanceur.ts:104` | Then |
| `la CI de la branche de la tâche {string} de l'itération {int} répond {string}` | `the CI of the branch of task {string} of iteration {int} answers {string}` | `features/steps/lanceur.ts:109` | When |
| `une nouvelle réponse {string} de la CI ne change pas le verdict de la tâche {string} de l'itération {int}` | `a new {string} answer from the CI does not change the verdict of task {string} of iteration {int}` | `features/steps/lanceur.ts:113` | Then |
| `la base refuse tout nouveau changement du verdict ou du résultat de CI de la tâche {string} de l'itération {int}` | `the database refuses any further change to the verdict or CI result of task {string} of iteration {int}` | `features/steps/lanceur.ts:117` | Then |
| `le cycle passe de {string} à {string} par {string}` | `the cycle moves from {string} to {string} by {string}` | `features/steps/verifications.ts:21` | Then |
| `le cycle reste dans l'état {string} par {string}` | `the cycle stays in state {string} by {string}` | `features/steps/verifications.ts:24` | Then |
| `le cycle est dans l'état {string}` | `the cycle is in state {string}` | `features/steps/verifications.ts:27` | Then |
| `le cycle n'est pas dans l'état {string}` | `the cycle is not in state {string}` | `features/steps/verifications.ts:33` | Then |
| `le cycle n'est pas passé par l'état {string}` | `the cycle has not passed through state {string}` | `features/steps/verifications.ts:37` | Then |
| `le message {string} est traité comme l'avis cadrage {string}` | `message {string} is handled as scoping feedback {string}` | `features/steps/verifications.ts:42` | Then |
| `la table {string} contient exactement une tâche {string} pour l'itération {int}` | `table {string} contains exactly one {string} task for iteration {int}` | `features/steps/verifications.ts:62` | Then |
| `la tâche {string} de l'itération {int} a été créée avant la tâche {string}` | `task {string} of iteration {int} was created before task {string}` | `features/steps/verifications.ts:66` | Then |
| `la table {string} ne contient aucune tâche {string} pour l'itération {int}` | `table {string} contains no {string} task for iteration {int}` | `features/steps/verifications.ts:71` | Then |
| `la table {string} ne contient aucune tâche {string}` | `table {string} contains no {string} task` | `features/steps/verifications.ts:75` | Then |
| `la table {string} ne contient aucune tâche pour l'itération {int}` | `table {string} contains no task for iteration {int}` | `features/steps/verifications.ts:79` | Then |
| `la table {string} ne contient aucune tâche pour l'étape {string}` | `table {string} contains no task for step {string}` | `features/steps/verifications.ts:83` | Then |
| `aucune tâche d'agent n'est lancée` | `no agent task is launched` | `features/steps/verifications.ts:86` | Then |
| `les {int} tâches du tour {int} ont le statut {string}` | `the {int} tasks of round {int} have status {string}` | `features/steps/verifications.ts:93` | Then |
| `la tâche {string} de l'itération {int} a le statut {string}` | `task {string} of iteration {int} has status {string}` | `features/steps/verifications.ts:99` | Then |
| `la tâche {string} de l'itération {int} a un coût de {int} $` | `task {string} of iteration {int} has a cost of {int} $` | `features/steps/verifications.ts:103` | Then |
| `la tâche {string} de l'itération {int} a une empreinte d'arbre` | `task {string} of iteration {int} has a tree hash` | `features/steps/verifications.ts:107` | Then |
| `l'empreinte d'arbre de la tâche {string} de l'itération {int} est égale à celle de l'itération {int}` | `the tree hash of task {string} of iteration {int} equals the one of iteration {int}` | `features/steps/verifications.ts:120` | Then |
| `l'empreinte d'arbre de la tâche {string} de l'itération {int} est différente de celle de l'itération {int}` | `the tree hash of task {string} of iteration {int} differs from the one of iteration {int}` | `features/steps/verifications.ts:124` | Then |
| `le conteneur de la tâche {string} de l'itération {int} est arrêté` | `the container of task {string} of iteration {int} is stopped` | `features/steps/verifications.ts:128` | Then |
| `aucun conteneur d'agent du cycle n'est en cours d'exécution` | `no agent container of the cycle is running` | `features/steps/verifications.ts:133` | Then |
| `toute tâche du cycle encore ouverte a le statut {string}, un coût égal au plafond de budget de son rôle si elle avait démarré et de 0 $ sinon` | `every still open task of the cycle has status {string}, a cost equal to its role's budget cap if it had started and 0 $ otherwise` | `features/steps/verifications.ts:137` | Then |
| `la tâche {string} de l'itération {int} a dans son contexte {string}` | `task {string} of iteration {int} has {string} in its context` | `features/steps/verifications.ts:158` | Then |
| `la prochaine tâche d'agent lancée a dans son contexte {string}` | `the next agent task launched has {string} in its context` | `features/steps/verifications.ts:162` | Then |
| `la tâche {string} de l'itération {int} reçoit comme donnée la précision {string}` | `task {string} of iteration {int} receives the clarification {string} as data` | `features/steps/verifications.ts:167` | Then |
| `la tâche {string} de l'itération {int} ne reçoit pas cette précision dans ses instructions` | `task {string} of iteration {int} does not receive this clarification in its instructions` | `features/steps/verifications.ts:172` | Then |
| `la tâche {string} de l'itération {int} ne reçoit pas {string} dans ses instructions` | `task {string} of iteration {int} does not receive {string} in its instructions` | `features/steps/verifications.ts:179` | Then |
| `la tâche {string} de l'itération {int} reçoit l'écart {string} sur {string}` | `task {string} of iteration {int} receives deviation {string} on {string}` | `features/steps/verifications.ts:185` | Then |
| `la tâche {string} de l'itération {int} ne reçoit pas l'écart {string} sur {string}` | `task {string} of iteration {int} does not receive deviation {string} on {string}` | `features/steps/verifications.ts:189` | Then |
| `la tâche {string} de l'itération {int} reçoit du builder le constat {string} sur {string} avec la preuve {string}` | `task {string} of iteration {int} receives from the builder finding {string} on {string} with evidence {string}` | `features/steps/verifications.ts:193` | Then |
| `la tâche {string} de l'itération {int} reçoit le rapport précédent de {string} de l'itération {int}` | `task {string} of iteration {int} receives the previous report of {string} from iteration {int}` | `features/steps/verifications.ts:198` | Then |
| `le compteur de stagnation de l'écart {string} sur {string} vaut {int}` | `the stagnation counter of deviation {string} on {string} is {int}` | `features/steps/verifications.ts:217` | Then |
| `le compteur de stagnation de la catégorie {string} sur {string} vaut {int}` | `the stagnation counter of category {string} on {string} is {int}` | `features/steps/verifications.ts:221` | Then |
| `le compteur hérité de l'écart {string} sur {string} vaut {int}` | `the inherited counter of deviation {string} on {string} is {int}` | `features/steps/verifications.ts:225` | Then |
| `aucun compteur de stagnation d'écart ni de catégorie n'atteint {int}` | `no deviation or category stagnation counter reaches {int}` | `features/steps/verifications.ts:229` | Then |
| `le nombre d'écarts dédoublonnés des tours {int} à {int} vaut {string}` | `the number of deduplicated deviations of rounds {int} to {int} is {string}` | `features/steps/verifications.ts:234` | Then |
| `le compteur de tours du cycle vaut {int}` | `the cycle's round counter is {int}` | `features/steps/verifications.ts:240` | Then |
| `le compteur « même erreur » du cycle vaut {int}` | `the cycle's "same error" counter is {int}` | `features/steps/verifications.ts:245` | Then |
| `le compteur de tentatives du cycle vaut {int}` | `the cycle's attempt counter is {int}` | `features/steps/verifications.ts:249` | Then |
| `le coût cumulé du cycle est de {int} $` | `the cycle's cumulative cost is {int} $` | `features/steps/verifications.ts:257` | Then |
| `le dépassement du budget du cycle est inférieur ou égal à {int} $` | `the cycle's budget overrun is at most {int} $` | `features/steps/verifications.ts:260` | Then |
| `le contrôle de budget du cadrage du cycle porte sur {int} $ dépensés pour un plafond de {int} $` | `the cycle's scoping budget check is on {int} $ spent for a cap of {int} $` | `features/steps/verifications.ts:264` | Then |
| `le plafond de budget du cadrage du cycle est de {int} $` | `the cycle's scoping budget cap is {int} $` | `features/steps/verifications.ts:268` | Then |
| `le plafond de budget du durcissement du cycle est de {int} $` | `the cycle's hardening budget cap is {int} $` | `features/steps/verifications.ts:271` | Then |
| `le plafond de budget appliqué au contrat est celui du durcissement du cycle, soit {int} $` | `the budget cap applied to the contract is the cycle's hardening cap, {int} $` | `features/steps/verifications.ts:274` | Then |
| `la durée de travail des agents du cycle est de {int} minutes` | `the cycle's agent work duration is {int} minutes` | `features/steps/verifications.ts:280` | Then |
| `le demandeur a reçu {int} relance` | `the requester has received {int} reminder` | `features/steps/verifications.ts:287` | Then |
| `le demandeur a reçu {int} relances` | `the requester has received {int} reminders` | `features/steps/verifications.ts:291` | Then |
| `l'admin a reçu {int} relance` | `the admin has received {int} reminder` | `features/steps/verifications.ts:295` | Then |
| `l'admin a reçu {int} relances` | `the admin has received {int} reminders` | `features/steps/verifications.ts:299` | Then |
| `l'admin a reçu un rappel hebdomadaire sans nouvelle relance tracée` | `the admin has received a weekly reminder without a new traced reminder` | `features/steps/verifications.ts:303` | Then |
| `le demandeur ne reçoit pas de 4e relance` | `the requester does not receive a 4th reminder` | `features/steps/verifications.ts:310` | Then |
| `la notification envoyée à l'admin contient {string}` | `the notification sent to the admin contains {string}` | `features/steps/verifications.ts:314` | Then |
| `le workflow du cycle est toujours en cours` | `the cycle's workflow is still running` | `features/steps/verifications.ts:320` | Then |
| `la notification envoyée à l'admin ne contient pas {string}` | `the notification sent to the admin does not contain {string}` | `features/steps/verifications.ts:324` | Then |
| `aucune notification de gate {string} n'est envoyée à l'admin` | `no gate {string} notification is sent to the admin` | `features/steps/verifications.ts:328` | Then |
| `le demandeur reçoit une notification de fin de cycle` | `the requester receives an end-of-cycle notification` | `features/steps/verifications.ts:332` | Then |
| `le demandeur reçoit le lien {string}` | `the requester receives link {string}` | `features/steps/verifications.ts:335` | Then |
| `le demandeur reçoit avec le lien de la maquette le message {string}` | `the requester receives with the mock-up link the message {string}` | `features/steps/verifications.ts:338` | Then |
| `le demandeur n'a reçu aucun lien vers la maquette` | `the requester has received no link to the mock-up` | `features/steps/verifications.ts:342` | Then |
| `le demandeur n'a reçu aucun lien vers la Preview` | `the requester has received no link to the Preview` | `features/steps/verifications.ts:345` | Then |
| `le faux serveur mail a envoyé à l'admin un message dont le sujet contient {string}` | `the fake mail server has sent the admin a message whose subject contains {string}` | `features/steps/verifications.ts:348` | Then |
| `le message contient le lien du tableau de bord du cycle` | `the message contains the link to the cycle's dashboard` | `features/steps/verifications.ts:351` | Then |
| `la décision est refusée avec le message {string}` | `the decision is refused with message {string}` | `features/steps/verifications.ts:355` | Then |
| `la table {string} contient une décision {string} à la gate {string} par l'acteur {string} sous la casquette {string}` | `table {string} contains a {string} decision at gate {string} by actor {string} under hat {string}` | `features/steps/verifications.ts:358` | Then |
| `la table {string} ne contient aucune décision pour la gate {string}` | `table {string} contains no decision for gate {string}` | `features/steps/verifications.ts:361` | Then |
| `le signal de la forge est refusé avec le message {string}` | `the forge's signal is refused with message {string}` | `features/steps/verifications.ts:366` | Then |
| `la demande d'abandon est refusée avec le message {string}` | `the abandonment request is refused with message {string}` | `features/steps/verifications.ts:369` | Then |
| `la table {string} contient une décision {string} pour la gate {string}` | `table {string} contains a {string} decision for gate {string}` | `features/steps/verifications.ts:375` | Then |
| `la table {string} contient une décision {string} pour la gate {string} avec une rallonge de {int} $` | `table {string} contains a {string} decision for gate {string} with a top-up of {int} $` | `features/steps/verifications.ts:378` | Then |
| `la table {string} contient une décision {string} pour la gate {string} avec l'empreinte {string}` | `table {string} contains a {string} decision for gate {string} with digest {string}` | `features/steps/verifications.ts:381` | Then |
| `la table {string} contient une décision {string} pour la gate {string} avec le commentaire {string}` | `table {string} contains a {string} decision for gate {string} with comment {string}` | `features/steps/verifications.ts:384` | Then |
| `la table {string} contient exactement une décision pour la gate {string}` | `table {string} contains exactly one decision for gate {string}` | `features/steps/verifications.ts:387` | Then |
| `la table {string} contient un déploiement {string} avec la santé {string}` | `table {string} contains a {string} deployment with health {string}` | `features/steps/verifications.ts:391` | Then |
| `la table {string} contient un déploiement {string} de l'empreinte {string} avec la santé {string}` | `table {string} contains a {string} deployment of digest {string} with health {string}` | `features/steps/verifications.ts:394` | Then |
| `le dernier déploiement {string} sain de l'outil a l'empreinte {string}` | `the tool's last healthy {string} deployment has digest {string}` | `features/steps/verifications.ts:397` | Then |
| `la table {string} contient pour le pipeline {string} et l'itération {int} le contrôle {string} avec le résultat {string} contre l'empreinte {string}` | `table {string} contains for pipeline {string} and iteration {int} check {string} with result {string} against digest {string}` | `features/steps/verifications.ts:401` | Then |
| `la table {string} contient pour l'itération {int} l'écart {string} sur {string}` | `table {string} contains for iteration {int} deviation {string} on {string}` | `features/steps/verifications.ts:404` | Then |
| `la table {string} ne contient pour l'itération {int} aucun écart {string}` | `table {string} contains for iteration {int} no deviation {string}` | `features/steps/verifications.ts:407` | Then |
| `la table {string} contient une annulation par l'acteur {string}` | `table {string} contains a cancellation by actor {string}` | `features/steps/verifications.ts:411` | Then |
| `le demandeur lit dans le chat le message de l'orchestrateur {string}` | `the requester reads the orchestrator's message {string} in the chat` | `features/steps/verifications.ts:414` | Then |
| `la plateforme a vérifié le socle une seule fois sans rien publier dans main` | `the platform has checked the core once without publishing anything into main` | `features/steps/verifications.ts:418` | Then |
| `la table {string} contient {int} messages pour le cycle` | `table {string} contains {int} messages for the cycle` | `features/steps/verifications.ts:423` | Then |
| `la table {string} contient une vérification de budget pour l'étape {string} avant le lancement de la tâche {string} de l'itération {int}` | `table {string} contains a budget check for step {string} before the launch of task {string} of iteration {int}` | `features/steps/verifications.ts:427` | Then |
| `la forge a publié dans main le travail {string} avant la tâche {string} de l'itération {int}` | `the forge has published the {string} work into main before task {string} of iteration {int}` | `features/steps/verifications.ts:431` | Then |
| `la table {string} ne contient aucune vérification de budget entre la tâche {string} et la tâche {string} de l'itération {int}` | `table {string} contains no budget check between task {string} and task {string} of iteration {int}` | `features/steps/verifications.ts:438` | Then |
| `l'outil est archivé` | `the tool is archived` | `features/steps/verifications.ts:450` | Then |
| `l'outil n'est pas archivé` | `the tool is not archived` | `features/steps/verifications.ts:453` | Then |
| `aucune donnée du cycle n'est supprimée` | `no data of the cycle is deleted` | `features/steps/verifications.ts:457` | Then |
| `la création d'un nouveau cycle pour cet outil est refusée` | `creating a new cycle for this tool is refused` | `features/steps/verifications.ts:464` | Then |
| `l'outil {string} a exactement un cycle en cours` | `tool {string} has exactly one cycle in progress` | `features/steps/verifications.ts:468` | Then |
| `le conteneur de maquette de l'outil est arrêté` | `the tool's mock-up container is stopped` | `features/steps/verifications.ts:473` | Then |
| `le conteneur de maquette de l'outil est retiré` | `the tool's mock-up container is removed` | `features/steps/verifications.ts:476` | Then |
| `le sous-domaine de cadrage de l'outil est retiré` | `the tool's scoping subdomain is removed` | `features/steps/verifications.ts:479` | Then |
| `l'admin est invité à archiver le dépôt de l'outil dans la forge` | `the admin is asked to archive the tool's repository in the forge` | `features/steps/verifications.ts:485` | Then |
| `l'outil répond en production avec l'empreinte {string}` | `the tool answers in production with digest {string}` | `features/steps/verifications.ts:489` | Then |
| `la Preview de l'outil reste déployée` | `the tool's Preview stays deployed` | `features/steps/verifications.ts:493` | Then |
| `la forge a reçu exactement une demande de création pour le dépôt {string}` | `the forge has received exactly one creation request for repository {string}` | `features/steps/verifications.ts:499` | Then |
| `la forge n'a reçu aucune demande de création de dépôt` | `the forge has received no repository creation request` | `features/steps/verifications.ts:502` | Then |
| `la forge n'a reçu aucune nouvelle demande de CI ni de pipeline Preview` | `the forge has received no new CI or Preview pipeline request` | `features/steps/verifications.ts:506` | Then |
| `le tableau de bord de l'admin montre pour la tâche {string} de l'itération {int} la raison {string}` | `the admin dashboard shows for task {string} of iteration {int} reason {string}` | `features/steps/verifications.ts:517` | Then |
| `le tableau de bord de l'admin montre pour l'itération {int} l'écart {string}` | `the admin dashboard shows for iteration {int} deviation {string}` | `features/steps/verifications.ts:521` | Then |
| `le tableau de bord de l'admin montre l'écart {string} sur {string} comme suite de {string} du tour {int}` | `the admin dashboard shows deviation {string} on {string} as a follow-up of {string} from round {int}` | `features/steps/verifications.ts:525` | Then |
| `le tableau de bord de l'admin montre le cycle « en attente > {int} h »` | `the admin dashboard shows the cycle "waiting > {int} h"` | `features/steps/verifications.ts:529` | Then |
| `l'orchestrateur s'arrête avec le message {string}` | `the orchestrator stops with message {string}` | `features/steps/verifications.ts:541` | Then |
| `aucun workflow n'est lancé` | `no workflow is launched` | `features/steps/verifications.ts:544` | Then |
| `la table {string} contient pour le pipeline {string} et l'itération {int} le contrôle {string} avec le résultat {string}` | `table {string} contains for pipeline {string} and iteration {int} check {string} with result {string}` | `features/steps/verifications.ts:555` | Then |
| `la table {string} ne contient aucune tâche pour l'itération suivante` | `table {string} contains no task for the next iteration` | `features/steps/verifications.ts:558` | Then |

### Rules (no row per instance)

- **Local names** (variables, parameters, private members `#…`, labels) of the area: renamed by Words, no rows.
  The inventory counts 445 one-file French code names plus 71 private members and one-file keys in the area.
- **Test titles** (`test('…')`, 9 `.feature` files with 124 scenario titles) and **comments/JSDoc** (the large majority of
  the area): English prose. A mutation's `tests` command names test titles (`--test-name-pattern "<title>"`) and scenario
  titles (`--name "^20\\. "`, `scenario('20\\. Une rallonge')`): translate them in the same commit as the titles.
- **Mutation ids** (338 entries, 217 with French words, e.g. `A0-dockerfile-interdit` → `A0-dockerfile-forbidden`,
  `CI-guetteur-factice` → `CI-fake-watcher`; renamed in step 4b): words
  translated by Words; prefixes are decision codes and stay (`E`, `AR`, `T`, `ID`, `C`, `A`, `R`, `L`, `S`, `CI`,
  `FU`, `G`, `WEB`, `V`, `OV`, `X`, `D`, `PURGE`, `M`, `MSG`) except `SOCLE`/`MES`/`CONS` (rows above). Every entry's
  `remplacements` is exact code text: it changes in the commit that renames that code, or the campaign reports "not
  applicable" (`verif-applicabilite.ts` catches it). `reference.json` holds only `{"mutations": 338}`.
- **Messages** for developers and operators (22 `console`/`DBOS.logger` calls, every `throw new Error(…)`, the 88 `RAISE`
  messages of the migrations, `Probleme` details of the API, CI step output of `images/moteur/.gitea/workflows/publier.yml`):
  English text. There are no structured log events or log field names in this area (logs are prose lines).
- **Human-facing texts** (L10): the chat messages the engine writes to the requester (`ecrireMessage(…, 'orchestrateur', …)`,
  e.g. `Socle mis à jour : …`), mail subjects and bodies (`notifier('admin'|'demandeur', …)`), gate reasons shown to the
  admin (`motifGate`), the stagnation reasons (`stagnation.ts`) — all hard-coded French in `cycleOutil.ts`,
  `orchestrateur.ts`, `stagnation.ts` today — move to an en/fr dictionary; only the requester's page already has one
  (`web/lang/en.json`, `fr.json`, 51 keys; the French VALUES stay French).
- **State descriptions** (`ETATS[].description`) and **transition notes** (`TRANSITIONS[].note`) are stored by the
  generated migration (`etats.description`, `transitions_autorisees.note`) and rendered in `MACHINE.md`: English; regenerate
  the migration (`generate-transitions.ts`) and the `MACHINE.md` block (`generate-mermaid.ts`, phase labels `LIBELLE_PHASE`
  `Entrée…Fins` → `Entry…Ends`) in the same commit.
- **Agent-facing prose**: `PROMPT` and the `tache.md` text (`moteur-claude.ts`), the finding texts sent back to agents
  (`texteEcart`: `conflit : …`, `contrôle rouge`, `fichier hors du périmètre du rôle`) → English (agents read English
  instructions).
- **Test fixtures with French free text** (chat messages, needs, request names such as `Réservation des véhicules de
  service`): English, except fixtures that deliberately test accents or invisible characters (allow-list them).
- **Docs of the area** (`MACHINE.md` 310 lines, `orchestrateur/README.md` 471 lines,
  `images/moteur/README.md`): English, French copy per the docs convention.

### Couplings that must move in one change set

1. **State machine**: `src/machine/etats.ts` ↔ the generated `*_state-machine.sql` (the LAST one is compared byte for byte
   by `tests/machine.test.ts`, found by its name) ↔ `MACHINE.md` block ↔ the 108 `@t:` tags of the features ↔
   `tests/couverture-features.test.ts` ↔ `web/lang/*.json` `state.*` keys and the `fin_` prefix in `web/app.js` ↔ CLI
   choices of `eupadev.py` ↔ infra verify playbooks that query states and triggers (infra area).
2. **Gherkin**: `cucumber.json` (`"language": "fr"`), the 9 `.feature` files, `features/steps/*.ts` (233 expressions) and the
   keyword parser `tests/aides/features.ts` (`Scénario`, `Exemples:`).
3. **Template names read by the engine** (template area): `WORKFLOW_CI` `controle.yml`, `WORKFLOW_PREVIEW`
   `controle-preview.yml` (`forge-gitea.ts`); `REGLES_PAR_ROLE` `qualite`/`securite` → `.claude/rules/<name>.md`
   (`consignes.ts`), the `report.schema.json` enum values and the stored `ecarts.category` values (`securite.md#Requests`);
   `tests/acceptation/` in `CHEMINS_PAR_ROLE`, `roleProprietaire`, `dansPerimetre`, `/tmp/tache/suite/tests/acceptation/`;
   the default template repo `template-outil-ia`; `agents/report.schema.json` (config default, `Dockerfile` COPY,
   `Dockerfile.dockerignore`); CI job ids embedded in `ci:<job>` rules (`ci:analyse`, `ci:garde-fous`).
4. **Agent container contract**: `/tmp/tache/…` paths, `FA_*` variables, `EUPADEV-*` frame lines, context keys
   (`ecarts`, `constats_builder`, `precision_admin`, …) ↔ `images/agent/managed-settings.json` and
   `images/agent/controle/claude.sh` (both GENERATED by `generer-controle-claude.ts`, checked by `claude-sortie.test.ts`) ↔
   the template's agent instructions that name these paths and keys.
5. **SSH deployer protocol**: commands `deployer|arreter|retirer|servi`, environments `maquette|preview|prod`, JSON fields
   `empreinte|url|sante|raison|refus|cycle`, value `inconnue`, exit code 2, account `deploiement@` ↔
   `infra/ansible/roles/deployeur/files/deployeur.py` and `test_deployeur.py`; mock-up host `<slug>.cadrage.<domain>` ↔
   Caddy/DNS (infra).
6. **Environment variables** ↔ `infra/ansible/roles/orchestrateur/templates/orchestrateur-variables.j2`, the compose file
   (`ADRESSE_API`), `orchestrateur/Dockerfile` ENV and HEALTHCHECK (`PORT_API`, `/sante`).
7. **Database names**: database `orchestrateur`, roles `orch_proprietaire`/`orch_moteur`, the psql variables of
   `sql/roles.sql` ↔ infra (creation, secrets, backups) and `tests/aides/postgres-jetable.ts`.
8. **API**: routes and JSON fields ↔ `scripts/eupadev.py` (+ `test_eupadev.py`), `web/app.js`, verify playbooks
   (`/sante`, `/demandes`), `features/support/web.ts`.
9. **CI** `.github/workflows/moteur.yml`: path filter and `working-directory: orchestrateur`, `pnpm test:reprise`,
   `tests/mutations/cliquet.ts --tuees`, the grep of `mutations tuées`, and `FETCH_HEAD:orchestrateur/tests/mutations/
   reference.json`: in the PR that renames the directory, main's reference is not found and the ratchet silently compares
   only against the branch (one run).
10. **`images/moteur/` → `images/engine/`**: `cosign.pub` is read by path by `images/agent/.gitea/workflows/publier.yml:132`
    and `images/keycloak/.gitea/workflows/publier.yml:82`; the Gitea repo `moteur`; `-f orchestrateur/Dockerfile`.
11. **Names compared as strings**: error classes `ErreurAutorisation` (`api.ts`, after DBOS), `ErreurDefinitive`,
    `ErreurDeployeur`; DBOS step `lancer le pipeline Preview` (read back by the watcher); workflow names `cycleOutil`
    (listed by name), `apiDemande`/`apiMessage` (`#parCle`).
12. **Keep `IMAGE`**: `.github/scripts/verifier-empreintes.py` recognises only a TS constant named exactly `IMAGE`
    (`tests/aides/postgres-jetable.ts`).

## Infra (`infra/`, `images/base-node/`, `images/keycloak/`, image publish workflows)

Scope note: "base" in infra names often means the database ("la base"): those become `db` (see Dictionary
requests). Terms owned by another area (engine tables, routes and states queried by the verify playbooks; core
package and kit names; template files) follow that area's rows: the verify playbooks are listed there in Where.

### Paths (repository)

| French | English | Where | Notes |
|---|---|---|---|
| `images/moteur/` | `images/engine/` | `infra/ansible/group_vars/forge/vars.yml` (`gitea_platform_repos[].src`) | L8; also the source of Gitea repo `engine` |
| `images/socle/` | `images/core/` | `group_vars/forge/vars.yml` | L1 |
| `images/base-node/.gitea/workflows/publier.yml` | `images/base-node/.gitea/workflows/publish.yml` | `tasks/reconstruire-pipeline.yml` (dispatches `publier.yml`) | same rename for `images/{agent,keycloak,moteur,socle}/.gitea/workflows/publier.yml`; workflow file name is dispatched by name |
| `images/keycloak/.gitea/workflows/publier.yml` | `images/keycloak/.gitea/workflows/publish.yml` | `empreinte-moteur.yml -e repo=keycloak` | |
| `images/moteur/.gitea/workflows/publier.yml` | `images/engine/.gitea/workflows/publish.yml` | `empreinte-moteur.yml` | |
| `images/socle/.gitea/workflows/publier.yml` | `images/core/.gitea/workflows/publish.yml` | `verify-socle.yml` | |
| `images/agent/.gitea/workflows/publier.yml` | `images/agent/.gitea/workflows/publish.yml` | `verify-image-agent.yml` | agent-image content: Tool template section |
| `infra/ansible/arret-urgence.yml` | `infra/ansible/emergency-stop.yml` | `infra/README.md`, `infra/CLAUDE.md` | word order |
| `infra/ansible/empreinte-moteur.yml` | `infra/ansible/engine-digest.yml` | `infra/CLAUDE.md` | word order |
| `infra/ansible/enregistrer-outils.yml` | `infra/ansible/register-tools.yml` | `group_vars/all/outils-socle.yml`, `deployeur.py` (refusal text), `tasks/outil-socle-retirer.yml` | |
| `infra/ansible/mesure-ressources.yml` | `infra/ansible/measure-resources.yml` | `infra/CLAUDE.md` | |
| `infra/ansible/nettoyage-registre.yml` | `infra/ansible/registry-cleanup.yml` | `roles/nettoyage_registre/tasks/main.yml` | word order |
| `infra/ansible/verify-deployeur-acces.yml` | `infra/ansible/verify-deployer-access.yml` | `infra/CLAUDE.md` | |
| `infra/ansible/verify-deployeur-socle.yml` | `infra/ansible/verify-deployer-core.yml` | `infra/CLAUDE.md` | |
| `infra/ansible/verify-deployeur.yml` | `infra/ansible/verify-deployer.yml` | `infra/CLAUDE.md` | |
| `infra/ansible/verify-executeur-claude.yml` | `infra/ansible/verify-executor-claude.yml` | `infra/CLAUDE.md` | |
| `infra/ansible/verify-image-base.yml` | `infra/ansible/verify-base-image.yml` | `infra/CLAUDE.md` | L8 `image-base` → `base-image` |
| `infra/ansible/verify-maquette.yml` | `infra/ansible/verify-mockup.yml` | `infra/CLAUDE.md` | |
| `infra/ansible/verify-moteur.yml` | `infra/ansible/verify-engine.yml` | `infra/CLAUDE.md`, `docs/architecture.md` | same pattern for every `verify-moteur-*.yml` below |
| `infra/ansible/verify-moteur-chat.yml` | `infra/ansible/verify-engine-chat.yml` | `infra/CLAUDE.md` | |
| `infra/ansible/verify-moteur-ci.yml` | `infra/ansible/verify-engine-ci.yml` | `docs/architecture.md` | |
| `infra/ansible/verify-moteur-claude.yml` | `infra/ansible/verify-engine-claude.yml` | `docs/architecture.md` | |
| `infra/ansible/verify-moteur-deploiement.yml` | `infra/ansible/verify-engine-deployment.yml` | `infra/CLAUDE.md` | |
| `infra/ansible/verify-moteur-forge.yml` | `infra/ansible/verify-engine-forge.yml` | `docs/architecture.md` | |
| `infra/ansible/verify-moteur-integration.yml` | `infra/ansible/verify-engine-integration.yml` | `docs/architecture.md` | |
| `infra/ansible/verify-moteur-mails.yml` | `infra/ansible/verify-engine-mails.yml` | `docs/architecture.md` | |
| `infra/ansible/verify-moteur-preview.yml` | `infra/ansible/verify-engine-preview.yml` | `infra/CLAUDE.md` | |
| `infra/ansible/verify-orchestrateur.yml` | `infra/ansible/verify-orchestrator.yml` | `docs/architecture.md` | |
| `infra/ansible/verify-prod-bascule.yml` | `infra/ansible/verify-prod-switch.yml` | `infra/CLAUDE.md` | |
| `infra/ansible/verify-sauvegarde.yml` | `infra/ansible/verify-backup.yml` | `infra/CLAUDE.md` | |
| `infra/ansible/verify-socle.yml` | `infra/ansible/verify-core.yml` | `infra/CLAUDE.md` | |
| `infra/ansible/verify-stockage.yml` | `infra/ansible/verify-storage.yml` | `infra/CLAUDE.md` | |
| `infra/ansible/verify-systeme.yml` | `infra/ansible/verify-system.yml` | `infra/CLAUDE.md` | |
| `infra/ansible/files/acceptance-essai/` | `infra/ansible/files/trial-acceptance/` | `verify-moteur-deploiement.yml` | `essai` → `trial`, word order |
| `infra/ansible/files/cosign-outils.pub` | `infra/ansible/files/cosign-tools.pub` | `roles/deployeur/defaults/main.yml` | |
| `infra/ansible/files/mesure-pnpm.sh` | `infra/ansible/files/measure-pnpm.sh` | `verify-agents.yml` | |
| `infra/ansible/files/mesure-ressources.sh` | `infra/ansible/files/measure-resources.sh` | `mesure-ressources.yml` | |
| `infra/ansible/files/nettoyage-registre.py` | `infra/ansible/files/registry-cleanup.py` | `roles/nettoyage_registre/tasks/main.yml`, `tasks/nettoyage-registre.yml` | |
| `infra/ansible/files/outil-socle-essai/` | `infra/ansible/files/trial-core-tool/` | `verify-deployeur-socle.yml` | stand-in image, not the core |
| `infra/ansible/files/outil-socle-essai/migrer.js` | `infra/ansible/files/trial-core-tool/migrate.js` | `verify-deployeur-socle.yml` | mirrors core `bin/migrate.js` |
| `infra/ansible/files/outil-socle-essai/migrer-ko.js` | `infra/ansible/files/trial-core-tool/migrate-ko.js` | `verify-deployeur-socle.yml` | failing-migration stand-in |
| `infra/ansible/files/outil-socle-essai/purger.js` | `infra/ansible/files/trial-core-tool/purge.js` | `verify-deployeur-socle.yml` | mirrors core `bin/purge.js` |
| `infra/ansible/files/registre-essai.py` | `infra/ansible/files/trial-registry.py` | `verify-forge.yml`, `/opt/eupadev/registre-essai.py` | |
| `infra/ansible/files/sonde-reseau.js` | `infra/ansible/files/network-probe.js` | `verify-agents.yml` (`/sonde/sonde-reseau.js`) | |
| `infra/ansible/files/verif-keycloak.py` | `infra/ansible/files/check-keycloak.py` | `verify-keycloak.yml` (`/tmp/verif-keycloak.py`) | |
| `infra/ansible/group_vars/all/outils-socle.yml` | `infra/ansible/group_vars/all/core-tools.yml` | `enregistrer-outils.yml` | "outil socle" = tool built on the core |
| `infra/ansible/group_vars/orchestrateur/` | `infra/ansible/group_vars/orchestrator/` | inventory group name | must match the group |
| `infra/ansible/group_vars/outils/` | `infra/ansible/group_vars/tools/` | inventory group name | must match the group |
| `infra/ansible/roles/deployeur/` | `infra/ansible/roles/deployer/` | `site.yml`, `.github/workflows/infra-lint.yml:33` (runs `test_deployeur.py`) | |
| `infra/ansible/roles/deployeur/files/deployeur.py` | `infra/ansible/roles/deployer/files/deployer.py` | `roles/deployeur/tasks/main.yml`, `test_deployeur.py` (`import deployeur`) | module name imported by its test |
| `infra/ansible/roles/deployeur/files/test_deployeur.py` | `infra/ansible/roles/deployer/files/test_deployer.py` | `.github/workflows/infra-lint.yml:33` | |
| `infra/ansible/roles/deployeur/tasks/jeton.yml` | `infra/ansible/roles/deployer/tasks/token.yml` | `roles/deployeur/tasks/main.yml` | |
| `infra/ansible/roles/executeur/` | `infra/ansible/roles/executor/` | `site.yml`, `verify-executeur-claude.yml`, `verify-moteur.yml` (`include_role`) | |
| `infra/ansible/roles/executeur/tasks/demarrer.yml` | `infra/ansible/roles/executor/tasks/start.yml` | `verify-executeur-claude.yml` (`tasks_from`) | |
| `infra/ansible/roles/executeur/tasks/jeton.yml` | `infra/ansible/roles/executor/tasks/token.yml` | `roles/executeur/tasks/main.yml` | |
| `infra/ansible/roles/executeur/templates/executeur-variables.j2` | `infra/ansible/roles/executor/templates/executor-variables.j2` | `roles/executeur/tasks/main.yml` | |
| `infra/ansible/roles/gitea_org/tasks/depot-plateforme.yml` | `infra/ansible/roles/gitea_org/tasks/platform-repo.yml` | `roles/gitea_org/tasks/main.yml` | |
| `infra/ansible/roles/gitea_org/tasks/org-socle.yml` | `infra/ansible/roles/gitea_org/tasks/core-org.yml` | `roles/gitea_org/tasks/main.yml` | |
| `infra/ansible/roles/gitea_org/tasks/retirer-depot-equipe.yml` | `infra/ansible/roles/gitea_org/tasks/remove-team-repo.yml` | `roles/gitea_org/tasks/main.yml` | |
| `infra/ansible/roles/keycloak/tasks/amorcage.yml` | `infra/ansible/roles/keycloak/tasks/bootstrap.yml` | `roles/keycloak/tasks/main.yml` | |
| `infra/ansible/roles/keycloak/tasks/realm-outils.yml` | `infra/ansible/roles/keycloak/tasks/realm-tools.yml` | `roles/keycloak/tasks/main.yml` | realm `outils` → `tools` |
| `infra/ansible/roles/keycloak/files/base.sql` | `infra/ansible/roles/keycloak/files/db.sql` | `roles/keycloak/tasks/main.yml` | override: "base" = database |
| `infra/ansible/roles/nettoyage_registre/` | `infra/ansible/roles/registry_cleanup/` | `site.yml` | word order |
| `infra/ansible/roles/orchestrateur/` | `infra/ansible/roles/orchestrator/` | `site.yml` | |
| `infra/ansible/roles/orchestrateur/tasks/jeton-forge.yml` | `infra/ansible/roles/orchestrator/tasks/forge-token.yml` | `roles/orchestrateur/tasks/main.yml` | word order |
| `infra/ansible/roles/orchestrateur/tasks/tls-base.yml` | `infra/ansible/roles/orchestrator/tasks/db-tls.yml` | `roles/orchestrateur/tasks/main.yml` | override: "base" = database |
| `infra/ansible/roles/orchestrateur/templates/eupadev-pare-feu-base.service.j2` | `infra/ansible/roles/orchestrator/templates/eupadev-db-firewall.service.j2` | `roles/orchestrateur/tasks/tls-base.yml` | override of CONVENTIONS example (`base-firewall`): it filters the database port |
| `infra/ansible/roles/orchestrateur/templates/orchestrateur-variables.j2` | `infra/ansible/roles/orchestrator/templates/orchestrator-variables.j2` | `roles/orchestrateur/tasks/main.yml` | |
| `infra/ansible/roles/pki_base/` | `infra/ansible/roles/db_pki/` | `roles/orchestrateur/tasks/tls-base.yml`, `roles/executeur/tasks/main.yml`, `roles/postgres_outils/tasks/main.yml` (`include_role`) | override: PKI of the database |
| `infra/ansible/roles/postgres_outils/` | `infra/ansible/roles/postgres_tools/` | `site.yml` | |
| `infra/ansible/roles/postgres_outils/files/eupadev-outils-secrets` | `infra/ansible/roles/postgres_tools/files/eupadev-tools-secrets` | `roles/postgres_outils/tasks/main.yml` | installed as `/usr/local/sbin/eupadev-tools-secrets` |
| `infra/ansible/roles/postgres_outils/templates/eupadev-outils-secrets.service.j2` | `infra/ansible/roles/postgres_tools/templates/eupadev-tools-secrets.service.j2` | `roles/postgres_outils/tasks/main.yml` | |
| `infra/ansible/roles/proxys_agents/` | `infra/ansible/roles/agent_proxies/` | `site.yml` | word order |
| `infra/ansible/roles/sauvegarde/` | `infra/ansible/roles/backup/` | `site.yml`, `verify-sauvegarde.yml` | |
| `infra/ansible/roles/sauvegarde/templates/eupadev-sauvegarde.service.j2` | `infra/ansible/roles/backup/templates/eupadev-backup.service.j2` | `roles/sauvegarde/tasks/main.yml` | also `.timer.j2` and `.sh.j2` |
| `infra/ansible/tasks/attendre-pipeline.yml` | `infra/ansible/tasks/wait-for-pipeline.yml` | `verify-template.yml`, `verify-ci.yml`, `tasks/reconstruire-pipeline.yml` | |
| `infra/ansible/tasks/deployeur-acces-cible.yml` | `infra/ansible/tasks/deployer-target-access.yml` | `verify-deployeur-acces.yml` | |
| `infra/ansible/tasks/moteur-etape.yml` | `infra/ansible/tasks/engine-step.yml` | `verify-moteur*.yml` | |
| `infra/ansible/tasks/moteur-jeton.yml` | `infra/ansible/tasks/engine-token.yml` | `verify-moteur*.yml`, `tasks/moteur-etape.yml` | |
| `infra/ansible/tasks/nettoyage-registre.yml` | `infra/ansible/tasks/registry-cleanup.yml` | `nettoyage-registre.yml`, `verify-forge.yml` | |
| `infra/ansible/tasks/outil-socle-cible.yml` | `infra/ansible/tasks/core-tool-target.yml` | `enregistrer-outils.yml` | |
| `infra/ansible/tasks/outil-socle-retirer.yml` | `infra/ansible/tasks/remove-core-tool.yml` | `verify-deployeur-socle.yml`, `verify-moteur-deploiement.yml` | verb first |
| `infra/ansible/tasks/reconstruire-pipeline.yml` | `infra/ansible/tasks/rebuild-pipeline.yml` | `verify-image-base.yml` | |
| `infra/compose/deployeur/` | `infra/compose/deployer/` | `roles/deployeur/tasks/main.yml` | |
| `infra/compose/deployeur/outil.compose.yml` | `infra/compose/deployer/tool.compose.yml` | `roles/deployeur/tasks/main.yml`, `deployeur.py` (`MODELE`) | |
| `infra/compose/deployeur/outil-socle.compose.yml` | `infra/compose/deployer/core-tool.compose.yml` | `deployeur.py` (`MODELE_SOCLE`) | |
| `infra/compose/executeur/` | `infra/compose/executor/` | `roles/executeur/tasks/main.yml` | |
| `infra/compose/orchestrateur/` | `infra/compose/orchestrator/` | `roles/orchestrateur/tasks/main.yml` | |
| `infra/compose/outils-db/` | `infra/compose/tools-db/` | `roles/postgres_outils/tasks/main.yml` | |
| `infra/compose/agents/proxy-ia/` | `infra/compose/agents/ai-proxy/` | `infra/compose/agents/compose.yml` | IA = AI |
| `socle système`, `Socle commun` (role `base`) | `system base`, `common base` | `site.yml`, `verify-systeme.yml` | not the core: the hosts' common baseline |

### Ansible roles

| French | English | Where | Notes |
|---|---|---|---|
| `deployeur` | `deployer` | `site.yml` | |
| `executeur` | `executor` | `site.yml`, `verify-moteur.yml` | |
| `nettoyage_registre` | `registry_cleanup` | `site.yml` | |
| `orchestrateur` | `orchestrator` | `site.yml` | |
| `pki_base` | `db_pki` | `roles/orchestrateur/tasks/tls-base.yml` | override: "base" = database |
| `postgres_outils` | `postgres_tools` | `site.yml` | |
| `proxys_agents` | `agent_proxies` | `site.yml` | |
| `sauvegarde` | `backup` | `site.yml` | |

### Inventory groups, hosts and Terraform

| French | English | Where | Notes |
|---|---|---|---|
| `orchestrateur` | `orchestrator` | `inventory/lab.yml`, `site.yml`, `hostvars[groups['orchestrateur'][0]]` (≈ 26 files) | inventory group |
| `outils` | `tools` | `inventory/lab.yml`, `site.yml`, `group_vars/orchestrateur/vars.yml` | inventory group |
| `eupadev-outils` | `eupadev-tools` | `inventory/lab.yml`, `terraform/main.tf` (`eupadev-${each.key}`) | VM / inventory host; `eupadev-orch` stays |
| `maintenance_heure` | `maintenance_hour` | `inventory/lab.yml`, `roles/base/tasks/main.yml` | host variable |
| `outils` | `tools` | `terraform/main.tf:61`, `:92` (`var.vms["outils"]`) | Terraform map key; lab rebuilt (L9): no `moved` block |
| `domaine` | `domain` | `terraform/main.tf:31`, `:91-97` | Terraform variable |
| `eupadev-outils-docker` | `eupadev-tools-docker` | `terraform/main.tf` (`eupadev-${each.key}-docker`) | LXD volume, derived |
| `maquette.${var.domaine}` | `mockup.${var.domain}` | `terraform/main.tf:94` | dnsmasq record; same name in deployer Caddyfile and `deployeur.py` |

### Ansible variables

| French | English | Where | Notes |
|---|---|---|---|
| `sauvegarde_dossier` | `backup_dir` | `group_vars/all/vars.yml`, `roles/sauvegarde/*`, `verify-sauvegarde.yml` | |
| `sauvegarde_garder` | `backup_keep` | `roles/sauvegarde/defaults/main.yml`, `group_vars/forge/vars.yml` | |
| `sauvegarde_heure` | `backup_hour` | `roles/sauvegarde/defaults/main.yml` | |
| `swap_taille` | `swap_size` | `group_vars/all/vars.yml`, `roles/base/tasks/main.yml` | |
| `proxys_agents_smk_version` | `agent_proxies_smk_version` | `group_vars/all/vars.yml`, `roles/deployeur/tasks/main.yml` | role prefix follows the role |
| `proxys_agents_smk_sha256` | `agent_proxies_smk_sha256` | `group_vars/all/vars.yml` | |
| `proxys_agents_smk_nom` | `agent_proxies_smk_name` | `group_vars/all/vars.yml`, `roles/deployeur/tasks/main.yml` | |
| `outils_socle` | `core_tools` | `group_vars/all/outils-socle.yml`, `enregistrer-outils.yml` | Gate 1 entries |
| `outils_socle_duree` | `core_tools_duration` | `group_vars/all/outils-socle.yml`, `enregistrer-outils.yml` | |
| `outils_socle_personas` | `core_tools_personas` | `group_vars/all/outils-socle.yml`, `enregistrer-outils.yml`, `verify-deployeur-socle.yml` | entry key `nom` → `name` |
| `outils_socle_oidc` | `core_tools_oidc` | `enregistrer-outils.yml`, `tasks/outil-socle-cible.yml` | set_fact |
| `outils_socle_env` | `core_tools_env` | `enregistrer-outils.yml`, `tasks/outil-socle-cible.yml` | |
| `outils_personas` | `tools_personas` | `enregistrer-outils.yml` | set_fact |
| `deployeur_envs` | `deployer_envs` | `group_vars/ci/vars.yml`, `group_vars/outils/vars.yml`, `roles/deployeur/*` | values `maquette, preview` / `prod` → `mockup, preview` / `prod` |
| `deployeur_utilisateur` | `deployer_user` | `roles/deployeur/defaults/main.yml`, `templates/sudoers.j2` | value `deploiement` → `deployment` (Linux account) |
| `deployeur_ip_moteur` | `deployer_engine_ip` | `roles/deployeur/defaults/main.yml`, `tasks/main.yml` | |
| `deployeur_slug_max` | `deployer_slug_max` | `roles/deployeur/defaults/main.yml` | |
| `deployeur_noms_reserves` | `deployer_reserved_names` | `roles/deployeur/defaults/main.yml` | value `maquette` → `mockup` |
| `deployeur_cosign_version` | `deployer_cosign_version` | `roles/deployeur/defaults/main.yml` | |
| `deployeur_cosign_sha256` | `deployer_cosign_sha256` | `roles/deployeur/defaults/main.yml` | |
| `deployeur_cosign_outils_pub` | `deployer_cosign_tools_pub` | `roles/deployeur/defaults/main.yml` | |
| `deployeur_quota_previews` | `deployer_preview_quota` | `roles/deployeur/defaults/main.yml` | |
| `deployeur_idp_hote` | `deployer_idp_host` | `roles/deployeur/defaults/main.yml`, `templates/smokescreen/*.j2` | |
| `deployeur_idp_adresse` | `deployer_idp_address` | `roles/deployeur/defaults/main.yml` | |
| `deployeur_oidc_issuer` | `deployer_oidc_issuer` | `roles/deployeur/defaults/main.yml` | value path `/realms/outils` → `/realms/tools` |
| `deployeur_purge_heure` | `deployer_purge_hour` | `roles/deployeur/defaults/main.yml`, `templates/eupadev-purge.timer.j2` | |
| `executeur_tls_url` | `executor_tls_url` | `group_vars/agents/vars.yml` | |
| `executeur_image` | `executor_image` | `roles/executeur/defaults/main.yml`, `executeur-variables.j2` | |
| `executeur_orch` | `executor_orch` | `roles/executeur/defaults/main.yml` | |
| `executeur_moteur_claude` | `executor_claude_engine` | `roles/executeur/defaults/main.yml`, `verify-executeur-claude.yml` | word order |
| `executeur_moteur_pousse` | `executor_pushing_engine` | `roles/executeur/defaults/main.yml` | |
| `executeur_config` | `executor_config` | `roles/executeur/defaults/main.yml`, `executeur-variables.j2` | |
| `executeur_jeton` | `executor_token` | `roles/executeur/tasks/jeton.yml`, `group_vars/agents/vars.yml` | set_fact |
| `executeur_jetons` | `executor_tokens` | `roles/executeur/tasks/jeton.yml`, `group_vars/agents/vars.yml` | |
| `executeur_jt` | `executor_token_item` | `roles/executeur/tasks/main.yml`, `tasks/jeton.yml` | loop_var; keys `cred`, `user`, `nom` → `name`, `scopes` |
| `orchestrateur_image` | `orchestrator_image` | `group_vars/orchestrateur/vars.yml`, `roles/orchestrateur/*`, `verify-moteur*.yml` | `-e orchestrateur_image=` too |
| `orchestrateur_mailpit` | `orchestrator_mailpit` | `group_vars/orchestrateur/vars.yml`, `orchestrateur-variables.j2` | |
| `orchestrateur_monde_reel` | `orchestrator_real_world` | `group_vars/orchestrateur/vars.yml`, `roles/executeur/defaults/main.yml`, `verify-moteur-deploiement.yml` | `-e` too |
| `orchestrateur_config` | `orchestrator_config` | `group_vars/orchestrateur/vars.yml`, `orchestrateur-variables.j2` | env keys: see Environment variables |
| `orchestrateur_tls_url` | `orchestrator_tls_url` | `group_vars/orchestrateur/vars.yml` | |
| `orchestrateur_secrets` | `orchestrator_secrets` | `group_vars/orchestrateur/vars.yml`, `roles/orchestrateur/tasks/systemd-creds.yml` | entry keys `nom`/`valeur` → `name`/`value` |
| `orchestrateur_quatre_yeux_derogation_sujet` | `orchestrator_four_eyes_exemption_subject` | `group_vars/orchestrateur/vars.yml`, `roles/orchestrateur/defaults/main.yml` | |
| `orchestrateur_cosign_version` | `orchestrator_cosign_version` | `roles/orchestrateur/defaults/main.yml`, `verify-moteur.yml` | |
| `orchestrateur_cosign_sha256` | `orchestrator_cosign_sha256` | `roles/orchestrateur/defaults/main.yml` | |
| `orchestrateur_base_clients_tls` | `orchestrator_db_tls_clients` | `roles/orchestrateur/defaults/main.yml`, `eupadev-pare-feu-base.service.j2` | override: "base" = database |
| `orchestrateur_oidc_emetteur` | `orchestrator_oidc_issuer` | `roles/orchestrateur/defaults/main.yml` | |
| `orchestrateur_oidc_jwks_url` | `orchestrator_oidc_jwks_url` | `roles/orchestrateur/defaults/main.yml` | |
| `orchestrateur_oidc_audience` | `orchestrator_oidc_audience` | `roles/orchestrateur/defaults/main.yml` | |
| `orchestrateur_oidc_web_client_id` | `orchestrator_oidc_web_client_id` | `roles/orchestrateur/defaults/main.yml` | |
| `orchestrateur_oidc_web_redirect_url` | `orchestrator_oidc_web_redirect_url` | `roles/orchestrateur/defaults/main.yml` | |
| `orchestrateur_jeton_forge` | `orchestrator_forge_token` | `roles/orchestrateur/tasks/jeton-forge.yml`, `group_vars/orchestrateur/vars.yml` | set_fact |
| `orchestrateur_known_hosts` | `orchestrator_known_hosts` | `roles/orchestrateur/tasks/main.yml`, `group_vars/orchestrateur/vars.yml` | set_fact |
| `orchestrateur_recreer` | `orchestrator_recreate` | `roles/orchestrateur/tasks/*.yml` | set_fact |
| `orchestrateur_base_relire` | `orchestrator_db_reread` | `roles/orchestrateur/tasks/tls-base.yml`, `main.yml` | set_fact; "base" = database |
| `keycloak_domaine` | `keycloak_domain` | `group_vars/orchestrateur/vars.yml`, `Caddyfile-auth.j2`, `orchestrateur-variables.j2` | |
| `keycloak_reseau` | `keycloak_network` | `group_vars/orchestrateur/vars.yml` | |
| `keycloak_emetteur` | `keycloak_issuer` | `group_vars/orchestrateur/vars.yml`, `verify-keycloak.yml` | |
| `keycloak_jwks_url_interne` | `keycloak_internal_jwks_url` | `group_vars/orchestrateur/vars.yml` | word order |
| `keycloak_jeton_url_interne` | `keycloak_internal_token_url` | `group_vars/orchestrateur/vars.yml`, `tasks/moteur-jeton.yml` | word order |
| `keycloak_verif_demandeur_mail` | `keycloak_check_requester_mail` | `group_vars/orchestrateur/vars.yml`, `roles/keycloak/tasks/realm.yml` | |
| `keycloak_scopes_defaut` | `keycloak_default_scopes` | `group_vars/orchestrateur/keycloak.yml` | word order |
| `keycloak_scopes_optionnels` | `keycloak_optional_scopes` | `group_vars/orchestrateur/keycloak.yml` | word order |
| `keycloak_client_commun` | `keycloak_common_client` | `group_vars/orchestrateur/keycloak.yml`, `roles/keycloak/tasks/realm.yml` | |
| `keycloak_clients_integres` | `keycloak_builtin_clients` | `group_vars/orchestrateur/keycloak.yml`, `verify-keycloak.yml` | override: Keycloak's term is "built-in" |
| `keycloak_portees` | `keycloak_scope_mappings` | `group_vars/orchestrateur/keycloak.yml`, `roles/keycloak/tasks/realm.yml` | override: avoids a clash with client scopes; keys `de` → `from`, `compte_de_service` → `service_account` |
| `keycloak_personnes` | `keycloak_people` | `group_vars/orchestrateur/keycloak.yml`, `roles/keycloak/tasks/realm.yml` | keys `prenom` → `first_name`, `nom` → `last_name` (override: family name), `groupes` → `groups`, `mdp_temporaire` → `temporary_password`; same keys in `keycloak_master_admins` |
| `keycloak_roles_api` | `keycloak_api_roles` | `group_vars/orchestrateur/keycloak.yml` | word order; key `groupe` → `group` |
| `keycloak_locales` | `keycloak_locales` | `group_vars/orchestrateur/keycloak.yml` | name stays; keys `supportees` → `supported`, `defaut` → `default` (value `fr` stays: L10) |
| `keycloak_realm_outils` | `keycloak_tools_realm` | `group_vars/orchestrateur/keycloak.yml`, `roles/keycloak/tasks/realm-outils.yml`, `verify-keycloak.yml` | |
| `keycloak_outils_adresses` | `keycloak_tool_addresses` | `group_vars/orchestrateur/keycloak.yml`, `realm-outils.yml`, `enregistrer-outils.yml` | key `outil-essai` → `trial-tool` |
| `keycloak_master_empreinte` | `keycloak_master_digest` | `roles/keycloak/tasks/master.yml`, `main.yml` | set_fact |
| `amorcage_realm` | `bootstrap_realm` | `roles/keycloak/tasks/amorcage.yml`, `main.yml` | also `amorcage_client`, `amorcage_secret` → `bootstrap_client`, `bootstrap_secret` |
| `gitea_socle_org` | `gitea_core_org` | `group_vars/forge/vars.yml`, `roles/gitea_org/tasks/org-socle.yml`, `roles/executeur/defaults/main.yml` | |
| `gitea_comptes_humains` | `gitea_human_accounts` | `group_vars/forge/vars.yml`, `roles/gitea_org/tasks/main.yml` | |
| `gitea_membres_supplementaires` | `gitea_additional_members` | `group_vars/forge/vars.yml`, `roles/gitea_org/tasks/main.yml` | |
| `gitea_fichiers_proteges_liste` | `gitea_protected_files_list` | `group_vars/forge/vars.yml`, `orchestrateur/tests/chemins-interdits.test.ts` | the engine test reads this variable by name |
| `gitea_fichiers_proteges` | `gitea_protected_files` | `group_vars/forge/vars.yml` | |
| `gitea_secrets_depots` | `gitea_repo_secrets` | `group_vars/forge/vars.yml`, `roles/gitea_org/tasks/depot-plateforme.yml` | |
| `gitea_secrets_org` | `gitea_org_secrets` | `group_vars/forge/vars.yml` | word order |
| `tous_les_depots` | `all_repos` | `group_vars/forge/vars.yml` (`gitea_service_accounts[]`, `gitea_comptes_humains[]`) | entry key |
| `registre_en_service` | `registry_in_service` | `group_vars/forge/vars.yml`, `nettoyage-registre.yml`, `roles/nettoyage_registre/tasks/main.yml` | |
| `registre_mobiles` | `registry_movable` | `group_vars/forge/vars.yml`, `nettoyage-registre.yml` | movable tags |
| `nettoyage_registre_heure` | `registry_cleanup_hour` | `roles/nettoyage_registre/defaults/main.yml` | |
| `nettoyage_en_service` | `cleanup_in_service` | `tasks/nettoyage-registre.yml`, `verify-forge.yml` | task-file parameter |
| `nettoyage_mobiles` | `cleanup_movable` | `tasks/nettoyage-registre.yml` | |
| `nettoyage_paquets` | `cleanup_packages` | `tasks/nettoyage-registre.yml` | |
| `nettoyage_appliquer` | `cleanup_apply` | `tasks/nettoyage-registre.yml`, `nettoyage-registre.yml` | |
| `nettoyage_delai` | `cleanup_grace_minutes` | `tasks/nettoyage-registre.yml` | override: a grace period, not a timeout |
| `nettoyage_resultat` | `cleanup_result` | `tasks/nettoyage-registre.yml`, `verify-forge.yml` | output |
| `gvisor_cle_sha256` | `gvisor_key_sha256` | `roles/gvisor/defaults/main.yml` | |
| `lab_ca_cibles` | `lab_ca_targets` | `roles/lab_ca/defaults/main.yml`, `site.yml` | |
| `pki_base_san` | `db_pki_san` | `roles/pki_base/defaults/main.yml` | role prefix follows `db_pki`; same for `pki_base_cn`, `pki_base_usage`, `pki_base_uid` |
| `pki_base_duree` | `db_pki_duration` | `roles/pki_base/defaults/main.yml` | |
| `pki_base_renouveler` | `db_pki_renew` | `roles/pki_base/defaults/main.yml` | |
| `pki_base_dossier` | `db_pki_dir` | `roles/orchestrateur/tasks/tls-base.yml`, `roles/postgres_outils/tasks/main.yml` | role parameter |
| `pki_base_nom` | `db_pki_name` | `roles/orchestrateur/tasks/tls-base.yml` | value `serveur` → `server` |
| `moteur_api` | `engine_api` | `tasks/moteur-etape.yml`, `verify-moteur*.yml` | task-file parameters |
| `moteur_cycle` | `engine_cycle` | `tasks/moteur-etape.yml`, `verify-moteur*.yml` | |
| `moteur_slug` | `engine_slug` | `tasks/moteur-etape.yml` | |
| `moteur_etat` | `engine_state` | `tasks/moteur-etape.yml` | values are engine state ids |
| `moteur_message` | `engine_message` | `tasks/moteur-etape.yml` | |
| `moteur_casquette` | `engine_hat` | `tasks/moteur-jeton.yml` | values `demandeur`/`admin` → `requester`/`admin` |
| `moteur_jeton` | `engine_token` | `tasks/moteur-jeton.yml`, `verify-moteur*.yml` | output |
| `moteur_image` | `engine_image` | `verify-moteur.yml`, `verify-moteur-preview.yml` | |
| `id_personne` | `person_id` | `enregistrer-outils.yml`, `tasks/outil-socle-retirer.yml` | |
| `mdp_personne` | `person_password` | `enregistrer-outils.yml`, `verify-deployeur-socle.yml` | |
| `essai_dir` | `trial_dir` | `verify-template.yml`, `verify-ci.yml` | |
| `essai_src` | `trial_src` | `verify-template.yml` | |
| `outil` | `tool` | `enregistrer-outils.yml`, `tasks/outil-socle-cible.yml` | loop_var |
| `outil_slug` | `tool_slug` | `tasks/outil-socle-retirer.yml`, `verify-deployeur-socle.yml` | |
| `cible` | `target` | `verify-deployeur-acces.yml`, `tasks/deployeur-acces-cible.yml` | loop_var / parameter |
| `verif_cle` | `check_key` | `tasks/deployeur-acces-cible.yml`, `verify-deployeur-acces.yml` | parameter (other `verif_*`: rule) |
| `verif_known_hosts` | `check_known_hosts` | `tasks/deployeur-acces-cible.yml` | |
| `vault_cosign_outils_private_key` | `vault_cosign_tools_private_key` | `group_vars/forge/vars.yml` | vault variable name (value never read) |
| `vault_cosign_outils_password` | `vault_cosign_tools_password` | `group_vars/forge/vars.yml` | |
| `vault_deployeur_ssh_private_key` | `vault_deployer_ssh_private_key` | `group_vars/orchestrateur/vars.yml` | |
| `vault_deployeur_ssh_public_key` | `vault_deployer_ssh_public_key` | `roles/deployeur/tasks/main.yml` | |
| `vault_keycloak_outils_config_secret` | `vault_keycloak_tools_config_secret` | `roles/keycloak/tasks/realm-outils.yml` | |
| `vault_keycloak_verif_admin_secret` | `vault_keycloak_check_admin_secret` | `group_vars/orchestrateur/keycloak.yml` | |
| `vault_keycloak_verif_demandeur_secret` | `vault_keycloak_check_requester_secret` | `group_vars/orchestrateur/keycloak.yml` | |
| `vault_orch_moteur_password` | `vault_orch_engine_password` | `group_vars/orchestrateur/vars.yml`, `group_vars/agents/vars.yml` | follows PG role `orch_engine` |
| `vault_orch_proprietaire_password` | `vault_orch_owner_password` | `group_vars/orchestrateur/vars.yml` | follows PG role `orch_owner` |
| `vault_pki_base_ca_crt` | `vault_db_pki_ca_crt` | `roles/pki_base/tasks/main.yml` | also `vault_pki_base_ca_key` → `vault_db_pki_ca_key` |
| `vault-comptes.yml` | `vault-accounts.yml` | `init-vault.sh`, `infra/CLAUDE.md` | vault file names (local, untracked) |
| `vault-cosign-outils.yml` | `vault-cosign-tools.yml` | `init-vault.sh` | |
| `vault-deployeur.yml` | `vault-deployer.yml` | `init-vault.sh` | |
| `vault-ia.yml` | `vault-ai.yml` | `init-vault.sh`, `group_vars/agents/vars.yml` | IA = AI |
| `vault-keycloak-outils.yml` | `vault-keycloak-tools.yml` | `init-vault.sh` | |
| `vault-pki-base.yml` | `vault-db-pki.yml` | `init-vault.sh` | |
| `outils_personas_lus` | `tools_personas_read` | `enregistrer-outils.yml` | |
| `outils_socle_secrets_kc` | `core_tools_secrets_kc` | `enregistrer-outils.yml` | register |
| `outils_depots_secrets` | `tool_repo_secrets` | `enregistrer-outils.yml` | |
| `gitea_org_socle`, `gitea_org_socle_equipes`, `gitea_org_socle_equipe_creee`, `gitea_org_socle_equipe`, `gitea_org_socle_id` | `gitea_org_core`, `gitea_org_core_teams`, `gitea_org_core_team_created`, `gitea_org_core_team`, `gitea_org_core_team_id` | `roles/gitea_org/tasks/core-org.yml` | registers |
| `deployeur_reseaux_socle` | `deployer_core_networks` | `roles/deployeur/tasks/main.yml` | register; written `deployeur_core_networks` until the role is renamed in step 5 (ansible-lint requires the role prefix) |
| `label_socle`, `version_socle` | `core_label`, `core_version` | `verify-template.yml` | registers |
| `outil_lus`, `outil_mdp`, `outil_valeurs`, `outil_base`, `outil_roles` | `tool_secrets_read`, `tool_passwords`, `tool_values`, `tool_db`, `tool_roles` | `tasks/core-tool-target.yml` | |
| `outil_utilisateurs`, `outil_slug` | `tool_users`, `tool_slug` | `tasks/remove-core-tool.yml` | |
| `verif-socle` (badge, container, `/run/verif-socle*`), `0.0.0-verif-faux` | `check-core`, `0.0.0-check-fake` | `verify-core.yml`, `verify-deployer-core.yml` | `verif_*` → `check_*` by Words |

### Extra variables (`-e` on the command line)

| French | English | Where | Notes |
|---|---|---|---|
| `appel_ia` | `ai_call` | `verify-agents.yml`, `verify-moteur-claude.yml`, `verify-executeur-claude.yml` | paid call guard |
| `niveau` | `level` | `arret-urgence.yml` | |
| `confirmer` | `confirm` | `arret-urgence.yml` | value `oui` → `yes` |
| `mode` | `mode` | `mesure-ressources.yml` | values `debut`/`fin` → `start`/`end` |
| `appliquer` | `apply` | `nettoyage-registre.yml` | |
| `redemarrer_vm` | `restart_vm` | `verify-moteur.yml` | |
| `reconstruire` | `rebuild` | `verify-image-base.yml` | |
| `mesure_intervalle` | `measure_interval` | `mesure-ressources.yml` | |
| `mesure_duree_max` | `measure_max_duration` | `mesure-ressources.yml` | |

### Handlers

| French | English | Where | Notes |
|---|---|---|---|
| `Redémarrer Docker` | `Restart Docker` | `roles/docker/handlers/main.yml`, `roles/docker/tasks/main.yml` (`notify:`) | `notify:` text must match |
| `Redémarrer journald` | `Restart journald` | `roles/base/handlers/main.yml`, `roles/base/tasks/main.yml` | |
| `Recharger SSH` | `Reload SSH` | `roles/base/handlers/main.yml`, `roles/base/tasks/main.yml` | |

### Compose

| French | English | Where | Notes |
|---|---|---|---|
| `orchestrateur` | `orchestrator` | `compose/orchestrateur/compose.yml` (`name:`) | project; container names follow (`orchestrator-keycloak-1`, volume `orchestrator_db`) |
| `executeur` | `executor` | `compose/executeur/compose.yml` | project and service (`executor-executor-1`) |
| `deployeur` | `deployer` | `compose/deployeur/compose.yml` | project; containers `deployer-caddy-1`, `deployer-smokescreen-1` (constants in `deployeur.py`, `HTTPS_PROXY` in `outil-socle.compose.yml`) |
| `outils-db` | `tools-db` | `compose/outils-db/compose.yml` | project and `container_name` (`docker exec outils-db` in `deployeur.py`, `eupadev-sauvegarde.sh.j2`) |
| `migrer` | `migrate` | `compose/orchestrateur/compose.yml`, `compose/deployeur/outil-socle.compose.yml`, `deployeur.py` | one-shot service |
| `moteur` | `engine` | `compose/orchestrateur/compose.yml`, `roles/orchestrateur/tasks/*.yml`, `verify-moteur*.yml` (`docker compose … moteur`) | service and profile |
| `purger` | `purge` | `compose/deployeur/outil-socle.compose.yml`, `deployeur.py` | service |
| `outil` | `tool` | `compose/deployeur/outil.compose.yml`, `outil-socle.compose.yml` | service and network |
| `socle` | `core` | `compose/deployeur/outil-socle.compose.yml` (`profiles`, `x-socle`) | profile and anchor `x-core` |
| `proxy-ia` | `ai-proxy` | `compose/agents/compose.yml`, `roles/executeur/defaults/main.yml` (`agents-proxy-ia-1`) | container `agents-ai-proxy-1`; IA = AI |
| `sortie` | `egress` | `compose/agents/compose.yml` | network (`agents_sortie` → `agents_egress`) |
| `sortie-ia` | `ai-egress` | `compose/agents/compose.yml` | network (`agents_ai-egress`) |
| `interne` | `internal` | `compose/outils-db/compose.yml` | network |
| `NOM` | `NAME` | `compose/deployeur/outil.compose.yml`, `deployeur.py` (`variables()`) | interpolation variable |
| `RESEAU` | `NETWORK` | `compose/deployeur/outil.compose.yml`, `deployeur.py` | |
| `OUTIL` | `TOOL` | `compose/deployeur/outil.compose.yml`, `outil-socle.compose.yml`, `deployeur.py` | |
| `HOTE` | `HOST` | `compose/deployeur/outil-socle.compose.yml`, `deployeur.py` | |
| `manquant` | `missing` | every `compose.yml` (`${X:?manquant}`) | error text |
| `orchestrateur` | `orchestrator` | `compose/orchestrateur/compose.yml` (`POSTGRES_DB`, `POSTGRES_USER`, `pg_isready -d`), `eupadev-sauvegarde.sh.j2`, `group_vars/*/vars.yml` URLs | engine database and its superuser; same name in engine docs |
| `serveur.crt` | `server.crt` | `compose/orchestrateur/compose.yml`, `compose/outils-db/compose.yml` | TLS file names; also `serveur.key` → `server.key` |

### systemd units and timers

| French | English | Where | Notes |
|---|---|---|---|
| `eupadev-pare-feu-base.service` | `eupadev-db-firewall.service` | `roles/orchestrateur/tasks/tls-base.yml`, `verify-orchestrateur.yml` | override (see Paths) |
| `eupadev-outils-secrets.service` | `eupadev-tools-secrets.service` | `roles/postgres_outils/*`, `enregistrer-outils.yml` | |
| `eupadev-sauvegarde.service` | `eupadev-backup.service` | `roles/sauvegarde/*`, `verify-sauvegarde.yml` | and `.timer` |
| `eupadev-nettoyage-registre@.service` | `eupadev-registry-cleanup@.service` | `roles/nettoyage_registre/tasks/main.yml`, `verify-forge.yml` | instances `@registre` → `@registry`, `@essai` → `@trial`; and `eupadev-nettoyage-registre.timer` |
| `mesure-ressources.service` | `measure-resources.service` | `mesure-ressources.yml` | transient unit |

### Paths on the VMs, credstore and secret names

| French | English | Where | Notes |
|---|---|---|---|
| `/opt/eupadev/orchestrateur` | `/opt/eupadev/orchestrator` | `roles/orchestrateur/*`, `arret-urgence.yml`, `verify-*.yml` (45 uses) | |
| `/opt/eupadev/executeur` | `/opt/eupadev/executor` | `roles/executeur/*`, `arret-urgence.yml` | |
| `/opt/eupadev/deployeur` | `/opt/eupadev/deployer` | `roles/deployeur/tasks/main.yml` | |
| `/opt/eupadev/outils-db` | `/opt/eupadev/tools-db` | `roles/postgres_outils/tasks/main.yml`, `outil-socle.compose.yml` | |
| `/opt/eupadev/registre-essai.py` | `/opt/eupadev/trial-registry.py` | `verify-forge.yml` | |
| `ARRET-URGENCE` | `EMERGENCY-STOP` | `arret-urgence.yml`, `verify-moteur.yml` (`/opt/eupadev/*/ARRET-URGENCE`) | marker file |
| `/var/lib/docker/sauvegardes` | `/var/lib/docker/backups` | `group_vars/all/vars.yml`, `verify-sauvegarde.yml` | |
| `/usr/local/sbin/eupadev-sauvegarde` | `/usr/local/sbin/eupadev-backup` | `roles/sauvegarde/tasks/main.yml` | |
| `/usr/local/sbin/eupadev-nettoyage-registre` | `/usr/local/sbin/eupadev-registry-cleanup` | `roles/nettoyage_registre/tasks/main.yml` | |
| `/usr/local/sbin/eupadev-outils-secrets` | `/usr/local/sbin/eupadev-tools-secrets` | `roles/postgres_outils/tasks/main.yml` | |
| `/etc/eupadev-nettoyage-registre/` | `/etc/eupadev-registry-cleanup/` | `roles/nettoyage_registre/tasks/main.yml` | files `registre.json` → `registry.json`, `essai.json` → `trial.json`, `mot-de-passe` → `password` (also the `LoadCredential=` name read by the script) |
| `/etc/eupadev/deployeur.json` | `/etc/eupadev/deployer.json` | `roles/deployeur/tasks/main.yml`, `deployeur.py` (`CONFIGURATION`) | keys: see Python scripts |
| `/etc/eupadev/outils` | `/etc/eupadev/tools` | `enregistrer-outils.yml`, `deployeur.py` (`OUTILS`), `files/eupadev-purge` | Gate 1 entries `<slug>.json` |
| `/etc/eupadev/outil.compose.yml` | `/etc/eupadev/tool.compose.yml` | `roles/deployeur/tasks/main.yml`, `deployeur.py` | |
| `/etc/eupadev/outil-socle.compose.yml` | `/etc/eupadev/core-tool.compose.yml` | `deployeur.py` | |
| `/etc/eupadev/cosign-outils.pub` | `/etc/eupadev/cosign-tools.pub` | `roles/deployeur/tasks/main.yml`, `deployeur.py` (`CLE_OUTILS`) | |
| `/etc/eupadev/cosign-moteur.pub` | `/etc/eupadev/cosign-engine.pub` | `roles/orchestrateur/tasks/image.yml` | |
| `/etc/sudoers.d/eupadev-deployeur` | `/etc/sudoers.d/eupadev-deployer` | `roles/deployeur/tasks/main.yml` | the script is already `/usr/local/sbin/eupadev-deployer` |
| `/srv/eupadev/maquettes` | `/srv/eupadev/mockups` | `roles/deployeur/tasks/main.yml`, `compose/deployeur/compose.yml`, `deployeur.py` (`MAQUETTES`) | mounted as `/srv/maquettes` → `/srv/mockups` (Caddyfile `root`) |
| `/var/lib/eupadev/maquettes` | `/var/lib/eupadev/mockups` | `deployeur.py` (`INDEX_MAQUETTES`) | |
| `/run/eupadev/verrous` | `/run/eupadev/locks` | `deployeur.py` (`VERROUS`), `verify-deployeur.yml` | |
| `/run/eupadev/registre` | `/run/eupadev/registry` | `deployeur.py` (`REGISTRE`) | |
| `/run/eupadev/outils` | `/run/eupadev/tools` | `deployeur.py` (`SECRETS_OUTILS`), `eupadev-outils-secrets`, `outil-socle.compose.yml` | files `outil-<slug>-<x>` → `tool-<slug>-<x>` |
| `outil-<slug>-<x>` | `tool-<slug>-<x>` | `tasks/outil-socle-cible.yml`, `deployeur.py`, `outil-socle.compose.yml` | credstore and `/run` secret names (`x` = `oidc`, `db-owner`, `db-app`, `db-purge`) |
| `deployeur_jeton_registre` | `deployer_registry_token` | `roles/deployeur/tasks/jeton.yml`, `deployeur.py` (`JETON`) | credstore entry |
| `orch_forge_jeton` | `orch_forge_token` | `group_vars/orchestrateur/vars.yml`, `compose/orchestrateur/compose.yml`, `roles/orchestrateur/tasks/jeton-forge.yml` | credstore entry and Compose secret |
| `deployeur_cle` | `deployer_key` | `group_vars/orchestrateur/vars.yml`, `compose/orchestrateur/compose.yml` | secret name |
| `deployeur_known_hosts` | `deployer_known_hosts` | `group_vars/orchestrateur/vars.yml`, `compose/orchestrateur/compose.yml` | |
| `executeur_database_url` | `executor_database_url` | `group_vars/agents/vars.yml`, `compose/executeur/compose.yml` | |
| `executeur_jeton_forge` | `executor_forge_token` | `group_vars/agents/vars.yml`, `compose/executeur/compose.yml`, `roles/executeur/tasks/main.yml` | |
| `executeur_jeton_socle` | `executor_core_token` | `group_vars/agents/vars.yml`, `compose/executeur/compose.yml` | |
| `executeur_docker_config` | `executor_docker_config` | `group_vars/agents/vars.yml`, `compose/executeur/compose.yml` | |
| `/tmp/mesure-ressources` | `/tmp/measure-resources` | `mesure-ressources.yml` | |
| `/tmp/outils` | `/tmp/tools` | `verify-agents.yml` (pnpm tools dir) | |
| `eupadev-mesures` | `eupadev-measures` | `mesure-ressources.yml` (`~/eupadev-mesures/` on the controller) | |

### Gitea

| French | English | Where | Notes |
|---|---|---|---|
| `eupadev-socle` | `eupadev-core` | `group_vars/forge/vars.yml` (`{{ gitea_org }}-socle`), `infra/renovate/config.js`, `roles/executeur/defaults/main.yml` | npm owner of the core; the `<org>-core` convention is derived by the pipelines |
| `svc-orchestrateur` | `svc-orchestrator` | `group_vars/forge/vars.yml`, `roles/orchestrateur/tasks/jeton-forge.yml`, `arret-urgence.yml`, `docs/architecture.md` | robot user |
| `svc-deploiement` | `svc-deployment` | `group_vars/forge/vars.yml`, `roles/deployeur/tasks/jeton.yml`, `images/socle/.gitea/workflows/publier.yml` | robot user |
| `svc-socle` | `svc-core` | `group_vars/forge/vars.yml` | robot user |
| `orchestrateur` | `orchestrator` | `group_vars/forge/vars.yml` (team) | team |
| `deploiement` | `deployment` | `group_vars/forge/vars.yml` (team), `roles/deployeur/defaults/main.yml` (Linux account) | team and Linux account on the target VMs |
| `humains` | `humans` | `group_vars/forge/vars.yml` (team) | team |
| `template-outil-ia` | `tool-template` | `group_vars/forge/vars.yml`, `orchestrateur/src/exterieur/forge-gitea.ts` | repo (L8) |
| `image-base` | `base-image` | `group_vars/forge/vars.yml`, `verify-image-base.yml` | repo (L8) |
| `moteur` | `engine` | `group_vars/forge/vars.yml`, `empreinte-moteur.yml`, registry image `eupadev/moteur` | repo and registry image name (L8) |
| `socle` | `core` | `group_vars/forge/vars.yml` (`gitea_platform_repos`) | repo |
| `ci-registre` | `ci-registry` | `group_vars/forge/vars.yml` (`gitea_ci_tokens`) | token name |
| `ci-lecture-registre` | `ci-registry-read` | `group_vars/forge/vars.yml` | token name |
| `socle-publication` | `core-publication` | `group_vars/forge/vars.yml` (`badges`) | token name |
| `moteur` | `engine` | `roles/orchestrateur/tasks/jeton-forge.yml` (`/users/svc-orchestrateur/tokens/moteur`) | durable token name of svc-orchestrator |
| `executeur` | `executor` | `roles/executeur/tasks/main.yml` | svc-agent token name |
| `executeur-socle` | `executor-core` | `roles/executeur/tasks/main.yml` | svc-deployment token name |
| `deployeur-<vm>` | `deployer-<vm>` | `roles/deployeur/tasks/jeton.yml` | svc-deployment token per target |
| `SOCLE_PUBLISH_TOKEN` | `CORE_PUBLISH_TOKEN` | `images/socle/.gitea/workflows/publier.yml`, `infra/CLAUDE.md` | repo secret |
| `COSIGN_OUTILS_PRIVATE_KEY` | `COSIGN_TOOLS_PRIVATE_KEY` | `group_vars/forge/vars.yml`, `template-outil-ia/.gitea/workflows/controle.yml` | org secret; also `COSIGN_OUTILS_PASSWORD` → `COSIGN_TOOLS_PASSWORD` |
| `exception/sync-plateforme` | `exception/sync-platform` | `roles/gitea_org/tasks/depot-plateforme.yml:157` | branch name of the template sync |
| `deploiement-moteur` | `engine-deployment` | `roles/orchestrator/tasks/image.yml` | svc-deployment token of the orchestrator VM (pulls the engine image) |

### Keycloak

| French | English | Where | Notes |
|---|---|---|---|
| `outils` | `tools` | `roles/keycloak/tasks/realm-outils.yml`, `Caddyfile-auth.j2` (`/realms/outils/*`), `roles/deployeur/defaults/main.yml`, `socle/tests/keycloak/realm-test.json` | realm; the realm file is owned by the core |
| `outils-config` | `tools-config` | `roles/keycloak/tasks/realm-outils.yml` | config client of realm tools |
| `demandeur` | `requester` | `group_vars/orchestrateur/keycloak.yml`, engine `auth.ts` | client role of `eupadev-api` (L5) |
| `eupadev-demandeurs` | `eupadev-requesters` | `group_vars/orchestrateur/keycloak.yml` | group |
| `verif-demandeur` | `check-requester` | `group_vars/orchestrateur/keycloak.yml`, `tasks/moteur-jeton.yml`, `verify-moteur*.yml` | lab-only client; mail `verif-demandeur@<domain>` → `check-requester@<domain>` |
| `verif-admin` | `check-admin` | `group_vars/orchestrateur/keycloak.yml`, `tasks/moteur-jeton.yml` | lab-only client |
| `outil-essai` | `trial-tool` | `group_vars/orchestrateur/keycloak.yml` (`keycloak_outils_adresses`), `socle/tests/keycloak/realm-test.json` | client of realm tools (core-owned file) |
| `sujet_ilan` | `ilan_subject` | `roles/keycloak/tasks/main.yml` (fact `keycloak.fact`), `group_vars/orchestrateur/vars.yml` | local fact key |
| `<slug>-<role>-<n>` | `<slug>-<role>-<n>` | `group_vars/all/outils-socle.yml` | persona naming unchanged; credstore `persona-<name>` unchanged |

### Docker labels and image names

| French | English | Where | Notes |
|---|---|---|---|
| `eupadev.socle` | `eupadev.core` | `deployeur.py`, `roles/postgres_outils/tasks/main.yml`, `roles/deployeur/tasks/main.yml`, `verify-template.yml`, `verify-deployeur-socle.yml`, `test_deployeur.py`, `template-outil-ia/.gitea/image/Dockerfile` | set by the template's fixed Dockerfile |
| `eupadev.outil` | `eupadev.tool` | `compose/deployeur/outil.compose.yml`, `deployeur.py` | |
| `eupadev.tache` | `eupadev.task` | `verify-agents.yml`, `orchestrateur/src/exterieur/moteur-claude.ts` | engine-owned |
| `commun` | `common` | `images/base-node/Dockerfile:17` | Docker stage |
| `construction` | `build` | `images/keycloak/Dockerfile:6` | Docker stage |
| `eupadev/moteur` | `eupadev/engine` | `group_vars/orchestrateur/vars.yml` (`orchestrateur_image`) | registry image = repo name |

### Caddy

| French | English | Where | Notes |
|---|---|---|---|
| `maquette.{{ base_domain }}` | `mockup.{{ base_domain }}` | `roles/deployeur/templates/Caddyfile.j2`, `deployeur.py` (URL), `terraform/main.tf` | site name / subdomain |
| `@maquette` | `@mockup` | `roles/deployeur/templates/Caddyfile.j2` | matcher |
| `@cadre` | `@frame` | `roles/deployeur/templates/Caddyfile.j2` | matcher |
| `Maquette — données fictives, rien de ce que vous saisissez n'est enregistré` (frame page) | key `mockup.banner` (also `mockup.title`) | `roles/deployer/templates/Caddyfile.j2`, `roles/deployer/lang/{en,fr}.json`, `verify-mockup.yml` | end-user text (G2 as recommended): the dictionary of `eupadev_language` (`group_vars/all/vars.yml`, `fr` on the lab), which also sets `EUPADEV_LANGUAGE` |

### Python scripts

| French | English | Where | Notes |
|---|---|---|---|
| `servi` | `served` | `deployeur.py` (`ARITE`), `orchestrateur/src/exterieur/deployeur-ssh.ts`, `verify-deployeur*.yml` | deployer command (SSH forced-command protocol) |
| `deployer` | `deploy` | `deployeur.py`, `deployeur-ssh.ts`, `files/eupadev-purge` | command (`deployer` is French "déployer" here) |
| `arreter` | `stop` | `deployeur.py`, `deployeur-ssh.ts` | command |
| `retirer` | `remove` | `deployeur.py`, `deployeur-ssh.ts` | command |
| `purger` | `purge` | `deployeur.py`, `files/eupadev-purge` | command |
| `maquette` | `mockup` | `deployeur.py`, `deployeur-ssh.ts`, `group_vars/ci/vars.yml` | environment name (`preview`, `prod` stay) |
| `empreinte` | `digest` | `deployeur.py` (answers), `deployeur-ssh.ts` | answer key; mock-up index key `empreintes` → `digests` |
| `sante` | `health` | `deployeur.py`, `deployeur-ssh.ts` | answer key; value `echec` → `failed` (`ok` stays): the verdict the engine stores as is in `deployments.health`, so the same word (settled in step 4b) |
| `raison` | `reason` | `deployeur.py`, `deployeur-ssh.ts` | answer key |
| `fait` | `done` | `deployeur.py`, `deployeur-ssh.ts` | answer key |
| `refus` | `refusal` | `deployeur.py`, `deployeur-ssh.ts` | answer key (exit code 2) |
| `erreur` | `error` | `deployeur.py`, `nettoyage-registre.py`, `verif-keycloak.py` | answer key |
| `sortie` | `output` | `deployeur.py` (`purger`) | answer key |
| `registre` | `registry` | `/etc/eupadev/deployeur.json`, `deployeur.py` | config key |
| `reserves` | `reserved` | `/etc/eupadev/deployeur.json`, `deployeur.py` | config key |
| `domaine` | `domain` | `/etc/eupadev/deployeur.json`, `deployeur.py` | config key |
| `Refus` | `Refusal` | `deployeur.py`, `test_deployeur.py` | exception class imported by the test |
| `analyser` | `parse` | `deployeur.py`, `test_deployeur.py` | |
| `executer` | `execute` | `deployeur.py`, `test_deployeur.py` | |
| `servi_maquette` | `served_mockup` | `deployeur.py`, `test_deployeur.py` | |
| `deployer_maquette` | `deploy_mockup` | `deployeur.py`, `test_deployeur.py` | |
| `retirer_maquette` | `remove_mockup` | `deployeur.py`, `test_deployeur.py` | |
| `lancer` | `launch` | `deployeur.py`, `test_deployeur.py` (patched) | |
| `attendre` | `wait` | `deployeur.py`, `test_deployeur.py` (patched) | |
| `VERROUS` | `LOCKS` | `deployeur.py`, `test_deployeur.py` | module constants patched by the test: also `REGISTRE` → `REGISTRY`, `OUTILS` → `TOOLS`, `SECRETS_OUTILS` → `TOOL_SECRETS`, `SECRETS_SOCLE` → `CORE_SECRETS`, `MODELE_SOCLE` → `CORE_MODEL`, `MAQUETTES` → `MOCKUPS`, `INDEX_MAQUETTES` → `MOCKUP_INDEX`, `PLAFOND_FICHIERS` → `FILES_CAP`, `BASE` → `DB` (override) |
| `racine` | `root` | `nettoyage-registre.py`, `registre-essai.py`, `roles/nettoyage_registre/tasks/main.yml` | stdin parameter |
| `utilisateur` | `user` | `nettoyage-registre.py`, `registre-essai.py`, `verif-keycloak.py` | stdin parameter |
| `mot_de_passe` | `password` | `nettoyage-registre.py`, `registre-essai.py`, `verif-keycloak.py` | stdin parameter |
| `en_service` | `in_service` | `nettoyage-registre.py`, `tasks/nettoyage-registre.yml` | |
| `etiquettes_mobiles` | `movable_tags` | `nettoyage-registre.py`, `roles/nettoyage_registre/tasks/main.yml` | word order |
| `appliquer` | `apply` | `nettoyage-registre.py` | |
| `paquets` | `packages` | `nettoyage-registre.py`, `verify-forge.yml` | parameter and output |
| `delai_minutes` | `grace_minutes` | `nettoyage-registre.py`, `tasks/nettoyage-registre.yml` | override (see `nettoyage_delai`) |
| `prefixe_jetable` | `throwaway_prefix` | `nettoyage-registre.py`, `verify-forge.yml` | |
| `applique` | `applied` | `nettoyage-registre.py`, `verify-forge.yml` | output |
| `liberes_octets` | `freed_bytes` | `nettoyage-registre.py`, `verify-forge.yml` | output |
| `garde` | `kept` | `nettoyage-registre.py`, `verify-forge.yml` | output list |
| `efface` | `erased` | `nettoyage-registre.py`, `verify-forge.yml` | output list |
| `motif` | `reason` | `nettoyage-registre.py` | output key (texts English) |
| `paquet` | `package` | `registre-essai.py`, `verify-forge.yml` | parameter |
| `constructions` | `builds` | `registre-essai.py`, `verify-forge.yml` | parameter; trial tags `essai-<n>` → `trial-<n>` |
| `complet` | `full` | `verif-keycloak.py`, `verify-keycloak.yml` | mode (`page`, `console` stay; `outil` → `tool`) |
| `statut` | `status` | `verif-keycloak.py`, `verify-keycloak.yml` | output key |
| `connexion` | `sign_in` | `verif-keycloak.py`, `verify-keycloak.yml` | output key |
| `connecte` | `signed_in` | `verif-keycloak.py` | output key |
| `echange_code` | `code_exchange` | `verif-keycloak.py` | output key |
| `rejeu_a` | `replay_a` | `verif-keycloak.py`, `verify-keycloak.yml` | also `apres_rejeu_b` → `after_replay_b`, `apres_rejeu_sso` → `after_replay_sso`, `apres_logout` → `after_logout` |
| `sans_pkce` | `without_pkce` | `verif-keycloak.py`, `verify-keycloak.yml` | output key |
| `redirections` | `redirects` | `verif-keycloak.py`, `verify-keycloak.yml` | also `autre_chemin` → `other_path`, `autre_hote` → `other_host`, `autre_redirection` → `other_redirect`, `redirection` → `redirect` |
| `vers_idp` | `to_idp` | `verif-keycloak.py` | also `vers_callback` → `to_callback`, `vers` → `to`, `retour` → `return`, `page_idp` → `idp_page` |
| `bon_mot_de_passe` | `good_password` | `verif-keycloak.py` | |
| `roles_api` | `api_roles` | `verif-keycloak.py`, `verify-keycloak.yml` | word order; also `roles_realm` → `realm_roles`, `autres_clients` → `other_clients`, `a_sub` → `has_sub`, `duree` → `duration` |
| `jeton_de_rafraichissement` | `has_refresh_token` | `verif-keycloak.py`, `verify-keycloak.yml` | boolean; also `typ_rafraichissement` → `refresh_typ`, `scope_reponse` → `response_scope`, `brut` → `raw`, `echecs` → `failures`, `resultat` → `result` |
| `ecoute` | `listen` | `files/sonde-reseau.js`, `verify-agents.yml` | probe mode; args `hote` → `host`, `cible` → `target`; reply `ici` → `here` |
| `est_socle`, `preparer_socle`, `creer_reseau(socle=)` | `is_core`, `prepare_core`, `core=` | `deployeur.py` | |
| `MODELE_SOCLE`, `SECRETS_SOCLE` | `CORE_MODEL`, `CORE_SECRETS` | `deployeur.py`, `test_deployeur.py` | module constants |
| `Socle`, `SocleProd` (test classes) | `Core`, `CoreProd` | `test_deployeur.py` | |
| `CLE_OUTILS`, `PLAFOND_OCTETS`, `LONGUEUR_MAX`, `DUREE` | `TOOLS_KEY`, `BYTES_CAP`, `MAX_LENGTH`, `DURATION` | `deployer.py` | module constants (step 5) |
| `JETON` | `TOKEN_FILE` | `deployer.py` | override: holds the credstore path (and a `TOKEN = …` line is flagged by secret scanners) |
| `FausseVM`, `FausseProd` | `FakeVM`, `FakeProd` | `test_deployer.py` | test classes |
| `appelant=`, `commande=`, `resultat=` | `caller=`, `command=`, `result=` | `deployer.py` (syslog line), `verify-deployer-access.yml`, `verify-deployer-core.yml` (journal searched) | log fields: both ends together |
| `occupé par le cycle <n>` | `owned by cycle <n>` | `deployer.py`, `test_deployer.py`, `verify-deployer.yml`, `verify-mockup.yml` | refusal and answer text (the engine only prefixes it: `refused by the target: …`) |
| `signature refusée (clé des outils)` | `signature refused (tools key)` | `deployer.py`, `verify-deployer.yml` | refusal text |
| `garder` | `keep` | `registry-cleanup.py`, `tasks/registry-cleanup.yml` | stdin parameter |
| `empreinte`, `etiquette` | `digest`, `tag` | `registry-cleanup.py`, `trial-registry.py`, `verify-forge.yml` | output keys |
| `Echec` | `Failure` | `registry-cleanup.py` | exception class |
| `titre`, `erreur` | `title`, `error` | `check-keycloak.py`, `verify-keycloak.yml` | output keys |
| `code reçu`, `enrôlement OTP exigé` | `code received`, `OTP enrolment required` | `check-keycloak.py`, `verify-keycloak.yml`, `verify-engine-chat.yml` | printed values compared by the playbooks |

### Shell scripts in `files/` and templates

| French | English | Where | Notes |
|---|---|---|---|
| `collecte` | `collect` | `files/mesure-ressources.sh`, `mesure-ressources.yml` | subcommand and function |
| `resume` | `summary` | `files/mesure-ressources.sh`, `mesure-ressources.yml` | subcommand (French "résumé") |
| `msom` | `msum` | `files/mesure-ressources.sh` | awk variables: `csom` → `csum`, `rtaille` → `rsize`, `dtaille` → `dsize`, `rfin` → `rend`, `dfin` → `dend` |
| `.partiel` | `.partial` | `roles/sauvegarde/templates/eupadev-sauvegarde.sh.j2`, `verify-sauvegarde.yml` | temporary dump suffix; vars `dossier` → `dir`, `fichier` → `file`, `bases` → `dbs` |
| `creer_coffre` | `create_vault` | `init-vault.sh` | function |
| `CLE_ANTHROPIC` | `ANTHROPIC_KEY_FILE` | `init-vault.sh`, `infra/CLAUDE.md`, `group_vars/agents/vars.yml` (comment) | override: holds a file path |
| `donnees.txt`, `<hôte>-<date>-resume.txt` | `data.txt`, `<host>-<date>-summary.txt` | `files/measure-resources.sh`, `measure-resources.yml` | measurement files (step 5) |
| `/sonde/` | `/probe/` | `verify-agents.yml` (mount of `files/network-probe.js`) | probe outputs `reached`, `unreachable (…)`, `here` |
| `.partiel` | `.partial` | `roles/backup/templates/eupadev-backup.sh.j2` | (also the row above); output line `backup written: … bytes` |

### Environment variables set by templates and Compose

| French | English | Where | Notes |
|---|---|---|---|
| `ORCHESTRATEUR_IMAGE` | `ORCHESTRATOR_IMAGE` | `orchestrateur-variables.j2`, `executeur-variables.j2`, `compose/orchestrateur/compose.yml`, `compose/executeur/compose.yml` | |
| `KEYCLOAK_RESEAU` | `KEYCLOAK_NETWORK` | `orchestrateur-variables.j2`, `compose/orchestrateur/compose.yml` | |
| `ORCH_AUTH_ADRESSE` | `ORCH_AUTH_ADDRESS` | `orchestrateur-variables.j2`, `compose/orchestrateur/compose.yml` | |
| `ORCH_DB_ADRESSE` | `ORCH_DB_ADDRESS` | `orchestrateur-variables.j2`, `compose/orchestrateur/compose.yml` | |
| `FORGE_HOTE` | `FORGE_HOST` | `orchestrateur-variables.j2`, `executeur-variables.j2`, compose files | |
| `COMPOSE_PROFILES` value `moteur` | `engine` | `orchestrateur-variables.j2` | profile name |
| `EUPADEV_EXTERIEUR` | `EUPADEV_EXTERNAL` | `group_vars/orchestrateur/vars.yml`, `roles/executeur/defaults/main.yml`, compose files, `orchestrateur/src/config.ts` | values: `deployeur=ssh` → `deployer=ssh`, `moteur=claude` → `engine=claude`, `moteur=pousse` → `engine=pushing`, `factice-auto` → `fake-auto` (engine-owned values, as the engine row says) |
| `EUPADEV_ROLE` values | `pilote` → `pilot`, `executeur` → `executor`, `tout-en-un` → `all-in-one` | `group_vars/orchestrateur/vars.yml`, `roles/executeur/defaults/main.yml`, compose files | name stays |
| `ADRESSE_ESCALADE_ADMIN` | `ADMIN_ESCALATION_ADDRESS` | `group_vars/orchestrateur/vars.yml`, compose files, `config.ts` | word order |
| `MAIL_EXPEDITEUR` | `MAIL_FROM` | `group_vars/orchestrateur/vars.yml`, `compose/orchestrateur/compose.yml` | override: one name per concept, the core and the example already use `MAIL_FROM` |
| `DOMAINE_OUTILS` | `TOOL_DOMAIN` | `group_vars/orchestrateur/vars.yml`, compose files | |
| `URL_TABLEAU_DE_BORD` | `DASHBOARD_URL` | `group_vars/orchestrateur/vars.yml`, compose files | |
| `CONCURRENCE_AGENTS` | `AGENT_CONCURRENCY` | `group_vars/orchestrateur/vars.yml`, compose files | as Words |
| `DEPLOYEUR_HOTES` | `DEPLOYER_HOSTS` | `group_vars/orchestrateur/vars.yml`, `compose/orchestrateur/compose.yml` | value keys `maquette=` → `mockup=` |
| `DEPLOYEUR_CLE_FILE` | `DEPLOYER_KEY_FILE` | `compose/orchestrateur/compose.yml` | |
| `DEPLOYEUR_KNOWN_HOSTS_FILE` | `DEPLOYER_KNOWN_HOSTS_FILE` | `compose/orchestrateur/compose.yml` | |
| `FORGE_JETON_FILE` | `FORGE_TOKEN_FILE` | `compose/orchestrateur/compose.yml` | |
| `ADRESSE_API` | `API_ADDRESS` | `compose/orchestrateur/compose.yml` | |
| `OIDC_EMETTEUR` | `OIDC_ISSUER` | `orchestrateur-variables.j2`, `compose/orchestrateur/compose.yml` | |
| `QUATRE_YEUX_DEROGATION_SUJET` | `FOUR_EYES_EXEMPTION_SUBJECT` | `orchestrateur-variables.j2`, `compose/orchestrateur/compose.yml` | |
| `AGENT_FORGE_JETON_FILE` | `AGENT_FORGE_TOKEN_FILE` | `compose/executeur/compose.yml` | |
| `AGENT_JETON_FILE` | `AGENT_TOKEN_FILE` | `compose/executeur/compose.yml` | |
| `AGENT_PROXY_IA` | `AGENT_AI_PROXY` | `roles/executeur/defaults/main.yml`, `compose/executeur/compose.yml` | value `agents-proxy-ia-1:8080` → `agents-ai-proxy-1:8080` |
| `AGENT_PROXY_SORTIE` | `AGENT_EGRESS_PROXY` | `roles/executeur/defaults/main.yml`, `compose/executeur/compose.yml` | |
| `AGENT_PROXYS` | `AGENT_PROXIES` | `roles/executeur/defaults/main.yml`, `compose/executeur/compose.yml` | |
| `AGENT_SOCLE_REGISTRE` | `AGENT_CORE_REGISTRY` | `roles/executeur/defaults/main.yml`, `compose/executeur/compose.yml` | |
| `AGENT_SOCLE_JETON_FILE` | `AGENT_CORE_TOKEN_FILE` | `compose/executeur/compose.yml` | |
| `AGENT_SOCLE_HOTE` | `AGENT_CORE_HOST` | `roles/executeur/defaults/main.yml`, `compose/executeur/compose.yml` | |
| `AGENT_SOCLE_CA` | `AGENT_CORE_CA` | `roles/executeur/defaults/main.yml`, `compose/executeur/compose.yml` | |
| — (new in step 4b) | `EUPADEV_LANGUAGE` | `compose/orchestrateur/compose.yml`, `group_vars/orchestrateur/vars.yml` | engine-owned; `fr` on the lab (L10, ADR-025), `en` by default |

### Image publish workflows (`images/*/.gitea/workflows/publier.yml`)

| French | English | Where | Notes |
|---|---|---|---|
| `publier` | `publish` | all five `publier.yml` (job id) | job id read as a check name by `verify-image-*.yml`, `tasks/attendre-pipeline.yml` |
| `Image du moteur` | `Engine image` | `images/moteur/.gitea/workflows/publier.yml:7` | workflow `name:`; also `Image Keycloak` → `Keycloak image`, `Socle` → `Core`, `Image des agents` → `Agent image` |
| `JOUR` | `DAY` | `images/base-node/.gitea/workflows/publier.yml:27` | env var; tag `build-24-AAAAMMJJ` → `YYYYMMDD` in docs |
| `Empreinte du moteur : <ref>` | `Engine digest: <ref>` | `images/moteur/.gitea/workflows/publier.yml:89`, `empreinte-moteur.yml` (parsed) | log line parsed by Ansible: both ends together |
| `Empreinte de Keycloak : <ref>` | `Keycloak digest: <ref>` | `images/keycloak/.gitea/workflows/publier.yml:84`, `empreinte-moteur.yml -e repo=keycloak` | parsed |
| `Empreinte de l'image agent : <ref>` | `Agent image digest: <ref>` | `images/agent/.gitea/workflows/publier.yml:134`, `verify-image-agent.yml:80`, `group_vars/agents/vars.yml` (comment) | parsed |
| `Empreinte <variant> : <ref>` | `Digest <variant>: <ref>` | `images/base-node/.gitea/workflows/publier.yml:84`, `verify-image-base.yml` | parsed |
| `OK : …` | `OK: …` | every `publier.yml` | `verify-image-*.yml` search the OK lines (`log_job.content is search(item…)`): change both ends |

### Rules (no row per instance)

- **Registers and locals**: 397 French `register:` names (`verif_*` → `check_*`, `*_lu` → `*_read`, `*_cree` → `*_created`…), ~200 play-level `vars:`/`set_fact` names used in one file, 9 `loop_var` names: renamed by Words, keep the role prefix translated (`gitea_org_depot` → `gitea_org_repo`, `gitea_org_equipe` → `gitea_org_team`). A register that shadows a later variable (`clients` in `verify-keycloak.yml`) must stay distinct after translation.
- **Task, play and step names**: ~1,215 French `- name:` lines in `infra/ansible` (of 1,681): English sentences; handler names are rows above (they are referenced by `notify:`).
- **Throwaway names in verify playbooks** (tool slugs, repos, containers, temp dirs: `verif-maquette`, `verif-socle`, `verif-agents-a`, `essai-…`, `/run/eupadev/verif-*`, `/tmp/verif-*`): `verif-` → `check-`, `essai-` → `trial-`; ~60 distinct prefixes.
- **Names owned by other areas used here**: engine tables, columns, states, routes (`/demandes`, `/sante`) and CLI read by `verify-moteur*.yml`, `verify-orchestrateur.yml`, `verify-executeur-claude.yml`; engine scripts `essai-*.ts` run by them; core package, bins (`bin/migrer.js`, `bin/purger.js`), SQL roles `socle_app`/`socle_purge`, realm file `realm-test.json`; template files (`controle.yml`, `garde-fous.sh`, job ids, `PREVIEW_PERSONAS` keys). They follow the owning area's rows in the same change set.
- **Human-facing texts** written by infra: the Caddy mock-up banner page (`Caddyfile.j2`, French `<html lang="fr">`), Gitea repo/team/account descriptions in `group_vars/forge/vars.yml`, Keycloak role descriptions: English, with the i18n question below for the banner.
- **Comments** (~90 % French) and the `README.md`/`CLAUDE.md` of `infra/` and `images/*`: docs area.

## CI, scripts, docs and ADRs

### Paths: CI, scripts, docs and ADRs

| French | English | Where | Notes |
|---|---|---|---|
| `.github/workflows/adr-propositions.yml` | `.github/workflows/adr-proposals.yml` | `.github/workflows/` | keeps `adr` in the name: `adr.yml` filters `.github/workflows/adr*.yml` |
| `.github/workflows/exemples-demandes.yml` | `.github/workflows/examples-requests.yml` | `.github/workflows/` | its own path filter names the file |
| `.github/workflows/images-empreinte.yml` | `.github/workflows/image-digests.yml` | `.github/workflows/` | |
| `.github/workflows/moteur.yml` | `.github/workflows/engine.yml` | `.github/workflows/` | its own path filter names the file |
| `.github/workflows/socle.yml` | `.github/workflows/core.yml` | `.github/workflows/` | L1; its own path filter names the file |
| `.github/workflows/template-regles.yml` | `.github/workflows/template-rules.yml` | `.github/workflows/` | its own path filter names the file |
| `.github/scripts/verifier-adr.py` | `.github/scripts/verify-adr.py` | `adr.yml`, `adr-propositions.yml` | keeps `adr` (filter `.github/scripts/*adr*`) |
| `.github/scripts/test_verifier_adr.py` | `.github/scripts/test_verify_adr.py` | `adr.yml` | loads the script by file name (`:9`) |
| `.github/scripts/verifier-empreintes.py` | `.github/scripts/verify-digests.py` | `images-empreinte.yml` | |
| `.github/scripts/test_verifier_empreintes.py` | `.github/scripts/test_verify_digests.py` | `images-empreinte.yml` | loads the script by file name (`:9`) |
| `docs/adr/gabarit.md` | `docs/adr/template.md` | `verifier-adr.py:20`, ADR-000 `:21`, ADR-011 `:34` | |
| `docs/prerequis-client.md` | `docs/client-prerequisites.md` | `docs/deployment.md:7,48,148`, ADR-001 `:27` | already English inside |
| `docs/scenarios-orchestrateur.md` | `docs/orchestrator-scenarios.md` | 5 `orchestrateur/features/*.feature` headers | |
| `docs/fr/gouvernance.md` | `docs/fr/governance.md` | `docs/fr/architecture.md:136` | French copies mirror the English file name (template convention) |
| `docs/fr/installation.md` | `docs/fr/deployment.md` | `docs/fr/architecture.md:137` | idem |
| `docs/fr/prerequis-client.md` | `docs/fr/client-prerequisites.md` | `docs/fr/installation.md:9,51,154` | idem |
| `docs/reflexions/` | `docs/reflexions/` (unchanged, private) | 121 references in 74 tracked files | L7: stays French in the private repository; every link to it is removed before publication |

### ADR file names (one-time exception L6, ADR-026)

| French | English | Where | Notes |
|---|---|---|---|
| `000-format-et-cycle-de-vie-des-adr.md` | `000-adr-format-and-lifecycle.md` | ROADMAP registry, `adr.yml:1-2` | glob comments `000-*.md` keep working |
| `001-appliance-sur-vm-fournies-par-la-dsi.md` | `001-appliance-on-vms-provided-by-the-it-department.md` | ROADMAP registry | "DSI" → IT department |
| `002-une-seule-pile-et-deux-profils-d-exploitation.md` | `002-one-stack-and-two-operating-profiles.md` | ROADMAP registry | |
| `003-cles-et-modelisation-de-la-base-des-outils.md` | `003-keys-and-modelling-of-the-tools-database.md` | ROADMAP registry | British spelling |
| `004-migrations-immuables-sans-down-controlees-par-squawk.md` | `004-immutable-migrations-without-down-checked-by-squawk.md` | ROADMAP registry | |
| `005-images-et-actions-ci-designees-par-empreinte.md` | `005-images-and-ci-actions-pinned-by-digest.md` | ROADMAP registry | |
| `006-moteur-d-agent-interchangeable.md` | `006-interchangeable-agent-engine.md` | ROADMAP registry | |
| `007-licences-aucun-composant-embarque-agpl-sspl-bsl.md` | `007-licences-no-embedded-agpl-sspl-bsl-component.md` | ROADMAP registry | British "licences" kept |
| `008-garder-gitea-passer-a-incus-et-opentofu.md` | `008-keep-gitea-move-to-incus-and-opentofu.md` | ROADMAP registry | |
| `009-maquette-de-cadrage-servie-en-fichiers-statiques.md` | `009-scoping-mockup-served-as-static-files.md` | ROADMAP registry | |
| `010-labo-sur-incus-et-opentofu-avant-la-publication.md` | `010-lab-on-incus-and-opentofu-before-publication.md` | ROADMAP registry | |
| `011-format-et-cycle-de-vie-des-adr-v2.md` | `011-adr-format-and-lifecycle-v2.md` | `verifier-adr.py:2,205`, `adr.yml:1-2`, `adr-propositions.yml:2`, `CLAUDE.md` | path printed in the proposals issue body |
| `012-forge-rester-sur-gitea-porte-ouverte-vers-forgejo.md` | `012-forge-stay-on-gitea-door-open-to-forgejo.md` | ROADMAP registry | |
| `013-moteur-d-agent-interchangeable-claude-code-binaire-signe.md` | `013-interchangeable-agent-engine-claude-code-signed-binary.md` | ROADMAP registry | |
| `014-deployeur-des-outils.md` | `014-tool-deployer.md` | ROADMAP registry | |
| `015-domaine-des-previews-ordre-de-preference.md` | `015-preview-domain-order-of-preference.md` | ROADMAP registry | |
| `016-registre-npm-en-lecture-seule-pour-les-agents.md` | `016-read-only-npm-registry-for-agents.md` | ROADMAP registry | |
| `017-identite-des-personnes.md` | `017-identity-of-people.md` | ROADMAP registry | |
| `018-les-instructions-viennent-de-l-image-signee.md` | `018-instructions-come-from-the-signed-image.md` | ROADMAP registry | |
| `019-socle-commun-des-outils-generes-et-dependances-autorisees.md` | `019-common-core-of-generated-tools-and-allowed-dependencies.md` | ROADMAP registry | L1 |
| `020-relecteurs-en-lecture-seule-par-le-harnais.md` | `020-read-only-reviewers-enforced-by-the-harness.md` | ROADMAP registry | |
| `021-un-seul-agent-builder-ecrit-le-code.md` | `021-a-single-builder-agent-writes-the-code.md` | ROADMAP registry | |
| `023-socle-distributed-through-the-forge-npm-registry.md` | `023-core-distributed-through-the-forge-npm-registry.md` | ROADMAP registry | L1 reaches English names too |

### ADR format (ADR-011, `verifier-adr.py`, `docs/adr/gabarit.md`)

| French | English | Where | Notes |
|---|---|---|---|
| `proposé` | `proposed` | `verifier-adr.py:32,78,99,104,106,119,126,133,168`, every ADR | status |
| `accepté` | `accepted` | idem | status |
| `rejeté` | `rejected` | idem | status |
| `retiré` | `withdrawn` | idem | status |
| `remplacé par ADR-NNN` | `superseded by ADR-NNN` | idem | status; the field `supersedes` is already English |
| `controle` | `check` | frontmatter of 23 ADRs, `gabarit.md:17`, `verifier-adr.py:74,120,145` | frontmatter key |
| `en-place` | `in-place` | `verifier-adr.py:35` | `check` value |
| `partiel` | `partial` | idem | `check` value |
| `prévu` | `planned` | idem | `check` value |
| `aucun` | `none` | idem | `check` value |
| `## Contexte` | `## Context` | `gabarit.md:19` | heading |
| `## Décision` | `## Decision` | `gabarit.md:25`, `test_verifier_adr.py:10` | heading |
| `## Alternatives écartées` | `## Rejected alternatives` | `gabarit.md:28` | heading |
| `## Conséquences` | `## Consequences` | `gabarit.md:31` | heading |
| `## Vérification` | `## Verification` | `gabarit.md:34` | heading |
| `## Rejet` | `## Rejection` | `gabarit.md:42` | heading, optional |
| `<!-- registre-adr:debut -->` | `<!-- adr-registry:start -->` | `ROADMAP.md:469`, `verifier-adr.py:38` | generated block marker |
| `<!-- registre-adr:fin -->` | `<!-- adr-registry:end -->` | `ROADMAP.md:497`, `verifier-adr.py:38` | generated block marker |
| `\| ADR \| Titre \| Statut \| Date \| Contrôle \|` | `\| ADR \| Title \| Status \| Date \| Check \|` | `verifier-adr.py:141`, `test_verifier_adr.py:56` | registry header |
| `--ecrire` | `--write` | `verifier-adr.py`, ADR-011, ROADMAP | CLI option |
| `--propositions` | `--proposals` | `verifier-adr.py`, `adr-propositions.yml:28` | CLI option |
| `--aujourdhui` | `--today` | `verifier-adr.py`, `test_verifier_adr.py` | CLI option (tests) |
| `AVANT` | `BEFORE` | `adr.yml:39`, `verifier-adr.py:186`, `test_verifier_adr.py:29` | env var |
| `DOSSIER` | `DIR` | `verifier-adr.py:30-38` | module constants |
| `NOM` | `NAME` | `verifier-adr.py:30-38` | module constants |
| `STATUT` | `STATUS` | `verifier-adr.py:30-38` | module constants |
| `FIGES` | `FROZEN` | `verifier-adr.py:30-38` | module constants |
| `CONTROLE` | `CHECK` | `verifier-adr.py:30-38` | module constants |
| `DELAI_PROPOSE` | `PROPOSED_DELAY` | `verifier-adr.py:30-38` | module constants |
| `DEBUT` | `START` | `verifier-adr.py:30-38` | module constants |
| `FIN` | `END` | `verifier-adr.py:30-38` | module constants |

### CI workflows (`.github/workflows/`)

| French | English | Where | Notes |
|---|---|---|---|
| `ADR immuables et registre à jour` | `ADR immutability and registry` | `adr.yml:8` | workflow `name:` |
| `ADR proposés depuis plus de 30 jours` | `ADRs proposed for more than 30 days` | `adr-propositions.yml:6,34` | workflow `name:` AND the issue title the job deduplicates on: close the open French-titled issue in the same change |
| `Images et actions désignées par empreinte` | `Images and actions pinned by digest` | `images-empreinte.yml:6` | workflow `name:` |
| `Exemple demandes — tests et kit` | `Example requests — tests and kit` | `exemples-demandes.yml:7` | workflow `name:` |
| `Moteur — types, tests, mutations` | `Engine — types, tests, mutations` | `moteur.yml:7` | workflow `name:` |
| `Socle — types, tests, migration` | `Core — types, tests, migration` | `socle.yml:13` | workflow `name:` |
| `Template — règles Opengrep et Dockerfile fixe` | `Template — Opengrep rules and fixed Dockerfile` | `template-regles.yml:10` | workflow `name:` |
| `propositions` | `proposals` | `adr-propositions.yml:18` | job id = GitHub check name |
| `empreintes` | `digests` | `images-empreinte.yml:16` | job id = GitHub check name |
| `jeton` | `token` | `renovate.yml:28,37` | step id |
| `TITRE` | `TITLE` | `adr-propositions.yml:34,39,43` | env var |
| `KIT_GARDER` | `KIT_KEEP` | `exemples-demandes.yml:90`, `exemples/demandes/tests/stack.js:45`, `socle/tests/kit.test.js` | env var (core area) |
| `retard.md` | `late.md` | `adr-propositions.yml:28,43` | temp file |
| `pnpm figé` | `pinned pnpm` | 8 workflows | recurring step name |
| `cosign figé` | `pinned cosign` | 8 workflows | recurring step name |
| `Opengrep figé` | `pinned Opengrep` | 8 workflows | recurring step name |
| `mutations tuées` | `mutations killed` | `moteur.yml:152`, `orchestrateur/tests/mutations/lancer.ts:133` | grepped log text: change both ends together |
| `--tuees` | `--killed` | `moteur.yml:76,153`, `orchestrateur/tests/mutations/cliquet.ts:13` | CLI option |
| `etat` | `state` | `moteur.yml`, `socle.yml` | shell variables |
| `tuees` | `killed` | `moteur.yml`, `socle.yml` | shell variables |
| `PONT` | `BRIDGE` | `moteur.yml`, `socle.yml` | shell variables |

### Renovate (`renovate.json`)

| French | English | Where | Notes |
|---|---|---|---|
| `dépendances` | `dependencies` | `renovate.json:11,23,108,129` | label; same as the Gitea config (`infra/renovate/config.js:34`); rename the GitHub label in the repository settings |
| `sécurité` | `security` | `renovate.json:24` | label; rename on GitHub |
| `postgres-majeure` | `postgres-major` | `renovate.json:109` | label; rename on GitHub |
| `images Docker` | `Docker images` | `renovate.json:45` | groupName: drives Renovate branch and PR names (open Renovate PRs are closed and reopened) |
| `actions de CI` | `CI actions` | `renovate.json:59` | groupName |
| `pnpm et corepack` | `pnpm and corepack` | `renovate.json:94` | groupName |
| `Gitea et runner` | `Gitea and runner` | `renovate.json:122` | groupName |
| `socle` (groupName and label) | `core` | `infra/renovate/config.js` | |

### Rules (no row per instance)
- CI step names (about 45 French of 52) and every comment: translated in place, prose.
- `renovate.json` descriptions (17, all French): prose; the one citing `docs/reflexions/` loses the link (L7).
- Root translations keep the GitHub convention `X.fr.md` (`README.fr.md`, `CONTRIBUTING.fr.md`, template `AGENTS.fr.md`); every other French copy lives under a `docs/fr/` that mirrors the English path and file name.
- Spelling: British English, as the existing English documents (`organisation`, `licence`, `catalogue`, `modelling`); third-party names keep theirs.

### Names cited only in documents (step 6)

Retired or planned names, headings and markers that the root documents and `docs/` cite; added when they were
translated (step 6), so that later steps cite them the same way.

| French | English | Where | Notes |
|---|---|---|---|
| `[test orchestrateur]` | `[orchestrator test]` | `ROADMAP.md` §8.12, `docs/orchestrator-scenarios.md`, `orchestrateur/features/erreurs-connues-v1.feature:2` | check marker |
| `[test réel]` | `[real test]` | `ROADMAP.md` §8.12 | check marker |
| `Installation chez le client` | `Installation at the client` | `ROADMAP.md` §8.15, `docs/deployment.md`, `docs/client-prerequisites.md` | ROADMAP heading cited by the docs |
| `Exploitation : socle système et maintenance` | `Operations: system base and maintenance` | `infra/README.md`, `docs/deployment.md` | infra README heading cited by the docs (step 5 uses this heading) |
| `supprimerBranches` | `deleteBranches` | `ROADMAP.md` §8.16 M5 | Forge contract method, removed (E2) |
| `archiverDepot` | `archiveRepo` | `ROADMAP.md` §8.16 M5 | Forge contract method, removed (E2) |
| `tache_terminee` | `task_finished` | `ROADMAP.md` §8.13, §8.14 | W2 message, removed (S4) |
| `a_confirmer` | `to_confirm` | `ROADMAP.md` §8.14 A | field, removed (S8) |
| `outil_nom` | `tool_name` | `ROADMAP.md` §8.12 E1 | v1 state column |
| `domaine_previews` | `preview_domain` | `ROADMAP.md` §8.16 M3 | planned infra variable (ADR-015) |
| `registre-capacites.md.example` | `capability-registry.md.example` | `ROADMAP.md` §2 | v1 template file |
| `evenement-<id>-<abonné>` | `event-<id>-<subscriber>` | `ROADMAP.md` §8.11 no. 5 | planned workflow id |
| `<outil>-<itération>-<rôle>` | `<tool>-<iteration>-<role>` | `ROADMAP.md` §8.12 E4 | task id pattern |

## Open questions (settled)

Points that were genuinely ambiguous when the glossary was built, with the recommendation the rows above use; each
was settled as recommended.

| # | Question | Rows above use | Alternative |
|---|---|---|---|
| G1 | The example tool (`examples/requests/web/`) and the core's example screen: English-only fixtures, or en/fr dictionaries to show the L10 pattern the agents copy? | the core's 9 screen strings go to `core/web/lang/{en,fr}.json`; both example screens stay English-only | dictionaries in the example tool too, since agents copy it |
| G2 | The mock-up banner page served by Caddy (`roles/deployeur/templates/Caddyfile.j2`) is French end-user text, and Caddy has no i18n | a role variable for the deployment language selects one of two texts (French on the lab) | English only |
| G3 | `Chloé` in the core test realm (one accented fixture name) | renamed `Chloe` (no allow-list entry) | keep it as a deliberate non-ASCII fixture in the allow-list |
| G4 | `orchestrateur/src/moteur/` holds the AGENT engine's rules (instructions, forbidden paths, report); `orchestrator/src/engine/` would put an `engine/` folder inside the engine | `orchestrator/src/agent-engine/` | `orchestrator/src/engine/` (word for word) |
| G5 | One component, two names after L8: the directory is `orchestrator/`, its Gitea repo and image `engine`, its package `@eupadev/orchestrator` | as decided (L8); settle it in the product rename pass | one name now (`engine` everywhere, or `orchestrator` everywhere) |
| G6 | `DELAI_*` variables mix deadlines and waits between two actions | split: deadline → `*_TIMEOUT_MS` (`DELAI_TACHE_MS` → `TASK_TIMEOUT_MS`), wait → `*_DELAY_MS` (`DELAI_RELANCE_MS` → `REMINDER_DELAY_MS`) | `*_TIMEOUT_MS` everywhere |
