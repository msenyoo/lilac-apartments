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
