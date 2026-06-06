import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { Download, GitMerge, Receipt, Upload, Megaphone, DownloadCloud, History } from 'lucide-react'

const TABLE_ICON: Record<string, React.ReactNode> = {
  transactions:             <Download size={17} />,
  expenses:                 <Receipt size={17} />,
  uploads:                  <Upload size={17} />,
  maintenance_payments:     <GitMerge size={17} />,
  corpus_plans:             <Megaphone size={17} />,
  corpus_payments:          <Megaphone size={17} />,
}

function actionColor(action: string) {
  if (action === 'INSERT') return 'var(--ok)'
  if (action === 'UPDATE') return 'var(--warn)'
  if (action === 'DELETE') return 'var(--bad)'
  return 'var(--ink-500)'
}

function actionBg(action: string) {
  if (action === 'INSERT') return 'var(--ok-bg)'
  if (action === 'UPDATE') return 'var(--warn-bg)'
  if (action === 'DELETE') return 'var(--bad-bg)'
  return 'var(--ink-100)'
}

const TABLES = [
  'all', 'transactions', 'expenses', 'uploads', 'maintenance_payments',
  'corpus_plans', 'corpus_payments', 'flats', 'maintenance_rate_history',
  'app_settings', 'user_roles',
]

function defaultFrom() {
  const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10)
}

export default function ActivityPage() {
  const [tableFilter, setTableFilter] = useState('all')
  const [actionFilter, setActionFilter] = useState<'all' | 'INSERT' | 'UPDATE' | 'DELETE'>('all')
  const [from, setFrom] = useState(defaultFrom())
  const [to,   setTo]   = useState(new Date().toISOString().slice(0, 10))
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['activity-log', tableFilter, actionFilter, from, to],
    queryFn: async () => {
      let q = supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(100)
      if (tableFilter !== 'all') q = q.eq('table_name', tableFilter)
      if (actionFilter !== 'all') q = q.eq('action', actionFilter)
      if (from) q = q.gte('created_at', from)
      if (to)   q = q.lte('created_at', to + 'T23:59:59Z')
      const { data, error } = await q
      if (error) { console.warn('audit_log:', error.message); return [] }
      return data ?? []
    },
  })

  return (
    <div className="flex flex-col gap-5 fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-extrabold">Activity log</h1>
          <p className="text-[13.5px] mt-1" style={{ color: 'var(--ink-500)' }}>
            Every change to the books — a transparent audit trail for the AGM
          </p>
        </div>
        <button
          className="flex items-center gap-2 px-3.5 py-2 rounded-[10px] border hairline font-semibold text-[13.5px] disabled:opacity-40"
          style={{ color: 'var(--ink-700)' }}
          disabled={logs.length === 0}
          onClick={() => {
            const exportRows = (logs as any[]).map(row => ({
              Timestamp: new Date(row.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
              Actor: row.user_email ?? 'System',
              Table: row.table_name,
              Action: row.action,
              'Record ID': row.record_id ?? '',
            }))
            const ws = XLSX.utils.json_to_sheet(exportRows)
            ws['!cols'] = [22, 28, 22, 10, 36].map(w => ({ wch: w }))
            const wb = XLSX.utils.book_new()
            XLSX.utils.book_append_sheet(wb, ws, 'Activity Log')
            XLSX.writeFile(wb, `ActivityLog_${new Date().toISOString().slice(0, 10)}.xlsx`)
          }}
        >
          <DownloadCloud size={15} /> Export log
        </button>
      </div>

      {/* Filters */}
      <div className="surface !p-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[140px] space-y-1">
          <label className="ds-lbl">Table</label>
          <select
            className="ds-field"
            value={tableFilter}
            onChange={e => setTableFilter(e.target.value)}
          >
            {TABLES.map(t => <option key={t} value={t}>{t === 'all' ? 'All tables' : t}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[120px] space-y-1">
          <label className="ds-lbl">Action</label>
          <select
            className="ds-field"
            value={actionFilter}
            onChange={e => setActionFilter(e.target.value as typeof actionFilter)}
          >
            <option value="all">All actions</option>
            <option value="INSERT">INSERT</option>
            <option value="UPDATE">UPDATE</option>
            <option value="DELETE">DELETE</option>
          </select>
        </div>
        <div className="flex-1 min-w-[120px] space-y-1">
          <label className="ds-lbl">From</label>
          <input type="date" className="ds-field" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div className="flex-1 min-w-[120px] space-y-1">
          <label className="ds-lbl">To</label>
          <input type="date" className="ds-field" value={to} onChange={e => setTo(e.target.value)} />
        </div>
      </div>

      {/* Log list */}
      {isLoading ? (
        <div className="surface !p-8 text-center" style={{ color: 'var(--ink-400)' }}>
          Loading…
        </div>
      ) : logs.length === 0 ? (
        <div className="surface !p-12 flex flex-col items-center gap-4 text-center">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: 'var(--ink-100)', color: 'var(--ink-400)' }}
          >
            <History size={26} />
          </div>
          <p className="font-semibold" style={{ color: 'var(--ink-700)' }}>No activity found</p>
          <p className="text-[13px]" style={{ color: 'var(--ink-500)' }}>
            Try adjusting the date range or table filter.
          </p>
        </div>
      ) : (
        <div className="surface !p-0 overflow-hidden">
          <div className="divide-rows">
            {(logs as any[]).map(row => {
              const isExp = expanded === row.id
              const icon = TABLE_ICON[row.table_name] ?? <History size={17} />
              return (
                <div key={row.id}>
                  <button
                    className="w-full flex items-start gap-3.5 px-5 py-3.5 text-left hover:bg-[var(--ink-50)] transition-colors"
                    onClick={() => setExpanded(isExp ? null : row.id)}
                  >
                    <span
                      className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
                      style={{ background: 'var(--brand-50)', color: 'var(--brand-600)' }}
                    >
                      {icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13.5px]">
                        <span className="font-bold">{row.user_email ?? 'System'}</span>
                        {' '}
                        <span style={{ color: 'var(--ink-500)' }}>
                          {({ INSERT: 'inserted', UPDATE: 'updated', DELETE: 'deleted' } as Record<string, string>)[row.action] ?? row.action.toLowerCase()} a record in
                        </span>
                        {' '}
                        <span className="font-medium mono text-[12.5px]">{row.table_name}</span>
                      </p>
                      <p className="text-[11.5px] mono mt-0.5" style={{ color: 'var(--ink-400)' }}>
                        {new Date(row.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                      </p>
                    </div>
                    <span
                      className="ds-badge shrink-0 mt-0.5"
                      style={{ background: actionBg(row.action), color: actionColor(row.action) }}
                    >
                      {row.action}
                    </span>
                  </button>
                  {isExp && (
                    <div className="px-5 pb-4 pt-1" style={{ background: 'var(--ink-50)', borderTop: '1px solid var(--ink-150)' }}>
                      <div className="flex gap-3 flex-wrap">
                        {['old_val', 'new_val'].map(k => (
                          <div key={k} className="flex-1 min-w-48">
                            <p className="text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--ink-400)' }}>
                              {k === 'old_val' ? 'Before' : 'After'}
                            </p>
                            <pre
                              className="text-[11px] rounded-xl p-3 overflow-x-auto whitespace-pre-wrap break-all"
                              style={{ background: '#fff', border: '1px solid var(--ink-200)', color: 'var(--ink-700)' }}
                            >
                              {(row as any)[k] ? JSON.stringify((row as any)[k], null, 2) : 'null'}
                            </pre>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
