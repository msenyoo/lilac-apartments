import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  LayoutDashboard, TrendingUp, AlertTriangle, ArrowRight,
  IndianRupee, Building2, HandHeart,
} from 'lucide-react'
import {
  Bar, Line, XAxis, YAxis, Tooltip,
  Legend, ResponsiveContainer, ComposedChart,
} from 'recharts'
import { supabase } from '@/lib/supabase'
import { formatINR } from '@/lib/tagger'
import { driveBalanceLabel } from '@/lib/contributions'
import { computePettyCashBalance } from '@/lib/pettyCash'
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

  const { data: fundPositions = [] } = useQuery<{ fund: string; receipts: number; payments: number; balance: number }[]>({
    queryKey: ['fo-fund-position'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_fund_position')
        .select('fund, receipts, payments, balance')
      if (error) throw error
      return (data ?? []) as { fund: string; receipts: number; payments: number; balance: number }[]
    },
  })
  const { data: pettyCashBalance = 0 } = useQuery({
    queryKey: ['petty-cash-balance'],
    queryFn: async () => {
      const { data } = await supabase.from('petty_cash_transactions').select('txn_type, amount')
      return computePettyCashBalance(data ?? [])
    },
  })

  const maintenancePos    = fundPositions.find(p => p.fund === 'Maintenance')
  const corpusPos         = fundPositions.find(p => p.fund === 'Corpus')
  const contributionPos   = fundPositions.find(p => p.fund === 'Contribution')
  const maintCollected    = maintenancePos?.receipts ?? 0
  const maintSpent        = maintenancePos?.payments ?? 0

  const { data: duesData = [] } = useQuery<DuesRow[]>({
    queryKey: ['fo-dues'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_dues_tracker')
        .select('flat_code, block, pending, status, total_outstanding, annual_due')
        .neq('status', 'Clear')
        .order('total_outstanding', { ascending: false })
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

  const { data: openDrives = [] } = useQuery<{ drive_id: string; name: string; collected: number; disbursed: number; balance: number }[]>({
    queryKey: ['fo-open-contribution-drives'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_contribution_tracker')
        .select('drive_id, name, collected, disbursed, balance')
        .eq('status', 'open')
        .order('name')
      if (error) throw error
      return (data ?? []) as { drive_id: string; name: string; collected: number; disbursed: number; balance: number }[]
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

  const dueFlats = duesData.filter(d => (d.total_outstanding ?? 0) > 0)
  const pendingDuesTotal = dueFlats.reduce((s, d) => s + d.total_outstanding, 0)
  const overdueFlatCount = dueFlats.length

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
  // Spent scoped to the same plans as Collected (tracker = active/draft only)
  const corpusSpent     = corpusPlans.reduce((s, p) => s + p.spent, 0)
  // Available = bank-ledger balance per fund (v_fund_position), so the net
  // always ties to the actual bank balance. corpusCollected/corpusSpent stay
  // for plan-progress displays only.
  const corpusAvailable       = Math.max(0, corpusPos?.balance ?? 0)
  const maintBalance          = maintenancePos?.balance ?? 0
  const contributionAvailable = Math.max(0, contributionPos?.balance ?? 0)

  const fdTotal        = deposits.reduce((s, d) => s + d.principal, 0)
  const fdMaturingSoon = deposits.filter(d => { const days = daysUntil(d.maturity_date); return days >= 0 && days <= 30 })
  const nextFD         = deposits.length > 0
    ? deposits.reduce((a, b) => parseLocalDate(a.maturity_date) < parseLocalDate(b.maturity_date) ? a : b)
    : null

  const pendingActionsCount = overdueFlatCount + unreconciledCount + fdMaturingSoon.length
  // Sum raw (unclamped) fund balances, not the per-fund clamped Available values above —
  // a fund running a deficit (e.g. Maintenance overspent, covered by Corpus) must still net
  // out here, or this headline stops tying to the actual bank balance.
  const netAvailableCash    = (maintenancePos?.balance ?? 0) + (corpusPos?.balance ?? 0) + (contributionPos?.balance ?? 0)

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

      {/* Mobile: compact row list — the hero-card layout below eats 3 screens of scroll on a phone */}
      <div className="sm:hidden surface !p-0 overflow-hidden divide-rows">
        <button onClick={() => navigate('/expenses?filter=maintenance')} className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-[var(--ink-50)]">
          <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--brand-100)', color: 'var(--brand-600)' }}>
            <IndianRupee size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold" style={{ color: 'var(--ink-700)' }}>Net Available Cash</p>
            <p className="text-[11px] truncate" style={{ color: 'var(--ink-400)' }}>
              Maintenance + Corpus{contributionAvailable > 0 ? ' + Contributions' : ''}{pettyCashBalance > 0 ? ` · +${formatINR(pettyCashBalance)} cash` : ''}
            </p>
          </div>
          <p className="text-[16px] font-extrabold tnum shrink-0" style={{ color: 'var(--brand-700)' }}>{formatINR(netAvailableCash)}</p>
        </button>

        <button onClick={() => navigate('/finance')} className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-[var(--ink-50)]">
          <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: '#ede9fe', color: '#7c3aed' }}>
            <TrendingUp size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold" style={{ color: 'var(--ink-700)' }}>Fixed Deposits</p>
            <p className="text-[11px] truncate" style={{ color: 'var(--ink-400)' }}>
              {deposits.length} active{nextFD ? ` · matures ${parseLocalDate(nextFD.maturity_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}` : ''}
            </p>
          </div>
          <p className="text-[16px] font-extrabold tnum shrink-0" style={{ color: '#5b21b6' }}>{formatINR(fdTotal)}</p>
        </button>

        <button onClick={() => navigate('/dues')} className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-[var(--ink-50)]">
          <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
            style={pendingActionsCount > 0
              ? { background: 'rgba(239,68,68,.15)', color: 'var(--bad)' }
              : { background: 'rgba(34,197,94,.15)', color: 'var(--ok)' }}>
            <AlertTriangle size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold" style={{ color: 'var(--ink-700)' }}>Pending Actions</p>
            <p className="text-[11px] truncate" style={{ color: 'var(--ink-400)' }}>
              {pendingActionsCount === 0
                ? 'All clear'
                : [
                    overdueFlatCount > 0 && `${overdueFlatCount} overdue`,
                    unreconciledCount > 0 && `${unreconciledCount} unreconciled`,
                    fdMaturingSoon.length > 0 && `${fdMaturingSoon.length} FD maturing`,
                  ].filter(Boolean).join(' · ')
              }
            </p>
          </div>
          <p className="text-[16px] font-extrabold tnum shrink-0" style={{ color: pendingActionsCount > 0 ? 'var(--bad)' : 'var(--ok)' }}>
            {pendingActionsCount}
          </p>
        </button>
      </div>

      {/* sm+: original hero cards */}
      <div className="hidden sm:grid sm:grid-cols-3 gap-3">
        <button
          onClick={() => navigate('/expenses?filter=maintenance')}
          className="surface !p-4 text-left hover:shadow-md transition-shadow"
          style={{ background: 'var(--brand-50)', borderColor: 'var(--brand-200)' }}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-[9px] flex items-center justify-center shrink-0" style={{ background: 'var(--brand-100)', color: 'var(--brand-600)' }}>
              <IndianRupee size={16} />
            </div>
            <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--brand-600)' }}>Net Available Cash</p>
          </div>
          <p className="text-[28px] font-extrabold tnum leading-tight" style={{ color: 'var(--brand-700)' }}>{formatINR(netAvailableCash)}</p>
          <p className="text-[11.5px] mt-1" style={{ color: 'var(--brand-500)' }}>
            Maintenance + Corpus{contributionAvailable > 0 ? ' + Contributions' : ''} available
          </p>
          {pettyCashBalance > 0 && (
            <p className="text-[10.5px] mt-0.5" style={{ color: 'var(--brand-400)' }}>
              + {formatINR(pettyCashBalance)} cash in hand
            </p>
          )}
        </button>

        <button
          onClick={() => navigate('/finance')}
          className="surface !p-4 text-left hover:shadow-md transition-shadow"
          style={{ background: '#f5f3ff', borderColor: '#c4b5fd' }}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-[9px] flex items-center justify-center shrink-0" style={{ background: '#ede9fe', color: '#7c3aed' }}>
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
            <div className="w-8 h-8 rounded-[9px] flex items-center justify-center shrink-0"
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
        <div className="surface !p-4 sm:!p-5 flex flex-col gap-3 sm:gap-4" style={{ background: 'var(--brand-50)', borderColor: 'var(--brand-200)' }}>
          <div className="flex items-center gap-2">
            <IndianRupee size={17} style={{ color: 'var(--brand-600)' }} />
            <p className="text-[13.5px] sm:text-[14px] font-bold" style={{ color: 'var(--brand-700)' }}>Maintenance Fund</p>
            <Badge variant="outline" className="ml-auto text-[11px]" style={{ background: 'var(--brand-100)', color: 'var(--brand-700)', borderColor: 'var(--brand-300)' }}>
              Lifetime
            </Badge>
          </div>
          <div className="sm:hidden flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--brand-600)' }}>
            <span>Bank CRs <span className="font-bold tnum" style={{ color: 'var(--brand-800)' }}>{formatINR(maintCollected)}</span></span>
            <span style={{ color: 'var(--brand-300)' }}>·</span>
            <span>Bank DRs <span className="font-bold tnum" style={{ color: 'var(--brand-800)' }}>{formatINR(maintSpent)}</span></span>
          </div>
          <div className="hidden sm:grid sm:grid-cols-2 gap-3">
            <div className="rounded-xl p-3" style={{ background: 'var(--brand-100)' }}>
              <p className="text-[11px] font-medium mb-1" style={{ color: 'var(--brand-600)' }}>Bank CRs</p>
              <p className="text-[20px] font-bold tnum" style={{ color: 'var(--brand-800)' }}>{formatINR(maintCollected)}</p>
            </div>
            <div className="rounded-xl p-3" style={{ background: 'var(--brand-100)' }}>
              <p className="text-[11px] font-medium mb-1" style={{ color: 'var(--brand-600)' }}>Bank DRs</p>
              <p className="text-[20px] font-bold tnum" style={{ color: 'var(--brand-800)' }}>{formatINR(maintSpent)}</p>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-xl px-3.5 py-2.5 sm:px-4 sm:py-3" style={{ background: 'white' }}>
            <div>
              <p className="text-[11px] sm:text-[11.5px]" style={{ color: 'var(--ink-500)' }}>{maintBalance < 0 ? 'Funded by Corpus' : 'Available'}</p>
              <p className="text-[19px] sm:text-[22px] font-extrabold tnum" style={{ color: maintBalance < 0 ? '#dc2626' : 'var(--brand-700)' }}>{formatINR(Math.abs(maintBalance))}</p>
            </div>
            <Button size="sm" variant="outline" className="text-[12px]" style={{ borderColor: 'var(--brand-400)', color: 'var(--brand-700)' }} onClick={() => navigate('/expenses?filter=maintenance')}>
              View expenses <ArrowRight size={13} className="ml-1" />
            </Button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] sm:text-[11.5px]" style={{ color: 'var(--ink-500)' }}>Outstanding dues</p>
              <p className="text-[15px] sm:text-[16px] font-bold tnum" style={{ color: pendingDuesTotal > 0 ? 'var(--bad)' : 'var(--ok)' }}>
                {formatINR(pendingDuesTotal)}
                <span className="text-[11.5px] sm:text-[12px] font-normal ml-1.5" style={{ color: 'var(--ink-400)' }}>
                  ({overdueFlatCount} flat{overdueFlatCount !== 1 ? 's' : ''})
                </span>
              </p>
            </div>
            <Button size="sm" variant="outline" className="text-[12px]" onClick={() => navigate('/dues')}>
              View dues <ArrowRight size={13} className="ml-1" />
            </Button>
          </div>
        </div>

        <div className="surface !p-4 sm:!p-5 flex flex-col gap-3 sm:gap-4" style={{ background: '#f5f3ff', borderColor: '#c4b5fd' }}>
          <div className="flex items-center gap-2">
            <Building2 size={17} style={{ color: '#7c3aed' }} />
            <p className="text-[13.5px] sm:text-[14px] font-bold" style={{ color: '#5b21b6' }}>Corpus Fund</p>
            <Badge variant="outline" className="ml-auto text-[11px]" style={{ background: '#ede9fe', color: '#7c3aed', borderColor: '#c4b5fd' }}>
              {activePlans.length} active plan{activePlans.length !== 1 ? 's' : ''}
            </Badge>
          </div>
          <div className="sm:hidden flex items-center gap-1.5 text-[12px]" style={{ color: '#7c3aed' }}>
            <span>Collected <span className="font-bold tnum" style={{ color: '#5b21b6' }}>{formatINR(corpusCollected)}</span></span>
            <span style={{ color: '#c4b5fd' }}>·</span>
            <span>Spent <span className="font-bold tnum" style={{ color: '#5b21b6' }}>{formatINR(corpusSpent)}</span></span>
          </div>
          <div className="hidden sm:grid sm:grid-cols-2 gap-3">
            <div className="rounded-xl p-3" style={{ background: '#ede9fe' }}>
              <p className="text-[11px] font-medium mb-1" style={{ color: '#7c3aed' }}>Collected</p>
              <p className="text-[20px] font-bold tnum" style={{ color: '#5b21b6' }}>{formatINR(corpusCollected)}</p>
            </div>
            <div className="rounded-xl p-3" style={{ background: '#ede9fe' }}>
              <p className="text-[11px] font-medium mb-1" style={{ color: '#7c3aed' }}>Spent</p>
              <p className="text-[20px] font-bold tnum" style={{ color: '#5b21b6' }}>{formatINR(corpusSpent)}</p>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-xl px-3.5 py-2.5 sm:px-4 sm:py-3" style={{ background: 'white' }}>
            <div>
              <p className="text-[11px] sm:text-[11.5px]" style={{ color: 'var(--ink-500)' }}>Available</p>
              <p className="text-[19px] sm:text-[22px] font-extrabold tnum" style={{ color: '#5b21b6' }}>{formatINR(corpusAvailable)}</p>
            </div>
            <Button size="sm" variant="outline" className="text-[12px]" style={{ borderColor: '#a78bfa', color: '#7c3aed' }} onClick={() => navigate('/corpus')}>
              View corpus <ArrowRight size={13} className="ml-1" />
            </Button>
          </div>
          <div>
            <p className="text-[11px] sm:text-[11.5px]" style={{ color: 'var(--ink-500)' }}>Active plans</p>
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

      {openDrives.length > 0 && (
        <div className="surface !p-4 sm:!p-5 flex flex-col gap-3" style={{ background: '#fff1f2', borderColor: '#fecdd3' }}>
          <div className="flex items-center gap-2">
            <HandHeart size={17} style={{ color: '#e11d48' }} />
            <p className="text-[13.5px] sm:text-[14px] font-bold" style={{ color: '#9f1239' }}>Active Contributions</p>
            <Badge variant="outline" className="ml-auto text-[11px]" style={{ background: '#ffe4e6', color: '#e11d48', borderColor: '#fecdd3' }}>
              {openDrives.length} open drive{openDrives.length !== 1 ? 's' : ''}
            </Badge>
          </div>
          <div className="flex flex-col gap-2">
            {openDrives.map(d => (
              <button key={d.drive_id} onClick={() => navigate('/contributions')}
                className="flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 sm:px-4 sm:py-3 text-left hover:opacity-90 transition-opacity"
                style={{ background: 'white' }}>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold truncate" style={{ color: '#9f1239' }}>{d.name}</p>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--ink-400)' }}>
                    Collected {formatINR(d.collected)}{d.disbursed > 0 && <> · Disbursed {formatINR(d.disbursed)}</>}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[11px]" style={{ color: 'var(--ink-400)' }}>{driveBalanceLabel(d.balance).label}</p>
                  <p className="text-[16px] font-bold tnum" style={{ color: '#e11d48' }}>{formatINR(driveBalanceLabel(d.balance).amount)}</p>
                </div>
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" className="self-start text-[12px]" style={{ borderColor: '#fda4af', color: '#e11d48' }} onClick={() => navigate('/contributions')}>
            View contributions <ArrowRight size={13} className="ml-1" />
          </Button>
        </div>
      )}

      <div className="surface !p-4 sm:!p-5">
        <p className="text-[13px] sm:text-[13.5px] font-semibold mb-3 sm:mb-4" style={{ color: 'var(--ink-700)' }}>
          12-month cash flow — collections vs expenses
        </p>
        {chartData.length === 0 ? (
          <div className="flex items-center justify-center h-[240px]" style={{ color: 'var(--ink-400)' }}>
            <p className="text-[13px]">No data yet</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--ink-400)' }} tickLine={false} axisLine={false} angle={-35} textAnchor="end" interval={0} height={40} />
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="surface !p-0 overflow-hidden">
          <div className="px-4 sm:px-5 py-2.5 sm:py-3 border-b hairline flex items-center justify-between">
            <p className="text-[13px] font-semibold" style={{ color: 'var(--ink-700)' }}>Aging Receivables</p>
            <Button size="sm" variant="ghost" className="text-[12px] h-7" style={{ color: 'var(--brand-600)' }} onClick={() => navigate('/dues')}>
              View all <ArrowRight size={12} className="ml-1" />
            </Button>
          </div>
          {dueFlats.length === 0 ? (
            <div className="px-4 sm:px-5 py-6 sm:py-8 text-center">
              <p className="text-[13px]" style={{ color: 'var(--ink-400)' }}>All flats are clear</p>
            </div>
          ) : (
            <div className="divide-rows">
              <div className="px-4 py-2 grid grid-cols-[1fr_auto_auto] gap-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-400)' }}>
                <span>Flat</span>
                <span className="text-right">Amount due</span>
                <span className="text-right">Status</span>
              </div>
              {dueFlats.slice(0, 8).map(d => (
                <button key={d.flat_code} className="w-full px-4 py-2.5 grid grid-cols-[1fr_auto_auto] gap-3 items-center text-left hover:bg-[var(--ink-50)] transition-colors" onClick={() => navigate('/dues')}>
                  <div>
                    <p className="text-[13px] font-semibold" style={{ color: 'var(--ink-800)' }}>{d.flat_code}</p>
                    <p className="text-[11px]" style={{ color: 'var(--ink-400)' }}>Block {d.block}</p>
                  </div>
                  <p className="text-[13px] font-semibold tnum text-right" style={{ color: 'var(--bad)' }}>{formatINR(d.total_outstanding)}</p>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                    style={d.status === 'Due' ? { background: 'var(--bad-bg)', color: 'var(--bad)' } : { background: 'var(--warn-bg)', color: 'var(--warn)' }}>
                    {d.status}
                  </span>
                </button>
              ))}
              {dueFlats.length > 8 && (
                <div className="px-4 py-2.5 text-center">
                  <button className="text-[12px] font-medium" style={{ color: 'var(--brand-600)' }} onClick={() => navigate('/dues')}>
                    +{dueFlats.length - 8} more flats — view all
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="surface !p-0 overflow-hidden">
          <div className="px-4 sm:px-5 py-2.5 sm:py-3 border-b hairline flex items-center justify-between">
            <p className="text-[13px] font-semibold" style={{ color: 'var(--ink-700)' }}>Corpus Plans</p>
            <Button size="sm" variant="ghost" className="text-[12px] h-7" style={{ color: 'var(--brand-600)' }} onClick={() => navigate('/corpus')}>
              View all <ArrowRight size={12} className="ml-1" />
            </Button>
          </div>
          {corpusPlans.length === 0 ? (
            <div className="px-4 sm:px-5 py-6 sm:py-8 text-center">
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
