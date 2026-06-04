import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, useFieldArray, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Trash2, Download, Receipt, Users, Building, X } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { formatINR } from '@/lib/tagger'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

// ── Types ─────────────────────────────────────────────────────

interface ExpenseCategory { id: string; name: string; budget_type: string; is_utility: boolean }
interface Vendor  { id: string; name: string; type: string | null; phone: string | null }
interface StaffMember { id: string; name: string; role: string; assigned_area: string | null; phone: string | null; left_date: string | null }
interface Expense {
  id: string; expense_date: string; description: string
  payee_type: string; payee_name_raw: string | null
  amount: number; payment_mode: string
  reference_no: string | null; cheque_number: string | null; voucher_no: string | null
  transaction_id: string | null; reconciled_at: string | null
  notes: string | null; created_at: string
  category: ExpenseCategory | null
  vendor: Vendor | null
  staff_member: StaffMember | null
  corpus_plan: { name: string } | null
  line_items: ExpenseLineItem[]
}
interface ExpenseLineItem {
  id: string; payee_type: string; payee_name_raw: string | null
  description: string; cost_center: string; amount: number
  utility_units: number | null; utility_rate: number | null
  period_from: string | null; period_to: string | null
  category: ExpenseCategory | null
}

// ── Zod schema ────────────────────────────────────────────────

const lineItemSchema = z.object({
  description:    z.string().min(1, 'Required'),
  payee_type:     z.string().min(1),
  payee_name_raw: z.string().optional(),
  staff_id:       z.string().optional(),
  vendor_id:      z.string().optional(),
  category_id:    z.string().min(1, 'Required'),
  cost_center:    z.string().min(1, 'Required'),
  amount:         z.coerce.number().int().positive('Must be > 0'),
  utility_units:  z.coerce.number().optional(),
  utility_rate:   z.coerce.number().optional(),
  period_from:    z.string().optional(),
  period_to:      z.string().optional(),
})

const expenseSchema = z.object({
  expense_date:   z.string().min(1, 'Required'),
  description:    z.string().min(1, 'Required'),
  payee_type:     z.string().min(1, 'Required'),
  payee_name_raw: z.string().optional(),
  staff_id:       z.string().optional(),
  vendor_id:      z.string().optional(),
  amount:         z.coerce.number().int().positive('Must be > 0'),
  payment_mode:   z.string().min(1, 'Required'),
  reference_no:   z.string().optional(),
  cheque_number:  z.string().optional(),
  category_id:    z.string().optional(),
  corpus_plan_id: z.string().optional(),
  notes:          z.string().optional(),
  line_items:     z.array(lineItemSchema).min(1, 'At least one line item required'),
})

type ExpenseFormData = z.infer<typeof expenseSchema>

const PAYEE_TYPES  = ['Staff', 'Vendor', 'Intermediary', 'Municipal', 'Other']
const PAYMENT_MODES = ['Cash', 'Online', 'Bank Transfer', 'Cheque']
const COST_CENTERS = ['Block-A', 'Block-B', 'Block-C', 'Block-D', 'Block-E', 'Common', 'Municipal', 'All']

function expenseStatus(e: Expense) {
  if (e.payment_mode === 'Cash') return 'Cash'
  if (e.reconciled_at || e.transaction_id) return 'Reconciled'
  return 'Unreconciled'
}

const STATUS_STYLE: Record<string, string> = {
  Cash:          'bg-slate-100 text-slate-600',
  Reconciled:    'bg-green-100 text-green-700',
  Unreconciled:  'bg-amber-100 text-amber-700',
}

// ── Page ──────────────────────────────────────────────────────

export default function ExpensesPage() {
  const [tab, setTab] = useState<'daybook' | 'vendors' | 'staff'>('daybook')
  const [addOpen, setAddOpen] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-semibold">Expenses</h2>
          <p className="text-sm text-slate-500 mt-0.5">Day book · Vendors · Staff</p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="flex items-center gap-2">
          <Plus size={16} /> Add Expense
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {([
          { key: 'daybook', label: 'Day Book',    icon: Receipt },
          { key: 'vendors', label: 'Vendors',     icon: Building },
          { key: 'staff',   label: 'Staff',       icon: Users },
        ] as { key: typeof tab; label: string; icon: any }[]).map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === key ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
            }`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'daybook' && <DayBook />}
      {tab === 'vendors' && <VendorsTab />}
      {tab === 'staff'   && <StaffTab />}

      <AddExpenseDialog open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  )
}

// ── Day Book ──────────────────────────────────────────────────

function DayBook() {
  const [detailId, setDetailId] = useState<string | null>(null)

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ['expenses'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select(`
          *,
          category:category_id(id,name,budget_type,is_utility),
          vendor:vendor_id(id,name,type,phone),
          staff_member:staff_id(id,name,role,assigned_area,phone,left_date),
          corpus_plan:corpus_plan_id(name),
          line_items:expense_line_items(*, category:category_id(id,name,budget_type,is_utility))
        `)
        .order('expense_date', { ascending: false })
      if (error) throw error
      return (data ?? []) as Expense[]
    },
  })

  const selectedExpense = expenses.find(e => e.id === detailId) ?? null

  function handleExport() {
    const ws = XLSX.utils.json_to_sheet(expenses.map(e => ({
      Date:        e.expense_date,
      Voucher:     e.voucher_no,
      Description: e.description,
      Payee:       e.payee_name_raw ?? e.vendor?.name ?? e.staff_member?.name ?? '',
      Category:    e.category?.name ?? '',
      Amount:      e.amount,
      Mode:        e.payment_mode,
      Reference:   e.reference_no ?? '',
      Status:      expenseStatus(e),
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Day Book')
    XLSX.writeFile(wb, 'Expenses_DayBook.xlsx')
  }

  // Summary cards
  const totalThisMonth = expenses
    .filter(e => e.expense_date.startsWith(new Date().toISOString().slice(0, 7)))
    .reduce((s, e) => s + e.amount, 0)
  const unreconciled = expenses.filter(e => expenseStatus(e) === 'Unreconciled').length
  const totalAll     = expenses.reduce((s, e) => s + e.amount, 0)

  if (isLoading) return <div className="card h-48 animate-pulse bg-slate-100" />

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-4 bg-white">
          <p className="text-xs text-slate-500 mb-1">This month</p>
          <p className="text-xl font-bold text-slate-800">{formatINR(totalThisMonth)}</p>
        </div>
        <div className="card p-4 bg-white">
          <p className="text-xs text-slate-500 mb-1">Total recorded</p>
          <p className="text-xl font-bold text-slate-800">{formatINR(totalAll)}</p>
        </div>
        <div className={`card p-4 ${unreconciled > 0 ? 'bg-amber-50' : 'bg-white'}`}>
          <p className="text-xs text-slate-500 mb-1">Unreconciled</p>
          <p className={`text-xl font-bold ${unreconciled > 0 ? 'text-amber-600' : 'text-slate-400'}`}>{unreconciled}</p>
        </div>
        <div className="card p-4 bg-white">
          <p className="text-xs text-slate-500 mb-1">Total entries</p>
          <p className="text-xl font-bold text-slate-800">{expenses.length}</p>
        </div>
      </div>

      {/* Export */}
      <div className="flex justify-end">
        <button onClick={handleExport} disabled={!expenses.length}
          className="flex items-center gap-1.5 text-sm text-brand-700 hover:text-brand-900 disabled:opacity-40">
          <Download size={14} /> Export
        </button>
      </div>

      {expenses.length === 0 ? (
        <div className="card p-12 flex flex-col items-center justify-center text-center gap-4">
          <div className="w-14 h-14 rounded-full bg-brand-100 flex items-center justify-center">
            <Receipt size={26} className="text-brand-600" />
          </div>
          <div>
            <p className="text-base font-medium text-slate-800">No expenses recorded yet</p>
            <p className="text-sm text-slate-500 mt-1">Click "Add Expense" to record the first entry.</p>
          </div>
        </div>
      ) : (
        <div className="flex gap-4">
          {/* List */}
          <div className="flex-1 min-w-0 card divide-y divide-slate-100">
            {expenses.map(e => {
              const status = expenseStatus(e)
              const payeeName = e.payee_name_raw ?? e.vendor?.name ?? e.staff_member?.name ?? ''
              return (
                <button
                  key={e.id}
                  onClick={() => setDetailId(d => d === e.id ? null : e.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left transition-colors ${detailId === e.id ? 'bg-violet-50' : ''}`}
                >
                  <div className="shrink-0 text-center w-10">
                    <p className="text-xs font-bold text-slate-800 leading-tight">
                      {new Date(e.expense_date).getDate().toString().padStart(2, '0')}
                    </p>
                    <p className="text-[10px] text-slate-400 uppercase">
                      {new Date(e.expense_date).toLocaleString('en', { month: 'short' })}
                    </p>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <p className="text-sm font-medium text-slate-800 truncate">{e.description}</p>
                      {e.voucher_no && (
                        <span className="text-[10px] text-slate-400 shrink-0">{e.voucher_no}</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 truncate mt-0.5">
                      {payeeName} · {e.category?.name ?? e.payment_mode}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[status]}`}>
                      {status}
                    </span>
                    <span className="text-sm font-semibold text-slate-800">{formatINR(e.amount)}</span>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Detail panel */}
          {selectedExpense && (
            <ExpenseDetailPanel expense={selectedExpense} onClose={() => setDetailId(null)} />
          )}
        </div>
      )}
    </div>
  )
}

// ── Expense detail panel ──────────────────────────────────────

function ExpenseDetailPanel({ expense: e, onClose }: { expense: Expense; onClose: () => void }) {
  const status = expenseStatus(e)
  const payeeName = e.payee_name_raw ?? e.vendor?.name ?? e.staff_member?.name ?? '—'
  const lineTotal = e.line_items.reduce((s, li) => s + li.amount, 0)

  return (
    <div className="w-80 shrink-0 space-y-3">
      <div className="card p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-slate-800">{e.description}</h3>
            {e.voucher_no && <p className="text-xs text-slate-400 mt-0.5">{e.voucher_no}</p>}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 shrink-0"><X size={15} /></button>
        </div>

        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[status]}`}>{status}</span>

        <div className="space-y-1.5 text-sm">
          <Row label="Date"     value={e.expense_date} />
          <Row label="Amount"   value={<span className="font-bold text-slate-800">{formatINR(e.amount)}</span>} />
          <Row label="Payee"    value={payeeName} />
          <Row label="Mode"     value={e.payment_mode} />
          {e.reference_no   && <Row label="Reference" value={e.reference_no} />}
          {e.cheque_number  && <Row label="Cheque"    value={e.cheque_number} />}
          {e.category       && <Row label="Category"  value={e.category.name} />}
          {e.corpus_plan    && <Row label="Corpus"    value={e.corpus_plan.name} />}
          {e.notes          && <Row label="Notes"     value={e.notes} />}
        </div>
      </div>

      {e.line_items.length > 0 && (
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">Line items</h4>
            {lineTotal !== e.amount && (
              <span className="text-xs text-red-500 font-medium">⚠ {formatINR(lineTotal)} / {formatINR(e.amount)}</span>
            )}
          </div>
          <div className="space-y-2">
            {e.line_items.map(li => (
              <div key={li.id} className="bg-slate-50 rounded-lg p-2.5 text-xs space-y-1">
                <div className="flex justify-between font-medium">
                  <span className="text-slate-700">{li.description}</span>
                  <span className="text-slate-800">{formatINR(li.amount)}</span>
                </div>
                <div className="text-slate-400 flex gap-2 flex-wrap">
                  <span>{li.cost_center}</span>
                  {li.category && <span>· {li.category.name}</span>}
                  {li.utility_units != null && li.utility_rate != null && (
                    <span>· {li.utility_units} units × ₹{li.utility_rate}</span>
                  )}
                  {li.period_from && <span>· {li.period_from} – {li.period_to}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className="text-slate-800 text-right">{value}</span>
    </div>
  )
}

// ── Add Expense dialog ────────────────────────────────────────

function AddExpenseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()

  const { data: categories = [] } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: async () => {
      const { data } = await supabase.from('expense_categories').select('*').order('sort_order')
      return (data ?? []) as ExpenseCategory[]
    },
  })

  const { data: vendors = [] } = useQuery({
    queryKey: ['vendors'],
    queryFn: async () => {
      const { data } = await supabase.from('vendors').select('*').order('name')
      return (data ?? []) as Vendor[]
    },
  })

  const { data: staffList = [] } = useQuery({
    queryKey: ['staff'],
    queryFn: async () => {
      const { data } = await supabase.from('staff').select('*').order('name')
      return (data ?? []) as StaffMember[]
    },
  })

  const { data: corpusPlans = [] } = useQuery({
    queryKey: ['corpus-plans-active'],
    queryFn: async () => {
      const { data } = await supabase.from('corpus_plans').select('id,name').in('status', ['active', 'draft']).order('name')
      return data ?? []
    },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { register, control, handleSubmit, watch, reset, formState: { errors, isSubmitting } } = useForm<ExpenseFormData>({
    resolver: zodResolver(expenseSchema) as any,
    defaultValues: {
      expense_date: new Date().toISOString().slice(0, 10),
      payee_type:   'Vendor',
      payment_mode: 'Online',
      line_items: [{ description: '', payee_type: 'Other', cost_center: 'Common', category_id: '', amount: 0 }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'line_items' })

  const watchedAmount    = watch('amount') ?? 0
  const watchedPayeeType = watch('payee_type')
  const watchedMode      = watch('payment_mode')
  const lineItems        = watch('line_items') ?? []
  const lineTotal        = lineItems.reduce((s, li) => s + (Number(li.amount) || 0), 0)
  const lineBalanceDiff  = Number(watchedAmount) - lineTotal

  const mutation = useMutation({
    mutationFn: async (data: ExpenseFormData) => {
      const { data: { user } } = await supabase.auth.getUser()

      const headerPayload: any = {
        expense_date:   data.expense_date,
        description:    data.description,
        payee_type:     data.payee_type,
        payee_name_raw: data.payee_name_raw || null,
        staff_id:       data.staff_id   || null,
        vendor_id:      data.vendor_id  || null,
        amount:         data.amount,
        payment_mode:   data.payment_mode,
        reference_no:   data.reference_no   || null,
        cheque_number:  data.cheque_number  || null,
        category_id:    data.category_id    || null,
        corpus_plan_id: data.corpus_plan_id || null,
        notes:          data.notes || null,
        created_by:     user?.id ?? null,
      }

      const { data: expense, error: hErr } = await supabase
        .from('expenses')
        .insert(headerPayload)
        .select()
        .single()
      if (hErr) throw hErr

      const linePayloads = data.line_items.map(li => ({
        expense_id:     expense.id,
        payee_type:     li.payee_type,
        payee_name_raw: li.payee_name_raw || null,
        staff_id:       li.staff_id   || null,
        vendor_id:      li.vendor_id  || null,
        description:    li.description,
        category_id:    li.category_id,
        cost_center:    li.cost_center,
        amount:         li.amount,
        utility_units:  li.utility_units  || null,
        utility_rate:   li.utility_rate   || null,
        period_from:    li.period_from    || null,
        period_to:      li.period_to      || null,
      }))

      const { error: liErr } = await supabase.from('expense_line_items').insert(linePayloads)
      if (liErr) throw liErr
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] })
      reset()
      onClose()
    },
  })

  const maintenanceCats = categories.filter(c => c.budget_type === 'Maintenance')
  const corpusCats      = categories.filter(c => c.budget_type === 'Corpus')

  function getCategoryIsUtility(catId: string) {
    return categories.find(c => c.id === catId)?.is_utility ?? false
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose() } }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Expense</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit((d: any) => mutation.mutateAsync(d))} className="space-y-6">
          {/* ── Header ────────────────────────────────── */}
          <section className="space-y-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Payment header</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Date *</Label>
                <Input type="date" {...register('expense_date')} />
                {errors.expense_date && <p className="text-xs text-red-500">{errors.expense_date.message}</p>}
              </div>
              <div className="space-y-1">
                <Label>Amount (₹) *</Label>
                <Input type="number" placeholder="0" {...register('amount')} />
                {errors.amount && <p className="text-xs text-red-500">{errors.amount.message}</p>}
              </div>
            </div>

            <div className="space-y-1">
              <Label>Description *</Label>
              <Input placeholder="e.g. Security salary June 2026" {...register('description')} />
              {errors.description && <p className="text-xs text-red-500">{errors.description.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Payee type *</Label>
                <Controller name="payee_type" control={control} render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAYEE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )} />
              </div>
              <div className="space-y-1">
                {watchedPayeeType === 'Vendor' || watchedPayeeType === 'Intermediary' ? (
                  <>
                    <Label>Vendor</Label>
                    <Controller name="vendor_id" control={control} render={({ field }) => (
                      <Select value={field.value ?? ''} onValueChange={field.onChange}>
                        <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
                        <SelectContent>
                          {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )} />
                  </>
                ) : watchedPayeeType === 'Staff' ? (
                  <>
                    <Label>Staff member</Label>
                    <Controller name="staff_id" control={control} render={({ field }) => (
                      <Select value={field.value ?? ''} onValueChange={field.onChange}>
                        <SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger>
                        <SelectContent>
                          {staffList.map(s => <SelectItem key={s.id} value={s.id}>{s.name} ({s.role})</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )} />
                  </>
                ) : (
                  <>
                    <Label>Payee name</Label>
                    <Input placeholder="Payee name" {...register('payee_name_raw')} />
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Payment mode *</Label>
                <Controller name="payment_mode" control={control} render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_MODES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )} />
              </div>
              <div className="space-y-1">
                {(watchedMode === 'Online' || watchedMode === 'Bank Transfer') ? (
                  <>
                    <Label>Reference / UTR</Label>
                    <Input placeholder="NEFT/UPI reference" {...register('reference_no')} />
                  </>
                ) : watchedMode === 'Cheque' ? (
                  <>
                    <Label>Cheque number</Label>
                    <Input placeholder="Cheque no." {...register('cheque_number')} />
                  </>
                ) : <div />}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Category</Label>
                <Controller name="category_id" control={control} render={({ field }) => (
                  <Select value={field.value ?? ''} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                    <SelectContent>
                      {maintenanceCats.length > 0 && (
                        <>
                          <p className="px-2 py-1 text-[10px] text-slate-400 font-semibold uppercase">Maintenance</p>
                          {maintenanceCats.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </>
                      )}
                      {corpusCats.length > 0 && (
                        <>
                          <p className="px-2 py-1 text-[10px] text-slate-400 font-semibold uppercase">Corpus</p>
                          {corpusCats.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </>
                      )}
                    </SelectContent>
                  </Select>
                )} />
              </div>
              {corpusPlans.length > 0 && (
                <div className="space-y-1">
                  <Label>Corpus plan (if applicable)</Label>
                  <Controller name="corpus_plan_id" control={control} render={({ field }) => (
                    <Select value={field.value ?? ''} onValueChange={field.onChange}>
                      <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                      <SelectContent>
                        {corpusPlans.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )} />
                </div>
              )}
            </div>

            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea placeholder="Optional remarks" rows={2} {...register('notes')} />
            </div>
          </section>

          {/* ── Line items ─────────────────────────────── */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Split / line items</p>
              <div className={`text-sm font-medium ${lineBalanceDiff === 0 ? 'text-green-600' : 'text-red-500'}`}>
                {lineTotal > 0 && (
                  <span>
                    {formatINR(lineTotal)} / {formatINR(Number(watchedAmount) || 0)}
                    {lineBalanceDiff !== 0 && ` (${lineBalanceDiff > 0 ? '-' : '+'}${formatINR(Math.abs(lineBalanceDiff))})`}
                  </span>
                )}
              </div>
            </div>

            {errors.line_items && typeof errors.line_items.message === 'string' && (
              <p className="text-xs text-red-500">{errors.line_items.message}</p>
            )}

            <div className="space-y-3">
              {fields.map((field, idx) => {
                const catId = watch(`line_items.${idx}.category_id`)
                const isUtility = getCategoryIsUtility(catId)
                return (
                  <div key={field.id} className="bg-slate-50 rounded-xl p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-slate-600">Item {idx + 1}</p>
                      {fields.length > 1 && (
                        <button type="button" onClick={() => remove(idx)} className="text-slate-400 hover:text-red-500">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Description *</Label>
                        <Input placeholder="What is this for?" {...register(`line_items.${idx}.description`)} />
                        {errors.line_items?.[idx]?.description && (
                          <p className="text-xs text-red-500">{errors.line_items[idx]?.description?.message}</p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Amount (₹) *</Label>
                        <Input type="number" placeholder="0" {...register(`line_items.${idx}.amount`)} />
                        {errors.line_items?.[idx]?.amount && (
                          <p className="text-xs text-red-500">{errors.line_items[idx]?.amount?.message}</p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Category *</Label>
                        <Controller name={`line_items.${idx}.category_id`} control={control} render={({ field: f }) => (
                          <Select value={f.value} onValueChange={f.onChange}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Category" /></SelectTrigger>
                            <SelectContent>
                              {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        )} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Cost center *</Label>
                        <Controller name={`line_items.${idx}.cost_center`} control={control} render={({ field: f }) => (
                          <Select value={f.value} onValueChange={f.onChange}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Where?" /></SelectTrigger>
                            <SelectContent>
                              {COST_CENTERS.map(cc => <SelectItem key={cc} value={cc}>{cc}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        )} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Payee type</Label>
                        <Controller name={`line_items.${idx}.payee_type`} control={control} render={({ field: f }) => (
                          <Select value={f.value} onValueChange={f.onChange}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {PAYEE_TYPES.concat(['Utility']).map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        )} />
                      </div>
                    </div>

                    {/* Utility fields */}
                    {isUtility && (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Units consumed</Label>
                          <Input type="number" step="0.01" placeholder="kWh / KL / trips" {...register(`line_items.${idx}.utility_units`)} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Rate per unit (₹)</Label>
                          <Input type="number" step="0.01" placeholder="₹/unit" {...register(`line_items.${idx}.utility_rate`)} />
                        </div>
                      </div>
                    )}

                    {/* Period */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Period from</Label>
                        <Input type="date" {...register(`line_items.${idx}.period_from`)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Period to</Label>
                        <Input type="date" {...register(`line_items.${idx}.period_to`)} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            <button
              type="button"
              onClick={() => append({ description: '', payee_type: 'Other', cost_center: 'Common', category_id: '', amount: 0 })}
              className="flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-800 font-medium"
            >
              <Plus size={14} /> Add line item
            </button>
          </section>

          {mutation.isError && (
            <p className="text-sm text-red-500">
              Failed to save: {(mutation.error as Error)?.message}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { reset(); onClose() }}>Cancel</Button>
            <Button
              type="submit"
              disabled={isSubmitting || mutation.isPending || lineBalanceDiff !== 0}
              title={lineBalanceDiff !== 0 ? `Line items must sum to header amount (off by ${formatINR(Math.abs(lineBalanceDiff))})` : ''}
            >
              {mutation.isPending ? 'Saving…' : 'Save Expense'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Vendors tab ───────────────────────────────────────────────

function VendorsTab() {
  const { data: vendors = [], isLoading } = useQuery({
    queryKey: ['vendors'],
    queryFn: async () => {
      const { data } = await supabase.from('vendors').select('*').order('name')
      return (data ?? []) as Vendor[]
    },
  })

  if (isLoading) return <div className="card h-32 animate-pulse bg-slate-100" />
  if (!vendors.length) return (
    <div className="card p-10 text-center text-slate-400">
      <Building size={28} className="mx-auto mb-2 opacity-40" />
      <p className="text-sm">No vendors added yet</p>
    </div>
  )

  return (
    <div className="card divide-y divide-slate-100">
      {vendors.map(v => (
        <div key={v.id} className="flex items-center gap-3 px-4 py-3">
          <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
            <Building size={14} className="text-slate-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-800">{v.name}</p>
            <p className="text-xs text-slate-400">{v.type ?? 'Vendor'}{v.phone ? ` · ${v.phone}` : ''}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Staff tab ─────────────────────────────────────────────────

function StaffTab() {
  const { data: staffList = [], isLoading } = useQuery({
    queryKey: ['staff'],
    queryFn: async () => {
      const { data } = await supabase.from('staff').select('*').order('name')
      return (data ?? []) as StaffMember[]
    },
  })

  const active   = staffList.filter(s => !s.left_date)
  const inactive = staffList.filter(s => s.left_date)

  if (isLoading) return <div className="card h-32 animate-pulse bg-slate-100" />
  if (!staffList.length) return (
    <div className="card p-10 text-center text-slate-400">
      <Users size={28} className="mx-auto mb-2 opacity-40" />
      <p className="text-sm">No staff added yet</p>
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="card divide-y divide-slate-100">
        <div className="px-4 py-2 bg-slate-50 rounded-t-xl">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Active ({active.length})</p>
        </div>
        {active.map(s => (
          <div key={s.id} className="flex items-center gap-3 px-4 py-3">
            <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center shrink-0">
              <Users size={14} className="text-violet-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800">{s.name}</p>
              <p className="text-xs text-slate-400">{s.role}{s.assigned_area ? ` · ${s.assigned_area}` : ''}{s.phone ? ` · ${s.phone}` : ''}</p>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Active</span>
          </div>
        ))}
      </div>

      {inactive.length > 0 && (
        <div className="card divide-y divide-slate-100">
          <div className="px-4 py-2 bg-slate-50 rounded-t-xl">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Former ({inactive.length})</p>
          </div>
          {inactive.map(s => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-3 opacity-60">
              <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                <Users size={14} className="text-slate-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-700">{s.name}</p>
                <p className="text-xs text-slate-400">{s.role}{s.left_date ? ` · Left ${s.left_date}` : ''}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
