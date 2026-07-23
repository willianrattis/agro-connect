import {
  KG_PER_ARROBA, FEMALE_GMD_FACTOR, ICONS, lotStageLabel, lotStageChipClass,
} from "../../js/core/constants.js";
import {
  lotListEl, lotCountEl, statHeadEl, statArrobasEl,
  lotFiltersEl, lotFilterPropertyEl, lotFilterSexEl, lotFilterYearEl,
  lotSortBtn, lotSortLabelEl, fabBtn,
  mergeSelectionBarEl, mergeSelectionCountEl, mergeSelectionCancelBtn, mergeSelectionNextBtn,
} from "../../js/core/dom.js";
import {
  escapeHtml, formatKg, formatArrobas, formatPercentTrim,
  lotAgeMetaLabel, lotTenureMetaLabel, lotDateChipLabel, resolveFarmYieldPct, resolveConfinementYieldPct,
  lotWeightProjection, lotConfinedProjection, confinementStripHTML, formatBRL,
  resolveLotTargetArrobas, slaughterForecast, lotClosure, lotDisplayStageKey,
  toDateSafe, resolveLotSex,
} from "../../js/core/helpers.js";
import { lotsCache, animalsCache, propertiesCache } from "../../js/core/state.js";

    // Quick-filter state for the Rebanho feed — in-memory only (no
    // localStorage/URL/Firestore), reset on reload. "" means "no filter" for
    // every field except status, whose neutral value is "all".
    let lotFilters = { status: "active", propertyId: "", sex: "", year: "" };

    // Sort toggle state — in-memory only, reset on reload. "desc" = most
    // recent acquisitionDate first.
    let lotSort = "desc";

    // Rebuilds the property/sex/year <select> option lists from the current
    // caches, preserving the active selection where it still exists — a
    // selection whose option disappeared (property deleted, no lot left from
    // that year) resets to "" ("all") rather than silently keeping a value
    // that's no longer offered.
    function populateLotFilterOptions() {
      const properties = [...propertiesCache].sort((a, b) => (a.name || "").localeCompare(b.name || "", "pt-BR"));
      const propertyIds = new Set(properties.map((p) => p.id));
      if (lotFilters.propertyId && !propertyIds.has(lotFilters.propertyId)) lotFilters.propertyId = "";
      lotFilterPropertyEl.innerHTML = [
        `<option value="">Todas as propriedades</option>`,
        ...properties.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`),
      ].join("");
      lotFilterPropertyEl.value = lotFilters.propertyId;

      lotFilterSexEl.innerHTML = `
        <option value="">Ambos os sexos</option>
        <option value="M">Machos</option>
        <option value="F">Fêmeas</option>
      `;
      lotFilterSexEl.value = lotFilters.sex;

      const years = [...new Set(
        lotsCache
          .map((l) => toDateSafe(l.acquisitionDate)?.getFullYear())
          .filter((y) => Number.isFinite(y))
      )].sort((a, b) => b - a);
      if (lotFilters.year && !years.includes(Number(lotFilters.year))) lotFilters.year = "";
      lotFilterYearEl.innerHTML = [
        `<option value="">Todos os anos</option>`,
        ...years.map((y) => `<option value="${y}">${y}</option>`),
      ].join("");
      lotFilterYearEl.value = lotFilters.year;
    }

    // status: "active" lots are those lotClosure() doesn't consider closed;
    // "closed" the opposite; "all" skips the check entirely. Every other
    // field is skipped when left at its "" (all) value.
    function applyLotFilters(lots) {
      return lots.filter((l) => {
        if (lotFilters.status !== "all") {
          const isClosed = lotClosure(l).isClosed;
          if (lotFilters.status === "active" && isClosed) return false;
          if (lotFilters.status === "closed" && !isClosed) return false;
        }
        if (lotFilters.propertyId && l.propertyId !== lotFilters.propertyId) return false;
        if (lotFilters.sex && resolveLotSex(l) !== lotFilters.sex) return false;
        if (lotFilters.year) {
          const acqYear = toDateSafe(l.acquisitionDate)?.getFullYear();
          if (String(acqYear) !== lotFilters.year) return false;
        }
        return true;
      });
    }

    // Sorts a COPY of the given lots by acquisitionDate — "desc" (default)
    // puts the most recently acquired lot first, "asc" the oldest first.
    // Lots with no resolvable acquisitionDate always sort last, regardless
    // of direction. Never mutates lotsCache.
    function applyLotSort(lots) {
      const sign = lotSort === "asc" ? 1 : -1;
      return [...lots].sort((a, b) => {
        const da = toDateSafe(a.acquisitionDate);
        const db = toDateSafe(b.acquisitionDate);
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return (da - db) * sign;
      });
    }

    function updateLotSortButtonUI() {
      lotSortLabelEl.textContent = lotSort === "desc" ? "Entrada: mais recente" : "Entrada: mais antiga";
      const arrowEl = lotSortBtn.querySelector('span[aria-hidden="true"]');
      if (arrowEl) arrowEl.textContent = lotSort === "desc" ? "↓" : "↑";
    }

    lotSortBtn.addEventListener("click", () => {
      lotSort = lotSort === "desc" ? "asc" : "desc";
      updateLotSortButtonUI();
      renderLots();
    });

    function resetLotFilters() {
      lotFilters = { status: "active", propertyId: "", sex: "", year: "" };
      const activeRadio = document.getElementById("lot-status-active");
      if (activeRadio) activeRadio.checked = true;
      renderLots();
    }

    document.querySelectorAll('input[name="lot-status"]').forEach((r) => r.addEventListener("change", () => {
      lotFilters.status = document.querySelector('input[name="lot-status"]:checked').value;
      renderLots();
    }));
    lotFilterPropertyEl.addEventListener("change", () => {
      lotFilters.propertyId = lotFilterPropertyEl.value;
      renderLots();
    });
    lotFilterSexEl.addEventListener("change", () => {
      lotFilters.sex = lotFilterSexEl.value;
      renderLots();
    });
    lotFilterYearEl.addEventListener("change", () => {
      lotFilters.year = lotFilterYearEl.value;
      renderLots();
    });
    lotListEl.addEventListener("click", (e) => {
      if (e.target.closest('[data-action="clear-lot-filters"]')) resetLotFilters();
    });

    // Merge-selection mode — in-feed card selection that replaces the old
    // "Mesclar lotes" picker sheet. null = off; a Set<string> of lot ids =
    // on (possibly empty, before the second lot is picked).
    let mergeSelection = null;

    export function isMergeSelectionActive() {
      return mergeSelection !== null;
    }

    export function getMergeSelectionIds() {
      return mergeSelection ? Array.from(mergeSelection) : [];
    }

    // Only per-head (aggregate) lots that aren't closed can be merged —
    // merging a closed (zero-head) lot changes no number in the preview and
    // just imports its exit history into the target's ledger.
    export function isMergeEligible(lot) {
      return (lot.trackingMode || "individual") === "aggregate" && !lotClosure(lot).isClosed;
    }

    export function enterMergeSelection() {
      const eligibleCount = lotsCache.filter(isMergeEligible).length;
      if (eligibleCount < 2) return false;
      mergeSelection = new Set();
      renderLots();
      return true;
    }

    export function exitMergeSelection() {
      mergeSelection = null;
      renderLots();
    }

    export function toggleMergeSelection(id) {
      if (!mergeSelection) return;
      const lot = lotsCache.find((l) => l.id === id);
      if (!lot || !isMergeEligible(lot)) return;
      if (mergeSelection.has(id)) mergeSelection.delete(id);
      else mergeSelection.add(id);
      renderLots();
    }

    // Selection survives filtering — ids are only dropped here, when the lot
    // they point to has vanished from lotsCache entirely or stopped being
    // eligible (e.g. closed out from under the selection). Filtering the
    // feed to find a second lot must never drop the first.
    function pruneMergeSelection() {
      if (!mergeSelection) return;
      for (const id of mergeSelection) {
        const lot = lotsCache.find((l) => l.id === id);
        if (!lot || !isMergeEligible(lot)) mergeSelection.delete(id);
      }
    }

    function ineligibilityReason(lot) {
      if ((lot.trackingMode || "individual") !== "aggregate") return "Lote com brincos individuais";
      return "Lote encerrado";
    }

    mergeSelectionCancelBtn.addEventListener("click", () => exitMergeSelection());

    function syncMergeSelectionBar() {
      const active = isMergeSelectionActive();
      mergeSelectionBarEl.hidden = !active;
      fabBtn.hidden = active;
      lotListEl.classList.toggle("has-merge-bar", active);
      if (!active) return;
      const n = mergeSelection.size;
      mergeSelectionCountEl.textContent = `${n} selecionado${n === 1 ? "" : "s"}`;
      mergeSelectionNextBtn.disabled = n < 2;
    }

    // 4. Render: skeletons → cattle cards (staggered)
    // =====================================================
    export function renderSkeletons(count) {
      lotListEl.innerHTML = Array.from({ length: count })
        .map(
          () => `
            <li class="card skeleton" aria-hidden="true">
              <div class="card-top">
                <span class="sk-block sk-tag"></span>
                <span class="sk-block sk-chip"></span>
              </div>
              <div class="card-stats" style="border-top: none;">
                <span class="sk-block sk-stat"></span>
                <span class="sk-block sk-stat"></span>
                <span class="sk-block sk-stat"></span>
              </div>
            </li>
          `
        )
        .join("");
    }

    // Herd summary strip (Cabeças no rebanho / Estoque estimado) is derived
    // from lot headcount, not tagged animals — aggregate lots have no animal
    // docs, and tagged animals are a non-additive subset of a lot's headcount.
    // Owned totals include confined head (still the owner's patrimony, just
    // not on the farm) via the confined projection, so fully-confined lots
    // don't vanish from these totals.
    // Deliberately unfiltered — always reports the whole herd regardless of
    // the quick filters below, which only scope the card list.
    export function renderHerdSummary() {
      let head = 0;
      let arrobas = 0;
      for (const l of lotsCache) {
        const confinedHeadcount = l.confinedHeadcount ?? 0;
        head += (l.headcount ?? 0) + confinedHeadcount;

        const projection = lotWeightProjection(l);
        if (projection) {
          arrobas += projection.projectedTotalArrobas;
        } else if (Number.isFinite(l.avgWeightKg)) {
          const yieldPct = resolveFarmYieldPct(l);
          arrobas += (l.headcount ?? 0) * ((l.avgWeightKg * yieldPct) / KG_PER_ARROBA);
        }

        if (confinedHeadcount > 0) {
          const confinedProjection = lotConfinedProjection(l);
          const yieldPct = resolveConfinementYieldPct(l);
          const confinedWeightKg = confinedProjection?.projectedWeightKg ?? l.avgWeightKg;
          if (Number.isFinite(confinedWeightKg)) {
            arrobas += confinedHeadcount * ((confinedWeightKg * yieldPct) / KG_PER_ARROBA);
          }
        }
      }
      statHeadEl.textContent = String(head);
      statArrobasEl.innerHTML = `${formatArrobas(arrobas)} <small>@</small>`;
    }

    export function renderLotsError() {
      lotListEl.innerHTML = `
        <li>
          <div class="empty-state">
            <span class="icon" aria-hidden="true" style="background: rgba(179,38,30,0.12); color: var(--danger);">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16h.01"/></svg>
            </span>
            <h3>Não foi possível carregar os lotes</h3>
            <p>Verifique sua conexão e tente novamente em instantes.</p>
          </div>
        </li>
      `;
      lotCountEl.textContent = "";
    }

    // Reads lotsCache + animalsCache directly (both kept fresh by their own
    // onSnapshot listeners) so it can be called from either one.
    export function renderLots() {
      pruneMergeSelection();
      const selectionActive = isMergeSelectionActive();

      if (lotsCache.length === 0) {
        lotFiltersEl.hidden = true;
        lotListEl.innerHTML = `
          <li>
            <div class="empty-state">
              <span class="icon" aria-hidden="true">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18"/></svg>
              </span>
              <h3>Nenhum lote ainda</h3>
              <p>Toque em + para criar um lote.</p>
            </div>
          </li>
        `;
        lotCountEl.textContent = "0 lotes";
        syncMergeSelectionBar();
        return;
      }
      lotFiltersEl.hidden = false;
      populateLotFilterOptions();

      const filteredLots = applyLotSort(applyLotFilters(lotsCache));
      if (filteredLots.length === 0) {
        lotListEl.innerHTML = `
          <li>
            <div class="empty-state">
              <span class="icon" aria-hidden="true">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18"/></svg>
              </span>
              <h3>Nenhum lote com esses filtros</h3>
              <p>Ajuste os filtros acima para ver outros lotes.</p>
              <button type="button" class="btn-inline pressable" data-action="clear-lot-filters" style="margin-top: var(--space-4);">Limpar filtros</button>
            </div>
          </li>
        `;
        lotCountEl.textContent = "0 lotes";
        syncMergeSelectionBar();
        return;
      }

      lotListEl.innerHTML = filteredLots
        .map((l, i) => {
          const closure = lotClosure(l);
          const stageKey = lotDisplayStageKey(l, closure);
          const chipClass = lotStageChipClass(l, stageKey);
          const categoryChip = `<span class="chip ${chipClass}">${escapeHtml(lotStageLabel(l, stageKey))}</span>`;
          const menuBtn = selectionActive ? "" : `
            <button type="button" class="card-menu-btn pressable" data-action="lot-menu" data-id="${escapeHtml(l.id)}" aria-label="Ações do lote ${escapeHtml(l.name)}">
              ${ICONS.menu}
            </button>
          `;
          const property = l.propertyId ? propertiesCache.find((p) => p.id === l.propertyId) : null;
          const dateChip = lotDateChipLabel(l, closure);
          const metaRowHTML = property || dateChip
            ? `
              <div class="card-meta-row">
                ${property ? `<p class="field-hint">${escapeHtml(property.name)}</p>` : ""}
                ${dateChip ? `<span class="chip chip-meta">${escapeHtml(dateChip)}</span>` : ""}
              </div>
            `
            : "";
          const selectionHintHTML = selectionActive && !isMergeEligible(l)
            ? `<p class="field-hint">${ineligibilityReason(l)}</p>`
            : "";

          if ((l.trackingMode || "individual") === "aggregate") {
            const headcount = l.headcount ?? 0;
            const confinedHeadcount = l.confinedHeadcount ?? 0;
            const hasConfined = confinedHeadcount > 0;
            const ownedHeadcount = headcount + confinedHeadcount;
            const yieldPct = resolveFarmYieldPct(l);

            // Economics row is computed over OWNED head (farm + confined),
            // each side valued at its own location's projected weight (and
            // its own yield — feedlot runs higher than pasture), so a
            // fully-confined lot doesn't read as worthless patrimony.
            const farmProjection = lotWeightProjection(l);
            const confinedProjection = lotConfinedProjection(l);
            const confinedYieldPct = resolveConfinementYieldPct(l);
            const farmArrobas = farmProjection && headcount > 0
              ? headcount * ((farmProjection.projectedWeightKg * yieldPct) / KG_PER_ARROBA)
              : 0;
            const confinedArrobas = confinedProjection
              ? confinedHeadcount * ((confinedProjection.projectedWeightKg * confinedYieldPct) / KG_PER_ARROBA)
              : 0;
            const hasArrobaData = (farmProjection && headcount > 0) || confinedProjection;
            const totalArrobasEst = hasArrobaData ? farmArrobas + confinedArrobas : null;
            const costPerArroba = totalArrobasEst
              ? (l.totalPurchaseCostBRL ?? 0) / totalArrobasEst
              : null;

            const cardClasses = ["card", "enter"];
            let cardAttrs = ` style="--i: ${i}"`;
            if (selectionActive) {
              if (isMergeEligible(l)) {
                const selected = mergeSelection.has(l.id);
                cardClasses.push("is-selectable");
                if (selected) cardClasses.push("is-selected");
                cardAttrs += ` data-lot-id="${escapeHtml(l.id)}" data-merge-selectable role="checkbox" aria-checked="${selected}" tabindex="0" aria-label="Selecionar lote ${escapeHtml(l.name)}"`;
              } else {
                cardClasses.push("is-ineligible");
                cardAttrs += ` aria-disabled="true"`;
              }
            } else {
              cardClasses.push("pressable");
              cardAttrs += ` data-lot-id="${escapeHtml(l.id)}" tabindex="0" role="button" aria-label="Ver detalhes do lote ${escapeHtml(l.name)}"`;
            }

            return `
              <li class="${cardClasses.join(" ")}"${cardAttrs}>
                <div class="card-top">
                  <span class="ear-tag" style="font-size: var(--fs-base);">${escapeHtml(l.name)}</span>
                  <div class="card-top-right">
                    ${categoryChip}
                    ${menuBtn}
                  </div>
                </div>
                ${metaRowHTML}
                ${selectionHintHTML}
                <div class="card-stats" style="grid-template-columns: repeat(2, 1fr);">
                  <div class="mini-stat">
                    <p class="mini-value">${ownedHeadcount}</p>
                    <p class="mini-label">${hasConfined ? `Cabeças · ${headcount} na fazenda` : "Cabeças"}</p>
                  </div>
                  <div class="mini-stat">
                    <p class="mini-value">${l.avgWeightKg != null ? `${formatKg(l.avgWeightKg)} kg` : "—"}</p>
                    <p class="mini-label">Peso médio</p>
                  </div>
                </div>
                ${confinementStripHTML(l)}
                <div class="card-stats" style="grid-template-columns: repeat(2, 1fr);">
                  <div class="mini-stat">
                    <p class="mini-value">${totalArrobasEst != null ? `${formatArrobas(totalArrobasEst)} @` : "—"}</p>
                    <p class="mini-label">@ total estimada</p>
                  </div>
                  <div class="mini-stat">
                    <p class="mini-value">${costPerArroba != null ? formatBRL(costPerArroba) : "—"}</p>
                    <p class="mini-label">Custo médio/@</p>
                  </div>
                </div>
                ${(() => {
                  if (headcount <= 0 || !farmProjection) return "";
                  const p = farmProjection;
                  const femaleSuffix = p.isFemale
                    ? ` (fêmea −${formatPercentTrim((1 - FEMALE_GMD_FACTOR) * 100)}%)`
                    : "";
                  const headSuffix = hasConfined ? ` · ${headcount} cab.` : "";
                  const labelSuffix = hasConfined ? " (fazenda)" : "";
                  const cappedSuffix = p.isCapped ? ` · limite de ${formatKg(p.maxWeightKg)} kg atingido` : "";
                  const hint = `Projeção: pastagem ${p.qualityLabel.toLowerCase()} · ${Math.round(p.gmdKgPerDay * 1000).toLocaleString("pt-BR")} g/dia${femaleSuffix} · ${p.days.toLocaleString("pt-BR")} dias${headSuffix}${cappedSuffix}`;
                  const forecast = slaughterForecast({
                    projectedWeightKg: p.projectedWeightKg,
                    gmdKgPerDay: p.gmdKgPerDay,
                    targetArrobas: resolveLotTargetArrobas(l),
                    yieldPct: resolveFarmYieldPct(l),
                    maxWeightKg: p.maxWeightKg,
                  });
                  return `
                    <div class="card-stats" style="grid-template-columns: repeat(2, 1fr);">
                      <div class="mini-stat">
                        <p class="mini-value">${formatKg(p.projectedWeightKg)} kg</p>
                        <p class="mini-label">Peso estimado hoje${labelSuffix}</p>
                      </div>
                      <div class="mini-stat">
                        <p class="mini-value">${formatArrobas(p.projectedTotalArrobas)} @</p>
                        <p class="mini-label">@ estimada hoje${labelSuffix}</p>
                      </div>
                    </div>
                    <p class="field-hint">${escapeHtml(hint)}</p>
                    ${forecast ? `<p class="field-hint">${escapeHtml(forecast.label)}</p>` : ""}
                  `;
                })()}
                <div class="card-stats" style="grid-template-columns: repeat(2, 1fr);">
                  <div class="mini-stat">
                    <p class="mini-value is-meta">${escapeHtml(lotAgeMetaLabel(l, closure))}</p>
                    <p class="mini-label">Idade (ref.)</p>
                  </div>
                  <div class="mini-stat">
                    <p class="mini-value is-meta">${escapeHtml(lotTenureMetaLabel(l, closure))}</p>
                    <p class="mini-label">Na fazenda</p>
                  </div>
                </div>
              </li>
            `;
          }

          const count = animalsCache.filter((a) => a.lotId === l.id && (a.status || "active") === "active").length;
          const individualCardClasses = ["card", "enter"];
          let individualCardAttrs = ` style="--i: ${i}"`;
          if (selectionActive) {
            individualCardClasses.push("is-ineligible");
            individualCardAttrs += ` aria-disabled="true"`;
          }
          return `
            <li class="${individualCardClasses.join(" ")}"${individualCardAttrs}>
              <div class="card-top">
                <span class="ear-tag" style="font-size: var(--fs-base);">${escapeHtml(l.name)}</span>
                <div class="card-top-right">
                  ${categoryChip}
                  ${menuBtn}
                </div>
              </div>
              ${metaRowHTML}
              ${selectionHintHTML}
              <div class="card-stats" style="grid-template-columns: repeat(2, 1fr);">
                <div class="mini-stat">
                  <p class="mini-value">${count}</p>
                  <p class="mini-label">Animais</p>
                </div>
                <div class="mini-stat">
                  <p class="mini-value">${l.areaHa != null ? `${l.areaHa.toLocaleString("pt-BR")} ha` : "—"}</p>
                  <p class="mini-label">Área</p>
                </div>
              </div>
              <div class="card-stats" style="grid-template-columns: repeat(2, 1fr);">
                <div class="mini-stat">
                  <p class="mini-value is-meta">${escapeHtml(lotAgeMetaLabel(l, closure))}</p>
                  <p class="mini-label">Idade (ref.)</p>
                </div>
                <div class="mini-stat">
                  <p class="mini-value is-meta">${escapeHtml(lotTenureMetaLabel(l, closure))}</p>
                  <p class="mini-label">Na fazenda</p>
                </div>
              </div>
            </li>
          `;
        })
        .join("");
      lotCountEl.textContent = `${filteredLots.length} lote${filteredLots.length === 1 ? "" : "s"}`;
      syncMergeSelectionBar();
    }
