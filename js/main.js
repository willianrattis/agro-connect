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
import "./core/tabs.js";
import "./core/listeners.js";
import "./core/auth.js";
