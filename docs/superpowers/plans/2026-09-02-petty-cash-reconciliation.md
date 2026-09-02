# Petty Cash Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing (unused) `expense_id`/`transaction_id` columns on `petty_cash_transactions` into the Reconcile flow and Cash-mode expenses, so cash-in-hand movements are linked, auditable, balance-validated, and visible across reports and the dashboard.

**Architecture:** All application code lives in `src/pages/ExpensesPage.tsx` (Petty Cash tab, Reconcile tab, Add/Edit Expense dialog, Void), `src/pages/ReportPage.tsx` (Balance Sheet, Cashbook, R&P Statement), `src/components/reports/AgmPdfDocs.tsx` (PDF templates), and `src/pages/DashboardPage.tsx`. One new migration adds an audit trigger, RLS policies, and a `fn_petty_cash_balance_as_of` SQL function — no new tables or columns. **This repo has no unit-test framework** (no vitest/jest, no `*.test.ts` files anywhere) — its established QA process, per `CLAUDE.md`, is `npx tsc --noEmit` before every commit plus manual verification in the browser (dev server) and direct SQL checks for DB changes. Every task's verification steps follow that pattern instead of an invented unit-test ritual.

**Tech Stack:** React 18 + TypeScript + Vite, react-hook-form + zod, TanStack Query, Supabase (Postgres + RLS), @react-pdf/renderer, Tailwind, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-09-02-petty-cash-reconciliation-design.md`

## Global Constraints

- No new DB columns — only `petty_cash_transactions`'s existing unused `expense_id`/`transaction_id` get populated.
- Balance validation (Cash-mode expenses, and Disbursement postings from Reconcile) is a **hard block**, no override, computed against the ledger's total running balance (sum of all entries — same computation the Petty Cash tab already uses), not a strict per-date balance.
- Nothing changes in Pending Items or bulk-add flows — only the single-expense Add/Edit dialog's header `payment_mode` field.
- `EXP-2026-0032` (Sewage Lorry) needs no correction — confirmed with Eugene as 4 loads at ₹2,500 (₹10,000 total), an exact match to its linked ₹10,000 bank transfer. Do not touch it; it's the expected "no diff, no Petty Cash entry" example used in Task 4's verification.
- The dev Supabase project (`qcoezjcwrsqchulqgydm`) is currently unreachable this session (connection failures, not in the accessible-projects list for the current token) — a pre-existing issue unrelated to this feature. Apply the migration directly to prod (`aulttcsvxzcwyceezzpz`) via the Management API, per `CLAUDE.md`'s documented fallback for when `supabase db push` can't be trusted. Do not attempt to fix the dev project as part of this plan.
- Every commit uses the trailer:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_014zRuYM4tvB1XTUmm3urSjF
  ```

---

### Task 1: Migration — audit trigger, RLS, balance function

**Files:**
- Create: `supabase/migrations/049_petty_cash_linkage.sql`

**Interfaces:**
- Produces: SQL function `public.fn_petty_cash_balance_as_of(p_date date) RETURNS bigint` — used by Task 7 (Balance Sheet) and Task 8 (Cashbook, R&P Statement).
- Produces: RLS policies `petty_cash_admin_write` (ALL, admin) and `petty_cash_select` (SELECT, admin/committee/auditor) on `petty_cash_transactions` — all later tasks' queries/mutations against this table run under these policies.

- [ ] **Step 1: Write the migration file**

```sql
-- 049_petty_cash_linkage.sql
-- Wires petty_cash_transactions.expense_id/transaction_id (existing, unused
-- columns) into audit + access-control parity with every other financial
-- table, and adds a point-in-time balance function mirroring
-- fn_bank_balance_as_of.

-- 1. Audit trail parity with expenses (trg_audit_expenses uses the same
--    generic fn_audit_trigger — works on any table with an `id` column).
CREATE TRIGGER trg_audit_petty_cash
  AFTER INSERT OR UPDATE OR DELETE ON public.petty_cash_transactions
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- 2. RLS parity with expenses — petty_cash_transactions currently has RLS
--    OFF entirely, unlike every other financial table.
ALTER TABLE public.petty_cash_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY petty_cash_admin_write ON public.petty_cash_transactions
  FOR ALL
  USING (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');

CREATE POLICY petty_cash_select ON public.petty_cash_transactions
  FOR SELECT
  USING (get_my_role() = ANY (ARRAY['admin', 'committee', 'auditor']));

-- 3. Point-in-time balance, mirroring fn_bank_balance_as_of exactly.
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

- [ ] **Step 2: Apply to prod via the Management API**

```bash
TOKEN=$(grep -oP '"SUPABASE_ACCESS_TOKEN":\s*"\K[^"]+' .claude/settings.local.json)
SQL=$(cat supabase/migrations/049_petty_cash_linkage.sql)
curl -s "https://api.supabase.com/v1/projects/aulttcsvxzcwyceezzpz/database/query" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "$(python3 -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))' <<< "$SQL")"
```

Expected: `[]` or a success response, no `"message":"Failed..."` field.

- [ ] **Step 3: Verify the trigger, policies, and function exist**

```bash
curl -s "https://api.supabase.com/v1/projects/aulttcsvxzcwyceezzpz/database/query" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select trigger_name from information_schema.triggers where event_object_table='"'"'petty_cash_transactions'"'"'; select policyname from pg_policies where tablename='"'"'petty_cash_transactions'"'"'; select proname from pg_proc where proname='"'"'fn_petty_cash_balance_as_of'"'"';"}'
```

Expected: `trg_audit_petty_cash`, both policy names, and `fn_petty_cash_balance_as_of` all present.

- [ ] **Step 4: Verify existing Petty Cash reads still work under the new RLS**

In the app (as the admin/"Treasurer" test login), open Expenses → Petty Cash tab. It must still load without error (currently 0 entries is fine — confirms `petty_cash_select` policy resolves correctly for the logged-in role).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/049_petty_cash_linkage.sql
git commit -m "$(cat <<'EOF'
feat(db): audit trigger, RLS, and balance function for petty cash

petty_cash_transactions had no audit trigger and no RLS at all —
both gaps predating this feature. Adds parity with expenses (same
fn_audit_trigger, same admin-write/committee-read policy shape) and
fn_petty_cash_balance_as_of(date), mirroring fn_bank_balance_as_of,
for the report tasks that follow.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014zRuYM4tvB1XTUmm3urSjF
EOF
)"
```

---

### Task 2: Shared balance helper + linked-entry display + pagination/export

**Files:**
- Create: `src/lib/pettyCash.ts`
- Modify: `src/pages/ExpensesPage.tsx:43` (`PettyCashTxn` interface)
- Modify: `src/pages/ExpensesPage.tsx:3118-3208` (`PettyCashTab`)

**Interfaces:**
- Produces: exported function `computePettyCashBalance(txns: {txn_type: string; amount: number}[]): number` in `src/lib/pettyCash.ts` — used by Task 3, Task 4, Task 5 (all within `ExpensesPage.tsx`) and Task 9 (`DashboardPage.tsx`). Kept in its own small lib file (matching the existing `src/lib/tagger.ts`/`src/lib/date.ts` convention) rather than exported from `ExpensesPage.tsx`, so `DashboardPage.tsx` importing it doesn't pull that whole page's module (and its `xlsx`, dialogs, etc.) into the Dashboard's code-split chunk.
- Produces: extended `PettyCashTxn` shape (adds `expense_id`, `transaction_id`, and joined `expense`/`transaction` labels) — no other task consumes this type directly, but Task 3 and Task 4 insert rows with these same column names.

- [ ] **Step 1: Create the shared balance helper**

```tsx
// src/lib/pettyCash.ts
export function computePettyCashBalance(txns: { txn_type: string; amount: number }[]): number {
  return txns.reduce((s, t) => t.txn_type === 'Disbursement' ? s - t.amount : s + t.amount, 0)
}
```

In `ExpensesPage.tsx`, add the import near the top (alongside the other `@/lib/*` imports, e.g. next to `import { formatDateDMY } from '@/lib/date'`):
```tsx
import { computePettyCashBalance } from '@/lib/pettyCash'
```
Then remove the inline balance calculation currently in `PettyCashTab` (line 3134-3136):
```tsx
const balance = txns.reduce((s, t) =>
  t.txn_type === 'Disbursement' ? s - t.amount : s + t.amount, 0
)
```
(replaced in Step 2 below by a call to the imported helper). Next, replace the `PettyCashTxn` interface at line 43:
```tsx
interface PettyCashTxn {
  id: string; txn_date: string; txn_type: string; amount: number; notes: string | null
  expense_id: string | null; transaction_id: string | null
  expense: { voucher_no: string | null; description: string } | null
  transaction: { description: string } | null
}
```

- [ ] **Step 2: Update the Petty Cash query to fetch linked expense/transaction, and use the shared helper**

Replace the `PettyCashTab` query (line 3123-3132) select and the balance line (3134-3136):
```tsx
const { data: txns = [], isLoading } = useQuery({
  queryKey: ['petty-cash'],
  queryFn: async () => {
    const { data } = await supabase
      .from('petty_cash_transactions')
      .select('*, expense:expense_id(voucher_no, description), transaction:transaction_id(description)')
      .order('txn_date', { ascending: false })
    return (data ?? []) as PettyCashTxn[]
  },
})

const balance = computePettyCashBalance(txns)
```

- [ ] **Step 3: Show the link on each row**

In the row render (line 3179-3201), replace the notes line:
```tsx
{t.notes && <span className="text-xs truncate" style={{ color: 'var(--ink-500)' }}>{t.notes}</span>}
```
with:
```tsx
{t.expense ? (
  <span className="text-xs truncate" style={{ color: 'var(--ink-500)' }}>
    → {t.expense.voucher_no ?? 'EXP'} · {t.expense.description}
  </span>
) : t.transaction ? (
  <span className="text-xs truncate" style={{ color: 'var(--ink-500)' }}>
    → {t.transaction.description}
  </span>
) : t.notes ? (
  <span className="text-xs truncate" style={{ color: 'var(--ink-500)' }}>{t.notes}</span>
) : null}
```

- [ ] **Step 4: Add pagination, mirroring the Day Book's exact pattern (lines 320-328, 604-629)**

Inside `PettyCashTab`, add state and derived values right after the `balance` line:
```tsx
const [page, setPage] = useState(1)
const [pageSize, setPageSize] = useState(25)
const totalPages = Math.max(1, Math.ceil(txns.length / pageSize))
const pageSafe = Math.min(page, totalPages)
const pagedTxns = txns.slice((pageSafe - 1) * pageSize, pageSafe * pageSize)
```
Change the row-rendering map (line 3179) from `txns.map(t => ...)` to `pagedTxns.map(t => ...)`. After the closing `</div>` of the row list (line 3202), add the same pager block used in the Day Book (adapt lines 604-629 verbatim, replacing `filteredExpenses`/`pagedExpenses` with `txns`/`pagedTxns`):
```tsx
{txns.length > pageSize && (
  <div className="flex items-center justify-between px-4 py-3 text-xs" style={{ color: 'var(--ink-500)' }}>
    <span>
      Showing {(pageSafe - 1) * pageSize + 1}–{Math.min(pageSafe * pageSize, txns.length)} of {txns.length}
    </span>
    <div className="flex items-center gap-2">
      <select
        value={pageSize}
        onChange={e => { setPageSize(Number(e.target.value)); setPage(1) }}
        className="ds-field !h-7 !py-0 text-xs"
      >
        {[25, 50, 100].map(n => <option key={n} value={n}>{n}/page</option>)}
      </select>
      <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={pageSafe <= 1}>
        <ChevronLeft size={14} />
      </button>
      <span>{pageSafe} / {totalPages}</span>
      <button
        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
        disabled={pageSafe >= totalPages}
      >
        <ChevronRight size={14} />
      </button>
    </div>
  </div>
)}
```
(`ChevronLeft`/`ChevronRight` are already imported at line 8.)

- [ ] **Step 5: Add CSV export, mirroring the Day Book's export shape**

Add a `handleExport` function inside `PettyCashTab`, and an Export button next to "Add Entry" (line 3162-3166):
```tsx
function handleExport() {
  const rows = [
    ['Date', 'Type', 'Amount', 'Linked to', 'Notes'],
    ...txns.map(t => [
      t.txn_date,
      t.txn_type,
      String(t.amount),
      t.expense ? `${t.expense.voucher_no ?? 'EXP'} · ${t.expense.description}` : t.transaction ? t.transaction.description : '',
      t.notes ?? '',
    ]),
  ]
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `Lilac_PettyCash_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
```
Add the button (in the header row, next to `{canWrite && ...Add Entry...}` at line 3162):
```tsx
<Button size="sm" variant="outline" onClick={handleExport} className="flex items-center gap-1.5 mt-1">
  <Download size={14} /> Export
</Button>
```
(`Download` is already imported at line 8.)

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual verification**

Run `npm run dev:prod`, log in, go to Expenses → Petty Cash. Confirm: tab loads with 0 entries (unchanged from before), "Export" button downloads an empty-but-valid CSV (header row only), no console errors.

- [ ] **Step 8: Commit**

```bash
git add src/pages/ExpensesPage.tsx
git commit -m "$(cat <<'EOF'
feat(petty-cash): linked-entry display, pagination, and export

Petty Cash tab now shows what each entry is linked to (once Tasks 3-5
start populating expense_id/transaction_id), reuses the Day Book's
exact pagination pattern, and gets a CSV export. Balance calc is
extracted to computePettyCashBalance() for reuse by the Cash-mode
expense flow and the dashboard.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014zRuYM4tvB1XTUmm3urSjF
EOF
)"
```

---

### Task 3: Reconcile tab — post the diff to Petty Cash

**Files:**
- Modify: `src/pages/ExpensesPage.tsx:1780-2050ish` (`ReconcileTab`)

**Interfaces:**
- Consumes: `computePettyCashBalance` from Task 2.
- Produces: nothing new consumed elsewhere — this is a leaf UI flow.

- [ ] **Step 1: Add state and a balance query to `ReconcileTab`**

Right after the existing `useState` declarations (line 1784-1786):
```tsx
const [postDiffPrompt, setPostDiffPrompt] = useState<{
  expenseId: string; transactionId: string; amount: number; kind: 'Replenishment' | 'Disbursement'
} | null>(null)

const { data: pettyCashBalance = 0 } = useQuery({
  queryKey: ['petty-cash-balance'],
  queryFn: async () => {
    const { data } = await supabase.from('petty_cash_transactions').select('txn_type, amount')
    return computePettyCashBalance(data ?? [])
  },
})
```

- [ ] **Step 2: Capture the diff when a mismatched match succeeds**

Modify `matchMutation`'s `onSuccess` (line 1857-1866). It currently clears selection unconditionally. Capture the diff *before* clearing, using the still-in-scope `selExp`/`selTxn`/`amountMatch`:
```tsx
onSuccess: () => {
  toast.success('Reconciled successfully')
  if (!amountMatch && selExp && selTxn) {
    const diff = selTxn.amount - netOf(selExp)
    setPostDiffPrompt({
      expenseId: selExp.id,
      transactionId: selTxn.id,
      amount: Math.abs(diff),
      kind: diff > 0 ? 'Replenishment' : 'Disbursement',
    })
  }
  qc.invalidateQueries({ queryKey: ['unreconciled-expenses'] })
  qc.invalidateQueries({ queryKey: ['unmatched-bank-drs'] })
  qc.invalidateQueries({ queryKey: ['expenses'] })
  qc.invalidateQueries({ queryKey: ['unreconciled-count'] })
  setSelectedExpenseId(null)
  setSelectedTxnId(null)
  setForceMatchOpen(false)
},
```

- [ ] **Step 3: Add the posting mutation**

Add alongside `matchMutation`:
```tsx
const postDiffMutation = useMutation({
  mutationFn: async () => {
    if (!postDiffPrompt) return
    if (postDiffPrompt.kind === 'Disbursement' && postDiffPrompt.amount > pettyCashBalance) {
      throw new Error(`₹${postDiffPrompt.amount} exceeds the available Petty Cash balance (₹${pettyCashBalance})`)
    }
    const { error } = await supabase.from('petty_cash_transactions').insert({
      txn_date: new Date().toISOString().slice(0, 10),
      txn_type: postDiffPrompt.kind,
      amount: postDiffPrompt.amount,
      expense_id: postDiffPrompt.kind === 'Disbursement' ? postDiffPrompt.expenseId : null,
      transaction_id: postDiffPrompt.kind === 'Replenishment' ? postDiffPrompt.transactionId : null,
      notes: `Auto: reconciliation ${postDiffPrompt.kind === 'Replenishment' ? 'surplus' : 'shortfall'}`,
    })
    if (error) throw error
  },
  onSuccess: () => {
    toast.success(`${postDiffPrompt?.kind} posted to Petty Cash`)
    qc.invalidateQueries({ queryKey: ['petty-cash'] })
    qc.invalidateQueries({ queryKey: ['petty-cash-balance'] })
    setPostDiffPrompt(null)
  },
  onError: (e: any) => toast.error(e.message ?? 'Failed to post to Petty Cash'),
})
```

- [ ] **Step 4: Render the follow-up prompt**

Add right after the `forceMatchOpen` block (after line 1971, before the `selectedTxnId && !selectedExpenseId` block at line 1973):
```tsx
{postDiffPrompt && (
  <div className="rounded-xl p-4 flex items-start gap-3" style={{ background: 'var(--ink-50)', border: '1px solid var(--ink-200)' }}>
    <Coins size={18} className="shrink-0 mt-0.5" style={{ color: 'var(--ink-500)' }} />
    <div className="flex-1 min-w-0">
      <p className="text-sm font-semibold" style={{ color: 'var(--ink-800)' }}>
        {formatINR(postDiffPrompt.amount)} {postDiffPrompt.kind === 'Replenishment' ? 'surplus' : 'shortfall'} — post to Petty Cash?
      </p>
      <p className="text-xs mt-0.5" style={{ color: 'var(--ink-400)' }}>
        {postDiffPrompt.kind === 'Replenishment'
          ? 'Adds the unspent leftover to the cash-in-hand pool.'
          : 'Draws the shortfall from the cash-in-hand pool.'}
      </p>
    </div>
    <div className="flex gap-2 shrink-0">
      <Button size="sm" variant="outline" onClick={() => setPostDiffPrompt(null)}>Skip</Button>
      <Button size="sm" onClick={() => postDiffMutation.mutate()} disabled={postDiffMutation.isPending}>
        {postDiffMutation.isPending ? 'Posting…' : `Post ${formatINR(postDiffPrompt.amount)}`}
      </Button>
    </div>
  </div>
)}
```
(`Coins` is already imported at line 8.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual verification against prod**

Run `npm run dev:prod`. This requires a real mismatched pair to test against — since all of today's real mismatches (EXP-2026-0029, EXP-2026-0030) are already reconciled and won't appear in the *live* Reconcile tab's unreconciled list (that's what Task 4 covers), verify this task's live-match flow using **any** currently-unreconciled expense/DR pair that has a mismatch when force-matched, or temporarily un-reconcile one of today's expenses via its detail panel's "Un-reconcile" action, redo the match through the Reconcile tab, confirm the prompt appears with the correct amount and kind, click "Post", confirm a new row appears in Petty Cash tab linked to the right expense/transaction, then click "Skip" on a second attempt and confirm nothing is posted. Re-reconcile anything you temporarily undid.

- [ ] **Step 7: Commit**

```bash
git add src/pages/ExpensesPage.tsx
git commit -m "$(cat <<'EOF'
feat(reconcile): offer to post the match diff to Petty Cash

After a mismatched force-match, an explicit (not automatic) prompt
offers to post the surplus (Replenishment, linked to the bank
transaction) or shortfall (Disbursement, linked to the expense, hard-
blocked if it would overdraw the pool) to Petty Cash. Skipping leaves
the match untouched.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014zRuYM4tvB1XTUmm3urSjF
EOF
)"
```

---

### Task 4: Retroactive posting on already-reconciled expenses + Day Book badge

**Files:**
- Modify: `src/pages/ExpensesPage.tsx:654-737ish` (`ExpenseDetailPanel`)
- Modify: `src/pages/ExpensesPage.tsx:540-603ish` (Day Book row list)

**Interfaces:**
- Consumes: `Expense.transaction` (already fetched, `{id, value_date, description, amount} | null`), `computePettyCashBalance` from Task 2.
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Fetch existing Petty Cash links once, at the `ExpensesPage` level**

In the main `ExpensesPage` component (where the `expenses` query lives, around line 257), add:
```tsx
const { data: pettyCashLinks = [] } = useQuery({
  queryKey: ['petty-cash-links'],
  queryFn: async () => {
    const { data } = await supabase
      .from('petty_cash_transactions')
      .select('expense_id')
      .not('expense_id', 'is', null)
    return (data ?? []).map(r => r.expense_id as string)
  },
})
const linkedExpenseIds = new Set(pettyCashLinks)
```
Pass `linkedExpenseIds` down as a prop to `ExpenseDetailPanel` (alongside the existing `expense`/`onClose`/`onVoidSuccess` props) and use it in the Day Book row map too.

- [ ] **Step 2: Day Book row badge (passive, linked expenses only)**

In the row badges area (line 580-599), add a badge before the amount when the expense is linked:
```tsx
{linkedExpenseIds.has(e.id) && (
  <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700 flex items-center gap-1">
    <Coins size={10} /> Petty Cash
  </span>
)}
```

- [ ] **Step 3: Detail panel — "Post to Petty Cash" affordance for an unposted diff**

In `ExpenseDetailPanel`, add the diff/eligibility calc and a balance query right after `const isVoided = !!e.voided_at` (line 666):
```tsx
const hasBankMismatchDiff = !!e.transaction && e.transaction.amount !== e.amount
const alreadyLinked = linkedExpenseIds.has(e.id)
const showPostToPettyCash = !isVoided && hasBankMismatchDiff && !alreadyLinked

const { data: pettyCashBalance = 0 } = useQuery({
  queryKey: ['petty-cash-balance'],
  enabled: showPostToPettyCash,
  queryFn: async () => {
    const { data } = await supabase.from('petty_cash_transactions').select('txn_type, amount')
    return computePettyCashBalance(data ?? [])
  },
})

const [postingDiff, setPostingDiff] = useState(false)

async function handlePostDiffToPettyCash() {
  if (!e.transaction) return
  const diff = e.transaction.amount - e.amount
  const kind: 'Replenishment' | 'Disbursement' = diff > 0 ? 'Replenishment' : 'Disbursement'
  const amount = Math.abs(diff)
  if (kind === 'Disbursement' && amount > pettyCashBalance) {
    toast.error(`₹${amount} exceeds the available Petty Cash balance (₹${pettyCashBalance})`)
    return
  }
  setPostingDiff(true)
  const { error } = await supabase.from('petty_cash_transactions').insert({
    txn_date: e.expense_date,
    txn_type: kind,
    amount,
    expense_id: kind === 'Disbursement' ? e.id : null,
    transaction_id: kind === 'Replenishment' ? e.transaction.id : null,
    notes: `Auto: reconciliation ${kind === 'Replenishment' ? 'surplus' : 'shortfall'} (retroactive)`,
  })
  setPostingDiff(false)
  if (error) { toast.error(error.message); return }
  toast.success(`${kind} posted to Petty Cash`)
  qc.invalidateQueries({ queryKey: ['petty-cash'] })
  qc.invalidateQueries({ queryKey: ['petty-cash-balance'] })
  qc.invalidateQueries({ queryKey: ['petty-cash-links'] })
}
```
(`useQuery` and `toast` are already imported in this file; `qc` is already defined in `ExpenseDetailPanel` at line 662.)

- [ ] **Step 4: Render the affordance / posted indicator in the detail panel**

Find the JSX section listing expense metadata (near where `status`/`payeeName` are displayed — locate the block that renders `Reconciled`/voucher/reference info) and add:
```tsx
{alreadyLinked && (
  <p className="text-xs mt-1 flex items-center gap-1" style={{ color: 'var(--ink-500)' }}>
    <Coins size={12} /> Posted to Petty Cash
  </p>
)}
{showPostToPettyCash && (
  <div className="mt-2 flex items-center gap-2">
    <p className="text-xs" style={{ color: 'var(--ink-500)' }}>
      {formatINR(Math.abs(e.transaction!.amount - e.amount))} unposted diff vs. linked bank transaction
    </p>
    {canWrite && (
      <Button size="sm" variant="outline" onClick={handlePostDiffToPettyCash} disabled={postingDiff}>
        {postingDiff ? 'Posting…' : 'Post to Petty Cash'}
      </Button>
    )}
  </div>
)}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual verification against prod — this is the real backfill for two of today's expenses**

Run `npm run dev:prod`. Open EXP-2026-0029 ("Staff salary & upkeep - 05 Jul 2026") detail panel: confirm it shows "₹1,500 unposted diff" and a "Post to Petty Cash" button; click it; confirm success toast, the button is replaced by "Posted to Petty Cash", a Day Book badge appears on that row, and Petty Cash tab now shows a Replenishment entry linked to that expense. Repeat for EXP-2026-0030 ("...04 Aug 2026", ₹1,300). Confirm EXP-2026-0032 (Sewage Lorry, exact match, no diff) shows neither the badge nor the affordance — it has no diff to post. After both: Petty Cash balance should read ₹0 + 1,500 + 1,300 = ₹2,800 (the Opening entry from the backfill checklist hasn't been added yet — that's a manual step outside this plan, per the spec).

- [ ] **Step 7: Commit**

```bash
git add src/pages/ExpensesPage.tsx
git commit -m "$(cat <<'EOF'
feat(expenses): retroactive Petty Cash posting + Day Book link badge

An already-reconciled expense with an unposted diff against its
linked bank transaction (e.g. matched before this feature existed)
now gets the same "Post to Petty Cash" affordance in its detail
panel, not just live during Reconcile. Linked expenses get a small
badge in the Day Book list.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014zRuYM4tvB1XTUmm3urSjF
EOF
)"
```

---

### Task 5: Cash-mode expenses draw from the pool (create + edit)

**Files:**
- Modify: `src/pages/ExpensesPage.tsx:1036-1460ish` (`AddExpenseDialog`)

**Interfaces:**
- Consumes: `computePettyCashBalance` from Task 2, `watchedMode` (existing watch of `payment_mode`, line 1123), `watchedAmount` (line 1121), `isEditMode`/`editExpense` (existing).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Add a live balance query inside `AddExpenseDialog`**

Add near the other queries (after the `vendorYtd` query, around line 1148):
```tsx
const { data: pettyCashTxnsRaw = [] } = useQuery({
  queryKey: ['petty-cash-balance-raw'],
  queryFn: async () => {
    const { data } = await supabase.from('petty_cash_transactions').select('txn_type, amount, expense_id')
    return data ?? []
  },
})
const pettyCashBalance = computePettyCashBalance(pettyCashTxnsRaw)
const existingLinkedDisbursement = isEditMode
  ? pettyCashTxnsRaw.find(t => t.expense_id === editExpense!.id && t.txn_type === 'Disbursement')
  : undefined
// Balance as if this expense's own prior draw (if any) were freed — what edit validation checks against.
const adjustedPettyCashBalance = pettyCashBalance + (existingLinkedDisbursement?.amount ?? 0)
```

- [ ] **Step 2: Show the balance inline when Cash is selected**

In the Payment mode section (right after the `Controller name="payment_mode"` block, line 1438-1445, inside the same `flex flex-col gap-1` div, after its closing `)} />`):
```tsx
{watchedMode === 'Cash' && (
  <p className="text-xs mt-1" style={{ color: adjustedPettyCashBalance < (Number(watchedAmount) || 0) ? '#dc2626' : 'var(--ink-500)' }}>
    Available in Petty Cash: {formatINR(adjustedPettyCashBalance)}
  </p>
)}
```

- [ ] **Step 3: Validate in the mutation, before any DB write**

At the very top of `mutation`'s `mutationFn` (line 1152-1153, before `const { data: { user } } = ...`):
```tsx
mutationFn: async (data: ExpenseFormData) => {
  if (data.payment_mode === 'Cash') {
    const balanceExcludingSelf = isEditMode
      ? pettyCashBalance + (existingLinkedDisbursement?.amount ?? 0)
      : pettyCashBalance
    if (data.amount > balanceExcludingSelf) {
      throw new Error(`Amount exceeds available Petty Cash balance (₹${balanceExcludingSelf} available)`)
    }
  }
  const { data: { user } } = await supabase.auth.getUser()
  // ... rest unchanged
```

- [ ] **Step 4: Reconcile the linked Disbursement after the expense itself saves successfully**

The existing mutation already computes `expenseId` for both create (line 1208-1214) and edit (line 1193-1199) paths, and already has line-item insert logic after it (line 1217+). After the **entire** existing mutation body succeeds (i.e., right before the function's closing — find the end of `mutationFn`, after the `if (!isEditMode) { ...contributions... }` block around line 1271-1286, still inside `mutationFn`), add:
```tsx
  // Keep the linked Petty Cash disbursement in sync with this expense's
  // final payment_mode/amount. Delete-then-recreate is simpler and safer
  // than trying to patch amounts in place — this only ever runs on save,
  // not on every render.
  if (existingLinkedDisbursement) {
    const { error: delErr } = await supabase
      .from('petty_cash_transactions')
      .delete()
      .eq('id', existingLinkedDisbursement.id)
    if (delErr) throw delErr
  }
  if (data.payment_mode === 'Cash') {
    const { error: pcErr } = await supabase.from('petty_cash_transactions').insert({
      txn_date: data.expense_date,
      txn_type: 'Disbursement',
      amount: data.amount,
      expense_id: expenseId,
      transaction_id: null,
      notes: `Auto: ${data.description}`,
    })
    if (pcErr) throw pcErr
  }
}, // end mutationFn
```

**Note for the implementer:** `existingLinkedDisbursement` needs an `id` field for the delete in Step 4 — go back to Step 1's query and add `id` to the select: `.select('id, txn_type, amount, expense_id')`.

- [ ] **Step 5: Invalidate the new queries on success**

In `mutation`'s `onSuccess` (find it right after the closing of `mutationFn`, alongside the existing `qc.invalidateQueries` calls), add:
```tsx
qc.invalidateQueries({ queryKey: ['petty-cash'] })
qc.invalidateQueries({ queryKey: ['petty-cash-balance'] })
qc.invalidateQueries({ queryKey: ['petty-cash-balance-raw'] })
qc.invalidateQueries({ queryKey: ['petty-cash-links'] })
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual verification against prod**

Run `npm run dev:prod`. By this point in the plan, Petty Cash balance should be ₹2,800 (from Task 4's verification). Add a new expense: description "Test water can", amount ₹500, payment mode Cash. Confirm the inline "Available in Petty Cash: ₹2,800" note appears, save succeeds, Petty Cash tab now shows a ₹500 Disbursement linked to the new expense, balance is now ₹2,300. Edit that same expense's amount to ₹2,500 (still under balance-including-its-own-refund: 2,300 + 500 = 2,800 available) — confirm it saves and the linked entry's amount updates to ₹2,500, balance now ₹300. Try editing it again to ₹1,000 over the adjusted balance (e.g. type an amount like ₹50,000) — confirm the save is blocked with a clear error and nothing changes. Finally, void this test expense via its detail panel, confirm the linked Petty Cash entry disappears and the balance returns to ₹2,800.

- [ ] **Step 8: Commit**

```bash
git add src/pages/ExpensesPage.tsx
git commit -m "$(cat <<'EOF'
feat(expenses): Cash-mode expenses draw from and validate against Petty Cash

Payment mode = Cash now means "funded from the Petty Cash pool" —
shows the live balance inline, hard-blocks (no override) saving an
amount that would overdraw it, and keeps a linked Disbursement entry
in sync through create, amount edits, and payment-mode changes.
Scoped to the single-expense header field only — Pending Items and
bulk-add are untouched.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014zRuYM4tvB1XTUmm3urSjF
EOF
)"
```

---

### Task 6: Void keeps the pool consistent

**Files:**
- Modify: `src/pages/ExpensesPage.tsx:677-706` (`handleVoid` in `ExpenseDetailPanel`)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Delete any linked Petty Cash entry as part of voiding**

Modify `handleVoid` (line 677-706) — insert the deletion right after the existing `expenses` update succeeds (after line 687's `if (error) throw error`, before the existing `directTotalOf` block):
```tsx
async function handleVoid() {
  if (!voidReason.trim()) return
  setVoiding(true)
  try {
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('expenses').update({
      voided_at: new Date().toISOString(),
      voided_by: user?.id ?? null,
      void_reason: voidReason.trim(),
    }).eq('id', e.id)
    if (error) throw error
    const { error: pcErr } = await supabase
      .from('petty_cash_transactions')
      .delete()
      .eq('expense_id', e.id)
    if (pcErr) {
      toast.error('Expense voided, but its linked Petty Cash entry could not be removed — check the Petty Cash tab and remove it manually if needed.', { duration: 10000 })
    }
    if (directTotalOf(e.direct_txns) > 0) {
      // ... existing code unchanged
```
Then, in the existing `qc.invalidateQueries` block right after (line 694-697), add:
```tsx
qc.invalidateQueries({ queryKey: ['petty-cash'] })
qc.invalidateQueries({ queryKey: ['petty-cash-balance'] })
qc.invalidateQueries({ queryKey: ['petty-cash-links'] })
```

**Note:** `petty_cash_transactions` currently has no delete-by-`expense_id`-when-none-exists edge case to worry about — deleting a filter that matches zero rows is a no-op success, not an error, so this is safe to run unconditionally on every void (not just Cash-mode ones), which also correctly reverses a manually-posted Reconcile diff (Task 3/4) on a voided expense.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification against prod**

Run `npm run dev:prod`. Add a throwaway Cash expense (₹100, "Test void"), confirm it creates a linked Disbursement and drops the balance by ₹100. Void it. Confirm: the linked Petty Cash entry is gone, balance is restored, and the Day Book badge from Task 4 no longer shows on that row.

- [ ] **Step 4: Commit**

```bash
git add src/pages/ExpensesPage.tsx
git commit -m "$(cat <<'EOF'
fix(expenses): voiding an expense removes its linked Petty Cash entry

Voiding a Cash-mode expense (Task 5) or an expense with a manually-
posted reconciliation diff (Task 3/4) left its Petty Cash entry
behind, silently understating the pool balance. Now the linked entry
is removed on void, restoring the balance.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014zRuYM4tvB1XTUmm3urSjF
EOF
)"
```

---

### Task 7: Balance Sheet — Cash in Hand asset line

**Files:**
- Modify: `src/pages/ReportPage.tsx:2730-2830ish` (`BalanceSheetTab`)
- Modify: `src/components/reports/AgmPdfDocs.tsx:369-413` (`BalanceSheetDoc`)

**Interfaces:**
- Consumes: `fn_petty_cash_balance_as_of` SQL function from Task 1.
- Produces: nothing new consumed elsewhere (AGM PDFs reuse `BalanceSheetDoc` directly, so this change carries through automatically — no separate AGM task).

- [ ] **Step 1: Query the balance in `BalanceSheetTab`**

Add alongside the existing `bankBalanceData` query (right after line 2743's closing `})`):
```tsx
const { data: cashInHandData = 0 } = useQuery({
  queryKey: ['bs-cash-in-hand', selectedFy.end],
  queryFn: async () => {
    const { data, error } = await supabase.rpc('fn_petty_cash_balance_as_of', { p_date: selectedFy.end })
    if (error) throw error
    return (data as number) ?? 0
  },
})
```

- [ ] **Step 2: Include it in totals**

Change line 2787-2790 from:
```tsx
const bankBalance = bankBalanceData
const fdTotal     = activeFDs ?? 0
const corpColl    = corpusCollected ?? 0
const totalAssets = bankBalance + fdTotal + corpColl
```
to:
```tsx
const bankBalance = bankBalanceData
const fdTotal     = activeFDs ?? 0
const corpColl    = corpusCollected ?? 0
const cashInHand  = cashInHandData
const totalAssets = bankBalance + fdTotal + corpColl + cashInHand
```

- [ ] **Step 3: Add the line to the on-screen assets table**

In the assets array (line 2863-2866), add a fourth entry:
```tsx
{ label: 'Bank balance',           amount: bankBalance, note: 'Cumulative CRs − DRs through this date (audit-derived)' },
{ label: 'Fixed deposits (active)', amount: fdTotal,    note: 'Sum of active FD principals' },
{ label: 'Corpus fund collected',   amount: corpColl,   note: 'All plans combined' },
{ label: 'Cash in hand',            amount: cashInHand, note: 'Petty cash balance held by caretaker' },
```

- [ ] **Step 4: Pass it to the PDF, and update the PDF component**

In `handlePdf` (line 2807-2819), add the prop:
```tsx
<BalanceSheetDoc
  fyLabel={selectedFy.label}
  asAtDate={`31 March ${selectedFyYear + 1}`}
  bankBalance={bankBalance}
  fdTotal={fdTotal}
  corpusCollected={corpColl}
  cashInHand={cashInHand}
  totalAssets={totalAssets}
  pendingDues={pendDues}
  corpusBalance={corpBal}
  totalLiabilities={totalLiab}
  netPosition={netPosition}
  generated={generated}
/>
```
In `AgmPdfDocs.tsx`, update `BalanceSheetDoc`'s signature (line 369-386) to accept and type `cashInHand: number`, and add it to the assets array (line 399-402):
```tsx
export function BalanceSheetDoc({
  fyLabel, asAtDate,
  bankBalance, fdTotal, corpusCollected, cashInHand, totalAssets,
  pendingDues, corpusBalance, totalLiabilities, netPosition,
  generated,
}: {
  fyLabel: string
  asAtDate: string
  bankBalance: number
  fdTotal: number
  corpusCollected: number
  cashInHand: number
  totalAssets: number
  pendingDues: number
  corpusBalance: number
  totalLiabilities: number
  netPosition: number
  generated: string
}) {
```
```tsx
{ label: 'Bank balance',            amount: bankBalance },
{ label: 'Fixed deposits (active)', amount: fdTotal },
{ label: 'Corpus fund collected',   amount: corpusCollected },
{ label: 'Cash in hand',            amount: cashInHand },
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual verification against prod**

Run `npm run dev:prod`, go to Reports → Balance Sheet. Confirm a "Cash in hand" row appears in ASSETS with the current Petty Cash balance (₹2,800 or whatever it is after prior tasks' testing), and Total Assets includes it. Download the PDF, confirm the same line appears there.

- [ ] **Step 7: Commit**

```bash
git add src/pages/ReportPage.tsx src/components/reports/AgmPdfDocs.tsx
git commit -m "$(cat <<'EOF'
feat(reports): Cash in Hand asset line on the Balance Sheet

Total Assets previously omitted the Petty Cash balance entirely —
a real understatement once the pool holds money. Sourced from
fn_petty_cash_balance_as_of, shown on screen and in the PDF. The AGM
PDF bundle reuses BalanceSheetDoc, so it picks this up automatically.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014zRuYM4tvB1XTUmm3urSjF
EOF
)"
```

---

### Task 8: Cashbook + R&P Statement — Petty Cash opening/closing addendum

**Files:**
- Modify: `src/pages/ReportPage.tsx:2158-2427ish` (`CashbookTab`)
- Modify: `src/pages/ReportPage.tsx:2527-2730ish` (`RPStatementTab`)
- Modify: `src/components/reports/AgmPdfDocs.tsx:631-750ish` (`CashbookDoc`)
- Modify: `src/components/reports/AgmPdfDocs.tsx:280-368` (`RPStatementDoc`)

**Interfaces:**
- Consumes: `fn_petty_cash_balance_as_of` SQL function from Task 1.
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Query Petty Cash opening/closing in `CashbookTab`**

Add alongside the existing `openingBalance`/`closingBalance` queries (after line 2180's closing `})`):
```tsx
const { data: pcOpening = 0 } = useQuery({
  queryKey: ['cashbook-pc-opening', prevEnd],
  queryFn: async () => {
    const { data, error } = await supabase.rpc('fn_petty_cash_balance_as_of', { p_date: prevEnd })
    if (error) throw error
    return (data as number) ?? 0
  },
})
const { data: pcClosing = 0 } = useQuery({
  queryKey: ['cashbook-pc-closing', end],
  queryFn: async () => {
    const { data, error } = await supabase.rpc('fn_petty_cash_balance_as_of', { p_date: end })
    if (error) throw error
    return (data as number) ?? 0
  },
})
```

- [ ] **Step 2: Add a compact addendum line beneath the KPI strip (screen)**

Right after the KPI strip's closing `</div>` (line 2427), before the `{/* Receipts / Payments */}` comment:
```tsx
<p className="text-xs px-1" style={{ color: 'var(--ink-500)' }}>
  Petty Cash: opening {formatINR(pcOpening)} → closing {formatINR(pcClosing)}
</p>
```

- [ ] **Step 3: Add the same two rows to the Excel export**

In `handleExcelExport` (line 2320-2357), add rows right after the existing `['Opening Balance', openingBalance]` (line 2324) and before `['Closing Balance', closingBalance]` (line 2344) sections respectively — insert two new lines into the `rows` array:
```tsx
['Opening Balance', openingBalance],
['Petty Cash — Opening', pcOpening],
[],
// ... existing RECEIPTS/PAYMENTS sections unchanged ...
['Closing Balance', closingBalance],
['Petty Cash — Closing', pcClosing],
[],
```

- [ ] **Step 4: Pass to the PDF and update `CashbookDoc`**

Find the `<CashbookDoc ... />` call inside `handlePdf` (starts at line 2368) and add two new props (`pettyCashOpening`, `pettyCashClosing`) — every other prop in that call stays exactly as it already is, including the inline `dues={[...]}` array literal:
```tsx
<CashbookDoc
  month={month}
  openingBalance={openingBalance}
  closingBalance={closingBalance}
  pettyCashOpening={pcOpening}
  pettyCashClosing={pcClosing}
  receipts={crSplitup ?? []}
  payments={drSplitup ?? []}
  dues={[
    { label: 'Current FY Pending',    amount: pendingTotal,     flats: pendingRows.length },
    { label: 'Arrears (prior years)', amount: arrearsTotal,     flats: arrearsRows.length },
    { label: 'Total Outstanding',     amount: outstandingTotal, flats: outstandingRows.length },
  ]}
  generated={generated}
/>
```

In `AgmPdfDocs.tsx`, update `CashbookDoc`'s signature (line 631-640):
```tsx
export function CashbookDoc({
  month, openingBalance, closingBalance, pettyCashOpening, pettyCashClosing, receipts, payments, dues, generated,
}: {
  month: string
  openingBalance: number
  closingBalance: number
  pettyCashOpening: number
  pettyCashClosing: number
  receipts: CashbookCrRow[]
  payments: CashbookDrGroup[]
  dues: CashbookDuesRow[]
  generated: string
}) {
```
Then add one line right after the existing "Closing Balance" block (line 711-714):
```tsx
<View style={[S.rowTotal, { marginTop: 8 }]}>
  <Text style={[S.col, S.bold]}>Closing Balance</Text>
  <Text style={[S.colR, S.bold]}>{formatINR(closingBalance)}</Text>
</View>

<Text style={[S.small, { marginTop: 4 }]}>
  Petty Cash: opening {formatINR(pettyCashOpening)} → closing {formatINR(pettyCashClosing)}
</Text>
```

- [ ] **Step 5: Repeat for `RPStatementTab`**

Add two queries alongside the existing `openingBalance` query (after line 2544's closing `})`), reusing the same prior-date computation it already uses for its own opening balance:
```tsx
const { data: rpPcOpening = 0 } = useQuery({
  queryKey: ['rp-pc-opening', selectedFy.start],
  queryFn: async () => {
    const d = new Date(selectedFy.start)
    d.setDate(d.getDate() - 1)
    const priorDate = d.toISOString().slice(0, 10)
    const { data, error } = await supabase.rpc('fn_petty_cash_balance_as_of', { p_date: priorDate })
    if (error) throw error
    return (data as number) ?? 0
  },
})
const { data: rpPcClosing = 0 } = useQuery({
  queryKey: ['rp-pc-closing', selectedFy.end],
  queryFn: async () => {
    const { data, error } = await supabase.rpc('fn_petty_cash_balance_as_of', { p_date: selectedFy.end })
    if (error) throw error
    return (data as number) ?? 0
  },
})
```
Add a compact addendum line right after the existing closing-balance card (line 2714-2721, after its closing `</div>`):
```tsx
<p className="text-xs px-1" style={{ color: 'var(--ink-500)' }}>
  Petty Cash: opening {formatINR(rpPcOpening)} → closing {formatINR(rpPcClosing)}
</p>
```
Add the two props to the `<RPStatementDoc ... />` call in `handlePdf` (line 2630-2638):
```tsx
<RPStatementDoc
  fyLabel={selectedFy.label}
  openingBalance={openingBalance}
  maintenanceCR={mCR}
  corpusCR={cCR}
  fdInterest={fdInt}
  pettyCashOpening={rpPcOpening}
  pettyCashClosing={rpPcClosing}
  payments={paymentRows ?? []}
  generated={generated}
/>
```
In `AgmPdfDocs.tsx`, update `RPStatementDoc`'s signature (line 280-290):
```tsx
export function RPStatementDoc({
  fyLabel, openingBalance, maintenanceCR, corpusCR, fdInterest, pettyCashOpening, pettyCashClosing, payments, generated,
}: {
  fyLabel: string
  openingBalance: number
  maintenanceCR: number
  corpusCR: number
  fdInterest: number
  pettyCashOpening: number
  pettyCashClosing: number
  payments: RPPaymentRow[]
  generated: string
}) {
```
Add one line right after the existing deficit-conditional block, before the footer (line 359-361):
```tsx
{closingBal < 0 && (
  <View style={[S.rowTotal, { marginTop: 12 }]}>
    <Text style={[S.col, S.bold, { fontSize: 10, color: '#dc2626' }]}>
      Deficit for the year
    </Text>
    <Text style={[S.colR, S.bold, { fontSize: 10, color: '#dc2626' }]}>
      {formatINR(Math.abs(closingBal))}
    </Text>
  </View>
)}

<Text style={[S.small, { marginTop: 8 }]}>
  Petty Cash: opening {formatINR(pettyCashOpening)} → closing {formatINR(pettyCashClosing)}
</Text>

<LetterheadFooter style={S.footer} generated={generated} />
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual verification against prod**

Run `npm run dev:prod`. Reports → Cashbook: confirm the "Petty Cash: opening → closing" line appears beneath the KPI strip with sensible values for the selected month, Excel export includes the two new rows, PDF includes the new line. Reports → R&P Statement: same check.

- [ ] **Step 8: Commit**

```bash
git add src/pages/ReportPage.tsx src/components/reports/AgmPdfDocs.tsx
git commit -m "$(cat <<'EOF'
feat(reports): Petty Cash opening/closing on Cashbook and R&P Statement

A cash book has always meant two columns — Bank and Cash-in-Hand.
Adds a compact opening/closing addendum (not a full parallel CR/DR
splitup) to both reports' screen view, exports, and PDFs, sourced
from fn_petty_cash_balance_as_of.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014zRuYM4tvB1XTUmm3urSjF
EOF
)"
```

---

### Task 9: Dashboard — Cash in Hand note

**Files:**
- Modify: `src/pages/DashboardPage.tsx:252-268ish` (Net Available Cash card)

**Interfaces:**
- Consumes: `computePettyCashBalance` from `src/lib/pettyCash.ts` (Task 2).

- [ ] **Step 1: Import the shared helper and add a balance query**

Add to the imports at the top of `DashboardPage.tsx`:
```tsx
import { computePettyCashBalance } from '@/lib/pettyCash'
```
Add a query near the other dashboard queries (e.g. alongside the `fundPositions` query around line 78):
```tsx
const { data: pettyCashBalance = 0 } = useQuery({
  queryKey: ['petty-cash-balance'],
  queryFn: async () => {
    const { data } = await supabase.from('petty_cash_transactions').select('txn_type, amount')
    return computePettyCashBalance(data ?? [])
  },
})
```
(This reuses the same query key already used elsewhere — TanStack Query dedupes/shares cached results across components using the same key, so this doesn't add an extra network round trip if the Expenses page was recently visited, and is harmless standalone otherwise.)

- [ ] **Step 2: Render the note inside the Net Available Cash card**

Inside the card's button (right after the existing caption paragraph, line 265-267, before the closing `</button>` at line 268):
```tsx
<p className="text-[11.5px] mt-1" style={{ color: 'var(--brand-500)' }}>
  Maintenance + Corpus{contributionAvailable > 0 ? ' + Contributions' : ''} available
</p>
{pettyCashBalance > 0 && (
  <p className="text-[10.5px] mt-0.5" style={{ color: 'var(--brand-400)' }}>
    + {formatINR(pettyCashBalance)} cash in hand
  </p>
)}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification against prod**

Run `npm run dev:prod`, open the Dashboard. Confirm the "+ ₹X cash in hand" line appears beneath the Net Available Cash figure (not folded into the big number itself), matching the current Petty Cash balance, and is absent entirely if the balance were ever ₹0 (can't easily test the zero case at this point in the plan since prior tasks' verification leaves a positive balance — just confirm the conditional exists in code and the positive case renders correctly).

- [ ] **Step 5: Commit**

```bash
git add src/pages/DashboardPage.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): show Cash in Hand alongside Net Available Cash

A small, separate note — not folded into Net Available Cash, which
means "bank balance by fund" today and should keep meaning exactly
that. Not a full KPI card either; the pool sits in the low thousands
next to lakhs of Maintenance/Corpus.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014zRuYM4tvB1XTUmm3urSjF
EOF
)"
```

---

## After all tasks: push and run the backfill

1. `git push origin main` (Vercel auto-deploys).
2. Work through the spec's "Data correction & backfill" checklist against **prod**, using the shipped UI:
   - Add the Opening entry (₹3,783, dated 2026-07-04) via Petty Cash tab → Add Entry.
   - The two Replenishment postings (₹1,500, ₹1,300) should already be done from Task 4's manual verification — confirm they're there rather than redoing them.
   - Nothing to do for Sewage Lorry — confirmed exact match, no entry needed.
   - Confirm final balance reads ₹6,583.
