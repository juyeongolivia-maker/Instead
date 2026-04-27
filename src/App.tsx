import { useState, useMemo, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Wallet, Plus, ArrowLeft, Settings, Coffee, ShoppingBag, Shirt, Utensils, Tv, ShoppingCart, UtensilsCrossed, X, ChevronLeft, ChevronRight, ChevronDown, Check, Target, Plane, Home, Car, GraduationCap, Heart, PiggyBank, LogIn, LogOut, Calendar, List, Tag, Pencil } from "lucide-react"
import { useAuth } from "@/lib/useAuth"
import { useCloudSync } from "@/lib/useCloudSync"
import type { LucideIcon } from "lucide-react"

type Currency = "USD" | "KRW"
type Lang = "en" | "ko"
type Mode = "once" | "recurring"
type FrequencyValue = "365" | "52" | "12"
type View = "list" | "calculator" | "settings"
type ThemeColor = "amber" | "blue" | "emerald" | "rose" | "violet"
type RecordItem = {
  id: string
  name: string
  usdAmt: number
  date: number
  type: Mode
  freq?: number // 1 (once) | 12 (monthly) | 52 (weekly) | 365 (daily). Legacy records: undefined → treated as 12 for recurring.
  // Recurring-only: first month this record no longer applies (exclusive).
  // Omitted = still active from start month onward.
  // endDate (timestamp, day-precision) supersedes endYear/endMonth for new records.
  // The month-level fields stay for legacy data — getEndDate() reconciles both.
  endYear?: number
  endMonth?: number // 0-11
  endDate?: number
  // "I actually moved this money" tracking. Once items use a single bool;
  // recurring items track per-month with "YYYY-MM" keys (each month is a
  // separate transfer to verify).
  verified?: boolean                                  // legacy (read-only after migration)
  verifiedMonths?: string[]                            // legacy (read-only after migration)
  // Each verified transfer carries a destination bucket: "goal" (toward the
  // active short-term goal) or "long" (long-term savings). New writes use the
  // *To fields; legacy values are read as "long" by getVerifiedDestination.
  verifiedTo?: Destination
  verifiedMonthsTo?: { [monthKey: string]: Destination }
}

type Destination = "goal" | "long"

// Effective end timestamp for a recurring record. Prefers the precise endDate;
// falls back to start-of-(endYear, endMonth) for older records that only
// captured month-level granularity. Returns undefined if the record never ends.
function getEndDate(r: RecordItem): number | undefined {
  if (typeof r.endDate === "number") return r.endDate
  if (typeof r.endYear === "number" && typeof r.endMonth === "number") {
    return new Date(r.endYear, r.endMonth, 1).getTime()
  }
  return undefined
}

function monthKey(year: number, month: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}`
}

// Returns the bucket the user moved this month's contribution into, or null
// if not verified yet. Reads the new *To fields first; falls back to the
// legacy boolean/array (treated as "long" — the safer migration default).
function getVerifiedDestination(r: RecordItem, viewYear: number, viewMonth: number): Destination | null {
  if (r.type !== "recurring") {
    if (r.verifiedTo) return r.verifiedTo
    if (r.verified) return "long"
    return null
  }
  const key = monthKey(viewYear, viewMonth)
  const fromMap = r.verifiedMonthsTo?.[key]
  if (fromMap) return fromMap
  if ((r.verifiedMonths ?? []).includes(key)) return "long"
  return null
}

type GoalIconKey = "plane" | "home" | "car" | "grad" | "heart" | "piggy" | "target"
const goalIcons: Record<GoalIconKey, LucideIcon> = {
  plane: Plane,
  home: Home,
  car: Car,
  grad: GraduationCap,
  heart: Heart,
  piggy: PiggyBank,
  target: Target,
}

type GoalType = "personal" | "shared"

type Goal = {
  id: string
  name: string
  iconKey: GoalIconKey
  targetUsd: number
  deadline?: number // timestamp, optional
  createdAt: number
  achievedAt?: number
  // Phase 1: added for future shared-goal support. All existing goals default to "personal".
  // Phase 2 will introduce memberIds/inviteToken + Firestore shared collection.
  type?: GoalType
  // Optional free-text account label (e.g. "Toss · ●●2345"). For user reference
  // only — never store full account numbers; UI nudges users to use a partial.
  account?: string
}

type CustomPreset = {
  id: string
  name: string
  usdAmt: number
  mode: Mode
  freq?: number // 365/52/12 when recurring
}

const KRW_RATE_FALLBACK = 1380
const RATE_STALE_MS = 1000 * 60 * 60 * 24 // refetch after 24h
const RATE_API_URL = "https://open.er-api.com/v6/latest/USD"
const STORAGE_KEY = "instead-react-v2"
// Prior storage keys we should migrate from on first load (oldest → kept for safety)
const LEGACY_STORAGE_KEYS = ["instead-react-v1", "instead-react"]
const SCHEMA_VERSION = 1

// Theme definitions
// primary / primaryFg: used for bg-primary / text-primary-foreground (buttons, active segments, FAB)
// highlight: used for accent numbers (gains, projections) — always readable on both light/dark bg
// dot: color swatch in settings
// CSS vars: hsl values without "hsl()" wrapper, for --primary and --primary-foreground
const themes: Record<ThemeColor, {
  label: string
  dot: string
  // CSS var values (no hsl() wrapper)
  primaryHsl: string        // e.g. "38 92% 50%"
  primaryFgHsl: string      // e.g. "0 0% 0%"  (text on top of primary bg)
  // Tailwind classes for accent text (numbers like gain, projections)
  textAccent: string        // e.g. "text-amber-600 dark:text-amber-400"
}> = {
  amber:   { label: "Amber",   dot: "bg-amber-400",   primaryHsl: "38 92% 50%",  primaryFgHsl: "0 0% 0%",    textAccent: "text-amber-600 dark:text-amber-400" },
  blue:    { label: "Blue",    dot: "bg-blue-500",     primaryHsl: "217 91% 50%", primaryFgHsl: "0 0% 100%",  textAccent: "text-blue-600 dark:text-blue-400" },
  emerald: { label: "Emerald", dot: "bg-emerald-500",  primaryHsl: "160 84% 35%", primaryFgHsl: "0 0% 100%",  textAccent: "text-emerald-600 dark:text-emerald-400" },
  rose:    { label: "Rose",    dot: "bg-rose-500",     primaryHsl: "346 77% 52%", primaryFgHsl: "0 0% 100%",  textAccent: "text-rose-600 dark:text-rose-400" },
  violet:  { label: "Violet",  dot: "bg-violet-500",   primaryHsl: "258 90% 58%", primaryFgHsl: "0 0% 100%",  textAccent: "text-violet-600 dark:text-violet-400" },
}

const i18n = {
  en: {
    appName: "Instead",
    oneTime: "Once",
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly",
    itemPlaceholder: "e.g. the bag I wanted",
    amountUSD: "Amount ($)",
    amountKRW: "Amount (₩)",
    annualReturn: "Return %",
    investmentPeriod: "Investment period",
    years: "years",
    futureValueIn: "Future value in",
    gain: "Gain",
    principal: "Principal",
    totalContributed: "total contributed",
    after10: "After 10Y",
    after20: "After 20Y",
    saveRecord: "Save",
    saved: "Saved!",
    totalSaved: "Total saved",
    thisMonth: "This month",
    projected20: "Projected in 20 years",
    noRecords: "No savings yet.\nTap + to add your first one.",
    deleteAll: "Delete all records",
    confirmDeleteAll: "Delete all records?",
    unnamed: "Unnamed saving",
    after20Label: "After 20Y",
    note: "Invested at ~{rate}%/yr, compounding annually. Simulation only.",
    language: "Language",
    currency: "Currency",
    appearance: "Appearance",
    darkMode: "Dark mode",
    theme: "Theme color",
    settings: "Settings",
    presets: {
      coffee: "Coffee",
      bag: "Bag",
      clothes: "Clothes",
      delivery: "Delivery",
      subscription: "Subscription",
      impulse: "Impulse",
      dining: "Dining Out",
    },
  },
  ko: {
    appName: "Instead",
    oneTime: "한 번",
    daily: "매일",
    weekly: "매주",
    monthly: "매월",
    itemPlaceholder: "예: 사고 싶었던 가방",
    amountUSD: "금액 ($)",
    amountKRW: "금액 (₩)",
    annualReturn: "수익률 %",
    investmentPeriod: "투자 기간",
    years: "년",
    futureValueIn: "",
    gain: "수익",
    principal: "원금",
    totalContributed: "총 납입",
    after10: "10년 후",
    after20: "20년 후",
    saveRecord: "저장",
    saved: "저장 완료!",
    totalSaved: "총 절약액",
    thisMonth: "이번 달",
    projected20: "20년 후 예상",
    noRecords: "아직 기록이 없어요.\n+ 버튼으로 첫 절약을 추가해보세요.",
    deleteAll: "모든 기록 삭제",
    confirmDeleteAll: "모든 기록을 삭제할까요?",
    unnamed: "이름 없는 절약",
    after20Label: "20년 후",
    note: "연 {rate}% 복리로 투자했을 때의 시뮬레이션입니다.",
    language: "언어",
    currency: "통화",
    appearance: "화면",
    darkMode: "다크 모드",
    theme: "테마 색상",
    settings: "설정",
    presets: {
      coffee: "커피",
      bag: "가방",
      clothes: "옷",
      delivery: "배달",
      subscription: "구독",
      impulse: "충동구매",
      dining: "외식",
    },
  },
} as const

// defaultMode/defaultFreq drive auto-selection when a preset chip is tapped.
// "once" → one-time purchase; "recurring" + freq sets daily(365)/weekly(52)/monthly(12).
const presetItems: {
  key: "coffee" | "bag" | "clothes" | "delivery" | "subscription" | "impulse" | "dining"
  Icon: LucideIcon
  usd: number
  defaultMode: Mode
  defaultFreq?: FrequencyValue
}[] = [
  // Ordered by expected usage frequency — the everyday skips come first so the
  // most-tapped chips are the closest to the name field, and the rarer big-ticket
  // items trail at the end where they're easier to ignore.
  { key: "coffee", Icon: Coffee, usd: 7, defaultMode: "once" },
  { key: "dining", Icon: UtensilsCrossed, usd: 60, defaultMode: "once" },
  { key: "delivery", Icon: Utensils, usd: 25, defaultMode: "once" },
  { key: "subscription", Icon: Tv, usd: 15, defaultMode: "recurring", defaultFreq: "12" },
  { key: "impulse", Icon: ShoppingCart, usd: 50, defaultMode: "once" },
  { key: "bag", Icon: ShoppingBag, usd: 800, defaultMode: "once" },
  { key: "clothes", Icon: Shirt, usd: 150, defaultMode: "once" },
]

function fvLump(p: number, r: number, y: number) {
  return p * Math.pow(1 + r / 100, y)
}

// Calendar-based contribution of a recurring item for a specific month.
// Prorates the START month for daily/weekly items (counts only from start date to month-end).
// - once: not called (once items handled separately)
// - monthly (freq=12): full usdAmt regardless of start day (monthly is atomic per month)
// - weekly  (freq=52): usdAmt × (activeDays / 7)
// - daily   (freq=365): usdAmt × activeDays
// activeDays = (in start month) daysInMonth - startDay + 1, else full daysInMonth
function contributionForMonth(usdAmt: number, freq: number, startTs: number, year: number, month: number, endTs?: number) {
  // Monthly: atomic per month — active iff the month's first day is before endTs.
  if (freq === 12) {
    if (endTs !== undefined && new Date(year, month, 1).getTime() >= endTs) return 0
    return usdAmt
  }
  const startDate = new Date(startTs)
  const sy = startDate.getFullYear()
  const sm = startDate.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const isStartMonth = sy === year && sm === month
  let activeDays = isStartMonth
    ? Math.max(0, daysInMonth - startDate.getDate() + 1)
    : daysInMonth
  // If endTs falls inside this month, only count days strictly before endTs.
  if (endTs !== undefined) {
    const endDate = new Date(endTs)
    const ey = endDate.getFullYear()
    const em = endDate.getMonth()
    if (ey * 12 + em < year * 12 + month) {
      activeDays = 0
    } else if (ey === year && em === month) {
      const firstActive = isStartMonth ? startDate.getDate() : 1
      const lastActive = endDate.getDate() - 1 // exclusive of endDate itself
      activeDays = Math.max(0, lastActive - firstActive + 1)
    }
  }
  if (freq === 52) return usdAmt * (activeDays / 7)
  if (freq === 365) return usdAmt * activeDays
  return usdAmt * (freq / 12) // defensive fallback
}
function fvRecurring(perYear: number, r: number, y: number, freq: number) {
  const rp = r / 100 / freq
  const n = y * freq
  const pmt = perYear / freq
  if (rp === 0) return pmt * n
  return pmt * ((Math.pow(1 + rp, n) - 1) / rp)
}

export default function App() {
  const [lang, setLang] = useState<Lang>("en")
  const [currency, setCurrency] = useState<Currency>("USD")
  const [mode, setMode] = useState<Mode>("once")
  const [isDark, setIsDark] = useState(false)
  const [themeColor, setThemeColor] = useState<ThemeColor>("amber")
  const [itemName, setItemName] = useState("")
  const [amount, setAmount] = useState("7")
  const [rate, setRate] = useState("10")
  const [frequency, setFrequency] = useState<FrequencyValue>("52")
  const [years, setYears] = useState(10)
  const [records, setRecords] = useState<RecordItem[]>([])
  const [saveFlash, setSaveFlash] = useState(false)
  const [view, setView] = useState<View>("list")
  const [editingRecord, setEditingRecord] = useState<RecordItem | null>(null)
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date()
    return { year: d.getFullYear(), month: d.getMonth() }
  })
  // Toggle between list and calendar layout for the month view
  const [monthViewMode, setMonthViewMode] = useState<"list" | "calendar">("list")
  // Which day is expanded in the calendar. null = show month summary.
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  // User-defined preset chips that sit alongside the built-in ones on the add screen.
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>([])
  // Category editor modal state. If editingCategory is set we're editing that one;
  // otherwise the modal is in "add new" mode.
  const [categoryEditorOpen, setCategoryEditorOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<CustomPreset | null>(null)
  // Goal detail modal — read-only progress + per-record contribution breakdown.
  // Edit happens via a button inside this detail modal so a casual tap on the
  // goal card no longer drops users into a write-mode form.
  const [goalDetailOpen, setGoalDetailOpen] = useState(false)
  // Delete-confirmation modal — for recurring records the user picks the cutoff
  // date so weekly/daily records stop at the right occurrence, not just the
  // start of a month.
  const [deletingRecord, setDeletingRecord] = useState<RecordItem | null>(null)
  // Verify destination modal — opens when the user toggles a transfer ON and
  // a short-term goal exists, so they can pick whether the money went to the
  // goal or to long-term savings.
  const [verifyingRecord, setVerifyingRecord] = useState<RecordItem | null>(null)
  // Free-text label for the long-term savings account (e.g. "Wealthfront · ●●1234").
  // Stored alongside other app state in the save blob so it syncs across devices.
  const [longTermAccount, setLongTermAccount] = useState<string>("")
  // Whether the long-term account editor modal is open.
  const [longTermAccountEditorOpen, setLongTermAccountEditorOpen] = useState(false)
  // Single-select horizon, kept as a 1-element array so downstream .map() code keeps
  // rendering a single column without a broader refactor.
  const [horizons, setHorizons] = useState<number[]>([10])
  const [examplesDismissed, setExamplesDismissed] = useState(false)
  const [horizonMenuOpen, setHorizonMenuOpen] = useState(false)
  const [goal, setGoal] = useState<Goal | null>(null)
  const [goalEditorOpen, setGoalEditorOpen] = useState(false)
  const [goalTargetInvalid, setGoalTargetInvalid] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  // Auth + cloud sync (status not surfaced in UI; syncing runs silently)
  const auth = useAuth()
  const { flush: flushCloudSync } = useCloudSync(auth.user, {
    storageKey: STORAGE_KEY,
    onRemoteApplied: () => {
      // Remote state replaced localStorage; reload so every useState re-hydrates from it
      window.location.reload()
    },
  })
  // Reset validation state whenever the goal editor closes
  useEffect(() => {
    if (!goalEditorOpen && goalTargetInvalid) setGoalTargetInvalid(false)
  }, [goalEditorOpen, goalTargetInvalid])
  // Exchange rate (USD → KRW)
  const [krwRateSource, setKrwRateSource] = useState<"auto" | "manual">("auto")
  const [krwRateManual, setKrwRateManual] = useState<number>(KRW_RATE_FALLBACK)
  const [krwRateAuto, setKrwRateAuto] = useState<number | null>(null)
  const [krwRateAutoFetchedAt, setKrwRateAutoFetchedAt] = useState<number | null>(null)
  const [krwRateFetching, setKrwRateFetching] = useState(false)
  const [krwRateError, setKrwRateError] = useState<string | null>(null)
  // Effective rate: when auto and we have a fetched value, use it; otherwise fall back to manual
  const krwRate = krwRateSource === "manual"
    ? krwRateManual
    : (krwRateAuto ?? krwRateManual)

  const t = i18n[lang]
  const theme = themes[themeColor]

  // Gate the save effect: don't overwrite localStorage until initial load has finished.
  // Otherwise the mount-time save (with default empty state) clobbers whatever load/sync just set.
  const [hydrated, setHydrated] = useState(false)

  // Load from localStorage (with migration from legacy keys)
  useEffect(() => {
    let raw = localStorage.getItem(STORAGE_KEY)
    // If current key is empty, try to migrate from any legacy key
    if (!raw) {
      for (const legacyKey of LEGACY_STORAGE_KEYS) {
        const legacy = localStorage.getItem(legacyKey)
        if (legacy) {
          raw = legacy
          // Copy forward; remove legacy to avoid duplicate
          localStorage.setItem(STORAGE_KEY, legacy)
          localStorage.removeItem(legacyKey)
          break
        }
      }
    }
    if (!raw) {
      setHydrated(true)
      return
    }
    try {
      const p = JSON.parse(raw)
      if (p.lang) setLang(p.lang)
      if (p.currency) setCurrency(p.currency)
      if (p.mode) setMode(p.mode)
      if (typeof p.isDark === "boolean") setIsDark(p.isDark)
      if (p.themeColor && themes[p.themeColor as ThemeColor]) setThemeColor(p.themeColor)
      if (p.itemName) setItemName(p.itemName)
      if (p.amount) setAmount(p.amount)
      if (p.rate) setRate(p.rate)
      if (p.frequency) setFrequency(p.frequency)
      if (p.years) setYears(p.years)
      if (Array.isArray(p.records)) setRecords(p.records)
      if (Array.isArray(p.horizons) && p.horizons.every((n: unknown) => typeof n === "number") && p.horizons.length > 0) {
        // Migrate legacy multi-select saves down to a single horizon.
        setHorizons([p.horizons[0] as number])
      }
      if (Array.isArray(p.customPresets)) {
        const valid = p.customPresets
          .filter((c: unknown): c is Record<string, unknown> =>
            !!c && typeof c === "object"
            && typeof (c as Record<string, unknown>).id === "string"
            && typeof (c as Record<string, unknown>).name === "string"
            && typeof (c as Record<string, unknown>).usdAmt === "number")
          .map((c: Record<string, unknown>): CustomPreset => ({
            id: c.id as string,
            name: c.name as string,
            usdAmt: c.usdAmt as number,
            mode: c.mode === "recurring" ? "recurring" : "once",
            freq: typeof c.freq === "number" ? c.freq : undefined,
          }))
        setCustomPresets(valid)
      }
      if (typeof p.longTermAccount === "string") setLongTermAccount(p.longTermAccount)
      if (typeof p.examplesDismissed === "boolean") setExamplesDismissed(p.examplesDismissed)
      if (p.goal && typeof p.goal === "object" && typeof p.goal.targetUsd === "number") {
        // Validate iconKey, default to target if unknown
        const icon = (p.goal.iconKey && goalIcons[p.goal.iconKey as GoalIconKey]) ? p.goal.iconKey : "target"
        // Migrate legacy goals missing `type` → default to personal
        const goalType: GoalType = p.goal.type === "shared" ? "shared" : "personal"
        setGoal({ ...p.goal, iconKey: icon, type: goalType })
      }
      if (p.krwRateSource === "manual" || p.krwRateSource === "auto") setKrwRateSource(p.krwRateSource)
      if (typeof p.krwRateManual === "number" && p.krwRateManual > 0) setKrwRateManual(p.krwRateManual)
      if (typeof p.krwRateAuto === "number" && p.krwRateAuto > 0) setKrwRateAuto(p.krwRateAuto)
      if (typeof p.krwRateAutoFetchedAt === "number") setKrwRateAutoFetchedAt(p.krwRateAutoFetchedAt)
    } catch { /* ignore */ }
    setHydrated(true)
  }, [])

  // Save to localStorage (only after hydration AND only when signed in if auth is configured).
  // Prevents (a) initial-mount defaults from clobbering loaded data, and (b) anonymous/signed-out
  // state from being pushed up to Firestore after the user signs in.
  useEffect(() => {
    if (!hydrated) return
    if (auth.configured && !auth.user) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      lang, currency, mode, isDark, themeColor, itemName, amount, rate, frequency, years, records, horizons, examplesDismissed, goal, customPresets, longTermAccount,
      krwRateSource, krwRateManual, krwRateAuto, krwRateAutoFetchedAt,
    }))
  }, [hydrated, auth.configured, auth.user, lang, currency, mode, isDark, themeColor, itemName, amount, rate, frequency, years, records, horizons, examplesDismissed, goal, customPresets, longTermAccount, krwRateSource, krwRateManual, krwRateAuto, krwRateAutoFetchedAt])

  // When Firebase is configured and user is signed out, ensure localStorage stays clean so that
  // the next sign-in pulls fresh data from Firestore instead of pushing stale local state up.
  useEffect(() => {
    if (auth.configured && !auth.loading && !auth.user) {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [auth.configured, auth.loading, auth.user])

  // Dark mode
  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark)
  }, [isDark])

  // Apply theme color as CSS custom properties
  useEffect(() => {
    const existing = document.getElementById("theme-override")
    if (existing) existing.remove()
    const style = document.createElement("style")
    style.id = "theme-override"
    style.textContent = `
      :root {
        --primary: ${theme.primaryHsl};
        --primary-foreground: ${theme.primaryFgHsl};
      }
      .dark {
        --primary: ${theme.primaryHsl};
        --primary-foreground: ${theme.primaryFgHsl};
      }
    `
    document.head.appendChild(style)
  }, [themeColor])

  const calc = useMemo(() => {
    const rawAmt = parseFloat(amount) || 0
    const usdAmt = currency === "KRW" ? rawAmt / krwRate : rawAmt
    const r = parseFloat(rate) || 0
    const freq = parseFloat(frequency)

    let fv10 = 0, fv20 = 0, fvMain = 0, principal = 0

    if (mode === "once") {
      fv10 = fvLump(usdAmt, r, 10)
      fv20 = fvLump(usdAmt, r, 20)
      fvMain = fvLump(usdAmt, r, years)
      principal = usdAmt
    } else {
      const annual = usdAmt * freq
      fv10 = fvRecurring(annual, r, 10, freq)
      fv20 = fvRecurring(annual, r, 20, freq)
      fvMain = fvRecurring(annual, r, years, freq)
      principal = annual * years
    }
    return { usdAmt, principal, gain: fvMain - principal, fvMain, fv10, fv20 }
  }, [amount, currency, rate, frequency, years, mode])

  const historySummary = useMemo(() => {
    const r = parseFloat(rate) || 10
    // Compare year-month tuples. Returns <0 if a<b, 0 if equal, >0 if a>b.
    const cmpYM = (ay: number, am: number, by: number, bm: number) =>
      (ay - by) || (am - bm)
    // Include: once items only in their exact creation month;
    // recurring items in every month from start (inclusive) until endMonth (exclusive, if set).
    const scoped = records.filter(item => {
      const d = new Date(item.date)
      const sy = d.getFullYear(), sm = d.getMonth()
      if (item.type !== "recurring") {
        return sy === viewMonth.year && sm === viewMonth.month
      }
      // Before start?
      if (cmpYM(viewMonth.year, viewMonth.month, sy, sm) < 0) return false
      // At/after end? Include the month if any active day still falls before endDate.
      const endTs = getEndDate(item)
      if (endTs !== undefined) {
        const monthFirstTs = new Date(viewMonth.year, viewMonth.month, 1).getTime()
        if (monthFirstTs >= endTs) return false
      }
      return true
    })
    let monthSaved = 0
    let monthSavedVerified = 0
    const horizonSums: Record<number, number> = {}
    const horizonSumsVerified: Record<number, number> = {}
    horizons.forEach(h => { horizonSums[h] = 0; horizonSumsVerified[h] = 0 })
    // Sort: by frequency rank primary (monthly→weekly→daily→once, so the heavier
    // monthly amounts lead for visual balance), then amount desc within each group
    // so bigger items float to the top. Date desc only as a final tiebreaker.
    const freqRank = (item: RecordItem) => {
      if (item.type !== "recurring") return 3
      if (item.freq === 12) return 0
      if (item.freq === 52) return 1
      return 2 // freq 365 daily
    }
    const enriched = [...scoped].sort((a, b) => {
      const fd = freqRank(a) - freqRank(b)
      if (fd !== 0) return fd
      const ad = b.usdAmt - a.usdAmt
      if (ad !== 0) return ad
      return b.date - a.date
    }).map(item => {
      // Legacy recurring records without freq default to monthly (12)
      const isRecurring = item.type === "recurring"
      const freq = item.freq ?? (isRecurring ? 12 : 1)
      // Calendar-based monthly amount with start-date proration for daily/weekly.
      // e.g. $25/wk registered Apr 18 → April counts Apr 18–30 (13 days), May onward counts full month.
      const monthAmt = isRecurring
        ? contributionForMonth(item.usdAmt, freq, item.date, viewMonth.year, viewMonth.month, getEndDate(item))
        : item.usdAmt
      const fvByHorizon: Record<number, number> = {}
      const fvRecurringByHorizon: Record<number, number> = {}
      const destination = getVerifiedDestination(item, viewMonth.year, viewMonth.month)
      const verified = destination !== null
      horizons.forEach(h => {
        fvByHorizon[h] = fvLump(monthAmt, r, h)
        if (isRecurring) {
          const annual = item.usdAmt * freq
          fvRecurringByHorizon[h] = fvRecurring(annual, r, h, freq)
        }
        // Totals sum the "headline" number of each row: recurring → full stream FV,
        // once → one-time lump FV. Matches the single value now shown per row.
        const headline = isRecurring ? fvRecurringByHorizon[h] : fvByHorizon[h]
        horizonSums[h] += headline
        if (verified) horizonSumsVerified[h] += headline
      })
      monthSaved += monthAmt
      if (verified) monthSavedVerified += monthAmt
      return { ...item, fvByHorizon, fvRecurringByHorizon, isRecurring, freq, monthAmt, verified, destination }
    })
    return { enriched, monthSaved, monthSavedVerified, horizonSums, horizonSumsVerified }
  }, [records, rate, viewMonth, horizons])

  // Two totals for goal progress:
  // - totalSaved: actually accumulated through the current calendar month (solid progress)
  // - projectedByDeadline: totalSaved + committed contributions of active recurrings through deadline (ghost projection)
  // Once items only count when their date ≤ horizon. Recurring items contribute monthAmt × active-months in [start, min(end, horizon+1)).
  const savingsSummary = useMemo(() => {
    const now = new Date()
    const currentAbs = now.getFullYear() * 12 + now.getMonth()
    // Last contributing month: a month counts if its first day precedes the deadline.
    // e.g. deadline Sep 1 → last = Aug. Deadline Sep 30 → last = Sep. Deadline Sep 1 exactly → Aug.
    let lastMonthAbs = currentAbs
    if (goal?.deadline) {
      const dl = new Date(goal.deadline)
      const dlMonthAbs = dl.getFullYear() * 12 + dl.getMonth()
      lastMonthAbs = dl.getDate() === 1 ? dlMonthAbs - 1 : dlMonthAbs
    }
    // If deadline has already passed, projection and actual converge
    const horizonAbs = Math.max(currentAbs, lastMonthAbs)
    const sumThrough = (throughAbsInclusive: number) => {
      let total = 0
      records.forEach(item => {
        const d = new Date(item.date)
        const startAbs = d.getFullYear() * 12 + d.getMonth()
        const isRecurring = item.type === "recurring"
        const freq = item.freq ?? (isRecurring ? 12 : 1)
        if (!isRecurring) {
          if (startAbs <= throughAbsInclusive) total += item.usdAmt
          return
        }
        const endTs = getEndDate(item)
        // Months whose first day is before endTs are still candidates for contribution.
        // contributionForMonth itself prorates the partial end month.
        const endAbsExclusive = endTs !== undefined
          ? (() => {
            const e = new Date(endTs)
            const eAbs = e.getFullYear() * 12 + e.getMonth()
            return e.getDate() === 1 ? eAbs : eAbs + 1
          })()
          : throughAbsInclusive + 1
        const cap = Math.min(endAbsExclusive, throughAbsInclusive + 1)
        for (let abs = startAbs; abs < cap; abs++) {
          const y = Math.floor(abs / 12)
          const m = abs % 12
          total += contributionForMonth(item.usdAmt, freq, item.date, y, m, endTs)
        }
      })
      return total
    }
    const totalSaved = sumThrough(currentAbs)
    const projectedByDeadline = goal?.deadline ? sumThrough(horizonAbs) : totalSaved
    return { totalSaved, projectedByDeadline }
  }, [records, goal])
  const totalSaved = savingsSummary.totalSaved
  const projectedByDeadline = savingsSummary.projectedByDeadline

  // Actual balances by destination — sums the months/items the user has
  // explicitly verified as moved to each bucket. These are "real" numbers
  // (only counts confirmed transfers), distinct from totalSaved which counts
  // every record regardless of verification.
  const verifiedBalances = useMemo(() => {
    const r = parseFloat(rate) || 10
    void r // not used here; kept for parity with other useMemos that depend on rate
    let goalBalance = 0
    let longBalance = 0
    records.forEach(item => {
      const isRecurring = item.type === "recurring"
      const freq = item.freq ?? (isRecurring ? 12 : 1)
      if (!isRecurring) {
        const dest = item.verifiedTo ?? (item.verified ? "long" : null)
        if (dest === "goal") goalBalance += item.usdAmt
        else if (dest === "long") longBalance += item.usdAmt
        return
      }
      // Recurring: iterate every month the user has marked, sum that month's
      // contribution into the right bucket.
      const seen = new Set<string>()
      const map = item.verifiedMonthsTo ?? {}
      Object.entries(map).forEach(([key, dest]) => {
        seen.add(key)
        const [y, m] = key.split("-").map(Number)
        const amt = contributionForMonth(item.usdAmt, freq, item.date, y, m - 1, getEndDate(item))
        if (dest === "goal") goalBalance += amt
        else if (dest === "long") longBalance += amt
      })
      // Legacy verifiedMonths array (no destination) → treat as "long"
      ;(item.verifiedMonths ?? []).forEach(key => {
        if (seen.has(key)) return
        const [y, m] = key.split("-").map(Number)
        const amt = contributionForMonth(item.usdAmt, freq, item.date, y, m - 1, getEndDate(item))
        longBalance += amt
      })
    })
    return { goalBalance, longBalance }
  }, [records, rate])

  // Per-record contribution to the current goal. Mirrors sumThrough's logic but
  // tallies per item so the goal-detail modal can list which records contribute
  // most. Splits actual (already-saved) from committed (still-to-come this period).
  const goalContributions = useMemo(() => {
    if (!goal) return [] as { record: RecordItem; actual: number; committed: number; total: number }[]
    const now = new Date()
    const currentAbs = now.getFullYear() * 12 + now.getMonth()
    let lastMonthAbs = currentAbs
    if (goal.deadline) {
      const dl = new Date(goal.deadline)
      const dlMonthAbs = dl.getFullYear() * 12 + dl.getMonth()
      lastMonthAbs = dl.getDate() === 1 ? dlMonthAbs - 1 : dlMonthAbs
    }
    const horizonAbs = Math.max(currentAbs, lastMonthAbs)
    const out = records.map(item => {
      const d = new Date(item.date)
      const startAbs = d.getFullYear() * 12 + d.getMonth()
      const isRecurring = item.type === "recurring"
      const freq = item.freq ?? (isRecurring ? 12 : 1)
      let actual = 0
      let committed = 0
      if (!isRecurring) {
        if (startAbs <= currentAbs) actual = item.usdAmt
        else if (startAbs <= horizonAbs) committed = item.usdAmt
      } else {
        const endTs = getEndDate(item)
        const endAbsExclusive = endTs !== undefined
          ? (() => {
            const e = new Date(endTs)
            const eAbs = e.getFullYear() * 12 + e.getMonth()
            return e.getDate() === 1 ? eAbs : eAbs + 1
          })()
          : horizonAbs + 1
        const cap = Math.min(endAbsExclusive, horizonAbs + 1)
        for (let abs = startAbs; abs < cap; abs++) {
          const y = Math.floor(abs / 12)
          const m = abs % 12
          const c = contributionForMonth(item.usdAmt, freq, item.date, y, m, endTs)
          if (abs <= currentAbs) actual += c
          else committed += c
        }
      }
      return { record: item, actual, committed, total: actual + committed }
    }).filter(r => r.total > 0)
    // Match the main list's grouping: monthly → weekly → daily → once,
    // then by contribution amount desc within each group.
    const freqRank = (r: RecordItem) => {
      if (r.type !== "recurring") return 3
      if (r.freq === 12) return 0
      if (r.freq === 52) return 1
      return 2
    }
    out.sort((a, b) => {
      const fd = freqRank(a.record) - freqRank(b.record)
      if (fd !== 0) return fd
      return b.total - a.total
    })
    return out
  }, [records, goal])

  // Monthly savings series from the first record's month through the current month.
  // Feeds the cumulative chart: bars = that month's saving, area = running total.
  const monthlySeries = useMemo(() => {
    if (records.length === 0) return [] as { year: number; month: number; saved: number; cumulative: number }[]
    let firstAbs = Infinity
    records.forEach(r => {
      const d = new Date(r.date)
      const abs = d.getFullYear() * 12 + d.getMonth()
      if (abs < firstAbs) firstAbs = abs
    })
    const now = new Date()
    const endAbs = now.getFullYear() * 12 + now.getMonth()
    if (firstAbs === Infinity || firstAbs > endAbs) return []
    const out: { year: number; month: number; saved: number; cumulative: number }[] = []
    let cum = 0
    for (let abs = firstAbs; abs <= endAbs; abs++) {
      const y = Math.floor(abs / 12)
      const m = abs % 12
      let saved = 0
      records.forEach(rec => {
        const d = new Date(rec.date)
        const sy = d.getFullYear(), sm = d.getMonth()
        const sabs = sy * 12 + sm
        if (rec.type !== "recurring") {
          if (sy === y && sm === m) saved += rec.usdAmt
          return
        }
        if (abs < sabs) return
        const endTs = getEndDate(rec)
        if (endTs !== undefined && new Date(y, m, 1).getTime() >= endTs) return
        const freq = rec.freq ?? 12
        saved += contributionForMonth(rec.usdAmt, freq, rec.date, y, m, endTs)
      })
      cum += saved
      out.push({ year: y, month: m, saved, cumulative: cum })
    }
    return out
  }, [records])

  function fmt(usd: number) {
    if (currency === "KRW") {
      const won = Math.round(usd * krwRate)
      // Switch to 억 at 1000만 (=0.1억) so values never grow past 3 digits in front
      // of the 만/억 suffix — keeps them inside the narrow 30Y / Now columns.
      if (won >= 10000000) return `₩${(won / 100000000).toFixed(1)}억`
      if (won >= 10000) return `₩${Math.round(won / 10000)}만`
      return `₩${won.toLocaleString("ko-KR")}`
    }
    // Keep a single decimal for 1k-10k (enough to differentiate $1.2k from $1.8k),
    // drop it above 10k where the extra digit is just noise.
    if (usd >= 1000000) return `$${(usd / 1000000).toFixed(1)}M`
    if (usd >= 10000) return `$${Math.round(usd / 1000)}K`
    if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}K`
    return `$${Math.round(usd).toLocaleString("en-US")}`
  }


  function handleCurrencyChange(next: Currency) {
    if (next === currency) return
    const cur = parseFloat(amount) || 0
    if (next === "KRW") setAmount(String(cur < 10000 ? Math.round(cur * krwRate / 1000) * 1000 : cur))
    else setAmount(cur > 1000 ? (cur / krwRate).toFixed(2) : String(cur))
    setCurrency(next)
  }

  function saveRecord() {
    if (calc.usdAmt <= 0) return
    // When adding from a non-current month view, anchor the record to the 1st of
    // that month so it lands in the user's current context instead of "today".
    const now = new Date()
    const onCurrent = viewMonth.year === now.getFullYear() && viewMonth.month === now.getMonth()
    const ts = onCurrent ? Date.now() : new Date(viewMonth.year, viewMonth.month, 1, 12).getTime()
    setRecords(prev => [{
      id: crypto.randomUUID(),
      name: itemName.trim() || t.unnamed,
      usdAmt: calc.usdAmt,
      date: ts,
      type: mode,
      freq: mode === "recurring" ? (parseFloat(frequency) || 12) : 1,
    }, ...prev])
    setSaveFlash(true)
    setTimeout(() => {
      setSaveFlash(false)
      setView("list")
    }, 800)
  }

  // Set (or clear) the destination for this record's transfer in the current
  // viewMonth. dest=null clears the verification. Cleans up legacy fields so
  // they don't shadow the new map-based storage.
  function setRecordDestination(id: string, dest: Destination | null) {
    setRecords(prev => prev.map(r => {
      if (r.id !== id) return r
      if (r.type !== "recurring") {
        return {
          ...r,
          verifiedTo: dest ?? undefined,
          verified: undefined, // drop legacy
        }
      }
      const key = monthKey(viewMonth.year, viewMonth.month)
      const map = { ...(r.verifiedMonthsTo ?? {}) }
      if (dest) map[key] = dest
      else delete map[key]
      const cleanedLegacy = (r.verifiedMonths ?? []).filter(k => k !== key)
      return { ...r, verifiedMonthsTo: map, verifiedMonths: cleanedLegacy }
    }))
  }

  // Stop a recurring record from a chosen day onward. Past contributions remain
  // counted; the day itself and everything after are excluded. Wipes the legacy
  // month-level fields so they don't fight with the new endDate.
  function endRecordAt(id: string, endTs: number) {
    setRecords(prev => prev.map(r =>
      r.id === id ? { ...r, endDate: endTs, endYear: undefined, endMonth: undefined } : r
    ))
  }

  // Resume a stopped recurring record — clears endDate so contributions count
  // again from now on (and retroactively over the stopped gap).
  function resumeRecord(id: string) {
    setRecords(prev => prev.map(r =>
      r.id === id ? { ...r, endDate: undefined, endYear: undefined, endMonth: undefined } : r
    ))
  }

  // Remove the record entirely — past contributions disappear too. Used for
  // "I made this by mistake" cases or for once-type records.
  function removeRecordCompletely(id: string) {
    setRecords(prev => prev.filter(r => r.id !== id))
  }

  function updateRecord(id: string, name: string, usdAmt?: number, mode?: Mode, freq?: number, date?: number) {
    setRecords(prev => prev.map(r => {
      if (r.id !== id) return r
      const nextAmt = usdAmt !== undefined && usdAmt > 0 ? usdAmt : r.usdAmt
      const nextType = mode ?? r.type
      // freq: 1 for once, 365/52/12 for daily/weekly/monthly
      const nextFreq = nextType === "once" ? 1 : (freq ?? r.freq ?? 12)
      const nextDate = typeof date === "number" && Number.isFinite(date) ? date : r.date
      return { ...r, name, usdAmt: nextAmt, type: nextType, freq: nextFreq, date: nextDate }
    }))
    setEditingRecord(null)
  }

  function clearAll() {
    if (window.confirm(t.confirmDeleteAll)) setRecords([])
  }

  function exportData() {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const blob = new Blob([raw], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    const date = new Date().toISOString().slice(0, 10)
    a.download = `instead-backup-${date}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function importData(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text = String(reader.result)
        const p = JSON.parse(text)
        if (typeof p !== "object" || p === null) throw new Error("invalid")
        // Overwrite storage and reload to re-hydrate every state
        if (!window.confirm(lang === "ko"
          ? "기존 데이터를 백업 파일로 교체할까요?"
          : "Replace existing data with backup?")) return
        localStorage.setItem(STORAGE_KEY, text)
        window.location.reload()
      } catch {
        window.alert(lang === "ko" ? "파일을 읽을 수 없어요 (JSON 확인)" : "Couldn't read file (check JSON)")
      }
    }
    reader.readAsText(file)
  }

  function saveGoal(input: { name: string; iconKey: GoalIconKey; targetUsd: number; deadline?: number; type: GoalType; account?: string }) {
    setGoal(prev => {
      if (prev) {
        return { ...prev, ...input, achievedAt: undefined }
      }
      return {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        ...input,
      }
    })
    setGoalEditorOpen(false)
  }

  function deleteGoal() {
    setGoal(null)
    setGoalEditorOpen(false)
  }

  // Fetch USD→KRW from a free API. Called on auto-refresh + manual refresh.
  async function fetchKrwRate() {
    setKrwRateFetching(true)
    setKrwRateError(null)
    try {
      const resp = await fetch(RATE_API_URL)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json()
      const rate = data?.rates?.KRW
      if (typeof rate !== "number" || rate <= 0) throw new Error("Invalid rate")
      setKrwRateAuto(rate)
      setKrwRateAutoFetchedAt(Date.now())
    } catch (e) {
      setKrwRateError(e instanceof Error ? e.message : "fetch failed")
    } finally {
      setKrwRateFetching(false)
    }
  }

  // On mount (and whenever source flips back to auto), fetch if stale or empty
  useEffect(() => {
    if (krwRateSource !== "auto") return
    const stale = !krwRateAutoFetchedAt || (Date.now() - krwRateAutoFetchedAt > RATE_STALE_MS)
    if (stale) fetchKrwRate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [krwRateSource])

  // Auto-mark goal as achieved when reached; clear if it falls back below (e.g., after deletions)
  useEffect(() => {
    if (!goal) return
    const reached = totalSaved >= goal.targetUsd
    if (reached && !goal.achievedAt) {
      setGoal({ ...goal, achievedAt: Date.now() })
    } else if (!reached && goal.achievedAt) {
      setGoal({ ...goal, achievedAt: undefined })
    }
  }, [totalSaved, goal])

  const noteText = t.note.replace("{rate}", rate)

  // ── Shared header ──
  const Header = ({ showBack = false }: { showBack?: boolean }) => (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        {showBack && (
          <button onClick={() => setView("list")} className="rounded-md border border-border p-1.5 text-muted-foreground">
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
        )}
        <h1 className="flex items-center gap-1.5 text-xl font-black tracking-tight">
          <Wallet className={`h-5 w-5 ${theme.textAccent}`} strokeWidth={1.5} />
          {t.appName}
        </h1>
      </div>
      <div className="flex items-center gap-1.5">
        {/* Sync runs silently in the background — no UI indicator */}
        {/* Account button */}
        {auth.configured && (
          <div className="relative">
            {auth.user ? (
              <button
                onClick={() => setAccountMenuOpen(o => !o)}
                className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-border"
                aria-label={lang === "ko" ? "계정" : "Account"}
              >
                {auth.user.photoURL ? (
                  <img src={auth.user.photoURL} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-xs font-bold">
                    {(auth.user.displayName || auth.user.email || "?").charAt(0).toUpperCase()}
                  </span>
                )}
              </button>
            ) : (
              <button
                onClick={auth.signInWithGoogle}
                disabled={auth.loading}
                className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <LogIn className="h-3 w-3" strokeWidth={1.5} />
                {lang === "ko" ? "로그인" : "Sign in"}
              </button>
            )}
            {accountMenuOpen && auth.user && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setAccountMenuOpen(false)} />
                <div className="absolute right-0 top-full z-20 mt-1 min-w-[180px] rounded-md border border-border bg-background py-1 shadow-lg">
                  <div className="border-b border-border px-3 py-2">
                    <div className="text-xs font-semibold truncate">{auth.user.displayName ?? auth.user.email}</div>
                    {auth.user.displayName && auth.user.email && (
                      <div className="text-[10px] text-muted-foreground truncate">{auth.user.email}</div>
                    )}
                  </div>
                  <button
                    onClick={async () => {
                      setAccountMenuOpen(false)
                      // Flush any pending debounced write BEFORE signing out, otherwise
                      // the effect cleanup cancels the timer and the last edit is lost.
                      await flushCloudSync()
                      await auth.signOut()
                      // Clear local cache so the app returns to its fresh empty state.
                      // Data is still safe in Firestore and will be restored on next sign-in.
                      localStorage.removeItem(STORAGE_KEY)
                      window.location.reload()
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-muted"
                  >
                    <LogOut className="h-3 w-3" strokeWidth={1.5} />
                    {lang === "ko" ? "로그아웃" : "Sign out"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        <button
          onClick={() => setView("settings")}
          className="rounded-md border border-border p-1.5 text-muted-foreground"
        >
          <Settings className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )

  // ── AUTH GATE ──
  // When Firebase is configured, require sign-in before showing the app.
  // Signed-out state = clean login screen only (no local data leaks).
  if (auth.configured) {
    if (auth.loading) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
          <div className="text-sm text-muted-foreground">
            {lang === "ko" ? "로딩 중..." : "Loading..."}
          </div>
        </div>
      )
    }
    if (!auth.user) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground px-6">
          <div className="w-full max-w-sm space-y-6 text-center">
            <div className="flex items-center justify-center gap-2">
              <Wallet className={`h-8 w-8 ${theme.textAccent}`} strokeWidth={1.5} />
              <h1 className="text-3xl font-black tracking-tight">{t.appName}</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              {lang === "ko"
                ? "샀을 대신 아꼈을 때 얼마가 될까?"
                : "What if you saved instead of spent?"}
            </p>
            <Button
              className="w-full"
              onClick={auth.signInWithGoogle}
              disabled={auth.loading}
            >
              <LogIn className="h-4 w-4 mr-2" strokeWidth={1.5} />
              {lang === "ko" ? "Google로 로그인" : "Sign in with Google"}
            </Button>
            {auth.error && (
              <p className="text-xs text-destructive">{auth.error}</p>
            )}
          </div>
        </div>
      )
    }
  }

  // ── SETTINGS VIEW ──
  if (view === "settings") {
    const SegmentGroup = ({ value, onChange, options }: {
      value: string
      onChange: (v: string) => void
      options: { label: string; value: string }[]
    }) => (
      <div className="flex rounded-lg border border-border overflow-hidden">
        {options.map((opt, i) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`flex-1 py-1.5 text-xs font-semibold transition-colors ${i < options.length - 1 ? "border-r border-border" : ""} ${value === opt.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >{opt.label}</button>
        ))}
      </div>
    )

    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="mx-auto w-full max-w-md px-4 pb-10 pt-4 space-y-5">
          {/* Header */}
          <div className="flex items-center gap-2">
            <button onClick={() => setView("list")} className="rounded-md border border-border p-1.5 text-muted-foreground">
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
            <h1 className="text-xl font-black tracking-tight">{t.settings}</h1>
          </div>

          {/* Language */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.language}</Label>
            <SegmentGroup
              value={lang}
              onChange={v => setLang(v as Lang)}
              options={[{ label: "English", value: "en" }, { label: "한국어", value: "ko" }]}
            />
          </div>

          <Separator />

          {/* Currency */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.currency}</Label>
            <SegmentGroup
              value={currency}
              onChange={v => handleCurrencyChange(v as Currency)}
              options={[{ label: "USD ($)", value: "USD" }, { label: "KRW (₩)", value: "KRW" }]}
            />
          </div>

          <Separator />

          {/* Appearance */}
          <div className="space-y-4">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.appearance}</Label>

            {/* Dark mode */}
            <div className="flex items-center justify-between">
              <span className="text-sm">{t.darkMode}</span>
              <button
                onClick={() => setIsDark(v => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isDark ? "bg-primary" : "bg-muted"}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${isDark ? "translate-x-6" : "translate-x-1"}`} />
              </button>
            </div>

            {/* Theme color */}
            <div className="space-y-2">
              <span className="text-sm">{t.theme}</span>
              <div className="flex gap-3 pt-1">
                {(Object.entries(themes) as [ThemeColor, typeof themes[ThemeColor]][]).map(([key, val]) => (
                  <button
                    key={key}
                    onClick={() => setThemeColor(key)}
                    className={`flex flex-col items-center gap-1.5`}
                  >
                    <span className={`flex h-8 w-8 items-center justify-center rounded-full ${val.dot} ring-offset-background transition-all ${themeColor === key ? "ring-2 ring-primary ring-offset-2" : "opacity-60 hover:opacity-100"}`}>
                      {themeColor === key && <span className="h-2.5 w-2.5 rounded-full bg-white" />}
                    </span>
                    <span className="text-xs text-muted-foreground">{val.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <Separator />

          {/* Time horizon shown in list (single-select) */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {lang === "ko" ? "리스트 기간 표시" : "Horizon shown in list"}
            </Label>
            <div className="flex gap-2">
              {[10, 20, 30].map(h => {
                const active = horizons[0] === h
                return (
                  <button
                    key={h}
                    onClick={() => setHorizons([h])}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${active ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
                  >
                    {lang === "ko" ? `${h}년` : `${h}Y`}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {lang === "ko" ? "한 번에 하나만 표시돼요." : "One at a time."}
            </p>
          </div>

          <Separator />

          {/* Exchange rate */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {lang === "ko" ? "환율 (USD → KRW)" : "Exchange rate (USD → KRW)"}
            </Label>
            <div className="flex gap-2">
              {(["auto", "manual"] as const).map(src => (
                <button
                  key={src}
                  onClick={() => setKrwRateSource(src)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${krwRateSource === src ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
                >
                  {src === "auto"
                    ? (lang === "ko" ? "자동" : "Auto")
                    : (lang === "ko" ? "직접 입력" : "Manual")}
                </button>
              ))}
            </div>
            {krwRateSource === "auto" ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 text-xs text-muted-foreground">
                  {krwRateFetching ? (
                    lang === "ko" ? "가져오는 중..." : "Fetching..."
                  ) : krwRateAuto && krwRateAutoFetchedAt ? (
                    <>
                      1 USD = <span className="font-semibold text-foreground">₩{krwRateAuto.toFixed(2)}</span>
                      <div className="text-[10px]">
                        {lang === "ko" ? "업데이트: " : "Updated: "}
                        {new Date(krwRateAutoFetchedAt).toLocaleString(lang === "ko" ? "ko-KR" : "en-US", { dateStyle: "short", timeStyle: "short" })}
                      </div>
                    </>
                  ) : krwRateError ? (
                    <span className="text-destructive">
                      {lang === "ko" ? `가져오기 실패 — 현재 ₩${krwRate} 사용` : `Fetch failed — using ₩${krwRate}`}
                    </span>
                  ) : (
                    lang === "ko" ? "아직 가져오지 않음" : "Not fetched yet"
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={fetchKrwRate} disabled={krwRateFetching}>
                  {lang === "ko" ? "새로고침" : "Refresh"}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  value={String(krwRateManual)}
                  onChange={e => {
                    const v = parseFloat(e.target.value)
                    if (Number.isFinite(v) && v > 0) setKrwRateManual(v)
                  }}
                  className="h-9"
                />
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {lang === "ko" ? "원/달러" : "KRW per USD"}
                </span>
              </div>
            )}
          </div>

          <Separator />

          {/* Data section */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Data</Label>
            <p className="text-xs text-muted-foreground">
              {lang === "ko"
                ? "앱 업데이트 전 백업, 새 기기로 옮길 때 복원에 사용해요."
                : "Back up before updates or restore on a new device."}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={exportData}>
                {lang === "ko" ? "내보내기" : "Export"}
              </Button>
              <label className="flex-1">
                <Button variant="outline" className="w-full pointer-events-none">
                  {lang === "ko" ? "가져오기" : "Import"}
                </Button>
                <input
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (file) importData(file)
                    e.target.value = "" // allow re-selecting the same file later
                  }}
                />
              </label>
            </div>
            <Button variant="destructive" className="w-full" onClick={() => { clearAll(); setView("list") }}>
              {t.deleteAll}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // ── LIST VIEW ──
  if (view === "list") {
    const r = parseFloat(rate) || 10
    const exampleRows: { key: "coffee" | "delivery" | "subscription" | "bag" | "dining"; Icon: LucideIcon; usd: number; freq: number }[] = [
      { key: "coffee", Icon: Coffee, usd: 7, freq: 365 },
    ]
    const exampleData = exampleRows.map(ex => {
      const isRecurring = ex.freq > 1
      const annual = ex.usd * ex.freq
      const monthly = isRecurring ? annual / 12 : 0
      const fvByHorizon: Record<number, number> = {}
      horizons.forEach(h => {
        fvByHorizon[h] = isRecurring ? fvRecurring(annual, r, h, ex.freq) : fvLump(ex.usd, r, h)
      })
      return { ...ex, fvByHorizon, monthly, isRecurring }
    })

    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-3 px-4 pb-24 pt-4">
          <Header />

          {/* Month navigator — allow forward nav so recurring items entered now
              project visibly into next/future months. */}
          {records.length > 0 && (() => {
            const monthLabel = lang === "ko"
              ? `${viewMonth.year}년 ${viewMonth.month + 1}월`
              : new Date(viewMonth.year, viewMonth.month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })
            return (
              <div className="flex items-center justify-between px-1">
                <button
                  onClick={() => {
                    const prev = new Date(viewMonth.year, viewMonth.month - 1, 1)
                    setViewMonth({ year: prev.getFullYear(), month: prev.getMonth() })
                  }}
                  className="rounded-md p-1.5 text-muted-foreground hover:text-foreground"
                  aria-label={lang === "ko" ? "이전 달" : "Previous month"}
                >
                  <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
                </button>
                <span className="text-sm font-semibold">{monthLabel}</span>
                <button
                  onClick={() => {
                    const next = new Date(viewMonth.year, viewMonth.month + 1, 1)
                    setViewMonth({ year: next.getFullYear(), month: next.getMonth() })
                  }}
                  className="rounded-md p-1.5 text-muted-foreground hover:text-foreground"
                  aria-label={lang === "ko" ? "다음 달" : "Next month"}
                >
                  <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </div>
            )
          })()}

          {/* View mode toggle (list / calendar) + horizon selector */}
          {records.length > 0 && (
            <div className="relative flex items-center justify-between px-1">
              <div className="flex gap-1 rounded-md border border-border p-0.5">
                <button
                  onClick={() => { setMonthViewMode("list"); setSelectedDay(null) }}
                  className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold transition-colors ${monthViewMode === "list" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  aria-label={lang === "ko" ? "리스트 보기" : "List view"}
                >
                  <List className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
                <button
                  onClick={() => setMonthViewMode("calendar")}
                  className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold transition-colors ${monthViewMode === "calendar" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  aria-label={lang === "ko" ? "캘린더 보기" : "Calendar view"}
                >
                  <Calendar className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </div>
              <button
                onClick={() => setHorizonMenuOpen(o => !o)}
                className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
                aria-haspopup="true"
                aria-expanded={horizonMenuOpen}
              >
                {horizons.map(h => (lang === "ko" ? `${h}년` : `${h}Y`)).join(", ")}
                <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
              </button>
              {horizonMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setHorizonMenuOpen(false)}
                  />
                  <div className="absolute right-1 top-full z-20 mt-1 flex min-w-[140px] flex-col rounded-md border border-border bg-background py-1 shadow-lg">
                    {[10, 20, 30].map(h => {
                      const active = horizons[0] === h
                      return (
                        <button
                          key={h}
                          onClick={() => {
                            setHorizons([h])
                            setHorizonMenuOpen(false)
                          }}
                          className="flex items-center justify-between px-3 py-1.5 text-sm hover:bg-muted"
                        >
                          <span>{lang === "ko" ? `${h}년 후` : `In ${h}Y`}</span>
                          {active && <Check className="h-3.5 w-3.5" strokeWidth={1.5} />}
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Saved records for selected month — list or calendar view */}
          {monthViewMode === "calendar" && records.length > 0 && (() => {
            // For each day in the viewed month, figure out which records (both once
            // and recurring) are active that day, so the grid actually reflects the
            // daily rhythm of savings — not just one-off entries.
            const daysInMonth = new Date(viewMonth.year, viewMonth.month + 1, 0).getDate()
            const firstWeekday = new Date(viewMonth.year, viewMonth.month, 1).getDay()
            const recordsByDay = new Map<number, RecordItem[]>()
            const msPerDay = 86400000
            for (let day = 1; day <= daysInMonth; day++) {
              const dayDate = new Date(viewMonth.year, viewMonth.month, day)
              const dayTs = dayDate.getTime()
              const active: RecordItem[] = []
              for (const r of records) {
                const start = new Date(r.date)
                const startDayTs = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()
                if (startDayTs > dayTs) continue
                const endTs = getEndDate(r)
                // Day-precision: skip if dayDate is on/after endDate (record stopped that day).
                if (endTs !== undefined && dayTs >= endTs) continue
                if (r.type === "once") {
                  if (start.getFullYear() === viewMonth.year
                    && start.getMonth() === viewMonth.month
                    && start.getDate() === day) active.push(r)
                  continue
                }
                if (r.freq === 365) {
                  active.push(r)
                } else if (r.freq === 52) {
                  const diffDays = Math.round((dayTs - startDayTs) / msPerDay)
                  if (diffDays >= 0 && diffDays % 7 === 0) active.push(r)
                } else if (r.freq === 12) {
                  const targetDay = Math.min(start.getDate(), daysInMonth)
                  if (day === targetDay) active.push(r)
                }
              }
              if (active.length > 0) recordsByDay.set(day, active)
            }
            const weekdayLabels = lang === "ko"
              ? ["일", "월", "화", "수", "목", "금", "토"]
              : ["S", "M", "T", "W", "T", "F", "S"]
            // Sort the selected-day list the same way the main list is sorted:
            // monthly → weekly → daily → once, amount desc within each group.
            const calFreqRank = (r: RecordItem) => {
              if (r.type !== "recurring") return 3
              if (r.freq === 12) return 0
              if (r.freq === 52) return 1
              return 2
            }
            const selectedRecords = selectedDay !== null
              ? [...(recordsByDay.get(selectedDay) ?? [])].sort((a, b) => {
                const fd = calFreqRank(a) - calFreqRank(b)
                if (fd !== 0) return fd
                return b.usdAmt - a.usdAmt
              })
              : []
            return (
              <Card>
                <CardContent className="p-3 space-y-3">
                  {/* Legend — explains the four frequency colors used in the grid dots. */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-0.5 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-violet-400" />{lang === "ko" ? "매달" : "Monthly"}</span>
                    <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-sky-400" />{lang === "ko" ? "매주" : "Weekly"}</span>
                    <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{lang === "ko" ? "매일" : "Daily"}</span>
                    <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" />{lang === "ko" ? "일회" : "Once"}</span>
                  </div>
                  {/* Weekday header */}
                  <div className="grid grid-cols-7 gap-1">
                    {weekdayLabels.map((d, i) => (
                      <div key={i} className="text-center text-[10px] font-semibold text-muted-foreground">{d}</div>
                    ))}
                  </div>
                  {/* Days grid */}
                  <div className="grid grid-cols-7 gap-1">
                    {Array.from({ length: firstWeekday }).map((_, i) => (
                      <div key={`blank-${i}`} />
                    ))}
                    {Array.from({ length: daysInMonth }).map((_, i) => {
                      const day = i + 1
                      const dayRecords = recordsByDay.get(day) ?? []
                      const hasRecords = dayRecords.length > 0
                      const isSelected = selectedDay === day
                      // Distinct colored dot per frequency type present that day. Chosen
                      // to read as a coordinated palette rather than utility-ticket hues.
                      const hasOnce = dayRecords.some(r => r.type !== "recurring")
                      const hasDaily = dayRecords.some(r => r.type === "recurring" && r.freq === 365)
                      const hasWeekly = dayRecords.some(r => r.type === "recurring" && r.freq === 52)
                      const hasMonthly = dayRecords.some(r => r.type === "recurring" && r.freq === 12)
                      return (
                        <button
                          key={day}
                          onClick={() => setSelectedDay(isSelected ? null : (hasRecords ? day : null))}
                          disabled={!hasRecords}
                          className={`aspect-square rounded-md flex flex-col items-center justify-between py-1.5 px-1 transition-colors ${
                            isSelected ? "bg-primary text-primary-foreground" :
                            hasRecords ? "hover:bg-muted" :
                            ""
                          }`}
                        >
                          <span className={`text-xs font-semibold leading-none ${hasRecords || isSelected ? "" : "text-muted-foreground/50"}`}>{day}</span>
                          <div className="flex gap-0.5 min-h-[6px] items-center">
                            {hasDaily && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
                            {hasWeekly && <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />}
                            {hasMonthly && <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />}
                            {hasOnce && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                  {/* Selected day details — scrollable so the card height is bounded
                      on phone screens even when the active list is long. Recurring-
                      this-month footer removed: dots on the grid already signal that. */}
                  {selectedDay !== null && selectedRecords.length > 0 && (
                    <div className="border-t border-border pt-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                        {lang === "ko" ? `${viewMonth.month + 1}월 ${selectedDay}일` : new Date(viewMonth.year, viewMonth.month, selectedDay).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </p>
                      <div className="max-h-48 overflow-y-auto space-y-1 [scrollbar-gutter:stable]">
                        {selectedRecords.map(r => {
                          const suffix = r.type === "recurring"
                            ? (r.freq === 365 ? (lang === "ko" ? "/일" : "/d")
                              : r.freq === 52 ? (lang === "ko" ? "/주" : "/w")
                              : (lang === "ko" ? "/월" : "/m"))
                            : ""
                          const dotColor = r.type !== "recurring" ? "bg-amber-400"
                            : r.freq === 365 ? "bg-emerald-400"
                            : r.freq === 52 ? "bg-sky-400"
                            : "bg-violet-400"
                          return (
                            <button
                              key={r.id}
                              onClick={() => setEditingRecord(r)}
                              className="flex w-full items-center justify-between py-1 text-left"
                            >
                              <span className="flex items-center gap-1.5 flex-1 min-w-0">
                                <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${dotColor}`} />
                                <span className="text-sm font-semibold truncate">{r.name}</span>
                              </span>
                              <span className="text-xs text-muted-foreground ml-2 whitespace-nowrap">{fmt(r.usdAmt)}{suffix}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })()}
          {monthViewMode === "list" && historySummary.enriched.length > 0 ? (
            <Card className="overflow-hidden">
              {/* Legend — same mapping as the calendar so the row-prefix dot colors
                  have an explanation before the list itself begins. */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-violet-400" />{lang === "ko" ? "매달" : "Monthly"}</span>
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-sky-400" />{lang === "ko" ? "매주" : "Weekly"}</span>
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{lang === "ko" ? "매일" : "Daily"}</span>
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" />{lang === "ko" ? "일회" : "Once"}</span>
              </div>
              {/* Header row */}
              {/* Scroll the rows inside the card (header + rows in same scroll container
                  so a visible scrollbar eats width from both, keeping columns aligned).
                  Header sticks to the top as the user scrolls.
                  overscroll-contain + touch-pan-y stop iOS Safari from forwarding the
                  touch to the page's own scroll, which was hiding rows below the fold. */}
              <div className="max-h-80 overflow-y-auto overscroll-contain touch-pan-y [scrollbar-gutter:stable] [-webkit-overflow-scrolling:touch]">
                {/* Three-column grid: name | now (entered + monthly eq) | in-horizon FV.
                    Same gap + widths used in every row below so columns line up cleanly. */}
                <div className="sticky top-0 z-10 flex items-center border-b border-border bg-background px-4 py-2 gap-3">
                  <span className="flex-1 text-xs font-semibold text-muted-foreground">{lang === "ko" ? "항목" : "Item"}</span>
                  <span className="w-5 text-center text-xs font-semibold text-muted-foreground" aria-label={lang === "ko" ? "이체" : "Moved"}>✓</span>
                  <span className="w-20 text-right text-xs font-semibold text-muted-foreground">{lang === "ko" ? "현재" : "Now"}</span>
                  {horizons.map(h => (
                    <span key={h} className="w-14 text-right text-xs font-semibold text-muted-foreground">
                      {lang === "ko" ? `${h}년 후` : `In ${h}Y`}
                    </span>
                  ))}
                </div>
                {historySummary.enriched.map((item, index) => {
                  const freqSuffix = item.isRecurring
                    ? item.freq === 365 ? (lang === "ko" ? "/일" : "/d")
                    : item.freq === 52 ? (lang === "ko" ? "/주" : "/w")
                    : (lang === "ko" ? "/월" : "/m")
                    : ""
                  const moSuffix = lang === "ko" ? "/월" : "/m"
                  // Show monthly equivalent only when the entered unit isn't already monthly
                  const showMonthlyEq = item.isRecurring && item.freq !== 12
                  return (
                    <div key={item.id} className={`flex items-start px-4 py-2.5 gap-3 ${index < historySummary.enriched.length - 1 ? "border-b border-border" : ""}`}>
                      <button
                        className="flex-1 min-w-0 text-left p-0 bg-transparent border-0 m-0"
                        onClick={() => setEditingRecord(item)}
                        aria-label={lang === "ko" ? "편집" : "Edit"}
                      >
                        <div className="flex items-center gap-1.5 leading-5">
                          <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${
                            item.isRecurring
                              ? item.freq === 365 ? "bg-emerald-400"
                              : item.freq === 52 ? "bg-sky-400"
                              : "bg-violet-400"
                              : "bg-amber-400"
                          }`} />
                          <span className="text-sm font-semibold truncate">{item.name}</span>
                        </div>
                      </button>
                      {/* Verified toggle — tap to mark "I actually moved this money".
                          Recurring tracks per-month, so the same row will reset to
                          unverified when the user navigates to a different month. */}
                      {/* Verified toggle. Off → if a goal exists open the destination
                          modal; otherwise mark as long-term immediately. On → tap clears
                          back to unverified (no modal needed for un-marking). The check
                          color reflects the destination: theme-primary for goal, emerald
                          for long. */}
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation()
                          if (item.destination) {
                            setRecordDestination(item.id, null)
                          } else if (goal) {
                            setVerifyingRecord(item)
                          } else {
                            setRecordDestination(item.id, "long")
                          }
                        }}
                        className="w-5 flex items-center justify-center pt-1"
                        aria-label={item.verified ? (lang === "ko" ? "이체 취소" : "Unmark moved") : (lang === "ko" ? "이체 표시" : "Mark moved")}
                      >
                        {item.destination === "goal" ? (
                          <span className="h-4 w-4 rounded-full bg-primary flex items-center justify-center">
                            <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />
                          </span>
                        ) : item.destination === "long" ? (
                          <span className="h-4 w-4 rounded-full bg-emerald-500 flex items-center justify-center">
                            <Check className="h-3 w-3 text-white" strokeWidth={3} />
                          </span>
                        ) : (
                          <span className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 hover:border-muted-foreground/60 transition-colors" />
                        )}
                      </button>
                      {/* Now column: monthly (or entered if already monthly/once) on line 1,
                          entered unit in parens on line 2 for daily/weekly recurring.
                          Use compact fmt() so KRW ₩260,000 collapses to ₩26만 and the
                          number still fits the 80px column without wrapping. */}
                      <div className="w-20 text-right">
                        <div className="text-xs text-muted-foreground leading-5 whitespace-nowrap">
                          {showMonthlyEq
                            ? `${fmt(item.monthAmt)}${moSuffix}`
                            : `${fmt(item.usdAmt)}${freqSuffix}`}
                        </div>
                        {showMonthlyEq && (
                          <div className="text-xs text-muted-foreground leading-4 whitespace-nowrap">
                            ({fmt(item.usdAmt)}{freqSuffix})
                          </div>
                        )}
                      </div>
                      {horizons.map(h => {
                        // Recurring items show the full stream FV (what the habit
                        // becomes if continued), once items show the lump-sum FV.
                        const headlineFv = item.isRecurring
                          ? item.fvRecurringByHorizon[h]
                          : item.fvByHorizon[h]
                        return (
                          <div key={h} className={`w-14 text-right ${theme.textAccent}`}>
                            <div className="text-xs font-medium leading-5">{fmt(headlineFv)}</div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}

                {/* Totals live inside the same scroll container so they share the exact
                    same effective width as the rows above — including the reserved
                    scrollbar gutter. Sticky-bottom keeps the month sum visible while the
                    user scrolls through a long list. */}
                {/* Totals show two layers per cell: verified (bold dark) + pending (muted).
                    Verified = items the user actually moved money for. Pending = the rest.
                    Both add up to the all-records total. */}
                <div className="sticky bottom-0 z-10 border-t-2 border-border bg-muted px-4 py-2.5">
                  <div className="flex items-start gap-3">
                    <span className="flex-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground self-center">
                      {lang === "ko" ? "이 달 합계" : "Month total"}
                    </span>
                    <div className="w-20 text-right">
                      <div className="text-base font-extrabold leading-5">
                        {fmt(historySummary.monthSavedVerified)}
                      </div>
                      {historySummary.monthSaved > historySummary.monthSavedVerified && (
                        <div className="text-[10px] text-muted-foreground leading-4">
                          +{fmt(historySummary.monthSaved - historySummary.monthSavedVerified)}
                        </div>
                      )}
                    </div>
                    {horizons.map(h => (
                      <div key={h} className="w-14 text-right">
                        <div className={`text-sm font-bold leading-5 ${theme.textAccent}`}>
                          {fmt(historySummary.horizonSumsVerified[h])}
                        </div>
                        {historySummary.horizonSums[h] > historySummary.horizonSumsVerified[h] && (
                          <div className="text-[10px] text-muted-foreground leading-4">
                            +{fmt(historySummary.horizonSums[h] - historySummary.horizonSumsVerified[h])}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          ) : monthViewMode === "list" && records.length > 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                {lang === "ko" ? "이 달 기록 없음" : "No savings this month"}
              </CardContent>
            </Card>
          ) : null}

          {/* Cumulative savings chart — from first record's month through current.
              Area = running total, faint bars behind = that month's flow, dashed line = goal.
              Only shown once there's at least 2 months of data to make the trend readable. */}
          {monthlySeries.length >= 2 && (() => {
            const W = 400
            const H = 140
            const padT = 8
            const padB = 18
            const chartH = H - padT - padB
            const n = monthlySeries.length
            const maxCum = monthlySeries[n - 1].cumulative
            const goalTarget = goal?.targetUsd ?? 0
            const maxY = Math.max(maxCum, goalTarget) * 1.1 || 1
            const xAt = (i: number) => n === 1 ? W / 2 : (i * W) / (n - 1)
            const yAt = (v: number) => padT + (1 - v / maxY) * chartH
            // Smooth cubic path between points (control points at segment midpoints)
            const pts = monthlySeries.map((p, i) => ({ x: xAt(i), y: yAt(p.cumulative) }))
            let linePath = `M ${pts[0].x},${pts[0].y}`
            for (let i = 1; i < pts.length; i++) {
              const midX = (pts[i - 1].x + pts[i].x) / 2
              linePath += ` C ${midX},${pts[i - 1].y} ${midX},${pts[i].y} ${pts[i].x},${pts[i].y}`
            }
            const areaPath = `${linePath} L ${pts[n - 1].x},${padT + chartH} L ${pts[0].x},${padT + chartH} Z`
            // Bar geometry: slot = total slice per month; bar occupies 60% of slot, centered
            const slot = W / n
            const barW = Math.max(2, slot * 0.6)
            const maxBar = Math.max(...monthlySeries.map(p => p.saved), 1)
            const goalY = goalTarget > 0 ? yAt(goalTarget) : null
            const gradId = `spark-${theme.primaryHsl.replace(/[^a-z0-9]/gi, "")}`
            const monthLabel = (y: number, m: number) => lang === "ko"
              ? `${m + 1}월`
              : new Date(y, m, 1).toLocaleDateString("en-US", { month: "short" })
            // Sparse x-labels: first, last, plus ~2 in middle if room
            const labelIdxs = new Set<number>([0, n - 1])
            if (n >= 4) labelIdxs.add(Math.floor(n / 3))
            if (n >= 6) labelIdxs.add(Math.floor((2 * n) / 3))
            return (
              <Card>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-baseline justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {lang === "ko" ? "누적 저축" : "Cumulative savings"}
                    </p>
                    <span className={`text-lg font-extrabold ${theme.textAccent}`}>{fmt(maxCum)}</span>
                  </div>
                  <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor={`hsl(${theme.primaryHsl})`} stopOpacity="0.32" />
                        <stop offset="100%" stopColor={`hsl(${theme.primaryHsl})`} stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    {/* Monthly bars (faint, behind) */}
                    {monthlySeries.map((p, i) => {
                      const x = slot * i + (slot - barW) / 2
                      const h = (p.saved / maxBar) * (chartH * 0.35)
                      const y = padT + chartH - h
                      return (
                        <rect
                          key={i}
                          x={x}
                          y={y}
                          width={barW}
                          height={h}
                          fill="currentColor"
                          className="text-muted-foreground/20"
                          rx={1}
                        />
                      )
                    })}
                    {/* Goal threshold line */}
                    {goalY !== null && goalY >= padT && (
                      <>
                        <line
                          x1={0} x2={W}
                          y1={goalY} y2={goalY}
                          stroke="currentColor"
                          className="text-muted-foreground/50"
                          strokeWidth={1}
                          strokeDasharray="3 3"
                        />
                        <text
                          x={W - 2}
                          y={goalY - 3}
                          textAnchor="end"
                          className="fill-muted-foreground"
                          fontSize="9"
                        >
                          {lang === "ko" ? "목표" : "Goal"}
                        </text>
                      </>
                    )}
                    {/* Cumulative area + line */}
                    <path d={areaPath} fill={`url(#${gradId})`} />
                    <path
                      d={linePath}
                      fill="none"
                      stroke={`hsl(${theme.primaryHsl})`}
                      strokeWidth={1.75}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {/* Latest point dot */}
                    <circle cx={pts[n - 1].x} cy={pts[n - 1].y} r={3} fill={`hsl(${theme.primaryHsl})`} />
                    {/* X-axis month labels */}
                    {monthlySeries.map((p, i) => labelIdxs.has(i) ? (
                      <text
                        key={`lbl-${i}`}
                        x={xAt(i)}
                        y={H - 4}
                        textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
                        className="fill-muted-foreground"
                        fontSize="9"
                      >
                        {monthLabel(p.year, p.month)}
                      </text>
                    ) : null)}
                  </svg>
                </CardContent>
              </Card>
            )
          })()}

          {/* Goal card (below the list so records read first; goal reads as the "why").
              The horizon columns mirror the list's horizon checkboxes above — same state. */}
          {goal ? (() => {
            // Committed = actual + recurring commitments through deadline. This is the headline.
            const committed = projectedByDeadline
            const committedPct = Math.min(100, (committed / goal.targetUsd) * 100)
            const isAchieved = !!goal.achievedAt
            const GoalIcon = goalIcons[goal.iconKey] ?? Target
            const goalRate = parseFloat(rate) || 10
            // Deadline-based stats
            let daysLeft: number | null = null
            let saveableMonths = 0
            let shortfall = 0
            let onTrack = false
            if (goal.deadline) {
              const msPerDay = 1000 * 60 * 60 * 24
              daysLeft = Math.max(0, Math.ceil((goal.deadline - Date.now()) / msPerDay))
              const now = new Date()
              const currentAbs = now.getFullYear() * 12 + now.getMonth()
              const dl = new Date(goal.deadline)
              const dlMonthAbs = dl.getFullYear() * 12 + dl.getMonth()
              const lastAbs = dl.getDate() === 1 ? dlMonthAbs - 1 : dlMonthAbs
              saveableMonths = Math.max(1, lastAbs - currentAbs + 1)
              shortfall = Math.max(0, goal.targetUsd - committed)
              onTrack = committed >= goal.targetUsd
            }
            const extraMonthlyNeeded = goal.deadline ? shortfall / saveableMonths : 0
            return (
              <Card className={`overflow-hidden ${isAchieved ? "border-primary" : ""}`}>
                <button className="w-full text-left" onClick={() => setGoalDetailOpen(true)}>
                  <CardContent className="p-4 space-y-2">
                    {/* Top row: name + 30Y projection of the target. Target itself
                        moves into the meta line below to drop one row. */}
                    <div className="flex items-center">
                      <div className="flex flex-1 items-center gap-2 min-w-0 leading-5">
                        <GoalIcon className={`h-4 w-4 flex-shrink-0 ${theme.textAccent}`} strokeWidth={1.5} />
                        <span className="text-sm font-semibold truncate">{goal.name}</span>
                        <span className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full flex-shrink-0">
                          {lang === "ko" ? "단기" : "Short-term"}
                        </span>
                      </div>
                      {horizons.map(h => (
                        <div key={h} className={`w-14 text-right text-xs font-medium leading-5 ${theme.textAccent}`}>
                          {fmt(fvLump(goal.targetUsd, goalRate, h))}
                        </div>
                      ))}
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${committedPct}%` }}
                      />
                    </div>
                    {/* Compact meta — current/target on the left, status on the right.
                        Status pill collapses to "Short-term" when no deadline / not achieved
                        so the card always carries the bucket label. */}
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {fmt(committed)} / {fmt(goal.targetUsd)}
                        {goal.account && <span className="ml-1.5">· {goal.account}</span>}
                      </span>
                      {isAchieved ? (
                        <span className={`font-semibold ${theme.textAccent}`}>{lang === "ko" ? "달성 ✓" : "Achieved ✓"}</span>
                      ) : goal.deadline && daysLeft !== null ? (
                        onTrack ? (
                          <span className={`font-semibold ${theme.textAccent}`}>
                            {lang === "ko" ? `${daysLeft}일 ✓` : `${daysLeft}d ✓`}
                          </span>
                        ) : (
                          <span>
                            {lang === "ko" ? `${daysLeft}일 · +${fmt(extraMonthlyNeeded)}/월` : `${daysLeft}d · +${fmt(extraMonthlyNeeded)}/m`}
                          </span>
                        )
                      ) : null}
                    </div>
                  </CardContent>
                </button>
              </Card>
            )
          })() : (
            <Card className="border-dashed">
              <button
                className="w-full text-left"
                onClick={() => setGoalEditorOpen(true)}
              >
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-full bg-muted ${theme.textAccent}`}>
                    <Target className="h-5 w-5" strokeWidth={1.5} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm">
                      {lang === "ko" ? "목표를 만들어보세요" : "Set a goal"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {lang === "ko" ? "스킵할 때마다 진행률이 쌓여요" : "Every skip fills your progress bar"}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                </CardContent>
              </button>
            </Card>
          )}

          {/* Long-term savings card — laid out to mirror the goal card above:
              icon + name on the left, headline number on the right, account
              label on the second line if set. Tapping opens the small editor
              for the account label. */}
          <Card className="overflow-hidden">
            <button className="w-full text-left" onClick={() => setLongTermAccountEditorOpen(true)}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center">
                  <div className="flex flex-1 items-center gap-2 min-w-0 leading-5">
                    <PiggyBank className="h-4 w-4 flex-shrink-0 text-emerald-600 dark:text-emerald-400" strokeWidth={1.5} />
                    <span className="text-sm font-semibold truncate">
                      {lang === "ko" ? "장기 저축" : "Long-term"}
                    </span>
                  </div>
                  <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                    {fmt(verifiedBalances.longBalance)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {longTermAccount
                      ? longTermAccount
                      : (lang === "ko" ? "계좌 추가하기" : "Add account")}
                  </span>
                  <span>{lang === "ko" ? "이체 확인된 금액" : "Verified"}</span>
                </div>
              </CardContent>
            </button>
          </Card>

          {/* Goal detail modal — read-only progress + per-record contribution list.
              Edit goes through the Edit button so a casual tap can't accidentally
              start mutating fields. */}
          {goalDetailOpen && goal && (() => {
            const committed = projectedByDeadline
            const committedPct = Math.min(100, (committed / goal.targetUsd) * 100)
            const isAchieved = !!goal.achievedAt
            const GoalIcon = goalIcons[goal.iconKey] ?? Target
            let daysLeft: number | null = null
            let onTrack = false
            if (goal.deadline) {
              const msPerDay = 1000 * 60 * 60 * 24
              daysLeft = Math.max(0, Math.ceil((goal.deadline - Date.now()) / msPerDay))
              onTrack = committed >= goal.targetUsd
            }
            const futureCommitment = Math.max(0, committed - totalSaved)
            return (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6" onClick={() => setGoalDetailOpen(false)}>
                <div className="w-full max-w-sm rounded-xl bg-background p-5 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                  {/* Header: name + status pill */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <GoalIcon className={`h-5 w-5 flex-shrink-0 ${theme.textAccent}`} strokeWidth={1.5} />
                      <span className="font-bold text-base truncate">{goal.name}</span>
                    </div>
                    {isAchieved ? (
                      <span className={`text-xs font-semibold ${theme.textAccent}`}>{lang === "ko" ? "달성 🎉" : "Achieved 🎉"}</span>
                    ) : goal.deadline && daysLeft !== null ? (
                      <span className={`text-xs font-semibold ${onTrack ? theme.textAccent : "text-muted-foreground"}`}>
                        {onTrack ? (lang === "ko" ? "순조롭게 ✓" : "On track ✓") : (lang === "ko" ? "더 분발해야" : "Behind")}
                      </span>
                    ) : null}
                  </div>
                  {/* Big progress display */}
                  <div className="space-y-2">
                    <div className="flex items-baseline justify-between">
                      <span className="text-2xl font-extrabold">{fmt(committed)}</span>
                      <span className="text-sm text-muted-foreground">/ {fmt(goal.targetUsd)}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${committedPct}%` }} />
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{committedPct.toFixed(0)}%</span>
                      {goal.deadline && daysLeft !== null && (
                        <span>{lang === "ko" ? `${daysLeft}일 남음` : `${daysLeft}d left`}</span>
                      )}
                    </div>
                  </div>
                  {/* Saved vs committed split */}
                  {goal.deadline && futureCommitment > 0 && (
                    <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/50 p-3">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{lang === "ko" ? "지금까지" : "Saved"}</p>
                        <p className="text-sm font-bold mt-0.5">{fmt(totalSaved)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{lang === "ko" ? "예정 (반복)" : "Committed"}</p>
                        <p className="text-sm font-bold mt-0.5">{fmt(futureCommitment)}</p>
                      </div>
                    </div>
                  )}
                  {/* Contribution list */}
                  {goalContributions.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {lang === "ko" ? "기여 항목" : "Contributing items"}
                      </p>
                      <div className="space-y-1">
                        {goalContributions.map(({ record: r, total, actual }) => {
                          const isRecurring = r.type === "recurring"
                          const suffix = isRecurring
                            ? (r.freq === 365 ? (lang === "ko" ? "/일" : "/d")
                              : r.freq === 52 ? (lang === "ko" ? "/주" : "/w")
                              : (lang === "ko" ? "/월" : "/m"))
                            : ""
                          const dotColor = !isRecurring ? "bg-amber-400"
                            : r.freq === 365 ? "bg-emerald-400"
                            : r.freq === 52 ? "bg-sky-400"
                            : "bg-violet-400"
                          const pct = (total / goal.targetUsd) * 100
                          return (
                            <div key={r.id} className="flex items-center justify-between gap-2 py-1">
                              <span className="flex items-center gap-1.5 flex-1 min-w-0">
                                <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${dotColor}`} />
                                <span className="text-sm font-semibold truncate">{r.name}</span>
                                <span className="text-xs text-muted-foreground whitespace-nowrap">{fmt(r.usdAmt)}{suffix}</span>
                              </span>
                              <span className="text-right whitespace-nowrap">
                                <span className={`text-sm font-medium ${theme.textAccent}`}>{fmt(total)}</span>
                                <span className="text-[10px] text-muted-foreground ml-1">
                                  {pct.toFixed(0)}%{actual > 0 && total > actual && "*"}
                                </span>
                              </span>
                            </div>
                          )
                        })}
                      </div>
                      {goalContributions.some(c => c.actual > 0 && c.total > c.actual) && (
                        <p className="text-[10px] text-muted-foreground/70 mt-1">
                          {lang === "ko" ? "* 일부는 아직 예정 (recurring 미래분)" : "* Some still committed (future recurring)"}
                        </p>
                      )}
                    </div>
                  )}
                  {/* Actions */}
                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" className="flex-1" onClick={() => setGoalDetailOpen(false)}>
                      {lang === "ko" ? "닫기" : "Close"}
                    </Button>
                    <Button className="flex-1" onClick={() => { setGoalDetailOpen(false); setGoalEditorOpen(true) }}>
                      {lang === "ko" ? "편집" : "Edit"}
                    </Button>
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Goal editor modal */}
          {goalEditorOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6" onClick={() => setGoalEditorOpen(false)}>
              <div className="w-full max-w-sm rounded-xl bg-background p-5 shadow-xl space-y-4" onClick={e => e.stopPropagation()}>
                <p className="font-semibold">
                  {goal
                    ? (lang === "ko" ? "목표 편집" : "Edit goal")
                    : (lang === "ko" ? "새 목표" : "New goal")}
                </p>
                {/* Icon picker */}
                <div className="space-y-1">
                  <Label className="text-xs">{lang === "ko" ? "아이콘" : "Icon"}</Label>
                  <div className="flex gap-1.5">
                    {(Object.keys(goalIcons) as GoalIconKey[]).map(key => {
                      const Icon = goalIcons[key]
                      const selected = (goal?.iconKey ?? "target") === key
                      return (
                        <button
                          key={key}
                          id={`goal-icon-${key}`}
                          type="button"
                          onClick={() => {
                            // toggle visual selection via DOM (we read final value on save)
                            document.querySelectorAll("[data-goal-icon-btn]").forEach(el => el.removeAttribute("data-selected"))
                            const el = document.getElementById(`goal-icon-${key}`)
                            if (el) el.setAttribute("data-selected", "true")
                          }}
                          data-goal-icon-btn
                          data-icon-key={key}
                          data-selected={selected ? "true" : undefined}
                          className="flex h-9 w-9 items-center justify-center rounded-md border border-border data-[selected=true]:border-primary data-[selected=true]:bg-primary/10 hover:bg-muted"
                        >
                          <Icon className="h-4 w-4" strokeWidth={1.5} />
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{lang === "ko" ? "이름" : "Name"}</Label>
                  <Input
                    autoFocus
                    defaultValue={goal?.name ?? ""}
                    placeholder={lang === "ko" ? "예: 한국 여행" : "e.g. Korea trip"}
                    maxLength={40}
                    id="goal-name-input"
                  />
                </div>
                <div className="space-y-1">
                  <Label className={`text-xs ${goalTargetInvalid ? "text-destructive" : ""}`}>
                    {lang === "ko"
                      ? (currency === "KRW" ? "목표 금액 (₩)" : "목표 금액 ($)")
                      : (currency === "KRW" ? "Target (₩)" : "Target ($)")}
                  </Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    defaultValue={goal ? String(currency === "KRW" ? Math.round(goal.targetUsd * krwRate) : goal.targetUsd) : ""}
                    id="goal-target-input"
                    className={goalTargetInvalid ? "border-destructive focus-visible:ring-destructive" : ""}
                    onInput={() => { if (goalTargetInvalid) setGoalTargetInvalid(false) }}
                  />
                  {goalTargetInvalid && (
                    <p className="text-xs text-destructive">
                      {lang === "ko" ? "목표 금액을 입력해주세요" : "Enter a target amount"}
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">
                    {lang === "ko" ? "목표 날짜 (선택)" : "Deadline (optional)"}
                  </Label>
                  <Input
                    type="date"
                    defaultValue={goal?.deadline ? new Date(goal.deadline).toISOString().slice(0, 10) : ""}
                    id="goal-deadline-input"
                    className="appearance-none min-w-0"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">
                    {lang === "ko" ? "계좌 (선택)" : "Account (optional)"}
                  </Label>
                  <Input
                    type="text"
                    defaultValue={goal?.account ?? ""}
                    placeholder={lang === "ko" ? "예: 토스 ●●2345" : "e.g. Wealthfront ●●1234"}
                    maxLength={40}
                    id="goal-account-input"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    {lang === "ko" ? "계좌번호 전체는 적지 마세요" : "Don't enter the full account number"}
                  </p>
                </div>
                {/* Shared-goal checkbox (Phase 1: UI scaffold; Phase 2 will wire invite flow) */}
                <label className="flex items-start gap-2 cursor-pointer select-none pt-1">
                  <input
                    type="checkbox"
                    id="goal-shared-input"
                    defaultChecked={goal?.type === "shared"}
                    disabled
                    className="mt-0.5 h-4 w-4 accent-primary disabled:opacity-50 cursor-not-allowed"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-muted-foreground">
                      {lang === "ko" ? "다른 사람과 공유하기" : "Share with someone"}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {lang === "ko" ? "곧 출시 — 파트너/가족과 함께 저축" : "Coming soon — save together with a partner"}
                    </div>
                  </div>
                </label>
                <div className="flex gap-2 pt-3">
                  {goal && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (window.confirm(lang === "ko" ? "목표를 삭제할까요?" : "Delete this goal?")) {
                          deleteGoal()
                        }
                      }}
                      className="text-destructive hover:text-destructive"
                    >
                      {lang === "ko" ? "삭제" : "Delete"}
                    </Button>
                  )}
                  <Button variant="outline" className="flex-1" onClick={() => setGoalEditorOpen(false)}>
                    {lang === "ko" ? "취소" : "Cancel"}
                  </Button>
                  <Button className="flex-1" onClick={() => {
                    const nameInput = document.getElementById("goal-name-input") as HTMLInputElement
                    const targetInput = document.getElementById("goal-target-input") as HTMLInputElement
                    const deadlineInput = document.getElementById("goal-deadline-input") as HTMLInputElement
                    const sharedInput = document.getElementById("goal-shared-input") as HTMLInputElement | null
                    const selectedIconEl = document.querySelector<HTMLElement>("[data-goal-icon-btn][data-selected=true]")
                    const iconKey = (selectedIconEl?.dataset.iconKey as GoalIconKey | undefined) ?? goal?.iconKey ?? "target"
                    const name = nameInput.value.trim() || (lang === "ko" ? "내 목표" : "My goal")
                    const rawTarget = parseFloat(targetInput.value)
                    if (!Number.isFinite(rawTarget) || rawTarget <= 0) {
                      setGoalTargetInvalid(true)
                      targetInput.focus()
                      return
                    }
                    const targetUsd = currency === "KRW" ? rawTarget / krwRate : rawTarget
                    const deadlineStr = deadlineInput.value
                    const deadline = deadlineStr ? new Date(deadlineStr + "T00:00:00").getTime() : undefined
                    const type: GoalType = sharedInput?.checked ? "shared" : "personal"
                    const accountInput = document.getElementById("goal-account-input") as HTMLInputElement | null
                    const account = accountInput?.value.trim() || undefined
                    saveGoal({ name, iconKey, targetUsd, deadline, type, account })
                  }}>
                    {lang === "ko" ? "저장" : "Save"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Edit modal */}
          {editingRecord && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6" onClick={() => setEditingRecord(null)}>
              <div className="w-full max-w-sm rounded-xl bg-background p-5 shadow-xl space-y-4" onClick={e => e.stopPropagation()}>
                <p className="font-semibold">{lang === "ko" ? "편집" : "Edit"}</p>
                <div className="space-y-1">
                  <Label className="text-xs">{lang === "ko" ? "이름" : "Name"}</Label>
                  <Input
                    autoFocus
                    defaultValue={editingRecord.name}
                    maxLength={40}
                    onKeyDown={e => {
                      if (e.key === "Escape") setEditingRecord(null)
                    }}
                    id="edit-name-input"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{currency === "KRW" ? t.amountKRW : t.amountUSD}</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    defaultValue={currency === "KRW"
                      ? String(Math.round(editingRecord.usdAmt * krwRate))
                      : String(editingRecord.usdAmt)}
                    onKeyDown={e => {
                      if (e.key === "Escape") setEditingRecord(null)
                    }}
                    id="edit-amount-input"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{lang === "ko" ? "날짜" : "Date"}</Label>
                  <Input
                    type="date"
                    defaultValue={new Date(editingRecord.date).toISOString().slice(0, 10)}
                    onKeyDown={e => {
                      if (e.key === "Escape") setEditingRecord(null)
                    }}
                    id="edit-date-input"
                    // iOS Safari draws extra chrome inside <input type="date"> that pushes
                    // the rendered text past the box. appearance:none disables that native
                    // styling so the input respects the modal's content width.
                    className="appearance-none min-w-0"
                  />
                </div>
                {/* Frequency selector: once / daily / weekly / monthly */}
                <div className="space-y-1">
                  <Label className="text-xs">{lang === "ko" ? "빈도" : "Frequency"}</Label>
                  <div className="flex rounded-lg border border-border overflow-hidden">
                    {([
                      { label: t.oneTime, mode: "once" as Mode, freq: 1 },
                      { label: t.daily, mode: "recurring" as Mode, freq: 365 },
                      { label: t.weekly, mode: "recurring" as Mode, freq: 52 },
                      { label: t.monthly, mode: "recurring" as Mode, freq: 12 },
                    ]).map((opt, i, arr) => {
                      const currentType = editingRecord.type
                      const currentFreq = editingRecord.freq ?? (currentType === "recurring" ? 12 : 1)
                      const isActive = opt.mode === "once"
                        ? currentType === "once"
                        : currentType === "recurring" && currentFreq === opt.freq
                      return (
                        <button
                          key={opt.label}
                          type="button"
                          data-edit-freq-btn
                          data-mode={opt.mode}
                          data-freq={opt.freq}
                          data-active={isActive ? "true" : undefined}
                          onClick={() => {
                            // Update visual selection via DOM; value read on save
                            document.querySelectorAll("[data-edit-freq-btn]").forEach(el => el.removeAttribute("data-active"))
                            ;(document.querySelector(`[data-edit-freq-btn][data-mode="${opt.mode}"][data-freq="${opt.freq}"]`) as HTMLElement | null)?.setAttribute("data-active", "true")
                          }}
                          className={`flex-1 py-2 text-xs font-semibold transition-colors ${i < arr.length - 1 ? "border-r border-border" : ""} data-[active=true]:bg-primary data-[active=true]:text-primary-foreground text-muted-foreground hover:text-foreground`}
                        >
                          {opt.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
                {/* Status section — only shown when the record has been stopped at
                    some date. Lets the user resume (clear endDate) or pick a new
                    cutoff (re-open the delete-with-when modal). Hidden for
                    fully-active records to keep the form quiet. */}
                {(() => {
                  const endTs = getEndDate(editingRecord)
                  if (endTs === undefined) return null
                  const endD = new Date(endTs)
                  const endLabel = lang === "ko"
                    ? `${endD.getMonth() + 1}월 ${endD.getDate()}일`
                    : endD.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                  return (
                    <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20 p-3">
                      <Label className="text-xs">
                        {lang === "ko" ? "상태" : "Status"}
                      </Label>
                      <p className="text-sm">
                        {lang === "ko" ? `${endLabel}부터 멈춤` : `Stopped from ${endLabel}`}
                      </p>
                      <div className="flex gap-2 pt-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 text-xs"
                          onClick={() => {
                            const msg = lang === "ko"
                              ? `재개하면 멈췄던 기간(${endLabel}~)도 다시 활성화돼요. 진행할까요?`
                              : `Resuming will reactivate the stopped period (${endLabel} to now). Continue?`
                            if (window.confirm(msg)) {
                              resumeRecord(editingRecord.id)
                              setEditingRecord(null)
                            }
                          }}
                        >
                          {lang === "ko" ? "재개" : "Resume"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 text-xs"
                          onClick={() => {
                            // Hand off to the delete-with-when modal so the user
                            // can pick a different cutoff date.
                            const record = editingRecord
                            setEditingRecord(null)
                            setDeletingRecord(record)
                          }}
                        >
                          {lang === "ko" ? "끝 날짜 변경" : "Change cutoff"}
                        </Button>
                      </div>
                    </div>
                  )
                })()}
                {/* Verification destination picker — same data the list-row check writes
                    to, but with the goal/long-term split visible. Three buttons:
                    not moved / to goal / to long-term. If no goal exists, the goal
                    button is hidden so the picker collapses to two states. */}
                {(() => {
                  const isRec = editingRecord.type === "recurring"
                  const dest = getVerifiedDestination(editingRecord, viewMonth.year, viewMonth.month)
                  const monthLabel = lang === "ko"
                    ? `${viewMonth.year}년 ${viewMonth.month + 1}월`
                    : new Date(viewMonth.year, viewMonth.month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })
                  const setDest = (d: Destination | null) => setRecordDestination(editingRecord.id, d)
                  const baseBtn = "flex-1 flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-xs font-medium transition-colors"
                  return (
                    <div className="space-y-2 rounded-lg border border-border p-3">
                      <Label className="text-xs">
                        {lang === "ko" ? "이체 확인" : "Money moved"}
                        {isRec && <span className="text-muted-foreground"> · {monthLabel}</span>}
                      </Label>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => setDest(null)}
                          className={`${baseBtn} ${dest === null ? "border-foreground bg-muted" : "border-border hover:bg-muted/50"}`}
                        >
                          <span className="h-3 w-3 rounded-full border-2 border-muted-foreground/40 flex-shrink-0" />
                          {lang === "ko" ? "안 옮김" : "Not moved"}
                        </button>
                        {goal && (
                          <button
                            type="button"
                            onClick={() => setDest("goal")}
                            className={`${baseBtn} ${dest === "goal" ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50"}`}
                          >
                            <span className={`h-3 w-3 rounded-full bg-primary flex items-center justify-center flex-shrink-0 ${dest === "goal" ? "" : "opacity-50"}`}>
                              {dest === "goal" && <Check className="h-2 w-2 text-primary-foreground" strokeWidth={3} />}
                            </span>
                            <span className="truncate">{goal.name}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setDest("long")}
                          className={`${baseBtn} ${dest === "long" ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30" : "border-border hover:bg-muted/50"}`}
                        >
                          <span className={`h-3 w-3 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0 ${dest === "long" ? "" : "opacity-50"}`}>
                            {dest === "long" && <Check className="h-2 w-2 text-white" strokeWidth={3} />}
                          </span>
                          {lang === "ko" ? "장기" : "Long-term"}
                        </button>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        {isRec
                          ? (lang === "ko"
                            ? "반복 항목은 매달 따로 체크해요. 옮긴 돈이 어느 버킷에 가는지 선택하세요."
                            : "Recurring items are checked monthly. Pick which bucket the money went into.")
                          : (lang === "ko"
                            ? "옮긴 돈이 단기 목표로 가는지, 장기 저축으로 가는지 선택하세요."
                            : "Pick whether the moved money goes to the goal or long-term savings.")}
                      </p>
                    </div>
                  )
                })()}
                <div className="flex gap-2 pt-3">
                  <Button
                    variant="outline"
                    onClick={() => {
                      // Open the delete-with-when modal instead of confirming
                      // here so recurring records can stop at a specific day.
                      const record = editingRecord
                      setEditingRecord(null)
                      setDeletingRecord(record)
                    }}
                    className="text-destructive hover:text-destructive"
                  >
                    {lang === "ko" ? "삭제" : "Delete"}
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={() => setEditingRecord(null)}>
                    {lang === "ko" ? "취소" : "Cancel"}
                  </Button>
                  <Button className="flex-1" onClick={() => {
                    const nameInput = document.getElementById("edit-name-input") as HTMLInputElement
                    const amtInput = document.getElementById("edit-amount-input") as HTMLInputElement
                    const dateInput = document.getElementById("edit-date-input") as HTMLInputElement
                    const activeFreq = document.querySelector<HTMLElement>("[data-edit-freq-btn][data-active=true]")
                    const raw = parseFloat(amtInput.value)
                    const usd = currency === "KRW"
                      ? (Number.isFinite(raw) ? raw / krwRate : undefined)
                      : (Number.isFinite(raw) ? raw : undefined)
                    const pickedMode = (activeFreq?.dataset.mode as Mode | undefined) ?? editingRecord.type
                    const pickedFreq = activeFreq?.dataset.freq ? parseInt(activeFreq.dataset.freq, 10) : undefined
                    // Parse the date at noon to sidestep DST / TZ off-by-one issues.
                    const dateStr = dateInput.value
                    const dateTs = dateStr ? new Date(`${dateStr}T12:00:00`).getTime() : undefined
                    updateRecord(editingRecord.id, nameInput.value, usd, pickedMode, pickedFreq, dateTs)
                  }}>
                    {lang === "ko" ? "저장" : "Save"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Category editor modal (add new or edit/delete existing custom preset) */}
          {/* Delete-with-when modal — for recurring records the user picks the
              cutoff (which weekly occurrence, which day, which month) so weekly
              and daily recurrence stop precisely. Once items get a simple confirm. */}
          {/* Long-term account editor — small modal opened by tapping the long-term card.
              Just a free-text label so the user can note which account holds these funds. */}
          {longTermAccountEditorOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6" onClick={() => setLongTermAccountEditorOpen(false)}>
              <div className="w-full max-w-sm rounded-xl bg-background p-5 shadow-xl space-y-4" onClick={e => e.stopPropagation()}>
                <p className="font-semibold">
                  {lang === "ko" ? "장기 저축 계좌" : "Long-term account"}
                </p>
                <div className="space-y-1">
                  <Label className="text-xs">
                    {lang === "ko" ? "계좌 (선택)" : "Account (optional)"}
                  </Label>
                  <Input
                    autoFocus
                    type="text"
                    defaultValue={longTermAccount}
                    placeholder={lang === "ko" ? "예: 토스 ●●2345" : "e.g. Wealthfront ●●1234"}
                    maxLength={40}
                    id="lt-account-input"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    {lang === "ko" ? "계좌번호 전체는 적지 마세요" : "Don't enter the full account number"}
                  </p>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" className="flex-1" onClick={() => setLongTermAccountEditorOpen(false)}>
                    {lang === "ko" ? "취소" : "Cancel"}
                  </Button>
                  <Button className="flex-1" onClick={() => {
                    const input = document.getElementById("lt-account-input") as HTMLInputElement
                    setLongTermAccount(input.value.trim())
                    setLongTermAccountEditorOpen(false)
                  }}>
                    {lang === "ko" ? "저장" : "Save"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Verify destination modal — shown when the user toggles a row's check ON
              and a goal exists, so they can pick whether the money went to the goal
              or to long-term savings. If no goal exists, list-row check skips this
              and writes "long" directly (no choice to make). */}
          {verifyingRecord && goal && (() => {
            const r = verifyingRecord
            const closeModal = () => setVerifyingRecord(null)
            const choose = (d: Destination) => {
              setRecordDestination(r.id, d)
              closeModal()
            }
            const GoalIcon = goalIcons[goal.iconKey] ?? Target
            const monthLabel = lang === "ko"
              ? `${viewMonth.year}년 ${viewMonth.month + 1}월`
              : new Date(viewMonth.year, viewMonth.month, 1).toLocaleDateString("en-US", { month: "long" })
            return (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6" onClick={closeModal}>
                <div className="w-full max-w-sm rounded-xl bg-background p-5 shadow-xl space-y-4" onClick={e => e.stopPropagation()}>
                  <div>
                    <p className="font-semibold">
                      {lang === "ko" ? "어디로 옮겼어요?" : "Where did it go?"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 truncate">
                      {r.name}{r.type === "recurring" ? ` · ${monthLabel}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => choose("goal")}
                      className="flex items-center gap-3 rounded-lg border border-border p-4 hover:border-primary hover:bg-primary/5 transition-colors text-left"
                    >
                      <span className={`flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 ${theme.textAccent} flex-shrink-0`}>
                        <GoalIcon className="h-5 w-5" strokeWidth={1.5} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm">{goal.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {lang === "ko" ? "단기 목표로" : "To goal"}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => choose("long")}
                      className="flex items-center gap-3 rounded-lg border border-border p-4 hover:border-emerald-500 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 transition-colors text-left"
                    >
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 flex-shrink-0">
                        <PiggyBank className="h-5 w-5" strokeWidth={1.5} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm">
                          {lang === "ko" ? "장기 저축" : "Long-term savings"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {lang === "ko" ? "투자/은퇴용" : "Investment / retirement"}
                        </div>
                      </div>
                    </button>
                  </div>
                  <Button variant="outline" className="w-full" onClick={closeModal}>
                    {lang === "ko" ? "취소" : "Cancel"}
                  </Button>
                </div>
              </div>
            )
          })()}

          {deletingRecord && (() => {
            const r = deletingRecord
            const isRecurring = r.type === "recurring"
            const closeModal = () => setDeletingRecord(null)
            // Build the freq-specific list of cutoff dates the user can pick.
            // "Stop from {date}" means contributions on/after that date go away.
            type Choice = { ts: number; label: string }
            const choices: Choice[] = []
            if (isRecurring) {
              const startTs = r.date
              const startDate = new Date(startTs)
              const startDay = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate())
              const monthFirst = new Date(viewMonth.year, viewMonth.month, 1)
              const monthLast = new Date(viewMonth.year, viewMonth.month + 1, 0)
              const fmtDate = (d: Date) => lang === "ko"
                ? `${d.getMonth() + 1}월 ${d.getDate()}일부터`
                : `From ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
              if (r.freq === 12) {
                // Monthly: offer this month's start and next month's start.
                const thisMonthStart = monthFirst
                const nextMonthStart = new Date(viewMonth.year, viewMonth.month + 1, 1)
                if (thisMonthStart >= startDay) choices.push({ ts: thisMonthStart.getTime(), label: lang === "ko" ? `${viewMonth.month + 1}월부터 멈춤` : `Stop from ${thisMonthStart.toLocaleDateString("en-US", { month: "long" })}` })
                choices.push({ ts: nextMonthStart.getTime(), label: lang === "ko" ? `${viewMonth.month + 2 > 12 ? 1 : viewMonth.month + 2}월부터 멈춤` : `Stop from ${nextMonthStart.toLocaleDateString("en-US", { month: "long" })}` })
              } else if (r.freq === 52) {
                // Weekly: list each weekly occurrence inside the viewed month
                // (and the first one in the next month so the user can pick "after the last week").
                const startWeekday = startDate.getDay()
                // Find first weekly occurrence on/after monthFirst that matches start weekday
                let occ = new Date(monthFirst)
                const daysToAdd = (startWeekday - occ.getDay() + 7) % 7
                occ.setDate(occ.getDate() + daysToAdd)
                while (occ <= monthLast) {
                  if (occ >= startDay) choices.push({ ts: occ.getTime(), label: fmtDate(occ) })
                  occ = new Date(occ); occ.setDate(occ.getDate() + 7)
                }
                // Add one more = first occurrence in the next month (lets user say "stop after last week of this month")
                if (occ >= startDay) choices.push({ ts: occ.getTime(), label: fmtDate(occ) })
              } else if (r.freq === 365) {
                // Daily: too many to list — show a date input. Default = today (or first
                // day of viewMonth if today is in a different month).
                // Quick presets: today, tomorrow, first of next month.
                const now = new Date()
                const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
                const tomorrow = new Date(todayMidnight); tomorrow.setDate(tomorrow.getDate() + 1)
                const nextMonthStart = new Date(viewMonth.year, viewMonth.month + 1, 1)
                if (todayMidnight >= startDay) choices.push({ ts: todayMidnight.getTime(), label: lang === "ko" ? "오늘부터 멈춤" : "Stop from today" })
                if (tomorrow >= startDay) choices.push({ ts: tomorrow.getTime(), label: lang === "ko" ? "내일부터 멈춤" : "Stop from tomorrow" })
                if (nextMonthStart >= startDay) choices.push({ ts: nextMonthStart.getTime(), label: lang === "ko" ? `${viewMonth.month + 2 > 12 ? 1 : viewMonth.month + 2}월부터 멈춤` : `Stop from ${nextMonthStart.toLocaleDateString("en-US", { month: "long" })}` })
              }
            }
            return (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6" onClick={closeModal}>
                <div className="w-full max-w-sm rounded-xl bg-background p-5 shadow-xl space-y-4" onClick={e => e.stopPropagation()}>
                  <div>
                    <p className="font-semibold">
                      {lang === "ko" ? "삭제" : "Delete"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 truncate">{r.name}</p>
                  </div>
                  {!isRecurring ? (
                    <p className="text-sm text-muted-foreground">
                      {lang === "ko" ? "이 기록을 완전히 삭제할까요?" : "Delete this record completely?"}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        {r.freq === 365
                          ? (lang === "ko" ? "어느 날 이후로 멈출까요?" : "Stop from which day?")
                          : r.freq === 52
                            ? (lang === "ko" ? "어느 주부터 멈출까요?" : "Stop from which week?")
                            : (lang === "ko" ? "어느 달부터 멈출까요?" : "Stop from which month?")}
                      </p>
                      {/* Weekly: mini calendar grid — only weekly occurrences are tappable.
                          Mirrors the main calendar's visual language (sky dot per occurrence)
                          so the user can see at a glance "month has 4 weeks; I want to stop
                          after the 3rd one". Other days are dimmed and unclickable. */}
                      {r.freq === 52 && (() => {
                        const startTs = r.date
                        const startDate = new Date(startTs)
                        const startDay = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate())
                        const monthFirst = new Date(viewMonth.year, viewMonth.month, 1)
                        const monthLast = new Date(viewMonth.year, viewMonth.month + 1, 0)
                        const daysInMonth = monthLast.getDate()
                        const firstWeekday = monthFirst.getDay()
                        const startWeekday = startDate.getDay()
                        const occurrences = new Set<number>()
                        let occ = new Date(monthFirst)
                        occ.setDate(occ.getDate() + ((startWeekday - occ.getDay() + 7) % 7))
                        while (occ <= monthLast) {
                          if (occ >= startDay) occurrences.add(occ.getDate())
                          occ = new Date(occ); occ.setDate(occ.getDate() + 7)
                        }
                        const nextMonthFirstOcc = new Date(occ)
                        const weekdayLabels = lang === "ko"
                          ? ["일", "월", "화", "수", "목", "금", "토"]
                          : ["S", "M", "T", "W", "T", "F", "S"]
                        return (
                          <div className="space-y-2">
                            <div className="grid grid-cols-7 gap-1">
                              {weekdayLabels.map((d, i) => (
                                <div key={i} className="text-center text-[10px] font-semibold text-muted-foreground">{d}</div>
                              ))}
                            </div>
                            <div className="grid grid-cols-7 gap-1">
                              {Array.from({ length: firstWeekday }).map((_, i) => (
                                <div key={`blank-${i}`} />
                              ))}
                              {Array.from({ length: daysInMonth }).map((_, i) => {
                                const day = i + 1
                                const isOcc = occurrences.has(day)
                                if (!isOcc) {
                                  return (
                                    <div key={day} className="aspect-square flex items-center justify-center">
                                      <span className="text-xs text-muted-foreground/40">{day}</span>
                                    </div>
                                  )
                                }
                                const occTs = new Date(viewMonth.year, viewMonth.month, day).getTime()
                                return (
                                  <button
                                    key={day}
                                    type="button"
                                    onClick={() => { endRecordAt(r.id, occTs); closeModal() }}
                                    className="aspect-square rounded-md flex flex-col items-center justify-center gap-0.5 bg-sky-100 dark:bg-sky-900/30 hover:bg-sky-200 dark:hover:bg-sky-900/50 transition-colors"
                                    aria-label={lang === "ko" ? `${viewMonth.month + 1}월 ${day}일부터 멈춤` : `Stop from ${viewMonth.month + 1}/${day}`}
                                  >
                                    <span className="text-xs font-semibold leading-none">{day}</span>
                                    <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
                                  </button>
                                )
                              })}
                            </div>
                            <button
                              type="button"
                              onClick={() => { endRecordAt(r.id, nextMonthFirstOcc.getTime()); closeModal() }}
                              className="w-full rounded-md border border-border px-3 py-2 text-sm text-left hover:bg-muted transition-colors"
                            >
                              {lang === "ko"
                                ? `다음 달 ${nextMonthFirstOcc.getMonth() + 1}월 ${nextMonthFirstOcc.getDate()}일부터 멈춤`
                                : `Stop from next month (${nextMonthFirstOcc.toLocaleDateString("en-US", { month: "short", day: "numeric" })})`}
                            </button>
                          </div>
                        )
                      })()}
                      {/* Daily: same mini-calendar approach as weekly, but every day from
                          the start date onward is tappable (emerald to match the daily dot
                          in the legend). Today gets a ring so the "stop from today" action
                          is one tap away. */}
                      {r.freq === 365 && (() => {
                        const startTs = r.date
                        const startDate = new Date(startTs)
                        const startDay = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate())
                        const monthFirst = new Date(viewMonth.year, viewMonth.month, 1)
                        const monthLast = new Date(viewMonth.year, viewMonth.month + 1, 0)
                        const daysInMonth = monthLast.getDate()
                        const firstWeekday = monthFirst.getDay()
                        const today = new Date()
                        const isCurrentMonth = today.getFullYear() === viewMonth.year && today.getMonth() === viewMonth.month
                        const todayDay = isCurrentMonth ? today.getDate() : -1
                        const nextMonthFirst = new Date(viewMonth.year, viewMonth.month + 1, 1)
                        const weekdayLabels = lang === "ko"
                          ? ["일", "월", "화", "수", "목", "금", "토"]
                          : ["S", "M", "T", "W", "T", "F", "S"]
                        return (
                          <div className="space-y-2">
                            <div className="grid grid-cols-7 gap-1">
                              {weekdayLabels.map((d, i) => (
                                <div key={i} className="text-center text-[10px] font-semibold text-muted-foreground">{d}</div>
                              ))}
                            </div>
                            <div className="grid grid-cols-7 gap-1">
                              {Array.from({ length: firstWeekday }).map((_, i) => (
                                <div key={`blank-${i}`} />
                              ))}
                              {Array.from({ length: daysInMonth }).map((_, i) => {
                                const day = i + 1
                                const dayMid = new Date(viewMonth.year, viewMonth.month, day)
                                if (dayMid.getTime() < startDay.getTime()) {
                                  return (
                                    <div key={day} className="aspect-square flex items-center justify-center">
                                      <span className="text-xs text-muted-foreground/40">{day}</span>
                                    </div>
                                  )
                                }
                                const occTs = dayMid.getTime()
                                const isToday = day === todayDay
                                return (
                                  <button
                                    key={day}
                                    type="button"
                                    onClick={() => { endRecordAt(r.id, occTs); closeModal() }}
                                    className={`aspect-square rounded-md flex flex-col items-center justify-center gap-0.5 bg-emerald-100 dark:bg-emerald-900/30 hover:bg-emerald-200 dark:hover:bg-emerald-900/50 transition-colors ${isToday ? "ring-2 ring-emerald-500" : ""}`}
                                    aria-label={lang === "ko" ? `${viewMonth.month + 1}월 ${day}일부터 멈춤` : `Stop from ${viewMonth.month + 1}/${day}`}
                                  >
                                    <span className="text-xs font-semibold leading-none">{day}</span>
                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                                  </button>
                                )
                              })}
                            </div>
                            <button
                              type="button"
                              onClick={() => { endRecordAt(r.id, nextMonthFirst.getTime()); closeModal() }}
                              className="w-full rounded-md border border-border px-3 py-2 text-sm text-left hover:bg-muted transition-colors"
                            >
                              {lang === "ko"
                                ? `다음 달 ${nextMonthFirst.getMonth() + 1}월 1일부터 멈춤`
                                : `Stop from next month (${nextMonthFirst.toLocaleDateString("en-US", { month: "short" })})`}
                            </button>
                          </div>
                        )
                      })()}
                      {/* Monthly: just the two "this month / next month" buttons. */}
                      {r.freq === 12 && (
                        <div className="flex flex-col gap-1.5">
                          {choices.map(c => (
                            <button
                              key={c.ts}
                              type="button"
                              onClick={() => { endRecordAt(r.id, c.ts); closeModal() }}
                              className="rounded-md border border-border px-3 py-2 text-sm text-left hover:bg-muted transition-colors"
                            >
                              {c.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="flex flex-col gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => { removeRecordCompletely(r.id); closeModal() }}
                      className="text-xs text-destructive hover:underline text-center"
                    >
                      {lang === "ko" ? "전체 기록 완전히 삭제" : "Remove completely (including past)"}
                    </button>
                    <Button variant="outline" onClick={closeModal}>
                      {lang === "ko" ? "취소" : "Cancel"}
                    </Button>
                  </div>
                </div>
              </div>
            )
          })()}

          {categoryEditorOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6" onClick={() => setCategoryEditorOpen(false)}>
              <div className="w-full max-w-sm rounded-xl bg-background p-5 shadow-xl space-y-4" onClick={e => e.stopPropagation()}>
                <p className="font-semibold">
                  {editingCategory
                    ? (lang === "ko" ? "카테고리 편집" : "Edit category")
                    : (lang === "ko" ? "새 카테고리" : "New category")}
                </p>
                <div className="space-y-1">
                  <Label className="text-xs">{lang === "ko" ? "이름" : "Name"}</Label>
                  <Input
                    autoFocus
                    defaultValue={editingCategory?.name ?? ""}
                    maxLength={20}
                    id="cat-name-input"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{currency === "KRW" ? t.amountKRW : t.amountUSD}</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    defaultValue={editingCategory
                      ? (currency === "KRW"
                        ? String(Math.round(editingCategory.usdAmt * krwRate))
                        : String(editingCategory.usdAmt))
                      : ""}
                    id="cat-amount-input"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{lang === "ko" ? "빈도" : "Frequency"}</Label>
                  <div className="flex rounded-lg border border-border overflow-hidden">
                    {([
                      { label: t.oneTime, mode: "once" as Mode, freq: 1 },
                      { label: t.daily, mode: "recurring" as Mode, freq: 365 },
                      { label: t.weekly, mode: "recurring" as Mode, freq: 52 },
                      { label: t.monthly, mode: "recurring" as Mode, freq: 12 },
                    ]).map((opt, i, arr) => {
                      const currentMode = editingCategory?.mode ?? "once"
                      const currentFreq = editingCategory?.freq ?? (currentMode === "recurring" ? 12 : 1)
                      const isActive = opt.mode === "once"
                        ? currentMode === "once"
                        : currentMode === "recurring" && currentFreq === opt.freq
                      return (
                        <button
                          key={opt.label}
                          type="button"
                          data-cat-freq-btn
                          data-mode={opt.mode}
                          data-freq={opt.freq}
                          data-active={isActive ? "true" : undefined}
                          onClick={() => {
                            document.querySelectorAll("[data-cat-freq-btn]").forEach(el => el.removeAttribute("data-active"))
                            ;(document.querySelector(`[data-cat-freq-btn][data-mode="${opt.mode}"][data-freq="${opt.freq}"]`) as HTMLElement | null)?.setAttribute("data-active", "true")
                          }}
                          className={`flex-1 py-2 text-xs font-semibold transition-colors ${i < arr.length - 1 ? "border-r border-border" : ""} data-[active=true]:bg-primary data-[active=true]:text-primary-foreground text-muted-foreground hover:text-foreground`}
                        >
                          {opt.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div className="flex gap-2 pt-3">
                  {editingCategory && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (window.confirm(lang === "ko" ? "카테고리를 삭제할까요?" : "Delete this category?")) {
                          setCustomPresets(prev => prev.filter(c => c.id !== editingCategory.id))
                          setCategoryEditorOpen(false)
                        }
                      }}
                      className="text-destructive hover:text-destructive"
                    >
                      {lang === "ko" ? "삭제" : "Delete"}
                    </Button>
                  )}
                  <Button variant="outline" className="flex-1" onClick={() => setCategoryEditorOpen(false)}>
                    {lang === "ko" ? "취소" : "Cancel"}
                  </Button>
                  <Button className="flex-1" onClick={() => {
                    const nameInput = document.getElementById("cat-name-input") as HTMLInputElement
                    const amtInput = document.getElementById("cat-amount-input") as HTMLInputElement
                    const activeFreq = document.querySelector<HTMLElement>("[data-cat-freq-btn][data-active=true]")
                    const name = nameInput.value.trim()
                    if (!name) { nameInput.focus(); return }
                    const raw = parseFloat(amtInput.value)
                    if (!Number.isFinite(raw) || raw <= 0) { amtInput.focus(); return }
                    const usd = currency === "KRW" ? raw / krwRate : raw
                    const pickedMode = (activeFreq?.dataset.mode as Mode | undefined) ?? editingCategory?.mode ?? "once"
                    const pickedFreq = activeFreq?.dataset.freq ? parseInt(activeFreq.dataset.freq, 10) : undefined
                    const next: CustomPreset = {
                      id: editingCategory?.id ?? crypto.randomUUID(),
                      name,
                      usdAmt: usd,
                      mode: pickedMode,
                      freq: pickedMode === "recurring" ? (pickedFreq ?? 12) : undefined,
                    }
                    setCustomPresets(prev => editingCategory
                      ? prev.map(c => c.id === next.id ? next : c)
                      : [...prev, next])
                    setCategoryEditorOpen(false)
                  }}>
                    {lang === "ko" ? "저장" : "Save"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Example table */}
          {!examplesDismissed && (
          <div className="mt-1">
            <div className="mb-1.5 flex items-center justify-between px-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {lang === "ko" ? "사용예 (샘플)" : "Examples (sample)"}
              </p>
              <button
                onClick={() => setExamplesDismissed(true)}
                className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
                aria-label={lang === "ko" ? "샘플 숨기기" : "Hide samples"}
              >
                {lang === "ko" ? "숨기기" : "Hide"}
                <X className="h-3 w-3" strokeWidth={1.5} />
              </button>
            </div>
            <Card className="overflow-hidden">
              <div className="flex border-b border-border px-4 py-2">
                <span className="flex-1 text-xs font-semibold text-muted-foreground">{lang === "ko" ? "항목" : "Item"}</span>
                {horizons.map(h => (
                  <span key={h} className="w-16 text-right text-xs font-semibold text-muted-foreground">
                    {lang === "ko" ? `${h}년 후` : `In ${h}Y`}
                  </span>
                ))}
              </div>
              {exampleData.map((ex, index) => (
                <div key={ex.key} className={`flex items-center px-4 py-2.5 ${index < exampleData.length - 1 ? "border-b border-border" : ""}`}>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium flex items-center gap-1.5">
                      <ex.Icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                      {t.presets[ex.key]}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {fmt(ex.usd)}{ex.isRecurring
                        ? ex.freq === 365 ? (lang === "ko" ? "/일" : "/d")
                        : ex.freq === 52 ? (lang === "ko" ? "/주" : "/w")
                        : (lang === "ko" ? "/월" : "/m")
                        : (lang === "ko" ? " 일회성" : " once")}
                      {ex.isRecurring && ex.freq !== 12 && (
                        <span> · {fmt(ex.monthly)}{lang === "ko" ? "/월" : "/m"}</span>
                      )}
                    </div>
                  </div>
                  {horizons.map(h => (
                    <div key={h} className={`w-16 text-right text-xs font-medium ${theme.textAccent}`}>
                      {fmt(ex.fvByHorizon[h])}
                    </div>
                  ))}
                </div>
              ))}
            </Card>
            <p className="mt-1.5 text-center text-xs text-muted-foreground">{noteText}</p>
          </div>
          )}
        </div>

        {/* Floating + button */}
        <button
          onClick={() => setView("calculator")}
          className="fixed bottom-8 right-1/2 translate-x-1/2 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg active:scale-95 transition-transform"
        >
          <Plus className="h-6 w-6" />
        </button>
      </div>
    )
  }

  // ── CALCULATOR VIEW ──
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-3 px-4 pb-8 pt-4">
        <Header showBack />

        <div className="flex flex-1 flex-col gap-3">
          {/* Mode + frequency combined segment */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            {([
              { label: t.oneTime, freq: null },
              { label: t.daily, freq: "365" },
              { label: t.weekly, freq: "52" },
              { label: t.monthly, freq: "12" },
            ] as { label: string; freq: FrequencyValue | null }[]).map(({ label, freq }, i, arr) => {
              const isActive = freq === null ? mode === "once" : mode === "recurring" && frequency === freq
              return (
                <button
                  key={label}
                  onClick={() => {
                    if (freq === null) setMode("once")
                    else { setMode("recurring"); setFrequency(freq) }
                  }}
                  className={`flex-1 py-2 text-xs font-semibold transition-colors ${i < arr.length - 1 ? "border-r border-border" : ""} ${isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >{label}</button>
              )
            })}
          </div>

          {/* Item name + presets */}
          <Card>
            <CardContent className="px-3 pt-3 pb-3 space-y-2">
              <Input
                value={itemName}
                onChange={e => setItemName(e.target.value)}
                placeholder={t.itemPlaceholder}
                maxLength={40}
                className="h-8 text-sm"
              />
              <div className="flex flex-wrap gap-1.5">
                {presetItems.map(item => (
                  <Badge
                    key={item.key}
                    variant="secondary"
                    className="cursor-pointer rounded-full px-2 py-0.5 text-xs whitespace-nowrap"
                    onClick={() => {
                      setItemName(t.presets[item.key])
                      setAmount(currency === "KRW"
                        ? String(Math.round(item.usd * krwRate / 1000) * 1000)
                        : String(item.usd))
                      setMode(item.defaultMode)
                      if (item.defaultMode === "recurring" && item.defaultFreq) {
                        setFrequency(item.defaultFreq)
                      }
                    }}
                  >
                    <item.Icon className="mr-1 h-3 w-3" strokeWidth={1.5} />{t.presets[item.key]}
                  </Badge>
                ))}
                {customPresets.map(cp => (
                  <div
                    key={cp.id}
                    className="inline-flex items-center rounded-full bg-secondary text-secondary-foreground text-xs whitespace-nowrap"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setItemName(cp.name)
                        setAmount(currency === "KRW"
                          ? String(Math.round(cp.usdAmt * krwRate / 1000) * 1000)
                          : String(cp.usdAmt))
                        setMode(cp.mode)
                        if (cp.mode === "recurring" && cp.freq) {
                          setFrequency(String(cp.freq) as FrequencyValue)
                        }
                      }}
                      className="flex items-center gap-1 pl-2 py-0.5 font-semibold hover:opacity-80"
                    >
                      <Tag className="h-3 w-3" strokeWidth={1.5} />{cp.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setEditingCategory(cp); setCategoryEditorOpen(true) }}
                      className="px-1.5 py-0.5 text-muted-foreground hover:text-foreground"
                      aria-label={lang === "ko" ? "편집" : "Edit"}
                    >
                      <Pencil className="h-3 w-3" strokeWidth={1.5} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => { setEditingCategory(null); setCategoryEditorOpen(true) }}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/40"
                >
                  <Plus className="h-3 w-3" strokeWidth={1.5} />
                  {lang === "ko" ? "새 카테고리" : "New"}
                </button>
              </div>
            </CardContent>
          </Card>

          {/* Amount + rate */}
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex gap-2 items-end">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">{currency === "KRW" ? t.amountKRW : t.amountUSD}</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="w-24 space-y-1">
                  <Label className="text-xs whitespace-nowrap">{t.annualReturn}</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={rate}
                    onChange={e => setRate(e.target.value)}
                    className="h-9"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Save button — sits right below the entered amount */}
          <Button className="w-full" onClick={saveRecord}>
            <Wallet className="mr-2 h-4 w-4" />
            {saveFlash
              ? t.saved
              : calc.usdAmt > 0
                ? lang === "ko"
                  ? `${fmt(calc.usdAmt)} 저장`
                  : `Save ${fmt(calc.usdAmt)}`
                : t.saveRecord}
          </Button>

          {/* Preview — compact compound-growth curve from 0 to 30 years. The curve shape
              IS the message (compounding accelerates), so it's intentionally understated. */}
          {calc.usdAmt > 0 && (() => {
            const r = parseFloat(rate) || 0
            const freq = parseFloat(frequency)
            const annual = calc.usdAmt * freq
            const fvAt = (y: number) => mode === "once"
              ? fvLump(calc.usdAmt, r, y)
              : fvRecurring(annual, r, y, freq)
            const maxY = 30
            const values = Array.from({ length: maxY + 1 }, (_, i) => fvAt(i))
            const vMax = values[maxY] || 1
            const W = 320
            const H = 90
            const padT = 14
            const padR = 16
            const padL = 16
            const padB = 14
            const chartW = W - padL - padR
            const chartH = H - padT - padB
            const xAt = (y: number) => padL + (y / maxY) * chartW
            const yAt = (v: number) => padT + (1 - v / vMax) * chartH
            // Smooth cubic path through the value points
            const pts = values.map((v, i) => ({ x: xAt(i), y: yAt(v) }))
            let linePath = `M ${pts[0].x},${pts[0].y}`
            for (let i = 1; i < pts.length; i++) {
              const midX = (pts[i - 1].x + pts[i].x) / 2
              linePath += ` C ${midX},${pts[i - 1].y} ${midX},${pts[i].y} ${pts[i].x},${pts[i].y}`
            }
            const areaPath = `${linePath} L ${pts[maxY].x},${padT + chartH} L ${pts[0].x},${padT + chartH} Z`
            const gradId = `preview-${theme.primaryHsl.replace(/[^a-z0-9]/gi, "")}`
            const anchors = [10, 20, 30]
            return (
              <Card className="bg-muted/30">
                <CardContent className="px-4 py-3 space-y-1">
                  <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor={`hsl(${theme.primaryHsl})`} stopOpacity="0.22" />
                        <stop offset="100%" stopColor={`hsl(${theme.primaryHsl})`} stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path d={areaPath} fill={`url(#${gradId})`} />
                    <path
                      d={linePath}
                      fill="none"
                      stroke={`hsl(${theme.primaryHsl})`}
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={0.85}
                    />
                    {anchors.map(y => {
                      const cx = xAt(y)
                      const cy = yAt(values[y])
                      // Keep value label inside the viewBox: anchor to the end at the
                      // right-most point so it extends leftward instead of getting clipped.
                      const isEnd = y === maxY
                      const labelAnchor: "start" | "middle" | "end" = isEnd ? "end" : "middle"
                      const labelX = isEnd ? cx : cx
                      const labelY = Math.max(9, cy - 5)
                      return (
                        <g key={y}>
                          <circle cx={cx} cy={cy} r={2.5} fill={`hsl(${theme.primaryHsl})`} />
                          <text
                            x={labelX}
                            y={labelY}
                            textAnchor={labelAnchor}
                            className="fill-foreground"
                            fontSize="10"
                            fontWeight="600"
                          >
                            {fmt(values[y])}
                          </text>
                          <text
                            x={cx}
                            y={H - 3}
                            textAnchor="middle"
                            className="fill-muted-foreground"
                            fontSize="9"
                          >
                            {lang === "ko" ? `${y}년` : `${y}Y`}
                          </text>
                        </g>
                      )
                    })}
                  </svg>
                  <p className="text-[10px] text-muted-foreground text-center">
                    {lang === "ko"
                      ? `연 ${rate}% 복리 가정`
                      : `Assuming ${rate}%/yr compound`}
                  </p>
                </CardContent>
              </Card>
            )
          })()}

          <p className="text-center text-xs text-muted-foreground">{noteText}</p>
        </div>
      </div>
    </div>
  )
}
