import { useState, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef } from 'ag-grid-community'
import { X, TrendingDown, Download } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase, DuesEntry, Transaction } from '@/lib/supabase'
import { formatINR } from '@/lib/tagger'


export default function DuesPage() {
  const [selectedFlat, setSelectedFlat] = useState<DuesEntry | null>(null)
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
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-semibold">Dues tracker</h2>
          <p className="text-sm text-slate-500 mt-0.5">{fyLabel} maintenance outstanding{!sameYear && ' (carry-forward)'}</p>
        </div>
        <button onClick={handleExport} disabled={!data?.length}
          className="flex items-center gap-1.5 text-sm text-brand-700 hover:text-brand-900 disabled:opacity-40">
          <Download size={14} /> Export
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="Total pending" value={formatINR(totalPending)} color="text-red-600" bg="bg-red-50" />
        <SummaryCard label="Due (0 paid)"  value={String(counts.Due)}     color="text-red-600"   bg="bg-red-50" />
        <SummaryCard label="Partial"        value={String(counts.Partial)} color="text-amber-600" bg="bg-amber-50" />
        <SummaryCard label="Clear"          value={String(counts.Clear)}   color="text-green-600" bg="bg-green-50" />
      </div>

      {/* Grid */}
      <div className="flex gap-4">
        <div className="flex-1 min-w-0">
          {isLoading ? (
            <div className="card h-64 animate-pulse bg-slate-100" />
          ) : (
            <div className="rounded-xl overflow-hidden border border-slate-200" style={{ height: 520 }}>
              <AgGridReact
                ref={gridRef}
                rowData={data ?? []}
                columnDefs={colDefs}
                defaultColDef={{ sortable: true, resizable: true, filter: true, floatingFilter: true }}
                rowSelection={{ mode: 'singleRow' }}
                onRowClicked={e => setSelectedFlat(e.data)}
                getRowStyle={(p: any) => p.data?.flat_code === selectedFlat?.flat_code ? { background: '#eff6ff' } : undefined}
              />
            </div>
          )}
        </div>

        {/* Flat detail panel */}
        {selectedFlat && (
          <FlatPaymentPanel flat={selectedFlat} fiscalYear={parseInt(fiscalYear)} startFiscalYear={parseInt(startFY)} onClose={() => setSelectedFlat(null)} />
        )}
      </div>
    </div>
  )
}

function SummaryCard({ label, value, color, bg }: { label: string; value: string; color: string; bg: string }) {
  return (
    <div className={`card p-4 ${bg}`}>
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  )
}

function FlatPaymentPanel({ flat, fiscalYear, startFiscalYear, onClose }: { flat: DuesEntry; fiscalYear: number; startFiscalYear: number; onClose: () => void }) {
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

  return (
    <div className="w-72 shrink-0 space-y-3">
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">{flat.flat_code} — {flat.bhk_type}</h3>
            <p className="text-xs text-slate-400 mt-0.5">Block {flat.block}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X size={15} /></button>
        </div>

        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Rate/mo</span>
            <span className="font-medium">{formatINR(flat.maintenance_amt)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Annual due</span>
            <span className="font-medium">{formatINR(flat.annual_due)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Collected</span>
            <span className="font-medium text-green-700">{formatINR(flat.collected_fy)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-100 pt-1.5">
            <span className="text-slate-500">Pending</span>
            <span className={`font-semibold ${flat.pending > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {flat.pending > 0 ? formatINR(flat.pending) : '✓ Clear'}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-2 rounded-full transition-all ${flat.status === 'Clear' ? 'bg-green-500' : flat.status === 'Partial' ? 'bg-amber-400' : 'bg-red-400'}`}
            style={{ width: `${Math.min(100, (flat.collected_fy / flat.annual_due) * 100)}%` }}
          />
        </div>
      </div>

      <div className="card p-4">
        <h4 className="font-medium text-sm mb-3 flex items-center gap-1.5">
          <TrendingDown size={14} className="text-slate-400" /> Payment history
        </h4>
        {!payments?.length ? (
          <p className="text-sm text-slate-400">No payments yet</p>
        ) : (
          <div className="space-y-2">
            {payments.map(p => (
              <div key={p.id} className="flex justify-between text-sm">
                <div>
                  <p className="font-medium">{p.fiscal_label}</p>
                  <p className="text-xs text-slate-400">{p.value_date}</p>
                </div>
                <p className="font-semibold text-green-700">{formatINR(p.amount)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
