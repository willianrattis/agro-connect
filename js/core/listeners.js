import {
  db, doc, serverTimestamp, collection, addDoc, query, where, orderBy, onSnapshot,
} from "./firebase.js";
import {
  syncIndicatorEl, herdListEl, herdCountEl, lotListEl, lotCountEl, statHeadEl, statArrobasEl,
  finReceitasEl, finDespesasEl, finSaldoEl, finCountEl, txListEl,
  settingsTargetValueEl, settingsFarmYieldValueEl, settingsConfYieldValueEl,
  accountMembersCardEl, accountMembersListEl, sharedAccessCardEl,
  propertiesCountValueEl, propertiesAreaValueEl, propertiesPriceValueEl, propertiesCapitalValueEl,
  suppliersCountValueEl, suppliersWithDocValueEl,
} from "./dom.js";
import {
  currentAuthUid, currentUid, setCurrentAuthUid, setCurrentUid,
  setLotsCache, animalsCache, setAnimalsCache, setTransactionsCache, setEventsCache,
  settingsCache, setSettingsCache, propertiesCache, setPropertiesCache, setSuppliersCache,
  setConfinementsCache, setMovementsCache, setLotWeighingsCache, setAccountMembersCache,
} from "./state.js";
import { showToast } from "./auth.js";
import {
  renderSkeletons, renderHerd, renderHerdEmpty, renderHerdError, renderHerdSummary,
  renderLots, renderLotsError,
} from "../../features/rebanho/render.js";
import { refreshLotDetailSheetIfOpen, setOpenLotDetailLotId } from "../../features/rebanho/lots.js";
import { renderFinanceiro, renderFinError, renderMonthChips } from "../../features/financeiro/financeiro.js";
import { renderSettingsCard } from "../../features/perfil/settings.js";
import { renderPropertiesCard } from "../../features/perfil/properties.js";
import { renderSuppliersCard } from "../../features/perfil/suppliers.js";
import {
  renderIndicadores, renderIndicadoresLoading, renderEstoque, setEstoqueSelectedPropertyId,
} from "../../features/indicadores/indicadores.js";

    // =====================================================
    // 8. Firestore listeners (animals + lots + transactions + settings)
    //    — lifecycle tied to auth
    // =====================================================
    // currentAuthUid = the authenticated Firebase user; currentUid = the
    // active account's owner uid (the data scope for all queries/writes).
    // They differ when the signed-in user is operating in a shared account.
    export function isSharedSession() {
      return currentAuthUid != null && currentUid != null && currentAuthUid !== currentUid;
    }
    let unsubAnimals = null;
    let unsubLots = null;
    let unsubTransactions = null;
    let unsubEvents = null;
    let unsubSettings = null;
    let unsubProperties = null;
    let unsubSuppliers = null;
    let unsubConfinements = null;
    let unsubMovements = null;
    let unsubLotWeighings = null;

    // Collections whose latest snapshot is cache-only (metadata.fromCache);
    // drives the header "Sincronizando" indicator.
    const syncPending = new Set();
    function updateSyncState(name, fromCache) {
      if (fromCache) syncPending.add(name);
      else syncPending.delete(name);
      const show = syncPending.size > 0 && currentUid != null;
      syncIndicatorEl.hidden = !show;
      if (show) syncIndicatorEl.setAttribute("aria-hidden", "false");
      else syncIndicatorEl.removeAttribute("aria-hidden");
    }

    // Indicadores needs all four caches to have resolved at least once before
    // it can tell "no data yet" apart from "still loading" (skeleton vs. hint).
    export let loadedFlags = { animals: false, transactions: false, events: false, settings: false, properties: false, lots: false };

    // Guards the one-time settings.propertyAreaHa → properties/{id} migration
    // (see maybeMigratePropertyArea) so it fires at most once per session.
    let propertyMigrationAttempted = false;

    export function startFirestoreListeners(uid) {
      setCurrentUid(uid);
      renderSkeletons(4);
      herdCountEl.textContent = "Carregando…";
      loadedFlags = { animals: false, transactions: false, events: false, settings: false, properties: false, lots: false };
      propertyMigrationAttempted = false;

      const animalsQuery = query(
        collection(db, "animals"),
        where("ownerId", "==", uid),
        orderBy("createdAt", "desc")
      );
      unsubAnimals = onSnapshot(
        animalsQuery,
        { includeMetadataChanges: true },
        (snap) => {
          updateSyncState("animals", snap.metadata.fromCache);
          setAnimalsCache(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
          if (animalsCache.length === 0) renderHerdEmpty();
          else renderHerd(animalsCache);
          renderLots();
          renderHerdSummary();
          loadedFlags.animals = true;
          renderIndicadores();
        },
        (err) => {
          updateSyncState("animals", false);
          console.warn("[Agro Connect] animals onSnapshot error:", err?.code ?? err);
          renderHerdError(err);
          loadedFlags.animals = true;
          renderIndicadores();
        }
      );

      const lotsQuery = query(
        collection(db, "lots"),
        where("ownerId", "==", uid),
        orderBy("createdAt", "desc")
      );
      unsubLots = onSnapshot(
        lotsQuery,
        { includeMetadataChanges: true },
        (snap) => {
          updateSyncState("lots", snap.metadata.fromCache);
          setLotsCache(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
          renderLots();
          renderHerdSummary();
          renderFinanceiro();
          refreshLotDetailSheetIfOpen();
          loadedFlags.lots = true;
          renderEstoque();
          renderIndicadores();
        },
        (err) => {
          updateSyncState("lots", false);
          console.warn("[Agro Connect] lots onSnapshot error:", err?.code ?? err);
          setLotsCache([]);
          renderLotsError();
          statHeadEl.textContent = "—";
          statArrobasEl.textContent = "—";
          loadedFlags.lots = true;
          renderEstoque();
          renderIndicadores();
        }
      );

      // Per-lot ledger (aggregate lots): read-only feed for the lot detail
      // sheet's movement history + running headcount, and for the farm/
      // confined weight-projection anchors (feeds Ponto de abate too).
      const movementsQuery = query(
        collection(db, "movements"),
        where("ownerId", "==", uid),
        orderBy("date", "desc")
      );
      unsubMovements = onSnapshot(
        movementsQuery,
        { includeMetadataChanges: true },
        (snap) => {
          updateSyncState("movements", snap.metadata.fromCache);
          setMovementsCache(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
          refreshLotDetailSheetIfOpen();
          renderIndicadores();
        },
        (err) => {
          updateSyncState("movements", false);
          console.warn("[Agro Connect] movements onSnapshot error:", err?.code ?? err);
          setMovementsCache([]);
          renderIndicadores();
        }
      );

      // Bulk weighing sessions — feeds the weighing history sheet and lets the
      // most recent session be edited/deleted.
      const lotWeighingsQuery = query(
        collection(db, "lot_weighings"),
        where("ownerId", "==", uid),
        orderBy("date", "desc")
      );
      unsubLotWeighings = onSnapshot(
        lotWeighingsQuery,
        { includeMetadataChanges: true },
        (snap) => {
          updateSyncState("lot_weighings", snap.metadata.fromCache);
          setLotWeighingsCache(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        },
        (err) => {
          updateSyncState("lot_weighings", false);
          console.warn("[Agro Connect] lot_weighings onSnapshot error:", err?.code ?? err);
          setLotWeighingsCache([]);
        }
      );

      // Linked despesas feed the sale-result profit line on each card, so a
      // change here needs to re-render the herd, not just refresh a cache.
      const transactionsQuery = query(
        collection(db, "transactions"),
        where("ownerId", "==", uid),
        orderBy("date", "desc")
      );
      unsubTransactions = onSnapshot(
        transactionsQuery,
        { includeMetadataChanges: true },
        (snap) => {
          updateSyncState("transactions", snap.metadata.fromCache);
          setTransactionsCache(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
          if (animalsCache.length) renderHerd(animalsCache);
          renderMonthChips();
          renderFinanceiro();
          loadedFlags.transactions = true;
          renderIndicadores();
        },
        (err) => {
          updateSyncState("transactions", false);
          console.warn("[Agro Connect] transactions onSnapshot error:", err?.code ?? err);
          setTransactionsCache([]);
          renderFinError();
          loadedFlags.transactions = true;
          renderIndicadores();
        }
      );

      // Weighings, reproductive and lifecycle events — read-only here, feeds
      // GMD/reprodutivo/idade-de-abate indicators (no writes from this view).
      const eventsQuery = query(
        collection(db, "events"),
        where("ownerId", "==", uid),
        orderBy("date", "asc")
      );
      unsubEvents = onSnapshot(
        eventsQuery,
        { includeMetadataChanges: true },
        (snap) => {
          updateSyncState("events", snap.metadata.fromCache);
          setEventsCache(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
          loadedFlags.events = true;
          renderIndicadores();
        },
        (err) => {
          updateSyncState("events", false);
          console.warn("[Agro Connect] events onSnapshot error:", err?.code ?? err);
          setEventsCache([]);
          showToast("Não foi possível carregar os eventos. Verifique sua conexão.");
          loadedFlags.events = true;
          renderIndicadores();
        }
      );

      unsubSettings = onSnapshot(
        doc(db, "settings", uid),
        { includeMetadataChanges: true },
        (snap) => {
          updateSyncState("settings", snap.metadata.fromCache);
          setSettingsCache(snap.exists() ? snap.data() : {});
          renderSettingsCard();
          loadedFlags.settings = true;
          maybeMigratePropertyArea();
          renderIndicadores();
        },
        (err) => {
          updateSyncState("settings", false);
          console.warn("[Agro Connect] settings onSnapshot error:", err?.code ?? err);
          setSettingsCache({});
          showToast("Não foi possível carregar suas configurações. Verifique sua conexão.");
          loadedFlags.settings = true;
          renderIndicadores();
        }
      );

      const propertiesQuery = query(
        collection(db, "properties"),
        where("ownerId", "==", uid),
        orderBy("name")
      );
      unsubProperties = onSnapshot(
        propertiesQuery,
        { includeMetadataChanges: true },
        (snap) => {
          updateSyncState("properties", snap.metadata.fromCache);
          setPropertiesCache(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
          renderPropertiesCard();
          renderSettingsCard();
          loadedFlags.properties = true;
          maybeMigratePropertyArea();
          renderIndicadores();
          renderEstoque();
        },
        (err) => {
          updateSyncState("properties", false);
          console.warn("[Agro Connect] properties onSnapshot error:", err?.code ?? err);
          setPropertiesCache([]);
          renderSettingsCard();
          loadedFlags.properties = true;
          renderIndicadores();
          renderEstoque();
        }
      );

      const suppliersQuery = query(
        collection(db, "suppliers"),
        where("ownerId", "==", uid),
        orderBy("nameLower")
      );
      unsubSuppliers = onSnapshot(
        suppliersQuery,
        { includeMetadataChanges: true },
        (snap) => {
          updateSyncState("suppliers", snap.metadata.fromCache);
          setSuppliersCache(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
          renderSuppliersCard();
        },
        (err) => {
          updateSyncState("suppliers", false);
          console.warn("[Agro Connect] suppliers onSnapshot error:", err?.code ?? err);
          setSuppliersCache([]);
        }
      );

      const confinementsQuery = query(
        collection(db, "confinements"),
        where("ownerId", "==", uid),
        orderBy("nameLower")
      );
      unsubConfinements = onSnapshot(
        confinementsQuery,
        { includeMetadataChanges: true },
        (snap) => {
          updateSyncState("confinements", snap.metadata.fromCache);
          setConfinementsCache(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        },
        (err) => {
          updateSyncState("confinements", false);
          console.warn("[Agro Connect] confinements onSnapshot error:", err?.code ?? err);
          setConfinementsCache([]);
        }
      );
    }

    // One-time compat migration: users who set an area under the old
    // single-property settings.propertyAreaHa get it seeded as their first
    // "Principal" property, so multi-property indicators have data to sum.
    function maybeMigratePropertyArea() {
      if (propertyMigrationAttempted) return;
      if (!loadedFlags.properties || !loadedFlags.settings) return;
      propertyMigrationAttempted = true;
      if (propertiesCache.length > 0) return;
      const legacyArea = settingsCache.propertyAreaHa;
      if (legacyArea == null) return;
      addDoc(collection(db, "properties"), {
        ownerId: currentUid,
        name: "Principal",
        areaHa: legacyArea,
        notes: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }).catch((err) => {
        console.warn("[Agro Connect] Falha ao migrar área da propriedade:", err?.code ?? err);
      });
    }

    export function stopFirestoreListeners() {
      unsubAnimals?.();
      unsubLots?.();
      unsubTransactions?.();
      unsubEvents?.();
      unsubSettings?.();
      unsubProperties?.();
      unsubSuppliers?.();
      unsubConfinements?.();
      unsubMovements?.();
      unsubLotWeighings?.();
      unsubAnimals = null;
      unsubLots = null;
      unsubTransactions = null;
      unsubEvents = null;
      unsubSettings = null;
      unsubProperties = null;
      unsubSuppliers = null;
      unsubConfinements = null;
      unsubMovements = null;
      unsubLotWeighings = null;
      setCurrentUid(null);
      setCurrentAuthUid(null);
      syncPending.clear();
      syncIndicatorEl.hidden = true;
      syncIndicatorEl.removeAttribute("aria-hidden");
      setLotsCache([]);
      setAnimalsCache([]);
      setTransactionsCache([]);
      setEventsCache([]);
      setSettingsCache({});
      setPropertiesCache([]);
      setSuppliersCache([]);
      setConfinementsCache([]);
      setMovementsCache([]);
      setLotWeighingsCache([]);
      setOpenLotDetailLotId(null);
      setEstoqueSelectedPropertyId(null);
      loadedFlags = { animals: false, transactions: false, events: false, settings: false, properties: false, lots: false };
      propertyMigrationAttempted = false;
      herdListEl.innerHTML = "";
      statHeadEl.textContent = "—";
      statArrobasEl.textContent = "—";
      herdCountEl.textContent = "";
      lotListEl.innerHTML = "";
      lotCountEl.textContent = "";
      finReceitasEl.textContent = "—";
      finDespesasEl.textContent = "—";
      finSaldoEl.textContent = "—";
      finSaldoEl.classList.remove("fin-positive", "fin-negative");
      finCountEl.textContent = "";
      txListEl.innerHTML = "";
      propertiesCountValueEl.textContent = "—";
      propertiesAreaValueEl.textContent = "—";
      propertiesPriceValueEl.textContent = "—";
      propertiesCapitalValueEl.textContent = "—";
      suppliersCountValueEl.textContent = "—";
      suppliersWithDocValueEl.textContent = "—";
      settingsTargetValueEl.textContent = "—";
      settingsFarmYieldValueEl.textContent = "—";
      settingsConfYieldValueEl.textContent = "—";
      renderIndicadoresLoading();
      setAccountMembersCache([]);
      accountMembersListEl.innerHTML = "";
      accountMembersCardEl.hidden = true;
      sharedAccessCardEl.hidden = true;
    }
