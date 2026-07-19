import { toDateSafe } from "./helpers.js";

    // =====================================================
    // 1. Domain constants
    // =====================================================
    export const CARCASS_YIELD = 0.5;   // live → carcass approximation for the @ estimate
    export const KG_PER_ARROBA = 15;

    // Embrapa annual average daily gain for pasture-only systems (mineral
    // salt only) — already nets out dry-season losses.
    export const PASTURE_QUALITY = {
      degradada: { label: "Degradada", gmdKgPerDay: 0.205 },
      fraca:     { label: "Fraca",     gmdKgPerDay: 0.288 },
      regular:   { label: "Regular",   gmdKgPerDay: 0.383 },
      boa:       { label: "Boa",       gmdKgPerDay: 0.480 },
    };
    export const DEFAULT_PASTURE_QUALITY = "regular";
    // Embrapa GMD figures are for males. Females gain 12–15% less on the same
    // pasture; 0.865 is the midpoint of that band. Single tunable knob.
    export const FEMALE_GMD_FACTOR = 0.865;
    export const CONFINEMENT_GMD_KG_PER_DAY = 1.7; // typical feedlot GMD 1.6–1.8 kg/day

    // Ponto de abate — global target/yield defaults, overridable per lot and
    // per Perfil settings (settings/{uid}.targetArrobasPerHead/defaultFarmYieldPct/
    // defaultConfinementYieldPct). These constants are the final fallback for
    // docs that predate the feature or never set the settings doc.
    export const DEFAULT_TARGET_ARROBAS_PER_HEAD = 21;
    export const DEFAULT_FARM_YIELD_PCT = CARCASS_YIELD;  // ~50% at pasture
    export const DEFAULT_CONFINEMENT_YIELD_PCT = 0.54;    // feedlot runs higher, up to ~57%

    // Single source of truth for cattle category taxonomy (key → label/sex).
    // Order matters: it drives select option order everywhere it's rendered.
    export const CATTLE_CATEGORIES = {
      bezerro_lactente:  { label: "Bezerro (mamando)", sex: "M" },
      bezerra_lactente:  { label: "Bezerra (mamando)", sex: "F" },
      bezerro_desmamado: { label: "Bezerro desmamado", sex: "M" },
      bezerra_desmamada: { label: "Bezerra desmamada", sex: "F" },
      garrote:           { label: "Garrote",           sex: "M" },
      boi_magro:         { label: "Boi magro",          sex: "M" },
      boi_gordo:         { label: "Boi gordo",          sex: "M" },
      novilha:           { label: "Novilha",            sex: "F" },
      vaca:              { label: "Vaca",               sex: "F" },
    };

    // Reuses the existing 4-hue chip palette (SPEC chip-bezerro/recria/engorda/matriz)
    // by bucketing the finer taxonomy into the same visual families.
    export const CATEGORY_CHIP_CLASS = {
      bezerro_lactente: "chip-bezerro",
      bezerra_lactente: "chip-bezerro",
      bezerro_desmamado: "chip-recria",
      bezerra_desmamada: "chip-recria",
      garrote: "chip-recria",
      novilha: "chip-recria",
      boi_magro: "chip-engorda",
      boi_gordo: "chip-engorda",
      vaca: "chip-matriz",
    };

    // CATTLE_CATEGORIES entries whose sex matches, in taxonomy order — feeds
    // any category <select> that's scoped to a chosen sex.
    export function categoriesForSex(sex) {
      return Object.entries(CATTLE_CATEGORIES)
        .filter(([, c]) => c.sex === sex)
        .map(([value, c]) => ({ value, label: c.label }));
    }

    // Legacy (pre-taxonomy) category values → CATTLE_CATEGORIES key, resolved
    // against the animal's sex where the old value was sex-ambiguous. Existing
    // stored docs keep their legacy value; this only runs at read time.
    export function MIGRATE_CATEGORY(oldKey, sex) {
      switch (oldKey) {
        case "bezerro": return sex === "F" ? "bezerra_lactente" : "bezerro_lactente";
        case "recria":  return sex === "F" ? "novilha" : "garrote";
        case "engorda": return "boi_magro";
        case "matriz":  return "vaca";
        default: return null;
      }
    }

    // Stored category → current taxonomy key, migrating legacy values on the fly.
    export function resolveCategoryKey(rawCategory, sex) {
      if (rawCategory && CATTLE_CATEGORIES[rawCategory]) return rawCategory;
      return MIGRATE_CATEGORY(rawCategory, sex);
    }

    export function categoryLabelFor(rawCategory, sex) {
      const key = resolveCategoryKey(rawCategory, sex);
      return key ? CATTLE_CATEGORIES[key].label : (rawCategory || "—");
    }

    export function categoryChipClassFor(rawCategory, sex) {
      const key = resolveCategoryKey(rawCategory, sex);
      return (key && CATEGORY_CHIP_CLASS[key]) || "chip-recria";
    }

    // Whole months between two dates, floored (a day short of the month
    // anniversary doesn't count yet). Used only for stage derivation below.
    export function ageMonthsBetween(birthDate, now) {
      const b = toDateSafe(birthDate);
      const n = toDateSafe(now) || now;
      if (!b || !n) return null;
      let months = (n.getFullYear() - b.getFullYear()) * 12 + (n.getMonth() - b.getMonth());
      if (n.getDate() < b.getDate()) months -= 1;
      return Math.max(0, months);
    }

    // Chronological stage engine (derived, not stored). Age is the primary
    // driver — a stage never stalls waiting on an event stamp — and events
    // (weaning/1st-calving/finishing) only pull the stage forward EARLIER
    // than the age thresholds would (e.g. an early-weaned 9mo calf, or a
    // terminal finishing/calving flag). A null event date never holds an
    // animal back below what its age already implies.
    // Returns null when there's no birthDate to compute from — callers must
    // fall back to the stored entry category (no auto-advance) in that case.
    export function deriveStage({ sex, birthDate, weaningDate, firstCalvingDate, finishingStartDate, now = new Date() }) {
      const age = ageMonthsBetween(birthDate, now);
      if (age == null) return null;

      const nowDate = toDateSafe(now) || now;
      const weanedEarly = !!(weaningDate && toDateSafe(weaningDate) && toDateSafe(weaningDate) <= nowDate);

      if (sex === "F") {
        if (firstCalvingDate) return "vaca";
        if (age >= 12) return "novilha";
        if (age >= 8 || weanedEarly) return "bezerra_desmamada";
        return "bezerra_lactente";
      }

      // Male
      if (finishingStartDate) return "boi_gordo";
      if (age >= 24) return "boi_magro";
      if (age >= 12) return "garrote";
      if (age >= 8 || weanedEarly) return "bezerro_desmamado";
      return "bezerro_lactente";
    }

    // Chronological rank per sex — later stage = higher index. Used to floor
    // the derived stage at the stored/entry category so a lot or animal
    // registered mid-life (e.g. bought in as bezerro_desmamado) can only ever
    // move forward, never regress to an earlier stage the derivation might
    // otherwise imply (e.g. missing birthDateRef precision).
    export const STAGE_RANK = {
      M: ["bezerro_lactente", "bezerro_desmamado", "garrote", "boi_magro", "boi_gordo"],
      F: ["bezerra_lactente", "bezerra_desmamada", "novilha", "vaca"],
    };
    export function stageRank(key, sex) {
      const order = STAGE_RANK[sex];
      return order ? order.indexOf(key) : -1;
    }
    // Never lets `derivedKey` rank below `floorKey` (the stored/entry
    // category) — a floor, not a ceiling, so later stages still win.
    export function clampStageFloor(derivedKey, floorKey, sex) {
      const derivedRank = stageRank(derivedKey, sex);
      const floorRank = stageRank(floorKey, sex);
      if (derivedRank === -1 || floorRank === -1) return derivedKey;
      return derivedRank < floorRank ? floorKey : derivedKey;
    }

    // animal.birthDate falls back to its lot's birthDateRef (untagged/aggregate
    // reference age); with neither, the stored entry category wins as-is.
    export function displayCategoryKeyForAnimal(animal, lot) {
      const birthDate = animal.birthDate || lot?.birthDateRef || null;
      const storedKey = resolveCategoryKey(animal.category, animal.sex);
      if (!birthDate) return storedKey;
      const derivedKey = deriveStage({
        sex: animal.sex,
        birthDate,
        weaningDate: animal.weaningDate,
        firstCalvingDate: animal.firstCalvingDate,
        finishingStartDate: animal.finishingStartDate,
      });
      if (!derivedKey) return storedKey;
      return clampStageFloor(derivedKey, storedKey, animal.sex);
    }

    // lot.entryCategory-based lots (Phase 2+) derive their stage from
    // birthDateRef; lots predating that field simply have no entryCategory
    // and the caller should fall back to the legacy coarse category display.
    export function displayCategoryKeyForLot(lot) {
      if (!lot.entryCategory) return null;
      const floorKey = resolveCategoryKey(lot.entryCategory, lot.sex);
      if (!lot.birthDateRef) return floorKey;
      const derivedKey = deriveStage({
        sex: lot.sex,
        birthDate: lot.birthDateRef,
        weaningDate: lot.weaningDate,
        firstCalvingDate: lot.firstCalvingDate,
        finishingStartDate: lot.finishingStartDate,
      });
      if (!derivedKey) return floorKey;
      return clampStageFloor(derivedKey, floorKey, lot.sex);
    }

    // CATTLE_CATEGORIES key (lots.entryCategory) → legacy coarse lots.category
    // bucket, kept alongside entryCategory on every new lot so the existing
    // lot-list chip/label rendering (lotCategoryLabel/LOT_CHIP_CLASS) keeps
    // working without a migration.
    export const LOT_CATEGORY_BUCKET = {
      bezerro_lactente: "bezerros",
      bezerra_lactente: "bezerros",
      bezerro_desmamado: "recria",
      bezerra_desmamada: "recria",
      garrote: "recria",
      novilha: "recria",
      boi_magro: "engorda",
      boi_gordo: "engorda",
      vaca: "matrizes",
    };

    // ---- Lot-centric rework foundation (data shape only, Phase 1) ----
    // These fields are not written yet — the next phases wire up the forms
    // that populate them. Readers must treat any field absent on a stored
    // doc as null (Firestore just omits the key; `doc.field` reads undefined,
    // which every `??`/`|| null` fallback in this file already treats as null).
    export const LOT_FIELDS_V2 = [
      "origin",                  // "purchased" | "born"
      "sex",                     // "M" | "F"
      "entryCategory",           // CATTLE_CATEGORIES key
      "headcount",               // int — source of truth for lot size
      "birthDateRef",            // Date | null
      "birthDateRefIsEstimated", // bool
      "weaningDate",             // Date | null
      "firstCalvingDate",        // Date | null — stamped at lot level for homogeneous female lots
      "finishingStartDate",      // Date | null
      // propertyId already exists on lots; becomes REQUIRED starting Phase 2.
    ];
    export const ANIMAL_FIELDS_V2 = [
      "weaningDate",       // Date | null
      "finishingStartDate", // Date | null
      "firstCalvingDate",  // Date | null
      // A tagged animal is an OPTIONAL SUBSET of its lot — it NEVER adds to lot.headcount.
    ];
    export const SUPPLIER_FIELDS_V2 = [
      "municipio", // string | null
      "estado",    // UF string | null
    ];

    export const statusLabel = {
      active: "Ativo",
      sold: "Vendido",
      dead: "Morto",
    };

    // Predefined transaction categories per kind (SPEC 6.6), plus a free "outra".
    export const TX_CATEGORIES = {
      receita: [
        { value: "venda-animal", label: "Venda de animal" },
        { value: "outra", label: "Outra" },
      ],
      despesa: [
        { value: "compra-animal", label: "Compra de animal" },
        { value: "frete", label: "Frete" },
        { value: "alimentação", label: "Alimentação" },
        { value: "sanidade", label: "Sanidade" },
        { value: "mão-de-obra", label: "Mão de obra" },
        { value: "arrendamento", label: "Arrendamento" },
        { value: "depreciação", label: "Depreciação" },
        { value: "outra", label: "Outra" },
      ],
    };
    export const TX_CATEGORY_LABEL = Object.fromEntries(
      [...TX_CATEGORIES.receita, ...TX_CATEGORIES.despesa].map((c) => [c.value, c.label])
    );

    // movements.type → ledger vocabulary (aggregate lots), with the sign and
    // "gerar lançamento financeiro" defaults each type starts the form with —
    // both stay user-editable (SPEC: allow manual adjustment / opt-out).
    export const MOVEMENT_TYPES = [
      { value: "entry", label: "Entrada", defaultSign: "+", defaultFinance: true },
      { value: "birth", label: "Nascimento", defaultSign: "+", defaultFinance: false },
      { value: "transfer", label: "Transferência", defaultSign: "+", defaultFinance: false },
      { value: "adjustment", label: "Ajuste", defaultSign: "+", defaultFinance: false },
      { value: "death", label: "Morte", defaultSign: "-", defaultFinance: false },
      { value: "shipment", label: "Embarque", defaultSign: "-", defaultFinance: true },
      { value: "sale", label: "Venda", defaultSign: "-", defaultFinance: true },
      { value: "confinement_out", label: "Envio p/ confinamento", defaultSign: "-", defaultFinance: false },
      { value: "confinement_return", label: "Retorno de confinamento", defaultSign: "+", defaultFinance: false },
    ];
    export const MOVEMENT_TYPE_LABEL = Object.fromEntries(MOVEMENT_TYPES.map((t) => [t.value, t.label]));
    export const MOVEMENT_TYPE_BY_VALUE = Object.fromEntries(MOVEMENT_TYPES.map((t) => [t.value, t]));

    export const MONTH_ABBR = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
    export const WEEKDAY_ABBR = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

    // Inline icons shared by the card kebab menu and its action sheet.
    export const ICONS = {
      menu: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>`,
      sell: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
      weigh: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>`,
      wean: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v6"/><path d="M5 22c0-5 3-9 7-9s7 4 7 9"/></svg>`,
      death: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6"/><path d="M15 9l-6 6"/></svg>`,
      edit: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
      delete: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`,
      warning: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
      movement: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v18"/><path d="m3 7 4-4 4 4"/><path d="M17 21V3"/><path d="m21 17-4 4-4-4"/></svg>`,
      calving: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/></svg>`,
      finishing: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/></svg>`,
      transfer: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l4 4-4 4"/><path d="M3 7h18"/><path d="M7 21l-4-4 4-4"/><path d="M21 17H3"/></svg>`,
      history: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>`,
      print: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/></svg>`,
    };

    // lots.category (SPEC 6.3) — distinct plural vocabulary from animals.category,
    // reusing the same chip color set where the concept overlaps.
    export const lotCategoryLabel = {
      recria: "Recria",
      engorda: "Engorda",
      matrizes: "Matrizes",
      bezerros: "Bezerros",
      outro: "Outro",
    };
    export const LOT_CHIP_CLASS = {
      recria: "chip-recria",
      engorda: "chip-engorda",
      matrizes: "chip-matriz",
      bezerros: "chip-bezerro",
      outro: "chip-recria",
    };

    // Chip label/class for an animal card: the chronologically DERIVED stage
    // when there's enough data to compute one, falling back to the stored
    // (possibly legacy) category otherwise. Never writes back.
    export function animalStageLabel(animal, lot) {
      const key = displayCategoryKeyForAnimal(animal, lot);
      return key ? CATTLE_CATEGORIES[key].label : categoryLabelFor(animal.category, animal.sex);
    }
    export function animalStageChipClass(animal, lot) {
      const key = displayCategoryKeyForAnimal(animal, lot);
      return key ? (CATEGORY_CHIP_CLASS[key] || "chip-recria") : categoryChipClassFor(animal.category, animal.sex);
    }

    // Same idea for a lot card: derived stage when the lot has entryCategory
    // (Phase 2+) and enough data to compute one; legacy lots (no
    // entryCategory) fall back to the old coarse lots.category chip as before.
    export function lotStageLabel(lot) {
      const key = displayCategoryKeyForLot(lot);
      return key ? CATTLE_CATEGORIES[key].label : (lotCategoryLabel[lot.category] || lot.category || "—");
    }
    export function lotStageChipClass(lot) {
      const key = displayCategoryKeyForLot(lot);
      return key ? (CATEGORY_CHIP_CLASS[key] || "chip-recria") : (LOT_CHIP_CLASS[lot.category] || "chip-recria");
    }

