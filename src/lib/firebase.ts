import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getDatabase } from 'firebase/database';

export const firebaseConfig = {
  apiKey: "AIzaSyAvuHW-o4Rl-Ry8Fx5I3xp_Op1ujBT24Ls",
  authDomain: "zexiofficial844.firebaseapp.com",
  databaseURL: "https://zexiofficial844-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "zexiofficial844",
  storageBucket: "zexiofficial844.firebasestorage.app",
  messagingSenderId: "1025879830376",
  appId: "1:1025879830376:web:dce57d7bfcaae9f6aa70dd",
  measurementId: "G-B2NY0LX1YV"
};

export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const db = getFirestore(app);
export const rtdb = getDatabase(app);
export const database = rtdb;
