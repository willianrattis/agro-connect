import {
  db, doc, updateDoc, serverTimestamp, collection, addDoc, writeBatch,
} from "../../js/core/firebase.js";
import {
  CATTLE_CATEGORIES, categoriesForSex, LOT_CATEGORY_BUCKET, MOVEMENT_TYPE_LABEL, ICONS, lotCategoryLabel,
  displayCategoryKeyForLot, lifecycleActionsFor,
} from "../../js/core/constants.js";
import { lotListEl } from "../../js/core/dom.js";
import {
  escapeHtml, toDateSafe, toDateInputValue, formatKg, fractionToPercentDisplay, movementDeltas,
  getSlaughterConfig, confinementStripHTML, formatCurrencyInput, parseBRLToNumber, formatBRL,
  formatCPFInput, formatCNPJNumericInput, formatCNPJAlnumInput, formatUFInput, formatDayLabel,
} from "../../js/core/helpers.js";
import {
  currentUid, lotsCache, animalsCache, transactionsCache, eventsCache, propertiesCache,
  suppliersCache, movementsCache, lotWeighingsCache,
} from "../../js/core/state.js";
import { Sheet } from "../../js/core/sheet.js";
import { showToast } from "../../js/core/auth.js";
import {
  clearFieldError, setFieldError, openLotCalvingSheet, openLotFinishingSheet, openLotWeaningSheet,
  openLotAnimalsSheet,
} from "./animals.js";
import { openLotWeighingSheet, openLotWeighingHistorySheet } from "./weighing.js";
import { openLotMovementSheet, openEditMovementSheet } from "./movements.js";

     export function buildLotActionMenuHTML(lot) {
       const isAggregate = (lot.trackingMode || "individual") === "aggregate";
       // Chronological stamps only make sense for Phase 2+ lots that carry
       // a sex + taxonomy category — legacy lots keep their old action set.
       const hasStages = !!lot.sex;
       const stageKey = displayCategoryKeyForLot(lot);
       const { wean, finishing } = lifecycleActionsFor({
         stageKey,
         sex: lot.sex,
         weaningDate: lot.weaningDate,
         finishingStartDate: lot.finishingStartDate,
       });
       return `
         <div class="action-list">
           ${!isAggregate ? `
             <div class="action-group">
               <div class="action-group-title">Animais</div>
               <button type="button" class="action-item pressable" data-menu-action="view-animals">
                 <span class="action-icon" aria-hidden="true">${ICONS.tag}</span>
                 Ver animais
               </button>
             </div>
           ` : ""}
           <div class="action-group">
             <div class="action-group-title">Medição</div>
             <button type="button" class="action-item pressable" data-menu-action="weigh-lot">
               <span class="action-icon" aria-hidden="true">${ICONS.weigh}</span>
               Pesar lote
             </button>
             <button type="button" class="action-item pressable" data-menu-action="weighing-history">
               <span class="action-icon" aria-hidden="true">${ICONS.history}</span>
               Histórico de pesagens
             </button>
           </div>
           <div class="action-group">
             <div class="action-group-title">Registros</div>
             <button type="button" class="action-item pressable" data-menu-action="movement">
               <span class="action-icon" aria-hidden="true">${ICONS.movement}</span>
               Nova movimentação
             </button>
             ${hasStages && wean ? `
               <button type="button" class="action-item pressable" data-menu-action="wean">
                 <span class="action-icon" aria-hidden="true">${ICONS.wean}</span>
                 Registrar desmama
               </button>
             ` : ""}
             ${hasStages && lot.sex === "F" ? `
               <button type="button" class="action-item pressable" data-menu-action="calving">
                 <span class="action-icon" aria-hidden="true">${ICONS.calving}</span>
                 Registrar 1º parto
               </button>
             ` : ""}
             ${hasStages && finishing ? `
               <button type="button" class="action-item pressable" data-menu-action="finishing">
                 <span class="action-icon" aria-hidden="true">${ICONS.finishing}</span>
                 Iniciar terminação
               </button>
             ` : ""}
             <button type="button" class="action-item pressable" data-menu-action="transfer">
               <span class="action-icon" aria-hidden="true">${ICONS.transfer}</span>
               Transferir propriedade
             </button>
           </div>
           <div class="action-group">
             <div class="action-group-title">Gestão</div>
             <button type="button" class="action-item pressable" data-menu-action="edit">
               <span class="action-icon" aria-hidden="true">${ICONS.edit}</span>
               Editar
             </button>
             <button type="button" class="action-item danger pressable" data-menu-action="delete">
               <span class="action-icon" aria-hidden="true">${ICONS.delete}</span>
               Excluir
             </button>
           </div>
         </div>
       `;
     }

     export function openLotActionSheet(lot) {
       Sheet.open({ title: `Ações · ${escapeHtml(lot.name)}`, content: buildLotActionMenuHTML(lot) });
       const back = () => openLotActionSheet(lot);
       document.querySelectorAll("#sheet-body [data-menu-action]").forEach((btn) => {
         btn.addEventListener("click", () => {
           if (btn.dataset.menuAction === "view-animals") { openLotAnimalsSheet(lot); Sheet.setBack(back); }
           else if (btn.dataset.menuAction === "weigh-lot") { openLotWeighingSheet(lot); Sheet.setBack(back); }
           else if (btn.dataset.menuAction === "weighing-history") { openLotWeighingHistorySheet(lot); Sheet.setBack(back); }
           else if (btn.dataset.menuAction === "edit") { openEditLotSheet(lot); Sheet.setBack(back); }
           else if (btn.dataset.menuAction === "delete") { openDeleteLotSheet(lot); Sheet.setBack(back); }
           else if (btn.dataset.menuAction === "movement") { openLotMovementSheet(lot); Sheet.setBack(back); }
           else if (btn.dataset.menuAction === "wean") { openLotWeaningSheet(lot); Sheet.setBack(back); }
           else if (btn.dataset.menuAction === "calving") { openLotCalvingSheet(lot); Sheet.setBack(back); }
           else if (btn.dataset.menuAction === "finishing") { openLotFinishingSheet(lot); Sheet.setBack(back); }
           else if (btn.dataset.menuAction === "transfer") { openTransferSheet(lot); Sheet.setBack(back); }
           else Sheet.close();
         });
       });
     }

     // --- Transferir propriedade: moves the lot's whole headcount to
     //     another property and logs a "transfer" movement for the ledger. ---
     export function buildTransferFormHTML(lot) {
       const propertyOptions = propertiesCache
         .filter((p) => p.id !== lot.propertyId)
         .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`)
         .join("");
       const noTargets = propertyOptions === "";
       return `
         <form id="transfer-form" class="form-grid" novalidate>
           ${noTargets ? `
             <p class="field-hint">Nenhuma outra propriedade disponível. Cadastre uma nova propriedade antes de transferir este lote.</p>
           ` : `
             <div class="field field--half">
               <label class="field-label" for="transfer-property">Nova propriedade *</label>
               <select class="select" id="transfer-property">
                 <option value="" selected>Selecione</option>
                 ${propertyOptions}
               </select>
               <p class="field-error" id="transfer-property-error"></p>
             </div>
             <div class="field field--half">
               <label class="field-label" for="transfer-date">Data da transferência *</label>
               <input class="input" id="transfer-date" type="date" value="${toDateInputValue(new Date())}" />
               <p class="field-error" id="transfer-date-error"></p>
             </div>
           `}
           <p class="field-error" id="transfer-form-error" role="alert"></p>
           <button type="submit" class="btn-primary pressable" id="transfer-submit" ${noTargets ? "disabled" : ""}>Transferir</button>
         </form>
       `;
     }

     export function wireTransferForm(lot) {
       const form = document.getElementById("transfer-form");
       const submitBtn = document.getElementById("transfer-submit");
       const formError = document.getElementById("transfer-form-error");

       form.addEventListener("submit", async (e) => {
         e.preventDefault();
         if (!currentUid) return;

         formError.textContent = "";
         ["transfer-property", "transfer-date"].forEach(clearFieldError);

         let valid = true;
         const fail = (id, msg) => { valid = false; setFieldError(id, msg); };

         const toPropertyId = document.getElementById("transfer-property")?.value || "";
         if (!toPropertyId) fail("transfer-property", "Selecione a propriedade de destino.");

         const dateStr = document.getElementById("transfer-date")?.value || "";
         if (!dateStr) fail("transfer-date", "Informe a data da transferência.");

         if (!valid) return;

         const date = new Date(`${dateStr}T00:00:00`);
         const fromPropertyId = lot.propertyId || null;

         submitBtn.disabled = true;
         submitBtn.textContent = "Salvando…";

         try {
           await addDoc(collection(db, "movements"), {
             ownerId: currentUid,
             type: "transfer",
             lotId: lot.id,
             fromPropertyId,
             toPropertyId,
             qty: lot.headcount ?? 0,
             date,
             createdAt: serverTimestamp(),
           });
           await updateDoc(doc(db, "lots", lot.id), { propertyId: toPropertyId, updatedAt: serverTimestamp() });
           showToast("Lote transferido.");
           Sheet.close();
         } catch (err) {
           console.warn("[Agro Connect] Falha ao transferir lote:", err?.code ?? err);
           formError.textContent =
             err?.code === "permission-denied"
               ? "Sem permissão para gravar."
               : "Não foi possível salvar. Tente novamente.";
           submitBtn.disabled = false;
           submitBtn.textContent = "Transferir";
         }
       });
     }

     export function openTransferSheet(lot) {
       Sheet.open({ title: `Transferir · ${escapeHtml(lot.name)}`, content: buildTransferFormHTML(lot) });
       wireTransferForm(lot);
     }

     // Tapping an aggregate lot's card opens its detail sheet (movement
     // ledger + running headcount); the kebab button opens the action menu
     // instead — checked first since it's nested inside the card. Individual
     // (per-animal) lots have no data-lot-id, so their cards stay inert.
     export function handleLotCardActivate(e) {
       const menuBtn = e.target.closest('[data-action="lot-menu"]');
       if (menuBtn) {
         const lot = lotsCache.find((l) => l.id === menuBtn.dataset.id);
         if (lot) openLotActionSheet(lot);
         return;
       }
       const card = e.target.closest("li[data-lot-id]");
       if (!card) return;
       const lot = lotsCache.find((l) => l.id === card.dataset.lotId);
       if (lot) openLotDetailSheet(lot);
     }
     lotListEl.addEventListener("click", handleLotCardActivate);
     lotListEl.addEventListener("keydown", (e) => {
       if (e.key !== "Enter" && e.key !== " ") return;
       if (e.target.closest('[data-action="lot-menu"]')) return; // native button handles its own activation
       if (!e.target.closest("li[data-lot-id]")) return;
       e.preventDefault();
       handleLotCardActivate(e);
     });

     // --- Editar lote ---
     export function buildLotFormHTML(lot) {
       const categoryOptions = Object.entries(lotCategoryLabel)
         .map(([value, label]) => `<option value="${value}" ${lot.category === value ? "selected" : ""}>${label}</option>`)
         .join("");
       const propertyOptions = propertiesCache
         .map((p) => `<option value="${escapeHtml(p.id)}" ${lot.propertyId === p.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`)
         .join("");
       const cfg = getSlaughterConfig();
       const hasConfined = (lot.confinedHeadcount ?? 0) > 0;
       return `
         <form id="lot-form" class="form-grid" novalidate>
           <div class="field">
             <label class="field-label" for="lot-name">Nome *</label>
             <input class="input" id="lot-name" type="text" placeholder="Ex: Lote 3 — Engorda" autocomplete="off" value="${escapeHtml(lot.name)}" />
             <p class="field-error" id="lot-name-error"></p>
           </div>
           <div class="field field--half">
             <label class="field-label" for="lot-category">Categoria *</label>
             <select class="select" id="lot-category">${categoryOptions}</select>
             <p class="field-error" id="lot-category-error"></p>
           </div>
           <div class="field field--half">
             <label class="field-label" for="lot-area">Área (ha)</label>
             <input class="input" id="lot-area" type="number" min="0" step="0.01" placeholder="Opcional" value="${lot.areaHa ?? ""}" />
           </div>
           <div class="field">
             <label class="field-label" for="lot-property">Propriedade</label>
             <select class="select" id="lot-property">
               <option value="" ${!lot.propertyId ? "selected" : ""}>Sem propriedade</option>
               ${propertyOptions}
             </select>
           </div>

           <p class="form-section-title">Finalização (opcional)</p>
           <div class="field field--half">
             <label class="field-label" for="lot-target-arrobas">Meta de @ por cabeça</label>
             <input class="input" id="lot-target-arrobas" type="number" min="0" step="0.5" placeholder="${cfg.targetArrobasPerHead}" value="${lot.targetArrobas ?? ""}" />
             <p class="field-hint">Vazio = usa a meta padrão (Perfil).</p>
           </div>
           <div class="field field--half">
             <label class="field-label" for="lot-carcass-yield">Aprov. a pasto (%)</label>
             <input class="input" id="lot-carcass-yield" type="number" min="1" max="100" step="0.5" placeholder="${fractionToPercentDisplay(cfg.defaultFarmYieldPct)}" value="${lot.carcassYieldPct != null ? fractionToPercentDisplay(lot.carcassYieldPct) : ""}" />
             <p class="field-hint">Vazio = usa o padrão da fazenda (Perfil).</p>
           </div>
           ${hasConfined ? `
           <div class="field">
             <label class="field-label" for="lot-confinement-yield">Aprov. no confinamento (%)</label>
             <input class="input" id="lot-confinement-yield" type="number" min="1" max="100" step="0.5" placeholder="${fractionToPercentDisplay(cfg.defaultConfinementYieldPct)}" value="${lot.confinementYieldPct != null ? fractionToPercentDisplay(lot.confinementYieldPct) : ""}" />
             <p class="field-hint">Vazio = usa o padrão do confinamento (Perfil).</p>
           </div>
           ` : ""}

           <p class="field-error" id="lot-form-error" role="alert"></p>
           <button type="submit" class="btn-primary pressable" id="lot-submit">Salvar alterações</button>
         </form>
       `;
     }

     export function wireLotForm(lot) {
       const form = document.getElementById("lot-form");
       const submitBtn = document.getElementById("lot-submit");

       form.addEventListener("submit", async (e) => {
         e.preventDefault();
         if (!currentUid) return;

         ["lot-name", "lot-category"].forEach(clearFieldError);

         let valid = true;
         const fail = (id, msg) => { valid = false; setFieldError(id, msg); };

         const name = document.getElementById("lot-name").value.trim();
         if (!name) fail("lot-name", "Informe o nome do lote.");

         const category = document.getElementById("lot-category").value;
         if (!category) fail("lot-category", "Selecione a categoria.");

         const areaRaw = document.getElementById("lot-area").value;
         const areaHa = areaRaw ? parseFloat(areaRaw) : null;

         const propertyId = document.getElementById("lot-property").value || null;

         const targetArrobasRaw = document.getElementById("lot-target-arrobas").value;
         const targetArrobas = targetArrobasRaw ? parseFloat(targetArrobasRaw) : null;

         const carcassYieldRaw = document.getElementById("lot-carcass-yield").value;
         const carcassYieldPct = carcassYieldRaw ? parseFloat(carcassYieldRaw) / 100 : null;

         const confinementYieldInput = document.getElementById("lot-confinement-yield");
         const confinementYieldPct = confinementYieldInput?.value ? parseFloat(confinementYieldInput.value) / 100 : null;

         if (!valid) return;

         submitBtn.disabled = true;
         submitBtn.textContent = "Salvando…";

         try {
           const updates = { name, category, areaHa, propertyId, targetArrobas, carcassYieldPct, updatedAt: serverTimestamp() };
           if (confinementYieldInput) updates.confinementYieldPct = confinementYieldPct;
           await updateDoc(doc(db, "lots", lot.id), updates);
           showToast("Lote atualizado.");
           Sheet.close();
         } catch (err) {
           console.warn("[Agro Connect] Falha ao atualizar lote:", err?.code ?? err);
           showToast(
             err?.code === "permission-denied" ? "Sem permissão para gravar." : "Não foi possível salvar. Tente novamente."
           );
           submitBtn.disabled = false;
           submitBtn.textContent = "Salvar alterações";
         }
       });
     }

     export function openEditLotSheet(lot) {
       Sheet.open({ title: "Editar lote", content: buildLotFormHTML(lot) });
       wireLotForm(lot);
     }

     // --- Excluir lote (cascata completa: animais, eventos, transações e movimentações) ---
     export function buildDeleteLotHTML(lot, linkedCount) {
       return `
         <div class="form-grid">
           <div class="confirm-warning">
             <span class="confirm-warning-icon" aria-hidden="true">${ICONS.warning}</span>
             <p>Tem certeza que deseja excluir o lote <strong>${escapeHtml(lot.name)}</strong>? Esta ação não pode ser desfeita e excluirá permanentemente${
               linkedCount > 0 ? ` os ${linkedCount} animal(is) vinculado(s)` : " todos os animais vinculados"
             } e todos os lançamentos financeiros, eventos e movimentações relacionados.</p>
           </div>
           <div class="confirm-actions">
             <button type="button" class="btn-secondary pressable" id="delete-lot-cancel">Cancelar</button>
             <button type="button" class="btn-primary btn-danger pressable" id="delete-lot-confirm">Excluir lote</button>
           </div>
         </div>
       `;
     }

     // Collects every doc ref tied to a lot from the in-memory caches and
     // deletes them via writeBatch, chunked to stay under Firestore's 500-op
     // limit. The lot doc itself is deleted last, in the final chunk.
     export async function deleteLotCascade(lot) {
       const linkedAnimals = animalsCache.filter((a) => a.lotId === lot.id);
       const animalIds = new Set(linkedAnimals.map((a) => a.id));

       const linkedEvents = eventsCache.filter((e) => animalIds.has(e.animalId));
       const linkedTransactions = transactionsCache.filter(
         (t) => t.linkedLotId === lot.id || animalIds.has(t.linkedAnimalId)
       );
       const linkedMovements = movementsCache.filter((m) => m.lotId === lot.id);
       const linkedWeighings = lotWeighingsCache.filter((w) => w.lotId === lot.id);

       const refs = [
         ...linkedAnimals.map((a) => doc(db, "animals", a.id)),
         ...linkedEvents.map((e) => doc(db, "events", e.id)),
         ...linkedTransactions.map((t) => doc(db, "transactions", t.id)),
         ...linkedMovements.map((m) => doc(db, "movements", m.id)),
         ...linkedWeighings.map((w) => doc(db, "lot_weighings", w.id)),
         doc(db, "lots", lot.id),
       ];

       const CHUNK_SIZE = 450;
       for (let i = 0; i < refs.length; i += CHUNK_SIZE) {
         const batch = writeBatch(db);
         refs.slice(i, i + CHUNK_SIZE).forEach((ref) => batch.delete(ref));
         await batch.commit();
       }
     }

     export function wireDeleteLotForm(lot) {
       const cancelBtn = document.getElementById("delete-lot-cancel");
       const confirmBtn = document.getElementById("delete-lot-confirm");

       cancelBtn.addEventListener("click", () => Sheet.close());

       confirmBtn.addEventListener("click", async () => {
         if (!currentUid) return;
         confirmBtn.disabled = true;
         cancelBtn.disabled = true;
         confirmBtn.textContent = "Excluindo…";

         try {
           await deleteLotCascade(lot);
           showToast("Lote excluído.");
           Sheet.close();
         } catch (err) {
           console.warn("[Agro Connect] Falha ao excluir lote:", err?.code ?? err);
           showToast(
             err?.code === "permission-denied" ? "Sem permissão para excluir." : "Não foi possível excluir. Tente novamente."
           );
           confirmBtn.disabled = false;
           cancelBtn.disabled = false;
           confirmBtn.textContent = "Excluir lote";
         }
       });
     }

     export function openDeleteLotSheet(lot) {
       const linkedCount = animalsCache.filter((a) => a.lotId === lot.id).length;
       Sheet.open({ title: "Excluir lote", content: buildDeleteLotHTML(lot, linkedCount) });
       wireDeleteLotForm(lot);
     }

     export function buildNewLotFormHTML() {
       const propertyOptions = propertiesCache
         .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`)
         .join("");

       return `
         <form id="nl-form" class="form-grid" novalidate>
           <div class="field">
             <label class="field-label" for="nl-name">Nome *</label>
             <input class="input" id="nl-name" type="text" placeholder="Ex: Lote 4 — Compra julho" autocomplete="off" />
             <p class="field-error" id="nl-name-error"></p>
           </div>

           <div class="field">
             <span class="field-label">Origem *</span>
             <div class="segmented" role="radiogroup" aria-label="Origem do lote">
               <input type="radio" id="nl-origin-purchased" name="nl-origin" value="purchased" checked />
               <label for="nl-origin-purchased">Compra</label>
               <input type="radio" id="nl-origin-born" name="nl-origin" value="born" />
               <label for="nl-origin-born">Nascimento</label>
             </div>
           </div>

           <div class="field">
             <label class="field-label" for="nl-property">Propriedade *</label>
             <select class="select" id="nl-property">
               <option value="" selected>Selecione</option>
               ${propertyOptions}
               <option value="__new__">+ Nova propriedade…</option>
             </select>
             <p class="field-error" id="nl-property-error"></p>
             <p class="field-hint">Propriedade que vai receber os animais — o destino da entrada deste lote.</p>
           </div>
           <div class="field" id="nl-newproperty-field" hidden>
             <label class="field-label" for="nl-newproperty-name">Nome da nova propriedade *</label>
             <input class="input" id="nl-newproperty-name" type="text" placeholder="Ex: Fazenda Santa Rosa" autocomplete="off" />
             <p class="field-error" id="nl-newproperty-name-error"></p>
           </div>

           <p class="form-section-title">Animais</p>
           <div class="field field--half">
             <label class="field-label" for="nl-sex">Sexo *</label>
             <select class="select" id="nl-sex">
               <option value="" selected>Selecione</option>
               <option value="F">Fêmea</option>
               <option value="M">Macho</option>
             </select>
             <p class="field-error" id="nl-sex-error"></p>
           </div>

           <div class="field field--half">
             <label class="field-label" for="nl-category">Categoria *</label>
             <select class="select" id="nl-category" disabled>
               <option value="" selected>Selecione o sexo primeiro</option>
             </select>
             <p class="field-error" id="nl-category-error"></p>
           </div>

           <div class="field field--half">
             <label class="field-label" for="nl-acquisitionDate">Data de entrada *</label>
             <input class="input" id="nl-acquisitionDate" type="date" value="${toDateInputValue(new Date())}" />
             <p class="field-error" id="nl-acquisitionDate-error"></p>
           </div>

           <div class="field field--half">
             <label class="field-label" for="nl-headcount">Quantidade de cabeças *</label>
             <input class="input" id="nl-headcount" type="number" min="1" step="1" inputmode="numeric" placeholder="Ex: 140" />
             <p class="field-error" id="nl-headcount-error"></p>
           </div>

           <div class="field field--half">
             <label class="field-label" for="nl-avgWeightKg">Peso na entrada (kg) *</label>
             <input class="input" id="nl-avgWeightKg" type="number" min="0" step="1" placeholder="Ex: 210" />
             <p class="field-error" id="nl-avgWeightKg-error"></p>
           </div>

           <div class="field field--half">
             <label class="field-label" for="nl-birthDateRef">Data de nascimento (ref.)</label>
             <input class="input" id="nl-birthDateRef" type="date" />
           </div>
           <label class="field checkbox-field" id="nl-birthDateRefEstimated-field" for="nl-birthDateRefEstimated" hidden>
             <input type="checkbox" id="nl-birthDateRefEstimated" />
             <span class="field-label">Data estimada</span>
           </label>

           <div class="field">
             <button type="button" class="btn-secondary pressable" id="nl-tags-toggle">+ Adicionar brincos (opcional)</button>
           </div>
           <div class="form-grid" id="nl-tags-container" hidden>
             <p class="field-hint">Brincos são opcionais — identificam um subconjunto do lote e nunca alteram a quantidade de cabeças.</p>
             <ul id="nl-tags-list" style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-3);"></ul>
             <button type="button" class="btn-secondary pressable" id="nl-tags-add">+ Adicionar brinco</button>
             <p class="field-hint" id="nl-tags-hint">0 brinco(s) adicionados.</p>
           </div>

           <div id="nl-purchase-fields" class="form-grid">
             <fieldset class="form-fieldset form-fieldset--seller">
               <legend>Dados do vendedor</legend>
               <p class="field-hint">Quem vendeu este lote. Estes dados criam ou vinculam o cadastro do produtor.</p>

               <div class="field autocomplete">
                 <label class="field-label" for="nl-produtor">Nome do produtor</label>
                 <input class="input" id="nl-produtor" type="text" placeholder="Opcional" autocomplete="off" />
                 <ul class="autocomplete-list" id="nl-produtor-list" hidden></ul>
                 <div class="supplier-picked" id="nl-produtor-picked" hidden>
                   <div class="supplier-picked-info">
                     <strong id="nl-produtor-picked-name"></strong>
                     <span id="nl-produtor-picked-doc"></span>
                   </div>
                   <button type="button" class="supplier-picked-clear pressable" id="nl-produtor-clear">Trocar</button>
                 </div>
               </div>

               <div class="form-grid" id="nl-seller-details">
                 <div class="field">
                   <label class="field-label" for="nl-seller-fazenda">Propriedade do vendedor</label>
                   <input class="input" id="nl-seller-fazenda" type="text" placeholder="Opcional" autocomplete="off" />
                 </div>

                 <div class="field">
                   <label class="field-label" for="nl-seller-cnpj">CNPJ</label>
                   <input class="input" id="nl-seller-cnpj" type="text" inputmode="text" autocomplete="off" placeholder="00.000.000/0000-00 ou alfanumérico" />
                   <p class="field-error" id="nl-seller-cnpj-error"></p>
                 </div>
                 <div class="field">
                   <label class="field-label" for="nl-seller-cpf">CPF</label>
                   <input class="input" id="nl-seller-cpf" type="text" inputmode="numeric" autocomplete="off" placeholder="000.000.000-00" />
                   <p class="field-error" id="nl-seller-cpf-error"></p>
                 </div>

                 <div class="field field--half">
                   <label class="field-label" for="nl-seller-municipio">Município</label>
                   <input class="input" id="nl-seller-municipio" type="text" placeholder="Opcional" autocomplete="off" />
                 </div>
                 <div class="field field--half">
                   <label class="field-label" for="nl-seller-estado">Estado (UF)</label>
                   <input class="input" id="nl-seller-estado" type="text" maxlength="2" placeholder="Ex: MG" autocomplete="off" />
                 </div>
               </div>
             </fieldset>

             <p class="form-section-title">Valores da compra</p>
             <p class="field-hint" id="nl-price-hint">Preencha um dos campos — os demais são calculados a partir da quantidade e do peso.</p>
             <div class="field field--half">
               <label class="field-label" for="nl-priceUnit">Preço por cabeça (R$)</label>
               <input class="input" id="nl-priceUnit" type="text" inputmode="decimal" placeholder="R$ 0,00" autocomplete="off" />
               <p class="field-error" id="nl-priceUnit-error"></p>
             </div>
             <div class="field field--half">
               <label class="field-label" for="nl-priceKg">Preço por kg (R$)</label>
               <input class="input" id="nl-priceKg" type="text" inputmode="decimal" placeholder="R$ 0,00" autocomplete="off" />
               <p class="field-error" id="nl-priceKg-error"></p>
             </div>
             <div class="field field--half">
               <label class="field-label" for="nl-priceTotal">Valor total (R$)</label>
               <input class="input" id="nl-priceTotal" type="text" inputmode="decimal" placeholder="R$ 0,00" autocomplete="off" />
               <p class="field-error" id="nl-priceTotal-error"></p>
             </div>

             <div class="field">
               <label class="field-label" for="nl-freight">Frete (R$)</label>
               <input class="input" id="nl-freight" type="text" inputmode="decimal" placeholder="R$ 0,00 (opcional)" autocomplete="off" />
             </div>

             <label class="field checkbox-field" for="nl-gen-purchase-expense">
               <input type="checkbox" id="nl-gen-purchase-expense" checked />
               <span class="field-label">Gerar despesa da compra</span>
             </label>
             <label class="field checkbox-field" id="nl-gen-freight-expense-field" for="nl-gen-freight-expense" hidden>
               <input type="checkbox" id="nl-gen-freight-expense" checked />
               <span class="field-label">Gerar despesa do frete</span>
             </label>
           </div>

           <p class="field-error" id="nl-form-error" role="alert"></p>
           <button type="submit" class="btn-primary pressable" id="nl-submit">Criar lote</button>
         </form>
       `;
     }

     export function wireNewLotForm() {
       const form = document.getElementById("nl-form");
       const propertySelect = document.getElementById("nl-property");
       const newPropertyField = document.getElementById("nl-newproperty-field");
       const sexSelect = document.getElementById("nl-sex");
       const categorySelect = document.getElementById("nl-category");
       const headcountInput = document.getElementById("nl-headcount");
       const avgWeightInput = document.getElementById("nl-avgWeightKg");
       const birthDateRefInput = document.getElementById("nl-birthDateRef");
       const birthDateRefEstimatedField = document.getElementById("nl-birthDateRefEstimated-field");
       const birthDateRefEstimatedCheckbox = document.getElementById("nl-birthDateRefEstimated");
       const tagsToggle = document.getElementById("nl-tags-toggle");
       const tagsContainer = document.getElementById("nl-tags-container");
       const tagsList = document.getElementById("nl-tags-list");
       const tagsAddBtn = document.getElementById("nl-tags-add");
       const tagsHint = document.getElementById("nl-tags-hint");
       const purchaseFields = document.getElementById("nl-purchase-fields");
       const produtorInput = document.getElementById("nl-produtor");
       const produtorList = document.getElementById("nl-produtor-list");
       const produtorPicked = document.getElementById("nl-produtor-picked");
       const produtorPickedName = document.getElementById("nl-produtor-picked-name");
       const produtorPickedDoc = document.getElementById("nl-produtor-picked-doc");
       const produtorClearBtn = document.getElementById("nl-produtor-clear");
       const sellerDetails = document.getElementById("nl-seller-details");
       const sellerFazendaInput = document.getElementById("nl-seller-fazenda");
       const sellerCnpjInput = document.getElementById("nl-seller-cnpj");
       const sellerCpfInput = document.getElementById("nl-seller-cpf");
       const sellerMunicipioInput = document.getElementById("nl-seller-municipio");
       const sellerEstadoInput = document.getElementById("nl-seller-estado");
       const priceUnitInput = document.getElementById("nl-priceUnit");
       const priceKgInput = document.getElementById("nl-priceKg");
       const priceTotalInput = document.getElementById("nl-priceTotal");
       const freightInput = document.getElementById("nl-freight");
       const genPurchaseExpenseCheckbox = document.getElementById("nl-gen-purchase-expense");
       const genFreightExpenseField = document.getElementById("nl-gen-freight-expense-field");
       const genFreightExpenseCheckbox = document.getElementById("nl-gen-freight-expense");
       const submitBtn = document.getElementById("nl-submit");
       const formError = document.getElementById("nl-form-error");

       let selectedSupplierId = null;

       const allFieldIds = [
         "nl-name", "nl-property", "nl-newproperty-name", "nl-sex", "nl-category",
         "nl-acquisitionDate", "nl-headcount", "nl-avgWeightKg",
         "nl-seller-cnpj", "nl-seller-cpf", "nl-priceUnit", "nl-priceKg", "nl-priceTotal",
       ];

       // --- Origem: Compra shows seller + price + freight; Nascimento hides them ---
       function originValue() {
         return form.querySelector('input[name="nl-origin"]:checked').value;
       }
       function syncOrigin() {
         purchaseFields.hidden = originValue() !== "purchased";
       }
       form.querySelectorAll('input[name="nl-origin"]').forEach((r) => r.addEventListener("change", syncOrigin));
       syncOrigin();

       // --- Categoria options are scoped to the chosen sex (CATTLE_CATEGORIES) ---
       sexSelect.addEventListener("change", () => {
         const sex = sexSelect.value;
         categorySelect.disabled = !sex;
         categorySelect.innerHTML = `
           <option value="" selected>${sex ? "Selecione" : "Selecione o sexo primeiro"}</option>
           ${sex ? categoriesForSex(sex).map((c) => `<option value="${c.value}">${c.label}</option>`).join("") : ""}
         `;
       });

       // --- Propriedade: "+ Nova propriedade…" reveals an inline name field ---
       propertySelect.addEventListener("change", () => {
         newPropertyField.hidden = propertySelect.value !== "__new__";
       });

       // --- Data de nascimento (ref.): "estimada" only makes sense once a date is set ---
       birthDateRefInput.addEventListener("change", () => {
         birthDateRefEstimatedField.hidden = !birthDateRefInput.value;
         if (!birthDateRefInput.value) birthDateRefEstimatedCheckbox.checked = false;
       });

       // --- Brincos (opcional): collapsible list of up-to-`headcount` ear-tag rows ---
       let tagRowSeq = 0;
       function tagRowCount() {
         return tagsList.querySelectorAll("[data-tag-row]").length;
       }
       function syncTagsAddState() {
         const headcount = parseInt(headcountInput.value, 10);
         const capped = Number.isInteger(headcount) && headcount > 0 && tagRowCount() >= headcount;
         tagsAddBtn.disabled = capped;
         const count = tagRowCount();
         tagsHint.textContent = Number.isInteger(headcount) && headcount > 0
           ? `${count} de ${headcount} brinco(s) adicionados.`
           : `${count} brinco(s) adicionados.`;
       }
       function addTagRow() {
         const headcount = parseInt(headcountInput.value, 10);
         if (Number.isInteger(headcount) && headcount > 0 && tagRowCount() >= headcount) return;
         tagRowSeq += 1;
         const li = document.createElement("li");
         li.className = "field";
         li.dataset.tagRow = "";
         li.innerHTML = `
           <label class="field-label" for="nl-tag-${tagRowSeq}">Brinco</label>
           <div style="display: flex; gap: var(--space-2);">
             <input class="input" id="nl-tag-${tagRowSeq}" type="text" placeholder="Ex: 1104" autocomplete="off" />
             <button type="button" class="btn-secondary pressable" data-remove-tag aria-label="Remover brinco">Remover</button>
           </div>
         `;
         tagsList.appendChild(li);
         syncTagsAddState();
         li.querySelector("input").focus({ preventScroll: true });
       }
       tagsToggle.addEventListener("click", () => {
         const willShow = tagsContainer.hidden;
         tagsContainer.hidden = !willShow;
         tagsToggle.textContent = willShow ? "− Ocultar brincos" : "+ Adicionar brincos (opcional)";
         if (willShow && !tagRowCount()) addTagRow();
       });
       tagsAddBtn.addEventListener("click", addTagRow);
       tagsList.addEventListener("click", (e) => {
         const btn = e.target.closest("[data-remove-tag]");
         if (!btn) return;
         btn.closest("[data-tag-row]").remove();
         syncTagsAddState();
       });
       headcountInput.addEventListener("input", syncTagsAddState);
       syncTagsAddState();

       // --- Produtor autocomplete over suppliersCache; picking a supplier
       //     hides the "new supplier" detail fields since that data already
       //     exists on the picked record ---
       function hideSuggestions() {
         produtorList.hidden = true;
         produtorList.innerHTML = "";
       }
       function showPicked(supplier) {
         selectedSupplierId = supplier.id;
         produtorInput.hidden = true;
         produtorPicked.hidden = false;
         sellerDetails.hidden = true;
         produtorPickedName.textContent = supplier.name;
         const docInfo = supplier.docType === "cnpj" && supplier.cnpj
           ? `CNPJ ${supplier.cnpj}`
           : supplier.docType === "cpf" && supplier.cpf
           ? `CPF ${supplier.cpf}`
           : "";
         produtorPickedDoc.textContent = [supplier.fazenda, docInfo].filter(Boolean).join(" · ") || "Sem fazenda/documento cadastrado";
         hideSuggestions();
       }
       function clearPicked() {
         selectedSupplierId = null;
         produtorInput.hidden = false;
         produtorPicked.hidden = true;
         sellerDetails.hidden = false;
         produtorInput.value = "";
         produtorInput.focus({ preventScroll: true });
       }
       produtorClearBtn.addEventListener("click", clearPicked);

       produtorInput.addEventListener("input", () => {
         selectedSupplierId = null;
         const term = produtorInput.value;
         if (!term.trim()) { hideSuggestions(); return; }
         const matches = searchSuppliers(term).slice(0, 8);
         if (!matches.length) { hideSuggestions(); return; }
         produtorList.innerHTML = matches
           .map(
             (s) => `
               <li>
                 <button type="button" class="autocomplete-item pressable" data-id="${escapeHtml(s.id)}">
                   ${escapeHtml(s.name)}
                   ${s.fazenda ? `<small>${escapeHtml(s.fazenda)}</small>` : ""}
                 </button>
               </li>
             `
           )
           .join("");
         produtorList.hidden = false;
       });
       produtorList.addEventListener("click", (e) => {
         const btn = e.target.closest("[data-id]");
         if (!btn) return;
         const supplier = suppliersCache.find((s) => s.id === btn.dataset.id);
         if (supplier) showPicked(supplier);
       });
       // Clicking elsewhere in the form dismisses the suggestion list; the
       // listener lives on `form` itself so it's discarded along with the
       // sheet's markup on close — no manual cleanup needed.
       form.addEventListener("click", (e) => {
         if (!e.target.closest(".autocomplete")) hideSuggestions();
       });

       // --- Seller document: CNPJ/CPF fields are always visible and optional;
       //     the CNPJ mask auto-detects numeric vs alphanumeric as the user types. ---
       sellerCnpjInput.addEventListener("input", () => {
         const hasLetter = /[A-Za-z]/.test(sellerCnpjInput.value);
         if (hasLetter) formatCNPJAlnumInput(sellerCnpjInput);
         else formatCNPJNumericInput(sellerCnpjInput);
       });
       sellerCpfInput.addEventListener("input", () => formatCPFInput(sellerCpfInput));
       sellerEstadoInput.addEventListener("input", () => formatUFInput(sellerEstadoInput));

       // --- Preço: três campos sempre visíveis, inter-derivados a partir do
       //     último editado pelo usuário, usando Quantidade e Peso na entrada. ---
       function qtyValue() {
         const q = parseInt(headcountInput.value, 10);
         return Number.isInteger(q) && q > 0 ? q : null;
       }
       function weightValue() {
         const w = parseFloat(avgWeightInput.value);
         return Number.isFinite(w) && w > 0 ? w : null;
       }

       let lastPriceSource = null; // "unit" | "kg" | "total"

       function recomputeFromLast() {
         const qty = qtyValue();
         const weight = weightValue();
         if (lastPriceSource === "unit") {
           const unit = parseBRLToNumber(priceUnitInput.value);
           if (!Number.isFinite(unit)) { priceKgInput.value = ""; priceTotalInput.value = ""; return; }
           priceTotalInput.value = qty ? formatBRL(unit * qty) : "";
           priceKgInput.value = weight ? formatBRL(unit / weight) : "";
         } else if (lastPriceSource === "kg") {
           const kg = parseBRLToNumber(priceKgInput.value);
           if (!Number.isFinite(kg)) { priceUnitInput.value = ""; priceTotalInput.value = ""; return; }
           priceUnitInput.value = weight ? formatBRL(kg * weight) : "";
           priceTotalInput.value = (weight && qty) ? formatBRL(kg * weight * qty) : "";
         } else if (lastPriceSource === "total") {
           const total = parseBRLToNumber(priceTotalInput.value);
           if (!Number.isFinite(total)) { priceUnitInput.value = ""; priceKgInput.value = ""; return; }
           priceUnitInput.value = qty ? formatBRL(total / qty) : "";
           priceKgInput.value = (qty && weight) ? formatBRL(total / (weight * qty)) : "";
         }
       }

       priceUnitInput.addEventListener("input", () => { formatCurrencyInput(priceUnitInput); lastPriceSource = "unit"; recomputeFromLast(); });
       priceKgInput.addEventListener("input", () => { formatCurrencyInput(priceKgInput); lastPriceSource = "kg"; recomputeFromLast(); });
       priceTotalInput.addEventListener("input", () => { formatCurrencyInput(priceTotalInput); lastPriceSource = "total"; recomputeFromLast(); });
       headcountInput.addEventListener("input", recomputeFromLast);
       avgWeightInput.addEventListener("input", recomputeFromLast);

       // --- Frete: R$ 0,00 unlocks the "Gerar despesa do frete" opt-out ---
       freightInput.addEventListener("input", () => {
         formatCurrencyInput(freightInput);
         const freight = parseBRLToNumber(freightInput.value);
         genFreightExpenseField.hidden = !(Number.isFinite(freight) && freight > 0);
       });

       form.addEventListener("submit", async (e) => {
         e.preventDefault();
         if (!currentUid) return;

         formError.textContent = "";
         allFieldIds.forEach(clearFieldError);

         let valid = true;
         const fail = (id, msg) => { valid = false; setFieldError(id, msg); };

         const name = document.getElementById("nl-name").value.trim();
         if (!name) fail("nl-name", "Informe o nome do lote.");

         const origin = originValue();

         let propertyId = propertySelect.value || null;
         let newPropertyName = "";
         if (propertyId === "__new__") {
           newPropertyName = document.getElementById("nl-newproperty-name").value.trim();
           if (!newPropertyName) fail("nl-newproperty-name", "Informe o nome da propriedade.");
         } else if (!propertyId) {
           fail("nl-property", "Selecione a propriedade.");
         }

         const sex = sexSelect.value;
         if (!sex) fail("nl-sex", "Selecione o sexo.");

         const category = categorySelect.value;
         if (!category) fail("nl-category", "Selecione a categoria.");

         const acquisitionDateStr = document.getElementById("nl-acquisitionDate").value || toDateInputValue(new Date());

         const headcount = parseInt(headcountInput.value, 10);
         if (!Number.isInteger(headcount) || headcount <= 0) fail("nl-headcount", "Informe a quantidade de cabeças.");

         const avgWeightKgRaw = parseFloat(avgWeightInput.value);
         let avgWeightKg = null;
         if (!Number.isFinite(avgWeightKgRaw) || avgWeightKgRaw <= 0) {
           fail("nl-avgWeightKg", "Informe o peso na entrada.");
         } else {
           avgWeightKg = Math.round(avgWeightKgRaw);
         }

         const birthDateRefStr = birthDateRefInput.value;
         const birthDateRefIsEstimated = !birthDateRefEstimatedField.hidden && birthDateRefEstimatedCheckbox.checked;

         const tagInputs = Array.from(tagsList.querySelectorAll("[data-tag-row] input"));
         const earTags = tagInputs.map((inp) => inp.value.trim()).filter(Boolean);
         if (Number.isInteger(headcount) && earTags.length > headcount) {
           fail("nl-headcount", "A quantidade de brincos não pode exceder a quantidade de cabeças.");
         }

         const produtorText = origin === "purchased"
           ? (produtorPicked.hidden ? produtorInput.value : produtorPickedName.textContent).trim()
           : "";

         let avgPurchaseCostBRL = null;
         let totalPurchaseCostBRL = null;
         let freightBRL = null;
         let genPurchaseExpense = false;
         let genFreightExpense = false;

         if (origin === "purchased") {
           const qty = Number.isInteger(headcount) && headcount > 0 ? headcount : null;
           const unit = parseBRLToNumber(priceUnitInput.value);
           const kg = parseBRLToNumber(priceKgInput.value);
           const total = parseBRLToNumber(priceTotalInput.value);
           if (Number.isFinite(total) && total > 0 && qty) {
             totalPurchaseCostBRL = total;
             avgPurchaseCostBRL = total / qty;
           } else if (Number.isFinite(unit) && unit > 0 && qty) {
             avgPurchaseCostBRL = unit;
             totalPurchaseCostBRL = unit * qty;
           } else if (Number.isFinite(kg) && kg > 0 && qty && avgWeightKg) {
             avgPurchaseCostBRL = kg * avgWeightKg;
             totalPurchaseCostBRL = kg * avgWeightKg * qty;
           } else {
             fail("nl-priceTotal", "Informe o preço por cabeça, por kg ou o valor total.");
           }

           const freightRaw = parseBRLToNumber(freightInput.value);
           freightBRL = Number.isFinite(freightRaw) && freightRaw > 0 ? freightRaw : null;
           genPurchaseExpense = genPurchaseExpenseCheckbox.checked;
           genFreightExpense = !genFreightExpenseField.hidden && genFreightExpenseCheckbox.checked;
         }

         if (!valid) return;

         const acquisitionDate = new Date(`${acquisitionDateStr}T00:00:00`);
         const birthDateRef = birthDateRefStr ? new Date(`${birthDateRefStr}T00:00:00`) : null;

         submitBtn.disabled = true;
         submitBtn.textContent = "Salvando…";

         try {
           if (propertyId === "__new__") {
             const propRef = await addDoc(collection(db, "properties"), {
               ownerId: currentUid,
               name: newPropertyName,
               areaHa: null,
               notes: null,
               createdAt: serverTimestamp(),
               updatedAt: serverTimestamp(),
             });
             propertyId = propRef.id;
           }

           // Reuse an existing supplier on an exact name match; otherwise
           // persist a new one (with whatever seller details were filled in)
           // and link its id — spec: never duplicate.
           let supplierId = selectedSupplierId;
           if (origin === "purchased" && !supplierId && produtorText) {
             const nameLower = produtorText.toLowerCase();
             const existing = suppliersCache.find((s) => s.nameLower === nameLower);
             if (existing) {
               supplierId = existing.id;
             } else {
               const fazenda = sellerFazendaInput.value.trim() || null;
               const municipio = sellerMunicipioInput.value.trim() || null;
               const estado = sellerEstadoInput.value.trim() || null;
               const cnpjRaw = sellerCnpjInput.value.trim();
               const cpfRaw = sellerCpfInput.value.trim();
               let cnpj = null, cnpjKey = null, cpf = null, cpfDigits = null;
               if (cnpjRaw) {
                 cnpj = cnpjRaw;
                 cnpjKey = cnpj.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
               } else if (cpfRaw) {
                 cpf = cpfRaw;
                 cpfDigits = cpf.replace(/\D/g, "");
               }
               const supplierRef = await addDoc(collection(db, "suppliers"), {
                 ownerId: currentUid,
                 name: produtorText,
                 nameLower,
                 fazenda,
                 docType: cnpj ? "cnpj" : cpf ? "cpf" : null,
                 cnpj,
                 cnpjKey,
                 cpf,
                 cpfDigits,
                 phone: null,
                 phoneDigits: null,
                 municipio,
                 estado,
                 notes: null,
                 createdAt: serverTimestamp(),
                 updatedAt: serverTimestamp(),
               });
               supplierId = supplierRef.id;
             }
           }

           const trackingMode = earTags.length > 0 && earTags.length === headcount ? "individual" : "aggregate";

           const lotRef = await addDoc(collection(db, "lots"), {
             ownerId: currentUid,
             name,
             category: LOT_CATEGORY_BUCKET[category] || "outro",
             entryCategory: category,
             sex,
             origin,
             areaHa: null,
             trackingMode,
             headcount,
             confinedHeadcount: 0,
             avgWeightKg,
             propertyId,
             supplierId: origin === "purchased" ? (supplierId || null) : null,
             acquisitionDate,
             birthDateRef,
             birthDateRefIsEstimated: birthDateRef ? birthDateRefIsEstimated : false,
             weaningDate: null,
             finishingStartDate: null,
             avgPurchaseCostBRL: origin === "purchased" ? avgPurchaseCostBRL : null,
             totalPurchaseCostBRL: origin === "purchased" ? totalPurchaseCostBRL : null,
             freightBRL,
             createdAt: serverTimestamp(),
             updatedAt: serverTimestamp(),
           });

           if (genPurchaseExpense && totalPurchaseCostBRL != null) {
             await addDoc(collection(db, "transactions"), {
               ownerId: currentUid,
               kind: "despesa",
               category: "compra-animal",
               costNature: null,
               amountBRL: totalPurchaseCostBRL,
               date: acquisitionDate,
               linkedScope: "lot",
               linkedAnimalId: null,
               linkedLotId: lotRef.id,
               description: `Compra de ${headcount} cabeça${headcount === 1 ? "" : "s"} — ${name}`,
               createdAt: serverTimestamp(),
             });
           }
           if (genFreightExpense && freightBRL != null) {
             await addDoc(collection(db, "transactions"), {
               ownerId: currentUid,
               kind: "despesa",
               category: "frete",
               costNature: null,
               amountBRL: freightBRL,
               date: acquisitionDate,
               linkedScope: "lot",
               linkedAnimalId: null,
               linkedLotId: lotRef.id,
               description: `Frete — ${name}`,
               createdAt: serverTimestamp(),
             });
           }

           let animalBirthDate = null;
           let animalBirthDateIsEstimated = false;
           if (birthDateRef) {
             animalBirthDate = birthDateRef;
             animalBirthDateIsEstimated = birthDateRefIsEstimated;
           } else if (origin === "born") {
             animalBirthDate = acquisitionDate;
             animalBirthDateIsEstimated = true;
           }

           await Promise.all(earTags.map((earTag) => addDoc(collection(db, "animals"), {
             ownerId: currentUid,
             earTag,
             sex,
             breed: null,
             category,
             lotId: lotRef.id,
             propertyId,
             birthDate: animalBirthDate,
             birthDateIsEstimated: animalBirthDateIsEstimated,
             damAnimalId: null,
             acquisitionType: origin,
             purchaseDate: origin === "purchased" ? acquisitionDate : null,
             purchaseWeightKg: origin === "purchased" ? avgWeightKg : null,
             purchaseCostBRL: origin === "purchased" ? avgPurchaseCostBRL : null,
             currentWeightKg: avgWeightKg,
             notes: null,
             status: "active",
             saleDate: null,
             saleArrobas: null,
             salePricePerArrobaBRL: null,
             saleRevenueBRL: null,
             deathDate: null,
             deathCause: null,
             createdAt: serverTimestamp(),
             updatedAt: serverTimestamp(),
           })));

           showToast("Lote criado com sucesso.");
           Sheet.close();
         } catch (err) {
           console.warn("[Agro Connect] Falha ao criar lote:", err?.code ?? err);
           formError.textContent =
             err?.code === "permission-denied"
               ? "Sem permissão para gravar."
               : "Não foi possível salvar. Tente novamente.";
           submitBtn.disabled = false;
           submitBtn.textContent = "Criar lote";
         }
       });
     }

     export function openNewLotSheet() {
       Sheet.open({ title: "Novo lote", content: buildNewLotFormHTML() });
       wireNewLotForm();
     }

     document.getElementById("lot-new-btn").addEventListener("click", openNewLotSheet);

     export let openLotDetailLotId = null; // tracks which lot's detail sheet is open, for live refresh
     export function setOpenLotDetailLotId(v) { openLotDetailLotId = v; }

     // Running dual balances per row, anchored to the lot's current
     // headcount/confinedHeadcount (the source of truth) and walked
     // backwards so it stays correct even when there's no movement
     // recording the lot's original headcount.
     export function computeLotMovementRows(lot) {
       const rows = movementsCache
         .filter((m) => m.lotId === lot.id)
         .slice()
         .sort((a, b) => toDateSafe(b.date) - toDateSafe(a.date));
       let runningFarm = lot.headcount ?? 0;
       let runningConfined = lot.confinedHeadcount ?? 0;
       return rows.map((m) => {
         const afterFarm = runningFarm;
         const afterConfined = runningConfined;
         const { farmDelta, confinedDelta } = movementDeltas(m);
         runningFarm = afterFarm - farmDelta;
         runningConfined = afterConfined - confinedDelta;
         return { ...m, afterFarm, afterConfined };
       });
     }

     export function renderLotMovementRow(m) {
       const qty = m.qty || 0;
       const isEntry = qty >= 0;
       const sign = isEntry ? "+" : "−";
       const amountClass = isEntry ? "fin-positive" : "fin-negative";
       const typeLabel = MOVEMENT_TYPE_LABEL[m.type] || m.type;
       const date = toDateSafe(m.date);
       const touchesConfined = m.type === "confinement_out" || m.type === "confinement_return" || !!m.fromConfinement;
       const balanceHint = touchesConfined || m.afterConfined !== 0
         ? `Saldo após: ${m.afterFarm} na fazenda · ${m.afterConfined} no confinamento`
         : `Saldo após: ${m.afterFarm} na fazenda`;
       return `
         <li class="tx-row">
           <div class="tx-row-main">
             <div class="tx-tags">
               <span class="chip tx-category-chip">${escapeHtml(typeLabel)}</span>
               <span class="chip tx-link-chip">${date ? formatDayLabel(date) : "—"}</span>
               ${m.confinementName ? `<span class="chip tx-link-chip">${escapeHtml(m.confinementName)}</span>` : ""}
             </div>
             ${m.description ? `<p class="tx-desc">${escapeHtml(m.description)}</p>` : ""}
             <p class="field-hint">${balanceHint}</p>
           </div>
           <div class="tx-row-end">
             <p class="tx-amount ${amountClass}">${sign}${Math.abs(qty)}${m.amountBRL != null ? ` (${formatBRL(m.amountBRL)})` : ""}</p>
             <button type="button" class="card-menu-btn pressable" data-action="mv-edit" data-id="${escapeHtml(m.id)}" aria-label="Editar movimentação">
               ${ICONS.edit}
             </button>
           </div>
         </li>
       `;
     }

     export function buildLotMovementListHTML(lot) {
       const rows = computeLotMovementRows(lot);
       if (!rows.length) {
         return `<p class="field-hint">Nenhuma movimentação registrada ainda.</p>`;
       }
       return `<ul class="tx-day-items">${rows.map(renderLotMovementRow).join("")}</ul>`;
     }

     export function buildLotDetailHTML(lot) {
       const headcount = lot.headcount ?? 0;
       const confinedHeadcount = lot.confinedHeadcount ?? 0;
       const hasConfined = confinedHeadcount > 0;
       const ownedHeadcount = headcount + confinedHeadcount;
       return `
         <div class="card-stats" style="grid-template-columns: repeat(2, 1fr); border-top: none; padding-top: 0;">
           <div class="mini-stat">
             <p class="mini-value">${ownedHeadcount}</p>
             <p class="mini-label">${hasConfined ? `Cabeças atuais · ${headcount} na fazenda` : "Cabeças atuais"}</p>
           </div>
           <div class="mini-stat">
             <p class="mini-value">${lot.avgWeightKg != null ? `${formatKg(lot.avgWeightKg)} kg` : "—"}</p>
             <p class="mini-label">Peso médio</p>
           </div>
         </div>
         ${confinementStripHTML(lot)}

         <div class="detail-section">
           <p class="detail-section-title">Movimentações</p>
           ${buildLotMovementListHTML(lot)}
         </div>

         <div class="detail-section" style="display: flex; gap: var(--space-3); flex-wrap: wrap;">
           <button type="button" class="btn-primary pressable" id="lot-detail-new-movement-btn">+ Nova movimentação</button>
           <button type="button" class="btn-secondary pressable" id="lot-detail-actions-btn">Ações do lote</button>
         </div>
       `;
     }

     // Sheets are flat (no back-stack): leaving the detail view for the
     // movement form or the action menu clears openLotDetailLotId first, so
     // a live cache update mid-edit can't clobber whatever's now on screen.
     export function wireLotDetailSheet(lot) {
       document.getElementById("lot-detail-new-movement-btn")?.addEventListener("click", () => {
         openLotDetailLotId = null;
         openLotMovementSheet(lot);
       });
       document.getElementById("lot-detail-actions-btn")?.addEventListener("click", () => {
         openLotDetailLotId = null;
         openLotActionSheet(lot);
       });
       document.querySelectorAll("#sheet-body [data-action='mv-edit']").forEach((btn) => {
         btn.addEventListener("click", () => {
           const m = movementsCache.find((x) => x.id === btn.dataset.id);
           if (!m) return;
           openLotDetailLotId = null;
           openEditMovementSheet(m);
         });
       });
     }

     export function openLotDetailSheet(lot) {
       openLotDetailLotId = lot.id;
       Sheet.open({
         title: escapeHtml(lot.name),
         content: buildLotDetailHTML(lot),
         onClose: () => { openLotDetailLotId = null; },
       });
       wireLotDetailSheet(lot);
     }

     // Keeps the ledger + headcount live while the lot detail sheet is open —
     // movements and lots each arrive on their own onSnapshot listener.
     export function refreshLotDetailSheetIfOpen() {
       if (!openLotDetailLotId) return;
       const lot = lotsCache.find((l) => l.id === openLotDetailLotId);
       if (!lot) { openLotDetailLotId = null; Sheet.close(); return; }
       const bodyEl = document.getElementById("sheet-body");
       if (bodyEl) bodyEl.innerHTML = buildLotDetailHTML(lot);
       wireLotDetailSheet(lot);
     }

     // Weighted by headcount (SPEC): avg cost/weight over the target + every
     // checked source, as if all their heads had always belonged to one lot.
     export function computeMergePreview(lots) {
       const totalHeadcount = lots.reduce((s, l) => s + (l.headcount ?? 0), 0);
       const totalCost = lots.reduce((s, l) => s + (l.headcount ?? 0) * (l.avgPurchaseCostBRL ?? 0), 0);
       const totalWeight = lots.reduce((s, l) => s + (l.headcount ?? 0) * (l.avgWeightKg ?? 0), 0);
       return {
         totalHeadcount,
         newAvgCostBRL: totalHeadcount > 0 ? totalCost / totalHeadcount : 0,
         newAvgWeightKg: totalHeadcount > 0 ? Math.round(totalWeight / totalHeadcount) : 0,
         totalPurchaseCostBRL: totalCost,
       };
     }

     export function buildMergeFormHTML() {
       const aggregateLots = lotsCache.filter((l) => (l.trackingMode || "individual") === "aggregate");
       const targetOptions = aggregateLots
         .map((l) => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.name)} (${l.headcount ?? 0} cabeças)</option>`)
         .join("");
       return `
         <div class="form-grid">
           <div class="field">
             <label class="field-label" for="merge-target">Lote de destino *</label>
             <select class="select" id="merge-target">
               <option value="" selected>Selecione</option>
               ${targetOptions}
             </select>
             <p class="field-error" id="merge-target-error"></p>
           </div>

           <div class="field">
             <span class="field-label">Lotes de origem *</span>
             <div class="merge-source-list" id="merge-source-list">
               <p class="field-hint">Selecione o lote de destino para ver as opções.</p>
             </div>
             <p class="field-error" id="merge-sources-error"></p>
           </div>

           <div class="live-calc" id="merge-preview" hidden>
             <div class="live-calc-item">
               <span class="live-calc-label">Total de cabeças</span>
               <span class="live-calc-value" id="merge-calc-headcount">—</span>
             </div>
             <div class="live-calc-item">
               <span class="live-calc-label">Peso médio</span>
               <span class="live-calc-value" id="merge-calc-weight">—</span>
             </div>
             <div class="live-calc-item">
               <span class="live-calc-label">Custo médio</span>
               <span class="live-calc-value" id="merge-calc-cost">—</span>
             </div>
             <div class="live-calc-item">
               <span class="live-calc-label">Custo total</span>
               <span class="live-calc-value" id="merge-calc-total">—</span>
             </div>
           </div>

           <label class="field checkbox-field" for="merge-migrate-linked">
             <input type="checkbox" id="merge-migrate-linked" checked />
             <span class="field-label">Migrar lançamentos vinculados</span>
           </label>

           <p class="field-error" id="merge-form-error" role="alert"></p>
           <button type="button" class="btn-primary pressable" id="merge-submit">Mesclar lotes</button>
         </div>
       `;
     }

     export function buildMergeSourceListHTML(sourceCandidates) {
       if (!sourceCandidates.length) {
         return `<p class="field-hint">Nenhum outro lote por cabeça disponível para mesclar.</p>`;
       }
       return sourceCandidates
         .map(
           (l) => `
             <label class="merge-source-item">
               <input type="checkbox" value="${escapeHtml(l.id)}" data-merge-source />
               <span class="merge-source-item-info">
                 <span>${escapeHtml(l.name)}</span>
                 <small>${l.headcount ?? 0} cabeças · ${l.avgWeightKg != null ? `${formatKg(l.avgWeightKg)} kg` : "—"} · ${l.avgPurchaseCostBRL != null ? formatBRL(l.avgPurchaseCostBRL) : "—"}/cab.</small>
               </span>
             </label>
           `
         )
         .join("");
     }

     export function wireMergeForm() {
       const targetSelect = document.getElementById("merge-target");
       const sourceListEl = document.getElementById("merge-source-list");
       const previewEl = document.getElementById("merge-preview");
       const submitBtn = document.getElementById("merge-submit");
       const formError = document.getElementById("merge-form-error");

       function checkedSourceLots() {
         const ids = Array.from(sourceListEl.querySelectorAll("[data-merge-source]:checked")).map((c) => c.value);
         return lotsCache.filter((l) => ids.includes(l.id));
       }

       function updatePreview() {
         const targetLot = lotsCache.find((l) => l.id === targetSelect.value);
         const sources = targetLot ? checkedSourceLots() : [];
         if (!targetLot || !sources.length) {
           previewEl.hidden = true;
           return;
         }
         const preview = computeMergePreview([targetLot, ...sources]);
         document.getElementById("merge-calc-headcount").textContent = `${preview.totalHeadcount} cabeças`;
         document.getElementById("merge-calc-weight").textContent = `${formatKg(preview.newAvgWeightKg)} kg`;
         document.getElementById("merge-calc-cost").textContent = formatBRL(preview.newAvgCostBRL);
         document.getElementById("merge-calc-total").textContent = formatBRL(preview.totalPurchaseCostBRL);
         previewEl.hidden = false;
       }

       function renderSourceOptions() {
         const targetId = targetSelect.value;
         if (!targetId) {
           sourceListEl.innerHTML = `<p class="field-hint">Selecione o lote de destino para ver as opções.</p>`;
           updatePreview();
           return;
         }
         const candidates = lotsCache.filter(
           (l) => l.id !== targetId && (l.trackingMode || "individual") === "aggregate"
         );
         sourceListEl.innerHTML = buildMergeSourceListHTML(candidates);
         sourceListEl.querySelectorAll("[data-merge-source]").forEach((cb) => cb.addEventListener("change", updatePreview));
         updatePreview();
       }

       targetSelect.addEventListener("change", renderSourceOptions);

       submitBtn.addEventListener("click", () => {
         formError.textContent = "";
         clearFieldError("merge-target");
         clearFieldError("merge-sources");

         let valid = true;
         const fail = (id, msg) => { valid = false; setFieldError(id, msg); };

         const targetLot = lotsCache.find((l) => l.id === targetSelect.value);
         if (!targetLot) fail("merge-target", "Selecione o lote de destino.");

         const sources = targetLot ? checkedSourceLots() : [];
         if (targetLot && !sources.length) fail("merge-sources", "Selecione ao menos um lote de origem.");

         if (!valid) return;

         // Guards: no self-merge (target excluded from the source list above)
         // and no mixing tracking modes (source list is aggregate-only above).
         if (sources.some((l) => l.id === targetLot.id)) {
           fail("merge-sources", "O lote de destino não pode ser também de origem.");
           return;
         }
         if (sources.some((l) => (l.trackingMode || "individual") !== "aggregate")) {
           fail("merge-sources", "Só é possível mesclar lotes por cabeça (aggregate).");
           return;
         }

         const migrateLinked = document.getElementById("merge-migrate-linked").checked;
         openMergeConfirmSheet(targetLot, sources, migrateLinked);
       });
     }

     export function openMergeLotsSheet() {
       const aggregateLots = lotsCache.filter((l) => (l.trackingMode || "individual") === "aggregate");
       if (aggregateLots.length < 2) {
         showToast("É preciso ao menos 2 lotes por cabeça para mesclar.");
         return;
       }
       Sheet.open({ title: "Mesclar lotes", content: buildMergeFormHTML() });
       wireMergeForm();
     }

     document.getElementById("lot-merge-btn").addEventListener("click", openMergeLotsSheet);

     // --- Confirmação da mesclagem ---
     export function buildMergeConfirmHTML(targetLot, sourceLots, preview) {
       const sourceNames = sourceLots.map((l) => escapeHtml(l.name)).join(", ");
       return `
         <div class="form-grid">
           <div class="confirm-warning">
             <span class="confirm-warning-icon" aria-hidden="true">${ICONS.warning}</span>
             <p>
               Os lotes <strong>${sourceNames}</strong> serão mesclados em <strong>${escapeHtml(targetLot.name)}</strong>.
               O histórico de movimentações será preservado sob o lote de destino, e os lotes de origem serão excluídos.
               Esta ação não pode ser desfeita.
             </p>
           </div>

           <div class="live-calc">
             <div class="live-calc-item">
               <span class="live-calc-label">Total de cabeças</span>
               <span class="live-calc-value">${preview.totalHeadcount} cabeças</span>
             </div>
             <div class="live-calc-item">
               <span class="live-calc-label">Peso médio</span>
               <span class="live-calc-value">${formatKg(preview.newAvgWeightKg)} kg</span>
             </div>
             <div class="live-calc-item">
               <span class="live-calc-label">Custo médio</span>
               <span class="live-calc-value">${formatBRL(preview.newAvgCostBRL)}</span>
             </div>
             <div class="live-calc-item">
               <span class="live-calc-label">Custo total</span>
               <span class="live-calc-value">${formatBRL(preview.totalPurchaseCostBRL)}</span>
             </div>
           </div>

           <div class="confirm-actions">
             <button type="button" class="btn-secondary pressable" id="merge-confirm-cancel">Cancelar</button>
             <button type="button" class="btn-primary pressable" id="merge-confirm-submit">Confirmar mesclagem</button>
           </div>
         </div>
       `;
     }

     export function wireMergeConfirmForm(targetLot, sourceLots, migrateLinked, preview) {
       const cancelBtn = document.getElementById("merge-confirm-cancel");
       const confirmBtn = document.getElementById("merge-confirm-submit");

       cancelBtn.addEventListener("click", () => Sheet.close());

       confirmBtn.addEventListener("click", async () => {
         if (!currentUid) return;
         confirmBtn.disabled = true;
         cancelBtn.disabled = true;
         confirmBtn.textContent = "Mesclando…";

         try {
           const sourceIds = sourceLots.map((l) => l.id);
           const batch = writeBatch(db);

           batch.update(doc(db, "lots", targetLot.id), {
             headcount: preview.totalHeadcount,
             avgWeightKg: preview.newAvgWeightKg,
             avgPurchaseCostBRL: preview.newAvgCostBRL,
             totalPurchaseCostBRL: preview.totalPurchaseCostBRL,
             updatedAt: serverTimestamp(),
           });

           movementsCache
             .filter((m) => sourceIds.includes(m.lotId))
             .forEach((m) => batch.update(doc(db, "movements", m.id), { lotId: targetLot.id }));

           if (migrateLinked) {
             transactionsCache
               .filter((t) => sourceIds.includes(t.linkedLotId))
               .forEach((t) => batch.update(doc(db, "transactions", t.id), { linkedLotId: targetLot.id }));
           }

           sourceLots.forEach((l) => batch.delete(doc(db, "lots", l.id)));

           await batch.commit();
           showToast("Lotes mesclados.");
           Sheet.close();
         } catch (err) {
           console.warn("[Agro Connect] Falha ao mesclar lotes:", err?.code ?? err);
           showToast(
             err?.code === "permission-denied" ? "Sem permissão para gravar." : "Não foi possível mesclar. Tente novamente."
           );
           confirmBtn.disabled = false;
           cancelBtn.disabled = false;
           confirmBtn.textContent = "Confirmar mesclagem";
         }
       });
     }

     export function openMergeConfirmSheet(targetLot, sourceLots, migrateLinked) {
       const preview = computeMergePreview([targetLot, ...sourceLots]);
       Sheet.open({ title: "Confirmar mesclagem", content: buildMergeConfirmHTML(targetLot, sourceLots, preview) });
       wireMergeConfirmForm(targetLot, sourceLots, migrateLinked, preview);
     }

     // --- Prefix search over suppliersCache (name, CNPJ or CPF) — no extra
     //     Firestore queries; consumed by the lot-purchase form (Phase C). ---
     export function searchSuppliers(term) {
       const raw = String(term || "").trim();
       if (!raw) return [];
       const nameTerm = raw.toLowerCase();
       const docTerm = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
       return suppliersCache.filter((s) =>
         (s.nameLower && s.nameLower.startsWith(nameTerm)) ||
         (docTerm && s.cnpjKey && s.cnpjKey.startsWith(docTerm)) ||
         (docTerm && s.cpfDigits && s.cpfDigits.startsWith(docTerm))
       );
     }
