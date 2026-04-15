import { useState, useMemo, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Wallet, Plus, ArrowLeft, Settings, Coffee, ShoppingBag, Shirt, Utensils, Tv, ShoppingCart, UtensilsCrossed, X, ChevronLeft, ChevronRight, ChevronDown, Check } from "lucide-react"
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

const KRW_RATE = 1380
const STORAGE_KEY = "instead-react-v2"

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

const presetItems: { key: "coffee" | "bag" | "clothes" | "delivery" | "subscription" | "impulse" | "dining"; Icon: LucideIcon; usd: number }[] = [
  { key: "coffee", Icon: Coffee, usd: 7 },
  { key: "bag", Icon: ShoppingBag, usd: 800 },
  { key: "clothes", Icon: Shirt, usd: 150 },
  { key: "delivery", Icon: Utensils, usd: 25 },
  { key: "subscription", Icon: Tv, usd: 15 },
  { key: "impulse", Icon: ShoppingCart, usd: 50 },
  { key: "dining", Icon: UtensilsCrossed, usd: 60 },
]

function fvLump(p: number, r: number, y: number) {
  return p * Math.pow(1 + r / 100, y)
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

  const t = i18n[lang]
  const theme = themes[themeColor]

  // Load from localStorage
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
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
    } catch { /* ignore */ }
  }, [])

  // Save to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      lang, currency, mode, isDark, themeColor, itemName, amount, rate, frequency, years, records, horizons, examplesDismissed
    }))
  }, [lang, currency, mode, isDark, themeColor, itemName, amount, rate, frequency, years, records, horizons, examplesDismissed])

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
    const usdAmt = currency === "KRW" ? rawAmt / KRW_RATE : rawAmt
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
      const fvByHorizon: Record<number, number> = {}
      const fvRecurringByHorizon: Record<number, number> = {}
      horizons.forEach(h => {
        const lumpValue = fvLump(item.usdAmt, r, h)
        fvByHorizon[h] = lumpValue
        horizonSums[h] += lumpValue
        if (isRecurring) {
          const annual = item.usdAmt * freq
          fvRecurringByHorizon[h] = fvRecurring(annual, r, h, freq)
        }
      })
      monthSaved += item.usdAmt
      return { ...item, fvByHorizon, fvRecurringByHorizon, isRecurring, freq }
    })
    return { enriched, monthSaved, horizonSums }
  }, [records, rate, viewMonth, horizons])

  function fmt(usd: number) {
    if (currency === "KRW") {
      const won = Math.round(usd * KRW_RATE)
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
      ? `₩${Math.round(usd * KRW_RATE).toLocaleString("ko-KR")}`
      : `$${usd.toFixed(2)}`
  }

  function handleCurrencyChange(next: Currency) {
    if (next === currency) return
    const cur = parseFloat(amount) || 0
    if (next === "KRW") setAmount(String(cur < 10000 ? Math.round(cur * KRW_RATE / 1000) * 1000 : cur))
    else setAmount(cur > 1000 ? (cur / KRW_RATE).toFixed(2) : String(cur))
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

          {/* Danger zone */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Data</Label>
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
      { key: "delivery", Icon: Utensils, usd: 25, freq: 52 },
      { key: "subscription", Icon: Tv, usd: 15, freq: 12 },
      { key: "bag", Icon: ShoppingBag, usd: 800, freq: 1 },
      { key: "dining", Icon: UtensilsCrossed, usd: 60, freq: 52 },
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
                        {fmtExact(item.usdAmt)}
                        {item.isRecurring && (
                          <span> ({fmtExact(item.usdAmt)}{freqSuffix})</span>
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
                      ? String(Math.round(editingRecord.usdAmt * KRW_RATE))
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
                      ? (Number.isFinite(raw) ? raw / KRW_RATE : undefined)
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
                        ? String(Math.round(item.usd * KRW_RATE / 1000) * 1000)
                        : String(item.usd))
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
