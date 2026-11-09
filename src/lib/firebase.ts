import { initializeApp, getApps } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// 1. Primary Firebase Config (Existing: zexiofficial844)
export const primaryConfig = {
  apiKey: "AIzaSyAvuHW-o4Rl-Ry8Fx5I3xp_Op1ujBT24Ls",
  authDomain: "zexiofficial844.firebaseapp.com",
  databaseURL: "https://zexiofficial844-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "zexiofficial844",
  storageBucket: "zexiofficial844.firebasestorage.app",
  messagingSenderId: "1025879830376",
  appId: "1:1025879830376:web:dce57d7bfcaae9f6aa70dd",
  measurementId: "G-B2NY0LX1YV"
};

// 2. Secondary Firebase Config (New: zexi-official)
export const secondaryConfig = {
  apiKey: "AIzaSyBZSaaMFkGrtEFnjQ5DlKFufQddjGB_6mc",
  authDomain: "zexi-official.firebaseapp.com",
  databaseURL: "https://zexi-official-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "zexi-official",
  storageBucket: "zexi-official.firebasestorage.app",
  messagingSenderId: "505293677006",
  appId: "1:505293677006:web:68affc8fb63d44c9accb9f",
  measurementId: "G-YJK5D86P6C"
};

// Safe initializer preventing duplicate app errors on HMR / re-import
function getOrInitializeApp(config: typeof primaryConfig, name: string) {
  const existing = getApps().find(a => a.name === name);
  if (existing) return existing;
  return initializeApp(config, name);
}

// Initialize Primary App
export const primaryApp = getOrInitializeApp(primaryConfig, "primaryBot");
export const primaryDb = getDatabase(primaryApp);
export const primaryAuth = getAuth(primaryApp);
export const primaryFirestore = getFirestore(primaryApp);

// Initialize Secondary App
export const secondaryApp = getOrInitializeApp(secondaryConfig, "secondaryBot");
export const secondaryDb = getDatabase(secondaryApp);
export const secondaryAuth = getAuth(secondaryApp);
export const secondaryFirestore = getFirestore(secondaryApp);

// Initialize Analytics safely (only in supported browser environments)
export let primaryAnalytics: any = null;
export let secondaryAnalytics: any = null;

if (typeof window !== "undefined") {
  isSupported().then((supported) => {
    if (supported) {
      try {
        primaryAnalytics = getAnalytics(primaryApp);
      } catch {}
      try {
        secondaryAnalytics = getAnalytics(secondaryApp);
      } catch {}
    }
  }).catch(() => {});
}

// Backward-compatible exports for existing application code
export const firebaseConfig = primaryConfig;
export const app = primaryApp;
export const auth = primaryAuth;
export const db = primaryFirestore;
export const rtdb = primaryDb;
export const database = primaryDb;
