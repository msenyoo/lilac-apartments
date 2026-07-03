import { supabase } from '@/lib/supabase'
import { isHeicName, heicBlobToObjectUrl } from '@/lib/heic'

export interface PacketLineItem {
  paid_date: string | null
  description: string
  category: string
  cost_center: string
  amount: number
}

export interface PacketExpense {
  voucher_no: string
  expense_date: string
  description: string
  payee: string
  amount: number
  payment_mode: string
  status: string
  lineItems: PacketLineItem[]
  images: { dataUrl: string; caption: string }[]
  pdfAttachments: string[]
}

interface SourceExpense {
  id: string
  voucher_no: string | null
  expense_date: string
  description: string
  payee_name_raw: string | null
  vendor: { name: string } | null
  staff_member: { name: string } | null
  amount: number
  payment_mode: string
  line_items: {
    paid_date: string | null
    description: string
    cost_center: string
    amount: number
    category: { name: string } | null
  }[]
}

async function toJpegDataUrl(src: string, maxDim = 1400): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error('image decode failed'))
    i.src = src
  })
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.8)
}

export async function buildPacketExpenses<T extends SourceExpense>(
  expenses: T[],
  statusOf: (e: T) => string,
): Promise<PacketExpense[]> {
  const ids = expenses.map(e => e.id)
  const { data: attachments, error } = await supabase
    .from('expense_attachments')
    .select('expense_id, file_name, file_url')
    .in('expense_id', ids)
    .order('uploaded_at')
  if (error) throw error

  const byExpense = new Map<string, { file_name: string; file_url: string }[]>()
  for (const a of attachments ?? []) {
    const list = byExpense.get(a.expense_id) ?? []
    list.push(a)
    byExpense.set(a.expense_id, list)
  }

  const out: PacketExpense[] = []
  for (const e of expenses) {
    const images: PacketExpense['images'] = []
    const pdfAttachments: string[] = []
    const atts = byExpense.get(e.id) ?? []
    for (let i = 0; i < atts.length; i++) {
      const att = atts[i]
      const caption = `${e.voucher_no ?? e.description} · receipt ${i + 1} of ${atts.length} · ${att.file_name}`
      if (att.file_url.toLowerCase().endsWith('.pdf') || att.file_name.toLowerCase().endsWith('.pdf')) {
        pdfAttachments.push(att.file_name)
        continue
      }
      try {
        const { data: blob, error: dlErr } = await supabase.storage
          .from('expense-attachments')
          .download(att.file_url)
        if (dlErr || !blob) throw dlErr ?? new Error('download failed')
        const objUrl = isHeicName(att.file_name) || isHeicName(att.file_url)
          ? await heicBlobToObjectUrl(blob)
          : URL.createObjectURL(blob)
        try {
          images.push({ dataUrl: await toJpegDataUrl(objUrl), caption })
        } finally {
          URL.revokeObjectURL(objUrl)
        }
      } catch {
        pdfAttachments.push(`${att.file_name} (could not be embedded)`)
      }
    }
    out.push({
      voucher_no: e.voucher_no ?? '—',
      expense_date: e.expense_date,
      description: e.description,
      payee: e.payee_name_raw ?? e.vendor?.name ?? e.staff_member?.name ?? '—',
      amount: e.amount,
      payment_mode: e.payment_mode,
      status: statusOf(e),
      lineItems: e.line_items.map(li => ({
        paid_date: li.paid_date,
        description: li.description,
        category: li.category?.name ?? '—',
        cost_center: li.cost_center,
        amount: li.amount,
      })),
      images,
      pdfAttachments,
    })
  }
  return out
}

export async function sharePdf(blob: Blob, filename: string): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], filename, { type: 'application/pdf' })
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename })
      return 'shared'
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'shared'
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  return 'downloaded'
}
