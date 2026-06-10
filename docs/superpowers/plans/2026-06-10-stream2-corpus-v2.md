# Corpus Fund v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make corpus fund management safe for parallel plans — add overlap warnings, plan-attribution UI, unified collection calendar, overflow indicators, and activation validation.

**Architecture:** SQL function for overlap detection; UI changes confined to CorpusPage.tsx and TransactionsPage.tsx; new migration 029_corpus_v2.sql. No new tables.

**Tech Stack:** React 18, TypeScript, Supabase JS, react-query, Shadcn/ui, Tailwind CSS

---

## Pre-flight checklist

- [ ] Confirm `npm run dev` starts cleanly on `http://localhost:5173`
- [ ] Confirm `npx tsc --noEmit` passes with zero errors before you touch anything
- [ ] Note: migrations 001–028 are already applied to production. The next migration number is **029**.

---

## Task 1 — Migration 029: `get_overlapping_active_plans` SQL function

**File to create:** `supabase/migrations/029_corpus_v2.sql`

**What this does:** Adds a Postgres function that accepts a candidate plan's `start_fiscal_year` and `end_fiscal_year` and returns any currently-active plans whose FY range overlaps. The app layer calls this via `supabase.rpc()` before activating a draft plan. No new columns or tables are created.

- [ ] Create the file `supabase/migrations/029_corpus_v2.sql` with this exact content:

```sql
-- Migration 029: Corpus Fund v2 helpers
-- Adds get_overlapping_active_plans() for overlap detection at plan activation time.
-- No schema changes — function only.

CREATE OR REPLACE FUNCTION public.get_overlapping_active_plans(
  p_start int,
  p_end   int
)
RETURNS TABLE(id uuid, name text, start_fiscal_year int, end_fiscal_year int)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    id,
    name,
    start_fiscal_year,
    end_fiscal_year
  FROM corpus_plans
  WHERE status = 'active'
    AND start_fiscal_year <= p_end
    AND end_fiscal_year   >= p_start;
$$;

GRANT EXECUTE ON FUNCTION public.get_overlapping_active_plans(int, int) TO authenticated;
```

- [ ] Apply the migration to Supabase. If you have the Supabase CLI configured with a PAT, run:

  ```bash
  npx supabase db push --project-ref aulttcsvxzcwyceezzpz
  ```

  If CLI auth is not available, paste the SQL directly into the Supabase dashboard SQL Editor and run it.

- [ ] Verify the function exists: in the SQL Editor run `SELECT * FROM get_overlapping_active_plans(2025, 2026);` — it should return zero or more rows without error.

- [ ] Run `npx tsc --noEmit` — must pass.

- [ ] Commit:
  ```
  git add supabase/migrations/029_corpus_v2.sql
  git commit -m "feat(corpus): add get_overlapping_active_plans SQL function (migration 029)"
  ```

---

## Task 2 — Parallel plan warning banner in CorpusPage

**File to edit:** `src/pages/CorpusPage.tsx`

**What this does:** When 2 or more corpus plans are simultaneously active (status = `'active'`), show an amber warning banner at the top of the page — above the KPI strip, below the header. The banner is dismissible per session. It shows the names and FY ranges of the overlapping plans.

### 2a — Add dismissible state and derive `overlappingActivePlans`

- [ ] In `CorpusPage()`, after the existing `const activePlans = ...` line, add:

```typescript
// Only status='active' plans (not draft) can truly overlap
const trulyActivePlans = plans.filter(p => p.status === 'active')
const [overlapDismissed, setOverlapDismissed] = useState(false)
```

The existing `activePlans` variable (which includes `draft`) is unchanged — it feeds the plan selector. `trulyActivePlans` is used only for the warning banner.

### 2b — Add the `ParallelPlanWarning` component

- [ ] Add this component near the top of the file, after the `STATUS_BADGE` constant and before the `CorpusPage` function:

```typescript
function fyRange(p: CorpusPlan) {
  return `FY ${p.start_fiscal_year}-${String((p.start_fiscal_year ?? 0) + 1).slice(-2)} – FY ${p.end_fiscal_year}-${String((p.end_fiscal_year ?? 0) + 1).slice(-2)}`
}

function ParallelPlanWarning({ plans, onDismiss }: { plans: CorpusPlan[]; onDismiss: () => void }) {
  const names = plans.map(p => `${p.name} (${fyRange(p)})`).join(' vs ')
  return (
    <div className="flex items-start gap-3 rounded-xl px-4 py-3 border border-amber-300 bg-amber-50">
      <span className="mt-0.5 text-amber-600 shrink-0">⚠</span>
      <p className="flex-1 text-sm text-amber-800">
        <span className="font-semibold">{plans.length} active plans detected.</span>{' '}
        Corpus payments without a plan tag will be attributed by fiscal year range.
        Overlap risk: {names}.
      </p>
      <button
        onClick={onDismiss}
        className="shrink-0 p-0.5 rounded hover:bg-amber-100 text-amber-500"
        aria-label="Dismiss warning"
      >
        <X size={15} />
      </button>
    </div>
  )
}
```

### 2c — Render the banner in `CorpusPage` JSX

- [ ] In the `CorpusPage` JSX, find the existing `{/* Consolidated view banner when showing all */}` block. Insert the parallel plan warning **above** it:

```typescript
{/* Parallel plan warning */}
{trulyActivePlans.length >= 2 && !overlapDismissed && (
  <ParallelPlanWarning plans={trulyActivePlans} onDismiss={() => setOverlapDismissed(true)} />
)}
```

The full JSX order after the header section becomes:
1. Parallel plan warning (new)
2. Consolidated view banner (existing, unchanged)
3. KPI strip (existing, unchanged)

- [ ] Run `npx tsc --noEmit` — must pass.

- [ ] Verify manually: create or check that 2 plans have `status = 'active'` in Supabase. Load `/corpus`. The amber banner should appear. Clicking `✕` hides it for the session.

- [ ] Commit:
  ```
  git add src/pages/CorpusPage.tsx
  git commit -m "feat(corpus): parallel plan amber warning banner when 2+ plans active"
  ```

---

## Task 3 — Plan activation overlap check

**File to edit:** `src/pages/CorpusPage.tsx`

**What this does:** When the treasurer clicks "Activate plan", the app calls `get_overlapping_active_plans` with the draft plan's FY range. If any active plans are returned, it shows a confirmation dialog listing the conflicts. The treasurer must explicitly confirm to proceed. If no overlap is found, activation proceeds immediately (same as today).

### 3a — Extend `ActivatePlanDialog` to do the overlap check

The existing `ActivatePlanDialog` component receives `planId` but has no reference to the plan object. We need to also pass `plan` so we can read its FY range.

- [ ] Update the `ActivatePlanDialog` component signature and internals. Replace the entire component with:

```typescript
function ActivatePlanDialog({ open, plan, onClose, onSuccess }: {
  open: boolean
  plan: CorpusPlan
  onClose: () => void
  onSuccess: () => void
}) {
  const [checking, setChecking]         = useState(false)
  const [overlapping, setOverlapping]   = useState<{ id: string; name: string; start_fiscal_year: number; end_fiscal_year: number }[]>([])
  const [showConfirm, setShowConfirm]   = useState(false)
  const [loading, setLoading]           = useState(false)

  // Run the overlap check as soon as the dialog opens
  useEffect(() => {
    if (!open) return
    setOverlapping([])
    setShowConfirm(false)
    setChecking(true)
    supabase
      .rpc('get_overlapping_active_plans', {
        p_start: plan.start_fiscal_year ?? 0,
        p_end:   plan.end_fiscal_year   ?? 9999,
      })
      .then(({ data, error }) => {
        if (error) toast.error('Overlap check failed: ' + error.message)
        setOverlapping((data ?? []) as { id: string; name: string; start_fiscal_year: number; end_fiscal_year: number }[])
        setChecking(false)
        setShowConfirm(true)
      })
  }, [open, plan])

  async function doActivate() {
    setLoading(true)
    const { error } = await supabase
      .from('corpus_plans')
      .update({ status: 'active' })
      .eq('id', plan.id)
    setLoading(false)
    if (error) { toast.error(error.message); return }
    toast.success('Plan activated')
    onSuccess()
    onClose()
  }

  const hasOverlap = overlapping.length > 0

  return (
    <AlertDialog open={open} onOpenChange={v => !v && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Activate Corpus Plan?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              {checking ? (
                <span className="block text-sm">Checking for plan conflicts…</span>
              ) : hasOverlap ? (
                <>
                  <span className="block mb-2 text-amber-700 font-medium">
                    ⚠ {overlapping.length} active plan{overlapping.length > 1 ? 's' : ''} overlap{overlapping.length === 1 ? 's' : ''} this plan's FY range:
                  </span>
                  <div className="flex flex-col gap-1 mb-2">
                    {overlapping.map(p => (
                      <span key={p.id} className="text-sm text-slate-700">
                        • {p.name} (FY {p.start_fiscal_year}-{String(p.start_fiscal_year + 1).slice(-2)} – FY {p.end_fiscal_year}-{String(p.end_fiscal_year + 1).slice(-2)})
                      </span>
                    ))}
                  </div>
                  <span className="block text-sm text-slate-600">
                    Untagged corpus payments may be split across plans by fiscal year range. You can tag individual transactions to a specific plan in the Transactions → Review tab. Proceed anyway?
                  </span>
                </>
              ) : (
                <span>This will make the plan live and allow collection tracking. No active plan conflicts found.</span>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose} disabled={loading}>Cancel</AlertDialogCancel>
          {showConfirm && (
            <AlertDialogAction
              onClick={doActivate}
              disabled={loading || checking}
              className={hasOverlap ? 'bg-amber-600 hover:bg-amber-700' : ''}
            >
              {loading ? 'Activating…' : hasOverlap ? 'Activate anyway' : 'Activate'}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

### 3b — Update the call site in CorpusPage JSX

- [ ] Find the existing `{showActivate && selectedPlanId !== '__all__' && (` block. Change it from:

```typescript
{showActivate && selectedPlanId !== '__all__' && (
  <ActivatePlanDialog
    open={showActivate}
    planId={selectedPlanId}
    onClose={() => setShowActivate(false)}
    onSuccess={invalidatePlans}
  />
)}
```

To:

```typescript
{showActivate && selectedPlanId !== '__all__' && selectedPlan && (
  <ActivatePlanDialog
    open={showActivate}
    plan={selectedPlan}
    onClose={() => setShowActivate(false)}
    onSuccess={invalidatePlans}
  />
)}
```

Note: `selectedPlan` is already derived in `CorpusPage` as `plans.find(p => p.id === selectedPlanId) ?? null`. The added `&& selectedPlan` guard handles the null case.

- [ ] Run `npx tsc --noEmit` — must pass.

- [ ] Verify manually: activate a draft plan that overlaps an active one. The dialog should show the amber warning with the conflicting plan's name. Activating a non-overlapping draft should show the plain "No conflicts" message.

- [ ] Commit:
  ```
  git add src/pages/CorpusPage.tsx
  git commit -m "feat(corpus): overlap validation dialog before plan activation"
  ```

---

## Task 4 — Unified Collection Calendar tab

**File to edit:** `src/pages/CorpusPage.tsx`

**What this does:** Adds a new "Collection Calendar" tab in CorpusPage. This tab is always visible (not disabled when `selectedPlanId === '__all__'`). It shows a flat-by-installment grid across **all active plans** simultaneously. Each cell is color-coded:
- Green — flat has paid ≥ installment amount for that plan
- Amber — flat has paid something but less than the installment target
- Red — installment due date has passed and nothing paid
- Grey — installment due date is in the future, nothing paid yet

The data is derived from existing queries: `allCorpus` (from `v_corpus_tracker`), all plans' installments, and all flat installment assignments. No new Supabase queries are needed beyond the ones already declared in `CorpusPage`.

### 4a — Add new queries for all-plan installments

The existing installments query is scoped to `selectedPlanId`. We need installments for all active plans at once.

- [ ] In `CorpusPage()`, after the `const { data: expenditures = [] }` query, add two new queries:

```typescript
// All installments across all active plans (for Collection Calendar tab)
const { data: allInstallments = [] } = useQuery({
  queryKey: ['corpus-all-installments', activePlans.map(p => p.id).join(',')],
  queryFn: async () => {
    if (activePlans.length === 0) return []
    const { data } = await supabase
      .from('corpus_plan_installments')
      .select('*')
      .in('plan_id', activePlans.map(p => p.id))
      .order('plan_id')
      .order('installment_no')
    return data ?? []
  },
  enabled: activePlans.length > 0,
})

// All flat-level payments per installment across all active plans
const { data: allFlatInstallments = [] } = useQuery({
  queryKey: ['corpus-all-flat-installments', activePlans.map(p => p.id).join(',')],
  queryFn: async () => {
    if (activePlans.length === 0) return []
    const { data } = await supabase
      .from('corpus_plan_flat_installments')
      .select('*, flat:flat_id(code)')
      .in('plan_id', activePlans.map(p => p.id))
    return data ?? []
  },
  enabled: activePlans.length > 0,
})
```

### 4b — Add the `CollectionCalendar` component

- [ ] Add this component after the `ExpenditureView` component and before `PlanHistory`:

```typescript
// ── Collection Calendar ───────────────────────────────────────

interface CalendarColumn {
  key: string         // e.g. "plan_abc123_inst_1"
  planId: string
  planName: string
  installmentNo: number
  label: string
  dueDate: string | null
  defaultAmount: number
}

function CollectionCalendar({
  activePlans,
  allCorpus,
  allInstallments,
  allFlatInstallments,
}: {
  activePlans: CorpusPlan[]
  allCorpus: CorpusEntry[]
  allInstallments: any[]
  allFlatInstallments: any[]
}) {
  const today = new Date().toISOString().slice(0, 10)

  // Build column definitions: one column per installment per plan
  const columns: CalendarColumn[] = allInstallments.map(inst => {
    const plan = activePlans.find(p => p.id === inst.plan_id)
    return {
      key: `${inst.plan_id}_inst_${inst.installment_no}`,
      planId: inst.plan_id,
      planName: plan?.name ?? inst.plan_id,
      installmentNo: inst.installment_no,
      label: inst.label,
      dueDate: inst.due_date ?? null,
      defaultAmount: inst.default_amount,
    }
  })

  // Build lookup: flatCode → planId → installment_no → overridden amount
  // allFlatInstallments holds per-flat overrides; fall back to defaultAmount from column
  const flatInstMap = new Map<string, Map<string, Map<number, number>>>()
  for (const fi of allFlatInstallments) {
    const code = fi.flat?.code ?? ''
    if (!flatInstMap.has(code)) flatInstMap.set(code, new Map())
    const planMap = flatInstMap.get(code)!
    if (!planMap.has(fi.plan_id)) planMap.set(fi.plan_id, new Map())
    planMap.get(fi.plan_id)!.set(fi.installment_no, fi.amount)
  }

  // Collect distinct flat codes in order
  const flatCodes = Array.from(
    new Set(allCorpus.map(e => e.flat_code))
  ).sort()

  // Build collected-per-flat-per-plan map from allCorpus
  const collectedMap = new Map<string, number>()
  for (const e of allCorpus) {
    collectedMap.set(`${e.flat_code}__${e.plan_id}`, e.collected)
  }

  // Determine cell status for a given flat + column
  function cellStatus(flatCode: string, col: CalendarColumn): 'paid' | 'partial' | 'overdue' | 'future' {
    const targetAmt =
      flatInstMap.get(flatCode)?.get(col.planId)?.get(col.installmentNo)
      ?? col.defaultAmount

    // Use total collected for the plan (installment-level payment tracking is not in v_corpus_tracker)
    // We use a simple heuristic: compare collected-so-far against cumulative installment targets up to this installment
    const planInsts = allInstallments
      .filter(i => i.plan_id === col.planId)
      .sort((a, b) => a.installment_no - b.installment_no)

    const instIndex = planInsts.findIndex(i => i.installment_no === col.installmentNo)
    const cumulativeTarget = planInsts
      .slice(0, instIndex + 1)
      .reduce((sum, i) => {
        const amt = flatInstMap.get(flatCode)?.get(col.planId)?.get(i.installment_no) ?? i.default_amount
        return sum + amt
      }, 0)

    const collected = collectedMap.get(`${flatCode}__${col.planId}`) ?? 0

    if (collected >= cumulativeTarget) return 'paid'
    if (collected > 0 && col.dueDate && col.dueDate < today) return 'partial'
    if (col.dueDate && col.dueDate < today) return 'overdue'
    return 'future'
  }

  const CELL_STYLE: Record<string, string> = {
    paid:    'bg-green-100 text-green-700',
    partial: 'bg-amber-100 text-amber-700',
    overdue: 'bg-red-100 text-red-600',
    future:  'bg-slate-100 text-slate-400',
  }
  const CELL_LABEL: Record<string, string> = {
    paid:    '✓',
    partial: '~',
    overdue: '!',
    future:  '—',
  }

  if (activePlans.length === 0) {
    return (
      <p className="surface !p-6 text-sm text-center" style={{ color: 'var(--ink-400)' }}>
        No active plans to display.
      </p>
    )
  }

  if (columns.length === 0) {
    return (
      <p className="surface !p-6 text-sm text-center" style={{ color: 'var(--ink-400)' }}>
        No installments defined on active plans.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Legend */}
      <div className="flex items-center gap-4 flex-wrap text-xs">
        <span className="font-medium text-slate-500">Legend:</span>
        {(['paid', 'partial', 'overdue', 'future'] as const).map(s => (
          <span key={s} className={`px-2 py-0.5 rounded-full font-medium ${CELL_STYLE[s]}`}>
            {s === 'paid' ? 'Paid' : s === 'partial' ? 'Partial' : s === 'overdue' ? 'Overdue' : 'Not due'}
          </span>
        ))}
      </div>

      {/* Column headers grouped by plan */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            {/* Row 1: plan name spans */}
            <tr>
              <th className="sticky left-0 bg-white px-3 py-2 text-left font-semibold text-slate-600 border-b hairline w-24">
                Flat
              </th>
              {activePlans.map(plan => {
                const planCols = columns.filter(c => c.planId === plan.id)
                if (planCols.length === 0) return null
                return (
                  <th
                    key={plan.id}
                    colSpan={planCols.length}
                    className="px-2 py-2 text-center font-semibold border-b hairline border-l hairline"
                    style={{ color: 'var(--brand-700)', background: 'var(--brand-50)' }}
                  >
                    {plan.name}
                  </th>
                )
              })}
            </tr>
            {/* Row 2: installment labels */}
            <tr>
              <th className="sticky left-0 bg-white px-3 py-1.5 border-b hairline" />
              {columns.map(col => (
                <th
                  key={col.key}
                  className="px-2 py-1.5 text-center font-medium text-slate-500 border-b hairline border-l hairline whitespace-nowrap"
                >
                  <div>{col.label}</div>
                  {col.dueDate && (
                    <div className="text-[10px] font-normal text-slate-400">{col.dueDate}</div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {flatCodes.map(flatCode => (
              <tr key={flatCode} className="hover:bg-slate-50">
                <td className="sticky left-0 bg-white px-3 py-1.5 font-medium text-slate-700 border-b hairline w-24">
                  {flatCode}
                </td>
                {columns.map(col => {
                  const status = cellStatus(flatCode, col)
                  return (
                    <td
                      key={col.key}
                      className={`px-2 py-1.5 text-center border-b hairline border-l hairline font-semibold ${CELL_STYLE[status]}`}
                      title={`${flatCode} · ${col.planName} · ${col.label} · ${status}`}
                    >
                      {CELL_LABEL[status]}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px]" style={{ color: 'var(--ink-400)' }}>
        Paid/Partial status is based on cumulative collection vs cumulative installment targets.
        Installment due dates drive overdue detection.
      </p>
    </div>
  )
}
```

### 4c — Wire up the new tab

- [ ] In `CorpusPage()`, change the `tab` state type to include `'calendar'`:

```typescript
const [tab, setTab] = useState<'collection' | 'plan' | 'expenditure' | 'calendar'>('collection')
```

- [ ] In the tab bar array (the `([...] as {...}[]).map(...)` block), add the new tab entry after `'expenditure'`:

```typescript
{ key: 'calendar', label: 'Collection Calendar' },
```

Remove the `disabled` logic from the new tab — it should always be enabled. The full array becomes:

```typescript
{([
  { key: 'collection',  label: 'By Flat' },
  { key: 'plan',        label: 'Installment Plan', disabled: selectedPlanId === '__all__' },
  { key: 'expenditure', label: 'Expenditure' },
  { key: 'calendar',    label: 'Collection Calendar' },
] as { key: typeof tab; label: string; disabled?: boolean }[]).map(({ key, label, disabled }) => (
  // ...existing button render logic, unchanged...
))}
```

- [ ] After the `{tab === 'expenditure' && ...}` line, add the new tab render:

```typescript
{tab === 'calendar' && (
  <CollectionCalendar
    activePlans={activePlans}
    allCorpus={allCorpus}
    allInstallments={allInstallments}
    allFlatInstallments={allFlatInstallments}
  />
)}
```

- [ ] Run `npx tsc --noEmit` — must pass.

- [ ] Verify manually: navigate to `/corpus`, click "Collection Calendar". You should see a table with flat codes as rows and installment columns grouped by plan. Cells should show green/amber/red/grey based on payment status.

- [ ] Commit:
  ```
  git add src/pages/CorpusPage.tsx
  git commit -m "feat(corpus): unified Collection Calendar tab across all active plans"
  ```

---

## Task 5 — Overflow indicator on plan cards

**File to edit:** `src/pages/CorpusPage.tsx`

**What this does:** In the `ConsolidatedBanner` (shown when `selectedPlanId === '__all__'`), if a plan's `collected > effective_target`, show a green "Surplus: ₹X" badge instead of the balance. This is informational only — no transfer logic.

### 5a — Update `ConsolidatedBanner` to show surplus

- [ ] Find the `ConsolidatedBanner` component. In the JSX that renders each plan row, change the last `<span>` (the balance/done indicator) to:

```typescript
{balance > 0 ? (
  formatINR(balance)
) : surplus > 0 ? (
  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
    Surplus: {formatINR(surplus)}
  </span>
) : (
  '✓'
)}
```

- [ ] Update the `planSummaries` derivation in `ConsolidatedBanner` to include `surplus`:

Change:
```typescript
return { plan: p, target, collected, balance: Math.max(0, target - collected) }
```
To:
```typescript
const rawBalance = target - collected
return {
  plan: p,
  target,
  collected,
  balance:  Math.max(0, rawBalance),
  surplus:  rawBalance < 0 ? Math.abs(rawBalance) : 0,
}
```

- [ ] Update the destructuring in the `.map()` render to include `surplus`:

Change:
```typescript
{planSummaries.map(({ plan, target, collected, balance }) => (
```
To:
```typescript
{planSummaries.map(({ plan, target, collected, balance, surplus }) => (
```

- [ ] The updated `ConsolidatedBanner` last `<span>` should now read:

```typescript
<span className={`font-semibold ${balance > 0 ? 'text-amber-600' : surplus > 0 ? '' : 'text-green-600'}`}>
  {balance > 0
    ? formatINR(balance)
    : surplus > 0
    ? (
      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
        Surplus: {formatINR(surplus)}
      </span>
    )
    : '✓'}
</span>
```

### 5b — Also show overflow in the KPI strip when a single plan is selected

The `SummaryCard` for "Still to collect" already uses `Math.max(0, totalTarget - totalCollected)` which clamps negative values to zero. Add a surplus indicator below the KPI strip when `totalCollected > totalTarget`.

- [ ] After the closing `</div>` of the KPI strip grid (the 5-card `grid` div), add:

```typescript
{totalCollected > totalTarget && totalTarget > 0 && (
  <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-green-50 border border-green-200 text-sm">
    <span className="text-green-600 font-semibold">
      Surplus: {formatINR(totalCollected - totalTarget)}
    </span>
    <span style={{ color: 'var(--ink-500)' }}>
      — collected exceeds the plan target. No action needed; this is informational.
    </span>
  </div>
)}
```

- [ ] Run `npx tsc --noEmit` — must pass.

- [ ] Verify manually: if you have a plan where collected > effective_target, the "All active plans" view should show a green "Surplus: ₹X" badge in the consolidated banner row. If you select that specific plan, a green surplus strip appears below the KPI cards.

- [ ] Commit:
  ```
  git add src/pages/CorpusPage.tsx
  git commit -m "feat(corpus): surplus/overflow indicator on consolidated banner and KPI strip"
  ```

---

## Task 6 — Plan-attribution dropdown in TransactionsPage (AllTransactionsTab edit modal)

**File to edit:** `src/pages/TransactionsPage.tsx`

**What this does:** The `EditModal` and `ReviewItem` components already have a plan selector dropdown — it is shown when `effectiveCorpus === 'YES' && activePlans.length > 1`. This is the correct behaviour per the spec. This task verifies the existing implementation is complete and adds one small improvement: auto-select the single active plan when `activePlans.length === 1` (currently no auto-selection happens; the field is hidden).

Review the existing code at lines 466–620 and lines 623–800 of `TransactionsPage.tsx`:

- In `ReviewItem`: the plan selector is already rendered at line 574 (`{effectiveCorpus === 'YES' && activePlans.length > 1 && (...)}`)
- In `EditModal`: a plan selector also exists (after line 643)

The only gap is that when exactly **one** active plan exists, `planId` stays null and the transaction gets FY-range attributed. The spec says "if single active plan, auto-select (no extra step)". We should auto-populate `planId` when the user selects Corpus category and exactly one active plan is available.

### 6a — Auto-select in `ReviewItem`

- [ ] In `ReviewItem`, the `category` select's `onChange` handler currently does:

```typescript
onChange={e => {
  setCategory(e.target.value)
  if (e.target.value === 'Corpus') setCorpus('YES')
  else { setCorpus('NO'); setPlanId(null) }
}}
```

Change it to auto-select the single active plan when one exists:

```typescript
onChange={e => {
  setCategory(e.target.value)
  if (e.target.value === 'Corpus') {
    setCorpus('YES')
    if (activePlans.length === 1) setPlanId(activePlans[0].id)
  } else {
    setCorpus('NO')
    setPlanId(null)
  }
}}
```

### 6b — Auto-select in `EditModal`

- [ ] In `EditModal`, `handleCategoryChange` currently does:

```typescript
function handleCategoryChange(val: string) {
  setCategory(val)
  if (val === 'Corpus') { setCorpus('YES') }
  else { setCorpus('NO'); setPlanId(null) }
}
```

Change it to:

```typescript
function handleCategoryChange(val: string) {
  setCategory(val)
  if (val === 'Corpus') {
    setCorpus('YES')
    if (activePlans.length === 1) setPlanId(activePlans[0].id)
  } else {
    setCorpus('NO')
    setPlanId(null)
  }
}
```

- [ ] Run `npx tsc --noEmit` — must pass.

- [ ] Verify manually: with exactly one active corpus plan, open a Corpus transaction's edit modal and change its category to "Corpus". The plan selector should not appear (only 1 plan) but the plan ID should be auto-populated on save. With 2+ active plans, the dropdown should appear as before.

- [ ] Commit:
  ```
  git add src/pages/TransactionsPage.tsx
  git commit -m "feat(transactions): auto-select corpus plan when exactly one active plan exists"
  ```

---

## Task 7 — Final TypeScript check and integration smoke test

- [ ] Run `npx tsc --noEmit` one final time — must produce zero errors.

- [ ] Manual smoke test checklist:
  - [ ] `/corpus` loads without console errors
  - [ ] With 2 active plans: amber warning banner visible at top of page
  - [ ] Dismissing banner hides it (session-only)
  - [ ] Selecting a draft plan → clicking "Activate plan" → overlap dialog appears with correct plan names
  - [ ] "Collection Calendar" tab renders, flat codes visible as rows, installment columns present
  - [ ] Cell colors: green/amber/red/grey visible based on payment status
  - [ ] When `collected > target` for any plan: "Surplus: ₹X" badge appears in consolidated banner
  - [ ] `/transactions` → Review queue → select Corpus category → plan dropdown appears if 2+ active plans
  - [ ] `/transactions` → All Transactions → edit a corpus transaction → plan dropdown if 2+ active plans

- [ ] Final commit (if any cleanup done):
  ```
  git add -p
  git commit -m "chore(corpus): stream 2 cleanup and final tsc pass"
  ```

---

## Appendix — Key code locations for reference

| Symbol | File | Line (approx) |
|---|---|---|
| `CorpusPage()` | `src/pages/CorpusPage.tsx` | 25 |
| `activePlans` derivation | `src/pages/CorpusPage.tsx` | 50 |
| `ConsolidatedBanner` | `src/pages/CorpusPage.tsx` | 313 |
| `ActivatePlanDialog` | `src/pages/CorpusPage.tsx` | 1127 |
| Tab bar array | `src/pages/CorpusPage.tsx` | 202 |
| `ReviewItem` plan selector | `src/pages/TransactionsPage.tsx` | 574 |
| `EditModal` plan selector | `src/pages/TransactionsPage.tsx` | ~740 |
| `get_overlapping_active_plans` | `supabase/migrations/029_corpus_v2.sql` | (new) |

## Appendix — `CorpusEntry` and `CorpusPlan` types (from `src/lib/supabase.ts`)

```typescript
interface CorpusPlan {
  id: string
  name: string
  description: string | null
  total_target: number
  pre_payments: number
  planned_budget: { category: string; budget: number }[]
  status: 'draft' | 'active' | 'completed' | 'cancelled'
  start_fiscal_year: number | null
  end_fiscal_year: number | null
  closed_at: string | null
  close_notes: string | null
  created_at: string
}

interface CorpusEntry {
  flat_code: string
  block: string
  flat_type: string
  plan_id: string
  plan_name: string
  plan_status: 'draft' | 'active' | 'completed' | 'cancelled'
  start_fiscal_year: number
  end_fiscal_year: number
  corpus_target: number
  pre_payment: number
  carry_forward_amount: number
  effective_target: number
  collected: number
  balance: number
  pct_paid: number
  last_payment_date: string | null
  status: 'Done' | 'Partial' | 'Pending'
}
```
