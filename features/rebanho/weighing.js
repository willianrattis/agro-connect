import { db, doc, serverTimestamp, collection, writeBatch } from "../../js/core/firebase.js";
import { KG_PER_ARROBA, ICONS } from "../../js/core/constants.js";
import {
  escapeHtml, toDateSafe, toDateInputValue, formatKg, formatArrobas, printHTML, resolveFarmYieldPct,
} from "../../js/core/helpers.js";
import { currentUid, animalsCache, eventsCache, propertiesCache, lotWeighingsCache } from "../../js/core/state.js";
import { Sheet } from "../../js/core/sheet.js";
import { showToast } from "../../js/core/auth.js";
import { clearFieldError, setFieldError } from "./animals.js";

     // Weighing sessions for one lot, newest first. The listener already orders
     // by date desc, but re-sorting keeps this correct if the cache is ever
     // populated from another path.
     export function lotWeighingsFor(lotId) {
       return lotWeighingsCache
         .filter((w) => w.lotId === lotId)
         .slice()
         .sort((a, b) => (toDateSafe(b.date) ?? 0) - (toDateSafe(a.date) ?? 0));
     }

     export function weighingArrobas(lot, weighing) {
       const yieldPct = resolveFarmYieldPct(lot);
       if (!Number.isFinite(weighing.avgWeightKg) || !Number.isFinite(yieldPct) || yieldPct <= 0) {
         return { perHead: null, total: null };
       }
       const perHead = (weighing.avgWeightKg * yieldPct) / KG_PER_ARROBA;
       const head = weighing.headcountAtWeighing || 0;
       return { perHead, total: head ? perHead * head : null };
     }

     export function buildLotWeighingFormHTML(lot) {
       const isIndividual = (lot.trackingMode || "individual") === "individual";
       const activeAnimals = isIndividual
         ? animalsCache.filter((a) => a.lotId === lot.id && (a.status || "active") === "active")
         : [];
       const weighableCount = isIndividual ? activeAnimals.length : (lot.headcount || 0);
       const PAGE_SIZE = 5;
       const totalPages = Math.max(1, Math.ceil(weighableCount / PAGE_SIZE));
       const showIndividuals = weighableCount > 0;

       return `
         <form id="lot-weighing-form" class="form-grid" novalidate>
           <div class="lot-weighing-sticky-top form-grid">
             <div class="field field--half">
               <label class="field-label" for="lot-weighing-date">Data da pesagem *</label>
               <input class="input" id="lot-weighing-date" type="date" value="${toDateInputValue(new Date())}" />
               <p class="field-error" id="lot-weighing-date-error"></p>
             </div>
             <div class="field field--half">
               <label class="field-label" for="lot-weighing-avg">Peso médio (kg) *</label>
               <input class="input" id="lot-weighing-avg" type="number" step="0.01" min="0" placeholder="Ex: 240" inputmode="decimal" />
               <p class="field-error" id="lot-weighing-avg-error"></p>
             </div>
             ${showIndividuals ? `
               <div class="card-stats" style="grid-template-columns: repeat(2, 1fr);">
                 <div class="mini-stat">
                   <p class="mini-value" id="lot-weighing-arroba-head">—</p>
                   <p class="mini-label">@ por cabeça</p>
                 </div>
                 <div class="mini-stat">
                   <p class="mini-value" id="lot-weighing-arroba-total">—</p>
                   <p class="mini-label">@ total (${weighableCount} cab.)</p>
                 </div>
               </div>
               <div class="field">
                 <label class="field-label">Pesagens individuais</label>
                 <p class="field-hint" id="lot-weighing-count-hint">0 de ${weighableCount} pesados</p>
               </div>
             ` : ""}
           </div>
           ${showIndividuals ? `
             <div class="field">
               <div id="lot-weighing-individual-list" class="form-grid"></div>
               ${isIndividual ? `<datalist id="lot-weighing-tag-options"></datalist>` : ""}
               ${totalPages > 1 ? `
                 <div style="display: flex; align-items: center; justify-content: space-between; margin-top: var(--space-3);">
                   <button type="button" id="lot-weighing-prev-page" class="btn-secondary pressable" disabled>← Anterior</button>
                   <span id="lot-weighing-page-indicator" class="field-hint">Página 1 de ${totalPages}</span>
                   <button type="button" id="lot-weighing-next-page" class="btn-secondary pressable">Próxima →</button>
                 </div>
               ` : ""}
             </div>
           ` : ""}
           <p class="field-error" id="lot-weighing-form-error" role="alert"></p>
           <button type="submit" class="btn-primary pressable" id="lot-weighing-submit">Salvar pesagem</button>
         </form>
       `;
     }

     export function wireLotWeighingForm(lot) {
       const form = document.getElementById("lot-weighing-form");
       const submitBtn = document.getElementById("lot-weighing-submit");
       const formError = document.getElementById("lot-weighing-form-error");

       const isIndividual = (lot.trackingMode || "individual") === "individual";
       const activeAnimals = isIndividual
         ? animalsCache.filter((a) => a.lotId === lot.id && (a.status || "active") === "active")
         : [];
       const weighableCount = isIndividual ? activeAnimals.length : (lot.headcount || 0);
       const PAGE_SIZE = 5;
       const totalPages = Math.max(1, Math.ceil(weighableCount / PAGE_SIZE));
       const yieldPct = resolveFarmYieldPct(lot);

       const individualWeights = new Array(weighableCount).fill(null);
       const individualTags = new Array(weighableCount).fill(null);
       let currentPage = 0;

       const listEl = document.getElementById("lot-weighing-individual-list");
       const avgEl = document.getElementById("lot-weighing-avg");
       const arrobaHeadEl = document.getElementById("lot-weighing-arroba-head");
       const arrobaTotalEl = document.getElementById("lot-weighing-arroba-total");
       const countHintEl = document.getElementById("lot-weighing-count-hint");
       const prevBtn = document.getElementById("lot-weighing-prev-page");
       const nextBtn = document.getElementById("lot-weighing-next-page");
       const pageInd = document.getElementById("lot-weighing-page-indicator");
       const tagOptionsEl = document.getElementById("lot-weighing-tag-options");

       // Suggestions are shared across every tag input (one <datalist> for
       // the whole form), so a tag already typed in any row drops out of
       // everyone else's suggestions too — the row that owns it doesn't need
       // to see it again once entered.
       function updateTagOptions() {
         if (!isIndividual || !tagOptionsEl) return;
         const used = new Set(
           individualTags.filter((t) => t).map((t) => t.trim().toLowerCase())
         );
         const available = activeAnimals.filter(
           (a) => !used.has((a.earTag || "").trim().toLowerCase())
         );
         tagOptionsEl.innerHTML = available.map((a) => `<option value="${escapeHtml(a.earTag)}"></option>`).join("");
       }

       function renderPage() {
         if (!listEl) return;
         const start = currentPage * PAGE_SIZE;
         const end = Math.min(start + PAGE_SIZE, weighableCount);
         const rows = [];
         for (let i = start; i < end; i++) {
           const v = individualWeights[i];
           if (isIndividual) {
             const tag = individualTags[i];
             rows.push(`
               <div class="lot-weighing-row" style="display: flex; gap: var(--space-2);">
                 <input class="input" type="text" list="lot-weighing-tag-options" placeholder="Brinco"
                        data-role="individual-tag" data-index="${i}"
                        value="${tag ? escapeHtml(tag) : ""}" style="flex: 1;" />
                 <input class="input" type="number" step="0.01" min="0" inputmode="decimal"
                        placeholder="Peso (kg)"
                        data-role="individual-weight" data-index="${i}"
                        value="${v != null ? v : ""}" style="flex: 1;" />
               </div>
             `);
           } else {
             rows.push(`
               <input class="input" type="number" step="0.01" min="0" inputmode="decimal"
                      placeholder="Peso ${i + 1} (kg)"
                      data-role="individual-weight" data-index="${i}"
                      value="${v != null ? v : ""}" />
             `);
           }
         }
         listEl.innerHTML = rows.join("");
         if (prevBtn) prevBtn.disabled = currentPage === 0;
         if (nextBtn) nextBtn.disabled = currentPage >= totalPages - 1;
         if (pageInd) pageInd.textContent = `Página ${currentPage + 1} de ${totalPages}`;
         updateTagOptions();
       }

       function updateArrobaDisplay(pesoKg) {
         if (!arrobaHeadEl || !arrobaTotalEl) return;
         if (!Number.isFinite(pesoKg) || pesoKg <= 0 || !Number.isFinite(yieldPct) || yieldPct <= 0) {
           arrobaHeadEl.textContent = "—";
           arrobaTotalEl.textContent = "—";
           return;
         }
         const perHead = (pesoKg * yieldPct) / KG_PER_ARROBA;
         arrobaHeadEl.textContent = `${formatArrobas(perHead)} @`;
         arrobaTotalEl.textContent = `${formatArrobas(perHead * weighableCount)} @`;
       }

       function recomputeAverage() {
         const valid = individualWeights.filter((w) => Number.isFinite(w) && w > 0);
         if (countHintEl) countHintEl.textContent = `${valid.length} de ${weighableCount} pesados`;
         if (valid.length === 0) {
           updateArrobaDisplay(parseFloat(avgEl.value));
           return;
         }
         const avg = valid.reduce((s, w) => s + w, 0) / valid.length;
         avgEl.value = avg.toFixed(2);
         updateArrobaDisplay(avg);
       }

       function focusFirstRow() {
         const first = isIndividual
           ? listEl.querySelector('[data-role="individual-tag"]')
           : listEl.querySelector('[data-role="individual-weight"]');
         if (first) first.focus();
       }

       if (listEl) {
         listEl.addEventListener("input", (e) => {
           const t = e.target;
           if (t.matches('[data-role="individual-weight"]')) {
             const idx = parseInt(t.dataset.index, 10);
             const val = parseFloat(t.value);
             individualWeights[idx] = Number.isFinite(val) && val > 0 ? val : null;
             recomputeAverage();
           } else if (isIndividual && t.matches('[data-role="individual-tag"]')) {
             const idx = parseInt(t.dataset.index, 10);
             individualTags[idx] = t.value || null;
             updateTagOptions();
           }
         });

         listEl.addEventListener("keydown", (e) => {
           if (e.key !== "Enter") return;
           const t = e.target;

           if (isIndividual && t.matches('[data-role="individual-tag"]')) {
             e.preventDefault();
             const idx = parseInt(t.dataset.index, 10);
             listEl.querySelector(`[data-role="individual-weight"][data-index="${idx}"]`)?.focus();
             return;
           }

           if (!t.matches('[data-role="individual-weight"]')) return;
           e.preventDefault();

           if (isIndividual) {
             const idx = parseInt(t.dataset.index, 10);
             const nextTag = listEl.querySelector(`[data-role="individual-tag"][data-index="${idx + 1}"]`);
             if (nextTag) {
               nextTag.focus();
             } else if (currentPage < totalPages - 1) {
               currentPage++;
               renderPage();
               focusFirstRow();
             } else {
               submitBtn.focus();
             }
             return;
           }

           const inputs = Array.from(listEl.querySelectorAll('[data-role="individual-weight"]'));
           const idx = inputs.indexOf(t);
           if (idx < inputs.length - 1) {
             inputs[idx + 1].focus();
           } else if (currentPage < totalPages - 1) {
             currentPage++;
             renderPage();
             focusFirstRow();
           } else {
             submitBtn.focus();
           }
         });
       }

       avgEl.addEventListener("input", () => updateArrobaDisplay(parseFloat(avgEl.value)));

       if (prevBtn) prevBtn.addEventListener("click", () => {
         if (currentPage > 0) {
           currentPage--;
           renderPage();
           focusFirstRow();
         }
       });
       if (nextBtn) nextBtn.addEventListener("click", () => {
         if (currentPage < totalPages - 1) {
           currentPage++;
           renderPage();
           focusFirstRow();
         }
       });

       if (weighableCount > 0) renderPage();

       form.addEventListener("submit", async (e) => {
         e.preventDefault();
         if (!currentUid) return;

         formError.textContent = "";
         ["lot-weighing-date", "lot-weighing-avg"].forEach(clearFieldError);

         let valid = true;
         const fail = (id, msg) => { valid = false; setFieldError(id, msg); };

         const dateStr = document.getElementById("lot-weighing-date").value;
         const weighingDate = dateStr ? new Date(`${dateStr}T00:00:00`) : null;
         if (!dateStr || !weighingDate) fail("lot-weighing-date", "Informe a data da pesagem.");
         else if (weighingDate > new Date()) fail("lot-weighing-date", "A data não pode ser no futuro.");

         const avgWeightKg = parseFloat(document.getElementById("lot-weighing-avg").value);
         if (!Number.isFinite(avgWeightKg) || avgWeightKg <= 0) fail("lot-weighing-avg", "Informe o peso médio.");

         // Fresh read of active animals at submit time (an animal could have
         // been sold/died while the sheet was open), used both to validate
         // ear tags and to build the matched entries below.
         const freshActiveAnimals = isIndividual
           ? animalsCache.filter((a) => a.lotId === lot.id && (a.status || "active") === "active")
           : [];
         const headcountAtWeighing = isIndividual ? freshActiveAnimals.length : (lot.headcount || 0);

         const validWeights = individualWeights.filter((w) => Number.isFinite(w) && w > 0);

         // A row needs BOTH a tag and a weight to become a matched entry — a
         // tag alone (no weight) is silently ignored, per spec.
         const individualEntries = [];
         if (isIndividual) {
           const seenTags = new Set();
           for (let i = 0; i < weighableCount && valid; i++) {
             const rawTag = individualTags[i];
             const tag = rawTag ? rawTag.trim() : "";
             const weightKg = individualWeights[i];
             if (!tag || weightKg == null) continue;

             const normalized = tag.toLowerCase();
             const animal = freshActiveAnimals.find(
               (a) => (a.earTag || "").trim().toLowerCase() === normalized
             );
             if (!animal) {
               valid = false;
               formError.textContent = "Brinco não encontrado neste lote.";
               break;
             }
             if (seenTags.has(normalized)) {
               valid = false;
               formError.textContent = "Brinco repetido.";
               break;
             }
             seenTags.add(normalized);
             individualEntries.push({ animalId: animal.id, earTag: animal.earTag, weightKg });
           }
         }

         if (!valid) return;

         submitBtn.disabled = true;
         submitBtn.textContent = "Salvando…";

         try {
           const batch = writeBatch(db);

           // Generates an id client-side without a write, so events can reference it
           // inside the same batch.
           const weighingRef = doc(collection(db, "lot_weighings"));
           batch.set(weighingRef, {
             ownerId: currentUid,
             lotId: lot.id,
             date: weighingDate,
             avgWeightKg,
             individualWeights: validWeights.length ? validWeights : null,
             individualEntries: individualEntries.length ? individualEntries : null,
             headcountAtWeighing,
             trackingMode: isIndividual ? "individual" : "aggregate",
             createdAt: serverTimestamp(),
             updatedAt: serverTimestamp(),
           });

           batch.update(doc(db, "lots", lot.id), {
             avgWeightKg,
             lastWeighingDate: weighingDate,
             updatedAt: serverTimestamp(),
           });

           if (isIndividual) {
             // TODO: lots with > ~490 active animals will exceed Firestore's
             // 500-op batch limit (1 lot update + 1 weighing doc + 1 event per
             // animal) — needs chunked batches (see deleteLotCascade) as a
             // follow-up.
             const matchedByAnimalId = new Map(individualEntries.map((entry) => [entry.animalId, entry.weightKg]));
             freshActiveAnimals.forEach((animal) => {
               const weightKg = matchedByAnimalId.has(animal.id) ? matchedByAnimalId.get(animal.id) : avgWeightKg;
               const eventRef = doc(collection(db, "events"));
               batch.set(eventRef, {
                 ownerId: currentUid,
                 type: "weighing",
                 animalId: animal.id,
                 lotId: lot.id,
                 date: weighingDate,
                 payload: { weightKg },
                 source: "lot_weighing",
                 lotWeighingId: weighingRef.id,
                 createdAt: serverTimestamp(),
               });
             });
           }

           await batch.commit();
           showToast("Pesagem do lote registrada.");
           Sheet.close();
         } catch (err) {
           console.warn("[Agro Connect] Falha ao registrar pesagem do lote:", err?.code ?? err);
           formError.textContent =
             err?.code === "permission-denied"
               ? "Sem permissão para gravar."
               : "Não foi possível salvar. Tente novamente.";
           submitBtn.disabled = false;
           submitBtn.textContent = "Salvar pesagem";
         }
       });
     }

     export function openLotWeighingSheet(lot) {
       Sheet.open({ title: `Pesar lote · ${escapeHtml(lot.name)}`, content: buildLotWeighingFormHTML(lot) });
       wireLotWeighingForm(lot);
     }

     export function buildLotWeighingHistoryHTML(lot) {
       const weighings = lotWeighingsFor(lot.id);
       if (!weighings.length) {
         return `
           <div class="form-grid">
             <div class="empty-state">
               <span class="icon" aria-hidden="true">${ICONS.history}</span>
               <h3>Nenhuma pesagem registrada</h3>
               <p>Use "Pesar lote" no menu do lote para registrar a primeira. Pesagens feitas antes desta versão do app não aparecem aqui.</p>
             </div>
           </div>
         `;
       }
       const rows = weighings.map((w, i) => {
         const d = toDateSafe(w.date);
         const { perHead } = weighingArrobas(lot, w);
         const sampled = Array.isArray(w.individualWeights) ? w.individualWeights.length : 0;
         return `
           <div class="card pressable" data-role="weighing-row" data-id="${escapeHtml(w.id)}" style="margin-bottom: var(--space-3);">
             <div class="card-top">
               <span class="ear-tag">${d ? d.toLocaleDateString("pt-BR") : "—"}</span>
               ${i === 0 ? `<span class="chip chip-success">Mais recente</span>` : ""}
             </div>
             <div class="card-stats" style="grid-template-columns: repeat(3, 1fr);">
               <div class="mini-stat">
                 <p class="mini-value">${formatKg(w.avgWeightKg)} kg</p>
                 <p class="mini-label">Peso médio</p>
               </div>
               <div class="mini-stat">
                 <p class="mini-value">${perHead != null ? `${formatArrobas(perHead)} @` : "—"}</p>
                 <p class="mini-label">@ por cabeça</p>
               </div>
               <div class="mini-stat">
                 <p class="mini-value">${sampled || "—"}</p>
                 <p class="mini-label">Pesados</p>
               </div>
             </div>
           </div>
         `;
       }).join("");
       return `
         <div class="form-grid">
           <button type="button" id="weighing-history-print" class="btn-secondary pressable">
             <span class="action-icon" aria-hidden="true">${ICONS.print}</span>
             Imprimir histórico
           </button>
           ${rows}
         </div>
       `;
     }

     export function openLotWeighingHistorySheet(lot) {
       Sheet.open({
         title: `Pesagens · ${escapeHtml(lot.name)}`,
         content: buildLotWeighingHistoryHTML(lot),
       });
       const printBtn = document.getElementById("weighing-history-print");
       if (printBtn) {
         printBtn.addEventListener("click", () => printHTML(buildWeighingHistoryPrintHTML(lot)));
       }
       document.querySelectorAll('#sheet-body [data-role="weighing-row"]').forEach((row) => {
         row.addEventListener("click", () => {
           const w = lotWeighingsCache.find((x) => x.id === row.dataset.id);
           if (w) openLotWeighingDetailSheet(lot, w);
         });
       });
     }

     // Zips the flat individualWeights sample against the (smaller) set of
     // tag-matched entries, by value, so each row can show "#<earTag>" when
     // attributed or fall back to its positional index otherwise. There's no
     // stored index linking the two arrays — matching by value is the best
     // available signal, and duplicate weight values are rare enough that a
     // display-only mismatch there is an acceptable trade-off.
     function weighingDisplayRows(weights, entries) {
       const remaining = entries.slice();
       return weights.map((weightKg) => {
         const idx = remaining.findIndex((entry) => entry.weightKg === weightKg);
         if (idx === -1) return { earTag: null, weightKg };
         const [entry] = remaining.splice(idx, 1);
         return { earTag: entry.earTag, weightKg };
       });
     }

     export function buildLotWeighingDetailHTML(lot, w) {
       const d = toDateSafe(w.date);
       const { perHead, total } = weighingArrobas(lot, w);
       const weights = Array.isArray(w.individualWeights) ? w.individualWeights : [];
       const hasIndividualEntries = Array.isArray(w.individualEntries) && w.individualEntries.length > 0;
       const mostRecent = lotWeighingsFor(lot.id)[0];
       // Weighings with ear-tag attributions never get the edit UI, even when
       // most recent — saveWeighingEdit rewrites weights anonymously and would
       // silently invalidate the attributions (see saveWeighingEdit).
       const isEditable = mostRecent && mostRecent.id === w.id && !hasIndividualEntries;

       let grid;
       if (isEditable) {
         grid = `
           <div class="field">
             <label class="field-label">Pesagens individuais (<span id="weighing-edit-count">${weights.length}</span>)</label>
             <p class="field-hint">Editar um valor recalcula o peso médio. As linhas são a amostra usada no cálculo — não representam animais específicos.</p>
             <div class="weighing-detail-scroll">
               <table class="weighing-detail-table">
                 <thead><tr><th>#</th><th class="num">Peso (kg)</th><th></th></tr></thead>
                 <tbody id="weighing-edit-body"></tbody>
               </table>
             </div>
             <button type="button" id="weighing-edit-add" class="btn-secondary pressable" style="margin-top: var(--space-2);">+ Adicionar linha</button>
           </div>
           <div class="card-stats" style="grid-template-columns: repeat(2, 1fr);">
             <div class="mini-stat">
               <p class="mini-value" id="weighing-edit-avg">${formatKg(w.avgWeightKg)} kg</p>
               <p class="mini-label">Peso médio (recalculado)</p>
             </div>
             <div class="mini-stat">
               <p class="mini-value" id="weighing-edit-arroba">—</p>
               <p class="mini-label">@ por cabeça</p>
             </div>
           </div>
         `;
       } else if (weights.length) {
         const displayRows = weighingDisplayRows(weights, hasIndividualEntries ? w.individualEntries : []);
         grid = `
           <div class="field">
             <label class="field-label">Pesagens individuais (${weights.length})</label>
             <p class="field-hint">${hasIndividualEntries
               ? "Pesagens com brinco ainda não podem ser editadas."
               : "Somente a pesagem mais recente do lote pode ser editada."}</p>
             <div class="weighing-detail-scroll">
               <table class="weighing-detail-table">
                 <thead>
                   <tr><th>#</th><th class="num">Peso</th></tr>
                 </thead>
                 <tbody>
                   ${displayRows.map((row, i) => `
                     <tr><td>${row.earTag ? `#${escapeHtml(row.earTag)}` : `#${i + 1}`}</td><td class="num">${formatKg(row.weightKg)} kg</td></tr>
                   `).join("")}
                 </tbody>
               </table>
             </div>
           </div>
         `;
       } else {
         grid = `<p class="field-hint">Peso médio informado diretamente, sem pesagens individuais.</p>`;
       }

       return `
         <div class="form-grid">
           <div class="card-stats" style="grid-template-columns: repeat(2, 1fr);">
             <div class="mini-stat">
               <p class="mini-value">${d ? d.toLocaleDateString("pt-BR") : "—"}</p>
               <p class="mini-label">Data</p>
             </div>
             <div class="mini-stat">
               <p class="mini-value">${w.headcountAtWeighing || "—"}</p>
               <p class="mini-label">Cabeças</p>
             </div>
             <div class="mini-stat">
               <p class="mini-value">${formatKg(w.avgWeightKg)} kg</p>
               <p class="mini-label">Peso médio</p>
             </div>
             <div class="mini-stat">
               <p class="mini-value">${perHead != null ? `${formatArrobas(perHead)} @` : "—"}</p>
               <p class="mini-label">@ por cabeça</p>
             </div>
             <div class="mini-stat">
               <p class="mini-value">${total != null ? `${formatArrobas(total)} @` : "—"}</p>
               <p class="mini-label">@ total</p>
             </div>
           </div>
           ${grid}
           ${isEditable ? `
             <button type="button" id="weighing-edit-save" class="btn-primary pressable" hidden>Salvar alterações</button>
             <p class="field-error" id="weighing-edit-error" role="alert"></p>
           ` : ""}
           <button type="button" id="weighing-detail-print" class="btn-secondary pressable">
             <span class="action-icon" aria-hidden="true">${ICONS.print}</span>
             Imprimir esta pesagem
           </button>
           <button type="button" id="weighing-detail-back" class="btn-secondary pressable">← Voltar ao histórico</button>
         </div>
       `;
     }

     export function openLotWeighingDetailSheet(lot, w) {
       const d = toDateSafe(w.date);
       Sheet.open({
         title: `Pesagem · ${d ? d.toLocaleDateString("pt-BR") : ""}`,
         content: buildLotWeighingDetailHTML(lot, w),
       });
       document.getElementById("weighing-detail-print")
         ?.addEventListener("click", () => printHTML(buildWeighingDetailPrintHTML(lot, w)));
       document.getElementById("weighing-detail-back")
         ?.addEventListener("click", () => openLotWeighingHistorySheet(lot));

       const mostRecent = lotWeighingsFor(lot.id)[0];
       const hasIndividualEntries = Array.isArray(w.individualEntries) && w.individualEntries.length > 0;
       const isEditable = mostRecent && mostRecent.id === w.id && !hasIndividualEntries;

       if (isEditable) {
         const yieldPct = resolveFarmYieldPct(lot);
         let editedWeights = (Array.isArray(w.individualWeights) ? w.individualWeights : []).slice();
         const original = JSON.stringify(editedWeights);

         const bodyEl = document.getElementById("weighing-edit-body");
         const countEl = document.getElementById("weighing-edit-count");
         const avgEl = document.getElementById("weighing-edit-avg");
         const arrobaEl = document.getElementById("weighing-edit-arroba");
         const saveBtn = document.getElementById("weighing-edit-save");
         const addBtn = document.getElementById("weighing-edit-add");
         const errEl = document.getElementById("weighing-edit-error");

         function currentAvg() {
           const valid = editedWeights.filter((x) => Number.isFinite(x) && x > 0);
           return valid.length ? valid.reduce((s, x) => s + x, 0) / valid.length : null;
         }

         function renderRows() {
           bodyEl.innerHTML = editedWeights.map((kg, i) => `
             <tr>
               <td>#${i + 1}</td>
               <td class="num">
                 <input class="input" type="number" step="0.01" min="0" inputmode="decimal"
                        data-role="edit-weight" data-index="${i}"
                        value="${Number.isFinite(kg) ? kg : ""}" style="text-align: right; max-width: 120px;" />
               </td>
               <td class="num">
                 <button type="button" class="btn-icon pressable" data-role="edit-remove" data-index="${i}" aria-label="Remover">✕</button>
               </td>
             </tr>
           `).join("");
           if (countEl) countEl.textContent = String(editedWeights.length);
         }

         function refreshDisplay() {
           const avg = currentAvg();
           if (avgEl) avgEl.textContent = avg != null ? `${formatKg(avg)} kg` : "—";
           if (arrobaEl) {
             arrobaEl.textContent = (avg != null && Number.isFinite(yieldPct) && yieldPct > 0)
               ? `${formatArrobas((avg * yieldPct) / KG_PER_ARROBA)} @`
               : "—";
           }
           const dirty = JSON.stringify(editedWeights) !== original;
           if (saveBtn) saveBtn.hidden = !dirty;
         }

         renderRows();
         refreshDisplay();

         bodyEl.addEventListener("input", (e) => {
           if (!e.target.matches('[data-role="edit-weight"]')) return;
           const idx = parseInt(e.target.dataset.index, 10);
           const val = parseFloat(e.target.value);
           editedWeights[idx] = Number.isFinite(val) && val > 0 ? val : null;
           refreshDisplay();
         });

         bodyEl.addEventListener("click", (e) => {
           const btn = e.target.closest('[data-role="edit-remove"]');
           if (!btn) return;
           editedWeights.splice(parseInt(btn.dataset.index, 10), 1);
           renderRows();
           refreshDisplay();
         });

         addBtn?.addEventListener("click", () => {
           editedWeights.push(null);
           renderRows();
           refreshDisplay();
           const inputs = bodyEl.querySelectorAll('[data-role="edit-weight"]');
           inputs[inputs.length - 1]?.focus();
         });

         saveBtn?.addEventListener("click", () => saveWeighingEdit(lot, w, editedWeights, saveBtn, errEl));
       }
     }

     export async function saveWeighingEdit(lot, w, editedWeights, saveBtn, errEl) {
       if (!currentUid) return;
       errEl.textContent = "";

       const valid = editedWeights.filter((x) => Number.isFinite(x) && x > 0);
       if (!valid.length) {
         errEl.textContent = "Informe ao menos um peso válido.";
         return;
       }
       const newAvg = valid.reduce((s, x) => s + x, 0) / valid.length;

       saveBtn.disabled = true;
       saveBtn.textContent = "Salvando…";

       try {
         const batch = writeBatch(db);
         const weighingDate = toDateSafe(w.date);

         // 1. Update the weighing session.
         batch.update(doc(db, "lot_weighings", w.id), {
           individualWeights: valid,
           avgWeightKg: newAvg,
           updatedAt: serverTimestamp(),
         });

         // 2. Delete previously propagated events for this session, then recreate
         //    them with the new average over the lot's current active animals.
         const isIndividual = (lot.trackingMode || "individual") === "individual";
         if (isIndividual) {
           const oldEvents = eventsCache.filter((ev) => ev.lotWeighingId === w.id);
           oldEvents.forEach((ev) => batch.delete(doc(db, "events", ev.id)));

           const activeAnimals = animalsCache.filter(
             (a) => a.lotId === lot.id && (a.status || "active") === "active"
           );
           // TODO: > ~490 animals exceeds the 500-op batch limit — chunk as follow-up.
           activeAnimals.forEach((animal) => {
             const evRef = doc(collection(db, "events"));
             batch.set(evRef, {
               ownerId: currentUid,
               type: "weighing",
               animalId: animal.id,
               lotId: lot.id,
               date: weighingDate,
               payload: { weightKg: newAvg },
               source: "lot_weighing",
               lotWeighingId: w.id,
               createdAt: serverTimestamp(),
             });
           });
         }

         // 3. Re-anchor the lot — this is the most recent weighing by construction.
         batch.update(doc(db, "lots", lot.id), {
           avgWeightKg: newAvg,
           lastWeighingDate: weighingDate,
           updatedAt: serverTimestamp(),
         });

         await batch.commit();
         showToast("Pesagem atualizada.");
         // Reopen the detail fresh so the new baseline becomes the "original".
         const updated = { ...w, individualWeights: valid, avgWeightKg: newAvg };
         openLotWeighingDetailSheet(lot, updated);
       } catch (err) {
         console.warn("[Agro Connect] Falha ao editar pesagem:", err?.code ?? err);
         errEl.textContent = err?.code === "permission-denied"
           ? "Sem permissão para salvar."
           : "Não foi possível salvar. Tente novamente.";
         saveBtn.disabled = false;
         saveBtn.textContent = "Salvar alterações";
       }
     }

     export function printFooterHTML() {
       return `<p class="print-foot">Agro Connect · emitido em ${new Date().toLocaleString("pt-BR")}</p>`;
     }

     export function buildWeighingHistoryPrintHTML(lot) {
       const weighings = lotWeighingsFor(lot.id);
       const property = propertiesCache.find((p) => p.id === lot.propertyId);
       const rows = weighings.map((w) => {
         const d = toDateSafe(w.date);
         const { perHead, total } = weighingArrobas(lot, w);
         const sampled = Array.isArray(w.individualWeights) ? w.individualWeights.length : 0;
         return `
           <tr>
             <td>${d ? d.toLocaleDateString("pt-BR") : "—"}</td>
             <td class="num">${w.headcountAtWeighing || "—"}</td>
             <td class="num">${formatKg(w.avgWeightKg)} kg</td>
             <td class="num">${perHead != null ? `${formatArrobas(perHead)} @` : "—"}</td>
             <td class="num">${total != null ? `${formatArrobas(total)} @` : "—"}</td>
             <td class="num">${sampled || "—"}</td>
           </tr>
         `;
       }).join("");
       return `
         <div class="print-doc">
           <h1>Histórico de pesagens · ${escapeHtml(lot.name)}</h1>
           <p class="print-sub">${property ? escapeHtml(property.name) : "Sem propriedade"} · ${weighings.length} pesagem(ns)</p>
           <table>
             <thead>
               <tr>
                 <th>Data</th><th class="num">Cabeças</th><th class="num">Peso médio</th>
                 <th class="num">@/cab</th><th class="num">@ total</th><th class="num">Pesados</th>
               </tr>
             </thead>
             <tbody>${rows || `<tr><td colspan="6">Nenhuma pesagem registrada.</td></tr>`}</tbody>
           </table>
           ${printFooterHTML()}
         </div>
       `;
     }

     export function buildWeighingDetailPrintHTML(lot, w) {
       const d = toDateSafe(w.date);
       const property = propertiesCache.find((p) => p.id === lot.propertyId);
       const { perHead, total } = weighingArrobas(lot, w);
       const weights = Array.isArray(w.individualWeights) ? w.individualWeights : [];
       const hasIndividualEntries = Array.isArray(w.individualEntries) && w.individualEntries.length > 0;
       const displayRows = weighingDisplayRows(weights, hasIndividualEntries ? w.individualEntries : []);
       const indivRows = displayRows.map((row, i) => `<tr><td>${row.earTag ? `#${escapeHtml(row.earTag)}` : `#${i + 1}`}</td><td class="num">${formatKg(row.weightKg)} kg</td></tr>`).join("");
       return `
         <div class="print-doc">
           <h1>Pesagem de lote · ${escapeHtml(lot.name)}</h1>
           <p class="print-sub">${property ? escapeHtml(property.name) : "Sem propriedade"} · ${d ? d.toLocaleDateString("pt-BR") : "—"}</p>
           <table>
             <tbody>
               <tr><th>Cabeças</th><td class="num">${w.headcountAtWeighing || "—"}</td></tr>
               <tr><th>Peso médio</th><td class="num">${formatKg(w.avgWeightKg)} kg</td></tr>
               <tr><th>@ por cabeça</th><td class="num">${perHead != null ? `${formatArrobas(perHead)} @` : "—"}</td></tr>
               <tr><th>@ total</th><td class="num">${total != null ? `${formatArrobas(total)} @` : "—"}</td></tr>
               <tr><th>Pesagens individuais</th><td class="num">${weights.length || "—"}</td></tr>
             </tbody>
           </table>
           ${weights.length ? `
             <table style="margin-top: 12pt;">
               <thead><tr><th>#</th><th class="num">Peso</th></tr></thead>
               <tbody>${indivRows}</tbody>
             </table>
           ` : ""}
           ${printFooterHTML()}
         </div>
       `;
     }

