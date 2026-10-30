# Règles frontend

> Traduction destinée aux lecteurs humains ; la version anglaise `.claude/rules/frontend.md` fait foi.

## Design system
- Copie `design/design-system.css` tel quel dans `web/styles/design-system.css` ;
  ajoute des classes dans une autre feuille, ne change jamais un jeton ou une classe existants.
- Les couleurs d'état gardent un seul sens : `--green` succès, `--orange` en
  attente, `--red` erreur, `--blue` action neutre. Les graphiques utilisent `--series-1` à `--series-6` dans l'ordre.
- Mise en page : `.app-shell` avec `.sidebar` et `.app-main`.
- Maquettes du cadrage : pages statiques dans `web/` avec des données réalistes
  du domaine du demandeur, liens relatifs, aucun `fetch`, rien de `/core/`.

## Structure du code
- Modules ES natifs, aucune étape de build, aucun framework. `web/index.html`
  porte la mise en page et un `<template>` par bloc ; `web/app.js` route et affiche, comme l'outil de référence.
- L'API uniquement par `/core/api.js`, par `operationId` : `api.call`,
  `api.link` pour un lien (`<a href>`), `api.upload` pour un fichier ; les
  formulaires par `bindForm` (`/core/form.js`), qui prend leurs contraintes dans le contrat.

## Sécurité dans le navigateur
- Le texte par `textContent` ou les fonctions de rendu de `/core/render.js` ;
  jamais `innerHTML`, `document.write`, script ou style en ligne.
- Masquer une commande relève de l'affichage, jamais du contrôle d'accès. Rien sur la session dans `localStorage`.

## Formulaires et états réseau
- Un bouton d'envoi reste désactivé jusqu'à la réponse.
- Chaque requête montre l'attente, le succès, ou l'échec avec le `detail` et
  l'`error_id` du problème et un moyen de réessayer.

## Accessibilité (WCAG 2.1 AA)
- Atteignable au clavier avec un focus visible, un libellé pour chaque champ,
  contraste 4,5:1, `prefers-reduced-motion` respecté.
- `lang`, un seul `<h1>`, des repères, `alt` sur les images ; les pages
  principales passent axe sans violation critique ni sérieuse.
