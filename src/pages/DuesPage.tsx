import { useState, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef } from 'ag-grid-community'
import { X, TrendingDown, Download, MessageCircle, Check } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase, DuesEntry, Transaction } from '@/lib/supabase'
import { formatINR } from '@/lib/tagger'

type AgingTab = 'All' | 'Due' | '30d+' | '60d+' | '90d+'

const AGING_TABS: AgingTab[] = ['All', 'Due', '30d+', '60d+', '90d+']

function applyAgingFilter(rows: DuesEntry[], tab: AgingTab): DuesEntry[] {
  if (tab === 'All') return rows
  if (tab === 'Due') return rows.filter(r => r.pending > 0)
  const monthMultiplier = tab === '30d+' ? 1 : tab === '60d+' ? 2 : 3
  return rows.filter(r => r.pending > r.maintenance_amt * monthMultiplier)
}


export default function DuesPage() {
  const [selectedFlat, setSelectedFlat] = useState<DuesEntry | null>(null)
  const [agingTab, setAgingTab] = useState<AgingTab>('All')
  const gridRef = useRef<AgGridReact>(null)

  const { data: settings } = useQuery({
    queryKey: ['app-settings'],
    queryFn: async () => {
      const { data } = await supabase.from('app_settings').select('*')
      return Object.fromEntries((data ?? []).map(s => [s.key, s.value]))
    },
  })

  const now         = new Date()
  const fiscalYear  = String(now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1)
  const startFY     = settings?.dues_start_fiscal_year   ?? fiscalYear
  const sameYear    = startFY === fiscalYear
  const fyLabel     = sameYear
    ? `FY ${fiscalYear}-${String(parseInt(fiscalYear) + 1).slice(-2)}`
    : `FY ${startFY}-${String(parseInt(startFY) + 1).slice(-2)} → FY ${fiscalYear}-${String(parseInt(fiscalYear) + 1).slice(-2)}`

  const { data, isLoading } = useQuery({
    queryKey: ['dues', fiscalYear],
    queryFn: async () => {
      const { data } = await supabase.from('v_dues_tracker').select('*').order('flat_code')
      return (data ?? []) as DuesEntry[]
    },
  })

  const totalPending = (data ?? []).reduce((s, d) => s + Math.max(0, d.pending), 0)
  const counts = {
    Due:     (data ?? []).filter(d => d.status === 'Due').length,
    Partial: (data ?? []).filter(d => d.status === 'Partial').length,
    Clear:   (data ?? []).filter(d => d.status === 'Clear').length,
  }

  const filteredData = useMemo(() => applyAgingFilter(data ?? [], agingTab), [data, agingTab])

  const colDefs = useMemo((): ColDef<any>[] => [
    { field: 'flat_code',       headerName: 'Flat',     width: 90 },
    { field: 'maintenance_amt', headerName: 'Rate/mo',  width: 110, type: 'numericColumn',
      valueFormatter: (p: any) => formatINR(p.value),
    },
    { field: 'annual_due',   headerName: sameYear ? 'Due to date' : 'Total Due', width: 120, type: 'numericColumn',
      valueFormatter: (p: any) => formatINR(p.value),
    },
    { field: 'collected_fy', headerName: 'Collected', width: 120, type: 'numericColumn',
      valueFormatter: (p: any) => formatINR(p.value),
    },
    { field: 'pending',      headerName: 'Pending',   width: 120, type: 'numericColumn',
      valueFormatter: (p: any) => p.value > 0 ? formatINR(p.value) : '—',
      cellStyle: (p: any) => p.value > 0 ? { color: '#dc2626', fontWeight: 600 } : { color: '#16a34a', fontWeight: 400 },
    },
    { field: 'status', headerName: 'Status', width: 110, filter: true,
      cellRenderer: (p: any) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
          p.value === 'Clear' ? 'bg-green-100 text-green-700' :
          p.value === 'Partial' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
        }`}>{p.value}</span>
      ),
    },
  ], [sameYear])

  function handleExport() {
    const rows: any[] = []
    gridRef.current?.api?.forEachNodeAfterFilterAndSort(node => { if (node.data) rows.push(node.data) })
    const exportRows = (rows.length > 0 ? rows : data ?? []).map(r => ({
      Flat: r.flat_code, Block: r.block, BHK: r.bhk_type,
      'Rate/mo': r.maintenance_amt,
      'Due to date': r.annual_due,
      Collected: r.collected_fy,
      Pending: r.pending,
      Status: r.status,
    }))
    const ws = XLSX.utils.json_to_sheet(exportRows)
    ws['!cols'] = [8, 8, 12, 12, 14, 12, 12, 10].map(w => ({ wch: w }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Dues')
    XLSX.writeFile(wb, `Dues_${fyLabel.replace(/[^a-z0-9]/gi, '_')}.xlsx`)
  }

  return (
    <div className="flex flex-col gap-5 fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-[24px] font-extrabold">Dues tracker</h1>
          <p className="text-[13.5px] mt-1" style={{ color: 'var(--ink-500)' }}>
            {fyLabel} maintenance outstanding{!sameYear && ' (carry-forward)'}
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={!data?.length}
          className="flex items-center gap-2 px-3.5 py-2 rounded-[10px] border hairline font-semibold text-[13.5px] disabled:opacity-40"
          style={{ color: 'var(--ink-700)' }}
        >
          <Download size={14} /> Export
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {[
          { label: 'Total pending', value: formatINR(totalPending), tone: 'bad' },
          { label: 'Due (0 paid)',  value: String(counts.Due),      tone: 'bad' },
          { label: 'Partial',       value: String(counts.Partial),  tone: 'warn' },
          { label: 'Clear',         value: String(counts.Clear),    tone: 'ok' },
        ].map(({ label, value, tone }) => (
          <div
            key={label}
            className="surface !p-4"
            style={{
              background: tone === 'bad' ? 'var(--bad-bg)' : tone === 'warn' ? 'var(--warn-bg)' : tone === 'ok' ? 'var(--ok-bg)' : '#fff',
            }}
          >
            <p className="text-[12px] font-medium mb-1" style={{ color: 'var(--ink-500)' }}>{label}</p>
            <p
              className="text-[26px] font-bold leading-tight tnum"
              style={{ color: tone === 'bad' ? 'var(--bad)' : tone === 'warn' ? 'var(--warn)' : tone === 'ok' ? 'var(--ok)' : 'var(--ink-800)' }}
            >
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* Aging filter tabs */}
      <div className="flex gap-1 p-1 rounded-[12px] flex-wrap" style={{ background: 'var(--ink-100)' }}>
        {AGING_TABS.map(t => (
          <button
            key={t}
            onClick={() => setAgingTab(t)}
            className="px-4 py-1.5 rounded-[9px] text-[13.5px] font-medium transition-colors"
            style={agingTab === t
              ? { background: '#fff', color: 'var(--ink-900)', boxShadow: '0 1px 4px rgba(26,24,32,.10)' }
              : { color: 'var(--ink-500)' }
            }
          >
            {t}
          </button>
        ))}
      </div>

      {/* Grid + detail panel */}
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1 min-w-0">
          {isLoading ? (
            <div className="surface h-64 animate-pulse" style={{ background: 'var(--ink-100)' }} />
          ) : (
            <div className="overflow-hidden border hairline" style={{ borderRadius: 'var(--ds-radius)', height: 480 }}>
              <AgGridReact
                ref={gridRef}
                rowData={filteredData}
                columnDefs={colDefs}
                defaultColDef={{ sortable: true, resizable: true, filter: true, floatingFilter: true }}
                rowSelection={{ mode: 'singleRow' }}
                onRowClicked={e => setSelectedFlat(e.data)}
                getRowStyle={(p: any) => p.data?.flat_code === selectedFlat?.flat_code ? { background: 'var(--brand-50)' } : undefined}
              />
            </div>
          )}
        </div>

        {selectedFlat && (
          <FlatPaymentPanel flat={selectedFlat} fiscalYear={parseInt(fiscalYear)} startFiscalYear={parseInt(startFY)} onClose={() => setSelectedFlat(null)} />
        )}
      </div>
    </div>
  )
}

function FlatPaymentPanel({ flat, fiscalYear, startFiscalYear, onClose }: { flat: DuesEntry; fiscalYear: number; startFiscalYear: number; onClose: () => void }) {
  const [copied, setCopied] = useState(false)

  const { data: payments } = useQuery({
    queryKey: ['flat-payments', flat.flat_code, startFiscalYear, fiscalYear],
    queryFn: async () => {
      const { data } = await supabase.from('transactions')
        .select('*')
        .eq('flat_code', flat.flat_code)
        .gte('fiscal_year', startFiscalYear)
        .lte('fiscal_year', fiscalYear)
        .eq('cr_dr', 'CR')
        .eq('category', 'Maintenance')
        .neq('row_type', 'VOIDED')
        .order('value_date')
      return (data ?? []) as Transaction[]
    },
  })

  const { data: settings } = useQuery({
    queryKey: ['app-settings'],
    queryFn: async () => {
      const { data } = await supabase.from('app_settings').select('*')
      return Object.fromEntries((data ?? []).map((s: any) => [s.key, s.value]))
    },
  })

  const fyLabel = `FY ${fiscalYear}-${String(fiscalYear + 1).slice(-2)}`

  function buildReminderText() {
    const lines = [
      `Dear resident of ${flat.flat_code},`,
      ``,
      `Your maintenance dues of ${formatINR(flat.pending)} are pending for ${fyLabel}.`,
      ``,
      `Please make the payment at your earliest convenience.`,
    ]
    const upi  = settings?.collection_upi
    const bank = settings?.collection_bank
    if (upi || bank) {
      lines.push(``)
      lines.push(`Payment details:`)
      if (upi)  lines.push(`  UPI: ${upi}`)
      if (bank) lines.push(`  Bank transfer: ${bank}`)
    }
    lines.push(``, `— Lilac Apartment Association`)
    return lines.join('\n')
  }

  async function handleCopyReminder() {
    await navigator.clipboard.writeText(buildReminderText())
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="w-full lg:w-72 shrink-0 flex flex-col gap-3">
      <div className="surface !p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-[15px]">{flat.flat_code} — {flat.bhk_type}</h3>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--ink-400)' }}>Block {flat.block}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--ink-100)]" style={{ color: 'var(--ink-500)' }}>
            <X size={15} />
          </button>
        </div>

        <div className="flex flex-col gap-1.5 text-[13.5px]">
          {[
            { label: 'Rate/mo',    val: formatINR(flat.maintenance_amt), special: '' },
            { label: 'Annual due', val: formatINR(flat.annual_due),      special: '' },
            { label: 'Collected',  val: formatINR(flat.collected_fy),    special: 'ok' },
          ].map(({ label, val, special }) => (
            <div key={label} className="flex justify-between">
              <span style={{ color: 'var(--ink-500)' }}>{label}</span>
              <span className="font-medium" style={{ color: special === 'ok' ? 'var(--ok)' : 'var(--ink-800)' }}>{val}</span>
            </div>
          ))}
          <div className="flex justify-between border-t hairline pt-1.5">
            <span style={{ color: 'var(--ink-500)' }}>Pending</span>
            <span className="font-bold" style={{ color: flat.pending > 0 ? 'var(--bad)' : 'var(--ok)' }}>
              {flat.pending > 0 ? formatINR(flat.pending) : '✓ Clear'}
            </span>
          </div>
        </div>

        <div className="ds-track">
          <div
            className="ds-track-fill"
            style={{
              width: `${Math.min(100, (flat.collected_fy / flat.annual_due) * 100)}%`,
              background: flat.status === 'Clear' ? 'var(--ok)' : flat.status === 'Partial' ? 'var(--warn)' : 'var(--bad)',
            }}
          />
        </div>

        {flat.pending > 0 && (
          <button
            onClick={handleCopyReminder}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-[10px] border font-medium text-[13px] transition-colors"
            style={{ borderColor: 'var(--ok-bd)', background: 'var(--ok-bg)', color: 'var(--ok)' }}
          >
            {copied
              ? <><Check size={14} /> Copied!</>
              : <><MessageCircle size={14} /> Copy WhatsApp reminder</>
            }
          </button>
        )}
      </div>

      <div className="surface !p-4">
        <h4 className="font-semibold text-[13px] mb-3 flex items-center gap-1.5" style={{ color: 'var(--ink-700)' }}>
          <TrendingDown size={14} style={{ color: 'var(--ink-400)' }} /> Payment history
        </h4>
        {!payments?.length ? (
          <p className="text-[13px]" style={{ color: 'var(--ink-400)' }}>No payments yet</p>
        ) : (
          <div className="flex flex-col gap-2">
            {payments.map(p => (
              <div key={p.id} className="flex justify-between text-[13px]">
                <div>
                  <p className="font-medium">{p.fiscal_label}</p>
                  <p className="text-[11.5px] mono" style={{ color: 'var(--ink-400)' }}>{p.value_date}</p>
                </div>
                <p className="font-bold" style={{ color: 'var(--ok)' }}>{formatINR(p.amount)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
