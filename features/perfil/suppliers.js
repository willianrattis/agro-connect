import { db, doc, updateDoc, deleteDoc, serverTimestamp, collection, addDoc } from "../../js/core/firebase.js";
import { ICONS } from "../../js/core/constants.js";
import { suppliersCountValueEl, suppliersWithDocValueEl, suppliersManageBtn } from "../../js/core/dom.js";
import {
  escapeHtml, formatCPFInput, formatCNPJNumericInput, formatCNPJAlnumInput, formatPhoneInput,
} from "../../js/core/helpers.js";
import { currentUid, suppliersCache } from "../../js/core/state.js";
import { Sheet } from "../../js/core/sheet.js";
import { showToast } from "../../js/core/auth.js";
import { clearFieldError, setFieldError } from "../rebanho/animals.js";

     // =====================================================
     // 7e-ter. Perfil — Produtores (manage sheet: list, CRUD)
     //     Standalone in this phase; searchSuppliers() below is consumed by
     //     the lot-purchase form's autocomplete in Phase C.
     // =====================================================
     export function renderSuppliersCard() {
       suppliersCountValueEl.textContent = String(suppliersCache.length);
       const withDoc = suppliersCache.filter((s) => s.docType).length;
       suppliersWithDocValueEl.textContent = String(withDoc);
     }

     export function supplierDocLabel(supplier) {
       if (supplier.docType === "cnpj") return { label: "CNPJ", value: supplier.cnpj || "—" };
       if (supplier.docType === "cpf") return { label: "CPF", value: supplier.cpf || "—" };
       return { label: "Documento", value: "—" };
     }

     export function buildSuppliersListHTML() {
       const newButton = `<button type="button" class="btn-primary pressable" id="supplier-new-btn">Novo produtor</button>`;

       if (suppliersCache.length === 0) {
         return `
           <div class="form-grid">
             ${newButton}
             <div class="empty-state">
               <span class="icon" aria-hidden="true">
                 <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6"/></svg>
               </span>
               <h3>Nenhum produtor cadastrado</h3>
               <p>Cadastre um produtor para reaproveitar os dados nas próximas compras.</p>
             </div>
           </div>
         `;
       }

       const cards = suppliersCache
         .map((s, i) => {
           const doc = supplierDocLabel(s);
           return `
             <li class="card enter" style="--i: ${i}">
               <div class="card-top">
                 <span class="ear-tag" style="font-size: var(--fs-base);">${escapeHtml(s.name)}</span>
                 <button type="button" class="card-menu-btn pressable" data-action="supplier-menu" data-id="${escapeHtml(s.id)}" aria-label="Ações do produtor ${escapeHtml(s.name)}">
                   ${ICONS.menu}
                 </button>
               </div>
               <div class="card-stats" style="grid-template-columns: repeat(2, 1fr);">
                 <div class="mini-stat">
                   <p class="mini-value">${s.fazenda ? escapeHtml(s.fazenda) : "—"}</p>
                   <p class="mini-label">Fazenda</p>
                 </div>
                 <div class="mini-stat">
                   <p class="mini-value">${escapeHtml(doc.value)}</p>
                   <p class="mini-label">${doc.label}</p>
                 </div>
               </div>
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

     export function openSuppliersSheet() {
       Sheet.open({ title: "Produtores", content: buildSuppliersListHTML() });
       document.getElementById("supplier-new-btn")?.addEventListener("click", openNewSupplierSheet);
       document.querySelectorAll('#sheet-body [data-action="supplier-menu"]').forEach((btn) => {
         btn.addEventListener("click", () => {
           const supplier = suppliersCache.find((s) => s.id === btn.dataset.id);
           if (supplier) openSupplierActionSheet(supplier);
         });
       });
     }

     suppliersManageBtn.addEventListener("click", openSuppliersSheet);

     // --- "..." action menu (Editar / Excluir) ---
     export function buildSupplierActionMenuHTML() {
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

     export function openSupplierActionSheet(supplier) {
       Sheet.open({ title: `Ações · ${escapeHtml(supplier.name)}`, content: buildSupplierActionMenuHTML() });
       document.querySelectorAll("#sheet-body [data-menu-action]").forEach((btn) => {
         btn.addEventListener("click", () => {
           if (btn.dataset.menuAction === "edit") openEditSupplierSheet(supplier);
           else if (btn.dataset.menuAction === "delete") openDeleteSupplierSheet(supplier);
           else Sheet.close();
         });
       });
     }

     // --- Novo / editar produtor (shared form; addDoc vs. updateDoc) ---
     export function buildSupplierFormHTML(supplier) {
       const docType = supplier?.docType || "none";
       const cnpjIsAlnum = /[A-Z]/.test(supplier?.cnpjKey || "");
       const cnpjFormat = cnpjIsAlnum ? "alnum" : "numeric";
       return `
         <form id="supplier-form" class="form-grid" novalidate>
           <div class="field">
             <label class="field-label" for="supplier-name">Produtor *</label>
             <input class="input" id="supplier-name" type="text" placeholder="Ex: João da Silva" autocomplete="off" value="${supplier ? escapeHtml(supplier.name) : ""}" />
             <p class="field-error" id="supplier-name-error"></p>
           </div>
           <div class="field">
             <label class="field-label" for="supplier-fazenda">Fazenda</label>
             <input class="input" id="supplier-fazenda" type="text" placeholder="Opcional" autocomplete="off" value="${supplier?.fazenda ? escapeHtml(supplier.fazenda) : ""}" />
           </div>

           <div class="field">
             <span class="field-label">Documento</span>
             <div class="segmented" role="radiogroup" aria-label="Tipo de documento">
               <input type="radio" id="supplier-doctype-none" name="supplier-doctype" value="none" ${docType === "none" ? "checked" : ""} />
               <label for="supplier-doctype-none">Nenhum</label>
               <input type="radio" id="supplier-doctype-cnpj" name="supplier-doctype" value="cnpj" ${docType === "cnpj" ? "checked" : ""} />
               <label for="supplier-doctype-cnpj">CNPJ</label>
               <input type="radio" id="supplier-doctype-cpf" name="supplier-doctype" value="cpf" ${docType === "cpf" ? "checked" : ""} />
               <label for="supplier-doctype-cpf">CPF</label>
             </div>
           </div>

           <div class="form-grid" id="supplier-cnpj-fields" ${docType === "cnpj" ? "" : "hidden"}>
             <div class="field">
               <span class="field-label">Formato do CNPJ</span>
               <div class="segmented" role="radiogroup" aria-label="Formato do CNPJ">
                 <input type="radio" id="supplier-cnpj-format-numeric" name="supplier-cnpj-format" value="numeric" ${cnpjFormat === "numeric" ? "checked" : ""} />
                 <label for="supplier-cnpj-format-numeric">Numérico</label>
                 <input type="radio" id="supplier-cnpj-format-alnum" name="supplier-cnpj-format" value="alnum" ${cnpjFormat === "alnum" ? "checked" : ""} />
                 <label for="supplier-cnpj-format-alnum">Alfanumérico</label>
               </div>
             </div>
             <div class="field">
               <label class="field-label" for="supplier-cnpj">CNPJ *</label>
               <input class="input" id="supplier-cnpj" type="text" inputmode="${cnpjFormat === "numeric" ? "numeric" : "text"}" autocomplete="off" placeholder="${cnpjFormat === "numeric" ? "00.000.000/0000-00" : "AA.AAA.AAA/AAAA-00"}" value="${docType === "cnpj" && supplier?.cnpj ? escapeHtml(supplier.cnpj) : ""}" />
               <p class="field-error" id="supplier-cnpj-error"></p>
               <p class="field-hint">Dígito verificador não validado (TODO: validação do dígito verificador).</p>
             </div>
           </div>

           <div class="field" id="supplier-cpf-field" ${docType === "cpf" ? "" : "hidden"}>
             <label class="field-label" for="supplier-cpf">CPF</label>
             <input class="input" id="supplier-cpf" type="text" inputmode="numeric" autocomplete="off" placeholder="000.000.000-00" value="${docType === "cpf" && supplier?.cpf ? escapeHtml(supplier.cpf) : ""}" />
             <p class="field-error" id="supplier-cpf-error"></p>
           </div>

           <div class="field">
             <label class="field-label" for="supplier-phone">Telefone</label>
             <input class="input" id="supplier-phone" type="text" inputmode="numeric" autocomplete="off" placeholder="(00) 0000-0000" value="${supplier?.phone ? escapeHtml(supplier.phone) : ""}" />
             <p class="field-error" id="supplier-phone-error"></p>
           </div>

           <div class="field">
             <label class="field-label" for="supplier-notes">Observações</label>
             <textarea class="textarea" id="supplier-notes" placeholder="Opcional">${supplier?.notes ? escapeHtml(supplier.notes) : ""}</textarea>
           </div>

           <p class="field-error" id="supplier-form-error" role="alert"></p>
           <button type="submit" class="btn-primary pressable" id="supplier-submit">${supplier ? "Salvar alterações" : "Criar produtor"}</button>
         </form>
       `;
     }

     export function wireSupplierForm(supplier) {
       const form = document.getElementById("supplier-form");
       const submitBtn = document.getElementById("supplier-submit");
       const cnpjFields = document.getElementById("supplier-cnpj-fields");
       const cpfField = document.getElementById("supplier-cpf-field");
       const cnpjInput = document.getElementById("supplier-cnpj");
       const cpfInput = document.getElementById("supplier-cpf");
       const phoneInput = document.getElementById("supplier-phone");

       function docTypeValue() {
         return form.querySelector('input[name="supplier-doctype"]:checked').value;
       }
       function cnpjFormatValue() {
         return form.querySelector('input[name="supplier-cnpj-format"]:checked').value;
       }

       function syncDocType() {
         const docType = docTypeValue();
         cnpjFields.hidden = docType !== "cnpj";
         cpfField.hidden = docType !== "cpf";
       }
       form.querySelectorAll('input[name="supplier-doctype"]').forEach((r) => r.addEventListener("change", syncDocType));
       syncDocType();

       function applyCnpjMask() {
         if (cnpjFormatValue() === "alnum") formatCNPJAlnumInput(cnpjInput);
         else formatCNPJNumericInput(cnpjInput);
       }
       // Switching format re-masks from scratch — the two formats aren't
       // interchangeable character-by-character (letters vs. digits-only).
       form.querySelectorAll('input[name="supplier-cnpj-format"]').forEach((r) => r.addEventListener("change", () => {
         cnpjInput.value = "";
         cnpjInput.focus({ preventScroll: true });
       }));
       cnpjInput.addEventListener("input", applyCnpjMask);

       cpfInput.addEventListener("input", () => formatCPFInput(cpfInput));
       phoneInput.addEventListener("input", () => formatPhoneInput(phoneInput));

       form.addEventListener("submit", async (e) => {
         e.preventDefault();
         if (!currentUid) return;

         ["supplier-name", "supplier-cnpj", "supplier-cpf", "supplier-phone"].forEach(clearFieldError);

         let valid = true;
         const fail = (id, msg) => { valid = false; setFieldError(id, msg); };

         const name = document.getElementById("supplier-name").value.trim();
         if (!name) fail("supplier-name", "Informe o nome do produtor.");

         const fazenda = document.getElementById("supplier-fazenda").value.trim() || null;

         const docType = docTypeValue();
         let cnpj = null, cnpjKey = null, cpf = null, cpfDigits = null;

         if (docType === "cnpj") {
           cnpj = cnpjInput.value.trim();
           cnpjKey = cnpj.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
           if (cnpjKey.length !== 14) {
             fail("supplier-cnpj", "Informe os 14 caracteres do CNPJ no padrão correto.");
           } else if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpjKey)) {
             fail("supplier-cnpj", "Os dois últimos caracteres do CNPJ devem ser numéricos.");
           }
         } else if (docType === "cpf") {
           const cpfRaw = cpfInput.value.trim();
           const cpfDigitsRaw = cpfRaw.replace(/\D/g, "");
           if (cpfDigitsRaw && cpfDigitsRaw.length !== 11) {
             fail("supplier-cpf", "Informe os 11 dígitos do CPF.");
           } else if (cpfDigitsRaw) {
             cpf = cpfRaw;
             cpfDigits = cpfDigitsRaw;
           }
         }

         const phoneRaw = phoneInput.value.trim();
         const phoneDigits = phoneRaw ? phoneRaw.replace(/\D/g, "") : null;
         const phone = phoneDigits ? phoneRaw : null;

         const notes = document.getElementById("supplier-notes").value.trim() || null;

         if (!valid) return;

         submitBtn.disabled = true;
         submitBtn.textContent = "Salvando…";

         const payload = {
           name,
           nameLower: name.toLowerCase().trim(),
           fazenda,
           docType: docType === "none" ? null : docType,
           cnpj,
           cnpjKey,
           cpf,
           cpfDigits,
           phone,
           phoneDigits,
           notes,
         };

         try {
           if (supplier) {
             // Editar: updateDoc on the existing document — never recreate.
             await updateDoc(doc(db, "suppliers", supplier.id), { ...payload, updatedAt: serverTimestamp() });
             showToast("Produtor atualizado.");
           } else {
             await addDoc(collection(db, "suppliers"), {
               ownerId: currentUid,
               ...payload,
               createdAt: serverTimestamp(),
               updatedAt: serverTimestamp(),
             });
             showToast("Produtor criado.");
           }
           Sheet.close();
         } catch (err) {
           console.warn("[Agro Connect] Falha ao salvar produtor:", err?.code ?? err);
           showToast(
             err?.code === "permission-denied" ? "Sem permissão para gravar." : "Não foi possível salvar. Tente novamente."
           );
           submitBtn.disabled = false;
           submitBtn.textContent = supplier ? "Salvar alterações" : "Criar produtor";
         }
       });
     }

     export function openNewSupplierSheet() {
       Sheet.open({ title: "Novo produtor", content: buildSupplierFormHTML(null) });
       wireSupplierForm(null);
     }

     export function openEditSupplierSheet(supplier) {
       Sheet.open({ title: "Editar produtor", content: buildSupplierFormHTML(supplier) });
       wireSupplierForm(supplier);
     }

     // --- Excluir produtor (nunca sem confirmação) ---
     export function buildDeleteSupplierHTML(supplier) {
       return `
         <div class="form-grid">
           <div class="confirm-warning">
             <span class="confirm-warning-icon" aria-hidden="true">${ICONS.warning}</span>
             <p>Tem certeza que deseja excluir o produtor <strong>${escapeHtml(supplier.name)}</strong>? Esta ação não pode ser desfeita.</p>
           </div>
           <div class="confirm-actions">
             <button type="button" class="btn-secondary pressable" id="delete-supplier-cancel">Cancelar</button>
             <button type="button" class="btn-primary btn-danger pressable" id="delete-supplier-confirm">Excluir produtor</button>
           </div>
         </div>
       `;
     }

     export function wireDeleteSupplierForm(supplier) {
       const cancelBtn = document.getElementById("delete-supplier-cancel");
       const confirmBtn = document.getElementById("delete-supplier-confirm");

       cancelBtn.addEventListener("click", () => Sheet.close());

       confirmBtn.addEventListener("click", async () => {
         if (!currentUid) return;
         confirmBtn.disabled = true;
         cancelBtn.disabled = true;
         confirmBtn.textContent = "Excluindo…";

         try {
           await deleteDoc(doc(db, "suppliers", supplier.id));
           showToast("Produtor excluído.");
           Sheet.close();
         } catch (err) {
           console.warn("[Agro Connect] Falha ao excluir produtor:", err?.code ?? err);
           showToast(
             err?.code === "permission-denied" ? "Sem permissão para excluir." : "Não foi possível excluir. Tente novamente."
           );
           confirmBtn.disabled = false;
           cancelBtn.disabled = false;
           confirmBtn.textContent = "Excluir produtor";
         }
       });
     }

     export function openDeleteSupplierSheet(supplier) {
       Sheet.open({ title: "Excluir produtor", content: buildDeleteSupplierHTML(supplier) });
       wireDeleteSupplierForm(supplier);
     }
