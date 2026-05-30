import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase, DuesEntry } from '@/lib/supabase'
import { formatINR } from '@/lib/tagger'
import { Search } from 'lucide-react'

type Filter = 'all' | 'Due' | 'Partial' | 'Clear'

export default function DuesPage() {
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['dues'],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_dues_tracker')
        .select('*')
        .order('flat_code')
      return (data ?? []) as DuesEntry[]
    },
  })

  const filtered = (data ?? []).filter(d => {
    if (filter !== 'all' && d.status !== filter) return false
    if (search && !d.flat_code.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const totalPending = (data ?? []).reduce((s, d) => s + Math.max(0, d.pending), 0)
  const counts = {
    Due: (data ?? []).filter(d => d.status === 'Due').length,
    Partial: (data ?? []).filter(d => d.status === 'Partial').length,
    Clear: (data ?? []).filter(d => d.status === 'Clear').length,
  }

  return (
    <div className="p-4 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Dues tracker</h2>
        <p className="text-sm text-slate-500">FY 2026-27 maintenance outstanding</p>
      </div>

      <div className="card p-4 bg-red-50 border border-red-200">
        <p className="text-xs text-red-600 mb-1">Total pending (FY 2026-27)</p>
        <p className="text-2xl font-bold text-red-700">{formatINR(totalPending)}</p>
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {(['all','Due','Partial','Clear'] as Filter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors
              ${filter === f
                ? 'bg-brand-700 text-white'
                : 'bg-white border border-slate-200 text-slate-600'}`}
          >
            {f === 'all' ? `All (${data?.length ?? 0})` : `${f} (${counts[f as keyof typeof counts]})`}
          </button>
        ))}
      </div>

      {/* Search */}
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
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="card h-14 animate-pulse bg-slate-100" />
          ))}
        </div>
      ) : (
        <div className="card divide-y divide-slate-100">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No results</p>
          ) : filtered.map(d => (
            <div key={d.flat_code} className="px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center">
                  <span className="text-xs font-bold text-brand-700">{d.flat_code}</span>
                </div>
                <div>
                  <p className="text-sm font-medium">{d.flat_code}</p>
                  <p className="text-xs text-slate-400">{d.block} · {d.flat_type} · {formatINR(d.maintenance_amt)}/mo</p>
                </div>
              </div>
              <div className="text-right">
                <p className={`text-sm font-semibold ${d.pending > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {d.pending > 0 ? formatINR(d.pending) : '✓ Clear'}
                </p>
                <span className={
                  d.status === 'Clear' ? 'badge-paid' :
                  d.status === 'Partial' ? 'badge-partial' : 'badge-pending'
                }>{d.status}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
