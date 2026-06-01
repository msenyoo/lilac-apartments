import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { NavLink } from 'react-router-dom'
import { supabase, MonthlySummary } from '@/lib/supabase'
import { formatINR } from '@/lib/tagger'
import { TrendingUp, Users, AlertCircle, Building, ArrowRight } from 'lucide-react'

const FISCAL_MONTHS = [
  'Apr-26','May-26','Jun-26','Jul-26','Aug-26','Sep-26',
  'Oct-26','Nov-26','Dec-26','Jan-27','Feb-27','Mar-27',
  'Apr-25','May-25','Jun-25','Jul-25','Aug-25','Sep-25',
  'Oct-25','Nov-25','Dec-25','Jan-26','Feb-26','Mar-26',
]

export default function DashboardPage() {
  const [month, setMonth] = useState('May-26')

  const { data: settings } = useQuery({
    queryKey: ['app-settings'],
    queryFn: async () => {
      const { data } = await supabase.from('app_settings').select('*')
      return Object.fromEntries((data ?? []).map(s => [s.key, s.value]))
    },
  })

  const { data: summary, isLoading } = useQuery({
    queryKey: ['monthly-summary', month],
    queryFn: async () => {
      const { data } = await supabase.from('v_monthly_summary').select('*').eq('fiscal_label', month).single()
      return data as MonthlySummary | null
    },
  })

  const { data: reviewCount } = useQuery({
    queryKey: ['review-count'],
    queryFn: async () => {
      const { count } = await supabase.from('v_review_queue').select('*', { count: 'exact', head: true })
      return count ?? 0
    },
  })

  const { data: totalDues } = useQuery({
    queryKey: ['total-dues'],
    queryFn: async () => {
      const { data } = await supabase.from('v_dues_tracker').select('pending')
      return (data ?? []).reduce((s, r) => s + Math.max(0, r.pending ?? 0), 0)
    },
  })

  const currentFY = settings?.current_fiscal_year ?? '2026'
  const fyLabel = `FY ${currentFY}-${String(parseInt(currentFY) + 1).slice(-2)}`

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold">Dashboard</h2>
          <p className="text-sm text-slate-500">{fyLabel} · Lilac Apartments</p>
        </div>
        <select
          value={month}
          onChange={e => setMonth(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white font-medium"
        >
          {FISCAL_MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {/* Alert: review queue */}
      {reviewCount != null && reviewCount > 0 && (
        <NavLink to="/transactions?tab=review"
          className="flex items-center gap-3 p-4 rounded-xl bg-orange-50 border border-orange-200 hover:bg-orange-100 transition-colors">
          <AlertCircle size={20} className="text-orange-600 shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-orange-800 text-sm">
              {reviewCount} transaction{reviewCount > 1 ? 's' : ''} need tagging
            </p>
            <p className="text-xs text-orange-600 mt-0.5">Auto-tagging couldn't identify these payments</p>
          </div>
          <ArrowRight size={16} className="text-orange-400 shrink-0" />
        </NavLink>
      )}

      {/* Stats grid — 2 col on mobile, 4 col on desktop */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="card h-28 animate-pulse bg-slate-100" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={<TrendingUp size={20} className="text-green-600" />}
            label="Maintenance collected"
            value={formatINR(summary?.maintenance_collected ?? 0)}
            sub={`${summary?.flats_paid ?? 0} of 44 flats`}
            bg="bg-green-50"
          />
          <StatCard
            icon={<Building size={20} className="text-purple-600" />}
            label="Corpus collected"
            value={formatINR(summary?.corpus_collected ?? 0)}
            bg="bg-purple-50"
          />
          <StatCard
            icon={<TrendingUp size={20} className="text-red-500" />}
            label="Total expenses"
            value={formatINR(summary?.total_expenses ?? 0)}
            sub={`Salary ${formatINR(summary?.salary ?? 0)}`}
            bg="bg-red-50"
          />
          <StatCard
            icon={<Users size={20} className="text-amber-600" />}
            label={`Total dues (${fyLabel})`}
            value={formatINR(totalDues ?? 0)}
            bg="bg-amber-50"
          />
        </div>
      )}

      {/* Bottom section: 2 col on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-sm">Expense breakdown — {month}</h3>
          </div>
          <ExpenseBreakdown month={month} />
        </div>

        <div className="card">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-sm">Quick links</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {[
              { to: '/transactions', label: 'Upload bank statement',  sub: 'Import new PSV file' },
              { to: '/dues',         label: `Dues tracker (${fyLabel})`, sub: 'View outstanding maintenance' },
              { to: '/corpus',       label: 'Corpus fund',            sub: 'Collection & expenditure' },
              { to: '/reports',      label: 'Monthly report',         sub: 'Share with residents' },
              { to: '/flats',        label: 'Flats & Residents',      sub: 'Manage owners & UPI IDs' },
            ].map(({ to, label, sub }) => (
              <NavLink key={to} to={to}
                className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors group">
                <div>
                  <p className="text-sm font-medium text-slate-700 group-hover:text-brand-700">{label}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
                </div>
                <ArrowRight size={15} className="text-slate-300 group-hover:text-brand-600" />
              </NavLink>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, sub, bg }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; bg: string
}) {
  return (
    <div className={`card p-4 lg:p-5 ${bg}`}>
      <div className="flex items-center gap-2 mb-2 lg:mb-3">{icon}<span className="text-xs text-slate-500 leading-tight">{label}</span></div>
      <p className="font-bold text-lg lg:text-xl text-slate-800 leading-tight">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  )
}

function ExpenseBreakdown({ month }: { month: string }) {
  const { data } = useQuery({
    queryKey: ['expenses', month],
    queryFn: async () => {
      const { data } = await supabase.from('v_expenses').select('*').eq('fiscal_label', month).order('total_amount', { ascending: false })
      return data ?? []
    },
  })

  if (!data?.length) return <p className="px-5 py-8 text-sm text-slate-400 text-center">No expenses recorded</p>

  return (
    <div className="divide-y divide-slate-100">
      {data.map(e => (
        <div key={e.category} className="flex justify-between items-center px-5 py-3">
          <span className="text-sm text-slate-600">{e.category}</span>
          <span className="font-semibold text-sm text-slate-800">{formatINR(e.total_amount)}</span>
        </div>
      ))}
    </div>
  )
}
