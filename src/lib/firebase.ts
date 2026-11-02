import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import rawConfig from '../../firebase-applet-config.json';

export const firebaseConfig = {
  apiKey: rawConfig.apiKey || "AIzaSyAnQ0nbJl36_dBHaWnzo9IFZDJrRfn5nAA",
  authDomain: rawConfig.authDomain || "persuasive-sled-llxdt.firebaseapp.com",
  projectId: rawConfig.projectId || "persuasive-sled-llxdt",
  storageBucket: rawConfig.storageBucket || "persuasive-sled-llxdt.appspot.com",
  messagingSenderId: rawConfig.messagingSenderId || "979073438419",
  appId: rawConfig.appId || "1:979073438419:web:02625d32455e5b8c81fa26"
};

export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const db = getFirestore(app, rawConfig.firestoreDatabaseId); /* CRITICAL: The app will break without this line */
export const auth = getAuth(app);

// Test Firestore connection on boot
export async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase client is offline or initializing.');
    }
  }
}

testConnection();
