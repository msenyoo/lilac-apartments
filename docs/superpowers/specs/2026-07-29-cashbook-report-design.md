# Monthly Cashbook Report

**Status:** Draft 2026-07-29
**Author:** Senthil + Claude
**Migration:** none — reuses existing `fn_bank_balance_as_of()` and tables/views, no schema change

## Problem

The committee wants a monthly report that reads like a cashbook: how much money was there at the
start of the month, what came in, what went out (broken down enough to actually see who got paid
what), and how much is left — plus a reminder of what's still owed by residents. The existing
`/reports` tabs don't cover this together: Monthly Summary has no balances; R&P Statement has
balances but is FY-scoped and payments are category totals only (no payee detail); Balance Sheet
is a point-in-time snapshot, not a monthly flow.

## Scope

- **In scope:** a new `Cashbook` tab on `/reports`, one calendar month at a time (same month
  picker convention — `MMM-YY` — as the existing Monthly Summary tab), showing:
  - Opening balance, Total Receipts (CR), Total Payments (DR), Closing balance
  - Receipts (CR) broken down by category (Maintenance / Corpus / Interest / etc.)
  - Payments (DR) broken down by category, and *within* each category by payee — e.g.
    `Salary → Kasi ₹8,500, Kannan ₹7,000, Kolam ₹200`; `Corpus → Painting payment 1 ₹1,00,000`
  - Pending dues section: Current FY Pending (amount + flat count), Arrears from prior years
    (amount + flat count), Total Outstanding (amount + flat count) — as of *today*, not
    month-end (dues tracking is always "as of now" elsewhere in the app too)
  - Excel export and PDF export (PDF follows the existing `AgmPdfDocs.tsx` letterhead pattern)
- **Out of scope:**
  - Receipts (CR) do **not** drill into per-flat detail — that's already covered by the
    "Collections by flat" table on the Monthly Summary tab.
  - No new database objects. All data comes from `fn_bank_balance_as_of()`, `transactions`,
    `expenses` (+ `staff`/`vendors`/`expense_categories`), and `v_dues_tracker`.
  - No automatic reconciliation between the DR payee-level total and the bank-derived
    Opening→Closing delta (see **Known non-reconciliation** below — this mirrors how the
    existing R&P Statement tab already works).
  - No "future month" selection — the month picker only offers months up to the current one,
    same as every other tab on this page.

## Design

### Tab wiring

- Add `'cashbook'` to the `ReportTab` union and the tab bar array in `ReportPage.tsx`, rendering
  `<CashbookTab />`. Placed after `expenditure`, before `rp` (keeps monthly reports grouped
  before the FY-level ones).
- `CashbookTab` owns its own `month` state (`useState(currentFiscalLabel)`), independent of the
  Monthly Summary tab's month state, consistent with how `ExpenditureReportsTab` /
  `DuesAgingTab` each own their own FY selector rather than sharing one.

### Month → date range

New module-level helper (next to `buildFiscalMonths`):

```ts
function monthLabelToRange(label: string) {
  const [mon, yy] = label.split('-')
  const monthIndex = MONTHS_SHORT.indexOf(mon)
  const year = 2000 + Number(yy)
  const lastDay = new Date(year, monthIndex + 1, 0).getDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  const prevMonthIndex = monthIndex === 0 ? 11 : monthIndex - 1
  const prevYear = monthIndex === 0 ? year - 1 : year
  const prevLastDay = new Date(prevYear, prevMonthIndex + 1, 0).getDate()
  return {
    start: `${year}-${pad(monthIndex + 1)}-01`,
    end:   `${year}-${pad(monthIndex + 1)}-${pad(lastDay)}`,
    prevEnd: `${prevYear}-${pad(prevMonthIndex + 1)}-${pad(prevLastDay)}`, // last day of prior month, plain arithmetic (no Date→toISOString round-trip, which rolls back a day in UTC+5:30)
  }
}
```

### Data queries

All scoped by `{ start, end, prevEnd } = monthLabelToRange(month)`:

1. **Opening balance** — `supabase.rpc('fn_bank_balance_as_of', { p_date: prevEnd })`
2. **Closing balance** — `supabase.rpc('fn_bank_balance_as_of', { p_date: end })`
3. **CR splitup** — `transactions` where `cr_dr='CR'`, `row_type<>'VOIDED'`,
   `value_date` between `start`/`end`, `select('category, amount')`, grouped client-side by
   `category` (same aggregation pattern already used in `AGMReportsTab`'s `income` memo).
4. **DR splitup** — `expenses` where `expense_date` between `start`/`end`, `voided_at is null`,
   `select('amount, description, category_id, payee_type, staff_id, vendor_id, payee_name_raw')`,
   joined client-side to `expense_categories` (name), `staff` (name), `vendors` (name) — same
   three lookups `ExpenditureReportsTab`'s vendor-wise query already does. Grouped into
   `{ category: string, total: number, payees: { name: string; amount: number }[] }[]`, where
   `payees` groups line rows by resolved payee name (staff name → vendor name → `payee_name_raw`
   → `'Cash / Misc'`, same fallback chain as `ExpenditureReportsTab`).
5. **Pending dues** — `v_dues_tracker` (`select('pending, arrears_maintenance, total_outstanding')`,
   no FY filter needed since the view is already cumulative-to-date):
   - Current FY Pending: `sum(pending)` where `pending > 0`, count of rows where `pending > 0`
   - Arrears: `sum(arrears_maintenance)` where `arrears_maintenance > 0`, count where `> 0`
   - Total Outstanding: `sum(total_outstanding)` where `total_outstanding > 0`, count where `> 0`

### Known non-reconciliation

Total Payments (sum of the DR panel, from `expenses`) is not forced to equal
`Closing Balance − Opening Balance − Total Receipts`. The two can differ by cash expenses not yet
linked to a bank row, or bank DR rows not yet entered as an expense — the same gap the existing
R&P Statement tab already lives with (its `payments` also comes from `expenses`, independent of
the bank-derived balance). Closing/Opening balance is the authoritative bank position either way,
since it comes straight from `fn_bank_balance_as_of()`. A footer note says so, wording modeled on
the existing Balance Sheet tab's footer note.

### UI layout

Mirrors `RPStatementTab`'s structure:

1. Month picker (`ds-field` select, `FISCAL_MONTHS` options) + Export Excel / Download PDF buttons
2. KPI strip (4 cards, `grid grid-cols-2 lg:grid-cols-4`): Opening Balance, Total Receipts,
   Total Payments, Closing Balance
3. Two-column surface (`S.twoCol` equivalent — `flex gap-4` with two `surface` panels):
   - Left: **RECEIPTS** — flat list of category rows + total, same row style as
     `RPStatementTab`'s receipts panel
   - Right: **PAYMENTS** — for each category: a bold subtotal row, then indented payee rows
     (smaller text, `pl-4`), same visual nesting `UtilityTab`'s block/period grouping uses
4. **Pending Dues** surface: three rows (Current FY Pending, Arrears, Total Outstanding), each
   showing `formatINR(amount)` and `(N flats)`, Total Outstanding row bolded/bordered like the
   totals row in `DuesAgingTab`
5. Footer note (`text-xs text-center`) about the DR non-reconciliation caveat

### Excel export

One sheet, `aoa_to_sheet`, following the header-block + table convention used by
`FlatStatementTab.handleExport`:

```
Lilac Apartment Association — Cashbook — <month>
Opening Balance                    <amt>
RECEIPTS
  <category>                       <amt>   (repeated)
  Total Receipts                   <amt>
PAYMENTS
  <category>                       <amt>
    <payee>                        <amt>   (repeated, indented via leading spaces in cell text)
  Total Payments                   <amt>
Closing Balance                    <amt>
PENDING DUES (as of today)
  Current FY Pending    <amt>   <N> flats
  Arrears               <amt>   <N> flats
  Total Outstanding     <amt>   <N> flats
```

### PDF export

New `CashbookDoc` in `AgmPdfDocs.tsx`, modeled directly on `RPStatementDoc` (same `S.twoCol`
two-panel layout, same letterhead/footer) with:
- Header: "Cashbook — {month}"
- Opening/Closing balance rows above and below the two-column receipts/payments block, styled
  like `RPStatementDoc`'s total rows
- Payments column shows category subtotal rows in bold, payee rows in regular weight indented
  (`{ paddingLeft: 8 }`) beneath — same nesting idea as the UI, translated to `@react-pdf/renderer`
  `View`/`Text` primitives
- A third section below the two columns: **Pending Dues** (three rows, Total Outstanding bolded),
  same table pattern as `DefaultersListDoc`'s total row

## Testing

No new Playwright coverage planned — this is a read-only reporting tab following the exact
pattern of five other read-only reporting tabs on this page that have no dedicated e2e tests
today (Expenditure, Utility, AGM, R&P, Balance Sheet). Verification is manual: `npx tsc --noEmit`
must pass; then in the running dev app, open Reports → Cashbook, pick a month with known expenses
(e.g. one with staff salary + a corpus payment), and confirm:
- Opening/Closing balance match what `fn_bank_balance_as_of` would return for the day before/last
  day of that month (spot-check via Balance Sheet or R&P tab for a nearby date)
- Payments panel correctly nests payees under their category and the category subtotal equals the
  sum of its payees
- Pending dues counts and totals match the Dues Aging tab for the same "as of today" snapshot
- Excel and PDF downloads open correctly and contain the same figures shown on screen

## Acceptance

- New "Cashbook" tab appears on `/reports`, between Expenditure and R&P Statement.
- Selecting a month shows correct Opening Balance, Closing Balance, Total Receipts, Total
  Payments, CR category breakdown, DR category→payee breakdown, and the three pending-dues rows.
- Payee names resolve staff → vendor → raw payee name → "Cash / Misc", matching existing
  vendor-wise expense report behavior.
- Excel export and PDF export both succeed and contain matching figures.
- `npx tsc --noEmit` passes.
