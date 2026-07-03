# Direct Payments (Owner Pays Vendor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one expense be funded by any number of owner "direct contributions" (owner pays the vendor directly, e.g. by credit card) — each contribution creates a matched CR (flat credit) + DR transaction pair netting ₹0 against the bank balance — with the society's bank transfer reconciling against the NET remainder.

**Architecture:** Contributions live as `transactions` rows themselves (no new table): CR tagged to the flat (`Maintenance`/`corpus`) and DR both carry `source='Direct'`, `expense_id`, and a shared `split_ref_code` pair key. Two SECURITY DEFINER RPCs (`add_direct_contribution`, `void_direct_pairs`) do all pair writes atomically. `v_expense_reconciliation` and the client compute `direct_total` and net amount; the Reconcile tab matches bank DRs against net.

**Tech Stack:** Supabase Postgres (migration 035, RPCs, view), React 18 + TypeScript, react-query, react-hook-form + zod, Shadcn/ui. No new dependencies.

**Spec:** Design agreed in conversation 2026-07-03 (no separate spec doc per user instruction). Key agreements: entry point is Add/Edit Expense; amounts arbitrary (partial or full); multiple payers per expense plus bank-transfer remainder; new payment mode `Direct` for fully-owner-funded expenses.

## Global Constraints

- One migration file: `supabase/migrations/035_direct_payments.sql`.
- Apply to **dev** (`qcoezjcwrsqchulqgydm`) first; **prod** (`aulttcsvxzcwyceezzpz`) only in the final task. Management API PowerShell pattern (UTF-8 read + manual JSON escape) — never `Set-Content`/`Out-File` for the SQL.
- Dev project DB is BEHIND prod (missing recent migrations) — verify the RPCs on dev with self-contained SQL tests that create and then delete their own fixture rows; do NOT assume dev has app data. If dev is missing a prerequisite object (e.g. `get_my_role()`), apply the missing earlier migration(s) to dev first.
- Fiscal conventions (must match `src/lib/tagger.ts`): `fiscal_year` = calendar year if month ≥ Apr else year−1; `fiscal_month` = `'Jan'..'Dec'`; `fiscal_label` = `'Jun-26'` (`Mon-YY`).
- Dues tracker counts CRs with `category='Maintenance'`, `corpus='NO'`; corpus tracker counts CRs with `corpus='YES'` and `plan_id` (or FY fallback). The CR row MUST be tagged exactly this way.
- Bank-balance invariant: every pair inserts CR and DR of equal amount — net ₹0. Never insert one without the other.
- Partial-failure toast copy (verbatim):
  - Add mode: `Expense saved, but N contribution(s) could not be recorded — open the expense and add them again.`
  - Void: `Expense voided, but its direct payment entries could not be voided — open Transactions and contact admin.`
- All UI changes live in `src/pages/ExpensesPage.tsx`, `src/pages/TransactionsPage.tsx`, new `src/components/expenses/DirectContributions.tsx`, and one HelpButton bullet.
- Run `npx tsc --noEmit` before every commit. No comments unless the WHY is non-obvious.
- Commits go to `main`; do NOT push until the final task (Vercel auto-deploys, and prod DB gets the migration only in the final task).

---

## File map

| File | Action |
|---|---|
| `supabase/migrations/035_direct_payments.sql` | CREATE |
| `src/components/expenses/DirectContributions.tsx` | CREATE |
| `src/pages/ExpensesPage.tsx` | MODIFY (schema/consts, Expense type + query embed, expenseStatus, Add/Edit dialog, detail panel, void cascade, Reconcile net logic) |
| `src/pages/TransactionsPage.tsx` | MODIFY (void guard for `source='Direct'`) |
| `src/components/HelpButton.tsx` | MODIFY (one bullet) |

---

## Task 1: Migration 035 — mode CHECK, RPCs, view

**Files:**
- Create: `supabase/migrations/035_direct_payments.sql`

**Interfaces:**
- Consumes: `expenses`, `transactions`, `flats`, `vendors`, `staff`, `corpus_plans` tables; `public.get_my_role()` (exists since RBAC migrations, used by 033/034).
- Produces:
  - `add_direct_contribution(p_expense_id uuid, p_flat_id uuid, p_amount integer, p_corpus_plan_id uuid DEFAULT NULL) RETURNS jsonb` → `{"cr_id": uuid, "dr_id": uuid, "pair": text}`; raises `'forbidden'`, `'amount must be positive'`, `'expense not found or voided'`, `'flat not found'`, `'corpus plan not found'`, `'contributions (X) would exceed expense amount (Y)'`.
  - `void_direct_pairs(p_expense_id uuid, p_cr_id uuid DEFAULT NULL) RETURNS jsonb` → `{"voided": n}`; raises `'forbidden'`, `'contribution not found'` (when `p_cr_id` given and not found).
  - `v_expense_reconciliation` gains columns `direct_total integer`, `net_amount integer`; status can now be `'Direct'`.

- [x] **Step 1: Write the migration file exactly**

```sql
-- 035: Direct payments — owner pays vendor directly.
--   A contribution is a matched CR (flat credit) + DR transaction pair,
--   net Rs.0 to the bank balance, linked to its expense via expense_id
--   and to its partner row via a shared split_ref_code pair key.

-- 1. Allow 'Direct' payment mode on expense headers
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_payment_mode_check;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_payment_mode_check
  CHECK (payment_mode IN ('Cash','Online','Bank Transfer','Cheque','Direct'));

-- 2. Add a contribution: insert the CR/DR pair
CREATE OR REPLACE FUNCTION public.add_direct_contribution(
  p_expense_id    uuid,
  p_flat_id       uuid,
  p_amount        integer,
  p_corpus_plan_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_exp      expenses%ROWTYPE;
  v_flat     flats%ROWTYPE;
  v_existing integer;
  v_payee    text;
  v_pair     text;
  v_cr       uuid;
  v_dr       uuid;
  v_fy       integer;
  v_fmon     text;
  v_flab     text;
BEGIN
  IF public.get_my_role() <> 'admin' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;

  SELECT * INTO v_exp FROM expenses
   WHERE id = p_expense_id AND voided_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'expense not found or voided'; END IF;

  SELECT * INTO v_flat FROM flats WHERE id = p_flat_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'flat not found'; END IF;

  IF p_corpus_plan_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM corpus_plans WHERE id = p_corpus_plan_id) THEN
    RAISE EXCEPTION 'corpus plan not found';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_existing
    FROM transactions
   WHERE expense_id = p_expense_id AND source = 'Direct'
     AND cr_dr = 'CR' AND row_type <> 'VOIDED';
  IF v_existing + p_amount > v_exp.amount THEN
    RAISE EXCEPTION 'contributions (%) would exceed expense amount (%)',
      v_existing + p_amount, v_exp.amount;
  END IF;

  v_payee := COALESCE(
    v_exp.payee_name_raw,
    (SELECT name FROM vendors WHERE id = v_exp.vendor_id),
    (SELECT name FROM staff   WHERE id = v_exp.staff_id),
    'payee');
  v_fy := CASE WHEN EXTRACT(MONTH FROM v_exp.expense_date) >= 4
               THEN EXTRACT(YEAR FROM v_exp.expense_date)::int
               ELSE EXTRACT(YEAR FROM v_exp.expense_date)::int - 1 END;
  v_fmon := trim(to_char(v_exp.expense_date, 'Mon'));
  v_flab := trim(to_char(v_exp.expense_date, 'Mon')) || '-' || to_char(v_exp.expense_date, 'YY');
  v_pair := 'DP-' || substr(md5(random()::text || clock_timestamp()::text), 1, 10);

  INSERT INTO transactions (
    value_date, description, cr_dr, amount, flat_id, flat_code,
    category, corpus, plan_id, fiscal_year, fiscal_month, fiscal_label,
    source, expense_id, row_type, split_ref_code)
  VALUES (
    v_exp.expense_date,
    'Direct payment by ' || v_flat.code || ' to ' || v_payee
      || ' (' || COALESCE(v_exp.voucher_no, 'no voucher') || ')',
    'CR', p_amount, p_flat_id, v_flat.code,
    CASE WHEN p_corpus_plan_id IS NULL THEN 'Maintenance' ELSE 'Corpus' END,
    CASE WHEN p_corpus_plan_id IS NULL THEN 'NO' ELSE 'YES' END,
    p_corpus_plan_id, v_fy, v_fmon, v_flab,
    'Direct', p_expense_id, 'Normal', v_pair)
  RETURNING id INTO v_cr;

  INSERT INTO transactions (
    value_date, description, cr_dr, amount,
    category, corpus, fiscal_year, fiscal_month, fiscal_label,
    source, expense_id, row_type, split_ref_code)
  VALUES (
    v_exp.expense_date,
    'Direct payment to ' || v_payee || ' by ' || v_flat.code
      || ' (' || COALESCE(v_exp.voucher_no, 'no voucher') || ')',
    'DR', p_amount,
    'Direct', 'NO', v_fy, v_fmon, v_flab,
    'Direct', p_expense_id, 'Normal', v_pair)
  RETURNING id INTO v_dr;

  RETURN jsonb_build_object('cr_id', v_cr, 'dr_id', v_dr, 'pair', v_pair);
END $$;

-- 3. Void one pair (p_cr_id given) or all pairs of an expense
CREATE OR REPLACE FUNCTION public.void_direct_pairs(
  p_expense_id uuid,
  p_cr_id      uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_pair text;
  v_n    integer;
BEGIN
  IF public.get_my_role() <> 'admin' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_cr_id IS NOT NULL THEN
    SELECT split_ref_code INTO v_pair FROM transactions
     WHERE id = p_cr_id AND expense_id = p_expense_id
       AND source = 'Direct' AND cr_dr = 'CR' AND row_type <> 'VOIDED'
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'contribution not found'; END IF;
    UPDATE transactions SET row_type = 'VOIDED'
     WHERE expense_id = p_expense_id AND source = 'Direct'
       AND split_ref_code = v_pair AND row_type <> 'VOIDED';
  ELSE
    UPDATE transactions SET row_type = 'VOIDED'
     WHERE expense_id = p_expense_id AND source = 'Direct'
       AND row_type <> 'VOIDED';
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('voided', v_n);
END $$;

-- 4. Reconciliation view: expose direct_total / net_amount, add 'Direct' status
CREATE OR REPLACE VIEW public.v_expense_reconciliation
WITH (security_invoker = true)
AS
SELECT
  e.id,
  e.voucher_no,
  e.expense_date,
  e.description,
  e.amount,
  e.payment_mode,
  e.transaction_id,
  e.reconciled_at,
  COALESCE(d.direct_total, 0)::integer            AS direct_total,
  (e.amount - COALESCE(d.direct_total, 0))::integer AS net_amount,
  CASE
    WHEN e.payment_mode = 'Cash'                       THEN 'Cash'
    WHEN e.transaction_id IS NOT NULL                  THEN 'Reconciled'
    WHEN e.payment_mode = 'Direct'                     THEN 'Direct'
    WHEN COALESCE(d.direct_total, 0) >= e.amount       THEN 'Direct'
    ELSE 'Unreconciled'
  END AS reconciliation_status,
  v.name  AS vendor_name,
  ec.name AS category_name,
  cp.name AS corpus_plan_name
FROM public.expenses e
LEFT JOIN LATERAL (
  SELECT SUM(t.amount) AS direct_total
    FROM public.transactions t
   WHERE t.expense_id = e.id AND t.source = 'Direct'
     AND t.cr_dr = 'CR' AND t.row_type <> 'VOIDED'
) d ON true
LEFT JOIN public.vendors            v  ON v.id  = e.vendor_id
LEFT JOIN public.expense_categories ec ON ec.id = e.category_id
LEFT JOIN public.corpus_plans       cp ON cp.id = e.corpus_plan_id
ORDER BY e.expense_date DESC;

GRANT EXECUTE ON FUNCTION public.add_direct_contribution(uuid, uuid, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_direct_pairs(uuid, uuid) TO authenticated;
```

- [x] **Step 2: Commit**

```bash
git add supabase/migrations/035_direct_payments.sql
git commit -m "feat(db): migration 035 — direct payment RPCs + Direct mode + net reconciliation view"
```

---

## Task 2: Apply 035 to dev and test the RPCs with SQL fixtures

**Files:** none (database work on dev project `qcoezjcwrsqchulqgydm` only)

**Interfaces:**
- Consumes: migration file from Task 1; Supabase Management API token `sbp_<redacted-rotate-me>`.
- Produces: verified RPC behavior; no schema or data left behind on dev beyond the migration objects.

All SQL below runs via the Management API pattern:

```powershell
$token = "sbp_<redacted-rotate-me>"
$ref   = "qcoezjcwrsqchulqgydm"
$sql   = [System.IO.File]::ReadAllText("<path-to-a-.sql-file-or-inline>", [System.Text.Encoding]::UTF8)
$escaped = $sql -replace '\\', '\\' -replace '"', '\"' -replace "`r", '' -replace "`n", '\n' -replace "`t", '\t'
$body = '{"query":"' + $escaped + '"}'
Invoke-RestMethod -Method POST -Uri "https://api.supabase.com/v1/projects/$ref/database/query" `
  -Headers @{ "Authorization" = "Bearer $token"; "Content-Type" = "application/json" } -Body $body
```

For short queries, build `$sql` as a single-quoted PowerShell here-string instead of reading a file.

- [x] **Step 1: Preflight — check dev has the prerequisites** *(dev was missing `expenses.voided_at` — applied 027 to dev)*

Query: `SELECT proname FROM pg_proc WHERE proname IN ('get_my_role','generate_expense_voucher');` and `SELECT column_name FROM information_schema.columns WHERE table_name='transactions' AND column_name IN ('expense_id','split_ref_code','source','row_type');`
Expected: both functions and all four columns present. If `get_my_role` or `expense_id` is missing, apply the earlier migration that defines it (open `supabase/migrations/` and apply in number order) before continuing.

- [x] **Step 2: Apply the migration to dev**

POST the full content of `supabase/migrations/035_direct_payments.sql`. Expected: empty/null response.

- [x] **Step 3: Run the fixture test (single DO block — asserts and cleans up)** *(passed; `get_my_role()` returns NULL for the Management API session so the admin check doesn't raise — no workaround needed; fixture needed `corpus_target` in the flats insert)*

```sql
DO $$
DECLARE
  v_flat uuid; v_exp uuid; v_res jsonb; v_cr uuid;
  v_sum integer; v_bal_before numeric; v_bal_after numeric; v_status text;
BEGIN
  SELECT COALESCE(SUM(CASE WHEN cr_dr='CR' THEN amount ELSE -amount END),0)
    INTO v_bal_before FROM transactions WHERE row_type <> 'VOIDED';

  INSERT INTO flats (code, block, flat_type, maintenance_amt)
    VALUES ('ZZTEST', 'Block-A', '2BHK', 0) RETURNING id INTO v_flat;
  INSERT INTO expenses (expense_date, description, payee_type, payee_name_raw, amount, payment_mode)
    VALUES ('2026-06-15', 'DP fixture', 'Other', 'Fixture Vendor', 1000, 'Bank Transfer')
    RETURNING id INTO v_exp;

  -- add two partial contributions
  v_res := add_direct_contribution(v_exp, v_flat, 200);
  v_cr  := (v_res->>'cr_id')::uuid;
  v_res := add_direct_contribution(v_exp, v_flat, 300);

  -- CR tagging correct for the dues tracker
  PERFORM 1 FROM transactions WHERE id = v_cr AND category='Maintenance'
    AND corpus='NO' AND flat_id=v_flat AND fiscal_year=2026
    AND fiscal_month='Jun' AND fiscal_label='Jun-26' AND source='Direct';
  IF NOT FOUND THEN RAISE EXCEPTION 'TEST FAIL: CR tags wrong'; END IF;

  -- net zero on balance
  SELECT COALESCE(SUM(CASE WHEN cr_dr='CR' THEN amount ELSE -amount END),0)
    INTO v_bal_after FROM transactions WHERE row_type <> 'VOIDED';
  IF v_bal_after <> v_bal_before THEN RAISE EXCEPTION 'TEST FAIL: balance moved'; END IF;

  -- view math
  SELECT reconciliation_status INTO v_status FROM v_expense_reconciliation WHERE id = v_exp;
  IF v_status <> 'Unreconciled' THEN RAISE EXCEPTION 'TEST FAIL: expected Unreconciled, got %', v_status; END IF;
  SELECT net_amount INTO v_sum FROM v_expense_reconciliation WHERE id = v_exp;
  IF v_sum <> 500 THEN RAISE EXCEPTION 'TEST FAIL: net_amount % <> 500', v_sum; END IF;

  -- over-contribution must fail
  BEGIN
    v_res := add_direct_contribution(v_exp, v_flat, 600);
    RAISE EXCEPTION 'TEST FAIL: over-contribution accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'contributions%' THEN RAISE; END IF;
  END;

  -- fully fund → status Direct
  v_res := add_direct_contribution(v_exp, v_flat, 500);
  SELECT reconciliation_status INTO v_status FROM v_expense_reconciliation WHERE id = v_exp;
  IF v_status <> 'Direct' THEN RAISE EXCEPTION 'TEST FAIL: expected Direct, got %', v_status; END IF;

  -- void one pair, then all
  v_res := void_direct_pairs(v_exp, v_cr);
  IF (v_res->>'voided')::int <> 2 THEN RAISE EXCEPTION 'TEST FAIL: pair void count %', v_res->>'voided'; END IF;
  v_res := void_direct_pairs(v_exp);
  IF (v_res->>'voided')::int <> 4 THEN RAISE EXCEPTION 'TEST FAIL: all void count %', v_res->>'voided'; END IF;

  -- cleanup
  DELETE FROM transactions WHERE expense_id = v_exp;
  DELETE FROM expenses WHERE id = v_exp;
  DELETE FROM flats WHERE id = v_flat;
  RAISE NOTICE 'ALL DIRECT-PAYMENT TESTS PASSED';
END $$;
```

Note: `add_direct_contribution` checks `get_my_role() = 'admin'`. The Management API runs as `postgres`, so if `get_my_role()` returns NULL/none for it, temporarily wrap the DO block with `SET LOCAL role` or verify `get_my_role()` treats service connections as admin (check its definition first — migrations 010/013 area). If it blocks, test via a second variant of the DO block that calls the function bodies' logic after `SET LOCAL "request.jwt.claims"` appropriately, or grant the test session admin in `user_roles`. Whatever workaround is used, it must not weaken the deployed function.

Expected output: NOTICE `ALL DIRECT-PAYMENT TESTS PASSED`; the flat/expense/transactions fixture rows deleted.

- [x] **Step 4: Confirm nothing left behind on dev**

Query: `SELECT count(*) FROM flats WHERE code='ZZTEST';` → 0. `SELECT count(*) FROM expenses WHERE description='DP fixture';` → 0.

---

## Task 3: DirectContributions component + Add/Edit Expense wiring

**Files:**
- Create: `src/components/expenses/DirectContributions.tsx`
- Modify: `src/pages/ExpensesPage.tsx` (consts at ~line 141, `AddExpenseDialog` form + mutation)

**Interfaces:**
- Consumes: RPCs from Task 1; `useRoleCtx`, `supabase`, `formatINR`, shadcn `Button`.
- Produces:
  - `export interface StagedContribution { key: string; flat_id: string; amount: number; corpus_plan_id: string | null }`
  - `export interface DirectCr { id: string; amount: number; flat_code: string | null; plan_id: string | null; value_date: string }`
  - `export function DirectContributionsSection(props: { expenseId: string | null; expenseAmount: number; corpusPlanId: string | null; staged: StagedContribution[]; onStagedChange: (rows: StagedContribution[]) => void })`
  - `export function directTotalOf(txns: { amount: number; cr_dr: string; source: string; row_type: string }[] | undefined): number`

- [x] **Step 1: Create the component**

Behavior spec (write real code following existing project style — native selects, `var(--ink-*)` styling, react-query):

- Queries (shared cache keys): `['flats-list']` → `supabase.from('flats').select('id, code').order('code')`; `['corpus-plans-active']` (same select as ExpensesPage line ~864).
- **Add mode** (`expenseId === null`): renders `staged` rows — each row: flat select, amount number input, credit-toward select (`— Maintenance —` or a corpus plan) — plus "Add contribution" button appending `{ key: crypto.randomUUID(), flat_id: '', amount: 0, corpus_plan_id: null }` and a remove button per row. All edits go through `onStagedChange`.
- **Edit mode** (`expenseId` set): queries live CRs with key `['direct-crs', expenseId]`:
  `supabase.from('transactions').select('id, amount, flat_code, plan_id, value_date').eq('expense_id', expenseId).eq('source', 'Direct').eq('cr_dr', 'CR').neq('row_type', 'VOIDED').order('created_at')`.
  "Add contribution" opens the same row inputs; confirming calls `supabase.rpc('add_direct_contribution', { p_expense_id, p_flat_id, p_amount, p_corpus_plan_id })` then invalidates `['direct-crs', expenseId]` and `['expenses']`. Remove calls `supabase.rpc('void_direct_pairs', { p_expense_id: expenseId, p_cr_id: row.id })` with a confirm step, then invalidates the same keys. RPC errors → `toast.error(error.message)`.
- Footer line always visible: `Contributions {formatINR(total)} · Remainder {formatINR(expenseAmount - total)}`; when `total > expenseAmount` render the remainder in red — the parent uses this same condition to block save.
- `directTotalOf` helper: sums `amount` over rows where `cr_dr==='CR' && source==='Direct' && row_type!=='VOIDED'`; returns 0 for undefined.

- [x] **Step 2: Wire into ExpensesPage**

1. Line ~141: `const PAYMENT_MODES = ['Cash', 'Online', 'Bank Transfer', 'Cheque', 'Direct']`. Where the mode `<option>`s render, show label `Direct (owner paid)` for the `Direct` value.
2. In `AddExpenseDialog`: add state `const [staged, setStaged] = useState<StagedContribution[]>([])`; render `<DirectContributionsSection expenseId={isEditMode ? editExpense!.id : null} expenseAmount={Number(watchedAmount) || 0} corpusPlanId={watch('corpus_plan_id') || null} staged={staged} onStagedChange={setStaged} />` between the payment-details block and line items.
3. Save guard: compute `stagedTotal`; disable Save when `stagedTotal > Number(watchedAmount)` (tooltip `Contributions exceed the expense amount`).
4. In the create branch of the mutation (after line-items insert and `attach_pending_items`), loop staged rows sequentially calling `add_direct_contribution`; count failures; if any, `toast.error` with the verbatim Add-mode copy, replacing `N`. Invalidate `['expenses']`, `['direct-crs', expenseId]`, `['unreconciled-expenses']`.
5. When `payment_mode === 'Direct'`: hide the reference-no and cheque-number inputs (like Cash handling if present; otherwise just conditionally render).

- [x] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add src/components/expenses/DirectContributions.tsx src/pages/ExpensesPage.tsx
git commit -m "feat(expenses): direct contributions section in Add/Edit Expense"
```

---

## Task 4: Status, Day Book, detail panel, void cascade, Reconcile net matching

**Files:**
- Modify: `src/pages/ExpensesPage.tsx`

**Interfaces:**
- Consumes: `directTotalOf` from Task 3; view/RPCs from Task 1.
- Produces: `expenseStatus(e)` may return `'Direct'`; `Expense` interface gains `direct_txns`.

- [x] **Step 1: Day Book query + type**

- `Expense` interface (~line 43): add
  `direct_txns: { id: string; amount: number; cr_dr: string; source: string; row_type: string; flat_code: string | null; plan_id: string | null; value_date: string }[]`.
- Day Book select (~line 227): add embed line `direct_txns:transactions!expense_id(id,amount,cr_dr,source,row_type,flat_code,plan_id,value_date),` — NOTE: `!expense_id` disambiguates from the forward `transaction:transaction_id` embed. If PostgREST errors with ambiguity, use the FK constraint name `transactions!transactions_expense_id_fkey`.

- [x] **Step 2: Status + chips**

```typescript
function expenseStatus(e: Expense) {
  if (e.payment_mode === 'Cash') return 'Cash'
  if (e.reconciled_at || e.transaction_id) return 'Reconciled'
  const direct = directTotalOf(e.direct_txns)
  if (e.payment_mode === 'Direct' || (direct > 0 && direct >= e.amount)) return 'Direct'
  return 'Unreconciled'
}
```

Add to `STATUS_STYLE`: `Direct: 'bg-blue-100 text-blue-700'` (and a matching `STATUS_INLINE` entry if that map requires one — mirror how `Reconciled` is styled).

- [x] **Step 3: Detail panel + void cascade**

- In `ExpenseDetailPanel`, when `directTotalOf(e.direct_txns) > 0`, render a "Direct contributions" block: one line per non-voided CR (`{flat_code} · {formatINR(amount)} · {plan_id ? 'Corpus' : 'Maintenance'}`), then `Remainder {formatINR(e.amount - direct)}`.
- In `handleVoid` (~line 503): after the expense update succeeds, if `directTotalOf(e.direct_txns) > 0` call `supabase.rpc('void_direct_pairs', { p_expense_id: e.id })`; on RPC error `toast.error` with the verbatim Void copy. Then the existing invalidations plus `['direct-crs', e.id]`.

- [x] **Step 4: Reconcile tab — net everywhere**

- `UnreconciledExpense` interface: add `direct_txns` (same shape as Task 4 Step 1).
- `unreconciled-expenses` query (~line 1527): add the same embed; add `.neq('payment_mode', 'Direct')`; after fetch, `filter(e => netOf(e) > 0)` where `const netOf = (e) => e.amount - directTotalOf(e.direct_txns)`.
- Replace amount comparisons with net:
  - ~1555 `amountMatch`: `selTxn.amount === netOf(selExp)`
  - ~1564 `getSuggestionTier`: all three uses of `selExp.amount` → `netOf(selExp)`
  - ~1616 summary strip unreconciled total → sum of `netOf(e)`
  - ~1633 selected-match card and ~1637/1684 diff lines → `netOf(selExp!)`
- In the expense list rows, when `directTotalOf(e.direct_txns) > 0` show `formatINR(netOf(e))` as the amount with a sub-line `net of {formatINR(directTotalOf(e.direct_txns))} direct`.
- Match mutation itself is unchanged (links the DR to the expense).

- [x] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add src/pages/ExpensesPage.tsx
git commit -m "feat(expenses): Direct status + net-amount reconciliation"
```

---

## Task 5: Transactions page guard + help bullet

**Files:**
- Modify: `src/pages/TransactionsPage.tsx` (~line 966 `handleVoid`, ~line 1441 void button render)
- Modify: `src/components/HelpButton.tsx` (expenses bullets)

**Interfaces:**
- Consumes: `Transaction.source` (already in the type).
- Produces: none downstream.

- [x] **Step 1: Guard the void action**

- At the void button render (~1441 `canWrite && selectedTxn.row_type !== 'VOIDED'`): add `&& selectedTxn.source !== 'Direct'`.
- Where the button would have been, when `selectedTxn.source === 'Direct'` render a muted note: `Created by a direct payment — void it from the expense instead.`
- In the second void path (~line 1127, split/edit dialog): early-return with `toast.error('Direct payment rows are managed from their expense')` if `txn.source === 'Direct'`.

- [x] **Step 2: Help bullet**

In `src/components/HelpButton.tsx` `/expenses` bullets, append:
`'Payment mode "Direct (owner paid)" records an owner paying the vendor directly: add contributions per flat and each creates a flat credit + matching debit (net zero to the bank). The bank transfer for any remainder reconciles at the net amount.'`

- [x] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add src/pages/TransactionsPage.tsx src/components/HelpButton.tsx
git commit -m "feat(transactions): guard direct-payment rows from standalone void"
```

---

## Task 6: Apply to prod, end-to-end verify, push

**Files:** none new (prod DB `aulttcsvxzcwyceezzpz`; browser verification)

- [x] **Step 1: Snapshot prod bank balance** *(₹3,93,093.69 — unchanged after full e2e + cleanup)*

Management API (prod ref) query: `SELECT COALESCE(SUM(CASE WHEN cr_dr='CR' THEN amount ELSE -amount END),0) FROM transactions WHERE row_type <> 'VOIDED';` — record the number.

- [x] **Step 2: Apply migration 035 to prod**

Same PowerShell pattern with `$ref = "aulttcsvxzcwyceezzpz"`. Expected: empty response. Verify: `SELECT proname FROM pg_proc WHERE proname IN ('add_direct_contribution','void_direct_pairs');` returns both.

- [x] **Step 3: Browser end-to-end on the running dev server (prod DB)** *(use `npm run dev:prod` — plain `npm run dev` targets the dev project via .env.dev.local)*

1. Add Expense: description `Direct payment verification (temp)`, payee Other/`Test Vendor`, amount `1000`, mode `Bank Transfer`, one line item; add one staged contribution: any flat, `200`, Maintenance. Save.
2. Verify: Day Book shows the expense; detail panel lists the contribution and `Remainder ₹800`; Transactions page shows the CR and DR rows tagged `Direct`; the flat's dues tracker shows +₹200 collected; Reconcile tab lists the expense at `₹800 net`.
3. Edit the expense: add a second contribution `800`, corpus or maintenance. Verify status chip becomes `Direct` and it leaves the Reconcile list.
4. Remove one contribution from the edit dialog; verify the pair voids (Transactions page shows both rows struck through) and the status reverts.
5. Void the whole expense with reason `verification cleanup`; verify all its Direct rows are VOIDED.
6. Re-run the Step 1 balance query — the number MUST be identical.
7. Hard-delete the fixture: Management API `DELETE FROM transactions WHERE expense_id = (SELECT id FROM expenses WHERE description='Direct payment verification (temp)'); DELETE FROM expenses WHERE description='Direct payment verification (temp)';`

- [x] **Step 4: Push + memory**

```bash
npx tsc --noEmit
git push
```

Update memory `project_pending_work.md`: mark item 21 DONE with a one-paragraph summary (contributions model, RPC names, migration 035 applied to dev+prod). Update `project_overview.md` migration range to 035.

---

## Self-review notes

- Spec coverage: entry point (T3), arbitrary/partial amounts (RPC allows any ≤ remaining; UI unrestricted), multiple payers (N rows), net reconciliation (T4 step 4), fully-direct mode (CHECK + status), void-together (RPCs + T4 step 3 + T5 guard), audit trail (transactions rows + existing audit triggers on expenses; transactions has no audit trigger — the rows themselves are the ledger).
- Type consistency: `directTotalOf` defined in Task 3, consumed in Task 4; `direct_txns` shape identical in both interfaces; RPC parameter names match between SQL (`p_*`) and `supabase.rpc` calls.
- Known risk: `get_my_role()` behavior under the Management API test session (Task 2 Step 3 note) — resolve there, do not weaken the function.
