import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, useFieldArray, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Trash2, Download, Receipt, Users, Building, X, GitMerge, CheckCircle2, Paperclip, RefreshCcw, Coins, Upload, Loader2, Trash } from 'lucide-react'
import { useDropzone } from 'react-dropzone'
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
interface Vendor  { id: string; name: string; type: string | null; phone: string | null; pan_number: string | null; notes: string | null }
interface RecurringTemplate {
  id: string; name: string; description: string | null
  vendor: { id: string; name: string } | null
  category: { id: string; name: string } | null
  amount: number; payment_mode: string; frequency: string; active: boolean
}
interface PettyCashTxn { id: string; txn_date: string; txn_type: string; amount: number; notes: string | null }
interface Attachment { id: string; expense_id: string; file_name: string; file_url: string; file_size: number | null; uploaded_at: string }
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
  const [tab, setTab] = useState<'daybook' | 'reconcile' | 'vendors' | 'staff' | 'recurring' | 'petty'>('daybook')
  const [addOpen, setAddOpen] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-semibold">Expenses</h2>
          <p className="text-sm text-slate-500 mt-0.5">Day book · Reconcile · Vendors · Staff</p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="flex items-center gap-2">
          <Plus size={16} /> Add Expense
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 overflow-x-auto">
        {([
          { key: 'daybook',   label: 'Day Book',   icon: Receipt },
          { key: 'reconcile', label: 'Reconcile',  icon: GitMerge },
          { key: 'vendors',   label: 'Vendors',    icon: Building },
          { key: 'staff',     label: 'Staff',      icon: Users },
          { key: 'recurring', label: 'Recurring',  icon: RefreshCcw },
          { key: 'petty',     label: 'Petty Cash', icon: Coins },
        ] as { key: typeof tab; label: string; icon: any }[]).map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === key ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
            }`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'daybook'   && <DayBook />}
      {tab === 'reconcile' && <ReconcileTab />}
      {tab === 'vendors'   && <VendorsTab />}
      {tab === 'staff'     && <StaffTab />}
      {tab === 'recurring' && <RecurringTab />}
      {tab === 'petty'     && <PettyCashTab />}

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

      <AttachmentsSection expenseId={e.id} />
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
      <DialogContent className="max-w-3xl">
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

// ── Reconcile tab ─────────────────────────────────────────────

interface UnreconciledExpense {
  id: string; expense_date: string; description: string; amount: number
  payment_mode: string; voucher_no: string | null; payee_name_raw: string | null
  reference_no: string | null
}
interface UnmatchedDR {
  id: string; value_date: string; description: string; amount: number
  txn_id: string | null; category: string | null
}

function ReconcileTab() {
  const qc = useQueryClient()
  const [selectedExpenseId, setSelectedExpenseId] = useState<string | null>(null)
  const [selectedTxnId,     setSelectedTxnId]     = useState<string | null>(null)

  const { data: expenses = [], isLoading: loadingExp } = useQuery({
    queryKey: ['unreconciled-expenses'],
    queryFn: async () => {
      const { data } = await supabase
        .from('expenses')
        .select('id,expense_date,description,amount,payment_mode,voucher_no,payee_name_raw,reference_no')
        .neq('payment_mode', 'Cash')
        .is('transaction_id', null)
        .order('expense_date', { ascending: false })
      return (data ?? []) as UnreconciledExpense[]
    },
  })

  const { data: bankDRs = [], isLoading: loadingDR } = useQuery({
    queryKey: ['unmatched-bank-drs'],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('id,value_date,description,amount,txn_id,category')
        .eq('cr_dr', 'DR')
        .neq('row_type', 'VOIDED')
        .is('expense_id', null)
        .order('value_date', { ascending: false })
      return (data ?? []) as UnmatchedDR[]
    },
  })

  const selExp = expenses.find(e => e.id === selectedExpenseId)
  const selTxn = bankDRs.find(t => t.id === selectedTxnId)
  const amountMatch = selExp && selTxn && selExp.amount === selTxn.amount
  const canMatch    = !!selExp && !!selTxn

  const matchMutation = useMutation({
    mutationFn: async () => {
      if (!selectedExpenseId || !selectedTxnId) return
      const now = new Date().toISOString()
      const [{ error: e1 }, { error: e2 }] = await Promise.all([
        supabase.from('expenses')
          .update({ transaction_id: selectedTxnId, reconciled_at: now })
          .eq('id', selectedExpenseId),
        supabase.from('transactions')
          .update({ expense_id: selectedExpenseId })
          .eq('id', selectedTxnId),
      ])
      if (e1) throw e1
      if (e2) throw e2
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['unreconciled-expenses'] })
      qc.invalidateQueries({ queryKey: ['unmatched-bank-drs'] })
      qc.invalidateQueries({ queryKey: ['expenses'] })
      setSelectedExpenseId(null)
      setSelectedTxnId(null)
    },
  })

  const loading = loadingExp || loadingDR

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <div className={`card p-4 ${expenses.length > 0 ? 'bg-amber-50' : 'bg-green-50'}`}>
          <p className="text-xs text-slate-500 mb-1">Unreconciled expenses</p>
          <p className={`text-2xl font-bold ${expenses.length > 0 ? 'text-amber-600' : 'text-green-600'}`}>
            {expenses.length}
          </p>
          {expenses.length > 0 && (
            <p className="text-xs text-amber-600 mt-0.5">
              {formatINR(expenses.reduce((s, e) => s + e.amount, 0))}
            </p>
          )}
        </div>
        <div className="card p-4 bg-white">
          <p className="text-xs text-slate-500 mb-1">Unmatched bank DRs</p>
          <p className="text-2xl font-bold text-slate-700">{bankDRs.length}</p>
          {bankDRs.length > 0 && (
            <p className="text-xs text-slate-400 mt-0.5">
              {formatINR(bankDRs.reduce((s, t) => s + t.amount, 0))}
            </p>
          )}
        </div>
        {canMatch && (
          <div className={`card p-4 ${amountMatch ? 'bg-green-50 border border-green-200' : 'bg-orange-50 border border-orange-200'}`}>
            <p className="text-xs text-slate-500 mb-1">Selected match</p>
            <p className="text-sm font-medium text-slate-700">
              {formatINR(selExp!.amount)} ↔ {formatINR(selTxn!.amount)}
            </p>
            {!amountMatch && (
              <p className="text-xs text-orange-600 mt-0.5">
                Diff: {formatINR(Math.abs(selExp!.amount - selTxn!.amount))}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Action bar */}
      {canMatch && (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-violet-50 border border-violet-200">
          <div className="flex-1 text-sm text-slate-700">
            <span className="font-medium">{selExp!.voucher_no ?? selExp!.description.slice(0, 30)}</span>
            <span className="text-slate-400 mx-2">↔</span>
            <span className="font-medium">{selTxn!.txn_id ?? selTxn!.description.slice(0, 30)}</span>
          </div>
          {!amountMatch && (
            <span className="text-xs text-orange-600 font-medium shrink-0">Amount mismatch</span>
          )}
          <Button
            size="sm"
            onClick={() => matchMutation.mutate()}
            disabled={matchMutation.isPending}
            className="shrink-0"
          >
            <CheckCircle2 size={14} className="mr-1.5" />
            {matchMutation.isPending ? 'Matching…' : 'Match'}
          </Button>
          <button
            onClick={() => { setSelectedExpenseId(null); setSelectedTxnId(null) }}
            className="text-slate-400 hover:text-slate-600 shrink-0"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {loading ? (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="card h-64 animate-pulse bg-slate-100" />
          <div className="card h-64 animate-pulse bg-slate-100" />
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">
          {/* Left: unreconciled expenses */}
          <div className="card">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 rounded-t-xl">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                Unreconciled expenses ({expenses.length})
              </p>
              <p className="text-xs text-slate-400 mt-0.5">Select one to match with a bank DR</p>
            </div>
            {expenses.length === 0 ? (
              <p className="px-4 py-8 text-sm text-slate-400 text-center">All expenses reconciled ✓</p>
            ) : (
              <div className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
                {expenses.map(e => (
                  <button
                    key={e.id}
                    onClick={() => setSelectedExpenseId(id => id === e.id ? null : e.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left transition-colors ${
                      selectedExpenseId === e.id ? 'bg-violet-50 border-l-2 border-violet-500' : ''
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-sm font-medium text-slate-800 truncate">{e.description}</p>
                        <p className="text-sm font-bold text-slate-800 shrink-0">{formatINR(e.amount)}</p>
                      </div>
                      <div className="flex gap-2 mt-0.5">
                        <span className="text-xs text-slate-400">{e.expense_date}</span>
                        {e.voucher_no && <span className="text-xs text-slate-400">{e.voucher_no}</span>}
                        <span className="text-xs text-slate-400">{e.payment_mode}</span>
                        {e.reference_no && <span className="text-xs text-slate-400 truncate">{e.reference_no}</span>}
                      </div>
                    </div>
                    {selectedExpenseId === e.id && (
                      <CheckCircle2 size={16} className="text-violet-500 shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right: unmatched bank DRs */}
          <div className="card">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 rounded-t-xl">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                Unmatched bank DRs ({bankDRs.length})
              </p>
              <p className="text-xs text-slate-400 mt-0.5">Select one to match with an expense</p>
            </div>
            {bankDRs.length === 0 ? (
              <p className="px-4 py-8 text-sm text-slate-400 text-center">No unmatched bank debits</p>
            ) : (
              <div className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
                {bankDRs.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTxnId(id => id === t.id ? null : t.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left transition-colors ${
                      selectedTxnId === t.id ? 'bg-violet-50 border-l-2 border-violet-500' : ''
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-sm font-medium text-slate-800 truncate">{t.description}</p>
                        <p className="text-sm font-bold text-red-600 shrink-0">{formatINR(t.amount)}</p>
                      </div>
                      <div className="flex gap-2 mt-0.5">
                        <span className="text-xs text-slate-400">{t.value_date}</span>
                        {t.txn_id && <span className="text-xs text-slate-400">{t.txn_id}</span>}
                        {t.category && <span className="text-xs text-slate-400">{t.category}</span>}
                      </div>
                    </div>
                    {selectedTxnId === t.id && (
                      <CheckCircle2 size={16} className="text-violet-500 shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {matchMutation.isError && (
        <p className="text-sm text-red-500">
          Match failed: {(matchMutation.error as Error)?.message}
        </p>
      )}
    </div>
  )
}

// ── Vendors tab ───────────────────────────────────────────────

function VendorsTab() {
  const [addOpen, setAddOpen] = useState(false)

  const { data: vendors = [], isLoading } = useQuery({
    queryKey: ['vendors'],
    queryFn: async () => {
      const { data } = await supabase.from('vendors').select('*').order('name')
      return (data ?? []) as Vendor[]
    },
  })

  if (isLoading) return <div className="card h-32 animate-pulse bg-slate-100" />

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setAddOpen(true)} className="flex items-center gap-1.5">
          <Plus size={14} /> Add Vendor
        </Button>
      </div>

      {vendors.length === 0 ? (
        <div className="card p-10 text-center text-slate-400">
          <Building size={28} className="mx-auto mb-2 opacity-40" />
          <p className="text-sm">No vendors added yet</p>
        </div>
      ) : (
        <div className="card divide-y divide-slate-100">
          {vendors.map(v => (
            <div key={v.id} className="flex items-center gap-3 px-4 py-3">
              <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                <Building size={14} className="text-slate-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800">{v.name}</p>
                <p className="text-xs text-slate-400">
                  {v.type ?? 'Vendor'}{v.phone ? ` · ${v.phone}` : ''}{v.pan_number ? ` · PAN: ${v.pan_number}` : ''}
                </p>
                {v.notes && <p className="text-xs text-slate-400 truncate">{v.notes}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      <AddVendorDialog open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  )
}

// ── Staff tab ─────────────────────────────────────────────────

function StaffTab() {
  const [addOpen, setAddOpen] = useState(false)

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

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setAddOpen(true)} className="flex items-center gap-1.5">
          <Plus size={14} /> Add Staff
        </Button>
      </div>

      {staffList.length === 0 ? (
        <div className="card p-10 text-center text-slate-400">
          <Users size={28} className="mx-auto mb-2 opacity-40" />
          <p className="text-sm">No staff added yet</p>
        </div>
      ) : (<>
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
      </>)}

      <AddStaffDialog open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  )
}

// â”€â”€ Add Vendor dialog â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function AddVendorDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName]   = useState('')
  const [type, setType]   = useState('')
  const [phone, setPhone] = useState('')
  const [pan, setPan]     = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')

  function reset() { setName(''); setType(''); setPhone(''); setPan(''); setNotes(''); setErr('') }

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true); setErr('')
    try {
      const { error } = await supabase.from('vendors').insert({
        name: name.trim(), type: type || null, phone: phone || null,
        pan_number: pan || null, notes: notes || null,
      })
      if (error) throw error
      qc.invalidateQueries({ queryKey: ['vendors'] })
      reset(); onClose()
    } catch (e: any) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose() } }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add Vendor</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Vendor / company name" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {['Individual','Company','Agency','Municipal'].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Mobile number" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>PAN number</Label>
            <Input value={pan} onChange={e => setPan(e.target.value)} placeholder="For TDS tracking" />
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Optional remarks" />
          </div>
          {err && <p className="text-sm text-red-500">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose() }}>Cancel</Button>
          <Button onClick={handleSave} disabled={!name.trim() || saving}>
            {saving ? 'Saving...' : 'Add Vendor'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// â”€â”€ Add Staff dialog â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const STAFF_ROLES = ['Security', 'Sweeper', 'Gardener', 'Plumber', 'Electrician', 'Lift Operator', 'Other']

function AddStaffDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({ name: '', role: '', area: '', phone: '', joined: today })
  const [salary, setSalary] = useState('')
  const [saving, setSaving]  = useState(false)
  const [err, setErr]        = useState('')

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  function reset() { setForm({ name: '', role: '', area: '', phone: '', joined: today }); setSalary(''); setErr('') }

  async function handleSave() {
    if (!form.name.trim() || !form.role) return
    setSaving(true); setErr('')
    try {
      const { data: staff, error: sErr } = await supabase.from('staff').insert({
        name: form.name.trim(), role: form.role,
        assigned_area: form.area || null, phone: form.phone || null, joined_date: form.joined,
      }).select().single()
      if (sErr) throw sErr

      if (salary && Number(salary) > 0) {
        const { error: shErr } = await supabase.from('staff_salary_history').insert({
          staff_id: staff.id, monthly_salary: Number(salary), effective_from: form.joined,
        })
        if (shErr) throw shErr
      }

      qc.invalidateQueries({ queryKey: ['staff'] })
      reset(); onClose()
    } catch (e: any) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose() } }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add Staff Member</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Full name *</Label>
            <Input value={form.name} onChange={set('name')} placeholder="e.g. Murugan" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Role *</Label>
              <Select value={form.role} onValueChange={r => setForm(f => ({ ...f, role: r }))}>
                <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                <SelectContent>
                  {STAFF_ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Assigned area</Label>
              <Input value={form.area} onChange={set('area')} placeholder="Block-A, Common, All..." />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={set('phone')} placeholder="Mobile number" />
            </div>
            <div className="space-y-1">
              <Label>Joined date *</Label>
              <Input type="date" value={form.joined} onChange={set('joined')} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Starting monthly salary (Rs)</Label>
            <Input type="number" value={salary} onChange={e => setSalary(e.target.value)} placeholder="Optional - can set later" />
            <p className="text-xs text-slate-400">Added as initial salary history entry effective from joined date</p>
          </div>
          {err && <p className="text-sm text-red-500">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose() }}>Cancel</Button>
          <Button onClick={handleSave} disabled={!form.name.trim() || !form.role || saving}>
            {saving ? 'Saving...' : 'Add Staff'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// â”€â”€ Recurring templates tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function RecurringTab() {
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['recurring-templates'],
    queryFn: async () => {
      const { data } = await supabase
        .from('recurring_expense_templates')
        .select('*, vendor:vendor_id(id,name), category:category_id(id,name)')
        .order('name')
      return (data ?? []) as RecurringTemplate[]
    },
  })

  async function toggleActive(id: string, current: boolean) {
    await supabase.from('recurring_expense_templates').update({ active: !current }).eq('id', id)
    qc.invalidateQueries({ queryKey: ['recurring-templates'] })
  }

  if (isLoading) return <div className="card h-40 animate-pulse bg-slate-100" />

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setAddOpen(true)} className="flex items-center gap-1.5">
          <Plus size={14} /> Add Template
        </Button>
      </div>

      {templates.length === 0 ? (
        <div className="card p-12 flex flex-col items-center gap-3 text-center text-slate-400">
          <RefreshCcw size={28} className="opacity-40" />
          <div>
            <p className="text-sm font-medium text-slate-700">No recurring templates</p>
            <p className="text-xs mt-1">Add templates for monthly expenses like lift AMC, security agency contract, etc.</p>
          </div>
        </div>
      ) : (
        <div className="card divide-y divide-slate-100">
          {templates.map(t => (
            <div key={t.id} className={`flex items-center gap-3 px-4 py-3 ${!t.active ? 'opacity-50' : ''}`}>
              <div className="w-8 h-8 rounded-full bg-violet-50 flex items-center justify-center shrink-0">
                <RefreshCcw size={14} className="text-violet-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-slate-800">{t.name}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                    t.frequency === 'Monthly' ? 'bg-blue-100 text-blue-700' :
                    t.frequency === 'Quarterly' ? 'bg-amber-100 text-amber-700' :
                    'bg-purple-100 text-purple-700'
                  }`}>{t.frequency}</span>
                </div>
                <p className="text-xs text-slate-400">
                  {t.vendor?.name ?? 'No vendor'} {t.category ? 'Â· ' + t.category.name : ''}
                  {t.description ? ' Â· ' + t.description : ''}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-sm font-semibold text-slate-800">{formatINR(t.amount)}</span>
                <button
                  onClick={() => toggleActive(t.id, t.active)}
                  className={`text-xs px-2 py-0.5 rounded-full font-medium transition-colors ${
                    t.active
                      ? 'bg-green-100 text-green-700 hover:bg-red-100 hover:text-red-700'
                      : 'bg-slate-100 text-slate-500 hover:bg-green-100 hover:text-green-700'
                  }`}
                >
                  {t.active ? 'Active' : 'Inactive'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <AddRecurringDialog open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  )
}

function AddRecurringDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ name: '', description: '', vendor_id: '', category_id: '', amount: '', payment_mode: 'Online', frequency: 'Monthly' })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')

  const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: async () => {
    const { data } = await supabase.from('vendors').select('id,name').order('name')
    return (data ?? []) as { id: string; name: string }[]
  }})
  const { data: categories = [] } = useQuery({ queryKey: ['expense-categories'], queryFn: async () => {
    const { data } = await supabase.from('expense_categories').select('id,name').order('sort_order')
    return (data ?? []) as { id: string; name: string }[]
  }})

  const set = (k: keyof typeof form) => (v: string) => setForm(f => ({ ...f, [k]: v }))
  function reset() {
    setForm({ name: '', description: '', vendor_id: '', category_id: '', amount: '', payment_mode: 'Online', frequency: 'Monthly' })
    setErr('')
  }

  async function handleSave() {
    if (!form.name.trim() || !form.amount) return
    setSaving(true); setErr('')
    try {
      const { error } = await supabase.from('recurring_expense_templates').insert({
        name: form.name.trim(), description: form.description || null,
        vendor_id: form.vendor_id || null, category_id: form.category_id || null,
        amount: Number(form.amount), payment_mode: form.payment_mode, frequency: form.frequency,
      })
      if (error) throw error
      qc.invalidateQueries({ queryKey: ['recurring-templates'] })
      reset(); onClose()
    } catch (e: any) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose() } }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add Recurring Template</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Name *</Label>
            <Input value={form.name} onChange={e => set('name')(e.target.value)} placeholder="e.g. Lift AMC" />
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <Input value={form.description} onChange={e => set('description')(e.target.value)} placeholder="Optional details" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Amount (Rs) *</Label>
              <Input type="number" value={form.amount} onChange={e => set('amount')(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1">
              <Label>Frequency</Label>
              <Select value={form.frequency} onValueChange={set('frequency')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['Monthly','Quarterly','Annual'].map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Vendor</Label>
              <Select value={form.vendor_id} onValueChange={set('vendor_id')}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Category</Label>
              <Select value={form.category_id} onValueChange={set('category_id')}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Payment mode</Label>
            <Select value={form.payment_mode} onValueChange={set('payment_mode')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAYMENT_MODES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {err && <p className="text-sm text-red-500">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose() }}>Cancel</Button>
          <Button onClick={handleSave} disabled={!form.name.trim() || !form.amount || saving}>
            {saving ? 'Saving...' : 'Add Template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// â”€â”€ Petty cash tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const TXN_TYPE_STYLE: Record<string, string> = {
  Opening:       'bg-blue-100 text-blue-700',
  Replenishment: 'bg-green-100 text-green-700',
  Disbursement:  'bg-red-100 text-red-700',
}

function PettyCashTab() {
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)

  const { data: txns = [], isLoading } = useQuery({
    queryKey: ['petty-cash'],
    queryFn: async () => {
      const { data } = await supabase
        .from('petty_cash_transactions')
        .select('*')
        .order('txn_date', { ascending: false })
      return (data ?? []) as PettyCashTxn[]
    },
  })

  const balance = txns.reduce((s, t) =>
    t.txn_type === 'Disbursement' ? s - t.amount : s + t.amount, 0
  )

  async function handleAdd(form: { txn_date: string; txn_type: string; amount: string; notes: string }) {
    const { error } = await supabase.from('petty_cash_transactions').insert({
      txn_date: form.txn_date,
      txn_type: form.txn_type,
      amount:   Number(form.amount),
      notes:    form.notes || null,
    })
    if (error) throw error
    qc.invalidateQueries({ queryKey: ['petty-cash'] })
  }

  if (isLoading) return <div className="card h-40 animate-pulse bg-slate-100" />

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="card p-4 flex-1 bg-white">
          <p className="text-xs text-slate-500 mb-1">Current balance</p>
          <p className={`text-2xl font-bold ${balance >= 0 ? 'text-slate-800' : 'text-red-600'}`}>
            {formatINR(balance)}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">{txns.length} entries</p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)} className="flex items-center gap-1.5 mt-1">
          <Plus size={14} /> Add Entry
        </Button>
      </div>

      {txns.length === 0 ? (
        <div className="card p-12 flex flex-col items-center gap-3 text-center text-slate-400">
          <Coins size={28} className="opacity-40" />
          <div>
            <p className="text-sm font-medium text-slate-700">No petty cash entries</p>
            <p className="text-xs mt-1">Start with an Opening entry to set the initial balance.</p>
          </div>
        </div>
      ) : (
        <div className="card divide-y divide-slate-100">
          {txns.map(t => (
            <div key={t.id} className="flex items-center gap-3 px-4 py-3">
              <div className="shrink-0 w-10 text-center">
                <p className="text-xs font-bold text-slate-800 leading-tight">
                  {new Date(t.txn_date).getDate().toString().padStart(2, '0')}
                </p>
                <p className="text-[10px] text-slate-400 uppercase">
                  {new Date(t.txn_date).toLocaleString('en', { month: 'short' })}
                </p>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${TXN_TYPE_STYLE[t.txn_type] ?? 'bg-slate-100 text-slate-600'}`}>
                    {t.txn_type}
                  </span>
                  {t.notes && <span className="text-xs text-slate-500 truncate">{t.notes}</span>}
                </div>
              </div>
              <span className={`text-sm font-semibold shrink-0 ${t.txn_type === 'Disbursement' ? 'text-red-600' : 'text-green-700'}`}>
                {t.txn_type === 'Disbursement' ? '-' : '+'}{formatINR(t.amount)}
              </span>
            </div>
          ))}
        </div>
      )}

      <AddPettyCashDialog open={addOpen} onClose={() => setAddOpen(false)} onSave={handleAdd} />
    </div>
  )
}

function AddPettyCashDialog({ open, onClose, onSave }: {
  open: boolean; onClose: () => void
  onSave: (form: { txn_date: string; txn_type: string; amount: string; notes: string }) => Promise<void>
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({ txn_date: today, txn_type: 'Disbursement', amount: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')

  const set = (k: keyof typeof form) => (v: string) => setForm(f => ({ ...f, [k]: v }))
  function reset() { setForm({ txn_date: today, txn_type: 'Disbursement', amount: '', notes: '' }); setErr('') }

  async function handleSave() {
    if (!form.amount || Number(form.amount) <= 0) return
    setSaving(true); setErr('')
    try { await onSave(form); reset(); onClose() }
    catch (e: any) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose() } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Add Petty Cash Entry</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Date *</Label>
              <Input type="date" value={form.txn_date} onChange={e => set('txn_date')(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Type *</Label>
              <Select value={form.txn_type} onValueChange={set('txn_type')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['Opening','Replenishment','Disbursement'].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Amount (Rs) *</Label>
            <Input type="number" value={form.amount} onChange={e => set('amount')(e.target.value)} placeholder="0" />
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Input value={form.notes} onChange={e => set('notes')(e.target.value)} placeholder="What was the purpose?" />
          </div>
          {err && <p className="text-sm text-red-500">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose() }}>Cancel</Button>
          <Button onClick={handleSave} disabled={!form.amount || Number(form.amount) <= 0 || saving}>
            {saving ? 'Saving...' : 'Add Entry'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// â”€â”€ Attachments section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function AttachmentsSection({ expenseId }: { expenseId: string }) {
  const qc = useQueryClient()
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState('')

  const { data: attachments = [] } = useQuery({
    queryKey: ['attachments', expenseId],
    queryFn: async () => {
      const { data } = await supabase
        .from('expense_attachments')
        .select('*')
        .eq('expense_id', expenseId)
        .order('uploaded_at')
      return (data ?? []) as Attachment[]
    },
  })

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'image/*': [], 'application/pdf': [] },
    maxSize: 10 * 1024 * 1024,
    onDrop: async (files) => {
      if (!files.length) return
      setUploading(true); setUploadErr('')
      try {
        for (const file of files) {
          const path = `expenses/${expenseId}/${Date.now()}_${file.name}`
          const { error: upErr } = await supabase.storage
            .from('expense-attachments')
            .upload(path, file)
          if (upErr) throw upErr
          const { error: dbErr } = await supabase.from('expense_attachments').insert({
            expense_id: expenseId, file_name: file.name,
            file_url: path, file_size: file.size,
          })
          if (dbErr) throw dbErr
        }
        qc.invalidateQueries({ queryKey: ['attachments', expenseId] })
      } catch (e: any) { setUploadErr(e.message) }
      finally { setUploading(false) }
    },
  })

  async function handleDelete(att: Attachment) {
    await supabase.storage.from('expense-attachments').remove([att.file_url])
    await supabase.from('expense_attachments').delete().eq('id', att.id)
    qc.invalidateQueries({ queryKey: ['attachments', expenseId] })
  }

  async function handleDownload(att: Attachment) {
    const { data } = await supabase.storage
      .from('expense-attachments')
      .createSignedUrl(att.file_url, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Paperclip size={14} className="text-slate-400" />
        <h4 className="text-sm font-medium">Attachments</h4>
        {attachments.length > 0 && (
          <span className="text-xs text-slate-400">{attachments.length} file{attachments.length > 1 ? 's' : ''}</span>
        )}
      </div>

      {attachments.length > 0 && (
        <div className="space-y-1">
          {attachments.map(att => (
            <div key={att.id} className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 text-xs">
              <span className="flex-1 truncate text-slate-700">{att.file_name}</span>
              {att.file_size != null && (
                <span className="text-slate-400 shrink-0">{(att.file_size / 1024).toFixed(0)} KB</span>
              )}
              <button onClick={() => handleDownload(att)} className="text-violet-600 hover:text-violet-800 shrink-0">
                <Download size={12} />
              </button>
              <button onClick={() => handleDelete(att)} className="text-slate-400 hover:text-red-500 shrink-0">
                <Trash size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition-colors text-xs ${
          isDragActive ? 'border-violet-400 bg-violet-50' : 'border-slate-200 hover:border-violet-300 hover:bg-slate-50'
        }`}
      >
        <input {...getInputProps()} />
        {uploading ? (
          <div className="flex items-center justify-center gap-1.5 text-slate-500">
            <Loader2 size={13} className="animate-spin" /> Uploading...
          </div>
        ) : (
          <div className="flex items-center justify-center gap-1.5 text-slate-400">
            <Upload size={13} />
            {isDragActive ? 'Drop to upload' : 'Drop files or click - PDF, JPG, PNG (max 10 MB)'}
          </div>
        )}
      </div>
      {uploadErr && <p className="text-xs text-red-500">{uploadErr}</p>}
    </div>
  )
}
