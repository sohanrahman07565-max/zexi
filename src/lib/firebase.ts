import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getDatabase } from 'firebase/database';

export const firebaseConfig = {
  apiKey: "AIzaSyCx2CDvJEm_i6gQ4O8EhN16pkqLFp7mFZI",
  authDomain: "zexiofficial8.firebaseapp.com",
  databaseURL: "https://zexiofficial8-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "zexiofficial8",
  storageBucket: "zexiofficial8.firebasestorage.app",
  messagingSenderId: "454772013301",
  appId: "1:454772013301:web:dac9c5438f64297d7f2dbc",
  measurementId: "G-9PF1ETHCEP"
};

export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const db = getFirestore(app);
export const rtdb = getDatabase(app);
