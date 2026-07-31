# Payment Receipt (PDF + WhatsApp share) — Design

## Problem

Residents and committee members have no way to generate a receipt for an individual
maintenance or corpus payment. Today, payment history is only visible as read-only
rows in the Dues, Corpus, and Owner Portal pages — there's no downloadable or
shareable record of a single payment.

## Goal

Add a "Download / Share Receipt" action next to each payment in the existing payment
history lists (Dues page, Corpus page, Owner Portal) that:
- Generates a one-page PDF receipt for that single payment
- Lets the user share it directly to WhatsApp (or any app) via the OS share sheet on
  mobile, or downloads it on desktop

## Non-goals

- No persistent/sequential receipt numbers. Receipts are generated on-the-fly from
  the transaction row each time — no schema changes, no new DB table or column.
- No bulk/multi-payment receipt generation (e.g. "all payments this FY in one PDF").
  Single-payment only.
- No new "payment mode" concept. The `transactions` table has no payment-mode field
  (that's an expenses-only concept); the receipt uses the bank narration
  (`description`) as its reference line instead.

## Existing patterns this reuses

- **PDF generation**: `@react-pdf/renderer`, following the style of
  `src/components/reports/OwnerStatementPdf.tsx` (own `StyleSheet`, wrapped in
  `LetterheadHeader/LetterheadFooter` from `src/components/reports/Letterhead.tsx`).
- **Share mechanism**: `sharePdf()` in `src/lib/approvalPacket.ts` — already used by
  `ExpensesPage.tsx`'s Approval Packet button. Uses `navigator.canShare({ files })` +
  `navigator.share()` to open the native share sheet (WhatsApp shows up there on
  mobile); falls back to a plain `<a download>` on desktop/unsupported browsers.
  Reused as-is, no changes to this function.
- **Lazy-loading**: PDF renderer and doc component are dynamically imported on click,
  matching `ExpensesPage.tsx`'s `handleSharePdf`.

## Data source

Payments in all three integration points are rows from the `transactions` table
(CR, `category = 'Maintenance'` or `corpus = 'YES'`, `row_type != 'VOIDED'`). Split
payments (see `TransactionsPage.tsx`'s split flow) already appear as their own clean
per-flat, per-category rows once split — no special-casing needed for the receipt.

Relevant `Transaction` fields used: `value_date`, `amount`, `description`,
`category`, `corpus`, `plan_id`, `months_covered`, `flat_code`.

## Components

### 1. `src/components/reports/PaymentReceiptPdf.tsx` (new)

A react-pdf `Document`, one A4 page, following `OwnerStatementPdf.tsx`'s style
conventions (own local `StyleSheet.create()` — not a shared style module, matching
how `AgmPdfDocs.tsx` / `ApprovalPacketPdf.tsx` / `OwnerStatementPdf.tsx` each define
their own styles).

```ts
export interface PaymentReceiptData {
  flatCode: string
  block: string
  amount: number
  valueDate: string          // ISO date
  categoryLabel: string      // "Maintenance" or "Corpus Fund — <plan name>"
  periodCovered: string | null   // from months_covered, null if absent
  reference: string          // transactions.description (bank narration)
  generated: string          // display-formatted date, same convention as other PDFs
}

export function PaymentReceiptDoc({ data }: { data: PaymentReceiptData }) { ... }
```

Layout:
- `LetterheadHeader`: title "Payment Receipt", subtitle "Flat {flatCode} · Block {block}"
- Prominent amount box (reuse `summaryBox` style pattern from `OwnerStatementPdf.tsx`)
- Rows: Date paid, Category, Period covered (omitted entirely when null), Reference
- `LetterheadFooter` with `generated` date (same as all other PDFs)

### 2. `src/lib/paymentReceipt.ts` (new)

Pure mapping function, no DB calls:

```ts
export function buildReceiptData(
  txn: Pick<Transaction, 'value_date' | 'amount' | 'description' | 'category' | 'corpus' | 'months_covered'>,
  flat: { code: string; block: string },
  planName: string | null,
): PaymentReceiptData
```

- `categoryLabel`: `corpus === 'YES' ? `Corpus Fund — ${planName ?? 'Corpus'}`` : (category ?? 'Maintenance')`
- `periodCovered`: `months_covered` passed through as-is (already human-readable per existing usage), or `null`
- `generated`: formatted with the same `toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })` used elsewhere (e.g. `ExpensesPage.tsx`'s `handleSharePdf`)

Plan name is resolved by the caller (see integration points below) — this function
takes it as a plain string, no corpus_plans query inside.

### 3. `src/components/ReceiptButton.tsx` (new)

```ts
export function ReceiptButton({
  txn, flat, planName,
}: {
  txn: Pick<Transaction, 'id' | 'value_date' | 'amount' | 'description' | 'category' | 'corpus' | 'months_covered'>
  flat: { code: string; block: string }
  planName?: string | null
}) { ... }
```

- Small icon button (Receipt/Download icon from `lucide-react`, matching the icon
  size/style already used in the payment history rows it sits in)
- On click: sets a local `sharing` loading state, dynamically imports
  `@react-pdf/renderer`, `./reports/PaymentReceiptPdf`, and
  `buildReceiptData`/`sharePdf` from their respective lib files, builds the blob via
  `pdf(<PaymentReceiptDoc data={...} />).toBlob()`, calls `sharePdf(blob, filename)`
- Filename: `` `Receipt_${flat.code}_${txn.value_date}.pdf` ``
- Toast on result, same copy pattern as `ExpensesPage.tsx`:
  - shared → "Share sheet opened — pick where to send it"
  - downloaded → "Receipt downloaded — attach it in WhatsApp"
  - error → `toast.error(e.message ?? 'Could not generate the receipt')`
- No role/permission gating — this is a read-derived action (no mutation), available
  to every role that can already see the payment history row, including residents on
  the Owner Portal.

## Integration points

1. **`DuesPage.tsx`** (~line 465, `FlatDetailsPanel`'s payment history row): add
   `<ReceiptButton txn={p} flat={{ code: flat.flat_code, block: flat.block }} />`
   next to the existing amount. No `planName` (Maintenance-only query).

2. **`CorpusPage.tsx`** (~line 856, `FlatCorpusPanel`'s payment history row): add
   `<ReceiptButton txn={p} flat={{ code: flat.flat_code, block: flat.block }} planName={flat.plan_name} />`.
   `flat.plan_name` already exists on the `CorpusEntry` type passed into this panel.

3. **`OwnerPortalPage.tsx`** (~line 750, payments table row): add a receipt icon
   button as a new small action in that row (e.g. an extra narrow column, or inline
   next to the amount cell — final placement decided during implementation to fit
   the existing table layout). `planName` resolved via a `plan_id → plan_name` map
   built from the already-fetched `corpusList` (which carries `plan_id` +
   `plan_name`), looked up by `p.plan_id`; `null` when `p.corpus !== 'YES'`.

## Error handling

- PDF generation failure (e.g. dynamic import fails, `pdf().toBlob()` throws): caught
  in `ReceiptButton`, shown via `toast.error`, loading state cleared. Matches
  `ExpensesPage.tsx`'s existing `handleSharePdf` catch block.
- `sharePdf()`'s own `AbortError` handling (user cancels the share sheet) is already
  handled inside that function — treated as success, no changes needed.

## Testing

No PDF-content snapshot testing exists elsewhere in this codebase (Approval Packet,
AGM PDFs, Owner Statement are all manually verified) — this feature follows the same
approach:
- `npx tsc --noEmit` for type correctness
- Manual verification in the dev server: generate a receipt from a Maintenance
  payment row and a Corpus payment row (with and without `months_covered` present),
  confirm PDF content is correct, confirm desktop download fallback works, and spot
  check the Owner Portal entry point renders correctly for a non-admin role.
- Web Share API / WhatsApp attach behavior itself is not re-tested — it's the
  existing, already-proven `sharePdf()` function; only the new call sites are
  verified.
