import { useState, useMemo, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Trash2, Moon, Sun, Wallet, Repeat, Sparkles } from "lucide-react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

type Currency = "USD" | "KRW"
type Lang = "en" | "ko"
type Mode = "once" | "recurring"
type FrequencyValue = "365" | "52" | "12"
type RecordItem = {
  id: string
  name: string
  usdAmt: number
  date: number
  type: Mode
}

const KRW_RATE = 1380
const STORAGE_KEY = "instead-react-v1"

const i18n = {
  en: {
    appName: "Instead",
    subtitle: "Turn small spending into long-term investing insight.",
    calculate: "Calculate",
    graph: "Graph",
    history: "History",
    oneTime: "One-time",
    recurring: "Recurring",
    itemName: "Item name",
    itemPlaceholder: "e.g. the bag I wanted",
    amountUSD: "Amount ($)",
    amountKRW: "Amount (₩)",
    frequency: "Frequency",
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly",
    annualReturn: "Annual return (%)",
    investmentPeriod: "Investment period",
    years: "years",
    futureValueIn: "Future value in",
    gain: "Gain",
    principal: "Principal",
    totalContributed: "total contributed",
    resultsHint: "Results update instantly.",
    graphHint: "Your projected growth based on the current inputs.",
    totalAssets: "Total assets",
    principalLine: "Principal",
    after5: "After 5Y",
    after10: "After 10Y",
    after20: "After 20Y",
    saveRecord: "Save this record",
    saved: "Saved!",
    totalSaved: "Total saved so far",
    projected20: "Projected in 20 years",
    noRecords: "No records yet. Save one from the calculator tab.",
    deleteAll: "Delete all records",
    confirmDeleteAll: "Delete all records?",
    unnamed: "Unnamed saving",
    after20Label: "After 20Y",
    note: "VOO historical average is ~10%/yr. This app is a simulation for motivation only.",
    useLightMode: "Light mode",
    language: "Language",
    currency: "Currency",
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
    subtitle: "작은 소비를 장기 투자 관점으로 바꿔보세요.",
    calculate: "계산",
    graph: "그래프",
    history: "기록",
    oneTime: "이번 한 번",
    recurring: "반복 절약",
    itemName: "항목 이름",
    itemPlaceholder: "예: 사고 싶었던 가방",
    amountUSD: "금액 ($)",
    amountKRW: "금액 (₩)",
    frequency: "빈도",
    daily: "매일",
    weekly: "매주",
    monthly: "매월",
    annualReturn: "연 수익률 (%)",
    investmentPeriod: "투자 기간",
    years: "년",
    futureValueIn: "",
    gain: "수익",
    principal: "원금",
    totalContributed: "총 납입",
    resultsHint: "입력하면 바로 계산돼요.",
    graphHint: "현재 입력값 기준 투자 성장 그래프예요.",
    totalAssets: "총 자산",
    principalLine: "원금",
    after5: "5년 후",
    after10: "10년 후",
    after20: "20년 후",
    saveRecord: "이 절약 기록하기",
    saved: "기록 완료!",
    totalSaved: "지금까지 총 절약액",
    projected20: "20년 후 예상",
    noRecords: "아직 기록이 없어요. 계산 탭에서 하나 저장해보세요.",
    deleteAll: "모든 기록 삭제",
    confirmDeleteAll: "모든 기록을 삭제할까요?",
    unnamed: "이름 없는 절약",
    after20Label: "20년 후",
    note: "VOO 과거 연평균은 약 10% 수준입니다. 이 앱은 동기부여용 시뮬레이션입니다.",
    useLightMode: "라이트 모드",
    language: "언어",
    currency: "통화",
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

const presetItems = [
  { key: "coffee" as const, emoji: "☕", usd: 7 },
  { key: "bag" as const, emoji: "👜", usd: 800 },
  { key: "clothes" as const, emoji: "👕", usd: 150 },
  { key: "delivery" as const, emoji: "🍱", usd: 25 },
  { key: "subscription" as const, emoji: "📺", usd: 15 },
  { key: "impulse" as const, emoji: "🛍️", usd: 50 },
  { key: "dining" as const, emoji: "🍽️", usd: 60 },
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
  const [isLightMode, setIsLightMode] = useState(false)
  const [itemName, setItemName] = useState("")
  const [amount, setAmount] = useState("7")
  const [rate, setRate] = useState("10")
  const [frequency, setFrequency] = useState<FrequencyValue>("52")
  const [years, setYears] = useState(10)
  const [records, setRecords] = useState<RecordItem[]>([])
  const [saveFlash, setSaveFlash] = useState(false)

  const t = i18n[lang]

  // Load from localStorage
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    try {
      const p = JSON.parse(raw)
      if (p.lang) setLang(p.lang)
      if (p.currency) setCurrency(p.currency)
      if (p.mode) setMode(p.mode)
      if (typeof p.isLightMode === "boolean") setIsLightMode(p.isLightMode)
      if (p.itemName) setItemName(p.itemName)
      if (p.amount) setAmount(p.amount)
      if (p.rate) setRate(p.rate)
      if (p.frequency) setFrequency(p.frequency)
      if (p.years) setYears(p.years)
      if (Array.isArray(p.records)) setRecords(p.records)
    } catch { /* ignore */ }
  }, [])

  // Save to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      lang, currency, mode, isLightMode, itemName, amount, rate, frequency, years, records
    }))
  }, [lang, currency, mode, isLightMode, itemName, amount, rate, frequency, years, records])

  // Dark/light mode
  useEffect(() => {
    document.documentElement.classList.toggle("dark", !isLightMode)
  }, [isLightMode])

  // Initialize dark mode
  useEffect(() => {
    document.documentElement.classList.add("dark")
  }, [])

  const calc = useMemo(() => {
    const rawAmt = parseFloat(amount) || 0
    const usdAmt = currency === "KRW" ? rawAmt / KRW_RATE : rawAmt
    const r = parseFloat(rate) || 0
    const freq = parseFloat(frequency)

    let fv5 = 0, fv10 = 0, fv20 = 0, fvMain = 0, principal = 0
    const chart: Array<{ year: string; total: number; principal: number }> = []

    if (mode === "once") {
      fv5 = fvLump(usdAmt, r, 5)
      fv10 = fvLump(usdAmt, r, 10)
      fv20 = fvLump(usdAmt, r, 20)
      fvMain = fvLump(usdAmt, r, years)
      principal = usdAmt
      for (let i = 0; i <= years; i++) {
        chart.push({ year: lang === "ko" ? `${i}년` : `${i}Y`, total: fvLump(usdAmt, r, i), principal: usdAmt })
      }
    } else {
      const annual = usdAmt * freq
      fv5 = fvRecurring(annual, r, 5, freq)
      fv10 = fvRecurring(annual, r, 10, freq)
      fv20 = fvRecurring(annual, r, 20, freq)
      fvMain = fvRecurring(annual, r, years, freq)
      principal = annual * years
      for (let i = 0; i <= years; i++) {
        chart.push({ year: lang === "ko" ? `${i}년` : `${i}Y`, total: fvRecurring(annual, r, i, freq), principal: annual * i })
      }
    }
    return { usdAmt, principal, gain: fvMain - principal, fvMain, fv5, fv10, fv20, chart }
  }, [amount, currency, rate, frequency, years, mode, lang])

  const historySummary = useMemo(() => {
    const r = parseFloat(rate) || 10
    const now = Date.now()
    let totalSaved = 0, projected = 0
    const enriched = [...records].sort((a, b) => b.date - a.date).map(item => {
      const elapsed = (now - item.date) / (1000 * 60 * 60 * 24 * 365.25)
      const future = fvLump(item.usdAmt, r, Math.max(0, 20 - elapsed))
      totalSaved += item.usdAmt
      projected += future
      return { ...item, future }
    })
    return { totalSaved, projected, enriched }
  }, [records, rate])

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
    }, ...prev])
    setSaveFlash(true)
    setTimeout(() => setSaveFlash(false), 1200)
  }

  function deleteRecord(id: string) {
    setRecords(prev => prev.filter(r => r.id !== id))
  }

  function clearAll() {
    if (window.confirm(t.confirmDeleteAll)) setRecords([])
  }

  const heroLabel = lang === "ko"
    ? `${years}${t.years} 후 미래가치`
    : `${t.futureValueIn} ${years} ${t.years}`
  const heroSub = `${t.principal} ${fmt(calc.principal)}${mode === "recurring" ? ` (${t.totalContributed})` : ""}`

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-3 px-4 pb-8 pt-4">

        {/* Header — compact single row */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-black tracking-tight">💸 {t.appName}</h1>
          <div className="flex items-center gap-1.5">
            {/* Language */}
            <div className="flex rounded-md border border-border overflow-hidden">
              <button
                onClick={() => setLang("en")}
                className={`px-2.5 py-1 text-xs font-semibold transition-colors ${lang === "en" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >EN</button>
              <button
                onClick={() => setLang("ko")}
                className={`px-2.5 py-1 text-xs font-semibold transition-colors ${lang === "ko" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >KO</button>
            </div>
            {/* Currency */}
            <div className="flex rounded-md border border-border overflow-hidden">
              <button
                onClick={() => handleCurrencyChange("USD")}
                className={`px-2.5 py-1 text-xs font-semibold transition-colors ${currency === "USD" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >$</button>
              <button
                onClick={() => handleCurrencyChange("KRW")}
                className={`px-2.5 py-1 text-xs font-semibold transition-colors ${currency === "KRW" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >₩</button>
            </div>
            {/* Dark/Light */}
            <button
              onClick={() => setIsLightMode(v => !v)}
              className="rounded-md border border-border p-1.5 text-muted-foreground"
            >
              {isLightMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="calculate" className="flex flex-1 flex-col gap-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="calculate">{t.calculate}</TabsTrigger>
            <TabsTrigger value="graph">{t.graph}</TabsTrigger>
            <TabsTrigger value="history">{t.history}</TabsTrigger>
          </TabsList>

          {/* ── Calculate Tab ── */}
          <TabsContent value="calculate" className="mt-0 space-y-3">
            {/* Mode toggle */}
            <div className="grid grid-cols-2 gap-2">
              <Button variant={mode === "once" ? "default" : "outline"} className="w-full" onClick={() => setMode("once")}>
                <Sparkles className="mr-2 h-4 w-4" />{t.oneTime}
              </Button>
              <Button variant={mode === "recurring" ? "default" : "outline"} className="w-full" onClick={() => setMode("recurring")}>
                <Repeat className="mr-2 h-4 w-4" />{t.recurring}
              </Button>
            </div>

            {/* Item name + presets */}
            <Card>
              <CardContent className="pt-4 space-y-3">
                <Input
                  id="itemName"
                  value={itemName}
                  onChange={e => setItemName(e.target.value)}
                  placeholder={t.itemPlaceholder}
                  maxLength={40}
                />
                <div className="flex flex-wrap gap-1.5">
                  {presetItems.map(item => (
                    <Badge
                      key={item.key}
                      variant="secondary"
                      className="cursor-pointer rounded-full px-2.5 py-1 text-xs"
                      onClick={() => {
                        setItemName(t.presets[item.key])
                        setAmount(currency === "KRW"
                          ? String(Math.round(item.usd * KRW_RATE / 1000) * 1000)
                          : String(item.usd))
                      }}
                    >
                      <span className="mr-1">{item.emoji}</span>{t.presets[item.key]}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Amount + rate + frequency — compact inline */}
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex gap-2 items-end">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs">{currency === "KRW" ? t.amountKRW : t.amountUSD}</Label>
                    <Input
                      id="amount"
                      type="number"
                      inputMode="decimal"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      className="h-9"
                    />
                  </div>
                  {mode === "recurring" && (
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs">{t.frequency}</Label>
                      <Select value={frequency} onValueChange={v => setFrequency(v as FrequencyValue)}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="365">{t.daily}</SelectItem>
                          <SelectItem value="52">{t.weekly}</SelectItem>
                          <SelectItem value="12">{t.monthly}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="w-20 space-y-1">
                    <Label className="text-xs">{t.annualReturn}</Label>
                    <Input
                      id="rate"
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

            {/* Years — compact */}
            <Card>
              <CardContent className="pt-3 pb-3">
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs">{t.investmentPeriod}</Label>
                  <span className="text-lg font-black">{years} {t.years}</span>
                </div>
                <div className="grid grid-cols-4 gap-1.5 mb-2">
                  {[5, 10, 20, 30].map(v => (
                    <Button key={v} variant={years === v ? "default" : "outline"} size="sm"
                      className="h-8 text-xs" onClick={() => setYears(v)}>
                      {lang === "ko" ? `${v}년` : `${v}Y`}
                    </Button>
                  ))}
                </div>
                <Slider value={[years]} min={1} max={40} step={1}
                  onValueChange={v => setYears(v[0] ?? 10)} />
              </CardContent>
            </Card>

            {/* Result hero */}
            <Card className="border-amber-500/40 bg-gradient-to-br from-amber-100 via-orange-50 to-emerald-100 dark:from-amber-500/20 dark:via-orange-500/10 dark:to-emerald-500/20">
              <CardContent className="flex items-center justify-between gap-4 px-5 py-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{heroLabel}</div>
                  <div className="mt-1 text-3xl font-black tracking-tight">{fmt(calc.fvMain)}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{heroSub}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.gain}</div>
                  <div className="mt-1 text-lg font-extrabold text-emerald-600 dark:text-emerald-400">
                    +{fmt(calc.gain)}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Mini grid */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: t.after5, value: calc.fv5 },
                { label: t.after10, value: calc.fv10 },
                { label: t.after20, value: calc.fv20 },
              ].map(item => (
                <Card key={item.label}>
                  <CardContent className="p-3 text-center">
                    <div className="text-xs text-muted-foreground">{item.label}</div>
                    <div className="mt-1 text-base font-bold text-amber-600 dark:text-amber-400">{fmt(item.value)}</div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Save button */}
            <Button className="w-full" onClick={saveRecord}>
              <Wallet className="mr-2 h-4 w-4" />
              {saveFlash ? t.saved : t.saveRecord}
            </Button>

            <p className="text-center text-xs text-muted-foreground">{t.note}</p>
          </TabsContent>

          {/* ── Graph Tab ── */}
          <TabsContent value="graph" className="mt-0 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{heroLabel}</CardTitle>
                <CardDescription>{t.graphHint}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-4 flex items-end justify-between gap-4">
                  <div>
                    <div className="text-4xl font-black tracking-tight">{fmt(calc.fvMain)}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{heroSub}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">{t.gain}</div>
                    <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">+{fmt(calc.gain)}</div>
                  </div>
                </div>
                <div className="h-[340px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={calc.chart}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={v => fmt(v as number)} width={72} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(value: number) => fmt(value)} />
                      <Legend />
                      <Area
                        type="monotone" dataKey="total" name={t.totalAssets}
                        stroke="hsl(38 92% 50%)" fill="hsl(38 92% 50%)" fillOpacity={0.18}
                      />
                      <Line
                        type="monotone" dataKey="principal" name={t.principalLine}
                        stroke="hsl(160 60% 45%)" dot={false} strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── History Tab ── */}
          <TabsContent value="history" className="mt-0 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{t.totalSaved}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-4xl font-black tracking-tight">{fmt(historySummary.totalSaved)}</div>
                <div className="mt-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  {t.projected20}: {fmt(historySummary.projected)}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-4 pt-6">
                {historySummary.enriched.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">{t.noRecords}</div>
                ) : (
                  historySummary.enriched.map((item, index) => {
                    const d = new Date(item.date)
                    const ds = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`
                    return (
                      <div key={item.id}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-semibold">{item.name}</div>
                            <div className="text-sm text-amber-600 dark:text-amber-400">{fmtExact(item.usdAmt)}</div>
                            <div className="text-xs text-muted-foreground">{ds}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-semibold text-emerald-600 dark:text-emerald-400">→ {fmt(item.future)}</div>
                            <div className="text-xs text-muted-foreground">{t.after20Label}</div>
                          </div>
                          <Button variant="ghost" size="icon" onClick={() => deleteRecord(item.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        {index < historySummary.enriched.length - 1 && <Separator className="mt-4" />}
                      </div>
                    )
                  })
                )}
              </CardContent>
            </Card>

            <Button variant="destructive" className="w-full" onClick={clearAll}>
              {t.deleteAll}
            </Button>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
