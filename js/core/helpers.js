import {
  CARCASS_YIELD, KG_PER_ARROBA, PASTURE_QUALITY, DEFAULT_PASTURE_QUALITY,
  DEFAULT_TARGET_ARROBAS_PER_HEAD, DEFAULT_FARM_YIELD_PCT, DEFAULT_CONFINEMENT_YIELD_PCT,
  CATTLE_CATEGORIES, FEMALE_GMD_FACTOR, CONFINEMENT_GMD_KG_PER_DAY, ICONS,
  MONTH_ABBR, WEEKDAY_ABBR, TX_CATEGORY_LABEL, resolveCategoryKey, ageMonthsBetween,
} from "./constants.js";
import { propertiesCache, movementsCache, settingsCache, transactionsCache } from "./state.js";

    // =====================================================
    // 3. Helpers
    // =====================================================
    export function escapeHtml(str) {
      return String(str ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
      }[c]));
    }

    // Firestore Timestamp | Date | date-string → Date, or null.
    export function toDateSafe(value) {
      if (!value) return null;
      if (typeof value.toDate === "function") return value.toDate();
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    }

    // Date | Timestamp | null → "YYYY-MM-DD" for prefilling <input type="date">.
    export function toDateInputValue(value) {
      const d = toDateSafe(value);
      if (!d) return "";
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }

    // Always derived from purchaseDate/birthDate — never from weight records.
    export function daysOnFarm(animal) {
      const ref = animal.acquisitionType === "purchased" ? animal.purchaseDate : animal.birthDate;
      const d = toDateSafe(ref);
      if (!d) return null;
      const ms = Date.now() - d.getTime();
      return Math.max(0, Math.round(ms / 86_400_000));
    }

    export function totalArrobas(animals) {
      const kg = animals.reduce((sum, a) => sum + (a.currentWeightKg || 0), 0);
      return (kg * CARCASS_YIELD) / KG_PER_ARROBA;
    }

    // pt-BR display helpers: kg as whole numbers, @ (arroba) with 1 decimal.
    export function formatKg(n) {
      return Math.round(n).toLocaleString("pt-BR");
    }
    export function formatArrobas(n) {
      return n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    }
    // Prints arbitrary HTML without involving the <dialog> — elements in the
    // top layer print inconsistently across engines, so content is mirrored
    // into a plain body-level container instead.
    export function printHTML(html) {
      const area = document.getElementById("print-area");
      if (!area) return;
      area.innerHTML = html;
      const cleanup = () => {
        area.innerHTML = "";
        window.removeEventListener("afterprint", cleanup);
      };
      window.addEventListener("afterprint", cleanup);
      window.print();
    }
    // pt-BR percent with 1 decimal, trailing ",0" trimmed (13.5 → "13,5", 10 → "10").
    export function formatPercentTrim(n) {
      return n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
    }
    // Yield fraction (0.53) → plain 1-decimal percent number for number-input
    // value/placeholder attributes (53, not a pt-BR locale string with a comma).
    export function fractionToPercentDisplay(fraction) {
      return Math.round(fraction * 1000) / 10;
    }

    // pt-BR duration phrase for a whole month count: "X meses" under a year,
    // "X anos" or "X anos e Y meses" at 12+.
    export function formatMonthsDuration(totalMonths) {
      if (totalMonths == null || !Number.isFinite(totalMonths)) return null;
      const months = Math.max(0, Math.round(totalMonths));
      if (months < 12) return `${months} ${months === 1 ? "mês" : "meses"}`;
      const years = Math.floor(months / 12);
      const rem = months % 12;
      const yearsLabel = `${years} ${years === 1 ? "ano" : "anos"}`;
      return rem === 0 ? yearsLabel : `${yearsLabel} e ${rem} ${rem === 1 ? "mês" : "meses"}`;
    }

    // Lot card meta: reference age from birthDateRef, flagged "(est.)" when
    // the stamped date is an estimate rather than a known birth date.
    export function lotAgeMetaLabel(lot) {
      const months = ageMonthsBetween(lot.birthDateRef, new Date());
      const duration = formatMonthsDuration(months);
      if (!duration) return "—";
      return lot.birthDateRefIsEstimated ? `${duration} (est.)` : duration;
    }

    // Lot card meta: time on the property since acquisitionDate, with the
    // absolute date alongside since "1 ano e 4 meses" alone is hard to anchor.
    export function lotTenureMetaLabel(lot) {
      const months = ageMonthsBetween(lot.acquisitionDate, new Date());
      const duration = formatMonthsDuration(months);
      if (!duration) return "—";
      const d = toDateSafe(lot.acquisitionDate);
      return d ? `${duration} (desde ${d.toLocaleDateString("pt-BR")})` : duration;
    }

    // Resolves a lot's pasture quality key, falling back to the default
    // when the lot has no property, the property is missing from cache,
    // or its pastureQuality value isn't a known PASTURE_QUALITY key.
    export function resolveLotPastureQualityKey(lot) {
      const property = lot?.propertyId ? propertiesCache.find((p) => p.id === lot.propertyId) : null;
      const key = property?.pastureQuality;
      return key && Object.prototype.hasOwnProperty.call(PASTURE_QUALITY, key) ? key : DEFAULT_PASTURE_QUALITY;
    }

    // A movement's effect on the lot's two balances (on-farm headcount vs.
    // confined headcount) — shared by the ledger replay and the submit-time
    // counter update, so the two can never drift apart.
    export function movementDeltas(m) {
      const magnitude = Math.abs(m.qty || 0);
      if (m.type === "confinement_out") return { farmDelta: -magnitude, confinedDelta: magnitude };
      if (m.type === "confinement_return") return { farmDelta: magnitude, confinedDelta: -magnitude };
      if (m.fromConfinement) return { farmDelta: 0, confinedDelta: -magnitude };
      return { farmDelta: m.qty || 0, confinedDelta: 0 };
    }

    // Each location (farm pasture / feedlot) has its own weight-projection
    // anchor: a base weight + base date the GMD is applied from. Leaving a
    // location freezes that location's projection for the animals that left;
    // entering the other re-anchors it. One anchor per location, most-recent
    // movement wins — no per-batch cohort tracking.
    //
    // Confined anchor: the most recent confinement_out movement's shipping
    // weight/date. That weight is user-editable (e.g. once the feedlot
    // reports the post-transport arrival weight), so the projection
    // automatically re-bases when it's updated.
    //
    // Farm anchor: the most recent confinement_return movement with a
    // recorded weight; absent that (never confined, or still out), falls
    // back to the lot's stored avgWeightKg/acquisitionDate — identical to
    // this function's pre-confinement behavior.
    export function lotProjectionAnchors(lot) {
      const movements = movementsCache.filter((m) => m.lotId === lot.id);

      const outs = movements
        .filter((m) => m.type === "confinement_out")
        .map((m) => ({ ...m, _date: toDateSafe(m.date) }))
        .filter((m) => m._date)
        .sort((a, b) => b._date - a._date);
      const latestOut = outs[0] ?? null;

      const returns = movements
        .filter((m) => m.type === "confinement_return" && Number.isFinite(m.avgWeightKg))
        .map((m) => ({ ...m, _date: toDateSafe(m.date) }))
        .filter((m) => m._date)
        .sort((a, b) => b._date - a._date);
      const latestReturn = returns[0] ?? null;

      // Farm anchor: most-recent-wins between a confinement return and a
      // manual lot weighing ("Pesar lote") — whichever happened last is the
      // freshest known weight/date pair to project from.
      const candidates = [];
      if (latestReturn) {
        candidates.push({ baseWeightKg: latestReturn.avgWeightKg, baseDate: latestReturn._date });
      }
      const lastWeighingDate = toDateSafe(lot.lastWeighingDate);
      if (lastWeighingDate && Number.isFinite(lot.avgWeightKg)) {
        candidates.push({ baseWeightKg: lot.avgWeightKg, baseDate: lastWeighingDate });
      }
      const farm = candidates.length
        ? candidates.sort((a, b) => b.baseDate - a.baseDate)[0]
        : { baseWeightKg: lot.avgWeightKg, baseDate: toDateSafe(lot.acquisitionDate) };

      return {
        confined: latestOut
          ? {
              baseWeightKg: Number.isFinite(latestOut.avgWeightKg) ? latestOut.avgWeightKg : lot.avgWeightKg,
              baseDate: latestOut._date,
              confinementName: latestOut.confinementName || "—",
            }
          : null,
        farm,
      };
    }

    // Perfil-level targets/yields (settings/{uid}), each with its own
    // hardcoded fallback so the feature works before the settings doc has
    // ever been saved.
    export function getSlaughterConfig() {
      return {
        targetArrobasPerHead: Number.isFinite(settingsCache.targetArrobasPerHead)
          ? settingsCache.targetArrobasPerHead
          : DEFAULT_TARGET_ARROBAS_PER_HEAD,
        defaultFarmYieldPct: Number.isFinite(settingsCache.defaultFarmYieldPct)
          ? settingsCache.defaultFarmYieldPct
          : DEFAULT_FARM_YIELD_PCT,
        defaultConfinementYieldPct: Number.isFinite(settingsCache.defaultConfinementYieldPct)
          ? settingsCache.defaultConfinementYieldPct
          : DEFAULT_CONFINEMENT_YIELD_PCT,
      };
    }

    // Farm-side carcass yield: lot override → Perfil default → CARCASS_YIELD.
    export function resolveFarmYieldPct(lot) {
      if (Number.isFinite(lot.carcassYieldPct)) return lot.carcassYieldPct;
      return getSlaughterConfig().defaultFarmYieldPct;
    }

    // Confined-side carcass yield: lot override → Perfil default → CARCASS_YIELD.
    export function resolveConfinementYieldPct(lot) {
      if (Number.isFinite(lot.confinementYieldPct)) return lot.confinementYieldPct;
      return getSlaughterConfig().defaultConfinementYieldPct;
    }

    // Projects a lot's on-farm weight/@ from its farm anchor using the
    // property's pasture-quality GMD (Embrapa averages), reduced for females
    // (they gain slower than the male-referenced Embrapa figures) —
    // read-time only, never persisted.
    export function lotWeightProjection(lot) {
      const { baseWeightKg, baseDate } = lotProjectionAnchors(lot).farm;
      if (!Number.isFinite(baseWeightKg) || baseWeightKg <= 0) return null;
      if (!baseDate) return null;

      const days = Math.max(0, Math.floor((Date.now() - baseDate.getTime()) / 86_400_000));
      const qualityKey = resolveLotPastureQualityKey(lot);
      const { label: qualityLabel, gmdKgPerDay: baseGmdKgPerDay } = PASTURE_QUALITY[qualityKey];

      // Legacy lots predate the `sex` field, so fall back to the category
      // taxonomy's sex, then default to male.
      const sex = lot.sex ?? CATTLE_CATEGORIES[resolveCategoryKey(lot.entryCategory, null)]?.sex ?? "M";
      const isFemale = sex === "F";
      const gmdKgPerDay = isFemale ? baseGmdKgPerDay * FEMALE_GMD_FACTOR : baseGmdKgPerDay;

      const gainKg = days * gmdKgPerDay;
      const projectedWeightKg = baseWeightKg + gainKg;
      const yieldPct = resolveFarmYieldPct(lot);
      const projectedTotalArrobas = (lot.headcount ?? 0) * ((projectedWeightKg * yieldPct) / KG_PER_ARROBA);

      return { days, qualityKey, qualityLabel, baseGmdKgPerDay, gmdKgPerDay, isFemale, projectedWeightKg, gainKg, projectedTotalArrobas };
    }

    // Feedlot day-counter + weight projection for a lot's confined head,
    // from the confined anchor — read-time only, never persisted. Null when
    // the lot holds no confined head, or none of its movements is a
    // confinement_out (so there's no anchor to project from).
    export function lotConfinedProjection(lot) {
      if (!((lot.confinedHeadcount ?? 0) > 0)) return null;
      const { confined } = lotProjectionAnchors(lot);
      if (!confined || !Number.isFinite(confined.baseWeightKg) || confined.baseWeightKg <= 0) return null;

      const days = Math.max(0, Math.floor((Date.now() - confined.baseDate.getTime()) / 86_400_000));
      const projectedWeightKg = confined.baseWeightKg + days * CONFINEMENT_GMD_KG_PER_DAY;
      return { days, projectedWeightKg, confinementName: confined.confinementName };
    }

    // Tinted single-line strip summarizing a lot's confined head — shared by
    // the lot card and the lot detail sheet. Returns "" when the lot holds
    // no confined head.
    export function confinementStripHTML(lot) {
      const confinedHeadcount = lot.confinedHeadcount ?? 0;
      if (confinedHeadcount <= 0) return "";
      const projection = lotConfinedProjection(lot);
      const parts = [`<strong>${confinedHeadcount} no confinamento</strong>`];
      if (projection) {
        const gmd = CONFINEMENT_GMD_KG_PER_DAY.toLocaleString("pt-BR", { minimumFractionDigits: 1 });
        parts.push(escapeHtml(projection.confinementName));
        parts.push(`${projection.days.toLocaleString("pt-BR")} dias`);
        parts.push(`peso est. ${formatKg(projection.projectedWeightKg)} kg (+${gmd} kg/dia)`);
      }
      return `
        <div class="confinement-strip">
          ${ICONS.transfer}
          <span>${parts.join(" · ")}</span>
        </div>
      `;
    }

    // pt-BR currency mask: keeps digits only, formats as R$ on every keystroke.
    export function formatCurrencyInput(input) {
      const digits = input.value.replace(/\D/g, "");
      if (!digits) { input.value = ""; return; }
      const amount = parseInt(digits, 10) / 100;
      input.value = amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    }

    export function parseBRLToNumber(str) {
      const digits = String(str || "").replace(/\D/g, "");
      if (!digits) return NaN;
      return parseInt(digits, 10) / 100;
    }

    export function formatBRL(n) {
      return (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    }

    // Brazilian document/phone masks: strip to raw chars, then reformat on
    // every keystroke — same approach as formatCurrencyInput above.
    export function formatCPFInput(input) {
      const digits = input.value.replace(/\D/g, "").slice(0, 11);
      let out = digits.slice(0, 3);
      if (digits.length > 3) out += "." + digits.slice(3, 6);
      if (digits.length > 6) out += "." + digits.slice(6, 9);
      if (digits.length > 9) out += "-" + digits.slice(9, 11);
      input.value = out;
    }

    export function formatCNPJNumericInput(input) {
      const digits = input.value.replace(/\D/g, "").slice(0, 14);
      let out = digits.slice(0, 2);
      if (digits.length > 2) out += "." + digits.slice(2, 5);
      if (digits.length > 5) out += "." + digits.slice(5, 8);
      if (digits.length > 8) out += "/" + digits.slice(8, 12);
      if (digits.length > 12) out += "-" + digits.slice(12, 14);
      input.value = out;
    }

    // Alphanumeric CNPJ (Receita Federal's newer format): first 12 chars are
    // A–Z/0–9, the last 2 (check digits) stay numeric.
    // TODO: check-digit validation — not implemented, only shape/length.
    export function formatCNPJAlnumInput(input) {
      const raw = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 14);
      const chars = raw.slice(0, 12) + raw.slice(12, 14).replace(/\D/g, "");
      let out = chars.slice(0, 2);
      if (chars.length > 2) out += "." + chars.slice(2, 5);
      if (chars.length > 5) out += "." + chars.slice(5, 8);
      if (chars.length > 8) out += "/" + chars.slice(8, 12);
      if (chars.length > 12) out += "-" + chars.slice(12, 14);
      input.value = out;
    }

    // UF: 2 letters, uppercased as typed.
    export function formatUFInput(input) {
      input.value = input.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
    }

    // Auto-detects landline (10 digits) vs. mobile (11 digits) as the user
    // types, rather than requiring an explicit toggle.
    export function formatPhoneInput(input) {
      const digits = input.value.replace(/\D/g, "").slice(0, 11);
      if (!digits) { input.value = ""; return; }
      let out = "(" + digits.slice(0, 2);
      if (digits.length >= 2) out += ") ";
      if (digits.length > 2) {
        if (digits.length <= 10) {
          out += digits.slice(2, 6);
          if (digits.length > 6) out += "-" + digits.slice(6, 10);
        } else {
          out += digits.slice(2, 3) + " " + digits.slice(3, 7) + "-" + digits.slice(7, 11);
        }
      }
      input.value = out;
    }

    // Days between purchaseDate|birthDate and saleDate — the sold-animal
    // counterpart of daysOnFarm(), which measures against "now" instead.
    export function saleDaysHeld(animal) {
      const startRef = animal.acquisitionType === "purchased" ? animal.purchaseDate : animal.birthDate;
      const start = toDateSafe(startRef);
      const end = toDateSafe(animal.saleDate);
      if (!start || !end) return null;
      return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000));
    }

    // profit = saleRevenueBRL − purchaseCostBRL − despesas linked to this animal.
    export function computeSaleResult(animal, transactions) {
      if (animal.status !== "sold" || animal.saleRevenueBRL == null) return null;
      const days = saleDaysHeld(animal);
      if (days == null) return null;
      const linkedDespesas = transactions
        .filter((t) => t.linkedAnimalId === animal.id && t.kind === "despesa")
        .reduce((sum, t) => sum + (t.amountBRL || 0), 0);
      const profit = animal.saleRevenueBRL - (animal.purchaseCostBRL || 0) - linkedDespesas;
      const dailyProfit = days > 0 ? profit / days : profit;
      return { days, profit, dailyProfit };
    }

    export function monthKey(date) {
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    }

    export function monthChipLabel(key) {
      const [y, m] = key.split("-").map(Number);
      return `${MONTH_ABBR[m - 1]}/${String(y).slice(2)}`;
    }

    // Trailing N months ending at the current month, oldest first.
    export function buildRecentMonthKeys(count) {
      const now = new Date();
      const keys = [];
      for (let i = count - 1; i >= 0; i--) {
        keys.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
      }
      return keys;
    }

    // Calendar years spanning from the earliest transaction on record through
    // the current year, ascending — so retroactive entries always have a
    // reachable year in the stepper.
    export function getAvailableYears() {
      const cy = new Date().getFullYear();
      let earliest = cy;
      for (const t of transactionsCache) {
        const d = toDateSafe(t.date);
        if (d && d.getFullYear() < earliest) earliest = d.getFullYear();
      }
      const years = [];
      for (let y = earliest; y <= cy; y++) years.push(y);
      return years;
    }

    export function formatDayLabel(date) {
      return `${WEEKDAY_ABBR[date.getDay()]}, ${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
    }

    export function categoryDisplayLabel(category) {
      return TX_CATEGORY_LABEL[category] || category;
    }

    // =====================================================
