# Agro Connect — Product & Technical Spec

Status: draft (Phase 1 — bootstrap). This document will evolve as later phases land.

## 1. Product Objective

Agro Connect is a lightweight, mobile-first web app for small and medium
agricultural operations (farmers, rural producers, field technicians) to
manage day-to-day operational data from a phone in the field or an office
computer, without installing anything or paying for a backend.

The app should feel fast on a mid-range Android phone with intermittent
connectivity, require only a Google account to get started, and keep every
feature reachable from a single screen via modals — no page navigation, no
build step, no framework.

## 2. Audience

- Primary: rural producers and farm staff who need a simple way to record
  and consult operational data (e.g., inventory, tasks, crops, equipment —
  final entity defined in Phase 5) from a mobile device.
- Secondary: small farm managers/admins who want a lightweight shared tool
  without standing up a full system.

Assumptions: users have a Google account, a modern mobile browser, and
variable-quality internet connectivity. No offline-first requirement in
this phase.

## 3. Functional Requirements

### 3.1 Authentication
- Users sign in with **Google login** via Firebase Authentication.
- Users can sign out from anywhere in the app (visible affordance in the
  main header/nav).
- Signed-out users see a login prompt and no access to data-bearing
  features.

### 3.2 Navigation & UI pattern
- The main page is a single shell (`index.html`).
- All features open as **modals** layered on top of the main page — there
  is no multi-page navigation/routing.
- Modals are dismissible (close button, backdrop click, `Esc` key) and
  trap focus while open (see Accessibility).

### 3.3 Domain entity CRUD (defined in Phase 5)
- The app supports Create, Read, Update, Delete for one primary domain
  entity, opened and edited via modal forms.
- The entity's exact shape (e.g., crop, task, inventory item) is
  intentionally undefined until Phase 5; section 6 sketches a placeholder
  `items` collection to unblock early plumbing (auth, Firestore wiring,
  modal shell) without committing to a schema.
- Only the authenticated owner (or authorized users, TBD in Phase 5) can
  modify their own records.

## 4. Non-Functional Requirements

### 4.1 Responsiveness
- Mobile-first layout: design and build for small viewports first, then
  progressively enhance for tablet/desktop breakpoints.
- Layout must remain usable from ~320px wide up through desktop widths,
  with touch-friendly tap targets (min ~44px).

### 4.2 Accessibility (baseline)
- Full keyboard operability: all interactive elements (nav, buttons,
  modal triggers, form fields) reachable and operable via keyboard alone.
- Modals use appropriate ARIA roles/attributes (`role="dialog"`,
  `aria-modal="true"`, `aria-labelledby`), trap focus while open, and
  restore focus to the trigger element on close.
- Sufficient color contrast against the green/earth palette (target WCAG
  AA for text).
- Meaningful `alt` text / `aria-label`s on icon-only controls.

### 4.3 Performance
- No build step, no heavy frameworks — plain HTML/CSS/JS plus the
  Firebase modular SDK loaded from CDN.
- Keep initial load lean: avoid unnecessary blocking scripts/styles,
  defer non-critical JS, and avoid loading Firestore data until the user
  is authenticated.
- Target a fast first paint on mid-range mobile hardware over 3G/4G.

## 5. Design System

"Countryside" visual identity: shades of green with earth-tone accents,
evoking fields, crops, and soil. Concrete hex values and full token list
will be finalized when the UI is built (Phase 2+); this section defines
the approach and placeholder tokens.

### 5.1 Approach
- All design values (colors, spacing, radii, typography scale, shadows)
  are defined as **CSS custom properties** on `:root`, so the palette and
  scale can be tuned in one place.
- No CSS framework/build tool — plain CSS using the custom properties as
  design tokens.

### 5.2 Draft tokens (placeholder — to be refined in Phase 2)

```css
:root {
  /* Greens (primary) */
  --color-green-900: #1b3a1e; /* darkest, headers/nav */
  --color-green-700: #2f5d33;
  --color-green-500: #4c8c4a; /* primary brand/action */
  --color-green-300: #8fc17f;
  --color-green-100: #e3f2df; /* subtle backgrounds */

  /* Earth tones (accents) */
  --color-earth-700: #6b4423; /* brown, secondary accents */
  --color-earth-400: #a9744f;
  --color-earth-100: #efe3d6; /* warm neutral background */

  /* Neutrals */
  --color-text: #1f241f;
  --color-text-muted: #5a6357;
  --color-surface: #ffffff;
  --color-border: #d7ddd3;

  /* Feedback */
  --color-danger: #b3261e;
  --color-success: var(--color-green-500);

  /* Spacing scale */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 16px;
  --space-4: 24px;
  --space-5: 32px;

  /* Radii */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 16px;
}
```

## 6. Initial Data Model (draft)

Firestore, modular SDK v12. Collection/field names and structure are
provisional and will be finalized alongside auth (later phase) and the
CRUD entity (Phase 5).

### `users` collection
Document ID: Firebase Auth `uid`.

| Field        | Type      | Notes                                  |
|--------------|-----------|-----------------------------------------|
| `uid`        | string    | Firebase Auth UID (redundant, for queries) |
| `displayName`| string    | From Google profile                    |
| `email`      | string    | From Google profile                    |
| `photoURL`   | string    | From Google profile                    |
| `createdAt`  | timestamp | Server timestamp on first login        |
| `lastLoginAt`| timestamp | Server timestamp, updated on login      |

### `items` collection (placeholder for the Phase 5 domain entity)
Document ID: auto-generated.

| Field       | Type      | Notes                                    |
|-------------|-----------|-------------------------------------------|
| `ownerUid`  | string    | References `users` document / Auth UID    |
| `name`      | string    | Placeholder label field                   |
| `notes`     | string    | Placeholder free-text field               |
| `createdAt` | timestamp | Server timestamp                          |
| `updatedAt` | timestamp | Server timestamp, updated on edit         |

This shape exists only to unblock early Firestore wiring and rules
structure; it will be replaced/extended once Phase 5 defines the real
domain entity.

## 7. Constraints

- **Single-file core**: application markup, styles, and logic live in
  `index.html` (inline `<style>`/`<script>` or minimal same-file
  structure) — no build pipeline, no bundler.
- **Firebase modular SDK v12**, loaded via CDN using ES module imports
  (`import { ... } from "https://www.gstatic.com/firebasejs/12.x.x/..."`).
  No npm install, no bundler-based imports.
- **No frontend frameworks** (no React/Vue/etc.) and no CSS frameworks —
  vanilla HTML/CSS/JS only.
- **Firestore security**: `firestore.rules` denies all access by default
  until Phase 6, when rules are scoped to authenticated, owner-based
  access per the data model above.

## 8. Out of Scope (for now)

- Offline support / service worker / PWA installability.
- Multi-language i18n.
- Roles/permissions beyond "authenticated owner."
- The concrete domain entity beyond the Phase 5 placeholder in section 6.

## 9. Phases (reference)

1. Bootstrap: repo structure, this spec, deny-all rules. *(this document)*
2. Design system + static app shell (mobile-first layout, modal shell, no data).
3. Firebase Auth (Google login/logout) wiring.
4. Firestore wiring for `users` on login.
5. Define and implement domain entity CRUD (modals + Firestore).
6. Tighten `firestore.rules` to real, owner-based access rules.
