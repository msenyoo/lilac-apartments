// Lazy-loaded via dynamic import — keep @react-pdf/renderer imports here only
import {
  Document, Page, Text, View, Image, StyleSheet,
} from '@react-pdf/renderer'
import type { PacketExpense } from '@/lib/approvalPacket'
import { LetterheadHeader, LetterheadFooter } from './Letterhead'

const S = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9, padding: 36, color: '#1e293b' },
  header: { marginBottom: 16, borderBottom: '1.5pt solid #7c3aed', paddingBottom: 8 },
  title: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: '#7c3aed', marginBottom: 2 },
  subtitle: { fontSize: 8, color: '#64748b' },
  expenseHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
    marginTop: 14, marginBottom: 4, paddingBottom: 3,
    borderBottom: '0.8pt solid #cbd5e1',
  },
  voucher: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#334155' },
  meta: { fontSize: 8, color: '#64748b', marginBottom: 6 },
  row: { flexDirection: 'row', borderBottom: '0.3pt solid #f1f5f9', paddingVertical: 3 },
  rowHead: { flexDirection: 'row', backgroundColor: '#f1f5f9', paddingVertical: 3 },
  rowTotal: { flexDirection: 'row', borderTop: '1pt solid #94a3b8', paddingTop: 4, marginTop: 2 },
  colDate: { width: 60, paddingHorizontal: 3 },
  colDesc: { flex: 1, paddingHorizontal: 3 },
  colCat: { width: 90, paddingHorizontal: 3 },
  colCc: { width: 60, paddingHorizontal: 3 },
  colAmt: { width: 70, paddingHorizontal: 3, textAlign: 'right' },
  bold: { fontFamily: 'Helvetica-Bold' },
  small: { fontSize: 7, color: '#64748b' },
  grandTotal: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginTop: 16, paddingTop: 6, borderTop: '1.5pt solid #7c3aed',
  },
  receiptPage: { fontFamily: 'Helvetica', fontSize: 8, padding: 36, color: '#1e293b' },
  receiptCaption: { fontSize: 8, color: '#64748b', marginBottom: 6 },
  receiptImage: { objectFit: 'contain', maxHeight: 660, marginBottom: 12 },
  footer: { position: 'absolute', bottom: 20, left: 36, right: 36, fontSize: 7, color: '#94a3b8', textAlign: 'center' },
})

function inr(n: number) {
  const abs = Math.abs(Math.round(n))
  const s = abs.toString()
  const last3 = s.slice(-3)
  const rest = s.slice(0, -3)
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3
  return (n < 0 ? '-' : '') + 'Rs.' + grouped
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function ApprovalPacketDoc({ expenses, generated }: {
  expenses: PacketExpense[]
  generated: string
}) {
  const grandTotal = expenses.reduce((s, e) => s + e.amount, 0)
  const allImages = expenses.flatMap(e => e.images)
  return (
    <Document>
      <Page size="A4" style={S.page}>
        <LetterheadHeader style={S.header}>
          <Text style={S.title}>Expense approval request</Text>
          <Text style={S.subtitle}>
            {expenses.length} expense{expenses.length !== 1 ? 's' : ''} · Total {inr(grandTotal)} · Generated {generated}
          </Text>
        </LetterheadHeader>

        {expenses.map((e, i) => (
          <View key={i}>
            <View style={S.expenseHead} wrap={false}>
              <Text style={S.voucher}>{e.voucher_no} · {e.description}</Text>
              <Text style={[S.voucher, { color: '#7c3aed' }]}>{inr(e.amount)}</Text>
            </View>
            <Text style={S.meta}>
              {fmtDate(e.expense_date)} · Paid to {e.payee} · {e.payment_mode} · {e.status}
            </Text>

            {e.lineItems.length > 0 && (
              <View>
                <View style={S.rowHead}>
                  <Text style={[S.colDate, S.bold]}>Date</Text>
                  <Text style={[S.colDesc, S.bold]}>Description</Text>
                  <Text style={[S.colCat, S.bold]}>Category</Text>
                  <Text style={[S.colCc, S.bold]}>Cost ctr</Text>
                  <Text style={[S.colAmt, S.bold]}>Amount</Text>
                </View>
                {e.lineItems.map((li, j) => (
                  <View key={j} style={S.row}>
                    <Text style={S.colDate}>{fmtDate(li.paid_date)}</Text>
                    <Text style={S.colDesc}>{li.description}</Text>
                    <Text style={S.colCat}>{li.category}</Text>
                    <Text style={S.colCc}>{li.cost_center}</Text>
                    <Text style={S.colAmt}>{inr(li.amount)}</Text>
                  </View>
                ))}
                <View style={S.rowTotal}>
                  <Text style={[S.colDesc, S.bold]}>Total · {e.lineItems.length} item{e.lineItems.length !== 1 ? 's' : ''}</Text>
                  <Text style={[S.colAmt, S.bold]}>{inr(e.lineItems.reduce((s, li) => s + li.amount, 0))}</Text>
                </View>
              </View>
            )}

            {e.pdfAttachments.length > 0 && (
              <Text style={[S.small, { marginTop: 3 }]}>
                PDF receipt{e.pdfAttachments.length !== 1 ? 's' : ''} on file (view in app): {e.pdfAttachments.join(', ')}
              </Text>
            )}
          </View>
        ))}

        {expenses.length > 1 && (
          <View style={S.grandTotal}>
            <Text style={S.bold}>Grand total · {expenses.length} expenses</Text>
            <Text style={[S.bold, { color: '#7c3aed', fontSize: 11 }]}>{inr(grandTotal)}</Text>
          </View>
        )}

        <LetterheadFooter style={S.footer} generated={generated} />
      </Page>

      {allImages.length > 0 && (
        <Page size="A4" style={S.receiptPage}>
          <LetterheadHeader style={S.header}>
            <Text style={S.title}>Receipts</Text>
            <Text style={S.subtitle}>{allImages.length} image{allImages.length !== 1 ? 's' : ''}</Text>
          </LetterheadHeader>
          {allImages.map((img, i) => (
            <View key={i} wrap={false}>
              <Text style={S.receiptCaption}>{img.caption}</Text>
              <Image src={img.dataUrl} style={S.receiptImage} />
            </View>
          ))}
          <LetterheadFooter style={S.footer} generated={generated} />
        </Page>
      )}
    </Document>
  )
}
