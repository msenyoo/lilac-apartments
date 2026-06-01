import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Save, RefreshCw } from 'lucide-react'

const FY_OPTIONS = ['2022','2023','2024','2025','2026','2027','2028']
function fyLabel(y: string) { return `FY ${y}-${String(parseInt(y) + 1).slice(-2)}` }

export default function SettingsPage() {
  const qc = useQueryClient()

  const { data: settings, isLoading } = useQuery({
    queryKey: ['app-settings'],
    queryFn: async () => {
      const { data } = await supabase.from('app_settings').select('*')
      return Object.fromEntries((data ?? []).map(s => [s.key, s.value]))
    },
  })

  const [duesStartFY, setDuesStartFY] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)

  const currentStartFY = settings?.dues_start_fiscal_year ?? '2025'
  const workingStartFY = duesStartFY || currentStartFY

  async function handleSave() {
    setSaving(true)
    await supabase.from('app_settings').upsert([
      { key: 'dues_start_fiscal_year', value: workingStartFY, updated_at: new Date().toISOString() },
    ])
    qc.invalidateQueries()
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h2 className="text-xl font-semibold">Settings</h2>
        <p className="text-sm text-slate-500 mt-0.5">App configuration</p>
      </div>

      <div className="card p-5 space-y-4">
        <h3 className="font-semibold">Dues configuration</h3>

        <div className="max-w-xs">
          <label className="text-sm text-slate-600 block mb-1">Carry-forward from</label>
          <p className="text-xs text-slate-400 mb-2">Unpaid dues before this FY are ignored</p>
          <select
            value={workingStartFY}
            onChange={e => setDuesStartFY(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm bg-white"
          >
            {FY_OPTIONS.map(y => <option key={y} value={y}>{fyLabel(y)}</option>)}
          </select>
        </div>

        <button onClick={handleSave} disabled={saving || isLoading}
          className="btn-primary flex items-center gap-2">
          {saving ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}
          {saved ? 'Saved!' : 'Save settings'}
        </button>
      </div>

      {/* Upload history */}
      <UploadHistorySection />

      {/* About */}
      <div className="card p-5 space-y-2">
        <h3 className="font-semibold">About</h3>
        <div className="space-y-1 text-sm text-slate-500">
          <p>Lilac Apartment Association · Rajakil Pakkam, Chennai</p>
          <p>44 flats · A–E blocks</p>
          <p className="text-xs mt-2 text-slate-400">React 18 + Supabase · Built for association committee use</p>
        </div>
      </div>
    </div>
  )
}

function UploadHistorySection() {
  const { data } = useQuery({
    queryKey: ['uploads'],
    queryFn: async () => {
      const { data } = await supabase.from('uploads').select('*').order('created_at', { ascending: false }).limit(20)
      return data ?? []
    },
  })

  return (
    <div className="card p-5 space-y-3">
      <h3 className="font-semibold">Import history</h3>
      {!data?.length ? (
        <p className="text-sm text-slate-400">No imports yet</p>
      ) : (
        <div className="divide-y divide-slate-100 -mx-5">
          {data.map((u: any) => (
            <div key={u.id} className="flex justify-between items-start px-5 py-3 text-sm">
              <div>
                <p className="font-medium text-slate-700">{u.month_label || '—'}</p>
                <p className="text-xs text-slate-400 mt-0.5 truncate max-w-xs">{u.original_name}</p>
                <p className="text-xs text-slate-300">{new Date(u.created_at).toLocaleString('en-IN')}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-slate-500">{u.new_txns} added</p>
                {u.review_count > 0 && <span className="badge-review">{u.review_count} review</span>}
                {u.duplicates > 0 && <p className="text-xs text-slate-300">{u.duplicates} dupes</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
