// =====================================================
// 0. Firebase (modular SDK v12 via CDN)
// =====================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider,
  signInWithPopup, signInWithRedirect, getRedirectResult,
  onAuthStateChanged, signOut,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp,
  collection, addDoc, query, where, orderBy, onSnapshot, getDocs, writeBatch,
  arrayUnion, arrayRemove,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB_rY85_SSBNjQtbHFHY7Ms8EI9RYsHfsA",
  authDomain: "agro-connect-78e69.firebaseapp.com",
  projectId: "agro-connect-78e69",
  storageBucket: "agro-connect-78e69.firebasestorage.app",
  messagingSenderId: "217525649901",
  appId: "1:217525649901:web:a4bdf756fab68b1d1f27e4",
  measurementId: "G-7JNSSZ4R1G",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Persistent local cache (IndexedDB): cached snapshots render instantly
// on cold start, and the SDK reconciles with the server automatically.
// Falls back to memory-only when unsupported (e.g. private browsing).
export let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch (err) {
  console.warn("[Agro Connect] Persistência local indisponível:", err?.code ?? err);
  db = getFirestore(app); // memory-only fallback (private mode / unsupported browser)
}

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// Analytics is optional and only works over http(s); guard so a file://
// open or a blocked import can't break initialization.
try {
  const { getAnalytics, isSupported } = await import(
    "https://www.gstatic.com/firebasejs/12.16.0/firebase-analytics.js"
  );
  if (await isSupported()) getAnalytics(app);
} catch (err) {
  console.warn("[Agro Connect] Analytics indisponível:", err?.message ?? err);
}

// Re-exported so auth.js / listeners.js / index.html's inline script don't
// need a second import of the same CDN modules for the SDK functions they call.
export {
  signInWithPopup, signInWithRedirect, getRedirectResult,
  onAuthStateChanged, signOut,
  doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp,
  collection, addDoc, query, where, orderBy, onSnapshot, getDocs, writeBatch,
  arrayUnion, arrayRemove,
};
