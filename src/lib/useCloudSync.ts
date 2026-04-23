// Handles two-way sync of the app state blob between localStorage and Firestore.
// - On login: fetches user's doc; merges with local if local has unseen changes; writes back.
// - On local changes: debounced write to Firestore.
// - On remote changes (other device): onSnapshot updates localStorage; caller reload re-hydrates state.

import { useCallback, useEffect, useRef, useState } from "react"
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
  const [status, setStatusRaw] = useState<SyncStatus>("idle")
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null)
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Tracks the blob we have most recently "claimed" as ours (either just wrote, or just received).
  // onSnapshot compares against this to skip our own echoes.
  const lastKnownBlobRef = useRef<string | null>(null)
  // Rolling window of recently-written blobs so rapid successive edits don't misidentify
  // stale echo snapshots as genuine remote changes.
  const recentWrittenRef = useRef<string[]>([])
  const rememberWritten = (blob: string) => {
    recentWrittenRef.current.push(blob)
    if (recentWrittenRef.current.length > 10) recentWrittenRef.current.shift()
  }
  const wasRecentlyWritten = (blob: string) => recentWrittenRef.current.includes(blob)
  // Gate: don't allow local→remote writes until the initial getDoc has completed.
  // Otherwise the watch interval can push empty defaults to Firestore before we've
  // seen the user's real remote data, wiping it out.
  const initialSyncCompleteRef = useRef(false)
  // Keep the latest user in a ref so flush() (called from outside, e.g. before signOut)
  // can always see the current user even though it's a stable callback.
  const userRef = useRef<User | null>(user)
  userRef.current = user
  const statusRef = useRef<SyncStatus>("idle")
  // Dedupe: only actually update status if it changed
  const setStatus = (s: SyncStatus) => {
    if (statusRef.current === s) return
    statusRef.current = s
    setStatusRaw(s)
  }

  // Subscribe to the user's doc.
  useEffect(() => {
    if (!user || !firebaseDb) {
      setStatus("idle")
      initialSyncCompleteRef.current = false
      return
    }
    setStatus("loading")
    initialSyncCompleteRef.current = false
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
            // Always remember the remote blob we just fetched, so when onSnapshot fires
            // with it, we don't treat it as a "remote change" and trigger a reload loop.
            rememberWritten(remoteBlob)
            // Detect "freshly signed in" — localStorage was cleared/defaults (no real user data).
            // In that case we must pull remote, not push local up (which would wipe Firestore).
            const hasRealData = (blob: string | null) => {
              if (!blob) return false
              try {
                const parsed = JSON.parse(blob)
                const hasRecords = Array.isArray(parsed.records) && parsed.records.length > 0
                const hasGoal = !!parsed.goal
                return hasRecords || hasGoal
              } catch {
                return false
              }
            }
            const localLooksEmpty = !hasRealData(localRaw)
            const remoteHasRealData = hasRealData(remoteBlob)
            if (localLooksEmpty && remoteHasRealData && localRaw !== remoteBlob) {
              // Local is empty/defaults AND remote has meaningful user data — pull remote.
              // If remote is also empty (just settings), skip this branch: re-serialization
              // noise (e.g. krwRateAutoFetchedAt updates) would otherwise cause a reload loop.
              lastKnownBlobRef.current = remoteBlob
              localStorage.setItem(storageKey, remoteBlob)
              onRemoteApplied?.()
            } else if (localRaw === remoteBlob) {
              // Perfectly in sync (including the both-empty-identical case)
              lastKnownBlobRef.current = remoteBlob
            } else if (localRaw) {
              // Both sides have meaningful data but bytes differ — local wins to prevent
              // re-serialization loops. Debounced poll will push local up. Genuine remote
              // updates from other devices still come through onSnapshot.
              lastKnownBlobRef.current = localRaw
              rememberWritten(localRaw)
              // eslint-disable-next-line no-console
              console.log("[sync] initial conflict — local wins", {
                localLen: localRaw.length,
                remoteLen: remoteBlob.length,
              })
            }
          }
          setStatus("synced")
          setLastSyncedAt(Date.now())
        }
      } catch {
        if (!cancelled) setStatus("error")
      }

      if (cancelled) return
      // Initial sync complete — safe to allow local→remote writes now.
      initialSyncCompleteRef.current = true
      // Subscribe to live updates (multi-device realtime)
      unsub = onSnapshot(
        ref,
        snap => {
          const remoteBlob = snap.data()?.blob
          if (typeof remoteBlob !== "string") return
          // Skip echoes: matches current known, OR was recently written by us
          if (remoteBlob === lastKnownBlobRef.current || wasRecentlyWritten(remoteBlob)) {
            // eslint-disable-next-line no-console
            console.log("[sync] snapshot (echo, skipped)", { len: remoteBlob.length })
            return
          }
          // eslint-disable-next-line no-console
          console.log("[sync] remote changed — applying + reload", {
            prevLen: lastKnownBlobRef.current?.length ?? 0,
            newLen: remoteBlob.length,
          })
          // Genuine remote update from another device/tab
          lastKnownBlobRef.current = remoteBlob
          rememberWritten(remoteBlob)
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
      // Don't write until the initial getDoc has resolved. Otherwise we'd upload
      // whatever defaults React rendered before we fetched the user's real data,
      // racing the getDoc and potentially wiping their Firestore blob.
      if (!initialSyncCompleteRef.current) return
      const current = localStorage.getItem(storageKey)
      if (!current) return
      // If current matches what we already know (either we wrote it, or we received it), skip
      if (current === lastKnownBlobRef.current) return
      // Genuine local change: mark it + schedule debounced write
      // eslint-disable-next-line no-console
      console.log("[sync] local changed — scheduling write", {
        prevLen: lastKnownBlobRef.current?.length ?? 0,
        newLen: current.length,
      })
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
        rememberWritten(latest)
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

  // Immediately write any pending local change to Firestore. Call this before
  // sign-out to guarantee the user's last edit is saved (debounce would otherwise
  // be cancelled by the effect cleanup when auth.user becomes null).
  const flush = useCallback(async () => {
    const u = userRef.current
    if (!u || !firebaseDb) return
    if (!initialSyncCompleteRef.current) return
    if (writeTimer.current) {
      clearTimeout(writeTimer.current)
      writeTimer.current = null
    }
    const latest = localStorage.getItem(storageKey)
    if (!latest) return
    if (latest === lastKnownBlobRef.current) return
    const ref = doc(firebaseDb, "users", u.uid, "app", "state")
    const before = lastKnownBlobRef.current
    lastKnownBlobRef.current = latest
    rememberWritten(latest)
    try {
      await setDoc(ref, { blob: latest, updatedAt: serverTimestamp() })
      setLastSyncedAt(Date.now())
    } catch {
      lastKnownBlobRef.current = before
    }
  }, [storageKey])

  return { status, lastSyncedAt, flush }
}
