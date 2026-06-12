# Pending Line Items → Bundled Expense — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the treasurer capture small individual payments as draft "pending line items" over time, then manually pick a set and club them into one bundled expense that enters the existing day-book / approval / reconciliation pipeline.

**Architecture:** A new `pending_line_items` table holds orphan items with full detail (date, payee, category, cost-centre, amount, payment mode, reference). A Postgres RPC `bundle_pending_items(ids, header)` atomically creates the `expenses` header, copies rows into `expense_line_items`, and deletes the originals. UI is a new "Pending Items" tab on `/expenses` with quick-add and bulk-bundle.

**Tech Stack:** Supabase Postgres + RLS, React 18 + TypeScript + Vite, react-query, react-hook-form + zod, Shadcn/ui dialogs, Tailwind. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-12-pending-line-items-design.md`

---

## File map

| File | Action |
|---|---|
| `supabase/migrations/032_pending_line_items.sql` | CREATE |
| `src/lib/supabase.ts` | MODIFY (add `PendingLineItem`, extend `ExpenseLineItem`) |
| `src/pages/ExpensesPage.tsx` | MODIFY (new tab + 3 components) |
| `src/components/HelpButton.tsx` | MODIFY (add help blurb) |

---

## Task 1: Write migration 032 — schema + RPC + RLS + audit

**Files:**
- Create: `supabase/migrations/032_pending_line_items.sql`

- [ ] **Step 1: Create the migration file with full SQL**

Write this exactly:

```sql
-- 032: Pending line items — capture small payments individually, bundle later

-- 1. Pending items table
CREATE TABLE IF NOT EXISTS public.pending_line_items (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  paid_date       date NOT NULL,
  description     text NOT NULL,
  amount          integer NOT NULL CHECK (amount > 0),
  payment_mode    text NOT NULL CHECK (payment_mode IN ('Cash','Online','Bank Transfer','Cheque')),
  reference_no    text,
  payee_type      text NOT NULL CHECK (payee_type IN ('Staff','Vendor','Utility','Municipal','Other')),
  staff_id        uuid REFERENCES public.staff(id),
  vendor_id       uuid REFERENCES public.vendors(id),
  payee_name_raw  text,
  category_id     uuid REFERENCES public.expense_categories(id),
  cost_center     text NOT NULL,
  corpus_plan_id  uuid REFERENCES public.corpus_plans(id),
  notes           text,
  created_at      timestamptz DEFAULT now(),
  created_by      uuid REFERENCES public.profiles(id),
  voided_at       timestamptz,
  voided_by       uuid REFERENCES public.profiles(id),
  void_reason     text
);

CREATE INDEX IF NOT EXISTS idx_pending_items_date   ON public.pending_line_items(paid_date DESC);
CREATE INDEX IF NOT EXISTS idx_pending_items_active ON public.pending_line_items(voided_at) WHERE voided_at IS NULL;

-- 2. Extend expense_line_items so bundled rows preserve mode + reference
ALTER TABLE public.expense_line_items
  ADD COLUMN IF NOT EXISTS payment_mode text
  CHECK (payment_mode IS NULL OR payment_mode IN ('Cash','Online','Bank Transfer','Cheque'));

ALTER TABLE public.expense_line_items
  ADD COLUMN IF NOT EXISTS reference_no text;

-- 3. Audit trigger (mirrors pattern from 012/016)
DROP TRIGGER IF EXISTS trg_audit_pending_line_items ON public.pending_line_items;
CREATE TRIGGER trg_audit_pending_line_items
  AFTER INSERT OR UPDATE OR DELETE ON public.pending_line_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- 4. RLS
ALTER TABLE public.pending_line_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pending_items_select" ON public.pending_line_items;
CREATE POLICY "pending_items_select" ON public.pending_line_items
  FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin', 'committee', 'auditor'));

DROP POLICY IF EXISTS "pending_items_insert" ON public.pending_line_items;
CREATE POLICY "pending_items_insert" ON public.pending_line_items
  FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "pending_items_update" ON public.pending_line_items;
CREATE POLICY "pending_items_update" ON public.pending_line_items
  FOR UPDATE TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "pending_items_delete" ON public.pending_line_items;
CREATE POLICY "pending_items_delete" ON public.pending_line_items
  FOR DELETE TO authenticated
  USING (public.get_my_role() = 'admin');

-- 5. Bundle RPC
CREATE OR REPLACE FUNCTION public.bundle_pending_items(
  p_ids    uuid[],
  p_header jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role             text;
  v_count            integer;
  v_total            integer;
  v_corpus_plan_ids  uuid[];
  v_expense_id       uuid;
  v_voucher_no       text;
  v_corpus_plan_id   uuid;
  v_header_date      date;
  v_header_desc      text;
  v_header_mode      text;
  v_header_payee     text;
BEGIN
  -- Auth
  v_role := public.get_my_role();
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Parse header
  v_header_date  := (p_header->>'expense_date')::date;
  v_header_desc  := p_header->>'description';
  v_header_mode  := p_header->>'payment_mode';
  v_header_payee := COALESCE(p_header->>'payee_name_raw', 'Bundled');

  IF v_header_date IS NULL OR v_header_desc IS NULL OR v_header_mode IS NULL THEN
    RAISE EXCEPTION 'missing header fields';
  END IF;
  IF v_header_mode NOT IN ('Cash','Online','Bank Transfer','Cheque') THEN
    RAISE EXCEPTION 'invalid payment_mode';
  END IF;

  -- Validate selection: exists, not voided, consistent corpus_plan_id
  SELECT COUNT(*), SUM(amount),
         array_agg(DISTINCT COALESCE(corpus_plan_id, '00000000-0000-0000-0000-000000000000'::uuid))
  INTO   v_count, v_total, v_corpus_plan_ids
  FROM   public.pending_line_items
  WHERE  id = ANY(p_ids) AND voided_at IS NULL;

  IF v_count = 0 OR v_count <> array_length(p_ids, 1) THEN
    RAISE EXCEPTION 'one or more items not found or voided';
  END IF;

  IF array_length(v_corpus_plan_ids, 1) > 1 THEN
    RAISE EXCEPTION 'cannot mix maintenance and corpus items, or different corpus plans';
  END IF;

  v_corpus_plan_id := CASE WHEN v_corpus_plan_ids[1] = '00000000-0000-0000-0000-000000000000'::uuid
                           THEN NULL ELSE v_corpus_plan_ids[1] END;

  -- Create expense header
  INSERT INTO public.expenses (
    expense_date, description, payee_type, payee_name_raw,
    amount, payment_mode, corpus_plan_id, approval_status, created_by
  ) VALUES (
    v_header_date, v_header_desc, 'Other', v_header_payee,
    v_total, v_header_mode, v_corpus_plan_id, 'pending', auth.uid()
  )
  RETURNING id, voucher_no INTO v_expense_id, v_voucher_no;

  -- Copy pending rows → expense_line_items
  INSERT INTO public.expense_line_items (
    expense_id, payee_type, staff_id, vendor_id, payee_name_raw,
    description, category_id, cost_center, amount,
    payment_mode, reference_no
  )
  SELECT v_expense_id, payee_type, staff_id, vendor_id, payee_name_raw,
         description, category_id, cost_center, amount,
         payment_mode, reference_no
  FROM   public.pending_line_items
  WHERE  id = ANY(p_ids);

  -- Hard-delete the originals
  DELETE FROM public.pending_line_items WHERE id = ANY(p_ids);

  RETURN jsonb_build_object('expense_id', v_expense_id, 'voucher_no', v_voucher_no);
END;
$$;

GRANT EXECUTE ON FUNCTION public.bundle_pending_items(uuid[], jsonb) TO authenticated;
```

- [ ] **Step 2: Apply migration to Supabase**

Run from project root:
```bash
supabase db push
```
Expected: `Applying migration 032_pending_line_items.sql ... done`.

If `supabase db push` is not configured, paste the file's SQL into the Supabase SQL editor.

- [ ] **Step 3: Verify table + RPC exist**

Run in Supabase SQL editor:
```sql
SELECT to_regclass('public.pending_line_items') AS table_ok,
       (SELECT proname FROM pg_proc WHERE proname = 'bundle_pending_items') AS rpc_ok;
```
Expected: `table_ok = pending_line_items`, `rpc_ok = bundle_pending_items`.

Also verify new columns:
```sql
SELECT column_name FROM information_schema.columns
WHERE  table_name = 'expense_line_items'
  AND  column_name IN ('payment_mode', 'reference_no');
```
Expected: both rows returned.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/032_pending_line_items.sql
git commit -m "feat(db): pending_line_items table + bundle RPC + RLS"
```

---

## Task 2: TypeScript types

**Files:**
- Modify: `src/lib/supabase.ts`

- [ ] **Step 1: Locate the `ExpenseLineItem`-equivalent and add new interface**

Open `src/lib/supabase.ts`. After the existing expense-related interfaces, append:

```ts
export interface PendingLineItem {
  id: string
  paid_date: string
  description: string
  amount: number
  payment_mode: 'Cash' | 'Online' | 'Bank Transfer' | 'Cheque'
  reference_no: string | null
  payee_type: 'Staff' | 'Vendor' | 'Utility' | 'Municipal' | 'Other'
  staff_id: string | null
  vendor_id: string | null
  payee_name_raw: string | null
  category_id: string | null
  cost_center: string
  corpus_plan_id: string | null
  notes: string | null
  created_at: string
  created_by: string | null
  voided_at: string | null
  voided_by: string | null
  void_reason: string | null
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: no new errors. (Pre-existing errors in the repo are fine; do not introduce new ones.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase.ts
git commit -m "feat(types): PendingLineItem interface"
```

> **Note on `ExpenseLineItem`:** The local interface lives inside `src/pages/ExpensesPage.tsx` (line ~63), not in `supabase.ts`. Extend it in-file in Task 4 when we touch the page.

---

## Task 3: Tab entry + PendingItemsTab shell

**Files:**
- Modify: `src/pages/ExpensesPage.tsx`

- [ ] **Step 1: Add 'pending' to the tab union and the tab strip**

In `src/pages/ExpensesPage.tsx` at line 130, change:
```ts
const [tab, setTab] = useState<'daybook' | 'reconcile' | 'vendors' | 'staff' | 'recurring' | 'petty'>('daybook')
```
to:
```ts
const [tab, setTab] = useState<'daybook' | 'pending' | 'reconcile' | 'vendors' | 'staff' | 'recurring' | 'petty'>('daybook')
```

In the tab strip (line ~150-156), add a new entry between `daybook` and `reconcile`:
```ts
{ key: 'daybook',   label: 'Day Book',     icon: Receipt },
{ key: 'pending',   label: 'Pending Items', icon: ListChecks },
{ key: 'reconcile', label: 'Reconcile',    icon: GitMerge },
```

In the render block (line ~168), add after the daybook line:
```tsx
{tab === 'pending' && <PendingItemsTab />}
```

Add `ListChecks` to the lucide-react import at line 8:
```ts
import { Plus, Trash2, Download, Receipt, Users, Building, X, GitMerge, CheckCircle2, Paperclip, RefreshCcw, Coins, Upload, Loader2, Trash, Pencil, Ban, Unlink, AlertTriangle, PiggyBank, ListChecks } from 'lucide-react'
```

- [ ] **Step 2: Add PendingLineItem interface to the page-local types**

After the `ExpenseLineItem` interface (around line 63), add:
```ts
interface PendingItem {
  id: string
  paid_date: string
  description: string
  amount: number
  payment_mode: 'Cash' | 'Online' | 'Bank Transfer' | 'Cheque'
  reference_no: string | null
  payee_type: string
  staff_id: string | null
  vendor_id: string | null
  payee_name_raw: string | null
  category_id: string | null
  cost_center: string
  corpus_plan_id: string | null
  notes: string | null
  voided_at: string | null
  category: ExpenseCategory | null
  staff_member: StaffMember | null
  vendor: Vendor | null
}
```

Also extend `ExpenseLineItem` interface (around line 63) to include the new optional columns:
```ts
interface ExpenseLineItem {
  id: string; payee_type: string; payee_name_raw: string | null
  description: string; cost_center: string; amount: number
  utility_units: number | null; utility_rate: number | null
  period_from: string | null; period_to: string | null
  payment_mode: string | null
  reference_no: string | null
  category: ExpenseCategory | null
}
```

- [ ] **Step 3: Add the PendingItemsTab component skeleton**

At the end of the file (before the final closing of the module), add:

```tsx
// ── Pending Items tab ─────────────────────────────────────────

function PendingItemsTab() {
  const { canWrite } = useRoleCtx()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [addOpen, setAddOpen] = useState(false)
  const [editItem, setEditItem] = useState<PendingItem | null>(null)
  const [bundleOpen, setBundleOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['pending-line-items'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pending_line_items')
        .select(`
          *,
          category:category_id(id, name, budget_type, is_utility),
          staff_member:staff_id(id, name, role, assigned_area, phone, joined_date, left_date),
          vendor:vendor_id(id, name, type, phone, pan_number, notes, is_active)
        `)
        .is('voided_at', null)
        .order('paid_date', { ascending: false })
      if (error) throw error
      return (data ?? []) as PendingItem[]
    },
  })

  const total = items.reduce((s, i) => s + i.amount, 0)
  const selectedItems = items.filter(i => selectedIds.has(i.id))
  const selectedTotal = selectedItems.reduce((s, i) => s + i.amount, 0)

  function toggleOne(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function toggleAll() {
    setSelectedIds(prev => prev.size === items.length ? new Set() : new Set(items.map(i => i.id)))
  }

  if (isLoading) return <div className="surface h-40 animate-pulse" style={{ background: 'var(--ink-100)' }} />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm" style={{ color: 'var(--ink-600)' }}>
          <span className="font-semibold" style={{ color: 'var(--ink-800)' }}>{formatINR(total)}</span> unbundled · {items.length} items
        </div>
        <div className="flex gap-2">
          {canWrite && (
            <Button size="sm" onClick={() => setAddOpen(true)} className="flex items-center gap-1.5">
              <Plus size={14} /> Quick Add
            </Button>
          )}
          {canWrite && selectedIds.size > 0 && (
            <Button size="sm" onClick={() => setBundleOpen(true)} className="flex items-center gap-1.5">
              Bundle ({selectedIds.size}) · {formatINR(selectedTotal)}
            </Button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="surface !p-12 flex flex-col items-center gap-3 text-center" style={{ color: 'var(--ink-400)' }}>
          <ListChecks size={28} className="opacity-40" />
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--ink-700)' }}>No pending items</p>
            <p className="text-xs mt-1">Capture small payments here and bundle them into one expense later.</p>
          </div>
        </div>
      ) : (
        <div className="surface !p-0 divide-rows">
          <div className="flex items-center gap-3 px-4 py-2 text-xs uppercase" style={{ color: 'var(--ink-400)', borderBottom: '1px solid var(--ink-100)' }}>
            <input
              type="checkbox"
              checked={selectedIds.size === items.length && items.length > 0}
              onChange={toggleAll}
              className="w-4 h-4"
            />
            <span className="flex-1">Item</span>
            <span>Amount</span>
          </div>
          {items.map(i => (
            <div key={i.id} className="flex items-center gap-3 px-4 py-3">
              <input
                type="checkbox"
                checked={selectedIds.has(i.id)}
                onChange={() => toggleOne(i.id)}
                className="w-4 h-4"
              />
              <div className="shrink-0 w-10 text-center">
                <p className="text-xs font-bold leading-tight" style={{ color: 'var(--ink-800)' }}>
                  {new Date(i.paid_date).getDate().toString().padStart(2, '0')}
                </p>
                <p className="text-[10px] uppercase" style={{ color: 'var(--ink-400)' }}>
                  {new Date(i.paid_date).toLocaleString('en', { month: 'short' })}
                </p>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: 'var(--ink-800)' }}>{i.description}</p>
                <p className="text-xs truncate" style={{ color: 'var(--ink-500)' }}>
                  {i.category?.name ?? 'Uncategorised'} · {i.cost_center} · {i.payment_mode}
                  {(i.payee_name_raw || i.staff_member?.name || i.vendor?.name) && (
                    <> · {i.payee_name_raw || i.staff_member?.name || i.vendor?.name}</>
                  )}
                </p>
              </div>
              <span className="text-sm font-semibold shrink-0" style={{ color: 'var(--ink-800)' }}>
                {formatINR(i.amount)}
              </span>
              {canWrite && (
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => setEditItem(i)} className="p-1 hover:bg-[var(--ink-100)] rounded">
                    <Pencil size={14} style={{ color: 'var(--ink-500)' }} />
                  </button>
                  <button onClick={() => setDeleteId(i.id)} className="p-1 hover:bg-[var(--ink-100)] rounded">
                    <Trash size={14} style={{ color: 'var(--ink-500)' }} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {addOpen && <PendingItemDialog onClose={() => setAddOpen(false)} />}
      {editItem && <PendingItemDialog item={editItem} onClose={() => setEditItem(null)} />}
      {bundleOpen && (
        <BundleDialog
          items={selectedItems}
          onClose={() => setBundleOpen(false)}
          onBundled={() => { setBundleOpen(false); setSelectedIds(new Set()) }}
        />
      )}
      {deleteId && (
        <DeletePendingDialog
          id={deleteId}
          onClose={() => setDeleteId(null)}
        />
      )}
    </div>
  )
}

// Stubs — implemented in later tasks
function PendingItemDialog(_props: { item?: PendingItem; onClose: () => void }) { return null }
function BundleDialog(_props: { items: PendingItem[]; onClose: () => void; onBundled: () => void }) { return null }
function DeletePendingDialog(_props: { id: string; onClose: () => void }) { return null }
```

- [ ] **Step 4: Type-check + view in browser**

```bash
npx tsc --noEmit
npm run dev
```
Navigate to `/expenses`. Click **Pending Items** tab. Expected: empty state "No pending items".

- [ ] **Step 5: Commit**

```bash
git add src/pages/ExpensesPage.tsx
git commit -m "feat(expenses): Pending Items tab shell + list query"
```

---

## Task 4: PendingItemDialog (add + edit)

**Files:**
- Modify: `src/pages/ExpensesPage.tsx`

- [ ] **Step 1: Replace the `PendingItemDialog` stub**

Find the line `function PendingItemDialog(_props: { item?: PendingItem; onClose: () => void }) { return null }` and replace with the full component:

```tsx
const pendingItemSchema = z.object({
  paid_date:      z.string().min(1, 'Required'),
  description:    z.string().min(1, 'Required'),
  amount:         z.coerce.number().int().positive('Must be > 0'),
  payment_mode:   z.enum(['Cash','Online','Bank Transfer','Cheque']),
  reference_no:   z.string().optional(),
  payee_type:     z.enum(['Staff','Vendor','Utility','Municipal','Other']),
  staff_id:       z.string().optional(),
  vendor_id:      z.string().optional(),
  payee_name_raw: z.string().optional(),
  category_id:    z.string().min(1, 'Required'),
  cost_center:    z.string().min(1, 'Required'),
  corpus_plan_id: z.string().optional(),
  notes:          z.string().optional(),
})
type PendingItemForm = z.infer<typeof pendingItemSchema>

function PendingItemDialog({ item, onClose }: { item?: PendingItem; onClose: () => void }) {
  const qc = useQueryClient()
  const isEdit = !!item

  const { data: categories = [] } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: async () => {
      const { data } = await supabase.from('expense_categories').select('*').order('sort_order')
      return (data ?? []) as ExpenseCategory[]
    },
  })
  const { data: corpusPlans = [] } = useQuery({
    queryKey: ['corpus-plans-active'],
    queryFn: async () => {
      const { data } = await supabase.from('corpus_plans').select('id, name, status').in('status', ['active', 'draft'])
      return (data ?? []) as { id: string; name: string; status: string }[]
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

  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<PendingItemForm>({
    resolver: zodResolver(pendingItemSchema),
    defaultValues: item ? {
      paid_date:      item.paid_date,
      description:    item.description,
      amount:         item.amount,
      payment_mode:   item.payment_mode,
      reference_no:   item.reference_no ?? '',
      payee_type:     item.payee_type as PendingItemForm['payee_type'],
      staff_id:       item.staff_id ?? '',
      vendor_id:      item.vendor_id ?? '',
      payee_name_raw: item.payee_name_raw ?? '',
      category_id:    item.category_id ?? '',
      cost_center:    item.cost_center,
      corpus_plan_id: item.corpus_plan_id ?? '',
      notes:          item.notes ?? '',
    } : {
      paid_date:    new Date().toISOString().slice(0, 10),
      payment_mode: 'Cash',
      payee_type:   'Other',
      cost_center:  'Common',
    },
  })

  const payeeType = watch('payee_type')

  async function onSubmit(form: PendingItemForm) {
    const payload = {
      paid_date:      form.paid_date,
      description:    form.description,
      amount:         form.amount,
      payment_mode:   form.payment_mode,
      reference_no:   form.reference_no || null,
      payee_type:     form.payee_type,
      staff_id:       form.payee_type === 'Staff'  && form.staff_id  ? form.staff_id  : null,
      vendor_id:      form.payee_type === 'Vendor' && form.vendor_id ? form.vendor_id : null,
      payee_name_raw: form.payee_name_raw || null,
      category_id:    form.category_id,
      cost_center:    form.cost_center,
      corpus_plan_id: form.corpus_plan_id || null,
      notes:          form.notes || null,
    }
    if (isEdit && item) {
      const { error } = await supabase.from('pending_line_items').update(payload).eq('id', item.id)
      if (error) { toast.error(error.message); return }
      toast.success('Pending item updated')
    } else {
      const { error } = await supabase.from('pending_line_items').insert(payload)
      if (error) { toast.error(error.message); return }
      toast.success('Pending item added')
    }
    qc.invalidateQueries({ queryKey: ['pending-line-items'] })
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit pending item' : 'Add pending item'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Date</Label>
              <Input type="date" {...register('paid_date')} />
              {errors.paid_date && <p className="text-xs text-red-600 mt-1">{errors.paid_date.message}</p>}
            </div>
            <div>
              <Label>Amount (₹)</Label>
              <Input type="number" min="1" {...register('amount')} />
              {errors.amount && <p className="text-xs text-red-600 mt-1">{errors.amount.message}</p>}
            </div>
          </div>

          <div>
            <Label>Description</Label>
            <Input {...register('description')} placeholder="e.g. Bleaching powder, plumber call-out" />
            {errors.description && <p className="text-xs text-red-600 mt-1">{errors.description.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Category</Label>
              <select {...register('category_id')} className="w-full h-9 px-2 border rounded text-sm">
                <option value="">Select…</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {errors.category_id && <p className="text-xs text-red-600 mt-1">{errors.category_id.message}</p>}
            </div>
            <div>
              <Label>Cost centre</Label>
              <select {...register('cost_center')} className="w-full h-9 px-2 border rounded text-sm">
                {['Block-A','Block-B','Block-C','Block-D','Block-E','Common','Municipal','All'].map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Payment mode</Label>
              <select {...register('payment_mode')} className="w-full h-9 px-2 border rounded text-sm">
                {['Cash','Online','Bank Transfer','Cheque'].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <Label>Reference / UPI ref</Label>
              <Input {...register('reference_no')} placeholder="Optional" />
            </div>
          </div>

          <div>
            <Label>Paid to</Label>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <select {...register('payee_type')} className="h-9 px-2 border rounded text-sm">
                {['Other','Staff','Vendor','Utility','Municipal'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              {payeeType === 'Staff' && (
                <select {...register('staff_id')} className="h-9 px-2 border rounded text-sm col-span-2">
                  <option value="">Select staff…</option>
                  {staff.map(s => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
                </select>
              )}
              {payeeType === 'Vendor' && (
                <select {...register('vendor_id')} className="h-9 px-2 border rounded text-sm col-span-2">
                  <option value="">Select vendor…</option>
                  {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              )}
              {payeeType !== 'Staff' && payeeType !== 'Vendor' && (
                <Input {...register('payee_name_raw')} placeholder="Name (free text)" className="col-span-2" />
              )}
            </div>
          </div>

          <div>
            <Label>Corpus plan (optional)</Label>
            <select {...register('corpus_plan_id')} className="w-full h-9 px-2 border rounded text-sm">
              <option value="">— None (Maintenance) —</option>
              {corpusPlans.map(p => <option key={p.id} value={p.id}>{p.name} ({p.status})</option>)}
            </select>
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea {...register('notes')} rows={2} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : (isEdit ? 'Update' : 'Add item')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Type-check + smoke test**

```bash
npx tsc --noEmit
```
In the browser, click **Quick Add**. Fill all required fields. Save. Expected: row appears in the list; "0 items" → "1 items"; total updates.

Click pencil icon on the row → dialog opens prefilled → change description → Update → row reflects new description.

- [ ] **Step 3: Commit**

```bash
git add src/pages/ExpensesPage.tsx
git commit -m "feat(expenses): pending item add + edit dialog"
```

---

## Task 5: Soft-delete pending item

**Files:**
- Modify: `src/pages/ExpensesPage.tsx`

- [ ] **Step 1: Replace the `DeletePendingDialog` stub**

```tsx
function DeletePendingDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleDelete() {
    setSubmitting(true)
    const { error } = await supabase
      .from('pending_line_items')
      .update({
        voided_at:   new Date().toISOString(),
        voided_by:   (await supabase.auth.getUser()).data.user?.id,
        void_reason: reason || 'Deleted by admin',
      })
      .eq('id', id)
    setSubmitting(false)
    if (error) { toast.error(error.message); return }
    toast.success('Pending item deleted')
    qc.invalidateQueries({ queryKey: ['pending-line-items'] })
    onClose()
  }

  return (
    <AlertDialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete pending item?</AlertDialogTitle>
          <AlertDialogDescription>
            This will hide the item from the list. The audit log keeps a record.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div>
          <Label className="text-xs">Reason (optional)</Label>
          <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. duplicate entry" />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleDelete} disabled={submitting}>
            {submitting ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

- [ ] **Step 2: Smoke test**

In browser: click trash icon on a row. Enter reason. Confirm. Expected: row disappears; counts update.

Verify in Supabase:
```sql
SELECT id, description, voided_at, void_reason FROM pending_line_items WHERE voided_at IS NOT NULL LIMIT 1;
```
Expected: the deleted row exists with `voided_at` set.

- [ ] **Step 3: Commit**

```bash
git add src/pages/ExpensesPage.tsx
git commit -m "feat(expenses): soft-delete pending item"
```

---

## Task 6: BundleDialog + RPC call + validation

**Files:**
- Modify: `src/pages/ExpensesPage.tsx`

- [ ] **Step 1: Replace the `BundleDialog` stub**

```tsx
const bundleHeaderSchema = z.object({
  expense_date:   z.string().min(1, 'Required'),
  description:    z.string().min(1, 'Required'),
  payment_mode:   z.enum(['Cash','Online','Bank Transfer','Cheque']),
  payee_name_raw: z.string().optional(),
})
type BundleHeaderForm = z.infer<typeof bundleHeaderSchema>

function BundleDialog({ items, onClose, onBundled }: { items: PendingItem[]; onClose: () => void; onBundled: () => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()

  // Validation: all items must share the same corpus_plan_id (NULL or same UUID)
  const corpusPlanIds = Array.from(new Set(items.map(i => i.corpus_plan_id ?? '__none__')))
  const mixedCorpus = corpusPlanIds.length > 1

  // Defaults
  const maxDate = items.reduce((m, i) => i.paid_date > m ? i.paid_date : m, items[0]?.paid_date ?? new Date().toISOString().slice(0,10))
  const modeFreq = items.reduce<Record<string, number>>((acc, i) => { acc[i.payment_mode] = (acc[i.payment_mode] ?? 0) + 1; return acc }, {})
  const commonMode = (Object.entries(modeFreq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Cash') as BundleHeaderForm['payment_mode']
  const dateRange = (() => {
    const dates = items.map(i => i.paid_date).sort()
    const fmt = (d: string) => `${new Date(d).getDate()} ${new Date(d).toLocaleString('en', { month: 'short' })}`
    return dates[0] === dates[dates.length - 1] ? fmt(dates[0]) : `${fmt(dates[0])} → ${fmt(dates[dates.length - 1])}`
  })()
  const total = items.reduce((s, i) => s + i.amount, 0)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<BundleHeaderForm>({
    resolver: zodResolver(bundleHeaderSchema),
    defaultValues: {
      expense_date:   maxDate,
      description:    `Bundled — ${items.length} items, ${dateRange}`,
      payment_mode:   commonMode,
      payee_name_raw: 'Bundled',
    },
  })

  async function onSubmit(form: BundleHeaderForm) {
    const { data, error } = await supabase.rpc('bundle_pending_items', {
      p_ids: items.map(i => i.id),
      p_header: form,
    })
    if (error) { toast.error(error.message); return }
    const result = data as { expense_id: string; voucher_no: string }
    toast.success(`Created ${result.voucher_no}`, {
      action: { label: 'View', onClick: () => navigate(`/expenses?voucher=${result.voucher_no}`) },
    })
    qc.invalidateQueries({ queryKey: ['pending-line-items'] })
    qc.invalidateQueries({ queryKey: ['expenses'] })
    onBundled()
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Bundle {items.length} items → 1 expense</DialogTitle>
        </DialogHeader>

        {mixedCorpus ? (
          <div className="surface !p-4 flex items-start gap-2 bg-red-50">
            <AlertTriangle size={16} className="text-red-600 mt-0.5 shrink-0" />
            <div className="text-sm text-red-900">
              <p className="font-medium">Cannot mix maintenance and corpus items in one bundle.</p>
              <p className="text-xs mt-1">All selected items must share the same corpus plan (or all be maintenance).</p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
            <div className="surface !p-3 text-sm">
              {items.length} items · <span className="font-semibold">{formatINR(total)}</span> · {dateRange}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Expense date</Label>
                <Input type="date" {...register('expense_date')} />
                {errors.expense_date && <p className="text-xs text-red-600 mt-1">{errors.expense_date.message}</p>}
              </div>
              <div>
                <Label>Bundle payment mode</Label>
                <select {...register('payment_mode')} className="w-full h-9 px-2 border rounded text-sm">
                  {['Cash','Online','Bank Transfer','Cheque'].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>

            <div>
              <Label>Description</Label>
              <Input {...register('description')} />
              {errors.description && <p className="text-xs text-red-600 mt-1">{errors.description.message}</p>}
            </div>

            <div>
              <Label>Payee label on bundled expense</Label>
              <Input {...register('payee_name_raw')} />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Creating…' : 'Create bundled expense'}
              </Button>
            </DialogFooter>
          </form>
        )}

        {mixedCorpus && (
          <DialogFooter>
            <Button onClick={onClose}>Close</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Smoke test — happy path**

In browser:
1. Add 3 pending items (different categories, all maintenance, no corpus plan, mix of cash and UPI).
2. Select all 3 via the header checkbox.
3. Click `Bundle (3) · ₹X,XXX`.
4. Expected: dialog shows 3 items + total + date range; defaults populated.
5. Click **Create bundled expense**.
6. Expected: toast `Created EXP-YYYY-NNNN`. Pending list is now empty. Selected count resets.
7. Switch to **Day Book** tab. Expected: new expense with voucher number appears with `approval_status='pending'` badge and the 3 line items inside.

- [ ] **Step 3: Smoke test — mixed corpus blocked**

1. Add 2 pending items: one with corpus plan set, one without.
2. Select both → Bundle.
3. Expected: dialog shows the red blocker; no submit button visible; only Close.

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/ExpensesPage.tsx
git commit -m "feat(expenses): bundle pending items into single expense via RPC"
```

---

## Task 7: Help text update

**Files:**
- Modify: `src/components/HelpButton.tsx`

- [ ] **Step 1: Locate the expenses help section**

Search for the existing expenses help blurb:

```bash
grep -n "expenses\|Expenses" src/components/HelpButton.tsx
```

- [ ] **Step 2: Add a Pending Items paragraph**

In the help content for the `/expenses` route, add:

```tsx
<>
  <h4 className="font-semibold text-sm mt-3">Pending Items</h4>
  <p className="text-xs">
    Capture individual small payments (cash, UPI, online) as they happen. When you're ready,
    select several and click <b>Bundle</b> to create one consolidated expense in the Day Book —
    that bundled expense goes through the normal approval and reconciliation flow.
  </p>
  <p className="text-xs">
    Items in one bundle must all be either maintenance or all belong to the same corpus plan.
  </p>
</>
```

- [ ] **Step 3: Type-check + visual check**

```bash
npx tsc --noEmit
```
Open `/expenses`, click the floating `?` button. Expected: new "Pending Items" paragraph appears.

- [ ] **Step 4: Commit**

```bash
git add src/components/HelpButton.tsx
git commit -m "docs(help): explain Pending Items tab on Expenses page"
```

---

## Task 8: Final verification

- [ ] **Step 1: Full TypeScript check**

```bash
npx tsc --noEmit
```
Expected: no new errors compared to baseline before this work.

- [ ] **Step 2: Playwright auth + smoke (optional but recommended)**

```bash
npx playwright test --project=setup
npx playwright test --project="Desktop Chrome" --grep "expenses|pending"
```
Expected: existing expenses tests still pass.

- [ ] **Step 3: End-to-end manual walkthrough**

1. As admin user, navigate `/expenses` → Pending Items.
2. Add 4 items across two payees (one staff, one vendor) using cash + UPI.
3. Edit one item — change amount. Verify list updates.
4. Delete one item — verify it disappears.
5. Select remaining 3 → Bundle → confirm defaults → create.
6. Day Book: verify bundled expense voucher exists with 3 line items + pending approval badge.
7. As another admin or committee, approve the bundled expense (existing flow).
8. Verify in Supabase: `pending_line_items` is empty (for those 3); `expense_line_items` has the 3 rows with `payment_mode` + `reference_no` preserved.

- [ ] **Step 4: Final commit if any leftover tweaks**

```bash
git status
# If clean, no commit needed
```

---

## Rollback

If a serious issue surfaces post-deploy:

1. **Migration:** create `033_rollback_pending_line_items.sql` with `DROP TABLE public.pending_line_items CASCADE; DROP FUNCTION public.bundle_pending_items(uuid[], jsonb);` (do NOT drop the new columns on `expense_line_items` — bundled rows depend on them).
2. **UI:** revert the ExpensesPage tab entry; the components are inert if the tab is not selectable.

## Out of scope (deferred to a future plan)

- Bulk CSV import of pending items
- Auto-bundling rules
- Per-item bank reconciliation
- Attachments per pending item (currently only at bundle level)
