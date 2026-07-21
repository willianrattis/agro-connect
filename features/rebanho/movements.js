import { db, doc, updateDoc, serverTimestamp, collection, addDoc } from "../../js/core/firebase.js";
import { MOVEMENT_TYPE_LABEL, MOVEMENT_TYPE_BY_VALUE } from "../../js/core/constants.js";
import { escapeHtml, toDateInputValue, movementDeltas, formatCurrencyInput, parseBRLToNumber, formatBRL } from "../../js/core/helpers.js";
import { currentUid, confinementsCache } from "../../js/core/state.js";
import { Sheet } from "../../js/core/sheet.js";
import { showToast } from "../../js/core/auth.js";
import { clearFieldError, setFieldError } from "./animals.js";
import { fmtNum } from "../indicadores/indicadores.js";

     // --- "Nova movimentação" form ---
     export function buildMovementFormHTML(lot) {
       const MOVEMENT_TYPE_GROUPS = [
         { label: "Entradas", values: ["entry", "birth", "confinement_return"] },
         { label: "Saídas",   values: ["sale", "shipment", "death", "confinement_out"] },
         { label: "Outros",   values: ["adjustment"] },
       ];
       const typeOptions = MOVEMENT_TYPE_GROUPS
         .map((g) => `<optgroup label="${g.label}">${
           g.values.map((v) => `<option value="${v}">${MOVEMENT_TYPE_LABEL[v]}</option>`).join("")
         }</optgroup>`)
         .join("");
       const confinamentoOptions = confinementsCache
         .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`)
         .join("");
       return `
         <form id="mv-form" class="form-grid" novalidate>
           <div class="field field--half">
             <label class="field-label" for="mv-type">Tipo *</label>
             <select class="select" id="mv-type">
               <option value="" selected>Selecione</option>
               ${typeOptions}
             </select>
             <p class="field-error" id="mv-type-error"></p>
           </div>

           <div class="field field--half">
             <label class="field-label" for="mv-date">Data *</label>
             <input class="input" id="mv-date" type="date" value="${toDateInputValue(new Date())}" />
             <p class="field-error" id="mv-date-error"></p>
           </div>

           <div class="field">
             <span class="field-label">Sinal</span>
             <div class="segmented" role="radiogroup" aria-label="Entrada ou saída">
               <input type="radio" id="mv-sign-plus" name="mv-sign" value="+" checked />
               <label for="mv-sign-plus">+ Entrada</label>
               <input type="radio" id="mv-sign-minus" name="mv-sign" value="-" />
               <label for="mv-sign-minus">− Saída</label>
             </div>
           </div>

           <div class="field" id="mv-confinamento-field" hidden>
             <label class="field-label" for="mv-confinamento">Confinamento *</label>
             <select class="select" id="mv-confinamento">
               <option value="" selected>Selecione</option>
               ${confinamentoOptions}
               <option value="__new__">+ Novo confinamento…</option>
             </select>
             <p class="field-error" id="mv-confinamento-error"></p>
           </div>
           <div class="field" id="mv-newconfinamento-field" hidden>
             <label class="field-label" for="mv-newconfinamento-name">Nome do novo confinamento *</label>
             <input class="input" id="mv-newconfinamento-name" type="text" placeholder="Ex: Confinamento Chaparral" autocomplete="off" />
             <p class="field-error" id="mv-newconfinamento-name-error"></p>
           </div>

           <div class="field field--half">
             <label class="field-label" for="mv-qty">Quantidade (cabeças) *</label>
             <input class="input" id="mv-qty" type="number" min="1" step="1" inputmode="numeric" placeholder="Ex: 28" />
             <p class="field-error" id="mv-qty-error"></p>
           </div>

           <div class="field field--half">
             <label class="field-label" for="mv-avgWeightKg">Peso médio (kg)</label>
             <input class="input" id="mv-avgWeightKg" type="number" min="0" step="1" placeholder="Opcional" />
             <p class="field-hint" id="mv-avgWeightKg-hint" hidden></p>
           </div>

           <label class="field checkbox-field" id="mv-from-confinamento-field" for="mv-from-confinamento" hidden>
             <input type="checkbox" id="mv-from-confinamento" />
             <span class="field-label">Animais estão no confinamento</span>
           </label>

           <div class="field field--half" id="mv-arroba-price-field" hidden>
             <label class="field-label" for="mv-arroba-price">Valor da @ (R$)</label>
             <input class="input" id="mv-arroba-price" type="text" inputmode="decimal" placeholder="Ex: R$ 300,00" autocomplete="off" />
           </div>

           <div class="field field--half" id="mv-yield-pct-field" hidden>
             <label class="field-label" for="mv-yield-pct">Aproveitamento (%)</label>
             <input class="input" id="mv-yield-pct" type="number" min="1" max="100" step="0.5" placeholder="Ex: 53" />
           </div>

           <p class="field-hint" id="mv-arroba-hint" hidden></p>

           <div class="field field--half">
             <label class="field-label" for="mv-amount">Valor (R$)</label>
             <input class="input" id="mv-amount" type="text" inputmode="decimal" placeholder="R$ 0,00 (opcional)" autocomplete="off" />
           </div>

           <div class="field field--half">
             <label class="field-label" for="mv-description">Descrição</label>
             <input class="input" id="mv-description" type="text" placeholder="Ex: retorno de confinamento" autocomplete="off" />
           </div>

           <label class="field checkbox-field" id="mv-gen-finance-field" for="mv-gen-finance" hidden>
             <input type="checkbox" id="mv-gen-finance" checked />
             <span class="field-label" id="mv-gen-finance-label">Gerar lançamento financeiro</span>
           </label>

           <p class="field-error" id="mv-form-error" role="alert"></p>
           <button type="submit" class="btn-primary pressable" id="mv-submit">Salvar movimentação</button>
         </form>
       `;
     }

     export function wireMovementForm(lot) {
       const form = document.getElementById("mv-form");
       const typeSelect = document.getElementById("mv-type");
       const qtyInput = document.getElementById("mv-qty");
       const avgWeightInput = document.getElementById("mv-avgWeightKg");
       const avgWeightHint = document.getElementById("mv-avgWeightKg-hint");
       const amountInput = document.getElementById("mv-amount");
       const arrobaPriceField = document.getElementById("mv-arroba-price-field");
       const arrobaPriceInput = document.getElementById("mv-arroba-price");
       const yieldPctField = document.getElementById("mv-yield-pct-field");
       const yieldPctInput = document.getElementById("mv-yield-pct");
       const arrobaHint = document.getElementById("mv-arroba-hint");
       const genFinanceField = document.getElementById("mv-gen-finance-field");
       const genFinanceCheckbox = document.getElementById("mv-gen-finance");
       const genFinanceLabel = document.getElementById("mv-gen-finance-label");
       const confinamentoField = document.getElementById("mv-confinamento-field");
       const confinamentoSelect = document.getElementById("mv-confinamento");
       const newConfinamentoField = document.getElementById("mv-newconfinamento-field");
       const newConfinamentoNameInput = document.getElementById("mv-newconfinamento-name");
       const fromConfinamentoField = document.getElementById("mv-from-confinamento-field");
       const fromConfinamentoCheckbox = document.getElementById("mv-from-confinamento");
       const signPlusRadio = document.getElementById("mv-sign-plus");
       const signMinusRadio = document.getElementById("mv-sign-minus");
       const submitBtn = document.getElementById("mv-submit");
       const formError = document.getElementById("mv-form-error");

       function isConfinementType() {
         return typeSelect.value === "confinement_out" || typeSelect.value === "confinement_return";
       }
       function isNegativeType() {
         return typeSelect.value === "sale" || typeSelect.value === "shipment" || typeSelect.value === "death";
       }

       // sale/shipment → receita; entry → despesa; everything else (birth,
       // death, transfer, adjustment) falls back to the movement's own sign
       // when the user opts in manually, since those types have no fixed
       // financial direction of their own.
       function financeKindForType(type, qty) {
         if (type === "sale" || type === "shipment") return "receita";
         if (type === "entry") return "despesa";
         return qty < 0 ? "despesa" : "receita";
       }

       function currentSign() {
         return form.querySelector('input[name="mv-sign"]:checked')?.value || "+";
       }

       function syncFinanceLabel() {
         const kind = financeKindForType(typeSelect.value, currentSign() === "-" ? -1 : 1);
         genFinanceLabel.textContent = kind === "receita" ? "Gerar receita vinculada" : "Gerar despesa vinculada";
       }

       function syncFinanceVisibility() {
         const amount = parseBRLToNumber(amountInput.value);
         genFinanceField.hidden = !(Number.isFinite(amount) && amount > 0);
         syncFinanceLabel();
       }

       // --- Venda/Embarque: valor da @ × aproveitamento derivam o Valor
       //     automaticamente, até o usuário editar o campo Valor manualmente. ---
       function isArrobaSaleType() {
         return typeSelect.value === "sale" || typeSelect.value === "shipment";
       }

       let amountManuallyEdited = false;

       function syncArrobaCalc() {
         if (!isArrobaSaleType()) { arrobaHint.hidden = true; return; }

         const qty = parseInt(qtyInput.value, 10);
         const avgWeightKg = parseFloat(avgWeightInput.value);
         const arrobaPrice = parseBRLToNumber(arrobaPriceInput.value);
         const yieldPct = parseFloat(yieldPctInput.value);

         const hasQty = Number.isInteger(qty) && qty > 0;
         const hasWeight = Number.isFinite(avgWeightKg) && avgWeightKg > 0;
         const hasPrice = Number.isFinite(arrobaPrice) && arrobaPrice > 0;
         const hasYield = Number.isFinite(yieldPct) && yieldPct > 0;
         const arrobaFieldsTouched = arrobaPriceInput.value.trim() !== "" || yieldPctInput.value.trim() !== "";

         if (hasQty && hasWeight && hasPrice && hasYield) {
           const arrobasPerHead = (avgWeightKg * (yieldPct / 100)) / 15;
           const totalArrobas = arrobasPerHead * qty;
           const derivedAmount = totalArrobas * arrobaPrice;

           arrobaHint.hidden = false;
           arrobaHint.textContent =
             `${fmtNum(arrobasPerHead, 2)} @/cab · ${fmtNum(totalArrobas, 2)} @ no total · ${formatBRL(arrobasPerHead * arrobaPrice)}/cabeça`;

           if (!amountManuallyEdited) {
             amountInput.value = formatBRL(Math.round(derivedAmount * 100) / 100);
             syncFinanceVisibility();
           }
         } else if (arrobaFieldsTouched) {
           arrobaHint.hidden = false;
           arrobaHint.textContent = "Preencha peso médio, @ e aproveitamento para calcular o valor";
         } else {
           arrobaHint.hidden = true;
         }
       }

       function syncType() {
         const meta = MOVEMENT_TYPE_BY_VALUE[typeSelect.value];
         document.getElementById(meta?.defaultSign === "-" ? "mv-sign-minus" : "mv-sign-plus").checked = true;
         genFinanceCheckbox.checked = meta ? meta.defaultFinance : false;
         arrobaPriceField.hidden = !isArrobaSaleType();
         yieldPctField.hidden = !isArrobaSaleType();

         // confinement_out/confinement_return: sign is fixed by the type,
         // so the segmented control is locked instead of left editable.
         const confinementType = isConfinementType();
         signPlusRadio.disabled = confinementType;
         signMinusRadio.disabled = confinementType;
         confinamentoField.hidden = !confinementType;
         if (!confinementType) {
           confinamentoSelect.value = "";
           newConfinamentoField.hidden = true;
           newConfinamentoNameInput.value = "";
         }

         // sale/shipment/death: offer "animals are at the feedlot" only when
         // the lot actually has confined head to draw down.
         const showFromConfinamento = isNegativeType() && (lot.confinedHeadcount ?? 0) > 0;
         fromConfinamentoField.hidden = !showFromConfinamento;
         if (!showFromConfinamento) fromConfinamentoCheckbox.checked = false;

         avgWeightHint.hidden = typeSelect.value !== "confinement_out";
         avgWeightHint.textContent = typeSelect.value === "confinement_out"
           ? "Peso de embarque — pode ser editado depois com o peso aferido no confinamento"
           : "";

         syncArrobaCalc();
         syncFinanceVisibility();
       }
       typeSelect.addEventListener("change", syncType);
       confinamentoSelect.addEventListener("change", () => {
         newConfinamentoField.hidden = confinamentoSelect.value !== "__new__";
       });
       form.querySelectorAll('input[name="mv-sign"]').forEach((r) => r.addEventListener("change", syncFinanceLabel));
       amountInput.addEventListener("input", () => {
         formatCurrencyInput(amountInput);
         amountManuallyEdited = amountInput.value.trim() !== "";
         syncFinanceVisibility();
       });
       qtyInput.addEventListener("input", syncArrobaCalc);
       avgWeightInput.addEventListener("input", syncArrobaCalc);
       arrobaPriceInput.addEventListener("input", () => { formatCurrencyInput(arrobaPriceInput); syncArrobaCalc(); });
       yieldPctInput.addEventListener("input", syncArrobaCalc);

       syncType();

       form.addEventListener("submit", async (e) => {
         e.preventDefault();
         if (!currentUid) return;

         formError.textContent = "";
         ["mv-type", "mv-date", "mv-qty", "mv-confinamento", "mv-newconfinamento-name"].forEach(clearFieldError);

         let valid = true;
         const fail = (id, msg) => { valid = false; setFieldError(id, msg); };

         const type = typeSelect.value;
         if (!type) fail("mv-type", "Selecione o tipo.");

         const dateStr = document.getElementById("mv-date").value;
         if (!dateStr) fail("mv-date", "Informe a data.");

         const magnitude = parseInt(document.getElementById("mv-qty").value, 10);
         if (!Number.isInteger(magnitude) || magnitude <= 0) fail("mv-qty", "Informe a quantidade.");

         const confinementType = isConfinementType();
         let newConfinamentoName = null;
         if (confinementType) {
           if (!confinamentoSelect.value) {
             fail("mv-confinamento", "Selecione o confinamento.");
           } else if (confinamentoSelect.value === "__new__") {
             newConfinamentoName = newConfinamentoNameInput.value.trim();
             if (!newConfinamentoName) fail("mv-newconfinamento-name", "Informe o nome do confinamento.");
           }
         }

         const fromConfinement = !fromConfinamentoField.hidden && fromConfinamentoCheckbox.checked;

         const qty = currentSign() === "-" ? -magnitude : magnitude;
         const { farmDelta, confinedDelta } = movementDeltas({ type, qty, fromConfinement });
         const newHeadcount = (lot.headcount ?? 0) + farmDelta;
         const newConfinedHeadcount = (lot.confinedHeadcount ?? 0) + confinedDelta;
         if (valid && newHeadcount < 0) {
           fail("mv-qty", "Essa movimentação deixaria o lote com cabeças negativas.");
         }
         if (valid && newConfinedHeadcount < 0) {
           fail("mv-qty", "Essa movimentação deixaria o confinamento com cabeças negativas.");
         }

         const avgWeightRaw = document.getElementById("mv-avgWeightKg").value;
         const avgWeightKg = avgWeightRaw ? parseFloat(avgWeightRaw) : null;

         const amountRaw = parseBRLToNumber(amountInput.value);
         const amountBRL = Number.isFinite(amountRaw) && amountRaw > 0 ? amountRaw : null;

         const arrobaPriceRaw = parseBRLToNumber(arrobaPriceInput.value);
         const yieldPctRaw = parseFloat(yieldPctInput.value);
         const arrobaPriceBRL = isArrobaSaleType() && Number.isFinite(arrobaPriceRaw) && arrobaPriceRaw > 0 ? arrobaPriceRaw : null;
         const carcassYieldPct = isArrobaSaleType() && Number.isFinite(yieldPctRaw) && yieldPctRaw > 0 ? yieldPctRaw : null;

         const description = document.getElementById("mv-description").value.trim() || null;

         const genFinance = !genFinanceField.hidden && genFinanceCheckbox.checked && amountBRL != null;

         if (!valid) return;

         const date = new Date(`${dateStr}T00:00:00`);
         const typeLabel = MOVEMENT_TYPE_LABEL[type] || type;

         submitBtn.disabled = true;
         submitBtn.textContent = "Salvando…";

         try {
           // Reuse an existing confinamento on an exact name match; otherwise
           // persist a new one and link its id — same dedupe rule as the
           // supplier quick-create in the "Novo lote" flow.
           let confinementId = null;
           let confinementName = null;
           if (confinementType) {
             if (confinamentoSelect.value === "__new__") {
               const nameLower = newConfinamentoName.toLowerCase();
               const existing = confinementsCache.find((c) => c.nameLower === nameLower);
               if (existing) {
                 confinementId = existing.id;
                 confinementName = existing.name;
               } else {
                 const confinementRef = await addDoc(collection(db, "confinements"), {
                   ownerId: currentUid,
                   name: newConfinamentoName,
                   nameLower,
                   createdAt: serverTimestamp(),
                   updatedAt: serverTimestamp(),
                 });
                 confinementId = confinementRef.id;
                 confinementName = newConfinamentoName;
               }
             } else {
               const selected = confinementsCache.find((c) => c.id === confinamentoSelect.value);
               confinementId = selected?.id ?? null;
               confinementName = selected?.name ?? null;
             }
           }

           let linkedTransactionId = null;
           if (genFinance) {
             const kind = financeKindForType(type, qty);
             const category = kind === "receita" ? "venda-animal" : type === "entry" ? "compra-animal" : "outra";
             const txRef = await addDoc(collection(db, "transactions"), {
               ownerId: currentUid,
               kind,
               category,
               costNature: null,
               buyerType: category === "venda-animal" ? "pj" : null,
               amountBRL,
               date,
               linkedScope: "lot",
               linkedAnimalId: null,
               linkedLotId: lot.id,
               description: description || `${typeLabel} — ${magnitude} cabeça${magnitude === 1 ? "" : "s"} — ${lot.name}`,
               createdAt: serverTimestamp(),
             });
             linkedTransactionId = txRef.id;
           }

           await addDoc(collection(db, "movements"), {
             ownerId: currentUid,
             lotId: lot.id,
             date,
             type,
             qty,
             avgWeightKg,
             amountBRL,
             arrobaPriceBRL,
             carcassYieldPct,
             description,
             linkedTransactionId,
             confinementId,
             confinementName,
             fromConfinement: fromConfinement || null,
             createdAt: serverTimestamp(),
           });

           await updateDoc(doc(db, "lots", lot.id), {
             headcount: newHeadcount,
             confinedHeadcount: newConfinedHeadcount,
             updatedAt: serverTimestamp(),
           });

           showToast("Movimentação registrada.");
           Sheet.close();
         } catch (err) {
           console.warn("[Agro Connect] Falha ao registrar movimentação:", err?.code ?? err);
           formError.textContent =
             err?.code === "permission-denied"
               ? "Sem permissão para gravar."
               : "Não foi possível salvar. Tente novamente.";
           submitBtn.disabled = false;
           submitBtn.textContent = "Salvar movimentação";
         }
       });
     }

     export function openLotMovementSheet(lot) {
       Sheet.open({ title: `Nova movimentação · ${escapeHtml(lot.name)}`, content: buildMovementFormHTML(lot) });
       wireMovementForm(lot);
     }

     // --- Editar movimentação: type and qty are immutable (they'd require
     //     replaying every counter change since), so only date, weight,
     //     description and amount are editable here. ---
     export function buildEditMovementFormHTML(m) {
       const typeLabel = MOVEMENT_TYPE_LABEL[m.type] || m.type;
       const qty = m.qty || 0;
       const qtyLabel = `${qty >= 0 ? "+" : "−"}${Math.abs(qty)}`;
       return `
         <form id="mve-form" class="form-grid" novalidate>
           <div class="field field--half">
             <label class="field-label" for="mve-type-display">Tipo</label>
             <input class="input" id="mve-type-display" type="text" value="${escapeHtml(typeLabel)}" disabled />
           </div>
           <div class="field field--half">
             <label class="field-label" for="mve-qty-display">Quantidade</label>
             <input class="input" id="mve-qty-display" type="text" value="${escapeHtml(qtyLabel)}" disabled />
           </div>

           <div class="field field--half">
             <label class="field-label" for="mve-date">Data *</label>
             <input class="input" id="mve-date" type="date" value="${toDateInputValue(m.date)}" />
             <p class="field-error" id="mve-date-error"></p>
           </div>
           <div class="field field--half">
             <label class="field-label" for="mve-avgWeightKg">Peso médio (kg)</label>
             <input class="input" id="mve-avgWeightKg" type="number" min="0" step="1" placeholder="Opcional" value="${m.avgWeightKg ?? ""}" />
           </div>

           <div class="field field--half">
             <label class="field-label" for="mve-amount">Valor (R$)</label>
             <input class="input" id="mve-amount" type="text" inputmode="decimal" placeholder="R$ 0,00 (opcional)" autocomplete="off" value="${m.amountBRL != null ? formatBRL(m.amountBRL) : ""}" />
           </div>
           <div class="field field--half">
             <label class="field-label" for="mve-description">Descrição</label>
             <input class="input" id="mve-description" type="text" placeholder="Opcional" autocomplete="off" value="${m.description ? escapeHtml(m.description) : ""}" />
           </div>

           <p class="field-error" id="mve-form-error" role="alert"></p>
           <button type="submit" class="btn-primary pressable" id="mve-submit">Salvar alterações</button>
         </form>
       `;
     }

     export function wireEditMovementForm(m) {
       const form = document.getElementById("mve-form");
       const dateInput = document.getElementById("mve-date");
       const avgWeightInput = document.getElementById("mve-avgWeightKg");
       const amountInput = document.getElementById("mve-amount");
       const descriptionInput = document.getElementById("mve-description");
       const submitBtn = document.getElementById("mve-submit");
       const formError = document.getElementById("mve-form-error");

       amountInput.addEventListener("input", () => formatCurrencyInput(amountInput));

       form.addEventListener("submit", async (e) => {
         e.preventDefault();
         if (!currentUid) return;

         formError.textContent = "";
         clearFieldError("mve-date");

         const dateStr = dateInput.value;
         if (!dateStr) { setFieldError("mve-date", "Informe a data."); return; }

         const date = new Date(`${dateStr}T00:00:00`);
         const avgWeightRaw = avgWeightInput.value;
         const avgWeightKg = avgWeightRaw ? parseFloat(avgWeightRaw) : null;
         const amountRaw = parseBRLToNumber(amountInput.value);
         const amountBRL = Number.isFinite(amountRaw) && amountRaw > 0 ? amountRaw : null;
         const description = descriptionInput.value.trim() || null;

         submitBtn.disabled = true;
         submitBtn.textContent = "Salvando…";

         try {
           await updateDoc(doc(db, "movements", m.id), {
             date,
             avgWeightKg,
             amountBRL,
             description,
             updatedAt: serverTimestamp(),
           });

           if (m.linkedTransactionId) {
             const amountChanged = amountBRL != null && amountBRL !== (m.amountBRL ?? null);
             const dateChanged = dateStr !== toDateInputValue(m.date);
             if (amountChanged || dateChanged) {
               await updateDoc(doc(db, "transactions", m.linkedTransactionId), {
                 ...(amountChanged ? { amountBRL } : {}),
                 ...(dateChanged ? { date } : {}),
               });
             }
           }

           showToast("Movimentação atualizada.");
           Sheet.close();
         } catch (err) {
           console.warn("[Agro Connect] Falha ao atualizar movimentação:", err?.code ?? err);
           formError.textContent =
             err?.code === "permission-denied"
               ? "Sem permissão para gravar."
               : "Não foi possível salvar. Tente novamente.";
           submitBtn.disabled = false;
           submitBtn.textContent = "Salvar alterações";
         }
       });
     }

     export function openEditMovementSheet(m) {
       Sheet.open({ title: "Editar movimentação", content: buildEditMovementFormHTML(m) });
       wireEditMovementForm(m);
     }
