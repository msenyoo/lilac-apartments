import { useQuery } from '@tanstack/react-query'
import { NavLink } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  TrendingUp, AlertCircle, ArrowRight, IndianRupee,
  Building2, Receipt, GitMerge, Users, Landmark, Coins, Wallet,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatINR } from '@/lib/tagger'
import { useRoleCtx } from '@/contexts/RoleContext'
import OwnerPortalPage from '@/pages/OwnerPortalPage'

export default function DashboardPage() {
  const { isOwner, loading } = useRoleCtx()
  if (loading) return null
  if (isOwner) return <OwnerPortalPage />
  const { data: settings } = useQuery({
    queryKey: ['app-settings'],
    queryFn: async () => {
      const { data } = await supabase.from('app_settings').select('*')
      return Object.fromEntries((data ?? []).map((s: any) => [s.key, s.value]))
    },
  })

  const { data: reviewCount = 0 } = useQuery({
    queryKey: ['review-count'],
    queryFn: async () => {
      const { count, error } = await supabase.from('v_review_queue').select('*', { count: 'exact', head: true })
      if (error) return 0
      return count ?? 0
    },
    refetchInterval: 30_000,
    retry: false,
  })

  const { data: duesData = [] } = useQuery({
    queryKey: ['dues-all'],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_dues_tracker')
        .select('flat_code, block, pending, status, total_outstanding, collected_fy')
        .order('pending', { ascending: false })
      return data ?? []
    },
  })

  const { data: corpusData = [] } = useQuery({
    queryKey: ['corpus-kpi'],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_corpus_tracker')
        .select('plan_id,plan_name,effective_target,collected')
      return data ?? []
    },
  })

  const { data: monthlyData = [] } = useQuery({
    queryKey: ['monthly-collection-chart'],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_monthly_summary')
        .select('fiscal_label,fiscal_year,maintenance_collected,corpus_collected,total_expenses')
        .order('fiscal_year', { ascending: true })
        .order('fiscal_label', { ascending: true })
        .limit(24)
      return data ?? []
    },
  })

  const { data: unreconciledCount = 0 } = useQuery({
    queryKey: ['unreconciled-count'],
    queryFn: async () => {
      const { count } = await supabase
        .from('expenses')
        .select('*', { count: 'exact', head: true })
        .neq('payment_mode', 'Cash')
        .is('transaction_id', null)
        .is('voided_at', null)
      return count ?? 0
    },
    refetchInterval: 60_000,
  })

  const { data: bankPosition } = useQuery({
    queryKey: ['dashboard-bank-position'],
    queryFn: async () => {
      const [{ data: crs }, { data: drs }] = await Promise.all([
        supabase.from('transactions').select('amount, corpus').eq('cr_dr', 'CR').neq('row_type', 'VOIDED'),
        supabase.from('transactions').select('amount, corpus').eq('cr_dr', 'DR').neq('row_type', 'VOIDED'),
      ])
      let totalCR = 0, totalDR = 0, corpCR = 0, corpDR = 0
      for (const r of crs ?? []) { totalCR += r.amount; if (r.corpus === 'YES') corpCR += r.amount }
      for (const r of drs ?? []) { totalDR += r.amount; if (r.corpus === 'YES') corpDR += r.amount }
      return {
        bank: totalCR - totalDR,
        corpusInBank: corpCR - corpDR,
        maintInBank: (totalCR - totalDR) - (corpCR - corpDR),
      }
    },
  })

  const { data: cashOnHand = 0 } = useQuery({
    queryKey: ['dashboard-cash-on-hand'],
    queryFn: async () => {
      const { data } = await supabase.from('petty_cash_transactions').select('txn_type, amount')
      return (data ?? []).reduce((s: number, t: any) =>
        t.txn_type === 'Disbursement' ? s - t.amount : s + t.amount, 0)
    },
  })

  const { data: deposits = [] } = useQuery({
    queryKey: ['dashboard-deposits'],
    queryFn: async () => {
      const { data } = await supabase.from('deposits').select('id, principal, maturity_date, status').eq('status', 'active')
      return (data ?? []) as { id: string; principal: number; maturity_date: string; status: string }[]
    },
  })

  const { data: thisMonthExpenses = 0 } = useQuery({
    queryKey: ['this-month-expenses'],
    queryFn: async () => {
      const now = new Date()
      const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
      const { data } = await supabase.from('expenses').select('amount').gte('expense_date', from).is('voided_at', null)
      return (data ?? []).reduce((s: number, e: any) => s + e.amount, 0)
    },
  })

  const currentFY = settings?.current_fiscal_year ?? String(new Date().getFullYear())
  const fyLabel   = `FY ${currentFY}-${String(parseInt(currentFY) + 1).slice(-2)}`

  const totalPending     = duesData.reduce((s: number, d: any) => s + Math.max(0, d.pending ?? 0), 0)
  const duesCounts       = (duesData as any[]).reduce((acc, d) => {
    if (d.total_outstanding <= 0) acc.Clear += 1
    else if (d.collected_fy > 0) acc.Partial += 1
    else acc.Due += 1
    return acc
  }, { Due: 0, Partial: 0, Clear: 0 })
  const overdueFlatCount = duesCounts.Due + duesCounts.Partial
  const overdueFlats     = (duesData as any[]).filter((d: any) => d.total_outstanding > 0)

  const fdTotal       = deposits.reduce((s, d) => s + (d.principal ?? 0), 0)
  const fdMaturingSoon = deposits.filter(d => {
    if (!d.maturity_date) return false
    const [y, m, day] = d.maturity_date.split('-').map(Number)
    const days = Math.round((new Date(y, m - 1, day).getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000)
    return days >= 0 && days <= 30
  })
  const nextFD = deposits.length > 0
    ? deposits.slice().sort((a, b) => (a.maturity_date ?? '').localeCompare(b.maturity_date ?? ''))[0]
    : null

  const corpusByPlan = new Map<string, { name: string; target: number; collected: number }>()
  for (const row of corpusData as any[]) {
    if (!corpusByPlan.has(row.plan_id)) {
      corpusByPlan.set(row.plan_id, { name: row.plan_name, target: 0, collected: 0 })
    }
    const p = corpusByPlan.get(row.plan_id)!
    p.target    += row.effective_target
    p.collected += row.collected
  }
  const corpusPlans = Array.from(corpusByPlan.values())

  const chartData = (monthlyData as any[]).slice(-12).map((m: any) => ({
    month:       m.fiscal_label,
    Maintenance: m.maintenance_collected,
    Corpus:      m.corpus_collected,
    Expenses:    m.total_expenses,
  }))

  return (
    <div className="flex flex-col gap-5 fade-in">
      {/* Header */}
      <div>
        <h1 className="text-[24px] font-extrabold">Dashboard</h1>
        <p className="text-[13.5px] mt-1" style={{ color: 'var(--ink-500)' }}>{fyLabel} · Lilac Apartments</p>
      </div>

      {/* Financial Position strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {[
          {
            icon: <Landmark size={18} />, tone: 'brand',
            label: 'Bank balance',
            value: formatINR(bankPosition?.bank ?? 0),
            sub: fdTotal > 0 ? `+ ${formatINR(fdTotal)} in FDs` : undefined,
          },
          {
            icon: <Coins size={18} />, tone: cashOnHand > 0 ? 'neutral' : 'warn',
            label: 'Cash on hand',
            value: formatINR(cashOnHand),
            sub: cashOnHand === 0 ? 'Not tracked — record via Expenses → Petty Cash' : undefined,
          },
          {
            icon: <Building2 size={18} />, tone: 'brand',
            label: 'Corpus available',
            value: formatINR(Math.max(0, bankPosition?.corpusInBank ?? 0)),
            sub: 'Collected − spent (in bank)',
          },
          {
            icon: <Wallet size={18} />, tone: (bankPosition?.maintInBank ?? 0) < 0 ? 'bad' : 'neutral',
            label: 'Maintenance available',
            value: formatINR(bankPosition?.maintInBank ?? 0),
            sub: (bankPosition?.maintInBank ?? 0) < 0
              ? 'Deficit — corpus subsidising'
              : 'Bank − corpus claim',
          },
        ].map(({ icon, tone, label, value, sub }) => (
          <div key={label} className="surface !p-4 sm:!p-5 flex flex-col gap-3">
            <div
              className="w-9 h-9 rounded-[10px] flex items-center justify-center"
              style={{
                background: tone === 'brand' ? 'var(--brand-50)'
                  : tone === 'bad'    ? 'var(--bad-bg)'
                  : tone === 'warn'   ? 'var(--warn-bg)'
                  : 'var(--ink-100)',
                color: tone === 'brand' ? 'var(--brand-600)'
                  : tone === 'bad'   ? 'var(--bad)'
                  : tone === 'warn'  ? 'var(--warn)'
                  : 'var(--ink-500)',
              }}
            >
              {icon}
            </div>
            <div>
              <p className="text-[12.5px] font-medium leading-tight" style={{ color: 'var(--ink-500)' }}>{label}</p>
              <p className="text-[26px] font-bold leading-tight mt-1 tnum">{value}</p>
              {sub && <p className="text-[11.5px] mt-1" style={{ color: 'var(--ink-400)' }}>{sub}</p>}
            </div>
          </div>
        ))}
      </div>

      {/* Alert strip */}
      <div className="flex flex-col gap-2">
        {reviewCount > 0 && (
          <NavLink to="/transactions?tab=review"
            className="flex items-center gap-3 px-4 py-3 rounded-[12px] border transition-colors"
            style={{ background: 'var(--warn-bg)', borderColor: 'var(--warn-bd)', color: 'var(--warn)' }}>
            <AlertCircle size={17} className="shrink-0" />
            <p className="flex-1 text-[13px] font-semibold">
              {reviewCount} transaction{reviewCount > 1 ? 's' : ''} need tagging
            </p>
            <ArrowRight size={15} className="shrink-0 opacity-60" />
          </NavLink>
        )}
        {unreconciledCount > 0 && (
          <NavLink to="/expenses"
            className="flex items-center gap-3 px-4 py-3 rounded-[12px] border transition-colors"
            style={{ background: 'var(--warn-bg)', borderColor: 'var(--warn-bd)', color: 'var(--warn)' }}>
            <GitMerge size={17} className="shrink-0" />
            <p className="flex-1 text-[13px] font-semibold">
              {unreconciledCount} unreconciled expense{unreconciledCount > 1 ? 's' : ''} — bank DRs not matched
            </p>
            <ArrowRight size={15} className="shrink-0 opacity-60" />
          </NavLink>
        )}
        {overdueFlatCount > 0 && (
          <NavLink to="/dues"
            className="flex items-center gap-3 px-4 py-3 rounded-[12px] border transition-colors"
            style={{ background: 'var(--bad-bg)', borderColor: 'var(--bad-bd)', color: 'var(--bad)' }}>
            <IndianRupee size={17} className="shrink-0" />
            <p className="flex-1 text-[13px] font-semibold">
              {overdueFlatCount} flat{overdueFlatCount > 1 ? 's' : ''} have pending dues — {formatINR(totalPending)} outstanding
            </p>
            <ArrowRight size={15} className="shrink-0 opacity-60" />
          </NavLink>
        )}
        {fdMaturingSoon.length > 0 && (
          <NavLink to="/finance"
            className="flex items-center gap-3 px-4 py-3 rounded-[12px] border transition-colors"
            style={{ background: 'var(--warn-bg)', borderColor: 'var(--warn-bd)', color: 'var(--warn)' }}>
            <TrendingUp size={17} className="shrink-0" />
            <p className="flex-1 text-[13px] font-semibold">
              {fdMaturingSoon.length} FD{fdMaturingSoon.length > 1 ? 's' : ''} maturing in the next 30 days
            </p>
            <ArrowRight size={15} className="shrink-0 opacity-60" />
          </NavLink>
        )}
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {[
          {
            icon: <IndianRupee size={18} />, tone: 'bad',
            label: `Dues pending (${fyLabel})`,
            value: formatINR(totalPending),
            sub: `${duesCounts.Due} Due · ${duesCounts.Partial} Partial · ${duesCounts.Clear} Clear`,
          },
          {
            icon: <TrendingUp size={18} />, tone: 'brand',
            label: 'Fixed Deposits',
            value: formatINR(fdTotal),
            sub: deposits.length === 0
              ? 'No active FDs'
              : `${deposits.length} active${nextFD ? ` · next ${new Date(nextFD.maturity_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}` : ''}`,
          },
          {
            icon: <Receipt size={18} />, tone: 'neutral',
            label: "This month's expenses",
            value: formatINR(thisMonthExpenses),
          },
          {
            icon: <GitMerge size={18} />, tone: unreconciledCount > 0 ? 'warn' : 'neutral',
            label: 'Unreconciled expenses',
            value: String(unreconciledCount),
          },
        ].map(({ icon, tone, label, value, sub }) => (
          <div key={label} className="surface !p-4 sm:!p-5 flex flex-col gap-3">
            <div
              className="w-9 h-9 rounded-[10px] flex items-center justify-center"
              style={{
                background: tone === 'brand' ? 'var(--brand-50)'
                  : tone === 'bad'    ? 'var(--bad-bg)'
                  : tone === 'warn'   ? 'var(--warn-bg)'
                  : 'var(--ink-100)',
                color: tone === 'brand' ? 'var(--brand-600)'
                  : tone === 'bad'   ? 'var(--bad)'
                  : tone === 'warn'  ? 'var(--warn)'
                  : 'var(--ink-500)',
              }}
            >
              {icon}
            </div>
            <div>
              <p className="text-[12.5px] font-medium leading-tight" style={{ color: 'var(--ink-500)' }}>{label}</p>
              <p className="text-[26px] font-bold leading-tight mt-1 tnum">{value}</p>
              {sub && <p className="text-[11.5px] mt-1" style={{ color: 'var(--ink-400)' }}>{sub}</p>}
            </div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Bar chart — 2 cols */}
        <div className="surface !p-5 lg:col-span-2">
          <p className="text-[13.5px] font-semibold mb-4" style={{ color: 'var(--ink-700)' }}>
            Monthly collection & expenses (last 12 months)
          </p>
          {chartData.length === 0 ? (
            <div className="flex items-center justify-center h-[220px]" style={{ color: 'var(--ink-400)' }}>
              <p className="text-[13px]">No data yet</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--ink-400)' }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: 'var(--ink-400)' }} tickLine={false} axisLine={false} width={52} />
                <Tooltip
                  formatter={(v: number, name: string) => [formatINR(v), name]}
                  contentStyle={{ borderRadius: 10, border: '1px solid var(--ink-200)', fontSize: 12 }}
                />
                <Bar dataKey="Maintenance" fill="var(--maint)"   radius={[3, 3, 0, 0]} maxBarSize={20} />
                <Bar dataKey="Corpus"      fill="var(--corpus)"  radius={[3, 3, 0, 0]} maxBarSize={20} />
                <Bar dataKey="Expenses"    fill="var(--expense)" radius={[3, 3, 0, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          )}
          {chartData.length > 0 && (
            <div className="flex gap-4 mt-3 justify-center">
              {[
                { label: 'Maintenance', color: 'var(--maint)' },
                { label: 'Corpus',      color: 'var(--corpus)' },
                { label: 'Expenses',    color: 'var(--expense)' },
              ].map(({ label, color }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-[11.5px]" style={{ color: 'var(--ink-500)' }}>{label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Aging receivables — top flats with dues */}
        <div className="surface !p-0 overflow-hidden">
          <div className="px-5 py-3 border-b hairline flex items-center justify-between">
            <p className="text-[13.5px] font-semibold" style={{ color: 'var(--ink-700)' }}>Top outstanding</p>
            <NavLink to="/dues" className="text-[12px] font-medium flex items-center gap-1" style={{ color: 'var(--brand-600)' }}>
              View all <ArrowRight size={12} />
            </NavLink>
          </div>
          {overdueFlats.length === 0 ? (
            <div className="px-5 py-8 text-center text-[13px]" style={{ color: 'var(--ink-400)' }}>All flats are clear</div>
          ) : (
            <div className="divide-rows">
              {overdueFlats.slice(0, 8).map((d: any) => (
                <NavLink key={d.flat_code} to="/dues"
                  className="px-4 py-2.5 grid grid-cols-[1fr_auto] gap-3 items-center hover:bg-[var(--ink-50)] transition-colors">
                  <div>
                    <p className="text-[13px] font-semibold" style={{ color: 'var(--ink-800)' }}>{d.flat_code}</p>
                    <p className="text-[11px]" style={{ color: 'var(--ink-400)' }}>Block {d.block}</p>
                  </div>
                  <p className="text-[13px] font-semibold tnum" style={{ color: 'var(--bad)' }}>{formatINR(d.total_outstanding)}</p>
                </NavLink>
              ))}
              {overdueFlats.length > 8 && (
                <NavLink to="/dues" className="block px-4 py-2.5 text-center text-[12px] font-medium" style={{ color: 'var(--brand-600)' }}>
                  +{overdueFlats.length - 8} more flats — view all
                </NavLink>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Corpus progress */}
      {corpusPlans.length > 0 && (
        <div className="surface !p-5">
          <p className="text-[13.5px] font-semibold mb-4" style={{ color: 'var(--ink-700)' }}>Corpus plans</p>
          <div className="flex flex-col gap-3">
            {corpusPlans.map(p => {
              const pct = p.target > 0 ? Math.round(p.collected * 100 / p.target) : 0
              return (
                <div key={p.name}>
                  <div className="flex justify-between text-[13px] mb-1.5">
                    <span className="font-medium" style={{ color: 'var(--ink-700)' }}>{p.name}</span>
                    <span className="text-[11.5px]" style={{ color: 'var(--ink-500)' }}>
                      {formatINR(p.collected)} / {formatINR(p.target)} · {pct}%
                    </span>
                  </div>
                  <div className="ds-track">
                    <div className="ds-track-fill" style={{ width: `${Math.min(pct, 100)}%`, background: 'var(--corpus)' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Quick links */}
      <div className="surface !p-0 overflow-hidden">
        <div className="px-5 py-3 border-b hairline">
          <p className="text-[13px] font-semibold" style={{ color: 'var(--ink-700)' }}>Quick links</p>
        </div>
        <div className="divide-rows">
          {[
            { to: '/transactions', icon: TrendingUp,  label: 'Upload bank statement',     sub: 'Import new CSV/PSV file' },
            { to: '/dues',         icon: IndianRupee, label: `Dues tracker (${fyLabel})`, sub: 'View outstanding maintenance' },
            { to: '/corpus',       icon: Building2,   label: 'Corpus fund',               sub: 'Collection & expenditure' },
            { to: '/expenses',     icon: Receipt,     label: 'Add / reconcile expenses',  sub: 'Day book & bank reconciliation' },
            { to: '/flats',        icon: Users,       label: 'Flats & residents',         sub: 'Owners, UPI IDs, history' },
          ].map(({ to, icon: Icon, label, sub }) => (
            <NavLink
              key={to}
              to={to}
              className="flex items-center gap-3.5 px-5 py-3.5 hover:bg-[var(--ink-50)] transition-colors group"
            >
              <div
                className="w-8 h-8 rounded-[9px] flex items-center justify-center shrink-0"
                style={{ background: 'var(--ink-100)', color: 'var(--ink-500)' }}
              >
                <Icon size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-medium" style={{ color: 'var(--ink-700)' }}>{label}</p>
                <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--ink-400)' }}>{sub}</p>
              </div>
              <ArrowRight size={15} style={{ color: 'var(--ink-300)' }} className="shrink-0" />
            </NavLink>
          ))}
        </div>
      </div>
    </div>
  )
}
