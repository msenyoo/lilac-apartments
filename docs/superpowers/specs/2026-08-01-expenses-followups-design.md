# Expenses Page Follow-ups — Design

**Status:** Approved 2026-08-01
**Author:** Senthil + Claude
**Migration:** `043_pending_item_quantity.sql`

## Problem

Five gaps reported after using the Expenses page day-to-day:

1. Pending items (the quick-capture draft flow) can't record quantity/unit/rate, even
   though `expense_line_items` gained free-form quantity tracking in commit `63ad454`.
   When a pending item is bundled or attached into an expense, that data is simply
   missing and has to be re-entered by hand on the resulting line item.
2. The Day Book list has no pagination — every expense ever recorded renders in one
   unbounded scroll.
3. No way to filter Day Book by date range or category — only free-text search exists.
4. Category shows as plain text in list rows, hard to scan visually.
5. Reports (Expenditure by category/vendor/month, category drill-down, Utility report,
   Cashbook DR split-up, R&P payments, AGM expenditure) include expenses that are still
   awaiting committee approval or not yet reconciled with the bank — inflating report
   totals with amounts that aren't yet confirmed.

## Scope

- **In scope:** the five items above.
- **Out of scope:** period_from/period_to on pending items (explicitly not needed per
  user); server-side pagination (client-side is sufficient at current data volume);
  attachment support in the bulk-add grid (unchanged — single-item dialog already
  covers receipts); changing the TDS register's date basis (pre-existing quirk,
  unrelated to this fix).

## 1. Pending item ↔ line item quantity parity

### Schema — migration `043_pending_item_quantity.sql`

```sql
ALTER TABLE public.pending_line_items
  ADD COLUMN IF NOT EXISTS utility_units numeric,
  ADD COLUMN IF NOT EXISTS utility_rate  numeric,
  ADD COLUMN IF NOT EXISTS unit_label    text;
```

### `bundle_pending_items` RPC

`CREATE OR REPLACE` with the same signature; the `INSERT INTO expense_line_items`
column list and `SELECT` gain `utility_units, utility_rate, unit_label`.

### UI — `PendingItemDialog` (`src/pages/ExpensesPage.tsx`)

Add the same Qty / Unit / Rate mini-row used in `AddExpenseDialog`'s line-item card
(register `utility_units`/`utility_rate`/`unit_label`, auto-calc `amount` on change,
unit defaults from the selected category's `unit_label` when present). `PendingItem`
interface and `pendingItemSchema`/`PendingItemForm` gain the three optional fields.

### UI — `BulkAddPendingDialog` / `bulkPendingRows.ts`

`BulkDraftRow` gains `utility_units`, `utility_rate`, `unit_label` (strings, like
`amount`). Two extra grid columns (Qty, Rate — unit label reuses the row's category
default, shown as a placeholder, editable). Not part of clipboard paste parsing
(Date/Description/Amount/Category stays as-is) — new rows can still be filled by hand
after paste.

### `AddExpenseDialog` picker — `handlePick`

The `append({...})` call (around line 1198) gains
`utility_units: item.utility_units ?? undefined, utility_rate: item.utility_rate ?? undefined, unit_label: item.unit_label ?? undefined`.

## 2. Day Book pagination

`DayBook`'s `filteredExpenses` (already a derived array) is paginated client-side:
page size selector (25/50/100, default 25), Prev/Next, "showing X–Y of N". Page resets
to 1 whenever `search`, the new date-range, or category filter changes.

## 3. Filters — date range + category

Toolbar gains: From date, To date (native `<input type="date">`), and a category
`<select>` (options = active `expense_categories`, plus "All categories"). Combined
with search in one `useMemo`. Category match: `e.category?.id === selected` OR any
`e.line_items[].category?.id === selected` (mirrors the line-item-aware category truth
already established via `v_expense_category_spend`). Date range matches
`e.expense_date`. A "Clear filters" affordance appears when any filter is active.

## 4. Category badges

New helper `categoryBadgeClass(name: string)` — deterministic hash of the category
name into one of 8 Tailwind bg/text pairs (same visual language as `STATUS_STYLE`).
Applied where category currently renders as plain text: Day Book list rows and
Pending Items list rows. Category name renders as a small rounded pill instead of
inline text.

## 5. Exclude pending-approval / unreconciled expenses from reports

New `src/lib/expenseFilters.ts`:

```ts
export function applyReportableFilter<T extends { eq: any; or: any }>(q: T): T {
  return q
    .eq('approval_status', 'approved')
    .or('payment_mode.eq.Cash,payment_mode.eq.Direct,transaction_id.not.is.null,reconciled_at.not.is.null')
}
```

`approval_status` defaults to `'approved'` for all pre-existing rows (migration 031's
`NOT NULL DEFAULT 'approved'`), so this is safe against historical data. Cash and
Direct payments are settled by definition and always pass; Online/Bank/Cheque
payments pass once `transaction_id` or `reconciled_at` is set (i.e. status ≠
"Unreconciled" per the existing `expenseStatus()`/`v_expense_reconciliation` logic).
Rejected and pending-approval expenses are always excluded.

Applied to every `expenses` header query used for reporting in `ReportPage.tsx`:
AGM expenditure, category-wise/vendor-wise/monthly-trend (Expenditure Reports tab),
`CategoryDrillDownDialog`, `UtilityReport`, Cashbook DR split-up, R&P payments. Since
each of these already derives its line-item queries from the header's `id` list
(`headerIds`), filtering the header query cascades correctly without touching the
line-item queries.

The TDS register query is the one exception — it queries `expense_line_items`
directly by `created_at`, with no header join today. It gets a small addition: fetch
reportable header ids for the same window first (reusing `applyReportableFilter`),
then `.in('expense_id', headerIds)` on the line-item query.

## Acceptance

- Add a pending item with Qty 5 × Rate 20 (Unit "liters") → bundle it → the resulting
  expense's line item shows "5 liters × ₹20".
- Bulk-add two rows with quantity filled in → both carry through to the pending list
  and (after bundling) to the line item.
- Day Book with 60+ expenses shows 25 per page by default; changing page size or
  filters resets to page 1.
- Filtering Day Book by date range + category narrows the list; category badges are
  visually distinct and consistent per category name.
- Create an expense, leave it `approval_status='pending'` (or Online/unreconciled) →
  it does not appear in Expenditure Reports, Utility report, Cashbook, or AGM R&P
  statement totals; approving it (or reconciling it) makes it appear.
