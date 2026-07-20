import { db, doc, setDoc, serverTimestamp } from "../../js/core/firebase.js";
import {
  settingsTargetValueEl, settingsFarmYieldValueEl, settingsConfYieldValueEl, settingsEditBtn3,
} from "../../js/core/dom.js";
import {
  formatArrobas, formatPercentTrim, fractionToPercentDisplay, getSlaughterConfig,
} from "../../js/core/helpers.js";
import { currentUid, settingsCache } from "../../js/core/state.js";
import { Sheet } from "../../js/core/sheet.js";
import { showToast } from "../../js/core/auth.js";
import { clearFieldError, setFieldError } from "../rebanho/animals.js";

     // =====================================================
     // 7d. Perfil — metas e aproveitamento (slaughter config)
     // =====================================================
     export function renderSettingsCard() {
       const slaughterCfg = getSlaughterConfig();
       settingsTargetValueEl.textContent = `${formatArrobas(slaughterCfg.targetArrobasPerHead)} @`;
       settingsFarmYieldValueEl.textContent = `${formatPercentTrim(slaughterCfg.defaultFarmYieldPct * 100)}%`;
       settingsConfYieldValueEl.textContent = `${formatPercentTrim(slaughterCfg.defaultConfinementYieldPct * 100)}%`;
     }

     // --- Metas e aproveitamento (targetArrobasPerHead, defaultFarmYieldPct,
     //     defaultConfinementYieldPct) — feeds getSlaughterConfig() and the
     //     "Ponto de abate" panel in Indicadores. ---
     export function buildSlaughterSettingsFormHTML() {
       return `
         <form id="slaughter-settings-form" class="form-grid" novalidate>
           <div class="field">
             <label class="field-label" for="slaughter-target">Meta de @ por cabeça</label>
             <input class="input" id="slaughter-target" type="number" min="0" step="0.5" placeholder="Ex: 21" value="${settingsCache.targetArrobasPerHead ?? ""}" />
             <p class="field-hint">Meta de @ por cabeça para considerar o animal pronto.</p>
             <p class="field-error" id="slaughter-target-error"></p>
           </div>
           <div class="field field--half">
             <label class="field-label" for="slaughter-farmyield">Aprov. a pasto (%)</label>
             <input class="input" id="slaughter-farmyield" type="number" min="1" max="100" step="0.5" placeholder="Ex: 50" value="${settingsCache.defaultFarmYieldPct != null ? fractionToPercentDisplay(settingsCache.defaultFarmYieldPct) : ""}" />
             <p class="field-hint">Aproveitamento de carcaça a pasto.</p>
             <p class="field-error" id="slaughter-farmyield-error"></p>
           </div>
           <div class="field field--half">
             <label class="field-label" for="slaughter-confyield">Aprov. confinamento (%)</label>
             <input class="input" id="slaughter-confyield" type="number" min="1" max="100" step="0.5" placeholder="Ex: 54" value="${settingsCache.defaultConfinementYieldPct != null ? fractionToPercentDisplay(settingsCache.defaultConfinementYieldPct) : ""}" />
             <p class="field-hint">Aproveitamento de carcaça em confinamento — geralmente maior, até ~57%.</p>
             <p class="field-error" id="slaughter-confyield-error"></p>
           </div>
           <p class="field-error" id="slaughter-settings-form-error" role="alert"></p>
           <button type="submit" class="btn-primary pressable" id="slaughter-settings-submit">Salvar configurações</button>
         </form>
       `;
     }

     export function wireSlaughterSettingsForm() {
       const form = document.getElementById("slaughter-settings-form");
       const submitBtn = document.getElementById("slaughter-settings-submit");
       const formError = document.getElementById("slaughter-settings-form-error");
       const numericFieldIds = ["slaughter-target", "slaughter-farmyield", "slaughter-confyield"];

       form.addEventListener("submit", async (e) => {
         e.preventDefault();
         if (!currentUid) return;

         formError.textContent = "";
         numericFieldIds.forEach(clearFieldError);

         let valid = true;
         const fail = (id, msg) => { valid = false; setFieldError(id, msg); };

         function readOptionalNumber(id, label, { min = 0, max = Infinity } = {}) {
           const raw = document.getElementById(id).value;
           if (!raw) return null;
           const n = parseFloat(raw);
           if (!Number.isFinite(n) || n < min || n > max) { fail(id, `Informe ${label} válido(a).`); return null; }
           return n;
         }

         const targetArrobasPerHead = readOptionalNumber("slaughter-target", "uma meta de @");
         const farmYieldRaw = readOptionalNumber("slaughter-farmyield", "um aproveitamento", { min: 1, max: 100 });
         const confYieldRaw = readOptionalNumber("slaughter-confyield", "um aproveitamento", { min: 1, max: 100 });

         if (!valid) return;

         submitBtn.disabled = true;
         submitBtn.textContent = "Salvando…";

         try {
           await setDoc(
             doc(db, "settings", currentUid),
             {
               ownerId: currentUid,
               targetArrobasPerHead,
               defaultFarmYieldPct: farmYieldRaw != null ? farmYieldRaw / 100 : null,
               defaultConfinementYieldPct: confYieldRaw != null ? confYieldRaw / 100 : null,
               updatedAt: serverTimestamp(),
             },
             { merge: true }
           );
           showToast("Configurações salvas.");
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

     export function openSlaughterSettingsSheet() {
       Sheet.open({ title: "Metas e aproveitamento", content: buildSlaughterSettingsFormHTML() });
       wireSlaughterSettingsForm();
     }

     settingsEditBtn3.addEventListener("click", openSlaughterSettingsSheet);
