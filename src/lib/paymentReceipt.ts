import type { Transaction } from '@/lib/supabase'
import type { PaymentReceiptData } from '@/components/reports/PaymentReceiptPdf'

export type ReceiptTxn = Pick<Transaction, 'value_date' | 'amount' | 'description' | 'category' | 'corpus' | 'months_covered'>

export function buildReceiptData(
  txn: ReceiptTxn,
  flat: { code: string; block: string },
  planName: string | null,
): PaymentReceiptData {
  const categoryLabel = txn.corpus === 'YES'
    ? (planName ? `Corpus Fund — ${planName}` : 'Corpus Fund')
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
