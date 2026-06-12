# Pending Line Items → Bundled Expense

**Status:** Approved 2026-06-12
**Author:** Senthil + Claude
**Migration:** `032_pending_line_items.sql`

## Problem

The treasurer makes many small payments throughout the month — petty cash disbursements, UPI to staff, small online vendor payments. Today, recording each one as a separate `expenses` row clutters the day book and inflates the voucher counter. The treasurer wants to:

1. Capture each payment as it happens, with full detail (date, payee, category, cost centre, amount, mode).
2. Later, manually pick a set of these items and **club them into a single bundled expense** that becomes the reportable record in the day book.

## Scope

- **In scope:** Any small payment — cash, UPI, online, cheque. Manual bundling. Soft-delete of pending items.
- **Out of scope:** CSV import of pending items, auto-bundling rules, per-item bank reconciliation.

## Data model

### New table `pending_line_items`

```sql
CREATE TABLE public.pending_line_items (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  paid_date       date NOT NULL,
  description     text NOT NULL,
  amount          integer NOT NULL CHECK (amount > 0),
  payment_mode    text NOT NULL CHECK (payment_mode IN ('Cash','Online','Bank Transfer','Cheque')),
  reference_no    text,
  -- payee
  payee_type      text NOT NULL CHECK (payee_type IN ('Staff','Vendor','Utility','Municipal','Other')),
  staff_id        uuid REFERENCES public.staff(id),
  vendor_id       uuid REFERENCES public.vendors(id),
  payee_name_raw  text,
  -- classification
  category_id     uuid REFERENCES public.expense_categories(id),
  cost_center     text NOT NULL,
  corpus_plan_id  uuid REFERENCES public.corpus_plans(id),  -- NULL = maintenance
  -- audit & soft-delete
  notes           text,
  created_at      timestamptz DEFAULT now(),
  created_by      uuid REFERENCES public.profiles(id),
  voided_at       timestamptz,
  voided_by       uuid REFERENCES public.profiles(id),
  void_reason     text
);

CREATE INDEX idx_pending_items_date   ON public.pending_line_items(paid_date DESC);
CREATE INDEX idx_pending_items_active ON public.pending_line_items(voided_at) WHERE voided_at IS NULL;

ALTER TABLE public.pending_line_items ENABLE ROW LEVEL SECURITY;
-- policies mirror expenses table (admin write, committee read, auditor read)
```

### Schema change to `expense_line_items`

```sql
ALTER TABLE public.expense_line_items
  ADD COLUMN payment_mode text
  CHECK (payment_mode IS NULL OR payment_mode IN ('Cash','Online','Bank Transfer','Cheque'));

ALTER TABLE public.expense_line_items
  ADD COLUMN reference_no text;
```

Both nullable — existing rows keep NULL; bundled-from-pending rows preserve per-item mode and reference.

### RPC `bundle_pending_items`

Atomic transactional function:

```sql
CREATE FUNCTION public.bundle_pending_items(
  p_ids        uuid[],
  p_header     jsonb         -- { expense_date, description, payment_mode, payee_name_raw }
) RETURNS jsonb              -- { expense_id, voucher_no }
```

Steps inside the function:
1. Validate: all IDs exist, none voided, all share the same `corpus_plan_id` (NULL or same UUID).
2. INSERT into `expenses` (header) — amount = SUM, payee_type='Other', payee_name_raw from header or 'Bundled'.
3. For each pending row: INSERT into `expense_line_items` carrying payee (staff_id / vendor_id / payee_name_raw), category_id, cost_center, amount, description, payment_mode, reference_no.
4. DELETE the pending rows (hard delete — canonical record now lives in `expense_line_items`; audit history is in `audit_log` via existing triggers).
5. Return new `expense_id` + `voucher_no`.

## UI

### Location
New tab **"Pending Items"** on `/expenses` page, alongside Day Book / Petty Cash / Vendors / Staff.

### Tab layout
```
₹3,240 unbundled · 7 items     [+ Quick Add] [Bundle (0)]
─────────────────────────────────────────────────────────
☐ 12 Jun  Sweeper June dues       Salary · Common  ₹500 · Cash
☐ 11 Jun  UPI to plumber          Plumbing · A     ₹800 · UPI
…
```

### Quick Add dialog (mobile-first)
Required: date (default today), description, amount, category, cost_center, payment_mode (default Cash).
Combined "Paid to" autocomplete suggests staff & vendors → fills `staff_id`/`vendor_id`; free text → `payee_name_raw`.
Collapsed optional: reference_no, notes.
On save: toast + dialog resets for rapid entry.

### Selection & Bundle
- Per-row checkboxes; header "select all"; row count + selected total in floating Bundle button.
- Bundle dialog asks: expense_date (default = max paid_date), description (default = "Bundled — N items, DD Mon → DD Mon"), payment_mode (default = most common mode among selected; must be a single valid mode — Cash/Online/Bank Transfer/Cheque), optional payee_name_raw override.
- Summary line: "N items · ₹X → new expense".
- On submit: call RPC; toast voucher number + "View in Day Book →" action.

### Row actions
Edit (prefilled dialog) · Delete (soft-delete with reason; same pattern as expenses).

## Edge cases

| Case | Behaviour |
|---|---|
| Mix of maintenance + corpus items selected | Blocked in Bundle dialog with explanatory message |
| Different `corpus_plan_id`s | Blocked |
| Pending item edited after add | Allowed (it's a draft); audit log captures change |
| Bundled expense voided | Pending items NOT auto-restored; user re-enters if needed (documented) |
| Pending item soft-deleted | Hidden from tab; visible in audit log |
| Pending item never bundled | Stays in tab indefinitely; no expiry |

## Approval & RBAC

- Pending items are treasurer's draft notes — no per-item approval.
- The bundled `expenses` row enters the existing approval flow (`approval_status='pending'` → committee approves in Day Book).
- `canWrite` (admin): add/edit/delete/bundle.
- `committee`: read-only on Pending Items tab; approve on Day Book.
- `auditor`: read-only.

## Reconciliation

The bundled expense reconciles with one bank transaction like any other expense (existing flow). Individual pending items do not reconcile — their `reference_no` is for audit only.

## File-level surface

| File | Change |
|---|---|
| `supabase/migrations/032_pending_line_items.sql` | NEW — table, RPC, RLS, `expense_line_items.payment_mode` column |
| `src/lib/supabase.ts` | NEW `PendingLineItem` interface; extend `ExpenseLineItem` with optional `payment_mode` |
| `src/pages/ExpensesPage.tsx` | NEW `PendingItemsTab`, `PendingItemDialog`, `BundleDialog` components; new tab entry |
| `src/components/HelpButton.tsx` | Add pending-items context to expenses help |

## Deferred / future

- Bulk CSV import of pending items.
- Auto-bundling rules (e.g., weekly digest).
- Linking individual pending items directly to bank txns (one-to-one UPI matching).
- Attachments per pending item (currently bundle-level only).
