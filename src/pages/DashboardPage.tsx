import { useQuery } from '@tanstack/react-query'
import { supabase, MonthlySummary } from '@/lib/supabase'
import { formatINR } from '@/lib/tagger'
import { TrendingUp, Users, AlertCircle, Building } from 'lucide-react'
import { useState } from 'react'

const FISCAL_MONTHS = [
  'Apr-26','May-26','Jun-26','Jul-26','Aug-26','Sep-26',
  'Oct-26','Nov-26','Dec-26','Jan-27','Feb-27','Mar-27',
  'Apr-25','May-25','Jun-25','Jul-25','Aug-25','Sep-25',
  'Oct-25','Nov-25','Dec-25','Jan-26','Feb-26','Mar-26',
]

export default function DashboardPage() {
  const [month, setMonth] = useState('May-26')

  const { data: summary, isLoading } = useQuery({
    queryKey: ['monthly-summary', month],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_monthly_summary')
        .select('*')
        .eq('fiscal_label', month)
        .single()
      return data as MonthlySummary | null
    },
  })

  const { data: reviewCount } = useQuery({
    queryKey: ['review-count'],
    queryFn: async () => {
      const { count } = await supabase
        .from('v_review_queue')
        .select('*', { count: 'exact', head: true })
      return count ?? 0
    },
  })

  const { data: totalDues } = useQuery({
    queryKey: ['total-dues'],
    queryFn: async () => {
      const { data } = await supabase.from('v_dues_tracker').select('pending')
      return (data ?? []).reduce((s, r) => s + (r.pending ?? 0), 0)
    },
  })

  return (
    <div className="p-4 space-y-4">
      {/* Month selector */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Dashboard</h2>
        <select
          value={month}
          onChange={e => setMonth(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white"
        >
          {FISCAL_MONTHS.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card p-4 h-24 animate-pulse bg-slate-100" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              icon={<TrendingUp size={18} className="text-green-600" />}
              label="Maintenance collected"
              value={formatINR(summary?.maintenance_collected ?? 0)}
              sub={`${summary?.flats_paid ?? 0} of 44 flats`}
              bg="bg-green-50"
            />
            <StatCard
              icon={<Building size={18} className="text-purple-600" />}
              label="Corpus collected"
              value={formatINR(summary?.corpus_collected ?? 0)}
              bg="bg-purple-50"
            />
            <StatCard
              icon={<TrendingUp size={18} className="text-red-600" />}
              label="Total expenses"
              value={formatINR(summary?.total_expenses ?? 0)}
              sub={`Salary ${formatINR(summary?.salary ?? 0)} · EB ${formatINR(summary?.eb ?? 0)}`}
              bg="bg-red-50"
            />
            <StatCard
              icon={<Users size={18} className="text-amber-600" />}
              label="Total dues (FY)"
              value={formatINR(totalDues ?? 0)}
              bg="bg-amber-50"
            />
          </div>

          {reviewCount != null && reviewCount > 0 && (
            <div className="card p-4 bg-orange-50 border border-orange-200 flex gap-3 items-start">
              <AlertCircle size={18} className="text-orange-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-orange-800 text-sm">
                  {reviewCount} transaction{reviewCount > 1 ? 's' : ''} need tagging
                </p>
                <p className="text-xs text-orange-600 mt-0.5">
                  Go to Review tab to fix unrecognised payments
                </p>
              </div>
            </div>
          )}

          {/* Expense breakdown */}
          {summary && (
            <div className="card">
              <div className="px-4 py-3 border-b border-slate-100">
                <h3 className="font-medium text-sm">Expense breakdown — {month}</h3>
              </div>
              <ExpenseBreakdown month={month} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function StatCard({ icon, label, value, sub, bg }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; bg: string
}) {
  return (
    <div className={`card p-4 ${bg}`}>
      <div className="flex items-center gap-2 mb-2">{icon}<span className="text-xs text-slate-500">{label}</span></div>
      <p className="font-bold text-base text-slate-800 leading-tight">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  )
}

function ExpenseBreakdown({ month }: { month: string }) {
  const { data } = useQuery({
    queryKey: ['expenses', month],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_expenses')
        .select('*')
        .eq('fiscal_label', month)
        .order('total_amount', { ascending: false })
      return data ?? []
    },
  })

  if (!data?.length) return (
    <p className="px-4 py-6 text-sm text-slate-400 text-center">No expenses recorded</p>
  )

  return (
    <div className="divide-y divide-slate-100">
      {data.map(e => (
        <div key={e.category} className="flex justify-between items-center px-4 py-3">
          <span className="text-sm text-slate-600">{e.category}</span>
          <span className="font-medium text-sm">{formatINR(e.total_amount)}</span>
        </div>
      ))}
    </div>
  )
}
