import { db, doc, setDoc, serverTimestamp } from "../../js/core/firebase.js";
import {
  settingsTargetValueEl, settingsFarmYieldValueEl, settingsConfYieldValueEl, settingsMaxWeightValueEl, settingsEditBtn3,
  settingsFunruralTypeValueEl, settingsFunruralRegimeValueEl, settingsFunruralRateValueEl, settingsEditBtn4,
} from "../../js/core/dom.js";
import {
  formatArrobas, formatPercentTrim, fractionToPercentDisplay, formatKg, getSlaughterConfig, getFunruralConfig,
} from "../../js/core/helpers.js";
import {
  FUNRURAL_PRODUCER_TYPES, FUNRURAL_DEFAULTS, MATURE_WEIGHT_BREED_GROUPS,
  DEFAULT_MAX_WEIGHT_MALE_KG, DEFAULT_MAX_WEIGHT_FEMALE_KG,
} from "../../js/core/constants.js";
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
       settingsMaxWeightValueEl.textContent = `${formatKg(slaughterCfg.maxWeightMaleKg)} / ${formatKg(slaughterCfg.maxWeightFemaleKg)} kg`;

       const funruralCfg = getFunruralConfig();
       settingsFunruralTypeValueEl.textContent =
         FUNRURAL_PRODUCER_TYPES.find((t) => t.value === funruralCfg.producerType)?.label || "—";
       settingsFunruralRegimeValueEl.textContent = funruralCfg.regime === "folha" ? "Sobre folha" : "Sobre receita";
       settingsFunruralRateValueEl.textContent = `${formatPercentTrim(funruralCfg.receitaRatePct)}%`;
     }

     // --- Metas e aproveitamento (targetArrobasPerHead, defaultFarmYieldPct,
     //     defaultConfinementYieldPct) — feeds getSlaughterConfig() and the
     //     "Ponto de abate" panel in Indicadores. ---
     export function buildSlaughterSettingsFormHTML() {
       const breedGroupOptions = MATURE_WEIGHT_BREED_GROUPS
         .map((g) => `<option value="${g.value}" data-male-kg="${g.maleKg}" data-female-kg="${g.femaleKg}">${g.label}</option>`)
         .join("");
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
           <p class="form-section-title">Peso máximo (maturidade)</p>
           <div class="field">
             <label class="field-label" for="slaughter-breed-group">Grupo racial (preenche os campos abaixo)</label>
             <select class="select" id="slaughter-breed-group">
               <option value="">Personalizado</option>
               ${breedGroupOptions}
             </select>
           </div>
           <div class="field field--half">
             <label class="field-label" for="slaughter-maxweight-male">Peso máx. macho (kg)</label>
             <input class="input" id="slaughter-maxweight-male" type="number" min="100" max="2000" step="10" placeholder="${DEFAULT_MAX_WEIGHT_MALE_KG}" value="${settingsCache.maxWeightMaleKg ?? ""}" />
             <p class="field-hint">Vazio = usa o padrão.</p>
             <p class="field-error" id="slaughter-maxweight-male-error"></p>
           </div>
           <div class="field field--half">
             <label class="field-label" for="slaughter-maxweight-female">Peso máx. fêmea (kg)</label>
             <input class="input" id="slaughter-maxweight-female" type="number" min="100" max="2000" step="10" placeholder="${DEFAULT_MAX_WEIGHT_FEMALE_KG}" value="${settingsCache.maxWeightFemaleKg ?? ""}" />
             <p class="field-hint">Vazio = usa o padrão.</p>
             <p class="field-error" id="slaughter-maxweight-female-error"></p>
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
       const numericFieldIds = [
         "slaughter-target", "slaughter-farmyield", "slaughter-confyield",
         "slaughter-maxweight-male", "slaughter-maxweight-female",
       ];

       const breedGroupSelect = document.getElementById("slaughter-breed-group");
       const maxWeightMaleInput = document.getElementById("slaughter-maxweight-male");
       const maxWeightFemaleInput = document.getElementById("slaughter-maxweight-female");

       breedGroupSelect.addEventListener("change", () => {
         const option = breedGroupSelect.selectedOptions[0];
         if (!option?.value) return;
         maxWeightMaleInput.value = option.dataset.maleKg;
         maxWeightFemaleInput.value = option.dataset.femaleKg;
       });
       [maxWeightMaleInput, maxWeightFemaleInput].forEach((input) => {
         input.addEventListener("input", () => { breedGroupSelect.value = ""; });
       });

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
         const maxWeightMaleKg = readOptionalNumber("slaughter-maxweight-male", "um peso máximo", { min: 100, max: 2000 });
         const maxWeightFemaleKg = readOptionalNumber("slaughter-maxweight-female", "um peso máximo", { min: 100, max: 2000 });

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
               maxWeightMaleKg,
               maxWeightFemaleKg,
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

     // --- Funrural (funruralProducerType, funruralRegime, funruralReceitaRatePct,
     //     funruralFolhaRatePct) — feeds getFunruralConfig() and the "Funrural
     //     estimado" line in Financeiro. ---
     export function buildFunruralSettingsFormHTML() {
       const cfg = getFunruralConfig();
       const typeOptions = FUNRURAL_PRODUCER_TYPES
         .map((t) => `<option value="${t.value}" ${t.value === cfg.producerType ? "selected" : ""}>${t.label}</option>`)
         .join("");
       return `
         <form id="funrural-settings-form" class="form-grid" novalidate>
           <div class="field">
             <label class="field-label" for="funrural-type">Tipo de produtor</label>
             <select class="select" id="funrural-type">
               ${typeOptions}
             </select>
           </div>
           <div class="field">
             <span class="field-label">Regime de apuração</span>
             <div class="segmented" role="radiogroup" aria-label="Regime de apuração do Funrural">
               <input type="radio" id="funrural-regime-receita" name="funrural-regime" value="receita" ${cfg.regime === "receita" ? "checked" : ""} />
               <label for="funrural-regime-receita">Sobre receita</label>
               <input type="radio" id="funrural-regime-folha" name="funrural-regime" value="folha" ${cfg.regime === "folha" ? "checked" : ""} />
               <label for="funrural-regime-folha">Sobre folha</label>
             </div>
             <p class="field-hint">A opção por folha exige funcionários registrados e é escolhida no início do ano-calendário. O cálculo por folha será adicionado em breve.</p>
           </div>
           <div class="field field--half">
             <label class="field-label" for="funrural-receita-rate">Alíquota sobre receita (%)</label>
             <input class="input" id="funrural-receita-rate" type="number" min="0" max="100" step="0.01" value="${cfg.receitaRatePct}" />
             <p class="field-hint">Padrão 2026: PF 1,63% · Segurado especial 1,5% · PJ 2,23%.</p>
             <p class="field-error" id="funrural-receita-rate-error"></p>
           </div>
           <div class="field field--half">
             <label class="field-label" for="funrural-folha-rate">Alíquota sobre folha (%)</label>
             <input class="input" id="funrural-folha-rate" type="number" min="0" max="100" step="0.01" value="${cfg.folhaRatePct}" />
             <p class="field-hint">≈23% (20% INSS + RAT + 0,2% SENAR). Usada no cálculo por folha (em breve).</p>
             <p class="field-error" id="funrural-folha-rate-error"></p>
           </div>
           <p class="field-error" id="funrural-settings-form-error" role="alert"></p>
           <button type="submit" class="btn-primary pressable" id="funrural-settings-submit">Salvar configurações</button>
         </form>
       `;
     }

     export function wireFunruralSettingsForm() {
       const form = document.getElementById("funrural-settings-form");
       const typeSelect = document.getElementById("funrural-type");
       const receitaRateInput = document.getElementById("funrural-receita-rate");
       const submitBtn = document.getElementById("funrural-settings-submit");
       const formError = document.getElementById("funrural-settings-form-error");
       const numericFieldIds = ["funrural-receita-rate", "funrural-folha-rate"];

       typeSelect.addEventListener("change", () => {
         const rate = FUNRURAL_DEFAULTS.receitaRateByType[typeSelect.value];
         if (rate != null) receitaRateInput.value = rate;
       });

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

         const producerType = typeSelect.value;
         const regime = form.querySelector('input[name="funrural-regime"]:checked').value;
         const receitaRatePct = readOptionalNumber("funrural-receita-rate", "uma alíquota", { min: 0, max: 100 });
         const folhaRatePct = readOptionalNumber("funrural-folha-rate", "uma alíquota", { min: 0, max: 100 });

         if (!valid) return;

         submitBtn.disabled = true;
         submitBtn.textContent = "Salvando…";

         try {
           await setDoc(
             doc(db, "settings", currentUid),
             {
               ownerId: currentUid,
               funruralProducerType: producerType,
               funruralRegime: regime,
               funruralReceitaRatePct: receitaRatePct,
               funruralFolhaRatePct: folhaRatePct,
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

     export function openFunruralSettingsSheet() {
       Sheet.open({ title: "Funrural", content: buildFunruralSettingsFormHTML() });
       wireFunruralSettingsForm();
     }

     settingsEditBtn4.addEventListener("click", openFunruralSettingsSheet);
