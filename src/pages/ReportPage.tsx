import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatINR, FLAT_CODES } from '@/lib/tagger'
import { Share2, CheckCircle, AlertTriangle, Download } from 'lucide-react'
import * as XLSX from 'xlsx'

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function currentFiscalLabel() {
  const now = new Date()
  return `${MONTHS_SHORT[now.getMonth()]}-${String(now.getFullYear()).slice(-2)}`
}

function buildFiscalMonths() {
  const now = new Date()
  const result: string[] = []
  let y = 2022, m = 3 // Apr-22 = earliest archived data
  while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth())) {
    result.push(`${MONTHS_SHORT[m]}-${String(y).slice(-2)}`)
    if (++m > 11) { m = 0; y++ }
  }
  return result.reverse()
}

const FISCAL_MONTHS = buildFiscalMonths()

function getCurrentFy() {
  const now = new Date()
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return {
    start: `${year}-04-01`,
    end:   `${year + 1}-03-31`,
    label: `FY ${year}-${String(year + 1).slice(-2)}`,
  }
}

type ReportTab = 'monthly' | 'flat'

export default function ReportPage() {
  const [tab, setTab] = useState<ReportTab>('monthly')
  const [month, setMonth] = useState(currentFiscalLabel)
  const [shared, setShared] = useState(false)

  const { data: summary } = useQuery({
    queryKey: ['monthly-summary', month],
    queryFn: async () => {
      const { data } = await supabase.from('v_monthly_summary').select('*').eq('fiscal_label', month).single()
      return data
    },
  })

  const { data: flatsData } = useQuery({
    queryKey: ['report-flats', month],
    queryFn: async () => {
      const { data } = await supabase.from('v_monthly_collection').select('*').eq('fiscal_label', month).order('flat_code')
      return data ?? []
    },
  })

  const { data: expenses } = useQuery({
    queryKey: ['expenses', month],
    queryFn: async () => {
      const { data } = await supabase.from('v_expenses').select('*').eq('fiscal_label', month).order('total_amount', { ascending: false })
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
  const unpaidFlats = (flatsData ?? []).filter(f => f.collected < f.maintenance_amt)

  async function handleShare() {
    const text = buildShareText(month, summary, flatsData ?? [], expenses ?? [], totalCorpusCollected, totalCorpusTarget)
    if (navigator.share) {
      await navigator.share({ title: `Lilac Apartments — ${month}`, text })
    } else {
      await navigator.clipboard.writeText(text)
      setShared(true)
      setTimeout(() => setShared(false), 2500)
    }
  }

  function handleExcelExport() {
    const wb = XLSX.utils.book_new()

    // Sheet 1: Summary
    const summaryRows = [
      ['Lilac Apartment Association — Monthly Report', month],
      [],
      ['Metric', 'Value'],
      ['Maintenance collected', summary?.maintenance_collected ?? 0],
      ['Flats paid', `${summary?.flats_paid ?? 0} of 44`],
      ['Total expenses', summary?.total_expenses ?? 0],
      ['Corpus collected (total)', totalCorpusCollected],
      ['Corpus target (total)', totalCorpusTarget],
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'Summary')

    // Sheet 2: Collections by flat
    const collRows = [['Flat', 'Maintenance Rate', 'Collected', 'Status']]
    ;(flatsData ?? []).forEach((f: any) => {
      collRows.push([f.flat_code, f.maintenance_amt, f.collected, f.collected >= f.maintenance_amt ? 'Paid' : f.collected > 0 ? 'Partial' : 'Unpaid'])
    })
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(collRows), 'Collections')

    // Sheet 3: Expenses
    const expRows = [['Category', 'Amount', 'Transactions']]
    ;(expenses ?? []).forEach((e: any) => expRows.push([e.category, e.total_amount, e.txn_count]))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(expRows), 'Expenses')

    XLSX.writeFile(wb, `Lilac_Report_${month}.xlsx`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold">Reports</h2>
          <p className="text-sm text-slate-500 mt-0.5">Monthly summaries &amp; flat statements</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {([
          { key: 'monthly', label: 'Monthly summary' },
          { key: 'flat',    label: 'Flat statement' },
        ] as { key: ReportTab; label: string }[]).map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors
              ${tab === key ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'flat' && <FlatStatementTab />}
      {tab === 'monthly' && <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-sm text-slate-500">Summary for committee &amp; residents</p>
        </div>
        <select value={month} onChange={e => setMonth(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white">
          {FISCAL_MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {/* Summary card */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 text-white" style={{ background: 'linear-gradient(135deg, #1a3c5e, #2e75b6)' }}>
          <p className="text-xs opacity-75 uppercase tracking-wide">The Lilac Apartment Association</p>
          <p className="font-bold text-lg mt-0.5">Monthly Statement — {month}</p>
        </div>
        <div className="divide-y divide-slate-100">
          {[
            { label: 'Maintenance collected', value: formatINR(summary?.maintenance_collected ?? 0) },
            { label: 'Flats paid',            value: `${summary?.flats_paid ?? 0} of 44` },
            { label: 'Total expenses',         value: formatINR(summary?.total_expenses ?? 0) },
            { label: 'Corpus collected (total)', value: formatINR(totalCorpusCollected) },
            { label: 'Corpus target (total)',  value: formatINR(totalCorpusTarget) },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between px-5 py-3 text-sm">
              <span className="text-slate-500">{label}</span>
              <span className="font-semibold text-slate-800">{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Expenses */}
      {expenses && expenses.length > 0 && (
        <div className="card">
          <div className="px-5 py-3 border-b border-slate-100">
            <h3 className="font-semibold text-sm">Expenses — {month}</h3>
          </div>
          {expenses.map((e: any) => (
            <div key={e.category} className="flex justify-between px-5 py-2.5 border-b border-slate-50 text-sm">
              <span className="text-slate-600">{e.category}</span>
              <span className="font-semibold">{formatINR(e.total_amount)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Collections by flat */}
      <div className="card">
        <div className="px-5 py-3 border-b border-slate-100">
          <h3 className="font-semibold text-sm">Collections by flat — {month}</h3>
        </div>
        <div className="divide-y divide-slate-50 max-h-64 overflow-y-auto">
          {(flatsData ?? []).map((f: any) => (
            <div key={f.flat_code} className="flex justify-between items-center px-5 py-2 text-sm">
              <span className="font-medium w-12">{f.flat_code}</span>
              <span className="text-slate-500 flex-1 px-2">{formatINR(f.maintenance_amt)}</span>
              <span className={f.collected > 0 ? 'font-semibold text-green-700' : 'text-slate-300'}>
                {f.collected > 0 ? formatINR(f.collected) : '—'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Pending */}
      {unpaidFlats.length > 0 && (
        <div className="card">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
            <AlertTriangle size={15} className="text-amber-500" />
            <h3 className="font-semibold text-sm">Pending maintenance — {month}</h3>
          </div>
          {unpaidFlats.map((f: any) => (
            <div key={f.flat_code} className="flex justify-between px-5 py-2.5 border-b border-slate-50 text-sm">
              <span className="font-medium">{f.flat_code}</span>
              <span className="text-red-600 font-semibold">{formatINR(f.maintenance_amt - f.collected)} due</span>
            </div>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={handleShare} className="btn-primary flex items-center gap-2 flex-1 justify-center">
          {shared ? <><CheckCircle size={15} /> Copied!</> : <><Share2 size={15} /> Share with residents</>}
        </button>
        <button onClick={handleExcelExport} className="btn-secondary flex items-center gap-2">
          <Download size={15} /> Export Excel
        </button>
      </div>
      </div>}
    </div>
  )
}

// ── FLAT STATEMENT TAB ───────────────────────────────────────
type FlatDateMode = 'fy' | 'custom' | 'all'

function FlatStatementTab() {
  const fy = getCurrentFy()
  const [flatCode, setFlatCode]     = useState(FLAT_CODES[0])
  const [mode, setMode]             = useState<FlatDateMode>('fy')
  const [draftStart, setDraftStart] = useState('')
  const [draftEnd, setDraftEnd]     = useState('')
  const [appliedStart, setApplied]  = useState<string | null>(null)
  const [appliedEnd, setAppliedEnd] = useState<string | null>(null)

  const effectiveStart = mode === 'fy' ? fy.start : mode === 'custom' ? appliedStart : null
  const effectiveEnd   = mode === 'fy' ? fy.end   : mode === 'custom' ? appliedEnd   : null
  const canApply = draftStart && draftEnd && (draftStart !== appliedStart || draftEnd !== appliedEnd)

  const { data: flatInfo } = useQuery({
    queryKey: ['flat-info', flatCode],
    queryFn: async () => {
      const { data } = await supabase.from('flats').select('*').eq('code', flatCode).single()
      return data
    },
    enabled: !!flatCode,
  })

  const { data: txns, isLoading } = useQuery({
    queryKey: ['flat-statement', flatCode, effectiveStart, effectiveEnd],
    queryFn: async () => {
      let q = supabase.from('transactions')
        .select('*')
        .eq('flat_code', flatCode)
        .neq('row_type', 'VOIDED')
        .order('value_date', { ascending: false })
      if (effectiveStart) q = q.gte('value_date', effectiveStart)
      if (effectiveEnd)   q = q.lte('value_date', effectiveEnd)
      const { data } = await q
      return data ?? []
    },
    enabled: !!flatCode,
  })

  const { data: corpusEntry } = useQuery({
    queryKey: ['corpus-entry', flatCode],
    queryFn: async () => {
      const { data } = await supabase.from('v_corpus_tracker').select('*').eq('flat_code', flatCode).single()
      return data
    },
    enabled: !!flatCode,
  })

  const summary = useMemo(() => {
    const maintenance = (txns ?? []).filter(t => t.cr_dr === 'CR' && t.category === 'Maintenance')
    const corpus      = (txns ?? []).filter(t => t.cr_dr === 'CR' && t.category === 'Corpus')
    const expenses    = (txns ?? []).filter(t => t.cr_dr === 'DR')
    const maintenanceCollected = maintenance.reduce((s, t) => s + t.amount, 0)
    const corpusCollected      = corpus.reduce((s, t) => s + t.amount, 0)
    const annualDue = mode !== 'all' ? (flatInfo?.maintenance_amt ?? 0) * 12 : null
    return { maintenanceCollected, corpusCollected, annualDue, expenseTotal: expenses.reduce((s, t) => s + t.amount, 0) }
  }, [txns, flatInfo, mode])

  // Group transactions by fiscal month
  const grouped = useMemo(() => {
    const map = new Map<string, any[]>()
    ;(txns ?? []).forEach(t => {
      const key = t.fiscal_label || 'Unknown'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(t)
    })
    return Array.from(map.entries())
  }, [txns])

  function handleExport() {
    const wb = XLSX.utils.book_new()
    const rangeLabel = mode === 'fy' ? fy.label : mode === 'custom' ? `${appliedStart} to ${appliedEnd}` : 'All time'
    const headerRows: any[][] = [
      ['Lilac Apartment Association — Flat Statement'],
      [`Flat: ${flatCode}`, `BHK: ${flatInfo?.bhk_type ?? ''}`, `Period: ${rangeLabel}`],
      [],
      ['SUMMARY'],
      ['Maintenance rate/mo', flatInfo?.maintenance_amt ?? ''],
      ...(summary.annualDue != null ? [['Annual due', summary.annualDue]] : []),
      ['Maintenance collected', summary.maintenanceCollected],
      ...(summary.annualDue != null ? [['Maintenance pending', Math.max(0, summary.annualDue - summary.maintenanceCollected)]] : []),
      ['Corpus collected (period)', summary.corpusCollected],
      ['Corpus collected (total)', corpusEntry?.collected ?? ''],
      ['Corpus target', corpusEntry?.corpus_target ?? ''],
      [],
      ['TRANSACTIONS'],
      ['Date', 'Month', 'CR/DR', 'Amount', 'Category', 'Corpus', 'Type', 'Description'],
    ]
    const txnRows = (txns ?? []).map((t: any) => [
      t.value_date, t.fiscal_label, t.cr_dr, t.amount, t.category, t.corpus, t.row_type, t.description,
    ])
    const ws = XLSX.utils.aoa_to_sheet([...headerRows, ...txnRows])
    ws['!cols'] = [12, 8, 6, 12, 14, 8, 8, 60].map(w => ({ wch: w }))
    XLSX.utils.book_append_sheet(wb, ws, `${flatCode} Statement`)
    XLSX.writeFile(wb, `Lilac_${flatCode}_${rangeLabel.replace(/\s/g, '_')}.xlsx`)
  }

  const pending = summary.annualDue != null ? Math.max(0, summary.annualDue - summary.maintenanceCollected) : null

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <select value={flatCode} onChange={e => setFlatCode(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white font-medium">
          {FLAT_CODES.map(f => <option key={f} value={f}>{f}</option>)}
        </select>

        <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5 text-sm">
          {([
            { key: 'fy',     label: fy.label },
            { key: 'custom', label: 'Custom' },
            { key: 'all',    label: 'All time' },
          ] as { key: FlatDateMode; label: string }[]).map(({ key, label }) => (
            <button key={key} onClick={() => setMode(key)}
              className={`px-3 py-1 rounded-md font-medium transition-colors
                ${mode === key ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
              {label}
            </button>
          ))}
        </div>

        {mode === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={draftStart} onChange={e => setDraftStart(e.target.value)}
              className="border border-slate-200 rounded-lg px-2 py-1 text-sm" />
            <span className="text-slate-400 text-sm">to</span>
            <input type="date" value={draftEnd} onChange={e => setDraftEnd(e.target.value)}
              className="border border-slate-200 rounded-lg px-2 py-1 text-sm" />
            <button onClick={() => { setApplied(draftStart || null); setAppliedEnd(draftEnd || null) }}
              disabled={!canApply} className="btn-primary py-1 px-3">Apply</button>
            <button onClick={() => { setDraftStart(''); setDraftEnd(''); setApplied(null); setAppliedEnd(null); setMode('fy') }}
              className="btn-secondary py-1 px-3">Clear</button>
          </div>
        )}

        <button onClick={handleExport} disabled={!txns?.length}
          className="ml-auto flex items-center gap-1.5 text-sm text-brand-700 hover:text-brand-900 disabled:opacity-40">
          <Download size={14} /> Export Excel
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-4 bg-slate-50">
          <p className="text-xs text-slate-500 mb-1">Rate / month</p>
          <p className="text-xl font-bold text-slate-800">{formatINR(flatInfo?.maintenance_amt ?? 0)}</p>
        </div>
        {summary.annualDue != null && (
          <div className="card p-4 bg-slate-50">
            <p className="text-xs text-slate-500 mb-1">Annual due ({fy.label})</p>
            <p className="text-xl font-bold text-slate-800">{formatINR(summary.annualDue)}</p>
          </div>
        )}
        <div className="card p-4 bg-green-50">
          <p className="text-xs text-slate-500 mb-1">Maintenance collected</p>
          <p className="text-xl font-bold text-green-700">{formatINR(summary.maintenanceCollected)}</p>
        </div>
        {pending != null && (
          <div className={`card p-4 ${pending > 0 ? 'bg-red-50' : 'bg-green-50'}`}>
            <p className="text-xs text-slate-500 mb-1">Pending</p>
            <p className={`text-xl font-bold ${pending > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {pending > 0 ? formatINR(pending) : '✓ Clear'}
            </p>
          </div>
        )}
        {summary.corpusCollected > 0 && (
          <div className="card p-4 bg-purple-50">
            <p className="text-xs text-slate-500 mb-1">Corpus collected</p>
            <p className="text-xl font-bold text-purple-700">{formatINR(summary.corpusCollected)}</p>
            {corpusEntry && (
              <p className="text-xs text-slate-400 mt-0.5">of {formatINR(corpusEntry.corpus_target)} target</p>
            )}
          </div>
        )}
      </div>

      {/* Transaction ledger */}
      {isLoading ? (
        <div className="card h-40 animate-pulse bg-slate-100" />
      ) : !txns?.length ? (
        <div className="card p-10 text-center text-sm text-slate-400">No transactions found for this flat in the selected period</div>
      ) : (
        <div className="card">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-sm">{flatCode} — transaction history</h3>
            <span className="text-xs text-slate-400">{txns.length} transactions</span>
          </div>
          <div className="divide-y divide-slate-50 max-h-[560px] overflow-y-auto">
            {grouped.map(([monthLabel, rows]) => (
              <div key={monthLabel}>
                <div className="px-5 py-2 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide sticky top-0">
                  {monthLabel}
                  <span className="ml-2 font-normal normal-case text-slate-400">
                    {formatINR(rows.filter(r => r.cr_dr === 'CR').reduce((s, r) => s + r.amount, 0))} CR
                  </span>
                </div>
                {rows.map((t: any) => (
                  <div key={t.id} className="flex items-start justify-between px-5 py-3 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${t.cr_dr === 'CR' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {t.cr_dr}
                        </span>
                        <span className="font-semibold">{formatINR(t.amount)}</span>
                        <span className="text-slate-400 text-xs">{t.value_date}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          t.category === 'Corpus' ? 'bg-purple-100 text-purple-700' :
                          t.category === 'Maintenance' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
                        }`}>{t.category}</span>
                        {t.row_type === 'SPLIT' && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">SPLIT</span>}
                      </div>
                      <p className="text-xs text-slate-400 mt-1 truncate max-w-lg">{t.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function buildShareText(month: string, summary: any, flats: any[], expenses: any[], corpusCollected: number, corpusTarget: number) {
  return [
    `THE LILAC APARTMENT ASSOCIATION`,
    `Monthly Statement — ${month}`,
    ``,
    `MAINTENANCE`,
    `  Collected: ${formatINR(summary?.maintenance_collected ?? 0)}`,
    `  Flats paid: ${summary?.flats_paid ?? 0} of 44`,
    ``,
    `EXPENSES`,
    ...expenses.map((e: any) => `  ${e.category}: ${formatINR(e.total_amount)}`),
    ``,
    `CORPUS FUND`,
    `  Collected: ${formatINR(corpusCollected)} of ${formatINR(corpusTarget)}`,
    ``,
    ...(() => {
      const unpaid = flats.filter(f => f.collected < f.maintenance_amt)
      return unpaid.length > 0
        ? [`PENDING MAINTENANCE`, ...unpaid.map(f => `  ${f.flat_code}: ${formatINR(f.maintenance_amt - f.collected)}`), ``]
        : []
    })(),
    `Generated by Lilac Apartments App`,
  ].join('\n')
}
