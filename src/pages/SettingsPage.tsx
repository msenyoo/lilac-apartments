import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatINR } from '@/lib/tagger'
import { Save, RefreshCw, Plus, Pencil, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

const FY_OPTIONS = ['2022','2023','2024','2025','2026','2027','2028']
function fyLabel(y: string) { return `FY ${y}-${String(parseInt(y) + 1).slice(-2)}` }

type SettingsTab = 'general' | 'rates' | 'categories' | 'imports'

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
          { key: 'general',     label: 'General' },
          { key: 'rates',       label: 'Maintenance Rates' },
          { key: 'categories',  label: 'Expense Categories' },
          { key: 'imports',     label: 'Import History' },
        ] as { key: SettingsTab; label: string }[]).map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === key ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'general'    && <GeneralSettings />}
      {tab === 'rates'      && <RateHistorySettings />}
      {tab === 'categories' && <CategoriesSettings />}
      {tab === 'imports'    && <UploadHistorySection />}
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

  const [duesStartFY,    setDuesStartFY]    = useState('')
  const [collectionUpi,  setCollectionUpi]  = useState('')
  const [collectionBank, setCollectionBank] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)

  const currentStartFY    = settings?.dues_start_fiscal_year ?? '2025'
  const workingStartFY    = duesStartFY    || currentStartFY
  const workingUpi        = collectionUpi  !== '' ? collectionUpi  : (settings?.collection_upi  ?? '')
  const workingBank       = collectionBank !== '' ? collectionBank : (settings?.collection_bank ?? '')

  async function handleSave() {
    setSaving(true)
    await supabase.from('app_settings').upsert([
      { key: 'dues_start_fiscal_year', value: workingStartFY,  updated_at: new Date().toISOString() },
      { key: 'collection_upi',         value: workingUpi,      updated_at: new Date().toISOString() },
      { key: 'collection_bank',        value: workingBank,     updated_at: new Date().toISOString() },
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
      </div>

      <div className="card p-5 space-y-4">
        <h3 className="font-semibold">Collection payment details</h3>
        <p className="text-xs text-slate-400 -mt-2">Used in WhatsApp reminder messages sent to residents</p>
        <div className="space-y-3 max-w-md">
          <div>
            <label className="text-sm text-slate-600 block mb-1">UPI ID</label>
            <Input
              value={workingUpi}
              onChange={e => setCollectionUpi(e.target.value)}
              placeholder="e.g. lilacapts@upi"
              className="text-sm"
            />
          </div>
          <div>
            <label className="text-sm text-slate-600 block mb-1">Bank transfer details</label>
            <Input
              value={workingBank}
              onChange={e => setCollectionBank(e.target.value)}
              placeholder="e.g. A/c: 1234567890, IFSC: HDFC0001234, Name: Lilac Apt Association"
              className="text-sm"
            />
          </div>
        </div>
      </div>

      <div className="flex">
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

// ── Expense categories settings ───────────────────────────────

interface ExpenseCategory {
  id: string; name: string; budget_type: string
  is_utility: boolean; unit_label: string | null; sort_order: number
}

function CategoriesSettings() {
  const qc = useQueryClient()
  const [editTarget, setEditTarget] = useState<ExpenseCategory | null>(null)
  const [addOpen, setAddOpen]       = useState(false)

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['expense-categories-all'],
    queryFn: async () => {
      const { data } = await supabase
        .from('expense_categories')
        .select('id, name, budget_type, is_utility, unit_label, sort_order')
        .order('sort_order')
      return (data ?? []) as ExpenseCategory[]
    },
  })

  const maintenance = categories.filter(c => c.budget_type === 'Maintenance')
  const corpus      = categories.filter(c => c.budget_type === 'Corpus')

  async function toggleUtility(cat: ExpenseCategory) {
    await supabase
      .from('expense_categories')
      .update({ is_utility: !cat.is_utility })
      .eq('id', cat.id)
    qc.invalidateQueries({ queryKey: ['expense-categories-all'] })
    qc.invalidateQueries({ queryKey: ['utility-categories'] })
    qc.invalidateQueries({ queryKey: ['expense-categories'] })
  }

  if (isLoading) return <div className="card h-40 animate-pulse bg-slate-100" />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Categories marked as utility appear in the Utility report tab with per-block tracking.
        </p>
        <Button size="sm" onClick={() => setAddOpen(true)} className="flex items-center gap-1.5 shrink-0">
          <Plus size={14} /> Add Category
        </Button>
      </div>

      {(['Maintenance', 'Corpus'] as const).map(budgetType => {
        const rows = budgetType === 'Maintenance' ? maintenance : corpus
        return (
          <div key={budgetType} className="card overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{budgetType}</p>
            </div>
            <div className="divide-y divide-slate-100">
              {rows.map(cat => (
                <div key={cat.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="text-xs text-slate-400 w-6 shrink-0 text-right">{cat.sort_order}</span>
                  <span className="flex-1 text-sm font-medium text-slate-800">{cat.name}</span>
                  {cat.is_utility && cat.unit_label && (
                    <span className="text-xs text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full font-medium shrink-0">
                      {cat.unit_label}
                    </span>
                  )}
                  <button
                    onClick={() => toggleUtility(cat)}
                    title={cat.is_utility ? 'Shown in Utility report — click to remove' : 'Click to add to Utility report'}
                    className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium transition-colors shrink-0 ${
                      cat.is_utility
                        ? 'bg-amber-100 text-amber-700 hover:bg-slate-100 hover:text-slate-500'
                        : 'bg-slate-100 text-slate-400 hover:bg-amber-100 hover:text-amber-700'
                    }`}
                  >
                    <Zap size={10} />
                    {cat.is_utility ? 'Utility' : 'Not utility'}
                  </button>
                  <button
                    onClick={() => setEditTarget(cat)}
                    className="p-1 text-slate-400 hover:text-slate-700 transition-colors shrink-0"
                  >
                    <Pencil size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      <AddEditCategoryDialog
        key={editTarget?.id ?? 'new'}
        open={addOpen || !!editTarget}
        initial={editTarget}
        onClose={() => { setAddOpen(false); setEditTarget(null) }}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ['expense-categories-all'] })
          qc.invalidateQueries({ queryKey: ['utility-categories'] })
          qc.invalidateQueries({ queryKey: ['expense-categories'] })
        }}
      />
    </div>
  )
}

function AddEditCategoryDialog({ open, initial, onClose, onSuccess }: {
  open: boolean
  initial: ExpenseCategory | null
  onClose: () => void
  onSuccess: () => void
}) {
  const isEdit = !!initial
  const [name,       setName]       = useState(initial?.name ?? '')
  const [budgetType, setBudgetType] = useState(initial?.budget_type ?? 'Maintenance')
  const [isUtility,  setIsUtility]  = useState(initial?.is_utility ?? false)
  const [unitLabel,  setUnitLabel]  = useState(initial?.unit_label ?? '')
  const [sortOrder,  setSortOrder]  = useState(String(initial?.sort_order ?? ''))
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState('')

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true); setErr('')
    try {
      const payload = {
        name:        name.trim(),
        budget_type: budgetType,
        is_utility:  isUtility,
        unit_label:  isUtility && unitLabel ? unitLabel : null,
        sort_order:  sortOrder ? Number(sortOrder) : 99,
      }
      if (isEdit) {
        const { error } = await supabase.from('expense_categories').update(payload).eq('id', initial!.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('expense_categories').insert(payload)
        if (error) throw error
      }
      onSuccess(); onClose()
    } catch (e: any) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Category' : 'Add Category'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Painting, EB (Electricity)" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Budget type</Label>
              <Select value={budgetType} onValueChange={setBudgetType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Maintenance">Maintenance</SelectItem>
                  <SelectItem value="Corpus">Corpus</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Sort order</Label>
              <Input type="number" value={sortOrder} onChange={e => setSortOrder(e.target.value)} placeholder="99" />
            </div>
          </div>

          <div className="space-y-3 p-3 rounded-lg bg-amber-50 border border-amber-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
                  <Zap size={13} className="text-amber-500" /> Utility category
                </p>
                <p className="text-xs text-slate-400 mt-0.5">Appears in Utility report tab with block-wise tracking</p>
              </div>
              <button
                onClick={() => setIsUtility(u => !u)}
                className={`relative w-10 h-5 rounded-full transition-colors ${isUtility ? 'bg-amber-500' : 'bg-slate-200'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${isUtility ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>

            {isUtility && (
              <div className="space-y-1">
                <Label>Unit label</Label>
                <Input
                  value={unitLabel}
                  onChange={e => setUnitLabel(e.target.value)}
                  placeholder="kWh, trips, KL, L — leave blank for cost-only"
                />
                <p className="text-xs text-slate-400">Shown as column header when entering expense line items</p>
              </div>
            )}
          </div>

          {err && <p className="text-sm text-red-500">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!name.trim() || saving}>
            {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Category'}
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
