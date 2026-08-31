import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatINR, FLAT_CODES } from '@/lib/tagger'
import { AlertTriangle, Download, FileText, Loader2, Zap, MessageCircle, Check, ChevronDown } from 'lucide-react'
import * as XLSX from 'xlsx'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import type { DuesEntry } from '@/lib/supabase'
import { fetchFlatContactsByCode } from '@/lib/contacts'
import { WhatsAppSendButtons } from '@/components/WhatsAppSendButtons'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatDateDMY } from '@/lib/date'
import { applyReportableFilter } from '@/lib/expenseFilters'

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

function monthLabelToRange(label: string) {
  const [mon, yy] = label.split('-')
  const monthIndex = MONTHS_SHORT.indexOf(mon)
  const year = 2000 + Number(yy)
  const lastDay = new Date(year, monthIndex + 1, 0).getDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  const prevMonthIndex = monthIndex === 0 ? 11 : monthIndex - 1
  const prevYear = monthIndex === 0 ? year - 1 : year
  const prevLastDay = new Date(prevYear, prevMonthIndex + 1, 0).getDate()
  return {
    start:   `${year}-${pad(monthIndex + 1)}-01`,
    end:     `${year}-${pad(monthIndex + 1)}-${pad(lastDay)}`,
    prevEnd: `${prevYear}-${pad(prevMonthIndex + 1)}-${pad(prevLastDay)}`,
  }
}

function formatShortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d} ${MONTHS_SHORT[Number(m) - 1]}`
}

function getCurrentFy() {
  const now = new Date()
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return {
    year,
    start: `${year}-04-01`,
    end:   `${year + 1}-03-31`,
    label: `FY ${year}-${String(year + 1).slice(-2)}`,
  }
}

function getFyRange(year: number) {
  return {
    year,
    start: `${year}-04-01`,
    end:   `${year + 1}-03-31`,
    label: `FY ${year}-${String(year + 1).slice(-2)}`,
  }
}

function buildFiscalYears() {
  const now = new Date()
  const currentFyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  const years = []
  for (let y = 2022; y <= currentFyYear; y++) years.push(getFyRange(y))
  return years.reverse()
}

const FISCAL_YEARS = buildFiscalYears()


function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const BLOCK_COLORS: Record<string, string> = {
  'Block-A': '#7c3aed',
  'Block-B': '#2563eb',
  'Block-C': '#059669',
  'Block-D': '#d97706',
  'Block-E': '#dc2626',
  'Common':  '#64748b',
}

type ReportTab = 'monthly' | 'flat' | 'aging' | 'agm' | 'utility' | 'expenditure' | 'cashbook' | 'rp' | 'balance-sheet'

export default function ReportPage() {
  const [tab, setTab] = useState<ReportTab>('monthly')
  const [month, setMonth] = useState(currentFiscalLabel)
  const [generatingPdf, setGeneratingPdf] = useState(false)

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

  const { data: duesData } = useQuery({
    queryKey: ['report-dues'],
    queryFn: async () => {
      const { data } = await supabase.from('v_dues_tracker').select('*').order('flat_code')
      return (data ?? []) as DuesEntry[]
    },
  })

  const totalCorpusCollected = corpus?.reduce((s, c) => s + (c.collected ?? 0), 0) ?? 0
  const totalCorpusTarget    = corpus?.reduce((s, c) => s + (c.corpus_target ?? 0), 0) ?? 0
  // A payment made in advance lands in an earlier month's collections, so
  // "no money this month" ≠ "due" — only total outstanding decides that.
  const outstandingFlats = (duesData ?? []).filter(d => d.total_outstanding > 0)
  const duesByFlat = new Map((duesData ?? []).map(d => [d.flat_code, d]))
  // Collections settle oldest month first, so zero outstanding today means
  // every month up to today (incl. the selected one) is covered
  const isCovered = (f: any) => f.collected <= 0 && (duesByFlat.get(f.flat_code)?.total_outstanding ?? 1) <= 0

  async function handleMonthlyPdf() {
    setGeneratingPdf(true)
    try {
      const [{ pdf }, { MonthlyReportDoc }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/reports/AgmPdfDocs'),
      ])
      const generated = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      const blob = await pdf(
        <MonthlyReportDoc
          month={month}
          maintenanceCollected={summary?.maintenance_collected ?? 0}
          flatsPaid={summary?.flats_paid ?? 0}
          totalFlats={44}
          totalExpenses={summary?.total_expenses ?? 0}
          corpusCollected={totalCorpusCollected}
          corpusTarget={totalCorpusTarget}
          flats={(flatsData ?? []).map((f: any) => ({ flat_code: f.flat_code, maintenance_amt: f.maintenance_amt, collected: f.collected }))}
          expenses={(expenses ?? []).map((e: any) => ({ category: e.category, total_amount: e.total_amount }))}
          generated={generated}
        />
      ).toBlob()
      triggerDownload(blob, `Lilac_Monthly_Report_${month}.pdf`)
    } finally {
      setGeneratingPdf(false)
    }
  }

  function handleExcelExport() {
    const wb = XLSX.utils.book_new()

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

    const collRows = [['Flat', 'Maintenance Rate', 'Collected (this month)', 'Total Outstanding', 'Status']]
    ;(flatsData ?? []).forEach((f: any) => {
      const status = f.collected > 0 ? 'Received' : isCovered(f) ? 'Paid in advance' : 'Due'
      collRows.push([f.flat_code, f.maintenance_amt, f.collected, duesByFlat.get(f.flat_code)?.total_outstanding ?? 0, status])
    })
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(collRows), 'Collections')

    const expRows = [['Category', 'Amount', 'Transactions']]
    ;(expenses ?? []).forEach((e: any) => expRows.push([e.category, e.total_amount, e.txn_count]))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(expRows), 'Expenses')

    XLSX.writeFile(wb, `Lilac_Report_${month}.xlsx`)
  }

  return (
    <div className="flex flex-col gap-5 fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[24px] font-extrabold">Reports</h1>
          <p className="text-[13.5px] mt-1" style={{ color: 'var(--ink-500)' }}>Monthly summaries, flat statements &amp; AGM reports</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl p-1 overflow-x-auto" style={{ background: 'var(--ink-100)' }}>
        {([
          { key: 'monthly',     label: 'Monthly summary' },
          { key: 'flat',        label: 'Flat statement' },
          { key: 'aging',       label: 'Dues aging' },
          { key: 'agm',         label: 'AGM reports' },
          { key: 'utility',       label: 'Utilities' },
          { key: 'expenditure',   label: 'Expenditure' },
          { key: 'cashbook',      label: 'Cashbook' },
          { key: 'rp',            label: 'R&P Statement' },
          { key: 'balance-sheet', label: 'Balance Sheet' },
        ] as { key: ReportTab; label: string }[]).map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors
              ${tab === key ? 'bg-white shadow-sm' : 'hover:bg-[var(--ink-50)]'}`}
            style={{ color: tab === key ? 'var(--ink-900)' : 'var(--ink-500)' }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'flat'        && <FlatStatementTab />}
      {tab === 'aging'       && <DuesAgingTab />}
      {tab === 'agm'         && <AGMReportsTab />}
      {tab === 'utility'     && <UtilityTab />}
      {tab === 'expenditure'   && <ExpenditureReportsTab />}
      {tab === 'cashbook'      && <CashbookTab />}
      {tab === 'rp'            && <RPStatementTab />}
      {tab === 'balance-sheet' && <BalanceSheetTab />}
      {tab === 'monthly' && (
        <div className="flex flex-col gap-4 max-w-3xl">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <p className="text-sm" style={{ color: 'var(--ink-500)' }}>Summary for committee &amp; residents</p>
            <select value={month} onChange={e => setMonth(e.target.value)}
              className="ds-field">
              {FISCAL_MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 flex-wrap">
            <button onClick={handleExcelExport} className="btn-secondary flex items-center gap-2">
              <Download size={15} /> Export Excel
            </button>
            <button onClick={handleMonthlyPdf} disabled={generatingPdf} className="btn-primary flex items-center gap-2 disabled:opacity-50">
              {generatingPdf
                ? <><Loader2 size={15} className="animate-spin" /> Generating…</>
                : <><FileText size={15} /> Download PDF</>
              }
            </button>
          </div>

          {/* Summary card */}
          <div className="surface !p-0 overflow-hidden">
            <div className="px-5 py-4 text-white" style={{ background: 'linear-gradient(160deg, var(--brand-700), var(--brand-500))' }}>
              <p className="text-[11px] opacity-80 uppercase tracking-widest font-medium">The Lilac Apartment Association</p>
              <p className="font-bold text-lg mt-0.5">Monthly Statement — {month}</p>
            </div>
            <div className="divide-rows">
              {[
                { label: 'Maintenance collected', value: formatINR(summary?.maintenance_collected ?? 0) },
                { label: 'Flats paid',            value: `${summary?.flats_paid ?? 0} of 44` },
                { label: 'Total expenses',         value: formatINR(summary?.total_expenses ?? 0) },
                { label: 'Corpus collected (total)', value: formatINR(totalCorpusCollected) },
                { label: 'Corpus target (total)',  value: formatINR(totalCorpusTarget) },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between px-5 py-3 text-sm">
                  <span style={{ color: 'var(--ink-500)' }}>{label}</span>
                  <span className="font-semibold" style={{ color: 'var(--ink-800)' }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Expenses */}
          {expenses && expenses.length > 0 && (
            <div className="surface !p-0">
              <div className="px-5 py-3 border-b hairline">
                <h3 className="font-semibold text-sm">Expenses — {month}</h3>
              </div>
              {expenses.map((e: any) => (
                <div key={e.category} className="flex justify-between px-5 py-2.5 border-b hairline text-sm">
                  <span style={{ color: 'var(--ink-600)' }}>{e.category}</span>
                  <span className="font-semibold">{formatINR(e.total_amount)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Collections by flat */}
          <div className="surface !p-0">
            <div className="px-5 py-3 border-b hairline">
              <h3 className="font-semibold text-sm">Collections by flat — {month}</h3>
            </div>
            <div className="divide-rows max-h-64 overflow-y-auto">
              {(flatsData ?? []).map((f: any) => (
                <div key={f.flat_code} className="flex justify-between items-center px-5 py-2 text-sm">
                  <span className="font-medium w-12">{f.flat_code}</span>
                  <span className="flex-1 px-2" style={{ color: 'var(--ink-500)' }}>{formatINR(f.maintenance_amt)}</span>
                  {f.collected > 0 ? (
                    <span className="font-semibold text-green-700">{formatINR(f.collected)}</span>
                  ) : isCovered(f) ? (
                    <span className="text-green-700 text-xs font-medium">Paid in advance ✓</span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Outstanding dues */}
          {outstandingFlats.length > 0 && (
            <div className="surface !p-0">
              <div className="px-5 py-3 border-b hairline flex items-center gap-2">
                <AlertTriangle size={15} className="text-amber-500" />
                <h3 className="font-semibold text-sm">Outstanding dues — as of today</h3>
              </div>
              {outstandingFlats.map(f => (
                <div key={f.flat_code} className="flex justify-between px-5 py-2.5 border-b hairline text-sm">
                  <span className="font-medium">{f.flat_code}</span>
                  <span className="text-red-600 font-semibold">{formatINR(f.total_outstanding)} due</span>
                </div>
              ))}
            </div>
          )}

        </div>
      )}
    </div>
  )
}

// ── DUES AGING TAB ────────────────────────────────────────────

function DuesAgingTab() {
  const fy = getCurrentFy()
  const [selectedFyYear, setSelectedFyYear] = useState(fy.year)
  const selectedFy = getFyRange(selectedFyYear)
  const [generating, setGenerating] = useState(false)

  const { data: dues, isLoading } = useQuery({
    queryKey: ['dues-aging', selectedFyYear],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_dues_tracker')
        .select('*')
        .eq('fiscal_year', selectedFyYear)
        .gt('total_outstanding', 0)
        .order('total_outstanding', { ascending: false })
      return (data ?? []) as DuesEntry[]
    },
  })

  const totalPending = (dues ?? []).reduce((s, r) => s + r.total_outstanding, 0)

  function handleExcel() {
    if (!dues?.length) return
    const wb = XLSX.utils.book_new()
    const rows: any[][] = [
      [`Lilac Apartment Association — Defaulters List — ${selectedFy.label}`],
      [],
      ['Flat', 'Block', 'Annual Due', 'Collected', 'Pending', 'Arrears', 'Total Outstanding', 'Status'],
      ...(dues ?? []).map(r => [
        r.flat_code, r.block, r.annual_due, r.collected_fy,
        r.pending, r.arrears_maintenance, r.total_outstanding,
        r.total_outstanding <= 0 ? 'Clear' : (r.collected_fy > 0 ? 'Partial' : 'Due'),
      ]),
      [],
      ['', '', '', '', '', 'TOTAL OUTSTANDING', totalPending, ''],
    ]
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [10, 8, 14, 14, 14, 14, 18, 10].map(w => ({ wch: w }))
    XLSX.utils.book_append_sheet(wb, ws, 'Defaulters')
    XLSX.writeFile(wb, `Defaulters_${selectedFy.label.replace(/\s/g, '_')}.xlsx`)
  }

  async function handlePdf() {
    if (!dues?.length) return
    setGenerating(true)
    try {
      const [{ pdf }, { DefaultersListDoc }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/reports/AgmPdfDocs'),
      ])
      const generated = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      const blob = await pdf(
        <DefaultersListDoc rows={dues} fyLabel={selectedFy.label} generated={generated} />
      ).toBlob()
      triggerDownload(blob, `Defaulters_${selectedFy.label.replace(/\s/g, '_')}.pdf`)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={selectedFyYear}
          onChange={e => setSelectedFyYear(Number(e.target.value))}
          className="ds-field"
        >
          {FISCAL_YEARS.map(f => <option key={f.year} value={f.year}>{f.label}</option>)}
        </select>

        <div className="ml-auto flex items-center gap-2">
          <button onClick={handleExcel} disabled={!dues?.length}
            className="flex items-center gap-1.5 text-sm hover:opacity-80 disabled:opacity-40" style={{ color: 'var(--brand-700)' }}>
            <Download size={14} /> Export Excel
          </button>
          <button onClick={handlePdf} disabled={!dues?.length || generating}
            className="btn-primary flex items-center gap-2 py-1.5 px-3 text-sm">
            {generating
              ? <><Loader2 size={14} className="animate-spin" /> Generating…</>
              : <><FileText size={14} /> Download PDF</>
            }
          </button>
        </div>
      </div>

      {/* Summary strip */}
      {!isLoading && dues !== undefined && (
        <div className={`flex items-center gap-3 p-3 rounded-lg border text-sm ${dues.length > 0 ? 'bg-red-50 border-red-100' : 'bg-green-50 border-green-100'}`}>
          <AlertTriangle size={15} className={dues.length > 0 ? 'text-red-500 shrink-0' : 'text-green-500 shrink-0'} />
          {dues.length > 0 ? (
            <span className="text-red-700">
              <strong>{dues.length}</strong> flat(s) with outstanding dues ·{' '}
              <strong>{formatINR(totalPending)}</strong> total pending — {selectedFy.label}
            </span>
          ) : (
            <span className="text-green-700">All flats cleared for {selectedFy.label} 🎉</span>
          )}
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="h-64 animate-pulse rounded-[var(--ds-radius)]" style={{ background: 'var(--ink-100)' }} />
      ) : !dues?.length ? (
        <div className="surface !p-10 text-center text-[13px]" style={{ color: 'var(--ink-400)' }}>
          No pending dues for {selectedFy.label}
        </div>
      ) : (
        <div className="surface !p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b hairline" style={{ background: 'var(--ink-50)' }}>
              <tr>
                <th className="text-left px-4 py-2.5 font-semibold" style={{ color: 'var(--ink-600)' }}>Flat</th>
                <th className="text-left px-4 py-2.5 font-semibold" style={{ color: 'var(--ink-600)' }}>Block</th>
                <th className="text-right px-4 py-2.5 font-semibold" style={{ color: 'var(--ink-600)' }}>Annual Due</th>
                <th className="text-right px-4 py-2.5 font-semibold" style={{ color: 'var(--ink-600)' }}>Collected</th>
                <th className="text-right px-4 py-2.5 font-semibold" style={{ color: 'var(--ink-600)' }}>Pending</th>
                <th className="text-right px-4 py-2.5 font-semibold" style={{ color: 'var(--ink-600)' }}>Arrears</th>
                <th className="text-right px-4 py-2.5 font-semibold" style={{ color: 'var(--ink-600)' }}>Outstanding</th>
                <th className="text-left px-4 py-2.5 font-semibold" style={{ color: 'var(--ink-600)' }}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-rows">
              {dues.map((r, i) => {
                const status = r.total_outstanding <= 0 ? 'Clear' : (r.collected_fy > 0 ? 'Partial' : 'Due')
                return (
                <tr key={r.flat_code} className={i % 2 === 1 ? 'bg-slate-50/50' : ''}>
                  <td className="px-4 py-2.5 font-semibold">{r.flat_code}</td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--ink-600)' }}>{r.block}</td>
                  <td className="px-4 py-2.5 text-right">{formatINR(r.annual_due)}</td>
                  <td className="px-4 py-2.5 text-right text-green-700">{r.collected_fy > 0 ? formatINR(r.collected_fy) : '—'}</td>
                  <td className="px-4 py-2.5 text-right">{r.pending > 0 ? formatINR(r.pending) : '—'}</td>
                  <td className="px-4 py-2.5 text-right">{r.arrears_maintenance > 0 ? formatINR(r.arrears_maintenance) : '—'}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-red-600">{formatINR(r.total_outstanding)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      status === 'Due'     ? 'bg-red-100 text-red-700' :
                      status === 'Partial' ? 'bg-amber-100 text-amber-700' :
                                             'bg-green-100 text-green-700'
                    }`}>{status}</span>
                  </td>
                </tr>
                )
              })}
            </tbody>
            <tfoot className="border-t-2 hairline" style={{ background: 'var(--ink-50)' }}>
              <tr>
                <td className="px-4 py-3 font-bold" colSpan={6}>Total outstanding</td>
                <td className="px-4 py-3 text-right font-bold text-red-600">{formatINR(totalPending)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

// ── AGM REPORTS TAB ───────────────────────────────────────────

function AGMReportsTab() {
  const fy = getCurrentFy()
  const [selectedFyYear, setSelectedFyYear] = useState(fy.year)
  const selectedFy = getFyRange(selectedFyYear)
  const [generating, setGenerating] = useState<string | null>(null)

  // Defaulters: pending > 0, sorted block → flat
  const { data: defaulters } = useQuery({
    queryKey: ['agm-defaulters', selectedFyYear],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_dues_tracker')
        .select('*')
        .eq('fiscal_year', selectedFyYear)
        .gt('pending', 0)
        .order('block')
        .order('flat_code')
      return (data ?? []) as DuesEntry[]
    },
  })

  // Income: aggregate CR transactions by category for the FY. Excludes 'Contribution' —
  // voluntary drive money is held/disbursed outside the expenses table, so it never gets an
  // offsetting expenditure line here; counting it as income would overstate the I&E surplus.
  const { data: incomeTxns } = useQuery({
    queryKey: ['agm-income', selectedFyYear],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('category, amount')
        .eq('cr_dr', 'CR')
        .neq('row_type', 'VOIDED')
        .neq('category', 'Contribution')
        .gte('value_date', selectedFy.start)
        .lte('value_date', selectedFy.end)
      return data ?? []
    },
  })

  // Expenditure: from expenses table by category
  const { data: expenditure } = useQuery({
    queryKey: ['agm-expenses', selectedFyYear],
    queryFn: async () => {
      const [{ data: exps }, { data: cats }] = await Promise.all([
        applyReportableFilter(supabase.from('expenses').select('amount, category_id'))
          .gte('expense_date', selectedFy.start)
          .lte('expense_date', selectedFy.end),
        supabase.from('expense_categories').select('id, name'),
      ])
      const catMap = new Map((cats ?? []).map((c: any) => [c.id, c.name as string]))
      const grouped = new Map<string, number>()
      for (const e of exps ?? []) {
        const cat = catMap.get((e as any).category_id) ?? 'Uncategorised'
        grouped.set(cat, (grouped.get(cat) ?? 0) + ((e as any).amount ?? 0))
      }
      return Array.from(grouped.entries())
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount)
    },
  })

  // Corpus plans for fund statement
  const { data: corpusData } = useQuery({
    queryKey: ['agm-corpus'],
    queryFn: async () => {
      const { data } = await supabase.from('v_corpus_tracker').select('*')
      return data ?? []
    },
  })

  // Aggregate income by category
  const income = useMemo(() => {
    const grouped = new Map<string, number>()
    for (const t of incomeTxns ?? []) {
      grouped.set((t as any).category, (grouped.get((t as any).category) ?? 0) + ((t as any).amount ?? 0))
    }
    return Array.from(grouped.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
  }, [incomeTxns])

  // Receipts & Payments: all CR transactions by category + expenses by category
  const { data: allCrTxns } = useQuery({
    queryKey: ['agm-cr-txns', selectedFyYear],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('category, amount')
        .eq('cr_dr', 'CR')
        .neq('row_type', 'VOIDED')
        .gte('value_date', selectedFy.start)
        .lte('value_date', selectedFy.end)
      return data ?? []
    },
  })

  const receipts = useMemo(() => {
    const grouped = new Map<string, number>()
    for (const t of allCrTxns ?? []) {
      const cat = (t as any).category ?? 'Other'
      grouped.set(cat, (grouped.get(cat) ?? 0) + ((t as any).amount ?? 0))
    }
    return Array.from(grouped.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
  }, [allCrTxns])

  // Build CorpusPlanSummary[] for the PDF
  const corpusPlans = useMemo(() => {
    const planMap = new Map<string, any>()
    for (const row of corpusData ?? []) {
      const r = row as any
      if (!planMap.has(r.plan_id)) {
        planMap.set(r.plan_id, {
          plan_name: r.plan_name,
          plan_status: r.plan_status,
          start_fiscal_year: r.start_fiscal_year,
          end_fiscal_year: r.end_fiscal_year,
          total_target: 0,
          total_collected: 0,
          total_balance: 0,
          flats: [],
        })
      }
      const plan = planMap.get(r.plan_id)
      plan.total_target    += r.corpus_target ?? 0
      plan.total_collected += r.collected ?? 0
      plan.total_balance   += r.balance ?? 0
      plan.flats.push({
        flat_code:     r.flat_code,
        corpus_target: r.corpus_target ?? 0,
        collected:     r.collected ?? 0,
        balance:       r.balance ?? 0,
        status:        r.status ?? '',
      })
    }
    return Array.from(planMap.values())
  }, [corpusData])

  const generated = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

  async function handleDefaultersPdf() {
    if (!defaulters?.length) return
    setGenerating('defaulters')
    try {
      const [{ pdf }, { DefaultersListDoc }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/reports/AgmPdfDocs'),
      ])
      const blob = await pdf(
        <DefaultersListDoc rows={defaulters} fyLabel={selectedFy.label} generated={generated} />
      ).toBlob()
      triggerDownload(blob, `Defaulters_${selectedFy.label.replace(/\s/g, '_')}.pdf`)
    } finally {
      setGenerating(null)
    }
  }

  async function handleIEPdf() {
    setGenerating('ie')
    try {
      const [{ pdf }, { IEStatementDoc }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/reports/AgmPdfDocs'),
      ])
      const blob = await pdf(
        <IEStatementDoc
          income={income}
          expenditure={expenditure ?? []}
          fyLabel={selectedFy.label}
          generated={generated}
        />
      ).toBlob()
      triggerDownload(blob, `IE_Statement_${selectedFy.label.replace(/\s/g, '_')}.pdf`)
    } finally {
      setGenerating(null)
    }
  }

  async function handleCorpusPdf() {
    if (!corpusPlans.length) return
    setGenerating('corpus')
    try {
      const [{ pdf }, { CorpusFundDoc }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/reports/AgmPdfDocs'),
      ])
      const blob = await pdf(
        <CorpusFundDoc plans={corpusPlans} generated={generated} />
      ).toBlob()
      triggerDownload(blob, `Corpus_Fund_Statement.pdf`)
    } finally {
      setGenerating(null)
    }
  }

  async function handleRPPdf() {
    setGenerating('rp')
    try {
      const [{ pdf }, { ReceiptsPaymentsDoc }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/reports/AgmPdfDocs'),
      ])
      const blob = await pdf(
        <ReceiptsPaymentsDoc
          receipts={receipts}
          payments={expenditure ?? []}
          fyLabel={selectedFy.label}
          generated={generated}
        />
      ).toBlob()
      triggerDownload(blob, `RP_Account_${selectedFy.label.replace(/\s/g, '_')}.pdf`)
    } finally {
      setGenerating(null)
    }
  }

  const reports = [
    {
      key: 'defaulters',
      title: 'Defaulters List',
      desc: 'All flats with outstanding maintenance dues — read at AGM',
      meta: `${defaulters?.length ?? 0} flat(s) pending · ${selectedFy.label}`,
      onDownload: handleDefaultersPdf,
      disabled: !defaulters?.length,
    },
    {
      key: 'ie',
      title: 'Income & Expenditure Statement',
      desc: 'Categorised income vs expenditure for the financial year',
      meta: `${income.length} income categories · ${selectedFy.label}`,
      onDownload: handleIEPdf,
      disabled: income.length === 0,
    },
    {
      key: 'corpus',
      title: 'Corpus Fund Statement',
      desc: 'Per-plan flat-wise corpus collection status',
      meta: `${corpusPlans.length} plan(s) · all time`,
      onDownload: handleCorpusPdf,
      disabled: corpusPlans.length === 0,
    },
    {
      key: 'rp',
      title: 'Receipts & Payments Account',
      desc: 'Cash-basis summary of all inflows and outflows',
      meta: `${receipts.length} receipt categories · ${selectedFy.label}`,
      onDownload: handleRPPdf,
      disabled: receipts.length === 0,
    },
  ]

  return (
    <div className="flex flex-col gap-5">
      {/* FY selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium" style={{ color: 'var(--ink-600)' }}>Financial Year</label>
        <select
          value={selectedFyYear}
          onChange={e => setSelectedFyYear(Number(e.target.value))}
          className="ds-field"
        >
          {FISCAL_YEARS.map(f => <option key={f.year} value={f.year}>{f.label}</option>)}
        </select>
        <span className="text-xs" style={{ color: 'var(--ink-400)' }}>Corpus Fund Statement is for all active/completed plans regardless of FY</span>
      </div>

      {/* Report cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {reports.map(r => (
          <div key={r.key} className="surface !p-5 flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <FileText size={20} className="text-violet-500 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <h3 className="font-semibold text-sm leading-snug" style={{ color: 'var(--ink-800)' }}>{r.title}</h3>
                <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--ink-500)' }}>{r.desc}</p>
              </div>
            </div>

            <p className="text-xs border-t hairline pt-2" style={{ color: 'var(--ink-400)' }}>{r.meta}</p>

            <button
              onClick={r.onDownload}
              disabled={r.disabled || generating === r.key}
              className="btn-primary flex items-center justify-center gap-2 py-2 text-sm mt-auto disabled:opacity-50"
            >
              {generating === r.key
                ? <><Loader2 size={14} className="animate-spin" /> Generating PDF…</>
                : <><Download size={14} /> Download PDF</>
              }
            </button>
          </div>
        ))}
      </div>

      <p className="text-xs text-center" style={{ color: 'var(--ink-400)' }}>
        PDFs are generated in-browser — no data leaves your device.
      </p>
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
  const rangeLabel = mode === 'fy' ? fy.label : mode === 'custom' ? `${appliedStart} to ${appliedEnd}` : 'All time'

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

  const { data: corpusEntries } = useQuery({
    queryKey: ['corpus-entries', flatCode],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_corpus_tracker')
        .select('plan_name, corpus_target, collected, balance, status')
        .eq('flat_code', flatCode)
      return data ?? []
    },
    enabled: !!flatCode,
  })

  const corpusTotals = corpusEntries && corpusEntries.length > 0 ? {
    collected: corpusEntries.reduce((s, e) => s + (e.collected ?? 0), 0),
    target:    corpusEntries.reduce((s, e) => s + (e.corpus_target ?? 0), 0),
    balance:   corpusEntries.reduce((s, e) => s + (e.balance ?? 0), 0),
    plans:     corpusEntries.length,
  } : null

  // Cumulative dues tracker — tracks all dues/collections from dues_start_fiscal_year to today
  const { data: duesEntry } = useQuery({
    queryKey: ['dues-entry', flatCode],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_dues_tracker')
        .select('collected_fy, pending, total_outstanding, arrears_maintenance, advance_credits, status, start_fiscal_year')
        .eq('flat_code', flatCode)
        .single()
      return data
    },
    enabled: !!flatCode,
  })

  const maintenanceCollected = useMemo(() =>
    (txns ?? []).filter(t => t.cr_dr === 'CR' && t.category === 'Maintenance')
               .reduce((s, t) => s + t.amount, 0)
  , [txns])

  const grouped = useMemo(() => {
    const map = new Map<string, any[]>()
    ;(txns ?? []).forEach(t => {
      const key = t.fiscal_label || 'Unknown'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(t)
    })
    return Array.from(map.entries())
  }, [txns])

  const [exportOpen, setExportOpen]   = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)

  function handleExportExcel() {
    const wb = XLSX.utils.book_new()
    const headerRows: any[][] = [
      ['Lilac Apartment Association — Flat Statement'],
      [`Flat: ${flatCode}`, `BHK: ${flatInfo?.bhk_type ?? ''}`, `Period: ${rangeLabel}`],
      [],
      ['SUMMARY (cumulative since Apr-' + String(duesEntry?.start_fiscal_year ?? '').slice(-2) + ')'],
      ['Maintenance rate/mo', flatInfo?.maintenance_amt ?? ''],
      ['Total collected', duesEntry?.collected_fy ?? ''],
      ['Outstanding', duesEntry?.total_outstanding ?? ''],
      [],
      ['Corpus collected (total)', corpusTotals?.collected ?? ''],
      ['Corpus target (total)', corpusTotals?.target ?? ''],
      ['Corpus balance', corpusTotals?.balance ?? ''],
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

  const outstandingAmt = duesEntry ? Number(duesEntry.total_outstanding) : null

  async function handleExportPdf() {
    setExportingPdf(true)
    try {
      const [{ pdf }, { FlatStatementDoc }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/reports/AgmPdfDocs'),
      ])
      const generated = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      const blob = await pdf(
        <FlatStatementDoc
          flatCode={flatCode}
          bhkType={flatInfo?.bhk_type ?? ''}
          periodLabel={rangeLabel}
          sinceFyLabel={`Apr-${String(duesEntry?.start_fiscal_year ?? '').slice(-2)}`}
          rate={flatInfo?.maintenance_amt ?? 0}
          maintenanceCollected={maintenanceCollected}
          outstanding={outstandingAmt}
          corpus={corpusTotals ? { collected: corpusTotals.collected, target: corpusTotals.target, balance: corpusTotals.balance } : null}
          rows={(txns ?? []).map((t: any) => ({
            value_date: t.value_date, fiscal_label: t.fiscal_label, cr_dr: t.cr_dr, amount: t.amount,
            category: t.category, corpus: t.corpus, row_type: t.row_type, description: t.description,
          }))}
          generated={generated}
        />
      ).toBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Lilac_${flatCode}_${rangeLabel.replace(/\s/g, '_')}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } finally {
      setExportingPdf(false)
    }
  }

  const [copied, setCopied] = useState(false)

  const { data: appSettings } = useQuery({
    queryKey: ['app-settings'],
    queryFn: async () => {
      const { data } = await supabase.from('app_settings').select('*')
      return Object.fromEntries((data ?? []).map((s: any) => [s.key, s.value]))
    },
  })

  const { data: contacts } = useQuery({
    queryKey: ['flat-contacts', flatCode],
    queryFn: () => fetchFlatContactsByCode(flatCode),
    enabled: !!flatCode,
  })

  const maintOutstanding = outstandingAmt ?? 0
  const corpusOutstanding = corpusTotals?.balance ?? 0
  const combinedOutstanding = Math.max(0, maintOutstanding) + Math.max(0, corpusOutstanding)

  function buildConsolidatedReminder() {
    const asOf = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    const lines = [
      `*Lilac Apartments – Payment Reminder*`,
      ``,
      `*Flat ${flatCode} · ${asOf}*`,
      ``,
      `Dear Resident,`,
      ``,
      `This is a gentle reminder that your outstanding maintenance & corpus dues are currently *${formatINR(combinedOutstanding)}*:`,
      ``,
    ]
    if (maintOutstanding > 0) lines.push(`• Maintenance: ${formatINR(maintOutstanding)}`)
    if (corpusOutstanding > 0) lines.push(`• Corpus: ${formatINR(corpusOutstanding)}`)
    const upi  = appSettings?.collection_upi
    const bank = appSettings?.collection_bank
    if (upi || bank) {
      lines.push(``, `*Pay via:*`)
      if (upi) {
        lines.push(`UPI ID: \`${upi}\``)
        const payUrl = `upi://pay?pa=${upi}&pn=${encodeURIComponent('Lilac Apartment Association')}&am=${combinedOutstanding}&cu=INR`
        lines.push(``, `*Quick Pay* (supported on some devices):`, `\`${payUrl}\``)
      }
      if (bank) lines.push(``, `Bank: ${bank}`)
    }
    lines.push(
      ``,
      `We'd appreciate it if you could clear the dues at your earliest convenience. Thank you for your cooperation!`,
      ``,
      `— *The Lilac Apartment Association, Rajakilpakkam*`,
    )
    return lines.join('\n')
  }

  async function handleCopyConsolidated() {
    await navigator.clipboard.writeText(buildConsolidatedReminder())
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <select value={flatCode} onChange={e => setFlatCode(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white font-medium">
          {FLAT_CODES.map(f => <option key={f} value={f}>{f}</option>)}
        </select>

        <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5 text-sm flex-wrap">
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
            <span className="text-sm" style={{ color: 'var(--ink-400)' }}>to</span>
            <input type="date" value={draftEnd} onChange={e => setDraftEnd(e.target.value)}
              className="border border-slate-200 rounded-lg px-2 py-1 text-sm" />
            <button onClick={() => { setApplied(draftStart || null); setAppliedEnd(draftEnd || null) }}
              disabled={!canApply} className="btn-primary py-1 px-3">Apply</button>
            <button onClick={() => { setDraftStart(''); setDraftEnd(''); setApplied(null); setAppliedEnd(null); setMode('fy') }}
              className="btn-secondary py-1 px-3">Clear</button>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {combinedOutstanding > 0 && (
            <>
              {/* Redundant once a contact is tagged — WhatsAppSendButtons below sends directly. */}
              {(!contacts || contacts.length === 0) && (
                <button onClick={handleCopyConsolidated}
                  className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border hover:opacity-80"
                  style={{ borderColor: 'var(--ink-200)', color: 'var(--ink-700)' }}>
                  {copied
                    ? <><Check size={14} /> Copied!</>
                    : <><MessageCircle size={14} /> Copy reminder</>}
                </button>
              )}
              <WhatsAppSendButtons contacts={contacts ?? []} text={buildConsolidatedReminder()} />
            </>
          )}
          <Popover open={exportOpen} onOpenChange={setExportOpen}>
            <PopoverTrigger asChild>
              <button disabled={!txns?.length}
                className="flex items-center gap-1.5 text-sm hover:opacity-80 disabled:opacity-40" style={{ color: 'var(--brand-700)' }}>
                {exportingPdf ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                Export <ChevronDown size={13} />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-40 p-1">
              <div className="flex flex-col">
                <button
                  onClick={() => { setExportOpen(false); handleExportPdf() }}
                  className="text-left px-2.5 py-1.5 rounded-md text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                  Export as PDF
                </button>
                <button
                  onClick={() => { setExportOpen(false); handleExportExcel() }}
                  className="text-left px-2.5 py-1.5 rounded-md text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                  Export as Excel
                </button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="surface !p-4" style={{ background: 'var(--ink-50)' }}>
          <p className="text-[12px] mb-1" style={{ color: 'var(--ink-500)' }}>Rate / month</p>
          <p className="text-xl font-bold" style={{ color: 'var(--ink-800)' }}>{formatINR(flatInfo?.maintenance_amt ?? 0)}</p>
        </div>

        <div className="surface !p-4" style={{ background: 'var(--ok-bg)' }}>
          <p className="text-[12px] mb-1" style={{ color: 'var(--ink-500)' }}>Maintenance collected</p>
          <p className="text-xl font-bold text-green-700">{formatINR(maintenanceCollected)}</p>
        </div>

        {duesEntry && (
          <div className="surface !p-4" style={{ background: outstandingAmt! > 0 ? 'var(--bad-bg)' : 'var(--ok-bg)' }}>
            <p className="text-[12px] mb-1" style={{ color: 'var(--ink-500)' }}>Outstanding</p>
            <p className={`text-xl font-bold ${outstandingAmt! > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {outstandingAmt! > 0 ? formatINR(outstandingAmt!) : '✓ Clear'}
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--ink-400)' }}>all dues since Apr-{String(duesEntry.start_fiscal_year).slice(-2)}</p>
          </div>
        )}

        {corpusTotals && (
          <div className="surface !p-4" style={{ background: 'var(--brand-50)' }}>
            <p className="text-[12px] mb-1" style={{ color: 'var(--ink-500)' }}>Corpus collected</p>
            <p className="text-xl font-bold text-purple-700">{formatINR(corpusTotals.collected)}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--ink-400)' }}>
              of {formatINR(corpusTotals.target)} target
              {corpusTotals.plans > 1 && ` · ${corpusTotals.plans} plans`}
            </p>
          </div>
        )}
      </div>

      {/* Transaction ledger */}
      {isLoading ? (
        <div className="h-40 animate-pulse rounded-[var(--ds-radius)]" style={{ background: 'var(--ink-100)' }} />
      ) : !txns?.length ? (
        <div className="surface !p-10 text-center text-[13px]" style={{ color: 'var(--ink-400)' }}>No transactions found for this flat in the selected period</div>
      ) : (
        <div className="surface !p-0">
          <div className="px-5 py-3 border-b hairline flex items-center justify-between">
            <h3 className="font-semibold text-sm">{flatCode} — transaction history</h3>
            <span className="text-xs" style={{ color: 'var(--ink-400)' }}>{txns.length} transactions</span>
          </div>
          <div className="divide-rows max-h-[560px] overflow-y-auto">
            {grouped.map(([monthLabel, rows]) => (
              <div key={monthLabel}>
                <div className="px-5 py-2 text-xs font-semibold uppercase tracking-wide sticky top-0" style={{ background: 'var(--ink-50)', color: 'var(--ink-500)' }}>
                  {monthLabel}
                  <span className="ml-2 font-normal normal-case" style={{ color: 'var(--ink-400)' }}>
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
                        <span className="text-xs" style={{ color: 'var(--ink-400)' }}>{formatDateDMY(t.value_date)}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          t.category === 'Corpus' ? 'bg-purple-100 text-purple-700' :
                          t.category === 'Maintenance' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
                        }`}>{t.category}</span>
                        {t.row_type === 'SPLIT' && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">SPLIT</span>}
                      </div>
                      <p className="text-xs mt-1 truncate max-w-lg" style={{ color: 'var(--ink-400)' }}>{t.description}</p>
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

// ── EXPENDITURE REPORTS TAB ──────────────────────────────────

type ExpSubTab = 'category' | 'vendor' | 'trend' | 'tds'

type ExpFund = 'all' | 'maintenance' | 'corpus'

function ExpenditureReportsTab() {
  const fy = getCurrentFy()
  const [selectedFyYear, setSelectedFyYear] = useState(fy.year)
  const [subTab, setSubTab] = useState<ExpSubTab>('category')
  const [fund, setFund] = useState<ExpFund>('all')
  const [drillCategory, setDrillCategory] = useState<{ id: string | null; name: string } | null>(null)
  const selectedFy = getFyRange(selectedFyYear)
  const fundLabel = fund === 'all' ? '' : fund === 'corpus' ? ' (Corpus)' : ' (Maintenance)'

  function applyFund<T extends { is: any; not: any }>(q: T): T {
    if (fund === 'corpus') return q.not('corpus_plan_id', 'is', null)
    if (fund === 'maintenance') return q.is('corpus_plan_id', null)
    return q
  }

  // Category-wise expenses — broken down by line-item category, not header category.
  // A voucher covering several categories (e.g. a reimbursement split across Plumbing,
  // Sump water, Motor Pumps) has category_id = null on the header itself; the real
  // categorisation lives on each expense_line_items row. Headers with no line items fall
  // back to their own category_id/amount.
  const { data: catExpenses, isLoading: loadingCat } = useQuery({
    queryKey: ['exp-by-category', selectedFyYear, fund],
    queryFn: async () => {
      const { data: headers } = await applyFund(
        applyReportableFilter(supabase.from('expenses').select('id, amount, category_id'))
          .gte('expense_date', selectedFy.start)
          .lte('expense_date', selectedFy.end)
      )
      const headerIds = (headers ?? []).map((h: any) => h.id)
      const [{ data: lineItems }, { data: cats }] = await Promise.all([
        headerIds.length
          ? supabase.from('expense_line_items').select('expense_id, amount, category_id').in('expense_id', headerIds)
          : Promise.resolve({ data: [] as any[] }),
        supabase.from('expense_categories').select('id, name, budget_type'),
      ])
      const linesByHeader = new Map<string, any[]>()
      for (const li of lineItems ?? []) {
        if (!linesByHeader.has((li as any).expense_id)) linesByHeader.set((li as any).expense_id, [])
        linesByHeader.get((li as any).expense_id)!.push(li)
      }
      const catMap = new Map((cats ?? []).map((c: any) => [c.id, { name: c.name as string, budget_type: c.budget_type as string }]))
      const grouped = new Map<string, { amount: number; budget_type: string; categoryId: string | null }>()
      function addAmt(catId: string | null, amount: number) {
        const cat = (catId !== null ? catMap.get(catId) : undefined) ?? { name: 'Uncategorised', budget_type: 'Maintenance' }
        const prev = grouped.get(cat.name) ?? { amount: 0, budget_type: cat.budget_type, categoryId: cat.name === 'Uncategorised' ? null : catId }
        grouped.set(cat.name, { amount: prev.amount + amount, budget_type: cat.budget_type, categoryId: prev.categoryId })
      }
      for (const h of headers ?? []) {
        const lines = linesByHeader.get((h as any).id) ?? []
        if (lines.length === 0) {
          addAmt((h as any).category_id ?? null, (h as any).amount ?? 0)
        } else {
          for (const li of lines) addAmt((li as any).category_id ?? (h as any).category_id ?? null, (li as any).amount ?? 0)
        }
      }
      return Array.from(grouped.entries())
        .map(([category, v]) => ({ category, amount: v.amount, budget_type: v.budget_type, categoryId: v.categoryId }))
        .sort((a, b) => b.amount - a.amount)
    },
  })

  // Vendor-wise expenses
  const { data: vendorExpenses, isLoading: loadingVendor } = useQuery({
    queryKey: ['exp-by-vendor', selectedFyYear, fund],
    queryFn: async () => {
      const [{ data: exps }, { data: vendors }] = await Promise.all([
        applyFund(
          applyReportableFilter(supabase.from('expenses').select('amount, vendor_id, payee_name_raw, payment_mode'))
            .gte('expense_date', selectedFy.start)
            .lte('expense_date', selectedFy.end)
        ),
        supabase.from('vendors').select('id, name'),
      ])
      const vendorMap = new Map((vendors ?? []).map((v: any) => [v.id, v.name as string]))
      const grouped = new Map<string, number>()
      for (const e of exps ?? []) {
        const name = (e as any).vendor_id
          ? (vendorMap.get((e as any).vendor_id) ?? 'Unknown Vendor')
          : ((e as any).payee_name_raw ?? 'Cash / Misc')
        grouped.set(name, (grouped.get(name) ?? 0) + ((e as any).amount ?? 0))
      }
      return Array.from(grouped.entries())
        .map(([vendor, amount]) => ({ vendor, amount, tdsRequired: amount >= 30000 }))
        .sort((a, b) => b.amount - a.amount)
    },
  })

  // Monthly trend
  const { data: monthlyTrend, isLoading: loadingTrend } = useQuery({
    queryKey: ['exp-monthly-trend', selectedFyYear, fund],
    queryFn: async () => {
      const { data: exps } = await applyFund(
        applyReportableFilter(
          supabase
            .from('expenses')
            .select('expense_date, amount')
        )
          .gte('expense_date', selectedFy.start)
          .lte('expense_date', selectedFy.end)
      )
      const monthly = new Map<string, number>()
      const MONTHS_S = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
      for (const e of exps ?? []) {
        const d = new Date((e as any).expense_date)
        const key = `${MONTHS_S[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`
        monthly.set(key, (monthly.get(key) ?? 0) + ((e as any).amount ?? 0))
      }
      // Build ordered array Apr→Mar
      const result: { month: string; amount: number }[] = []
      for (let m = 3; m <= 14; m++) {
        const yr = m > 11 ? selectedFyYear + 1 : selectedFyYear
        const mi = m > 11 ? m - 12 : m
        const key = `${MONTHS_S[mi]}-${String(yr).slice(-2)}`
        result.push({ month: key, amount: monthly.get(key) ?? 0 })
      }
      return result
    },
  })

  const { data: tdsRows, isLoading: loadingTds } = useQuery({
    queryKey: ['tds-register', selectedFyYear],
    queryFn: async () => {
      const { data: reportableHeaders } = await applyReportableFilter(
        supabase.from('expenses').select('id')
      )
        .gte('expense_date', selectedFy.start)
        .lte('expense_date', selectedFy.end)
      const reportableIds = (reportableHeaders ?? []).map(h => h.id)
      if (reportableIds.length === 0) return []
      const [{ data: lineItems }, { data: vendors }] = await Promise.all([
        supabase
          .from('expense_line_items')
          .select('amount, vendor_id, payee_name_raw, category_id')
          .in('expense_id', reportableIds)
          .gte('created_at', selectedFy.start + 'T00:00:00')
          .lte('created_at', selectedFy.end + 'T23:59:59'),
        supabase.from('vendors').select('id, name, pan_number'),
      ])
      const vendorMap = new Map(
        (vendors ?? []).map((v: any) => [v.id, { name: v.name as string, pan: v.pan_number as string | null }])
      )
      const grouped = new Map<string, { name: string; pan: string | null; total: number }>()
      for (const item of lineItems ?? []) {
        const vi  = (item as any).vendor_id
        const key = vi ?? ((item as any).payee_name_raw ?? 'Cash / Misc')
        if (!grouped.has(key)) {
          const info = vi
            ? (vendorMap.get(vi) ?? { name: (item as any).payee_name_raw ?? 'Unknown', pan: null })
            : { name: (item as any).payee_name_raw ?? 'Cash / Misc', pan: null }
          grouped.set(key, { name: info.name, pan: info.pan, total: 0 })
        }
        grouped.get(key)!.total += (item as any).amount ?? 0
      }
      const TDS_THRESHOLD = 30000
      const TDS_RATE = 0.10
      return Array.from(grouped.values())
        .filter(r => r.total > 0)
        .map(r => ({
          name:          r.name,
          pan:           r.pan ?? '—',
          total:         r.total,
          overThreshold: Math.max(0, r.total - TDS_THRESHOLD),
          tdsDue:        r.total > TDS_THRESHOLD ? Math.round((r.total - TDS_THRESHOLD) * TDS_RATE) : 0,
          status:        r.total > TDS_THRESHOLD ? 'Due' : 'Below threshold',
        }))
        .sort((a, b) => b.total - a.total)
    },
  })

  function handleExcelCategory() {
    if (!catExpenses?.length) return
    const wb = XLSX.utils.book_new()
    const rows: any[][] = [
      [`Expenditure by Category — ${selectedFy.label}${fundLabel}`], [],
      ['Category', 'Type', 'Amount'],
      ...(catExpenses).map(r => [r.category, r.budget_type, r.amount]),
      [],
      ['TOTAL', '', catExpenses.reduce((s, r) => s + r.amount, 0)],
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Category')
    XLSX.writeFile(wb, `Expenses_Category_${selectedFy.label.replace(/\s/g,'_')}.xlsx`)
  }

  function handleExcelVendor() {
    if (!vendorExpenses?.length) return
    const wb = XLSX.utils.book_new()
    const rows: any[][] = [
      [`Expenditure by Vendor — ${selectedFy.label}${fundLabel}`], [],
      ['Vendor / Payee', 'Amount', 'TDS Required (>₹30K)'],
      ...(vendorExpenses).map(r => [r.vendor, r.amount, r.tdsRequired ? 'Yes' : 'No']),
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Vendor')
    XLSX.writeFile(wb, `Expenses_Vendor_${selectedFy.label.replace(/\s/g,'_')}.xlsx`)
  }

  const totalExpenses = (catExpenses ?? []).reduce((s, r) => s + r.amount, 0)
  const maintenanceTotal = (catExpenses ?? []).filter(r => r.budget_type === 'Maintenance').reduce((s, r) => s + r.amount, 0)
  const corpusTotal      = (catExpenses ?? []).filter(r => r.budget_type === 'Corpus').reduce((s, r) => s + r.amount, 0)
  const tdsVendors       = (vendorExpenses ?? []).filter(r => r.tdsRequired).length

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5 text-sm flex-wrap">
          {([
            { key: 'category', label: 'By category' },
            { key: 'vendor',   label: 'By vendor' },
            { key: 'trend',    label: 'Monthly trend' },
            { key: 'tds',      label: 'TDS Register' },
          ] as { key: ExpSubTab; label: string }[]).map(({ key, label }) => (
            <button key={key} onClick={() => setSubTab(key)}
              className={`px-3 py-1 rounded-md font-medium transition-colors
                ${subTab === key ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
              {label}
            </button>
          ))}
        </div>
        <select value={selectedFyYear} onChange={e => setSelectedFyYear(Number(e.target.value))}
          className="ds-field">
          {FISCAL_YEARS.map(f => <option key={f.year} value={f.year}>{f.label}</option>)}
        </select>
        <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5 text-sm">
          {([
            { key: 'all',         label: 'All funds' },
            { key: 'maintenance', label: 'Maintenance' },
            { key: 'corpus',      label: 'Corpus' },
          ] as { key: ExpFund; label: string }[]).map(({ key, label }) => (
            <button key={key} onClick={() => setFund(key)}
              className={`px-3 py-1 rounded-md font-medium transition-colors
                ${fund === key ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="surface !p-4" style={{ background: 'var(--bad-bg)' }}>
          <p className="text-[12px] mb-1" style={{ color: 'var(--ink-500)' }}>Total expenses</p>
          <p className="text-xl font-bold text-rose-600">{totalExpenses > 0 ? formatINR(totalExpenses) : '—'}</p>
        </div>
        <div className="surface !p-4" style={{ background: 'var(--info-bg)' }}>
          <p className="text-[12px] mb-1" style={{ color: 'var(--ink-500)' }}>Maintenance expenses</p>
          <p className="text-xl font-bold text-blue-700">{maintenanceTotal > 0 ? formatINR(maintenanceTotal) : '—'}</p>
        </div>
        <div className="surface !p-4" style={{ background: 'var(--brand-50)' }}>
          <p className="text-[12px] mb-1" style={{ color: 'var(--ink-500)' }}>Corpus expenses</p>
          <p className="text-xl font-bold text-violet-700">{corpusTotal > 0 ? formatINR(corpusTotal) : '—'}</p>
        </div>
        <div className="surface !p-4" style={{ background: tdsVendors > 0 ? 'var(--warn-bg, #fffbeb)' : undefined }}>
          <p className="text-[12px] mb-1" style={{ color: 'var(--ink-500)' }}>TDS required vendors</p>
          <p className={`text-xl font-bold ${tdsVendors > 0 ? 'text-amber-600' : ''}`} style={tdsVendors === 0 ? { color: 'var(--ink-400)' } : undefined}>
            {tdsVendors > 0 ? tdsVendors : '—'}
          </p>
          {tdsVendors > 0 && <p className="text-xs text-amber-500 mt-0.5">Vendors paid &gt;₹30K</p>}
        </div>
      </div>

      {/* By category */}
      {subTab === 'category' && (
        <div className="flex flex-col gap-4">
          {catExpenses && catExpenses.length > 0 && (
            <div className="surface !p-4">
              <h3 className="font-semibold text-sm mb-3">Category breakdown — {selectedFy.label}</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={catExpenses.slice(0, 12).map(r => ({ name: r.category.length > 16 ? r.category.slice(0, 14) + '…' : r.category, amount: r.amount }))}
                  margin={{ top: 4, right: 8, bottom: 40, left: 8 }}
                >
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `₹${(Number(v)/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: any) => [formatINR(Number(v)), 'Amount']} />
                  <Bar dataKey="amount" fill="#7c3aed" radius={[3, 3, 0, 0]} maxBarSize={32} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {loadingCat ? (
            <div className="h-40 animate-pulse rounded-[var(--ds-radius)]" style={{ background: 'var(--ink-100)' }} />
          ) : !catExpenses?.length ? (
            <div className="surface !p-10 text-center text-[13px]" style={{ color: 'var(--ink-400)' }}>No expenses recorded for {selectedFy.label}</div>
          ) : (
            <div className="surface !p-0 overflow-hidden">
              <div className="px-4 py-3 border-b hairline flex items-center justify-between">
                <h3 className="font-semibold text-sm">Expenses by category</h3>
                <button onClick={handleExcelCategory}
                  className="flex items-center gap-1.5 text-sm hover:opacity-80" style={{ color: 'var(--brand-700)' }}>
                  <Download size={14} /> Export Excel
                </button>
              </div>
              <table className="w-full text-sm">
                <thead className="border-b hairline" style={{ background: 'var(--ink-50)' }}>
                  <tr>
                    <th className="text-left px-4 py-2.5 font-semibold" style={{ color: 'var(--ink-600)' }}>Category</th>
                    <th className="text-left px-4 py-2.5 font-semibold" style={{ color: 'var(--ink-600)' }}>Type</th>
                    <th className="text-right px-4 py-2.5 font-semibold" style={{ color: 'var(--ink-600)' }}>Amount</th>
                    <th className="text-right px-4 py-2.5 font-semibold" style={{ color: 'var(--ink-600)' }}>% of total</th>
                  </tr>
                </thead>
                <tbody className="divide-rows">
                  {catExpenses.map((r, i) => (
                    <tr key={r.category}
                      onClick={() => setDrillCategory({ id: r.categoryId, name: r.category })}
                      className={`cursor-pointer hover:bg-[var(--brand-50)] transition-colors ${i % 2 === 1 ? 'bg-slate-50/50' : ''}`}>
                      <td className="px-4 py-2.5 font-medium">{r.category}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          r.budget_type === 'Corpus' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'
                        }`}>{r.budget_type}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold">{formatINR(r.amount)}</td>
                      <td className="px-4 py-2.5 text-right" style={{ color: 'var(--ink-500)' }}>
                        {totalExpenses > 0 ? `${((r.amount / totalExpenses) * 100).toFixed(1)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 hairline" style={{ background: 'var(--ink-50)' }}>
                  <tr>
                    <td className="px-4 py-3 font-bold" colSpan={2}>Total</td>
                    <td className="px-4 py-3 text-right font-bold">{formatINR(totalExpenses)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* By vendor */}
      {subTab === 'vendor' && (
        loadingVendor ? (
          <div className="h-40 animate-pulse rounded-[var(--ds-radius)]" style={{ background: 'var(--ink-100)' }} />
        ) : !vendorExpenses?.length ? (
          <div className="surface !p-10 text-center text-[13px]" style={{ color: 'var(--ink-400)' }}>No expenses for {selectedFy.label}</div>
        ) : (
          <div className="surface !p-0 overflow-hidden">
            <div className="px-4 py-3 border-b hairline flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-sm">Payments by vendor / payee</h3>
                {tdsVendors > 0 && (
                  <p className="text-xs text-amber-600 mt-0.5">{tdsVendors} vendor(s) exceed ₹30,000 — TDS may be applicable</p>
                )}
              </div>
              <button onClick={handleExcelVendor}
                className="flex items-center gap-1.5 text-sm hover:opacity-80" style={{ color: 'var(--brand-700)' }}>
                <Download size={14} /> Export Excel
              </button>
            </div>
            <table className="w-full text-sm">
              <thead className="border-b hairline" style={{ background: 'var(--ink-50)' }}>
                <tr>
                  <th className="text-left px-4 py-2.5 font-semibold" style={{ color: 'var(--ink-600)' }}>Vendor / Payee</th>
                  <th className="text-right px-4 py-2.5 font-semibold" style={{ color: 'var(--ink-600)' }}>Amount paid</th>
                  <th className="text-left px-4 py-2.5 font-semibold" style={{ color: 'var(--ink-600)' }}>TDS</th>
                </tr>
              </thead>
              <tbody className="divide-rows">
                {vendorExpenses.map((r, i) => (
                  <tr key={r.vendor} className={i % 2 === 1 ? 'bg-slate-50/50' : ''}>
                    <td className="px-4 py-2.5 font-medium">{r.vendor}</td>
                    <td className="px-4 py-2.5 text-right font-semibold">{formatINR(r.amount)}</td>
                    <td className="px-4 py-2.5">
                      {r.tdsRequired
                        ? <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">TDS required</span>
                        : <span className="text-xs" style={{ color: 'var(--ink-300)' }}>—</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 hairline" style={{ background: 'var(--ink-50)' }}>
                <tr>
                  <td className="px-4 py-3 font-bold">Total</td>
                  <td className="px-4 py-3 text-right font-bold">{formatINR(vendorExpenses.reduce((s,r) => s + r.amount, 0))}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )
      )}

      {/* Monthly trend */}
      {subTab === 'trend' && (
        loadingTrend ? (
          <div className="h-64 animate-pulse rounded-[var(--ds-radius)]" style={{ background: 'var(--ink-100)' }} />
        ) : (
          <div className="surface !p-4">
            <h3 className="font-semibold text-sm mb-3">Monthly expenditure — {selectedFy.label}</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={monthlyTrend} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `₹${(Number(v)/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: any) => [formatINR(Number(v)), 'Expenses']} />
                <Bar dataKey="amount" fill="#f43f5e" radius={[3, 3, 0, 0]} maxBarSize={32} name="Expenses" />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-3 text-xs text-right" style={{ color: 'var(--ink-400)' }}>
              Total: {formatINR((monthlyTrend ?? []).reduce((s, r) => s + r.amount, 0))}
            </div>
          </div>
        )
      )}

      {/* TDS Register */}
      {subTab === 'tds' && (
        loadingTds ? (
          <div className="h-40 animate-pulse rounded-[var(--ds-radius)]" style={{ background: 'var(--ink-100)' }} />
        ) : !tdsRows?.length ? (
          <div className="surface !p-10 text-center text-[13px]" style={{ color: 'var(--ink-400)' }}>
            No expense line items found for {selectedFy.label}
          </div>
        ) : (
          <div className="surface !p-0 overflow-hidden">
            <div className="px-4 py-3 border-b hairline flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-sm">TDS Compliance Register — {selectedFy.label}</h3>
                <p className="text-xs mt-0.5" style={{ color: 'var(--ink-500)' }}>
                  Threshold: ₹30,000 per vendor · TDS rate: 10% on amount above threshold
                </p>
              </div>
              <button
                onClick={() => {
                  const wb = XLSX.utils.book_new()
                  const rows: any[][] = [
                    [`TDS Compliance Register — ${selectedFy.label}`],
                    [`The Lilac Apartment Association · Generated ${formatDateDMY(new Date().toISOString())}`],
                    [],
                    ['Vendor / Payee', 'PAN', 'Total Paid (₹)', 'TDS Threshold (₹)', 'Amount Over Threshold (₹)', 'TDS @ 10% Due (₹)', 'Status'],
                    ...(tdsRows ?? []).map(r => [
                      r.name, r.pan, r.total, 30000, r.overThreshold, r.tdsDue, r.status,
                    ]),
                    [],
                    ['TOTAL', '', (tdsRows ?? []).reduce((s, r) => s + r.total, 0), '', (tdsRows ?? []).reduce((s, r) => s + r.overThreshold, 0), (tdsRows ?? []).reduce((s, r) => s + r.tdsDue, 0), ''],
                  ]
                  const ws = XLSX.utils.aoa_to_sheet(rows)
                  ws['!cols'] = [24, 14, 14, 14, 18, 14, 16].map(w => ({ wch: w }))
                  XLSX.utils.book_append_sheet(wb, ws, 'TDS Register')
                  XLSX.writeFile(wb, `TDS_Register_${selectedFy.label.replace(/\s/g, '_')}.xlsx`)
                }}
                className="flex items-center gap-1.5 text-sm hover:opacity-80"
                style={{ color: 'var(--brand-700)' }}
              >
                <Download size={14} /> Export Excel
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b hairline" style={{ background: 'var(--ink-50)' }}>
                  <tr>
                    <th className="text-left px-4 py-2.5 font-semibold" style={{ color: 'var(--ink-600)' }}>Vendor / Payee</th>
                    <th className="text-left px-4 py-2.5 font-semibold" style={{ color: 'var(--ink-600)' }}>PAN</th>
                    <th className="text-right px-4 py-2.5 font-semibold" style={{ color: 'var(--ink-600)' }}>Total Paid</th>
                    <th className="text-right px-4 py-2.5 font-semibold" style={{ color: 'var(--ink-600)' }}>Over Threshold</th>
                    <th className="text-right px-4 py-2.5 font-semibold" style={{ color: 'var(--ink-600)' }}>TDS @ 10%</th>
                    <th className="text-left px-4 py-2.5 font-semibold" style={{ color: 'var(--ink-600)' }}>Status</th>
                  </tr>
                </thead>
                <tbody className="divide-rows">
                  {(tdsRows ?? []).map((r, i) => (
                    <tr key={r.name + i} className={i % 2 === 1 ? 'bg-slate-50/50' : ''}>
                      <td className="px-4 py-2.5 font-medium">{r.name}</td>
                      <td className="px-4 py-2.5 font-mono text-xs" style={{ color: r.pan === '—' ? 'var(--ink-300)' : 'var(--ink-700)' }}>{r.pan}</td>
                      <td className="px-4 py-2.5 text-right font-semibold">{formatINR(r.total)}</td>
                      <td className="px-4 py-2.5 text-right" style={{ color: r.overThreshold > 0 ? 'var(--ink-800)' : 'var(--ink-300)' }}>
                        {r.overThreshold > 0 ? formatINR(r.overThreshold) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold" style={{ color: r.tdsDue > 0 ? '#d97706' : 'var(--ink-300)' }}>
                        {r.tdsDue > 0 ? formatINR(r.tdsDue) : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        {r.status === 'Due'
                          ? <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">TDS Due</span>
                          : <span className="text-xs" style={{ color: 'var(--ink-300)' }}>Below threshold</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 hairline" style={{ background: 'var(--ink-50)' }}>
                  <tr>
                    <td className="px-4 py-3 font-bold" colSpan={2}>Total</td>
                    <td className="px-4 py-3 text-right font-bold">{formatINR((tdsRows ?? []).reduce((s, r) => s + r.total, 0))}</td>
                    <td className="px-4 py-3 text-right font-bold">{formatINR((tdsRows ?? []).reduce((s, r) => s + r.overThreshold, 0))}</td>
                    <td className="px-4 py-3 text-right font-bold text-amber-600">{formatINR((tdsRows ?? []).reduce((s, r) => s + r.tdsDue, 0))}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )
      )}

      {drillCategory && (
        <CategoryDrillDownDialog
          category={drillCategory}
          fy={selectedFy}
          fund={fund}
          onClose={() => setDrillCategory(null)}
        />
      )}
    </div>
  )
}

function CategoryDrillDownDialog({ category, fy, fund, onClose }: {
  category: { id: string | null; name: string }
  fy: { start: string; end: string; label: string }
  fund: ExpFund
  onClose: () => void
}) {
  const { data: rows, isLoading } = useQuery({
    queryKey: ['category-drilldown', category.id, category.name, fy.start, fy.end, fund],
    queryFn: async () => {
      // Match the exp-by-category grouping: a header with line items is broken down by
      // each line's own category (falling back to the header's), not the header's category.
      let q = applyReportableFilter(supabase
        .from('expenses')
        .select(`
          id, expense_date, amount, description, payee_type, payee_name_raw, voucher_no, category_id, corpus_plan_id,
          vendor:vendor_id(name),
          staff_member:staff_id(name)
        `))
        .gte('expense_date', fy.start)
        .lte('expense_date', fy.end)
      if (fund === 'corpus') q = q.not('corpus_plan_id', 'is', null)
      if (fund === 'maintenance') q = q.is('corpus_plan_id', null)
      const { data: headers } = await q.order('expense_date', { ascending: false })

      const headerIds = (headers ?? []).map((h: any) => h.id)
      const { data: lineItems } = headerIds.length
        ? await supabase
            .from('expense_line_items')
            .select('id, expense_id, amount, description, category_id, payee_type, payee_name_raw, utility_units, utility_rate, unit_label, vendor:vendor_id(name), staff_member:staff_id(name)')
            .in('expense_id', headerIds)
        : { data: [] as any[] }
      const linesByHeader = new Map<string, any[]>()
      for (const li of lineItems ?? []) {
        if (!linesByHeader.has(li.expense_id)) linesByHeader.set(li.expense_id, [])
        linesByHeader.get(li.expense_id)!.push(li)
      }

      const matches = (catId: string | null) => category.id ? catId === category.id : catId === null
      const qtyOf = (units: number | null, unitLabel: string | null) =>
        units != null ? `${Number(units).toLocaleString('en-IN')} ${unitLabel || 'units'}` : ''

      const out: { id: string; date: string; payee: string; description: string; qty: string; amount: number }[] = []
      for (const h of headers ?? []) {
        const lines = linesByHeader.get((h as any).id) ?? []
        if (lines.length === 0) {
          if (matches((h as any).category_id ?? null)) {
            out.push({
              id: (h as any).id,
              date: (h as any).expense_date,
              payee: resolvePayeeCandidate(h as any) ?? 'Cash / Misc',
              description: (h as any).description ?? '',
              qty: '',
              amount: (h as any).amount ?? 0,
            })
          }
        } else {
          for (const li of lines) {
            if (matches(li.category_id ?? (h as any).category_id ?? null)) {
              out.push({
                id: li.id,
                date: (h as any).expense_date,
                payee: resolvePayeeCandidate(li) ?? resolvePayeeCandidate(h as any) ?? 'Cash / Misc',
                description: li.description ?? '',
                qty: qtyOf(li.utility_units, li.unit_label),
                amount: li.amount ?? 0,
              })
            }
          }
        }
      }
      return out
    },
  })

  const total = (rows ?? []).reduce((s, r) => s + (r.amount ?? 0), 0)

  function handleExcel() {
    if (!rows?.length) return
    const wb = XLSX.utils.book_new()
    const sheetRows: any[][] = [
      [`${category.name} — ${fy.label}`], [],
      ['Date', 'Payee', 'Description', 'Qty', 'Amount'],
      ...rows.map(r => [formatDateDMY(r.date), r.payee, r.description, r.qty, r.amount]),
      [], ['TOTAL', '', '', '', total],
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetRows), category.name.slice(0, 31))
    XLSX.writeFile(wb, `${category.name.replace(/[^a-zA-Z0-9]/g, '_')}_${fy.label.replace(/\s/g, '_')}.xlsx`)
  }

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-[520px] lg:max-w-[720px] max-h-[85vh] rounded-2xl p-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-5 pt-5 pb-3 border-b hairline">
          <DialogTitle>{category.name} — {fy.label}</DialogTitle>
        </DialogHeader>
        <div className="px-5 py-3 flex items-center justify-between border-b hairline" style={{ background: 'var(--ink-50)' }}>
          <span className="text-sm" style={{ color: 'var(--ink-500)' }}>
            {rows?.length ?? 0} expense{rows?.length === 1 ? '' : 's'} · {formatINR(total)}
          </span>
          <button onClick={handleExcel} disabled={!rows?.length}
            className="flex items-center gap-1.5 text-sm hover:opacity-80 disabled:opacity-40" style={{ color: 'var(--brand-700)' }}>
            <Download size={14} /> Export Excel
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {isLoading ? (
            <div className="p-5"><div className="h-32 animate-pulse rounded-[var(--ds-radius)]" style={{ background: 'var(--ink-100)' }} /></div>
          ) : !rows?.length ? (
            <div className="px-5 py-10 text-center text-sm" style={{ color: 'var(--ink-400)' }}>No expenses recorded</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b hairline" style={{ background: 'var(--ink-50)' }}>
                <tr>
                  <th className="text-left px-4 py-2 font-semibold" style={{ color: 'var(--ink-600)' }}>Date</th>
                  <th className="text-left px-4 py-2 font-semibold" style={{ color: 'var(--ink-600)' }}>Payee</th>
                  <th className="text-left px-4 py-2 font-semibold" style={{ color: 'var(--ink-600)' }}>Description</th>
                  <th className="text-right px-4 py-2 font-semibold" style={{ color: 'var(--ink-600)' }}>Amount</th>
                </tr>
              </thead>
              <tbody className="divide-rows">
                {rows.map((r, i) => (
                  <tr key={r.id} className={i % 2 === 1 ? 'bg-slate-50/50' : ''}>
                    <td className="px-4 py-2.5" style={{ color: 'var(--ink-600)' }}>{formatDateDMY(r.date)}</td>
                    <td className="px-4 py-2.5 font-medium">{r.payee}</td>
                    <td className="px-4 py-2.5 text-xs max-w-[220px] truncate" style={{ color: 'var(--ink-500)' }}>
                      {r.description}
                      {r.qty && <span className="ml-1.5" style={{ color: 'var(--ink-400)' }}>· {r.qty}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold">{formatINR(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── UTILITY TAB ──────────────────────────────────────────────

const MAX_VISIBLE_UTILITY_TABS = 7

function UtilityTab() {
  const fy = getCurrentFy()
  const [fyYear, setFyYear]       = useState(fy.year)
  const [activeCatId, setActive]  = useState<string | null>(null)
  const [moreOpen, setMoreOpen]   = useState(false)

  const { data: utilityCats = [] } = useQuery({
    queryKey: ['utility-categories'],
    queryFn: async () => {
      const { data } = await supabase
        .from('expense_categories')
        .select('id, name, unit_label')
        .eq('is_utility', true)
        .order('sort_order')
      return (data ?? []) as { id: string; name: string; unit_label: string | null }[]
    },
  })

  const displayCat = utilityCats.find(c => c.id === activeCatId) ?? utilityCats[0]

  // Keep the active category's tab visible even if it's past the cutoff — swap it in for
  // the last visible slot so selecting from "More" doesn't hide the thing you just picked.
  const activeInOverflow = displayCat && utilityCats.indexOf(displayCat) >= MAX_VISIBLE_UTILITY_TABS
  const visibleCats = activeInOverflow
    ? [...utilityCats.slice(0, MAX_VISIBLE_UTILITY_TABS - 1), displayCat]
    : utilityCats.slice(0, MAX_VISIBLE_UTILITY_TABS)
  const overflowCats = utilityCats.filter(c => !visibleCats.includes(c))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 text-sm overflow-x-auto min-w-0 max-w-full">
          {visibleCats.map(cat => (
            <button key={cat.id} onClick={() => setActive(cat.id)}
              className={`px-3 py-1 rounded-md font-medium transition-colors shrink-0 whitespace-nowrap
                ${displayCat?.id === cat.id ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
              {cat.name}
            </button>
          ))}
          {overflowCats.length > 0 && (
            <Popover open={moreOpen} onOpenChange={setMoreOpen}>
              <PopoverTrigger asChild>
                <button
                  className="flex items-center gap-1 px-2 py-1 rounded-md font-medium transition-colors text-slate-500 hover:text-slate-700 shrink-0">
                  <ChevronDown size={14} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-48 p-1">
                <div className="flex flex-col">
                  {overflowCats.map(cat => (
                    <button key={cat.id}
                      onClick={() => { setActive(cat.id); setMoreOpen(false) }}
                      className={`text-left px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors
                        ${displayCat?.id === cat.id ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`}>
                      {cat.name}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
        <select value={fyYear} onChange={e => setFyYear(Number(e.target.value))}
          className="ds-field">
          {FISCAL_YEARS.map(f => <option key={f.year} value={f.year}>{f.label}</option>)}
        </select>
      </div>

      {displayCat
        ? <UtilityReport catId={displayCat.id} catName={displayCat.name} unitLabel={displayCat.unit_label} fyYear={fyYear} />
        : <div className="h-48 animate-pulse rounded-[var(--ds-radius)]" style={{ background: 'var(--ink-100)' }} />
      }
    </div>
  )
}

function UtilityReport({ catId, catName, unitLabel: unitLabelProp, fyYear }: {
  catId: string; catName: string; unitLabel: string | null; fyYear: number
}) {
  const fy = getFyRange(fyYear)
  const unitLabel = unitLabelProp ?? 'units'

  const { data: items, isLoading } = useQuery({
    queryKey: ['utility-report', catId, fyYear],
    queryFn: async () => {
      // Bucket by payment date (expense_date), not per-line paid_date — matches the
      // cash-basis logic used by every other report (Cashbook, Expenditure). A line item
      // paid on a different date than the header still shows up in the FY the header
      // expense was recorded in; paid_date is used only for the row's own date column.
      const { data: headers } = await applyReportableFilter(supabase
        .from('expenses')
        .select('id, expense_date'))
        .gte('expense_date', fy.start)
        .lte('expense_date', fy.end)

      const headerIds = (headers ?? []).map(h => h.id)
      if (headerIds.length === 0) return []
      const expenseDateById = new Map((headers ?? []).map(h => [h.id, h.expense_date]))

      const { data } = await supabase
        .from('expense_line_items')
        .select('id, expense_id, cost_center, utility_units, utility_rate, amount, paid_date, description')
        .eq('category_id', catId)
        .in('expense_id', headerIds)

      return (data ?? [])
        .map(item => ({ ...item, expense_date: expenseDateById.get(item.expense_id) ?? null }))
        .sort((a, b) => (a.expense_date ?? '').localeCompare(b.expense_date ?? ''))
    },
  })

  const blocks = useMemo(() =>
    [...new Set((items ?? []).map((i: any) => i.cost_center as string))].filter(Boolean).sort()
  , [items])

  const hasUnits   = (items ?? []).some((i: any) => i.utility_units != null)
  const totalUnits = useMemo(() => (items ?? []).reduce((s, i: any) => s + (Number(i.utility_units) || 0), 0), [items])
  const totalAmt   = useMemo(() => (items ?? []).reduce((s, i: any) => s + (Number(i.amount) || 0), 0), [items])

  const chartData = useMemo(() => {
    const map = new Map<string, Record<string, number>>()
    for (const item of items ?? []) {
      if (!item.expense_date) continue
      const d    = new Date((item as any).expense_date)
      const mon  = `${MONTHS_SHORT[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`
      if (!map.has(mon)) map.set(mon, {})
      const row  = map.get(mon)!
      const blk  = (item as any).cost_center ?? 'Other'
      row[blk]   = (row[blk] ?? 0) + (Number((item as any).amount) || 0)
    }
    return Array.from(map.entries()).map(([month, v]) => ({ month, ...v }))
  }, [items])

  function handleExcel() {
    const wb = XLSX.utils.book_new()
    const rows: any[][] = [
      [`${catName} — ${fy.label}`], [],
      hasUnits
        ? ['Date', 'Block', unitLabel, 'Rate', 'Amount', 'Notes']
        : ['Date', 'Block', 'Amount', 'Notes'],
      ...(items ?? []).map((i: any) =>
        hasUnits
          ? [formatDateDMY(i.paid_date ?? i.expense_date), i.cost_center, i.utility_units ?? '', i.utility_rate ?? '', i.amount, i.description ?? '']
          : [formatDateDMY(i.paid_date ?? i.expense_date), i.cost_center, i.amount, i.description ?? '']
      ),
      [], hasUnits
        ? ['TOTAL', '', totalUnits, '', totalAmt, '']
        : ['TOTAL', '', totalAmt, ''],
    ]
    const ws = XLSX.utils.aoa_to_sheet(rows)
    XLSX.utils.book_append_sheet(wb, ws, catName.slice(0, 31))
    XLSX.writeFile(wb, `${catName.replace(/[^a-zA-Z0-9]/g, '_')}_${fy.label.replace(/\s/g, '_')}.xlsx`)
  }

  if (isLoading) return <div className="h-64 animate-pulse rounded-[var(--ds-radius)]" style={{ background: 'var(--ink-100)' }} />

  if (!items?.length) return (
    <div className="surface !p-10 text-center">
      <Zap size={32} className="mx-auto mb-3" style={{ color: 'var(--ink-200)' }} />
      <p className="text-sm" style={{ color: 'var(--ink-400)' }}>No {catName} line items recorded for {fy.label}.</p>
      <p className="text-xs mt-1" style={{ color: 'var(--ink-300)' }}>Add expenses in Expenses with category "{catName}" and line items.</p>
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      {/* Summary cards */}
      <div className={`grid grid-cols-2 gap-3 ${hasUnits ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
        <div className="surface !p-4" style={{ background: 'var(--brand-50)' }}>
          <p className="text-[12px] mb-1" style={{ color: 'var(--ink-500)' }}>Total cost</p>
          <p className="text-xl font-bold text-violet-700">{formatINR(totalAmt)}</p>
        </div>
        {hasUnits && (
          <>
            <div className="surface !p-4" style={{ background: 'var(--info-bg)' }}>
              <p className="text-[12px] mb-1" style={{ color: 'var(--ink-500)' }}>Total {unitLabel}</p>
              <p className="text-xl font-bold text-blue-700">{totalUnits.toLocaleString('en-IN')}</p>
            </div>
            <div className="surface !p-4" style={{ background: 'var(--ink-50)' }}>
              <p className="text-[12px] mb-1" style={{ color: 'var(--ink-500)' }}>Avg rate / {unitLabel}</p>
              <p className="text-xl font-bold" style={{ color: 'var(--ink-700)' }}>
                {totalUnits > 0 ? `₹${(totalAmt / totalUnits).toFixed(2)}` : '—'}
              </p>
            </div>
          </>
        )}
        <div className="surface !p-4" style={{ background: 'var(--ink-50)' }}>
          <p className="text-[12px] mb-1" style={{ color: 'var(--ink-500)' }}>Areas tracked</p>
          <p className="text-xl font-bold" style={{ color: 'var(--ink-700)' }}>{blocks.length}</p>
        </div>
      </div>

      {/* Monthly amount by block — bar chart */}
      {chartData.length > 0 && blocks.length > 0 && (
        <div className="surface !p-4">
          <h3 className="font-semibold text-sm mb-3">Monthly cost by area — {fy.label}</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `₹${(Number(v)/1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: any, name: string) => [formatINR(Number(v)), name]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {blocks.map(block => (
                <Bar key={block} dataKey={block} stackId="a"
                  fill={BLOCK_COLORS[block] ?? '#94a3b8'} name={block} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Detail table */}
      <div className="surface !p-0 overflow-hidden">
        <div className="px-4 py-3 border-b hairline flex items-center justify-between">
          <h3 className="font-semibold text-sm">Line-item detail</h3>
          <button onClick={handleExcel}
            className="flex items-center gap-1.5 text-sm hover:opacity-80" style={{ color: 'var(--brand-700)' }}>
            <Download size={14} /> Export Excel
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b hairline" style={{ background: 'var(--ink-50)' }}>
              <tr>
                <th className="text-left px-4 py-2 font-semibold" style={{ color: 'var(--ink-600)' }}>Date</th>
                <th className="text-left px-4 py-2 font-semibold" style={{ color: 'var(--ink-600)' }}>Area / Block</th>
                {hasUnits && <>
                  <th className="text-right px-4 py-2 font-semibold" style={{ color: 'var(--ink-600)' }}>{unitLabel}</th>
                  <th className="text-right px-4 py-2 font-semibold" style={{ color: 'var(--ink-600)' }}>Rate</th>
                </>}
                <th className="text-right px-4 py-2 font-semibold" style={{ color: 'var(--ink-600)' }}>Amount</th>
                <th className="text-left px-4 py-2 font-semibold" style={{ color: 'var(--ink-600)' }}>Notes</th>
              </tr>
            </thead>
            <tbody className="divide-rows">
              {(items ?? []).map((item: any, i: number) => (
                <tr key={item.id} className={i % 2 === 1 ? 'bg-slate-50/50' : ''}>
                  <td className="px-4 py-2.5" style={{ color: 'var(--ink-600)' }}>{formatDateDMY(item.paid_date ?? item.expense_date)}</td>
                  <td className="px-4 py-2.5 font-medium">{item.cost_center ?? '—'}</td>
                  {hasUnits && <>
                    <td className="px-4 py-2.5 text-right">{item.utility_units != null ? Number(item.utility_units).toLocaleString('en-IN') : '—'}</td>
                    <td className="px-4 py-2.5 text-right" style={{ color: 'var(--ink-500)' }}>{item.utility_rate != null ? `₹${item.utility_rate}` : '—'}</td>
                  </>}
                  <td className="px-4 py-2.5 text-right font-semibold">{formatINR(item.amount)}</td>
                  <td className="px-4 py-2.5 text-xs max-w-xs truncate" style={{ color: 'var(--ink-500)' }}>{item.description ?? ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 hairline" style={{ background: 'var(--ink-50)' }}>
              <tr>
                <td className="px-4 py-3 font-bold" colSpan={hasUnits ? 2 : 2}>Total</td>
                {hasUnits && <>
                  <td className="px-4 py-3 text-right font-bold">{totalUnits.toLocaleString('en-IN')}</td>
                  <td />
                </>}
                <td className="px-4 py-3 text-right font-bold">{formatINR(totalAmt)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── CASHBOOK TAB ──────────────────────────────────────────────

interface CrCategoryRow { category: string; amount: number }
interface DrItemRow { date: string | null; label: string; qty: string; amount: number }
interface DrCategoryGroup { category: string; total: number; items: DrItemRow[] }

interface PayeeCandidate {
  payee_type: string
  payee_name_raw: string | null
  vendor: { name: string } | null
  staff_member: { name: string } | null
}

function resolvePayeeCandidate(e: PayeeCandidate): string | null {
  if (e.payee_type === 'Staff')  return e.staff_member?.name ?? e.payee_name_raw ?? null
  if (e.payee_type === 'Vendor') return e.vendor?.name ?? e.payee_name_raw ?? null
  return e.payee_name_raw ?? null
}

function CashbookTab() {
  const [month, setMonth] = useState(currentFiscalLabel)
  const { start, end, prevEnd } = monthLabelToRange(month)
  const [generating, setGenerating] = useState(false)
  const asOfDate = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

  const { data: openingBalance = 0 } = useQuery({
    queryKey: ['cashbook-opening', prevEnd],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_bank_balance_as_of', { p_date: prevEnd })
      if (error) throw error
      return (data as number) ?? 0
    },
  })

  const { data: closingBalance = 0 } = useQuery({
    queryKey: ['cashbook-closing', end],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_bank_balance_as_of', { p_date: end })
      if (error) throw error
      return (data as number) ?? 0
    },
  })

  const { data: crSplitup } = useQuery({
    queryKey: ['cashbook-cr', start, end],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('category, amount')
        .eq('cr_dr', 'CR')
        .neq('row_type', 'VOIDED')
        .gte('value_date', start)
        .lte('value_date', end)
      const grouped = new Map<string, number>()
      for (const t of data ?? []) {
        const cat = (t as any).category ?? 'Other'
        grouped.set(cat, (grouped.get(cat) ?? 0) + ((t as any).amount ?? 0))
      }
      return Array.from(grouped.entries())
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount) as CrCategoryRow[]
    },
  })

  const { data: drSplitup } = useQuery({
    queryKey: ['cashbook-dr', start, end],
    queryFn: async () => {
      const { data: headers } = await applyReportableFilter(supabase
        .from('expenses')
        .select(`
          id, amount, description, expense_date, payee_type, payee_name_raw,
          category:category_id(name),
          vendor:vendor_id(name),
          staff_member:staff_id(name)
        `))
        .gte('expense_date', start)
        .lte('expense_date', end)

      const headerRows = (headers ?? []) as any[]
      const headerIds = headerRows.map(h => h.id)

      const { data: lineItems } = headerIds.length
        ? await supabase
            .from('expense_line_items')
            .select(`
              expense_id, amount, description, paid_date, payee_type, payee_name_raw,
              utility_units, utility_rate, unit_label,
              category:category_id(name),
              vendor:vendor_id(name),
              staff_member:staff_id(name)
            `)
            .in('expense_id', headerIds)
        : { data: [] }

      const lineRows = (lineItems ?? []) as any[]
      const linesByHeader = new Map<string, any[]>()
      for (const li of lineRows) {
        if (!linesByHeader.has(li.expense_id)) linesByHeader.set(li.expense_id, [])
        linesByHeader.get(li.expense_id)!.push(li)
      }

      const grouped = new Map<string, DrItemRow[]>()
      function addItem(category: string, item: DrItemRow) {
        if (!grouped.has(category)) grouped.set(category, [])
        grouped.get(category)!.push(item)
      }
      const qtyOf = (units: number | null, unitLabel: string | null, rate: number | null) =>
        units != null && rate != null
          ? `${Number(units).toLocaleString('en-IN')} ${unitLabel || 'units'} × ${formatINR(rate)}`
          : ''

      for (const header of headerRows) {
        const lines = linesByHeader.get(header.id) ?? []

        if (lines.length === 0) {
          // No line items recorded for this expense — fall back to header-level category/amount
          const cat = header.category?.name ?? 'Uncategorised'
          const payee = resolvePayeeCandidate(header)
          addItem(cat, payee
            ? { date: header.expense_date, label: payee, qty: '', amount: header.amount ?? 0 }
            : { date: header.expense_date, label: header.description, qty: '', amount: header.amount ?? 0 })
          continue
        }

        // A voucher whose line items all resolve to the SAME payee is a pass-through
        // reimbursement covering many purchases — itemize by description. A voucher whose
        // lines resolve to DIFFERENT payees (or has only one line) means each line is a
        // genuinely distinct payment — itemize by payee name instead. Every line always
        // carries its real payment date, for audit/verification against the bank statement.
        const linePayees = lines.map(l => resolvePayeeCandidate(l) ?? resolvePayeeCandidate(header))
        const distinctPayees = new Set(linePayees.filter((p): p is string => p != null))
        const isPassThrough = lines.length > 1 && distinctPayees.size === 1

        lines.forEach((line, i) => {
          const cat = line.category?.name ?? 'Uncategorised'
          addItem(cat, {
            date: line.paid_date ?? header.expense_date,
            label: isPassThrough ? line.description : (linePayees[i] ?? 'Cash / Misc'),
            qty: qtyOf(line.utility_units, line.unit_label, line.utility_rate),
            amount: line.amount ?? 0,
          })
        })
      }

      return Array.from(grouped.entries())
        .map(([category, items]) => ({
          category,
          total: items.reduce((s, it) => s + it.amount, 0),
          items: items.sort((a, b) => {
            if (a.date && b.date) return a.date.localeCompare(b.date)
            if (a.date && !b.date) return -1
            if (!a.date && b.date) return 1
            return b.amount - a.amount
          }),
        }))
        .sort((a, b) => b.total - a.total) as DrCategoryGroup[]
    },
  })

  const { data: duesRows } = useQuery({
    queryKey: ['cashbook-dues'],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_dues_tracker')
        .select('pending, arrears_maintenance, total_outstanding')
      return (data ?? []) as { pending: number; arrears_maintenance: number; total_outstanding: number }[]
    },
  })

  const totalReceipts = (crSplitup ?? []).reduce((s, r) => s + r.amount, 0)
  const totalPayments = (drSplitup ?? []).reduce((s, r) => s + r.total, 0)

  const isLoading = crSplitup === undefined || drSplitup === undefined || duesRows === undefined

  const pendingRows     = (duesRows ?? []).filter(r => r.pending > 0)
  const arrearsRows     = (duesRows ?? []).filter(r => r.arrears_maintenance > 0)
  const outstandingRows = (duesRows ?? []).filter(r => r.total_outstanding > 0)
  const pendingTotal     = pendingRows.reduce((s, r) => s + r.pending, 0)
  const arrearsTotal     = arrearsRows.reduce((s, r) => s + r.arrears_maintenance, 0)
  const outstandingTotal = outstandingRows.reduce((s, r) => s + r.total_outstanding, 0)

  function handleExcelExport() {
    const wb = XLSX.utils.book_new()
    const rows: any[][] = [
      [`Lilac Apartment Association — Cash Book Statement — ${month}`], [],
      ['Opening Balance', openingBalance],
      [],
      ['RECEIPTS'],
      ...(crSplitup ?? []).map(r => [`  ${r.category}`, r.amount]),
      ['  Total Receipts', totalReceipts],
      [],
      ['PAYMENTS'],
      ...(drSplitup ?? []).flatMap(group => [
        [`  ${group.category}`, group.total],
        ...group.items.map(item => [
          [
            '   ',
            item.date ? `${formatShortDate(item.date)}  ${item.label}` : item.label,
            item.qty ? `(${item.qty})` : '',
          ].filter(Boolean).join(' '),
          item.amount,
        ]),
      ]),
      ['  Total Payments', totalPayments],
      [],
      ['Closing Balance', closingBalance],
      [],
      [`PENDING DUES (as of ${asOfDate})`],
      ['  Current FY Pending', pendingTotal, `${pendingRows.length} flats`],
      ['  Arrears (prior years)', arrearsTotal, `${arrearsRows.length} flats`],
      ['  Total Outstanding', outstandingTotal, `${outstandingRows.length} flats`],
      [],
      ['Note: Opening/Closing balance is the audited bank position. Total Payments reflects only approved expenses that are Cash, Direct (owner-paid), or already reconciled with the bank; expenses still pending committee approval or not yet bank-reconciled are excluded from this total.'],
    ]
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [32, 14, 14].map(w => ({ wch: w }))
    XLSX.utils.book_append_sheet(wb, ws, 'Cashbook')
    XLSX.writeFile(wb, `Lilac_Cashbook_${month}.xlsx`)
  }

  async function handlePdf() {
    setGenerating(true)
    try {
      const [{ pdf }, { CashbookDoc }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/reports/AgmPdfDocs'),
      ])
      const generated = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      const blob = await pdf(
        <CashbookDoc
          month={month}
          openingBalance={openingBalance}
          closingBalance={closingBalance}
          receipts={crSplitup ?? []}
          payments={drSplitup ?? []}
          dues={[
            { label: 'Current FY Pending',    amount: pendingTotal,     flats: pendingRows.length },
            { label: 'Arrears (prior years)', amount: arrearsTotal,     flats: arrearsRows.length },
            { label: 'Total Outstanding',     amount: outstandingTotal, flats: outstandingRows.length },
          ]}
          generated={generated}
        />
      ).toBlob()
      triggerDownload(blob, `Lilac_Cashbook_${month}.pdf`)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <div className="flex items-center gap-3 flex-wrap">
        <select value={month} onChange={e => setMonth(e.target.value)} className="ds-field">
          {FISCAL_MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={handleExcelExport} disabled={isLoading}
            className="flex items-center gap-1.5 text-sm hover:opacity-80 disabled:opacity-50" style={{ color: 'var(--brand-700)' }}>
            <Download size={14} /> Export Excel
          </button>
          <button onClick={handlePdf} disabled={generating || isLoading}
            className="btn-primary flex items-center gap-2 py-2 px-4 text-sm disabled:opacity-50">
            {generating
              ? <><Loader2 size={14} className="animate-spin" /> Generating PDF…</>
              : <><FileText size={14} /> Download PDF</>
            }
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="surface !p-4" style={{ background: 'var(--ink-50)' }}>
          <p className="text-[12px] mb-1" style={{ color: 'var(--ink-500)' }}>Opening balance</p>
          <p className="text-xl font-bold" style={{ color: 'var(--ink-800)' }}>{formatINR(openingBalance)}</p>
        </div>
        <div className="surface !p-4" style={{ background: 'var(--ok-bg)' }}>
          <p className="text-[12px] mb-1" style={{ color: 'var(--ink-500)' }}>Total receipts (CR)</p>
          <p className="text-xl font-bold text-green-700">{formatINR(totalReceipts)}</p>
        </div>
        <div className="surface !p-4" style={{ background: 'var(--bad-bg)' }}>
          <p className="text-[12px] mb-1" style={{ color: 'var(--ink-500)' }}>Total payments (DR)</p>
          <p className="text-xl font-bold text-rose-600">{formatINR(totalPayments)}</p>
        </div>
        <div className="surface !p-4" style={{ background: 'var(--brand-50)' }}>
          <p className="text-[12px] mb-1" style={{ color: 'var(--ink-500)' }}>Closing balance</p>
          <p className="text-xl font-bold text-violet-700">{formatINR(closingBalance)}</p>
        </div>
      </div>

      {/* Receipts / Payments */}
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="surface !p-0 overflow-hidden flex-1">
          <div className="px-5 py-3 border-b hairline" style={{ background: 'var(--ink-50)' }}>
            <h3 className="font-semibold text-sm" style={{ color: 'var(--ink-700)' }}>RECEIPTS (CR)</h3>
          </div>
          {(crSplitup ?? []).length === 0 ? (
            <div className="px-5 py-6 text-center text-sm" style={{ color: 'var(--ink-400)' }}>No receipts for {month}</div>
          ) : (
            (crSplitup ?? []).map(r => (
              <div key={r.category} className="flex justify-between items-center px-5 py-3 border-b hairline text-sm">
                <span style={{ color: 'var(--ink-600)' }}>{r.category}</span>
                <span className="font-semibold" style={{ color: 'var(--ink-800)' }}>{formatINR(r.amount)}</span>
              </div>
            ))
          )}
          <div className="flex justify-between items-center px-5 py-3 text-sm font-bold border-t-2 hairline" style={{ background: 'var(--ok-bg)' }}>
            <span>Total Receipts</span>
            <span className="text-green-700">{formatINR(totalReceipts)}</span>
          </div>
        </div>

        <div className="surface !p-0 overflow-hidden flex-1">
          <div className="px-5 py-3 border-b hairline" style={{ background: 'var(--ink-50)' }}>
            <h3 className="font-semibold text-sm" style={{ color: 'var(--ink-700)' }}>PAYMENTS (DR)</h3>
          </div>
          {(drSplitup ?? []).length === 0 ? (
            <div className="px-5 py-6 text-center text-sm" style={{ color: 'var(--ink-400)' }}>No payments for {month}</div>
          ) : (
            (drSplitup ?? []).map(group => (
              <div key={group.category} className="border-b hairline">
                <div className="flex justify-between items-center px-5 py-2.5 text-sm font-semibold" style={{ color: 'var(--ink-700)' }}>
                  <span>{group.category}</span>
                  <span>{formatINR(group.total)}</span>
                </div>
                {group.items.map((item, i) => (
                  <div key={`${item.label}_${item.date ?? ''}_${i}`} className="flex flex-col gap-0.5 pl-8 pr-5 py-1.5 text-[13px]">
                    <div className="flex justify-between items-center">
                      <span style={{ color: 'var(--ink-500)' }}>
                        {item.date && <span className="mr-2" style={{ color: 'var(--ink-400)' }}>{formatShortDate(item.date)}</span>}
                        {item.label}
                      </span>
                      <span style={{ color: 'var(--ink-600)' }}>{formatINR(item.amount)}</span>
                    </div>
                    {item.qty && <span className="text-[11.5px]" style={{ color: 'var(--ink-400)' }}>{item.qty}</span>}
                  </div>
                ))}
              </div>
            ))
          )}
          <div className="flex justify-between items-center px-5 py-3 text-sm font-bold border-t-2 hairline" style={{ background: 'var(--bad-bg)' }}>
            <span>Total Payments</span>
            <span className="text-rose-700">{formatINR(totalPayments)}</span>
          </div>
        </div>
      </div>

      {/* Pending dues */}
      <div className="surface !p-0 overflow-hidden">
        <div className="px-5 py-3 border-b hairline flex items-center gap-2" style={{ background: 'var(--ink-50)' }}>
          <AlertTriangle size={15} className="text-amber-500" />
          <h3 className="font-semibold text-sm" style={{ color: 'var(--ink-700)' }}>PENDING DUES (as of {asOfDate})</h3>
        </div>
        <div className="flex justify-between items-center px-5 py-3 border-b hairline text-sm">
          <span style={{ color: 'var(--ink-600)' }}>Current FY Pending</span>
          <span className="font-semibold">
            {formatINR(pendingTotal)}{' '}
            <span className="font-normal text-xs" style={{ color: 'var(--ink-400)' }}>({pendingRows.length} flats)</span>
          </span>
        </div>
        <div className="flex justify-between items-center px-5 py-3 border-b hairline text-sm">
          <span style={{ color: 'var(--ink-600)' }}>Arrears (prior years)</span>
          <span className="font-semibold">
            {formatINR(arrearsTotal)}{' '}
            <span className="font-normal text-xs" style={{ color: 'var(--ink-400)' }}>({arrearsRows.length} flats)</span>
          </span>
        </div>
        <div className="flex justify-between items-center px-5 py-3 text-sm font-bold border-t-2 hairline" style={{ background: 'var(--bad-bg)' }}>
          <span>Total Outstanding</span>
          <span className="text-rose-700">
            {formatINR(outstandingTotal)}{' '}
            <span className="font-normal text-xs">({outstandingRows.length} flats)</span>
          </span>
        </div>
      </div>

      <p className="text-xs text-center" style={{ color: 'var(--ink-400)' }}>
        Opening/Closing balance is the audited bank position for {month}. Total Payments (above)
        reflects only approved expenses that are Cash, Direct (owner-paid), or already reconciled
        with the bank; expenses still pending committee approval or not yet bank-reconciled are
        excluded from this total.
      </p>
    </div>
  )
}

// ── R&P STATEMENT TAB ─────────────────────────────────────────

function RPStatementTab() {
  const fy = getCurrentFy()
  const [selectedFyYear, setSelectedFyYear] = useState(fy.year)
  const selectedFy = getFyRange(selectedFyYear)
  const [generating, setGenerating] = useState(false)

  const { data: openingBalance = 0 } = useQuery({
    queryKey: ['rp-opening', selectedFy.start],
    queryFn: async () => {
      // Opening = bank balance as of day BEFORE this FY starts
      const d = new Date(selectedFy.start)
      d.setDate(d.getDate() - 1)
      const priorDate = d.toISOString().slice(0, 10)
      const { data, error } = await supabase.rpc('fn_bank_balance_as_of', { p_date: priorDate })
      if (error) throw error
      return (data as number) ?? 0
    },
  })

  const { data: maintenanceCR } = useQuery({
    queryKey: ['rp-maintenance-cr', selectedFyYear],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('amount')
        .eq('cr_dr', 'CR')
        .eq('corpus', 'NO')
        .neq('row_type', 'VOIDED')
        .gte('value_date', selectedFy.start)
        .lte('value_date', selectedFy.end)
      return (data ?? []).reduce((s: number, r: any) => s + (r.amount ?? 0), 0)
    },
  })

  const { data: corpusCR } = useQuery({
    queryKey: ['rp-corpus-cr', selectedFyYear],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('amount')
        .eq('cr_dr', 'CR')
        .eq('corpus', 'YES')
        .neq('row_type', 'VOIDED')
        .gte('value_date', selectedFy.start)
        .lte('value_date', selectedFy.end)
      return (data ?? []).reduce((s: number, r: any) => s + (r.amount ?? 0), 0)
    },
  })

  const { data: fdInterest } = useQuery({
    queryKey: ['rp-fd-interest', selectedFyYear],
    queryFn: async () => {
      const { data } = await supabase
        .from('deposits')
        .select('principal, maturity_amount')
        .eq('status', 'matured')
        .gte('matured_date', selectedFy.start)
        .lte('matured_date', selectedFy.end)
      return (data ?? []).reduce((s: number, r: any) => {
        const interest = (r.maturity_amount ?? r.principal) - r.principal
        return s + (interest > 0 ? interest : 0)
      }, 0)
    },
  })

  const { data: paymentRows } = useQuery({
    queryKey: ['rp-payments', selectedFyYear],
    queryFn: async () => {
      const [{ data: exps }, { data: cats }] = await Promise.all([
        applyReportableFilter(supabase.from('expenses')
          .select('amount, category_id'))
          .gte('expense_date', selectedFy.start)
          .lte('expense_date', selectedFy.end),
        supabase.from('expense_categories').select('id, name'),
      ])
      const catMap = new Map((cats ?? []).map((c: any) => [c.id, c.name as string]))
      const grouped = new Map<string, number>()
      for (const e of exps ?? []) {
        const cat = catMap.get((e as any).category_id) ?? 'Uncategorised'
        grouped.set(cat, (grouped.get(cat) ?? 0) + ((e as any).amount ?? 0))
      }
      return Array.from(grouped.entries())
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount)
    },
  })

  const mCR         = maintenanceCR ?? 0
  const cCR         = corpusCR ?? 0
  const fdInt       = fdInterest ?? 0
  const totalReceipts = openingBalance + mCR + cCR + fdInt
  const totalPayments = (paymentRows ?? []).reduce((s, r) => s + r.amount, 0)
  const closingBalance = totalReceipts - totalPayments

  async function handlePdf() {
    setGenerating(true)
    try {
      const [{ pdf }, { RPStatementDoc }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/reports/AgmPdfDocs'),
      ])
      const generated = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      const blob = await pdf(
        <RPStatementDoc
          fyLabel={selectedFy.label}
          openingBalance={openingBalance}
          maintenanceCR={mCR}
          corpusCR={cCR}
          fdInterest={fdInt}
          payments={paymentRows ?? []}
          generated={generated}
        />
      ).toBlob()
      triggerDownload(blob, `RP_Statement_${selectedFy.label.replace(/\s/g, '_')}.pdf`)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-sm font-medium" style={{ color: 'var(--ink-600)' }}>Financial Year</label>
        <select
          value={selectedFyYear}
          onChange={e => setSelectedFyYear(Number(e.target.value))}
          className="ds-field"
        >
          {FISCAL_YEARS.map(f => <option key={f.year} value={f.year}>{f.label}</option>)}
        </select>
        <div className="ml-auto">
          <button
            onClick={handlePdf}
            disabled={generating}
            className="btn-primary flex items-center gap-2 py-2 px-4 text-sm disabled:opacity-50"
          >
            {generating
              ? <><Loader2 size={14} className="animate-spin" /> Generating PDF…</>
              : <><FileText size={14} /> Download PDF</>
            }
          </button>
        </div>
      </div>

      <div className="surface !p-0 overflow-hidden">
        <div className="px-5 py-3 border-b hairline" style={{ background: 'var(--ink-50)' }}>
          <h3 className="font-semibold text-sm" style={{ color: 'var(--ink-700)' }}>RECEIPTS</h3>
        </div>
        {[
          { label: 'Opening balance (brought forward)', amount: openingBalance },
          { label: 'Maintenance collected',             amount: mCR },
          { label: 'Corpus collected',                  amount: cCR },
          { label: 'FD interest received',              amount: fdInt },
        ].map(({ label, amount }) => (
          <div key={label} className="flex justify-between items-center px-5 py-3 border-b hairline text-sm">
            <span style={{ color: 'var(--ink-600)' }}>{label}</span>
            <span className="font-semibold" style={{ color: 'var(--ink-800)' }}>{formatINR(amount)}</span>
          </div>
        ))}
        <div className="flex justify-between items-center px-5 py-3 text-sm font-bold border-t-2 hairline" style={{ background: 'var(--ok-bg)' }}>
          <span>Total Receipts</span>
          <span className="text-green-700">{formatINR(totalReceipts)}</span>
        </div>
      </div>

      <div className="surface !p-0 overflow-hidden">
        <div className="px-5 py-3 border-b hairline" style={{ background: 'var(--ink-50)' }}>
          <h3 className="font-semibold text-sm" style={{ color: 'var(--ink-700)' }}>PAYMENTS</h3>
        </div>
        {(paymentRows ?? []).length === 0 ? (
          <div className="px-5 py-6 text-center text-sm" style={{ color: 'var(--ink-400)' }}>
            No expenses recorded for {selectedFy.label}
          </div>
        ) : (
          (paymentRows ?? []).map(({ category, amount }) => (
            <div key={category} className="flex justify-between items-center px-5 py-3 border-b hairline text-sm">
              <span style={{ color: 'var(--ink-600)' }}>{category}</span>
              <span className="font-semibold" style={{ color: 'var(--ink-800)' }}>{formatINR(amount)}</span>
            </div>
          ))
        )}
        <div className="flex justify-between items-center px-5 py-3 text-sm font-bold border-t-2 hairline" style={{ background: 'var(--bad-bg)' }}>
          <span>Total Payments</span>
          <span className="text-rose-700">{formatINR(totalPayments)}</span>
        </div>
      </div>

      <div className={`surface !p-4 flex justify-between items-center text-base font-bold border-2 ${closingBalance >= 0 ? 'border-green-200' : 'border-red-200'}`}
        style={{ background: closingBalance >= 0 ? 'var(--ok-bg)' : 'var(--bad-bg)' }}>
        <span>Closing Balance (31 Mar {selectedFyYear + 1})</span>
        <span className={closingBalance >= 0 ? 'text-green-700' : 'text-red-600'}>
          {formatINR(Math.abs(closingBalance))}
          {closingBalance < 0 && ' (deficit)'}
        </span>
      </div>

      <p className="text-xs text-center" style={{ color: 'var(--ink-400)' }}>
        Cash-basis statement · All monetary transactions for {selectedFy.label}
      </p>
    </div>
  )
}

function BalanceSheetTab() {
  const fy = getCurrentFy()
  const [selectedFyYear, setSelectedFyYear] = useState(fy.year)
  const selectedFy = getFyRange(selectedFyYear)
  const [generating, setGenerating] = useState(false)

  const { data: bankBalanceData = 0 } = useQuery({
    queryKey: ['bs-bank-balance', selectedFy.end],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_bank_balance_as_of', { p_date: selectedFy.end })
      if (error) throw error
      return (data as number) ?? 0
    },
  })

  const { data: activeFDs } = useQuery({
    queryKey: ['bs-active-fds'],
    queryFn: async () => {
      const { data } = await supabase
        .from('deposits')
        .select('principal')
        .eq('status', 'active')
      return (data ?? []).reduce((s: number, r: any) => s + (r.principal ?? 0), 0)
    },
  })

  const { data: corpusCollected } = useQuery({
    queryKey: ['bs-corpus-collected'],
    queryFn: async () => {
      const { data } = await supabase.from('v_corpus_tracker').select('collected')
      return (data ?? []).reduce((s: number, r: any) => s + (r.collected ?? 0), 0)
    },
  })

  const { data: pendingDues } = useQuery({
    queryKey: ['bs-pending-dues', selectedFyYear],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_dues_tracker')
        .select('total_outstanding')
        .eq('fiscal_year', selectedFyYear)
        .gt('total_outstanding', 0)
      return (data ?? []).reduce((s: number, r: any) => s + (r.total_outstanding ?? 0), 0)
    },
  })

  const { data: corpusBalance } = useQuery({
    queryKey: ['bs-corpus-balance'],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_corpus_tracker')
        .select('balance')
        .gt('balance', 0)
      return (data ?? []).reduce((s: number, r: any) => s + (r.balance ?? 0), 0)
    },
  })

  const bankBalance = bankBalanceData
  const fdTotal     = activeFDs ?? 0
  const corpColl    = corpusCollected ?? 0
  const totalAssets = bankBalance + fdTotal + corpColl

  const pendDues    = pendingDues ?? 0
  const corpBal     = corpusBalance ?? 0
  const totalLiab   = pendDues + corpBal

  const netPosition = totalAssets - totalLiab

  async function handlePdf() {
    setGenerating(true)
    try {
      const [{ pdf }, { BalanceSheetDoc }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/reports/AgmPdfDocs'),
      ])
      const generated = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      const blob = await pdf(
        <BalanceSheetDoc
          fyLabel={selectedFy.label}
          asAtDate={`31 March ${selectedFyYear + 1}`}
          bankBalance={bankBalance}
          fdTotal={fdTotal}
          corpusCollected={corpColl}
          totalAssets={totalAssets}
          pendingDues={pendDues}
          corpusBalance={corpBal}
          totalLiabilities={totalLiab}
          netPosition={netPosition}
          generated={generated}
        />
      ).toBlob()
      triggerDownload(blob, `Balance_Sheet_${selectedFy.label.replace(/\s/g, '_')}.pdf`)
    } finally {
      setGenerating(false)
    }
  }

  const isLoading = bankBalanceData === undefined

  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-sm font-medium" style={{ color: 'var(--ink-600)' }}>As at 31 March</label>
        <select
          value={selectedFyYear}
          onChange={e => setSelectedFyYear(Number(e.target.value))}
          className="ds-field"
        >
          {FISCAL_YEARS.map(f => <option key={f.year} value={f.year}>{f.year + 1} ({f.label})</option>)}
        </select>
        <div className="ml-auto">
          <button
            onClick={handlePdf}
            disabled={generating || isLoading}
            className="btn-primary flex items-center gap-2 py-2 px-4 text-sm disabled:opacity-50"
          >
            {generating
              ? <><Loader2 size={14} className="animate-spin" /> Generating PDF…</>
              : <><FileText size={14} /> Download PDF</>
            }
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="h-48 animate-pulse rounded-[var(--ds-radius)]" style={{ background: 'var(--ink-100)' }} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="surface !p-0 overflow-hidden">
            <div className="px-5 py-3 border-b hairline" style={{ background: 'var(--info-bg)' }}>
              <h3 className="font-semibold text-sm text-blue-800">ASSETS</h3>
              <p className="text-xs text-blue-600">as at 31 March {selectedFyYear + 1}</p>
            </div>
            {[
              { label: 'Bank balance',           amount: bankBalance, note: 'Cumulative CRs − DRs through this date (audit-derived)' },
              { label: 'Fixed deposits (active)', amount: fdTotal,    note: 'Sum of active FD principals' },
              { label: 'Corpus fund collected',   amount: corpColl,   note: 'All plans combined' },
            ].map(({ label, amount, note }) => (
              <div key={label} className="flex justify-between items-start px-5 py-3 border-b hairline text-sm">
                <div>
                  <p style={{ color: 'var(--ink-700)' }}>{label}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--ink-400)' }}>{note}</p>
                </div>
                <span className="font-semibold ml-4 shrink-0" style={{ color: 'var(--ink-800)' }}>{formatINR(amount)}</span>
              </div>
            ))}
            <div className="flex justify-between items-center px-5 py-3 font-bold text-sm border-t-2 hairline text-blue-700" style={{ background: 'var(--info-bg)' }}>
              <span>Total Assets</span>
              <span>{formatINR(totalAssets)}</span>
            </div>
          </div>

          <div className="surface !p-0 overflow-hidden">
            <div className="px-5 py-3 border-b hairline" style={{ background: 'var(--bad-bg)' }}>
              <h3 className="font-semibold text-sm text-rose-800">LIABILITIES</h3>
              <p className="text-xs text-rose-600">as at 31 March {selectedFyYear + 1}</p>
            </div>
            {[
              { label: 'Pending maintenance dues', amount: pendDues, note: 'Flats with outstanding dues' },
              { label: 'Corpus yet to collect',    amount: corpBal,  note: 'Target minus collected (all plans)' },
            ].map(({ label, amount, note }) => (
              <div key={label} className="flex justify-between items-start px-5 py-3 border-b hairline text-sm">
                <div>
                  <p style={{ color: 'var(--ink-700)' }}>{label}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--ink-400)' }}>{note}</p>
                </div>
                <span className="font-semibold ml-4 shrink-0" style={{ color: 'var(--ink-800)' }}>{formatINR(amount)}</span>
              </div>
            ))}
            <div className="flex justify-between items-center px-5 py-3 font-bold text-sm border-t-2 hairline text-rose-700" style={{ background: 'var(--bad-bg)' }}>
              <span>Total Liabilities</span>
              <span>{formatINR(totalLiab)}</span>
            </div>
          </div>
        </div>
      )}

      {!isLoading && (
        <div className={`surface !p-5 flex justify-between items-center text-lg font-bold border-2 rounded-[var(--ds-radius)] ${netPosition >= 0 ? 'border-green-300' : 'border-red-300'}`}
          style={{ background: netPosition >= 0 ? 'var(--ok-bg)' : 'var(--bad-bg)' }}>
          <div>
            <p>Net Position</p>
            <p className="text-xs font-normal mt-0.5" style={{ color: 'var(--ink-500)' }}>Total Assets − Total Liabilities</p>
          </div>
          <span className={netPosition >= 0 ? 'text-green-700' : 'text-red-600'}>
            {netPosition >= 0 ? '' : '−'}{formatINR(Math.abs(netPosition))}
          </span>
        </div>
      )}

      <p className="text-xs text-center" style={{ color: 'var(--ink-400)' }}>
        Note: Bank balance = opening balance (set in Settings) + all bank CRs − all bank DRs for {selectedFy.label}.
        Corpus collected is shown as an asset (ring-fenced fund).
      </p>
    </div>
  )
}
