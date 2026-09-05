// Lazy-loaded via React.lazy — keep @react-pdf/renderer imports here only
import {
  Document, Page, Text, View, StyleSheet,
} from '@react-pdf/renderer'
import { LetterheadHeader, LetterheadFooter } from './Letterhead'
import { driveBalanceLabel } from '@/lib/contributions'

// ── Shared styles ──────────────────────────────────────────────

const S = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9, padding: 36, color: '#1e293b' },
  header: { marginBottom: 16, borderBottom: '1.5pt solid #7c3aed', paddingBottom: 8 },
  title: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: '#7c3aed', marginBottom: 2 },
  subtitle: { fontSize: 8, color: '#64748b' },
  sectionHead: {
    fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#475569',
    textTransform: 'uppercase', letterSpacing: 0.6,
    marginTop: 12, marginBottom: 4,
    borderBottom: '0.5pt solid #e2e8f0', paddingBottom: 2,
  },
  table: { marginBottom: 8 },
  row: { flexDirection: 'row', borderBottom: '0.3pt solid #f1f5f9', paddingVertical: 3 },
  rowAlt: { backgroundColor: '#f8fafc' },
  rowTotal: { flexDirection: 'row', borderTop: '1pt solid #94a3b8', paddingTop: 4, marginTop: 4 },
  col: { flex: 1, paddingHorizontal: 3 },
  colR: { flex: 1, paddingHorizontal: 3, textAlign: 'right' },
  bold: { fontFamily: 'Helvetica-Bold' },
  small: { fontSize: 7, color: '#64748b' },
  footer: { position: 'absolute', bottom: 20, left: 36, right: 36, fontSize: 7, color: '#94a3b8', textAlign: 'center' },
  twoCol: { flexDirection: 'row', gap: 16 },
  half: { flex: 1 },
})

function formatINR(n: number) {
  if (n === 0) return '-'
  // toLocaleString not reliable in pdf renderer; manual Indian grouping
  const abs = Math.abs(Math.round(n))
  const s = abs.toString()
  const last3 = s.slice(-3)
  const rest = s.slice(0, -3)
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3
  return (n < 0 ? '-' : '') + 'Rs.' + grouped
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

// ── Defaulters List ────────────────────────────────────────────

interface DefaulterRow {
  flat_code: string; block: string; annual_due: number
  collected_fy: number; pending: number
  arrears_maintenance?: number; total_outstanding?: number
  status: string
}

export function DefaultersListDoc({ rows, fyLabel, generated }: {
  rows: DefaulterRow[]
  fyLabel: string
  generated: string
}) {
  const total = rows.reduce((s, r) => s + (r.total_outstanding ?? r.pending), 0)
  return (
    <Document>
      <Page size="A4" style={S.page}>
        <LetterheadHeader style={S.header}>
          <Text style={S.title}>Defaulters List — {fyLabel}</Text>
          <Text style={S.subtitle}>{rows.length} flat(s) with outstanding maintenance dues</Text>
        </LetterheadHeader>

        <View style={S.table}>
          <TableHead cols={[
            { label: 'Flat' }, { label: 'Block' },
            { label: 'Annual Due', right: true }, { label: 'Collected', right: true },
            { label: 'Pending', right: true }, { label: 'Arrears', right: true },
            { label: 'Outstanding', right: true }, { label: 'Status' },
          ]} />
          {rows.map((r, i) => (
            <View key={r.flat_code} style={[S.row, i % 2 === 1 ? S.rowAlt : {}]}>
              <Text style={[S.col, S.bold]}>{r.flat_code}</Text>
              <Text style={S.col}>{r.block}</Text>
              <Text style={S.colR}>{formatINR(r.annual_due)}</Text>
              <Text style={S.colR}>{formatINR(r.collected_fy)}</Text>
              <Text style={S.colR}>{formatINR(r.pending)}</Text>
              <Text style={S.colR}>{formatINR(r.arrears_maintenance ?? 0)}</Text>
              <Text style={[S.colR, S.bold, { color: '#dc2626' }]}>{formatINR(r.total_outstanding ?? r.pending)}</Text>
              <Text style={S.col}>{r.status}</Text>
            </View>
          ))}
          <View style={S.rowTotal}>
            <Text style={[S.col, S.bold, { flex: 6 }]}>Total outstanding</Text>
            <Text style={[S.colR, S.bold, { color: '#dc2626' }]}>{formatINR(total)}</Text>
            <Text style={S.col} />
          </View>
        </View>

        <LetterheadFooter style={S.footer} generated={generated} />
      </Page>
    </Document>
  )
}

// ── Income & Expenditure Statement ────────────────────────────

interface IERow { category: string; amount: number }

export function IEStatementDoc({ income, expenditure, fyLabel, generated }: {
  income: IERow[]
  expenditure: IERow[]
  fyLabel: string
  generated: string
}) {
  const totalIncome  = income.reduce((s, r) => s + r.amount, 0)
  const totalExpense = expenditure.reduce((s, r) => s + r.amount, 0)
  const surplus      = totalIncome - totalExpense

  return (
    <Document>
      <Page size="A4" style={S.page}>
        <LetterheadHeader style={S.header}>
          <Text style={S.title}>Income &amp; Expenditure Statement — {fyLabel}</Text>
        </LetterheadHeader>

        <View style={S.twoCol}>
          {/* Income */}
          <View style={S.half}>
            <Text style={S.sectionHead}>INCOME</Text>
            <View style={S.table}>
              {income.map((r, i) => (
                <View key={r.category} style={[S.row, i % 2 === 1 ? S.rowAlt : {}]}>
                  <Text style={S.col}>{r.category}</Text>
                  <Text style={S.colR}>{formatINR(r.amount)}</Text>
                </View>
              ))}
              <View style={S.rowTotal}>
                <Text style={[S.col, S.bold]}>Total Income</Text>
                <Text style={[S.colR, S.bold]}>{formatINR(totalIncome)}</Text>
              </View>
            </View>
          </View>

          {/* Expenditure */}
          <View style={S.half}>
            <Text style={S.sectionHead}>EXPENDITURE</Text>
            <View style={S.table}>
              {expenditure.map((r, i) => (
                <View key={r.category} style={[S.row, i % 2 === 1 ? S.rowAlt : {}]}>
                  <Text style={S.col}>{r.category}</Text>
                  <Text style={S.colR}>{formatINR(r.amount)}</Text>
                </View>
              ))}
              <View style={S.rowTotal}>
                <Text style={[S.col, S.bold]}>Total Expenditure</Text>
                <Text style={[S.colR, S.bold]}>{formatINR(totalExpense)}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Surplus/Deficit */}
        <View style={[S.rowTotal, { marginTop: 12 }]}>
          <Text style={[S.col, S.bold, { fontSize: 10 }]}>
            {surplus >= 0 ? 'Surplus for the year' : 'Deficit for the year'}
          </Text>
          <Text style={[S.colR, S.bold, { fontSize: 10, color: surplus >= 0 ? '#16a34a' : '#dc2626' }]}>
            {formatINR(Math.abs(surplus))}
          </Text>
        </View>

        <LetterheadFooter style={S.footer} generated={generated} />
      </Page>
    </Document>
  )
}

// ── Corpus Fund Statement ─────────────────────────────────────

interface CorpusPlanSummary {
  plan_name: string; plan_status: string
  start_fiscal_year: number; end_fiscal_year: number
  total_target: number; total_collected: number; total_balance: number
  flats: { flat_code: string; corpus_target: number; collected: number; balance: number; status: string }[]
}

// ── Receipts & Payments Account ──────────────────────────────

interface RPRow { category: string; amount: number }
interface DirectPaymentRow { description: string; amount: number }

export function ReceiptsPaymentsDoc({ receipts, payments, directPayments, fyLabel, generated }: {
  receipts: RPRow[]
  payments: RPRow[]
  directPayments?: DirectPaymentRow[]
  fyLabel: string
  generated: string
}) {
  const totalReceipts = receipts.reduce((s, r) => s + r.amount, 0)
  const totalPayments = payments.reduce((s, r) => s + r.amount, 0)
  const closingBal    = totalReceipts - totalPayments
  const totalDirect   = (directPayments ?? []).reduce((s, r) => s + r.amount, 0)

  return (
    <Document>
      <Page size="A4" style={S.page}>
        <LetterheadHeader style={S.header}>
          <Text style={S.title}>Receipts &amp; Payments Account — {fyLabel}</Text>
          <Text style={S.subtitle}>
            Cash basis · All monetary transactions for the financial year
          </Text>
        </LetterheadHeader>

        <View style={S.twoCol}>
          {/* Receipts */}
          <View style={S.half}>
            <Text style={S.sectionHead}>RECEIPTS</Text>
            <View style={S.table}>
              {receipts.map((r, i) => (
                <View key={r.category} style={[S.row, i % 2 === 1 ? S.rowAlt : {}]}>
                  <Text style={S.col}>{r.category}</Text>
                  <Text style={S.colR}>{formatINR(r.amount)}</Text>
                </View>
              ))}
              <View style={S.rowTotal}>
                <Text style={[S.col, S.bold]}>Total Receipts</Text>
                <Text style={[S.colR, S.bold]}>{formatINR(totalReceipts)}</Text>
              </View>
            </View>
          </View>

          {/* Payments */}
          <View style={S.half}>
            <Text style={S.sectionHead}>PAYMENTS</Text>
            <View style={S.table}>
              {payments.map((r, i) => (
                <View key={r.category} style={[S.row, i % 2 === 1 ? S.rowAlt : {}]}>
                  <Text style={S.col}>{r.category}</Text>
                  <Text style={S.colR}>{formatINR(r.amount)}</Text>
                </View>
              ))}
              {closingBal > 0 && (
                <View style={[S.row, (payments.length) % 2 === 1 ? S.rowAlt : {}]}>
                  <Text style={S.col}>Closing Balance</Text>
                  <Text style={S.colR}>{formatINR(closingBal)}</Text>
                </View>
              )}
              <View style={S.rowTotal}>
                <Text style={[S.col, S.bold]}>Total Payments</Text>
                <Text style={[S.colR, S.bold]}>{formatINR(totalReceipts)}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Net */}
        <View style={[S.rowTotal, { marginTop: 12 }]}>
          <Text style={[S.col, S.bold, { fontSize: 10 }]}>
            {closingBal >= 0 ? 'Closing balance (surplus)' : 'Deficit for the year'}
          </Text>
          <Text style={[S.colR, S.bold, { fontSize: 10, color: closingBal >= 0 ? '#16a34a' : '#dc2626' }]}>
            {formatINR(Math.abs(closingBal))}
          </Text>
        </View>

        {totalDirect > 0 && (
          <View style={{ marginTop: 10 }}>
            <Text style={S.small}>
              Includes {formatINR(totalDirect)} paid directly by flat-owner(s) to vendors (no bank movement):
            </Text>
            {(directPayments ?? []).map((d, i) => (
              <Text key={i} style={[S.small, { marginTop: 2 }]}>
                • {d.description} — {formatINR(d.amount)}
              </Text>
            ))}
          </View>
        )}

        <LetterheadFooter style={S.footer} generated={generated} />
      </Page>
    </Document>
  )
}

// ── R&P Statement (enhanced: opening balance + FD interest) ───

interface RPPaymentRow { category: string; amount: number }

export function RPStatementDoc({
  fyLabel, openingBalance, maintenanceCR, corpusCR, contributionCR, fdInterest, pettyCashOpening, pettyCashClosing, payments, generated,
}: {
  fyLabel: string
  openingBalance: number
  maintenanceCR: number
  corpusCR: number
  contributionCR?: number
  fdInterest: number
  pettyCashOpening: number
  pettyCashClosing: number
  payments: RPPaymentRow[]
  generated: string
}) {
  const contCR = contributionCR ?? 0
  const totalReceipts = openingBalance + maintenanceCR + corpusCR + contCR + fdInterest
  const totalPayments = payments.reduce((s, r) => s + r.amount, 0)
  const closingBal    = totalReceipts - totalPayments

  const receiptLines = [
    { label: 'Opening balance (b/f)', amount: openingBalance },
    { label: 'Maintenance collected', amount: maintenanceCR },
    { label: 'Corpus collected',      amount: corpusCR },
    { label: 'Contribution collected', amount: contCR },
    { label: 'FD interest received',  amount: fdInterest },
  ].filter(r => r.amount > 0)

  const paymentLines: RPPaymentRow[] = closingBal > 0
    ? [...payments, { category: 'Closing Balance (c/f)', amount: closingBal }]
    : payments

  return (
    <Document>
      <Page size="A4" style={S.page}>
        <LetterheadHeader style={S.header}>
          <Text style={S.title}>Receipts &amp; Payments Statement — {fyLabel}</Text>
          <Text style={S.subtitle}>
            Cash basis · Financial year 1 April to 31 March
          </Text>
        </LetterheadHeader>

        <View style={S.twoCol}>
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
          Petty Cash: opening {formatINR(pettyCashOpening)}{' -> closing '}{formatINR(pettyCashClosing)}
        </Text>

        <LetterheadFooter style={S.footer} generated={generated} />
      </Page>
    </Document>
  )
}

// ── Balance Sheet ─────────────────────────────────────────────

export function BalanceSheetDoc({
  fyLabel, asAtDate,
  bankBalance, fdTotal, corpusHeld, cashInHand, totalAssets,
  pendingDues, corpusBalance, totalLiabilities, netPosition,
  generated,
}: {
  fyLabel: string
  asAtDate: string
  bankBalance: number
  fdTotal: number
  // Lifetime corpus collected minus lifetime corpus spend — the portion still ring-fenced
  // within Bank balance today, not the raw lifetime collection total.
  corpusHeld: number
  cashInHand: number
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
        <LetterheadHeader style={S.header}>
          <Text style={S.title}>Balance Sheet — {fyLabel}</Text>
          <Text style={S.subtitle}>As at {asAtDate}</Text>
        </LetterheadHeader>

        <View style={S.twoCol}>
          <View style={S.half}>
            <Text style={S.sectionHead}>ASSETS</Text>
            <View style={S.table}>
              {[
                { label: 'Bank balance',            amount: bankBalance },
                { label: 'Fixed deposits (active)', amount: fdTotal },
                { label: 'Cash in hand',            amount: cashInHand },
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

          <View style={S.half}>
            <Text style={S.sectionHead}>LIABILITIES</Text>
            <View style={S.table}>
              {[
                { label: 'Pending maintenance dues', amount: pendingDues },
                { label: 'Corpus fund (still held)', amount: corpusHeld },
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
              <View style={[S.row, { marginTop: 4 }]}>
                <Text style={[S.col, S.small]}>Memo: Corpus yet to collect (future target, not a current obligation)</Text>
                <Text style={[S.colR, S.small]}>{formatINR(corpusBalance)}</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={[S.rowTotal, { marginTop: 16, paddingTop: 8, borderTop: '1.5pt solid #7c3aed' }]}>
          <Text style={[S.col, S.bold, { fontSize: 11 }]}>Net Position (Assets − Liabilities)</Text>
          <Text style={[S.colR, S.bold, { fontSize: 11, color: netPosition >= 0 ? '#16a34a' : '#dc2626' }]}>
            {netPosition >= 0 ? '' : '(Deficit) '}{formatINR(Math.abs(netPosition))}
          </Text>
        </View>

        <LetterheadFooter style={S.footer} generated={generated} />
      </Page>
    </Document>
  )
}

export function CorpusFundDoc({ plans, generated }: {
  plans: CorpusPlanSummary[]
  generated: string
}) {
  return (
    <Document>
      {plans.map(plan => (
        <Page key={plan.plan_name} size="A4" style={S.page}>
          <LetterheadHeader style={S.header}>
            <Text style={S.title}>Corpus Fund Statement — {plan.plan_name}</Text>
            <Text style={S.subtitle}>
              FY {plan.start_fiscal_year}-{String(plan.start_fiscal_year + 1).slice(-2)} to FY {plan.end_fiscal_year}-{String(plan.end_fiscal_year + 1).slice(-2)}
            </Text>
          </LetterheadHeader>

          {/* Plan summary */}
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            {[
              { label: 'Target', value: formatINR(plan.total_target) },
              { label: 'Collected', value: formatINR(plan.total_collected) },
              { label: 'Balance', value: formatINR(plan.total_balance) },
              { label: 'Status', value: plan.plan_status.toUpperCase() },
            ].map(({ label, value }) => (
              <View key={label} style={{ flex: 1, backgroundColor: '#f8fafc', borderRadius: 4, padding: 6, border: '0.5pt solid #e2e8f0' }}>
                <Text style={[S.small, { marginBottom: 2 }]}>{label}</Text>
                <Text style={[S.bold, { fontSize: 10 }]}>{value}</Text>
              </View>
            ))}
          </View>

          {/* Per-flat table */}
          <Text style={S.sectionHead}>FLAT-WISE COLLECTION</Text>
          <View style={S.table}>
            <TableHead cols={[
              { label: 'Flat' }, { label: 'Target', right: true },
              { label: 'Collected', right: true }, { label: 'Balance', right: true }, { label: 'Status' },
            ]} />
            {plan.flats.map((f, i) => (
              <View key={f.flat_code} style={[S.row, i % 2 === 1 ? S.rowAlt : {}]}>
                <Text style={[S.col, S.bold]}>{f.flat_code}</Text>
                <Text style={S.colR}>{formatINR(f.corpus_target)}</Text>
                <Text style={S.colR}>{formatINR(f.collected)}</Text>
                <Text style={[S.colR, f.balance > 0 ? { color: '#d97706' } : { color: '#16a34a' }]}>
                  {f.balance > 0 ? formatINR(f.balance) : '✓ Done'}
                </Text>
                <Text style={S.col}>{f.status}</Text>
              </View>
            ))}
            <View style={S.rowTotal}>
              <Text style={[S.col, S.bold]}>Total</Text>
              <Text style={[S.colR, S.bold]}>{formatINR(plan.total_target)}</Text>
              <Text style={[S.colR, S.bold]}>{formatINR(plan.total_collected)}</Text>
              <Text style={[S.colR, S.bold, { color: plan.total_balance > 0 ? '#d97706' : '#16a34a' }]}>
                {formatINR(plan.total_balance)}
              </Text>
              <Text style={S.col} />
            </View>
          </View>

          <LetterheadFooter style={S.footer} generated={generated} />
        </Page>
      ))}
    </Document>
  )
}

// ── Cashbook ────────────────────────────────────────────────────

const PDF_MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function formatShortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d} ${PDF_MONTHS_SHORT[Number(m) - 1]}`
}

interface CashbookCrRow { category: string; amount: number }
interface CashbookDrItem { date: string | null; label: string; qty: string; amount: number }
interface CashbookDrGroup { category: string; total: number; items: CashbookDrItem[] }
interface CashbookDuesRow { label: string; amount: number; flats: number }

export function CashbookDoc({
  month, openingBalance, closingBalance, pettyCashOpening, pettyCashClosing, receipts, payments, dues, duesAsOf, generated,
}: {
  month: string
  openingBalance: number
  closingBalance: number
  pettyCashOpening: number
  pettyCashClosing: number
  receipts: CashbookCrRow[]
  payments: CashbookDrGroup[]
  dues: CashbookDuesRow[]
  duesAsOf: string
  generated: string
}) {
  const totalReceipts = receipts.reduce((s, r) => s + r.amount, 0)
  const totalPayments = payments.reduce((s, g) => s + g.total, 0)

  return (
    <Document>
      <Page size="A4" style={S.page}>
        <LetterheadHeader style={S.header}>
          <Text style={S.title}>Cash Book Statement — {month}</Text>
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
                    {group.items.map((item, i) => (
                      <View key={`${item.label}_${item.date ?? ''}_${i}`} style={S.row}>
                        <Text style={[S.col, S.small, { paddingLeft: 8 }]}>
                          {item.date ? `${formatShortDate(item.date)}  ${item.label}` : item.label}
                          {item.qty ? `  (${item.qty})` : ''}
                        </Text>
                        <Text style={[S.colR, S.small]}>{formatINR(item.amount)}</Text>
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

        <Text style={[S.small, { marginTop: 4 }]}>
          Petty Cash: opening {formatINR(pettyCashOpening)}{' -> closing '}{formatINR(pettyCashClosing)}
        </Text>

        <Text style={[S.sectionHead, { marginTop: 12 }]}>PENDING DUES (AS OF {duesAsOf.toUpperCase()})</Text>
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

        <Text style={[S.small, { marginTop: 8, textAlign: 'center' }]}>
          Opening/Closing balance is the audited bank position for {month}. Total Payments is the sum of
          recorded expenses and may not exactly match the bank-derived Closing - Opening delta if a cash
          expense isn't yet linked to a bank transaction.
        </Text>

        <LetterheadFooter style={S.footer} generated={generated} />
      </Page>
    </Document>
  )
}

// ── Contribution Drive Statement ────────────────────────────────

interface ContributionDriveRow {
  value_date: string; flat_code: string | null; contributor: string | null
  cr_dr: 'CR' | 'DR'; amount: number; description: string
}

function fmtLongDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function ContributionDriveDoc({ driveName, description, status, collected, disbursed, rows, generated }: {
  driveName: string; description: string | null; status: string
  collected: number; disbursed: number; rows: ContributionDriveRow[]; generated: string
}) {
  const balance = collected - disbursed
  const balanceInfo = driveBalanceLabel(balance)
  const drRows = rows.filter(r => r.cr_dr === 'DR')
  return (
    <Document>
      <Page size="A4" style={S.page}>
        <LetterheadHeader style={S.header}>
          <Text style={S.title}>Contribution Drive — {driveName}</Text>
          <Text style={S.subtitle}>{status.toUpperCase()}{description ? ` · ${description}` : ''}</Text>
        </LetterheadHeader>

        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          {[
            { label: 'Collected', value: formatINR(collected) },
            { label: 'Disbursed', value: formatINR(disbursed) },
            // Omit when collected exactly covers disbursed — nothing to report either way.
            ...(balance !== 0 ? [{ label: balanceInfo.label, value: formatINR(balanceInfo.amount) }] : []),
          ].map(({ label, value }) => (
            <View key={label} style={{ flex: 1, backgroundColor: '#f8fafc', borderRadius: 4, padding: 6, border: '0.5pt solid #e2e8f0' }}>
              <Text style={[S.small, { marginBottom: 2 }]}>{label}</Text>
              <Text style={[S.bold, { fontSize: 10 }, balanceInfo.overpaid ? { color: '#dc2626' } : {}]}>{value}</Text>
            </View>
          ))}
        </View>

        <Text style={S.sectionHead}>TRANSACTIONS — SORTED BY FLAT</Text>
        <View style={S.table}>
          <TableHead cols={[
            { label: 'Flat', flex: 0.7 }, { label: 'Contributor', flex: 1.3 },
            { label: 'Date' }, { label: 'Amount', right: true },
          ]} />
          {rows.map((r, i) => (
            <View key={i} style={[S.row, i % 2 === 1 ? S.rowAlt : {}]}>
              <Text style={[S.col, S.bold, { flex: 0.7 }]}>{r.flat_code || '—'}</Text>
              <Text style={[S.col, { flex: 1.3 }]}>{r.contributor ?? '—'}</Text>
              <Text style={S.col}>{fmtLongDate(r.value_date)}</Text>
              <Text style={[S.colR, r.cr_dr === 'DR' ? { color: '#dc2626' } : {}]}>
                {r.cr_dr === 'DR' ? '− ' : ''}{formatINR(r.amount)}
              </Text>
            </View>
          ))}
          <View style={S.rowTotal}>
            <Text style={[S.col, S.bold, { flex: 2 }]}>{balanceInfo.label}</Text>
            <Text style={S.col} />
            <Text style={[S.colR, S.bold, balanceInfo.overpaid ? { color: '#dc2626' } : {}]}>{formatINR(balanceInfo.amount)}</Text>
          </View>
        </View>

        <LetterheadFooter style={S.footer} generated={generated} />
      </Page>

      {drRows.length > 0 && (
        <Page size="A4" style={S.page}>
          <LetterheadHeader style={S.header}>
            <Text style={S.title}>Contribution Drive — {driveName}</Text>
            <Text style={S.subtitle}>Disbursement vouchers · {drRows.length} payment{drRows.length !== 1 ? 's' : ''}</Text>
          </LetterheadHeader>

          {drRows.map((r, i) => (
            <View key={i} wrap={false} style={{
              marginBottom: 14, padding: 10, borderRadius: 4,
              border: '0.8pt solid #bbf7d0', backgroundColor: '#f0fdf4',
            }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 6, borderBottom: '0.8pt solid #bbf7d0', paddingBottom: 4 }}>
                <Text style={[S.bold, { fontSize: 10, color: '#166534' }]}>Disbursement voucher</Text>
                <Text style={[S.bold, { fontSize: 13, color: '#16a34a' }]}>{formatINR(r.amount)}</Text>
              </View>
              <View style={S.row}>
                <Text style={[S.col, S.small, { flex: 0.6 }]}>Date</Text>
                <Text style={S.col}>{fmtLongDate(r.value_date)}</Text>
              </View>
              <View style={S.row}>
                <Text style={[S.col, S.small, { flex: 0.6 }]}>Paid to</Text>
                <Text style={[S.col, S.bold]}>{r.contributor ?? '—'}</Text>
              </View>
              <View style={S.row}>
                <Text style={[S.col, S.small, { flex: 0.6 }]}>Bank reference</Text>
                <Text style={S.col}>{r.description}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 24, marginTop: 14 }}>
                <Text style={[S.small, { flex: 1, borderTop: '0.5pt solid #94a3b8', paddingTop: 3 }]}>Received by</Text>
                <Text style={[S.small, { flex: 1, borderTop: '0.5pt solid #94a3b8', paddingTop: 3 }]}>Date</Text>
              </View>
            </View>
          ))}

          <LetterheadFooter style={S.footer} generated={generated} />
        </Page>
      )}
    </Document>
  )
}

// ── Flat Statement ────────────────────────────────────────────

interface FlatStatementRow {
  value_date: string; fiscal_label: string; cr_dr: 'CR' | 'DR'; amount: number
  category: string | null; corpus: 'YES' | 'NO'; row_type: string; description: string
}

export function FlatStatementDoc({
  flatCode, bhkType, periodLabel, sinceFyLabel,
  rate, maintenanceCollected, outstanding,
  corpus, rows, generated,
}: {
  flatCode: string; bhkType: string; periodLabel: string; sinceFyLabel: string
  rate: number; maintenanceCollected: number; outstanding: number | null
  corpus: { collected: number; target: number; balance: number } | null
  rows: FlatStatementRow[]; generated: string
}) {
  return (
    <Document>
      <Page size="A4" style={S.page}>
        <LetterheadHeader style={S.header}>
          <Text style={S.title}>Flat Statement — {flatCode}</Text>
          <Text style={S.subtitle}>{bhkType} · Period: {periodLabel}</Text>
        </LetterheadHeader>

        <Text style={S.sectionHead}>SUMMARY (cumulative since {sinceFyLabel})</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          {[
            { label: 'Rate / month', value: formatINR(rate) },
            { label: 'Maintenance collected', value: formatINR(maintenanceCollected) },
            { label: 'Outstanding', value: outstanding !== null ? (outstanding > 0 ? formatINR(outstanding) : 'Clear') : '—',
              color: outstanding !== null && outstanding > 0 ? '#dc2626' : '#16a34a' },
            ...(corpus ? [{ label: 'Corpus balance', value: formatINR(corpus.balance) }] : []),
          ].map(({ label, value, color }) => (
            <View key={label} style={{ flex: 1, backgroundColor: '#f8fafc', borderRadius: 4, padding: 6, border: '0.5pt solid #e2e8f0' }}>
              <Text style={[S.small, { marginBottom: 2 }]}>{label}</Text>
              <Text style={[S.bold, { fontSize: 10 }, color ? { color } : {}]}>{value}</Text>
            </View>
          ))}
        </View>

        {corpus && (
          <>
            <Text style={S.sectionHead}>CORPUS</Text>
            <View style={S.table}>
              <TableHead cols={[{ label: 'Collected', right: true }, { label: 'Target', right: true }, { label: 'Balance', right: true }]} />
              <View style={S.row}>
                <Text style={S.colR}>{formatINR(corpus.collected)}</Text>
                <Text style={S.colR}>{formatINR(corpus.target)}</Text>
                <Text style={S.colR}>{formatINR(corpus.balance)}</Text>
              </View>
            </View>
          </>
        )}

        <Text style={S.sectionHead}>TRANSACTIONS</Text>
        <View style={S.table}>
          <TableHead cols={[
            { label: 'Date' }, { label: 'Category', flex: 2 },
            { label: 'Amount', right: true },
          ]} />
          {rows.map((r, i) => (
            <View key={i} style={[S.row, i % 2 === 1 ? S.rowAlt : {}]}>
              <Text style={S.col}>{fmtLongDate(r.value_date)}</Text>
              <Text style={[S.col, { flex: 2 }]}>
                {r.category ?? '—'}{r.corpus === 'YES' && r.category !== 'Corpus' ? ' (Corpus)' : ''}
                {r.row_type !== 'Normal' ? ` · ${r.row_type}` : ''}
              </Text>
              <Text style={[S.colR, r.cr_dr === 'DR' ? { color: '#dc2626' } : { color: '#16a34a' }]}>
                {r.cr_dr === 'DR' ? '− ' : ''}{formatINR(r.amount)}
              </Text>
            </View>
          ))}
        </View>

        <LetterheadFooter style={S.footer} generated={generated} />
      </Page>
    </Document>
  )
}
