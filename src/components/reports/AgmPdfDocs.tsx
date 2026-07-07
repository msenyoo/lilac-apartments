// Lazy-loaded via React.lazy — keep @react-pdf/renderer imports here only
import {
  Document, Page, Text, View, StyleSheet,
} from '@react-pdf/renderer'
import { LetterheadHeader, LetterheadFooter } from './Letterhead'

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

export function ReceiptsPaymentsDoc({ receipts, payments, fyLabel, generated }: {
  receipts: RPRow[]
  payments: RPRow[]
  fyLabel: string
  generated: string
}) {
  const totalReceipts = receipts.reduce((s, r) => s + r.amount, 0)
  const totalPayments = payments.reduce((s, r) => s + r.amount, 0)
  const closingBal    = totalReceipts - totalPayments

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

        <LetterheadFooter style={S.footer} generated={generated} />
      </Page>
    </Document>
  )
}

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

        <LetterheadFooter style={S.footer} generated={generated} />
      </Page>
    </Document>
  )
}

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
