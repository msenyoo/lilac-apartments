import {
  Document, Page, Text, View, StyleSheet,
} from '@react-pdf/renderer'

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
        <Text key={i} style={[c.right ? S.colR : S.col, S.bold, ...(c.flex ? [{ flex: c.flex }] : [])]}>
          {c.label}
        </Text>
      ))}
    </View>
  )
}

export interface MaintenanceMonthRow {
  month: string
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

export function OwnerStatementDoc({ data }: { data: OwnerStatementData }) {
  return (
    <Document>
      <Page size="A4" style={S.page}>
        <View style={S.header}>
          <Text style={S.title}>Annual Maintenance Statement — {data.fyLabel}</Text>
          <Text style={S.subtitle}>The Lilac Apartment Association · Rajakil Pakkam, Chennai</Text>
          <Text style={[S.subtitle, { marginTop: 2 }]}>
            Flat {data.flatCode} · Block {data.block}
            {data.ownerName ? ` · ${data.ownerName}` : ''}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          {[
            { label: 'Total maintenance paid', value: fmtINR(data.totalMaintPaid) },
            { label: 'Total corpus paid',      value: fmtINR(data.totalCorpusPaid) },
            { label: 'Total paid',             value: fmtINR(data.totalMaintPaid + data.totalCorpusPaid) },
          ].map(({ label, value }) => (
            <View key={label} style={[{ flex: 1 }, S.summaryBox]}>
              <Text style={S.small}>{label}</Text>
              <Text style={[S.bold, { fontSize: 10, marginTop: 2 }]}>{value}</Text>
            </View>
          ))}
        </View>

        <Text style={S.sectionHead}>MAINTENANCE — MONTH BY MONTH</Text>
        <View style={S.table}>
          <TableHead cols={[
            { label: 'Month', flex: 2 },
            { label: 'Due',   right: true },
            { label: 'Paid',  right: true },
            { label: 'Balance', right: true },
          ]} />
          {data.maintenanceRows.map((r, i) => (
            <View key={r.month} style={[S.row, ...(i % 2 === 1 ? [S.rowAlt] : [])]}>
              <Text style={[S.col, { flex: 2 }]}>{r.month}</Text>
              <Text style={S.colR}>{fmtINR(r.due)}</Text>
              <Text style={[S.colR, ...(r.paid > 0 ? [{ color: '#16a34a' }] : [])]}>{fmtINR(r.paid)}</Text>
              <Text style={[S.colR, ...(r.balance > 0 ? [{ color: '#dc2626' }] : [{ color: '#16a34a' }])]}>
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
                <View key={r.planName} style={[S.row, ...(i % 2 === 1 ? [S.rowAlt] : [])]}>
                  <Text style={[S.col, { flex: 3 }]}>{r.planName}</Text>
                  <Text style={S.colR}>{fmtINR(r.target)}</Text>
                  <Text style={[S.colR, { color: '#16a34a' }]}>{fmtINR(r.paid)}</Text>
                  <Text style={[S.colR, ...(r.balance > 0 ? [{ color: '#d97706' }] : [{ color: '#16a34a' }])]}>
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
