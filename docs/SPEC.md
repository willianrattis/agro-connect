# Agro Connect — Product & Technical Spec

Status: approved. Domain: **beef cattle (gado de corte) operational and
financial management**. Concrete CRUD implementation and final Firestore
shapes land in Phase 5 (section 9); security rules are hardened in
Phase 7.

## 1. Product Objective

Agro Connect is a lightweight, mobile-first web app for small and medium
**beef cattle operations** (fazendeiros, produtores rurais, técnicos de
campo) to manage day-to-day herd, lifecycle, and financial data from a
phone in the field or an office computer, without installing anything or
paying for a backend.

The app should feel fast on a mid-range Android phone with intermittent
connectivity, require only a Google account to get started, and keep every
feature reachable from a single screen via modals — no page navigation, no
build step, no framework.

## 2. Audience

- Primary: rural producers and farm staff who need a simple way to record
  and consult cattle-operation data — individual animals, lots/categories,
  lifecycle events, weighings, and financial transactions — from a mobile
  device.
- Secondary: small farm managers/admins who want a lightweight shared tool
  without standing up a full system, and who need at-a-glance zootechnical
  and financial indicators (section 6.7) instead of spreadsheets.

Assumptions: users have a Google account, a modern mobile browser, and
variable-quality internet connectivity. No offline-first requirement in
this phase. Single-owner data per operation for now — shared/multi-user
farm access (e.g., owner + foreman with different permissions) is out of
scope until a future phase (section 8).

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

### 3.3 Domain: beef cattle CRUD
The app supports Create, Read, Update, Delete, via modal forms, for the
entities defined in section 6:

- **Animals** (individual, tracked by ear tag / brinco).
- **Lots** (lotes/categorias: recria, engorda, matrizes, bezerros, etc.).
- **Lifecycle events**: compra (purchase), venda (sale), desmama
  (weaning), morte/perda (death/loss), **pesagens (weighings)**, and the
  reproductive events needed to compute the indicators in 6.7 —
  cobertura/IA (breeding), **diagnóstico de gestação confirmado (pregnancy
  confirmed)**, and **parto (calving)**.
- **Financial transactions**: receitas (income) and despesas (expenses),
  categorized and optionally linked to a specific animal, a specific lot,
  or the operation as a whole (unlinked = general overhead).

Only the authenticated owner can create/modify their own animals, lots,
events, and transactions. Broader roles/permissions remain out of scope
(section 8).

### 3.4 Tracking granularity
Two levels of tracking are first-class, not one collapsed into the other:

- **Individual animal** (ear tag): full lifecycle and weight history,
  purchase/sale economics, reproductive history.
- **Lot/category** (recria, engorda, matrizes, ...): groups animals for
  batch events, batch costs, and area-based indicators (ganho/ha,
  lotação, lucro/ha). An animal belongs to exactly one lot at a time; its
  `category` changes over its life (e.g., bezerro → recria after
  desmama).

### 3.5 Financial tracking
- Every receita/despesa has a required `date` and `amount`, a `category`
  (e.g., venda-animal, compra-animal, alimentação, sanidade, mão-de-obra,
  arrendamento, depreciação), and a link scope: `animal`, `lot`, or
  `operation`.
- Despesas additionally carry a `costNature` (`efetivo` vs `não-efetivo`)
  so effective operating cost (COE) and total operating cost (COT)
  indicators (6.7) can be computed separately, following the standard
  COE/COT cost-accounting convention used in Brazilian pecuária de corte
  (e.g., depreciação is não-efetivo).

### 3.6 Lifecycle event dates are mandatory
Purchase and sale events **require** a date field. Days-held, GMD, idade
de abate, and daily-profit indicators are derived from event **dates**,
not inferred from weight records — a weighing is a separate, independently
dated event (section 6.5).

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
evoking fields, pasture, and soil. Concrete hex values and full token list
were drafted in Phase 2 (see `index.html`); this section keeps the
approach and placeholder tokens for reference.

### 5.1 Approach
- All design values (colors, spacing, radii, typography scale, shadows)
  are defined as **CSS custom properties** on `:root`, so the palette and
  scale can be tuned in one place.
- No CSS framework/build tool — plain CSS using the custom properties as
  design tokens.

### 5.2 Draft tokens

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

## 6. Data Model

Firestore, modular SDK v12. Six top-level collections: **`users`,
`animals`, `lots`, `events`, `transactions`, `settings`**. Collections are
flat (each document carries `ownerId`) to keep security rules simple —
see `firestore.rules` for the owner-based access rules (section 7). Field
names below are the working contract; exact final shapes are locked in
Phase 5 (section 9) when the CRUD forms are built, but no field required
by section 6.7's indicator matrix may be dropped.

### 6.1 `users`
Document ID: Firebase Auth `uid`.

| Field        | Type      | Notes                                  |
|--------------|-----------|-----------------------------------------|
| `uid`        | string    | Firebase Auth UID (redundant, for queries) |
| `displayName`| string    | From Google profile                    |
| `email`      | string    | From Google profile                    |
| `photoURL`   | string    | From Google profile                    |
| `createdAt`  | timestamp | Server timestamp on first login        |
| `lastLoginAt`| timestamp | Server timestamp, updated on login      |

### 6.2 `settings`
Document ID: `ownerId` (1:1 with `users`). Operation-wide values needed
for area- and price-based indicators that no single animal/lot record can
supply.

| Field                     | Type      | Notes                                                        |
|---------------------------|-----------|----------------------------------------------------------------|
| `ownerId`                 | string    | References `users` document / Auth UID                        |
| `totalAreaHa`             | number    | Total property area, hectares                                 |
| `grazingAreaHa`           | number    | Usable pasture area; default fallback for lots without their own `areaHa` — feeds ganho/ha, lotação, lucro/ha |
| `referenceArrobaPriceBRL` | number    | Manually-updated current @ market price (R$) — used for herd inventory valuation and as a custo-de-reposição proxy. True replacement cost would need external market data this app doesn't source; this is an approximation, not a market feed. |
| `createdAt`, `updatedAt`  | timestamp | Server timestamps                                              |

### 6.3 `lots` (lotes)
Document ID: auto-generated.

| Field       | Type      | Notes                                                    |
|-------------|-----------|-------------------------------------------------------------|
| `ownerId`   | string    | References `users` document / Auth UID                      |
| `name`      | string    | e.g., "Lote 3 — Engorda"                                     |
| `category`  | string    | `recria` \| `engorda` \| `matrizes` \| `bezerros` \| `outro` |
| `areaHa`    | number \| null | Optional override; falls back to `settings.grazingAreaHa` when unset |
| `createdAt`, `updatedAt` | timestamp | Server timestamps                              |

### 6.4 `animals` (individual, brinco)
Document ID: auto-generated.

| Field                    | Type      | Notes                                                      |
|---------------------------|-----------|-------------------------------------------------------------|
| `ownerId`                 | string    | References `users` document / Auth UID                      |
| `earTag`                  | string    | Brinco; unique per owner                                    |
| `sex`                     | string    | `M` \| `F`                                                   |
| `breed`                   | string \| null | Optional                                                 |
| `category`                | string    | Current category; changes over the animal's life (e.g. on desmama) |
| `lotId`                   | string \| null | FK → `lots`                                             |
| `birthDate`               | timestamp \| null | Known only if born on the property                    |
| `birthDateIsEstimated`    | boolean   | When an animal is purchased young and the true birth date is unknown, a producer-estimated date may be stored so idade-de-abate can still be approximated; this flag is required whenever `birthDate` is set that way |
| `damAnimalId`             | string \| null | FK → `animals`; mother reference, only known for animals born on the property — feeds IEP/reproductive indicators |
| `acquisitionType`         | string    | `born` \| `purchased`                                        |
| `purchaseDate`            | timestamp \| null | **Required** if `acquisitionType = purchased`; source of days-held, not weight |
| `purchaseWeightKg`        | number \| null | Required alongside `purchaseDate`                       |
| `purchaseCostBRL`         | number \| null | Required alongside `purchaseDate`                       |
| `status`                  | string    | `active` \| `sold` \| `dead`                                  |
| `saleDate`                | timestamp \| null | **Required** when `status = sold`; source of days-held |
| `saleArrobas`             | number \| null | Carcass basis, 1 @ = 15 kg; required with `saleDate`      |
| `salePricePerArrobaBRL`   | number \| null | Required with `saleDate`                                 |
| `saleRevenueBRL`          | number \| null | `= saleArrobas × salePricePerArrobaBRL`, denormalized for quick reads |
| `deathDate`               | timestamp \| null | Required when `status = dead`                          |
| `deathCause`              | string \| null | Free text                                                |
| `createdAt`, `updatedAt`  | timestamp | Server timestamps                                            |

Note: `purchase*`/`sale*` fields here are a denormalized convenience copy
of the corresponding `events` documents (6.5) for cheap reads (herd list,
inventory valuation) without a join; `events` remains the source of
truth/audit trail. Keeping the two in sync is a single write-path
concern for the CRUD phase, not a schema ambiguity.

### 6.5 `events` (ciclo de vida, pesagens e reprodução)
Document ID: auto-generated. One collection covers all dated occurrences:
lifecycle events (compra, venda, desmama, morte), **weighings
(pesagens)** — recorded whenever the producer weighs an animal, not only
at transaction time — and the reproductive events (cobertura/IA,
diagnóstico de gestação, parto) needed to compute
prenhez/desmame/natalidade/IEP.

| Field        | Type      | Notes                                                         |
|--------------|-----------|------------------------------------------------------------------|
| `ownerId`    | string    | References `users` document / Auth UID                           |
| `type`       | string    | `purchase` \| `sale` \| `weaning` \| `death` \| `weighing` \| `breeding` \| `pregnancy_check` \| `birth` |
| `animalId`   | string \| null | FK → `animals`; null for a lot-level bulk event              |
| `lotId`      | string \| null | FK → `lots`; set for bulk purchase/sale of a whole lot        |
| `date`       | timestamp | **Required** for every type                                       |
| `payload`    | map       | Type-specific fields, see below                                    |
| `createdAt`  | timestamp | Server timestamp                                                    |

`payload` shape by `type`:

| `type`             | `payload` fields                                                   |
|--------------------|----------------------------------------------------------------------|
| `purchase`         | `weightKg`, `costBRL`                                                |
| `sale`             | `arrobas`, `pricePerArrobaBRL`, `revenueBRL` (= arrobas × price)      |
| `weaning`          | `weightKg`, `damAnimalId`; triggers `animals.category` transition     |
| `death`            | `cause`                                                                |
| `weighing`         | `weightKg` (live weight, required)                                     |
| `breeding`         | `method` (`natural` \| `IA`), `sireId` (optional), `femaleAnimalId`   |
| `pregnancy_check`  | `femaleAnimalId`, `result` (`pregnant` \| `open`), `method`           |
| `birth`            | `calfAnimalId`, `damAnimalId`, `birthWeightKg`                        |

### 6.6 `transactions` (receitas e despesas)
Document ID: auto-generated.

| Field              | Type      | Notes                                                              |
|---------------------|-----------|------------------------------------------------------------------------|
| `ownerId`           | string    | References `users` document / Auth UID                                 |
| `kind`              | string    | `receita` \| `despesa`                                                  |
| `category`          | string    | e.g., `venda-animal`, `compra-animal`, `alimentação`, `sanidade`, `mão-de-obra`, `arrendamento`, `depreciação`, `outros` |
| `costNature`        | string \| null | `efetivo` \| `não-efetivo`; required when `kind = despesa` (feeds COE vs COT, see 6.7) |
| `amountBRL`         | number    | Required                                                                 |
| `date`              | timestamp | Required                                                                 |
| `linkedScope`       | string    | `animal` \| `lot` \| `operation`                                        |
| `linkedAnimalId`    | string \| null | Set when `linkedScope = animal`                                    |
| `linkedLotId`       | string \| null | Set when `linkedScope = lot`                                       |
| `description`       | string \| null | Free text                                                          |
| `createdAt`         | timestamp | Server timestamp                                                        |

### 6.7 Indicator computability matrix

All four indicator groups — **desempenho animal (performance),
reprodutivo, econômico-financeiro, and gestão** — must be computable from
the stored data in 6.1–6.6, with no external inputs beyond the manually
maintained `settings` values. Formulas follow standard Brazilian pecuária
de corte definitions. Below, "weighings" means `events` with
`type = weighing`.

**Desempenho animal**
| Indicator | Formula | Source |
|---|---|---|
| GMD (ganho médio diário) | (weightKg₂ − weightKg₁) / (date₂ − date₁) per animal | weighings |
| Ganho/ha | Σ weight gain of animals in a lot over a period / lot area | weighings + `lots.areaHa` / `settings.grazingAreaHa` |
| Lotação (UA/ha) | Σ (latest weighing `weightKg` / 450) for active animals / area | `animals` + weighings + `lots`/`settings`. 450 kg/UA is the standard conversion constant. |
| Desfrute | count(`events` type=`sale`\|`death` in period) / count(active `animals` at period start) × 100 | `events` + `animals` |
| Idade de abate | `events[sale].date` − `animals.birthDate` (or `purchaseDate` if `birthDate` is null — approximation, see 6.4) | `animals` + `events` |
| Rendimento de carcaça | (`events[sale].arrobas` × 15) / latest weighing `weightKg` before sale date × 100 | `events` |

**Reprodutivo**
| Indicator | Formula | Source |
|---|---|---|
| Taxa de prenhez | count(`pregnancy_check` result=pregnant) / count(distinct females in `breeding`) × 100 | `events` |
| Taxa de desmame | count(`weaning`) / count(`birth`) × 100 | `events` |
| Taxa de natalidade | count(`birth`) / count(distinct females in `breeding`) × 100 | `events` |
| IEP (intervalo entre partos) | date diff between consecutive `birth` events sharing the same `damAnimalId` | `events` |
| Bezerros/vaca exposta | count(`birth`) / count(distinct females in `breeding` in period) | `events` |

**Econômico-financeiro**
| Indicator | Formula | Source |
|---|---|---|
| COE/@ | Σ `transactions` despesa, `costNature=efetivo` / total arrobas produced (Σ `events[sale].arrobas`) | `transactions` + `events` |
| COT/@ | Σ `transactions` despesa (all) / total arrobas produced | `transactions` + `events` |
| Margem bruta | Σ receita − Σ despesa (efetivo) | `transactions` |
| Margem líquida | Σ receita − Σ despesa (all) | `transactions` |
| Break-even (@) | total COT / current @ price | `transactions` + `settings.referenceArrobaPriceBRL` (or realized avg sale price from `events`) |
| ROI | (Σ receita − Σ despesa) / Σ despesa, scoped to an animal/lot/operation via `linkedScope` | `transactions` |
| Lucro/ha | (Σ receita − Σ despesa linked to a lot/operation) / area | `transactions` + `lots`/`settings` |

**Gestão / capital de giro**
| Indicator | Formula | Source |
|---|---|---|
| Giro de estoque | count(`events[sale]`) / average active-animal count over period | `events` + `animals` |
| Fluxo de caixa | `transactions` grouped by period, running receita − despesa | `transactions` |
| Custo de reposição | `settings.referenceArrobaPriceBRL` × typical category weight, or recent avg `compra-animal` despesa per category (approximation — see 6.2) | `settings` + `transactions` |
| Inventário (valorização do rebanho) | Σ active `animals`' latest weighing `weightKg` converted to @ × `settings.referenceArrobaPriceBRL` | `animals` + `events` + `settings` |

### 6.8 Worked example (validation)

Calf bought at 180 kg for R$3,000 on a purchase date; sold at 21 @
(1 @ = 15 kg carcass; @ = R$350 → 21 × 350 = R$7,350) on a sale date.

```
animals/a1:
  earTag: "1234", acquisitionType: "purchased",
  purchaseDate: 2026-01-10, purchaseWeightKg: 180, purchaseCostBRL: 3000,
  status: "sold",
  saleDate: 2026-07-05, saleArrobas: 21, salePricePerArrobaBRL: 350,
  saleRevenueBRL: 7350   // 21 × 350

events:
  { type: "purchase", animalId: "a1", date: 2026-01-10,
    payload: { weightKg: 180, costBRL: 3000 } }
  { type: "sale", animalId: "a1", date: 2026-07-05,
    payload: { arrobas: 21, pricePerArrobaBRL: 350, revenueBRL: 7350 } }

transactions:
  { kind: "despesa", category: "compra-animal", costNature: "efetivo",
    amountBRL: 3000, date: 2026-01-10,
    linkedScope: "animal", linkedAnimalId: "a1" }
  { kind: "receita", category: "venda-animal",
    amountBRL: 7350, date: 2026-07-05,
    linkedScope: "animal", linkedAnimalId: "a1" }
```

Derived by the app:
- **Days held** = `saleDate − purchaseDate` = 176 days (from dates, not
  weights).
- **Profit** = Σ receita − Σ despesa = 7,350 − 3,000 = **R$4,350**.
- **Daily profit** = 4,350 / 176 ≈ **R$24.72/day**.

Matches the required outputs; confirms `purchaseDate`/`saleDate` as
mandatory fields is sufficient (no dependency on weight records for
days-held).

## 7. Constraints

- **Single-file core**: application markup, styles, and logic live in
  `index.html` (inline `<style>`/`<script>` or minimal same-file
  structure) — no build pipeline, no bundler.
- **Firebase modular SDK v12**, loaded via CDN using ES module imports
  (`import { ... } from "https://www.gstatic.com/firebasejs/12.x.x/..."`).
  No npm install, no bundler-based imports.
- **No frontend frameworks** (no React/Vue/etc.) and no CSS frameworks —
  vanilla HTML/CSS/JS only.
- **Mobile-first** layout and **WCAG AA** contrast/accessibility baseline
  (section 4).
- **Firestore security**: `firestore.rules` scopes each collection to
  authenticated, owner-based access (`ownerId == request.auth.uid`) per
  the data model above; `users/{uid}` and `settings/{uid}` are keyed by
  the uid itself. Any path not covered stays denied by default.

## 8. Out of Scope (for now)

- Offline support / service worker / PWA installability.
- Multi-language i18n.
- Roles/permissions beyond "authenticated owner" — no owner + foreman /
  shared-operation access yet (see the assumption in section 2).
- Live market-price feeds for `referenceArrobaPriceBRL` / custo de
  reposição — manually entered for now (section 6.2).
- Genealogy/breeding-value tracking beyond the minimal `damAnimalId`/
  `sireId` references needed for IEP and reproductive-rate indicators.

## 9. Phases (reference)

1. Bootstrap: repo structure, spec, deny-all rules. *(done)*
2. Design system + static app shell (mobile-first layout, modal shell,
   mock data). *(done — the mock data in `index.html` still reflects the
   pre-revision placeholder domain and will be replaced with
   cattle-domain sample data in Phase 5)*
3. Spec revision to the beef-cattle domain (this document). *(done)*
4. Firebase Auth (Google login/logout) wiring, plus Firestore `users`
   document on login.
5. **Cattle data model + CRUD**: exact Firestore shapes for `animals`,
   `lots`, `events` (lifecycle, weighings, reproductive), `transactions`,
   and `settings` (section 6), with modal forms wired to Firestore.
6. Indicator dashboard: compute and surface the four indicator groups
   from section 6.7 (desempenho, reprodutivo, econômico-financeiro,
   gestão) from stored data.
7. Harden `firestore.rules` from deny-all to real, owner-based access
   rules across all collections in section 6.
