import { ICONS, MOVEMENT_TYPE_LABEL, ageMonthsBetween, displayCategoryKeyForAnimal, displayCategoryKeyForLot } from "../../js/core/constants.js";
import {
  homeStatHeadEl, homeStatArrobasEl, homeStatSaldoEl, homeAlertsListEl, homeActivityListEl,
} from "../../js/core/dom.js";
import {
  escapeHtml, formatArrobas, formatBRL, formatDayLabel, toDateSafe, categoryDisplayLabel,
  lotClosure, lotWeightProjection, resolveLotTargetArrobas, resolveFarmYieldPct, slaughterForecast,
} from "../../js/core/helpers.js";
import { lotsCache, animalsCache, transactionsCache, movementsCache, eventsCache } from "../../js/core/state.js";
import { herdTotals } from "../rebanho/render.js";
import { openLotDetailSheet } from "../rebanho/lots.js";
import { openAnimalDetailSheet } from "../rebanho/animals.js";

    // =====================================================
    // Home (feed inicial) — reads the in-memory caches directly, no new
    // Firestore queries. Safe to call at any time (before/without data):
    // every cache defaults to [], every lookup falls back to "—".
    // =====================================================

    // --- A. Hero KPIs ---
    function renderHomeHero() {
      const { head, arrobas } = herdTotals();
      homeStatHeadEl.textContent = String(head);
      homeStatArrobasEl.innerHTML = `${formatArrobas(arrobas)} <small>@</small>`;

      // All-time saldo, deliberately unscoped by any period — differs from
      // Financeiro's saldo whenever a month/year filter is active there.
      const saldo = transactionsCache.reduce((acc, t) => {
        if (t.kind === "receita") return acc + (t.amountBRL || 0);
        if (t.kind === "despesa") return acc - (t.amountBRL || 0);
        return acc;
      }, 0);
      homeStatSaldoEl.textContent = formatBRL(saldo);
      homeStatSaldoEl.classList.toggle("fin-positive", saldo > 0);
      homeStatSaldoEl.classList.toggle("fin-negative", saldo < 0);
    }

    // --- B. Alertas ---
    // Farm-side slaughter forecast, using the exact same inputs render.js's
    // lot card already computes — never duplicated math, just re-run here.
    function buildSlaughterAlerts() {
      const alerts = [];
      for (const lot of lotsCache) {
        if (lotClosure(lot).isClosed) continue;
        const headcount = lot.headcount ?? 0;
        if (headcount <= 0) continue;
        const projection = lotWeightProjection(lot);
        if (!projection) continue;
        const forecast = slaughterForecast({
          projectedWeightKg: projection.projectedWeightKg,
          gmdKgPerDay: projection.gmdKgPerDay,
          targetArrobas: resolveLotTargetArrobas(lot),
          yieldPct: resolveFarmYieldPct(lot),
          maxWeightKg: projection.maxWeightKg,
        });
        if (!forecast) continue;
        if (forecast.isReady) {
          alerts.push({ rank: 0, kind: "ready", target: "lot", lot, forecast });
        } else if (forecast.unreachable) {
          alerts.push({ rank: 3, kind: "unreachable", target: "lot", lot, forecast });
        } else if (forecast.daysRemaining <= 45) {
          alerts.push({ rank: 2, kind: "soon", target: "lot", lot, forecast });
        }
      }
      return alerts;
    }

    // Weaning threshold in deriveStage() is 8 months — this fires the
    // window just before that auto-promotion (7 to just-under-8 months)
    // when no weaning has actually been recorded yet.
    function buildWeaningAlerts() {
      const alerts = [];
      const now = new Date();
      for (const lot of lotsCache) {
        if (lotClosure(lot).isClosed) continue;
        const isAggregate = (lot.trackingMode || "individual") === "aggregate";

        if (isAggregate) {
          if (lot.weaningDate || !lot.birthDateRef) continue;
          const stageKey = displayCategoryKeyForLot(lot, now);
          if (stageKey !== "bezerro_lactente" && stageKey !== "bezerra_lactente") continue;
          const ageMonths = ageMonthsBetween(lot.birthDateRef, now);
          if (!Number.isFinite(ageMonths) || ageMonths < 7) continue;
          alerts.push({ rank: 1, kind: "weaning", target: "lot", lot, ageMonths });
          continue;
        }

        const animals = animalsCache.filter((a) => a.lotId === lot.id && (a.status || "active") === "active");
        for (const animal of animals) {
          if (animal.weaningDate) continue;
          const birthDate = animal.birthDate ?? lot.birthDateRef;
          if (!birthDate) continue;
          const stageKey = displayCategoryKeyForAnimal(animal, lot);
          if (stageKey !== "bezerro_lactente" && stageKey !== "bezerra_lactente") continue;
          const ageMonths = ageMonthsBetween(birthDate, now);
          if (!Number.isFinite(ageMonths) || ageMonths < 7) continue;
          alerts.push({ rank: 1, kind: "weaning", target: "animal", lot, animal, ageMonths });
        }
      }
      return alerts;
    }

    const ALERT_META = {
      ready:       { icon: ICONS.sell,    tint: "home-alert-ready",       title: "Pronto para venda" },
      soon:        { icon: ICONS.weigh,   tint: "home-alert-soon",        title: "Próximo do abate" },
      weaning:     { icon: ICONS.wean,    tint: "home-alert-weaning",     title: "Próximo do desmame" },
      unreachable: { icon: ICONS.warning, tint: "home-alert-unreachable", title: "Meta inalcançável" },
    };

    function alertSubtitle(a) {
      if (a.kind === "ready") return a.lot.name;
      if (a.kind === "soon" || a.kind === "unreachable") return `${a.lot.name} · ${a.forecast.label}`;
      const months = Math.floor(a.ageMonths);
      const monthsLabel = `${months} ${months === 1 ? "mês" : "meses"}`;
      return a.target === "animal"
        ? `${a.lot.name} · #${a.animal.earTag} · ${monthsLabel}`
        : `${a.lot.name} · ${monthsLabel}`;
    }

    const MAX_ALERT_CARDS = 8;

    function renderAlertCard(a, i) {
      const meta = ALERT_META[a.kind];
      const id = a.target === "lot" ? a.lot.id : a.animal.id;
      const subtitle = alertSubtitle(a);
      const ariaLabel = `${meta.title}: ${subtitle}`;
      return `
        <li class="card home-alert-card ${meta.tint} enter pressable" style="--i: ${i}"
            data-alert-target="${a.target}" data-alert-id="${escapeHtml(id)}"
            tabindex="0" role="button" aria-label="${escapeHtml(ariaLabel)}">
          <span class="home-alert-icon" aria-hidden="true">${meta.icon}</span>
          <div class="home-alert-body">
            <p class="home-alert-title">${escapeHtml(meta.title)}</p>
            <p class="home-alert-subtitle">${escapeHtml(subtitle)}</p>
          </div>
        </li>
      `;
    }

    function renderHomeAlerts() {
      const alerts = [...buildSlaughterAlerts(), ...buildWeaningAlerts()].sort((a, b) => a.rank - b.rank);

      if (alerts.length === 0) {
        homeAlertsListEl.innerHTML = `
          <li>
            <div class="empty-state">
              <span class="icon" aria-hidden="true">${ICONS.tag}</span>
              <p>Tudo em dia — nenhum aviso no momento.</p>
            </div>
          </li>
        `;
        return;
      }

      const shown = alerts.slice(0, MAX_ALERT_CARDS);
      const extra = alerts.length - shown.length;
      homeAlertsListEl.innerHTML = shown.map(renderAlertCard).join("")
        + (extra > 0 ? `<li class="home-alert-more">+${extra} outros avisos</li>` : "");
    }

    function handleAlertActivate(e) {
      const card = e.target.closest("li[data-alert-target]");
      if (!card) return;
      const id = card.dataset.alertId;
      if (card.dataset.alertTarget === "lot") {
        const lot = lotsCache.find((l) => l.id === id);
        if (lot) openLotDetailSheet(lot);
      } else {
        const animal = animalsCache.find((a) => a.id === id);
        if (animal) openAnimalDetailSheet(animal);
      }
    }
    homeAlertsListEl.addEventListener("click", handleAlertActivate);
    homeAlertsListEl.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (!e.target.closest("li[data-alert-target]")) return;
      e.preventDefault();
      handleAlertActivate(e);
    });

    // --- C. Atividade recente ---
    const EVENT_TYPE_LABEL = {
      weaning: "Desmama",
      calving: "Parto",
      finishing: "Início de terminação",
      death: "Óbito",
      weighing: "Pesagem",
      sale: "Venda",
    };
    const EVENT_TYPE_ICON = {
      weaning: ICONS.wean,
      calving: ICONS.calving,
      finishing: ICONS.finishing,
      death: ICONS.death,
      weighing: ICONS.weigh,
      sale: ICONS.sell,
    };

    const MAX_ACTIVITY_ROWS = 6;

    function buildActivityItems() {
      const items = [];
      for (const t of transactionsCache) {
        const date = toDateSafe(t.date);
        if (date) items.push({ date, kind: "transaction", data: t });
      }
      for (const m of movementsCache) {
        const date = toDateSafe(m.date);
        if (date) items.push({ date, kind: "movement", data: m });
      }
      for (const ev of eventsCache) {
        const date = toDateSafe(ev.date);
        if (date) items.push({ date, kind: "event", data: ev });
      }
      items.sort((a, b) => b.date - a.date);
      return items.slice(0, MAX_ACTIVITY_ROWS);
    }

    function renderActivityRow({ kind, data, date }, i) {
      let icon, label, context;
      if (kind === "transaction") {
        icon = ICONS.sell;
        label = categoryDisplayLabel(data.category);
        const sign = data.kind === "receita" ? "+" : "−";
        context = `${sign} ${formatBRL(Math.abs(data.amountBRL || 0))}`;
      } else if (kind === "movement") {
        const lot = lotsCache.find((l) => l.id === data.lotId);
        icon = ICONS.movement;
        label = MOVEMENT_TYPE_LABEL[data.type] || data.type;
        context = lot ? `${lot.name} · ${Math.abs(data.qty || 0)} cab.` : `${Math.abs(data.qty || 0)} cab.`;
      } else {
        icon = EVENT_TYPE_ICON[data.type] || ICONS.history;
        label = EVENT_TYPE_LABEL[data.type] || data.type;
        const animal = data.animalId ? animalsCache.find((a) => a.id === data.animalId) : null;
        const lot = data.lotId ? lotsCache.find((l) => l.id === data.lotId) : null;
        context = animal ? `#${animal.earTag}` : (lot ? lot.name : "—");
      }
      return `
        <li class="home-activity-row enter" style="--i: ${i}">
          <span class="home-activity-icon" aria-hidden="true">${icon}</span>
          <div class="home-activity-main">
            <p class="home-activity-label">${escapeHtml(label)}</p>
            <p class="home-activity-context">${escapeHtml(context)}</p>
          </div>
          <span class="home-activity-day">${escapeHtml(formatDayLabel(date))}</span>
        </li>
      `;
    }

    function renderHomeActivity() {
      const items = buildActivityItems();
      if (items.length === 0) {
        homeActivityListEl.innerHTML = `
          <li>
            <div class="empty-state">
              <span class="icon" aria-hidden="true">${ICONS.history}</span>
              <p>Nenhuma atividade registrada ainda.</p>
            </div>
          </li>
        `;
        return;
      }
      homeActivityListEl.innerHTML = items.map(renderActivityRow).join("");
    }

    // =====================================================
    // Entry point
    // =====================================================
    export function renderHome() {
      renderHomeHero();
      renderHomeAlerts();
      renderHomeActivity();
    }
