import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatINR } from '@/lib/tagger'
import { Save, RefreshCw, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'

const FY_OPTIONS = ['2022','2023','2024','2025','2026','2027','2028']
function fyLabel(y: string) { return `FY ${y}-${String(parseInt(y) + 1).slice(-2)}` }

type SettingsTab = 'general' | 'rates' | 'imports'

export default function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>('general')

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h2 className="text-xl font-semibold">Settings</h2>
        <p className="text-sm text-slate-500 mt-0.5">App configuration</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {([
          { key: 'general', label: 'General' },
          { key: 'rates',   label: 'Maintenance Rates' },
          { key: 'imports', label: 'Import History' },
        ] as { key: SettingsTab; label: string }[]).map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === key ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'general' && <GeneralSettings />}
      {tab === 'rates'   && <RateHistorySettings />}
      {tab === 'imports' && <UploadHistorySection />}
    </div>
  )
}

// ── General settings ──────────────────────────────────────────

function GeneralSettings() {
  const qc = useQueryClient()

  const { data: settings, isLoading } = useQuery({
    queryKey: ['app-settings'],
    queryFn: async () => {
      const { data } = await supabase.from('app_settings').select('*')
      return Object.fromEntries((data ?? []).map((s: any) => [s.key, s.value]))
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
    <div className="space-y-4">
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

// ── Maintenance rate history ───────────────────────────────────

interface RateRow {
  id: string
  flat_id: string
  monthly_rate: number
  effective_from: string
  effective_to: string | null
  notes: string | null
  flat?: { code: string; block: string; maintenance_amt: number }
}

function RateHistorySettings() {
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [filterBlock, setFilterBlock] = useState<string>('all')

  const { data: rates = [], isLoading } = useQuery({
    queryKey: ['rate-history-all'],
    queryFn: async () => {
      const { data } = await supabase
        .from('maintenance_rate_history')
        .select('*, flat:flat_id(code, block, maintenance_amt)')
        .order('effective_from', { ascending: false })
      return (data ?? []) as RateRow[]
    },
  })

  const { data: flats = [] } = useQuery({
    queryKey: ['flats-simple'],
    queryFn: async () => {
      const { data } = await supabase.from('flats').select('id,code,block,maintenance_amt').order('code')
      return data ?? []
    },
  })

  const blocks = useMemo(() => [...new Set(flats.map((f: any) => f.block as string))].sort(), [flats])

  // Group: current rates per flat (effective_to IS NULL)
  const currentRates = rates.filter(r => !r.effective_to)
  const filteredCurrent = filterBlock === 'all'
    ? currentRates
    : currentRates.filter(r => r.flat?.block === filterBlock)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm text-slate-600">Current maintenance rates per flat. Changes apply forward-only from the effective date.</p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="flex items-center gap-2">
          <Plus size={15} /> Add Rate Change
        </Button>
      </div>

      {/* Block filter */}
      <div className="flex gap-1 flex-wrap">
        {['all', ...blocks].map(b => (
          <button key={b} onClick={() => setFilterBlock(b)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
              filterBlock === b ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}>
            {b === 'all' ? 'All blocks' : `Block ${b}`}
          </button>
        ))}
      </div>

      {/* Current rates table */}
      {isLoading ? (
        <div className="card h-32 animate-pulse bg-slate-100" />
      ) : (
        <div className="card divide-y divide-slate-100">
          <div className="grid grid-cols-4 px-4 py-2 bg-slate-50 rounded-t-xl text-xs font-semibold text-slate-500 uppercase tracking-wide">
            <span>Flat</span>
            <span>Block</span>
            <span className="text-right">Current rate</span>
            <span className="text-right">Effective from</span>
          </div>
          {filteredCurrent.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-400 text-center">No rates found</p>
          ) : (
            filteredCurrent.map(r => (
              <div key={r.id} className="grid grid-cols-4 px-4 py-3 text-sm items-center">
                <span className="font-medium text-slate-800">{r.flat?.code}</span>
                <span className="text-slate-500">{r.flat?.block}</span>
                <span className="text-right font-semibold text-slate-800">{formatINR(r.monthly_rate)}/mo</span>
                <span className="text-right text-slate-500">{r.effective_from}</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* Rate change history (last 10 closed periods) */}
      {rates.filter(r => r.effective_to).length > 0 && (
        <div className="card">
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-700">Rate change history</p>
          </div>
          <div className="divide-y divide-slate-100">
            {rates.filter(r => r.effective_to).slice(0, 20).map(r => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="font-medium w-12 shrink-0">{r.flat?.code}</span>
                <span className="text-slate-500 flex-1">{formatINR(r.monthly_rate)}/mo</span>
                <span className="text-slate-400 text-xs">{r.effective_from} → {r.effective_to}</span>
                {r.notes && <span className="text-xs text-slate-400 truncate max-w-32">{r.notes}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <AddRateChangeDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        flats={flats}
        currentRates={currentRates}
        onSuccess={() => qc.invalidateQueries({ queryKey: ['rate-history-all'] })}
      />
    </div>
  )
}

// ── Add Rate Change dialog ─────────────────────────────────────

function AddRateChangeDialog({ open, onClose, flats, currentRates, onSuccess }: {
  open: boolean
  onClose: () => void
  flats: any[]
  currentRates: RateRow[]
  onSuccess: () => void
}) {
  const [selectedFlatIds, setSelectedFlatIds] = useState<string[]>([])
  const [newRate,      setNewRate]      = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10))
  const [notes,        setNotes]        = useState('')
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  function reset() {
    setSelectedFlatIds([]); setNewRate(''); setEffectiveFrom(new Date().toISOString().slice(0, 10))
    setNotes(''); setError('')
  }

  function toggleFlat(id: string) {
    setSelectedFlatIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function handleSave() {
    if (!selectedFlatIds.length) { setError('Select at least one flat'); return }
    const rate = parseInt(newRate)
    if (!rate || rate <= 0) { setError('Enter a valid rate'); return }
    if (!effectiveFrom) { setError('Set an effective date'); return }
    setSaving(true); setError('')
    try {
      for (const flatId of selectedFlatIds) {
        // Close any open rate period for this flat
        const current = currentRates.find(r => r.flat_id === flatId)
        if (current) {
          // effective_to = day before effectiveFrom
          const prevDay = new Date(effectiveFrom)
          prevDay.setDate(prevDay.getDate() - 1)
          await supabase
            .from('maintenance_rate_history')
            .update({ effective_to: prevDay.toISOString().slice(0, 10) })
            .eq('id', current.id)
        }
        // Insert new rate row
        await supabase.from('maintenance_rate_history').insert({
          flat_id: flatId,
          monthly_rate: rate,
          effective_from: effectiveFrom,
          effective_to: null,
          notes: notes || null,
        })
      }
      onSuccess()
      reset()
      onClose()
    } catch (e: any) {
      setError(e.message ?? 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const blocks = [...new Set(flats.map((f: any) => f.block as string))].sort()

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose() } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Rate Change</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label>New monthly rate (₹) *</Label>
            <Input
              type="number"
              placeholder="e.g. 1800"
              value={newRate}
              onChange={e => setNewRate(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label>Effective from *</Label>
            <Input
              type="date"
              value={effectiveFrom}
              onChange={e => setEffectiveFrom(e.target.value)}
            />
            <p className="text-xs text-slate-400">Previous rate period will be closed the day before this date.</p>
          </div>

          <div className="space-y-1">
            <Label>Notes</Label>
            <Input
              placeholder="Optional reason for rate change"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Apply to flats * ({selectedFlatIds.length} selected)</Label>
            <div className="space-y-2">
              {blocks.map(block => {
                const blockFlats = flats.filter((f: any) => f.block === block)
                const allSelected = blockFlats.every((f: any) => selectedFlatIds.includes(f.id))
                return (
                  <div key={block}>
                    <div className="flex items-center gap-2 mb-1">
                      <button
                        type="button"
                        onClick={() => {
                          const ids = blockFlats.map((f: any) => f.id)
                          setSelectedFlatIds(prev =>
                            allSelected
                              ? prev.filter(id => !ids.includes(id))
                              : [...new Set([...prev, ...ids])]
                          )
                        }}
                        className="text-xs text-brand-600 hover:underline font-medium"
                      >
                        Block {block} {allSelected ? '(deselect all)' : '(select all)'}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {blockFlats.map((f: any) => {
                        const current = currentRates.find(r => r.flat_id === f.id)
                        return (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => toggleFlat(f.id)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                              selectedFlatIds.includes(f.id)
                                ? 'bg-brand-600 text-white border-brand-600'
                                : 'bg-white text-slate-600 border-slate-200 hover:border-brand-400'
                            }`}
                          >
                            {f.code}
                            {current && <span className="ml-1 opacity-60">{formatINR(current.monthly_rate)}</span>}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose() }}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : `Apply to ${selectedFlatIds.length} flat${selectedFlatIds.length !== 1 ? 's' : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Upload / import history ────────────────────────────────────

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
