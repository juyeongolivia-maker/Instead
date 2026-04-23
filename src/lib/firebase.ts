// Firebase initialization. Reads config from Vite env vars (VITE_FIREBASE_*).
// If env vars are missing, firebase is not initialized and `firebaseApp` is null —
// the app still works in localStorage-only mode.

import { initializeApp, type FirebaseApp } from "firebase/app"
import { getAuth, type Auth, GoogleAuthProvider } from "firebase/auth"
import { getFirestore, type Firestore } from "firebase/firestore"

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const firebaseConfigured = !!(config.apiKey && config.authDomain && config.projectId)

let firebaseApp: FirebaseApp | null = null
let authInstance: Auth | null = null
let dbInstance: Firestore | null = null

if (firebaseConfigured) {
  firebaseApp = initializeApp(config)
  authInstance = getAuth(firebaseApp)
  dbInstance = getFirestore(firebaseApp)
}

export const firebaseAuth = authInstance
export const firebaseDb = dbInstance
export const googleProvider = new GoogleAuthProvider()
