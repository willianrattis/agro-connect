import { db, doc, updateDoc, deleteDoc, serverTimestamp, collection, addDoc } from "../../js/core/firebase.js";
import { PASTURE_QUALITY, DEFAULT_PASTURE_QUALITY, ICONS } from "../../js/core/constants.js";
import {
  propertiesCountValueEl, propertiesAreaValueEl, propertiesPriceValueEl, propertiesCapitalValueEl,
  propertiesManageBtn,
} from "../../js/core/dom.js";
import { escapeHtml, formatCurrencyInput, parseBRLToNumber, formatBRL } from "../../js/core/helpers.js";
import { currentUid, lotsCache, propertiesCache } from "../../js/core/state.js";
import { Sheet } from "../../js/core/sheet.js";
import { showToast } from "../../js/core/auth.js";
import { clearFieldError, setFieldError } from "../rebanho/animals.js";
import { sumPropertyField, avgPropertyField } from "../indicadores/indicadores.js";

     export function buildSettingsFormHTML() {
       if (propertiesCache.length === 0) {
         return `
           <div class="form-grid">
             <div class="empty-state">
               <span class="icon" aria-hidden="true">
                 <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18"/></svg>
               </span>
               <h3>Nenhuma propriedade cadastrada</h3>
               <p>Cadastre uma propriedade para configurar os valores econômicos.</p>
             </div>
             <button type="button" class="btn-primary pressable" id="settings-create-property-btn">Nova propriedade</button>
           </div>
         `;
       }

       const propertyOptionsHTML = propertiesCache
         .slice()
         .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
         .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`)
         .join("");

       return `
         <form id="settings-form" class="form-grid" novalidate>
           <div class="field">
             <label class="field-label" for="settings-property">Propriedade</label>
             <select class="select" id="settings-property">
               ${propertyOptionsHTML}
             </select>
           </div>
           <div class="field field--half">
             <label class="field-label" for="settings-price">Preço padrão da @ (R$)</label>
             <input class="input" id="settings-price" type="text" inputmode="decimal" placeholder="R$ 0,00" autocomplete="off" value="" />
             <p class="field-error" id="settings-price-error"></p>
           </div>
           <div class="field">
             <label class="field-label" for="settings-depreciation">Depreciação mensal (R$)</label>
             <input class="input" id="settings-depreciation" type="text" inputmode="decimal" placeholder="R$ 0,00" autocomplete="off" value="" />
             <p class="field-hint">Custo não-efetivo mensal (máquinas, benfeitorias) — alimenta o COT/@ e a margem líquida.</p>
             <p class="field-error" id="settings-depreciation-error"></p>
           </div>
           <div class="field field--half">
             <label class="field-label" for="settings-prolabore">Pró-labore mensal (R$)</label>
             <input class="input" id="settings-prolabore" type="text" inputmode="decimal" placeholder="R$ 0,00" autocomplete="off" value="" />
             <p class="field-error" id="settings-prolabore-error"></p>
           </div>
           <div class="field field--half">
             <label class="field-label" for="settings-capital">Capital investido (R$)</label>
             <input class="input" id="settings-capital" type="text" inputmode="decimal" placeholder="R$ 0,00" autocomplete="off" value="" />
             <p class="field-hint">Usado para calcular o ROI %.</p>
             <p class="field-error" id="settings-capital-error"></p>
           </div>
           <p class="field-error" id="settings-form-error" role="alert"></p>
           <button type="submit" class="btn-primary pressable" id="settings-submit">Salvar configurações</button>
         </form>
       `;
     }

     export function loadPropertyValues(propId) {
       const prop = propertiesCache.find((p) => p.id === propId);
       const fields = [
         ["settings-price", "defaultArrobaPriceBRL"],
         ["settings-depreciation", "monthlyDepreciationBRL"],
         ["settings-prolabore", "monthlyProLaboreBRL"],
         ["settings-capital", "investedCapitalBRL"],
       ];
       for (const [id, field] of fields) {
         const el = document.getElementById(id);
         const v = prop?.[field];
         el.value = Number.isFinite(v) ? formatBRL(v) : "";
       }
     }

     export function wireSettingsForm(propertyId) {
       const createBtn = document.getElementById("settings-create-property-btn");
       if (createBtn) {
         createBtn.addEventListener("click", openNewPropertySheet);
         return;
       }

       const form = document.getElementById("settings-form");
       const submitBtn = document.getElementById("settings-submit");
       const formError = document.getElementById("settings-form-error");
       const numericFieldIds = ["settings-price", "settings-depreciation", "settings-prolabore", "settings-capital"];
       const propertySelect = document.getElementById("settings-property");

       ["settings-price", "settings-depreciation", "settings-prolabore", "settings-capital"].forEach((id) => {
         const el = document.getElementById(id);
         el.addEventListener("input", () => formatCurrencyInput(el));
       });

       if (propertyId && propertiesCache.some((p) => p.id === propertyId)) {
         propertySelect.value = propertyId;
       }

       propertySelect.addEventListener("change", () => loadPropertyValues(propertySelect.value));
       loadPropertyValues(propertySelect.value);

       form.addEventListener("submit", async (e) => {
         e.preventDefault();
         if (!currentUid) return;

         formError.textContent = "";
         numericFieldIds.forEach(clearFieldError);

         let valid = true;
         const fail = (id, msg) => { valid = false; setFieldError(id, msg); };

         function readOptionalBRL(id, label) {
           const raw = document.getElementById(id).value;
           if (!raw) return null;
           const n = parseBRLToNumber(raw);
           if (!Number.isFinite(n) || n < 0) { fail(id, `Informe ${label} válido(a).`); return null; }
           return n;
         }

         const propId = propertySelect.value;
         const defaultArrobaPriceBRL = readOptionalBRL("settings-price", "um preço");
         const monthlyDepreciationBRL = readOptionalBRL("settings-depreciation", "um valor");
         const monthlyProLaboreBRL = readOptionalBRL("settings-prolabore", "um valor");
         const investedCapitalBRL = readOptionalBRL("settings-capital", "um valor");

         if (!valid) return;

         submitBtn.disabled = true;
         submitBtn.textContent = "Salvando…";

         try {
           await updateDoc(doc(db, "properties", propId), {
             defaultArrobaPriceBRL,
             monthlyDepreciationBRL,
             monthlyProLaboreBRL,
             investedCapitalBRL,
             updatedAt: serverTimestamp(),
           });
           showToast("Configurações da propriedade atualizadas.");
           Sheet.close();
         } catch (err) {
           console.warn("[Agro Connect] Falha ao salvar configurações:", err?.code ?? err);
           formError.textContent =
             err?.code === "permission-denied"
               ? "Sem permissão para gravar."
               : "Não foi possível salvar. Tente novamente.";
           submitBtn.disabled = false;
           submitBtn.textContent = "Salvar configurações";
         }
       });
     }

     export function openSettingsSheet(propertyId) {
       Sheet.open({ title: "Configurações da propriedade", content: buildSettingsFormHTML() });
       wireSettingsForm(propertyId);
     }

     // =====================================================
     // 7e-bis. Perfil — Propriedades (manage sheet: list, CRUD)
     // =====================================================
     export function renderPropertiesCard() {
       propertiesCountValueEl.textContent = String(propertiesCache.length);
       const totalArea = sumPropertyField("areaHa");
       propertiesAreaValueEl.textContent = Number.isFinite(totalArea) && totalArea > 0
         ? `${totalArea.toLocaleString("pt-BR")} ha`
         : "—";
       const avgPrice = avgPropertyField("defaultArrobaPriceBRL");
       propertiesPriceValueEl.textContent = Number.isFinite(avgPrice) ? formatBRL(avgPrice) : "—";
       const totalCapital = sumPropertyField("investedCapitalBRL");
       propertiesCapitalValueEl.textContent = Number.isFinite(totalCapital) ? formatBRL(totalCapital) : "—";
     }

     export function buildPropertiesListHTML() {
       const newButton = `<button type="button" class="btn-primary pressable" id="property-new-btn">Nova propriedade</button>`;

       if (propertiesCache.length === 0) {
         return `
           <div class="form-grid">
             ${newButton}
             <div class="empty-state">
               <span class="icon" aria-hidden="true">
                 <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18"/></svg>
               </span>
               <h3>Nenhuma propriedade cadastrada</h3>
               <p>Cadastre sua primeira propriedade para acompanhar área e indicadores.</p>
             </div>
           </div>
         `;
       }

       const cards = propertiesCache
         .map((p, i) => {
           const lotCount = lotsCache.filter((l) => l.propertyId === p.id).length;
           const pastureKey = p.pastureQuality && Object.prototype.hasOwnProperty.call(PASTURE_QUALITY, p.pastureQuality)
             ? p.pastureQuality
             : DEFAULT_PASTURE_QUALITY;
           const pastureQ = PASTURE_QUALITY[pastureKey];
           return `
             <li class="card enter" style="--i: ${i}">
               <div class="card-top">
                 <span class="ear-tag" style="font-size: var(--fs-base);">${escapeHtml(p.name)}</span>
                 <button type="button" class="card-menu-btn pressable" data-action="property-menu" data-id="${escapeHtml(p.id)}" aria-label="Ações da propriedade ${escapeHtml(p.name)}">
                   ${ICONS.menu}
                 </button>
               </div>
               <div class="card-stats" style="grid-template-columns: repeat(2, 1fr);">
                 <div class="mini-stat">
                   <p class="mini-value">${p.areaHa != null ? `${p.areaHa.toLocaleString("pt-BR")} ha` : "—"}</p>
                   <p class="mini-label">Área</p>
                 </div>
                 <div class="mini-stat">
                   <p class="mini-value">${lotCount}</p>
                   <p class="mini-label">${lotCount === 1 ? "Lote vinculado" : "Lotes vinculados"}</p>
                 </div>
               </div>
               <div class="card-stats" style="grid-template-columns: repeat(2, 1fr); border-top: none; padding-top: 0;">
                 <div class="mini-stat">
                   <p class="mini-value">${Number.isFinite(p.defaultArrobaPriceBRL) ? formatBRL(p.defaultArrobaPriceBRL) : "—"}</p>
                   <p class="mini-label">Preço @</p>
                 </div>
                 <div class="mini-stat">
                   <p class="mini-value">${Number.isFinite(p.monthlyDepreciationBRL) ? formatBRL(p.monthlyDepreciationBRL) : "—"}</p>
                   <p class="mini-label">Depreciação/mês</p>
                 </div>
                 <div class="mini-stat">
                   <p class="mini-value">${Number.isFinite(p.monthlyProLaboreBRL) ? formatBRL(p.monthlyProLaboreBRL) : "—"}</p>
                   <p class="mini-label">Pró-labore/mês</p>
                 </div>
                 <div class="mini-stat">
                   <p class="mini-value">${Number.isFinite(p.investedCapitalBRL) ? formatBRL(p.investedCapitalBRL) : "—"}</p>
                   <p class="mini-label">Capital investido</p>
                 </div>
               </div>
               <p class="field-hint">Pastagem: ${escapeHtml(pastureQ.label)} · ${escapeHtml(Math.round(pastureQ.gmdKgPerDay * 1000).toLocaleString("pt-BR"))} g/dia</p>
             </li>
           `;
         })
         .join("");

       return `
         <div class="form-grid">
           ${newButton}
           <ul class="herd-list">${cards}</ul>
         </div>
       `;
     }

     export function openPropertiesSheet() {
       Sheet.open({ title: "Propriedades", content: buildPropertiesListHTML() });
       document.getElementById("property-new-btn")?.addEventListener("click", openNewPropertySheet);
       document.querySelectorAll('#sheet-body [data-action="property-menu"]').forEach((btn) => {
         btn.addEventListener("click", () => {
           const property = propertiesCache.find((p) => p.id === btn.dataset.id);
           if (property) openPropertyActionSheet(property);
         });
       });
     }

     propertiesManageBtn.addEventListener("click", openPropertiesSheet);

     // --- "..." action menu (Editar / Excluir) ---
     export function buildPropertyActionMenuHTML() {
       return `
         <div class="action-list">
           <button type="button" class="action-item pressable" data-menu-action="edit">
             <span class="action-icon" aria-hidden="true">${ICONS.edit}</span>
             Editar
           </button>
           <button type="button" class="action-item pressable" data-menu-action="econ">
             <span class="action-icon" aria-hidden="true">${ICONS.edit}</span>
             Configurar economia
           </button>
           <button type="button" class="action-item danger pressable" data-menu-action="delete">
             <span class="action-icon" aria-hidden="true">${ICONS.delete}</span>
             Excluir
           </button>
         </div>
       `;
     }

     export function openPropertyActionSheet(property) {
       Sheet.open({ title: `Ações · ${escapeHtml(property.name)}`, content: buildPropertyActionMenuHTML() });
       document.querySelectorAll("#sheet-body [data-menu-action]").forEach((btn) => {
         btn.addEventListener("click", () => {
           if (btn.dataset.menuAction === "edit") openEditPropertySheet(property);
           else if (btn.dataset.menuAction === "econ") openSettingsSheet(property.id);
           else if (btn.dataset.menuAction === "delete") openDeletePropertySheet(property);
           else Sheet.close();
         });
       });
     }

     // --- Nova / editar propriedade (shared form; addDoc vs. updateDoc) ---
     export function buildPropertyFormHTML(property) {
       const pastureKey = property?.pastureQuality && Object.prototype.hasOwnProperty.call(PASTURE_QUALITY, property.pastureQuality)
         ? property.pastureQuality
         : DEFAULT_PASTURE_QUALITY;
       const pastureOptionsHTML = Object.entries(PASTURE_QUALITY)
         .map(([key, q]) => `
             <input type="radio" id="property-pasture-${key}" name="property-pasture" value="${key}" ${key === pastureKey ? "checked" : ""} />
             <label for="property-pasture-${key}">${escapeHtml(q.label)}</label>
           `)
         .join("");
       return `
         <form id="property-form" class="form-grid" novalidate>
           <div class="field">
             <label class="field-label" for="property-name">Nome *</label>
             <input class="input" id="property-name" type="text" placeholder="Ex: Fazenda Santa Rosa" autocomplete="off" value="${property ? escapeHtml(property.name) : ""}" />
             <p class="field-error" id="property-name-error"></p>
           </div>
           <div class="field">
             <label class="field-label" for="property-area">Área (ha)</label>
             <input class="input" id="property-area" type="number" min="0" step="0.01" placeholder="Opcional" value="${property?.areaHa ?? ""}" />
           </div>
           <div class="field">
             <span class="field-label">Qualidade da pastagem</span>
             <div class="segmented" role="radiogroup" aria-label="Qualidade da pastagem">
               ${pastureOptionsHTML}
             </div>
             <p class="field-hint" id="property-pasture-hint">Ganho médio estimado: ${escapeHtml(Math.round(PASTURE_QUALITY[pastureKey].gmdKgPerDay * 1000).toLocaleString("pt-BR"))} g/dia</p>
           </div>
           <div class="field">
             <label class="field-label" for="property-notes">Observações</label>
             <textarea class="textarea" id="property-notes" placeholder="Opcional">${property?.notes ? escapeHtml(property.notes) : ""}</textarea>
           </div>
           <p class="field-error" id="property-form-error" role="alert"></p>
           <button type="submit" class="btn-primary pressable" id="property-submit">${property ? "Salvar alterações" : "Criar propriedade"}</button>
         </form>
       `;
     }

     export function wirePropertyForm(property) {
       const form = document.getElementById("property-form");
       const submitBtn = document.getElementById("property-submit");
       const pastureHint = document.getElementById("property-pasture-hint");

       form.querySelectorAll('input[name="property-pasture"]').forEach((radio) => {
         radio.addEventListener("change", () => {
           if (!radio.checked) return;
           const q = PASTURE_QUALITY[radio.value];
           if (q) pastureHint.textContent = `Ganho médio estimado: ${Math.round(q.gmdKgPerDay * 1000).toLocaleString("pt-BR")} g/dia`;
         });
       });

       form.addEventListener("submit", async (e) => {
         e.preventDefault();
         if (!currentUid) return;

         clearFieldError("property-name");

         let valid = true;
         const fail = (id, msg) => { valid = false; setFieldError(id, msg); };

         const name = document.getElementById("property-name").value.trim();
         if (!name) fail("property-name", "Informe o nome da propriedade.");

         const areaRaw = document.getElementById("property-area").value;
         const areaHa = areaRaw ? parseFloat(areaRaw) : null;

         const notes = document.getElementById("property-notes").value.trim() || null;

         const pastureRaw = form.querySelector('input[name="property-pasture"]:checked')?.value;
         const pastureQuality = pastureRaw && Object.prototype.hasOwnProperty.call(PASTURE_QUALITY, pastureRaw)
           ? pastureRaw
           : DEFAULT_PASTURE_QUALITY;

         if (!valid) return;

         submitBtn.disabled = true;
         submitBtn.textContent = "Salvando…";

         try {
           if (property) {
             // Editar: updateDoc on the existing document — never recreate.
             await updateDoc(doc(db, "properties", property.id), { name, areaHa, notes, pastureQuality, updatedAt: serverTimestamp() });
             showToast("Propriedade atualizada.");
           } else {
             await addDoc(collection(db, "properties"), {
               ownerId: currentUid,
               name,
               areaHa,
               notes,
               pastureQuality,
               createdAt: serverTimestamp(),
               updatedAt: serverTimestamp(),
             });
             showToast("Propriedade criada.");
           }
           Sheet.close();
         } catch (err) {
           console.warn("[Agro Connect] Falha ao salvar propriedade:", err?.code ?? err);
           showToast(
             err?.code === "permission-denied" ? "Sem permissão para gravar." : "Não foi possível salvar. Tente novamente."
           );
           submitBtn.disabled = false;
           submitBtn.textContent = property ? "Salvar alterações" : "Criar propriedade";
         }
       });
     }

     export function openNewPropertySheet() {
       Sheet.open({ title: "Nova propriedade", content: buildPropertyFormHTML(null) });
       wirePropertyForm(null);
     }

     export function openEditPropertySheet(property) {
       Sheet.open({ title: "Editar propriedade", content: buildPropertyFormHTML(property) });
       wirePropertyForm(property);
     }

     // --- Excluir propriedade (nunca sem confirmação) ---
     export function buildDeletePropertyHTML(property, linkedCount) {
       return `
         <div class="form-grid">
           <div class="confirm-warning">
             <span class="confirm-warning-icon" aria-hidden="true">${ICONS.warning}</span>
             <p>Tem certeza que deseja excluir a propriedade <strong>${escapeHtml(property.name)}</strong>? Esta ação não pode ser desfeita.${
               linkedCount > 0 ? ` ${linkedCount} lote(s) vinculado(s) ficará(ão) sem propriedade.` : ""
             }</p>
           </div>
           <div class="confirm-actions">
             <button type="button" class="btn-secondary pressable" id="delete-property-cancel">Cancelar</button>
             <button type="button" class="btn-primary btn-danger pressable" id="delete-property-confirm">Excluir propriedade</button>
           </div>
         </div>
       `;
     }

     export function wireDeletePropertyForm(property) {
       const cancelBtn = document.getElementById("delete-property-cancel");
       const confirmBtn = document.getElementById("delete-property-confirm");

       cancelBtn.addEventListener("click", () => Sheet.close());

       confirmBtn.addEventListener("click", async () => {
         if (!currentUid) return;
         confirmBtn.disabled = true;
         cancelBtn.disabled = true;
         confirmBtn.textContent = "Excluindo…";

         try {
           const linkedLots = lotsCache.filter((l) => l.propertyId === property.id);
           await Promise.all(
             linkedLots.map((l) => updateDoc(doc(db, "lots", l.id), { propertyId: null, updatedAt: serverTimestamp() }))
           );
           await deleteDoc(doc(db, "properties", property.id));
           showToast("Propriedade excluída.");
           Sheet.close();
         } catch (err) {
           console.warn("[Agro Connect] Falha ao excluir propriedade:", err?.code ?? err);
           showToast(
             err?.code === "permission-denied" ? "Sem permissão para excluir." : "Não foi possível excluir. Tente novamente."
           );
           confirmBtn.disabled = false;
           cancelBtn.disabled = false;
           confirmBtn.textContent = "Excluir propriedade";
         }
       });
     }

     export function openDeletePropertySheet(property) {
       const linkedCount = lotsCache.filter((l) => l.propertyId === property.id).length;
       Sheet.open({ title: "Excluir propriedade", content: buildDeletePropertyHTML(property, linkedCount) });
       wireDeletePropertyForm(property);
     }
