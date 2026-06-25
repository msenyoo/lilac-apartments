import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef } from 'ag-grid-community'
import { X, TrendingDown, Download, MessageCircle, Check, Pencil, Trash2, ListChecks, Loader2, Search } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase, DuesEntry, Transaction, Flat } from '@/lib/supabase'
import { formatINR } from '@/lib/tagger'
import { useRoleCtx } from '@/contexts/RoleContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'

type AgingTab = 'Due' | '30d+' | '60d+' | '90d+' | 'Partial' | 'Clear'

const AGING_TABS: AgingTab[] = ['Due', '30d+', '60d+', '90d+', 'Partial', 'Clear']

function applyAgingFilter(rows: DuesEntry[], tab: AgingTab): DuesEntry[] {
  if (tab === 'Clear')   return rows.filter(r => r.total_outstanding <= 0)
  const openRows = rows.filter(r => r.total_outstanding > 0)
  if (tab === 'Due')     return openRows
  if (tab === 'Partial') return openRows.filter(r => r.collected_fy > 0)
  const monthMultiplier = tab === '30d+' ? 1 : tab === '60d+' ? 2 : 3
  return openRows.filter(r => r.pending > r.maintenance_amt * monthMultiplier)
}

function toFiscalLabel(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }).replace(' ', '-')
}

function toFiscalYear(dateStr: string): number {
  const d = new Date(dateStr)
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
}

function toFiscalMonth(dateStr: string): string {
  const d = new Date(dateStr)
  const monthName = d.toLocaleDateString('en-GB', { month: 'short' })
  const calYear = d.getFullYear()
  return `${monthName}-${calYear}`
}

interface UnmatchedCR {
  id: string
  value_date: string
  description: string
  amount: number
}

interface BulkRow {
  txnId: string
  valueDate: string
  description: string
  amount: number
  flatId: string
  flatCode: string
  fiscalLabel: string
}

export default function DuesPage() {
  const [selectedFlat, setSelectedFlat] = useState<DuesEntry | null>(null)
  const [agingTab, setAgingTab] = useState<AgingTab>('Due')
  const [bulkOpen, setBulkOpen] = useState(false)
  const gridRef = useRef<AgGridReact>(null)
  const { isAdmin } = useRoleCtx()

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
  const counts = (data ?? []).reduce((acc, d) => {
    if (d.total_outstanding <= 0) acc.Clear += 1
    else if (d.collected_fy > 0) acc.Partial += 1
    else acc.NeverPaid += 1
    if (d.pending > d.maintenance_amt) acc.Overdue += 1
    return acc
  }, { Overdue: 0, Partial: 0, Clear: 0, NeverPaid: 0 })

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
    {
      headerName: 'Arrears',
      field: 'arrears_maintenance',
      width: 110,
      valueFormatter: (p: any) => p.value > 0 ? formatINR(p.value) : '—',
      cellStyle: (p: any) => p.value > 0
        ? { color: '#dc2626', fontWeight: 600 }
        : { color: 'var(--ink-300)', fontWeight: 400 },
    },
    {
      headerName: 'Total Outstanding',
      field: 'total_outstanding',
      width: 140,
      valueFormatter: (p: any) => p.value > 0 ? formatINR(p.value) : 'Clear',
      cellStyle: (p: any) => p.value > 0
        ? { color: '#dc2626', fontWeight: 700 }
        : { color: '#16a34a', fontWeight: 600 },
    },
    { headerName: 'Status', width: 110, filter: true,
      valueGetter: (p: any) => {
        const { total_outstanding, collected_fy } = p.data
        if (total_outstanding <= 0) return 'Clear'
        if (collected_fy > 0) return 'Partial'
        return 'Due'
      },
      cellRenderer: (p: any) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
          p.value === 'Clear'   ? 'bg-green-100 text-green-700' :
          p.value === 'Partial' ? 'bg-amber-100 text-amber-700' :
                                  'bg-red-100 text-red-700'
        }`}>{p.value}</span>
      ),
    },
  ], [sameYear])

  function handleExport() {
    const rows: any[] = []
    gridRef.current?.api?.forEachNodeAfterFilterAndSort(node => { if (node.data) rows.push(node.data) })
    const dueLabel = sameYear ? 'Due to date' : 'Total Due'
    const exportRows = (rows.length > 0 ? rows : data ?? []).map(r => ({
      Flat:                r.flat_code,
      Block:               r.block,
      BHK:                 r.bhk_type,
      'Rate/mo':           r.maintenance_amt,
      [dueLabel]:          r.annual_due,
      Collected:           r.collected_fy,
      Pending:             r.pending,
      Arrears:             r.arrears_maintenance,
      'Total Outstanding': r.total_outstanding,
      Status:              r.total_outstanding <= 0 ? 'Clear' : (r.collected_fy > 0 ? 'Partial' : 'Due'),
    }))
    const ws = XLSX.utils.json_to_sheet(exportRows)
    ws['!cols'] = [8, 8, 12, 12, 14, 12, 12, 12, 16, 10].map(w => ({ wch: w }))
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
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setBulkOpen(true)}
              className="flex items-center gap-2"
            >
              <ListChecks size={14} /> Bulk Record
            </Button>
          )}
          <button
            onClick={handleExport}
            disabled={!data?.length}
            className="flex items-center gap-2 px-3.5 py-2 rounded-[10px] border hairline font-semibold text-[13.5px] disabled:opacity-40"
            style={{ color: 'var(--ink-700)' }}
          >
            <Download size={14} /> Export
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {[
          { label: 'Total pending',  value: formatINR(totalPending),   tone: 'bad',  onClick: () => setAgingTab('Due') },
          { label: 'Overdue 1 mo+',  value: String(counts.Overdue),    tone: 'bad',  onClick: () => setAgingTab('30d+') },
          { label: 'Partial',        value: String(counts.Partial),    tone: 'warn', onClick: () => setAgingTab('Partial') },
          { label: 'Clear',          value: String(counts.Clear),      tone: 'ok',   onClick: () => setAgingTab('Clear') },
        ].map(({ label, value, tone, onClick }) => (
          <button
            key={label}
            onClick={onClick}
            className="surface !p-4 text-left hover:shadow-md transition-shadow cursor-pointer"
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
          </button>
        ))}
      </div>

      {/* Aging filter tabs + flat lookup */}
      <div className="flex items-center gap-3 flex-wrap">
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
        <div className="relative ml-auto" style={{ width: 220 }}>
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--ink-400)' }} />
          <select
            value=""
            onChange={e => {
              const code = e.target.value
              const flat = (data ?? []).find(d => d.flat_code === code)
              if (flat) setSelectedFlat(flat)
            }}
            className="ds-field pl-8 text-[13px] w-full appearance-none"
          >
            <option value="" disabled>Open any flat…</option>
            {(data ?? []).slice().sort((a, b) => a.flat_code.localeCompare(b.flat_code)).map(d => (
              <option key={d.flat_code} value={d.flat_code}>
                {d.flat_code} {d.total_outstanding > 0 ? `· ${formatINR(d.total_outstanding)}` : '· clear'}
              </option>
            ))}
          </select>
        </div>
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

      {bulkOpen && <BulkRecordDialog open={bulkOpen} onClose={() => setBulkOpen(false)} />}
    </div>
  )
}

function FlatPaymentPanel({ flat, fiscalYear, startFiscalYear, onClose }: { flat: DuesEntry; fiscalYear: number; startFiscalYear: number; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const [showAddArrears, setShowAddArrears] = useState(false)
  const { isAdmin } = useRoleCtx()

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
        .order('value_date', { ascending: false })
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
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-[15px]">{flat.flat_code} — {flat.bhk_type}</h3>
              {isAdmin && (
                <button
                  onClick={() => setShowAddArrears(true)}
                  className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md border transition-colors hover:opacity-80"
                  style={{ color: 'var(--bad)', borderColor: 'var(--bad-bd)', background: 'var(--bad-bg)' }}
                >
                  + Arrears
                </button>
              )}
            </div>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--ink-400)' }}>Block {flat.block}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--ink-100)]" style={{ color: 'var(--ink-500)' }}>
            <X size={15} />
          </button>
        </div>

        <div className="flex flex-col gap-1.5 text-[13.5px]">
          {[
            { label: 'Rate/mo',          val: formatINR(flat.maintenance_amt),    tone: 'default', show: true },
            { label: 'Previous arrears', val: formatINR(flat.arrears_maintenance), tone: 'bad',    show: flat.arrears_maintenance > 0 },
            { label: 'Annual due',       val: formatINR(flat.annual_due),         tone: 'default', show: true },
            { label: 'Collected',        val: formatINR(flat.collected_fy),       tone: 'ok',     show: true },
          ].filter(r => r.show).map(({ label, val, tone }) => (
            <div key={label} className="flex justify-between">
              <span style={{ color: 'var(--ink-500)' }}>{label}</span>
              <span className="font-medium" style={{ color: tone === 'ok' ? 'var(--ok)' : tone === 'bad' ? 'var(--bad)' : 'var(--ink-800)' }}>{val}</span>
            </div>
          ))}
          <div className="flex justify-between border-t hairline pt-1.5">
            <span style={{ color: 'var(--ink-500)' }}>Pending</span>
            <span className="font-medium" style={{ color: flat.pending > 0 ? 'var(--bad)' : 'var(--ok)' }}>
              {flat.pending > 0 ? formatINR(flat.pending) : '✓ Clear'}
            </span>
          </div>
          {flat.advance_credits > 0 && (
            <div className="flex justify-between">
              <span style={{ color: 'var(--ink-500)' }}>Advance paid</span>
              <span className="font-medium" style={{ color: 'var(--ok)' }}>− {formatINR(flat.advance_credits)}</span>
            </div>
          )}
          {(flat.arrears_maintenance > 0 || flat.advance_credits > 0) && (
            <div className="flex justify-between border-t hairline pt-1.5">
              <span className="font-semibold" style={{ color: 'var(--ink-700)' }}>Total outstanding</span>
              <span className="font-bold" style={{ color: flat.total_outstanding > 0 ? 'var(--bad)' : 'var(--ok)' }}>
                {flat.total_outstanding > 0 ? formatINR(flat.total_outstanding) : '✓ Clear'}
              </span>
            </div>
          )}
        </div>

        <div className="ds-track">
          <div
            className="ds-track-fill"
            style={{
              width: `${flat.total_outstanding <= 0 ? 100 : Math.min(100, (flat.collected_fy / flat.annual_due) * 100)}%`,
              background: flat.total_outstanding <= 0 ? 'var(--ok)' : flat.pending === flat.total_outstanding ? 'var(--bad)' : 'var(--warn)',
            }}
          />
        </div>

        {flat.total_outstanding > 0 && (
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

        <ArrearsMgmt flatCode={flat.flat_code} showAdd={showAddArrears} onCloseAdd={() => setShowAddArrears(false)} />
      </div>

      <div className="surface !p-4">
        <h4 className="font-semibold text-[13px] mb-3 flex items-center gap-1.5" style={{ color: 'var(--ink-700)' }}>
          <TrendingDown size={14} style={{ color: 'var(--ink-400)' }} /> Payment history
        </h4>
        {!payments?.length ? (
          <p className="text-[13px]" style={{ color: 'var(--ink-400)' }}>No payments yet</p>
        ) : (
          <div className="flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: 220 }}>
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

function ArrearsMgmt({ flatCode, showAdd = false, onCloseAdd }: { flatCode: string; showAdd?: boolean; onCloseAdd?: () => void }) {
  const qc = useQueryClient()
  const { isAdmin } = useRoleCtx()
  const [editRow, setEditRow] = useState<any>(null)

  const { data: flatIdData } = useQuery({
    queryKey: ['flat-id-for-code', flatCode],
    queryFn: async () => {
      const { data } = await supabase
        .from('flats').select('id').eq('code', flatCode).single()
      return data?.id as string | null
    },
  })

  const { data: rows = [] } = useQuery({
    queryKey: ['arrears-for-flat', flatCode],
    queryFn: async () => {
      const { data } = await supabase
        .from('flat_arrears')
        .select('*')
        .eq('flat_id', flatIdData!)
        .in('arrears_type', ['maintenance', 'credit'])
        .order('created_at')
      return data ?? []
    },
    enabled: !!flatIdData,
  })

  const arrears = rows.filter((r: any) => r.arrears_type === 'maintenance')
  const credits = rows.filter((r: any) => r.arrears_type === 'credit')

  async function handleDelete(id: string) {
    const { error } = await supabase.from('flat_arrears').delete().eq('id', id)
    if (error) { toast.error(error.message); return }
    qc.invalidateQueries({ queryKey: ['arrears-for-flat', flatCode] })
    qc.invalidateQueries({ queryKey: ['dues'] })
  }

  if (rows.length === 0 && !showAdd && !editRow) return null

  function renderRow(row: any, color: string) {
    return (
      <div key={row.id} className="flex items-center justify-between text-[12.5px]">
        <span>{row.source_label}</span>
        <div className="flex items-center gap-2">
          <span className="font-semibold" style={{ color }}>{formatINR(row.amount)}</span>
          {isAdmin && (
            <>
              <button onClick={() => setEditRow(row)} className="text-[var(--ink-400)] hover:text-[var(--ink-700)]">
                <Pencil size={13} />
              </button>
              <button onClick={() => handleDelete(row.id)} className="text-[var(--bad)] hover:opacity-70">
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 border-t hairline pt-3">
      {arrears.length > 0 && (
        <>
          <p className="text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-400)' }}>
            Carried forward dues
          </p>
          {arrears.map((row: any) => renderRow(row, 'var(--bad)'))}
        </>
      )}
      {credits.length > 0 && (
        <>
          <p className="text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-400)' }}>
            Advance paid
          </p>
          {credits.map((row: any) => renderRow(row, 'var(--ok)'))}
        </>
      )}
      {(showAdd || editRow) && flatIdData && (
        <ArrearsDialog
          flatId={flatIdData}
          row={editRow}
          onClose={() => { onCloseAdd?.(); setEditRow(null) }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['arrears-for-flat', flatCode] })
            qc.invalidateQueries({ queryKey: ['dues'] })
            onCloseAdd?.(); setEditRow(null)
          }}
        />
      )}
    </div>
  )
}

function ArrearsDialog({ flatId, row, onClose, onSaved }: {
  flatId: string
  row: any | null
  onClose: () => void
  onSaved: () => void
}) {
  const [type, setType]     = useState<'maintenance' | 'credit'>(row?.arrears_type ?? 'maintenance')
  const [label, setLabel]   = useState(row?.source_label ?? '')
  const [amount, setAmount] = useState(row?.amount?.toString() ?? '')
  const [notes, setNotes]   = useState(row?.notes ?? '')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    const amt = parseInt(amount)
    if (!label.trim() || isNaN(amt) || amt <= 0) return
    setSaving(true)
    let error: any
    if (row) {
      ;({ error } = await supabase.from('flat_arrears').update({
        source_label: label.trim(), amount: amt, notes: notes.trim() || null,
      }).eq('id', row.id))
    } else {
      const { data: { user } } = await supabase.auth.getUser()
      ;({ error } = await supabase.from('flat_arrears').insert({
        flat_id: flatId, arrears_type: type,
        source_label: label.trim(), amount: amt,
        notes: notes.trim() || null, created_by: user!.id,
      }))
    }
    setSaving(false)
    if (error) { toast.error(error.message); return }
    onSaved()
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{row ? 'Edit entry' : 'Add dues / advance'}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          {!row && (
            <div className="flex rounded-lg border hairline overflow-hidden text-[13px] font-medium">
              {(['maintenance', 'credit'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className="flex-1 py-1.5 transition-colors"
                  style={type === t
                    ? { background: t === 'credit' ? 'var(--ok-bg)' : 'var(--bad-bg)', color: t === 'credit' ? 'var(--ok)' : 'var(--bad)' }
                    : { color: 'var(--ink-500)' }}
                >
                  {t === 'maintenance' ? 'Carried forward dues' : 'Advance paid'}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-1">
            <Label>Period label (e.g. FY 2024-25)</Label>
            <Input value={label} onChange={e => setLabel(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Amount (₹)</Label>
            <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Notes</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BulkRecordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [rows, setRows] = useState<BulkRow[]>([])
  const [saving, setSaving] = useState(false)

  const { data: unmatchedCRs = [], isLoading: loadingCRs } = useQuery({
    queryKey: ['unmatched-crs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('id, value_date, description, amount')
        .eq('cr_dr', 'CR')
        .eq('corpus', 'NO')
        .is('flat_id', null)
        .order('value_date', { ascending: false })
      if (error) throw error
      return (data ?? []) as UnmatchedCR[]
    },
    enabled: open,
  })

  const { data: flats = [], isLoading: loadingFlats } = useQuery({
    queryKey: ['flats-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('flats')
        .select('id, code, block')
        .order('code')
      if (error) throw error
      return (data ?? []) as Pick<Flat, 'id' | 'code' | 'block'>[]
    },
    enabled: open,
  })

  useEffect(() => {
    if (unmatchedCRs.length > 0) {
      setRows(
        unmatchedCRs.map(cr => ({
          txnId:       cr.id,
          valueDate:   cr.value_date,
          description: cr.description,
          amount:      cr.amount,
          flatId:      '',
          flatCode:    '',
          fiscalLabel: toFiscalLabel(cr.value_date),
        }))
      )
    }
  }, [unmatchedCRs])

  function setRowFlat(txnId: string, flatId: string, flatCode: string) {
    setRows(prev => prev.map(r => r.txnId === txnId ? { ...r, flatId, flatCode } : r))
  }

  function setRowFiscalLabel(txnId: string, fiscalLabel: string) {
    setRows(prev => prev.map(r => r.txnId === txnId ? { ...r, fiscalLabel } : r))
  }

  const assignedRows = rows.filter(r => r.flatId !== '')

  async function handleSaveAll() {
    if (assignedRows.length === 0) return
    setSaving(true)

    const results = await Promise.all(
      assignedRows.map(r =>
        supabase
          .from('transactions')
          .update({
            flat_id:      r.flatId,
            flat_code:    r.flatCode,
            category:     'Maintenance',
            corpus:       'NO',
            fiscal_year:  toFiscalYear(r.valueDate),
            fiscal_month: toFiscalMonth(r.valueDate),
            fiscal_label: r.fiscalLabel,
          })
          .eq('id', r.txnId)
      )
    )

    setSaving(false)
    const errors = results.filter(r => r.error)
    if (errors.length > 0) {
      toast.error(`${errors.length} row(s) failed to save`)
      return
    }

    toast.success(`${assignedRows.length} payment(s) recorded successfully`)
    qc.invalidateQueries({ queryKey: ['dues'] })
    qc.invalidateQueries({ queryKey: ['unmatched-crs'] })
    onClose()
  }

  const isLoading = loadingCRs || loadingFlats

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Bulk Record Maintenance Payments</DialogTitle>
          <p className="text-sm mt-1" style={{ color: 'var(--ink-500)' }}>
            Assign each unmatched bank credit to a flat. Only rows with a flat selected will be saved.
          </p>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin" style={{ color: 'var(--ink-400)' }} />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <ListChecks size={32} style={{ color: 'var(--ink-300)' }} />
            <p className="text-sm" style={{ color: 'var(--ink-400)' }}>No unmatched CR transactions found</p>
            <p className="text-xs" style={{ color: 'var(--ink-400)' }}>All credits have already been attributed to flats</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b hairline text-left">
                  <th className="py-2 pr-3 font-semibold text-xs" style={{ color: 'var(--ink-500)' }}>Date</th>
                  <th className="py-2 pr-3 font-semibold text-xs" style={{ color: 'var(--ink-500)' }}>Description</th>
                  <th className="py-2 pr-3 font-semibold text-xs text-right" style={{ color: 'var(--ink-500)' }}>Amount</th>
                  <th className="py-2 pr-3 font-semibold text-xs" style={{ color: 'var(--ink-500)' }}>Flat</th>
                  <th className="py-2 font-semibold text-xs" style={{ color: 'var(--ink-500)' }}>Fiscal month</th>
                </tr>
              </thead>
              <tbody className="divide-y hairline">
                {rows.map(r => (
                  <tr key={r.txnId} className={r.flatId ? 'bg-green-50' : ''}>
                    <td className="py-2 pr-3 font-mono text-xs whitespace-nowrap" style={{ color: 'var(--ink-600)' }}>
                      {r.valueDate}
                    </td>
                    <td className="py-2 pr-3 text-xs max-w-[180px] truncate" style={{ color: 'var(--ink-700)' }}>
                      {r.description}
                    </td>
                    <td className="py-2 pr-3 text-xs text-right font-semibold tabular-nums" style={{ color: 'var(--ink-800)' }}>
                      {formatINR(r.amount)}
                    </td>
                    <td className="py-2 pr-3">
                      <Select
                        value={r.flatId}
                        onValueChange={val => {
                          const flat = flats.find(f => f.id === val)
                          if (flat) setRowFlat(r.txnId, flat.id, flat.code)
                        }}
                      >
                        <SelectTrigger className="h-7 text-xs w-28">
                          <SelectValue placeholder="Select flat" />
                        </SelectTrigger>
                        <SelectContent>
                          {flats.map(f => (
                            <SelectItem key={f.id} value={f.id}>
                              {f.code} ({f.block})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-2">
                      <Input
                        className="h-7 text-xs w-24 font-mono"
                        value={r.fiscalLabel}
                        onChange={e => setRowFiscalLabel(r.txnId, e.target.value)}
                        placeholder="Jun-26"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {rows.length > 0 && (
          <div className="border-t hairline pt-3 flex items-center justify-between gap-3 flex-shrink-0">
            <p className="text-xs" style={{ color: 'var(--ink-500)' }}>
              {assignedRows.length} of {rows.length} rows assigned
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                disabled={assignedRows.length === 0 || saving}
                onClick={handleSaveAll}
              >
                {saving
                  ? <><Loader2 size={14} className="animate-spin mr-1" /> Saving...</>
                  : `Record ${assignedRows.length} payment${assignedRows.length !== 1 ? 's' : ''}`
                }
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
