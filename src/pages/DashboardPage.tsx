import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  LayoutDashboard, TrendingUp, AlertTriangle, ArrowRight,
  IndianRupee, Building2, CalendarClock, GitMerge,
} from 'lucide-react'
import {
  Bar, Line, XAxis, YAxis, Tooltip,
  Legend, ResponsiveContainer, ComposedChart,
} from 'recharts'
import { supabase } from '@/lib/supabase'
import { formatINR } from '@/lib/tagger'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useRoleCtx } from '@/contexts/RoleContext'
import OwnerPortalPage from '@/pages/OwnerPortalPage'

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

interface DepositRow {
  id: string
  principal: number
  maturity_date: string
  status: string
}

export default function DashboardPage() {
  const { isOwner, loading } = useRoleCtx()
  if (loading) return null
  if (isOwner) return <OwnerPortalPage />
  return <DashboardContent />
}

function DashboardContent() {
  const navigate = useNavigate()
  const { fyLabel } = getCurrentFY()

  const { data: maintCollected = 0 } = useQuery({
    queryKey: ['fo-maint-collected-lifetime'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('amount')
        .eq('cr_dr', 'CR')
        .eq('corpus', 'NO')
        .neq('row_type', 'VOIDED')
      if (error) throw error
      return (data ?? []).reduce((s: number, r: { amount: number | null }) => s + (r.amount ?? 0), 0)
    },
  })

  const { data: maintSpent = 0 } = useQuery({
    queryKey: ['fo-maint-spent-lifetime'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('amount')
        .eq('cr_dr', 'DR')
        .eq('corpus', 'NO')
        .neq('row_type', 'VOIDED')
      if (error) throw error
      return (data ?? []).reduce((s: number, r: { amount: number | null }) => s + (r.amount ?? 0), 0)
    },
  })

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

  const { data: corpusSpent = 0 } = useQuery({
    queryKey: ['fo-corpus-spent'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('amount')
        .not('corpus_plan_id', 'is', null)
        .is('voided_at', null)
      if (error) throw error
      return (data ?? []).reduce((s: number, e: { amount: number | null }) => s + (e.amount ?? 0), 0)
    },
  })

  const { data: corpusSpentByPlan = [] } = useQuery<{ corpus_plan_id: string; total: number }[]>({
    queryKey: ['fo-corpus-spent-by-plan'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('corpus_plan_id, amount')
        .not('corpus_plan_id', 'is', null)
        .is('voided_at', null)
      if (error) throw error
      const byPlan = new Map<string, number>()
      for (const e of data ?? []) {
        const id = e.corpus_plan_id as string
        byPlan.set(id, (byPlan.get(id) ?? 0) + (e.amount ?? 0))
      }
      return Array.from(byPlan.entries()).map(([corpus_plan_id, total]) => ({ corpus_plan_id, total }))
    },
  })

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

  const pendingDuesTotal = duesData.reduce((s, d) => s + Math.max(0, d.pending ?? 0), 0)
  const overdueFlatCount = duesData.filter(d => d.status !== 'Clear').length

  const corpusByPlan = new Map<string, { name: string; status: string; collected: number; target: number; spent: number; balance: number }>()
  for (const row of corpusRows) {
    if (!corpusByPlan.has(row.plan_id)) {
      corpusByPlan.set(row.plan_id, { name: row.plan_name, status: row.plan_status, collected: 0, target: 0, spent: 0, balance: 0 })
    }
    const p = corpusByPlan.get(row.plan_id)!
    p.collected += row.collected ?? 0
    p.target    += row.effective_target ?? 0
    p.balance   += row.balance ?? 0
  }
  for (const { corpus_plan_id, total } of corpusSpentByPlan) {
    const p = corpusByPlan.get(corpus_plan_id)
    if (p) p.spent = total
  }
  const corpusPlans     = Array.from(corpusByPlan.entries()).map(([id, p]) => ({ id, ...p }))
  const activePlans     = corpusPlans.filter(p => p.status === 'active')
  const corpusCollected = corpusPlans.reduce((s, p) => s + p.collected, 0)
  const corpusAvailable = Math.max(0, corpusCollected - corpusSpent)
  const maintAvailable  = Math.max(0, maintCollected - maintSpent)

  const fdTotal        = deposits.reduce((s, d) => s + d.principal, 0)
  const fdMaturingSoon = deposits.filter(d => { const days = daysUntil(d.maturity_date); return days >= 0 && days <= 30 })
  const nextFD         = deposits.length > 0
    ? deposits.reduce((a, b) => parseLocalDate(a.maturity_date) < parseLocalDate(b.maturity_date) ? a : b)
    : null

  const pendingActionsCount = overdueFlatCount + unreconciledCount + fdMaturingSoon.length
  const netAvailableCash    = maintAvailable + corpusAvailable

  type MonthlyRow = { fiscal_label: string; maintenance_collected: number | null; corpus_collected: number | null; total_expenses: number | null }
  const chartData = (monthlyRaw as MonthlyRow[]).slice(-12).map(m => ({
    month:       m.fiscal_label,
    Maintenance: m.maintenance_collected ?? 0,
    Corpus:      m.corpus_collected ?? 0,
    Expenses:    m.total_expenses ?? 0,
  }))

  return (
    <div className="flex flex-col gap-5 fade-in">

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[24px] font-extrabold flex items-center gap-2">
            <LayoutDashboard size={22} style={{ color: 'var(--brand-600)' }} />
            Dashboard
          </h1>
          <p className="text-[13.5px] mt-1" style={{ color: 'var(--ink-500)' }}>
            {fyLabel} · Lilac Apartments · Live cash position &amp; action items
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button
          onClick={() => navigate('/expenses?filter=maintenance')}
          className="surface !p-4 text-left hover:shadow-md transition-shadow"
          style={{ background: 'var(--brand-50)', borderColor: 'var(--brand-200)' }}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-[9px] flex items-center justify-center" style={{ background: 'var(--brand-100)', color: 'var(--brand-600)' }}>
              <IndianRupee size={16} />
            </div>
            <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--brand-600)' }}>Net Available Cash</p>
          </div>
          <p className="text-[28px] font-extrabold tnum leading-tight" style={{ color: 'var(--brand-700)' }}>{formatINR(netAvailableCash)}</p>
          <p className="text-[11.5px] mt-1" style={{ color: 'var(--brand-500)' }}>Maintenance + Corpus available</p>
        </button>

        <button
          onClick={() => navigate('/finance')}
          className="surface !p-4 text-left hover:shadow-md transition-shadow"
          style={{ background: '#f5f3ff', borderColor: '#c4b5fd' }}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-[9px] flex items-center justify-center" style={{ background: '#ede9fe', color: '#7c3aed' }}>
              <TrendingUp size={16} />
            </div>
            <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: '#7c3aed' }}>Fixed Deposits</p>
          </div>
          <p className="text-[28px] font-extrabold tnum leading-tight" style={{ color: '#5b21b6' }}>{formatINR(fdTotal)}</p>
          <p className="text-[11.5px] mt-1" style={{ color: '#8b5cf6' }}>
            {deposits.length} active FD{deposits.length !== 1 ? 's' : ''}
            {nextFD ? ` · next maturity ${parseLocalDate(nextFD.maturity_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}` : ''}
          </p>
        </button>

        <button
          onClick={() => navigate('/dues')}
          className="surface !p-4 text-left hover:shadow-md transition-shadow"
          style={pendingActionsCount > 0
            ? { background: 'var(--bad-bg)', borderColor: 'var(--bad-bd)' }
            : { background: 'var(--ok-bg)', borderColor: 'var(--ok-bd)' }}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-[9px] flex items-center justify-center"
              style={pendingActionsCount > 0
                ? { background: 'rgba(239,68,68,.15)', color: 'var(--bad)' }
                : { background: 'rgba(34,197,94,.15)', color: 'var(--ok)' }}>
              <AlertTriangle size={16} />
            </div>
            <p className="text-[12px] font-semibold uppercase tracking-wide"
              style={{ color: pendingActionsCount > 0 ? 'var(--bad)' : 'var(--ok)' }}>
              Pending Actions
            </p>
          </div>
          <p className="text-[28px] font-extrabold tnum leading-tight"
            style={{ color: pendingActionsCount > 0 ? 'var(--bad)' : 'var(--ok)' }}>
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="surface !p-5 flex flex-col gap-4" style={{ background: 'var(--brand-50)', borderColor: 'var(--brand-200)' }}>
          <div className="flex items-center gap-2">
            <IndianRupee size={18} style={{ color: 'var(--brand-600)' }} />
            <p className="text-[14px] font-bold" style={{ color: 'var(--brand-700)' }}>Maintenance Fund</p>
            <Badge variant="outline" className="ml-auto text-[11px]" style={{ background: 'var(--brand-100)', color: 'var(--brand-700)', borderColor: 'var(--brand-300)' }}>
              Lifetime
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl p-3" style={{ background: 'var(--brand-100)' }}>
              <p className="text-[11px] font-medium mb-1" style={{ color: 'var(--brand-600)' }}>Bank CRs</p>
              <p className="text-[20px] font-bold tnum" style={{ color: 'var(--brand-800)' }}>{formatINR(maintCollected)}</p>
            </div>
            <div className="rounded-xl p-3" style={{ background: 'var(--brand-100)' }}>
              <p className="text-[11px] font-medium mb-1" style={{ color: 'var(--brand-600)' }}>Bank DRs</p>
              <p className="text-[20px] font-bold tnum" style={{ color: 'var(--brand-800)' }}>{formatINR(maintSpent)}</p>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: 'white' }}>
            <div>
              <p className="text-[11.5px]" style={{ color: 'var(--ink-500)' }}>Available</p>
              <p className="text-[22px] font-extrabold tnum" style={{ color: 'var(--brand-700)' }}>{formatINR(maintAvailable)}</p>
            </div>
            <Button size="sm" variant="outline" className="text-[12px]" style={{ borderColor: 'var(--brand-400)', color: 'var(--brand-700)' }} onClick={() => navigate('/expenses?filter=maintenance')}>
              View expenses <ArrowRight size={13} className="ml-1" />
            </Button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11.5px]" style={{ color: 'var(--ink-500)' }}>Pending dues</p>
              <p className="text-[16px] font-bold tnum" style={{ color: pendingDuesTotal > 0 ? 'var(--bad)' : 'var(--ok)' }}>
                {formatINR(pendingDuesTotal)}
                <span className="text-[12px] font-normal ml-1.5" style={{ color: 'var(--ink-400)' }}>
                  ({overdueFlatCount} flat{overdueFlatCount !== 1 ? 's' : ''})
                </span>
              </p>
            </div>
            <Button size="sm" variant="outline" className="text-[12px]" onClick={() => navigate('/dues')}>
              View dues <ArrowRight size={13} className="ml-1" />
            </Button>
          </div>
        </div>

        <div className="surface !p-5 flex flex-col gap-4" style={{ background: '#f5f3ff', borderColor: '#c4b5fd' }}>
          <div className="flex items-center gap-2">
            <Building2 size={18} style={{ color: '#7c3aed' }} />
            <p className="text-[14px] font-bold" style={{ color: '#5b21b6' }}>Corpus Fund</p>
            <Badge variant="outline" className="ml-auto text-[11px]" style={{ background: '#ede9fe', color: '#7c3aed', borderColor: '#c4b5fd' }}>
              {activePlans.length} active plan{activePlans.length !== 1 ? 's' : ''}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl p-3" style={{ background: '#ede9fe' }}>
              <p className="text-[11px] font-medium mb-1" style={{ color: '#7c3aed' }}>Collected</p>
              <p className="text-[20px] font-bold tnum" style={{ color: '#5b21b6' }}>{formatINR(corpusCollected)}</p>
            </div>
            <div className="rounded-xl p-3" style={{ background: '#ede9fe' }}>
              <p className="text-[11px] font-medium mb-1" style={{ color: '#7c3aed' }}>Spent</p>
              <p className="text-[20px] font-bold tnum" style={{ color: '#5b21b6' }}>{formatINR(corpusSpent)}</p>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: 'white' }}>
            <div>
              <p className="text-[11.5px]" style={{ color: 'var(--ink-500)' }}>Available</p>
              <p className="text-[22px] font-extrabold tnum" style={{ color: '#5b21b6' }}>{formatINR(corpusAvailable)}</p>
            </div>
            <Button size="sm" variant="outline" className="text-[12px]" style={{ borderColor: '#a78bfa', color: '#7c3aed' }} onClick={() => navigate('/corpus')}>
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

      <div className="surface !p-5">
        <p className="text-[13.5px] font-semibold mb-4" style={{ color: 'var(--ink-700)' }}>
          12-month cash flow — collections vs expenses
        </p>
        {chartData.length === 0 ? (
          <div className="flex items-center justify-center h-[240px]" style={{ color: 'var(--ink-400)' }}>
            <p className="text-[13px]">No data yet</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--ink-400)' }} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: 'var(--ink-400)' }} tickLine={false} axisLine={false} width={52} />
              <Tooltip formatter={(v: unknown, name: string) => [formatINR(v as number), name]} contentStyle={{ borderRadius: 10, border: '1px solid var(--ink-200)', fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} formatter={(value: string) => <span style={{ color: 'var(--ink-500)' }}>{value}</span>} />
              <Bar dataKey="Maintenance" stackId="collections" fill="var(--maint)"  radius={[0, 0, 0, 0] as [number, number, number, number]} maxBarSize={22} />
              <Bar dataKey="Corpus"      stackId="collections" fill="var(--corpus)" radius={[3, 3, 0, 0] as [number, number, number, number]} maxBarSize={22} />
              <Line type="monotone" dataKey="Expenses" stroke="var(--expense)" strokeWidth={2} dot={{ r: 3, fill: 'var(--expense)', strokeWidth: 0 } as object} activeDot={{ r: 5 }} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {overdueFlatCount > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-[12px] border" style={{ background: 'var(--bad-bg)', borderColor: 'var(--bad-bd)' }}>
            <IndianRupee size={17} style={{ color: 'var(--bad)' }} className="shrink-0" />
            <p className="flex-1 text-[13px] font-semibold" style={{ color: 'var(--bad)' }}>
              {overdueFlatCount} flat{overdueFlatCount > 1 ? 's' : ''} with pending dues — {formatINR(pendingDuesTotal)} outstanding
            </p>
            <Button size="sm" variant="outline" className="text-[12px] shrink-0" style={{ borderColor: 'var(--bad-bd)', color: 'var(--bad)' }} onClick={() => navigate('/dues')}>
              View <ArrowRight size={12} className="ml-1" />
            </Button>
          </div>
        )}
        {fdMaturingSoon.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-[12px] border" style={{ background: 'var(--warn-bg)', borderColor: 'var(--warn-bd)' }}>
            <CalendarClock size={17} style={{ color: 'var(--warn)' }} className="shrink-0" />
            <p className="flex-1 text-[13px] font-semibold" style={{ color: 'var(--warn)' }}>
              {fdMaturingSoon.length} FD{fdMaturingSoon.length > 1 ? 's' : ''} maturing in the next 30 days
              {fdMaturingSoon.length === 1 && nextFD ? ` — ${parseLocalDate(nextFD.maturity_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}
            </p>
            <Button size="sm" variant="outline" className="text-[12px] shrink-0" style={{ borderColor: 'var(--warn-bd)', color: 'var(--warn)' }} onClick={() => navigate('/finance')}>
              View <ArrowRight size={12} className="ml-1" />
            </Button>
          </div>
        )}
        {unreconciledCount > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-[12px] border" style={{ background: 'var(--warn-bg)', borderColor: 'var(--warn-bd)' }}>
            <GitMerge size={17} style={{ color: 'var(--warn)' }} className="shrink-0" />
            <p className="flex-1 text-[13px] font-semibold" style={{ color: 'var(--warn)' }}>
              {unreconciledCount} unreconciled expense{unreconciledCount > 1 ? 's' : ''} — bank DRs not matched
            </p>
            <Button size="sm" variant="outline" className="text-[12px] shrink-0" style={{ borderColor: 'var(--warn-bd)', color: 'var(--warn)' }} onClick={() => navigate('/expenses?tab=reconcile')}>
              Reconcile <ArrowRight size={12} className="ml-1" />
            </Button>
          </div>
        )}
        {overdueFlatCount === 0 && unreconciledCount === 0 && fdMaturingSoon.length === 0 && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-[12px] border" style={{ background: 'var(--ok-bg)', borderColor: 'var(--ok-bd)' }}>
            <AlertTriangle size={17} style={{ color: 'var(--ok)' }} className="shrink-0" />
            <p className="text-[13px] font-semibold" style={{ color: 'var(--ok)' }}>No pending actions — everything is up to date</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="surface !p-0 overflow-hidden">
          <div className="px-5 py-3 border-b hairline flex items-center justify-between">
            <p className="text-[13px] font-semibold" style={{ color: 'var(--ink-700)' }}>Aging Receivables</p>
            <Button size="sm" variant="ghost" className="text-[12px] h-7" style={{ color: 'var(--brand-600)' }} onClick={() => navigate('/dues')}>
              View all <ArrowRight size={12} className="ml-1" />
            </Button>
          </div>
          {duesData.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-[13px]" style={{ color: 'var(--ink-400)' }}>All flats are clear</p>
            </div>
          ) : (
            <div className="divide-rows">
              <div className="px-4 py-2 grid grid-cols-[1fr_auto_auto] gap-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-400)' }}>
                <span>Flat</span>
                <span className="text-right">Amount due</span>
                <span className="text-right">Status</span>
              </div>
              {duesData.slice(0, 8).map(d => (
                <button key={d.flat_code} className="w-full px-4 py-2.5 grid grid-cols-[1fr_auto_auto] gap-3 items-center text-left hover:bg-[var(--ink-50)] transition-colors" onClick={() => navigate('/dues')}>
                  <div>
                    <p className="text-[13px] font-semibold" style={{ color: 'var(--ink-800)' }}>{d.flat_code}</p>
                    <p className="text-[11px]" style={{ color: 'var(--ink-400)' }}>Block {d.block}</p>
                  </div>
                  <p className="text-[13px] font-semibold tnum text-right" style={{ color: 'var(--bad)' }}>{formatINR(d.pending)}</p>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                    style={d.status === 'Due' ? { background: 'var(--bad-bg)', color: 'var(--bad)' } : { background: 'var(--warn-bg)', color: 'var(--warn)' }}>
                    {d.status}
                  </span>
                </button>
              ))}
              {duesData.length > 8 && (
                <div className="px-4 py-2.5 text-center">
                  <button className="text-[12px] font-medium" style={{ color: 'var(--brand-600)' }} onClick={() => navigate('/dues')}>
                    +{duesData.length - 8} more flats — view all
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="surface !p-0 overflow-hidden">
          <div className="px-5 py-3 border-b hairline flex items-center justify-between">
            <p className="text-[13px] font-semibold" style={{ color: 'var(--ink-700)' }}>Corpus Plans</p>
            <Button size="sm" variant="ghost" className="text-[12px] h-7" style={{ color: 'var(--brand-600)' }} onClick={() => navigate('/corpus')}>
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
                  <button key={p.id} className="w-full px-4 py-3 text-left hover:bg-[var(--ink-50)] transition-colors" onClick={() => navigate(`/corpus?plan=${p.id}`)}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--ink-800)' }}>{p.name}</p>
                          <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full capitalize"
                            style={p.status === 'active' ? { background: 'var(--ok-bg)', color: 'var(--ok)' } : { background: 'var(--ink-100)', color: 'var(--ink-500)' }}>
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
                        <p className="text-[14px] font-bold tnum" style={{ color: '#5b21b6' }}>{formatINR(available)}</p>
                      </div>
                    </div>
                    <div className="ds-track">
                      <div className="ds-track-fill" style={{ width: `${pct}%`, background: 'var(--corpus)' }} />
                    </div>
                    <p className="text-[11px] mt-1 text-right" style={{ color: 'var(--ink-400)' }}>{pct}% of target</p>
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
