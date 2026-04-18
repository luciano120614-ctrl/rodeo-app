// src/firebase.js
// Configuración de Firebase para la app Rodeo

import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentSingleTabManager } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyD02PNtBs0fNC8EDBfxoczMHYrMZEx6QI0",
  authDomain: "rodeo-app-7e53e.firebaseapp.com",
  projectId: "rodeo-app-7e53e",
  storageBucket: "rodeo-app-7e53e.firebasestorage.app",
  messagingSenderId: "1075119660503",
  appId: "1:1075119660503:web:621bf4016c74af6bc1bf92"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Firestore con persistencia offline (funciona sin internet)
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentSingleTabManager()
  })
});
