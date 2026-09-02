# Petty Cash — Linked Reconciliation & Cash-Funded Expenses

**Status:** Draft 2026-09-02
**Author:** Senthil + Claude
**Migration:** `049_petty_cash_linkage.sql`

## Problem

`petty_cash_transactions` already has `expense_id` and `transaction_id` foreign
key columns, but nothing ever populates them. Two real consequences surfaced
while reconciling July/August cash-salary batches:

1. When a bank withdrawal is force-matched against a smaller expense (the
   committee withdraws round numbers like ₹30,000, but only spends ₹28,500 on
   salaries), the leftover is real cash still sitting in the caretaker's hand
   — but the app has no representation of it. It just disappears from the
   books the moment the mismatched match is confirmed.
2. Conversely, an expense could in principle cost *more* than any single bank
   withdrawal covers, with the caretaker topping up from cash he's already
   holding (this was suspected of the Sewage Lorry payment — 5 loads at
   ₹2,500 would have meant a ₹2,500 shortfall over its ₹10,000 bank transfer
   — but Eugene confirmed on 2026-09-02 it was actually 4 loads, exactly
   ₹10,000, no shortfall; the concrete example didn't hold up, but the
   scenario itself is real and will recur). Today there's no way to record a
   genuine case of this without either understating the expense or inventing
   a bank transaction that didn't happen.
3. Many small cash expenses (a water can, a one-off supply run) never get
   their own bank transaction at all — they're paid straight out of
   whatever's in the pool from an earlier withdrawal. `payment_mode = Cash`
   already exists and is already excluded from reconciliation, but doesn't
   touch the pool balance in any way.
4. `petty_cash_transactions` has no audit trigger (unlike `expenses`) and no
   RLS at all (unlike every other financial table) — both gaps predate this
   feature but block it from being a trustworthy record.

## Scope

- **In scope:** Linking Petty Cash entries to the expense/transaction that
  caused them; posting reconciliation surplus/deficit to the pool (explicit,
  not automatic); Cash-mode expenses drawing from and validated against the
  pool; audit trigger + RLS parity for `petty_cash_transactions`; Petty Cash
  balance surfaced on Balance Sheet, Cashbook, R&P Statement, and the
  Dashboard; pagination + export on the Petty Cash tab; one-time manual
  backfill of the actual July–August cash flow, including the Sewage Lorry
  correction.
- **Out of scope:** DB-level (trigger-based) balance-can't-go-negative
  enforcement — app-level validation only. Petty Cash visibility on
  Expenditure/Monthly/Flat/Aging/Utility reports (they're category/flat
  rollups, unaffected by funding source). Per-row running balance display in
  the Petty Cash ledger (only a single current total, as today). Any change
  to Pending Items or bulk-add flows. Sub-bucket provenance tracking (e.g.
  "which ₹1,000 of this disbursement came from which prior withdrawal") — the
  pool is one fungible running balance, standard imprest-accounting style.

## Data model

### Migration `049_petty_cash_linkage.sql`

```sql
-- 1. Audit trail parity with every other financial table
CREATE TRIGGER trg_audit_petty_cash
  AFTER INSERT OR UPDATE OR DELETE ON public.petty_cash_transactions
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- 2. RLS parity with expenses (currently RLS is OFF on this table — a gap
--    predating this feature, closed here since we're touching the table)
ALTER TABLE public.petty_cash_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY petty_cash_admin_write ON public.petty_cash_transactions
  FOR ALL
  USING (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');

CREATE POLICY petty_cash_select ON public.petty_cash_transactions
  FOR SELECT
  USING (get_my_role() = ANY (ARRAY['admin', 'committee', 'auditor']));

-- 3. Point-in-time balance, mirroring fn_bank_balance_as_of
CREATE OR REPLACE FUNCTION public.fn_petty_cash_balance_as_of(p_date date)
RETURNS bigint
LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT COALESCE(
    SUM(CASE WHEN txn_type = 'Disbursement' THEN -amount ELSE amount END),
    0
  )::bigint
  FROM petty_cash_transactions
  WHERE txn_date <= p_date;
$$;
```

No new columns — `expense_id` and `transaction_id` already exist on
`petty_cash_transactions` and are simply populated going forward.

## Balance validation rule (used everywhere below)

Any action that would draw the pool below zero is **hard-blocked**, no
override — matching the "no assumptions" requirement. Validation is against
the ledger's **total running balance** (sum of all entries, same computation
the Petty Cash tab already uses today), not a strict per-date balance —
entries are assumed to be recorded in reasonable chronological order, and the
app doesn't attempt to model same-day ordering precision that the source
paper records don't carry either.

## UI changes

### Petty Cash tab (`ExpensesPage.tsx`)

- **Linked entries show their source.** A row with `expense_id` set resolves
  and displays the expense's voucher + description (e.g. "→ EXP-2026-0032 ·
  Sewage Lorry") instead of/alongside its notes. A row with `transaction_id`
  set shows the bank transaction's reference. Manual entries (Opening, or any
  future manual top-up) keep today's plain free-text notes — nothing about
  manual entry changes.
- **Pagination + export**, reusing the exact pattern already in the Day Book
  (`pageSize` state defaulting to 25, page-size selector, prev/next, "Showing
  X–Y of Z") and its CSV export function, applied to the Petty Cash list.

### Reconcile tab — post the diff (`ExpensesPage.tsx`, `ReconcileTab`)

- After a mismatched force-match is confirmed, an inline follow-up appears:
  surplus → *"₹1,500 surplus — Post to Petty Cash?"*; deficit → *"₹2,500
  shortfall — Post disbursement from Petty Cash?"*. Amount is the actual
  diff, not editable. One click posts a `Replenishment` (surplus, linked via
  `transaction_id`) or `Disbursement` (deficit, linked via `expense_id`,
  subject to the hard-block balance rule). Skipping it is fine — matching
  never depends on posting.
- **Same affordance on already-reconciled expenses** (Day Book row / expense
  detail), not just live at match time — this is how the three expenses
  reconciled yesterday (before this feature existed) get their diffs posted
  retroactively. Shown whenever: `transaction_id IS NOT NULL`, the linked
  transaction's amount differs from the expense amount, and no
  `petty_cash_transactions` row already references that `expense_id` (to
  prevent double-posting). Once posted, the affordance is replaced by a
  small "✓ Posted to Petty Cash" indicator.

### Add/Edit Expense — Cash mode draws from the pool (`ExpensesPage.tsx`, `AddExpenseDialog`)

- Selecting `Payment mode = Cash` shows the current pool balance inline
  (e.g. *"Available in Petty Cash: ₹6,583"*).
- On save, if `amount > current balance`: blocked, inline error, no override.
- On successful save: a `Disbursement` row is created, linked via
  `expense_id`, `transaction_id` left null, `txn_date = expense_date`, notes
  auto-generated (`"Auto: <voucher_no> · <description>"`).
- **Editing** a Cash expense's amount: the old linked disbursement (if any)
  is deleted, the new amount is validated against the balance (which already
  reflects that deletion), and a new linked disbursement is inserted — same
  hard-block rule as create.
- **Changing payment mode away from Cash** on edit: the linked disbursement
  is deleted (reverses the draw). **Changing payment mode to Cash**: same as
  a fresh create.
- **Voiding** any expense that has a linked `petty_cash_transactions` row
  (Cash-mode auto-disbursement, or a manually-posted Reconcile diff) deletes
  that row, restoring the balance. The new audit trigger records the
  deletion in `audit_log`, so nothing about the reversal is silent.
- Nothing changes in Pending Items or bulk-add — this only touches the
  header `payment_mode` field in the single-expense Add/Edit dialog.

### Reports (`ReportPage.tsx`)

- **Balance Sheet** (`BalanceSheetTab`): add a **Cash in Hand** asset line,
  sourced from `fn_petty_cash_balance_as_of(selectedFy.end)`. `totalAssets`
  becomes `bankBalance + fdTotal + corpColl + cashInHand`. The AGM PDF bundle
  reuses `BalanceSheetDoc`, so this fix carries through automatically — no
  separate AGM-specific change.
- **Cashbook** (`CashbookTab`) and **R&P Statement** (`RPStatementTab`): add
  the Petty Cash opening/closing balance for the selected period (via
  `fn_petty_cash_balance_as_of` at the same `prevEnd`/`end` boundaries already
  used for the bank figures), shown as a compact addendum — not a full
  parallel CR/DR splitup table.
- Expenditure, Monthly, Flat, Aging, Utility: untouched (out of scope, see
  above).

### Dashboard (`DashboardPage.tsx`)

- A small **"Cash in Hand: ₹X"** note beside/under the existing "Net
  Available Cash" card. Not folded into that figure (it means "bank balance
  by fund" today and should keep meaning exactly that) and not a full-size
  KPI card (the pool will sit in the low thousands next to lakhs of
  Maintenance/Corpus — a same-size card would overstate it). Balance fetched
  the same lightweight way the Petty Cash tab already computes it (client-side
  sum over all entries), not the date-scoped RPC, since the dashboard wants
  "right now."

## Data correction & backfill (manual, post-ship, done through the new UI)

Not part of the migration — a checklist to work through once the feature
ships, using the UI it adds:

1. **Opening entry:** ₹3,783, dated **2026-07-04** (one day before the first
   known movement, so it sorts distinctly first — the date is a "brought
   forward" label, not a claim about when that balance actually formed,
   since that's before any record we have). Amount is exact:
   ₹33,783 (recorded "total available in hand") − ₹30,000 (the 05-Jul
   withdrawal) = ₹3,783.
2. Post the **₹1,500 surplus** on EXP-2026-0029 (Jul salary batch) via the
   new "Post to Petty Cash" affordance → Replenishment linked to its
   transaction. Running balance: 3,783 + 1,500 = **5,283** — matches the
   paper sheet's own "B/F Rs.5283" figure exactly.
3. Post the **₹1,300 surplus** on EXP-2026-0030 (Aug salary batch) →
   Replenishment. Running balance: 5,283 + 1,300 = **6,583** — matches the
   paper sheet's own final "Balance Available" figure exactly.

**Expected balance after these three steps: ₹6,583**, matching the paper
sheet throughout. Steps 2–3 don't depend on the Sewage Lorry question below
and can be done as soon as the feature ships.

### Sewage Lorry — resolved, confirmed with Eugene (2026-09-02)

**Confirmed: 4 loads, not 5** — ₹10,000 total (4 × ₹2,500), matching the
₹10,000 bank transfer exactly. The original photographed sheet's "5" was a
miscount. **No correction needed:** EXP-2026-0032 stays exactly as originally
entered (₹10,000, exact match, no diff), and gets no Petty Cash entry — there
was never a shortfall to fund from the float.

## Migration & deploy

1. Apply `049_petty_cash_linkage.sql` to dev, smoke-test the new RLS
   policies don't break existing Petty Cash reads/writes for admin.
2. Apply to prod.
3. Deploy frontend.
4. Run the Opening + two Replenishment backfill steps against prod. No
   separate Sewage Lorry step — resolved, no correction needed.

## Acceptance

- Reconciling a mismatched pair offers to post the diff; declining leaves the
  match intact with nothing posted.
- The same offer appears on an already-reconciled expense with an unposted
  diff, and disappears (replaced by a posted indicator) once used.
- A Cash-mode expense exceeding the current pool balance cannot be saved;
  one within balance saves and visibly reduces the pool.
- Editing a Cash expense's amount, or switching its payment mode in either
  direction, keeps the pool's linked entry (or absence of one) correct.
- Voiding an expense with a linked pool entry restores the balance and is
  visible in `audit_log`.
- Petty Cash tab: entries show their linked expense/transaction where
  present; list paginates and exports like the Day Book.
- Balance Sheet's total assets include Cash in Hand; Cashbook and R&P
  Statement show the period's Petty Cash opening/closing balance; Dashboard
  shows a compact Cash in Hand figure.
- After the Opening + two Replenishment backfill steps: Petty Cash balance
  reads ₹6,583, with three entries, each traceable to the expense/transaction
  that produced it (or, for Opening, clearly labeled as brought forward).
  EXP-2026-0032 (Sewage Lorry) needs no entry — confirmed exact match,
  no shortfall.
