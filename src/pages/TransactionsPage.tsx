import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef } from 'ag-grid-community'
import {
  Upload as UploadIcon, CheckCircle, AlertTriangle, FileText,
  X, Plus, Trash2, Scissors, RefreshCw, Download, Copy,
  ListChecks, Loader2,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase, Transaction, ReviewEntry } from '@/lib/supabase'
import {
  parseStatement, tagTransaction, getFiscalLabel,
  getFiscalYear, getFiscalMonth, bankDateToISO, bankTimeTo24h, formatINR, FLAT_CODES, INCOME_CATS,
  guessSenderToken,
} from '@/lib/tagger'
import { formatDateDMY } from '@/lib/date'
import { useRoleCtx } from '@/contexts/RoleContext'
import { toast } from 'sonner'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'


type Tab = 'upload' | 'review' | 'all'

const EXPENSE_CATS = ['SALARY','EB','CIVIL','SEWAGE','LIFT SERVICE','LIFT','INTERNET','EXPENSES','FD','CCTV/MOTOR']

// A sender ID shorter than this is a fragment, not an identifier — bulk-applying on it would
// sweep in unrelated review rows, so the capture flow saves the ID but skips the bulk step.
const MIN_BULK_APPLY_TOKEN_LEN = 4

// `%` and `_` are LIKE wildcards; a sender ID containing one must match literally.
const escapeLike = (s: string) => s.replace(/[\\%_]/g, m => '\\' + m)

// ── MAIN PAGE ─────────────────────────────────────────────────
export default function TransactionsPage() {
  const [params] = useSearchParams()
  const { canWrite } = useRoleCtx()
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || (canWrite ? 'upload' : 'all'))

  const { data: reviewCount, refetch: refetchCount } = useQuery({
    queryKey: ['review-count'],
    queryFn: async () => {
      const { count } = await supabase.from('v_review_queue').select('*', { count: 'exact', head: true })
      return count ?? 0
    },
    refetchInterval: 30_000,
  })

  const visibleTabs = [
    ...(canWrite ? [{ key: 'upload' as Tab, label: 'Upload' }] : []),
    { key: 'review' as Tab, label: `Review${reviewCount ? ` (${reviewCount})` : ''}` },
    { key: 'all' as Tab,    label: 'All Transactions' },
  ]

  return (
    <div className="flex flex-col gap-5 fade-in">
      <div>
        <h1 className="text-[24px] font-extrabold">Transactions</h1>
        <p className="text-[13.5px] mt-1" style={{ color: 'var(--ink-500)' }}>Upload statements, review unknowns, browse all data</p>
      </div>


      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl p-1 flex-wrap" style={{ background: 'var(--ink-100)' }}>
        {visibleTabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors
              ${tab === key ? 'bg-white shadow-sm' : 'hover:bg-[var(--ink-50)]'}`}
            style={tab === key ? { color: 'var(--ink-900)' } : { color: 'var(--ink-500)' }}
          >
            {label}
          </button>
        ))}
      </div>

      {canWrite && tab === 'upload' && <UploadTab onImported={() => { setTab('review'); refetchCount() }} />}
      {tab === 'review' && <ReviewTab />}
      {tab === 'all'    && <AllTransactionsTab />}
    </div>
  )
}

// ── UPLOAD TAB ────────────────────────────────────────────────
type UploadStage = 'idle' | 'parsing' | 'preview' | 'importing' | 'done'

interface PreviewRow {
  txn_id: string | null
  value_date: string
  posted_date: string | null
  posted_time: string | null
  description: string
  cr_dr: 'CR' | 'DR'
  amount: number
  flat_id: string | null
  flat_code: string
  category: string
  corpus: 'YES' | 'NO'
  fiscal_year: number
  fiscal_month: string
  fiscal_label: string
  _confidence: 'Auto' | 'REVIEW'
}

interface ImportResult {
  total: number; added: number; duplicates: number; review: number; monthLabel: string
}

function UploadTab({ onImported }: { onImported: () => void }) {
  const [stage, setStage]           = useState<UploadStage>('idle')
  const [dragging, setDragging]     = useState(false)
  const [error, setError]           = useState('')
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [preview, setPreview]       = useState<{ rows: PreviewRow[]; duplicates: number; totalInFile: number } | null>(null)
  const [result, setResult]         = useState<ImportResult | null>(null)
  const qc = useQueryClient()

  async function parseFile(file: File) {
    setStage('parsing'); setError('')
    try {
      const text = await file.text()
      const parsed = parseStatement(text)
      if (parsed.length === 0) throw new Error('No transactions found. Supported formats: ICICI PSV (.txt/.psv), or any CSV with Date / Description / Debit / Credit columns.')

      const { data: existingRaw } = await supabase.from('transactions').select('txn_id').not('txn_id', 'is', null)
      const existingIds = new Set((existingRaw ?? []).map(r => r.txn_id))

      const { data: flats } = await supabase.from('flats').select('id,code,maintenance_amt')
      const flatMap = new Map((flats ?? []).map(f => [f.code, f.id]))
      const { data: residents } = await supabase.from('residents').select('upi_ids,flat_id,flat:flat_id(code)').eq('is_active', true)
      const dynamicUpiMap: Record<string, string> = {}
      ;(residents ?? []).forEach((r: any) => {
        const code = r.flat?.code
        if (code) (r.upi_ids ?? []).forEach((upi: string) => { if (upi) dynamicUpiMap[upi.toLowerCase()] = code })
      })

      const previewRows: PreviewRow[] = []
      let duplicates = 0
      for (const txn of parsed) {
        if (txn.txnId && existingIds.has(txn.txnId)) { duplicates++; continue }
        const tag = tagTransaction(txn.description, txn.crDr, dynamicUpiMap)
        previewRows.push({
          txn_id: txn.txnId || null,
          value_date: bankDateToISO(txn.valueDate),
          posted_date: bankDateToISO(txn.postedDate),
          posted_time: bankTimeTo24h(txn.postedTime),
          description: txn.description, cr_dr: txn.crDr, amount: txn.amount,
          flat_id: flatMap.get(tag.flatCode) ?? null,
          flat_code: tag.flatCode, category: tag.category, corpus: tag.corpus,
          fiscal_year: getFiscalYear(txn.valueDate),
          fiscal_month: getFiscalMonth(txn.valueDate),
          fiscal_label: getFiscalLabel(txn.valueDate),
          _confidence: tag.confidence,
        })
      }

      setPendingFile(file)
      setPreview({ rows: previewRows, duplicates, totalInFile: parsed.length })
      setStage('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setStage('idle')
    }
  }

  async function confirmImport() {
    if (!preview || !pendingFile) return
    setStage('importing')
    try {
      const { rows } = preview
      const ts = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '')
      const renamedFile = `${pendingFile.name.replace(/\.[^.]+$/, '')}_${ts}.${pendingFile.name.split('.').pop() ?? 'txt'}`

      const { data: storageData } = await supabase.storage.from('raw-statements').upload(`uploads/${renamedFile}`, pendingFile, { upsert: false })
      const { data: uploadRecord } = await supabase.from('uploads').insert({
        filename: renamedFile, original_name: pendingFile.name,
        storage_path: storageData?.path ?? null, status: 'processing',
      }).select('id').single()
      const uploadId = uploadRecord?.id ?? null

      const reviewCount = rows.filter(r => r._confidence === 'REVIEW').length
      const { data: activePlans } = await supabase.from('corpus_plans').select('id').eq('status', 'active')
      const soleActivePlanId = activePlans?.length === 1 ? activePlans[0].id : null
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const toInsert = rows.map(({ _confidence, ...r }) => ({
        ...r, source: `Import:${renamedFile}`, upload_id: uploadId, row_type: 'Normal' as const,
        plan_id: r.corpus === 'YES' ? soleActivePlanId : null,
      }))

      for (let i = 0; i < toInsert.length; i += 100) {
        const { error: ie } = await supabase.from('transactions').insert(toInsert.slice(i, i + 100))
        if (ie) throw new Error(ie.message)
      }

      const monthLabel = rows[0]?.fiscal_label ?? ''
      if (uploadId) {
        await supabase.from('uploads').update({
          month_label: monthLabel, total_txns: preview.totalInFile,
          new_txns: rows.length, duplicates: preview.duplicates,
          review_count: reviewCount, status: 'processed',
        }).eq('id', uploadId)
      }

      qc.invalidateQueries()
      setResult({ total: preview.totalInFile, added: rows.length, duplicates: preview.duplicates, review: reviewCount, monthLabel })
      setStage('done')
      if (reviewCount > 0) onImported()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setStage('preview')
    }
  }

  function reset() { setStage('idle'); setPreview(null); setPendingFile(null); setResult(null); setError('') }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]; if (file) parseFile(file)
  }, [])

  return (
    <div className="flex flex-col gap-4">
      {stage === 'idle' && (
        <label
          className={`flex flex-col items-center justify-center gap-3 p-10 rounded-2xl cursor-pointer
                      border-2 border-dashed transition-colors bg-white max-w-2xl
                      ${dragging ? 'border-brand-500 bg-brand-50' : 'hover:border-[var(--brand-300)]'}`}
          style={dragging ? undefined : { borderColor: 'var(--ink-200)' }}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <div className="w-16 h-16 rounded-full bg-brand-50 flex items-center justify-center">
            <UploadIcon size={28} className="text-brand-700" />
          </div>
          <div className="text-center">
            <p className="font-semibold text-slate-700">Click to select or drag & drop</p>
            <p className="text-sm text-slate-400 mt-1">ICICI PSV (.txt / .psv) or any bank CSV with Date, Description, Debit/Credit columns</p>
          </div>
          <input type="file" accept=".txt,.psv,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) parseFile(f) }} />
        </label>
      )}

      {(stage === 'parsing' || stage === 'importing') && (
        <div className="surface !p-10 flex flex-col items-center gap-4 max-w-2xl">
          <div className="w-12 h-12 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <p className="font-semibold text-slate-700">{stage === 'parsing' ? 'Reading file…' : 'Importing…'}</p>
          {stage === 'parsing' && <p className="text-sm text-slate-400">Auto-tagging flat codes, matching UPI IDs</p>}
        </div>
      )}

      {error && (
        <div className="surface !p-4 bg-red-50 border border-red-200 flex gap-3 max-w-2xl">
          <AlertTriangle size={20} className="text-red-600 shrink-0 mt-0.5" />
          <div><p className="font-medium text-red-800">Error</p><p className="text-sm text-red-600 mt-1">{error}</p></div>
        </div>
      )}

      {stage === 'preview' && preview && (
        <ImportPreview
          preview={preview}
          onRowEdited={(rowIndex, patch) => {
            setPreview(p => {
              if (!p) return p
              const next = [...p.rows]
              next[rowIndex] = { ...next[rowIndex], ...patch }
              return { ...p, rows: next }
            })
          }}
          fileName={pendingFile?.name ?? ''}
          onConfirm={confirmImport}
          onCancel={reset}
        />
      )}

      {stage === 'done' && result && (
        <div className="flex flex-col gap-3 max-w-2xl">
          <div className="surface !p-4 bg-green-50 border border-green-200 flex gap-3">
            <CheckCircle size={20} className="text-green-600 shrink-0 mt-0.5" />
            <p className="font-semibold text-green-800">Import complete — {result.monthLabel}</p>
          </div>
          <div className="surface !p-0">
            <div className="divide-rows">
              {[
                { label: 'Transactions in file', value: result.total,      cls: '' },
                { label: 'New rows added',        value: result.added,     cls: 'text-green-700 font-semibold' },
                { label: 'Duplicates skipped',    value: result.duplicates,cls: 'text-slate-400' },
                { label: 'Needs review',          value: result.review,    cls: result.review > 0 ? 'text-orange-600 font-semibold' : '' },
              ].map(({ label, value, cls }) => (
                <div key={label} className="flex justify-between px-4 py-3 text-sm">
                  <span className="text-slate-600">{label}</span>
                  <span className={cls}>{value}</span>
                </div>
              ))}
            </div>
          </div>
          <button onClick={reset} className="btn-secondary w-full">Import another file</button>
        </div>
      )}

      {stage === 'idle' && <UploadHistory />}
    </div>
  )
}

function ImportPreview({ preview, fileName, onConfirm, onCancel, onRowEdited }: {
  preview: { rows: PreviewRow[]; duplicates: number; totalInFile: number }
  fileName: string
  onConfirm: () => void
  onCancel: () => void
  onRowEdited: (rowIndex: number, patch: Partial<PreviewRow>) => void
}) {
  const { isAdmin } = useRoleCtx()
  const reviewCount = preview.rows.filter(r => r._confidence === 'REVIEW').length
  const [captureRow, setCaptureRow] = useState<{ flatCode: string; flatId: string; description: string } | null>(null)

  const { data: flats = [] } = useQuery({
    queryKey: ['flats-for-preview-edit'],
    queryFn: async () => {
      const { data } = await supabase.from('flats').select('id, code').order('code')
      return (data ?? []) as { id: string; code: string }[]
    },
  })
  const flatCodeOptions = useMemo(() => ['', ...flats.map(f => f.code)], [flats])
  const categoryOptions = useMemo(() => ['', 'Maintenance', 'Corpus', ...INCOME_CATS, ...EXPENSE_CATS], [])
  const flatIdByCode = useMemo(() => new Map(flats.map(f => [f.code, f.id])), [flats])

  const colDefs = useMemo((): ColDef<any>[] => [
    { field: 'value_date',   headerName: 'Date',       width: 110, valueFormatter: p => formatDateDMY(p.value) },
    { field: 'fiscal_label', headerName: 'Month',      width: 90  },
    { field: 'cr_dr',        headerName: 'CR/DR',      width: 75,
      cellRenderer: (p: any) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${p.value === 'CR' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {p.value}
        </span>
      ),
    },
    { field: 'amount', headerName: 'Amount', width: 110, type: 'numericColumn',
      valueFormatter: (p: any) => formatINR(p.value),
    },
    {
      field: 'flat_code', headerName: 'Flat / Cat', width: 110, filter: true,
      editable: true,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: { values: flatCodeOptions },
      onCellValueChanged: (e: any) => {
        const wasReview = e.data._confidence === 'REVIEW'
        const newCode = e.newValue ?? ''
        const newFlatId = newCode ? (flatIdByCode.get(newCode) ?? null) : null
        const patch: Partial<PreviewRow> = { flat_code: newCode, flat_id: newFlatId }
        // If linking to a flat for the first time on a CR row, default category to Maintenance
        if (newCode && e.data.cr_dr === 'CR' && !e.data.category) patch.category = 'Maintenance'
        patch._confidence = 'Auto'
        onRowEdited(e.rowIndex, patch)
        // Resolving a previously-unrecognized row here skips the Review tab entirely (it's
        // already 'Auto' on import), so this is the only chance to capture the sender's ID —
        // otherwise the same sender shows up as unrecognized again on every future statement.
        if (isAdmin && wasReview && newCode && newFlatId) {
          setCaptureRow({ flatCode: newCode, flatId: newFlatId, description: e.data.description })
        }
      },
    },
    {
      field: 'category', headerName: 'Category', width: 130, filter: true,
      editable: true,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: { values: categoryOptions },
      onCellValueChanged: (e: any) => {
        const patch: Partial<PreviewRow> = { category: e.newValue ?? '', _confidence: 'Auto' }
        if (e.newValue === 'Corpus') patch.corpus = 'YES'
        else if (e.newValue === 'Maintenance') patch.corpus = 'NO'
        onRowEdited(e.rowIndex, patch)
      },
    },
    { field: '_confidence', headerName: 'Match',    width: 90, filter: true,
      cellRenderer: (p: any) => p.value === 'REVIEW'
        ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-700">REVIEW</span>
        : <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-green-100 text-green-700">Auto</span>,
    },
    { field: 'description', headerName: 'Description', flex: 1, minWidth: 200 },
  ], [flatCodeOptions, categoryOptions, flatIdByCode, onRowEdited])

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="surface !p-4 bg-slate-50">
          <p className="text-xs text-slate-500 mb-1">In file</p>
          <p className="text-2xl font-bold text-slate-800">{preview.totalInFile}</p>
        </div>
        <div className="surface !p-4 bg-green-50">
          <p className="text-xs text-slate-500 mb-1">To import</p>
          <p className="text-2xl font-bold text-green-700">{preview.rows.length}</p>
        </div>
        <div className="surface !p-4 bg-slate-50">
          <p className="text-xs text-slate-500 mb-1">Duplicates (skip)</p>
          <p className="text-2xl font-bold text-slate-400">{preview.duplicates}</p>
        </div>
        <div className={`surface !p-4 ${reviewCount > 0 ? 'bg-amber-50' : 'bg-green-50'}`}>
          <p className="text-xs text-slate-500 mb-1">Needs review</p>
          <p className={`text-2xl font-bold ${reviewCount > 0 ? 'text-amber-600' : 'text-green-600'}`}>{reviewCount}</p>
        </div>
      </div>

      <p className="text-xs text-slate-400 flex items-center gap-1.5 flex-wrap">
        <FileText size={12} /> {fileName}
        <span className="ml-2">· Click any <b>Flat / Cat</b> or <b>Category</b> cell to correct before importing</span>
        {reviewCount > 0 && <span className="ml-2 text-amber-600">· Amber rows need attention</span>}
      </p>

      <div className="rounded-xl overflow-hidden border hairline" style={{ height: 440 }}>
        <AgGridReact
          rowData={preview.rows}
          columnDefs={colDefs}
          defaultColDef={{ sortable: true, resizable: true, filter: true, floatingFilter: true }}
          pagination={true}
          paginationPageSize={25}
          singleClickEdit={true}
          stopEditingWhenCellsLoseFocus={true}
          getRowStyle={(p: any) => p.data?._confidence === 'REVIEW' ? { background: '#fffbeb' } : undefined}
        />
      </div>

      <div className="flex gap-3 items-center">
        <button onClick={onCancel} className="btn-secondary px-6">Cancel</button>
        {preview.rows.length > 0 ? (
          <button onClick={onConfirm} className="btn-primary flex-1">
            Confirm — import {preview.rows.length} transaction{preview.rows.length !== 1 ? 's' : ''}
            {reviewCount > 0 ? ` · ${reviewCount} will need review` : ''}
          </button>
        ) : (
          <p className="flex-1 text-sm text-slate-400 text-center">
            All {preview.totalInFile} transaction{preview.totalInFile !== 1 ? 's' : ''} already in the database — nothing to import.
          </p>
        )}
      </div>

      {captureRow && (
        <SenderCaptureDialog row={captureRow} onClose={() => setCaptureRow(null)} />
      )}
    </div>
  )
}

function SenderCaptureDialog({ row, onClose }: {
  row: { flatCode: string; flatId: string; description: string }
  onClose: () => void
}) {
  const [token, setToken] = useState(() => guessSenderToken(row.description))
  const [residentId, setResidentId] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: residents = [] } = useQuery({
    queryKey: ['residents-active-lite'],
    queryFn: async () => {
      const { data } = await supabase.from('residents')
        .select('id, name, type, flat_id, upi_ids').eq('is_active', true)
      return (data ?? []) as { id: string; name: string; type: string; flat_id: string; upi_ids: string[] }[]
    },
  })
  const flatResidents = residents.filter(r => r.flat_id === row.flatId)

  async function handleSave() {
    if (!residentId || !token.trim()) { onClose(); return }
    setSaving(true)
    const tokens = Array.from(new Set(token.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)))

    // Fresh, unfiltered-by-active-status check — mirrors ReviewItem's capture guard and
    // LegacyMappingRow.handleConfirm in FlatsPage.
    const { data: conflictRows, error: conflictError } = await supabase
      .from('residents').select('id, name, upi_ids').neq('id', residentId)
    const conflictOwner = (conflictRows ?? []).find(
      r => ((r.upi_ids ?? []) as string[]).some(id => tokens.includes(id.toLowerCase())))

    if (conflictError) {
      toast.error(`Not saved — could not check for duplicates: ${conflictError.message}`)
    } else if (conflictOwner) {
      toast.error(`One of these sender IDs is already saved for ${conflictOwner.name} — not saved`)
    } else {
      const resident = residents.find(r => r.id === residentId)
      const merged = Array.from(new Set([...(resident?.upi_ids ?? []), ...tokens]))
      const { error } = await supabase.from('residents').update({ upi_ids: merged }).eq('id', residentId)
      if (error) toast.error(error.message)
      else toast.success(`Saved for ${resident?.name} — future imports from this sender will auto-tag ${row.flatCode}`)
    }
    setSaving(false)
    onClose()
  }

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Save sender ID for {row.flatCode}?</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <p className="text-xs" style={{ color: 'var(--ink-500)' }}>
            You just assigned an unrecognized transaction to {row.flatCode}. Save this sender so
            future imports auto-tag it instead of landing in Review.
          </p>
          <div>
            <label className="ds-lbl">Sender ID (comma separated for multiple)</label>
            <input type="text" value={token} onChange={e => setToken(e.target.value)} className="ds-field w-full" />
          </div>
          <div>
            <label className="ds-lbl">Resident</label>
            <select value={residentId} onChange={e => setResidentId(e.target.value)} className="ds-field w-full">
              <option value="">— select resident —</option>
              {flatResidents.map(r => <option key={r.id} value={r.id}>{r.name} ({r.type})</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="btn-secondary flex-1 text-sm">Skip</button>
          <button onClick={handleSave} disabled={!residentId || saving} className="btn-primary flex-1 text-sm">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function UploadHistory() {
  const [show, setShow] = useState(false)
  const { data, refetch } = useQuery({
    queryKey: ['uploads'],
    queryFn: async () => {
      const { data } = await supabase.from('uploads').select('*').order('created_at', { ascending: false }).limit(15)
      return data ?? []
    },
    enabled: show,
  })
  return (
    <div>
      {!show ? (
        <button onClick={() => { setShow(true); refetch() }} style={{ color: 'var(--brand-700)' }} className="flex items-center gap-1.5 text-sm hover:opacity-80">
          <FileText size={14} /> Show import history
        </button>
      ) : (
        <div className="surface !p-0">
          <div className="px-4 py-3 border-b hairline flex items-center justify-between">
            <h3 className="font-semibold text-sm">Import history</h3>
            <button onClick={() => setShow(false)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
          </div>
          {!data?.length ? (
            <p className="px-4 py-6 text-sm text-slate-400 text-center">No imports yet</p>
          ) : (
            <div className="divide-rows">
              {data.map((u: any) => (
                <div key={u.id} className="px-4 py-3 flex justify-between items-start text-sm">
                  <div>
                    <p className="font-medium">{u.month_label || '—'}</p>
                    <p className="text-[11px] mt-0.5 truncate max-w-xs" style={{ color: 'var(--ink-400)' }}>{u.original_name}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-slate-500">{u.new_txns} added</p>
                    {u.review_count > 0 && <span className="ds-badge-warn">{u.review_count} review</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── REVIEW TAB ────────────────────────────────────────────────
function ReviewTab() {
  const { canWrite, isAdmin } = useRoleCtx()
  const qc = useQueryClient()
  const [bulkOpen, setBulkOpen] = useState(false)
  const { data: items, isLoading } = useQuery({
    queryKey: ['review-queue'],
    queryFn: async () => {
      const { data } = await supabase.from('v_review_queue').select('*').order('value_date', { ascending: false })
      return (data ?? []) as ReviewEntry[]
    },
  })
  const { data: flats } = useQuery({
    queryKey: ['flats'],
    queryFn: async () => {
      const { data } = await supabase.from('flats').select('id,code,maintenance_amt')
      return data ?? []
    },
  })
  const { data: residents } = useQuery({
    queryKey: ['residents-active-lite'],
    queryFn: async () => {
      const { data } = await supabase.from('residents').select('id,name,type,flat_id,upi_ids').eq('is_active', true)
      return (data ?? []) as { id: string; name: string; type: string; flat_id: string; upi_ids: string[] }[]
    },
  })

  if (isLoading) return <div className="flex flex-col gap-2">{[...Array(5)].map((_, i) => <div key={i} className="h-16 animate-pulse rounded-[var(--ds-radius)]" style={{ background: 'var(--ink-100)' }} />)}</div>
  if (!items?.length) return (
    <div className="surface !p-12 flex flex-col items-center gap-3">
      <CheckCircle size={40} className="text-green-500" />
      <p className="font-semibold text-lg">All clear!</p>
      <p className="text-slate-500 text-sm">No transactions need review</p>
    </div>
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold">Review queue</h3>
        <span className="ds-badge-warn">{items.length} pending</span>
        {isAdmin && (
          <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)} className="ml-auto flex items-center gap-2">
            <ListChecks size={14} /> Bulk Record
          </Button>
        )}
      </div>
      <p className="text-sm text-slate-500">
        {canWrite
          ? "Auto-tagging couldn't identify these. Assign a flat or category."
          : "Auto-tagging couldn't identify these. Read-only view."}
      </p>
      <div className="grid gap-2 lg:grid-cols-2">
        {items.map(item => (
          <ReviewItem key={item.id} item={item} flats={flats ?? []} residents={residents ?? []} onSaved={() => qc.invalidateQueries()} />
        ))}
      </div>
      {bulkOpen && <BulkRecordDialog open={bulkOpen} onClose={() => setBulkOpen(false)} />}
    </div>
  )
}

// ── BULK RECORD DIALOG ────────────────────────────────────────
// Assign unmatched bank CR transactions (corpus=NO, no flat_id) to flats
// in a single table view; faster than reviewing items one-by-one.

interface UnmatchedCR { id: string; value_date: string; description: string; amount: number }
interface BulkRow {
  txnId: string; valueDate: string; description: string; amount: number
  flatId: string; flatCode: string; fiscalLabel: string
}

function bulkFiscalMonth(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.toLocaleDateString('en-GB', { month: 'short' })}-${d.getFullYear()}`
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
        .from('flats').select('id, code, block').order('code')
      if (error) throw error
      return (data ?? []) as { id: string; code: string; block: string }[]
    },
    enabled: open,
  })

  useEffect(() => {
    if (unmatchedCRs.length > 0) {
      setRows(unmatchedCRs.map(cr => ({
        txnId: cr.id, valueDate: cr.value_date, description: cr.description, amount: cr.amount,
        flatId: '', flatCode: '', fiscalLabel: getFiscalLabel(cr.value_date),
      })))
    }
  }, [unmatchedCRs])

  const setRowFlat       = (txnId: string, flatId: string, flatCode: string) =>
    setRows(prev => prev.map(r => r.txnId === txnId ? { ...r, flatId, flatCode } : r))
  const setRowFiscalLabel = (txnId: string, fiscalLabel: string) =>
    setRows(prev => prev.map(r => r.txnId === txnId ? { ...r, fiscalLabel } : r))

  const assignedRows = rows.filter(r => r.flatId !== '')

  async function handleSaveAll() {
    if (assignedRows.length === 0) return
    setSaving(true)
    const results = await Promise.all(assignedRows.map(r =>
      supabase.from('transactions').update({
        flat_id: r.flatId, flat_code: r.flatCode,
        category: 'Maintenance', corpus: 'NO',
        fiscal_year: getFiscalYear(r.valueDate),
        fiscal_month: bulkFiscalMonth(r.valueDate),
        fiscal_label: r.fiscalLabel,
      }).eq('id', r.txnId)
    ))
    setSaving(false)
    const errors = results.filter(r => r.error)
    if (errors.length > 0) { toast.error(`${errors.length} row(s) failed to save`); return }
    toast.success(`${assignedRows.length} payment(s) recorded successfully`)
    qc.invalidateQueries({ queryKey: ['dues'] })
    qc.invalidateQueries({ queryKey: ['unmatched-crs'] })
    qc.invalidateQueries({ queryKey: ['review-queue'] })
    qc.invalidateQueries({ queryKey: ['review-count'] })
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
                    <td className="py-2 pr-3 font-mono text-xs whitespace-nowrap" style={{ color: 'var(--ink-600)' }}>{r.valueDate}</td>
                    <td className="py-2 pr-3 text-xs max-w-[180px] truncate" style={{ color: 'var(--ink-700)' }}>{r.description}</td>
                    <td className="py-2 pr-3 text-xs text-right font-semibold tabular-nums" style={{ color: 'var(--ink-800)' }}>{formatINR(r.amount)}</td>
                    <td className="py-2 pr-3">
                      <Select
                        value={r.flatId}
                        onValueChange={val => {
                          const flat = flats.find(f => f.id === val)
                          if (flat) setRowFlat(r.txnId, flat.id, flat.code)
                        }}
                      >
                        <SelectTrigger className="h-7 text-xs w-28"><SelectValue placeholder="Select flat" /></SelectTrigger>
                        <SelectContent>
                          {flats.map(f => <SelectItem key={f.id} value={f.id}>{f.code} ({f.block})</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-2">
                      <Input className="h-7 text-xs w-24 font-mono" value={r.fiscalLabel}
                        onChange={e => setRowFiscalLabel(r.txnId, e.target.value)} placeholder="Jun-26" />
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
              <Button disabled={assignedRows.length === 0 || saving} onClick={handleSaveAll}>
                {saving
                  ? <><Loader2 size={14} className="animate-spin mr-1" /> Saving...</>
                  : `Record ${assignedRows.length} payment${assignedRows.length !== 1 ? 's' : ''}`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ReviewItem({ item, flats, residents, onSaved }: {
  item: ReviewEntry
  flats: any[]
  residents: { id: string; name: string; type: string; flat_id: string; upi_ids: string[] }[]
  onSaved: () => void
}) {
  const { canWrite, isAdmin } = useRoleCtx()
  const [flatCode, setFlatCode]   = useState('')
  const [category, setCategory]   = useState('Maintenance')
  const [corpus, setCorpus]       = useState<'YES' | 'NO'>('NO')
  const [planId, setPlanId]       = useState<string | null>(null)
  const [driveId, setDriveId] = useState<string | null>(null)
  const [contributorResidentId, setContributorResidentId] = useState<string | null>(null)
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)
  const [showSplit, setShowSplit] = useState(false)
  const [saveSender, setSaveSender]         = useState(false)
  const [senderToken, setSenderToken]       = useState(() => guessSenderToken(item.description))
  const [senderResidentId, setSenderResidentId] = useState('')

  const { data: activePlans = [] } = useQuery({
    queryKey: ['active-corpus-plans'],
    queryFn: async () => {
      const { data } = await supabase
        .from('corpus_plans')
        .select('id, name')
        .eq('status', 'active')
        .order('name')
      return (data ?? []) as { id: string; name: string }[]
    },
  })

  const { data: corpusCats = [] } = useQuery({
    queryKey: ['corpus-cat-names'],
    queryFn: async () => {
      const { data } = await supabase
        .from('expense_categories')
        .select('name')
        .eq('budget_type', 'Corpus')
        .order('name')
      return (data ?? []).map(c => c.name as string)
    },
  })

  const { data: openDrives = [] } = useQuery({
    queryKey: ['open-contribution-drives'],
    queryFn: async () => {
      const { data } = await supabase
        .from('contribution_drives')
        .select('id, name')
        .eq('status', 'open')
        .order('name')
      return (data ?? []) as { id: string; name: string }[]
    },
  })
  const driveIdByName = useMemo(() => new Map(openDrives.map(d => [d.name, d.id])), [openDrives])

  const isFlat = FLAT_CODES.includes(flatCode)
  const selectedFlat = flats.find(f => f.code === flatCode)

  // Multi-month hint
  const suggestedMonths = isFlat && selectedFlat && item.cr_dr === 'CR'
    ? Math.round(item.amount / selectedFlat.maintenance_amt)
    : 1
  const showMonthHint = suggestedMonths >= 2 && isFlat && category === 'Maintenance'

  const effectiveCorpus: 'YES' | 'NO' = isFlat && category === 'Corpus' ? 'YES' : corpus

  async function handleSave() {
    if (!flatCode) return
    const isContribution = category === 'Contribution'
    let resolvedPlanId = effectiveCorpus === 'YES' ? planId : null
    if (effectiveCorpus === 'YES' && !resolvedPlanId) {
      if (activePlans.length === 1) resolvedPlanId = activePlans[0].id
      else if (activePlans.length > 1) { toast.error('Select a corpus plan for this payment'); return }
    }
    let resolvedDriveId = isContribution ? driveId : null
    if (isContribution && !resolvedDriveId) {
      if (openDrives.length === 1) resolvedDriveId = openDrives[0].id
      else { toast.error('Select a contribution drive for this transaction'); return }
    }
    setSaving(true)
    const flatId = flats.find(f => f.code === flatCode)?.id ?? null
    const { error } = await supabase.from('transactions').update({
      flat_code: flatCode, flat_id: flatId,
      category: isContribution ? 'Contribution' : (isFlat ? category : flatCode),
      corpus: effectiveCorpus,
      plan_id: resolvedPlanId,
      drive_id: resolvedDriveId,
      resident_id: isContribution ? contributorResidentId : null,
      row_type: 'Normal',
    }).eq('id', item.id)
    if (!error && saveSender && senderResidentId && senderToken.trim()) {
      const tokens = Array.from(new Set(
        senderToken.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
      ))
      const label = tokens.length > 1 ? `${tokens.length} sender IDs` : tokens[0]

      // Check duplicates against a fresh, unfiltered read rather than the `residents` prop —
      // that prop is active-only and up to 5min stale, so it can miss a token already held by
      // an archived resident. Mirrors LegacyMappingRow.handleConfirm in FlatsPage.
      const { data: conflictRows, error: conflictError } = await supabase
        .from('residents')
        .select('id, name, upi_ids')
        .neq('id', senderResidentId)
      const conflictOwner = (conflictRows ?? []).find(
        r => ((r.upi_ids ?? []) as string[]).some(id => tokens.includes(id.toLowerCase())))

      if (conflictError) {
        toast.error(`${label} not saved — could not check for duplicates: ${conflictError.message}`)
      } else if (conflictOwner) {
        toast.error(`One of these sender IDs is already saved for ${conflictOwner.name} — not saved`)
      } else {
        const resident = residents.find(r => r.id === senderResidentId)
        const merged = Array.from(new Set([...(resident?.upi_ids ?? []), ...tokens]))
        const { error: residentError } = await supabase
          .from('residents').update({ upi_ids: merged }).eq('id', senderResidentId)

        if (residentError) {
          toast.error(`${label} not saved: ${residentError.message}`)
        } else {
          const bulkTokens = tokens.filter(t => t.length >= MIN_BULK_APPLY_TOKEN_LEN)
          if (bulkTokens.length > 0 && !isContribution) {
            // Only rows still in the review queue (v_review_queue = UNKNOWN + Normal). Without
            // the row_type filter a VOIDED row that kept flat_code='UNKNOWN' would be matched
            // and silently un-voided, double-counting it in every financial view.
            const matchIds = new Set<string>()
            let matchError: { message: string } | null = null
            for (const t of bulkTokens) {
              const { data, error: err } = await supabase
                .from('transactions')
                .select('id')
                .eq('flat_code', 'UNKNOWN')
                .eq('row_type', 'Normal')
                .eq('cr_dr', item.cr_dr)
                .ilike('description', `%${escapeLike(t)}%`)
                .neq('id', item.id)
              if (err) { matchError = err; break }
              for (const m of data ?? []) matchIds.add(m.id)
            }

            if (matchError) {
              toast.error(`Sender ID(s) saved, but the search for other matching transactions failed: ${matchError.message}`)
            } else if (matchIds.size > 0) {
              const plural = matchIds.size > 1 ? 's' : ''
              const { error: bulkError } = await supabase.from('transactions').update({
                flat_code: flatCode, flat_id: flatId,
                category: isContribution ? 'Contribution' : (isFlat ? category : flatCode),
                corpus: effectiveCorpus, plan_id: resolvedPlanId,
                drive_id: resolvedDriveId, resident_id: isContribution ? contributorResidentId : null,
              }).in('id', Array.from(matchIds))
              if (bulkError) toast.error(`Could not apply to ${matchIds.size} other matching transaction${plural}: ${bulkError.message}`)
              else toast.success(`Tagged as ${flatCode} — also applied to ${matchIds.size} other matching transaction${plural}`)
            }
          }
        }
      }
    }
    setSaving(false)
    if (!error) { setSaved(true); setTimeout(onSaved, 400) }
  }

  if (saved) return (
    <div className="surface !p-3 bg-green-50 flex items-center gap-2 text-sm">
      <CheckCircle size={15} className="text-green-600" />
      <span className="text-green-700">Tagged as {flatCode} · {category}</span>
    </div>
  )

  return (
    <>
      <div className="surface !p-4 flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${item.cr_dr === 'CR' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {item.cr_dr}
              </span>
              <span className="font-semibold">{formatINR(item.amount)}</span>
              <span className="text-xs text-slate-400">{formatDateDMY(item.value_date)}</span>
            </div>
            <p className="text-xs text-slate-500 mt-1 line-clamp-2">{item.description}</p>
          </div>
        </div>

        {/* Controls */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="ds-lbl">Flat / Category</label>
            <select
              value={flatCode}
              onChange={e => {
                const val = e.target.value
                setFlatCode(val)
                if (!FLAT_CODES.includes(val)) {
                  const driveIdForVal = driveIdByName.get(val) ?? null
                  setCategory(driveIdForVal ? 'Contribution' : val)
                  const isCorpusCat = corpusCats.includes(val)
                  setCorpus(isCorpusCat ? 'YES' : 'NO')
                  if (isCorpusCat && activePlans.length === 1) setPlanId(activePlans[0].id)
                  if (!isCorpusCat) setPlanId(null)
                  setDriveId(driveIdForVal)
                  setContributorResidentId(null)
                } else if (val !== flatCode) {
                  // Contributor is flat-scoped — a stale pick from the previous flat must not
                  // silently ride along onto the newly selected flat's Contribution row.
                  setContributorResidentId(null)
                }
              }}
              className="w-full ds-field bg-white"
            >
              <option value="">— Select —</option>
              <optgroup label="Flats">{FLAT_CODES.map(f => <option key={f} value={f}>{f}</option>)}</optgroup>
              <optgroup label="Income">{INCOME_CATS.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
              <optgroup label="Expenses">{EXPENSE_CATS.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
              <optgroup label="Corpus works">{corpusCats.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
              <optgroup label="Contributions">{openDrives.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}</optgroup>
            </select>
          </div>
          {isFlat && (
            <div>
              <label className="ds-lbl">Category</label>
              <select
                value={category}
                onChange={e => {
                  const val = e.target.value
                  setCategory(val)
                  if (val === 'Corpus') {
                    setCorpus('YES')
                    if (activePlans.length === 1) setPlanId(activePlans[0].id)
                    setDriveId(null)
                  } else if (val === 'Contribution') {
                    setCorpus('NO')
                    setPlanId(null)
                    setDriveId(openDrives.length === 1 ? openDrives[0].id : null)
                  } else {
                    setCorpus('NO')
                    setPlanId(null)
                    setDriveId(null)
                    setContributorResidentId(null)
                  }
                }}
                className="w-full ds-field bg-white"
              >
                <option value="Maintenance">Maintenance</option>
                <option value="Corpus">Corpus</option>
                {openDrives.length > 0 && <option value="Contribution">Contribution</option>}
              </select>
            </div>
          )}
        </div>

        {effectiveCorpus === 'YES' && activePlans.length > 1 && (
          <div className="flex flex-col gap-1">
            <Label>Corpus plan</Label>
            <Select
              value={planId ?? ''}
              onValueChange={v => setPlanId(v || null)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select plan…" />
              </SelectTrigger>
              <SelectContent>
                {activePlans.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {category === 'Contribution' && openDrives.length > 1 && (
          <div className="flex flex-col gap-1">
            <Label>Contribution drive</Label>
            <Select value={driveId ?? ''} onValueChange={v => setDriveId(v || null)}>
              <SelectTrigger>
                <SelectValue placeholder="Select drive…" />
              </SelectTrigger>
              <SelectContent>
                {openDrives.map(d => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {category === 'Contribution' && isFlat && (
          <div>
            <label className="ds-lbl">Contributor (optional)</label>
            <select
              value={contributorResidentId ?? ''}
              onChange={e => setContributorResidentId(e.target.value || null)}
              className="w-full ds-field bg-white"
            >
              <option value="">— Not specified —</option>
              {residents.filter(r => r.flat_id === selectedFlat?.id).map(r => (
                <option key={r.id} value={r.id}>{r.name} ({r.type})</option>
              ))}
            </select>
          </div>
        )}

        {showMonthHint && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
            This looks like <strong>{suggestedMonths} months</strong> of maintenance (
            {suggestedMonths} × {formatINR(selectedFlat.maintenance_amt)})
          </div>
        )}

        {isAdmin && isFlat && (
          <div className="flex flex-col gap-2 border-t hairline pt-2">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={saveSender} onChange={e => setSaveSender(e.target.checked)} />
              Also save this sender ID for a resident of {flatCode}
            </label>
            {saveSender && (
              <div className="grid grid-cols-2 gap-2">
                <input type="text" value={senderToken} onChange={e => setSenderToken(e.target.value)}
                  className="ds-field text-xs" placeholder="sender ID (comma separated for multiple)" />
                <select value={senderResidentId} onChange={e => setSenderResidentId(e.target.value)} className="ds-field text-xs">
                  <option value="">— select resident —</option>
                  {residents.filter(r => r.flat_id === selectedFlat?.id).map(r => (
                    <option key={r.id} value={r.id}>{r.name} ({r.type})</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          {canWrite && (
            <button onClick={handleSave} disabled={!flatCode || saving} className="btn-primary flex-1 text-sm py-2">
              {saving ? <span className="flex justify-center"><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /></span> : 'Save tag'}
            </button>
          )}
          {canWrite && item.cr_dr === 'CR' && (
            <button onClick={() => setShowSplit(true)} className="btn-secondary text-sm px-3 py-2 flex items-center gap-1.5">
              <Scissors size={14} /> Split
            </button>
          )}
        </div>
      </div>

      {showSplit && (
        <SplitModal txn={item as unknown as Transaction} onClose={() => setShowSplit(false)} onSaved={() => { setShowSplit(false); onSaved() }} flats={flats} />
      )}
    </>
  )
}

// ── EDIT MODAL ────────────────────────────────────────────────
function EditModal({ txn, flats, residents, onClose, onSaved, onSplit, onVoided }: {
  txn: Transaction
  flats: any[]
  residents: { id: string; name: string; type: string; flat_id: string }[]
  onClose: () => void
  onSaved: (updated: Transaction) => void
  onSplit: () => void
  onVoided: () => void
}) {
  const { isAdmin } = useRoleCtx()
  const isFlat = (code: string) => FLAT_CODES.includes(code)

  const [flatCode,     setFlatCode]     = useState(txn.flat_code ?? '')
  const [category,     setCategory]     = useState(txn.category ?? '')
  const [corpus,       setCorpus]       = useState<'YES' | 'NO'>(txn.corpus ?? 'NO')
  const [planId,       setPlanId]       = useState<string | null>(txn.plan_id ?? null)
  const [driveId,      setDriveId]      = useState<string | null>(txn.drive_id ?? null)
  const [residentId,   setResidentId]   = useState<string | null>(txn.resident_id ?? null)
  const [saving,       setSaving]       = useState(false)
  const [copied,       setCopied]       = useState(false)
  const [confirmVoid,  setConfirmVoid]  = useState(false)
  const [voiding,      setVoiding]      = useState(false)

  const { data: activePlans = [] } = useQuery({
    queryKey: ['active-corpus-plans'],
    queryFn: async () => {
      const { data } = await supabase
        .from('corpus_plans')
        .select('id, name')
        .eq('status', 'active')
        .order('name')
      return (data ?? []) as { id: string; name: string }[]
    },
  })

  const { data: corpusCats = [] } = useQuery({
    queryKey: ['corpus-cat-names'],
    queryFn: async () => {
      const { data } = await supabase
        .from('expense_categories')
        .select('name')
        .eq('budget_type', 'Corpus')
        .order('name')
      return (data ?? []).map(c => c.name as string)
    },
  })

  const { data: openDrives = [] } = useQuery({
    queryKey: ['open-contribution-drives'],
    queryFn: async () => {
      const { data } = await supabase
        .from('contribution_drives')
        .select('id, name')
        .eq('status', 'open')
        .order('name')
      return (data ?? []) as { id: string; name: string }[]
    },
  })
  const driveIdByName = useMemo(() => new Map(openDrives.map(d => [d.name, d.id])), [openDrives])

  function handleFlatChange(val: string) {
    setFlatCode(val)
    if (!isFlat(val)) {
      const driveIdForVal = driveIdByName.get(val) ?? null
      setCategory(driveIdForVal ? 'Contribution' : val)
      const isCorpusCat = corpusCats.includes(val)
      setCorpus(isCorpusCat ? 'YES' : 'NO')
      if (isCorpusCat && activePlans.length === 1) setPlanId(activePlans[0].id)
      if (!isCorpusCat) setPlanId(null)
      setDriveId(driveIdForVal)
      setResidentId(null)
    }
    else { setCategory('Maintenance'); setCorpus('NO'); setPlanId(null); setDriveId(null); setResidentId(null) }
  }

  function handleCategoryChange(val: string) {
    setCategory(val)
    if (val === 'Corpus') {
      setCorpus('YES')
      if (activePlans.length === 1) setPlanId(activePlans[0].id)
      setDriveId(null)
    } else if (val === 'Contribution') {
      setCorpus('NO')
      setPlanId(null)
      setDriveId(openDrives.length === 1 ? openDrives[0].id : null)
    } else {
      setCorpus('NO')
      setPlanId(null)
      setDriveId(null)
      setResidentId(null)
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(txn.description)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleSave() {
    const isContribution = category === 'Contribution'
    let resolvedPlanId = corpus === 'YES' ? planId : null
    if (corpus === 'YES' && !resolvedPlanId) {
      if (activePlans.length === 1) resolvedPlanId = activePlans[0].id
      else if (activePlans.length > 1) { toast.error('Select a corpus plan for this transaction'); return }
    }
    let resolvedDriveId = isContribution ? driveId : null
    if (isContribution && !resolvedDriveId) {
      if (openDrives.length === 1) resolvedDriveId = openDrives[0].id
      else { toast.error('Select a contribution drive for this transaction'); return }
    }
    setSaving(true)
    const flatId = flats.find(f => f.code === flatCode)?.id ?? null
    const resolvedCategory = isContribution ? 'Contribution' : (isFlat(flatCode) ? category : flatCode)
    const resolvedResidentId = isContribution ? residentId : null
    const { error } = await supabase.from('transactions').update({
      flat_code: flatCode, flat_id: flatId, category: resolvedCategory, corpus,
      plan_id: resolvedPlanId, drive_id: resolvedDriveId, resident_id: resolvedResidentId,
    }).eq('id', txn.id)
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('Transaction updated')
    onSaved({ ...txn, flat_code: flatCode, flat_id: flatId, category: resolvedCategory, corpus, plan_id: resolvedPlanId, drive_id: resolvedDriveId, resident_id: resolvedResidentId })
  }

  async function handleVoid() {
    if (txn.source === 'Direct') {
      toast.error('Direct payment rows are managed from their expense')
      return
    }
    setVoiding(true)
    const { error } = await supabase.from('transactions').update({ row_type: 'VOIDED' }).eq('id', txn.id)
    setVoiding(false)
    if (error) { toast.error(error.message); return }
    toast.success('Transaction voided')
    onVoided()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-[85vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-5 border-b hairline shrink-0">
          <div>
            <h3 className="font-semibold">Edit transaction</h3>
            <p className="text-sm text-slate-500 mt-0.5">{formatDateDMY(txn.value_date)} · {formatINR(txn.amount)}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--ink-100)]"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
          {/* Full description + copy */}
          <div className="rounded-lg p-3" style={{ background: 'var(--ink-50)' }}>
            <p className="text-xs text-slate-600 break-words">{txn.description}</p>
            <button onClick={handleCopy}
              className="flex items-center gap-1 mt-2 text-xs text-slate-400 hover:text-slate-600 transition-colors">
              {copied
                ? <CheckCircle size={11} className="text-green-600" />
                : <Copy size={11} />
              }
              <span>{copied ? 'Copied!' : 'Copy'}</span>
            </button>
          </div>

          <div>
            <label className="ds-lbl">Flat / Category</label>
            <select value={flatCode} onChange={e => handleFlatChange(e.target.value)}
              className="w-full ds-field">
              <option value="">— Select —</option>
              <optgroup label="Flats">{FLAT_CODES.map(f => <option key={f} value={f}>{f}</option>)}</optgroup>
              <optgroup label="Income">{INCOME_CATS.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
              <optgroup label="Expenses">{EXPENSE_CATS.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
              <optgroup label="Corpus works">{corpusCats.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
              <optgroup label="Contributions">{openDrives.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}</optgroup>
            </select>
          </div>

          {isFlat(flatCode) && (
            <div>
              <label className="ds-lbl">Type</label>
              <select value={category} onChange={e => handleCategoryChange(e.target.value)}
                className="w-full ds-field">
                <option value="Maintenance">Maintenance</option>
                <option value="Corpus">Corpus</option>
                {openDrives.length > 0 && <option value="Contribution">Contribution</option>}
              </select>
            </div>
          )}

          {!isFlat(flatCode) && category !== 'Contribution' && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={corpus === 'YES'} onChange={e => {
                const checked = e.target.checked
                setCorpus(checked ? 'YES' : 'NO')
                if (checked && !planId && activePlans.length === 1) setPlanId(activePlans[0].id)
                if (!checked) setPlanId(null)
              }}
                className="w-4 h-4 rounded" />
              <span className="text-slate-700">Corpus {txn.cr_dr === 'DR' ? 'expenditure' : 'collection'}</span>
              <span className="text-xs text-slate-400">{txn.cr_dr === 'DR' ? '(from corpus fund)' : '(corpus)'}</span>
            </label>
          )}

          {corpus === 'YES' && activePlans.length >= 1 && (
            <div className="flex flex-col gap-1">
              <Label>Corpus plan</Label>
              <Select
                value={planId ?? ''}
                onValueChange={v => setPlanId(v || null)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select plan…" />
                </SelectTrigger>
                <SelectContent>
                  {activePlans.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {category === 'Contribution' && openDrives.length > 1 && (
            <div className="flex flex-col gap-1">
              <Label>Contribution drive</Label>
              <Select value={driveId ?? ''} onValueChange={v => setDriveId(v || null)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select drive…" />
                </SelectTrigger>
                <SelectContent>
                  {openDrives.map(d => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {category === 'Contribution' && isFlat(flatCode) && (
            <div>
              <label className="ds-lbl">Contributor (optional)</label>
              <select
                value={residentId ?? ''}
                onChange={e => setResidentId(e.target.value || null)}
                className="w-full ds-field"
              >
                <option value="">— Not specified —</option>
                {residents.filter(r => r.flat_id === flats.find(f => f.code === flatCode)?.id).map(r => (
                  <option key={r.id} value={r.id}>{r.name} ({r.type})</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={handleSave} disabled={saving || !flatCode}
              className="btn-primary flex-1 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button onClick={onClose} className="btn-secondary px-4">Cancel</button>
          </div>

          {/* Secondary actions */}
          <div className="border-t hairline pt-3 flex gap-2">
            {txn.cr_dr === 'CR' && (
              <button onClick={() => {
                if (txn.drive_id) {
                  toast.error('This transaction is tagged to a contribution drive — splitting would remove it from the drive. Not supported yet.')
                  return
                }
                onSplit()
              }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-[var(--ink-100)] flex-1 justify-center">
                <Scissors size={13} /> Split
              </button>
            )}
            {isAdmin && (!confirmVoid ? (
              <button onClick={() => setConfirmVoid(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-300 text-red-600 text-sm hover:bg-red-50 flex-1 justify-center">
                <Trash2 size={13} /> Void
              </button>
            ) : (
              <div className="flex items-center gap-2 flex-1">
                <span className="text-xs text-red-600 font-medium flex-1">Void this?</span>
                <button onClick={handleVoid} disabled={voiding}
                  className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                  {voiding ? 'Voiding…' : 'Yes, void'}
                </button>
                <button onClick={() => setConfirmVoid(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm hover:bg-[var(--ink-100)]">
                  No
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── SPLIT MODAL ───────────────────────────────────────────────
interface SplitRow { flatCode: string; category: string; corpus: 'YES' | 'NO'; amount: string; planId?: string | null }

function SplitModal({ txn, onClose, onSaved, flats }: {
  txn: Transaction; onClose: () => void; onSaved: () => void; flats: any[]
}) {
  const [rows, setRows] = useState<SplitRow[]>([
    { flatCode: '', category: 'Maintenance', corpus: 'NO', amount: '' },
    { flatCode: '', category: 'Maintenance', corpus: 'NO', amount: '' },
  ])
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  const { data: activePlans = [] } = useQuery({
    queryKey: ['active-corpus-plans'],
    queryFn: async () => {
      const { data } = await supabase
        .from('corpus_plans')
        .select('id, name')
        .eq('status', 'active')
        .order('name')
      return (data ?? []) as { id: string; name: string }[]
    },
  })

  const total = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  const remaining = txn.amount - total

  function updateRow(i: number, field: keyof SplitRow, val: string) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r))
  }

  async function handleSave() {
    if (Math.abs(remaining) > 0.01) { setError(`Amounts must sum to ${formatINR(txn.amount)}`); return }
    if (rows.some(r => !r.flatCode || !r.amount)) { setError('All rows must have flat/category and amount'); return }
    if (activePlans.length > 1 && rows.some(r => r.corpus === 'YES' && !r.planId)) {
      setError('Select a corpus plan for each corpus row'); return
    }
    setSaving(true); setError('')

    // Create split_ref
    const refCode = `SPL-${Date.now().toString().slice(-5)}`
    const { data: splitRef } = await supabase.from('split_refs').insert({
      ref_code: refCode, original_amount: txn.amount, split_count: rows.length, notes: txn.description,
    }).select('id').single()

    // Void original
    await supabase.from('transactions').update({ row_type: 'VOIDED' }).eq('id', txn.id)

    // Insert split rows
    const flatMap = new Map(flats.map(f => [f.code, f.id]))
    const splitRows = rows.map(r => ({
      txn_id: null, value_date: txn.value_date, posted_date: txn.posted_date, posted_time: txn.posted_time,
      description: `${txn.description} [${refCode}]`,
      cr_dr: txn.cr_dr, amount: parseFloat(r.amount),
      flat_id: flatMap.get(r.flatCode) ?? null, flat_code: r.flatCode,
      category: FLAT_CODES.includes(r.flatCode) ? r.category : r.flatCode,
      corpus: r.corpus,
      plan_id: r.corpus === 'YES' ? (r.planId ?? (activePlans.length === 1 ? activePlans[0].id : null)) : null,
      fiscal_year: txn.fiscal_year, fiscal_month: txn.fiscal_month,
      fiscal_label: txn.fiscal_label, source: txn.source, upload_id: txn.upload_id,
      split_ref_id: splitRef?.id ?? null, split_ref_code: refCode, row_type: 'SPLIT' as const,
    }))
    await supabase.from('transactions').insert(splitRows)
    toast.success('Transaction split into ' + rows.length + ' rows')
    setSaving(false); onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-5 border-b hairline shrink-0">
          <div>
            <h3 className="font-semibold">Split transaction</h3>
            <p className="text-sm text-slate-500 mt-0.5">Original: {formatINR(txn.amount)}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--ink-100)]"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto flex-1 min-h-0">
          {rows.map((row, i) => (
            <div key={i} className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="ds-lbl">Flat / Category</label>
                <select
                  value={row.flatCode}
                  onChange={e => {
                    const v = e.target.value
                    updateRow(i, 'flatCode', v)
                    if (!FLAT_CODES.includes(v)) updateRow(i, 'category', v)
                  }}
                  className="w-full ds-field"
                >
                  <option value="">— Select —</option>
                  <optgroup label="Flats">{FLAT_CODES.map(f => <option key={f} value={f}>{f}</option>)}</optgroup>
                  <optgroup label="Income">{INCOME_CATS.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                  <optgroup label="Expenses">{EXPENSE_CATS.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                </select>
              </div>
              {FLAT_CODES.includes(row.flatCode) && (
                <div className="w-28">
                  <label className="ds-lbl">Type</label>
                  <select
                    value={row.category}
                    onChange={e => {
                      updateRow(i, 'category', e.target.value)
                      updateRow(i, 'corpus', e.target.value === 'Corpus' ? 'YES' : 'NO')
                    }}
                    className="w-full ds-field"
                  >
                    <option value="Maintenance">Maintenance</option>
                    <option value="Corpus">Corpus</option>
                  </select>
                </div>
              )}
              {row.corpus === 'YES' && activePlans.length > 1 && (
                <div className="w-36">
                  <label className="ds-lbl">Plan</label>
                  <select
                    value={row.planId ?? ''}
                    onChange={e => updateRow(i, 'planId', e.target.value)}
                    className="w-full ds-field"
                  >
                    <option value="">Select plan…</option>
                    {activePlans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}
              <div className="w-28">
                <label className="ds-lbl">Amount</label>
                <input
                  type="number" value={row.amount} placeholder="0"
                  onChange={e => updateRow(i, 'amount', e.target.value)}
                  className="w-full ds-field"
                />
              </div>
              {rows.length > 2 && (
                <button onClick={() => setRows(r => r.filter((_, idx) => idx !== i))} className="p-2 text-slate-400 hover:text-red-500">
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}

          <button onClick={() => setRows(r => [...r, { flatCode: '', category: 'Maintenance', corpus: 'NO', amount: '' }])}
            style={{ color: 'var(--brand-700)' }} className="flex items-center gap-1.5 text-sm hover:opacity-80">
            <Plus size={14} /> Add row
          </button>

          <div className={`flex justify-between text-sm font-medium px-1 ${Math.abs(remaining) > 0.01 ? 'text-red-600' : 'text-green-700'}`}>
            <span>Remaining</span>
            <span>{formatINR(Math.abs(remaining))} {remaining < -0.01 ? 'over' : remaining > 0.01 ? 'left' : '✓'}</span>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex gap-2 p-5 border-t hairline">
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button onClick={handleSave} disabled={saving || Math.abs(remaining) > 0.01} className="btn-primary flex-1">
            {saving ? 'Saving…' : 'Apply split'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── ALL TRANSACTIONS TAB ──────────────────────────────────────
type DateMode = 'fy' | 'custom' | 'all'

function getCurrentFy() {
  const now = new Date()
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return {
    start: `${year}-04-01`,
    end:   `${year + 1}-03-31`,
    label: `FY ${year}-${String(year + 1).slice(-2)}`,
  }
}

function AllTransactionsTab() {
  const { canWrite } = useRoleCtx()
  const gridRef = useRef<AgGridReact>(null)
  const qc = useQueryClient()
  const fy = getCurrentFy()

  const [mode, setMode]             = useState<DateMode>('fy')
  const [draftStart, setDraftStart] = useState('')
  const [draftEnd, setDraftEnd]     = useState('')
  const [appliedStart, setApplied]  = useState<string | null>(null)
  const [appliedEnd, setAppliedEnd] = useState<string | null>(null)
  const [selectedTxn, setSelectedTxn] = useState<Transaction | null>(null)
  const [showEdit, setShowEdit]       = useState(false)
  const [showSplit, setShowSplit]     = useState(false)

  const effectiveStart = mode === 'fy' ? fy.start : mode === 'custom' ? appliedStart : null
  const effectiveEnd   = mode === 'fy' ? fy.end   : mode === 'custom' ? appliedEnd   : null

  function handleApply() {
    setApplied(draftStart || null)
    setAppliedEnd(draftEnd || null)
  }

  function handleClear() {
    setDraftStart(''); setDraftEnd('')
    setApplied(null); setAppliedEnd(null)
    setMode('fy')
  }

  const canApply = draftStart && draftEnd && (draftStart !== appliedStart || draftEnd !== appliedEnd)

  const { data: flats } = useQuery({
    queryKey: ['flats'],
    queryFn: async () => {
      const { data } = await supabase.from('flats').select('id,code,maintenance_amt')
      return data ?? []
    },
  })

  const { data: residents } = useQuery({
    queryKey: ['residents-active-lite'],
    queryFn: async () => {
      const { data } = await supabase.from('residents').select('id,name,type,flat_id,upi_ids').eq('is_active', true)
      return (data ?? []) as { id: string; name: string; type: string; flat_id: string; upi_ids: string[] }[]
    },
  })

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['all-transactions', effectiveStart, effectiveEnd],
    queryFn: async () => {
      let q = supabase.from('transactions').select('*').order('value_date', { ascending: false })
      if (effectiveStart) q = q.gte('value_date', effectiveStart)
      if (effectiveEnd)   q = q.lte('value_date', effectiveEnd)
      if (!effectiveStart && !effectiveEnd) q = q.limit(2000)
      const { data } = await q
      return (data ?? []) as Transaction[]
    },
    staleTime: 1000 * 60,
  })

  function handleExport() {
    const rows: any[] = []
    gridRef.current?.api?.forEachNodeAfterFilterAndSort(node => { if (node.data) rows.push(node.data) })
    const exportRows = (rows.length > 0 ? rows : data ?? []).map(r => ({
      Date:        r.value_date,
      Month:       r.fiscal_label,
      Flat:        r.flat_code,
      'CR/DR':     r.cr_dr,
      Amount:      r.amount,
      Category:    r.category,
      Corpus:      r.corpus,
      Type:        r.row_type,
      Description: r.description,
      Source:      r.source,
    }))
    const ws = XLSX.utils.json_to_sheet(exportRows)
    ws['!cols'] = [10,8,8,6,12,14,8,8,50,20].map(w => ({ wch: w }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Transactions')
    const suffix = mode === 'fy' ? fy.label.replace(' ', '_') : mode === 'custom' ? `${appliedStart}_${appliedEnd}` : 'All'
    XLSX.writeFile(wb, `Transactions_${suffix}.xlsx`)
  }

  const colDefs = useMemo((): ColDef<any>[] => [
    { field: 'value_date',   headerName: 'Date',        width: 110, sort: 'desc' as const, valueFormatter: p => formatDateDMY(p.value) },
    { field: 'fiscal_label', headerName: 'Month',       width: 90  },
    { field: 'flat_code',    headerName: 'Flat',        width: 90, filter: true },
    { field: 'cr_dr',        headerName: 'CR/DR',       width: 80, filter: true,
      cellRenderer: (p: any) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${p.value === 'CR' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {p.value}
        </span>
      ),
    },
    { field: 'amount', headerName: 'Amount', width: 120, type: 'numericColumn',
      valueFormatter: (p: any) => formatINR(p.value),
    },
    { field: 'category',  headerName: 'Category', width: 130, filter: true },
    { field: 'corpus',    headerName: 'Corpus',   width: 90,  filter: true,
      cellRenderer: (p: any) => p.value === 'YES'
        ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-purple-100 text-purple-700">YES</span>
        : null,
    },
    { field: 'row_type', headerName: 'Type', width: 100, filter: true,
      cellRenderer: (p: any) => p.value !== 'Normal'
        ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-slate-100 text-slate-600">{p.value}</span>
        : null,
    },
    { field: 'description', headerName: 'Description', flex: 1, minWidth: 200 },
    { field: 'source', headerName: 'Source', width: 120 },
  ], [])

  const defaultColDef = useMemo(() => ({
    sortable: true, resizable: true, filter: true,
    floatingFilter: true, suppressHeaderMenuButton: false,
  }), [])

  return (
    <div className="flex flex-col gap-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Mode toggle */}
        <div className="flex gap-1 rounded-lg p-0.5 text-sm" style={{ background: 'var(--ink-100)' }}>
          {([
            { key: 'fy',     label: fy.label },
            { key: 'custom', label: 'Custom' },
            { key: 'all',    label: 'All time' },
          ] as { key: DateMode; label: string }[]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              className={`px-3 py-1 rounded-md font-medium transition-colors
                ${mode === key ? 'bg-white shadow-sm' : 'hover:bg-[var(--ink-50)]'}`}
              style={mode === key ? { color: 'var(--ink-900)' } : { color: 'var(--ink-500)' }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Custom date range inputs */}
        {mode === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date" value={draftStart}
              onChange={e => setDraftStart(e.target.value)}
              className="ds-field"
            />
            <span className="text-sm" style={{ color: 'var(--ink-400)' }}>to</span>
            <input
              type="date" value={draftEnd}
              onChange={e => setDraftEnd(e.target.value)}
              className="ds-field"
            />
            <button
              onClick={handleApply}
              disabled={!canApply}
              className="btn-primary py-1 px-3"
            >
              Apply
            </button>
            <button
              onClick={handleClear}
              className="btn-secondary py-1 px-3"
            >
              Clear
            </button>
          </div>
        )}

        {/* Right: row count + actions */}
        <div className="flex items-center gap-3 ml-auto">
          <span className="text-sm text-slate-500">
            {data?.length ?? 0} rows{mode === 'all' ? ' (capped 2000)' : ''}
          </span>
          <button onClick={handleExport} disabled={!data?.length} style={{ color: 'var(--brand-700)' }} className="flex items-center gap-1.5 text-sm hover:opacity-80 disabled:opacity-40">
            <Download size={14} /> Export
          </button>
          <button onClick={() => refetch()} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Selected row action strip */}
      {selectedTxn && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 rounded-xl text-sm" style={{ background: 'var(--brand-50)', border: '1px solid var(--brand-100)' }}>
          <div className="flex-1 min-w-0">
            <span className="font-semibold text-slate-800">{selectedTxn.flat_code}</span>
            <span className="mx-1.5 text-slate-400">·</span>
            <span className={selectedTxn.cr_dr === 'CR' ? 'text-green-700 font-semibold' : 'text-red-600 font-semibold'}>{formatINR(selectedTxn.amount)}</span>
            <span className="mx-1.5 text-slate-400">·</span>
            <span className="text-slate-600">{formatDateDMY(selectedTxn.value_date)}</span>
            <span className="mx-1.5 text-slate-400">·</span>
            <span className="text-slate-500">{selectedTxn.category}</span>
            {selectedTxn.corpus === 'YES' && (
              <span className="ml-2 px-1.5 py-0.5 rounded text-xs font-bold bg-purple-100 text-purple-700">Corpus</span>
            )}
            {selectedTxn.row_type !== 'Normal' && (
              <span className="ml-2 px-1.5 py-0.5 rounded text-xs font-bold bg-slate-200 text-slate-600">{selectedTxn.row_type}</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canWrite && selectedTxn.row_type !== 'VOIDED' && selectedTxn.source !== 'Direct' && (
              <button onClick={() => setShowEdit(true)}
                style={{ borderColor: 'var(--brand-500)', color: 'var(--brand-600)' }}
                className="flex items-center gap-1.5 border rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-[var(--brand-50)]">
                Edit
              </button>
            )}
            {canWrite && selectedTxn.row_type !== 'VOIDED' && selectedTxn.source === 'Direct' && (
              <span className="text-xs" style={{ color: 'var(--ink-400)' }}>
                Created by a direct payment — void it from the expense instead.
              </span>
            )}
            <button onClick={() => setSelectedTxn(null)}
              className="p-1.5 rounded-lg hover:bg-blue-100 text-slate-500">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {showEdit && selectedTxn && (
        <EditModal
          txn={selectedTxn}
          flats={flats ?? []}
          residents={residents ?? []}
          onClose={() => setShowEdit(false)}
          onSaved={(updated) => { setSelectedTxn(updated); setShowEdit(false); qc.invalidateQueries() }}
          onSplit={() => { setShowEdit(false); setShowSplit(true) }}
          onVoided={() => { setShowEdit(false); setSelectedTxn(null); qc.invalidateQueries({ queryKey: ['all-transactions'] }) }}
        />
      )}

      {isLoading ? (
        <div className="h-64 animate-pulse rounded-[var(--ds-radius)]" style={{ background: 'var(--ink-100)' }} />
      ) : (
        <div className="rounded-xl overflow-hidden border hairline" style={{ height: 520 }}>
          <AgGridReact
            ref={gridRef}
            rowData={data ?? []}
            columnDefs={colDefs}
            defaultColDef={defaultColDef}
            pagination={true}
            paginationPageSize={50}
            rowSelection={{ mode: 'singleRow' }}
            suppressCellFocus={true}
            onRowClicked={e => {
              if (!e.data) return
              setSelectedTxn(e.data)
              setShowEdit(canWrite && e.data.row_type !== 'VOIDED' && e.data.source !== 'Direct')
            }}
            getRowStyle={(params: any) => {
              if (params.data?.id === selectedTxn?.id) return { background: 'var(--brand-50)', opacity: 1, textDecoration: 'none' }
              if (params.data?.row_type === 'VOIDED') return { background: '', opacity: 0.4, textDecoration: 'line-through' }
              return undefined
            }}
          />
        </div>
      )}

      {showSplit && selectedTxn && (
        <SplitModal
          txn={selectedTxn}
          flats={flats ?? []}
          onClose={() => setShowSplit(false)}
          onSaved={() => {
            setShowSplit(false); setSelectedTxn(null)
            qc.invalidateQueries({ queryKey: ['all-transactions'] })
          }}
        />
      )}
    </div>
  )
}
