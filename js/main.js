// Entry point — imports the core modules in dependency order so their
// top-level side effects (Firebase init, the Sheet dialog wiring, the auth
// dropdown/toast/session DOM wiring, getRedirectResult()) run before the
// feature code inline in index.html executes.
import "./core/firebase.js";
import "./core/state.js";
import "./core/dom.js";
import "./core/constants.js";
import "./core/helpers.js";
import "./core/sheet.js";
import "./core/datefield.js";
import "./core/tabs.js";
import "./core/listeners.js";
import "./core/auth.js";

// Rebanho feature modules, in the order their code first appeared inline.
import "../features/rebanho/render.js";
import "../features/rebanho/animals.js";
import "../features/rebanho/weighing.js";
import "../features/rebanho/lots.js";
import "../features/rebanho/movements.js";

// Financeiro, Perfil and Indicadores feature modules, in the order their
// code first appeared inline.
import "../features/financeiro/financeiro.js";
import "../features/perfil/settings.js";
import "../features/perfil/members.js";
import "../features/perfil/properties.js";
import "../features/perfil/suppliers.js";
import "../features/indicadores/indicadores.js";

// --- Bootstrap wiring that spans multiple features (tab clicks, the FAB) ---
import { tabs, views, fabBtn } from "./core/dom.js";
import { activateTab } from "./core/tabs.js";
import { showToast } from "./core/auth.js";
import { renderAccountMembersCard } from "../features/perfil/members.js";
import { openNewLotSheet } from "../features/rebanho/lots.js";
import { openNewTransactionSheet } from "../features/financeiro/financeiro.js";

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    activateTab(tab);
    if (tab.dataset.view === "view-perfil") renderAccountMembersCard();
  });
});

fabBtn.addEventListener("click", () => {
  const activeView = views.find((v) => !v.hidden);
  if (activeView?.id === "view-rebanho") {
    openNewLotSheet();
  } else if (activeView?.id === "view-financeiro") {
    openNewTransactionSheet();
  } else {
    showToast("Em breve nesta aba.");
  }
});
