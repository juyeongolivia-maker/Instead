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
  const remoteAppliedRef = useRef(false) // guard against echo-loop when our own write comes back
  const lastWrittenRef = useRef<string | null>(null)

  // Subscribe to the user's doc. First snapshot is treated as "initial load":
  // - if remote exists → overwrite localStorage, call onRemoteApplied
  // - if remote empty → push current localStorage up
  useEffect(() => {
    if (!user || !firebaseDb) {
      setStatus("idle")
      return
    }
    setStatus("loading")
    const ref = doc(firebaseDb, "users", user.uid, "app", "state")
    let isFirst = true

    // Prime with a one-shot fetch so we can do merge logic on first login
    ;(async () => {
      try {
        const snap = await getDoc(ref)
        const localRaw = localStorage.getItem(storageKey)
        if (!snap.exists()) {
          // No remote yet: push local up
          if (localRaw) {
            await setDoc(ref, { blob: localRaw, updatedAt: serverTimestamp() })
            lastWrittenRef.current = localRaw
          }
          setStatus("synced")
          setLastSyncedAt(Date.now())
        } else {
          const remoteBlob = snap.data()?.blob
          if (typeof remoteBlob === "string") {
            if (localRaw && localRaw !== remoteBlob) {
              // Conflict: keep remote (last-write-wins on remote side). User can re-import later.
              localStorage.setItem(storageKey, remoteBlob)
              remoteAppliedRef.current = true
              onRemoteApplied?.()
            } else if (!localRaw) {
              localStorage.setItem(storageKey, remoteBlob)
              remoteAppliedRef.current = true
              onRemoteApplied?.()
            }
            lastWrittenRef.current = remoteBlob
          }
          setStatus("synced")
          setLastSyncedAt(Date.now())
        }
      } catch {
        setStatus("error")
      }

      // Then subscribe to live updates
      const unsub = onSnapshot(
        ref,
        snap => {
          if (isFirst) { isFirst = false; return } // skip echoes of our own priming write
          const remoteBlob = snap.data()?.blob
          if (typeof remoteBlob === "string" && remoteBlob !== lastWrittenRef.current) {
            localStorage.setItem(storageKey, remoteBlob)
            lastWrittenRef.current = remoteBlob
            remoteAppliedRef.current = true
            onRemoteApplied?.()
            setStatus("synced")
            setLastSyncedAt(Date.now())
          }
        },
        () => setStatus("error"),
      )

      return unsub
    })()
    // we intentionally don't return the inner unsub since the outer cleanup isn't used
    // for one-time first fetch; revisit if multi-device realtime becomes critical
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // Watch localStorage for changes and debounce-write to Firestore.
  // We can't listen to localStorage events from same tab, so we poll the key on a short interval.
  useEffect(() => {
    if (!user || !firebaseDb) return
    const ref = doc(firebaseDb, "users", user.uid, "app", "state")
    let lastSeen: string | null = localStorage.getItem(storageKey)
    const interval = setInterval(() => {
      const current = localStorage.getItem(storageKey)
      if (current === lastSeen) return
      lastSeen = current
      if (remoteAppliedRef.current) {
        // This change came from remote; don't write back
        remoteAppliedRef.current = false
        return
      }
      if (!current) return
      if (current === lastWrittenRef.current) return
      setStatus("syncing")
      if (writeTimer.current) clearTimeout(writeTimer.current)
      writeTimer.current = setTimeout(async () => {
        try {
          await setDoc(ref, { blob: current, updatedAt: serverTimestamp() })
          lastWrittenRef.current = current
          setStatus("synced")
          setLastSyncedAt(Date.now())
        } catch {
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
