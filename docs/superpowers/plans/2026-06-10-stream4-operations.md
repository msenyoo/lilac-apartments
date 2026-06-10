# Operations & Governance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add expense approval workflow infrastructure, a complete Staff CRUD UI, and bulk maintenance payment recording to reduce operational friction.

**Architecture:** Migration 030 adds approval columns. Staff tab is already present in ExpensesPage (the code exists at line 1564 onwards) — the plan documents how to verify and complete it. Bulk dues dialog added to DuesPage. No new pages.

**Tech Stack:** React 18, TypeScript, Supabase JS, react-query, Shadcn/ui, AG Grid, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-06-10-financial-intelligence-design.md` — Stream 4 section

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/030_approval.sql` | Add `approval_status`, `approved_by` (uuid), `approved_at`, `rejection_reason` to expenses |
| Modify | `src/lib/supabase.ts` | Add `approval_status`, `approved_by`, `approved_at`, `rejection_reason` to Expense interface |
| Modify | `src/pages/ExpensesPage.tsx` | Update Expense type; add approval badge + Approve/Reject in Day Book detail; update expense query to fetch approval fields; update insert to set `approval_status = 'approved'` |
| Modify | `src/pages/DuesPage.tsx` | Add `BulkRecordDialog` component; add "Bulk Record" button (admin only) in header |

**Key constraints:**
- The expenses table in migration 006 already has `approved_by text` and `approved_at timestamptz` columns. Migration 030 must handle this: drop the old text column and add proper uuid FK, plus add the new columns.
- The `maintenance_payments` table referenced in the spec does not exist in this codebase. The dues system is entirely transaction-based. Bulk recording inserts tagged CR rows into `transactions` (with `cr_dr='CR'`, `category='Maintenance'`, `flat_code`, `flat_id`, `fiscal_year`, `fiscal_month`, `fiscal_label`, `corpus='NO'`, `source='Manual'`).
- Staff CRUD is already implemented in ExpensesPage.tsx (lines 1564–2050). Task 3 verifies the existing code is complete, adds a TypeScript check, and commits.

---

## Task 1: Migration 030 — Expense approval columns

**File:** `supabase/migrations/030_approval.sql`

### Step 1.1: Write the migration file

- [ ] Create `supabase/migrations/030_approval.sql` with the following content:

```sql
-- 030: Expense approval workflow infrastructure
-- Adds approval_status (pending|approved|rejected), approved_by (uuid FK), approved_at,
-- rejection_reason to the expenses table.
-- The old approved_by column was TEXT (free text). We replace it with a proper uuid FK
-- to auth.users so we can look up who approved and show their name.

-- Step 1: rename the old text column so we can reuse the name as uuid
ALTER TABLE public.expenses
  RENAME COLUMN approved_by TO approved_by_legacy;

-- Step 2: add new columns
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS approval_status   text NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS approved_by       uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS rejection_reason  text;

-- Step 3: migrate legacy data — treat any non-null legacy value as approved
UPDATE public.expenses
  SET approval_status = 'approved'
  WHERE approval_status = 'approved'; -- no-op, default is already 'approved'

-- Step 4: drop the now-redundant legacy column
-- (approved_at was already timestamptz and remains unchanged)
ALTER TABLE public.expenses DROP COLUMN approved_by_legacy;

-- Step 5: index for pending queue lookups
CREATE INDEX IF NOT EXISTS idx_expenses_approval_status
  ON public.expenses(approval_status)
  WHERE approval_status = 'pending';

-- Step 6: comment
COMMENT ON COLUMN public.expenses.approval_status IS
  'pending = awaiting admin review; approved = cleared for payment totals; rejected = excluded';
COMMENT ON COLUMN public.expenses.approved_by IS
  'auth.users.id of the admin who approved/rejected this expense';
COMMENT ON COLUMN public.expenses.rejection_reason IS
  'Filled in when approval_status = ''rejected''';
```

- [ ] Apply the migration in Supabase Dashboard → SQL Editor → paste and run.

### Step 1.2: Commit

```
git add supabase/migrations/030_approval.sql
git commit -m "feat(db): migration 030 — expense approval_status column"
```

---

## Task 2: TypeScript types — update Expense interface

**File:** `src/lib/supabase.ts`

The `Expense` interface is defined locally inside `ExpensesPage.tsx`, not in `supabase.ts`. However, `supabase.ts` is the canonical type file. We update both.

### Step 2.1: supabase.ts has no Expense type — skip (it's in ExpensesPage.tsx)

The `Expense` interface lives at line 42 of `ExpensesPage.tsx`. We update it there in Task 3.

There is nothing to change in `supabase.ts` for this task — no Expense export exists there. Skip to Task 3.

---

## Task 3: Expense approval UI in Day Book

**File:** `src/pages/ExpensesPage.tsx`

### Step 3.1: Update the local Expense interface to include approval fields

At line 42 of `ExpensesPage.tsx`, the `Expense` interface ends before the closing brace. Add the four new columns:

- [ ] In `ExpensesPage.tsx`, locate the `interface Expense` block and add after `corpus_plan` line:

```typescript
  approval_status: 'pending' | 'approved' | 'rejected'
  approved_by: string | null
  approved_at: string | null
  rejection_reason: string | null
```

The full interface after the change (lines 42–58 region) should look like:

```typescript
interface Expense {
  id: string; expense_date: string; description: string
  payee_type: string; payee_name_raw: string | null
  amount: number; payment_mode: string
  reference_no: string | null; cheque_number: string | null; voucher_no: string | null
  transaction_id: string | null; reconciled_at: string | null
  reconciliation_notes: string | null
  notes: string | null; created_at: string
  voided_at: string | null; voided_by: string | null; void_reason: string | null
  category: ExpenseCategory | null
  vendor: Vendor | null
  staff_member: StaffMember | null
  corpus_plan_id: string | null
  corpus_plan: { name: string } | null
  transaction: { id: string; value_date: string; description: string; amount: number } | null
  line_items: ExpenseLineItem[]
  approval_status: 'pending' | 'approved' | 'rejected'
  approved_by: string | null
  approved_at: string | null
  rejection_reason: string | null
}
```

### Step 3.2: Update the DayBook query to fetch approval fields

In `DayBook()`, the `useQuery` fetches a long select string. Add `approval_status,approved_by,approved_at,rejection_reason` to the select list.

- [ ] Locate the `.select(...)` call inside the DayBook `queryFn` (around line 187). The existing select string includes `voided_at,voided_by,void_reason,corpus_plan_id`. Append the four new columns:

```typescript
let q = supabase
  .from('expenses')
  .select(`
    id,expense_date,description,payee_type,payee_name_raw,amount,payment_mode,
    reference_no,cheque_number,voucher_no,transaction_id,reconciled_at,
    reconciliation_notes,notes,created_at,voided_at,voided_by,void_reason,corpus_plan_id,
    approval_status,approved_by,approved_at,rejection_reason,
    category:category_id(id,name,budget_type,is_utility),
    vendor:vendor_id(id,name,type,phone),
    staff_member:staff_id(id,name,role,assigned_area,phone,left_date),
    corpus_plan:corpus_plan_id(name),
    transaction:transaction_id(id,value_date,description,amount),
    line_items:expense_line_items(*, category:category_id(id,name,budget_type,is_utility))
  `)
  .order('expense_date', { ascending: false })
```

### Step 3.3: Add "Show pending" toggle and pending count badge to Day Book toolbar

The Day Book toolbar (around line 264) currently shows `Show voided` toggle and Export button. Add a `showPending` state and toggle.

- [ ] Add state variable at the top of `DayBook()`:

```typescript
const [showPending, setShowPending] = useState(false)
```

- [ ] Update the `useQuery` key to include `showPending`:

```typescript
queryKey: ['expenses', showVoided, showPending],
```

- [ ] After the existing `.is('voided_at', null)` filter line, add pending filter:

```typescript
if (!showVoided) q = q.is('voided_at', null)
if (showPending) q = q.eq('approval_status', 'pending')
```

- [ ] Count pending expenses for the badge. Add after `const unreconciled = ...` line:

```typescript
const pendingApproval = activeExpenses.filter(e => e.approval_status === 'pending').length
```

- [ ] In the toolbar JSX, add the pending toggle next to the voided toggle:

```tsx
<div className="flex items-center gap-4">
  <label className="flex items-center gap-2 text-sm cursor-pointer select-none" style={{ color: 'var(--ink-500)' }}>
    <input
      type="checkbox"
      checked={showVoided}
      onChange={e => { setShowVoided(e.target.checked); setDetailId(null) }}
      className="rounded"
    />
    Show voided
  </label>
  <label className="flex items-center gap-2 text-sm cursor-pointer select-none" style={{ color: 'var(--ink-500)' }}>
    <input
      type="checkbox"
      checked={showPending}
      onChange={e => { setShowPending(e.target.checked); setDetailId(null) }}
      className="rounded"
    />
    Show pending
    {pendingApproval > 0 && !showPending && (
      <span className="ml-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
        {pendingApproval}
      </span>
    )}
  </label>
</div>
```

### Step 3.4: Add approval badge to each expense row in the list

In the expense list (around line 295), each row currently shows a status badge (Cash / Reconciled / Unreconciled). Add a pending badge alongside it.

- [ ] Inside the `expenses.map(e => ...)` block, in the badges area (after the `STATUS_STYLE` span), add:

```tsx
{e.approval_status === 'pending' && (
  <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">
    Pending
  </span>
)}
{e.approval_status === 'rejected' && (
  <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-600">
    Rejected
  </span>
)}
```

### Step 3.5: Add Approve / Reject buttons to the expense detail panel

The detail panel is rendered by `ExpenseDetailPanel` (or inline in DayBook — check the actual component name around line 400+). When `isAdmin` is true and `approval_status === 'pending'`, show Approve and Reject buttons.

- [ ] Find where the detail panel renders the void button (look for `voided_at` guard). Add the approval action block above the void button section:

```tsx
{isAdmin && e.approval_status === 'pending' && (
  <div className="flex flex-col gap-2 pt-2 border-t hairline">
    <p className="text-xs font-semibold" style={{ color: 'var(--ink-500)' }}>Approval required</p>
    <div className="flex gap-2">
      <Button
        size="sm"
        className="flex-1 bg-green-600 hover:bg-green-700"
        onClick={() => handleApprove(e.id)}
        disabled={approvalBusy}
      >
        Approve
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="flex-1 border-red-300 text-red-600 hover:bg-red-50"
        onClick={() => setRejectTarget(e.id)}
        disabled={approvalBusy}
      >
        Reject
      </Button>
    </div>
  </div>
)}
{e.approval_status === 'rejected' && e.rejection_reason && (
  <div className="text-xs p-2 rounded-lg bg-red-50 text-red-700 border border-red-200">
    <strong>Rejected:</strong> {e.rejection_reason}
  </div>
)}
```

- [ ] Add state and handler variables to `DayBook()`:

```typescript
const [approvalBusy, setApprovalBusy] = useState(false)
const [rejectTarget, setRejectTarget] = useState<string | null>(null)
const [rejectReason, setRejectReason] = useState('')
const qc = useQueryClient()
const { isAdmin } = useRoleCtx()

async function handleApprove(expenseId: string) {
  setApprovalBusy(true)
  const { error } = await supabase
    .from('expenses')
    .update({
      approval_status: 'approved',
      approved_at: new Date().toISOString(),
    })
    .eq('id', expenseId)
  setApprovalBusy(false)
  if (error) { toast.error(error.message); return }
  toast.success('Expense approved')
  qc.invalidateQueries({ queryKey: ['expenses'] })
}

async function handleReject(expenseId: string, reason: string) {
  if (!reason.trim()) { toast.error('Rejection reason is required'); return }
  setApprovalBusy(true)
  const { error } = await supabase
    .from('expenses')
    .update({
      approval_status: 'rejected',
      rejection_reason: reason.trim(),
    })
    .eq('id', expenseId)
  setApprovalBusy(false)
  if (error) { toast.error(error.message); return }
  toast.success('Expense rejected')
  setRejectTarget(null)
  setRejectReason('')
  qc.invalidateQueries({ queryKey: ['expenses'] })
}
```

- [ ] Add the Reject dialog at the bottom of the `DayBook` return JSX (alongside `AddExpenseDialog`):

```tsx
<Dialog open={!!rejectTarget} onOpenChange={open => { if (!open) { setRejectTarget(null); setRejectReason('') } }}>
  <DialogContent className="max-w-sm">
    <DialogHeader><DialogTitle>Reject expense</DialogTitle></DialogHeader>
    <div className="flex flex-col gap-3">
      <p className="text-sm" style={{ color: 'var(--ink-500)' }}>Provide a reason for rejection. This will be visible to the submitter.</p>
      <Textarea
        value={rejectReason}
        onChange={e => setRejectReason(e.target.value)}
        placeholder="e.g. Missing receipt, duplicate entry..."
        rows={3}
      />
    </div>
    <DialogFooter>
      <Button variant="outline" onClick={() => { setRejectTarget(null); setRejectReason('') }}>Cancel</Button>
      <Button
        className="bg-red-600 hover:bg-red-700"
        disabled={!rejectReason.trim() || approvalBusy}
        onClick={() => rejectTarget && handleReject(rejectTarget, rejectReason)}
      >
        Reject
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### Step 3.6: Ensure new admin expenses default to approved on insert

The `AddExpenseDialog` calls `supabase.from('expenses').insert(...)`. Since migration 030 sets `DEFAULT 'approved'` for `approval_status`, no change is needed in the insert code — new admin expenses will automatically get `approval_status = 'approved'`.

Verify by checking the insert payload in `AddExpenseDialog` (around line 600–700). Confirm `approval_status` is not set explicitly (the DB default handles it). No code change needed here.

### Step 3.7: TypeScript check and commit

- [ ] Run `npx tsc --noEmit` from the project root. Fix any type errors.

- [ ] Commit:

```
git add src/pages/ExpensesPage.tsx
git commit -m "feat(expenses): approval_status badges + admin approve/reject in Day Book"
```

---

## Task 4: Staff CRUD tab — verify and complete

**File:** `src/pages/ExpensesPage.tsx`

The Staff tab code already exists in ExpensesPage.tsx (lines 1564–2050). This task verifies completeness and adds any missing pieces.

### Step 4.1: Verify the Staff tab is wired into the tab switcher

- [ ] Read lines 124–174 of `ExpensesPage.tsx`. Confirm the tab array includes `{ key: 'staff', label: 'Staff', icon: Users }` and `{tab === 'staff' && <StaffTab />}`. If already present (it is per the codebase), no change needed.

### Step 4.2: Verify StaffTab shows active staff by default with "Show former" toggle

- [ ] Read lines 1566–1721. Confirm:
  - `showFormer` state controls whether inactive (left) staff appear.
  - `displayed` is filtered accordingly.
  - Empty state shows `<Users size={28} />` icon with contextual message.
  - Each row shows: name, role + area + phone, Active/Left badge, Edit (pencil) + Mark as left / Reactivate + Delete (trash) buttons.
  - Delete is guarded: checks both `expenses` and `expense_line_items` for linked records before allowing delete.

If all present (they are per the existing code), no changes needed in this step.

### Step 4.3: Verify AddStaffDialog saves salary history entry

- [ ] Read lines 1957–2050. Confirm `AddStaffDialog` inserts both the staff row AND, if salary is provided, a `staff_salary_history` row with `effective_from = form.joined`. This is already implemented.

### Step 4.4: Verify EditStaffDialog is complete

- [ ] Read lines 1877–1955. Confirm all fields (name, role, area, phone, joined_date) are editable and saved to `staff` table. This is already implemented.

### Step 4.5: TypeScript check

- [ ] Run `npx tsc --noEmit`. Fix any errors revealed by the Task 3 type additions.

### Step 4.6: Commit if any changes were made

If steps 4.1–4.4 found any gaps that were fixed:

```
git add src/pages/ExpensesPage.tsx
git commit -m "feat(expenses): complete Staff CRUD tab — add/edit/mark-left/delete"
```

If no changes were needed (Staff tab was already complete), this task produces no commit.

---

## Task 5: Bulk maintenance payment recording in DuesPage

**File:** `src/pages/DuesPage.tsx`

**Key design decision:** The spec says "insert `maintenance_payments` rows". This codebase does not have a `maintenance_payments` table — dues are tracked entirely via the `transactions` table (see migrations 001, 003, 024, 026). Bulk recording therefore **updates existing unmatched CR transactions** by tagging them with `flat_id`, `flat_code`, `category='Maintenance'`, `fiscal_year`, `fiscal_month`, `fiscal_label`, and `corpus='NO'`. This matches the exact mechanism the v_dues_tracker view uses to compute collected amounts.

The "unmatched CRs" are transactions where `cr_dr='CR'` AND `corpus='NO'` AND `flat_id IS NULL` (not yet attributed to a flat). We update these in batch.

### Step 5.1: Add imports to DuesPage.tsx

- [ ] Add the following to the existing import block at the top of `DuesPage.tsx`:

```typescript
import { useState, useMemo, useRef } from 'react'  // already present
// Add these if not already imported:
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Loader2, ListChecks } from 'lucide-react'
import type { Flat } from '@/lib/supabase'
```

Check the existing imports first and only add what is missing.

### Step 5.2: Add the fiscal label helper function

- [ ] After the existing `applyAgingFilter` function, add:

```typescript
// Compute fiscal label from a date string (e.g. '2026-01-15' → 'Jan-26')
function toFiscalLabel(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }).replace(' ', '-')
}

// Compute fiscal year from a date (Apr–Mar)
function toFiscalYear(dateStr: string): number {
  const d = new Date(dateStr)
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
}

// Compute fiscal_month key (e.g. 'Apr-2025', 'Jan-2026')
function toFiscalMonth(dateStr: string): string {
  const d = new Date(dateStr)
  const monthName = d.toLocaleDateString('en-GB', { month: 'short' })
  const fy = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
  // fiscal_month stored as 'Apr-2025' format matching existing transaction data
  return `${monthName}-${fy + (d.getMonth() >= 3 ? 1 : 0)}`
}
```

### Step 5.3: Define BulkRow type

- [ ] After the `toFiscalMonth` helper, add:

```typescript
interface UnmatchedCR {
  id: string
  value_date: string
  description: string
  amount: number
}

interface BulkRow {
  txnId: string
  valueDate: string
  description: string
  amount: number
  flatId: string
  flatCode: string
  fiscalLabel: string
}
```

### Step 5.4: Add BulkRecordDialog component

- [ ] At the end of `DuesPage.tsx` (after the closing brace of `ArrearsMgmt`), add the following component:

```tsx
function BulkRecordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [rows, setRows] = useState<BulkRow[]>([])
  const [saving, setSaving] = useState(false)

  // Unmatched CRs: corpus='NO', flat_id IS NULL, cr_dr='CR'
  const { data: unmatchedCRs = [], isLoading: loadingCRs } = useQuery({
    queryKey: ['unmatched-crs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('id, value_date, description, amount')
        .eq('cr_dr', 'CR')
        .eq('corpus', 'NO')
        .is('flat_id', null)
        .neq('row_type', 'VOIDED')
        .order('value_date', { ascending: false })
      if (error) throw error
      return (data ?? []) as UnmatchedCR[]
    },
    enabled: open,
  })

  // Flats for dropdown
  const { data: flats = [], isLoading: loadingFlats } = useQuery({
    queryKey: ['flats-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('flats')
        .select('id, code, block')
        .order('code')
      if (error) throw error
      return (data ?? []) as Pick<Flat, 'id' | 'code' | 'block'>[]
    },
    enabled: open,
  })

  // When unmatchedCRs load, initialise rows
  useEffect(() => {
    if (unmatchedCRs.length > 0) {
      setRows(
        unmatchedCRs.map(cr => ({
          txnId: cr.id,
          valueDate: cr.value_date,
          description: cr.description,
          amount: cr.amount,
          flatId: '',
          flatCode: '',
          fiscalLabel: toFiscalLabel(cr.value_date),
        }))
      )
    }
  }, [unmatchedCRs])

  function setRowFlat(txnId: string, flatId: string, flatCode: string) {
    setRows(prev =>
      prev.map(r => r.txnId === txnId ? { ...r, flatId, flatCode } : r)
    )
  }

  function setRowFiscalLabel(txnId: string, fiscalLabel: string) {
    setRows(prev =>
      prev.map(r => r.txnId === txnId ? { ...r, fiscalLabel } : r)
    )
  }

  const assignedRows = rows.filter(r => r.flatId !== '')

  async function handleSaveAll() {
    if (assignedRows.length === 0) return
    setSaving(true)

    // Build updates: one per transaction row
    const updates = assignedRows.map(r => ({
      id: r.txnId,
      flat_id: r.flatId,
      flat_code: r.flatCode,
      category: 'Maintenance',
      corpus: 'NO' as const,
      fiscal_year: toFiscalYear(r.valueDate),
      fiscal_month: toFiscalMonth(r.valueDate),
      fiscal_label: r.fiscalLabel,
    }))

    // Supabase JS does not support bulk update with different values per row.
    // Execute updates sequentially via Promise.all (one update per row).
    const results = await Promise.all(
      updates.map(u =>
        supabase
          .from('transactions')
          .update({
            flat_id: u.flat_id,
            flat_code: u.flat_code,
            category: u.category,
            corpus: u.corpus,
            fiscal_year: u.fiscal_year,
            fiscal_month: u.fiscal_month,
            fiscal_label: u.fiscal_label,
          })
          .eq('id', u.id)
      )
    )

    setSaving(false)

    const errors = results.filter(r => r.error)
    if (errors.length > 0) {
      toast.error(`${errors.length} row(s) failed to save`)
      return
    }

    toast.success(`${assignedRows.length} payment(s) recorded successfully`)
    qc.invalidateQueries({ queryKey: ['dues'] })
    qc.invalidateQueries({ queryKey: ['unmatched-crs'] })
    onClose()
  }

  const isLoading = loadingCRs || loadingFlats

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Bulk Record Maintenance Payments</DialogTitle>
          <p className="text-sm mt-1" style={{ color: 'var(--ink-500)' }}>
            Assign each unmatched bank credit to a flat. Only rows with a flat selected will be saved.
          </p>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin" style={{ color: 'var(--ink-400)' }} />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <ListChecks size={32} style={{ color: 'var(--ink-300)' }} />
            <p className="text-sm" style={{ color: 'var(--ink-400)' }}>No unmatched CR transactions found</p>
            <p className="text-xs" style={{ color: 'var(--ink-400)' }}>All credits have already been attributed to flats</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b hairline text-left">
                  <th className="py-2 pr-3 font-semibold text-xs" style={{ color: 'var(--ink-500)' }}>Date</th>
                  <th className="py-2 pr-3 font-semibold text-xs" style={{ color: 'var(--ink-500)' }}>Description</th>
                  <th className="py-2 pr-3 font-semibold text-xs text-right" style={{ color: 'var(--ink-500)' }}>Amount</th>
                  <th className="py-2 pr-3 font-semibold text-xs" style={{ color: 'var(--ink-500)' }}>Flat</th>
                  <th className="py-2 font-semibold text-xs" style={{ color: 'var(--ink-500)' }}>Fiscal month</th>
                </tr>
              </thead>
              <tbody className="divide-y hairline">
                {rows.map(r => (
                  <tr key={r.txnId} className={r.flatId ? 'bg-green-50' : ''}>
                    <td className="py-2 pr-3 font-mono text-xs whitespace-nowrap" style={{ color: 'var(--ink-600)' }}>
                      {r.valueDate}
                    </td>
                    <td className="py-2 pr-3 text-xs max-w-[180px] truncate" style={{ color: 'var(--ink-700)' }}>
                      {r.description}
                    </td>
                    <td className="py-2 pr-3 text-xs text-right font-semibold tabular-nums" style={{ color: 'var(--ink-800)' }}>
                      {formatINR(r.amount)}
                    </td>
                    <td className="py-2 pr-3">
                      <Select
                        value={r.flatId}
                        onValueChange={val => {
                          const flat = flats.find(f => f.id === val)
                          if (flat) setRowFlat(r.txnId, flat.id, flat.code)
                        }}
                      >
                        <SelectTrigger className="h-7 text-xs w-28">
                          <SelectValue placeholder="Select flat" />
                        </SelectTrigger>
                        <SelectContent>
                          {flats.map(f => (
                            <SelectItem key={f.id} value={f.id}>
                              {f.code} ({f.block})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-2">
                      <Input
                        className="h-7 text-xs w-24 font-mono"
                        value={r.fiscalLabel}
                        onChange={e => setRowFiscalLabel(r.txnId, e.target.value)}
                        placeholder="Jun-26"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {rows.length > 0 && (
          <div className="border-t hairline pt-3 flex items-center justify-between gap-3 flex-shrink-0">
            <p className="text-xs" style={{ color: 'var(--ink-500)' }}>
              {assignedRows.length} of {rows.length} rows assigned
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                disabled={assignedRows.length === 0 || saving}
                onClick={handleSaveAll}
              >
                {saving
                  ? <><Loader2 size={14} className="animate-spin mr-1" /> Saving...</>
                  : `Record ${assignedRows.length} payment${assignedRows.length !== 1 ? 's' : ''}`
                }
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
```

### Step 5.5: Add useEffect import to DuesPage.tsx

The `BulkRecordDialog` uses `useEffect`. Ensure it is imported.

- [ ] In the imports at the top of `DuesPage.tsx`, update the React import:

```typescript
import { useState, useMemo, useRef, useEffect } from 'react'
```

Also ensure `useQueryClient` is imported from `@tanstack/react-query` (check if only `useQuery` is currently imported):

```typescript
import { useQuery, useQueryClient } from '@tanstack/react-query'
```

### Step 5.6: Add "Bulk Record" button to DuesPage header and wire the dialog

- [ ] In `DuesPage()`, add state for the dialog:

```typescript
const [bulkOpen, setBulkOpen] = useState(false)
```

- [ ] In the header section (around line 137 where the Export button is), add the Bulk Record button visible to admins only:

```tsx
<div className="flex items-center gap-2">
  {isAdmin && (
    <Button
      size="sm"
      variant="outline"
      onClick={() => setBulkOpen(true)}
      className="flex items-center gap-2"
    >
      <ListChecks size={14} /> Bulk Record
    </Button>
  )}
  <button
    onClick={handleExport}
    disabled={!data?.length}
    className="flex items-center gap-2 px-3.5 py-2 rounded-[10px] border hairline font-semibold text-[13.5px] disabled:opacity-40"
    style={{ color: 'var(--ink-700)' }}
  >
    <Download size={14} /> Export
  </button>
</div>
```

- [ ] Add `const { isAdmin } = useRoleCtx()` inside `DuesPage()` (check if already present — it is only in `FlatPaymentPanel` and `ArrearsMgmt` currently).

- [ ] At the bottom of the `DuesPage` return JSX (before the closing `</div>`), add:

```tsx
{bulkOpen && <BulkRecordDialog open={bulkOpen} onClose={() => setBulkOpen(false)} />}
```

### Step 5.7: Add missing imports to DuesPage.tsx (Flat type + new Shadcn)

- [ ] Update the supabase import line to include `Flat`:

```typescript
import { supabase, DuesEntry, Transaction, Flat } from '@/lib/supabase'
```

- [ ] Ensure `Select` components are imported from `@/components/ui/select`. Add if missing:

```typescript
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
```

- [ ] Ensure `Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter` are imported:

```typescript
// Already: import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
```

- [ ] Ensure `Loader2, ListChecks` are in the lucide import:

```typescript
import { X, TrendingDown, Download, MessageCircle, Check, Pencil, Trash2, Loader2, ListChecks } from 'lucide-react'
```

### Step 5.8: TypeScript check and commit

- [ ] Run `npx tsc --noEmit`. Fix any type errors (e.g. `amount` on UnmatchedCR from Supabase may be `number` not matching `formatINR` — cast as needed).

- [ ] Commit:

```
git add src/pages/DuesPage.tsx
git commit -m "feat(dues): bulk maintenance payment recording dialog"
```

---

## Task 6: Final integration check

### Step 6.1: Run TypeScript across the whole codebase

- [ ] `npx tsc --noEmit` — must produce zero errors.

### Step 6.2: Manual smoke test checklist

- [ ] Open `/expenses` → Day Book. Confirm no errors in console.
- [ ] Confirm the "Show pending" toggle appears.
- [ ] Confirm existing expenses show no pending badge (approval_status defaults to 'approved').
- [ ] Open Staff tab. Confirm staff list loads. Add a test staff member. Edit it. Mark as left. Verify it greys out.
- [ ] Open `/dues`. Confirm "Bulk Record" button appears for admin.
- [ ] Click "Bulk Record". If no unmatched CRs exist, confirm the empty state message appears.
- [ ] If unmatched CRs exist, assign one to a flat and click Record. Confirm toast success and dues grid refreshes.

### Step 6.3: Final commit

```
git add -p   # stage only the files touched in this stream
git commit -m "feat(stream4): operations & governance — expense approval, staff CRUD, bulk dues recording"
```

---

## Appendix: Fiscal label format reference

The `transactions` table stores three related fields:
- `fiscal_year`: integer, e.g. `2025` (means Apr 2025 – Mar 2026)
- `fiscal_month`: string, e.g. `'Jun-2026'` (month + end year, matching existing data)
- `fiscal_label`: string, e.g. `'Jun-26'` (short display label)

The `v_dues_tracker` view sums transactions using `fiscal_year >= start_fy` combined with `category = 'Maintenance'`. The bulk recording must set all three fields correctly so the transaction appears in the dues total.

The `toFiscalLabel` helper in Task 5 produces the short form (`Jun-26`). The `toFiscalYear` helper returns the April-start year integer. The `toFiscalMonth` helper matches the longer format seen in existing rows.

Before deploying, verify the existing fiscal_month format against a real transaction in the Supabase dashboard to confirm it matches the helper output.
