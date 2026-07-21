import { db, doc, updateDoc, deleteDoc, serverTimestamp, collection, addDoc } from "../../js/core/firebase.js";
import {
  TX_CATEGORIES, TX_EXPENSE_GROUPS, IR_DEDUCT, MONTH_ABBR, ICONS,
  categoryDefaultDeduct, categoryGroupId,
} from "../../js/core/constants.js";
import {
  yearPrevBtn, yearNextBtn, yearLabelEl, monthSelectorEl, finReceitasEl, finDespesasEl,
  finSaldoEl, finSaldoAnteriorEl, finSaldoResultadoEl, finCountEl, txListEl,
  finFunruralEl, finFunruralHintEl, finFunruralSplitEl, finFunruralRetidoEl, finFunruralRecolherEl,
} from "../../js/core/dom.js";
import {
  escapeHtml, toDateSafe, toDateInputValue, formatCurrencyInput, parseBRLToNumber, formatBRL,
  getAvailableYears, formatDayLabel, categoryDisplayLabel, getFunruralConfig, formatPercentTrim,
} from "../../js/core/helpers.js";
import { currentUid, lotsCache, animalsCache, transactionsCache } from "../../js/core/state.js";
import { Sheet } from "../../js/core/sheet.js";
import { showToast } from "../../js/core/auth.js";
import { clearFieldError, setFieldError } from "../rebanho/animals.js";

    // 4b. Render: Financeiro (month-filtered ledger)
    // =====================================================
    let selectedYear = new Date().getFullYear();
    let monthRange = null; // null = whole year; else { start, end }, 1<=start<=end<=12

    // Rebuilds the year-stepper bounds/label from live data. Falls back to
    // the current year (and clears any month range) if the previously
    // selected year falls outside the data-derived range.
    export function renderYearStepper() {
      const years = getAvailableYears();
      if (!years.includes(selectedYear)) {
        selectedYear = new Date().getFullYear();
        monthRange = null;
      }
      yearPrevBtn.disabled = selectedYear <= years[0];
      yearNextBtn.disabled = selectedYear >= years[years.length - 1];
      yearLabelEl.textContent = String(selectedYear);
    }

    export function renderMonthChips() {
      renderYearStepper();
      const chips = [`<button type="button" class="month-chip pressable" role="tab" data-scope="year">Ano</button>`];
      for (let m = 1; m <= 12; m++) {
        chips.push(`<button type="button" class="month-chip pressable" role="tab" data-month="${m}">${MONTH_ABBR[m - 1]}</button>`);
      }
      monthSelectorEl.innerHTML = chips.join("");
      syncMonthChipActive();
    }

    export function syncMonthChipActive() {
      monthSelectorEl.querySelectorAll(".month-chip").forEach((btn) => {
        if (btn.dataset.scope === "year") {
          btn.classList.toggle("is-active", monthRange == null);
          btn.classList.remove("in-range");
          btn.setAttribute("aria-selected", String(monthRange == null));
          return;
        }
        const m = Number(btn.dataset.month);
        const isEndpoint = monthRange != null && (m === monthRange.start || m === monthRange.end);
        const isInRange = monthRange != null && m > monthRange.start && m < monthRange.end;
        btn.classList.toggle("is-active", isEndpoint);
        btn.classList.toggle("in-range", isInRange);
        btn.setAttribute("aria-selected", String(isEndpoint));
      });
    }

    monthSelectorEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".month-chip");
      if (!btn) return;
      if (btn.dataset.scope === "year") {
        monthRange = null;
      } else {
        const m = Number(btn.dataset.month);
        if (!monthRange || monthRange.start !== monthRange.end) {
          monthRange = { start: m, end: m };
        } else {
          monthRange = { start: Math.min(monthRange.start, m), end: Math.max(monthRange.start, m) };
        }
      }
      syncMonthChipActive();
      renderFinanceiro();
    });

    monthSelectorEl.addEventListener("wheel", (e) => {
      if (e.deltaX !== 0) return;
      const max = monthSelectorEl.scrollWidth - monthSelectorEl.clientWidth;
      if (max <= 0) return;
      const next = monthSelectorEl.scrollLeft + e.deltaY;
      if ((next < 0 && e.deltaY < 0) || (next > max && e.deltaY > 0)) return;
      e.preventDefault();
      monthSelectorEl.scrollLeft = next;
    }, { passive: false });

    yearPrevBtn.addEventListener("click", () => {
      const years = getAvailableYears();
      if (selectedYear <= years[0]) return;
      selectedYear -= 1;
      monthRange = null;
      renderMonthChips();
      renderFinanceiro();
    });

    yearNextBtn.addEventListener("click", () => {
      const years = getAvailableYears();
      if (selectedYear >= years[years.length - 1]) return;
      selectedYear += 1;
      monthRange = null;
      renderMonthChips();
      renderFinanceiro();
    });

    export function linkTagHTML(t) {
      if (t.linkedScope === "animal" && t.linkedAnimalId) {
        const animal = animalsCache.find((a) => a.id === t.linkedAnimalId);
        if (animal) return `<span class="chip tx-link-chip">#${escapeHtml(animal.earTag)}</span>`;
      } else if (t.linkedScope === "lot" && t.linkedLotId) {
        const lot = lotsCache.find((l) => l.id === t.linkedLotId);
        if (lot) return `<span class="chip tx-link-chip">${escapeHtml(lot.name)}</span>`;
      }
      return "";
    }

    export function renderTxRow(t) {
      const isReceita = t.kind === "receita";
      const amountClass = isReceita ? "fin-positive" : "fin-negative";
      const sign = isReceita ? "+" : "−";
      return `
        <li class="tx-row">
          <div class="tx-row-main">
            <div class="tx-tags">
              <span class="chip tx-category-chip">${escapeHtml(categoryDisplayLabel(t.category))}</span>
              ${linkTagHTML(t)}
            </div>
            ${t.description ? `<p class="tx-desc">${escapeHtml(t.description)}</p>` : ""}
          </div>
          <div class="tx-row-end">
            <p class="tx-amount ${amountClass}">${sign} ${formatBRL(Math.abs(t.amountBRL || 0))}</p>
            <button type="button" class="card-menu-btn pressable" data-action="tx-menu" data-id="${escapeHtml(t.id)}" aria-label="Ações do lançamento">
              ${ICONS.menu}
            </button>
          </div>
        </li>
      `;
    }

    export function renderFinError() {
      txListEl.innerHTML = `
        <li>
          <div class="empty-state">
            <span class="icon" aria-hidden="true" style="background: rgba(179,38,30,0.12); color: var(--danger);">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16h.01"/></svg>
            </span>
            <h3>Não foi possível carregar os lançamentos</h3>
            <p>Verifique sua conexão e tente novamente em instantes.</p>
          </div>
        </li>
      `;
      finReceitasEl.textContent = "—";
      finDespesasEl.textContent = "—";
      finSaldoEl.textContent = "—";
      finSaldoAnteriorEl.textContent = "—";
      finSaldoResultadoEl.textContent = "—";
      finCountEl.textContent = "";
      finFunruralEl.textContent = "—";
      finFunruralHintEl.textContent = "";
      finFunruralRetidoEl.textContent = "—";
      finFunruralRecolherEl.textContent = "—";
      finFunruralSplitEl.hidden = true;
    }

    export function renderFinEmpty() {
      txListEl.innerHTML = `
        <li>
          <div class="empty-state">
            <span class="icon" aria-hidden="true">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/></svg>
            </span>
            <h3>Nenhum lançamento neste período.</h3>
            <p>Toque em + para registrar uma receita ou despesa.</p>
          </div>
        </li>
      `;
    }

    // Reads transactionsCache directly (kept fresh by the transactions
    // onSnapshot listener) and filters by selectedYear + monthRange client-side
    // — the Firestore query itself only filters by ownerId + orders by date.
    export function renderFinanceiro() {
      const inScope = (t) => {
        const d = toDateSafe(t.date);
        if (!d || d.getFullYear() !== selectedYear) return false;
        if (!monthRange) return true;
        const m = d.getMonth() + 1;
        return m >= monthRange.start && m <= monthRange.end;
      };
      const scopedTx = transactionsCache.filter(inScope);

      const totals = scopedTx.reduce(
        (acc, t) => {
          if (t.kind === "receita") acc.receitas += t.amountBRL || 0;
          else if (t.kind === "despesa") acc.despesas += t.amountBRL || 0;
          if (t.kind === "receita" && t.category === "venda-animal") {
            const amt = t.amountBRL || 0;
            acc.funruralBase += amt;
            if (t.buyerType === "pf") acc.funruralBasePf += amt;
            else acc.funruralBasePj += amt;
          }
          if (t.kind === "despesa" && t.category === "mo-salarios") acc.funruralFolhaBase += t.amountBRL || 0;
          return acc;
        },
        { receitas: 0, despesas: 0, funruralBase: 0, funruralBasePj: 0, funruralBasePf: 0, funruralFolhaBase: 0 }
      );
      const resultadoPeriodo = totals.receitas - totals.despesas;

      // Carries forward every transaction dated strictly before the selected
      // period's start, regardless of year — scans the full cache, not scopedTx.
      const periodStart = monthRange
        ? new Date(selectedYear, monthRange.start - 1, 1)
        : new Date(selectedYear, 0, 1);
      const saldoAnterior = transactionsCache.reduce((acc, t) => {
        const d = toDateSafe(t.date);
        if (!d || d >= periodStart) return acc;
        if (t.kind === "receita") return acc + (t.amountBRL || 0);
        if (t.kind === "despesa") return acc - (t.amountBRL || 0);
        return acc;
      }, 0);
      const saldoAcumulado = saldoAnterior + resultadoPeriodo;

      finReceitasEl.textContent = formatBRL(totals.receitas);
      finDespesasEl.textContent = formatBRL(totals.despesas);
      finSaldoEl.textContent = formatBRL(saldoAcumulado);
      finSaldoEl.classList.toggle("fin-positive", saldoAcumulado > 0);
      finSaldoEl.classList.toggle("fin-negative", saldoAcumulado < 0);
      finSaldoAnteriorEl.textContent = formatBRL(saldoAnterior);
      finSaldoResultadoEl.textContent = formatBRL(resultadoPeriodo);
      finCountEl.textContent = `${scopedTx.length} lançamento${scopedTx.length === 1 ? "" : "s"}`;

      const fun = getFunruralConfig();
      if (fun.regime === "receita") {
        const rate = fun.receitaRatePct / 100;
        const est = totals.funruralBase * rate;
        finFunruralEl.textContent = formatBRL(est);
        finFunruralHintEl.textContent =
          `${formatPercentTrim(fun.receitaRatePct)}% sobre ${formatBRL(totals.funruralBase)} em vendas de gado no período`;
        finFunruralRetidoEl.textContent = formatBRL(totals.funruralBasePj * rate);
        finFunruralRecolherEl.textContent = formatBRL(totals.funruralBasePf * rate);
        finFunruralSplitEl.hidden = false;
      } else {
        const rate = fun.folhaRatePct / 100;
        const est = totals.funruralFolhaBase * rate;
        finFunruralEl.textContent = formatBRL(est);
        finFunruralHintEl.textContent =
          `${formatPercentTrim(fun.folhaRatePct)}% sobre ${formatBRL(totals.funruralFolhaBase)} de folha (salários) no período`;
        finFunruralSplitEl.hidden = true;
      }

      if (scopedTx.length === 0) {
        renderFinEmpty();
        return;
      }

      // scopedTx preserves the query's date-desc order, so a day boundary is
      // just a change in toDateSafe(date).toDateString() between neighbors.
      const groups = [];
      let lastDayKey = null;
      for (const t of scopedTx) {
        const d = toDateSafe(t.date);
        const dayKey = d ? d.toDateString() : "—";
        if (dayKey !== lastDayKey) {
          groups.push({ date: d, items: [] });
          lastDayKey = dayKey;
        }
        groups[groups.length - 1].items.push(t);
      }

      txListEl.innerHTML = groups
        .map(
          (g) => `
            <li class="tx-day-group">
              <p class="tx-day-label">${g.date ? formatDayLabel(g.date) : "Sem data"}</p>
              <ul class="tx-day-items">
                ${g.items.map(renderTxRow).join("")}
              </ul>
            </li>
          `
        )
        .join("");
    }

    renderMonthChips();

     // =====================================================
     // 7c. Financeiro — "Nova transação" sheet
     // =====================================================
     export function categoryOptionsHTML(kind, selectedValue) {
       if (kind !== "despesa") {
         return TX_CATEGORIES[kind]
           .map((c) => `<option value="${c.value}" ${c.value === selectedValue ? "selected" : ""}>${escapeHtml(c.label)}</option>`)
           .join("");
       }
       return TX_EXPENSE_GROUPS
         .map(
           (g) => `
             <optgroup label="${escapeHtml(g.label)}">
               ${g.items.map((c) => `<option value="${c.value}" ${c.value === selectedValue ? "selected" : ""}>${escapeHtml(c.label)}</option>`).join("")}
             </optgroup>
           `
         )
         .join("");
     }

     function isKnownDespesaCategory(value) {
       return TX_EXPENSE_GROUPS.some((g) => g.items.some((i) => i.value === value));
     }

     // Full <option> set for #tx-category, including a "Selecione" placeholder
     // and — for despesa only — a synthesized option for a legacy category
     // value that no longer exists in TX_EXPENSE_GROUPS (mirrors the
     // animalOptions back-compat pattern below), so editing an old
     // transaction never silently loses its stored category.
     function categorySelectOptionsHTML(kind, selectedValue) {
       const legacyOptionHTML =
         kind === "despesa" && selectedValue && !isKnownDespesaCategory(selectedValue)
           ? `<option value="${escapeHtml(selectedValue)}" selected>${escapeHtml(categoryDisplayLabel(selectedValue))}</option>`
           : "";
       return `<option value="">Selecione</option>${legacyOptionHTML}${categoryOptionsHTML(kind, selectedValue)}`;
     }

     export function buildTransactionFormHTML(animals, lots, transaction) {
       const kind = transaction?.kind || "receita";
       const scope = transaction?.linkedScope || "operation";
       const linkedAnimalId = transaction?.linkedAnimalId || null;
       const linkedLotId = transaction?.linkedLotId || null;
       const irDeduct = transaction?.irDeductible || categoryDefaultDeduct(transaction?.category);
       const buyerType = transaction?.buyerType || "pj";
       // Keep the currently-linked animal selectable even if it's no longer
       // active (sold/dead), so editing an old transaction doesn't lose its link.
       const animalOptions = animals
         .filter((a) => (a.status || "active") === "active" || a.id === linkedAnimalId)
         .map((a) => `<option value="${escapeHtml(a.id)}" ${a.id === linkedAnimalId ? "selected" : ""}>#${escapeHtml(a.earTag)}</option>`)
         .join("");
       const lotOptions = lots
         .map((l) => `<option value="${escapeHtml(l.id)}" ${l.id === linkedLotId ? "selected" : ""}>${escapeHtml(l.name)}</option>`)
         .join("");

       return `
         <form id="tx-form" class="form-grid" novalidate>
           <div class="field">
             <span class="field-label">Tipo *</span>
             <div class="segmented" role="radiogroup" aria-label="Tipo de lançamento">
               <input type="radio" id="tx-kind-receita" name="tx-kind" value="receita" ${kind === "receita" ? "checked" : ""} />
               <label for="tx-kind-receita">Receita</label>
               <input type="radio" id="tx-kind-despesa" name="tx-kind" value="despesa" ${kind === "despesa" ? "checked" : ""} />
               <label for="tx-kind-despesa">Despesa</label>
             </div>
           </div>

           <div class="field field--half">
             <label class="field-label" for="tx-category">Categoria *</label>
             <select class="select" id="tx-category">
               ${categorySelectOptionsHTML(kind, transaction?.category)}
             </select>
             <p class="field-error" id="tx-category-error"></p>
           </div>

           <div class="field field--half">
             <label class="field-label" for="tx-amount">Valor (R$) *</label>
             <input class="input" id="tx-amount" type="text" inputmode="decimal" placeholder="R$ 0,00" autocomplete="off" value="${transaction ? formatBRL(transaction.amountBRL) : ""}" />
             <p class="field-error" id="tx-amount-error"></p>
           </div>

           <div class="field" id="tx-ir-field" ${kind === "despesa" ? "" : "hidden"}>
             <span class="field-label">Dedutível no IR</span>
             <div class="segmented" role="radiogroup" aria-label="Dedutível no IR">
               <input type="radio" id="tx-ir-dedutivel" name="tx-ir-deduct" value="${IR_DEDUCT.DEDUTIVEL}" ${irDeduct === IR_DEDUCT.DEDUTIVEL ? "checked" : ""} />
               <label for="tx-ir-dedutivel">Dedutível</label>
               <input type="radio" id="tx-ir-nao-dedutivel" name="tx-ir-deduct" value="${IR_DEDUCT.NAO_DEDUTIVEL}" ${irDeduct === IR_DEDUCT.NAO_DEDUTIVEL ? "checked" : ""} />
               <label for="tx-ir-nao-dedutivel">Não ded.</label>
               <input type="radio" id="tx-ir-depreciavel" name="tx-ir-deduct" value="${IR_DEDUCT.DEPRECIAVEL}" ${irDeduct === IR_DEDUCT.DEPRECIAVEL ? "checked" : ""} />
               <label for="tx-ir-depreciavel">Depreciável</label>
             </div>
           </div>

           <div class="field" id="tx-buyer-field" ${(kind === "receita" && transaction?.category === "venda-animal") ? "" : "hidden"}>
             <label class="field-label">Comprador</label>
             <div class="segmented">
               <input type="radio" id="tx-buyer-pj" name="tx-buyer-type" value="pj" ${buyerType === "pj" ? "checked" : ""} />
               <label for="tx-buyer-pj">PJ (frigorífico)</label>
               <input type="radio" id="tx-buyer-pf" name="tx-buyer-type" value="pf" ${buyerType === "pf" ? "checked" : ""} />
               <label for="tx-buyer-pf">Pessoa Física</label>
             </div>
             <p class="field-hint">PJ retém o Funrural na fonte; PF exige que você recolha.</p>
           </div>

           <div class="field">
             <label class="field-label" for="tx-date">Data *</label>
             <input class="input" id="tx-date" type="date" value="${toDateInputValue(transaction?.date)}" />
             <p class="field-error" id="tx-date-error"></p>
           </div>

           <div class="field">
             <span class="field-label">Vínculo</span>
             <div class="segmented" role="radiogroup" aria-label="Vínculo do lançamento">
               <input type="radio" id="tx-scope-operation" name="tx-scope" value="operation" ${scope === "operation" ? "checked" : ""} />
               <label for="tx-scope-operation">Geral</label>
               <input type="radio" id="tx-scope-animal" name="tx-scope" value="animal" ${scope === "animal" ? "checked" : ""} />
               <label for="tx-scope-animal">Animal</label>
               <input type="radio" id="tx-scope-lot" name="tx-scope" value="lot" ${scope === "lot" ? "checked" : ""} />
               <label for="tx-scope-lot">Lote</label>
             </div>
           </div>

           <div class="field" id="tx-animal-field" ${scope === "animal" ? "" : "hidden"}>
             <label class="field-label" for="tx-animal">Animal</label>
             <select class="select" id="tx-animal">
               <option value="">Selecione</option>
               ${animalOptions}
             </select>
             <p class="field-error" id="tx-animal-error"></p>
           </div>

           <div class="field" id="tx-lot-field" ${scope === "lot" ? "" : "hidden"}>
             <label class="field-label" for="tx-lot">Lote</label>
             <select class="select" id="tx-lot">
               <option value="">Selecione</option>
               ${lotOptions}
             </select>
             <p class="field-error" id="tx-lot-error"></p>
           </div>

           <div class="field">
             <label class="field-label" for="tx-description">Descrição</label>
             <textarea class="textarea" id="tx-description" placeholder="Opcional">${transaction?.description ? escapeHtml(transaction.description) : ""}</textarea>
           </div>

           <p class="field-error" id="tx-form-error" role="alert"></p>
           <button type="submit" class="btn-primary pressable" id="tx-submit">${transaction ? "Salvar alterações" : "Salvar lançamento"}</button>
         </form>
       `;
     }

     export function wireTransactionForm(transaction = null) {
       const form = document.getElementById("tx-form");
       const categorySelect = document.getElementById("tx-category");
       const amountInput = document.getElementById("tx-amount");
       const scopeAnimalField = document.getElementById("tx-animal-field");
       const scopeLotField = document.getElementById("tx-lot-field");
       const irField = document.getElementById("tx-ir-field");
       const buyerField = document.getElementById("tx-buyer-field");
       const submitBtn = document.getElementById("tx-submit");
       const formError = document.getElementById("tx-form-error");
       const allFieldIds = ["tx-category", "tx-amount", "tx-date", "tx-animal", "tx-lot"];

       function kindValue() {
         return form.querySelector('input[name="tx-kind"]:checked').value;
       }
       function scopeValue() {
         return form.querySelector('input[name="tx-scope"]:checked').value;
       }

       function setIrDeduct(value) {
         const target = value || IR_DEDUCT.DEDUTIVEL;
         form.querySelectorAll('input[name="tx-ir-deduct"]').forEach((r) => { r.checked = r.value === target; });
       }
       function syncIrVisibility() {
         irField.hidden = kindValue() !== "despesa";
       }
       function syncBuyerVisibility() {
         buyerField.hidden = !(kindValue() === "receita" && categorySelect.value === "venda-animal");
       }

       // preselect is only honored on the initial call (edit prefill); a
       // manual kind toggle always resets the category, since the two
       // kinds' category lists don't overlap. resetIr mirrors that: false
       // only for the initial prefill, where the IR radios are already
       // correctly baked into the markup (transaction.irDeductible, or the
       // stored category's default).
       function syncCategoryOptions(preselect, resetIr = true) {
         categorySelect.innerHTML = categorySelectOptionsHTML(kindValue(), preselect);
         if (resetIr) setIrDeduct(categoryDefaultDeduct(categorySelect.value));
       }
       form.querySelectorAll('input[name="tx-kind"]').forEach((r) => r.addEventListener("change", () => {
         syncCategoryOptions();
         syncIrVisibility();
         syncBuyerVisibility();
       }));
       categorySelect.addEventListener("change", () => {
         setIrDeduct(categoryDefaultDeduct(categorySelect.value));
         syncBuyerVisibility();
       });
       syncCategoryOptions(transaction?.category, false);
       syncIrVisibility();
       syncBuyerVisibility();

       function syncScope() {
         const scope = scopeValue();
         scopeAnimalField.hidden = scope !== "animal";
         scopeLotField.hidden = scope !== "lot";
       }
       form.querySelectorAll('input[name="tx-scope"]').forEach((r) => r.addEventListener("change", syncScope));
       syncScope();

       amountInput.addEventListener("input", () => formatCurrencyInput(amountInput));

       form.addEventListener("submit", async (e) => {
         e.preventDefault();
         if (!currentUid) return;

         formError.textContent = "";
         allFieldIds.forEach(clearFieldError);

         let valid = true;
         const fail = (id, msg) => { valid = false; setFieldError(id, msg); };

         const kind = kindValue();

         const category = categorySelect.value;
         if (!category) fail("tx-category", "Selecione a categoria.");

         const amount = parseBRLToNumber(amountInput.value);
         if (!Number.isFinite(amount) || amount <= 0) fail("tx-amount", "Informe o valor.");

         const dateStr = document.getElementById("tx-date").value;
         if (!dateStr) fail("tx-date", "Informe a data.");

         const scope = scopeValue();
         const animalId = document.getElementById("tx-animal").value || null;
         const lotId = document.getElementById("tx-lot").value || null;
         if (scope === "animal" && !animalId) fail("tx-animal", "Selecione um animal.");
         if (scope === "lot" && !lotId) fail("tx-lot", "Selecione um lote.");

         const description = document.getElementById("tx-description").value.trim() || null;

         if (!valid) return;

         const date = new Date(`${dateStr}T00:00:00`);
         const irDeductible = kind === "despesa" ? form.querySelector('input[name="tx-ir-deduct"]:checked').value : null;
         const buyerType = (kind === "receita" && category === "venda-animal")
           ? form.querySelector('input[name="tx-buyer-type"]:checked').value : null;

         submitBtn.disabled = true;
         submitBtn.textContent = "Salvando…";

         const payload = {
           kind,
           category,
           costNature: null,
           irDeductible,
           buyerType,
           amountBRL: amount,
           date,
           linkedScope: scope,
           linkedAnimalId: scope === "animal" ? animalId : null,
           linkedLotId: scope === "lot" ? lotId : null,
           description,
         };

         try {
           if (transaction) {
             // Editar: updateDoc on the existing document — never recreate.
             await updateDoc(doc(db, "transactions", transaction.id), { ...payload, updatedAt: serverTimestamp() });
             showToast("Lançamento atualizado.");
           } else {
             await addDoc(collection(db, "transactions"), { ownerId: currentUid, ...payload, createdAt: serverTimestamp() });
             showToast("Lançamento salvo.");
           }
           Sheet.close();
         } catch (err) {
           console.warn("[Agro Connect] Falha ao salvar lançamento:", err?.code ?? err);
           showToast(
             err?.code === "permission-denied" ? "Sem permissão para gravar." : "Não foi possível salvar. Tente novamente."
           );
           submitBtn.disabled = false;
           submitBtn.textContent = transaction ? "Salvar alterações" : "Salvar lançamento";
         }
       });
     }

     export function openNewTransactionSheet() {
       Sheet.open({
         title: "Nova transação",
         content: buildTransactionFormHTML(animalsCache, lotsCache, null),
       });
       wireTransactionForm(null);
     }

     export function openEditTransactionSheet(transaction) {
       Sheet.open({
         title: "Editar lançamento",
         content: buildTransactionFormHTML(animalsCache, lotsCache, transaction),
       });
       wireTransactionForm(transaction);
     }

     // --- Excluir transação ---
     export function buildDeleteTransactionHTML(transaction) {
       return `
         <div class="form-grid">
           <div class="confirm-warning">
             <span class="confirm-warning-icon" aria-hidden="true">${ICONS.warning}</span>
             <p>Tem certeza que deseja excluir o lançamento de <strong>${escapeHtml(categoryDisplayLabel(transaction.category))}</strong> no valor de <strong>${formatBRL(transaction.amountBRL)}</strong>? Esta ação não pode ser desfeita.</p>
           </div>
           <div class="confirm-actions">
             <button type="button" class="btn-secondary pressable" id="delete-tx-cancel">Cancelar</button>
             <button type="button" class="btn-primary btn-danger pressable" id="delete-tx-confirm">Excluir lançamento</button>
           </div>
         </div>
       `;
     }

     export function wireDeleteTransactionForm(transaction) {
       const cancelBtn = document.getElementById("delete-tx-cancel");
       const confirmBtn = document.getElementById("delete-tx-confirm");

       cancelBtn.addEventListener("click", () => Sheet.close());

       confirmBtn.addEventListener("click", async () => {
         if (!currentUid) return;
         confirmBtn.disabled = true;
         cancelBtn.disabled = true;
         confirmBtn.textContent = "Excluindo…";

         try {
           await deleteDoc(doc(db, "transactions", transaction.id));
           showToast("Lançamento excluído.");
           Sheet.close();
         } catch (err) {
           console.warn("[Agro Connect] Falha ao excluir lançamento:", err?.code ?? err);
           showToast(
             err?.code === "permission-denied" ? "Sem permissão para excluir." : "Não foi possível excluir. Tente novamente."
           );
           confirmBtn.disabled = false;
           cancelBtn.disabled = false;
           confirmBtn.textContent = "Excluir lançamento";
         }
       });
     }

     export function openDeleteTransactionSheet(transaction) {
       Sheet.open({ title: "Excluir lançamento", content: buildDeleteTransactionHTML(transaction) });
       wireDeleteTransactionForm(transaction);
     }

     // --- Transaction row "..." action menu (Editar / Excluir) ---
     export function buildTxActionMenuHTML() {
       return `
         <div class="action-list">
           <button type="button" class="action-item pressable" data-menu-action="edit">
             <span class="action-icon" aria-hidden="true">${ICONS.edit}</span>
             Editar
           </button>
           <button type="button" class="action-item danger pressable" data-menu-action="delete">
             <span class="action-icon" aria-hidden="true">${ICONS.delete}</span>
             Excluir
           </button>
         </div>
       `;
     }

     export function openTxActionSheet(transaction) {
       Sheet.open({ title: "Ações do lançamento", content: buildTxActionMenuHTML() });
       document.querySelectorAll("#sheet-body [data-menu-action]").forEach((btn) => {
         btn.addEventListener("click", () => {
           if (btn.dataset.menuAction === "edit") openEditTransactionSheet(transaction);
           else if (btn.dataset.menuAction === "delete") openDeleteTransactionSheet(transaction);
           else Sheet.close();
         });
       });
     }

     txListEl.addEventListener("click", (e) => {
       const btn = e.target.closest('[data-action="tx-menu"]');
       if (!btn) return;
       const t = transactionsCache.find((x) => x.id === btn.dataset.id);
       if (t) openTxActionSheet(t);
     });
