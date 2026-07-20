import { db, auth, doc, getDoc, updateDoc, arrayUnion, arrayRemove } from "../../js/core/firebase.js";
import { ICONS } from "../../js/core/constants.js";
import {
  accountMembersCardEl, accountMembersListEl, accountMemberAddBtn, sharedAccessCardEl, sharedAccessEmailEl,
} from "../../js/core/dom.js";
import { escapeHtml } from "../../js/core/helpers.js";
import { currentAuthUid, accountMembersCache, setAccountMembersCache } from "../../js/core/state.js";
import { Sheet } from "../../js/core/sheet.js";
import { isSharedSession } from "../../js/core/listeners.js";
import { showToast } from "../../js/core/auth.js";
import { clearFieldError, setFieldError } from "../rebanho/animals.js";

     // =====================================================
     // 7e-a. Perfil — Membros da conta (shared-account access by email)
     //     One-time getDoc on Perfil render (no onSnapshot — this doc is
     //     read rarely and re-fetched explicitly after each mutation).
     // =====================================================

     export async function renderAccountMembersCard() {
       if (!currentAuthUid) return;

       if (isSharedSession()) {
         accountMembersCardEl.hidden = true;
         sharedAccessCardEl.hidden = false;
         sharedAccessEmailEl.textContent = auth.currentUser?.email || "";
         return;
       }

       sharedAccessCardEl.hidden = true;
       accountMembersCardEl.hidden = false;
       try {
         const snap = await getDoc(doc(db, "accounts", currentAuthUid));
         setAccountMembersCache(snap.exists() ? (snap.data().memberEmails || []) : []);
       } catch (err) {
         console.warn("[Agro Connect] Falha ao carregar membros da conta:", err?.code ?? err);
         setAccountMembersCache([]);
       }
       renderAccountMembersList();
     }

     export function renderAccountMembersList() {
       if (accountMembersCache.length === 0) {
         accountMembersListEl.innerHTML = `<p class="field-hint">Nenhum membro adicionado ainda.</p>`;
         return;
       }
       accountMembersListEl.innerHTML = `
         <ul class="herd-list">
           ${accountMembersCache
             .map(
               (email) => `
                 <li class="tx-row">
                   <div class="tx-row-main"><p class="tx-desc">${escapeHtml(email)}</p></div>
                   <div class="tx-row-end">
                     <button type="button" class="card-menu-btn pressable" data-action="member-remove" data-email="${escapeHtml(email)}" aria-label="Remover ${escapeHtml(email)}">
                       ${ICONS.delete}
                     </button>
                   </div>
                 </li>
               `
             )
             .join("")}
         </ul>
       `;
       accountMembersListEl.querySelectorAll('[data-action="member-remove"]').forEach((btn) => {
         btn.addEventListener("click", () => removeMember(btn.dataset.email));
       });
     }

     // Revocation isn't live — a removed member keeps access until their
     // next app load (their session already resolved the old accountId).
     export async function removeMember(email) {
       if (!currentAuthUid) return;
       try {
         await updateDoc(doc(db, "accounts", currentAuthUid), { memberEmails: arrayRemove(email) });
         showToast("Membro removido.");
       } catch (err) {
         console.warn("[Agro Connect] Falha ao remover membro:", err?.code ?? err);
         showToast(err?.code === "permission-denied" ? "Sem permissão para remover." : "Não foi possível remover. Tente novamente.");
         return;
       }
       await renderAccountMembersCard();
     }

     export function buildAddMemberFormHTML() {
       return `
         <form id="member-form" class="form-grid" novalidate>
           <div class="field">
             <label class="field-label" for="member-email">E-mail do Google</label>
             <input class="input" id="member-email" type="email" placeholder="nome@gmail.com" autocomplete="off" />
             <p class="field-error" id="member-email-error"></p>
           </div>
           <p class="field-hint">A pessoa deve entrar com o Google usando exatamente este e-mail. Nenhum convite é enviado — basta ela fazer login no Agro Connect.</p>
           <p class="field-error" id="member-form-error" role="alert"></p>
           <button type="submit" class="btn-primary pressable" id="member-submit">Adicionar</button>
         </form>
       `;
     }

     export function wireAddMemberForm() {
       const form = document.getElementById("member-form");
       const submitBtn = document.getElementById("member-submit");

       form.addEventListener("submit", async (e) => {
         e.preventDefault();
         if (!currentAuthUid) return;

         clearFieldError("member-email");

         const raw = document.getElementById("member-email").value.trim().toLowerCase();
         if (!raw || !raw.includes("@")) {
           setFieldError("member-email", "Informe um e-mail válido.");
           return;
         }
         if (raw === (auth.currentUser?.email || "").trim().toLowerCase()) {
           showToast("Você já é o dono da conta.");
           return;
         }
         if (accountMembersCache.includes(raw)) {
           showToast("Esse e-mail já tem acesso.");
           return;
         }

         submitBtn.disabled = true;
         submitBtn.textContent = "Adicionando…";

         try {
           const ref = doc(db, "accounts", currentAuthUid);
           const snap = await getDoc(ref);
           if (snap.exists()) {
             await updateDoc(ref, { memberEmails: arrayUnion(raw) });
           } else {
             await setDoc(ref, {
               ownerId: currentAuthUid,
               memberEmails: [raw],
               createdAt: serverTimestamp(),
             }, { merge: true });
           }
           showToast("Membro adicionado.");
           Sheet.close();
           await renderAccountMembersCard();
         } catch (err) {
           console.warn("[Agro Connect] Falha ao adicionar membro:", err?.code ?? err);
           showToast(err?.code === "permission-denied" ? "Sem permissão para adicionar." : "Não foi possível adicionar. Tente novamente.");
           submitBtn.disabled = false;
           submitBtn.textContent = "Adicionar";
         }
       });
     }

     export function openAddMemberSheet() {
       Sheet.open({ title: "Adicionar membro", content: buildAddMemberFormHTML() });
       wireAddMemberForm();
     }

     accountMemberAddBtn.addEventListener("click", openAddMemberSheet);
