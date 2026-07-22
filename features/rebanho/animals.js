import {
  db, doc, updateDoc, deleteDoc, serverTimestamp, collection, addDoc, query, where, getDocs,
} from "../../js/core/firebase.js";
import { CATTLE_CATEGORIES, categoriesForSex, resolveCategoryKey, deriveStage, statusLabel, ICONS } from "../../js/core/constants.js";
import {
  escapeHtml, toDateSafe, toDateInputValue, daysOnFarm, formatKg, formatCurrencyInput,
  parseBRLToNumber, formatBRL, saleDaysHeld, computeSaleResult, formatDayLabel, fmtNum,
  applyFunruralRetention,
} from "../../js/core/helpers.js";
import {
  currentUid, lotsCache, animalsCache, transactionsCache, settingsCache, propertiesCache, eventsCache,
} from "../../js/core/state.js";
import { Sheet } from "../../js/core/sheet.js";
import { showToast } from "../../js/core/auth.js";

     export function buildAnimalFormHTML(lots, animal) {
       const lotOptions = lots
         .map((l) => `<option value="${escapeHtml(l.id)}" ${animal.lotId === l.id ? "selected" : ""}>${escapeHtml(l.name)}</option>`)
         .join("");
       const origin = animal.acquisitionType || "purchased";
       const priceValue = animal.purchaseCostBRL != null ? formatBRL(animal.purchaseCostBRL) : "";
       const initialSex = animal.sex || "";
       const initialCategory = resolveCategoryKey(animal.category, animal.sex) || "";
       return `
         <form id="animal-form" class="form-grid" novalidate>
           <div class="field">
             <label class="field-label" for="af-earTag">Brinco *</label>
             <input class="input" id="af-earTag" type="text" placeholder="Ex: 1104" autocomplete="off" value="${escapeHtml(animal.earTag)}" />
             <p class="field-error" id="af-earTag-error"></p>
           </div>

           <div class="field field--half">
             <label class="field-label" for="af-sex">Sexo *</label>
             <select class="select" id="af-sex">
               <option value="" ${initialSex ? "" : "selected"}>Selecione</option>
               <option value="F" ${initialSex === "F" ? "selected" : ""}>Fêmea</option>
               <option value="M" ${initialSex === "M" ? "selected" : ""}>Macho</option>
             </select>
             <p class="field-error" id="af-sex-error"></p>
           </div>

           <div class="field field--half">
             <label class="field-label" for="af-category">Categoria *</label>
             <select class="select" id="af-category" ${initialSex ? "" : "disabled"}>
               <option value="" selected>${initialSex ? "Selecione" : "Selecione o sexo primeiro"}</option>
               ${initialSex ? categoriesForSex(initialSex).map((c) => `<option value="${c.value}" ${initialCategory === c.value ? "selected" : ""}>${c.label}</option>`).join("") : ""}
             </select>
             <p class="field-error" id="af-category-error"></p>
           </div>

           <div class="field">
             <span class="field-label">Origem *</span>
             <div class="segmented" role="radiogroup" aria-label="Origem do animal">
               <input type="radio" id="af-origin-purchased" name="af-origin" value="purchased" ${origin === "purchased" ? "checked" : ""} />
               <label for="af-origin-purchased">Compra</label>
               <input type="radio" id="af-origin-born" name="af-origin" value="born" ${origin === "born" ? "checked" : ""} />
               <label for="af-origin-born">Nascimento</label>
             </div>
           </div>

           <div id="af-purchased-fields" class="form-grid" ${origin === "purchased" ? "" : "hidden"}>
             <div class="field field--half">
               <label class="field-label" for="af-purchaseDate">Data da compra *</label>
               <input class="input" id="af-purchaseDate" type="date" value="${toDateInputValue(animal.purchaseDate)}" />
               <p class="field-error" id="af-purchaseDate-error"></p>
             </div>
             <div class="field field--half">
               <label class="field-label" for="af-purchaseWeightKg">Peso na compra (kg) *</label>
               <input class="input" id="af-purchaseWeightKg" type="number" min="0" step="0.1" placeholder="Ex: 220" value="${animal.purchaseWeightKg ?? ""}" />
               <p class="field-error" id="af-purchaseWeightKg-error"></p>
             </div>
             <div class="field">
               <label class="field-label" for="af-purchasePriceBRL">Valor pago (R$) *</label>
               <input class="input" id="af-purchasePriceBRL" type="text" inputmode="decimal" placeholder="R$ 0,00" autocomplete="off" value="${priceValue}" />
               <p class="field-error" id="af-purchasePriceBRL-error"></p>
             </div>
           </div>

           <div id="af-born-fields" class="form-grid" ${origin === "born" ? "" : "hidden"}>
             <div class="field">
               <label class="field-label" for="af-birthDate">Data de nascimento *</label>
               <input class="input" id="af-birthDate" type="date" value="${toDateInputValue(animal.birthDate)}" />
               <p class="field-error" id="af-birthDate-error"></p>
             </div>
           </div>

           <div class="field field--half">
             <label class="field-label" for="af-lot">Lote</label>
             <select class="select" id="af-lot">
               <option value="" ${!animal.lotId ? "selected" : ""}>Sem lote</option>
               ${lotOptions}
             </select>
           </div>

           <div class="field field--half">
             <label class="field-label" for="af-currentWeightKg">Peso atual (kg)</label>
             <input class="input" id="af-currentWeightKg" type="number" min="0" step="0.1" placeholder="Ex: 320" value="${animal.currentWeightKg ?? ""}" />
           </div>

           <div class="field">
             <label class="field-label" for="af-notes">Observações</label>
             <textarea class="textarea" id="af-notes" placeholder="Opcional">${animal.notes ? escapeHtml(animal.notes) : ""}</textarea>
           </div>

           <p class="field-error" id="af-form-error" role="alert"></p>

           <button type="submit" class="btn-primary pressable" id="af-submit">Salvar alterações</button>
         </form>
       `;
     }

     export function clearFieldError(inputId) {
       document.getElementById(inputId)?.classList.remove("has-error");
       const err = document.getElementById(`${inputId}-error`);
       if (err) err.textContent = "";
     }

     export function setFieldError(inputId, message) {
       document.getElementById(inputId)?.classList.add("has-error");
       const err = document.getElementById(`${inputId}-error`);
       if (err) err.textContent = message;
     }

     export function wireAnimalForm(animal) {
       const form = document.getElementById("animal-form");
       const purchasedFields = document.getElementById("af-purchased-fields");
       const bornFields = document.getElementById("af-born-fields");
       const lotSelect = document.getElementById("af-lot");
       const priceInput = document.getElementById("af-purchasePriceBRL");
       const submitBtn = document.getElementById("af-submit");
       const formError = document.getElementById("af-form-error");
       const sexSelect = document.getElementById("af-sex");
       const categorySelect = document.getElementById("af-category");
       const allFieldIds = [
         "af-earTag", "af-category", "af-sex", "af-purchaseDate", "af-purchaseWeightKg",
         "af-purchasePriceBRL", "af-birthDate",
       ];

       function originValue() {
         return form.querySelector('input[name="af-origin"]:checked').value;
       }

       function syncOrigin() {
         const purchased = originValue() === "purchased";
         purchasedFields.hidden = !purchased;
         bornFields.hidden = purchased;
       }
       form.querySelectorAll('input[name="af-origin"]').forEach((r) => r.addEventListener("change", syncOrigin));
       syncOrigin();

       // Category options are scoped to the chosen sex (CATTLE_CATEGORIES).
       // Changing sex invalidates any prior category pick, so it resets.
       sexSelect.addEventListener("change", () => {
         const sex = sexSelect.value;
         categorySelect.disabled = !sex;
         categorySelect.innerHTML = `
           <option value="" selected>${sex ? "Selecione" : "Selecione o sexo primeiro"}</option>
           ${sex ? categoriesForSex(sex).map((c) => `<option value="${c.value}">${c.label}</option>`).join("") : ""}
         `;
       });

       priceInput.addEventListener("input", () => formatCurrencyInput(priceInput));

       form.addEventListener("submit", async (e) => {
         e.preventDefault();
         if (!currentUid) return;

         formError.textContent = "";
         allFieldIds.forEach(clearFieldError);

         let valid = true;
         const fail = (id, msg) => { valid = false; setFieldError(id, msg); };

         const earTag = document.getElementById("af-earTag").value.trim();
         if (!earTag) fail("af-earTag", "Informe o brinco.");

         const category = document.getElementById("af-category").value;
         if (!category) fail("af-category", "Selecione a categoria.");

         const sex = document.getElementById("af-sex").value;
         if (!sex) fail("af-sex", "Selecione o sexo.");

         const origin = originValue();
         let purchaseDate, purchaseWeightKg, purchasePriceBRL, birthDate;

         if (origin === "purchased") {
           purchaseDate = document.getElementById("af-purchaseDate").value;
           if (!purchaseDate) fail("af-purchaseDate", "Informe a data da compra.");

           purchaseWeightKg = parseFloat(document.getElementById("af-purchaseWeightKg").value);
           if (!Number.isFinite(purchaseWeightKg) || purchaseWeightKg <= 0) {
             fail("af-purchaseWeightKg", "Informe o peso na compra.");
           }

           purchasePriceBRL = parseBRLToNumber(priceInput.value);
           if (!Number.isFinite(purchasePriceBRL) || purchasePriceBRL <= 0) {
             fail("af-purchasePriceBRL", "Informe o valor pago.");
           }
         } else {
           birthDate = document.getElementById("af-birthDate").value;
           if (!birthDate) fail("af-birthDate", "Informe a data de nascimento.");
         }

         const lotId = lotSelect.value || null;

         const currentWeightKgRaw = document.getElementById("af-currentWeightKg").value;
         const currentWeightKg = currentWeightKgRaw ? parseFloat(currentWeightKgRaw) : null;
         const notes = document.getElementById("af-notes").value.trim() || null;

         if (!valid) return;

         submitBtn.disabled = true;
         submitBtn.textContent = "Salvando…";

         try {
           // Editar: updateDoc on the existing document — never recreate.
           // Lifecycle fields (status/sale/death) are owned by their own
           // sheets (Vender, Registrar morte, ...), not this form.
           await updateDoc(doc(db, "animals", animal.id), {
             earTag,
             sex,
             category,
             lotId,
             birthDate: origin === "born" ? new Date(`${birthDate}T00:00:00`) : null,
             acquisitionType: origin,
             purchaseDate: origin === "purchased" ? new Date(`${purchaseDate}T00:00:00`) : null,
             purchaseWeightKg: origin === "purchased" ? purchaseWeightKg : null,
             purchaseCostBRL: origin === "purchased" ? purchasePriceBRL : null,
             currentWeightKg,
             notes,
             updatedAt: serverTimestamp(),
           });
           showToast("Animal atualizado.");
           Sheet.close();
         } catch (err) {
           console.warn("[Agro Connect] Falha ao salvar animal:", err?.code ?? err);
           showToast(
             err?.code === "permission-denied"
               ? "Sem permissão para gravar."
               : "Não foi possível salvar. Tente novamente."
           );
           submitBtn.disabled = false;
           submitBtn.textContent = "Salvar alterações";
         }
       });
     }

     export function openEditAnimalSheet(animal) {
       Sheet.open({
         title: `Editar · #${escapeHtml(animal.earTag)}`,
         content: buildAnimalFormHTML(lotsCache, animal),
       });
       wireAnimalForm(animal);
     }

     export function buildActionMenuHTML(animal) {
       const isActive = (animal.status || "active") === "active";
       const lifecycleItems = isActive
         ? `
           <button type="button" class="action-item pressable" data-menu-action="sell">
             <span class="action-icon" aria-hidden="true">${ICONS.sell}</span>
             Vender
           </button>
           <button type="button" class="action-item pressable" data-menu-action="weigh">
             <span class="action-icon" aria-hidden="true">${ICONS.weigh}</span>
             Pesar
           </button>
           <button type="button" class="action-item pressable" data-menu-action="wean">
             <span class="action-icon" aria-hidden="true">${ICONS.wean}</span>
             Desmamar
           </button>
           ${animal.sex === "F" ? `
             <button type="button" class="action-item pressable" data-menu-action="calving">
               <span class="action-icon" aria-hidden="true">${ICONS.calving}</span>
               Registrar 1º parto
             </button>
           ` : ""}
           ${animal.sex === "M" ? `
             <button type="button" class="action-item pressable" data-menu-action="finishing">
               <span class="action-icon" aria-hidden="true">${ICONS.finishing}</span>
               Iniciar terminação
             </button>
           ` : ""}
           <button type="button" class="action-item danger pressable" data-menu-action="death">
             <span class="action-icon" aria-hidden="true">${ICONS.death}</span>
             Registrar morte
           </button>
         `
         : "";
       return `
         <div class="action-list">
           ${lifecycleItems}
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

     export function openActionSheet(animal) {
       Sheet.open({
         title: `Ações · #${escapeHtml(animal.earTag)}`,
         content: buildActionMenuHTML(animal),
       });
       document.querySelectorAll("#sheet-body [data-menu-action]").forEach((btn) => {
         btn.addEventListener("click", () => {
           switch (btn.dataset.menuAction) {
             case "sell": openSaleSheet(animal); break;
             case "weigh": openWeighingSheet(animal); break;
             case "wean": openWeaningSheet(animal); break;
             case "calving": openCalvingSheet(animal); break;
             case "finishing": openFinishingSheet(animal); break;
             case "death": openDeathSheet(animal); break;
             case "edit": openEditAnimalSheet(animal); break;
             case "delete": openDeleteAnimalSheet(animal); break;
             default: Sheet.close();
           }
         });
       });
     }

     // --- Excluir animal (cascade optional: linked events + transactions) ---
     export async function deleteAnimalLinkedRecords(animalId) {
       const eventsQ = query(collection(db, "events"), where("ownerId", "==", currentUid), where("animalId", "==", animalId));
       const txQ = query(collection(db, "transactions"), where("ownerId", "==", currentUid), where("linkedAnimalId", "==", animalId));
       const [eventsSnap, txSnap] = await Promise.all([getDocs(eventsQ), getDocs(txQ)]);
       await Promise.all([
         ...eventsSnap.docs.map((d) => deleteDoc(d.ref)),
         ...txSnap.docs.map((d) => deleteDoc(d.ref)),
       ]);
     }

     export function buildDeleteAnimalHTML(animal) {
       return `
         <div class="form-grid">
           <div class="confirm-warning">
             <span class="confirm-warning-icon" aria-hidden="true">${ICONS.warning}</span>
             <p>Tem certeza que deseja excluir o animal <strong>#${escapeHtml(animal.earTag)}</strong>? Esta ação não pode ser desfeita.</p>
           </div>
           <label class="field confirm-field" for="delete-animal-cascade">
             <input type="checkbox" id="delete-animal-cascade" />
             <span class="field-label">Excluir também os eventos e lançamentos financeiros vinculados a este animal.</span>
           </label>
           <div class="confirm-actions">
             <button type="button" class="btn-secondary pressable" id="delete-animal-cancel">Cancelar</button>
             <button type="button" class="btn-primary btn-danger pressable" id="delete-animal-confirm">Excluir animal</button>
           </div>
         </div>
       `;
     }

     export function wireDeleteAnimalForm(animal) {
       const cancelBtn = document.getElementById("delete-animal-cancel");
       const confirmBtn = document.getElementById("delete-animal-confirm");
       const cascadeBox = document.getElementById("delete-animal-cascade");

       cancelBtn.addEventListener("click", () => Sheet.close());

       confirmBtn.addEventListener("click", async () => {
         if (!currentUid) return;
         confirmBtn.disabled = true;
         cancelBtn.disabled = true;
         confirmBtn.textContent = "Excluindo…";

         try {
           if (cascadeBox.checked) {
             await deleteAnimalLinkedRecords(animal.id);
           }
           await deleteDoc(doc(db, "animals", animal.id));
           showToast("Animal excluído.");
           Sheet.close();
         } catch (err) {
           console.warn("[Agro Connect] Falha ao excluir animal:", err?.code ?? err);
           showToast(
             err?.code === "permission-denied" ? "Sem permissão para excluir." : "Não foi possível excluir. Tente novamente."
           );
           confirmBtn.disabled = false;
           cancelBtn.disabled = false;
           confirmBtn.textContent = "Excluir animal";
         }
       });
     }

     export function openDeleteAnimalSheet(animal) {
       Sheet.open({
         title: `Excluir · #${escapeHtml(animal.earTag)}`,
         content: buildDeleteAnimalHTML(animal),
       });
       wireDeleteAnimalForm(animal);
     }

     // --- Vender ---
     export function buildSaleFormHTML(defaultPrice) {
       return `
         <form id="sale-form" class="form-grid" novalidate>
           <div class="field field--half">
             <label class="field-label" for="sale-date">Data da venda *</label>
             <input class="input" id="sale-date" type="date" />
             <p class="field-error" id="sale-date-error"></p>
           </div>
           <div class="field field--half">
             <label class="field-label" for="sale-arrobas">Peso de carcaça (@) *</label>
             <input class="input" id="sale-arrobas" type="number" min="0" step="0.01" placeholder="Ex: 21" />
             <p class="field-error" id="sale-arrobas-error"></p>
           </div>
           <div class="field field--half">
             <label class="field-label" for="sale-price">Preço da @ (R$) *</label>
             <input class="input" id="sale-price" type="text" inputmode="decimal" placeholder="R$ 0,00" autocomplete="off" value="${defaultPrice != null ? formatBRL(defaultPrice) : ""}" />
             <p class="field-error" id="sale-price-error"></p>
           </div>
           <div class="field field--half">
             <span class="field-label">Valor da venda</span>
             <p class="stat-value" id="sale-total" style="font-size: var(--fs-lg);">R$ 0,00</p>
           </div>
           <p class="field-error" id="sale-form-error" role="alert"></p>
           <button type="submit" class="btn-primary pressable" id="sale-submit">Confirmar venda</button>
         </form>
       `;
     }

     export function wireSaleForm(animal) {
       const form = document.getElementById("sale-form");
       const arrobasInput = document.getElementById("sale-arrobas");
       const priceInput = document.getElementById("sale-price");
       const totalEl = document.getElementById("sale-total");
       const submitBtn = document.getElementById("sale-submit");
       const formError = document.getElementById("sale-form-error");

       function recomputeTotal() {
         const arrobas = parseFloat(arrobasInput.value);
         const price = parseBRLToNumber(priceInput.value);
         const total = Number.isFinite(arrobas) && Number.isFinite(price) ? arrobas * price : 0;
         totalEl.textContent = formatBRL(total);
         return total;
       }
       arrobasInput.addEventListener("input", recomputeTotal);
       priceInput.addEventListener("input", () => { formatCurrencyInput(priceInput); recomputeTotal(); });
       recomputeTotal();

       form.addEventListener("submit", async (e) => {
         e.preventDefault();
         if (!currentUid) return;

         formError.textContent = "";
         ["sale-date", "sale-arrobas", "sale-price"].forEach(clearFieldError);

         let valid = true;
         const fail = (id, msg) => { valid = false; setFieldError(id, msg); };

         const dateStr = document.getElementById("sale-date").value;
         if (!dateStr) fail("sale-date", "Informe a data da venda.");

         const arrobas = parseFloat(arrobasInput.value);
         if (!Number.isFinite(arrobas) || arrobas <= 0) fail("sale-arrobas", "Informe o peso de carcaça em @.");

         const price = parseBRLToNumber(priceInput.value);
         if (!Number.isFinite(price) || price <= 0) fail("sale-price", "Informe o preço da @.");

         if (!valid) return;

         const revenue = arrobas * price;
         const saleDate = new Date(`${dateStr}T00:00:00`);

         submitBtn.disabled = true;
         submitBtn.textContent = "Salvando…";

         try {
           await updateDoc(doc(db, "animals", animal.id), {
             status: "sold",
             saleDate,
             saleArrobas: arrobas,
             salePricePerArrobaBRL: price,
             saleRevenueBRL: revenue,
             updatedAt: serverTimestamp(),
           });
           await addDoc(collection(db, "events"), {
             ownerId: currentUid,
             type: "sale",
             animalId: animal.id,
             lotId: animal.lotId || null,
             date: saleDate,
             payload: { arrobas, pricePerArrobaBRL: price, revenueBRL: revenue },
             createdAt: serverTimestamp(),
           });
           const r = applyFunruralRetention(revenue, "pj");
           await addDoc(collection(db, "transactions"), {
             ownerId: currentUid,
             kind: "receita",
             category: "venda-animal",
             costNature: null,
             buyerType: "pj",
             amountBRL: r.netBRL,
             grossBRL: r.grossBRL,
             funruralRetidoBRL: r.funruralRetidoBRL,
             date: saleDate,
             linkedScope: "animal",
             linkedAnimalId: animal.id,
             linkedLotId: null,
             description: null,
             createdAt: serverTimestamp(),
           });
           showToast("Venda registrada.");
           Sheet.close();
         } catch (err) {
           console.warn("[Agro Connect] Falha ao registrar venda:", err?.code ?? err);
           formError.textContent =
             err?.code === "permission-denied"
               ? "Sem permissão para gravar."
               : "Não foi possível salvar. Tente novamente.";
           submitBtn.disabled = false;
           submitBtn.textContent = "Confirmar venda";
         }
       });
     }

     export function openSaleSheet(animal) {
       const lot = animal.lotId ? lotsCache.find((l) => l.id === animal.lotId) : null;
       const prop = lot?.propertyId ? propertiesCache.find((p) => p.id === lot.propertyId) : null;
       const defaultPrice = Number.isFinite(prop?.defaultArrobaPriceBRL)
         ? prop.defaultArrobaPriceBRL
         : settingsCache.defaultArrobaPriceBRL;
       Sheet.open({
         title: `Vender · #${escapeHtml(animal.earTag)}`,
         content: buildSaleFormHTML(defaultPrice),
       });
       wireSaleForm(animal);
     }

     // --- Pesar ---
     export function buildWeighingFormHTML() {
       return `
         <form id="weigh-form" class="form-grid" novalidate>
           <div class="field field--half">
             <label class="field-label" for="weigh-date">Data da pesagem *</label>
             <input class="input" id="weigh-date" type="date" />
             <p class="field-error" id="weigh-date-error"></p>
           </div>
           <div class="field field--half">
             <label class="field-label" for="weigh-weight">Peso (kg) *</label>
             <input class="input" id="weigh-weight" type="number" min="0" step="0.1" placeholder="Ex: 340" />
             <p class="field-error" id="weigh-weight-error"></p>
           </div>
           <p class="field-error" id="weigh-form-error" role="alert"></p>
           <button type="submit" class="btn-primary pressable" id="weigh-submit">Registrar pesagem</button>
         </form>
       `;
     }

     export function wireWeighingForm(animal) {
       const form = document.getElementById("weigh-form");
       const submitBtn = document.getElementById("weigh-submit");
       const formError = document.getElementById("weigh-form-error");

       form.addEventListener("submit", async (e) => {
         e.preventDefault();
         if (!currentUid) return;

         formError.textContent = "";
         ["weigh-date", "weigh-weight"].forEach(clearFieldError);

         let valid = true;
         const fail = (id, msg) => { valid = false; setFieldError(id, msg); };

         const dateStr = document.getElementById("weigh-date").value;
         if (!dateStr) fail("weigh-date", "Informe a data da pesagem.");

         const weightKg = parseFloat(document.getElementById("weigh-weight").value);
         if (!Number.isFinite(weightKg) || weightKg <= 0) fail("weigh-weight", "Informe o peso.");

         if (!valid) return;

         const date = new Date(`${dateStr}T00:00:00`);

         submitBtn.disabled = true;
         submitBtn.textContent = "Salvando…";

         try {
           await addDoc(collection(db, "events"), {
             ownerId: currentUid,
             type: "weighing",
             animalId: animal.id,
             lotId: animal.lotId || null,
             date,
             payload: { weightKg },
             createdAt: serverTimestamp(),
           });
           await updateDoc(doc(db, "animals", animal.id), {
             currentWeightKg: weightKg,
             updatedAt: serverTimestamp(),
           });
           showToast("Pesagem registrada.");
           Sheet.close();
         } catch (err) {
           console.warn("[Agro Connect] Falha ao registrar pesagem:", err?.code ?? err);
           formError.textContent =
             err?.code === "permission-denied"
               ? "Sem permissão para gravar."
               : "Não foi possível salvar. Tente novamente.";
           submitBtn.disabled = false;
           submitBtn.textContent = "Registrar pesagem";
         }
       });
     }

     export function openWeighingSheet(animal) {
       Sheet.open({
         title: `Pesar · #${escapeHtml(animal.earTag)}`,
         content: buildWeighingFormHTML(),
       });
       wireWeighingForm(animal);
     }

     // --- Desmamar ---
     export function buildWeaningFormHTML() {
       return `
         <form id="wean-form" class="form-grid" novalidate>
           <div class="field field--half">
             <label class="field-label" for="wean-date">Data da desmama *</label>
             <input class="input" id="wean-date" type="date" />
             <p class="field-error" id="wean-date-error"></p>
           </div>
           <div class="field field--half">
             <label class="field-label" for="wean-weight">Peso (kg)</label>
             <input class="input" id="wean-weight" type="number" min="0" step="0.1" placeholder="Opcional" />
           </div>
           <p class="field-error" id="wean-form-error" role="alert"></p>
           <button type="submit" class="btn-primary pressable" id="wean-submit">Registrar desmama</button>
         </form>
       `;
     }

     export function wireWeaningForm(animal) {
       const form = document.getElementById("wean-form");
       const submitBtn = document.getElementById("wean-submit");
       const formError = document.getElementById("wean-form-error");

       form.addEventListener("submit", async (e) => {
         e.preventDefault();
         if (!currentUid) return;

         formError.textContent = "";
         clearFieldError("wean-date");

         let valid = true;
         const fail = (id, msg) => { valid = false; setFieldError(id, msg); };

         const dateStr = document.getElementById("wean-date").value;
         if (!dateStr) fail("wean-date", "Informe a data da desmama.");

         const weightRaw = document.getElementById("wean-weight").value;
         const weightKg = weightRaw ? parseFloat(weightRaw) : null;

         if (!valid) return;

         const date = new Date(`${dateStr}T00:00:00`);

         submitBtn.disabled = true;
         submitBtn.textContent = "Salvando…";

         try {
           await addDoc(collection(db, "events"), {
             ownerId: currentUid,
             type: "weaning",
             animalId: animal.id,
             lotId: animal.lotId || null,
             date,
             payload: { weightKg, damAnimalId: animal.damAnimalId || null },
             createdAt: serverTimestamp(),
           });
           // Stamp the date only — the displayed category is derived from it
           // (deriveStage), never written back to the stored category.
           await updateDoc(doc(db, "animals", animal.id), {
             weaningDate: date,
             updatedAt: serverTimestamp(),
           });
           showToast("Desmama registrada.");
           Sheet.close();
         } catch (err) {
           console.warn("[Agro Connect] Falha ao registrar desmama:", err?.code ?? err);
           formError.textContent =
             err?.code === "permission-denied"
               ? "Sem permissão para gravar."
               : "Não foi possível salvar. Tente novamente.";
           submitBtn.disabled = false;
           submitBtn.textContent = "Registrar desmama";
         }
       });
     }

     export function openWeaningSheet(animal) {
       Sheet.open({
         title: `Desmamar · #${escapeHtml(animal.earTag)}`,
         content: buildWeaningFormHTML(),
       });
       wireWeaningForm(animal);
     }

     // --- Shared "stamp a date" sheet: backs "Registrar 1º parto",
     //     "Iniciar terminação" and the lot-level "Registrar desmama" — each
     //     is just a date input that (a) appends an events doc and (b)
     //     stamps one field on the animal/lot doc. The displayed category
     //     is derived from that stamp (deriveStage), never written directly.
     export function buildStampFormHTML(dateLabel, submitLabel) {
       return `
         <form id="stamp-form" class="form-grid" novalidate>
           <div class="field">
             <label class="field-label" for="stamp-date">${dateLabel} *</label>
             <input class="input" id="stamp-date" type="date" value="${toDateInputValue(new Date())}" />
             <p class="field-error" id="stamp-date-error"></p>
           </div>
           <p class="field-error" id="stamp-form-error" role="alert"></p>
           <button type="submit" class="btn-primary pressable" id="stamp-submit">${submitLabel}</button>
         </form>
       `;
     }

     export function wireStampForm({ submitLabel, onSubmit }) {
       const form = document.getElementById("stamp-form");
       const submitBtn = document.getElementById("stamp-submit");
       const formError = document.getElementById("stamp-form-error");

       form.addEventListener("submit", async (e) => {
         e.preventDefault();
         if (!currentUid) return;

         formError.textContent = "";
         clearFieldError("stamp-date");

         const dateStr = document.getElementById("stamp-date").value;
         if (!dateStr) { setFieldError("stamp-date", "Informe a data."); return; }

         const date = new Date(`${dateStr}T00:00:00`);

         submitBtn.disabled = true;
         submitBtn.textContent = "Salvando…";

         try {
           await onSubmit(date);
           Sheet.close();
         } catch (err) {
           console.warn("[Agro Connect] Falha ao registrar:", err?.code ?? err);
           formError.textContent =
             err?.code === "permission-denied"
               ? "Sem permissão para gravar."
               : "Não foi possível salvar. Tente novamente.";
           submitBtn.disabled = false;
           submitBtn.textContent = submitLabel;
         }
       });
     }

     export function openStampSheet({ title, dateLabel, submitLabel, onSubmit }) {
       Sheet.open({ title, content: buildStampFormHTML(dateLabel, submitLabel) });
       wireStampForm({ submitLabel, onSubmit });
     }

     // --- Registrar 1º parto (fêmeas) ---
     export function openCalvingSheet(animal) {
       openStampSheet({
         title: `Registrar 1º parto · #${escapeHtml(animal.earTag)}`,
         dateLabel: "Data do 1º parto",
         submitLabel: "Registrar 1º parto",
         onSubmit: async (date) => {
           await addDoc(collection(db, "events"), {
             ownerId: currentUid,
             type: "calving",
             animalId: animal.id,
             lotId: animal.lotId || null,
             date,
             payload: {},
             createdAt: serverTimestamp(),
           });
           await updateDoc(doc(db, "animals", animal.id), { firstCalvingDate: date, updatedAt: serverTimestamp() });
           showToast("1º parto registrado.");
         },
       });
     }

     export function openLotCalvingSheet(lot) {
       openStampSheet({
         title: `Registrar 1º parto · ${escapeHtml(lot.name)}`,
         dateLabel: "Data do 1º parto",
         submitLabel: "Registrar 1º parto",
         onSubmit: async (date) => {
           await addDoc(collection(db, "events"), {
             ownerId: currentUid,
             type: "calving",
             animalId: null,
             lotId: lot.id,
             date,
             payload: {},
             createdAt: serverTimestamp(),
           });
           await updateDoc(doc(db, "lots", lot.id), { firstCalvingDate: date, updatedAt: serverTimestamp() });
           showToast("1º parto registrado para o lote.");
         },
       });
     }

     // --- Iniciar terminação (machos) ---
     export function openFinishingSheet(animal) {
       openStampSheet({
         title: `Iniciar terminação · #${escapeHtml(animal.earTag)}`,
         dateLabel: "Data de início da terminação",
         submitLabel: "Iniciar terminação",
         onSubmit: async (date) => {
           await addDoc(collection(db, "events"), {
             ownerId: currentUid,
             type: "finishing",
             animalId: animal.id,
             lotId: animal.lotId || null,
             date,
             payload: {},
             createdAt: serverTimestamp(),
           });
           await updateDoc(doc(db, "animals", animal.id), { finishingStartDate: date, updatedAt: serverTimestamp() });
           showToast("Terminação iniciada.");
         },
       });
     }

     export function openLotFinishingSheet(lot) {
       openStampSheet({
         title: `Iniciar terminação · ${escapeHtml(lot.name)}`,
         dateLabel: "Data de início da terminação",
         submitLabel: "Iniciar terminação",
         onSubmit: async (date) => {
           await addDoc(collection(db, "events"), {
             ownerId: currentUid,
             type: "finishing",
             animalId: null,
             lotId: lot.id,
             date,
             payload: {},
             createdAt: serverTimestamp(),
           });
           await updateDoc(doc(db, "lots", lot.id), { finishingStartDate: date, updatedAt: serverTimestamp() });
           showToast("Terminação iniciada para o lote.");
         },
       });
     }

     // --- Registrar desmama (lote) ---
     export function openLotWeaningSheet(lot) {
       openStampSheet({
         title: `Registrar desmama · ${escapeHtml(lot.name)}`,
         dateLabel: "Data da desmama",
         submitLabel: "Registrar desmama",
         onSubmit: async (date) => {
           await addDoc(collection(db, "events"), {
             ownerId: currentUid,
             type: "weaning",
             animalId: null,
             lotId: lot.id,
             date,
             payload: {},
             createdAt: serverTimestamp(),
           });
           await updateDoc(doc(db, "lots", lot.id), { weaningDate: date, updatedAt: serverTimestamp() });
           showToast("Desmama registrada para o lote.");
         },
       });
     }

     // --- Registrar morte ---
     export function buildDeathFormHTML() {
       return `
         <form id="death-form" class="form-grid" novalidate>
           <div class="field">
             <label class="field-label" for="death-date">Data do óbito *</label>
             <input class="input" id="death-date" type="date" />
             <p class="field-error" id="death-date-error"></p>
           </div>
           <div class="field">
             <label class="field-label" for="death-cause">Causa *</label>
             <textarea class="textarea" id="death-cause" placeholder="Ex: complicação clínica, acidente…"></textarea>
             <p class="field-error" id="death-cause-error"></p>
           </div>
           <label class="field confirm-field" for="death-confirm">
             <input type="checkbox" id="death-confirm" />
             <span class="field-label">Confirmo o registro de morte deste animal — esta ação não pode ser desfeita.</span>
           </label>
           <p class="field-error" id="death-form-error" role="alert"></p>
           <button type="submit" class="btn-primary btn-danger pressable" id="death-submit" disabled>Registrar morte</button>
         </form>
       `;
     }

     export function wireDeathForm(animal) {
       const form = document.getElementById("death-form");
       const confirmBox = document.getElementById("death-confirm");
       const submitBtn = document.getElementById("death-submit");
       const formError = document.getElementById("death-form-error");

       confirmBox.addEventListener("change", () => {
         submitBtn.disabled = !confirmBox.checked;
       });

       form.addEventListener("submit", async (e) => {
         e.preventDefault();
         if (!currentUid) return;

         formError.textContent = "";
         ["death-date", "death-cause"].forEach(clearFieldError);

         let valid = true;
         const fail = (id, msg) => { valid = false; setFieldError(id, msg); };

         const dateStr = document.getElementById("death-date").value;
         if (!dateStr) fail("death-date", "Informe a data.");

         const cause = document.getElementById("death-cause").value.trim();
         if (!cause) fail("death-cause", "Informe a causa.");

         if (!confirmBox.checked) {
           valid = false;
           formError.textContent = "Confirme o registro para continuar.";
         }

         if (!valid) return;

         const deathDate = new Date(`${dateStr}T00:00:00`);

         submitBtn.disabled = true;
         submitBtn.textContent = "Salvando…";

         try {
           await updateDoc(doc(db, "animals", animal.id), {
             status: "dead",
             deathDate,
             deathCause: cause,
             updatedAt: serverTimestamp(),
           });
           await addDoc(collection(db, "events"), {
             ownerId: currentUid,
             type: "death",
             animalId: animal.id,
             lotId: animal.lotId || null,
             date: deathDate,
             payload: { cause },
             createdAt: serverTimestamp(),
           });
           showToast("Óbito registrado.");
           Sheet.close();
         } catch (err) {
           console.warn("[Agro Connect] Falha ao registrar morte:", err?.code ?? err);
           formError.textContent =
             err?.code === "permission-denied"
               ? "Sem permissão para gravar."
               : "Não foi possível salvar. Tente novamente.";
           submitBtn.disabled = false;
           submitBtn.textContent = "Registrar morte";
         }
       });
     }

     export function openDeathSheet(animal) {
       Sheet.open({
         title: `Registrar morte · #${escapeHtml(animal.earTag)}`,
         content: buildDeathFormHTML(),
       });
       wireDeathForm(animal);
     }

     // --- Shared lookups over eventsCache/animalsCache ---
     export function animalEvents(animalId, type) {
       return eventsCache.filter((e) => e.animalId === animalId && e.type === type);
     }

     export function computeAnimalWeighingRows(animal) {
       const weighings = animalEvents(animal.id, "weighing").slice().sort((a, b) => toDateSafe(a.date) - toDateSafe(b.date));
       return weighings.map((w, i) => {
         const date = toDateSafe(w.date);
         const weight = w.payload?.weightKg;
         let gainLabel = "";
         if (i > 0) {
           const prev = weighings[i - 1];
           const prevDate = toDateSafe(prev.date);
           const days = (date - prevDate) / 86_400_000;
           if (days > 0 && Number.isFinite(weight) && Number.isFinite(prev.payload?.weightKg)) {
             const gDia = ((weight - prev.payload.weightKg) * 1000) / days;
             gainLabel = `${gDia >= 0 ? "+" : ""}${fmtNum(gDia)} g/dia`;
           }
         }
         return { date, weight, gainLabel };
       });
     }

     export function buildAnimalDetailHTML(animal) {
       const isActive = (animal.status || "active") === "active";
       const days = isActive ? daysOnFarm(animal) : saleDaysHeld(animal);
       const saleResult = computeSaleResult(animal, transactionsCache);
       const weighingRows = computeAnimalWeighingRows(animal);

       const weighingListHTML = weighingRows.length
         ? `<ul class="weighing-list">${weighingRows
             .map(
               (w) => `
               <li class="weighing-row">
                 <span>${w.date ? formatDayLabel(w.date) : "—"}</span>
                 <span>${w.weight != null ? `${formatKg(w.weight)} kg` : "—"}</span>
                 <span class="weighing-gain">${escapeHtml(w.gainLabel)}</span>
               </li>
             `
             )
             .join("")}</ul>`
         : `<p class="field-hint">Nenhuma pesagem registrada — use "Pesar" para acompanhar o GMD deste animal.</p>`;

       const resultHTML = saleResult
         ? `
           <div class="detail-section">
             <p class="detail-section-title">Resultado</p>
             <div class="result-grid">
               <div class="result-tile">
                 <p class="result-value">${saleResult.days}</p>
                 <p class="result-label">Dias até a venda</p>
               </div>
               <div class="result-tile">
                 <p class="result-value">${formatBRL(saleResult.profit)}</p>
                 <p class="result-label">Lucro total</p>
               </div>
               <div class="result-tile">
                 <p class="result-value">${formatBRL(saleResult.dailyProfit)}</p>
                 <p class="result-label">Lucro/dia</p>
               </div>
             </div>
           </div>
         `
         : "";

       return `
         <div class="card-stats" style="grid-template-columns: repeat(3, 1fr); border-top: none; padding-top: 0;">
           <div class="mini-stat">
             <p class="mini-value">${animal.currentWeightKg != null ? `${formatKg(animal.currentWeightKg)} kg` : "—"}</p>
             <p class="mini-label">Peso atual</p>
           </div>
           <div class="mini-stat">
             <p class="mini-value">${days != null ? `${days} d` : "—"}</p>
             <p class="mini-label">${isActive ? "Na fazenda" : "Dias até a venda"}</p>
           </div>
           <div class="mini-stat">
             <p class="mini-value">${statusLabel[animal.status] || "Ativo"}</p>
             <p class="mini-label">Status</p>
           </div>
         </div>

         ${resultHTML}

         <div class="detail-section">
           <p class="detail-section-title">Histórico de pesagens</p>
           ${weighingListHTML}
         </div>

         <div class="detail-section">
           <button type="button" class="btn-secondary pressable" id="animal-detail-actions-btn">Ações do animal</button>
         </div>
       `;
     }

     export function openAnimalDetailSheet(animal) {
       Sheet.open({
         title: `#${escapeHtml(animal.earTag)}`,
         content: buildAnimalDetailHTML(animal),
       });
       document.getElementById("animal-detail-actions-btn")?.addEventListener("click", () => openActionSheet(animal));
     }
