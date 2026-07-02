import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardPaste, Plus, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatINR } from '@/lib/tagger'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import {
  BulkDraftRow, emptyRow, parseClipboard, rowErrors, isRowEmpty,
  COST_CENTERS, PAYMENT_MODES, PAYEE_TYPES,
} from '@/lib/bulkPendingRows'

interface Category { id: string; name: string; budget_type: string; is_utility: boolean }
interface StaffMember { id: string; name: string; role: string }
interface Vendor { id: string; name: string }
interface CorpusPlan { id: string; name: string; status: string }

const inputCls = 'w-full h-8 px-1.5 border rounded text-sm bg-white'
const errCls = 'border-red-400'

export function BulkAddPendingDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [rows, setRows] = useState<BulkDraftRow[]>([emptyRow(), emptyRow(), emptyRow()])
  const [saving, setSaving] = useState(false)

  const { data: categories = [] } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: async () => {
      const { data } = await supabase.from('expense_categories').select('*').order('sort_order')
      return (data ?? []) as Category[]
    },
  })
  const { data: corpusPlans = [] } = useQuery({
    queryKey: ['corpus-plans-active'],
    queryFn: async () => {
      const { data } = await supabase.from('corpus_plans').select('id, name, status').in('status', ['active', 'draft'])
      return (data ?? []) as CorpusPlan[]
    },
  })
  const { data: staff = [] } = useQuery({
    queryKey: ['staff-active'],
    queryFn: async () => {
      const { data } = await supabase.from('staff').select('*').is('left_date', null)
      return (data ?? []) as StaffMember[]
    },
  })
  const { data: vendors = [] } = useQuery({
    queryKey: ['vendors-active'],
    queryFn: async () => {
      const { data } = await supabase.from('vendors').select('*').eq('is_active', true)
      return (data ?? []) as Vendor[]
    },
  })

  const activeRows = rows.filter(r => !isRowEmpty(r))
  const errorCount = activeRows.filter(r => Object.keys(rowErrors(r)).length > 0).length
  const total = activeRows.reduce((s, r) => s + (Number(r.amount) || 0), 0)

  function update(key: string, patch: Partial<BulkDraftRow>) {
    setRows(prev => prev.map(r => (r.key === key ? { ...r, ...patch } : r)))
  }
  function removeRow(key: string) {
    setRows(prev => (prev.length === 1 ? [emptyRow()] : prev.filter(r => r.key !== key)))
  }
  function handlePaste(text: string) {
    const parsed = parseClipboard(text, categories)
    if (parsed.length === 0) {
      toast.error('Nothing recognizable in the pasted text — expected columns: Date, Description, Amount')
      return
    }
    setRows(prev => [...prev.filter(r => !isRowEmpty(r)), ...parsed])
    toast.success(`${parsed.length} row(s) pasted — review and fill categories`)
  }

  async function save() {
    if (activeRows.length === 0 || errorCount > 0) return
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const payload = activeRows.map(r => ({
        paid_date: r.paid_date,
        description: r.description.trim(),
        amount: Number(r.amount),
        payment_mode: r.payment_mode,
        reference_no: r.reference_no || null,
        payee_type: r.payee_type,
        staff_id: r.payee_type === 'Staff' && r.staff_id ? r.staff_id : null,
        vendor_id: r.payee_type === 'Vendor' && r.vendor_id ? r.vendor_id : null,
        payee_name_raw: r.payee_type !== 'Staff' && r.payee_type !== 'Vendor' && r.payee_name_raw ? r.payee_name_raw : null,
        category_id: r.category_id,
        cost_center: r.cost_center,
        corpus_plan_id: r.corpus_plan_id || null,
        notes: r.notes || null,
        created_by: user?.id ?? null,
      }))
      const { error } = await supabase.from('pending_line_items').insert(payload)
      if (error) { toast.error(error.message); return }
      toast.success(`${payload.length} pending item(s) added · ${formatINR(total)}`)
      qc.invalidateQueries({ queryKey: ['pending-line-items'] })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  function payeeCell(r: BulkDraftRow, errs: ReturnType<typeof rowErrors>) {
    void errs
    return (
      <div className="flex gap-1">
        <select
          className={`${inputCls} !w-24 shrink-0`}
          value={r.payee_type}
          onChange={e => update(r.key, { payee_type: e.target.value as BulkDraftRow['payee_type'], staff_id: '', vendor_id: '', payee_name_raw: '' })}
        >
          {PAYEE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {r.payee_type === 'Staff' && (
          <select className={inputCls} value={r.staff_id} onChange={e => update(r.key, { staff_id: e.target.value })}>
            <option value="">Select staff…</option>
            {staff.map(s => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
          </select>
        )}
        {r.payee_type === 'Vendor' && (
          <select className={inputCls} value={r.vendor_id} onChange={e => update(r.key, { vendor_id: e.target.value })}>
            <option value="">Select vendor…</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        )}
        {r.payee_type !== 'Staff' && r.payee_type !== 'Vendor' && (
          <input className={inputCls} placeholder="Name (optional)" value={r.payee_name_raw} onChange={e => update(r.key, { payee_name_raw: e.target.value })} />
        )}
      </div>
    )
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-[96vw] lg:max-w-[1240px] max-h-[92vh] flex flex-col rounded-2xl p-3 md:p-5">
        <DialogHeader>
          <DialogTitle>Bulk add pending items</DialogTitle>
        </DialogHeader>

        <label
          className="flex items-center gap-2 border-2 border-dashed rounded-lg px-3 py-2 text-xs cursor-text"
          style={{ borderColor: 'var(--ink-200)', color: 'var(--ink-500)' }}
        >
          <ClipboardPaste size={14} className="shrink-0" />
          <span className="hidden sm:inline">Copy rows in Excel (Date · Description · Amount · Category) and paste here —</span>
          <textarea
            rows={1}
            value=""
            onChange={() => {}}
            onPaste={e => { e.preventDefault(); handlePaste(e.clipboardData.getData('text')) }}
            placeholder="paste from Excel…"
            className="flex-1 resize-none outline-none bg-transparent text-xs leading-6 h-6"
          />
        </label>

        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          {/* Desktop grid */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full border-separate" style={{ borderSpacing: '0 4px', minWidth: 1320 }}>
              <thead>
                <tr className="text-left text-xs uppercase" style={{ color: 'var(--ink-400)' }}>
                  <th className="w-[130px] px-1 font-medium">Date</th>
                  <th className="min-w-[210px] px-1 font-medium">Description</th>
                  <th className="w-[90px] px-1 font-medium">Amount</th>
                  <th className="w-[150px] px-1 font-medium">Category</th>
                  <th className="w-[110px] px-1 font-medium">Cost centre</th>
                  <th className="w-[110px] px-1 font-medium">Mode</th>
                  <th className="w-[230px] px-1 font-medium">Paid to</th>
                  <th className="w-[140px] px-1 font-medium">Corpus plan</th>
                  <th className="w-[100px] px-1 font-medium">Ref no</th>
                  <th className="w-[130px] px-1 font-medium">Notes</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const errs = isRowEmpty(r) ? {} : rowErrors(r)
                  return (
                    <tr key={r.key}>
                      <td className="px-1"><input type="date" className={`${inputCls} ${errs.paid_date ? errCls : ''}`} value={r.paid_date} onChange={e => update(r.key, { paid_date: e.target.value })} /></td>
                      <td className="px-1"><input className={`${inputCls} ${errs.description ? errCls : ''}`} value={r.description} onChange={e => update(r.key, { description: e.target.value })} /></td>
                      <td className="px-1"><input type="number" min="1" className={`${inputCls} ${errs.amount ? errCls : ''}`} value={r.amount} onChange={e => update(r.key, { amount: e.target.value })} /></td>
                      <td className="px-1">
                        <select className={`${inputCls} ${errs.category_id ? errCls : ''}`} value={r.category_id} onChange={e => update(r.key, { category_id: e.target.value })}>
                          <option value="">Select…</option>
                          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </td>
                      <td className="px-1">
                        <select className={inputCls} value={r.cost_center} onChange={e => update(r.key, { cost_center: e.target.value })}>
                          {COST_CENTERS.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                      <td className="px-1">
                        <select className={inputCls} value={r.payment_mode} onChange={e => update(r.key, { payment_mode: e.target.value as BulkDraftRow['payment_mode'] })}>
                          {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </td>
                      <td className="px-1">{payeeCell(r, errs)}</td>
                      <td className="px-1">
                        <select className={inputCls} value={r.corpus_plan_id} onChange={e => update(r.key, { corpus_plan_id: e.target.value })}>
                          <option value="">— Maintenance —</option>
                          {corpusPlans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </td>
                      <td className="px-1"><input className={inputCls} value={r.reference_no} onChange={e => update(r.key, { reference_no: e.target.value })} /></td>
                      <td className="px-1"><input className={inputCls} value={r.notes} onChange={e => update(r.key, { notes: e.target.value })} /></td>
                      <td className="px-1">
                        <button type="button" onClick={() => removeRow(r.key)} className="p-1.5 hover:bg-[var(--ink-100)] rounded">
                          <Trash2 size={14} style={{ color: 'var(--ink-400)' }} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="lg:hidden flex flex-col gap-3">
            {rows.map((r, idx) => {
              const errs = isRowEmpty(r) ? {} : rowErrors(r)
              return (
                <div key={r.key} className="border rounded-xl p-3 flex flex-col gap-2" style={{ borderColor: 'var(--ink-200)' }}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold" style={{ color: 'var(--ink-400)' }}>#{idx + 1}</span>
                    <button type="button" onClick={() => removeRow(r.key)} className="p-1 hover:bg-[var(--ink-100)] rounded">
                      <Trash2 size={14} style={{ color: 'var(--ink-400)' }} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-[11px] mb-0.5" style={{ color: 'var(--ink-500)' }}>Date</p>
                      <input type="date" className={`${inputCls} ${errs.paid_date ? errCls : ''}`} value={r.paid_date} onChange={e => update(r.key, { paid_date: e.target.value })} />
                    </div>
                    <div>
                      <p className="text-[11px] mb-0.5" style={{ color: 'var(--ink-500)' }}>Amount (₹)</p>
                      <input type="number" min="1" className={`${inputCls} ${errs.amount ? errCls : ''}`} value={r.amount} onChange={e => update(r.key, { amount: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] mb-0.5" style={{ color: 'var(--ink-500)' }}>Description</p>
                    <input className={`${inputCls} ${errs.description ? errCls : ''}`} value={r.description} onChange={e => update(r.key, { description: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-[11px] mb-0.5" style={{ color: 'var(--ink-500)' }}>Category</p>
                      <select className={`${inputCls} ${errs.category_id ? errCls : ''}`} value={r.category_id} onChange={e => update(r.key, { category_id: e.target.value })}>
                        <option value="">Select…</option>
                        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <p className="text-[11px] mb-0.5" style={{ color: 'var(--ink-500)' }}>Cost centre</p>
                      <select className={inputCls} value={r.cost_center} onChange={e => update(r.key, { cost_center: e.target.value })}>
                        {COST_CENTERS.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <p className="text-[11px] mb-0.5" style={{ color: 'var(--ink-500)' }}>Payment mode</p>
                      <select className={inputCls} value={r.payment_mode} onChange={e => update(r.key, { payment_mode: e.target.value as BulkDraftRow['payment_mode'] })}>
                        {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <div>
                      <p className="text-[11px] mb-0.5" style={{ color: 'var(--ink-500)' }}>Corpus plan</p>
                      <select className={inputCls} value={r.corpus_plan_id} onChange={e => update(r.key, { corpus_plan_id: e.target.value })}>
                        <option value="">— Maintenance —</option>
                        {corpusPlans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] mb-0.5" style={{ color: 'var(--ink-500)' }}>Paid to</p>
                    {payeeCell(r, errs)}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-[11px] mb-0.5" style={{ color: 'var(--ink-500)' }}>Ref no</p>
                      <input className={inputCls} value={r.reference_no} onChange={e => update(r.key, { reference_no: e.target.value })} />
                    </div>
                    <div>
                      <p className="text-[11px] mb-0.5" style={{ color: 'var(--ink-500)' }}>Notes</p>
                      <input className={inputCls} value={r.notes} onChange={e => update(r.key, { notes: e.target.value })} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-2 flex-wrap" style={{ borderTop: '1px solid var(--ink-100)' }}>
          <Button type="button" size="sm" variant="outline" onClick={() => setRows(prev => [...prev, emptyRow()])} className="flex items-center gap-1.5">
            <Plus size={14} /> Add row
          </Button>
          <div className="flex items-center gap-3 text-sm">
            <span style={{ color: 'var(--ink-500)' }}>
              {activeRows.length} item(s) · <span className="font-semibold" style={{ color: 'var(--ink-800)' }}>{formatINR(total)}</span>
              {errorCount > 0 && <span className="text-red-600"> · {errorCount} row(s) need fixes</span>}
            </span>
            <Button type="button" size="sm" onClick={save} disabled={saving || activeRows.length === 0 || errorCount > 0} style={{ background: 'var(--brand-600)', color: '#fff' }}>
              {saving ? 'Saving…' : `Save ${activeRows.length} item(s)`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
