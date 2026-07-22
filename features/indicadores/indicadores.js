import {
  CARCASS_YIELD, KG_PER_ARROBA, CATTLE_CATEGORIES, displayCategoryKeyForAnimal, displayCategoryKeyForLot,
  TX_EXPENSE_GROUPS, categoryGroupId, TX_CATEGORY_LABEL, CONFINEMENT_GMD_KG_PER_DAY,
} from "../../js/core/constants.js";
import {
  escapeHtml, toDateSafe, toDateInputValue, totalArrobas, formatArrobas, getSlaughterConfig,
  resolveFarmYieldPct, resolveConfinementYieldPct, lotWeightProjection, lotConfinedProjection,
  resolveLotTargetArrobas, slaughterForecast,
  formatBRL, saleDaysHeld, monthKey, monthChipLabel, buildRecentMonthKeys,
} from "../../js/core/helpers.js";
import {
  lotsCache, animalsCache, transactionsCache, eventsCache, settingsCache, propertiesCache, movementsCache,
} from "../../js/core/state.js";
import { animalEvents } from "../rebanho/animals.js";
import { openLotDetailSheet } from "../rebanho/lots.js";
import { loadedFlags } from "../../js/core/listeners.js";

     // =====================================================
     // 7f. Indicadores — período, cálculo puro (client-side) e renderização
     //     Pure derivation from animalsCache/eventsCache/transactionsCache/
     //     settingsCache — no writes happen from this tab.
     // =====================================================
     export const UA_KG = 450;              // kg de peso vivo por Unidade Animal
     export const DAYS_PER_MONTH = 30.44;
     export const DAYS_PER_YEAR = 365;

     export const periodSelectorEl = document.getElementById("period-selector");
     export const periodCustomRangeEl = document.getElementById("period-custom-range");
     export const periodStartInput = document.getElementById("period-start");
     export const periodEndInput = document.getElementById("period-end");
     export const indicadoresRootEl = document.getElementById("indicadores-root");

     export let periodMode = "12m"; // "12m" | "ytd" | "custom"

     export function computePeriodRange() {
       const now = new Date();
       const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
       if (periodMode === "ytd") {
         return { start: new Date(now.getFullYear(), 0, 1), end: endOfToday };
       }
       if (periodMode === "custom" && periodStartInput.value && periodEndInput.value) {
         const s = new Date(`${periodStartInput.value}T00:00:00`);
         const e = new Date(`${periodEndInput.value}T23:59:59`);
         if (s <= e) return { start: s, end: e };
       }
       // Default / fallback: trailing 12 months ending today.
       return { start: new Date(now.getFullYear(), now.getMonth() - 11, now.getDate()), end: endOfToday };
     }

     export function periodDays(range) {
       return Math.max(1, Math.round((range.end.getTime() - range.start.getTime()) / 86_400_000));
     }
     export function periodMonths(range) {
       return Math.max(1 / 30, periodDays(range) / DAYS_PER_MONTH);
     }
     export function inRange(dateValue, range) {
       const d = toDateSafe(dateValue);
       return !!d && d >= range.start && d <= range.end;
     }
     export function periodLabelText(range) {
       const fmt = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
       return `Período: ${fmt(range.start)} – ${fmt(range.end)}`;
     }

     export function syncPeriodChipActive() {
       periodSelectorEl.querySelectorAll(".period-chip").forEach((btn) => {
         const active = btn.dataset.period === periodMode;
         btn.classList.toggle("is-active", active);
         btn.setAttribute("aria-selected", String(active));
       });
       periodCustomRangeEl.hidden = periodMode !== "custom";
     }

     periodSelectorEl.addEventListener("click", (e) => {
       const btn = e.target.closest(".period-chip");
       if (!btn) return;
       periodMode = btn.dataset.period;
       if (periodMode === "custom" && !periodStartInput.value) {
         const range = computePeriodRange();
         periodStartInput.value = toDateInputValue(range.start);
         periodEndInput.value = toDateInputValue(range.end);
       }
       syncPeriodChipActive();
       renderIndicadores();
     });
     periodStartInput.addEventListener("change", () => { if (periodMode === "custom") renderIndicadores(); });
     periodEndInput.addEventListener("change", () => { if (periodMode === "custom") renderIndicadores(); });
     syncPeriodChipActive();

     // Best-known live weight of an animal at/before `date`: latest weighing
     // on/before it, else purchaseWeightKg if already purchased by then.
     export function weightAtDate(animal, date) {
       const priorWeighings = animalEvents(animal.id, "weighing")
         .map((e) => ({ d: toDateSafe(e.date), w: e.payload?.weightKg }))
         .filter((x) => x.d && x.d <= date && Number.isFinite(x.w))
         .sort((a, b) => b.d - a.d);
       if (priorWeighings.length) return priorWeighings[0].w;
       const purchaseDate = toDateSafe(animal.purchaseDate);
       if (animal.acquisitionType === "purchased" && purchaseDate && purchaseDate <= date) {
         return Number.isFinite(animal.purchaseWeightKg) ? animal.purchaseWeightKg : null;
       }
       return null;
     }

     export function animalAcquisitionDate(animal) {
       return toDateSafe(animal.acquisitionType === "purchased" ? animal.purchaseDate : animal.birthDate);
     }

     // Was this animal part of the herd as of `date`? (acquired by then, and
     // not yet sold/dead by then) — feeds the desfrute "opening count".
     export function wasActiveAt(animal, date) {
       const acq = animalAcquisitionDate(animal);
       if (acq && acq > date) return false;
       if (animal.status === "sold") {
         const sd = toDateSafe(animal.saleDate);
         if (sd && sd <= date) return false;
       }
       if (animal.status === "dead") {
         const dd = toDateSafe(animal.deathDate);
         if (dd && dd <= date) return false;
       }
       return true;
     }

     export function sumTx(range, predicate) {
       return transactionsCache
         .filter((t) => inRange(t.date, range) && predicate(t))
         .reduce((sum, t) => sum + (t.amountBRL || 0), 0);
     }

     export function arrobasProducedInPeriod(range) {
       return animalsCache
         .filter((a) => a.status === "sold" && inRange(a.saleDate, range) && Number.isFinite(a.saleArrobas))
         .reduce((sum, a) => sum + a.saleArrobas, 0);
     }

     export function averageRealizedArrobaPrice(range) {
       const sold = animalsCache.filter(
         (a) => a.status === "sold" && inRange(a.saleDate, range) && Number.isFinite(a.salePricePerArrobaBRL)
       );
       if (!sold.length) return null;
       return sold.reduce((sum, a) => sum + a.salePricePerArrobaBRL, 0) / sold.length;
     }

     export function monthlyExtraCosts() {
       return (totalMonthlyDepreciationBRL() ?? 0) + (totalMonthlyProLaboreBRL() ?? 0);
     }

     // --- Number formatting ---
     export function fmtNum(n, decimals = 0) {
       return n.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
     }

     // --- KPI result shape: { ok:true, label, value, unit, context } | { ok:false, label, hint } ---
     export function kpiOk(label, value, unit, context) {
       return { ok: true, label, value, unit, context };
     }
     export function kpiMissing(label, hint) {
       return { ok: false, label, hint };
     }

     // =========================== Grupo 1 — Desempenho animal ===========================
     export function computeGMDPerAnimal(range) {
       const perAnimal = [];
       for (const a of animalsCache) {
         const weighings = animalEvents(a.id, "weighing")
           .filter((e) => inRange(e.date, range) && Number.isFinite(e.payload?.weightKg))
           .sort((x, y) => toDateSafe(x.date) - toDateSafe(y.date));
         if (weighings.length < 2) continue;
         const first = weighings[0];
         const last = weighings[weighings.length - 1];
         const days = (toDateSafe(last.date) - toDateSafe(first.date)) / 86_400_000;
         if (days <= 0) continue;
         const gDia = ((last.payload.weightKg - first.payload.weightKg) * 1000) / days;
         perAnimal.push({ animal: a, gDia });
       }
       return perAnimal;
     }

     export function kpiGMD(range) {
       const perAnimal = computeGMDPerAnimal(range);
       if (!perAnimal.length) {
         return [kpiMissing("GMD do rebanho", "Cadastre ao menos 2 pesagens por animal no período para calcular o GMD.")];
       }
       const herdAvg = perAnimal.reduce((s, p) => s + p.gDia, 0) / perAnimal.length;
       const cards = [kpiOk("GMD do rebanho", fmtNum(herdAvg), "g/dia", `${perAnimal.length} animal(is) com pesagens no período`)];

       const byCategory = {};
       for (const p of perAnimal) {
         const lot = p.animal.lotId ? lotsCache.find((l) => l.id === p.animal.lotId) : null;
         const key = displayCategoryKeyForAnimal(p.animal, lot) || "outro";
         (byCategory[key] ||= []).push(p.gDia);
       }
       for (const [key, arr] of Object.entries(byCategory)) {
         const avg = arr.reduce((s, v) => s + v, 0) / arr.length;
         const label = CATTLE_CATEGORIES[key]?.label || key;
         cards.push(kpiOk(`GMD — ${label}`, fmtNum(avg), "g/dia", `${arr.length} animal(is)`));
       }
       return cards;
     }

     // --- Per-property economic aggregates (read-time; legacy settings as fallback) ---
     export function sumPropertyField(field) {
       const values = propertiesCache.map((p) => p[field]).filter((v) => Number.isFinite(v));
       return values.length ? values.reduce((s, v) => s + v, 0) : null;
     }
     export function avgPropertyField(field) {
       const values = propertiesCache.map((p) => p[field]).filter((v) => Number.isFinite(v));
       return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
     }
     export function totalMonthlyDepreciationBRL() {
       return sumPropertyField("monthlyDepreciationBRL") ?? settingsCache.monthlyDepreciationBRL ?? null;
     }
     export function totalMonthlyProLaboreBRL() {
       return sumPropertyField("monthlyProLaboreBRL") ?? settingsCache.monthlyProLaboreBRL ?? null;
     }
     export function totalPropertyCapitalBRL() {
       return sumPropertyField("investedCapitalBRL") ?? settingsCache.investedCapitalBRL ?? null;
     }

     // Weighted-by-@-produced consolidated arroba price across properties in the
     // range. Fallbacks: simple avg of property prices → averageRealizedArrobaPrice
     // → legacy settingsCache.defaultArrobaPriceBRL.
     export function consolidatedArrobaPrice(range) {
       const arrobasByProp = new Map();
       for (const a of animalsCache) {
         if (a.status !== "sold" || !inRange(a.saleDate, range)) continue;
         if (!Number.isFinite(a.saleArrobas)) continue;
         const lot = a.lotId ? lotsCache.find((l) => l.id === a.lotId) : null;
         const propId = lot?.propertyId;
         if (!propId) continue;
         arrobasByProp.set(propId, (arrobasByProp.get(propId) || 0) + a.saleArrobas);
       }
       let totalArr = 0;
       let weightedSum = 0;
       for (const [propId, arrobas] of arrobasByProp) {
         const prop = propertiesCache.find((p) => p.id === propId);
         const price = prop?.defaultArrobaPriceBRL;
         if (Number.isFinite(price)) {
           weightedSum += price * arrobas;
           totalArr += arrobas;
         }
       }
       if (totalArr) return weightedSum / totalArr;
       const simpleAvg = avgPropertyField("defaultArrobaPriceBRL");
       if (Number.isFinite(simpleAvg)) return simpleAvg;
       return averageRealizedArrobaPrice(range) || settingsCache.defaultArrobaPriceBRL || null;
     }

     // per-property indicator scoping: Phase F — for now, area-based KPIs
     // sum every property's areaHa rather than scoping per property.
     export function totalPropertyAreaHa() {
       return sumPropertyField("areaHa") ?? settingsCache.propertyAreaHa ?? null;
     }

     export function kpiGanhoHa(range) {
       const area = totalPropertyAreaHa();
       if (!area) return kpiMissing("Ganho por área", "Informe a área da propriedade em Perfil.");

       let variation = 0;
       let knownAnimals = 0;
       for (const a of animalsCache) {
         if ((a.status || "active") !== "active") continue;
         const wStart = weightAtDate(a, range.start);
         const wEnd = Number.isFinite(a.currentWeightKg) ? a.currentWeightKg : weightAtDate(a, range.end);
         if (wStart != null && wEnd != null) {
           variation += wEnd - wStart;
           knownAnimals++;
         }
       }

       let kgSold = 0;
       let soldCount = 0;
       for (const a of animalsCache) {
         if (a.status === "sold" && inRange(a.saleDate, range) && Number.isFinite(a.saleArrobas)) {
           kgSold += (a.saleArrobas * KG_PER_ARROBA) / CARCASS_YIELD;
           soldCount++;
         }
       }

       if (knownAnimals === 0 && soldCount === 0) {
         return kpiMissing("Ganho por área", "Cadastre pesagens e vendas no período para calcular o ganho por área.");
       }

       const annualized = ((variation + kgSold) / area) * (DAYS_PER_YEAR / periodDays(range));
       return kpiOk("Ganho por área", fmtNum(annualized), "kg PV/ha/ano", `${knownAnimals} animal(is) pesado(s) + ${soldCount} venda(s) no período`);
     }

     export function kpiLotacao() {
       const area = totalPropertyAreaHa();
       if (!area) return kpiMissing("Taxa de lotação", "Informe a área da propriedade em Perfil.");
       const active = animalsCache.filter((a) => (a.status || "active") === "active" && Number.isFinite(a.currentWeightKg));
       if (!active.length) return kpiMissing("Taxa de lotação", "Cadastre o peso atual dos animais ativos (use \"Pesar\").");
       const totalUA = active.reduce((s, a) => s + a.currentWeightKg, 0) / UA_KG;
       return kpiOk("Taxa de lotação", fmtNum(totalUA / area, 2), "UA/ha", `${active.length} animal(is) ativo(s) com peso`);
     }

     export function kpiDesfrute(range) {
       const openingCount = animalsCache.filter((a) => wasActiveAt(a, range.start)).length;
       if (!openingCount) return kpiMissing("Taxa de desfrute", "Sem animais ativos no início do período selecionado.");
       const exits = eventsCache.filter((e) => (e.type === "sale" || e.type === "death") && inRange(e.date, range)).length;
       return kpiOk("Taxa de desfrute", fmtNum((exits / openingCount) * 100, 1), "%", `${exits} saída(s) / ${openingCount} no início do período`);
     }

     export function kpiAbate(range) {
       const soldInPeriod = animalsCache.filter((a) => a.status === "sold" && inRange(a.saleDate, range));
       if (!soldInPeriod.length) {
         return [
           kpiMissing("Idade média de abate", "Registre vendas no período para calcular a idade de abate."),
           kpiMissing("Carcaça média ao abate", "Registre vendas no período para calcular a carcaça média."),
         ];
       }

       const cards = [];
       const ages = soldInPeriod
         .map((a) => {
           const birthRef = toDateSafe(a.birthDate) || toDateSafe(a.purchaseDate);
           const saleDate = toDateSafe(a.saleDate);
           return birthRef && saleDate ? (saleDate - birthRef) / (86_400_000 * DAYS_PER_MONTH) : null;
         })
         .filter((v) => v != null);
       if (ages.length) {
         cards.push(kpiOk("Idade média de abate", fmtNum(ages.reduce((s, v) => s + v, 0) / ages.length, 1), "meses", `${ages.length} animal(is) vendido(s)`));
       } else {
         cards.push(kpiMissing("Idade média de abate", "Cadastre data de nascimento (ou compra) dos animais vendidos."));
       }

       const arrobas = soldInPeriod.filter((a) => Number.isFinite(a.saleArrobas)).map((a) => a.saleArrobas);
       if (arrobas.length) {
         cards.push(kpiOk("Carcaça média ao abate", fmtNum(arrobas.reduce((s, v) => s + v, 0) / arrobas.length, 1), "@", `${arrobas.length} animal(is) vendido(s)`));
       } else {
         cards.push(kpiMissing("Carcaça média ao abate", "Registre @ de carcaça nas vendas."));
       }
       return cards;
     }

     export function renderGroup1(range) {
       return [...kpiGMD(range), kpiGanhoHa(range), kpiLotacao(), kpiDesfrute(range), ...kpiAbate(range)];
     }

     // =========================== Grupo 2 — Reprodutivo ===========================
     // Realistically "sem dados suficientes" today — this app has no CRUD yet
     // for cobertura/IA, diagnóstico de gestação or parto — but the math is
     // ready the moment those events start being written.
     export function kpiPrenhez(range) {
       const breedings = eventsCache.filter((e) => e.type === "breeding" && inRange(e.date, range));
       const distinctFemales = new Set(breedings.map((e) => e.payload?.femaleAnimalId).filter(Boolean));
       if (!distinctFemales.size) return kpiMissing("Taxa de prenhez", "Registre eventos de cobertura/IA no período.");
       const positives = eventsCache.filter((e) => e.type === "pregnancy_check" && inRange(e.date, range) && e.payload?.result === "pregnant");
       return kpiOk("Taxa de prenhez", fmtNum((positives.length / distinctFemales.size) * 100, 1), "%", `${positives.length} diagnóstico(s) positivo(s) / ${distinctFemales.size} fêmea(s) cobertas`);
     }

     export function kpiDesmame(range) {
       const births = eventsCache.filter((e) => e.type === "birth" && inRange(e.date, range));
       if (!births.length) return kpiMissing("Taxa de desmame", "Registre partos no período para calcular a taxa de desmame.");
       const weanings = eventsCache.filter((e) => e.type === "weaning" && inRange(e.date, range));
       return kpiOk("Taxa de desmame", fmtNum((weanings.length / births.length) * 100, 1), "%", `${weanings.length} desmama(s) / ${births.length} parto(s)`);
     }

     export function kpiNatalidade(range) {
       const breedings = eventsCache.filter((e) => e.type === "breeding" && inRange(e.date, range));
       const distinctFemales = new Set(breedings.map((e) => e.payload?.femaleAnimalId).filter(Boolean));
       if (!distinctFemales.size) return kpiMissing("Taxa de natalidade", "Registre eventos de cobertura/IA no período.");
       const births = eventsCache.filter((e) => e.type === "birth" && inRange(e.date, range));
       return kpiOk("Taxa de natalidade", fmtNum((births.length / distinctFemales.size) * 100, 1), "%", `${births.length} parto(s) / ${distinctFemales.size} fêmea(s) cobertas`);
     }

     export function kpiIEP() {
       const byDam = {};
       for (const e of eventsCache) {
         if (e.type !== "birth" || !e.payload?.damAnimalId) continue;
         (byDam[e.payload.damAnimalId] ||= []).push(toDateSafe(e.date));
       }
       const intervals = [];
       for (const dates of Object.values(byDam)) {
         const sorted = dates.filter(Boolean).sort((a, b) => a - b);
         for (let i = 1; i < sorted.length; i++) intervals.push((sorted[i] - sorted[i - 1]) / (86_400_000 * DAYS_PER_MONTH));
       }
       if (!intervals.length) return kpiMissing("IEP (intervalo entre partos)", "Registre pelo menos 2 partos da mesma matriz.");
       return kpiOk("IEP (intervalo entre partos)", fmtNum(intervals.reduce((s, v) => s + v, 0) / intervals.length, 1), "meses", `${intervals.length} intervalo(s) calculado(s)`);
     }

     export function kpiBezerrosPorMatriz(range) {
       const weanings = eventsCache.filter((e) => e.type === "weaning" && inRange(e.date, range) && e.payload?.damAnimalId);
       if (!weanings.length) return kpiMissing("Bezerros desmamados/matriz/ano", "Registre desmamas vinculadas à matriz no período.");
       const distinctDams = new Set(weanings.map((e) => e.payload.damAnimalId));
       const rate = (weanings.length / distinctDams.size) * (DAYS_PER_YEAR / periodDays(range));
       return kpiOk("Bezerros desmamados/matriz/ano", fmtNum(rate, 2), "bezerro(s)", `${weanings.length} desmama(s) / ${distinctDams.size} matriz(es)`);
     }

     export function renderGroup2(range) {
       return [kpiPrenhez(range), kpiDesmame(range), kpiNatalidade(range), kpiIEP(), kpiBezerrosPorMatriz(range)];
     }

     // =========================== Grupo 3 — Econômico-financeiro ===========================
     export function kpiCOE(range) {
       const arrobas = arrobasProducedInPeriod(range);
       if (!arrobas) return kpiMissing("COE/@", "Registre vendas (com @) no período para calcular o custo por arroba.");
       const despesasEfetivo = sumTx(range, (t) => t.kind === "despesa" && t.costNature === "efetivo");
       return kpiOk("COE/@", formatBRL(despesasEfetivo / arrobas), "/@", `${fmtNum(arrobas, 1)} @ produzida(s) no período`);
     }

     export function kpiCOT(range) {
       const arrobas = arrobasProducedInPeriod(range);
       if (!arrobas) return kpiMissing("COT/@", "Registre vendas (com @) no período para calcular o custo total por arroba.");
       const despesasEfetivo = sumTx(range, (t) => t.kind === "despesa" && t.costNature === "efetivo");
       const extras = monthlyExtraCosts() * periodMonths(range);
       const hasExtras = totalMonthlyDepreciationBRL() != null || totalMonthlyProLaboreBRL() != null;
       return kpiOk(
         "COT/@",
         formatBRL((despesasEfetivo + extras) / arrobas),
         "/@",
         hasExtras ? "Inclui depreciação e pró-labore mensais" : "Informe depreciação/pró-labore em Configurações da propriedade para um COT mais preciso"
       );
     }

     export function kpiMargens(range) {
       const receitas = sumTx(range, (t) => t.kind === "receita");
       const despesasAll = sumTx(range, (t) => t.kind === "despesa");
       if (!receitas && !despesasAll) {
         return [kpiMissing("Margem bruta", "Registre receitas e despesas no período."), kpiMissing("Margem líquida", "Registre receitas e despesas no período.")];
       }
       const margemBruta = receitas - despesasAll;
       const margemLiquida = margemBruta - monthlyExtraCosts() * periodMonths(range);
       const area = totalPropertyAreaHa();
       return [
         kpiOk("Margem bruta", formatBRL(margemBruta), "", area ? `${formatBRL(margemBruta / area)}/ha no período` : "Informe a área em Perfil para ver R$/ha"),
         kpiOk("Margem líquida", formatBRL(margemLiquida), "", area ? `${formatBRL(margemLiquida / area)}/ha no período` : "Informe a área em Perfil para ver R$/ha"),
       ];
     }

     export function kpiBreakEven(range) {
       const area = totalPropertyAreaHa();
       const cot = sumTx(range, (t) => t.kind === "despesa") + monthlyExtraCosts() * periodMonths(range);
       const price = consolidatedArrobaPrice(range);
       if (!price) return kpiMissing("Break-even", "Informe o preço padrão da @ em pelo menos uma propriedade ou registre vendas no período.");
       if (!area) return kpiMissing("Break-even", "Informe a área da propriedade em Perfil.");
       if (!cot) return kpiMissing("Break-even", "Registre despesas no período.");
       const breakEvenArrobas = cot / price;
       return kpiOk("Break-even", fmtNum(breakEvenArrobas / area, 2), "@/ha", `${fmtNum(breakEvenArrobas, 1)} @ no total, a ${formatBRL(price)}/@`);
     }

     export function kpiROI(range) {
       const capital = totalPropertyCapitalBRL();
       if (!capital) return kpiMissing("ROI", "Informe o capital investido em pelo menos uma propriedade (Configurações da propriedade).");
       const receitas = sumTx(range, (t) => t.kind === "receita");
       const despesasAll = sumTx(range, (t) => t.kind === "despesa");
       const margemLiquida = receitas - despesasAll - monthlyExtraCosts() * periodMonths(range);
       return kpiOk("ROI", fmtNum((margemLiquida / capital) * 100, 1), "%", `Margem líquida ${formatBRL(margemLiquida)} / capital ${formatBRL(capital)}`);
     }

     export function kpiLucroHa(range) {
       const area = totalPropertyAreaHa();
       if (!area) return kpiMissing("Lucro por hectare", "Informe a área da propriedade em Perfil.");
       const receitas = sumTx(range, (t) => t.kind === "receita");
       const despesasAll = sumTx(range, (t) => t.kind === "despesa");
       const margemLiquida = receitas - despesasAll - monthlyExtraCosts() * periodMonths(range);
       const annualized = (margemLiquida / area) * (DAYS_PER_YEAR / periodDays(range));
       return kpiOk("Lucro por hectare", formatBRL(annualized), "/ha/ano", "Baseado na margem líquida do período, anualizada");
     }

     export function renderGroup3(range) {
       return [kpiCOE(range), kpiCOT(range), ...kpiMargens(range), kpiBreakEven(range), kpiROI(range), kpiLucroHa(range)];
     }

     // =========================== Grupo 4 — Gestão ===========================
     export function kpiGiro(range) {
       const days = animalsCache
         .filter((a) => a.status === "sold" && inRange(a.saleDate, range))
         .map((a) => saleDaysHeld(a))
         .filter((d) => d != null);
       if (!days.length) return kpiMissing("Giro (dias até a venda)", "Registre vendas no período com data de compra/nascimento conhecida.");
       return kpiOk("Giro (dias até a venda)", fmtNum(days.reduce((s, d) => s + d, 0) / days.length, 0), "dias", `${days.length} animal(is) vendido(s) no período`);
     }

     export function kpiCustoReposicao(range) {
       const purchasedInPeriod = animalsCache.filter(
         (a) => a.acquisitionType === "purchased" && inRange(a.purchaseDate, range) && Number.isFinite(a.purchaseWeightKg) && Number.isFinite(a.purchaseCostBRL)
       );
       const soldInPeriod = animalsCache.filter((a) => a.status === "sold" && inRange(a.saleDate, range) && Number.isFinite(a.salePricePerArrobaBRL));

       const cards = [];
       if (purchasedInPeriod.length) {
         const totalCost = purchasedInPeriod.reduce((s, a) => s + a.purchaseCostBRL, 0);
         const totalKg = purchasedInPeriod.reduce((s, a) => s + a.purchaseWeightKg, 0);
         cards.push(kpiOk("Custo de reposição — compra", formatBRL(totalCost / totalKg), "/kg", `${purchasedInPeriod.length} compra(s) no período`));
       } else {
         cards.push(kpiMissing("Custo de reposição — compra", "Registre compras de animais no período."));
       }
       if (soldInPeriod.length) {
         const avgPrice = soldInPeriod.reduce((s, a) => s + a.salePricePerArrobaBRL, 0) / soldInPeriod.length;
         cards.push(kpiOk("Preço médio de venda", formatBRL(avgPrice), "/@", `${soldInPeriod.length} venda(s) no período`));
       } else {
         cards.push(kpiMissing("Preço médio de venda", "Registre vendas de animais no período."));
       }
       return cards;
     }

     export function kpiInventario() {
       const active = animalsCache.filter((a) => (a.status || "active") === "active");
       if (!active.length) return kpiMissing("Inventário atual", "Sem animais ativos para calcular o inventário.");
       // Group active animals by propertyId (via lot) and apply that property's price.
       const byProp = new Map();
       for (const a of active) {
         const lot = a.lotId ? lotsCache.find((l) => l.id === a.lotId) : null;
         const key = lot?.propertyId || null;
         if (!byProp.has(key)) byProp.set(key, []);
         byProp.get(key).push(a);
       }
       let totalValue = 0;
       let totalArr = 0;
       let covered = 0;
       for (const [propId, animals] of byProp) {
         const prop = propId ? propertiesCache.find((p) => p.id === propId) : null;
         const price = Number.isFinite(prop?.defaultArrobaPriceBRL)
           ? prop.defaultArrobaPriceBRL
           : settingsCache.defaultArrobaPriceBRL;
         if (!Number.isFinite(price)) continue;
         const arr = totalArrobas(animals);
         totalValue += arr * price;
         totalArr += arr;
         covered += animals.length;
       }
       if (!covered) return kpiMissing("Inventário atual", "Informe o preço padrão da @ em pelo menos uma propriedade.");
       return kpiOk("Inventário atual", formatBRL(totalValue), "", `${covered} cabeça(s) · ${formatArrobas(totalArr)} @ estimada(s)`);
     }

     export function renderGroup4Cards(range) {
       return [kpiGiro(range), ...kpiCustoReposicao(range), kpiInventario()];
     }

     export function computeMonthlyCashflow() {
       return buildRecentMonthKeys(12).map((key) => ({
         key,
         net: transactionsCache
           .filter((t) => { const d = toDateSafe(t.date); return d && monthKey(d) === key; })
           .reduce((s, t) => s + (t.kind === "receita" ? (t.amountBRL || 0) : -(t.amountBRL || 0)), 0),
       }));
     }

     // [{ id, label, total, pct }] desc by total, plus grand total.
     export function computeExpensesByGroup(range) {
       const groupLabel = Object.fromEntries(TX_EXPENSE_GROUPS.map((g) => [g.id, g.label]));
       const acc = {};
       for (const t of transactionsCache) {
         if (t.kind !== "despesa" || !inRange(t.date, range)) continue;
         const id = categoryGroupId(t.category) || "outros";
         acc[id] = (acc[id] || 0) + (t.amountBRL || 0);
       }
       const total = Object.values(acc).reduce((s, v) => s + v, 0);
       const groups = Object.entries(acc)
         .filter(([, v]) => v > 0)
         .map(([id, v]) => ({ id, label: groupLabel[id] || "Outros", total: v,
                              pct: total > 0 ? (v / total) * 100 : 0 }))
         .sort((a, b) => b.total - a.total);
       return { groups, total };
     }

     // Largest single despesa transaction in range, or null.
     export function largestExpense(range) {
       return transactionsCache
         .filter((t) => t.kind === "despesa" && inRange(t.date, range))
         .reduce((best, t) => (!best || (t.amountBRL || 0) > (best.amountBRL || 0) ? t : best), null);
     }

     // Top 5 groups + one aggregated "Outros" slice when there are more —
     // shared by the donut (expanded) and the stacked bar (preview) so their
     // colors/order always match.
     export function computeExpenseSlices(groups, total) {
       const top5 = groups.slice(0, 5);
       const restTotal = groups.slice(5).reduce((s, g) => s + g.total, 0);
       return restTotal > 0
         ? [...top5, { id: "resto", label: "Outros", total: restTotal, pct: total > 0 ? (restTotal / total) * 100 : 0 }]
         : top5;
     }

     export function renderExpensesByCategoryCard(range, { compact = false } = {}) {
       const { groups, total } = computeExpensesByGroup(range);
       if (total === 0) {
         if (compact) return "";
         return `
           <div class="kpi-card expenses-card is-missing">
             <p class="kpi-card-label">Despesas por categoria</p>
             <p class="kpi-card-hint">Registre despesas no período para ver a distribuição dos gastos por frente.</p>
           </div>
         `;
       }

       const donutSlices = computeExpenseSlices(groups, total);

       let cumulativePct = 0;
       const donutCircles = donutSlices
         .map((g, idx) => {
           const i = idx + 1;
           const offset = ((125 - cumulativePct) % 100).toFixed(2);
           cumulativePct += g.pct;
           return `<circle cx="21" cy="21" r="15.915" fill="none" stroke-width="5" class="donut-seg donut-seg-${i}" stroke-dasharray="${g.pct.toFixed(2)} ${(100 - g.pct).toFixed(2)}" stroke-dashoffset="${offset}"><title>${escapeHtml(g.label)}: ${escapeHtml(formatBRL(g.total))} (${g.pct.toFixed(1).replace(".", ",")}%)</title></circle>`;
         })
         .join("");

       if (compact) {
         const segmentsHTML = donutSlices
           .map((g, idx) => {
             const title = `${g.label}: ${formatBRL(g.total)} (${g.pct.toFixed(1).replace(".", ",")}%)`;
             return `<span class="stacked-seg exp-dot-${idx + 1}" style="flex-basis: ${g.pct.toFixed(1)}%" title="${escapeHtml(title)}"></span>`;
           })
           .join("");

         const legendSlices = donutSlices.slice(0, 2);
         const legendItems = legendSlices
           .map((g, idx) => `<li><span class="exp-dot exp-dot-${idx + 1}"></span>${escapeHtml(g.label)} <b>${Math.round(g.pct)}%</b></li>`)
           .join("");
         const remaining = donutSlices.length - legendSlices.length;
         const moreItem = remaining > 0 ? `<li class="is-muted">+${remaining} categorias</li>` : "";

         return `
           <div class="kpi-card expenses-card is-preview">
             <div class="kpi-preview-head">
               <p class="kpi-card-label">Despesas por categoria</p>
               <p class="kpi-preview-total">${escapeHtml(formatBRL(total))}</p>
             </div>
             <div class="stacked-bar" role="img" aria-label="Distribuição das despesas por categoria">${segmentsHTML}</div>
             <ul class="kpi-preview-legend">${legendItems}${moreItem}</ul>
           </div>
         `;
       }

       const maxTotal = groups[0].total;
       const listRows = groups
         .map((g, idx) => {
           const i = idx < 5 ? idx + 1 : 6;
           const pctOfMax = maxTotal > 0 ? (g.total / maxTotal) * 100 : 0;
           return `
             <div class="exp-row">
               <span class="exp-dot exp-dot-${i}"></span>
               <span class="exp-label">${escapeHtml(g.label)}</span>
               <span class="exp-bar"><span class="exp-bar-fill" style="width: ${pctOfMax.toFixed(1)}%"></span></span>
               <span class="exp-value">${escapeHtml(formatBRL(g.total))}</span>
               <span class="exp-pct">${g.pct.toFixed(1).replace(".", ",")}%</span>
             </div>
           `;
         })
         .join("");

       const largest = largestExpense(range);
       const highlightHTML = largest
         ? `
           <div class="exp-highlight">
             <span class="exp-highlight-label">Maior despesa</span>
             <span class="exp-highlight-value">${escapeHtml(formatBRL(largest.amountBRL || 0))}</span>
             <span class="exp-highlight-meta">${escapeHtml((TX_CATEGORY_LABEL[largest.category] || largest.category || "") + (largest.description ? ` · ${largest.description}` : ""))}</span>
           </div>
         `
         : "";

       return `
         <div class="kpi-card expenses-card">
           <p class="kpi-card-label">Despesas por categoria</p>
           <svg class="expenses-donut" viewBox="0 0 42 42" role="img" aria-label="Distribuição das despesas por categoria">
             ${donutCircles}
             <text x="21" y="19.5" text-anchor="middle" class="donut-center-value">${escapeHtml(formatBRL(total))}</text>
             <text x="21" y="26" text-anchor="middle" class="donut-center-caption">despesas</text>
           </svg>
           <div class="exp-list">${listRows}</div>
           ${highlightHTML}
         </div>
       `;
     }

     export function renderCashflowCard({ compact = false } = {}) {
       if (!transactionsCache.length) {
         if (compact) return "";
         return `
           <div class="kpi-card cashflow-card is-missing">
             <p class="kpi-card-label">Fluxo de caixa mensal</p>
             <p class="kpi-card-hint">Registre receitas e despesas para ver o fluxo de caixa dos últimos 12 meses.</p>
           </div>
         `;
       }
       const months = computeMonthlyCashflow();
       const maxAbs = Math.max(1, ...months.map((m) => Math.abs(m.net)));
       const w = 300, h = 72;
       const barW = w / months.length - 4;
       const bars = months
         .map((m, i) => {
           const barH = Math.max(2, (Math.abs(m.net) / maxAbs) * (h / 2 - 4));
           const x = (i * (w / months.length) + 2).toFixed(1);
           const y = (m.net >= 0 ? h / 2 - barH : h / 2).toFixed(1);
           return `<rect class="cf-bar${m.net < 0 ? " negative" : ""}" x="${x}" y="${y}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="2"><title>${escapeHtml(monthChipLabel(m.key))}: ${escapeHtml(formatBRL(m.net))}</title></rect>`;
         })
         .join("");
       const svgHTML = `
         <svg class="cashflow-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Fluxo de caixa mensal dos últimos 12 meses">
           <line class="cf-axis" x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" />
           ${bars}
         </svg>
       `;
       if (compact) {
         const net = months.reduce((s, m) => s + m.net, 0);
         return `
           <div class="kpi-card cashflow-card is-preview">
             <div class="kpi-preview-head">
               <p class="kpi-card-label">Fluxo de caixa mensal</p>
               <p class="kpi-preview-total${net < 0 ? " is-negative" : ""}">${escapeHtml(formatBRL(net))}</p>
             </div>
             ${svgHTML}
             <div class="cashflow-legend">
               <span>${escapeHtml(monthChipLabel(months[0].key))}</span>
               <span>${escapeHtml(monthChipLabel(months[months.length - 1].key))}</span>
             </div>
           </div>
         `;
       }
       return `
         <div class="kpi-card cashflow-card">
           <p class="kpi-card-label">Fluxo de caixa mensal</p>
           ${svgHTML}
           <div class="cashflow-legend">
             <span>${escapeHtml(monthChipLabel(months[0].key))}</span>
             <span>${escapeHtml(monthChipLabel(months[months.length - 1].key))}</span>
           </div>
         </div>
       `;
     }

     // --- KPI section collapse state ---
     // renderIndicadores() replaces indicadoresRootEl.innerHTML on every
     // render, so open/closed <details> state can't live in the DOM — it's
     // kept here and mirrored to localStorage so it survives reloads.
     const KPI_SECTIONS_KEY = "agroconnect:indicadores:openSections";
     function loadOpenKpiSections() {
       try {
         const parsed = JSON.parse(localStorage.getItem(KPI_SECTIONS_KEY));
         return new Set(Array.isArray(parsed) ? parsed : []);
       } catch {
         return new Set();
       }
     }
     let openKpiSections = loadOpenKpiSections();
     function persistOpenKpiSections() {
       try {
         localStorage.setItem(KPI_SECTIONS_KEY, JSON.stringify([...openKpiSections]));
       } catch {
         // best-effort — a write failure must never break rendering
       }
     }

     // --- Card / section HTML builders ---
     export function kpiCardHTML(item) {
       if (!item.ok) {
         return `
           <div class="kpi-card is-missing">
             <p class="kpi-card-label">${escapeHtml(item.label)}</p>
             <p class="kpi-card-hint">${escapeHtml(item.hint)}</p>
           </div>
         `;
       }
       return `
         <div class="kpi-card">
           <p class="kpi-card-label">${escapeHtml(item.label)}</p>
           <div class="kpi-card-value-row">
             <span class="kpi-card-value">${item.value}</span>
             ${item.unit ? `<span class="kpi-card-unit">${escapeHtml(item.unit)}</span>` : ""}
           </div>
           ${item.context ? `<p class="kpi-card-context">${escapeHtml(item.context)}</p>` : ""}
         </div>
       `;
     }

     export function kpiSectionHTML(id, title, subtitle, cardsHTML, previewHTML = "") {
       const open = openKpiSections.has(id);
       return `
         <details class="kpi-section" data-section-id="${id}"${open ? " open" : ""}>
           <summary class="kpi-section-header">
             <div class="kpi-section-heading">
               <h3 class="kpi-section-title">${escapeHtml(title)}</h3>
               ${subtitle ? `<p class="kpi-section-subtitle">${escapeHtml(subtitle)}</p>` : ""}
             </div>
             <span class="kpi-section-chevron" aria-hidden="true">▾</span>
             ${previewHTML}
           </summary>
           <div class="kpi-grid">${cardsHTML}</div>
         </details>
       `;
     }

     // Non-collapsible section wrapper used by the Estoque tab, which keeps
     // its own always-open sections outside this feature's scope.
     export function plainKpiSectionHTML(title, subtitle, cardsHTML) {
       return `
         <div class="kpi-section">
           <div class="kpi-section-header kpi-section-header-plain">
             <h3 class="kpi-section-title">${escapeHtml(title)}</h3>
             ${subtitle ? `<p class="kpi-section-subtitle">${escapeHtml(subtitle)}</p>` : ""}
           </div>
           <div class="kpi-grid">${cardsHTML}</div>
         </div>
       `;
     }

     export function kpiSkeletonCardHTML() {
       return `
         <div class="kpi-card skeleton" aria-hidden="true">
           <span class="sk-block" style="width: 60%; height: 14px;"></span>
           <div class="kpi-card-value-row">
             <span class="sk-block" style="width: 70%; height: 32px;"></span>
           </div>
         </div>
       `;
     }

     export function renderIndicadoresLoading() {
       const groups = [
         ["desempenho", "Desempenho animal", 5],
         ["reprodutivo", "Reprodutivo", 5],
         ["economico", "Econômico-financeiro", 6],
         ["gestao", "Gestão", 4],
       ];
       indicadoresRootEl.innerHTML = groups
         .map(([id, title, count]) => kpiSectionHTML(id, title, "", Array.from({ length: count }).map(kpiSkeletonCardHTML).join("")))
         .join("");
     }

     // =====================================================
     // 7f1. Ponto de abate — per-head arroba projection vs. target, one row
     //      per lot per location (farm/confined), sorted heaviest-first.
     //      Pure derivation from lotsCache/movementsCache/settingsCache —
     //      reuses the lotWeightProjection/lotConfinedProjection anchors.
     // =====================================================
     export function computeSlaughterRows() {
       const cfg = getSlaughterConfig();
       const rows = [];

       for (const lot of lotsCache) {
         const target = resolveLotTargetArrobas(lot);

         const headcount = lot.headcount ?? 0;
         if (headcount > 0) {
           const projection = lotWeightProjection(lot);
           if (projection) {
             const yieldPct = resolveFarmYieldPct(lot);
             const arrobasPerHead = (projection.projectedWeightKg * yieldPct) / KG_PER_ARROBA;
             rows.push({
               lotId: lot.id,
               lotName: lot.name,
               location: "farm",
               heads: headcount,
               projectedWeightKg: projection.projectedWeightKg,
               yieldPct,
               arrobasPerHead,
               targetArrobas: target,
               status: arrobasPerHead >= target ? "ready" : arrobasPerHead >= target - 1 ? "near" : "growing",
               forecast: slaughterForecast({
                 projectedWeightKg: projection.projectedWeightKg,
                 gmdKgPerDay: projection.gmdKgPerDay,
                 targetArrobas: target,
                 yieldPct,
               }),
             });
           }
         }

         const confinedHeadcount = lot.confinedHeadcount ?? 0;
         if (confinedHeadcount > 0) {
           const confinedProjection = lotConfinedProjection(lot);
           if (confinedProjection) {
             const yieldPct = resolveConfinementYieldPct(lot);
             const arrobasPerHead = (confinedProjection.projectedWeightKg * yieldPct) / KG_PER_ARROBA;
             rows.push({
               lotId: lot.id,
               lotName: lot.name,
               location: "confined",
               heads: confinedHeadcount,
               projectedWeightKg: confinedProjection.projectedWeightKg,
               yieldPct,
               arrobasPerHead,
               targetArrobas: target,
               status: arrobasPerHead >= target ? "ready" : arrobasPerHead >= target - 1 ? "near" : "growing",
               forecast: slaughterForecast({
                 projectedWeightKg: confinedProjection.projectedWeightKg,
                 gmdKgPerDay: CONFINEMENT_GMD_KG_PER_DAY,
                 targetArrobas: target,
                 yieldPct,
               }),
             });
           }
         }
       }

       rows.sort((a, b) => b.arrobasPerHead - a.arrobasPerHead);
       return rows;
     }

     export function slaughterRowHTML(row) {
       const locationLabel = row.location === "farm" ? "Fazenda" : "Confinamento";
       const pct = Math.max(0, Math.min(100, (row.arrobasPerHead / row.targetArrobas) * 100));
       return `
         <li class="slaughter-row is-${row.status}" data-lot-id="${escapeHtml(row.lotId)}" tabindex="0" role="button" aria-label="Ver detalhes do lote ${escapeHtml(row.lotName)}">
           <div class="slaughter-row-top">
             <div class="slaughter-row-left">
               <span class="slaughter-row-name">${escapeHtml(row.lotName)}</span>
               <span class="chip chip-location">${locationLabel}</span>
               <span class="slaughter-row-heads">${row.heads} cab.</span>
             </div>
             <div class="slaughter-row-right">
               <span class="slaughter-row-arrobas">${formatArrobas(row.arrobasPerHead)} @/cab</span>
               <span class="slaughter-row-target">meta ${formatArrobas(row.targetArrobas)} @</span>
             </div>
           </div>
           <div class="slaughter-progress">
             <div class="slaughter-progress-fill" style="width: ${pct.toFixed(1)}%;"></div>
           </div>
           ${row.forecast ? `<p class="slaughter-row-forecast">${escapeHtml(row.forecast.label)}</p>` : ""}
         </li>
       `;
     }

     export function slaughterPanelHTML() {
       const rows = computeSlaughterRows();
       const readyCount = rows.filter((r) => r.status === "ready").length;
       const summaryChip = readyCount > 0
         ? `<span class="chip chip-success">${readyCount} pronto${readyCount === 1 ? "" : "s"}</span>`
         : `<span class="chip chip-muted">Nenhum lote no ponto</span>`;

       const body = rows.length
         ? `<ul class="slaughter-row-list">${rows.map(slaughterRowHTML).join("")}</ul>`
         : `<p class="field-hint">Cadastre lotes com peso para acompanhar a projeção de @.</p>`;

       return `
         <div class="card slaughter-panel">
           <div class="card-top">
             <span class="ear-tag" style="font-size: var(--fs-base);">Ponto de abate</span>
             ${summaryChip}
           </div>
           ${body}
         </div>
       `;
     }

     // Delegated once — indicadoresRootEl's innerHTML is fully replaced on
     // every render, so per-row listeners would leak/duplicate.
     export function handleSlaughterRowActivate(e) {
       const row = e.target.closest(".slaughter-row[data-lot-id]");
       if (!row) return;
       const lot = lotsCache.find((l) => l.id === row.dataset.lotId);
       if (lot) openLotDetailSheet(lot);
     }
     indicadoresRootEl.addEventListener("click", handleSlaughterRowActivate);
     indicadoresRootEl.addEventListener("keydown", (e) => {
       if (e.key !== "Enter" && e.key !== " ") return;
       if (!e.target.closest(".slaughter-row[data-lot-id]")) return;
       e.preventDefault();
       handleSlaughterRowActivate(e);
     });
     // toggle doesn't bubble, so this must be a capture-phase listener.
     indicadoresRootEl.addEventListener("toggle", (e) => {
       if (!e.target.matches?.(".kpi-section[data-section-id]")) return;
       const id = e.target.dataset.sectionId;
       if (e.target.open) openKpiSections.add(id);
       else openKpiSections.delete(id);
       persistOpenKpiSections();
     }, true);

     export function renderIndicadores() {
       if (!loadedFlags.animals || !loadedFlags.transactions || !loadedFlags.events || !loadedFlags.settings) {
         renderIndicadoresLoading();
         return;
       }
       const range = computePeriodRange();
       const label = periodLabelText(range);

       indicadoresRootEl.innerHTML = [
         slaughterPanelHTML(),
         kpiSectionHTML("desempenho", "Desempenho animal", label, renderGroup1(range).map(kpiCardHTML).join("")),
         kpiSectionHTML("reprodutivo", "Reprodutivo", "Cobertura/IA, diagnóstico de gestação e partos", renderGroup2(range).map(kpiCardHTML).join("")),
         kpiSectionHTML("economico", "Econômico-financeiro", label,
           renderGroup3(range).map(kpiCardHTML).join("") + renderExpensesByCategoryCard(range),
           renderExpensesByCategoryCard(range, { compact: true })),
         kpiSectionHTML("gestao", "Gestão", "Fluxo dos últimos 12 meses; demais indicadores no período selecionado",
           renderGroup4Cards(range).map(kpiCardHTML).join("") + renderCashflowCard(),
           renderCashflowCard({ compact: true })),
       ].join("");
     }

     renderIndicadoresLoading();

     // =====================================================
     // 7f2. Estoque — per-property + consolidated inventory by chronological
     //      stage (Phase 4). Counts LOTS, not animals: each active lot's
     //      headcount (the source of truth) lands in exactly one
     //      CATTLE_CATEGORIES bucket, so tagged animals — already part of
     //      their lot's headcount — never double count.
     // =====================================================
     export const indSectionKpisEl = document.getElementById("indicadores-kpis-section");
     export const estoqueSectionEl = document.getElementById("estoque-section");
     export const estoquePropertySelect = document.getElementById("estoque-property");
     export const estoqueRootEl = document.getElementById("estoque-root");

     document.querySelectorAll('input[name="ind-section"]').forEach((r) => r.addEventListener("change", () => {
       const isEstoque = document.querySelector('input[name="ind-section"]:checked').value === "estoque";
       indSectionKpisEl.hidden = isEstoque;
       estoqueSectionEl.hidden = !isEstoque;
       if (isEstoque) renderEstoque();
     }));

     // { buckets: { [CATTLE_CATEGORIES key or "sem_categoria"]: headcount }, total }
     // includeConfined: per-property stock is physical/farm-only by
     // definition (like lotação), so it stays headcount-only; the
     // consolidated (all-properties) view opts in so a fully-confined lot
     // doesn't vanish from the owner's total inventory.
     export function computeInventoryBuckets(lots, { includeConfined = false } = {}) {
       const buckets = {};
       for (const key of Object.keys(CATTLE_CATEGORIES)) buckets[key] = 0;
       buckets.sem_categoria = 0;
       let total = 0;
       for (const lot of lots) {
         const headcount = (lot.headcount ?? 0) + (includeConfined ? (lot.confinedHeadcount ?? 0) : 0);
         const key = displayCategoryKeyForLot(lot) || "sem_categoria";
         buckets[key] = (buckets[key] || 0) + headcount;
         total += headcount;
       }
       return { buckets, total };
     }

     export function inventoryCardsHTML(buckets, total) {
       const categoryCards = Object.entries(CATTLE_CATEGORIES)
         .map(([key, c]) => kpiOk(c.label, fmtNum(buckets[key] || 0), "cabeças"))
         .map(kpiCardHTML)
         .join("");
       const outroCard = buckets.sem_categoria > 0
         ? kpiCardHTML(kpiOk("Sem categoria", fmtNum(buckets.sem_categoria), "cabeças", "Lotes anteriores à taxonomia atual"))
         : "";
       const totalCard = kpiCardHTML(kpiOk("Total", fmtNum(total), "cabeças"));
       return categoryCards + outroCard + totalCard;
     }

     export let estoqueSelectedPropertyId = null; // null = not yet initialized for this session
     export function setEstoqueSelectedPropertyId(v) { estoqueSelectedPropertyId = v; }

     export function estoquePropertyOptionsHTML() {
       const hasOrphanLots = lotsCache.some((l) => !l.propertyId);
       const propertyOptions = propertiesCache
         .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`)
         .join("");
       const orphanOption = hasOrphanLots ? `<option value="">Sem propriedade</option>` : "";
       return propertyOptions + orphanOption;
     }

     export function renderEstoqueLoading() {
       estoqueRootEl.innerHTML = [
         plainKpiSectionHTML("Estoque", "", Array.from({ length: 6 }).map(kpiSkeletonCardHTML).join("")),
         plainKpiSectionHTML("Consolidado", "", Array.from({ length: 6 }).map(kpiSkeletonCardHTML).join("")),
       ].join("");
     }

     export function renderEstoque() {
       if (!loadedFlags.lots || !loadedFlags.properties) {
         renderEstoqueLoading();
         return;
       }

       if (estoqueSelectedPropertyId == null) {
         estoqueSelectedPropertyId = propertiesCache[0]?.id ?? "";
       }

       estoquePropertySelect.innerHTML = estoquePropertyOptionsHTML();
       if (!estoquePropertySelect.innerHTML) {
         estoqueRootEl.innerHTML = `<p class="field-hint">Nenhuma propriedade ou lote cadastrado ainda.</p>`;
         return;
       }
       estoquePropertySelect.value = estoqueSelectedPropertyId;
       // Selected property may have been deleted since — fall back to the
       // first still-valid option rather than showing a blank select.
       if (estoquePropertySelect.value !== estoqueSelectedPropertyId) {
         estoqueSelectedPropertyId = estoquePropertySelect.options[0]?.value ?? "";
         estoquePropertySelect.value = estoqueSelectedPropertyId;
       }

       const propertyName = estoqueSelectedPropertyId
         ? (propertiesCache.find((p) => p.id === estoqueSelectedPropertyId)?.name || "—")
         : "Sem propriedade";
       const propertyLots = lotsCache.filter((l) => (l.propertyId || "") === estoqueSelectedPropertyId);
       const perProperty = computeInventoryBuckets(propertyLots);
       const consolidated = computeInventoryBuckets(lotsCache, { includeConfined: true });

       estoqueRootEl.innerHTML = [
         plainKpiSectionHTML(`Estoque — ${propertyName}`, `${propertyLots.length} lote(s) ativo(s)`, inventoryCardsHTML(perProperty.buckets, perProperty.total)),
         plainKpiSectionHTML("Consolidado", `${lotsCache.length} lote(s) em todas as propriedades`, inventoryCardsHTML(consolidated.buckets, consolidated.total)),
       ].join("");
     }

     estoquePropertySelect.addEventListener("change", () => {
       estoqueSelectedPropertyId = estoquePropertySelect.value;
       renderEstoque();
     });

     renderEstoqueLoading();
