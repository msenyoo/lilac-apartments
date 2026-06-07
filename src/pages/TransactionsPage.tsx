import { useState, useCallback, useRef, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef } from 'ag-grid-community'
import {
  Upload as UploadIcon, CheckCircle, AlertTriangle, FileText,
  X, Plus, Trash2, Scissors, RefreshCw, Download, Copy,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase, Transaction, ReviewEntry } from '@/lib/supabase'
import {
  parseStatement, tagTransaction, getFiscalLabel,
  getFiscalYear, getFiscalMonth, bankDateToISO, formatINR, FLAT_CODES,
} from '@/lib/tagger'
import { useRoleCtx } from '@/contexts/RoleContext'
import { toast } from 'sonner'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'


type Tab = 'upload' | 'review' | 'all'

const EXPENSE_CATS = ['SALARY','EB','CIVIL','SEWAGE','LIFT SERVICE','LIFT','INTERNET','EXPENSES','INTEREST','FD','CCTV/MOTOR']

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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const toInsert = rows.map(({ _confidence, ...r }) => ({
        ...r, source: `Import:${renamedFile}`, upload_id: uploadId, row_type: 'Normal' as const,
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

function ImportPreview({ preview, fileName, onConfirm, onCancel }: {
  preview: { rows: PreviewRow[]; duplicates: number; totalInFile: number }
  fileName: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const reviewCount = preview.rows.filter(r => r._confidence === 'REVIEW').length

  const colDefs = useMemo((): ColDef<any>[] => [
    { field: 'value_date',   headerName: 'Date',       width: 110 },
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
    { field: 'flat_code', headerName: 'Flat / Cat', width: 110, filter: true },
    { field: 'category',  headerName: 'Category',   width: 120, filter: true },
    { field: '_confidence', headerName: 'Match',    width: 90, filter: true,
      cellRenderer: (p: any) => p.value === 'REVIEW'
        ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-700">REVIEW</span>
        : <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-green-100 text-green-700">Auto</span>,
    },
    { field: 'description', headerName: 'Description', flex: 1, minWidth: 200 },
  ], [])

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

      <p className="text-xs text-slate-400 flex items-center gap-1.5">
        <FileText size={12} /> {fileName}
        {reviewCount > 0 && <span className="ml-2 text-amber-600">· Amber rows need manual tagging after import</span>}
      </p>

      <div className="rounded-xl overflow-hidden border hairline" style={{ height: 440 }}>
        <AgGridReact
          rowData={preview.rows}
          columnDefs={colDefs}
          defaultColDef={{ sortable: true, resizable: true, filter: true, floatingFilter: true }}
          pagination={true}
          paginationPageSize={25}
          suppressCellFocus={true}
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
    </div>
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
  const { canWrite } = useRoleCtx()
  const qc = useQueryClient()
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
      </div>
      <p className="text-sm text-slate-500">
        {canWrite
          ? "Auto-tagging couldn't identify these. Assign a flat or category."
          : "Auto-tagging couldn't identify these. Read-only view."}
      </p>
      <div className="grid gap-2 lg:grid-cols-2">
        {items.map(item => (
          <ReviewItem key={item.id} item={item} flats={flats ?? []} onSaved={() => qc.invalidateQueries()} />
        ))}
      </div>
    </div>
  )
}

function ReviewItem({ item, flats, onSaved }: { item: ReviewEntry; flats: any[]; onSaved: () => void }) {
  const { canWrite } = useRoleCtx()
  const [flatCode, setFlatCode]   = useState('')
  const [category, setCategory]   = useState('Maintenance')
  const [corpus, setCorpus]       = useState<'YES' | 'NO'>('NO')
  const [planId, setPlanId]       = useState<string | null>(null)
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)
  const [showSplit, setShowSplit] = useState(false)

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
    setSaving(true)
    const flatId = flats.find(f => f.code === flatCode)?.id ?? null
    const { error } = await supabase.from('transactions').update({
      flat_code: flatCode, flat_id: flatId,
      category: isFlat ? category : flatCode,
      corpus: effectiveCorpus,
      plan_id: effectiveCorpus === 'YES' ? planId : null,
      row_type: 'Normal',
    }).eq('id', item.id)
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
              <span className="text-xs text-slate-400">{item.value_date}</span>
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
                setFlatCode(e.target.value)
                if (!FLAT_CODES.includes(e.target.value)) setCategory(e.target.value)
              }}
              className="w-full ds-field bg-white"
            >
              <option value="">— Select —</option>
              <optgroup label="Flats">{FLAT_CODES.map(f => <option key={f} value={f}>{f}</option>)}</optgroup>
              <optgroup label="Expenses">{EXPENSE_CATS.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
            </select>
          </div>
          {isFlat && (
            <div>
              <label className="ds-lbl">Category</label>
              <select
                value={category}
                onChange={e => {
                  setCategory(e.target.value)
                  if (e.target.value === 'Corpus') setCorpus('YES')
                  else { setCorpus('NO'); setPlanId(null) }
                }}
                className="w-full ds-field bg-white"
              >
                <option value="Maintenance">Maintenance</option>
                <option value="Corpus">Corpus</option>
              </select>
            </div>
          )}
        </div>

        {effectiveCorpus === 'YES' && activePlans.length > 1 && (
          <div className="flex flex-col gap-1">
            <Label>Corpus plan</Label>
            <Select
              value={planId ?? '__auto__'}
              onValueChange={v => setPlanId(v === '__auto__' ? null : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Auto (matched by fiscal year)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__auto__">Auto (matched by fiscal year)</SelectItem>
                {activePlans.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {showMonthHint && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
            This looks like <strong>{suggestedMonths} months</strong> of maintenance (
            {suggestedMonths} × {formatINR(selectedFlat.maintenance_amt)})
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
function EditModal({ txn, flats, onClose, onSaved, onSplit, onVoided }: {
  txn: Transaction
  flats: any[]
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

  function handleFlatChange(val: string) {
    setFlatCode(val)
    if (!isFlat(val)) { setCategory(val) }
    else { setCategory('Maintenance'); setCorpus('NO'); setPlanId(null) }
  }

  function handleCategoryChange(val: string) {
    setCategory(val)
    if (val === 'Corpus') { setCorpus('YES') }
    else { setCorpus('NO'); setPlanId(null) }
  }

  function handleCopy() {
    navigator.clipboard.writeText(txn.description)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleSave() {
    setSaving(true)
    const flatId = flats.find(f => f.code === flatCode)?.id ?? null
    const resolvedCategory = isFlat(flatCode) ? category : flatCode
    const resolvedPlanId = corpus === 'YES' ? planId : null
    const { error } = await supabase.from('transactions').update({
      flat_code: flatCode, flat_id: flatId, category: resolvedCategory, corpus,
      plan_id: resolvedPlanId,
    }).eq('id', txn.id)
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('Transaction updated')
    onSaved({ ...txn, flat_code: flatCode, flat_id: flatId, category: resolvedCategory, corpus, plan_id: resolvedPlanId })
  }

  async function handleVoid() {
    setVoiding(true)
    const { error } = await supabase.from('transactions').update({ row_type: 'VOIDED' }).eq('id', txn.id)
    setVoiding(false)
    if (error) { toast.error(error.message); return }
    toast.success('Transaction voided')
    onVoided()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between p-5 border-b hairline">
          <div>
            <h3 className="font-semibold">Edit transaction</h3>
            <p className="text-sm text-slate-500 mt-0.5">{txn.value_date} · {formatINR(txn.amount)}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--ink-100)]"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
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
              <optgroup label="Expenses">{EXPENSE_CATS.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
            </select>
          </div>

          {isFlat(flatCode) && (
            <div>
              <label className="ds-lbl">Type</label>
              <select value={category} onChange={e => handleCategoryChange(e.target.value)}
                className="w-full ds-field">
                <option value="Maintenance">Maintenance</option>
                <option value="Corpus">Corpus</option>
              </select>
            </div>
          )}

          {!isFlat(flatCode) && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={corpus === 'YES'} onChange={e => {
                const checked = e.target.checked
                setCorpus(checked ? 'YES' : 'NO')
                if (!checked) setPlanId(null)
              }}
                className="w-4 h-4 rounded" />
              <span className="text-slate-700">Corpus {txn.cr_dr === 'DR' ? 'expenditure' : 'collection'}</span>
              <span className="text-xs text-slate-400">{txn.cr_dr === 'DR' ? '(from corpus fund)' : '(corpus)'}</span>
            </label>
          )}

          {corpus === 'YES' && activePlans.length > 1 && (
            <div className="flex flex-col gap-1">
              <Label>Corpus plan</Label>
              <Select
                value={planId ?? ''}
                onValueChange={v => setPlanId(v || null)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Auto (matched by fiscal year)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Auto (matched by fiscal year)</SelectItem>
                  {activePlans.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <button onClick={onSplit}
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
interface SplitRow { flatCode: string; category: string; corpus: 'YES' | 'NO'; amount: string }

function SplitModal({ txn, onClose, onSaved, flats }: {
  txn: Transaction; onClose: () => void; onSaved: () => void; flats: any[]
}) {
  const [rows, setRows] = useState<SplitRow[]>([
    { flatCode: '', category: 'Maintenance', corpus: 'NO', amount: '' },
    { flatCode: '', category: 'Maintenance', corpus: 'NO', amount: '' },
  ])
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  const total = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  const remaining = txn.amount - total

  function updateRow(i: number, field: keyof SplitRow, val: string) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r))
  }

  async function handleSave() {
    if (Math.abs(remaining) > 0.01) { setError(`Amounts must sum to ${formatINR(txn.amount)}`); return }
    if (rows.some(r => !r.flatCode || !r.amount)) { setError('All rows must have flat/category and amount'); return }
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
      txn_id: null, value_date: txn.value_date, posted_date: txn.posted_date,
      description: `${txn.description} [${refCode}]`,
      cr_dr: txn.cr_dr, amount: parseFloat(r.amount),
      flat_id: flatMap.get(r.flatCode) ?? null, flat_code: r.flatCode,
      category: FLAT_CODES.includes(r.flatCode) ? r.category : r.flatCode,
      corpus: r.corpus, fiscal_year: txn.fiscal_year, fiscal_month: txn.fiscal_month,
      fiscal_label: txn.fiscal_label, source: txn.source, upload_id: txn.upload_id,
      split_ref_id: splitRef?.id ?? null, split_ref_code: refCode, row_type: 'SPLIT' as const,
    }))
    await supabase.from('transactions').insert(splitRows)
    toast.success('Transaction split into ' + rows.length + ' rows')
    setSaving(false); onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b hairline">
          <div>
            <h3 className="font-semibold">Split transaction</h3>
            <p className="text-sm text-slate-500 mt-0.5">Original: {formatINR(txn.amount)}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--ink-100)]"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-3">
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
    { field: 'value_date',   headerName: 'Date',        width: 110, sort: 'desc' as const },
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
            <span className="text-slate-600">{selectedTxn.value_date}</span>
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
            {canWrite && selectedTxn.row_type !== 'VOIDED' && (
              <button onClick={() => setShowEdit(true)}
                style={{ borderColor: 'var(--brand-500)', color: 'var(--brand-600)' }}
                className="flex items-center gap-1.5 border rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-[var(--brand-50)]">
                Edit
              </button>
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
              setSelectedTxn(prev => prev?.id === e.data.id ? null : e.data)
              setShowEdit(false)
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
