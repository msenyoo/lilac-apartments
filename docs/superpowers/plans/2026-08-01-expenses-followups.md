# Expenses Page Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close five gaps on the Expenses page: pending-item/line-item quantity parity, Day Book pagination, Day Book date+category filters, category badges, and excluding pending-approval/unreconciled expenses from all reports.

**Architecture:** One schema migration (`043`) adds `utility_units`/`utility_rate`/`unit_label` to `pending_line_items` and updates the `bundle_pending_items` RPC to copy them. UI changes are localised: quantity inputs in `PendingItemDialog` and `BulkAddPendingDialog`, a field carry-over fix in `AddExpenseDialog`'s pending picker, pagination + filters + category badges in `DayBook`. A new `src/lib/expenseFilters.ts` helper (`applyReportableFilter`) is applied across every report query in `ReportPage.tsx` that reads from `expenses`.

**Tech Stack:** Supabase Postgres + RLS, React 18 + TypeScript + Vite, react-query, react-hook-form + zod, Shadcn/ui, Tailwind. No new dependencies. No unit-test framework exists in this repo (no vitest/jest) — verification is `npx tsc --noEmit`, direct SQL checks against the dev DB for migration correctness, and code review. Per explicit instruction, do not spend time on browser/Playwright smoke-testing for this plan.

**Spec:** `docs/superpowers/specs/2026-08-01-expenses-followups-design.md`

## Global Constraints

- All schema changes go in a single new migration `043_pending_item_quantity.sql`. Do not edit prior migrations.
- Apply migration to **dev** (`qcoezjcwrsqchulqgydm`) first (Task 1), apply to **prod** (`aulttcsvxzcwyceezzpz`) only in the final task, after all other tasks are done and typechecked.
- `SUPABASE_ACCESS_TOKEN` is already set as an environment variable in this shell — use it directly (`$env:SUPABASE_ACCESS_TOKEN` in PowerShell), do not hardcode or print the token value.
- Run `npx tsc --noEmit` after every task before committing.
- No comments unless the WHY is non-obvious.
- period_from/period_to are intentionally NOT added to `pending_line_items` — out of scope per spec.
- The `applyReportableFilter` helper additionally excludes `voided_at IS NOT NULL` rows, fixing a pre-existing gap in the monthly-trend report query (Task 10) that had no voided-exclusion at all — this is a one-line side effect of the shared helper, not a separate task.
- No browser/Playwright testing in this plan — verify via `npx tsc --noEmit`, `npm run build`, and direct SQL queries against dev.

---

## File map

| File | Action |
|---|---|
| `supabase/migrations/043_pending_item_quantity.sql` | CREATE |
| `src/pages/ExpensesPage.tsx` | MODIFY (types, PendingItemDialog, DayBook, PendingItemsTab, AddExpenseDialog picker) |
| `src/components/expenses/BulkAddPendingDialog.tsx` | MODIFY |
| `src/lib/bulkPendingRows.ts` | MODIFY |
| `src/lib/expenseFilters.ts` | CREATE |
| `src/pages/ReportPage.tsx` | MODIFY (8 query sites) |

---

## Task 1: Migration 043 — schema + RPC update, apply to dev

**Files:**
- Create: `supabase/migrations/043_pending_item_quantity.sql`

**Interfaces:**
- Consumes: existing `bundle_pending_items(uuid[], jsonb)` RPC (current version in `036_fix_pending_rpc_locks.sql`)
- Produces: `pending_line_items.utility_units numeric`, `.utility_rate numeric`, `.unit_label text`; same RPC signature, now also copies these three columns into `expense_line_items`

- [ ] **Step 1: Create the migration file**

Write `supabase/migrations/043_pending_item_quantity.sql` exactly:

```sql
-- 043: Quantity/unit/rate parity between pending_line_items and expense_line_items.
--   expense_line_items gained free-form utility_units/utility_rate/unit_label in
--   migration 042 (per-line, not per-category) but pending_line_items never did —
--   so bundling a pending item into an expense silently dropped any quantity data.

ALTER TABLE public.pending_line_items
  ADD COLUMN IF NOT EXISTS utility_units numeric,
  ADD COLUMN IF NOT EXISTS utility_rate  numeric,
  ADD COLUMN IF NOT EXISTS unit_label    text;

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
  v_role := public.get_my_role();
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RAISE EXCEPTION 'p_ids must contain at least one item';
  END IF;

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

  PERFORM 1
  FROM   public.pending_line_items
  WHERE  id = ANY(p_ids) AND voided_at IS NULL
  FOR UPDATE;

  SELECT COUNT(*), SUM(amount),
         array_agg(DISTINCT COALESCE(corpus_plan_id, '00000000-0000-0000-0000-000000000000'::uuid))
  INTO   v_count, v_total, v_corpus_plan_ids
  FROM   public.pending_line_items
  WHERE  id = ANY(p_ids) AND voided_at IS NULL;

  IF v_count <> cardinality(p_ids) THEN
    RAISE EXCEPTION 'one or more items not found or voided';
  END IF;

  IF cardinality(v_corpus_plan_ids) > 1 THEN
    RAISE EXCEPTION 'cannot mix maintenance and corpus items, or different corpus plans';
  END IF;

  v_corpus_plan_id := CASE WHEN v_corpus_plan_ids[1] = '00000000-0000-0000-0000-000000000000'::uuid
                           THEN NULL ELSE v_corpus_plan_ids[1] END;

  INSERT INTO public.expenses (
    expense_date, description, payee_type, payee_name_raw,
    amount, payment_mode, corpus_plan_id, approval_status, created_by
  ) VALUES (
    v_header_date, v_header_desc, 'Other', v_header_payee,
    v_total, v_header_mode, v_corpus_plan_id, 'pending', auth.uid()
  )
  RETURNING id, voucher_no INTO v_expense_id, v_voucher_no;

  INSERT INTO public.expense_line_items (
    expense_id, payee_type, staff_id, vendor_id, payee_name_raw,
    description, category_id, cost_center, amount,
    payment_mode, reference_no, paid_date,
    utility_units, utility_rate, unit_label
  )
  SELECT v_expense_id, payee_type, staff_id, vendor_id, payee_name_raw,
         description, category_id, cost_center, amount,
         payment_mode, reference_no, paid_date,
         utility_units, utility_rate, unit_label
  FROM   public.pending_line_items
  WHERE  id = ANY(p_ids) AND voided_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> cardinality(p_ids) THEN
    RAISE EXCEPTION 'one or more items voided concurrently';
  END IF;

  INSERT INTO public.expense_attachments (expense_id, file_name, file_url, uploaded_by)
  SELECT v_expense_id, attachment_name, attachment_url, auth.uid()
  FROM   public.pending_line_items
  WHERE  id = ANY(p_ids)
    AND  voided_at IS NULL
    AND  attachment_url IS NOT NULL;

  DELETE FROM public.pending_line_items WHERE id = ANY(p_ids) AND voided_at IS NULL;

  RETURN jsonb_build_object('expense_id', v_expense_id, 'voucher_no', v_voucher_no);
END;
$$;

GRANT EXECUTE ON FUNCTION public.bundle_pending_items(uuid[], jsonb) TO authenticated;
```

- [ ] **Step 2: Apply migration to dev**

Run from PowerShell:

```powershell
$ref = "qcoezjcwrsqchulqgydm"
$sql = [System.IO.File]::ReadAllText("D:\projects\lilac-apartments\supabase\migrations\043_pending_item_quantity.sql", [System.Text.Encoding]::UTF8)
$escaped = $sql -replace '\\', '\\' -replace '"', '\"' -replace "`r", '' -replace "`n", '\n' -replace "`t", '\t'
$body = '{"query":"' + $escaped + '"}'
Invoke-RestMethod -Method POST -Uri "https://api.supabase.com/v1/projects/$ref/database/query" `
  -Headers @{ "Authorization" = "Bearer $env:SUPABASE_ACCESS_TOKEN"; "Content-Type" = "application/json" } `
  -Body $body
```

Expected: `[]` or `null` (no error response).

- [ ] **Step 3: Verify dev schema**

Run the same `Invoke-RestMethod` pattern against dev with this query string:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='pending_line_items'
  AND column_name IN ('utility_units','utility_rate','unit_label')
ORDER BY 1;
```

Expected: three rows — `unit_label`, `utility_rate`, `utility_units`.

- [ ] **Step 4: Commit**

```powershell
git add supabase/migrations/043_pending_item_quantity.sql
git commit -m "feat(db): migration 043 - quantity/unit/rate on pending line items"
```

---

## Task 2: TypeScript types + zod schema for pending item quantity

**Files:**
- Modify: `src/pages/ExpensesPage.tsx` (`PendingItem` interface ~line 80, `pendingItemSchema` ~line 3499)

**Interfaces:**
- Consumes: migration 043 columns
- Produces: `PendingItem.utility_units: number | null`, `.utility_rate: number | null`, `.unit_label: string | null`; `pendingItemSchema` gains `utility_units`, `utility_rate`, `unit_label` (all optional); `PendingItemForm` (inferred type) gains the same three fields

- [ ] **Step 1: Extend `PendingItem` interface**

Find the `PendingItem` interface (around line 80) and add the three fields right after `reference_no`:

```typescript
interface PendingItem {
  id: string
  paid_date: string
  description: string
  amount: number
  payment_mode: 'Cash' | 'Online' | 'Bank Transfer' | 'Cheque'
  reference_no: string | null
  utility_units: number | null
  utility_rate: number | null
  unit_label: string | null
  payee_type: string
  staff_id: string | null
  vendor_id: string | null
  payee_name_raw: string | null
  category_id: string | null
  cost_center: string
  corpus_plan_id: string | null
  notes: string | null
  attachment_url: string | null
  attachment_name: string | null
  voided_at: string | null
  category: ExpenseCategory | null
  staff_member: StaffMember | null
  vendor: Vendor | null
}
```

- [ ] **Step 2: Extend `pendingItemSchema`**

Find `pendingItemSchema` (around line 3499) and add the three optional fields after `reference_no`:

```typescript
const pendingItemSchema = z.object({
  paid_date:      z.string().min(1, 'Required'),
  description:    z.string().min(1, 'Required'),
  amount:         z.coerce.number().int().positive('Must be > 0'),
  payment_mode:   z.enum(['Cash','Online','Bank Transfer','Cheque']),
  reference_no:   z.string().optional(),
  utility_units:  z.coerce.number().optional(),
  utility_rate:   z.coerce.number().optional(),
  unit_label:     z.string().optional(),
  payee_type:     z.enum(['Staff','Vendor','Utility','Municipal','Other']),
  staff_id:       z.string().optional(),
  vendor_id:      z.string().optional(),
  payee_name_raw: z.string().optional(),
  category_id:    z.string().min(1, 'Required'),
  cost_center:    z.string().min(1, 'Required'),
  corpus_plan_id: z.string().optional(),
  notes:          z.string().optional(),
})
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (the new fields are optional, so existing call sites still type-check).

- [ ] **Step 4: Commit**

```powershell
git add src/pages/ExpensesPage.tsx
git commit -m "feat(types): quantity/unit/rate fields on pending item type + schema"
```

---

## Task 3: PendingItemDialog — quantity inputs

**Files:**
- Modify: `src/pages/ExpensesPage.tsx` (`PendingItemDialog`, ~lines 3602–3882)

**Interfaces:**
- Consumes: `pendingItemSchema`/`PendingItemForm` fields from Task 2
- Produces: `pending_line_items` rows with `utility_units`/`utility_rate`/`unit_label` populated

- [ ] **Step 1: Add `setValue` to the form hook destructure**

Find (around line 3636):

```typescript
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<PendingItemForm>({
```

Change to:

```typescript
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<PendingItemForm>({
```

- [ ] **Step 2: Add defaultValues for the new fields (edit mode)**

Find the `defaultValues: item ? { ... }` block (around line 3638) and add three lines after `reference_no`:

```typescript
    defaultValues: item ? {
      paid_date:      item.paid_date,
      description:    item.description,
      amount:         item.amount,
      payment_mode:   item.payment_mode,
      reference_no:   item.reference_no ?? '',
      utility_units:  item.utility_units ?? undefined,
      utility_rate:   item.utility_rate ?? undefined,
      unit_label:     item.unit_label ?? '',
      payee_type:     item.payee_type as PendingItemForm['payee_type'],
      staff_id:       item.staff_id ?? '',
      vendor_id:      item.vendor_id ?? '',
      payee_name_raw: item.payee_name_raw ?? '',
      category_id:    item.category_id ?? '',
      cost_center:    item.cost_center,
      corpus_plan_id: item.corpus_plan_id ?? '',
      notes:          item.notes ?? '',
    } : {
```

(Only the two new lines `utility_units`/`utility_rate`/`unit_label` are added; everything else stays as-is.)

- [ ] **Step 3: Add the `autoCalcAmount` helper**

Inside `PendingItemDialog`, right after the `setValue` destructure line added in Step 1, add:

```typescript
  function autoCalcAmount(units: number, rate: number) {
    if (units > 0 && rate > 0) setValue('amount', Math.round(units * rate))
  }
```

- [ ] **Step 4: Render the Quantity/Unit/Rate row**

Find the Category/Cost-centre grid (around line 3770–3787):

```tsx
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
```

Immediately after this closing `</div>` (before the Payment mode/Reference grid), insert:

```tsx
          {(() => {
            const unitsReg = register('utility_units')
            const rateReg = register('utility_rate')
            return (
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs">Quantity</Label>
                  <Input type="number" step="0.01" placeholder="0"
                    {...unitsReg}
                    onChange={e => {
                      unitsReg.onChange(e)
                      autoCalcAmount(Number(e.target.value), Number(watch('utility_rate')) || 0)
                    }}
                  />
                </div>
                <div>
                  <Label className="text-xs">Unit</Label>
                  <Input placeholder="liters, trips, pcs…" {...register('unit_label')} />
                </div>
                <div>
                  <Label className="text-xs">Rate per unit (₹)</Label>
                  <Input type="number" step="0.01" placeholder="₹/unit"
                    {...rateReg}
                    onChange={e => {
                      rateReg.onChange(e)
                      autoCalcAmount(Number(watch('utility_units')) || 0, Number(e.target.value))
                    }}
                  />
                </div>
              </div>
            )
          })()}
```

- [ ] **Step 5: Persist the fields on save**

Find `async function onSubmit(form: PendingItemForm)` (around line 3708) and add three lines to `payload` after `reference_no`:

```typescript
    const payload = {
      paid_date:       form.paid_date,
      description:     form.description,
      amount:          form.amount,
      payment_mode:    form.payment_mode,
      reference_no:    form.reference_no || null,
      utility_units:   form.utility_units || null,
      utility_rate:    form.utility_rate || null,
      unit_label:      form.unit_label || null,
      payee_type:      form.payee_type,
      staff_id:        form.payee_type === 'Staff'  && form.staff_id  ? form.staff_id  : null,
      vendor_id:       form.payee_type === 'Vendor' && form.vendor_id ? form.vendor_id : null,
      payee_name_raw:  form.payee_name_raw || null,
      category_id:     form.category_id,
      cost_center:     form.cost_center,
      corpus_plan_id:  form.corpus_plan_id || null,
      notes:           form.notes || null,
      attachment_url:  attachmentUrl,
      attachment_name: attachmentName,
    }
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Verify against dev DB**

After a manual add via the running dev server is out of scope for this plan (no browser testing), verify the code path is correct by re-reading the edited block and confirming: `unitsReg`/`rateReg` are each captured once per render (not re-created inside `onChange`), `setValue` is imported from the hook, and `payload.utility_units`/`utility_rate`/`unit_label` map 1:1 to the migration 043 columns.

- [ ] **Step 8: Commit**

```powershell
git add src/pages/ExpensesPage.tsx
git commit -m "feat(pending): quantity/unit/rate inputs on pending item dialog"
```

---

## Task 4: Bulk-add pending items — quantity columns

**Files:**
- Modify: `src/lib/bulkPendingRows.ts` (`BulkDraftRow`, `emptyRow`)
- Modify: `src/components/expenses/BulkAddPendingDialog.tsx` (payload, desktop table, mobile cards)

**Interfaces:**
- Consumes: nothing new
- Produces: `BulkDraftRow.utility_units: string`, `.utility_rate: string`, `.unit_label: string`; `pending_line_items` insert payload carries the parsed numeric values

- [ ] **Step 1: Extend `BulkDraftRow` and `emptyRow`**

In `src/lib/bulkPendingRows.ts`, update the interface and factory:

```typescript
export interface BulkDraftRow {
  key: string
  paid_date: string
  description: string
  amount: string
  utility_units: string
  utility_rate: string
  unit_label: string
  category_id: string
  cost_center: string
  payment_mode: 'Cash' | 'Online' | 'Bank Transfer' | 'Cheque'
  payee_type: 'Staff' | 'Vendor' | 'Utility' | 'Municipal' | 'Other'
  staff_id: string
  vendor_id: string
  payee_name_raw: string
  corpus_plan_id: string
  reference_no: string
  notes: string
}
```

```typescript
export function emptyRow(): BulkDraftRow {
  return {
    key: crypto.randomUUID(),
    paid_date: '',
    description: '',
    amount: '',
    utility_units: '',
    utility_rate: '',
    unit_label: '',
    category_id: '',
    cost_center: 'Common',
    payment_mode: 'Cash',
    payee_type: 'Other',
    staff_id: '',
    vendor_id: '',
    payee_name_raw: '',
    corpus_plan_id: '',
    reference_no: '',
    notes: '',
  }
}
```

(`parseClipboard`, `isRowEmpty`, `rowErrors` are unchanged — the new fields are optional and `parseClipboard` already spreads `...emptyRow()` so pasted rows get empty defaults.)

- [ ] **Step 2: Type-check the lib file**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit the lib change**

```powershell
git add src/lib/bulkPendingRows.ts
git commit -m "feat(bulk-pending): add quantity/unit/rate to draft row type"
```

- [ ] **Step 4: Add the insert payload fields**

In `src/components/expenses/BulkAddPendingDialog.tsx`, find `async function save()` (around line 76) and add three lines to the `payload` map after `reference_no`:

```typescript
      const payload = activeRows.map(r => ({
        paid_date: r.paid_date,
        description: r.description.trim(),
        amount: Number(r.amount),
        payment_mode: r.payment_mode,
        reference_no: r.reference_no || null,
        utility_units: r.utility_units ? Number(r.utility_units) : null,
        utility_rate: r.utility_rate ? Number(r.utility_rate) : null,
        unit_label: r.unit_label || null,
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
```

- [ ] **Step 5: Add a shared quantity-change handler**

Right after `function removeRow(key: string) { ... }` (around line 65), add:

```typescript
  function updateQuantity(r: BulkDraftRow, patch: { utility_units?: string; utility_rate?: string }) {
    const units = Number(patch.utility_units ?? r.utility_units) || 0
    const rate  = Number(patch.utility_rate ?? r.utility_rate) || 0
    const amount = units > 0 && rate > 0 ? { amount: String(Math.round(units * rate)) } : {}
    update(r.key, { ...patch, ...amount })
  }
```

- [ ] **Step 6: Add desktop table columns**

Find the table header (around line 165–177) and add three `<th>`s right after the Amount column:

```tsx
                <tr className="text-left text-xs uppercase" style={{ color: 'var(--ink-400)' }}>
                  <th className="w-[130px] px-1 font-medium">Date</th>
                  <th className="min-w-[210px] px-1 font-medium">Description</th>
                  <th className="w-[90px] px-1 font-medium">Amount</th>
                  <th className="w-[70px] px-1 font-medium">Qty</th>
                  <th className="w-[80px] px-1 font-medium">Unit</th>
                  <th className="w-[80px] px-1 font-medium">Rate</th>
                  <th className="w-[150px] px-1 font-medium">Category</th>
                  <th className="w-[110px] px-1 font-medium">Cost centre</th>
                  <th className="w-[110px] px-1 font-medium">Mode</th>
                  <th className="w-[230px] px-1 font-medium">Paid to</th>
                  <th className="w-[140px] px-1 font-medium">Corpus plan</th>
                  <th className="w-[100px] px-1 font-medium">Ref no</th>
                  <th className="w-[130px] px-1 font-medium">Notes</th>
                  <th className="w-8" />
                </tr>
```

Update the `<table>`'s `minWidth` from `1320` to `1560` (same line, `style={{ borderSpacing: '0 4px', minWidth: 1560 }}`).

Find the Amount `<td>` in the row map (around line 186):

```tsx
                      <td className="px-1"><input type="number" min="1" className={`${inputCls} ${errs.amount ? errCls : ''}`} value={r.amount} onChange={e => update(r.key, { amount: e.target.value })} /></td>
```

Immediately after it, insert:

```tsx
                      <td className="px-1"><input type="number" step="0.01" min="0" className={inputCls} value={r.utility_units} onChange={e => updateQuantity(r, { utility_units: e.target.value })} /></td>
                      <td className="px-1"><input className={inputCls} placeholder="unit" value={r.unit_label} onChange={e => update(r.key, { unit_label: e.target.value })} /></td>
                      <td className="px-1"><input type="number" step="0.01" min="0" className={inputCls} value={r.utility_rate} onChange={e => updateQuantity(r, { utility_rate: e.target.value })} /></td>
```

- [ ] **Step 7: Add mobile card fields**

Find the Description block in the mobile card map (around line 246–249):

```tsx
                  <div>
                    <p className="text-[11px] mb-0.5" style={{ color: 'var(--ink-500)' }}>Description</p>
                    <input className={`${inputCls} ${errs.description ? errCls : ''}`} value={r.description} onChange={e => update(r.key, { description: e.target.value })} />
                  </div>
```

Immediately after it, insert:

```tsx
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <p className="text-[11px] mb-0.5" style={{ color: 'var(--ink-500)' }}>Qty</p>
                      <input type="number" step="0.01" min="0" className={inputCls} value={r.utility_units} onChange={e => updateQuantity(r, { utility_units: e.target.value })} />
                    </div>
                    <div>
                      <p className="text-[11px] mb-0.5" style={{ color: 'var(--ink-500)' }}>Unit</p>
                      <input className={inputCls} placeholder="unit" value={r.unit_label} onChange={e => update(r.key, { unit_label: e.target.value })} />
                    </div>
                    <div>
                      <p className="text-[11px] mb-0.5" style={{ color: 'var(--ink-500)' }}>Rate (₹)</p>
                      <input type="number" step="0.01" min="0" className={inputCls} value={r.utility_rate} onChange={e => updateQuantity(r, { utility_rate: e.target.value })} />
                    </div>
                  </div>
```

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```powershell
git add src/components/expenses/BulkAddPendingDialog.tsx
git commit -m "feat(bulk-pending): quantity/unit/rate columns in bulk-add grid"
```

---

## Task 5: "Add from pending" picker — carry quantity fields

**Files:**
- Modify: `src/pages/ExpensesPage.tsx` (`handlePick` inside `AddExpenseDialog`, ~line 1196)

**Interfaces:**
- Consumes: `PendingItem.utility_units`/`.utility_rate`/`.unit_label` from Task 2
- Produces: line items appended to the expense form carry quantity data from the picked pending item

- [ ] **Step 1: Extend the `append()` call**

Find `function handlePick(items: PendingItem[])` (around line 1196):

```typescript
  function handlePick(items: PendingItem[]) {
    for (const item of items) {
      append({
        description:    item.description,
        payee_type:     item.payee_type,
        payee_name_raw: item.payee_name_raw ?? '',
        staff_id:       item.staff_id ?? '',
        vendor_id:      item.vendor_id ?? '',
        category_id:    item.category_id ?? '',
        cost_center:    item.cost_center,
        amount:         item.amount,
        paid_date:      item.paid_date,
        payment_mode:   item.payment_mode,
        reference_no:   item.reference_no ?? '',
        pending_id:     item.id,
      })
    }
```

Change to:

```typescript
  function handlePick(items: PendingItem[]) {
    for (const item of items) {
      append({
        description:    item.description,
        payee_type:     item.payee_type,
        payee_name_raw: item.payee_name_raw ?? '',
        staff_id:       item.staff_id ?? '',
        vendor_id:      item.vendor_id ?? '',
        category_id:    item.category_id ?? '',
        cost_center:    item.cost_center,
        amount:         item.amount,
        paid_date:      item.paid_date,
        payment_mode:   item.payment_mode,
        reference_no:   item.reference_no ?? '',
        utility_units:  item.utility_units ?? undefined,
        utility_rate:   item.utility_rate ?? undefined,
        unit_label:     item.unit_label ?? '',
        pending_id:     item.id,
      })
    }
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (`lineItemSchema` already has `utility_units`/`utility_rate`/`unit_label` as optional fields from the earlier line-item-followups work).

- [ ] **Step 3: Commit**

```powershell
git add src/pages/ExpensesPage.tsx
git commit -m "feat(pending): carry quantity/unit/rate through add-from-pending picker"
```

---

## Task 6: Day Book — date range + category filters

**Files:**
- Modify: `src/pages/ExpensesPage.tsx` (`DayBook`, ~lines 225–427)

**Interfaces:**
- Consumes: `expense_categories` table
- Produces: `dateFrom`, `dateTo`, `categoryFilter` state used by Task 7 (pagination) for page-reset

- [ ] **Step 1: Add filter state and a categories query**

Find the top of `DayBook()` (around line 225–231):

```typescript
function DayBook() {
  const [detailId, setDetailId] = useState<string | null>(null)
  const [showVoided, setShowVoided] = useState(false)
  const [showPending, setShowPending] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [sharing, setSharing] = useState(false)
  const [search, setSearch] = useState('')
```

Add three lines after `search`:

```typescript
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
```

Right after the `expenses` query (after its closing `})`, around line 258), add a categories query:

```typescript
  const { data: dayBookCategories = [] } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: async () => {
      const { data } = await supabase.from('expense_categories').select('id, name').order('sort_order')
      return (data ?? []) as { id: string; name: string }[]
    },
  })
```

- [ ] **Step 2: Extend the filter logic**

Find `filteredExpenses` (around line 266–276):

```typescript
  const filteredExpenses = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return expenses
    return expenses.filter(e => {
      const haystack = [
        e.description, e.payee_name_raw, e.vendor?.name, e.staff_member?.name,
        e.voucher_no, e.category?.name, e.reference_no, e.cheque_number,
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [expenses, search])
```

Replace with:

```typescript
  const filteredExpenses = useMemo(() => {
    const q = search.trim().toLowerCase()
    return expenses.filter(e => {
      if (q) {
        const haystack = [
          e.description, e.payee_name_raw, e.vendor?.name, e.staff_member?.name,
          e.voucher_no, e.category?.name, e.reference_no, e.cheque_number,
        ].filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      if (dateFrom && e.expense_date < dateFrom) return false
      if (dateTo && e.expense_date > dateTo) return false
      if (categoryFilter) {
        const matchesHeader = e.category?.id === categoryFilter
        const matchesLine = e.line_items.some(li => (li.category?.id ?? e.category?.id) === categoryFilter)
        if (!matchesHeader && !matchesLine) return false
      }
      return true
    })
  }, [expenses, search, dateFrom, dateTo, categoryFilter])
```

- [ ] **Step 3: Render the filter row**

Find the toolbar (around line 368–426), specifically the closing `</div>` of the first toolbar row (the one containing the "Show voided"/"Show pending" checkboxes and search box, ending around line 412 with `</div>` then the Share/Export row). Immediately after that first toolbar `<div className="flex items-center justify-between">...</div>` block closes (i.e. after the whole block ending around line 426), insert a new row:

```tsx
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Label className="text-xs" style={{ color: 'var(--ink-500)' }}>From</Label>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="text-[13px] h-8 w-[150px]" />
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-xs" style={{ color: 'var(--ink-500)' }}>To</Label>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="text-[13px] h-8 w-[150px]" />
        </div>
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          className="h-8 px-2 border rounded text-[13px]"
          style={{ borderColor: 'var(--ink-200, #e2e8f0)' }}
        >
          <option value="">All categories</option>
          {dayBookCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {(dateFrom || dateTo || categoryFilter) && (
          <button
            onClick={() => { setDateFrom(''); setDateTo(''); setCategoryFilter('') }}
            className="text-xs hover:opacity-70"
            style={{ color: 'var(--brand-700)' }}
          >
            Clear filters
          </button>
        )}
      </div>
```

This new row must be a sibling of the existing toolbar `<div className="flex items-center justify-between">`, placed between it and the `{expenses.length === 0 ? ... }` conditional block that follows.

- [ ] **Step 4: Update the "no matches" empty state to reflect filters too**

Find (around line 438–447):

```tsx
      ) : filteredExpenses.length === 0 ? (
        <div className="surface !p-12 flex flex-col items-center justify-center text-center gap-4">
          <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: 'var(--ink-100)' }}>
            <Search size={26} style={{ color: 'var(--ink-400)' }} />
          </div>
          <div>
            <p className="text-base font-medium" style={{ color: 'var(--ink-800)' }}>No matches for "{search}"</p>
            <p className="text-sm mt-1" style={{ color: 'var(--ink-500)' }}>Try a different description, payee, or voucher number.</p>
          </div>
        </div>
      ) : (
```

Replace the message paragraph with one that also covers filter-only misses:

```tsx
      ) : filteredExpenses.length === 0 ? (
        <div className="surface !p-12 flex flex-col items-center justify-center text-center gap-4">
          <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: 'var(--ink-100)' }}>
            <Search size={26} style={{ color: 'var(--ink-400)' }} />
          </div>
          <div>
            <p className="text-base font-medium" style={{ color: 'var(--ink-800)' }}>
              {search ? `No matches for "${search}"` : 'No expenses match the current filters'}
            </p>
            <p className="text-sm mt-1" style={{ color: 'var(--ink-500)' }}>Try a different description, payee, voucher number, date range, or category.</p>
          </div>
        </div>
      ) : (
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```powershell
git add src/pages/ExpensesPage.tsx
git commit -m "feat(daybook): date range and category filters"
```

---

## Task 7: Day Book — pagination

**Files:**
- Modify: `src/pages/ExpensesPage.tsx` (`DayBook`, list-render block)

**Interfaces:**
- Consumes: `filteredExpenses`, `dateFrom`, `dateTo`, `categoryFilter`, `search` from Task 6
- Produces: nothing for downstream tasks

- [ ] **Step 1: Add pagination state and page-reset effect**

Right after the `filteredExpenses` `useMemo` block from Task 6, add:

```typescript
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  useEffect(() => {
    setPage(1)
  }, [search, dateFrom, dateTo, categoryFilter])

  const totalPages = Math.max(1, Math.ceil(filteredExpenses.length / pageSize))
  const pageSafe = Math.min(page, totalPages)
  const pagedExpenses = filteredExpenses.slice((pageSafe - 1) * pageSize, pageSafe * pageSize)
```

(`useEffect` is already imported at the top of the file.)

- [ ] **Step 2: Render the paged list instead of the full filtered list**

Find `{filteredExpenses.map(e => {` (around line 452, inside `<div className="flex-1 min-w-0 surface !p-0 divide-rows">`). Change `filteredExpenses.map` to `pagedExpenses.map`. Leave every other reference to `filteredExpenses` unchanged (the empty-state checks and `handleExport` must keep using the full filtered list, not just the current page).

- [ ] **Step 3: Add the pager control**

Find the closing of the list `.map()` (around line 512, `})}`) followed by the closing `</div>` of `<div className="flex-1 min-w-0 surface !p-0 divide-rows">` (around line 513). Immediately after the `.map()` call's closing `})}` and before that `</div>`, insert:

```tsx
            {filteredExpenses.length > pageSize && (
              <div className="flex items-center justify-between px-4 py-3 text-xs" style={{ color: 'var(--ink-500)' }}>
                <span>
                  Showing {(pageSafe - 1) * pageSize + 1}–{Math.min(pageSafe * pageSize, filteredExpenses.length)} of {filteredExpenses.length}
                </span>
                <div className="flex items-center gap-2">
                  <select
                    value={pageSize}
                    onChange={e => { setPageSize(Number(e.target.value)); setPage(1) }}
                    className="h-7 px-1.5 border rounded text-xs"
                    style={{ borderColor: 'var(--ink-200, #e2e8f0)' }}
                  >
                    {[25, 50, 100].map(n => <option key={n} value={n}>{n}/page</option>)}
                  </select>
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={pageSafe <= 1}
                    className="p-1 rounded hover:bg-[var(--ink-100)] disabled:opacity-30"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span>{pageSafe} / {totalPages}</span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={pageSafe >= totalPages}
                    className="p-1 rounded hover:bg-[var(--ink-100)] disabled:opacity-30"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
```

- [ ] **Step 4: Import the chevron icons**

At the top of the file, find the `lucide-react` import (line 8) and add `ChevronLeft, ChevronRight` to it:

```typescript
import { Plus, Trash2, Download, Receipt, Users, Building, X, GitMerge, CheckCircle2, Paperclip, RefreshCcw, Coins, Upload, Loader2, Trash, Pencil, Ban, Unlink, AlertTriangle, PiggyBank, ListChecks, ListPlus, Eye, Share2, Search, ChevronLeft, ChevronRight } from 'lucide-react'
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```powershell
git add src/pages/ExpensesPage.tsx
git commit -m "feat(daybook): client-side pagination"
```

---

## Task 8: Category badges

**Files:**
- Modify: `src/pages/ExpensesPage.tsx` (badge helper near `STATUS_STYLE`, Day Book row, Pending Items row)

**Interfaces:**
- Consumes: nothing new
- Produces: `categoryBadgeClass(name)` usable anywhere in the file

- [ ] **Step 1: Add the badge-color helper**

Find `STATUS_INLINE` (around line 163–165):

```typescript
const STATUS_INLINE: Record<string, React.CSSProperties> = {
  Cash: { background: 'var(--ink-100)', color: 'var(--ink-600)' },
}
```

Immediately after it, add:

```typescript
const CATEGORY_BADGE_COLORS = [
  'bg-rose-100 text-rose-700',
  'bg-amber-100 text-amber-700',
  'bg-lime-100 text-lime-700',
  'bg-emerald-100 text-emerald-700',
  'bg-cyan-100 text-cyan-700',
  'bg-blue-100 text-blue-700',
  'bg-violet-100 text-violet-700',
  'bg-fuchsia-100 text-fuchsia-700',
]

function categoryBadgeClass(name: string | null | undefined): string {
  const key = name ?? 'Uncategorised'
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return CATEGORY_BADGE_COLORS[hash % CATEGORY_BADGE_COLORS.length]
}
```

- [ ] **Step 2: Apply to the Day Book row**

Find (around line 483–486, inside the `DayBook` list row):

```tsx
                    <p className="text-xs mt-0.5" style={{ color: 'var(--ink-500)' }}>
                      {payeeName} · {e.category?.name ?? e.payment_mode}
                      {e.voucher_no && <span className="ml-1.5" style={{ color: 'var(--ink-400)' }}>{e.voucher_no}</span>}
                    </p>
```

Replace with:

```tsx
                    <p className="text-xs mt-0.5 flex items-center gap-1 flex-wrap" style={{ color: 'var(--ink-500)' }}>
                      {payeeName}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${categoryBadgeClass(e.category?.name ?? e.payment_mode)}`}>
                        {e.category?.name ?? e.payment_mode}
                      </span>
                      {e.voucher_no && <span className="ml-1" style={{ color: 'var(--ink-400)' }}>{e.voucher_no}</span>}
                    </p>
```

- [ ] **Step 3: Apply to the Pending Items row**

Find (around line 3453–3459, inside `PendingItemsTab`):

```tsx
                <p className="text-xs truncate" style={{ color: 'var(--ink-500)' }}>
                  {i.category?.name ?? 'Uncategorised'} · {i.cost_center} · {i.payment_mode}
                  {i.attachment_url && <Paperclip size={11} className="inline ml-1.5 align-text-bottom" style={{ color: 'var(--ink-400)' }} />}
                  {(i.payee_name_raw || i.staff_member?.name || i.vendor?.name) && (
                    <> · {i.payee_name_raw || i.staff_member?.name || i.vendor?.name}</>
                  )}
                </p>
```

Replace with:

```tsx
                <p className="text-xs truncate flex items-center gap-1" style={{ color: 'var(--ink-500)' }}>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${categoryBadgeClass(i.category?.name)}`}>
                    {i.category?.name ?? 'Uncategorised'}
                  </span>
                  <span className="truncate min-w-0">
                    {i.cost_center} · {i.payment_mode}
                    {i.attachment_url && <Paperclip size={11} className="inline ml-1.5 align-text-bottom" style={{ color: 'var(--ink-400)' }} />}
                    {(i.payee_name_raw || i.staff_member?.name || i.vendor?.name) && (
                      <> · {i.payee_name_raw || i.staff_member?.name || i.vendor?.name}</>
                    )}
                  </span>
                </p>
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```powershell
git add src/pages/ExpensesPage.tsx
git commit -m "feat(expenses): colored category badges in Day Book and Pending Items lists"
```

---

## Task 9: `applyReportableFilter` helper

**Files:**
- Create: `src/lib/expenseFilters.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `applyReportableFilter<T>(q: T): T` — used by Task 10

- [ ] **Step 1: Create the helper**

Write `src/lib/expenseFilters.ts`:

```typescript
// Reports must only reflect confirmed spend: an expense still awaiting committee
// approval hasn't actually cleared, and one paid Online/Bank/Cheque but not yet
// matched to a bank transaction ("Unreconciled") isn't confirmed to have gone
// through as recorded. Cash and Direct (owner-paid) are settled by definition and
// always pass. Mirrors the Cash/Reconciled/Direct/Unreconciled classification in
// v_expense_reconciliation and expenseStatus() in ExpensesPage.tsx.
export function applyReportableFilter<T extends { is: any; eq: any; or: any }>(q: T): T {
  return q
    .is('voided_at', null)
    .eq('approval_status', 'approved')
    .or('payment_mode.eq.Cash,payment_mode.eq.Direct,transaction_id.not.is.null,reconciled_at.not.is.null')
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```powershell
git add src/lib/expenseFilters.ts
git commit -m "feat(reports): add applyReportableFilter helper"
```

---

## Task 10: Apply the reportable filter across ReportPage.tsx

**Files:**
- Modify: `src/pages/ReportPage.tsx` (import + 8 query sites)

**Interfaces:**
- Consumes: `applyReportableFilter` from Task 9
- Produces: nothing for downstream tasks

- [ ] **Step 1: Add the import**

At the top of `src/pages/ReportPage.tsx`, alongside the other `@/lib/*` imports, add:

```typescript
import { applyReportableFilter } from '@/lib/expenseFilters'
```

- [ ] **Step 2: AGM expenditure query**

Find (around line 566–575, inside the `agm-expenses` query):

```typescript
      const [{ data: exps }, { data: cats }] = await Promise.all([
        supabase.from('expenses').select('amount, category_id')
          .gte('expense_date', selectedFy.start)
          .lte('expense_date', selectedFy.end)
          .is('voided_at', null),
        supabase.from('expense_categories').select('id, name'),
      ])
```

Replace with:

```typescript
      const [{ data: exps }, { data: cats }] = await Promise.all([
        applyReportableFilter(supabase.from('expenses').select('amount, category_id'))
          .gte('expense_date', selectedFy.start)
          .lte('expense_date', selectedFy.end),
        supabase.from('expense_categories').select('id, name'),
      ])
```

- [ ] **Step 3: Category-wise expenses (Expenditure Reports tab)**

Find (around line 1176–1181, inside the `exp-by-category` query):

```typescript
      const { data: headers } = await applyFund(
        supabase.from('expenses').select('id, amount, category_id')
          .gte('expense_date', selectedFy.start)
          .lte('expense_date', selectedFy.end)
          .is('voided_at', null)
      )
```

Replace with:

```typescript
      const { data: headers } = await applyFund(
        applyReportableFilter(supabase.from('expenses').select('id, amount, category_id'))
          .gte('expense_date', selectedFy.start)
          .lte('expense_date', selectedFy.end)
      )
```

- [ ] **Step 4: Vendor-wise expenses**

Find (around line 1219–1225, inside the `exp-by-vendor` query):

```typescript
        applyFund(
          supabase.from('expenses').select('amount, vendor_id, payee_name_raw, payment_mode')
            .gte('expense_date', selectedFy.start)
            .lte('expense_date', selectedFy.end)
            .is('voided_at', null)
        ),
```

Replace with:

```typescript
        applyFund(
          applyReportableFilter(supabase.from('expenses').select('amount, vendor_id, payee_name_raw, payment_mode'))
            .gte('expense_date', selectedFy.start)
            .lte('expense_date', selectedFy.end)
        ),
```

- [ ] **Step 5: Monthly trend**

Find (around line 1246–1252, inside the `exp-monthly-trend` query — note this one had no `voided_at` exclusion at all before this fix):

```typescript
      const { data: exps } = await applyFund(
        supabase
          .from('expenses')
          .select('expense_date, amount')
          .gte('expense_date', selectedFy.start)
          .lte('expense_date', selectedFy.end)
      )
```

Replace with:

```typescript
      const { data: exps } = await applyFund(
        applyReportableFilter(
          supabase
            .from('expenses')
            .select('expense_date, amount')
        )
          .gte('expense_date', selectedFy.start)
          .lte('expense_date', selectedFy.end)
      )
```

- [ ] **Step 6: TDS register — special case (line items, no header join today)**

Find the whole `tds-register` query (around line 1272–1282):

```typescript
  const { data: tdsRows, isLoading: loadingTds } = useQuery({
    queryKey: ['tds-register', selectedFyYear],
    queryFn: async () => {
      const [{ data: lineItems }, { data: vendors }] = await Promise.all([
        supabase
          .from('expense_line_items')
          .select('amount, vendor_id, payee_name_raw, category_id')
          .gte('created_at', selectedFy.start + 'T00:00:00')
          .lte('created_at', selectedFy.end + 'T23:59:59'),
        supabase.from('vendors').select('id, name, pan_number'),
      ])
```

Replace with:

```typescript
  const { data: tdsRows, isLoading: loadingTds } = useQuery({
    queryKey: ['tds-register', selectedFyYear],
    queryFn: async () => {
      const { data: reportableHeaders } = await applyReportableFilter(
        supabase.from('expenses').select('id')
      )
        .gte('expense_date', selectedFy.start)
        .lte('expense_date', selectedFy.end)
      const reportableIds = (reportableHeaders ?? []).map(h => h.id)
      if (reportableIds.length === 0) return []
      const [{ data: lineItems }, { data: vendors }] = await Promise.all([
        supabase
          .from('expense_line_items')
          .select('amount, vendor_id, payee_name_raw, category_id')
          .in('expense_id', reportableIds)
          .gte('created_at', selectedFy.start + 'T00:00:00')
          .lte('created_at', selectedFy.end + 'T23:59:59'),
        supabase.from('vendors').select('id, name, pan_number'),
      ])
```

(The rest of the function — grouping, TDS threshold calc, return — is unchanged. The early `return []` when there are no reportable headers matches the function's existing return type, an array.)

- [ ] **Step 7: Category drill-down dialog**

Find (around line 1666–1678, inside `CategoryDrillDownDialog`):

```typescript
      let q = supabase
        .from('expenses')
        .select(`
          id, expense_date, amount, description, payee_type, payee_name_raw, voucher_no, category_id, corpus_plan_id,
          vendor:vendor_id(name),
          staff_member:staff_id(name)
        `)
        .gte('expense_date', fy.start)
        .lte('expense_date', fy.end)
        .is('voided_at', null)
      if (fund === 'corpus') q = q.not('corpus_plan_id', 'is', null)
      if (fund === 'maintenance') q = q.is('corpus_plan_id', null)
      const { data: headers } = await q.order('expense_date', { ascending: false })
```

Replace with:

```typescript
      let q = applyReportableFilter(supabase
        .from('expenses')
        .select(`
          id, expense_date, amount, description, payee_type, payee_name_raw, voucher_no, category_id, corpus_plan_id,
          vendor:vendor_id(name),
          staff_member:staff_id(name)
        `))
        .gte('expense_date', fy.start)
        .lte('expense_date', fy.end)
      if (fund === 'corpus') q = q.not('corpus_plan_id', 'is', null)
      if (fund === 'maintenance') q = q.is('corpus_plan_id', null)
      const { data: headers } = await q.order('expense_date', { ascending: false })
```

- [ ] **Step 8: Utility report**

Find (around line 1888–1893, inside `UtilityReport`):

```typescript
      const { data: headers } = await supabase
        .from('expenses')
        .select('id, expense_date')
        .gte('expense_date', fy.start)
        .lte('expense_date', fy.end)
        .is('voided_at', null)
```

Replace with:

```typescript
      const { data: headers } = await applyReportableFilter(supabase
        .from('expenses')
        .select('id, expense_date'))
        .gte('expense_date', fy.start)
        .lte('expense_date', fy.end)
```

- [ ] **Step 9: Cashbook DR split-up**

Find (around line 2133–2143, inside the `cashbook-dr` query):

```typescript
      const { data: headers } = await supabase
        .from('expenses')
        .select(`
          id, amount, description, expense_date, payee_type, payee_name_raw,
          category:category_id(name),
          vendor:vendor_id(name),
          staff_member:staff_id(name)
        `)
        .gte('expense_date', start)
        .lte('expense_date', end)
        .is('voided_at', null)
```

Replace with:

```typescript
      const { data: headers } = await applyReportableFilter(supabase
        .from('expenses')
        .select(`
          id, amount, description, expense_date, payee_type, payee_name_raw,
          category:category_id(name),
          vendor:vendor_id(name),
          staff_member:staff_id(name)
        `))
        .gte('expense_date', start)
        .lte('expense_date', end)
```

- [ ] **Step 10: R&P statement payments**

Find (around line 2522–2528, inside the `rp-payments` query):

```typescript
      const [{ data: exps }, { data: cats }] = await Promise.all([
        supabase.from('expenses')
          .select('amount, category_id')
          .gte('expense_date', selectedFy.start)
          .lte('expense_date', selectedFy.end)
          .is('voided_at', null),
        supabase.from('expense_categories').select('id, name'),
      ])
```

Replace with:

```typescript
      const [{ data: exps }, { data: cats }] = await Promise.all([
        applyReportableFilter(supabase.from('expenses')
          .select('amount, category_id'))
          .gte('expense_date', selectedFy.start)
          .lte('expense_date', selectedFy.end),
        supabase.from('expense_categories').select('id, name'),
      ])
```

- [ ] **Step 11: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. If `applyReportableFilter`'s generic constraint doesn't satisfy any particular call site's inferred builder type, widen the constraint (it already mirrors the existing `applyFund<T extends { is: any; not: any }>` pattern in the same file — follow that same loose-typing convention).

- [ ] **Step 12: Verify against dev DB — confirm the exclusion actually filters**

Run this query against dev via the same `Invoke-RestMethod` pattern as Task 1, to confirm there is at least one expense row that Task 10's filter should exclude (sanity check that the feature has real effect, not just that it compiles):

```sql
SELECT count(*) FROM public.expenses
WHERE voided_at IS NULL
  AND NOT (
    approval_status = 'approved'
    AND (payment_mode IN ('Cash','Direct') OR transaction_id IS NOT NULL OR reconciled_at IS NOT NULL)
  );
```

If this returns 0, the filter is a no-op today (still correct, just nothing to visibly verify) — note that in the commit message body; otherwise the count confirms how many expenses reports will now correctly exclude.

- [ ] **Step 13: Commit**

```powershell
git add src/pages/ReportPage.tsx
git commit -m "fix(reports): exclude pending-approval and unreconciled expenses from all reports"
```

---

## Task 11: Apply migration 043 to prod, final build check, push

**Files:** none (deployment step)

- [ ] **Step 1: Full local verification**

```powershell
npx tsc --noEmit
npm run build
```

Expected: both succeed with no errors.

- [ ] **Step 2: Apply migration 043 to prod**

```powershell
$ref = "aulttcsvxzcwyceezzpz"
$sql = [System.IO.File]::ReadAllText("D:\projects\lilac-apartments\supabase\migrations\043_pending_item_quantity.sql", [System.Text.Encoding]::UTF8)
$escaped = $sql -replace '\\', '\\' -replace '"', '\"' -replace "`r", '' -replace "`n", '\n' -replace "`t", '\t'
$body = '{"query":"' + $escaped + '"}'
Invoke-RestMethod -Method POST -Uri "https://api.supabase.com/v1/projects/$ref/database/query" `
  -Headers @{ "Authorization" = "Bearer $env:SUPABASE_ACCESS_TOKEN"; "Content-Type" = "application/json" } `
  -Body $body
```

Expected: `[]` or `null`.

- [ ] **Step 3: Verify prod schema**

Same SELECT as Task 1 Step 3, against the prod ref. Expected three rows.

- [ ] **Step 4: Push to main (Vercel auto-deploys)**

```powershell
git push origin main
```

- [ ] **Step 5: Confirm deployment**

```powershell
git log origin/main -1 --oneline
```

Expected: matches the last local commit.

---

## Self-review summary

- Spec coverage: ✅ — #1 quantity parity → Tasks 1–5; #2 pagination → Task 7; #3 filters → Task 6; #4 badges → Task 8; #5 report exclusion → Tasks 9–10.
- Placeholders: none — every SQL/code block is concrete and copy-pasteable.
- Type consistency: `PendingItem.utility_units/.utility_rate/.unit_label` (Task 2) flow into `PendingItemDialog` (Task 3), `AddExpenseDialog.handlePick` (Task 5), and `bundle_pending_items` (Task 1) consistently as `number | null` / `numeric` / `text`. `applyReportableFilter<T>` (Task 9) is consumed identically at all 8 sites in Task 10, mirroring the existing `applyFund<T>` convention already in `ReportPage.tsx` so no new typing pattern is introduced.
- Migration ordering: schema+RPC applied to dev in Task 1 (needed before Task 3's manual verification reasoning and Task 10's dev sanity check), prod applied last in Task 11 — matches the established convention from `2026-06-24-line-item-followups.md`.
- Scope discipline: period_from/period_to explicitly excluded from pending items per spec; bulk-add attachment support explicitly out of scope; TDS register's `created_at`-based date bucketing is preserved as-is, only gaining the reportable-id filter on top.
- No task requires browser/Playwright testing, per the global constraint — verification is `tsc`, `build`, and direct SQL against dev.
