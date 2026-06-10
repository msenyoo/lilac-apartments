# Owner Transparency — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give flat owners visibility into how their corpus contributions are used, a downloadable annual maintenance statement PDF, and a society financial health strip.

**Architecture:** All changes in `OwnerPortalPage.tsx` plus a new `OwnerStatementPdf.tsx` component. No schema changes. All queries scoped to the logged-in owner's flat; society aggregates show totals only (no per-flat breakdown of others).

**Tech Stack:** React 18, TypeScript, Supabase JS, react-query, @react-pdf/renderer, Shadcn/ui, Tailwind CSS

**Source spec:** `docs/superpowers/specs/2026-06-10-financial-intelligence-design.md` — Stream 5 section

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/pages/OwnerPortalPage.tsx` | Add health strip, corpus expenditure section, statement download button + FY selector |
| Create | `src/components/reports/OwnerStatementPdf.tsx` | `@react-pdf/renderer` document — maintenance month table + corpus summary |

No migrations. No route changes. No schema changes.

---

## Task 1 — Society Financial Health Strip

**File:** `src/pages/OwnerPortalPage.tsx`

Add three read-only KPI cards below the flat identity card. Each card fetches society-wide aggregates. No individual flat data of other residents is exposed.

### Step 1.1 — Add three new query hooks

- [ ] Open `src/pages/OwnerPortalPage.tsx`.

Add the following three `useQuery` calls inside `OwnerPortalPage()`, after the existing `payments` query (around line 143), before the `upi`/`bank` constant lines.

```typescript
// --- Society health: maintenance collection rate this FY ---
const { data: healthMaintenance } = useQuery<{ cleared: number; total: number }>({
  queryKey: ['health-maintenance'],
  queryFn: async () => {
    const { data } = await supabase
      .from('v_dues_tracker')
      .select('status')
    const rows = (data ?? []) as { status: string }[]
    return {
      cleared: rows.filter(r => r.status === 'Clear').length,
      total:   rows.length,
    }
  },
  staleTime: 5 * 60 * 1000,
})

// --- Society health: corpus progress across all plans ---
const { data: healthCorpus } = useQuery<{ collected: number; target: number }>({
  queryKey: ['health-corpus'],
  queryFn: async () => {
    const { data } = await supabase
      .from('v_corpus_tracker')
      .select('collected,effective_target')
    const rows = (data ?? []) as { collected: number; effective_target: number }[]
    return {
      collected: rows.reduce((s, r) => s + (r.collected ?? 0), 0),
      target:    rows.reduce((s, r) => s + (r.effective_target ?? 0), 0),
    }
  },
  staleTime: 5 * 60 * 1000,
})

// --- Society health: most recent non-voided expense ---
interface LastExpenseRow {
  expense_date: string
  amount: number
  category: { name: string } | null
}
const { data: lastExpense } = useQuery<LastExpenseRow | null>({
  queryKey: ['health-last-expense'],
  queryFn: async () => {
    const { data } = await supabase
      .from('expenses')
      .select('expense_date,amount,category:category_id(name)')
      .is('voided_at', null)
      .order('expense_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    return data as LastExpenseRow | null
  },
  staleTime: 5 * 60 * 1000,
})
```

### Step 1.2 — Render the health strip in JSX

- [ ] In the JSX `return` block, locate the flat identity card `{/* Flat identity */}` (around line 163). Insert the `SocietyHealthStrip` component immediately after the closing `</div>` of that card, before the dues card.

First, add this helper component above the `OwnerPortalPage` function (after the `StatusPill` component):

```typescript
interface HealthCardProps { label: string; value: string; sub?: string }
function HealthCard({ label, value, sub }: HealthCardProps) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-400)' }}>{label}</p>
      <p className="text-[14px] font-bold truncate" style={{ color: 'var(--ink-800)' }}>{value}</p>
      {sub && <p className="text-[11.5px]" style={{ color: 'var(--ink-400)' }}>{sub}</p>}
    </div>
  )
}
```

Then in the JSX, insert after the flat identity card's closing `</div>`:

```tsx
{/* Society financial health strip */}
<div className="surface !p-4">
  <p className="text-[11px] font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--ink-400)' }}>
    Society overview
  </p>
  <div className="grid grid-cols-3 gap-3 divide-x" style={{ borderColor: 'var(--ink-100)' }}>
    <HealthCard
      label="Maintenance cleared"
      value={healthMaintenance ? `${healthMaintenance.cleared} of ${healthMaintenance.total} flats` : '—'}
    />
    <div className="pl-3">
      <HealthCard
        label="Corpus collected"
        value={
          healthCorpus && healthCorpus.target > 0
            ? `${Math.round((healthCorpus.collected / healthCorpus.target) * 100)}% of ${formatINR(healthCorpus.target)}`
            : '—'
        }
      />
    </div>
    <div className="pl-3">
      <HealthCard
        label="Last expense"
        value={lastExpense ? formatINR(lastExpense.amount) : '—'}
        sub={
          lastExpense
            ? `${(lastExpense.category as any)?.name ?? 'Expense'} · ${new Date(lastExpense.expense_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
            : undefined
        }
      />
    </div>
  </div>
</div>
```

### Step 1.3 — TypeScript check

- [ ] Run `npx tsc --noEmit` from `D:\projects\lilac-apartments`. Fix any type errors before proceeding.

### Step 1.4 — Commit

- [ ] `git add src/pages/OwnerPortalPage.tsx`
- [ ] `git commit -m "feat(owner-portal): society financial health strip — 3 KPI cards"`

---

## Task 2 — Corpus Expenditure Visibility

**File:** `src/pages/OwnerPortalPage.tsx`

New section "How Your Corpus Is Used" rendered after the corpus contribution cards. For each active plan the flat participates in, show a breakdown of expenses by category.

### Step 2.1 — Add types and corpus expenditure query

- [ ] Add the following interfaces near the top of the file, after the existing `TxnRow` interface (around line 31):

```typescript
interface CorpusExpenseRow {
  amount: number
  expense_date: string
  category: { name: string } | null
  corpus_plan: { name: string } | null
}

interface CorpusExpenseGroup {
  categoryName: string
  totalSpent: number
  firstDate: string
  lastDate: string
  count: number
}

interface CorpusPlanExpenses {
  planId: string
  planName: string
  groups: CorpusExpenseGroup[]
  totalSpent: number
}
```

- [ ] Add the following `useQuery` inside `OwnerPortalPage()`, after the `lastExpense` query from Task 1:

```typescript
// --- Corpus expenditure by plan (for plans this flat is in) ---
const activePlanIds = corpusList.map(c => c.plan_id)

const { data: corpusExpenses = [] } = useQuery<CorpusPlanExpenses[]>({
  queryKey: ['corpus-expenses-by-plan', activePlanIds],
  enabled: activePlanIds.length > 0,
  queryFn: async () => {
    const { data } = await supabase
      .from('expenses')
      .select('amount,expense_date,category:category_id(name),corpus_plan:corpus_plan_id(name)')
      .in('corpus_plan_id', activePlanIds)
      .is('voided_at', null)
      .order('expense_date', { ascending: true })

    const rows = (data ?? []) as CorpusExpenseRow[]

    // Group by plan then by category, client-side
    const planMap = new Map<string, CorpusPlanExpenses>()

    // Seed plan entries from corpusList so order is preserved
    for (const c of corpusList) {
      planMap.set(c.plan_id, {
        planId:     c.plan_id,
        planName:   c.plan_name,
        groups:     [],
        totalSpent: 0,
      })
    }

    for (const row of rows) {
      const planName = (row.corpus_plan as any)?.name ?? ''
      // Find planId by name (corpus_plan FK returns name only, not id)
      const planEntry = [...planMap.values()].find(p => p.planName === planName)
      if (!planEntry) continue

      const catName = (row.category as any)?.name ?? 'Other'
      let group = planEntry.groups.find(g => g.categoryName === catName)
      if (!group) {
        group = { categoryName: catName, totalSpent: 0, firstDate: row.expense_date, lastDate: row.expense_date, count: 0 }
        planEntry.groups.push(group)
      }
      group.totalSpent  += row.amount
      group.count       += 1
      group.lastDate     = row.expense_date
      planEntry.totalSpent += row.amount
    }

    return [...planMap.values()].filter(p => p.totalSpent > 0)
  },
})
```

> **Note:** The `corpus_plan` join returns `{ name: string }` from PostgREST. We match on plan name to reunite with the planId. This is safe because plan names are unique in practice; if a future plan has a duplicate name, the first match wins — acceptable for a read-only display.

### Step 2.2 — Render the section in JSX

- [ ] In the JSX, locate the comment `{/* Previous corpus arrears from closed plans */}` (around line 311). Insert the corpus expenditure section immediately **before** that comment block:

```tsx
{/* How Your Corpus Is Used */}
{corpusExpenses.length > 0 && (
  <div className="surface !p-5 flex flex-col gap-4">
    <div className="flex items-center gap-2">
      <Receipt size={16} style={{ color: 'var(--brand-600)' }} />
      <p className="font-semibold text-[14px]">How your corpus is used</p>
    </div>
    {corpusExpenses.map(plan => (
      <div key={plan.planId} className="flex flex-col gap-2">
        <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-400)' }}>
          {plan.planName} · {formatINR(plan.totalSpent)} spent
        </p>
        <div className="flex flex-col gap-1">
          {plan.groups.map(g => (
            <div key={g.categoryName} className="flex items-start justify-between gap-2 py-1.5 border-b last:border-0" style={{ borderColor: 'var(--ink-100)' }}>
              <div className="flex flex-col gap-0.5 min-w-0">
                <p className="text-[13px] font-medium truncate" style={{ color: 'var(--ink-800)' }}>{g.categoryName}</p>
                <p className="text-[11px]" style={{ color: 'var(--ink-400)' }}>
                  {new Date(g.firstDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                  {g.firstDate !== g.lastDate && ` – ${new Date(g.lastDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`}
                  {` · ${g.count} payment${g.count !== 1 ? 's' : ''}`}
                </p>
              </div>
              <span className="font-semibold text-[13px] shrink-0" style={{ color: 'var(--ink-700)' }}>
                {formatINR(g.totalSpent)}
              </span>
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
)}
```

### Step 2.3 — TypeScript check

- [ ] Run `npx tsc --noEmit`. Fix any errors.

### Step 2.4 — Commit

- [ ] `git add src/pages/OwnerPortalPage.tsx`
- [ ] `git commit -m "feat(owner-portal): corpus expenditure visibility — How Your Corpus Is Used section"`

---

## Task 3 — Annual Statement PDF component

**File:** `src/components/reports/OwnerStatementPdf.tsx` (new file)

This file must be lazy-loaded (no top-level `@react-pdf/renderer` import in OwnerPortalPage). It follows the exact same pattern as `AgmPdfDocs.tsx`.

### Step 3.1 — Create OwnerStatementPdf.tsx

- [ ] Create `src/components/reports/OwnerStatementPdf.tsx` with the following content:

```typescript
// Lazy-loaded via React.lazy — keep @react-pdf/renderer imports here only
import {
  Document, Page, Text, View, StyleSheet,
} from '@react-pdf/renderer'

// ── Styles ────────────────────────────────────────────────────

const S = StyleSheet.create({
  page:        { fontFamily: 'Helvetica', fontSize: 9, padding: 36, color: '#1e293b' },
  header:      { marginBottom: 16, borderBottom: '1.5pt solid #7c3aed', paddingBottom: 8 },
  title:       { fontSize: 13, fontFamily: 'Helvetica-Bold', color: '#7c3aed', marginBottom: 2 },
  subtitle:    { fontSize: 8, color: '#64748b' },
  sectionHead: {
    fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#475569',
    textTransform: 'uppercase', letterSpacing: 0.6,
    marginTop: 12, marginBottom: 4,
    borderBottom: '0.5pt solid #e2e8f0', paddingBottom: 2,
  },
  table:       { marginBottom: 8 },
  row:         { flexDirection: 'row', borderBottom: '0.3pt solid #f1f5f9', paddingVertical: 3 },
  rowAlt:      { backgroundColor: '#f8fafc' },
  rowTotal:    { flexDirection: 'row', borderTop: '1pt solid #94a3b8', paddingTop: 4, marginTop: 4 },
  col:         { flex: 1, paddingHorizontal: 3 },
  colR:        { flex: 1, paddingHorizontal: 3, textAlign: 'right' },
  bold:        { fontFamily: 'Helvetica-Bold' },
  small:       { fontSize: 7, color: '#64748b' },
  footer:      { position: 'absolute', bottom: 20, left: 36, right: 36, fontSize: 7, color: '#94a3b8', textAlign: 'center' },
  summaryBox:  { backgroundColor: '#f8fafc', borderRadius: 4, padding: 8, border: '0.5pt solid #e2e8f0', marginBottom: 8 },
  summaryRow:  { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
})

// ── Helpers ───────────────────────────────────────────────────

function fmtINR(n: number): string {
  if (n === 0) return '-'
  const abs = Math.abs(Math.round(n))
  const s   = abs.toString()
  const last3 = s.slice(-3)
  const rest  = s.slice(0, -3)
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3
  return (n < 0 ? '-' : '') + 'Rs.' + grouped
}

function PageFooter({ generated }: { generated: string }) {
  return (
    <Text style={S.footer} fixed>
      Lilac Apartment Association · Rajakil Pakkam, Chennai · Generated {generated}
    </Text>
  )
}

function TableHead({ cols }: { cols: { label: string; right?: boolean; flex?: number }[] }) {
  return (
    <View style={[S.row, { backgroundColor: '#f1f5f9' }]}>
      {cols.map((c, i) => (
        <Text key={i} style={[c.right ? S.colR : S.col, S.bold, c.flex ? { flex: c.flex } : {}]}>
          {c.label}
        </Text>
      ))}
    </View>
  )
}

// ── Types ─────────────────────────────────────────────────────

export interface MaintenanceMonthRow {
  month: string        // e.g. "Apr-25"
  due: number
  paid: number
  balance: number
}

export interface CorpusPlanSummaryRow {
  planName: string
  target: number
  paid: number
  balance: number
}

export interface OwnerStatementData {
  flatCode: string
  block: string
  ownerName: string
  fyLabel: string
  maintenanceRows: MaintenanceMonthRow[]
  corpusRows: CorpusPlanSummaryRow[]
  totalMaintPaid: number
  totalCorpusPaid: number
  generated: string
}

// ── Document ──────────────────────────────────────────────────

export function OwnerStatementDoc({ data }: { data: OwnerStatementData }) {
  return (
    <Document>
      <Page size="A4" style={S.page}>

        {/* Header */}
        <View style={S.header}>
          <Text style={S.title}>Annual Maintenance Statement — {data.fyLabel}</Text>
          <Text style={S.subtitle}>The Lilac Apartment Association · Rajakil Pakkam, Chennai</Text>
          <Text style={[S.subtitle, { marginTop: 2 }]}>
            Flat {data.flatCode} · Block {data.block}
            {data.ownerName ? ` · ${data.ownerName}` : ''}
          </Text>
        </View>

        {/* Summary boxes */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          {[
            { label: 'Total maintenance paid', value: fmtINR(data.totalMaintPaid) },
            { label: 'Total corpus paid',      value: fmtINR(data.totalCorpusPaid) },
            { label: 'Total paid',             value: fmtINR(data.totalMaintPaid + data.totalCorpusPaid) },
          ].map(({ label, value }) => (
            <View key={label} style={{ flex: 1, ...S.summaryBox }}>
              <Text style={S.small}>{label}</Text>
              <Text style={[S.bold, { fontSize: 10, marginTop: 2 }]}>{value}</Text>
            </View>
          ))}
        </View>

        {/* Maintenance month-by-month */}
        <Text style={S.sectionHead}>MAINTENANCE — MONTH BY MONTH</Text>
        <View style={S.table}>
          <TableHead cols={[
            { label: 'Month', flex: 2 },
            { label: 'Due',   right: true },
            { label: 'Paid',  right: true },
            { label: 'Balance', right: true },
          ]} />
          {data.maintenanceRows.map((r, i) => (
            <View key={r.month} style={[S.row, i % 2 === 1 ? S.rowAlt : {}]}>
              <Text style={[S.col, { flex: 2 }]}>{r.month}</Text>
              <Text style={S.colR}>{fmtINR(r.due)}</Text>
              <Text style={[S.colR, r.paid > 0 ? { color: '#16a34a' } : {}]}>{fmtINR(r.paid)}</Text>
              <Text style={[S.colR, r.balance > 0 ? { color: '#dc2626' } : { color: '#16a34a' }]}>
                {r.balance > 0 ? fmtINR(r.balance) : 'Paid'}
              </Text>
            </View>
          ))}
          <View style={S.rowTotal}>
            <Text style={[S.col, S.bold, { flex: 2 }]}>Total</Text>
            <Text style={[S.colR, S.bold]}>{fmtINR(data.maintenanceRows.reduce((s, r) => s + r.due, 0))}</Text>
            <Text style={[S.colR, S.bold, { color: '#16a34a' }]}>{fmtINR(data.totalMaintPaid)}</Text>
            <Text style={[S.colR, S.bold]}>
              {fmtINR(data.maintenanceRows.reduce((s, r) => s + r.due, 0) - data.totalMaintPaid)}
            </Text>
          </View>
        </View>

        {/* Corpus per-plan summary */}
        {data.corpusRows.length > 0 && (
          <>
            <Text style={S.sectionHead}>CORPUS FUND — PLAN SUMMARY</Text>
            <View style={S.table}>
              <TableHead cols={[
                { label: 'Plan', flex: 3 },
                { label: 'Target',  right: true },
                { label: 'Paid',    right: true },
                { label: 'Balance', right: true },
              ]} />
              {data.corpusRows.map((r, i) => (
                <View key={r.planName} style={[S.row, i % 2 === 1 ? S.rowAlt : {}]}>
                  <Text style={[S.col, { flex: 3 }]}>{r.planName}</Text>
                  <Text style={S.colR}>{fmtINR(r.target)}</Text>
                  <Text style={[S.colR, { color: '#16a34a' }]}>{fmtINR(r.paid)}</Text>
                  <Text style={[S.colR, r.balance > 0 ? { color: '#d97706' } : { color: '#16a34a' }]}>
                    {r.balance > 0 ? fmtINR(r.balance) : 'Done'}
                  </Text>
                </View>
              ))}
              <View style={S.rowTotal}>
                <Text style={[S.col, S.bold, { flex: 3 }]}>Total</Text>
                <Text style={[S.colR, S.bold]}>{fmtINR(data.corpusRows.reduce((s, r) => s + r.target, 0))}</Text>
                <Text style={[S.colR, S.bold, { color: '#16a34a' }]}>{fmtINR(data.totalCorpusPaid)}</Text>
                <Text style={[S.colR, S.bold]}>
                  {fmtINR(data.corpusRows.reduce((s, r) => s + r.balance, 0))}
                </Text>
              </View>
            </View>
          </>
        )}

        <PageFooter generated={data.generated} />
      </Page>
    </Document>
  )
}
```

### Step 3.2 — TypeScript check on new file

- [ ] Run `npx tsc --noEmit`. The new file has no React import needed (JSX transform) — if tsc complains about JSX, confirm `tsconfig.json` has `"jsx": "react-jsx"`. Fix any errors.

### Step 3.3 — Commit the PDF component

- [ ] `git add src/components/reports/OwnerStatementPdf.tsx`
- [ ] `git commit -m "feat(owner-portal): OwnerStatementPdf component — maintenance month table + corpus plan summary"`

---

## Task 4 — Download Statement button and FY selector in OwnerPortalPage

**File:** `src/pages/OwnerPortalPage.tsx`

Add a "Download Statement" button to the page header area, with an FY selector. Clicking the button: queries the maintenance months for the selected FY, builds the `OwnerStatementData` payload, lazy-loads the PDF component and `@react-pdf/renderer`, generates a blob, and triggers download.

### Step 4.1 — Add FY helpers and imports

- [ ] At the top of `src/pages/OwnerPortalPage.tsx`, extend the import line for lucide-react to include `FileText` and `Loader2`:

```typescript
import { IndianRupee, Building2, CheckCircle2, AlertCircle, Clock, Receipt, FileText, Loader2 } from 'lucide-react'
```

- [ ] Add the following helper functions after `currentFiscalYear()` (around line 36), before `elapsedMonthsSince`:

```typescript
function buildFiscalYears(): { year: number; label: string; start: string; end: string }[] {
  const now = new Date()
  const currentFyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  const years = []
  for (let y = 2022; y <= currentFyYear; y++) {
    years.push({
      year:  y,
      label: `FY ${y}-${String(y + 1).slice(-2)}`,
      start: `${y}-04-01`,
      end:   `${y + 1}-03-31`,
    })
  }
  return years.reverse()
}

const FISCAL_YEAR_LIST = buildFiscalYears()

const MONTHS_IN_ORDER = ['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar']

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href     = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
```

### Step 4.2 — Add state for FY selector and generating flag

- [ ] Inside `OwnerPortalPage()`, after the `const { flatId } = useRoleCtx()` line, add:

```typescript
const [statementFyYear, setStatementFyYear] = useState<number>(() => currentFiscalYear())
const [generatingStatement, setGeneratingStatement] = useState(false)
```

### Step 4.3 — Implement the handleDownloadStatement function

- [ ] Inside `OwnerPortalPage()`, after the `corpusExpenses` query, add the following function. It must be inside the component body so it can close over `myFlat`, `dues`, `corpusList`, and `payments`:

```typescript
async function handleDownloadStatement() {
  if (!myFlat) return
  setGeneratingStatement(true)
  try {
    const fy = FISCAL_YEAR_LIST.find(f => f.year === statementFyYear)
    if (!fy) return

    // Fetch all CR transactions for this flat in the selected FY
    const { data: fyPayments } = await supabase
      .from('transactions')
      .select('id,value_date,amount,fiscal_month,corpus,fiscal_year')
      .eq('flat_code', myFlat.code)
      .eq('cr_dr', 'CR')
      .eq('fiscal_year', fy.year)
      .neq('row_type', 'VOIDED')

    const fyTxns = (fyPayments ?? []) as {
      id: string; value_date: string; amount: number
      fiscal_month: string | null; corpus: string; fiscal_year: number | null
    }[]

    const monthlyRate = myFlat.maintenance_amt

    // Determine which months fall within this FY and up to today
    const now   = new Date()
    const cutoff = fy.year === currentFiscalYear() ? now : new Date(`${fy.year + 1}-03-31`)

    const maintenanceRows = MONTHS_IN_ORDER
      .map(mon => {
        // Map fiscal month label to calendar year
        const calYear = ['Jan', 'Feb', 'Mar'].includes(mon) ? fy.year + 1 : fy.year
        const monthDate = new Date(`${calYear}-${new Date(`${mon} 1`).getMonth() + 1}-01`)
        if (monthDate > cutoff) return null

        const shortLabel = `${mon}-${String(calYear).slice(-2)}`
        // Sum maintenance (non-corpus) payments tagged to this fiscal_month
        const paid = fyTxns
          .filter(t => t.corpus !== 'YES' && t.fiscal_month === mon)
          .reduce((s, t) => s + t.amount, 0)

        return {
          month:   shortLabel,
          due:     monthlyRate,
          paid,
          balance: Math.max(0, monthlyRate - paid),
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)

    // Corpus: use the corpusList already loaded (filtered by current FY plan — acceptable for statement)
    // For the selected FY, sum corpus payments from fyTxns
    const corpusPaid = fyTxns
      .filter(t => t.corpus === 'YES')
      .reduce((s, t) => s + t.amount, 0)

    const corpusRows = corpusList.map(c => ({
      planName: c.plan_name,
      target:   c.corpus_target,
      paid:     c.collected,
      balance:  c.balance,
    }))

    const totalMaintPaid   = maintenanceRows.reduce((s, r) => s + r.paid, 0)
    const totalCorpusPaid  = corpusPaid

    // Fetch owner name from residents (best-effort)
    let ownerName = ''
    const { data: resData } = await supabase
      .from('residents')
      .select('name')
      .eq('flat_id', myFlat.id)
      .eq('type', 'Owner')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
    if (resData) ownerName = (resData as { name: string }).name

    const generated = new Date().toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    })

    const [{ pdf }, { OwnerStatementDoc }] = await Promise.all([
      import('@react-pdf/renderer'),
      import('@/components/reports/OwnerStatementPdf'),
    ])

    const blob = await pdf(
      <OwnerStatementDoc data={{
        flatCode:        myFlat.code,
        block:           myFlat.block,
        ownerName,
        fyLabel:         fy.label,
        maintenanceRows,
        corpusRows,
        totalMaintPaid,
        totalCorpusPaid,
        generated,
      }} />
    ).toBlob()

    triggerDownload(blob, `Statement_${myFlat.code}_${fy.label.replace(/\s/g, '_')}.pdf`)
  } finally {
    setGeneratingStatement(false)
  }
}
```

### Step 4.4 — Render the header controls

- [ ] In the JSX `return`, locate the opening `<div className="flex flex-col gap-5 fade-in max-w-2xl">` (line 162). Replace it with a wrapper that adds a page header row above the flat identity card. The full `return` opening should become:

```tsx
return (
  <div className="flex flex-col gap-5 fade-in max-w-2xl">
    {/* Page header: title + download controls */}
    <div className="flex items-center justify-between flex-wrap gap-3">
      <div>
        <h1 className="text-[22px] font-extrabold" style={{ color: 'var(--ink-900)' }}>My Flat</h1>
        <p className="text-[13px]" style={{ color: 'var(--ink-400)' }}>Your maintenance &amp; corpus summary</p>
      </div>
      <div className="flex items-center gap-2">
        <select
          value={statementFyYear}
          onChange={e => setStatementFyYear(Number(e.target.value))}
          className="ds-field text-sm"
        >
          {FISCAL_YEAR_LIST.map(f => (
            <option key={f.year} value={f.year}>{f.label}</option>
          ))}
        </select>
        <button
          onClick={handleDownloadStatement}
          disabled={!myFlat || generatingStatement}
          className="btn-primary flex items-center gap-2 py-1.5 px-3 text-sm disabled:opacity-40"
        >
          {generatingStatement
            ? <><Loader2 size={14} className="animate-spin" /> Generating…</>
            : <><FileText size={14} /> Download Statement</>
          }
        </button>
      </div>
    </div>
```

Make sure to keep all the existing JSX inside this wrapper (the flat identity card, dues card, etc.) and the closing `</div>` at the end of the return block remains.

### Step 4.5 — TypeScript check

- [ ] Run `npx tsc --noEmit`. Common issues to watch for:
  - `useState` import — add `useState` to the React import if not present: `import { useState } from 'react'`
  - The dynamic `import('@react-pdf/renderer')` returns `{ pdf: Function }` — TypeScript may need a cast. If `pdf(...)` gives a type error, cast: `const { pdf } = await import('@react-pdf/renderer') as any`
  - The JSX in `handleDownloadStatement` (`<OwnerStatementDoc ... />`) requires the component to be in scope at the call site — this is fine since it's imported dynamically and used immediately after `await`.

  Fix all errors before continuing.

### Step 4.6 — Commit

- [ ] `git add src/pages/OwnerPortalPage.tsx`
- [ ] `git commit -m "feat(owner-portal): Download Statement button — FY selector + annual PDF generation"`

---

## Task 5 — Smoke test and final TypeScript check

### Step 5.1 — Run the dev server

- [ ] Run `npm run dev` (or confirm dev server is running at http://localhost:5173).

### Step 5.2 — Manual smoke test (owner account)

Log in as an owner user (an account with `role = 'owner'` and a `flat_id` assigned in `profiles`).

- [ ] Navigate to `/my-flat` (or the owner portal route).
- [ ] Verify the **Society overview** strip appears below the flat identity card with three KPI cards. Values should be non-zero numbers if any dues/corpus data exists.
- [ ] Verify the **How your corpus is used** section appears below the corpus contribution cards if the flat's plan has any expenses linked. If the flat is not on any active corpus plan, the section should be absent (no rendering for empty `corpusExpenses`).
- [ ] Select a FY in the header selector and click **Download Statement**. The button should show "Generating…" briefly, then the browser should prompt to save a PDF named `Statement_<FlatCode>_FY_YYYY-YY.pdf`.
- [ ] Open the PDF and verify: header has correct flat/owner/FY, maintenance table has months from April of the selected FY through the current month (or March end for past FY), corpus section lists all plans with target/paid/balance, footer shows society name and generation date.

### Step 5.3 — Final TypeScript check

- [ ] Run `npx tsc --noEmit` one last time. Zero errors required before pushing.

### Step 5.4 — Final commit

- [ ] `git add src/pages/OwnerPortalPage.tsx src/components/reports/OwnerStatementPdf.tsx`
- [ ] `git commit -m "feat(owner-portal): stream 5 owner transparency — health strip, corpus expenditure, annual statement PDF"`

---

## Appendix: Key Query Reference

| Query | Table/View | Filter |
|-------|-----------|--------|
| Health: maintenance cleared | `v_dues_tracker` | None — count all rows, filter `status='Clear'` client-side |
| Health: corpus progress | `v_corpus_tracker` | None — sum `collected` + `effective_target` |
| Health: last expense | `expenses` | `voided_at IS NULL`, order by `expense_date DESC`, limit 1 |
| Corpus expenditure | `expenses` | `corpus_plan_id IN (owner's plan ids)`, `voided_at IS NULL` |
| Statement: FY transactions | `transactions` | `flat_code = flat.code`, `cr_dr = 'CR'`, `fiscal_year = selectedFy`, `row_type != 'VOIDED'` |
| Statement: owner name | `residents` | `flat_id = flat.id`, `type = 'Owner'`, `is_active = true` |

## Appendix: Fiscal Year Month Order

Within a single FY (e.g. FY 2025-26), months run April → March:
```
Apr-25, May-25, Jun-25, Jul-25, Aug-25, Sep-25, Oct-25, Nov-25, Dec-25, Jan-26, Feb-26, Mar-26
```
The `MONTHS_IN_ORDER` constant in Task 4.1 (`['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar']`) maps each month name to a calendar year offset: Jan/Feb/Mar use `fy.year + 1`, all others use `fy.year`.

## Appendix: PDF formatINR note

`@react-pdf/renderer` does not support `Intl.NumberFormat` reliably (PDF renderer runs outside the browser sandbox). The `fmtINR` function in `OwnerStatementPdf.tsx` manually formats Indian-style grouping (same pattern as `AgmPdfDocs.tsx`) and must NOT import `formatINR` from `src/lib/tagger.ts`.
