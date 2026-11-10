---
paths:
  - "web/**"
---

# Frontend rules

## Design system
- Copy `design/design-system.css` unchanged to `web/styles/design-system.css`;
  add classes in another stylesheet, never change an existing token or class.
- Status colours keep one meaning: `--green` success, `--orange` pending,
  `--red` error, `--blue` neutral action. Charts use `--series-1` to `--series-6` in order.
- Layout: `.app-shell` with `.sidebar` and `.app-main`.
- Scoping mock-ups: static pages in `web/` with realistic data from the
  requester's domain, relative links, no `fetch`, nothing from `/core/`.

## Code structure
- Native ES modules, no build step, no framework. `web/index.html` holds the
  layout and one `<template>` per block; `web/app.js` routes and renders, as in the reference tool.
- The API only through `/core/api.js`, by `operationId`: `api.call`,
  `api.link` for a link (`<a href>`), `api.upload` for a file; forms through
  `bindForm` (`/core/form.js`), which takes their constraints from the contract.

## Security in the browser
- Text through `textContent` or the render helpers of `/core/render.js`;
  never `innerHTML`, `document.write`, inline script or style.
- Hiding a control is display, never access control. Nothing about the session in `localStorage`.

## Forms and network states
- A submit button stays disabled until the response arrives.
- Every request shows progress, success, or failure with the problem's
  `detail` and `error_id` and a way to retry.

## Accessibility (WCAG 2.1 AA)
- Keyboard reachable with visible focus, a label for every field, contrast
  4.5:1, `prefers-reduced-motion` respected.
- `lang`, one `<h1>`, landmarks, `alt` on images; main pages pass axe with no
  critical or serious violation.
- The Preview's pa11y check ignores the rule NoSuchID (hash-route links such
  as `#/requests/new` point to no id): an in-page link (`#main`, a skip link)
  is not checked by it. If you add one, its target id must exist and an
  acceptance test must follow it.
