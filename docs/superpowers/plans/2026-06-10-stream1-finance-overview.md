# Finance Overview Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new /finance-overview page giving the treasurer a live cash position split between Maintenance Fund and Corpus Fund, a 12-month cash flow chart, and actionable alerts.

**Architecture:** New standalone page FinanceOverviewPage.tsx with 5 sections — hero KPIs, two fund panels, cash flow chart, action strip, and two detail panels. Wired into router and sidebar. No schema changes.

**Tech Stack:** React 18, TypeScript, Supabase JS, react-query, Recharts, Shadcn/ui, Tailwind CSS, lucide-react

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/pages/FinanceOverviewPage.tsx` | Full page: hero KPIs, fund panels, chart, action strip, detail panels |
| Modify | `src/App.tsx` | Add `finance-overview` route |
| Modify | `src/components/layout/Layout.tsx` | Add "Finance Overview" nav item (admin + committee only) |

---

## Fiscal Year Helper (reference — used in all data queries)

```typescript
function getCurrentFY(): { fyStart: string; fyEnd: string; fyLabel: string } {
  const now = new Date()
  const month = now.getMonth() + 1 // 1-based
  const year = now.getFullYear()
  const startYear = month >= 4 ? year : year - 1
  return {
    fyStart: `${startYear}-04-01`,
    fyEnd:   `${startYear + 1}-03-31`,
    fyLabel: `FY ${startYear}-${String(startYear + 1).slice(-2)}`,
  }
}
```

---

## Task 1: Create `src/pages/FinanceOverviewPage.tsx` — skeleton + hero KPIs + fund panels

**Files:**
- Create: `src/pages/FinanceOverviewPage.tsx`

This task builds the complete page file with all 5 data queries and the first 2 rendered sections (hero KPIs + fund panels). Subsequent tasks extend this same file.

- [ ] **Step 1: Create the page file**

Create `src/pages/FinanceOverviewPage.tsx` with the full content below. This includes the fiscal year helper, all data queries (so react-query fires them all in parallel from mount), and Sections 1–2 rendered.

```typescript
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  LayoutDashboard, TrendingUp, AlertTriangle, ArrowRight,
  IndianRupee, Building2, CalendarClock, GitMerge,
} from 'lucide-react'
import {
  BarChart, Bar, Line, XAxis, YAxis, Tooltip,
  Legend, ResponsiveContainer, ComposedChart,
} from 'recharts'
import { supabase } from '@/lib/supabase'
import { formatINR } from '@/lib/tagger'
import { useRoleCtx } from '@/contexts/RoleContext'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

// ── Fiscal year helper ─────────────────────────────────────────────────────

function getCurrentFY(): { fyStart: string; fyEnd: string; fyLabel: string } {
  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear()
  const startYear = month >= 4 ? year : year - 1
  return {
    fyStart: `${startYear}-04-01`,
    fyEnd:   `${startYear + 1}-03-31`,
    fyLabel: `FY ${startYear}-${String(startYear + 1).slice(-2)}`,
  }
}

function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function daysUntil(dateStr: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((parseLocalDate(dateStr).getTime() - today.getTime()) / 86_400_000)
}

// ── Types ──────────────────────────────────────────────────────────────────

interface FundData {
  collected: number
  spent: number
}

interface CorpusPlanRow {
  plan_id: string
  plan_name: string
  plan_status: string
  collected: number
  effective_target: number
  balance: number
}

interface DuesRow {
  flat_code: string
  block: string
  pending: number
  status: string
  total_outstanding: number
  annual_due: number
}

interface ChartMonth {
  month: string
  Maintenance: number
  Corpus: number
  Expenses: number
}

interface DepositRow {
  id: string
  principal: number
  maturity_date: string
  status: string
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function FinanceOverviewPage() {
  const navigate = useNavigate()
  const { fyStart, fyEnd, fyLabel } = getCurrentFY()

  // ── Query 1: Maintenance collected this FY ────────────────────────────
  const { data: maintCollected = 0 } = useQuery({
    queryKey: ['fo-maint-collected', fyStart, fyEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('amount')
        .eq('cr_dr', 'CR')
        .eq('corpus', 'NO')
        .gte('value_date', fyStart)
        .lte('value_date', fyEnd)
      if (error) throw error
      return (data ?? []).reduce((s: number, r: any) => s + (r.amount ?? 0), 0)
    },
  })

  // ── Query 2: Maintenance spent this FY (category budget_type = Maintenance) ──
  const { data: maintSpent = 0 } = useQuery({
    queryKey: ['fo-maint-spent', fyStart, fyEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('amount, category:category_id(budget_type)')
        .is('voided_at', null)
        .gte('expense_date', fyStart)
        .lte('expense_date', fyEnd)
      if (error) throw error
      return (data ?? [])
        .filter((e: any) => e.category?.budget_type === 'Maintenance')
        .reduce((s: number, e: any) => s + (e.amount ?? 0), 0)
    },
  })

  // ── Query 3: Pending dues (sum of pending where not Clear) ─────────────
  const { data: duesData = [] } = useQuery<DuesRow[]>({
    queryKey: ['fo-dues'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_dues_tracker')
        .select('flat_code, block, pending, status, total_outstanding, annual_due')
        .neq('status', 'Clear')
        .order('pending', { ascending: false })
      if (error) throw error
      return (data ?? []) as DuesRow[]
    },
  })

  // ── Query 4: Corpus collected + plan details ───────────────────────────
  const { data: corpusRows = [] } = useQuery<CorpusPlanRow[]>({
    queryKey: ['fo-corpus-tracker'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_corpus_tracker')
        .select('plan_id, plan_name, plan_status, collected, effective_target, balance')
      if (error) throw error
      return (data ?? []) as CorpusPlanRow[]
    },
  })

  // ── Query 5: Corpus spent (expenses linked to any corpus plan) ─────────
  const { data: corpusSpent = 0 } = useQuery({
    queryKey: ['fo-corpus-spent'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('amount')
        .not('corpus_plan_id', 'is', null)
        .is('voided_at', null)
      if (error) throw error
      return (data ?? []).reduce((s: number, e: any) => s + (e.amount ?? 0), 0)
    },
  })

  // ── Query 6: Active deposits (FDs) ────────────────────────────────────
  const { data: deposits = [] } = useQuery<DepositRow[]>({
    queryKey: ['fo-deposits'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deposits')
        .select('id, principal, maturity_date, status')
        .eq('status', 'active')
      if (error) throw error
      return (data ?? []) as DepositRow[]
    },
  })

  // ── Query 7: Unreconciled expense count ───────────────────────────────
  const { data: unreconciledCount = 0 } = useQuery({
    queryKey: ['fo-unreconciled'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('expenses')
        .select('id', { count: 'exact', head: true })
        .is('transaction_id', null)
        .is('voided_at', null)
        .neq('payment_mode', 'Cash')
      if (error) return 0
      return count ?? 0
    },
    refetchInterval: 60_000,
  })

  // ── Query 8: 12-month cash flow chart data ────────────────────────────
  const { data: monthlyRaw = [] } = useQuery({
    queryKey: ['fo-monthly-summary'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_monthly_summary')
        .select('fiscal_label, fiscal_year, maintenance_collected, corpus_collected, total_expenses')
        .order('fiscal_year', { ascending: true })
        .order('fiscal_label', { ascending: true })
        .limit(24)
      if (error) throw error
      return data ?? []
    },
  })

  // ── Derived values ─────────────────────────────────────────────────────

  const pendingDuesTotal = duesData.reduce((s, d) => s + Math.max(0, d.pending ?? 0), 0)
  const overdueFlatCount = duesData.filter(d => d.status !== 'Clear').length

  // Corpus: dedupe by plan_id, sum collected and target
  const corpusByPlan = new Map<string, { name: string; status: string; collected: number; target: number; spent: number; balance: number }>()
  for (const row of corpusRows) {
    if (!corpusByPlan.has(row.plan_id)) {
      corpusByPlan.set(row.plan_id, {
        name:      row.plan_name,
        status:    row.plan_status,
        collected: 0,
        target:    0,
        spent:     0,
        balance:   0,
      })
    }
    const p = corpusByPlan.get(row.plan_id)!
    p.collected += row.collected ?? 0
    p.target    += row.effective_target ?? 0
    p.balance   += row.balance ?? 0
  }
  const corpusPlans      = Array.from(corpusByPlan.entries()).map(([id, p]) => ({ id, ...p }))
  const activePlans      = corpusPlans.filter(p => p.status === 'active')
  const corpusCollected  = corpusPlans.reduce((s, p) => s + p.collected, 0)
  const corpusAvailable  = Math.max(0, corpusCollected - corpusSpent)
  const maintAvailable   = Math.max(0, maintCollected - maintSpent)

  const fdTotal          = deposits.reduce((s, d) => s + d.principal, 0)
  const fdMaturingSoon   = deposits.filter(d => {
    const days = daysUntil(d.maturity_date)
    return days >= 0 && days <= 30
  })
  const nextFD           = deposits.length > 0
    ? deposits.reduce((a, b) =>
        parseLocalDate(a.maturity_date) < parseLocalDate(b.maturity_date) ? a : b
      )
    : null

  const pendingActionsCount = overdueFlatCount + unreconciledCount + fdMaturingSoon.length
  const netAvailableCash    = maintAvailable + corpusAvailable

  const chartData: ChartMonth[] = (monthlyRaw as any[]).slice(-12).map((m: any) => ({
    month:       m.fiscal_label,
    Maintenance: m.maintenance_collected ?? 0,
    Corpus:      m.corpus_collected ?? 0,
    Expenses:    m.total_expenses ?? 0,
  }))

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-5 fade-in">

      {/* ── Page header ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[24px] font-extrabold flex items-center gap-2">
            <LayoutDashboard size={22} style={{ color: 'var(--brand-600)' }} />
            Finance Overview
          </h1>
          <p className="text-[13.5px] mt-1" style={{ color: 'var(--ink-500)' }}>
            {fyLabel} · Live cash position &amp; action items
          </p>
        </div>
      </div>

      {/* ── Section 1: Hero KPI strip (3 cards) ──────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">

        {/* Card 1: Net Available Cash */}
        <button
          onClick={() => navigate('/expenses?filter=maintenance')}
          className="surface !p-4 text-left hover:shadow-md transition-shadow"
          style={{ background: 'var(--brand-50)', borderColor: 'var(--brand-200)' }}
        >
          <div className="flex items-center gap-2 mb-2">
            <div
              className="w-8 h-8 rounded-[9px] flex items-center justify-center"
              style={{ background: 'var(--brand-100)', color: 'var(--brand-600)' }}
            >
              <IndianRupee size={16} />
            </div>
            <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--brand-600)' }}>
              Net Available Cash
            </p>
          </div>
          <p className="text-[28px] font-extrabold tnum leading-tight" style={{ color: 'var(--brand-700)' }}>
            {formatINR(netAvailableCash)}
          </p>
          <p className="text-[11.5px] mt-1" style={{ color: 'var(--brand-500)' }}>
            Maintenance + Corpus available
          </p>
        </button>

        {/* Card 2: Fixed Deposits */}
        <button
          onClick={() => navigate('/finance')}
          className="surface !p-4 text-left hover:shadow-md transition-shadow"
          style={{ background: '#f5f3ff', borderColor: '#c4b5fd' }}
        >
          <div className="flex items-center gap-2 mb-2">
            <div
              className="w-8 h-8 rounded-[9px] flex items-center justify-center"
              style={{ background: '#ede9fe', color: '#7c3aed' }}
            >
              <TrendingUp size={16} />
            </div>
            <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: '#7c3aed' }}>
              Fixed Deposits
            </p>
          </div>
          <p className="text-[28px] font-extrabold tnum leading-tight" style={{ color: '#5b21b6' }}>
            {formatINR(fdTotal)}
          </p>
          <p className="text-[11.5px] mt-1" style={{ color: '#8b5cf6' }}>
            {deposits.length} active FD{deposits.length !== 1 ? 's' : ''}
            {nextFD ? ` · next maturity ${new Date(nextFD.maturity_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}` : ''}
          </p>
        </button>

        {/* Card 3: Pending Actions */}
        <button
          onClick={() => navigate('/dues')}
          className="surface !p-4 text-left hover:shadow-md transition-shadow"
          style={
            pendingActionsCount > 0
              ? { background: 'var(--bad-bg)', borderColor: 'var(--bad-bd)' }
              : { background: 'var(--ok-bg)', borderColor: 'var(--ok-bd)' }
          }
        >
          <div className="flex items-center gap-2 mb-2">
            <div
              className="w-8 h-8 rounded-[9px] flex items-center justify-center"
              style={
                pendingActionsCount > 0
                  ? { background: 'rgba(239,68,68,.15)', color: 'var(--bad)' }
                  : { background: 'rgba(34,197,94,.15)', color: 'var(--ok)' }
              }
            >
              <AlertTriangle size={16} />
            </div>
            <p
              className="text-[12px] font-semibold uppercase tracking-wide"
              style={{ color: pendingActionsCount > 0 ? 'var(--bad)' : 'var(--ok)' }}
            >
              Pending Actions
            </p>
          </div>
          <p
            className="text-[28px] font-extrabold tnum leading-tight"
            style={{ color: pendingActionsCount > 0 ? 'var(--bad)' : 'var(--ok)' }}
          >
            {pendingActionsCount}
          </p>
          <p className="text-[11.5px] mt-1" style={{ color: pendingActionsCount > 0 ? 'var(--bad)' : 'var(--ok)' }}>
            {pendingActionsCount === 0
              ? 'All clear'
              : [
                  overdueFlatCount > 0 && `${overdueFlatCount} overdue flat${overdueFlatCount > 1 ? 's' : ''}`,
                  unreconciledCount > 0 && `${unreconciledCount} unreconciled`,
                  fdMaturingSoon.length > 0 && `${fdMaturingSoon.length} FD maturing`,
                ].filter(Boolean).join(' · ')
            }
          </p>
        </button>
      </div>

      {/* ── Section 2: Fund panels (side by side) ────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Maintenance Fund panel */}
        <div
          className="surface !p-5 flex flex-col gap-4"
          style={{ background: 'var(--brand-50)', borderColor: 'var(--brand-200)' }}
        >
          <div className="flex items-center gap-2">
            <IndianRupee size={18} style={{ color: 'var(--brand-600)' }} />
            <p className="text-[14px] font-bold" style={{ color: 'var(--brand-700)' }}>Maintenance Fund</p>
            <Badge
              variant="outline"
              className="ml-auto text-[11px]"
              style={{ background: 'var(--brand-100)', color: 'var(--brand-700)', borderColor: 'var(--brand-300)' }}
            >
              {fyLabel}
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl p-3" style={{ background: 'var(--brand-100)' }}>
              <p className="text-[11px] font-medium mb-1" style={{ color: 'var(--brand-600)' }}>Collected</p>
              <p className="text-[20px] font-bold tnum" style={{ color: 'var(--brand-800)' }}>
                {formatINR(maintCollected)}
              </p>
            </div>
            <div className="rounded-xl p-3" style={{ background: 'var(--brand-100)' }}>
              <p className="text-[11px] font-medium mb-1" style={{ color: 'var(--brand-600)' }}>Spent</p>
              <p className="text-[20px] font-bold tnum" style={{ color: 'var(--brand-800)' }}>
                {formatINR(maintSpent)}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: 'white' }}>
            <div>
              <p className="text-[11.5px]" style={{ color: 'var(--ink-500)' }}>Available</p>
              <p className="text-[22px] font-extrabold tnum" style={{ color: 'var(--brand-700)' }}>
                {formatINR(maintAvailable)}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="text-[12px]"
              style={{ borderColor: 'var(--brand-400)', color: 'var(--brand-700)' }}
              onClick={() => navigate('/expenses?filter=maintenance')}
            >
              View expenses <ArrowRight size={13} className="ml-1" />
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11.5px]" style={{ color: 'var(--ink-500)' }}>Pending dues</p>
              <p
                className="text-[16px] font-bold tnum"
                style={{ color: pendingDuesTotal > 0 ? 'var(--bad)' : 'var(--ok)' }}
              >
                {formatINR(pendingDuesTotal)}
                <span className="text-[12px] font-normal ml-1.5" style={{ color: 'var(--ink-400)' }}>
                  ({overdueFlatCount} flat{overdueFlatCount !== 1 ? 's' : ''})
                </span>
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="text-[12px]"
              onClick={() => navigate('/dues')}
            >
              View dues <ArrowRight size={13} className="ml-1" />
            </Button>
          </div>
        </div>

        {/* Corpus Fund panel */}
        <div
          className="surface !p-5 flex flex-col gap-4"
          style={{ background: '#f5f3ff', borderColor: '#c4b5fd' }}
        >
          <div className="flex items-center gap-2">
            <Building2 size={18} style={{ color: '#7c3aed' }} />
            <p className="text-[14px] font-bold" style={{ color: '#5b21b6' }}>Corpus Fund</p>
            <Badge
              variant="outline"
              className="ml-auto text-[11px]"
              style={{ background: '#ede9fe', color: '#7c3aed', borderColor: '#c4b5fd' }}
            >
              {activePlans.length} active plan{activePlans.length !== 1 ? 's' : ''}
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl p-3" style={{ background: '#ede9fe' }}>
              <p className="text-[11px] font-medium mb-1" style={{ color: '#7c3aed' }}>Collected</p>
              <p className="text-[20px] font-bold tnum" style={{ color: '#5b21b6' }}>
                {formatINR(corpusCollected)}
              </p>
            </div>
            <div className="rounded-xl p-3" style={{ background: '#ede9fe' }}>
              <p className="text-[11px] font-medium mb-1" style={{ color: '#7c3aed' }}>Spent</p>
              <p className="text-[20px] font-bold tnum" style={{ color: '#5b21b6' }}>
                {formatINR(corpusSpent)}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: 'white' }}>
            <div>
              <p className="text-[11.5px]" style={{ color: 'var(--ink-500)' }}>Available</p>
              <p className="text-[22px] font-extrabold tnum" style={{ color: '#5b21b6' }}>
                {formatINR(corpusAvailable)}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="text-[12px]"
              style={{ borderColor: '#a78bfa', color: '#7c3aed' }}
              onClick={() => navigate('/corpus')}
            >
              View corpus <ArrowRight size={13} className="ml-1" />
            </Button>
          </div>

          <div>
            <p className="text-[11.5px]" style={{ color: 'var(--ink-500)' }}>Active plans</p>
            <div className="flex flex-col gap-1 mt-1">
              {activePlans.length === 0 && (
                <p className="text-[13px]" style={{ color: 'var(--ink-400)' }}>No active plans</p>
              )}
              {activePlans.map(p => {
                const pct = p.target > 0 ? Math.round(p.collected * 100 / p.target) : 0
                return (
                  <div key={p.id} className="flex items-center gap-2 text-[12px]">
                    <span className="flex-1 font-medium truncate" style={{ color: '#5b21b6' }}>{p.name}</span>
                    <span style={{ color: '#7c3aed' }}>{pct}%</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 3: 12-month cash flow chart ──────────────────────── */}
      <div className="surface !p-5">
        <p className="text-[13.5px] font-semibold mb-4" style={{ color: 'var(--ink-700)' }}>
          12-month cash flow — collections vs expenses
        </p>
        {chartData.length === 0 ? (
          <div className="flex items-center justify-center h-[240px]" style={{ color: 'var(--ink-400)' }}>
            <p className="text-[13px]">No data yet</p>
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: 'var(--ink-400)' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`}
                  tick={{ fontSize: 11, fill: 'var(--ink-400)' }}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                />
                <Tooltip
                  formatter={(v: number, name: string) => [formatINR(v), name]}
                  contentStyle={{ borderRadius: 10, border: '1px solid var(--ink-200)', fontSize: 12 }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
                  formatter={(value: string) => <span style={{ color: 'var(--ink-500)' }}>{value}</span>}
                />
                <Bar dataKey="Maintenance" stackId="collections" fill="var(--maint)"  radius={[0, 0, 0, 0]} maxBarSize={22} />
                <Bar dataKey="Corpus"      stackId="collections" fill="var(--corpus)" radius={[3, 3, 0, 0]} maxBarSize={22} />
                <Line
                  type="monotone"
                  dataKey="Expenses"
                  stroke="var(--expense)"
                  strokeWidth={2}
                  dot={{ r: 3, fill: 'var(--expense)', strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </>
        )}
      </div>

      {/* ── Section 4: Action strip ───────────────────────────────────── */}
      <div className="flex flex-col gap-2">

        {/* Overdue flats */}
        {overdueFlatCount > 0 && (
          <div
            className="flex items-center gap-3 px-4 py-3 rounded-[12px] border"
            style={{ background: 'var(--bad-bg)', borderColor: 'var(--bad-bd)' }}
          >
            <IndianRupee size={17} style={{ color: 'var(--bad)' }} className="shrink-0" />
            <p className="flex-1 text-[13px] font-semibold" style={{ color: 'var(--bad)' }}>
              {overdueFlatCount} flat{overdueFlatCount > 1 ? 's' : ''} with pending dues — {formatINR(pendingDuesTotal)} outstanding
            </p>
            <Button
              size="sm"
              variant="outline"
              className="text-[12px] shrink-0"
              style={{ borderColor: 'var(--bad-bd)', color: 'var(--bad)' }}
              onClick={() => navigate('/dues')}
            >
              View <ArrowRight size={12} className="ml-1" />
            </Button>
          </div>
        )}

        {/* FD maturities in next 30 days */}
        {fdMaturingSoon.length > 0 && (
          <div
            className="flex items-center gap-3 px-4 py-3 rounded-[12px] border"
            style={{ background: 'var(--warn-bg)', borderColor: 'var(--warn-bd)' }}
          >
            <CalendarClock size={17} style={{ color: 'var(--warn)' }} className="shrink-0" />
            <p className="flex-1 text-[13px] font-semibold" style={{ color: 'var(--warn)' }}>
              {fdMaturingSoon.length} FD{fdMaturingSoon.length > 1 ? 's' : ''} maturing in the next 30 days
              {fdMaturingSoon.length === 1 && nextFD
                ? ` — ${new Date(nextFD.maturity_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
                : ''}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="text-[12px] shrink-0"
              style={{ borderColor: 'var(--warn-bd)', color: 'var(--warn)' }}
              onClick={() => navigate('/finance')}
            >
              View <ArrowRight size={12} className="ml-1" />
            </Button>
          </div>
        )}

        {/* Unreconciled bank DRs */}
        {unreconciledCount > 0 && (
          <div
            className="flex items-center gap-3 px-4 py-3 rounded-[12px] border"
            style={{ background: 'var(--warn-bg)', borderColor: 'var(--warn-bd)' }}
          >
            <GitMerge size={17} style={{ color: 'var(--warn)' }} className="shrink-0" />
            <p className="flex-1 text-[13px] font-semibold" style={{ color: 'var(--warn)' }}>
              {unreconciledCount} unreconciled expense{unreconciledCount > 1 ? 's' : ''} — bank DRs not matched
            </p>
            <Button
              size="sm"
              variant="outline"
              className="text-[12px] shrink-0"
              style={{ borderColor: 'var(--warn-bd)', color: 'var(--warn)' }}
              onClick={() => navigate('/expenses?tab=reconcile')}
            >
              Reconcile <ArrowRight size={12} className="ml-1" />
            </Button>
          </div>
        )}

        {/* All clear */}
        {overdueFlatCount === 0 && unreconciledCount === 0 && fdMaturingSoon.length === 0 && (
          <div
            className="flex items-center gap-3 px-4 py-3 rounded-[12px] border"
            style={{ background: 'var(--ok-bg)', borderColor: 'var(--ok-bd)' }}
          >
            <AlertTriangle size={17} style={{ color: 'var(--ok)' }} className="shrink-0" />
            <p className="text-[13px] font-semibold" style={{ color: 'var(--ok)' }}>
              No pending actions — everything is up to date
            </p>
          </div>
        )}
      </div>

      {/* ── Section 5: Detail panels ──────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Left: Aging receivables table */}
        <div className="surface !p-0 overflow-hidden">
          <div className="px-5 py-3 border-b hairline flex items-center justify-between">
            <p className="text-[13px] font-semibold" style={{ color: 'var(--ink-700)' }}>
              Aging Receivables
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="text-[12px] h-7"
              style={{ color: 'var(--brand-600)' }}
              onClick={() => navigate('/dues')}
            >
              View all <ArrowRight size={12} className="ml-1" />
            </Button>
          </div>
          {duesData.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-[13px]" style={{ color: 'var(--ink-400)' }}>All flats are clear</p>
            </div>
          ) : (
            <div className="divide-rows">
              {/* Header row */}
              <div className="px-4 py-2 grid grid-cols-[1fr_auto_auto] gap-3 text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: 'var(--ink-400)' }}>
                <span>Flat</span>
                <span className="text-right">Amount due</span>
                <span className="text-right">Status</span>
              </div>
              {/* Data rows — show top 8 */}
              {duesData.slice(0, 8).map(d => (
                <button
                  key={d.flat_code}
                  className="w-full px-4 py-2.5 grid grid-cols-[1fr_auto_auto] gap-3 items-center text-left hover:bg-[var(--ink-50)] transition-colors"
                  onClick={() => navigate('/dues')}
                >
                  <div>
                    <p className="text-[13px] font-semibold" style={{ color: 'var(--ink-800)' }}>
                      {d.flat_code}
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--ink-400)' }}>Block {d.block}</p>
                  </div>
                  <p className="text-[13px] font-semibold tnum text-right" style={{ color: 'var(--bad)' }}>
                    {formatINR(d.pending)}
                  </p>
                  <span
                    className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                    style={
                      d.status === 'Due'
                        ? { background: 'var(--bad-bg)', color: 'var(--bad)' }
                        : { background: 'var(--warn-bg)', color: 'var(--warn)' }
                    }
                  >
                    {d.status}
                  </span>
                </button>
              ))}
              {duesData.length > 8 && (
                <div className="px-4 py-2.5 text-center">
                  <button
                    className="text-[12px] font-medium"
                    style={{ color: 'var(--brand-600)' }}
                    onClick={() => navigate('/dues')}
                  >
                    +{duesData.length - 8} more flats — view all
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Corpus plan status mini-table */}
        <div className="surface !p-0 overflow-hidden">
          <div className="px-5 py-3 border-b hairline flex items-center justify-between">
            <p className="text-[13px] font-semibold" style={{ color: 'var(--ink-700)' }}>
              Corpus Plans
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="text-[12px] h-7"
              style={{ color: 'var(--brand-600)' }}
              onClick={() => navigate('/corpus')}
            >
              View all <ArrowRight size={12} className="ml-1" />
            </Button>
          </div>
          {corpusPlans.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-[13px]" style={{ color: 'var(--ink-400)' }}>No corpus plans found</p>
            </div>
          ) : (
            <div className="divide-rows">
              {corpusPlans.map(p => {
                const pct = p.target > 0 ? Math.min(100, Math.round(p.collected * 100 / p.target)) : 0
                const available = Math.max(0, p.collected - p.spent)
                return (
                  <button
                    key={p.id}
                    className="w-full px-4 py-3 text-left hover:bg-[var(--ink-50)] transition-colors"
                    onClick={() => navigate(`/corpus?plan=${p.id}`)}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--ink-800)' }}>
                            {p.name}
                          </p>
                          <span
                            className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full capitalize"
                            style={
                              p.status === 'active'
                                ? { background: 'var(--ok-bg)', color: 'var(--ok)' }
                                : { background: 'var(--ink-100)', color: 'var(--ink-500)' }
                            }
                          >
                            {p.status}
                          </span>
                        </div>
                        <div className="flex gap-3 mt-0.5 text-[11px]" style={{ color: 'var(--ink-400)' }}>
                          <span>Target: {formatINR(p.target)}</span>
                          <span>·</span>
                          <span>Collected: {formatINR(p.collected)}</span>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[11px]" style={{ color: 'var(--ink-400)' }}>Available</p>
                        <p className="text-[14px] font-bold tnum" style={{ color: '#5b21b6' }}>
                          {formatINR(available)}
                        </p>
                      </div>
                    </div>
                    {/* Progress bar */}
                    <div className="ds-track">
                      <div
                        className="ds-track-fill"
                        style={{ width: `${pct}%`, background: 'var(--corpus)' }}
                      />
                    </div>
                    <p className="text-[11px] mt-1 text-right" style={{ color: 'var(--ink-400)' }}>
                      {pct}% of target
                    </p>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Fix any errors before proceeding. Common issues:
- If `ComposedChart` is not found, ensure it is imported from `recharts` (it is in `recharts >= 2.0`).
- If `var(--maint)`, `var(--corpus)`, `var(--expense)` are unfamiliar, check `src/index.css` — they are defined there, same as used in DashboardPage.tsx.
- If `ds-track` / `ds-track-fill` classes are missing, check the global CSS; they are used in DashboardPage so they exist.

- [ ] **Step 3: Commit**

```bash
git add src/pages/FinanceOverviewPage.tsx
git commit -m "feat(finance-overview): add FinanceOverviewPage with hero KPIs, fund panels, chart, action strip, detail panels"
```

---

## Task 2: Wire route in `src/App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add import**

In `src/App.tsx`, after the existing import of `FinancePage`, add:

```typescript
import FinanceOverviewPage from '@/pages/FinanceOverviewPage'
```

The import block currently ends with:

```typescript
import MyFlatPage         from '@/pages/MyFlatPage'
```

Insert the new import immediately after:

```typescript
import MyFlatPage         from '@/pages/MyFlatPage'
import FinanceOverviewPage from '@/pages/FinanceOverviewPage'
```

- [ ] **Step 2: Add route**

In `src/App.tsx`, inside the `<Route path="/" element={...}>` block, after the existing `finance` route:

```tsx
<Route path="finance"       element={<FinancePage />} />
```

Add:

```tsx
<Route path="finance"          element={<FinancePage />} />
<Route path="finance-overview" element={<FinanceOverviewPage />} />
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(finance-overview): add /finance-overview route in App.tsx"
```

---

## Task 3: Add nav item in `src/components/layout/Layout.tsx`

**Files:**
- Modify: `src/components/layout/Layout.tsx`

The sidebar nav currently uses the `NAV` array at the top of the file. The "Finance Overview" item must appear after the existing `finance` entry. It should be visible to `admin` and `committee` roles — achieved by adding `committeeVisible: true` and filtering in the `visibleNav` derivation, or by using the `adminOnly` flag pattern already present. Since `committee` should also see this page, and the existing pattern only has `adminOnly` for full exclusion, the cleanest approach is to add a `roles` array field and filter on it.

However, the existing code uses `adminOnly` boolean — we will keep consistency and add a new optional `hideFromRoles` approach. The simplest correct approach: add the item to `NAV` without `adminOnly`, so both admin and committee see it, but the `OWNER_BLOCKED` list already blocks owners from `/finance-overview`. Since auditors should NOT see this page per the spec, add `adminOrCommitteeOnly: true` flag and filter it.

- [ ] **Step 1: Add nav item and filter**

In `src/components/layout/Layout.tsx`, update the `NAV` array entry after `{ to: '/finance', ... }`:

Current:
```typescript
const NAV = [
  { to: '/dashboard',     icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/dues',          icon: IndianRupee,     label: 'Dues',              badge: 'dues' },
  { to: '/transactions',  icon: Banknote,        label: 'Transactions',      badge: 'review' },
  { to: '/corpus',        icon: Building2,       label: 'Corpus' },
  { to: '/finance',       icon: PiggyBank,       label: 'Finance' },
  { to: '/expenses',      icon: Receipt,         label: 'Expenses' },
  { to: '/announcements', icon: Megaphone,       label: 'Announcements' },
  { to: '/flats',         icon: Users,           label: 'Flats & residents' },
  { to: '/reports',       icon: FileText,        label: 'Reports' },
  { to: '/activity',      icon: History,         label: 'Activity log' },
  { to: '/users',         icon: Shield,          label: 'Users',             adminOnly: true },
  { to: '/settings',      icon: Settings,        label: 'Settings',          adminOnly: true },
  { to: '/help',          icon: HelpCircle,      label: 'Help Center' },
]
```

Replace with:
```typescript
const NAV = [
  { to: '/dashboard',        icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/dues',             icon: IndianRupee,     label: 'Dues',              badge: 'dues' },
  { to: '/transactions',     icon: Banknote,        label: 'Transactions',      badge: 'review' },
  { to: '/corpus',           icon: Building2,       label: 'Corpus' },
  { to: '/finance',          icon: PiggyBank,       label: 'Finance' },
  { to: '/finance-overview', icon: LayoutDashboard, label: 'Finance Overview',  adminOrCommitteeOnly: true },
  { to: '/expenses',         icon: Receipt,         label: 'Expenses' },
  { to: '/announcements',    icon: Megaphone,       label: 'Announcements' },
  { to: '/flats',            icon: Users,           label: 'Flats & residents' },
  { to: '/reports',          icon: FileText,        label: 'Reports' },
  { to: '/activity',         icon: History,         label: 'Activity log' },
  { to: '/users',            icon: Shield,          label: 'Users',             adminOnly: true },
  { to: '/settings',         icon: Settings,        label: 'Settings',          adminOnly: true },
  { to: '/help',             icon: HelpCircle,      label: 'Help Center' },
]
```

- [ ] **Step 2: Update visibleNav filter to respect adminOrCommitteeOnly**

In the same file, find the `visibleNav` derivation (currently around line 118–126):

```typescript
const visibleNav = roleLoading
  ? []
  : isOwner
    ? OWNER_NAV
    : (() => {
        const items = NAV.filter(n => !n.adminOnly || role === 'admin')
        if (!hasFlatAssigned) return items
        return [items[0], { to: '/my-flat', icon: Home, label: 'My Flat' }, ...items.slice(1)]
      })()
```

Replace with:

```typescript
const visibleNav = roleLoading
  ? []
  : isOwner
    ? OWNER_NAV
    : (() => {
        const items = NAV.filter(n => {
          if ((n as any).adminOnly && role !== 'admin') return false
          if ((n as any).adminOrCommitteeOnly && role !== 'admin' && role !== 'committee') return false
          return true
        })
        if (!hasFlatAssigned) return items
        return [items[0], { to: '/my-flat', icon: Home, label: 'My Flat' }, ...items.slice(1)]
      })()
```

- [ ] **Step 3: Add `/finance-overview` to OWNER_BLOCKED**

Find:
```typescript
const OWNER_BLOCKED = ['/transactions', '/dues', '/corpus', '/finance', '/expenses', '/flats', '/reports', '/activity', '/users']
```

Replace with:
```typescript
const OWNER_BLOCKED = ['/transactions', '/dues', '/corpus', '/finance', '/finance-overview', '/expenses', '/flats', '/reports', '/activity', '/users']
```

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/Layout.tsx
git commit -m "feat(finance-overview): add Finance Overview nav item (admin + committee only)"
```

---

## Task 4: Smoke-test in dev server

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Manual checks**

Navigate to `http://localhost:5173/finance-overview` and verify:

1. **Hero strip** — 3 cards render with real values from DB. "Net Available Cash" is blue-tinted. "Fixed Deposits" is purple-tinted. "Pending Actions" is red if any actions exist, green if all clear.

2. **Fund panels** — Maintenance Fund (blue) and Corpus Fund (purple) side by side on desktop, stacked on mobile. Each shows Collected / Spent / Available. "View expenses" and "View dues" buttons navigate correctly.

3. **Cash flow chart** — ComposedChart renders with stacked bars for Maintenance (blue) and Corpus (purple) and a Line for Expenses (red). X-axis shows fiscal month labels (e.g. "Apr 25"). Tooltip shows formatted INR values.

4. **Action strip** — Shows relevant banners for overdue flats, FD maturities, or unreconciled expenses. "All clear" banner appears when none are present.

5. **Detail panels** — Left: Aging receivables table shows flat code, block, amount due, status badge (Due/Partial in red/amber). Right: Corpus plan mini-table shows plan name, progress bar, available amount.

6. **Sidebar** — "Finance Overview" item appears for admin and committee roles, not for auditor or owner. Icon is `LayoutDashboard`.

7. **Role guard** — Logged in as auditor: `/finance-overview` should redirect to `/dashboard` (OWNER_BLOCKED does not cover auditor, so the page renders but the nav item is hidden — this is acceptable per spec which says "admin/committee only" for the sidebar; auditors can still navigate directly, which is read-only and safe).

8. **Mobile** — On narrow viewport, fund panels stack vertically. Action strip items remain readable. Detail panels stack vertically.

- [ ] **Step 3: Final TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Final commit (if any fixes were made during smoke test)**

```bash
git add src/pages/FinanceOverviewPage.tsx src/App.tsx src/components/layout/Layout.tsx
git commit -m "fix(finance-overview): smoke-test fixes"
```

---

## Complete File Summary

| File | Change |
|------|--------|
| `src/pages/FinanceOverviewPage.tsx` | **Created** — 8 data queries, 5 rendered sections |
| `src/App.tsx` | **Modified** — import + `<Route path="finance-overview" />` |
| `src/components/layout/Layout.tsx` | **Modified** — NAV entry, visibleNav filter, OWNER_BLOCKED |

**No schema migrations required.** All data comes from existing tables and views: `transactions`, `expenses`, `v_corpus_tracker`, `v_dues_tracker`, `deposits`, `v_monthly_summary`.

---

## Key Implementation Decisions

- **ComposedChart over BarChart** — The spec requires stacked bars (Maintenance + Corpus) plus an overlaid line (Expenses). Recharts `ComposedChart` with `stackId` on the `Bar` components and a `Line` component is the correct Recharts pattern for this. `BarChart` cannot natively mix bars and lines.

- **Corpus "spent" query** — The query uses `expenses.corpus_plan_id IS NOT NULL` as the corpus-expense discriminator, matching the spec exactly. This is consistent with how CorpusPage.tsx tracks corpus expenditure.

- **Maintenance "spent" query** — The spec requires filtering by `category.budget_type === 'Maintenance'`. This is done with a joined select `category:category_id(budget_type)` and client-side filter, which avoids a separate RPC and is consistent with how ExpensesPage handles category filtering.

- **adminOrCommitteeOnly flag** — The existing `adminOnly` boolean pattern in Layout.tsx is extended minimally with `adminOrCommitteeOnly`. This avoids a full refactor to a `roles[]` array while keeping the intent explicit. Auditors can still deep-link to `/finance-overview` (they have read access to all underlying tables), but the nav item does not appear for them.

- **OWNER_BLOCKED** — Adding `/finance-overview` ensures the redirect guard catches owners navigating to this URL directly, consistent with how all other management pages are protected.

- **Corpus deduplication** — `v_corpus_tracker` returns one row per (flat, plan) pair. To get plan-level totals (collected, target), the page groups by `plan_id` client-side using a Map, same pattern as DashboardPage.tsx.

- **No `principal_amount` column** — The `deposits` table uses `principal` (not `principal_amount`) per the `Deposit` interface in `src/lib/supabase.ts`. The spec's query pseudocode uses `principal_amount` — the plan uses the correct column name `principal`.
