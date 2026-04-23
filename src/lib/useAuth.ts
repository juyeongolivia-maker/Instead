// Hook that exposes current Firebase user + sign-in/sign-out helpers.
// If Firebase isn't configured (env vars missing), returns a no-op shell.

import { useEffect, useState } from "react"
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth"
import { firebaseAuth, firebaseConfigured, googleProvider } from "./firebase"

export type AuthState = {
  user: User | null
  loading: boolean
  configured: boolean
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  error: string | null
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(firebaseConfigured)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!firebaseAuth) {
      setLoading(false)
      return
    }
    const unsub = onAuthStateChanged(firebaseAuth, u => {
      setUser(u)
      setLoading(false)
    })
    return unsub
  }, [])

  async function signInWithGoogle() {
    if (!firebaseAuth) {
      setError("Firebase not configured")
      return
    }
    setError(null)
    try {
      await signInWithPopup(firebaseAuth, googleProvider)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed")
    }
  }

  async function signOut() {
    if (!firebaseAuth) return
    setError(null)
    try {
      await firebaseSignOut(firebaseAuth)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-out failed")
    }
  }

  return { user, loading, configured: firebaseConfigured, signInWithGoogle, signOut, error }
}
