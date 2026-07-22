import {
  db, doc, updateDoc, deleteDoc, serverTimestamp, collection, addDoc, query, where, getDocs,
} from "../../js/core/firebase.js";
import {
  CATTLE_CATEGORIES, categoriesForSex, resolveCategoryKey, deriveStage, statusLabel, ICONS,
  animalStageLabel, animalStageChipClass, displayCategoryKeyForAnimal, lifecycleActionsFor,
} from "../../js/core/constants.js";
import {
  escapeHtml, toDateSafe, toDateInputValue, daysOnFarm, formatKg, formatCurrencyInput,
  parseBRLToNumber, formatBRL, saleDaysHeld, computeSaleResult, formatDayLabel, fmtNum,
} from "../../js/core/helpers.js";
import {
  currentUid, lotsCache, animalsCache, transactionsCache, eventsCache,
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
       const lot = animal.lotId ? lotsCache.find((l) => l.id === animal.lotId) : null;
       const stageKey = displayCategoryKeyForAnimal(animal, lot);
       const { wean, finishing, calving } = lifecycleActionsFor({
         stageKey,
         sex: animal.sex,
         weaningDate: animal.weaningDate,
         finishingStartDate: animal.finishingStartDate,
       });

       const registrosItems = isActive
         ? [
             wean ? `
               <button type="button" class="action-item pressable" data-menu-action="wean">
                 <span class="action-icon" aria-hidden="true">${ICONS.wean}</span>
                 Desmamar
               </button>
             ` : "",
             calving ? `
               <button type="button" class="action-item pressable" data-menu-action="calving">
                 <span class="action-icon" aria-hidden="true">${ICONS.calving}</span>
                 ${animal.firstCalvingDate ? "Registrar parto" : "Registrar 1º parto"}
               </button>
             ` : "",
             finishing ? `
               <button type="button" class="action-item pressable" data-menu-action="finishing">
                 <span class="action-icon" aria-hidden="true">${ICONS.finishing}</span>
                 Iniciar terminação
               </button>
             ` : "",
             `
               <button type="button" class="action-item danger pressable" data-menu-action="death">
                 <span class="action-icon" aria-hidden="true">${ICONS.death}</span>
                 Registrar morte
               </button>
             `,
           ].filter(Boolean).join("")
         : "";

       return `
         <div class="action-list">
           ${registrosItems ? `
             <div class="action-group">
               <div class="action-group-title">Registros</div>
               ${registrosItems}
             </div>
           ` : ""}
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

     export function openActionSheet(animal) {
       Sheet.open({
         title: `Ações · #${escapeHtml(animal.earTag)}`,
         content: buildActionMenuHTML(animal),
       });
       document.querySelectorAll("#sheet-body [data-menu-action]").forEach((btn) => {
         btn.addEventListener("click", () => {
           switch (btn.dataset.menuAction) {
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

     // --- Registrar parto (fêmeas): 1º parto stamps firstCalvingDate and
     //     starts the count; every parto after that only advances
     //     lastCalvingDate/calvingCount — firstCalvingDate never changes
     //     again. The stage this derives to (novilha de 1ª cria vs. vaca)
     //     comes from calvingCount, not from firstCalvingDate alone. ---
     export function openCalvingSheet(animal) {
       const isFirst = !animal.firstCalvingDate;
       const title = isFirst ? "Registrar 1º parto" : "Registrar parto";
       openStampSheet({
         title: `${title} · #${escapeHtml(animal.earTag)}`,
         dateLabel: isFirst ? "Data do 1º parto" : "Data do parto",
         submitLabel: title,
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
           const stamps = isFirst
             ? { firstCalvingDate: date, lastCalvingDate: date, calvingCount: 1 }
             : { lastCalvingDate: date, calvingCount: (animal.calvingCount ?? 1) + 1 };
           await updateDoc(doc(db, "animals", animal.id), { ...stamps, updatedAt: serverTimestamp() });
           showToast(isFirst ? "1º parto registrado." : "Parto registrado.");
         },
       });
     }

     export function openLotCalvingSheet(lot) {
       const isFirst = !lot.firstCalvingDate;
       const title = isFirst ? "Registrar 1º parto" : "Registrar parto";
       openStampSheet({
         title: `${title} · ${escapeHtml(lot.name)}`,
         dateLabel: isFirst ? "Data do 1º parto" : "Data do parto",
         submitLabel: title,
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
           const stamps = isFirst
             ? { firstCalvingDate: date, lastCalvingDate: date, calvingCount: 1 }
             : { lastCalvingDate: date, calvingCount: (lot.calvingCount ?? 1) + 1 };
           await updateDoc(doc(db, "lots", lot.id), { ...stamps, updatedAt: serverTimestamp() });
           showToast(isFirst ? "1º parto registrado para o lote." : "Parto registrado para o lote.");
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

     // --- "Ver animais" (per-lot tagged-animal list) ---
     // Re-attaches the flat herd list's card UI, scoped to one lot, routing
     // to the sheets already defined above — no new animal features here.
     export let openLotAnimalsLotId = null;
     export function setOpenLotAnimalsLotId(id) { openLotAnimalsLotId = id; }

     export function buildLotAnimalsHTML(lot) {
       const animals = animalsCache
         .filter((a) => a.lotId === lot.id)
         .slice()
         .sort((a, b) => (a.earTag || "").localeCompare(b.earTag || "", undefined, { numeric: true }));

       if (!animals.length) {
         return `
           <div class="form-grid">
             <div class="empty-state">
               <span class="icon" aria-hidden="true">${ICONS.tag}</span>
               <h3>Nenhum animal com brinco neste lote</h3>
             </div>
           </div>
         `;
       }

       const active = animals.filter((a) => (a.status || "active") === "active");
       const cards = animals
         .map((a) => {
           const days = daysOnFarm(a);
           const weight = a.currentWeightKg != null ? `${formatKg(a.currentWeightKg)} kg` : "—";
           const chipClass = animalStageChipClass(a, lot);
           const saleResult = computeSaleResult(a, transactionsCache);
           return `
             <li class="card pressable" data-animal-id="${escapeHtml(a.id)}" tabindex="0" role="button" aria-label="Ver detalhes do animal #${escapeHtml(a.earTag)}">
               <div class="card-top">
                 <span class="ear-tag"><span class="hash">#</span>${escapeHtml(a.earTag)}</span>
                 <div class="card-top-right">
                   <span class="chip ${chipClass}">${escapeHtml(animalStageLabel(a, lot))}</span>
                   <button type="button" class="card-menu-btn pressable" data-action="animal-menu" data-id="${escapeHtml(a.id)}" aria-label="Ações do animal #${escapeHtml(a.earTag)}">
                     ${ICONS.menu}
                   </button>
                 </div>
               </div>
               <div class="card-stats">
                 <div class="mini-stat">
                   <p class="mini-value">${weight}</p>
                   <p class="mini-label">Peso atual</p>
                 </div>
                 <div class="mini-stat">
                   <p class="mini-value">${days != null ? `${days} d` : "—"}</p>
                   <p class="mini-label">Na fazenda</p>
                 </div>
                 <div class="mini-stat">
                   <p class="mini-value">${statusLabel[a.status] || "Ativo"}</p>
                   <p class="mini-label">Status</p>
                 </div>
               </div>
               ${saleResult ? `
                 <div class="sale-result">
                   <span><strong>${saleResult.days}</strong> dias</span>
                   <span>Lucro <strong>${formatBRL(saleResult.profit)}</strong></span>
                   <span><strong>${formatBRL(saleResult.dailyProfit)}</strong>/dia</span>
                 </div>
               ` : ""}
             </li>
           `;
         })
         .join("");

       return `
         <div class="form-grid">
           <p class="field-hint">${active.length} de ${animals.length} ativos</p>
           <ul class="herd-list">${cards}</ul>
         </div>
       `;
     }

     // Delegated on #sheet-body (not on individual cards) so a live refresh
     // that swaps the whole list back in doesn't need to re-bind per card.
     // Re-wiring removes the previous delegated pair first — #sheet-body is a
     // stable node reused by every Sheet.open(), so binding without removing
     // would stack a duplicate handler on every open/refresh of this sheet.
     let _lotAnimalsClickHandler = null;
     let _lotAnimalsKeydownHandler = null;

     export function wireLotAnimalsSheet(lot) {
       const bodyEl = document.getElementById("sheet-body");
       if (!bodyEl) return;
       const back = () => openLotAnimalsSheet(lot);

       if (_lotAnimalsClickHandler) bodyEl.removeEventListener("click", _lotAnimalsClickHandler);
       if (_lotAnimalsKeydownHandler) bodyEl.removeEventListener("keydown", _lotAnimalsKeydownHandler);

       function activate(e) {
         const menuBtn = e.target.closest('[data-action="animal-menu"]');
         if (menuBtn) {
           const animal = animalsCache.find((a) => a.id === menuBtn.dataset.id);
           if (animal) {
             openLotAnimalsLotId = null;
             openActionSheet(animal);
             Sheet.setBack(back);
           }
           return;
         }
         const card = e.target.closest("li[data-animal-id]");
         if (!card) return;
         const animal = animalsCache.find((a) => a.id === card.dataset.animalId);
         if (animal) {
           openLotAnimalsLotId = null;
           openAnimalDetailSheet(animal);
           Sheet.setBack(back);
         }
       }

       _lotAnimalsClickHandler = activate;
       _lotAnimalsKeydownHandler = (e) => {
         if (e.key !== "Enter" && e.key !== " ") return;
         if (e.target.closest('[data-action="animal-menu"]')) return; // native button handles its own activation
         if (!e.target.closest("li[data-animal-id]")) return;
         e.preventDefault();
         activate(e);
       };

       bodyEl.addEventListener("click", _lotAnimalsClickHandler);
       bodyEl.addEventListener("keydown", _lotAnimalsKeydownHandler);
     }

     export function openLotAnimalsSheet(lot) {
       openLotAnimalsLotId = lot.id;
       Sheet.open({
         title: `Animais · ${escapeHtml(lot.name)}`,
         content: buildLotAnimalsHTML(lot),
         onClose: () => { openLotAnimalsLotId = null; },
       });
       wireLotAnimalsSheet(lot);
     }

     // Keeps the list live while open — animals arrive on their own
     // onSnapshot listener (selling/weighing/editing an animal elsewhere
     // should be reflected here without a manual reopen).
     export function refreshLotAnimalsSheetIfOpen() {
       if (!openLotAnimalsLotId) return;
       const lot = lotsCache.find((l) => l.id === openLotAnimalsLotId);
       if (!lot) { openLotAnimalsLotId = null; Sheet.close(); return; }
       const bodyEl = document.getElementById("sheet-body");
       if (bodyEl) bodyEl.innerHTML = buildLotAnimalsHTML(lot);
       wireLotAnimalsSheet(lot);
     }
