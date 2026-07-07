import { Send } from 'lucide-react'
import type { FlatContact } from '@/lib/contacts'

export function WhatsAppSendButtons({ contacts, text }: { contacts: FlatContact[]; text: string }) {
  const open = (waPhone?: string) => window.open(
    waPhone
      ? `https://wa.me/${waPhone}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`,
    '_blank', 'noopener')

  if (!contacts.length) {
    return (
      <button onClick={() => open()}
        className="flex-1 flex items-center justify-center gap-2 py-2 rounded-[10px] border font-medium text-[13px] transition-colors"
        style={{ borderColor: 'var(--ok-bd)', background: 'var(--ok-bg)', color: 'var(--ok)' }}
        title="No phone on file — opens WhatsApp share to pick a contact">
        <Send size={14} /> Share
      </button>
    )
  }
  return (
    <div className="flex flex-col gap-1.5 flex-1">
      {contacts.map(c => (
        <button key={c.waPhone + c.name} onClick={() => open(c.waPhone)}
          className="flex items-center justify-center gap-2 py-2 rounded-[10px] border font-medium text-[13px] transition-colors"
          style={{ borderColor: 'var(--ok-bd)', background: 'var(--ok-bg)', color: 'var(--ok)' }}
          title={`Opens WhatsApp chat with ${c.name} (+${c.waPhone})`}>
          <Send size={14} /> Send · {c.name} ({c.type})
        </button>
      ))}
    </div>
  )
}
