import { useQuery } from '@tanstack/react-query'
import { NavLink } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import {
  TrendingUp, AlertCircle, ArrowRight, IndianRupee,
  Building, Receipt, GitMerge, Users,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatINR } from '@/lib/tagger'

const VIOLET  = '#7c3aed'
const AMBER   = '#d97706'
const EMERALD = '#10b981'
const ROSE    = '#f43f5e'

export default function DashboardPage() {
  // ── Queries ──────────────────────────────────────────────────

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
      const { count } = await supabase.from('v_review_queue').select('*', { count: 'exact', head: true })
      return count ?? 0
    },
    refetchInterval: 30_000,
  })

  // Dues tracker — pending total + status counts
  const { data: duesData = [] } = useQuery({
    queryKey: ['dues-all'],
    queryFn: async () => {
      const { data } = await supabase.from('v_dues_tracker').select('pending,status')
      return data ?? []
    },
  })

  // Corpus — all active plans collected vs target
  const { data: corpusData = [] } = useQuery({
    queryKey: ['corpus-kpi'],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_corpus_tracker')
        .select('plan_id,plan_name,effective_target,collected')
      return data ?? []
    },
  })

  // Monthly collection (last 12 fiscal months for bar chart)
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

  // Unreconciled expenses count
  const { data: unreconciledCount = 0 } = useQuery({
    queryKey: ['unreconciled-count'],
    queryFn: async () => {
      const { count } = await supabase
        .from('expenses')
        .select('*', { count: 'exact', head: true })
        .neq('payment_mode', 'Cash')
        .is('transaction_id', null)
      return count ?? 0
    },
    refetchInterval: 60_000,
  })

  // This month's expenses
  const { data: thisMonthExpenses = 0 } = useQuery({
    queryKey: ['this-month-expenses'],
    queryFn: async () => {
      const now = new Date()
      const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
      const { data } = await supabase
        .from('expenses')
        .select('amount')
        .gte('expense_date', from)
      return (data ?? []).reduce((s: number, e: any) => s + e.amount, 0)
    },
  })

  // ── Derived values ────────────────────────────────────────────

  const currentFY  = settings?.current_fiscal_year ?? String(new Date().getFullYear())
  const fyLabel    = `FY ${currentFY}-${String(parseInt(currentFY) + 1).slice(-2)}`

  const totalPending   = duesData.reduce((s: number, d: any) => s + Math.max(0, d.pending ?? 0), 0)
  const duesCounts     = {
    Due:     duesData.filter((d: any) => d.status === 'Due').length,
    Partial: duesData.filter((d: any) => d.status === 'Partial').length,
    Clear:   duesData.filter((d: any) => d.status === 'Clear').length,
  }
  const overdueFlatCount = duesCounts.Due + duesCounts.Partial

  // Corpus pool: sum across unique plans of (collected - anything spent, but we track as available = target - collected balance)
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
  const corpusPoolAvailable = corpusPlans.reduce((s, p) => s + Math.max(0, p.collected), 0)

  // Bar chart: last 12 months
  const chartData = (monthlyData as any[]).slice(-12).map((m: any) => ({
    month:       m.fiscal_label,
    Maintenance: m.maintenance_collected,
    Corpus:      m.corpus_collected,
    Expenses:    m.total_expenses,
  }))

  // Dues pie
  const pieData = [
    { name: 'Clear',   value: duesCounts.Clear,   color: EMERALD },
    { name: 'Partial', value: duesCounts.Partial, color: AMBER   },
    { name: 'Due',     value: duesCounts.Due,     color: ROSE    },
  ].filter(d => d.value > 0)

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div>
        <h2 className="text-xl font-semibold">Dashboard</h2>
        <p className="text-sm text-slate-500">{fyLabel} · Lilac Apartments</p>
      </div>

      {/* ── Alert strip ────────────────────────────────────── */}
      <div className="space-y-2">
        {reviewCount > 0 && (
          <NavLink to="/transactions?tab=review"
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-orange-50 border border-orange-200 hover:bg-orange-100 transition-colors">
            <AlertCircle size={18} className="text-orange-500 shrink-0" />
            <p className="flex-1 text-sm font-medium text-orange-800">
              {reviewCount} transaction{reviewCount > 1 ? 's' : ''} need tagging
            </p>
            <ArrowRight size={15} className="text-orange-400 shrink-0" />
          </NavLink>
        )}
        {unreconciledCount > 0 && (
          <NavLink to="/expenses"
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors">
            <GitMerge size={18} className="text-amber-500 shrink-0" />
            <p className="flex-1 text-sm font-medium text-amber-800">
              {unreconciledCount} unreconciled expense{unreconciledCount > 1 ? 's' : ''} — bank DRs not yet matched
            </p>
            <ArrowRight size={15} className="text-amber-400 shrink-0" />
          </NavLink>
        )}
        {overdueFlatCount > 0 && (
          <NavLink to="/dues"
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200 hover:bg-red-100 transition-colors">
            <IndianRupee size={18} className="text-red-500 shrink-0" />
            <p className="flex-1 text-sm font-medium text-red-800">
              {overdueFlatCount} flat{overdueFlatCount > 1 ? 's' : ''} have pending dues — {formatINR(totalPending)} outstanding
            </p>
            <ArrowRight size={15} className="text-red-400 shrink-0" />
          </NavLink>
        )}
      </div>

      {/* ── KPI strip ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={<IndianRupee size={18} className="text-red-500" />}
          label={`Dues pending (${fyLabel})`}
          value={formatINR(totalPending)}
          sub={`${duesCounts.Due} Due · ${duesCounts.Partial} Partial · ${duesCounts.Clear} Clear`}
          bg="bg-red-50"
        />
        <KpiCard
          icon={<Building size={18} className="text-violet-600" />}
          label="Corpus pool collected"
          value={formatINR(corpusPoolAvailable)}
          sub={`${corpusPlans.length} active plan${corpusPlans.length !== 1 ? 's' : ''}`}
          bg="bg-violet-50"
        />
        <KpiCard
          icon={<Receipt size={18} className="text-slate-600" />}
          label="This month's expenses"
          value={formatINR(thisMonthExpenses)}
          bg="bg-white"
        />
        <KpiCard
          icon={<GitMerge size={18} className={unreconciledCount > 0 ? 'text-amber-500' : 'text-slate-400'} />}
          label="Unreconciled expenses"
          value={String(unreconciledCount)}
          bg={unreconciledCount > 0 ? 'bg-amber-50' : 'bg-white'}
        />
      </div>

      {/* ── Charts row ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Monthly collection bar — spans 2 cols */}
        <div className="card p-4 lg:col-span-2">
          <p className="text-sm font-semibold text-slate-700 mb-4">Monthly collection & expenses (last 12 months)</p>
          {chartData.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">No data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={52} />
                <Tooltip
                  formatter={(v: number, name: string) => [formatINR(v), name]}
                  contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
                />
                <Bar dataKey="Maintenance" fill={EMERALD} radius={[3, 3, 0, 0]} maxBarSize={20} />
                <Bar dataKey="Corpus"      fill={VIOLET}  radius={[3, 3, 0, 0]} maxBarSize={20} />
                <Bar dataKey="Expenses"    fill={ROSE}    radius={[3, 3, 0, 0]} maxBarSize={20} />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Dues status pie */}
        <div className="card p-4">
          <p className="text-sm font-semibold text-slate-700 mb-2">Dues status ({fyLabel})</p>
          {pieData.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">No data</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={70}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => [`${v} flats`, '']} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-1">
                {[
                  { label: 'Clear',   count: duesCounts.Clear,   color: EMERALD },
                  { label: 'Partial', count: duesCounts.Partial, color: AMBER   },
                  { label: 'Due',     count: duesCounts.Due,     color: ROSE    },
                ].map(({ label, count, color }) => (
                  <div key={label} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                      <span className="text-slate-600">{label}</span>
                    </div>
                    <span className="font-semibold text-slate-700">{count} flats</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Corpus per-plan progress ────────────────────────── */}
      {corpusPlans.length > 0 && (
        <div className="card p-4">
          <p className="text-sm font-semibold text-slate-700 mb-4">Corpus plans</p>
          <div className="space-y-3">
            {corpusPlans.map(p => {
              const pct = p.target > 0 ? Math.round(p.collected * 100 / p.target) : 0
              return (
                <div key={p.name}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-slate-700">{p.name}</span>
                    <span className="text-slate-500 text-xs">
                      {formatINR(p.collected)} / {formatINR(p.target)} · {pct}%
                    </span>
                  </div>
                  <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-2.5 rounded-full transition-all"
                      style={{ width: `${Math.min(pct, 100)}%`, background: VIOLET }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Quick actions ───────────────────────────────────── */}
      <div className="card">
        <div className="px-5 py-3 border-b border-slate-100">
          <h3 className="font-semibold text-sm">Quick links</h3>
        </div>
        <div className="divide-y divide-slate-100">
          {[
            { to: '/transactions', icon: TrendingUp,  label: 'Upload bank statement',       sub: 'Import new PSV file' },
            { to: '/dues',         icon: IndianRupee, label: `Dues tracker (${fyLabel})`,   sub: 'View outstanding maintenance' },
            { to: '/corpus',       icon: Building,    label: 'Corpus fund',                 sub: 'Collection & expenditure' },
            { to: '/expenses',     icon: Receipt,     label: 'Add / reconcile expenses',    sub: 'Day book & bank reconciliation' },
            { to: '/flats',        icon: Users,       label: 'Flats & residents',           sub: 'Owners, UPI IDs, history' },
          ].map(({ to, icon: Icon, label, sub }) => (
            <NavLink key={to} to={to}
              className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors group">
              <Icon size={16} className="text-slate-400 group-hover:text-brand-600 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-700 group-hover:text-brand-700">{label}</p>
                <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
              </div>
              <ArrowRight size={15} className="text-slate-300 group-hover:text-brand-600 shrink-0" />
            </NavLink>
          ))}
        </div>
      </div>
    </div>
  )
}

function KpiCard({ icon, label, value, sub, bg }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; bg: string
}) {
  return (
    <div className={`card p-4 ${bg}`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-slate-500 leading-tight">{label}</span>
      </div>
      <p className="font-bold text-xl text-slate-800 leading-tight">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  )
}
