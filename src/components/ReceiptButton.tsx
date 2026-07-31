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
