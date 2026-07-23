import {
  KG_PER_ARROBA, FEMALE_GMD_FACTOR, ICONS, lotStageLabel, lotStageChipClass,
} from "../../js/core/constants.js";
import {
  lotListEl, lotCountEl, statHeadEl, statArrobasEl,
} from "../../js/core/dom.js";
import {
  escapeHtml, formatKg, formatArrobas, formatPercentTrim,
  lotAgeMetaLabel, lotTenureMetaLabel, resolveFarmYieldPct, resolveConfinementYieldPct,
  lotWeightProjection, lotConfinedProjection, confinementStripHTML, formatBRL,
  resolveLotTargetArrobas, slaughterForecast,
} from "../../js/core/helpers.js";
import { lotsCache, animalsCache, propertiesCache } from "../../js/core/state.js";

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
      if (lotsCache.length === 0) {
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
        return;
      }

      lotListEl.innerHTML = lotsCache
        .map((l, i) => {
          const chipClass = lotStageChipClass(l);
          const categoryChip = `<span class="chip ${chipClass}">${escapeHtml(lotStageLabel(l))}</span>`;
          const menuBtn = `
            <button type="button" class="card-menu-btn pressable" data-action="lot-menu" data-id="${escapeHtml(l.id)}" aria-label="Ações do lote ${escapeHtml(l.name)}">
              ${ICONS.menu}
            </button>
          `;

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
            const property = l.propertyId ? propertiesCache.find((p) => p.id === l.propertyId) : null;
            return `
              <li class="card enter pressable" style="--i: ${i}" data-lot-id="${escapeHtml(l.id)}" tabindex="0" role="button" aria-label="Ver detalhes do lote ${escapeHtml(l.name)}">
                <div class="card-top">
                  <span class="ear-tag" style="font-size: var(--fs-base);">${escapeHtml(l.name)}</span>
                  <div class="card-top-right">
                    ${categoryChip}
                    ${menuBtn}
                  </div>
                </div>
                ${property ? `<p class="field-hint">${escapeHtml(property.name)}</p>` : ""}
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
                    <p class="mini-value is-meta">${escapeHtml(lotAgeMetaLabel(l))}</p>
                    <p class="mini-label">Idade (ref.)</p>
                  </div>
                  <div class="mini-stat">
                    <p class="mini-value is-meta">${escapeHtml(lotTenureMetaLabel(l))}</p>
                    <p class="mini-label">Na fazenda</p>
                  </div>
                </div>
              </li>
            `;
          }

          const count = animalsCache.filter((a) => a.lotId === l.id && (a.status || "active") === "active").length;
          return `
            <li class="card enter" style="--i: ${i}">
              <div class="card-top">
                <span class="ear-tag" style="font-size: var(--fs-base);">${escapeHtml(l.name)}</span>
                <div class="card-top-right">
                  ${categoryChip}
                  ${menuBtn}
                </div>
              </div>
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
                  <p class="mini-value is-meta">${escapeHtml(lotAgeMetaLabel(l))}</p>
                  <p class="mini-label">Idade (ref.)</p>
                </div>
                <div class="mini-stat">
                  <p class="mini-value is-meta">${escapeHtml(lotTenureMetaLabel(l))}</p>
                  <p class="mini-label">Na fazenda</p>
                </div>
              </div>
            </li>
          `;
        })
        .join("");
      lotCountEl.textContent = `${lotsCache.length} lote${lotsCache.length === 1 ? "" : "s"}`;
    }
