import {
  signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged,
  auth, googleProvider, db,
  doc, getDoc, setDoc, serverTimestamp, collection, query, where, getDocs,
} from "./firebase.js";
import { setCurrentAuthUid } from "./state.js";
import { isSharedSession, startFirestoreListeners, stopFirestoreListeners } from "./listeners.js";

    // =====================================================
    // 9. Auth — Google sign-in / session-aware UI
    // =====================================================
    // Desktop uses a popup; mobile (or coarse pointers, e.g. DevTools device
    // mode) falls back to a full-page redirect, which popups handle poorly.
    const isMobile = window.matchMedia("(max-width: 767px), (pointer: coarse)").matches;

    const signinButtons = document.querySelectorAll("[data-action='signin']");
    const avatarWrap = document.getElementById("avatar-wrap");
    const avatarBtn = document.getElementById("avatar-btn");
    export const avatarImg = document.getElementById("avatar-img");
    export const avatarFallback = document.getElementById("avatar-fallback");
    const sessionMenu = document.getElementById("session-menu");
    export const menuName = document.getElementById("menu-name");
    export const menuEmail = document.getElementById("menu-email");
    const menuSharedBadge = document.getElementById("menu-shared-badge");
    const signoutBtn = document.getElementById("btn-signout");
    const toastRegion = document.getElementById("toast-region");

    // --- Toast (discreet, auto-dismissing; never alert()) ---
    export function showToast(message) {
      const el = document.createElement("div");
      el.className = "toast";
      el.setAttribute("role", "status");
      el.textContent = message;
      toastRegion.appendChild(el);
      window.setTimeout(() => {
        el.classList.add("leaving");
        el.addEventListener("animationend", () => el.remove(), { once: true });
        // Fallback if animations are disabled (reduced motion).
        window.setTimeout(() => el.remove(), 250);
      }, 4200);
    }

    function friendlyAuthError(code) {
      switch (code) {
        case "auth/popup-closed-by-user":
        case "auth/cancelled-popup-request":
          return "Login cancelado.";
        case "auth/popup-blocked":
          return "O pop-up foi bloqueado pelo navegador.";
        case "auth/network-request-failed":
          return "Falha de rede. Verifique a conexão.";
        case "auth/unauthorized-domain":
          return "Este domínio ainda não está autorizado no Firebase.";
        default:
          return "Não foi possível entrar. Tente novamente.";
      }
    }

    // --- Sign in / out ---
    async function signIn() {
      try {
        await signInWithPopup(auth, googleProvider);
      } catch (err) {
        // A blocked popup is recoverable — retry once via redirect.
        if (err?.code === "auth/popup-blocked") {
          try { await signInWithRedirect(auth, googleProvider); return; } catch { /* fall through */ }
        }
        // Silent, self-inflicted cancellations don't deserve a toast.
        if (err?.code !== "auth/cancelled-popup-request" && err?.code !== "auth/popup-closed-by-user") {
          showToast(friendlyAuthError(err?.code));
        }
        console.warn("[Agro Connect] Sign-in error:", err?.code ?? err);
      }
    }

    async function doSignOut() {
      try {
        await signOut(auth);
      } catch (err) {
        showToast("Não foi possível sair. Tente novamente.");
        console.warn("[Agro Connect] Sign-out error:", err?.code ?? err);
      }
    }

    // --- Account dropdown ---
    export function setMenu(open) {
      sessionMenu.hidden = !open;
      avatarBtn.setAttribute("aria-expanded", String(open));
    }
    avatarBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setMenu(sessionMenu.hidden);
    });
    document.addEventListener("click", (e) => {
      if (!sessionMenu.hidden && !avatarWrap.contains(e.target)) setMenu(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setMenu(false);
    });

    signinButtons.forEach((b) => b.addEventListener("click", signIn));
    signoutBtn.addEventListener("click", () => { setMenu(false); doSignOut(); });

    // --- users/{uid} upsert on login ---
    // NOTE: deny-all rules block these writes until Phase 7 — we catch and keep
    // the session alive rather than surfacing an error to the user.
    export async function upsertUserDoc(user) {
      try {
        const ref = doc(db, "users", user.uid);
        const snap = await getDoc(ref);
        const data = {
          displayName: user.displayName ?? null,
          email: user.email ?? null,
          photoURL: user.photoURL ?? null,
          lastLoginAt: serverTimestamp(),
        };
        if (!snap.exists()) data.createdAt = serverTimestamp();  // set once, on create
        await setDoc(ref, data, { merge: true });
      } catch (err) {
        console.warn(
          "[Agro Connect] users/{uid} não gravado (regras deny-all até a Fase 7):",
          err?.code ?? err
        );
      }
    }

    // --- Resolve which account (owner uid) the signed-in user operates in ---
    // A member's email being listed in an owner's accounts/{ownerUid}.memberEmails
    // routes all data access to that owner's uid; otherwise the user is their
    // own account owner. Discovery failures (offline, permission) must never
    // lock the user out of their own data — fall back to their own uid.
    export async function resolveActiveAccount(user) {
      const email = (user.email || "").trim().toLowerCase();
      if (!email) return user.uid;
      try {
        const snap = await getDocs(
          query(collection(db, "accounts"), where("memberEmails", "array-contains", email))
        );
        if (!snap.empty) return snap.docs[0].id;
        return user.uid;
      } catch (err) {
        console.warn("[Agro Connect] Falha ao resolver conta compartilhada:", err?.code ?? err);
        return user.uid;
      }
    }

    export function updateSharedSessionBadge() {
      menuSharedBadge.hidden = !isSharedSession();
    }

    // --- Complete any redirect-based sign-in on load ---
    getRedirectResult(auth).catch((err) => {
      showToast(friendlyAuthError(err?.code));
      console.warn("[Agro Connect] Redirect result error:", err?.code ?? err);
    });

    export function initialOf(user) {
      const src = (user.displayName || user.email || "?").trim();
      return src.charAt(0).toUpperCase();
    }

    // Photo can fail to load (expired/blocked URL) — show initials instead.
    avatarImg.addEventListener("error", () => {
      avatarImg.hidden = true;
      avatarFallback.hidden = false;
    });

    // --- Single source of truth for session-aware UI ---
    // If Firebase Auth can't resolve the session (offline, network failure)
    // onAuthStateChanged never fires — fall back to a retry screen instead of
    // leaving the loading skeleton up forever.
    export const authInitTimeout = window.setTimeout(() => {
      document.body.dataset.auth = "error";
    }, 12000);
    document.getElementById("auth-retry-btn").addEventListener("click", () => {
      window.location.reload();
    });

    async function handleAuthStateChanged(user) {
      window.clearTimeout(authInitTimeout);
      if (user) {
        avatarFallback.textContent = initialOf(user);
        if (user.photoURL) {
          avatarFallback.hidden = true;
          avatarImg.hidden = false;
          avatarImg.src = user.photoURL;
        } else {
          avatarImg.hidden = true;
          avatarFallback.hidden = false;
        }
        menuName.textContent = user.displayName || "Produtor(a)";
        menuEmail.textContent = user.email || "";
        document.body.dataset.auth = "in";
        setCurrentAuthUid(user.uid);
        upsertUserDoc(user);
        const accountId = await resolveActiveAccount(user);
        // A sign-out (or a different user signing in) may have raced the
        // await above — abort so we don't start listeners for a stale user.
        if (auth.currentUser?.uid !== user.uid) return;
        startFirestoreListeners(accountId);
        updateSharedSessionBadge();
      } else {
        setMenu(false);
        avatarImg.removeAttribute("src");
        document.body.dataset.auth = "out";
        stopFirestoreListeners();
        updateSharedSessionBadge();
      }
    }

    onAuthStateChanged(
      auth,
      (user) => { handleAuthStateChanged(user); },
      (err) => {
        console.warn("[Agro Connect] Auth state error:", err?.code ?? err);
        window.clearTimeout(authInitTimeout);
        document.body.dataset.auth = "error";
      }
    );
