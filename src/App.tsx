import { useState, useMemo, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Wallet, Plus, ArrowLeft, Settings, Coffee, ShoppingBag, Shirt, Utensils, Tv, ShoppingCart, UtensilsCrossed, X, ChevronLeft, ChevronRight, ChevronDown, Check, Target, Plane, Home, Car, GraduationCap, Heart, PiggyBank, Trophy } from "lucide-react"
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
  endYear?: number
  endMonth?: number // 0-11
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

type Goal = {
  id: string
  name: string
  iconKey: GoalIconKey
  targetUsd: number
  deadline?: number // timestamp, optional
  createdAt: number
  achievedAt?: number
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
  { key: "coffee", Icon: Coffee, usd: 7, defaultMode: "once" },
  { key: "bag", Icon: ShoppingBag, usd: 800, defaultMode: "once" },
  { key: "clothes", Icon: Shirt, usd: 150, defaultMode: "once" },
  { key: "delivery", Icon: Utensils, usd: 25, defaultMode: "once" },
  { key: "subscription", Icon: Tv, usd: 15, defaultMode: "recurring", defaultFreq: "12" },
  { key: "impulse", Icon: ShoppingCart, usd: 50, defaultMode: "once" },
  { key: "dining", Icon: UtensilsCrossed, usd: 60, defaultMode: "once" },
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
function contributionForMonth(usdAmt: number, freq: number, startTs: number, year: number, month: number) {
  if (freq === 12) return usdAmt
  const startDate = new Date(startTs)
  const sy = startDate.getFullYear()
  const sm = startDate.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const isStartMonth = sy === year && sm === month
  const activeDays = isStartMonth
    ? Math.max(0, daysInMonth - startDate.getDate() + 1)
    : daysInMonth
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
  const [horizons, setHorizons] = useState<number[]>([10, 20])
  const [examplesDismissed, setExamplesDismissed] = useState(false)
  const [horizonMenuOpen, setHorizonMenuOpen] = useState(false)
  const [goal, setGoal] = useState<Goal | null>(null)
  const [goalEditorOpen, setGoalEditorOpen] = useState(false)
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
    if (!raw) return
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
      if (Array.isArray(p.horizons) && p.horizons.every((n: unknown) => typeof n === "number")) {
        setHorizons(p.horizons)
      }
      if (typeof p.examplesDismissed === "boolean") setExamplesDismissed(p.examplesDismissed)
      if (p.goal && typeof p.goal === "object" && typeof p.goal.targetUsd === "number") {
        // Validate iconKey, default to target if unknown
        const icon = (p.goal.iconKey && goalIcons[p.goal.iconKey as GoalIconKey]) ? p.goal.iconKey : "target"
        setGoal({ ...p.goal, iconKey: icon })
      }
      if (p.krwRateSource === "manual" || p.krwRateSource === "auto") setKrwRateSource(p.krwRateSource)
      if (typeof p.krwRateManual === "number" && p.krwRateManual > 0) setKrwRateManual(p.krwRateManual)
      if (typeof p.krwRateAuto === "number" && p.krwRateAuto > 0) setKrwRateAuto(p.krwRateAuto)
      if (typeof p.krwRateAutoFetchedAt === "number") setKrwRateAutoFetchedAt(p.krwRateAutoFetchedAt)
    } catch { /* ignore */ }
  }, [])

  // Save to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      lang, currency, mode, isDark, themeColor, itemName, amount, rate, frequency, years, records, horizons, examplesDismissed, goal,
      krwRateSource, krwRateManual, krwRateAuto, krwRateAutoFetchedAt,
    }))
  }, [lang, currency, mode, isDark, themeColor, itemName, amount, rate, frequency, years, records, horizons, examplesDismissed, goal, krwRateSource, krwRateManual, krwRateAuto, krwRateAutoFetchedAt])

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
      // At/after end?
      if (item.endYear !== undefined && item.endMonth !== undefined) {
        if (cmpYM(viewMonth.year, viewMonth.month, item.endYear, item.endMonth) >= 0) return false
      }
      return true
    })
    let monthSaved = 0
    const horizonSums: Record<number, number> = {}
    horizons.forEach(h => { horizonSums[h] = 0 })
    const enriched = [...scoped].sort((a, b) => b.date - a.date).map(item => {
      // Legacy recurring records without freq default to monthly (12)
      const isRecurring = item.type === "recurring"
      const freq = item.freq ?? (isRecurring ? 12 : 1)
      // Calendar-based monthly amount with start-date proration for daily/weekly.
      // e.g. $25/wk registered Apr 18 → April counts Apr 18–30 (13 days), May onward counts full month.
      const monthAmt = isRecurring
        ? contributionForMonth(item.usdAmt, freq, item.date, viewMonth.year, viewMonth.month)
        : item.usdAmt
      const fvByHorizon: Record<number, number> = {}
      const fvRecurringByHorizon: Record<number, number> = {}
      horizons.forEach(h => {
        const lumpValue = fvLump(monthAmt, r, h)
        fvByHorizon[h] = lumpValue
        horizonSums[h] += lumpValue
        if (isRecurring) {
          const annual = item.usdAmt * freq
          fvRecurringByHorizon[h] = fvRecurring(annual, r, h, freq)
        }
      })
      monthSaved += monthAmt
      return { ...item, fvByHorizon, fvRecurringByHorizon, isRecurring, freq, monthAmt }
    })
    return { enriched, monthSaved, horizonSums }
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
        const endAbsExclusive = (item.endYear !== undefined && item.endMonth !== undefined)
          ? item.endYear * 12 + item.endMonth
          : throughAbsInclusive + 1
        const cap = Math.min(endAbsExclusive, throughAbsInclusive + 1)
        // Sum calendar-based contribution for each active month (prorates start month)
        for (let abs = startAbs; abs < cap; abs++) {
          const y = Math.floor(abs / 12)
          const m = abs % 12
          total += contributionForMonth(item.usdAmt, freq, item.date, y, m)
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

  function fmt(usd: number) {
    if (currency === "KRW") {
      const won = Math.round(usd * krwRate)
      if (won >= 100000000) return `₩${(won / 100000000).toFixed(1)}억`
      if (won >= 10000) return `₩${Math.round(won / 10000)}만`
      return `₩${won.toLocaleString("ko-KR")}`
    }
    if (usd >= 1000000) return `$${(usd / 1000000).toFixed(2)}M`
    if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}K`
    return `$${Math.round(usd).toLocaleString("en-US")}`
  }

  function fmtExact(usd: number) {
    return currency === "KRW"
      ? `₩${Math.round(usd * krwRate).toLocaleString("ko-KR")}`
      : `$${usd.toFixed(2)}`
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
    setRecords(prev => [{
      id: crypto.randomUUID(),
      name: itemName.trim() || t.unnamed,
      usdAmt: calc.usdAmt,
      date: Date.now(),
      type: mode,
      freq: mode === "recurring" ? (parseFloat(frequency) || 12) : 1,
    }, ...prev])
    setSaveFlash(true)
    setTimeout(() => {
      setSaveFlash(false)
      setView("list")
    }, 800)
  }

  function deleteRecord(id: string) {
    setRecords(prev => prev.flatMap(r => {
      if (r.id !== id) return [r]
      // Once: always remove entirely
      if (r.type !== "recurring") return []
      // Recurring: if viewing at-or-before the start month, remove entirely.
      // Otherwise set end = viewMonth so the recurring stops from viewMonth onward.
      const d = new Date(r.date)
      const startCmp = (viewMonth.year - d.getFullYear()) || (viewMonth.month - d.getMonth())
      if (startCmp <= 0) return []
      return [{ ...r, endYear: viewMonth.year, endMonth: viewMonth.month }]
    }))
  }

  function updateRecord(id: string, name: string, usdAmt?: number) {
    setRecords(prev => prev.map(r => {
      if (r.id !== id) return r
      const nextAmt = usdAmt !== undefined && usdAmt > 0 ? usdAmt : r.usdAmt
      return { ...r, name, usdAmt: nextAmt }
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

  function saveGoal(input: { name: string; iconKey: GoalIconKey; targetUsd: number; deadline?: number }) {
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

  const heroLabel = lang === "ko"
    ? `${years}${t.years} 후 미래가치`
    : `${t.futureValueIn} ${years} ${t.years}`
  const heroSub = `${t.principal} ${fmt(calc.principal)}${mode === "recurring" ? ` (${t.totalContributed})` : ""}`
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
      <button
        onClick={() => setView("settings")}
        className="rounded-md border border-border p-1.5 text-muted-foreground"
      >
        <Settings className="h-3.5 w-3.5" />
      </button>
    </div>
  )

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

          {/* Time horizons shown in list */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {lang === "ko" ? "리스트 기간 표시" : "Horizons shown in list"}
            </Label>
            <div className="flex gap-2">
              {[10, 20, 30].map(h => {
                const active = horizons.includes(h)
                return (
                  <button
                    key={h}
                    onClick={() => {
                      if (active) {
                        // prevent empty selection
                        if (horizons.length > 1) setHorizons(horizons.filter(x => x !== h))
                      } else {
                        setHorizons([...horizons, h].sort((a, b) => a - b))
                      }
                    }}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${active ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
                  >
                    {lang === "ko" ? `${h}년` : `${h}Y`}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {lang === "ko" ? "최소 하나는 선택되어야 해요." : "At least one must be selected."}
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

          {/* Goal card */}
          {goal ? (() => {
            // Committed = actual + recurring commitments through deadline. This is the headline.
            const committed = projectedByDeadline
            const committedPct = Math.min(100, (committed / goal.targetUsd) * 100)
            const isAchieved = !!goal.achievedAt
            const GoalIcon = goalIcons[goal.iconKey] ?? Target
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
            const futureCommitment = Math.max(0, committed - totalSaved)
            return (
              <Card className={`overflow-hidden ${isAchieved ? "border-primary" : ""}`}>
                <button className="w-full text-left" onClick={() => setGoalEditorOpen(true)}>
                  <CardContent className="p-4 space-y-2">
                    {isAchieved ? (
                      <div className="flex items-center gap-2">
                        <Trophy className={`h-5 w-5 ${theme.textAccent}`} strokeWidth={1.5} />
                        <span className="font-bold text-sm">
                          {lang === "ko" ? `${goal.name} 달성!` : `${goal.name} achieved!`}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <GoalIcon className={`h-5 w-5 flex-shrink-0 ${theme.textAccent}`} strokeWidth={1.5} />
                          <span className="font-bold text-sm truncate">{goal.name}</span>
                        </div>
                        <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">
                          {fmt(committed)} / {fmt(goal.targetUsd)}
                        </span>
                      </div>
                    )}
                    {/* Progress bar: solid = committed (actual + recurring commitments to deadline) */}
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${committedPct}%` }}
                      />
                    </div>
                    {/* Meta line */}
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {committedPct.toFixed(1)}%
                        {goal.deadline && futureCommitment > 0 && (
                          <span className="ml-1 text-muted-foreground/70">
                            {lang === "ko"
                              ? `(실제 ${fmt(totalSaved)} + 예정 ${fmt(futureCommitment)})`
                              : `(saved ${fmt(totalSaved)} + committed ${fmt(futureCommitment)})`}
                          </span>
                        )}
                      </span>
                      {!isAchieved && goal.deadline && daysLeft !== null ? (
                        onTrack ? (
                          <span className={theme.textAccent}>
                            {lang === "ko" ? `${daysLeft}일 · 이대로면 달성 ✓` : `${daysLeft}d · on track ✓`}
                          </span>
                        ) : (
                          <span>
                            {lang === "ko"
                              ? `${daysLeft}일 · 월 +${fmt(extraMonthlyNeeded)} 더 필요`
                              : `${daysLeft}d · +${fmt(extraMonthlyNeeded)}/mo needed`}
                          </span>
                        )
                      ) : isAchieved ? (
                        <span className={theme.textAccent}>
                          {lang === "ko" ? "축하해요 🎉" : "Congrats 🎉"}
                        </span>
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

          {/* Month navigator */}
          {records.length > 0 && (() => {
            const now = new Date()
            const isCurrent = viewMonth.year === now.getFullYear() && viewMonth.month === now.getMonth()
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
                  disabled={isCurrent}
                  className="rounded-md p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label={lang === "ko" ? "다음 달" : "Next month"}
                >
                  <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </div>
            )
          })()}

          {/* Horizon selector (dropdown) */}
          {records.length > 0 && (
            <div className="relative flex items-center justify-end px-1">
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
                      const active = horizons.includes(h)
                      const isLast = horizons.length === 1 && active
                      return (
                        <button
                          key={h}
                          disabled={isLast}
                          onClick={() => {
                            if (active) {
                              if (horizons.length > 1) setHorizons(horizons.filter(x => x !== h))
                            } else {
                              setHorizons([...horizons, h].sort((a, b) => a - b))
                            }
                          }}
                          className="flex items-center justify-between px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-60 disabled:hover:bg-transparent"
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

          {/* Saved records for selected month */}
          {historySummary.enriched.length > 0 ? (
            <Card className="overflow-hidden">
              {/* Header row */}
              <div className="flex items-center border-b border-border px-4 py-2">
                <span className="flex-1 text-xs font-semibold text-muted-foreground">{lang === "ko" ? "항목" : "Item"}</span>
                {horizons.map(h => (
                  <span key={h} className="w-14 text-right text-xs font-semibold text-muted-foreground">
                    {lang === "ko" ? `${h}년 후` : `In ${h}Y`}
                  </span>
                ))}
                <span className="w-8" />
              </div>
              {historySummary.enriched.map((item, index) => {
                const freqSuffix = item.isRecurring
                  ? item.freq === 365 ? (lang === "ko" ? "/일" : "/day")
                  : item.freq === 52 ? (lang === "ko" ? "/주" : "/wk")
                  : (lang === "ko" ? "/월" : "/mo")
                  : ""
                return (
                  <div key={item.id} className={`flex items-start px-4 py-2.5 ${index < historySummary.enriched.length - 1 ? "border-b border-border" : ""}`}>
                    <button
                      className="flex-1 min-w-0 text-left"
                      onClick={() => setEditingRecord(item)}
                      aria-label={lang === "ko" ? "편집" : "Edit"}
                    >
                      <div className="font-semibold truncate">{item.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {fmtExact(item.monthAmt)}
                        {item.isRecurring && item.freq !== 12 && (
                          <span> ({fmtExact(item.usdAmt)}{freqSuffix})</span>
                        )}
                        {item.isRecurring && item.freq === 12 && (
                          <span>{freqSuffix}</span>
                        )}
                      </div>
                    </button>
                    {horizons.map(h => (
                      <div key={h} className={`w-14 text-right text-xs font-medium ${theme.textAccent}`}>
                        <div>{fmt(item.fvByHorizon[h])}</div>
                        {item.isRecurring && (
                          <div className="text-[10px] font-normal text-muted-foreground">
                            ({fmt(item.fvRecurringByHorizon[h])})
                          </div>
                        )}
                      </div>
                    ))}
                    <button
                      onClick={() => deleteRecord(item.id)}
                      className="w-8 flex justify-end pt-0.5 text-muted-foreground hover:text-destructive transition-colors"
                      aria-label={lang === "ko" ? "삭제" : "Delete"}
                    >
                      <X className="h-4 w-4" strokeWidth={1.5} />
                    </button>
                  </div>
                )
              })}

              {/* Totals — labels on one row, amounts on the next, all column-aligned */}
              <div className="border-t-2 border-border bg-muted/40 px-4 py-2.5">
                {/* Label row */}
                <div className="flex items-center">
                  <span className="flex-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {lang === "ko" ? "이 달 합계" : "Month total"}
                  </span>
                  <span
                    className="text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                    style={{ width: `${horizons.length * 3.5}rem` }}
                  >
                    {lang === "ko" ? "미래 합계" : "Future total"}
                  </span>
                  <span className="w-8" />
                </div>
                {/* Amount row */}
                <div className="mt-1 flex items-center">
                  <span className="flex-1 text-base font-extrabold">{fmt(historySummary.monthSaved)}</span>
                  {horizons.map(h => (
                    <div key={h} className={`w-14 text-right text-sm font-bold ${theme.textAccent}`}>
                      {fmt(historySummary.horizonSums[h])}
                    </div>
                  ))}
                  <span className="w-8" />
                </div>
              </div>
            </Card>
          ) : records.length > 0 && (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                {lang === "ko" ? "이 달 기록 없음" : "No savings this month"}
              </CardContent>
            </Card>
          )}

          {/* Goal editor modal */}
          {goalEditorOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6" onClick={() => setGoalEditorOpen(false)}>
              <div className="w-full max-w-sm rounded-xl bg-background p-5 shadow-xl space-y-3" onClick={e => e.stopPropagation()}>
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
                  <Label className="text-xs">
                    {lang === "ko"
                      ? (currency === "KRW" ? "목표 금액 (₩)" : "목표 금액 ($)")
                      : (currency === "KRW" ? "Target (₩)" : "Target ($)")}
                  </Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    defaultValue={goal ? String(currency === "KRW" ? Math.round(goal.targetUsd * krwRate) : goal.targetUsd) : ""}
                    placeholder={currency === "KRW" ? "6900000" : "5000"}
                    id="goal-target-input"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">
                    {lang === "ko" ? "목표 날짜 (선택)" : "Deadline (optional)"}
                  </Label>
                  <Input
                    type="date"
                    defaultValue={goal?.deadline ? new Date(goal.deadline).toISOString().slice(0, 10) : ""}
                    id="goal-deadline-input"
                  />
                </div>
                <div className="flex gap-2 pt-1">
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
                    const selectedIconEl = document.querySelector<HTMLElement>("[data-goal-icon-btn][data-selected=true]")
                    const iconKey = (selectedIconEl?.dataset.iconKey as GoalIconKey | undefined) ?? goal?.iconKey ?? "target"
                    const name = nameInput.value.trim() || (lang === "ko" ? "내 목표" : "My goal")
                    const rawTarget = parseFloat(targetInput.value)
                    if (!Number.isFinite(rawTarget) || rawTarget <= 0) return
                    const targetUsd = currency === "KRW" ? rawTarget / krwRate : rawTarget
                    const deadlineStr = deadlineInput.value
                    const deadline = deadlineStr ? new Date(deadlineStr + "T00:00:00").getTime() : undefined
                    saveGoal({ name, iconKey, targetUsd, deadline })
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
              <div className="w-full max-w-sm rounded-xl bg-background p-5 shadow-xl space-y-3" onClick={e => e.stopPropagation()}>
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
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setEditingRecord(null)}>
                    {lang === "ko" ? "취소" : "Cancel"}
                  </Button>
                  <Button className="flex-1" onClick={() => {
                    const nameInput = document.getElementById("edit-name-input") as HTMLInputElement
                    const amtInput = document.getElementById("edit-amount-input") as HTMLInputElement
                    const raw = parseFloat(amtInput.value)
                    const usd = currency === "KRW"
                      ? (Number.isFinite(raw) ? raw / krwRate : undefined)
                      : (Number.isFinite(raw) ? raw : undefined)
                    updateRecord(editingRecord.id, nameInput.value, usd)
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
                        ? ex.freq === 365 ? (lang === "ko" ? "/일" : "/day")
                        : ex.freq === 52 ? (lang === "ko" ? "/주" : "/wk")
                        : (lang === "ko" ? "/월" : "/mo")
                        : (lang === "ko" ? " 일회성" : " once")}
                      {ex.isRecurring && ex.freq !== 12 && (
                        <span> · {fmt(ex.monthly)}{lang === "ko" ? "/월" : "/mo"}</span>
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
              <div className="flex gap-1.5 overflow-x-auto pb-0.5" style={{ WebkitOverflowScrolling: "touch" }}>
                {presetItems.map(item => (
                  <Badge
                    key={item.key}
                    variant="secondary"
                    className="cursor-pointer rounded-full px-2 py-0.5 text-xs whitespace-nowrap flex-shrink-0"
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

          {/* Preview (with period controls inside) */}
          <div>
            <p className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preview</p>
            <Card>
              <CardContent className="px-5 py-4">
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground">{heroLabel}</div>
                    <div className="mt-0.5 text-4xl font-black tracking-tight">{fmt(calc.fvMain)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{heroSub}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">{t.gain}</div>
                    <div className={`mt-0.5 text-xl font-bold ${theme.textAccent}`}>+{fmt(calc.gain)}</div>
                  </div>
                </div>

                {/* Period controls */}
                <div className="mt-4 pt-4 border-t border-border">
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs text-muted-foreground">{t.investmentPeriod}</Label>
                    <span className="text-sm font-bold">{years} {t.years}</span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5 mb-2">
                    {[5, 10, 20, 30].map(v => (
                      <Button key={v} variant={years === v ? "default" : "outline"} size="sm"
                        className="h-7 text-xs" onClick={() => setYears(v)}>
                        {lang === "ko" ? `${v}년` : `${v}Y`}
                      </Button>
                    ))}
                  </div>
                  <Slider value={[years]} min={1} max={40} step={1}
                    onValueChange={v => setYears(v[0] ?? 10)} />
                </div>

                <div className="mt-3 pt-3 border-t border-border">
                  <p className="text-xs text-muted-foreground">
                    {lang === "ko"
                      ? `연 ${rate}% 복리로 ${years}년간 굴렸을 때예요. 복리는 수익이 수익을 낳아요.`
                      : `At ${rate}%/yr compounded over ${years} years. Compound interest means your gains earn gains.`}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          <p className="text-center text-xs text-muted-foreground">{noteText}</p>
        </div>
      </div>
    </div>
  )
}
