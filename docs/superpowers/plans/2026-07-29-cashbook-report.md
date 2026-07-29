# Monthly Cashbook Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new "Cashbook" tab to `/reports` showing, for one calendar month at a time: opening balance, closing balance, receipts (CR) by category, payments (DR) by category with payee-level detail, and a pending-dues summary — with Excel and PDF export.

**Architecture:** One new tab-component (`CashbookTab`) added as a sibling function inside the existing single-file `src/pages/ReportPage.tsx` (matches how `RPStatementTab`, `BalanceSheetTab`, `ExpenditureReportsTab` etc. already live there), backed entirely by existing data: the `fn_bank_balance_as_of()` Postgres function (migration 033) for balances, `transactions` for CR splitup, `expenses` (+ its `category_id`/`vendor_id`/`staff_id` foreign keys) for payee-level DR splitup, and `v_dues_tracker` for pending dues. PDF export adds one new component, `CashbookDoc`, to the existing `src/components/reports/AgmPdfDocs.tsx`, following the `RPStatementDoc` pattern exactly.

**Tech Stack:** React 18 + TypeScript, TanStack Query, Supabase JS (embedded foreign-key selects), `xlsx` (SheetJS) for Excel export, `@react-pdf/renderer` (lazy-loaded) for PDF export, Tailwind utility classes matching this page's existing `surface`/`ds-field`/`btn-primary` conventions.

## Global Constraints

- No database migrations — this plan is 100% client-side, reusing `fn_bank_balance_as_of`, `transactions`, `expenses`, `expense_categories`, `staff`, `vendors`, `v_dues_tracker` exactly as they exist today.
- `npx tsc --noEmit` must pass before every commit.
- Repo is **PUBLIC** — no fixture, script, or committed file in this plan may contain real resident/flat/amount data. All manual verification happens against the live dev DB in the running app, never captured into a file.
- Follow this file's existing conventions exactly: `formatINR` from `@/lib/tagger` for on-screen amounts, the page-local `formatINR` inside `AgmPdfDocs.tsx` for PDF amounts (do not import one into the other), `XLSX.utils.aoa_to_sheet` + `book_append_sheet` + `writeFile` for Excel, the `surface`/`hairline`/`ds-field` Tailwind utility classes already used by every other tab on this page.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  ```

---

### Task 1: Cashbook tab — data queries + full read-only UI

**Files:**
- Modify: `src/pages/ReportPage.tsx:30` (add `monthLabelToRange` helper after `FISCAL_MONTHS`)
- Modify: `src/pages/ReportPage.tsx:83` (`ReportTab` union)
- Modify: `src/pages/ReportPage.tsx:207-225` (tab bar array)
- Modify: `src/pages/ReportPage.tsx:227-233` (render switch)
- Modify: `src/pages/ReportPage.tsx:1816-1818` (insert new `CashbookTab` section before the R&P Statement tab's comment header)

**Interfaces:**
- Consumes: `MONTHS_SHORT`, `FISCAL_MONTHS`, `currentFiscalLabel`, `formatINR`, `supabase`, `useState`, `useQuery`, `AlertTriangle` icon — all already imported/defined earlier in this file.
- Produces: `monthLabelToRange(label: string): { start: string; end: string; prevEnd: string }`; `resolveExpensePayee(e): string`; types `CrCategoryRow { category: string; amount: number }`, `DrPayeeRow { name: string; amount: number }`, `DrCategoryGroup { category: string; total: number; payees: DrPayeeRow[] }`; the `CashbookTab` component itself (no props). Task 2 and Task 3 both extend `CashbookTab`'s body in place.

- [ ] **Step 1: Add the `monthLabelToRange` helper**

In `src/pages/ReportPage.tsx`, after this existing line:

```ts
const FISCAL_MONTHS = buildFiscalMonths()
```

add:

```ts

function monthLabelToRange(label: string) {
  const [mon, yy] = label.split('-')
  const monthIndex = MONTHS_SHORT.indexOf(mon)
  const year = 2000 + Number(yy)
  const lastDay = new Date(year, monthIndex + 1, 0).getDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    start:   `${year}-${pad(monthIndex + 1)}-01`,
    end:     `${year}-${pad(monthIndex + 1)}-${pad(lastDay)}`,
    prevEnd: new Date(year, monthIndex, 0).toISOString().slice(0, 10),
  }
}
```

- [ ] **Step 2: Add `'cashbook'` to the `ReportTab` union**

Change:

```ts
type ReportTab = 'monthly' | 'flat' | 'aging' | 'agm' | 'utility' | 'expenditure' | 'rp' | 'balance-sheet'
```

to:

```ts
type ReportTab = 'monthly' | 'flat' | 'aging' | 'agm' | 'utility' | 'expenditure' | 'cashbook' | 'rp' | 'balance-sheet'
```

- [ ] **Step 3: Add the tab bar entry**

In the tab bar array (inside the default-exported `ReportPage` component), change:

```tsx
          { key: 'expenditure',   label: 'Expenditure' },
          { key: 'rp',            label: 'R&P Statement' },
```

to:

```tsx
          { key: 'expenditure',   label: 'Expenditure' },
          { key: 'cashbook',      label: 'Cashbook' },
          { key: 'rp',            label: 'R&P Statement' },
```

- [ ] **Step 4: Add the render switch entry**

Change:

```tsx
      {tab === 'expenditure'   && <ExpenditureReportsTab />}
      {tab === 'rp'            && <RPStatementTab />}
```

to:

```tsx
      {tab === 'expenditure'   && <ExpenditureReportsTab />}
      {tab === 'cashbook'      && <CashbookTab />}
      {tab === 'rp'            && <RPStatementTab />}
```

- [ ] **Step 5: Add the `CashbookTab` component**

Immediately before this existing comment:

```tsx
// ── R&P STATEMENT TAB ─────────────────────────────────────────

function RPStatementTab() {
```

insert:

```tsx
// ── CASHBOOK TAB ──────────────────────────────────────────────

interface CrCategoryRow { category: string; amount: number }
interface DrPayeeRow { name: string; amount: number }
interface DrCategoryGroup { category: string; total: number; payees: DrPayeeRow[] }

function resolveExpensePayee(e: {
  payee_type: string
  payee_name_raw: string | null
  vendor: { name: string } | null
  staff_member: { name: string } | null
}): string {
  if (e.payee_type === 'Staff')  return e.staff_member?.name ?? e.payee_name_raw ?? 'Cash / Misc'
  if (e.payee_type === 'Vendor') return e.vendor?.name ?? e.payee_name_raw ?? 'Cash / Misc'
  return e.payee_name_raw ?? 'Cash / Misc'
}

function CashbookTab() {
  const [month, setMonth] = useState(currentFiscalLabel)
  const { start, end, prevEnd } = monthLabelToRange(month)

  const { data: openingBalance = 0 } = useQuery({
    queryKey: ['cashbook-opening', prevEnd],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_bank_balance_as_of', { p_date: prevEnd })
      if (error) throw error
      return (data as number) ?? 0
    },
  })

  const { data: closingBalance = 0 } = useQuery({
    queryKey: ['cashbook-closing', end],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_bank_balance_as_of', { p_date: end })
      if (error) throw error
      return (data as number) ?? 0
    },
  })

  const { data: crSplitup } = useQuery({
    queryKey: ['cashbook-cr', start, end],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('category, amount')
        .eq('cr_dr', 'CR')
        .neq('row_type', 'VOIDED')
        .gte('value_date', start)
        .lte('value_date', end)
      const grouped = new Map<string, number>()
      for (const t of data ?? []) {
        const cat = (t as any).category ?? 'Other'
        grouped.set(cat, (grouped.get(cat) ?? 0) + ((t as any).amount ?? 0))
      }
      return Array.from(grouped.entries())
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount) as CrCategoryRow[]
    },
  })

  const { data: drSplitup } = useQuery({
    queryKey: ['cashbook-dr', start, end],
    queryFn: async () => {
      const { data } = await supabase
        .from('expenses')
        .select(`
          amount, payee_type, payee_name_raw,
          category:category_id(name),
          vendor:vendor_id(name),
          staff_member:staff_id(name)
        `)
        .gte('expense_date', start)
        .lte('expense_date', end)
        .is('voided_at', null)
      const grouped = new Map<string, Map<string, number>>()
      for (const row of data ?? []) {
        const e = row as any
        const cat = e.category?.name ?? 'Uncategorised'
        const payee = resolveExpensePayee(e)
        if (!grouped.has(cat)) grouped.set(cat, new Map())
        const payeeMap = grouped.get(cat)!
        payeeMap.set(payee, (payeeMap.get(payee) ?? 0) + (e.amount ?? 0))
      }
      return Array.from(grouped.entries())
        .map(([category, payeeMap]) => ({
          category,
          total: Array.from(payeeMap.values()).reduce((s, v) => s + v, 0),
          payees: Array.from(payeeMap.entries())
            .map(([name, amount]) => ({ name, amount }))
            .sort((a, b) => b.amount - a.amount),
        }))
        .sort((a, b) => b.total - a.total) as DrCategoryGroup[]
    },
  })

  const { data: duesRows } = useQuery({
    queryKey: ['cashbook-dues'],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_dues_tracker')
        .select('pending, arrears_maintenance, total_outstanding')
      return (data ?? []) as { pending: number; arrears_maintenance: number; total_outstanding: number }[]
    },
  })

  const totalReceipts = (crSplitup ?? []).reduce((s, r) => s + r.amount, 0)
  const totalPayments = (drSplitup ?? []).reduce((s, r) => s + r.total, 0)

  const pendingRows     = (duesRows ?? []).filter(r => r.pending > 0)
  const arrearsRows     = (duesRows ?? []).filter(r => r.arrears_maintenance > 0)
  const outstandingRows = (duesRows ?? []).filter(r => r.total_outstanding > 0)
  const pendingTotal     = pendingRows.reduce((s, r) => s + r.pending, 0)
  const arrearsTotal     = arrearsRows.reduce((s, r) => s + r.arrears_maintenance, 0)
  const outstandingTotal = outstandingRows.reduce((s, r) => s + r.total_outstanding, 0)

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <div className="flex items-center gap-3 flex-wrap">
        <select value={month} onChange={e => setMonth(e.target.value)} className="ds-field">
          {FISCAL_MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="surface !p-4" style={{ background: 'var(--ink-50)' }}>
          <p className="text-[12px] mb-1" style={{ color: 'var(--ink-500)' }}>Opening balance</p>
          <p className="text-xl font-bold" style={{ color: 'var(--ink-800)' }}>{formatINR(openingBalance)}</p>
        </div>
        <div className="surface !p-4" style={{ background: 'var(--ok-bg)' }}>
          <p className="text-[12px] mb-1" style={{ color: 'var(--ink-500)' }}>Total receipts (CR)</p>
          <p className="text-xl font-bold text-green-700">{formatINR(totalReceipts)}</p>
        </div>
        <div className="surface !p-4" style={{ background: 'var(--bad-bg)' }}>
          <p className="text-[12px] mb-1" style={{ color: 'var(--ink-500)' }}>Total payments (DR)</p>
          <p className="text-xl font-bold text-rose-600">{formatINR(totalPayments)}</p>
        </div>
        <div className="surface !p-4" style={{ background: 'var(--brand-50)' }}>
          <p className="text-[12px] mb-1" style={{ color: 'var(--ink-500)' }}>Closing balance</p>
          <p className="text-xl font-bold text-violet-700">{formatINR(closingBalance)}</p>
        </div>
      </div>

      {/* Receipts / Payments */}
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="surface !p-0 overflow-hidden flex-1">
          <div className="px-5 py-3 border-b hairline" style={{ background: 'var(--ink-50)' }}>
            <h3 className="font-semibold text-sm" style={{ color: 'var(--ink-700)' }}>RECEIPTS (CR)</h3>
          </div>
          {(crSplitup ?? []).length === 0 ? (
            <div className="px-5 py-6 text-center text-sm" style={{ color: 'var(--ink-400)' }}>No receipts for {month}</div>
          ) : (
            (crSplitup ?? []).map(r => (
              <div key={r.category} className="flex justify-between items-center px-5 py-3 border-b hairline text-sm">
                <span style={{ color: 'var(--ink-600)' }}>{r.category}</span>
                <span className="font-semibold" style={{ color: 'var(--ink-800)' }}>{formatINR(r.amount)}</span>
              </div>
            ))
          )}
          <div className="flex justify-between items-center px-5 py-3 text-sm font-bold border-t-2 hairline" style={{ background: 'var(--ok-bg)' }}>
            <span>Total Receipts</span>
            <span className="text-green-700">{formatINR(totalReceipts)}</span>
          </div>
        </div>

        <div className="surface !p-0 overflow-hidden flex-1">
          <div className="px-5 py-3 border-b hairline" style={{ background: 'var(--ink-50)' }}>
            <h3 className="font-semibold text-sm" style={{ color: 'var(--ink-700)' }}>PAYMENTS (DR)</h3>
          </div>
          {(drSplitup ?? []).length === 0 ? (
            <div className="px-5 py-6 text-center text-sm" style={{ color: 'var(--ink-400)' }}>No payments for {month}</div>
          ) : (
            (drSplitup ?? []).map(group => (
              <div key={group.category} className="border-b hairline">
                <div className="flex justify-between items-center px-5 py-2.5 text-sm font-semibold" style={{ color: 'var(--ink-700)' }}>
                  <span>{group.category}</span>
                  <span>{formatINR(group.total)}</span>
                </div>
                {group.payees.map(p => (
                  <div key={p.name} className="flex justify-between items-center pl-8 pr-5 py-1.5 text-[13px]">
                    <span style={{ color: 'var(--ink-500)' }}>{p.name}</span>
                    <span style={{ color: 'var(--ink-600)' }}>{formatINR(p.amount)}</span>
                  </div>
                ))}
              </div>
            ))
          )}
          <div className="flex justify-between items-center px-5 py-3 text-sm font-bold border-t-2 hairline" style={{ background: 'var(--bad-bg)' }}>
            <span>Total Payments</span>
            <span className="text-rose-700">{formatINR(totalPayments)}</span>
          </div>
        </div>
      </div>

      {/* Pending dues */}
      <div className="surface !p-0 overflow-hidden">
        <div className="px-5 py-3 border-b hairline flex items-center gap-2" style={{ background: 'var(--ink-50)' }}>
          <AlertTriangle size={15} className="text-amber-500" />
          <h3 className="font-semibold text-sm" style={{ color: 'var(--ink-700)' }}>PENDING DUES (as of today)</h3>
        </div>
        <div className="flex justify-between items-center px-5 py-3 border-b hairline text-sm">
          <span style={{ color: 'var(--ink-600)' }}>Current FY Pending</span>
          <span className="font-semibold">
            {formatINR(pendingTotal)}{' '}
            <span className="font-normal text-xs" style={{ color: 'var(--ink-400)' }}>({pendingRows.length} flats)</span>
          </span>
        </div>
        <div className="flex justify-between items-center px-5 py-3 border-b hairline text-sm">
          <span style={{ color: 'var(--ink-600)' }}>Arrears (prior years)</span>
          <span className="font-semibold">
            {formatINR(arrearsTotal)}{' '}
            <span className="font-normal text-xs" style={{ color: 'var(--ink-400)' }}>({arrearsRows.length} flats)</span>
          </span>
        </div>
        <div className="flex justify-between items-center px-5 py-3 text-sm font-bold border-t-2 hairline" style={{ background: 'var(--bad-bg)' }}>
          <span>Total Outstanding</span>
          <span className="text-rose-700">
            {formatINR(outstandingTotal)}{' '}
            <span className="font-normal text-xs">({outstandingRows.length} flats)</span>
          </span>
        </div>
      </div>

      <p className="text-xs text-center" style={{ color: 'var(--ink-400)' }}>
        Opening/Closing balance is the audited bank position for {month}. Total Payments (above) is
        the sum of recorded expenses for the month and may not exactly match the bank-derived
        Closing − Opening delta if a cash expense isn't yet linked to a bank transaction.
      </p>
    </div>
  )
}
```

- [ ] **Step 6: Verify compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual check**

`npm run dev`, open `/reports` → click the new "Cashbook" tab. Confirm:
- The month picker defaults to the current month and offers the same range of months as the
  Monthly Summary tab.
- Opening Balance, Total Receipts, Total Payments, Closing Balance cards all show non-placeholder
  amounts for a month with known activity.
- The Receipts panel lists CR categories (e.g. Maintenance, Corpus) with a bold total row.
- The Payments panel lists each expense category as a bold subtotal row with its payees indented
  underneath — for a month with a staff salary run, confirm each staff member appears as a
  separate line under "Salary" and their amounts sum to the category subtotal shown.
- The Pending Dues panel shows three rows (Current FY Pending, Arrears, Total Outstanding) with
  plausible flat counts — cross-check the Total Outstanding figure against the Dues Aging tab for
  the current FY, which should show the same total (mind that Dues Aging is FY-scoped while this
  total is cumulative-to-date, so they should match whenever `dues_start_fiscal_year` is the
  current FY).
- Switching months updates every figure.

- [ ] **Step 8: Commit**

```bash
git add src/pages/ReportPage.tsx
git commit -m "$(cat <<'EOF'
feat(reports): add Cashbook tab with opening/closing balance and CR/DR splitup

Opening/closing balance via fn_bank_balance_as_of, CR receipts grouped by
category, DR payments grouped by category then payee, and a pending-dues
summary (current FY / arrears / total outstanding).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Cashbook Excel export

**Files:**
- Modify: `src/pages/ReportPage.tsx` — `CashbookTab` (add `handleExcelExport`, add the button row)

**Interfaces:**
- Consumes: `CashbookTab`'s existing `month`, `openingBalance`, `closingBalance`, `crSplitup`,
  `drSplitup`, `totalReceipts`, `totalPayments`, `pendingTotal`, `pendingRows`, `arrearsTotal`,
  `arrearsRows`, `outstandingTotal`, `outstandingRows` (all from Task 1, same function scope).
  `XLSX` and `Download` are already imported at the top of this file (used by every other tab's
  export button).
- Produces: `handleExcelExport()` inside `CashbookTab`; no new exports for later tasks (Task 3
  only touches the JSX around this button, not the function itself).

- [ ] **Step 1: Add `handleExcelExport` and the button row**

In `CashbookTab`, change:

```tsx
  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <div className="flex items-center gap-3 flex-wrap">
        <select value={month} onChange={e => setMonth(e.target.value)} className="ds-field">
          {FISCAL_MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
```

to:

```tsx
  function handleExcelExport() {
    const wb = XLSX.utils.book_new()
    const rows: any[][] = [
      [`Lilac Apartment Association — Cashbook — ${month}`], [],
      ['Opening Balance', openingBalance],
      [],
      ['RECEIPTS'],
      ...(crSplitup ?? []).map(r => [`  ${r.category}`, r.amount]),
      ['  Total Receipts', totalReceipts],
      [],
      ['PAYMENTS'],
      ...(drSplitup ?? []).flatMap(group => [
        [`  ${group.category}`, group.total],
        ...group.payees.map(p => [`    ${p.name}`, p.amount]),
      ]),
      ['  Total Payments', totalPayments],
      [],
      ['Closing Balance', closingBalance],
      [],
      ['PENDING DUES (as of today)'],
      ['  Current FY Pending', pendingTotal, `${pendingRows.length} flats`],
      ['  Arrears (prior years)', arrearsTotal, `${arrearsRows.length} flats`],
      ['  Total Outstanding', outstandingTotal, `${outstandingRows.length} flats`],
    ]
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [32, 14, 14].map(w => ({ wch: w }))
    XLSX.utils.book_append_sheet(wb, ws, 'Cashbook')
    XLSX.writeFile(wb, `Lilac_Cashbook_${month}.xlsx`)
  }

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <div className="flex items-center gap-3 flex-wrap">
        <select value={month} onChange={e => setMonth(e.target.value)} className="ds-field">
          {FISCAL_MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <div className="ml-auto">
          <button onClick={handleExcelExport}
            className="flex items-center gap-1.5 text-sm hover:opacity-80" style={{ color: 'var(--brand-700)' }}>
            <Download size={14} /> Export Excel
          </button>
        </div>
      </div>
```

- [ ] **Step 2: Verify compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual check**

`npm run dev` → `/reports` → Cashbook tab → "Export Excel". Open the downloaded
`Lilac_Cashbook_<month>.xlsx` and confirm: Opening Balance row, RECEIPTS block with each category
and a Total Receipts row, PAYMENTS block with each category followed by its indented payee rows
and a Total Payments row, Closing Balance row, and a PENDING DUES block with the three rows and
flat counts — all matching the figures on screen.

- [ ] **Step 4: Commit**

```bash
git add src/pages/ReportPage.tsx
git commit -m "$(cat <<'EOF'
feat(reports): add Excel export to Cashbook tab

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Cashbook PDF export

**Files:**
- Modify: `src/components/reports/AgmPdfDocs.tsx` (add `CashbookDoc`, end of file)
- Modify: `src/pages/ReportPage.tsx` — `CashbookTab` (add `generating` state, `handlePdf`, extend
  the button row)

**Interfaces:**
- Consumes: `S`, `formatINR`, `LetterheadHeader`, `LetterheadFooter`, `TableHead` (all already
  defined at the top of `AgmPdfDocs.tsx` and used by every other `*Doc` export in that file);
  `CashbookTab`'s `month`, `openingBalance`, `closingBalance`, `crSplitup`, `drSplitup`,
  `pendingTotal`, `pendingRows`, `arrearsTotal`, `arrearsRows`, `outstandingTotal`,
  `outstandingRows` (Task 1); `triggerDownload` (already defined at module scope in
  `ReportPage.tsx`, used by every other PDF button on this page).
- Produces: `CashbookDoc({ month, openingBalance, closingBalance, receipts, payments, dues, generated })`
  exported from `AgmPdfDocs.tsx`. Nothing downstream consumes it beyond this task's own wiring.

- [ ] **Step 1: Add `CashbookDoc` to `AgmPdfDocs.tsx`**

At the end of `src/components/reports/AgmPdfDocs.tsx`, after the last export in the file, add:

```tsx

// ── Cashbook ────────────────────────────────────────────────────

interface CashbookCrRow { category: string; amount: number }
interface CashbookDrPayee { name: string; amount: number }
interface CashbookDrGroup { category: string; total: number; payees: CashbookDrPayee[] }
interface CashbookDuesRow { label: string; amount: number; flats: number }

export function CashbookDoc({
  month, openingBalance, closingBalance, receipts, payments, dues, generated,
}: {
  month: string
  openingBalance: number
  closingBalance: number
  receipts: CashbookCrRow[]
  payments: CashbookDrGroup[]
  dues: CashbookDuesRow[]
  generated: string
}) {
  const totalReceipts = receipts.reduce((s, r) => s + r.amount, 0)
  const totalPayments = payments.reduce((s, g) => s + g.total, 0)

  return (
    <Document>
      <Page size="A4" style={S.page}>
        <LetterheadHeader style={S.header}>
          <Text style={S.title}>Cashbook — {month}</Text>
          <Text style={S.subtitle}>Opening/closing balance, receipts &amp; payments for {month} only</Text>
        </LetterheadHeader>

        <View style={[S.rowTotal, { marginBottom: 8 }]}>
          <Text style={[S.col, S.bold]}>Opening Balance</Text>
          <Text style={[S.colR, S.bold]}>{formatINR(openingBalance)}</Text>
        </View>

        <View style={S.twoCol}>
          <View style={S.half}>
            <Text style={S.sectionHead}>RECEIPTS (CR)</Text>
            <View style={S.table}>
              {receipts.length === 0 ? (
                <Text style={[S.small, { paddingVertical: 4 }]}>No receipts for {month}</Text>
              ) : (
                receipts.map((r, i) => (
                  <View key={r.category} style={[S.row, i % 2 === 1 ? S.rowAlt : {}]}>
                    <Text style={S.col}>{r.category}</Text>
                    <Text style={S.colR}>{formatINR(r.amount)}</Text>
                  </View>
                ))
              )}
              <View style={S.rowTotal}>
                <Text style={[S.col, S.bold]}>Total Receipts</Text>
                <Text style={[S.colR, S.bold]}>{formatINR(totalReceipts)}</Text>
              </View>
            </View>
          </View>

          <View style={S.half}>
            <Text style={S.sectionHead}>PAYMENTS (DR)</Text>
            <View style={S.table}>
              {payments.length === 0 ? (
                <Text style={[S.small, { paddingVertical: 4 }]}>No payments for {month}</Text>
              ) : (
                payments.map(group => (
                  <View key={group.category}>
                    <View style={S.row}>
                      <Text style={[S.col, S.bold]}>{group.category}</Text>
                      <Text style={[S.colR, S.bold]}>{formatINR(group.total)}</Text>
                    </View>
                    {group.payees.map(p => (
                      <View key={p.name} style={S.row}>
                        <Text style={[S.col, S.small, { paddingLeft: 8 }]}>{p.name}</Text>
                        <Text style={[S.colR, S.small]}>{formatINR(p.amount)}</Text>
                      </View>
                    ))}
                  </View>
                ))
              )}
              <View style={S.rowTotal}>
                <Text style={[S.col, S.bold]}>Total Payments</Text>
                <Text style={[S.colR, S.bold]}>{formatINR(totalPayments)}</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={[S.rowTotal, { marginTop: 8 }]}>
          <Text style={[S.col, S.bold]}>Closing Balance</Text>
          <Text style={[S.colR, S.bold]}>{formatINR(closingBalance)}</Text>
        </View>

        <Text style={[S.sectionHead, { marginTop: 12 }]}>PENDING DUES (AS OF TODAY)</Text>
        <View style={S.table}>
          {dues.map((d, i) => (
            <View key={d.label} style={i === dues.length - 1 ? S.rowTotal : S.row}>
              <Text style={i === dues.length - 1 ? [S.col, S.bold] : S.col}>{d.label} ({d.flats} flats)</Text>
              <Text style={i === dues.length - 1 ? [S.colR, S.bold, { color: '#dc2626' }] : S.colR}>
                {formatINR(d.amount)}
              </Text>
            </View>
          ))}
        </View>

        <LetterheadFooter style={S.footer} generated={generated} />
      </Page>
    </Document>
  )
}
```

- [ ] **Step 2: Add `generating` state, `handlePdf`, and extend the button row in `CashbookTab`**

In `src/pages/ReportPage.tsx`, change:

```tsx
function CashbookTab() {
  const [month, setMonth] = useState(currentFiscalLabel)
  const { start, end, prevEnd } = monthLabelToRange(month)
```

to:

```tsx
function CashbookTab() {
  const [month, setMonth] = useState(currentFiscalLabel)
  const { start, end, prevEnd } = monthLabelToRange(month)
  const [generating, setGenerating] = useState(false)
```

Then change (this is the button row Task 2 added):

```tsx
        <div className="ml-auto">
          <button onClick={handleExcelExport}
            className="flex items-center gap-1.5 text-sm hover:opacity-80" style={{ color: 'var(--brand-700)' }}>
            <Download size={14} /> Export Excel
          </button>
        </div>
      </div>
```

to:

```tsx
        <div className="ml-auto flex items-center gap-2">
          <button onClick={handleExcelExport}
            className="flex items-center gap-1.5 text-sm hover:opacity-80" style={{ color: 'var(--brand-700)' }}>
            <Download size={14} /> Export Excel
          </button>
          <button onClick={handlePdf} disabled={generating}
            className="btn-primary flex items-center gap-2 py-2 px-4 text-sm disabled:opacity-50">
            {generating
              ? <><Loader2 size={14} className="animate-spin" /> Generating PDF…</>
              : <><FileText size={14} /> Download PDF</>
            }
          </button>
        </div>
      </div>
```

Then, immediately after `handleExcelExport`'s closing `}` (added in Task 2, right before the
`return (` of `CashbookTab`), add:

```tsx

  async function handlePdf() {
    setGenerating(true)
    try {
      const [{ pdf }, { CashbookDoc }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/reports/AgmPdfDocs'),
      ])
      const generated = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      const blob = await pdf(
        <CashbookDoc
          month={month}
          openingBalance={openingBalance}
          closingBalance={closingBalance}
          receipts={crSplitup ?? []}
          payments={drSplitup ?? []}
          dues={[
            { label: 'Current FY Pending',    amount: pendingTotal,     flats: pendingRows.length },
            { label: 'Arrears (prior years)', amount: arrearsTotal,     flats: arrearsRows.length },
            { label: 'Total Outstanding',     amount: outstandingTotal, flats: outstandingRows.length },
          ]}
          generated={generated}
        />
      ).toBlob()
      triggerDownload(blob, `Lilac_Cashbook_${month}.pdf`)
    } finally {
      setGenerating(false)
    }
  }
```

- [ ] **Step 3: Verify compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual check**

`npm run dev` → `/reports` → Cashbook tab → "Download PDF". Confirm the button shows "Generating
PDF…" briefly, then a `Lilac_Cashbook_<month>.pdf` downloads with the Lilac letterhead, Opening
Balance, a two-column Receipts/Payments layout (payments showing bold category rows with indented
payee lines beneath, matching the on-screen nesting), Closing Balance, and a Pending Dues section
with the Total Outstanding row in red — all figures matching what's shown on screen and in the
Excel export from Task 2.

- [ ] **Step 5: Commit**

```bash
git add src/components/reports/AgmPdfDocs.tsx src/pages/ReportPage.tsx
git commit -m "$(cat <<'EOF'
feat(reports): add PDF export to Cashbook tab

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
