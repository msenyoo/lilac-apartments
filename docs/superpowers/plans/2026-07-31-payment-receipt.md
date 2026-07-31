# Payment Receipt (PDF + WhatsApp share) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Download / Share Receipt" button to each row of the existing payment
history lists (Dues page, Corpus page, Owner Portal) that generates a one-page PDF
receipt for that single payment and shares it via the OS share sheet (WhatsApp shows
up there on mobile) or downloads it on desktop.

**Architecture:** A pure data-mapping function (`buildReceiptData`) turns a
`transactions` row into a `PaymentReceiptData` object, which a `@react-pdf/renderer`
document (`PaymentReceiptDoc`) renders into a PDF. A single reusable
`<ReceiptButton>` component wires the two together and calls the existing
`sharePdf()` helper to hand the resulting blob to the OS share sheet or a plain
download. The button is dropped into three already-existing payment history rows —
no new pages, no new routes, no schema changes.

**Tech Stack:** React + TypeScript, `@react-pdf/renderer` (already a dependency),
`sonner` for toasts, `lucide-react` for icons. No new dependencies.

## Global Constraints

- No DB migration, no persisted/sequential receipt numbers — receipts are built
  fresh from the `transactions` row every time (per approved spec,
  `docs/superpowers/specs/2026-07-31-payment-receipt-design.md`).
- No bulk/multi-payment receipts — single payment per PDF only.
- Reuse `sharePdf()` from `src/lib/approvalPacket.ts` exactly as it exists today — do
  not modify that function.
- Filename convention: `` `Receipt_${flat.code}_${txn.value_date}.pdf` ``.
- No role/permission gating on the button — it's a read-derived action, available to
  every role that can already see the payment history row it sits in (including
  residents on the Owner Portal).
- Follow existing PDF conventions exactly: each PDF file owns its own local
  `StyleSheet.create()` (do not extract a shared style module — `AgmPdfDocs.tsx`,
  `ApprovalPacketPdf.tsx`, and `OwnerStatementPdf.tsx` all do this independently),
  wrap content in `LetterheadHeader`/`LetterheadFooter` from
  `src/components/reports/Letterhead.tsx`, and use the same local `fmtINR()` helper
  pattern (`Rs.` prefix, not `₹`) already used in `OwnerStatementPdf.tsx`.
- No comments in code unless the WHY is non-obvious (project convention).
- Run `npx tsc --noEmit` before every commit (project convention, see CLAUDE.md).
- No automated unit/e2e test coverage is being added for this feature — the project
  has no unit test runner (`vitest`/`jest`), and per the approved spec's Testing
  section, the Web Share API branch of `sharePdf()` is already proven and is not
  re-tested. Verification is `npx tsc --noEmit` plus manual dev-server checks,
  matching how `OwnerStatementPdf.tsx` and `ApprovalPacketPdf.tsx` were verified.

---

### Task 1: Receipt data builder + PDF template

**Files:**
- Create: `src/lib/paymentReceipt.ts`
- Create: `src/components/reports/PaymentReceiptPdf.tsx`

**Interfaces:**
- Consumes: `Transaction` type from `src/lib/supabase.ts` (fields: `value_date`,
  `amount`, `description`, `category`, `corpus`, `months_covered`); `LetterheadHeader`,
  `LetterheadFooter` from `src/components/reports/Letterhead.tsx`.
- Produces: `PaymentReceiptData` interface and `PaymentReceiptDoc` component (both
  exported from `src/components/reports/PaymentReceiptPdf.tsx`); `ReceiptTxn` type
  and `buildReceiptData(txn, flat, planName)` function (both exported from
  `src/lib/paymentReceipt.ts`). Task 2's `ReceiptButton` imports all four.

- [ ] **Step 1: Create the PDF template**

Create `src/components/reports/PaymentReceiptPdf.tsx`:

```tsx
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { LetterheadHeader, LetterheadFooter } from './Letterhead'

const S = StyleSheet.create({
  page:        { fontFamily: 'Helvetica', fontSize: 10, padding: 36, color: '#1e293b' },
  header:      { marginBottom: 16, borderBottom: '1.5pt solid #7c3aed', paddingBottom: 8 },
  title:       { fontSize: 13, fontFamily: 'Helvetica-Bold', color: '#7c3aed', marginBottom: 2 },
  subtitle:    { fontSize: 9, color: '#64748b' },
  amountBox:   { backgroundColor: '#f8fafc', borderRadius: 4, padding: 14, border: '0.5pt solid #e2e8f0', marginBottom: 16, alignItems: 'center' },
  amountLabel: { fontSize: 8, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6 },
  amountValue: { fontSize: 22, fontFamily: 'Helvetica-Bold', color: '#16a34a', marginTop: 4 },
  detailRow:   { flexDirection: 'row', borderBottom: '0.3pt solid #f1f5f9', paddingVertical: 6 },
  detailLabel: { width: 120, color: '#64748b' },
  detailValue: { flex: 1, fontFamily: 'Helvetica-Bold', color: '#1e293b' },
  footer:      { position: 'absolute', bottom: 20, left: 36, right: 36, fontSize: 7, color: '#94a3b8', textAlign: 'center' },
})

function fmtINR(n: number): string {
  const abs = Math.abs(Math.round(n))
  const s = abs.toString()
  const last3 = s.slice(-3)
  const rest = s.slice(0, -3)
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3
  return (n < 0 ? '-' : '') + 'Rs.' + grouped
}

export interface PaymentReceiptData {
  flatCode: string
  block: string
  amount: number
  valueDate: string
  categoryLabel: string
  periodCovered: string | null
  reference: string
  generated: string
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={S.detailRow}>
      <Text style={S.detailLabel}>{label}</Text>
      <Text style={S.detailValue}>{value}</Text>
    </View>
  )
}

export function PaymentReceiptDoc({ data }: { data: PaymentReceiptData }) {
  return (
    <Document>
      <Page size="A4" style={S.page}>
        <LetterheadHeader style={S.header}>
          <Text style={S.title}>Payment Receipt</Text>
          <Text style={S.subtitle}>Flat {data.flatCode} · Block {data.block}</Text>
        </LetterheadHeader>

        <View style={S.amountBox}>
          <Text style={S.amountLabel}>Amount Received</Text>
          <Text style={S.amountValue}>{fmtINR(data.amount)}</Text>
        </View>

        <DetailRow
          label="Date paid"
          value={new Date(data.valueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
        />
        <DetailRow label="Category" value={data.categoryLabel} />
        {data.periodCovered && <DetailRow label="Period covered" value={data.periodCovered} />}
        <DetailRow label="Reference" value={data.reference || '—'} />

        <LetterheadFooter style={S.footer} generated={data.generated} />
      </Page>
    </Document>
  )
}
```

- [ ] **Step 2: Create the data builder**

Create `src/lib/paymentReceipt.ts`:

```ts
import type { Transaction } from '@/lib/supabase'
import type { PaymentReceiptData } from '@/components/reports/PaymentReceiptPdf'

export type ReceiptTxn = Pick<Transaction, 'value_date' | 'amount' | 'description' | 'category' | 'corpus' | 'months_covered'>

export function buildReceiptData(
  txn: ReceiptTxn,
  flat: { code: string; block: string },
  planName: string | null,
): PaymentReceiptData {
  const categoryLabel = txn.corpus === 'YES'
    ? `Corpus Fund — ${planName ?? 'Corpus'}`
    : (txn.category ?? 'Maintenance')

  return {
    flatCode: flat.code,
    block: flat.block,
    amount: txn.amount,
    valueDate: txn.value_date,
    categoryLabel,
    periodCovered: txn.months_covered,
    reference: txn.description,
    generated: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
  }
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors related to the two new files.

- [ ] **Step 4: Commit**

```bash
git add src/lib/paymentReceipt.ts src/components/reports/PaymentReceiptPdf.tsx
git commit -m "$(cat <<'EOF'
feat(receipts): add payment receipt PDF template and data builder

Reusable react-pdf document + pure data mapper for a single-payment
receipt, following the existing OwnerStatementPdf/Letterhead
conventions. Not wired to any UI yet.
EOF
)"
```

---

### Task 2: `ReceiptButton` + wire into Dues page

**Files:**
- Create: `src/components/ReceiptButton.tsx`
- Modify: `src/pages/DuesPage.tsx:465-473` (payment history row inside `FlatPaymentPanel`, `src/pages/DuesPage.tsx:296`)

**Interfaces:**
- Consumes: `ReceiptTxn`, `buildReceiptData` from `src/lib/paymentReceipt.ts`;
  `PaymentReceiptDoc` from `src/components/reports/PaymentReceiptPdf.tsx`;
  `sharePdf` from `src/lib/approvalPacket.ts` (existing, unchanged).
- Produces: `ReceiptButton({ txn: ReceiptTxn, flat: { code: string; block: string },
  planName?: string | null })` component, exported from
  `src/components/ReceiptButton.tsx`. Tasks 3 and 4 import this directly — no changes
  to its props.

- [ ] **Step 1: Create the button component**

Create `src/components/ReceiptButton.tsx`:

```tsx
import { useState } from 'react'
import { Receipt as ReceiptIcon, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { ReceiptTxn } from '@/lib/paymentReceipt'

export function ReceiptButton({
  txn, flat, planName,
}: {
  txn: ReceiptTxn
  flat: { code: string; block: string }
  planName?: string | null
}) {
  const [sharing, setSharing] = useState(false)

  async function handleClick() {
    setSharing(true)
    try {
      const [{ pdf }, { PaymentReceiptDoc }, { buildReceiptData }, { sharePdf }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/reports/PaymentReceiptPdf'),
        import('@/lib/paymentReceipt'),
        import('@/lib/approvalPacket'),
      ])
      const data = buildReceiptData(txn, flat, planName ?? null)
      const blob = await pdf(<PaymentReceiptDoc data={data} />).toBlob()
      const filename = `Receipt_${flat.code}_${txn.value_date}.pdf`
      const result = await sharePdf(blob, filename)
      toast.success(result === 'shared'
        ? 'Share sheet opened — pick where to send it'
        : 'Receipt downloaded — attach it in WhatsApp')
    } catch (e: any) {
      toast.error(e.message ?? 'Could not generate the receipt')
    } finally {
      setSharing(false)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={sharing}
      title="Download / share receipt"
      className="inline-flex items-center justify-center p-1 rounded-md hover:bg-black/5 disabled:opacity-40 transition-colors shrink-0"
      style={{ color: 'var(--brand-600)' }}
    >
      {sharing ? <Loader2 size={14} className="animate-spin" /> : <ReceiptIcon size={14} />}
    </button>
  )
}
```

- [ ] **Step 2: Wire it into the Dues page payment history row**

In `src/pages/DuesPage.tsx`, add the import near the other component imports (after
line 10, `import { WhatsAppSendButtons } from '@/components/WhatsAppSendButtons'`):

```ts
import { ReceiptButton } from '@/components/ReceiptButton'
```

Then replace the payment history row block at `src/pages/DuesPage.tsx:465-473`:

```tsx
            {payments.map(p => (
              <div key={p.id} className="flex justify-between text-[13px]">
                <div>
                  <p className="font-medium">{p.fiscal_label}</p>
                  <p className="text-[11.5px] mono" style={{ color: 'var(--ink-400)' }}>{p.value_date}</p>
                </div>
                <p className="font-bold" style={{ color: 'var(--ok)' }}>{formatINR(p.amount)}</p>
              </div>
            ))}
```

with:

```tsx
            {payments.map(p => (
              <div key={p.id} className="flex justify-between items-center text-[13px]">
                <div>
                  <p className="font-medium">{p.fiscal_label}</p>
                  <p className="text-[11.5px] mono" style={{ color: 'var(--ink-400)' }}>{p.value_date}</p>
                </div>
                <div className="flex items-center gap-2">
                  <p className="font-bold" style={{ color: 'var(--ok)' }}>{formatINR(p.amount)}</p>
                  <ReceiptButton txn={p} flat={{ code: flat.flat_code, block: flat.block }} />
                </div>
              </div>
            ))}
```

`flat` here is the `DuesEntry` prop of `FlatPaymentPanel` (`src/pages/DuesPage.tsx:296`)
already in scope; `p` is a full `Transaction` row (the query at
`src/pages/DuesPage.tsx:301-315` selects `*`), which satisfies `ReceiptTxn`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run `npm run dev`, log in (see `.env.test` — mobile-number login), navigate to
`/dues`, click a flat that has at least one payment in its history to open the
panel. Click the receipt icon next to any payment row. Confirm:
- A PDF downloads named `Receipt_<flat code>_<value_date>.pdf` (e.g.
  `Receipt_A-101_2025-06-15.pdf`).
- Opening the PDF shows: the society letterhead logo, "Payment Receipt" title, the
  correct flat code and block, the amount matching the row, the date, "Maintenance"
  as the category, a "Reference" line with the bank narration text, and the footer
  with society name/address/generated date.
- If the row has no `months_covered` value, confirm the "Period covered" line is
  absent (not blank) — pick a flat/row where it's easy to tell either way from the
  Transactions page if unsure.

- [ ] **Step 5: Commit**

```bash
git add src/components/ReceiptButton.tsx src/pages/DuesPage.tsx
git commit -m "$(cat <<'EOF'
feat(receipts): add receipt button to Dues page payment history

First integration point for the payment receipt feature — generates
and shares/downloads a PDF receipt per maintenance payment row.
EOF
)"
```

---

### Task 3: Wire `ReceiptButton` into Corpus page

**Files:**
- Modify: `src/pages/CorpusPage.tsx:856-864` (payment history row inside
  `FlatCorpusPanel`, `src/pages/CorpusPage.tsx:718`)

**Interfaces:**
- Consumes: `ReceiptButton` from `src/components/ReceiptButton.tsx` (Task 2, no
  changes to its interface).

- [ ] **Step 1: Add the import**

In `src/pages/CorpusPage.tsx`, add near the other component imports (after line 10,
`import { WhatsAppSendButtons } from '@/components/WhatsAppSendButtons'`):

```ts
import { ReceiptButton } from '@/components/ReceiptButton'
```

- [ ] **Step 2: Wire it into the payment history row**

Replace the block at `src/pages/CorpusPage.tsx:856-864`:

```tsx
            {payments.map((p: any) => (
              <div key={p.id} className="flex justify-between text-sm">
                <div>
                  <p className="font-medium">{p.fiscal_label}</p>
                  <p className="text-xs" style={{ color: 'var(--ink-400)' }}>{p.value_date}</p>
                </div>
                <p className="font-semibold text-green-700">{formatINR(p.amount)}</p>
              </div>
            ))}
```

with:

```tsx
            {payments.map((p: any) => (
              <div key={p.id} className="flex justify-between items-center text-sm">
                <div>
                  <p className="font-medium">{p.fiscal_label}</p>
                  <p className="text-xs" style={{ color: 'var(--ink-400)' }}>{p.value_date}</p>
                </div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-green-700">{formatINR(p.amount)}</p>
                  <ReceiptButton txn={p} flat={{ code: flat.flat_code, block: flat.block }} planName={flat.plan_name} />
                </div>
              </div>
            ))}
```

`flat` here is the `CorpusEntry` prop of `FlatCorpusPanel`
(`src/pages/CorpusPage.tsx:718`), which already carries `plan_name`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

With `npm run dev` running, navigate to `/corpus`, open a flat with at least one
corpus payment in its history, click the receipt icon on a payment row. Confirm the
downloaded PDF shows Category as `Corpus Fund — <plan name>` matching the flat's
active plan name shown elsewhere on that same panel, and (if that payment's
`months_covered` is set) the period-covered line.

- [ ] **Step 5: Commit**

```bash
git add src/pages/CorpusPage.tsx
git commit -m "$(cat <<'EOF'
feat(receipts): add receipt button to Corpus page payment history

Reuses ReceiptButton, passing the flat's plan_name so corpus
receipts show which plan the payment applies to.
EOF
)"
```

---

### Task 4: Wire `ReceiptButton` into Owner Portal

**Files:**
- Modify: `src/pages/OwnerPortalPage.tsx:32` (`TxnRow` interface)
- Modify: `src/pages/OwnerPortalPage.tsx:201` (payments query `select`)
- Modify: `src/pages/OwnerPortalPage.tsx:416` (insert plan-name lookup after this line, before `return` at line 418)
- Modify: `src/pages/OwnerPortalPage.tsx:733-775` (payments table)

**Interfaces:**
- Consumes: `ReceiptButton` from `src/components/ReceiptButton.tsx` (Task 2, no
  changes to its interface).

- [ ] **Step 1: Add the import**

In `src/pages/OwnerPortalPage.tsx`, add after line 6
(`import { useRoleCtx } from '@/contexts/RoleContext'`):

```ts
import { ReceiptButton } from '@/components/ReceiptButton'
```

- [ ] **Step 2: Extend `TxnRow` and the payments query to carry `plan_id` and `months_covered`**

Replace line 32:

```ts
interface TxnRow { id: string; value_date: string; description: string; amount: number; category: string | null; fiscal_label: string | null; corpus: string }
```

with:

```ts
interface TxnRow { id: string; value_date: string; description: string; amount: number; category: string | null; fiscal_label: string | null; corpus: string; plan_id: string | null; months_covered: string | null }
```

Replace line 201:

```ts
        .select('id,value_date,description,amount,category,fiscal_label,corpus')
```

with:

```ts
        .select('id,value_date,description,amount,category,fiscal_label,corpus,plan_id,months_covered')
```

- [ ] **Step 3: Build a plan-name lookup**

In `src/pages/OwnerPortalPage.tsx`, right before the `return (` at line 418 (after
the existing `const pendingMonths = ...` line), add:

```ts
  const planNameByPlanId = new Map(corpusList.map(c => [c.plan_id, c.plan_name]))
```

`corpusList` is the existing `CorpusRow[]` query result
(`src/pages/OwnerPortalPage.tsx:162-172`), already fetched for this flat and already
carrying `plan_id`/`plan_name` — no new query needed.

- [ ] **Step 4: Add the receipt button to the payments table**

Replace the table at `src/pages/OwnerPortalPage.tsx:734-773`:

```tsx
      {/* Payment history */}
      <div className="surface !p-0 overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: 'var(--ink-100)' }}>
          <Receipt size={16} style={{ color: 'var(--brand-600)' }} />
          <p className="font-semibold text-[14px]">Payment history</p>
        </div>
        {payments.length === 0 ? (
          <p className="px-5 py-6 text-[13px]" style={{ color: 'var(--ink-400)' }}>No payments recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="ds-tbl">
              <thead>
                <tr>
                  {['Date', 'Description', 'Type', 'Amount'].map(h => <th key={h}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {payments.map(p => (
                  <tr key={p.id}>
                    <td className="mono text-[12px] whitespace-nowrap" style={{ color: 'var(--ink-500)' }}>
                      {new Date(p.value_date).toLocaleDateString('en-IN', { dateStyle: 'short' })}
                    </td>
                    <td className="text-[12.5px]" style={{ color: 'var(--ink-700)' }}>
                      <p className="truncate max-w-[220px]">{p.description}</p>
                      {p.fiscal_label && (
                        <p className="text-[11px]" style={{ color: 'var(--ink-400)' }}>{p.fiscal_label}</p>
                      )}
                    </td>
                    <td>
                      <span className={`ds-badge ${p.corpus === 'YES' ? 'ds-badge-info' : 'ds-badge-ok'}`}>
                        {p.corpus === 'YES' ? 'Corpus' : (p.category ?? 'Maintenance')}
                      </span>
                    </td>
                    <td className="font-semibold mono text-right" style={{ color: 'var(--ok)' }}>
                      {formatINR(p.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
```

with:

```tsx
      {/* Payment history */}
      <div className="surface !p-0 overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: 'var(--ink-100)' }}>
          <Receipt size={16} style={{ color: 'var(--brand-600)' }} />
          <p className="font-semibold text-[14px]">Payment history</p>
        </div>
        {payments.length === 0 ? (
          <p className="px-5 py-6 text-[13px]" style={{ color: 'var(--ink-400)' }}>No payments recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="ds-tbl">
              <thead>
                <tr>
                  {['Date', 'Description', 'Type', 'Amount', ''].map(h => <th key={h}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {payments.map(p => (
                  <tr key={p.id}>
                    <td className="mono text-[12px] whitespace-nowrap" style={{ color: 'var(--ink-500)' }}>
                      {new Date(p.value_date).toLocaleDateString('en-IN', { dateStyle: 'short' })}
                    </td>
                    <td className="text-[12.5px]" style={{ color: 'var(--ink-700)' }}>
                      <p className="truncate max-w-[220px]">{p.description}</p>
                      {p.fiscal_label && (
                        <p className="text-[11px]" style={{ color: 'var(--ink-400)' }}>{p.fiscal_label}</p>
                      )}
                    </td>
                    <td>
                      <span className={`ds-badge ${p.corpus === 'YES' ? 'ds-badge-info' : 'ds-badge-ok'}`}>
                        {p.corpus === 'YES' ? 'Corpus' : (p.category ?? 'Maintenance')}
                      </span>
                    </td>
                    <td className="font-semibold mono text-right" style={{ color: 'var(--ok)' }}>
                      {formatINR(p.amount)}
                    </td>
                    <td className="text-right">
                      <ReceiptButton
                        txn={p}
                        flat={{ code: myFlat!.code, block: myFlat!.block }}
                        planName={p.plan_id ? planNameByPlanId.get(p.plan_id) ?? null : null}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
```

The `myFlat!` non-null assertions are safe here: the `payments` query itself is
gated with `enabled: !!myFlat?.code` (`src/pages/OwnerPortalPage.tsx:197`), so this
`payments.map` branch can only run with a real row once `myFlat.code` has already
resolved. The rest of this component uses `myFlat?.` optional chaining because its
JSX renders before that data loads too — this row-rendering branch specifically
cannot.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual verification**

With `npm run dev` running, navigate to `/my-flat`. Confirm the payments table has a
new receipt icon column. Click it on a Maintenance row and confirm the PDF shows
"Maintenance" as the category. If the flat has any corpus payments, click one of
those rows too and confirm the PDF shows `Corpus Fund — <plan name>` with the
correct plan name (cross-check against the "How your corpus is used" section on the
same page, or the corpus plan cards above it).

- [ ] **Step 7: Commit**

```bash
git add src/pages/OwnerPortalPage.tsx
git commit -m "$(cat <<'EOF'
feat(receipts): add receipt button to Owner Portal payment history

Extends the payments query with plan_id/months_covered and adds a
plan-name lookup from the already-fetched corpus list so residents
can self-serve download/share receipts for their own payments.
EOF
)"
```
