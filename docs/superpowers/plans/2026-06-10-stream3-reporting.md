# Reporting Suite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three audit-ready financial reports to ReportPage: Receipts & Payments statement, AGM Balance Sheet PDF, and TDS compliance register with Excel export.

**Architecture:** New tabs added to existing ReportPage.tsx following established patterns. PDFs via @react-pdf/renderer (lazy-loaded). Excel via xlsx. Opening balance stored in app_settings table.

**Tech Stack:** React 18, TypeScript, Supabase JS, react-query, @react-pdf/renderer, xlsx, Shadcn/ui, Tailwind CSS

---

## Orientation — codebase facts every engineer needs

Before touching code, understand these invariants:

| Fact | Detail |
|---|---|
| `ReportPage.tsx` tabs | `ReportTab = 'monthly' \| 'flat' \| 'aging' \| 'agm' \| 'utility' \| 'expenditure'` — you will extend this union |
| PDF pattern | Dynamic `import('@react-pdf/renderer')` + `import('@/components/reports/AgmPdfDocs')` inside an async handler, then `pdf(<Doc />).toBlob()`. Never import `@react-pdf/renderer` at the top of a page file |
| FY utilities | `getCurrentFy()`, `getFyRange(year)`, `buildFiscalYears()` are already defined in `ReportPage.tsx` — reuse them, do not redefine |
| `triggerDownload(blob, filename)` | Already defined in `ReportPage.tsx` — use it |
| `formatINR` in PDF docs | The PDF file has its own local `formatINR` that does Indian number grouping without `toLocaleString` (unreliable in renderer). The UI uses `import { formatINR } from '@/lib/tagger'` |
| `app_settings` table | Key-value store. Keys already in use: `dues_start_fiscal_year`, `collection_upi`, `collection_bank`. New key this plan adds: `opening_balance_<year>` (e.g. `opening_balance_2025`) |
| `deposits` table | Has `principal`, `interest_rate`, `maturity_amount`, `status`, `opened_date`, `maturity_date`. There is **no** `interest_earned` column — compute it as `maturity_amount - principal` on rows where `status = 'matured'` |
| `vendors` table | Has `id`, `name`, `pan_number` (nullable) |
| `expense_line_items` | Has `amount`, `vendor_id`, `payee_name_raw`, `category_id` |
| Latest migration | `028_deposits.sql` — next migration is `029` |
| SettingsPage tabs | `'general' \| 'rates' \| 'categories' \| 'imports'` — you will add `'balances'` |

---

## Task 1 — Migration: opening_balance per-FY in app_settings

**File:** `supabase/migrations/029_opening_balance_setting.sql`

The `app_settings` table is already a generic key-value store. No schema change is needed — we just document the convention. However we do need an RLS policy that lets admins write keys starting with `opening_balance_`. The existing migration 019 added a read-policy for all authenticated users; we need to confirm admins can write. We add an explicit upsert policy to be safe.

- [ ] Create `supabase/migrations/029_opening_balance_setting.sql`:

```sql
-- 029: Allow admins to upsert opening_balance_<fy> keys in app_settings
-- app_settings already has a read policy for all authenticated users (migration 019).
-- This migration ensures admins can INSERT/UPDATE any key (including opening_balance_*).

DO $$
BEGIN
  -- Drop if exists so migration is re-runnable
  DROP POLICY IF EXISTS "app_settings_admin_write" ON public.app_settings;

  CREATE POLICY "app_settings_admin_write" ON public.app_settings
    FOR ALL TO authenticated
    USING (
      EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
    )
    WITH CHECK (
      EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
    );
END $$;
```

- [ ] Apply to production via Supabase dashboard SQL editor (Settings → SQL Editor → paste and run). Confirm "Success" with no errors.

- [ ] Commit:
```
git add supabase/migrations/029_opening_balance_setting.sql
git commit -m "feat(migration): 029 — admin write policy for app_settings (opening balance keys)"
```

---

## Task 2 — Opening Balance UI in SettingsPage

**File:** `src/pages/SettingsPage.tsx`

Add a new "Balances" tab visible to admins only. The tab renders a new `OpeningBalancesTab` component that lets the treasurer enter the opening bank balance for each fiscal year. The value is stored as `opening_balance_<year>` in `app_settings`, where `<year>` is the April-start year (e.g. `opening_balance_2025` = opening balance for FY 2025-26).

### 2a — Extend the `SettingsTab` type and tab list

- [ ] In `SettingsPage.tsx`, find:

```typescript
type SettingsTab = 'general' | 'rates' | 'categories' | 'imports'
```

Replace with:

```typescript
type SettingsTab = 'general' | 'rates' | 'categories' | 'imports' | 'balances'
```

- [ ] Find the `TABS` array:

```typescript
  const TABS: { key: SettingsTab; label: string; adminOnly?: boolean }[] = [
    { key: 'general',    label: 'General' },
    { key: 'rates',      label: 'Maintenance Rates' },
    { key: 'categories', label: 'Expense Categories', adminOnly: true },
    { key: 'imports',    label: 'Import History',     adminOnly: true },
  ]
```

Replace with:

```typescript
  const TABS: { key: SettingsTab; label: string; adminOnly?: boolean }[] = [
    { key: 'general',    label: 'General' },
    { key: 'rates',      label: 'Maintenance Rates' },
    { key: 'categories', label: 'Expense Categories', adminOnly: true },
    { key: 'imports',    label: 'Import History',     adminOnly: true },
    { key: 'balances',   label: 'Opening Balances',   adminOnly: true },
  ]
```

- [ ] Find the block that renders tab content (after the tabs UI):

```typescript
      {tab === 'general'     && <GeneralSettings />}
      {tab === 'rates'       && <RateHistorySettings />}
      {tab === 'categories'  && isAdmin && <CategoriesSettings />}
      {tab === 'imports'     && isAdmin && <UploadHistorySection />}
```

Replace with:

```typescript
      {tab === 'general'     && <GeneralSettings />}
      {tab === 'rates'       && <RateHistorySettings />}
      {tab === 'categories'  && isAdmin && <CategoriesSettings />}
      {tab === 'imports'     && isAdmin && <UploadHistorySection />}
      {tab === 'balances'    && isAdmin && <OpeningBalancesTab />}
```

### 2b — Add the `OpeningBalancesTab` component

- [ ] At the bottom of `SettingsPage.tsx` (before the final closing), add:

```typescript
// ── Opening Balances tab ──────────────────────────────────────

const OB_FY_OPTIONS = ['2022', '2023', '2024', '2025', '2026', '2027', '2028']

function OpeningBalancesTab() {
  const qc = useQueryClient()

  const { data: settings, isLoading } = useQuery({
    queryKey: ['app-settings'],
    queryFn: async () => {
      const { data } = await supabase.from('app_settings').select('*')
      return Object.fromEntries((data ?? []).map((s: any) => [s.key, s.value]))
    },
  })

  // Draft values keyed by FY start year string
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  function getValue(year: string): string {
    if (drafts[year] !== undefined) return drafts[year]
    return settings?.[`opening_balance_${year}`] ?? ''
  }

  async function handleSave() {
    setSaving(true)
    const rows = OB_FY_OPTIONS
      .filter(y => drafts[y] !== undefined && drafts[y] !== '')
      .map(y => ({
        key: `opening_balance_${y}`,
        value: String(parseInt(drafts[y] ?? '0', 10) || 0),
        updated_at: new Date().toISOString(),
      }))
    if (rows.length === 0) { setSaving(false); return }
    const { error } = await supabase.from('app_settings').upsert(rows)
    setSaving(false)
    if (error) { toast.error(error.message); return }
    qc.invalidateQueries({ queryKey: ['app-settings'] })
    setDrafts({})
    toast.success('Opening balances saved')
  }

  if (isLoading) return (
    <div className="h-40 animate-pulse rounded-[var(--ds-radius)]" style={{ background: 'var(--ink-100)' }} />
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="surface !p-5 flex flex-col gap-4">
        <div>
          <p className="font-semibold text-[14px]">Bank opening balances per FY</p>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--ink-400)' }}>
            Opening balance = actual bank balance on 1 April of that FY.
            Used in the Balance Sheet and R&amp;P Statement reports.
          </p>
        </div>

        <div className="flex flex-col gap-3 max-w-sm">
          {OB_FY_OPTIONS.map(year => (
            <div key={year} className="flex items-center gap-3">
              <label className="ds-lbl w-24 shrink-0">
                FY {year}-{String(parseInt(year) + 1).slice(-2)}
              </label>
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium" style={{ color: 'var(--ink-400)' }}>
                  ₹
                </span>
                <Input
                  type="number"
                  min={0}
                  value={getValue(year)}
                  onChange={e => setDrafts(d => ({ ...d, [year]: e.target.value }))}
                  className="pl-7 text-sm"
                  placeholder="0"
                />
              </div>
            </div>
          ))}
        </div>

        <div className="flex">
          <Button
            onClick={handleSave}
            disabled={saving || Object.keys(drafts).length === 0}
            className="flex items-center gap-2"
          >
            {saving ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}
            Save balances
          </Button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] Run `npx tsc --noEmit` from `D:\projects\lilac-apartments` — fix any type errors before continuing.

- [ ] Commit:
```
git add src/pages/SettingsPage.tsx
git commit -m "feat(settings): Opening Balances tab — per-FY bank balance stored in app_settings"
```

---

## Task 3 — R&P Statement tab in ReportPage

This is the most complex new tab. It adds a dedicated "R&P Statement" tab with:
- FY selector
- Manual opening balance field (pre-filled from app_settings, editable inline)
- Receipts section: Maintenance CR, Corpus CR, FD interest received
- Payments section: grouped by expense category
- Closing balance = Opening + total receipts - total payments
- PDF export button

### 3a — Extend `ReportTab` union and tab bar

- [ ] In `ReportPage.tsx`, find:

```typescript
type ReportTab = 'monthly' | 'flat' | 'aging' | 'agm' | 'utility' | 'expenditure'
```

Replace with:

```typescript
type ReportTab = 'monthly' | 'flat' | 'aging' | 'agm' | 'utility' | 'expenditure' | 'rp' | 'balance-sheet'
```

- [ ] Find the tab bar array (the `([` block that lists tab objects), which currently is:

```typescript
        {([
          { key: 'monthly',     label: 'Monthly summary' },
          { key: 'flat',        label: 'Flat statement' },
          { key: 'aging',       label: 'Dues aging' },
          { key: 'agm',         label: 'AGM reports' },
          { key: 'utility',     label: 'Utilities' },
          { key: 'expenditure', label: 'Expenditure' },
        ] as { key: ReportTab; label: string }[]).map(({ key, label }) => (
```

Replace with:

```typescript
        {([
          { key: 'monthly',       label: 'Monthly summary' },
          { key: 'flat',          label: 'Flat statement' },
          { key: 'aging',         label: 'Dues aging' },
          { key: 'agm',           label: 'AGM reports' },
          { key: 'utility',       label: 'Utilities' },
          { key: 'expenditure',   label: 'Expenditure' },
          { key: 'rp',            label: 'R&P Statement' },
          { key: 'balance-sheet', label: 'Balance Sheet' },
        ] as { key: ReportTab; label: string }[]).map(({ key, label }) => (
```

- [ ] Find the block that renders each tab's content. After:

```typescript
      {tab === 'expenditure' && <ExpenditureReportsTab />}
```

Add:

```typescript
      {tab === 'rp'            && <RPStatementTab />}
      {tab === 'balance-sheet' && <BalanceSheetTab />}
```

### 3b — Add the `RPStatementTab` component

Add this component at the end of `ReportPage.tsx`, after `ExpenditureReportsTab` and before `UtilityTab`.

- [ ] Add the following component to `ReportPage.tsx`:

```typescript
// ── R&P STATEMENT TAB ─────────────────────────────────────────

function RPStatementTab() {
  const fy = getCurrentFy()
  const [selectedFyYear, setSelectedFyYear] = useState(fy.year)
  const selectedFy = getFyRange(selectedFyYear)
  const [generating, setGenerating] = useState(false)
  const [openingBalanceOverride, setOpeningBalanceOverride] = useState<string>('')

  // Load opening balance from app_settings
  const { data: openingBalanceSetting } = useQuery({
    queryKey: ['opening-balance', selectedFyYear],
    queryFn: async () => {
      const { data } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', `opening_balance_${selectedFyYear}`)
        .maybeSingle()
      return data?.value ?? '0'
    },
  })

  const openingBalance = openingBalanceOverride !== ''
    ? (parseInt(openingBalanceOverride, 10) || 0)
    : (parseInt(openingBalanceSetting ?? '0', 10) || 0)

  // Maintenance CRs this FY
  const { data: maintenanceCR } = useQuery({
    queryKey: ['rp-maintenance-cr', selectedFyYear],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('amount')
        .eq('cr_dr', 'CR')
        .eq('corpus', 'NO')
        .neq('row_type', 'VOIDED')
        .gte('value_date', selectedFy.start)
        .lte('value_date', selectedFy.end)
      return (data ?? []).reduce((s: number, r: any) => s + (r.amount ?? 0), 0)
    },
  })

  // Corpus CRs this FY
  const { data: corpusCR } = useQuery({
    queryKey: ['rp-corpus-cr', selectedFyYear],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('amount')
        .eq('cr_dr', 'CR')
        .eq('corpus', 'YES')
        .neq('row_type', 'VOIDED')
        .gte('value_date', selectedFy.start)
        .lte('value_date', selectedFy.end)
      return (data ?? []).reduce((s: number, r: any) => s + (r.amount ?? 0), 0)
    },
  })

  // FD interest received this FY (matured deposits: interest = maturity_amount - principal)
  const { data: fdInterest } = useQuery({
    queryKey: ['rp-fd-interest', selectedFyYear],
    queryFn: async () => {
      const { data } = await supabase
        .from('deposits')
        .select('principal, maturity_amount')
        .eq('status', 'matured')
        .gte('matured_date', selectedFy.start)
        .lte('matured_date', selectedFy.end)
      return (data ?? []).reduce((s: number, r: any) => {
        const interest = (r.maturity_amount ?? r.principal) - r.principal
        return s + (interest > 0 ? interest : 0)
      }, 0)
    },
  })

  // Expenses by category this FY
  const { data: paymentRows } = useQuery({
    queryKey: ['rp-payments', selectedFyYear],
    queryFn: async () => {
      const [{ data: exps }, { data: cats }] = await Promise.all([
        supabase.from('expenses')
          .select('amount, category_id')
          .gte('expense_date', selectedFy.start)
          .lte('expense_date', selectedFy.end)
          .is('voided_at', null),
        supabase.from('expense_categories').select('id, name'),
      ])
      const catMap = new Map((cats ?? []).map((c: any) => [c.id, c.name as string]))
      const grouped = new Map<string, number>()
      for (const e of exps ?? []) {
        const cat = catMap.get((e as any).category_id) ?? 'Uncategorised'
        grouped.set(cat, (grouped.get(cat) ?? 0) + ((e as any).amount ?? 0))
      }
      return Array.from(grouped.entries())
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount)
    },
  })

  const mCR         = maintenanceCR ?? 0
  const cCR         = corpusCR ?? 0
  const fdInt       = fdInterest ?? 0
  const totalReceipts = openingBalance + mCR + cCR + fdInt
  const totalPayments = (paymentRows ?? []).reduce((s, r) => s + r.amount, 0)
  const closingBalance = totalReceipts - totalPayments

  async function handlePdf() {
    setGenerating(true)
    try {
      const [{ pdf }, { RPStatementDoc }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/reports/AgmPdfDocs'),
      ])
      const generated = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      const blob = await pdf(
        <RPStatementDoc
          fyLabel={selectedFy.label}
          openingBalance={openingBalance}
          maintenanceCR={mCR}
          corpusCR={cCR}
          fdInterest={fdInt}
          payments={paymentRows ?? []}
          generated={generated}
        />
      ).toBlob()
      triggerDownload(blob, `RP_Statement_${selectedFy.label.replace(/\s/g, '_')}.pdf`)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-sm font-medium" style={{ color: 'var(--ink-600)' }}>Financial Year</label>
        <select
          value={selectedFyYear}
          onChange={e => { setSelectedFyYear(Number(e.target.value)); setOpeningBalanceOverride('') }}
          className="ds-field"
        >
          {FISCAL_YEARS.map(f => <option key={f.year} value={f.year}>{f.label}</option>)}
        </select>

        <div className="ml-auto">
          <button
            onClick={handlePdf}
            disabled={generating}
            className="btn-primary flex items-center gap-2 py-2 px-4 text-sm disabled:opacity-50"
          >
            {generating
              ? <><Loader2 size={14} className="animate-spin" /> Generating PDF…</>
              : <><FileText size={14} /> Download PDF</>
            }
          </button>
        </div>
      </div>

      {/* Opening balance (editable override) */}
      <div className="surface !p-4 flex items-center gap-3">
        <label className="text-sm font-medium shrink-0" style={{ color: 'var(--ink-600)' }}>
          Opening balance (1 Apr {selectedFyYear})
        </label>
        <div className="relative max-w-xs">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: 'var(--ink-400)' }}>₹</span>
          <input
            type="number"
            min={0}
            value={openingBalanceOverride !== '' ? openingBalanceOverride : (openingBalanceSetting ?? '0')}
            onChange={e => setOpeningBalanceOverride(e.target.value)}
            className="ds-field pl-7 max-w-[180px]"
          />
        </div>
        <p className="text-xs" style={{ color: 'var(--ink-400)' }}>
          Pre-filled from Settings → Opening Balances. Edit here for one-off override (not saved).
        </p>
      </div>

      {/* Receipts section */}
      <div className="surface !p-0 overflow-hidden">
        <div className="px-5 py-3 border-b hairline" style={{ background: 'var(--ink-50)' }}>
          <h3 className="font-semibold text-sm" style={{ color: 'var(--ink-700)' }}>RECEIPTS</h3>
        </div>
        {[
          { label: 'Opening balance (brought forward)', amount: openingBalance },
          { label: 'Maintenance collected',             amount: mCR },
          { label: 'Corpus collected',                  amount: cCR },
          { label: 'FD interest received',              amount: fdInt },
        ].map(({ label, amount }) => (
          <div key={label} className="flex justify-between items-center px-5 py-3 border-b hairline text-sm">
            <span style={{ color: 'var(--ink-600)' }}>{label}</span>
            <span className="font-semibold" style={{ color: 'var(--ink-800)' }}>{formatINR(amount)}</span>
          </div>
        ))}
        <div className="flex justify-between items-center px-5 py-3 text-sm font-bold border-t-2 hairline" style={{ background: 'var(--ok-bg)' }}>
          <span>Total Receipts</span>
          <span className="text-green-700">{formatINR(totalReceipts)}</span>
        </div>
      </div>

      {/* Payments section */}
      <div className="surface !p-0 overflow-hidden">
        <div className="px-5 py-3 border-b hairline" style={{ background: 'var(--ink-50)' }}>
          <h3 className="font-semibold text-sm" style={{ color: 'var(--ink-700)' }}>PAYMENTS</h3>
        </div>
        {(paymentRows ?? []).length === 0 ? (
          <div className="px-5 py-6 text-center text-sm" style={{ color: 'var(--ink-400)' }}>
            No expenses recorded for {selectedFy.label}
          </div>
        ) : (
          (paymentRows ?? []).map(({ category, amount }) => (
            <div key={category} className="flex justify-between items-center px-5 py-3 border-b hairline text-sm">
              <span style={{ color: 'var(--ink-600)' }}>{category}</span>
              <span className="font-semibold" style={{ color: 'var(--ink-800)' }}>{formatINR(amount)}</span>
            </div>
          ))
        )}
        <div className="flex justify-between items-center px-5 py-3 text-sm font-bold border-t-2 hairline" style={{ background: 'var(--bad-bg)' }}>
          <span>Total Payments</span>
          <span className="text-rose-700">{formatINR(totalPayments)}</span>
        </div>
      </div>

      {/* Closing balance */}
      <div className={`surface !p-4 flex justify-between items-center text-base font-bold border-2 ${closingBalance >= 0 ? 'border-green-200' : 'border-red-200'}`}
        style={{ background: closingBalance >= 0 ? 'var(--ok-bg)' : 'var(--bad-bg)' }}>
        <span>Closing Balance (31 Mar {selectedFyYear + 1})</span>
        <span className={closingBalance >= 0 ? 'text-green-700' : 'text-red-600'}>
          {formatINR(Math.abs(closingBalance))}
          {closingBalance < 0 && ' (deficit)'}
        </span>
      </div>

      <p className="text-xs text-center" style={{ color: 'var(--ink-400)' }}>
        Cash-basis statement · All monetary transactions for {selectedFy.label}
      </p>
    </div>
  )
}
```

- [ ] Run `npx tsc --noEmit` — fix any type errors.

- [ ] Commit:
```
git add src/pages/ReportPage.tsx
git commit -m "feat(reports): R&P Statement tab — FY receipts, payments, closing balance with PDF export"
```

---

## Task 4 — `RPStatementDoc` PDF component

**File:** `src/components/reports/AgmPdfDocs.tsx`

Add the new PDF document component for the R&P Statement. It follows the exact same pattern as `ReceiptsPaymentsDoc` (already in the file) but includes the opening balance as its own receipt line and shows FD interest as a named line.

- [ ] At the bottom of `AgmPdfDocs.tsx`, add:

```typescript
// ── R&P Statement (enhanced: opening balance + FD interest) ───

interface RPPaymentRow { category: string; amount: number }

export function RPStatementDoc({
  fyLabel, openingBalance, maintenanceCR, corpusCR, fdInterest, payments, generated,
}: {
  fyLabel: string
  openingBalance: number
  maintenanceCR: number
  corpusCR: number
  fdInterest: number
  payments: RPPaymentRow[]
  generated: string
}) {
  const totalReceipts = openingBalance + maintenanceCR + corpusCR + fdInterest
  const totalPayments = payments.reduce((s, r) => s + r.amount, 0)
  const closingBal    = totalReceipts - totalPayments

  const receiptLines = [
    { label: 'Opening balance (b/f)', amount: openingBalance },
    { label: 'Maintenance collected', amount: maintenanceCR },
    { label: 'Corpus collected',      amount: corpusCR },
    { label: 'FD interest received',  amount: fdInterest },
  ].filter(r => r.amount > 0)

  const paymentLines: RPPaymentRow[] = closingBal > 0
    ? [...payments, { category: 'Closing Balance (c/f)', amount: closingBal }]
    : payments

  return (
    <Document>
      <Page size="A4" style={S.page}>
        <View style={S.header}>
          <Text style={S.title}>Receipts &amp; Payments Statement — {fyLabel}</Text>
          <Text style={S.subtitle}>The Lilac Apartment Association · Rajakil Pakkam, Chennai</Text>
          <Text style={[S.subtitle, { marginTop: 2 }]}>
            Cash basis · Financial year 1 April to 31 March
          </Text>
        </View>

        <View style={S.twoCol}>
          {/* Receipts column */}
          <View style={S.half}>
            <Text style={S.sectionHead}>RECEIPTS (Dr)</Text>
            <View style={S.table}>
              {receiptLines.map((r, i) => (
                <View key={r.label} style={[S.row, i % 2 === 1 ? S.rowAlt : {}]}>
                  <Text style={S.col}>{r.label}</Text>
                  <Text style={S.colR}>{formatINR(r.amount)}</Text>
                </View>
              ))}
              <View style={S.rowTotal}>
                <Text style={[S.col, S.bold]}>Total Receipts</Text>
                <Text style={[S.colR, S.bold]}>{formatINR(totalReceipts)}</Text>
              </View>
            </View>
          </View>

          {/* Payments column */}
          <View style={S.half}>
            <Text style={S.sectionHead}>PAYMENTS (Cr)</Text>
            <View style={S.table}>
              {paymentLines.map((r, i) => (
                <View key={r.category} style={[S.row, i % 2 === 1 ? S.rowAlt : {}]}>
                  <Text style={S.col}>{r.category}</Text>
                  <Text style={S.colR}>{formatINR(r.amount)}</Text>
                </View>
              ))}
              <View style={S.rowTotal}>
                <Text style={[S.col, S.bold]}>Total Payments + Balance</Text>
                <Text style={[S.colR, S.bold]}>{formatINR(totalReceipts)}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Net position note */}
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

        <PageFooter generated={generated} />
      </Page>
    </Document>
  )
}
```

- [ ] Run `npx tsc --noEmit` — fix any type errors.

- [ ] Commit:
```
git add src/components/reports/AgmPdfDocs.tsx
git commit -m "feat(pdf): RPStatementDoc — enhanced R&P with opening balance and FD interest lines"
```

---

## Task 5 — Balance Sheet tab in ReportPage

### 5a — Add `BalanceSheetTab` component to `ReportPage.tsx`

The Balance Sheet shows the financial position "as at 31 March" for a chosen FY. Assets: bank balance (opening + CRs - DRs), active fixed deposits, corpus collected. Liabilities: pending maintenance dues, corpus balance yet to be collected. Net position = assets - liabilities.

Bank balance calculation: `opening_balance_<year>` + total CRs (all non-voided) - total DRs (all non-voided, i.e. expenses paid from bank). Note: we use the transactions table for CRs and DRs rather than expenses, because some DRs may be direct bank debits not captured as expenses. This is what the bank statement reflects.

- [ ] Add the following component to `ReportPage.tsx` (after `RPStatementTab`):

```typescript
// ── BALANCE SHEET TAB ─────────────────────────────────────────

function BalanceSheetTab() {
  const fy = getCurrentFy()
  const [selectedFyYear, setSelectedFyYear] = useState(fy.year)
  const selectedFy = getFyRange(selectedFyYear)
  const [generating, setGenerating] = useState(false)

  // Opening balance
  const { data: openingBalanceSetting } = useQuery({
    queryKey: ['opening-balance', selectedFyYear],
    queryFn: async () => {
      const { data } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', `opening_balance_${selectedFyYear}`)
        .maybeSingle()
      return parseInt(data?.value ?? '0', 10) || 0
    },
  })

  // Total CRs this FY (all non-voided)
  const { data: totalCR } = useQuery({
    queryKey: ['bs-total-cr', selectedFyYear],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('amount')
        .eq('cr_dr', 'CR')
        .neq('row_type', 'VOIDED')
        .gte('value_date', selectedFy.start)
        .lte('value_date', selectedFy.end)
      return (data ?? []).reduce((s: number, r: any) => s + (r.amount ?? 0), 0)
    },
  })

  // Total DRs this FY (all non-voided)
  const { data: totalDR } = useQuery({
    queryKey: ['bs-total-dr', selectedFyYear],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('amount')
        .eq('cr_dr', 'DR')
        .neq('row_type', 'VOIDED')
        .gte('value_date', selectedFy.start)
        .lte('value_date', selectedFy.end)
      return (data ?? []).reduce((s: number, r: any) => s + (r.amount ?? 0), 0)
    },
  })

  // Active fixed deposits
  const { data: activeFDs } = useQuery({
    queryKey: ['bs-active-fds'],
    queryFn: async () => {
      const { data } = await supabase
        .from('deposits')
        .select('principal')
        .eq('status', 'active')
      return (data ?? []).reduce((s: number, r: any) => s + (r.principal ?? 0), 0)
    },
  })

  // Corpus collected (all plans)
  const { data: corpusCollected } = useQuery({
    queryKey: ['bs-corpus-collected'],
    queryFn: async () => {
      const { data } = await supabase.from('v_corpus_tracker').select('collected')
      return (data ?? []).reduce((s: number, r: any) => s + (r.collected ?? 0), 0)
    },
  })

  // Pending maintenance dues (liabilities)
  const { data: pendingDues } = useQuery({
    queryKey: ['bs-pending-dues', selectedFyYear],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_dues_tracker')
        .select('pending')
        .eq('fiscal_year', selectedFyYear)
        .neq('status', 'Clear')
      return (data ?? []).reduce((s: number, r: any) => s + (r.pending ?? 0), 0)
    },
  })

  // Corpus balance yet to be collected (liabilities)
  const { data: corpusBalance } = useQuery({
    queryKey: ['bs-corpus-balance'],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_corpus_tracker')
        .select('balance')
        .gt('balance', 0)
      return (data ?? []).reduce((s: number, r: any) => s + (r.balance ?? 0), 0)
    },
  })

  const openBal     = openingBalanceSetting ?? 0
  const bankBalance = openBal + (totalCR ?? 0) - (totalDR ?? 0)
  const fdTotal     = activeFDs ?? 0
  const corpColl    = corpusCollected ?? 0
  const totalAssets = bankBalance + fdTotal + corpColl

  const pendDues    = pendingDues ?? 0
  const corpBal     = corpusBalance ?? 0
  const totalLiab   = pendDues + corpBal

  const netPosition = totalAssets - totalLiab

  async function handlePdf() {
    setGenerating(true)
    try {
      const [{ pdf }, { BalanceSheetDoc }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/reports/AgmPdfDocs'),
      ])
      const generated = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      const blob = await pdf(
        <BalanceSheetDoc
          fyLabel={selectedFy.label}
          asAtDate={`31 March ${selectedFyYear + 1}`}
          bankBalance={bankBalance}
          fdTotal={fdTotal}
          corpusCollected={corpColl}
          totalAssets={totalAssets}
          pendingDues={pendDues}
          corpusBalance={corpBal}
          totalLiabilities={totalLiab}
          netPosition={netPosition}
          generated={generated}
        />
      ).toBlob()
      triggerDownload(blob, `Balance_Sheet_${selectedFy.label.replace(/\s/g, '_')}.pdf`)
    } finally {
      setGenerating(false)
    }
  }

  const isLoading = openingBalanceSetting === undefined || totalCR === undefined

  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-sm font-medium" style={{ color: 'var(--ink-600)' }}>As at 31 March</label>
        <select
          value={selectedFyYear}
          onChange={e => setSelectedFyYear(Number(e.target.value))}
          className="ds-field"
        >
          {FISCAL_YEARS.map(f => <option key={f.year} value={f.year}>{f.year + 1} ({f.label})</option>)}
        </select>

        <div className="ml-auto">
          <button
            onClick={handlePdf}
            disabled={generating || isLoading}
            className="btn-primary flex items-center gap-2 py-2 px-4 text-sm disabled:opacity-50"
          >
            {generating
              ? <><Loader2 size={14} className="animate-spin" /> Generating PDF…</>
              : <><FileText size={14} /> Download PDF</>
            }
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="h-48 animate-pulse rounded-[var(--ds-radius)]" style={{ background: 'var(--ink-100)' }} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Assets */}
          <div className="surface !p-0 overflow-hidden">
            <div className="px-5 py-3 border-b hairline" style={{ background: 'var(--info-bg)' }}>
              <h3 className="font-semibold text-sm text-blue-800">ASSETS</h3>
              <p className="text-xs text-blue-600">as at 31 March {selectedFyYear + 1}</p>
            </div>
            {[
              { label: 'Bank balance',          amount: bankBalance, note: `Opening ₹${openBal.toLocaleString('en-IN')} + CRs − DRs` },
              { label: 'Fixed deposits (active)',amount: fdTotal,     note: 'Sum of active FD principals' },
              { label: 'Corpus fund collected',  amount: corpColl,   note: 'All plans combined' },
            ].map(({ label, amount, note }) => (
              <div key={label} className="flex justify-between items-start px-5 py-3 border-b hairline text-sm">
                <div>
                  <p style={{ color: 'var(--ink-700)' }}>{label}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--ink-400)' }}>{note}</p>
                </div>
                <span className="font-semibold ml-4 shrink-0" style={{ color: 'var(--ink-800)' }}>{formatINR(amount)}</span>
              </div>
            ))}
            <div className="flex justify-between items-center px-5 py-3 font-bold text-sm border-t-2 hairline text-blue-700" style={{ background: 'var(--info-bg)' }}>
              <span>Total Assets</span>
              <span>{formatINR(totalAssets)}</span>
            </div>
          </div>

          {/* Liabilities */}
          <div className="surface !p-0 overflow-hidden">
            <div className="px-5 py-3 border-b hairline" style={{ background: 'var(--bad-bg)' }}>
              <h3 className="font-semibold text-sm text-rose-800">LIABILITIES</h3>
              <p className="text-xs text-rose-600">as at 31 March {selectedFyYear + 1}</p>
            </div>
            {[
              { label: 'Pending maintenance dues', amount: pendDues, note: 'Flats with outstanding dues' },
              { label: 'Corpus yet to collect',    amount: corpBal,  note: 'Target minus collected (all plans)' },
            ].map(({ label, amount, note }) => (
              <div key={label} className="flex justify-between items-start px-5 py-3 border-b hairline text-sm">
                <div>
                  <p style={{ color: 'var(--ink-700)' }}>{label}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--ink-400)' }}>{note}</p>
                </div>
                <span className="font-semibold ml-4 shrink-0" style={{ color: 'var(--ink-800)' }}>{formatINR(amount)}</span>
              </div>
            ))}
            <div className="flex justify-between items-center px-5 py-3 font-bold text-sm border-t-2 hairline text-rose-700" style={{ background: 'var(--bad-bg)' }}>
              <span>Total Liabilities</span>
              <span>{formatINR(totalLiab)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Net position */}
      {!isLoading && (
        <div className={`surface !p-5 flex justify-between items-center text-lg font-bold border-2 rounded-[var(--ds-radius)] ${netPosition >= 0 ? 'border-green-300' : 'border-red-300'}`}
          style={{ background: netPosition >= 0 ? 'var(--ok-bg)' : 'var(--bad-bg)' }}>
          <div>
            <p>Net Position</p>
            <p className="text-xs font-normal mt-0.5" style={{ color: 'var(--ink-500)' }}>Total Assets − Total Liabilities</p>
          </div>
          <span className={netPosition >= 0 ? 'text-green-700' : 'text-red-600'}>
            {netPosition >= 0 ? '' : '−'}{formatINR(Math.abs(netPosition))}
          </span>
        </div>
      )}

      <p className="text-xs text-center" style={{ color: 'var(--ink-400)' }}>
        Note: Bank balance = opening balance (set in Settings) + all bank CRs − all bank DRs for {selectedFy.label}.
        Corpus collected is shown as an asset (ring-fenced fund).
      </p>
    </div>
  )
}
```

- [ ] Run `npx tsc --noEmit` — fix any type errors.

- [ ] Commit:
```
git add src/pages/ReportPage.tsx
git commit -m "feat(reports): Balance Sheet tab — assets, liabilities, net position with PDF export"
```

---

## Task 6 — `BalanceSheetDoc` PDF component

- [ ] At the bottom of `AgmPdfDocs.tsx`, add:

```typescript
// ── Balance Sheet ─────────────────────────────────────────────

export function BalanceSheetDoc({
  fyLabel, asAtDate,
  bankBalance, fdTotal, corpusCollected, totalAssets,
  pendingDues, corpusBalance, totalLiabilities, netPosition,
  generated,
}: {
  fyLabel: string
  asAtDate: string
  bankBalance: number
  fdTotal: number
  corpusCollected: number
  totalAssets: number
  pendingDues: number
  corpusBalance: number
  totalLiabilities: number
  netPosition: number
  generated: string
}) {
  return (
    <Document>
      <Page size="A4" style={S.page}>
        <View style={S.header}>
          <Text style={S.title}>Balance Sheet — {fyLabel}</Text>
          <Text style={S.subtitle}>The Lilac Apartment Association · Rajakil Pakkam, Chennai</Text>
          <Text style={[S.subtitle, { marginTop: 2 }]}>As at {asAtDate}</Text>
        </View>

        <View style={S.twoCol}>
          {/* Assets */}
          <View style={S.half}>
            <Text style={S.sectionHead}>ASSETS</Text>
            <View style={S.table}>
              {[
                { label: 'Bank balance',            amount: bankBalance },
                { label: 'Fixed deposits (active)', amount: fdTotal },
                { label: 'Corpus fund collected',   amount: corpusCollected },
              ].map((r, i) => (
                <View key={r.label} style={[S.row, i % 2 === 1 ? S.rowAlt : {}]}>
                  <Text style={S.col}>{r.label}</Text>
                  <Text style={S.colR}>{formatINR(r.amount)}</Text>
                </View>
              ))}
              <View style={S.rowTotal}>
                <Text style={[S.col, S.bold]}>Total Assets</Text>
                <Text style={[S.colR, S.bold]}>{formatINR(totalAssets)}</Text>
              </View>
            </View>
          </View>

          {/* Liabilities */}
          <View style={S.half}>
            <Text style={S.sectionHead}>LIABILITIES</Text>
            <View style={S.table}>
              {[
                { label: 'Pending maintenance dues', amount: pendingDues },
                { label: 'Corpus yet to collect',    amount: corpusBalance },
              ].map((r, i) => (
                <View key={r.label} style={[S.row, i % 2 === 1 ? S.rowAlt : {}]}>
                  <Text style={r.amount > 0 ? S.col : [S.col, { color: '#94a3b8' }]}>{r.label}</Text>
                  <Text style={S.colR}>{r.amount > 0 ? formatINR(r.amount) : '-'}</Text>
                </View>
              ))}
              <View style={S.rowTotal}>
                <Text style={[S.col, S.bold]}>Total Liabilities</Text>
                <Text style={[S.colR, S.bold]}>{formatINR(totalLiabilities)}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Net position */}
        <View style={[S.rowTotal, { marginTop: 16, paddingTop: 8, borderTop: '1.5pt solid #7c3aed' }]}>
          <Text style={[S.col, S.bold, { fontSize: 11 }]}>Net Position (Assets − Liabilities)</Text>
          <Text style={[S.colR, S.bold, { fontSize: 11, color: netPosition >= 0 ? '#16a34a' : '#dc2626' }]}>
            {netPosition >= 0 ? '' : '(Deficit) '}{formatINR(Math.abs(netPosition))}
          </Text>
        </View>

        <PageFooter generated={generated} />
      </Page>
    </Document>
  )
}
```

- [ ] Run `npx tsc --noEmit` — fix any type errors.

- [ ] Commit:
```
git add src/components/reports/AgmPdfDocs.tsx
git commit -m "feat(pdf): BalanceSheetDoc — AGM-ready balance sheet PDF component"
```

---

## Task 7 — TDS Compliance Register in Expenditure tab

The TDS register is a new sub-tab `'tds'` inside the existing `ExpenditureReportsTab`. It queries `expense_line_items` joined to `vendors`, groups by vendor, computes TDS thresholds, and exports to Excel via `xlsx`.

### 7a — Extend `ExpSubTab` and add sub-tab button

- [ ] In `ReportPage.tsx`, find:

```typescript
type ExpSubTab = 'category' | 'vendor' | 'trend'
```

Replace with:

```typescript
type ExpSubTab = 'category' | 'vendor' | 'trend' | 'tds'
```

- [ ] Find the sub-tab button array inside `ExpenditureReportsTab`:

```typescript
          {([
            { key: 'category', label: 'By category' },
            { key: 'vendor',   label: 'By vendor' },
            { key: 'trend',    label: 'Monthly trend' },
          ] as { key: ExpSubTab; label: string }[]).map(({ key, label }) => (
```

Replace with:

```typescript
          {([
            { key: 'category', label: 'By category' },
            { key: 'vendor',   label: 'By vendor' },
            { key: 'trend',    label: 'Monthly trend' },
            { key: 'tds',      label: 'TDS Register' },
          ] as { key: ExpSubTab; label: string }[]).map(({ key, label }) => (
```

### 7b — Add TDS data query and rendering

- [ ] Inside `ExpenditureReportsTab`, after the `monthlyTrend` query, add this new query:

```typescript
  // TDS register: vendor-wise totals from expense_line_items
  const { data: tdsRows, isLoading: loadingTds } = useQuery({
    queryKey: ['tds-register', selectedFyYear],
    queryFn: async () => {
      const [{ data: lineItems }, { data: vendors }] = await Promise.all([
        supabase
          .from('expense_line_items')
          .select('amount, vendor_id, payee_name_raw, category_id')
          .gte('created_at', selectedFy.start + 'T00:00:00')
          .lte('created_at', selectedFy.end + 'T23:59:59'),
        supabase.from('vendors').select('id, name, pan_number'),
      ])
      const vendorMap = new Map(
        (vendors ?? []).map((v: any) => [v.id, { name: v.name as string, pan: v.pan_number as string | null }])
      )
      // Group by vendor (prefer vendor_id; fall back to payee_name_raw)
      const grouped = new Map<string, { name: string; pan: string | null; total: number }>()
      for (const item of lineItems ?? []) {
        const vi  = (item as any).vendor_id
        const key = vi ?? ((item as any).payee_name_raw ?? 'Cash / Misc')
        if (!grouped.has(key)) {
          const info = vi ? (vendorMap.get(vi) ?? { name: (item as any).payee_name_raw ?? 'Unknown', pan: null }) : { name: (item as any).payee_name_raw ?? 'Cash / Misc', pan: null }
          grouped.set(key, { name: info.name, pan: info.pan, total: 0 })
        }
        grouped.get(key)!.total += (item as any).amount ?? 0
      }
      const TDS_THRESHOLD = 30000
      const TDS_RATE = 0.10
      return Array.from(grouped.values())
        .filter(r => r.total > 0)
        .map(r => ({
          name:         r.name,
          pan:          r.pan ?? '—',
          total:        r.total,
          overThreshold: Math.max(0, r.total - TDS_THRESHOLD),
          tdsDue:       r.total > TDS_THRESHOLD ? Math.round((r.total - TDS_THRESHOLD) * TDS_RATE) : 0,
          status:       r.total > TDS_THRESHOLD ? 'Due' : 'Below threshold',
        }))
        .sort((a, b) => b.total - a.total)
    },
  })
```

Note: `expense_line_items` has `created_at` (timestamptz), not `expense_date`. We filter by `created_at` for the FY range. Append the time component to the FY boundary strings.

- [ ] At the end of the return body inside `ExpenditureReportsTab`, before the closing `</div>`, add:

```typescript
      {/* TDS Register */}
      {subTab === 'tds' && (
        loadingTds ? (
          <div className="h-40 animate-pulse rounded-[var(--ds-radius)]" style={{ background: 'var(--ink-100)' }} />
        ) : !tdsRows?.length ? (
          <div className="surface !p-10 text-center text-[13px]" style={{ color: 'var(--ink-400)' }}>
            No expense line items found for {selectedFy.label}
          </div>
        ) : (
          <div className="surface !p-0 overflow-hidden">
            <div className="px-4 py-3 border-b hairline flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-sm">TDS Compliance Register — {selectedFy.label}</h3>
                <p className="text-xs mt-0.5" style={{ color: 'var(--ink-500)' }}>
                  Threshold: ₹30,000 per vendor · TDS rate: 10% on amount above threshold
                </p>
              </div>
              <button
                onClick={() => {
                  const wb = XLSX.utils.book_new()
                  const rows: any[][] = [
                    [`TDS Compliance Register — ${selectedFy.label}`],
                    [`The Lilac Apartment Association · Generated ${new Date().toLocaleDateString('en-IN')}`],
                    [],
                    ['Vendor / Payee', 'PAN', 'Total Paid (₹)', 'TDS Threshold (₹)', 'Amount Over Threshold (₹)', 'TDS @ 10% Due (₹)', 'Status'],
                    ...(tdsRows ?? []).map(r => [
                      r.name, r.pan, r.total, 30000, r.overThreshold, r.tdsDue, r.status,
                    ]),
                    [],
                    ['TOTAL', '', (tdsRows ?? []).reduce((s, r) => s + r.total, 0), '', (tdsRows ?? []).reduce((s, r) => s + r.overThreshold, 0), (tdsRows ?? []).reduce((s, r) => s + r.tdsDue, 0), ''],
                  ]
                  const ws = XLSX.utils.aoa_to_sheet(rows)
                  ws['!cols'] = [24, 14, 14, 14, 18, 14, 16].map(w => ({ wch: w }))
                  XLSX.utils.book_append_sheet(wb, ws, 'TDS Register')
                  XLSX.writeFile(wb, `TDS_Register_${selectedFy.label.replace(/\s/g, '_')}.xlsx`)
                }}
                className="flex items-center gap-1.5 text-sm hover:opacity-80"
                style={{ color: 'var(--brand-700)' }}
              >
                <Download size={14} /> Export Excel
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b hairline" style={{ background: 'var(--ink-50)' }}>
                  <tr>
                    <th className="text-left px-4 py-2.5 font-semibold" style={{ color: 'var(--ink-600)' }}>Vendor / Payee</th>
                    <th className="text-left px-4 py-2.5 font-semibold" style={{ color: 'var(--ink-600)' }}>PAN</th>
                    <th className="text-right px-4 py-2.5 font-semibold" style={{ color: 'var(--ink-600)' }}>Total Paid</th>
                    <th className="text-right px-4 py-2.5 font-semibold" style={{ color: 'var(--ink-600)' }}>Over Threshold</th>
                    <th className="text-right px-4 py-2.5 font-semibold" style={{ color: 'var(--ink-600)' }}>TDS @ 10%</th>
                    <th className="text-left px-4 py-2.5 font-semibold" style={{ color: 'var(--ink-600)' }}>Status</th>
                  </tr>
                </thead>
                <tbody className="divide-rows">
                  {(tdsRows ?? []).map((r, i) => (
                    <tr key={r.name} className={i % 2 === 1 ? 'bg-slate-50/50' : ''}>
                      <td className="px-4 py-2.5 font-medium">{r.name}</td>
                      <td className="px-4 py-2.5 font-mono text-xs" style={{ color: r.pan === '—' ? 'var(--ink-300)' : 'var(--ink-700)' }}>{r.pan}</td>
                      <td className="px-4 py-2.5 text-right font-semibold">{formatINR(r.total)}</td>
                      <td className="px-4 py-2.5 text-right" style={{ color: r.overThreshold > 0 ? 'var(--ink-800)' : 'var(--ink-300)' }}>
                        {r.overThreshold > 0 ? formatINR(r.overThreshold) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold" style={{ color: r.tdsDue > 0 ? '#d97706' : 'var(--ink-300)' }}>
                        {r.tdsDue > 0 ? formatINR(r.tdsDue) : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        {r.status === 'Due'
                          ? <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">TDS Due</span>
                          : <span className="text-xs" style={{ color: 'var(--ink-300)' }}>Below threshold</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 hairline" style={{ background: 'var(--ink-50)' }}>
                  <tr>
                    <td className="px-4 py-3 font-bold" colSpan={2}>Total</td>
                    <td className="px-4 py-3 text-right font-bold">{formatINR((tdsRows ?? []).reduce((s, r) => s + r.total, 0))}</td>
                    <td className="px-4 py-3 text-right font-bold">{formatINR((tdsRows ?? []).reduce((s, r) => s + r.overThreshold, 0))}</td>
                    <td className="px-4 py-3 text-right font-bold text-amber-600">{formatINR((tdsRows ?? []).reduce((s, r) => s + r.tdsDue, 0))}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )
      )}
```

- [ ] Run `npx tsc --noEmit` — fix any type errors.

- [ ] Commit:
```
git add src/pages/ReportPage.tsx
git commit -m "feat(reports): TDS Compliance Register — vendor-wise TDS table with Excel export"
```

---

## Task 8 — Final TypeScript check and deploy

- [ ] Run a full TypeScript check:
```
npx tsc --noEmit
```
Fix all errors before proceeding.

- [ ] Verify in the browser (dev server):
  1. Navigate to Reports → R&P Statement tab. Select a FY. Verify the four receipt lines appear, payments grouped by category, closing balance is correct.
  2. Click "Download PDF". Verify file downloads with the correct name and opens in a PDF viewer showing the two-column layout.
  3. Navigate to Reports → Balance Sheet tab. Verify assets and liabilities render with no loading spinners (data queries resolve).
  4. Click "Download PDF". Verify balance sheet PDF opens correctly.
  5. Navigate to Reports → Expenditure → TDS Register sub-tab. Verify vendor rows appear with PAN and status badges.
  6. Click "Export Excel". Verify `.xlsx` file downloads and opens with correct column headers and data.
  7. Navigate to Settings → Opening Balances. Enter a value for FY 2025-26, save, then return to Reports → R&P Statement and verify the opening balance is pre-filled.

- [ ] Commit all verified changes, then push to trigger Vercel deploy:
```
git push origin main
```

- [ ] In Vercel dashboard, confirm the deployment succeeds and the production URL shows the new tabs.

---

## Appendix — Data model decisions

### Why `opening_balance_<year>` in `app_settings` (not a new table)

`app_settings` is already a generic key-value store with an admin upsert path established in SettingsPage. Adding a new table for a single integer per FY would be over-engineering. The key convention `opening_balance_<year>` is unambiguous and consistent with `dues_start_fiscal_year`.

### Why FD interest = `maturity_amount - principal` (not an `interest_earned` column)

The `deposits` table (migration 028) does not have an `interest_earned` column. `maturity_amount` is the bank-confirmed payout. Computing `maturity_amount - principal` on `status = 'matured'` rows is accurate and requires no schema change. We filter by `matured_date` (not `maturity_date`) so we only count FDs that actually matured and paid out in the FY.

### Why TDS uses `expense_line_items.created_at` for FY filtering

`expense_line_items` has no `expense_date` column. The parent `expenses.expense_date` would require a join. Using `created_at` is a reasonable proxy — line items are created at the same time as the expense. If the committee needs exact FY filtering by voucher date, the fix is to add `expense_date` to `expense_line_items` in a future migration. This is out of scope for Stream 3.

### Why Balance Sheet bank balance uses transactions table (not expenses)

The spec says: "Bank balance = Opening balance + total CRs − total DRs (from transactions table)". This is correct because the transactions table is the actual bank statement import — it reflects real cash movements. Expenses may include non-cash adjustments. Using the raw bank statement CRs and DRs gives the most accurate bank balance figure.

### Why corpus collected is an asset in the Balance Sheet

Corpus funds are ring-fenced and held in trust for specific capital works. Showing them as an asset (matched by "corpus yet to collect" as a liability representing the outstanding obligation to collect) gives the complete picture. The net of these two lines represents the net corpus position.
