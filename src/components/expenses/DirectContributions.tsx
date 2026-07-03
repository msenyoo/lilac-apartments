import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { formatINR } from '@/lib/tagger'

export interface StagedContribution {
  key: string
  flat_id: string
  amount: number
  corpus_plan_id: string | null
}

export interface DirectCr {
  id: string
  amount: number
  flat_code: string | null
  plan_id: string | null
  value_date: string
}

export function directTotalOf(
  txns: { amount: number; cr_dr: string; source: string; row_type: string }[] | undefined,
): number {
  if (!txns) return 0
  return txns
    .filter(t => t.cr_dr === 'CR' && t.source === 'Direct' && t.row_type !== 'VOIDED')
    .reduce((s, t) => s + t.amount, 0)
}

export function DirectContributionsSection({ expenseId, expenseAmount, corpusPlanId, staged, onStagedChange }: {
  expenseId: string | null
  expenseAmount: number
  corpusPlanId: string | null
  staged: StagedContribution[]
  onStagedChange: (rows: StagedContribution[]) => void
}) {
  const qc = useQueryClient()
  const isEditMode = expenseId !== null

  const { data: flats = [] } = useQuery({
    queryKey: ['flats-list'],
    queryFn: async () => {
      const { data } = await supabase.from('flats').select('id, code').order('code')
      return (data ?? []) as { id: string; code: string }[]
    },
  })

  const { data: corpusPlans = [] } = useQuery({
    queryKey: ['corpus-plans-active'],
    queryFn: async () => {
      const { data } = await supabase.from('corpus_plans').select('id,name').in('status', ['active', 'draft']).order('name')
      return (data ?? []) as { id: string; name: string }[]
    },
  })

  const { data: liveCrs = [] } = useQuery({
    queryKey: ['direct-crs', expenseId],
    enabled: isEditMode,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('id, amount, flat_code, plan_id, value_date')
        .eq('expense_id', expenseId!)
        .eq('source', 'Direct')
        .eq('cr_dr', 'CR')
        .neq('row_type', 'VOIDED')
        .order('created_at')
      if (error) throw error
      return (data ?? []) as DirectCr[]
    },
  })

  const [draft, setDraft] = useState<StagedContribution | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const total = isEditMode
    ? liveCrs.reduce((s, c) => s + c.amount, 0)
    : staged.reduce((s, c) => s + (Number(c.amount) || 0), 0)
  const remainder = expenseAmount - total
  const over = total > expenseAmount

  function newRow(): StagedContribution {
    return { key: crypto.randomUUID(), flat_id: '', amount: 0, corpus_plan_id: corpusPlanId }
  }

  function updateStaged(key: string, patch: Partial<StagedContribution>) {
    onStagedChange(staged.map(r => r.key === key ? { ...r, ...patch } : r))
  }

  async function handleAddLive() {
    if (!draft || !draft.flat_id || !(Number(draft.amount) > 0)) return
    setBusy(true)
    const { error } = await supabase.rpc('add_direct_contribution', {
      p_expense_id: expenseId,
      p_flat_id: draft.flat_id,
      p_amount: Number(draft.amount),
      p_corpus_plan_id: draft.corpus_plan_id,
    })
    setBusy(false)
    if (error) { toast.error(error.message); return }
    setDraft(null)
    qc.invalidateQueries({ queryKey: ['direct-crs', expenseId] })
    qc.invalidateQueries({ queryKey: ['expenses'] })
  }

  async function handleVoidLive(crId: string) {
    setBusy(true)
    const { error } = await supabase.rpc('void_direct_pairs', {
      p_expense_id: expenseId,
      p_cr_id: crId,
    })
    setBusy(false)
    setConfirmId(null)
    if (error) { toast.error(error.message); return }
    qc.invalidateQueries({ queryKey: ['direct-crs', expenseId] })
    qc.invalidateQueries({ queryKey: ['expenses'] })
  }

  function rowInputs(row: StagedContribution, onChange: (patch: Partial<StagedContribution>) => void, onRemove: () => void) {
    return (
      <div key={row.key} className="grid grid-cols-[1fr_100px_1fr_28px] gap-2 items-center">
        <select
          value={row.flat_id}
          onChange={e => onChange({ flat_id: e.target.value })}
          className="h-9 px-2 border rounded text-sm"
        >
          <option value="">Flat…</option>
          {flats.map(f => <option key={f.id} value={f.id}>{f.code}</option>)}
        </select>
        <input
          type="number"
          min={1}
          placeholder="₹"
          value={row.amount || ''}
          onChange={e => onChange({ amount: Math.floor(Number(e.target.value)) || 0 })}
          className="h-9 px-2 border rounded text-sm"
        />
        <select
          value={row.corpus_plan_id ?? ''}
          onChange={e => onChange({ corpus_plan_id: e.target.value || null })}
          className="h-9 px-2 border rounded text-sm"
        >
          <option value="">— Maintenance —</option>
          {corpusPlans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button type="button" onClick={onRemove} className="hover:text-red-500 justify-self-center" style={{ color: 'var(--ink-400)' }}>
          <Trash2 size={14} />
        </button>
      </div>
    )
  }

  return (
    <section className="flex flex-col gap-3">
      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-500)' }}>
        Direct contributions (owner paid vendor)
      </p>

      {isEditMode ? (
        <>
          {liveCrs.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {liveCrs.map(c => (
                <div key={c.id} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--ink-50)' }}>
                  <span className="font-medium" style={{ color: 'var(--ink-700)' }}>{c.flat_code ?? '—'}</span>
                  <span className="text-xs" style={{ color: 'var(--ink-400)' }}>{c.plan_id ? 'Corpus' : 'Maintenance'}</span>
                  <span className="flex-1" />
                  <span className="font-medium" style={{ color: 'var(--ink-800)' }}>{formatINR(c.amount)}</span>
                  {confirmId === c.id ? (
                    <button type="button" disabled={busy} onClick={() => handleVoidLive(c.id)} className="text-xs font-semibold text-red-600 hover:text-red-700">
                      {busy ? 'Removing…' : 'Confirm remove?'}
                    </button>
                  ) : (
                    <button type="button" onClick={() => setConfirmId(c.id)} className="hover:text-red-500" style={{ color: 'var(--ink-400)' }}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {draft ? (
            <div className="flex flex-col gap-2">
              {rowInputs(draft, patch => setDraft(d => d ? { ...d, ...patch } : d), () => setDraft(null))}
              <button
                type="button"
                disabled={busy || !draft.flat_id || !(Number(draft.amount) > 0)}
                onClick={handleAddLive}
                className="self-start text-sm text-brand-600 hover:text-brand-800 font-medium disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Save contribution'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setDraft(newRow())}
              className="flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-800 font-medium self-start"
            >
              <Plus size={14} /> Add contribution
            </button>
          )}
        </>
      ) : (
        <>
          {staged.length > 0 && (
            <div className="flex flex-col gap-2">
              {staged.map(row => rowInputs(
                row,
                patch => updateStaged(row.key, patch),
                () => onStagedChange(staged.filter(r => r.key !== row.key)),
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => onStagedChange([...staged, newRow()])}
            className="flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-800 font-medium self-start"
          >
            <Plus size={14} /> Add contribution
          </button>
        </>
      )}

      <p className="text-xs" style={{ color: over ? undefined : 'var(--ink-500)' }}>
        <span style={{ color: 'var(--ink-500)' }}>Contributions {formatINR(total)} · </span>
        <span className={over ? 'text-red-500 font-semibold' : ''}>Remainder {formatINR(remainder)}</span>
      </p>
    </section>
  )
}
