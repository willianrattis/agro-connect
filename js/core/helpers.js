import {
  CARCASS_YIELD, KG_PER_ARROBA, PASTURE_QUALITY, DEFAULT_PASTURE_QUALITY,
  DEFAULT_TARGET_ARROBAS_PER_HEAD, DEFAULT_FARM_YIELD_PCT, DEFAULT_CONFINEMENT_YIELD_PCT,
  CATTLE_CATEGORIES, FEMALE_GMD_FACTOR, CONFINEMENT_GMD_KG_PER_DAY, ICONS,
  MONTH_ABBR, WEEKDAY_ABBR, TX_CATEGORY_LABEL, resolveCategoryKey, ageMonthsBetween,
  FUNRURAL_DEFAULTS, DEFAULT_MAX_WEIGHT_MALE_KG, DEFAULT_MAX_WEIGHT_FEMALE_KG,
  displayCategoryKeyForLot,
} from "./constants.js";
import { propertiesCache, movementsCache, settingsCache, transactionsCache, animalsCache } from "./state.js";

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

    // A lot is "closed" once every head it owned is gone — no head left to
    // keep ageing/accruing tenure forever. Derived at read time from the
    // current headcount/animal roster; never written back to Firestore.
    export function lotClosure(lot) {
      if (!lot) return { isClosed: false, closedAt: null };
      const isAggregate = (lot.trackingMode || "individual") !== "individual";

      if (isAggregate) {
        const owned = (lot.headcount ?? 0) + (lot.confinedHeadcount ?? 0);
        if (owned > 0) return { isClosed: false, closedAt: null };
        // Owned balance is zero, so the most recent movement is by
        // definition the one that zeroed it out — a later movement would
        // have raised the balance back above zero.
        let closedAt = null;
        for (const m of movementsCache) {
          if (m.lotId !== lot.id) continue;
          const d = toDateSafe(m.date);
          if (d && (!closedAt || d > closedAt)) closedAt = d;
        }
        return { isClosed: true, closedAt };
      }

      const animals = animalsCache.filter((a) => a.lotId === lot.id);
      const isClosed = animals.length > 0 && animals.every((a) => (a.status || "active") !== "active");
      if (!isClosed) return { isClosed: false, closedAt: null };
      let closedAt = null;
      for (const a of animals) {
        for (const raw of [a.saleDate, a.deathDate]) {
          const d = toDateSafe(raw);
          if (d && (!closedAt || d > closedAt)) closedAt = d;
        }
      }
      return { isClosed: true, closedAt };
    }

    // Lot card meta: reference age from birthDateRef, flagged "(est.)" when
    // the stamped date is an estimate rather than a known birth date. Frozen
    // at the lot's closedAt once every head is gone, so a fully sold-out lot
    // stops ageing instead of drifting further from its actual exit age.
    export function lotAgeMetaLabel(lot, closure = lotClosure(lot)) {
      const refDate = closure.closedAt ?? new Date();
      const months = ageMonthsBetween(lot.birthDateRef, refDate);
      const duration = formatMonthsDuration(months);
      if (!duration) return "—";
      return lot.birthDateRefIsEstimated ? `${duration} (est.)` : duration;
    }

    // Lot card meta: time on the property since acquisitionDate. Once closed
    // (and a closedAt could be resolved), the duration is pinned to
    // acquisition → exit instead of acquisition → today.
    export function lotTenureMetaLabel(lot, closure = lotClosure(lot)) {
      const refDate = closure.closedAt ?? new Date();
      const months = ageMonthsBetween(lot.acquisitionDate, refDate);
      return formatMonthsDuration(months) ?? "—";
    }

    // Lot card meta chip: the absolute acquisition date(s), split out of
    // lotTenureMetaLabel() since "1 ano e 4 meses" alone is hard to anchor.
    // Null when acquisitionDate can't be resolved at all.
    export function lotDateChipLabel(lot, closure = lotClosure(lot)) {
      const acq = toDateSafe(lot.acquisitionDate);
      if (!acq) return null;
      const acqBR = acq.toLocaleDateString("pt-BR");
      if (closure.isClosed && closure.closedAt) {
        return `${acqBR} → ${closure.closedAt.toLocaleDateString("pt-BR")}`;
      }
      return `desde ${acqBR}`;
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
        maxWeightMaleKg: Number.isFinite(settingsCache.maxWeightMaleKg)
          ? settingsCache.maxWeightMaleKg
          : DEFAULT_MAX_WEIGHT_MALE_KG,
        maxWeightFemaleKg: Number.isFinite(settingsCache.maxWeightFemaleKg)
          ? settingsCache.maxWeightFemaleKg
          : DEFAULT_MAX_WEIGHT_FEMALE_KG,
      };
    }

    // Perfil-level Funrural config (settings/{uid}), mirroring getSlaughterConfig()'s
    // read-with-fallback shape — the receita rate falls back per producer type, not
    // to a single flat default.
    export function getFunruralConfig() {
      const s = settingsCache || {};
      const producerType = s.funruralProducerType || FUNRURAL_DEFAULTS.producerType;
      const regime = s.funruralRegime || FUNRURAL_DEFAULTS.regime;
      const receitaRatePct = s.funruralReceitaRatePct != null
        ? s.funruralReceitaRatePct
        : FUNRURAL_DEFAULTS.receitaRateByType[producerType];
      const folhaRatePct = s.funruralFolhaRatePct != null
        ? s.funruralFolhaRatePct : FUNRURAL_DEFAULTS.folhaRatePct;
      return { producerType, regime, receitaRatePct, folhaRatePct };
    }

    // Splits a gado sale's gross value into what's retained at source vs. the
    // net the producer actually receives. Only PJ buyers retain (frigoríficos
    // withhold Funrural at source); PF buyers and the folha regime pass the
    // gross through untouched — the producer collects Funrural separately.
    export function applyFunruralRetention(grossBRL, buyerType) {
      const fun = getFunruralConfig();
      const applies = fun.regime === "receita" && buyerType === "pj"
        && Number.isFinite(grossBRL) && grossBRL > 0;
      if (!applies) return { grossBRL, funruralRetidoBRL: 0, netBRL: grossBRL };
      const retido = Math.round(grossBRL * (fun.receitaRatePct / 100) * 100) / 100;
      return { grossBRL, funruralRetidoBRL: retido,
               netBRL: Math.round((grossBRL - retido) * 100) / 100 };
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

    // Legacy lots predate the `sex` field, so fall back to the category
    // taxonomy's sex, then default to male.
    export function resolveLotSex(lot) {
      return lot.sex ?? CATTLE_CATEGORIES[resolveCategoryKey(lot.entryCategory, null)]?.sex ?? "M";
    }

    // Mature-weight ceiling for a lot's projection: lot override → Perfil
    // default (by sex) → hardcoded constant.
    export function resolveLotMaxWeightKg(lot) {
      if (Number.isFinite(lot.maxWeightKg)) return lot.maxWeightKg;
      const cfg = getSlaughterConfig();
      return resolveLotSex(lot) === "F" ? cfg.maxWeightFemaleKg : cfg.maxWeightMaleKg;
    }

    // Projects a lot's on-farm weight/@ from its farm anchor using the
    // property's pasture-quality GMD (Embrapa averages), reduced for females
    // (they gain slower than the male-referenced Embrapa figures) —
    // read-time only, never persisted. The projected weight is capped at the
    // lot's mature-weight ceiling (never below the base weight, so a lot
    // that's already past its cap keeps its base weight, flagged isCapped).
    export function lotWeightProjection(lot) {
      const { baseWeightKg, baseDate } = lotProjectionAnchors(lot).farm;
      if (!Number.isFinite(baseWeightKg) || baseWeightKg <= 0) return null;
      if (!baseDate) return null;

      const days = Math.max(0, Math.floor((Date.now() - baseDate.getTime()) / 86_400_000));
      const qualityKey = resolveLotPastureQualityKey(lot);
      const { label: qualityLabel, gmdKgPerDay: baseGmdKgPerDay } = PASTURE_QUALITY[qualityKey];

      const isFemale = resolveLotSex(lot) === "F";
      const gmdKgPerDay = isFemale ? baseGmdKgPerDay * FEMALE_GMD_FACTOR : baseGmdKgPerDay;

      const rawProjectedWeightKg = baseWeightKg + days * gmdKgPerDay;
      const maxWeightKg = resolveLotMaxWeightKg(lot);
      const isCapped = Number.isFinite(maxWeightKg) && rawProjectedWeightKg > maxWeightKg;
      const projectedWeightKg = isCapped ? Math.max(maxWeightKg, baseWeightKg) : rawProjectedWeightKg;
      const gainKg = projectedWeightKg - baseWeightKg;
      const yieldPct = resolveFarmYieldPct(lot);
      const projectedTotalArrobas = (lot.headcount ?? 0) * ((projectedWeightKg * yieldPct) / KG_PER_ARROBA);

      return {
        days, qualityKey, qualityLabel, baseGmdKgPerDay, gmdKgPerDay, isFemale,
        projectedWeightKg, gainKg, projectedTotalArrobas, maxWeightKg, isCapped,
      };
    }

    // Feedlot day-counter + weight projection for a lot's confined head,
    // from the confined anchor — read-time only, never persisted. Null when
    // the lot holds no confined head, or none of its movements is a
    // confinement_out (so there's no anchor to project from). Same
    // mature-weight cap as lotWeightProjection.
    export function lotConfinedProjection(lot) {
      if (!((lot.confinedHeadcount ?? 0) > 0)) return null;
      const { confined } = lotProjectionAnchors(lot);
      if (!confined || !Number.isFinite(confined.baseWeightKg) || confined.baseWeightKg <= 0) return null;

      const days = Math.max(0, Math.floor((Date.now() - confined.baseDate.getTime()) / 86_400_000));
      const rawProjectedWeightKg = confined.baseWeightKg + days * CONFINEMENT_GMD_KG_PER_DAY;
      const maxWeightKg = resolveLotMaxWeightKg(lot);
      const isCapped = Number.isFinite(maxWeightKg) && rawProjectedWeightKg > maxWeightKg;
      const projectedWeightKg = isCapped ? Math.max(maxWeightKg, confined.baseWeightKg) : rawProjectedWeightKg;
      return { days, projectedWeightKg, confinementName: confined.confinementName, maxWeightKg, isCapped };
    }

    // Per-lot target @/head — lot override → Perfil default.
    export function resolveLotTargetArrobas(lot) {
      return Number.isFinite(lot.targetArrobas) ? lot.targetArrobas : getSlaughterConfig().targetArrobasPerHead;
    }

    // Arrobas/head the lot carried out the door at closure — from the
    // closing movement's recorded weight (aggregate) or the sold animals'
    // recorded saleArrobas (individual). Used only to decide whether a
    // closed male lot should display as "boi gordo"; null when unresolvable.
    function exitArrobasPerHead(lot) {
      const isAggregate = (lot.trackingMode || "individual") !== "individual";
      if (isAggregate) {
        let closingMovement = null;
        let closingDate = null;
        for (const m of movementsCache) {
          if (m.lotId !== lot.id) continue;
          const d = toDateSafe(m.date);
          if (d && (!closingDate || d > closingDate)) { closingDate = d; closingMovement = m; }
        }
        if (!closingMovement) return null;
        if (closingMovement.type !== "sale" && closingMovement.type !== "shipment") return null;
        if (!Number.isFinite(closingMovement.avgWeightKg)) return null;
        const yieldFraction = Number.isFinite(closingMovement.carcassYieldPct)
          ? closingMovement.carcassYieldPct / 100
          : resolveFarmYieldPct(lot);
        return (closingMovement.avgWeightKg * yieldFraction) / KG_PER_ARROBA;
      }

      const arrobas = animalsCache
        .filter((a) => a.lotId === lot.id)
        .map((a) => a.saleArrobas)
        .filter((n) => Number.isFinite(n));
      if (arrobas.length === 0) return null;
      return arrobas.reduce((sum, n) => sum + n, 0) / arrobas.length;
    }

    // Chronologically-derived stage for a lot card, promoted to "boi gordo"
    // at closure when the age/weight it exited at already qualifies — a lot
    // sold at 23 months shouldn't freeze on "boi magro" forever just because
    // it closed a month short of the age threshold. Age is evaluated as of
    // closedAt (not today), matching the frozen labels above.
    export function lotDisplayStageKey(lot, closure = lotClosure(lot)) {
      const refDate = closure.closedAt ?? new Date();
      const baseKey = displayCategoryKeyForLot(lot, refDate);
      if (!closure.isClosed || lot.sex !== "M" || !baseKey || baseKey === "boi_gordo") return baseKey;

      const ageMonths = ageMonthsBetween(lot.birthDateRef, closure.closedAt);
      if (Number.isFinite(ageMonths) && ageMonths >= 24) return "boi_gordo";

      const arrobasPerHead = exitArrobasPerHead(lot);
      if (Number.isFinite(arrobasPerHead) && arrobasPerHead >= resolveLotTargetArrobas(lot)) return "boi_gordo";

      return baseKey;
    }

    // Estimated ready-for-sale date from a weight projection: how many days
    // until the projected weight reaches the target @ at the given yield,
    // read-time only. Returns null when any input is missing/non-positive.
    // When the target requires more live weight than the lot's mature-weight
    // cap, the goal is unreachable — reported distinctly from "still growing".
    export function slaughterForecast({ projectedWeightKg, gmdKgPerDay, targetArrobas, yieldPct, maxWeightKg }) {
      if (!Number.isFinite(projectedWeightKg) || !Number.isFinite(gmdKgPerDay) || gmdKgPerDay <= 0) return null;
      if (!Number.isFinite(targetArrobas) || targetArrobas <= 0) return null;
      if (!Number.isFinite(yieldPct) || yieldPct <= 0) return null;

      const targetLiveWeightKg = (targetArrobas * KG_PER_ARROBA) / yieldPct;
      const isReady = projectedWeightKg >= targetLiveWeightKg;

      if (!isReady && Number.isFinite(maxWeightKg) && targetLiveWeightKg > maxWeightKg) {
        return {
          daysRemaining: null, isReady: false, unreachable: true, date: null,
          label: `Meta não alcançável: limite de ${formatKg(maxWeightKg)} kg`,
        };
      }

      const daysRemaining = Math.ceil((targetLiveWeightKg - projectedWeightKg) / gmdKgPerDay);
      const date = isReady ? null : new Date(Date.now() + daysRemaining * 86_400_000);

      let label;
      if (isReady) {
        label = "Pronto para venda";
      } else if (daysRemaining < 45) {
        label = `Previsão: ${date.toLocaleDateString("pt-BR")} · em ${daysRemaining.toLocaleString("pt-BR")} dias`;
      } else {
        const months = Math.round(daysRemaining / 30.44);
        label = `Previsão: ${date.toLocaleDateString("pt-BR")} · em ~${months.toLocaleString("pt-BR")} meses`;
      }

      return { daysRemaining, isReady, unreachable: false, date, label };
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

    export function fmtNum(n, decimals = 0) {
      return n.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
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
      return `${WEEKDAY_ABBR[date.getDay()]}, ${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
    }

    export function categoryDisplayLabel(category) {
      return TX_CATEGORY_LABEL[category] || category;
    }

    // =====================================================
