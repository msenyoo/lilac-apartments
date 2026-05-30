import { useState, useCallback } from 'react'
import { Upload, CheckCircle, AlertTriangle, FileText, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { parsePipeStatement, tagTransaction, getFiscalLabel, getFiscalYear, getFiscalMonth } from '@/lib/tagger'
import { formatINR } from '@/lib/tagger'
import { useQueryClient } from '@tanstack/react-query'

interface ImportResult {
  total: number
  added: number
  duplicates: number
  review: number
  monthLabel: string
  uploadId: string
}

export default function UploadPage() {
  const [dragging, setDragging]   = useState(false)
  const [processing, setProcessing] = useState(false)
  const [result, setResult]       = useState<ImportResult | null>(null)
  const [error, setError]         = useState('')
  const navigate = useNavigate()
  const qc = useQueryClient()

  async function processFile(file: File) {
    setProcessing(true)
    setError('')
    setResult(null)

    try {
      const text = await file.text()
      const parsed = parsePipeStatement(text)
      if (parsed.length === 0) throw new Error('No transactions found. Make sure this is a pipe-delimited (|) bank statement.')

      // Get existing txn_ids to skip duplicates
      const { data: existingRaw } = await supabase
        .from('transactions')
        .select('txn_id')
        .not('txn_id', 'is', null)
      const existingIds = new Set((existingRaw ?? []).map(r => r.txn_id))

      // Get flat lookup map
      const { data: flats } = await supabase.from('flats').select('id,code')
      const flatMap = new Map((flats ?? []).map(f => [f.code, f.id]))

      // Timestamp the filename
      const ts = new Date().toISOString().slice(0,16).replace('T','_').replace(':','')
      const ext = file.name.split('.').pop() ?? 'txt'
      const base = file.name.replace(/\.[^.]+$/, '')
      const renamedFile = `${base}_${ts}.${ext}`

      // Upload raw file to storage
      const { data: storageData } = await supabase.storage
        .from('raw-statements')
        .upload(`uploads/${renamedFile}`, file, { upsert: false })

      // Create upload record
      const { data: uploadRecord } = await supabase
        .from('uploads')
        .insert({
          filename: renamedFile,
          original_name: file.name,
          storage_path: storageData?.path ?? null,
          status: 'processing',
        })
        .select('id')
        .single()

      const uploadId = uploadRecord?.id ?? null

      // Build transaction rows
      const newRows = []
      const reviewRows = []
      let duplicates = 0

      for (const txn of parsed) {
        if (txn.txnId && existingIds.has(txn.txnId)) { duplicates++; continue }

        const tag = tagTransaction(txn.description, txn.crDr)
        const fiscalLabel = getFiscalLabel(txn.valueDate)
        const fiscalYear  = getFiscalYear(txn.valueDate)
        const fiscalMonth = getFiscalMonth(txn.valueDate)

        const row = {
          txn_id:        txn.txnId || null,
          value_date:    txn.valueDate,
          posted_date:   txn.postedDate,
          description:   txn.description,
          cr_dr:         txn.crDr,
          amount:        txn.amount,
          flat_id:       flatMap.get(tag.flatCode) ?? null,
          flat_code:     tag.flatCode,
          category:      tag.category,
          corpus:        tag.corpus,
          fiscal_year:   fiscalYear,
          fiscal_month:  fiscalMonth,
          fiscal_label:  fiscalLabel,
          source:        `Import:${renamedFile}`,
          upload_id:     uploadId,
          row_type:      'Normal' as const,
        }
        newRows.push(row)
        if (tag.confidence === 'REVIEW') reviewRows.push(row)
      }

      // Batch insert
      if (newRows.length > 0) {
        const BATCH = 100
        for (let i = 0; i < newRows.length; i += BATCH) {
          const { error: insertError } = await supabase
            .from('transactions')
            .insert(newRows.slice(i, i + BATCH))
          if (insertError) throw new Error(insertError.message)
        }
      }

      // Detect month label from the data
      const monthLabel = newRows[0]?.fiscal_label ?? ''

      // Update upload record
      if (uploadId) {
        await supabase.from('uploads').update({
          month_label:  monthLabel,
          total_txns:   parsed.length,
          new_txns:     newRows.length,
          duplicates,
          review_count: reviewRows.length,
          status:       'processed',
        }).eq('id', uploadId)
      }

      // Invalidate all queries
      qc.invalidateQueries()

      setResult({
        total: parsed.length,
        added: newRows.length,
        duplicates,
        review: reviewRows.length,
        monthLabel,
        uploadId: uploadId ?? '',
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setProcessing(false)
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }, [])

  return (
    <div className="p-4 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Import statement</h2>
        <p className="text-sm text-slate-500">Upload the pipe-delimited .txt from your bank</p>
      </div>

      {!result && !processing && (
        <label
          className={`card flex flex-col items-center justify-center gap-3 p-8 cursor-pointer
                      border-2 border-dashed transition-colors
                      ${dragging ? 'border-brand-500 bg-brand-50' : 'border-slate-200'}`}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <div className="w-14 h-14 rounded-full bg-brand-50 flex items-center justify-center">
            <Upload size={24} className="text-brand-700" />
          </div>
          <div className="text-center">
            <p className="font-medium text-slate-700">Tap to select file</p>
            <p className="text-sm text-slate-400 mt-0.5">or drag and drop</p>
            <p className="text-xs text-slate-400 mt-2">Pipe-delimited .txt from your bank</p>
          </div>
          <input type="file" accept=".txt,.psv,.csv" className="hidden" onChange={onFileChange} />
        </label>
      )}

      {processing && (
        <div className="card p-8 flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <p className="font-medium">Processing transactions…</p>
          <p className="text-sm text-slate-400">Auto-tagging flat codes and categories</p>
        </div>
      )}

      {error && (
        <div className="card p-4 bg-red-50 border border-red-200 flex gap-3">
          <AlertTriangle size={20} className="text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-800">Import failed</p>
            <p className="text-sm text-red-600 mt-1">{error}</p>
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <div className="card p-4 bg-green-50 border border-green-200 flex gap-3">
            <CheckCircle size={20} className="text-green-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-green-800">Import complete — {result.monthLabel}</p>
            </div>
          </div>

          <div className="card divide-y divide-slate-100">
            {[
              { label: 'Transactions in file',  value: result.total,      color: '' },
              { label: 'New rows added',         value: result.added,      color: 'text-green-700' },
              { label: 'Duplicates skipped',     value: result.duplicates, color: 'text-slate-400' },
              { label: 'Needs review',           value: result.review,     color: result.review > 0 ? 'text-orange-600' : '' },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex justify-between items-center px-4 py-3">
                <span className="text-sm text-slate-600">{label}</span>
                <span className={`font-semibold text-sm ${color}`}>{value}</span>
              </div>
            ))}
          </div>

          {result.review > 0 && (
            <button
              onClick={() => navigate('/review')}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              Review {result.review} untagged transaction{result.review > 1 ? 's' : ''}
              <ChevronRight size={16} />
            </button>
          )}

          <button
            onClick={() => setResult(null)}
            className="btn-secondary w-full"
          >
            Import another file
          </button>
        </div>
      )}

      {/* Upload history */}
      <UploadHistory />
    </div>
  )
}

function UploadHistory() {
  const [uploads, setUploads] = useState<any[]>([])
  const [loaded, setLoaded]   = useState(false)

  async function loadHistory() {
    const { data } = await supabase
      .from('uploads')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10)
    setUploads(data ?? [])
    setLoaded(true)
  }

  if (!loaded) {
    return (
      <button onClick={loadHistory} className="text-sm text-brand-700 flex items-center gap-1">
        <FileText size={14} /> Show import history
      </button>
    )
  }

  return (
    <div className="card">
      <div className="px-4 py-3 border-b border-slate-100">
        <h3 className="font-medium text-sm">Import history</h3>
      </div>
      {uploads.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-400 text-center">No imports yet</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {uploads.map(u => (
            <div key={u.id} className="px-4 py-3 flex justify-between items-start">
              <div>
                <p className="text-sm font-medium text-slate-700">{u.month_label || '—'}</p>
                <p className="text-xs text-slate-400 mt-0.5">{u.filename}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-500">{u.new_txns} added</p>
                {u.review_count > 0 && (
                  <span className="badge-review">{u.review_count} review</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
