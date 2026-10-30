<div align="right">

🇬🇧 [Read in English](CONTRIBUTING.md)

</div>

# Contribuer à EupaDev

Merci d'envisager une contribution. Ce projet est encore en
**pré-publication** : au labo, un cycle complet avec un agent scripté (sans
IA) tourne de bout en bout — forge, CI, gates, image signée, Preview, Prod —
mais le tableau de bord et plusieurs pièces sont encore en construction
(voir [`docs/fr/architecture.md`](docs/fr/architecture.md) et
[`ROADMAP.md`](ROADMAP.md) §8). Il est normal que les choses bougent encore.

Toute participation suit le [code de conduite](CODE_OF_CONDUCT.md).

## Avant d'ouvrir une PR

Pour tout ce qui dépasse une simple coquille, ouvre d'abord une issue
décrivant le problème ou le changement envisagé. Ce projet a une
conception assez tranchée, pensée sécurité d'abord (voir
[`docs/architecture.md`](docs/architecture.md)
et [`ROADMAP.md`](ROADMAP.md) pour le raisonnement derrière la plupart
des choix) — une issue d'abord t'évite d'écrire une PR qui va à
l'encontre d'une décision déjà prise délibérément, pour une raison
documentée.

## Où vivent réellement les règles

Ne devine pas les conventions en lisant seulement le code existant — ce
projet les a écrites explicitement, et elles sont censées être suivies à
la lettre, y compris par les agents IA qui utilisent ce template :

- [`tool-template/AGENTS.md`](tool-template/AGENTS.md) — la
  charte des agents : le cycle Cadrage → Contrat → Durcissement → Review,
  les rôles et les dossiers où chacun peut écrire, les fichiers protégés,
  les règles non négociables.
- [`tool-template/.claude/rules/*.md`](tool-template/.claude/rules/) —
  règles détaillées par domaine : `backend.md`, `frontend.md`,
  `security.md` (18 catégories de sécurité), `quality.md` (7 axes de
  qualité), `tests.md`.
- [`docs/architecture.md`](docs/architecture.md) —
  comment la plateforme elle-même est câblée (modèle de confiance,
  pipeline, contrat de déploiement).
- [`docs/governance.md`](docs/governance.md) —
  rôles, gates, cycle de vie d'un outil généré.

Si tu modifies une règle dans `.claude/rules/`, mets aussi à jour la
section correspondante du sous-agent de revue concerné dans
`.claude/agents/` si la vérification doit changer — une règle sans
vérification associée n'est en pratique jamais appliquée.

## Faire un changement

1. **`tool-template/`** — tout changement de règle ou de convention
   ici affecte chaque futur outil généré à partir de ce template. Garder
   `AGENTS.md` court (~110 lignes) est volontaire ; le raisonnement
   détaillé a sa place dans le fichier `.claude/rules/*.md` concerné, pas
   dans `AGENTS.md` lui-même.
2. Garder des commentaires qui expliquent *pourquoi*, pas *quoi* — le
   code montre déjà ce qu'il fait.

## Messages de commit

Aucun format strict requis, mais un message de commit doit expliquer
pourquoi un changement a été fait, pas juste reformuler le diff. Si un
changement corrige un vrai bug trouvé en testant, dis ce qui ne marchait
pas et comment ça a été trouvé — c'est ce contexte qui rend fiables les
points de la checklist du projet par la suite.

## Signature (Developer Certificate of Origin)

Chaque commit doit être signé : `git commit -s` ajoute la ligne
`Signed-off-by: Ton Nom <toi@example.org>`, qui doit correspondre à
l'auteur du commit. En signant, tu certifies le
[Developer Certificate of Origin 1.1](https://developercertificate.org/) :
tu as écrit le changement, ou tu as le droit de le soumettre sous la
licence du projet. La CI refuse une pull request dont un commit n'est pas
signé. Pour corriger : `git commit --amend -s` (dernier commit) ou
`git rebase --signoff main` (tous), puis force-push de ta branche.

## Comment ce projet est construit

L'essentiel du code d'EupaDev est écrit par un agent de code IA (Claude
Code). Un humain — le mainteneur — décide quoi construire, relit chaque
changement, le fait tourner sur les VM du labo et le signe. Ce qui rend ça
digne de confiance, ce n'est pas l'agent mais les contrôles autour : la CI
(types, tests, tests de mutation, anglais seulement, empreintes épinglées,
ADR immuables), de vrais essais au labo, et un
[journal des erreurs de l'IA](docs/ai-error-log.md) qui note chaque erreur
de l'IA attrapée, par quoi, et ce qu'elle aurait coûté. Les commits du
mainteneur portent une ligne `Assisted-by:` qui nomme le modèle. Les règles
ci-dessous s'appliquent à tous, mainteneur compris.

## Contributions écrites avec l'IA

L'aide d'une IA est bienvenue, avec les règles qu'on s'applique à
nous-mêmes :

- **Le dire** : la partie « AI disclosure » de la pull request nomme
  l'outil, le modèle et ce qu'il a fait. Une ligne
  `Assisted-by: <outil> <modèle>` dans le commit est bienvenue ; un outil
  n'est jamais `Co-authored-by`.
- **L'assumer** : tu as lu, lancé et compris chaque ligne, et tu peux
  l'expliquer sans l'outil. La description et tes réponses à la revue sont
  écrites par toi.
- **Signer toi-même** : seul un humain peut certifier le DCO ; un outil ne
  signe jamais.
- **Le tester** : le changement arrive avec ses tests, comme les autres.
- **Pas d'agent autonome** : aucun robot ni agent n'ouvre d'issue, de pull
  request ou de commentaire de lui-même.
- **Reproduire d'abord** : un bug ou une faille trouvé par une IA n'est
  signalé qu'une fois reproduit par toi (voir [SECURITY.md](SECURITY.md)).

Le travail d'IA non déclaré, en masse ou que son auteur ne sait pas
expliquer est fermé sans discussion.

## Gouvernance du projet

EupaDev a un seul mainteneur, qui relit et fusionne chaque changement et
décide de la feuille de route ; les décisions et leurs raisons sont les ADR
de [`docs/adr/`](docs/adr/). Le [code de conduite](CODE_OF_CONDUCT.md)
s'applique partout. Aide et support : [SUPPORT.md](SUPPORT.md).

## Signaler une faille de sécurité

N'ouvre pas d'issue publique : suis [SECURITY.md](SECURITY.md).

## Licence

En contribuant, tu acceptes que ta contribution soit placée sous la
[licence Apache 2.0](LICENSE) du projet.
