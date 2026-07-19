// =====================================================
// Shared mutable state (caches + session identity)
//
// ES module imports are read-only live bindings — a consumer module can't
// do `animalsCache = ...` on an imported binding. Every cache below is
// exported with `export let` (so reads elsewhere see live updates) plus a
// setter function that the owning writer (listeners.js, or feature code
// left inline in index.html) must call instead of reassigning directly.
// =====================================================

// currentAuthUid = the authenticated Firebase user; currentUid = the
// active account's owner uid (the data scope for all queries/writes).
// They differ when the signed-in user is operating in a shared account.
export let currentAuthUid = null;
export function setCurrentAuthUid(v) { currentAuthUid = v; }

export let currentUid = null;
export function setCurrentUid(v) { currentUid = v; }

export let lotsCache = [];
export function setLotsCache(v) { lotsCache = v; }

export let animalsCache = [];
export function setAnimalsCache(v) { animalsCache = v; }

// Declared early in the original file (ahead of the other Firestore caches)
// because renderMonthChips() reads it during the module's initial
// synchronous render, before the "Firestore listeners" section ran.
export let transactionsCache = [];
export function setTransactionsCache(v) { transactionsCache = v; }

export let eventsCache = [];
export function setEventsCache(v) { eventsCache = v; }

export let settingsCache = {};
export function setSettingsCache(v) { settingsCache = v; }

export let propertiesCache = [];
export function setPropertiesCache(v) { propertiesCache = v; }

export let suppliersCache = [];
export function setSuppliersCache(v) { suppliersCache = v; }

export let confinementsCache = [];
export function setConfinementsCache(v) { confinementsCache = v; }

export let movementsCache = [];
export function setMovementsCache(v) { movementsCache = v; }

export let lotWeighingsCache = [];
export function setLotWeighingsCache(v) { lotWeighingsCache = v; }

// Perfil — Membros da conta (shared-account access by email). One-time
// getDoc on Perfil render (no onSnapshot — this doc is read rarely and
// re-fetched explicitly after each mutation).
export let accountMembersCache = [];
export function setAccountMembersCache(v) { accountMembersCache = v; }
