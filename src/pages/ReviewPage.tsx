import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, ReviewEntry } from '@/lib/supabase'
import { FLAT_CODES, formatINR } from '@/lib/tagger'
import { CheckCircle, ChevronDown, ChevronUp } from 'lucide-react'

const CATEGORIES = ['Maintenance','Corpus','SALARY','EB','CIVIL','SEWAGE','LIFT SERVICE','LIFT','INTERNET','CCTV/MOTOR','EXPENSES','INTEREST','FD','OTHER']

export default function ReviewPage() {
  const qc = useQueryClient()
  const { data: items, isLoading } = useQuery({
    queryKey: ['review-queue'],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_review_queue')
        .select('*')
        .order('value_date', { ascending: false })
      return (data ?? []) as ReviewEntry[]
    },
  })

  if (isLoading) return <LoadingSkeleton />

  if (!items?.length) return (
    <div className="flex flex-col items-center justify-center p-12 gap-4">
      <CheckCircle size={48} className="text-green-500" />
      <div className="text-center">
        <p className="font-semibold text-lg">All clear!</p>
        <p className="text-slate-500 text-sm mt-1">No transactions need review</p>
      </div>
    </div>
  )

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Review queue</h2>
        <span className="badge-review">{items.length} pending</span>
      </div>
      <p className="text-sm text-slate-500">
        These transactions couldn't be auto-tagged. Assign a flat or category.
      </p>
      <div className="space-y-2">
        {items.map(item => (
          <ReviewItem key={item.id} item={item} onSaved={() => qc.invalidateQueries()} />
        ))}
      </div>
    </div>
  )
}

function ReviewItem({ item, onSaved }: { item: ReviewEntry; onSaved: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [flatCode, setFlatCode] = useState('')
  const [category, setCategory] = useState('Maintenance')
  const [corpus, setCorpus]     = useState('NO')
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)

  const isFlat = FLAT_CODES.includes(flatCode)

  async function handleSave() {
    if (!flatCode) return
    setSaving(true)
    const { error } = await supabase
      .from('transactions')
      .update({
        flat_code: flatCode,
        flat_id: null,
        category: isFlat ? category : flatCode,
        corpus: corpus as 'YES' | 'NO',
        row_type: 'Normal',
      })
      .eq('id', item.id)
    setSaving(false)
    if (!error) { setSaved(true); setTimeout(onSaved, 400) }
  }

  if (saved) return (
    <div className="card p-3 bg-green-50 flex items-center gap-2">
      <CheckCircle size={16} className="text-green-600" />
      <p className="text-sm text-green-700">Tagged as {flatCode} · {category}</p>
    </div>
  )

  return (
    <div className="card overflow-hidden">
      <button
        className="w-full px-4 py-3 flex items-start justify-between gap-3 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
              item.cr_dr === 'CR' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}>{item.cr_dr}</span>
            <span className="font-semibold text-sm">{formatINR(item.amount)}</span>
            <span className="text-xs text-slate-400">{item.value_date}</span>
          </div>
          <p className="text-xs text-slate-500 mt-1 truncate">{item.description}</p>
        </div>
        {expanded ? <ChevronUp size={16} className="shrink-0 mt-1 text-slate-400" /> : <ChevronDown size={16} className="shrink-0 mt-1 text-slate-400" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
          <p className="text-xs text-slate-500 break-all">{item.description}</p>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Flat / Category</label>
              <select
                value={flatCode}
                onChange={e => { setFlatCode(e.target.value); if (!FLAT_CODES.includes(e.target.value)) setCategory(e.target.value) }}
                className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm"
              >
                <option value="">— Select —</option>
                <optgroup label="Flats">
                  {FLAT_CODES.map(f => <option key={f} value={f}>{f}</option>)}
                </optgroup>
                <optgroup label="Expenses">
                  {['SALARY','EB','CIVIL','SEWAGE','LIFT SERVICE','LIFT','INTERNET','EXPENSES','INTEREST','FD'].map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </optgroup>
              </select>
            </div>
            {isFlat && (
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Category</label>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm"
                >
                  <option value="Maintenance">Maintenance</option>
                  <option value="Corpus">Corpus</option>
                </select>
              </div>
            )}
          </div>

          {isFlat && category === 'Corpus' && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={corpus==='YES'} onChange={e => setCorpus(e.target.checked ? 'YES' : 'NO')} />
              Mark as corpus payment
            </label>
          )}

          <button
            onClick={handleSave}
            disabled={!flatCode || saving}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {saving ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : 'Save tag'}
          </button>
        </div>
      )}
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="p-4 space-y-3">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="card p-4 h-20 animate-pulse bg-slate-100" />
      ))}
    </div>
  )
}
