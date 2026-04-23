// Handles two-way sync of the app state blob between localStorage and Firestore.
// - On login: fetches user's doc; merges with local if local has unseen changes; writes back.
// - On local changes: debounced write to Firestore.
// - On remote changes (other device): onSnapshot updates localStorage; caller reload re-hydrates state.

import { useEffect, useRef, useState } from "react"
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "firebase/firestore"
import type { User } from "firebase/auth"
import { firebaseDb } from "./firebase"

const WRITE_DEBOUNCE_MS = 1500

export type SyncStatus = "idle" | "loading" | "syncing" | "synced" | "error" | "offline"

type Options = {
  storageKey: string
  // Called when an incoming remote snapshot replaces local data.
  // Parent should trigger a reload or re-hydrate state from localStorage.
  onRemoteApplied?: () => void
}

export function useCloudSync(user: User | null, opts: Options) {
  const { storageKey, onRemoteApplied } = opts
  const [status, setStatus] = useState<SyncStatus>("idle")
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null)
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Tracks the blob we have most recently "claimed" as ours (either just wrote, or just received).
  // onSnapshot compares against this to skip our own echoes.
  const lastKnownBlobRef = useRef<string | null>(null)

  // Subscribe to the user's doc.
  useEffect(() => {
    if (!user || !firebaseDb) {
      setStatus("idle")
      return
    }
    setStatus("loading")
    const ref = doc(firebaseDb, "users", user.uid, "app", "state")
    let unsub: (() => void) | null = null
    let cancelled = false

    // Prime with a one-shot fetch so we can do merge logic on first login
    ;(async () => {
      try {
        const snap = await getDoc(ref)
        if (cancelled) return
        const localRaw = localStorage.getItem(storageKey)
        if (!snap.exists()) {
          // No remote yet: push local up
          if (localRaw) {
            lastKnownBlobRef.current = localRaw // set BEFORE setDoc so echoes match
            await setDoc(ref, { blob: localRaw, updatedAt: serverTimestamp() })
          }
          setStatus("synced")
          setLastSyncedAt(Date.now())
        } else {
          const remoteBlob = snap.data()?.blob
          if (typeof remoteBlob === "string") {
            lastKnownBlobRef.current = remoteBlob
            if (localRaw && localRaw !== remoteBlob) {
              // Conflict: remote wins (last-write-wins). User can always re-import from backup.
              localStorage.setItem(storageKey, remoteBlob)
              onRemoteApplied?.()
            } else if (!localRaw) {
              localStorage.setItem(storageKey, remoteBlob)
              onRemoteApplied?.()
            }
          }
          setStatus("synced")
          setLastSyncedAt(Date.now())
        }
      } catch {
        if (!cancelled) setStatus("error")
      }

      if (cancelled) return
      // Subscribe to live updates (multi-device realtime)
      unsub = onSnapshot(
        ref,
        snap => {
          const remoteBlob = snap.data()?.blob
          if (typeof remoteBlob !== "string") return
          // Skip our own echoes — we already know this blob
          if (remoteBlob === lastKnownBlobRef.current) return
          // Genuine remote update from another device/tab
          lastKnownBlobRef.current = remoteBlob
          localStorage.setItem(storageKey, remoteBlob)
          onRemoteApplied?.()
          setStatus("synced")
          setLastSyncedAt(Date.now())
        },
        () => setStatus("error"),
      )
    })()

    return () => {
      cancelled = true
      if (unsub) unsub()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // Watch localStorage for changes and debounce-write to Firestore.
  // Same-tab localStorage changes don't fire "storage" events, so we poll.
  useEffect(() => {
    if (!user || !firebaseDb) return
    const ref = doc(firebaseDb, "users", user.uid, "app", "state")
    const interval = setInterval(() => {
      const current = localStorage.getItem(storageKey)
      if (!current) return
      // If current matches what we already know (either we wrote it, or we received it), skip
      if (current === lastKnownBlobRef.current) return
      // Genuine local change: mark it + schedule debounced write
      setStatus("syncing")
      if (writeTimer.current) clearTimeout(writeTimer.current)
      writeTimer.current = setTimeout(async () => {
        // Re-read in case state changed again during debounce window
        const latest = localStorage.getItem(storageKey)
        if (!latest) return
        if (latest === lastKnownBlobRef.current) {
          setStatus("synced")
          return
        }
        const before = lastKnownBlobRef.current
        lastKnownBlobRef.current = latest // set BEFORE write so onSnapshot echo matches
        try {
          await setDoc(ref, { blob: latest, updatedAt: serverTimestamp() })
          setStatus("synced")
          setLastSyncedAt(Date.now())
        } catch {
          // Roll back so next poll will retry
          lastKnownBlobRef.current = before
          setStatus("error")
        }
      }, WRITE_DEBOUNCE_MS)
    }, 500)
    return () => {
      clearInterval(interval)
      if (writeTimer.current) clearTimeout(writeTimer.current)
    }
  }, [user, storageKey])

  return { status, lastSyncedAt }
}
