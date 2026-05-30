import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase, CorpusEntry } from '@/lib/supabase'
import { formatINR } from '@/lib/tagger'
import { Search } from 'lucide-react'

type Filter = 'all' | 'Done' | 'Partial' | 'Pending'

export default function CorpusPage() {
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['corpus'],
    queryFn: async () => {
      const { data } = await supabase.from('v_corpus_tracker').select('*').order('flat_code')
      return (data ?? []) as CorpusEntry[]
    },
  })

  const filtered = (data ?? []).filter(d => {
    if (filter !== 'all' && d.status !== filter) return false
    if (search && !d.flat_code.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const totalTarget    = (data ?? []).reduce((s, d) => s + d.corpus_target, 0)
  const totalCollected = (data ?? []).reduce((s, d) => s + d.collected, 0)
  const pct = totalTarget > 0 ? Math.round(totalCollected * 100 / totalTarget) : 0

  return (
    <div className="p-4 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Corpus fund</h2>
        <p className="text-sm text-slate-500">One-time corpus collection status</p>
      </div>

      <div className="card p-4">
        <div className="flex justify-between mb-2">
          <p className="text-sm text-slate-500">Overall progress</p>
          <p className="text-sm font-semibold">{pct}%</p>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-brand-700 rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <div className="flex justify-between mt-2 text-xs text-slate-400">
          <span>Collected {formatINR(totalCollected)}</span>
          <span>Target {formatINR(totalTarget)}</span>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {(['all','Done','Partial','Pending'] as Filter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors
              ${filter === f ? 'bg-brand-700 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}
          >
            {f === 'all' ? `All (${data?.length ?? 0})` : `${f} (${(data ?? []).filter(d => d.status === f).length})`}
          </button>
        ))}
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Search flat..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="card h-14 animate-pulse bg-slate-100" />)}</div>
      ) : (
        <div className="card divide-y divide-slate-100">
          {filtered.map(d => (
            <div key={d.flat_code} className="px-4 py-3">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{d.flat_code}</span>
                  <span className={d.status === 'Done' ? 'badge-paid' : d.status === 'Partial' ? 'badge-partial' : 'badge-pending'}>
                    {d.status}
                  </span>
                </div>
                <span className="text-sm font-medium">{formatINR(d.collected)} / {formatINR(d.corpus_target)}</span>
              </div>
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${d.status === 'Done' ? 'bg-green-500' : d.status === 'Partial' ? 'bg-amber-500' : 'bg-slate-300'}`}
                  style={{ width: `${Math.min(d.pct_paid ?? 0, 100)}%` }}
                />
              </div>
              <p className="text-xs text-slate-400 mt-1">{d.pct_paid?.toFixed(0) ?? 0}% · Last: {d.last_payment_date ?? '—'}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
