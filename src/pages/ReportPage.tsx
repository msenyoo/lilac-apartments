import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatINR } from '@/lib/tagger'
import { Share2, CheckCircle, AlertTriangle } from 'lucide-react'

const FISCAL_MONTHS = [
  'May-26','Apr-26','Mar-26','Feb-26','Jan-26','Dec-25',
  'Nov-25','Oct-25','Sep-25','Aug-25','Jul-25','Jun-25','May-25','Apr-25',
]

export default function ReportPage() {
  const [month, setMonth] = useState('May-26')
  const [shared, setShared] = useState(false)

  const { data: summary } = useQuery({
    queryKey: ['monthly-summary', month],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_monthly_summary').select('*').eq('fiscal_label', month).single()
      return data
    },
  })

  const { data: flatsData } = useQuery({
    queryKey: ['report-flats', month],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_monthly_collection')
        .select('*')
        .eq('fiscal_label', month)
        .order('flat_code')
      return data ?? []
    },
  })

  const { data: expenses } = useQuery({
    queryKey: ['expenses', month],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_expenses').select('*').eq('fiscal_label', month).order('total_amount', { ascending: false })
      return data ?? []
    },
  })

  const { data: corpus } = useQuery({
    queryKey: ['corpus'],
    queryFn: async () => {
      const { data } = await supabase.from('v_corpus_tracker').select('*')
      return data ?? []
    },
  })

  const totalCorpusCollected = corpus?.reduce((s, c) => s + (c.collected ?? 0), 0) ?? 0
  const totalCorpusTarget    = corpus?.reduce((s, c) => s + (c.corpus_target ?? 0), 0) ?? 0

  async function handleShare() {
    const text = generateShareText(month, summary, flatsData ?? [], expenses ?? [], totalCorpusCollected, totalCorpusTarget)
    if (navigator.share) {
      await navigator.share({ title: `Lilac Apartments — ${month}`, text })
    } else {
      await navigator.clipboard.writeText(text)
      setShared(true)
      setTimeout(() => setShared(false), 2000)
    }
  }

  const unpaidFlats = (flatsData ?? []).filter(f => f.collected < f.maintenance_amt)

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Monthly report</h2>
          <p className="text-sm text-slate-500">Summary for residents</p>
        </div>
        <select
          value={month}
          onChange={e => setMonth(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white"
        >
          {FISCAL_MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {/* Summary section */}
      <div className="card divide-y divide-slate-100">
        <div className="px-4 py-3 bg-brand-700 text-white rounded-t-xl">
          <p className="text-xs opacity-75">THE LILAC APARTMENT ASSOCIATION</p>
          <p className="font-semibold">Monthly Statement — {month}</p>
        </div>
        {[
          { label: 'Maintenance collected', value: formatINR(summary?.maintenance_collected ?? 0) },
          { label: 'Flats paid', value: `${summary?.flats_paid ?? 0} of 44` },
          { label: 'Total expenses', value: formatINR(summary?.total_expenses ?? 0) },
          { label: 'Corpus collected (total)', value: formatINR(totalCorpusCollected) },
          { label: 'Corpus target (total)', value: formatINR(totalCorpusTarget) },
        ].map(({ label, value }) => (
          <div key={label} className="flex justify-between px-4 py-3">
            <span className="text-sm text-slate-500">{label}</span>
            <span className="text-sm font-semibold">{value}</span>
          </div>
        ))}
      </div>

      {/* Expenses */}
      {expenses && expenses.length > 0 && (
        <div className="card">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="font-medium text-sm">Expenses — {month}</h3>
          </div>
          {expenses.map(e => (
            <div key={e.category} className="flex justify-between px-4 py-2.5 border-b border-slate-50">
              <span className="text-sm text-slate-600">{e.category}</span>
              <span className="text-sm font-medium">{formatINR(e.total_amount)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Pending dues */}
      {unpaidFlats.length > 0 && (
        <div className="card">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-500" />
            <h3 className="font-medium text-sm">Pending maintenance — {month}</h3>
          </div>
          {unpaidFlats.map(f => (
            <div key={f.flat_code} className="flex justify-between px-4 py-2.5 border-b border-slate-50">
              <span className="text-sm font-medium">{f.flat_code}</span>
              <span className="text-sm text-red-600 font-medium">
                {formatINR(f.maintenance_amt - f.collected)} due
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Share button */}
      <button
        onClick={handleShare}
        className="btn-primary w-full flex items-center justify-center gap-2"
      >
        {shared ? (
          <><CheckCircle size={16} /> Copied to clipboard!</>
        ) : (
          <><Share2 size={16} /> Share with residents</>
        )}
      </button>
    </div>
  )
}

function generateShareText(
  month: string,
  summary: any,
  flats: any[],
  expenses: any[],
  corpusCollected: number,
  corpusTarget: number
): string {
  const lines = [
    `🏢 THE LILAC APARTMENT ASSOCIATION`,
    `📅 Monthly Statement — ${month}`,
    ``,
    `💰 MAINTENANCE`,
    `  Collected: ${formatINR(summary?.maintenance_collected ?? 0)}`,
    `  Flats paid: ${summary?.flats_paid ?? 0} of 44`,
    ``,
    `💸 EXPENSES`,
    ...expenses.map(e => `  ${e.category}: ${formatINR(e.total_amount)}`),
    ``,
    `🏗️ CORPUS FUND`,
    `  Collected: ${formatINR(corpusCollected)} of ${formatINR(corpusTarget)}`,
    ``,
  ]

  const unpaid = flats.filter(f => f.collected < f.maintenance_amt)
  if (unpaid.length > 0) {
    lines.push(`⚠️ PENDING MAINTENANCE`)
    unpaid.forEach(f => lines.push(`  ${f.flat_code}: ${formatINR(f.maintenance_amt - f.collected)}`))
    lines.push(``)
  }

  lines.push(`Generated by Lilac Apartments App`)
  return lines.join('\n')
}
