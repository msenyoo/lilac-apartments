import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Pin, Send, Megaphone, Sparkles, MessageCircle, User, X, Plus } from 'lucide-react'
import { useRoleCtx } from '@/contexts/RoleContext'
import { supabase } from '@/lib/supabase'

type Announcement = {
  id: string
  title: string
  body: string
  tag: 'Event' | 'Utility' | 'Maintenance' | 'Governance' | 'Finance'
  pinned: boolean
  createdAt: string
}

const TAG_TONE: Record<string, string> = {
  Event:       'ds-badge-brand',
  Utility:     'ds-badge-info',
  Maintenance: 'ds-badge-warn',
  Governance:  'ds-badge-neutral',
  Finance:     'ds-badge-bad',
}

const SETTINGS_KEY = 'announcements_data'

async function saveAnnouncements(items: Announcement[]) {
  const { error } = await supabase.from('app_settings').upsert(
    { key: SETTINGS_KEY, value: JSON.stringify(items) },
    { onConflict: 'key' }
  )
  if (error) throw error
}

function AnnCard({
  a,
  pinned,
  canWrite,
  onDelete,
  onTogglePin,
}: {
  a: Announcement
  pinned?: boolean
  canWrite: boolean
  onDelete: (id: string) => void
  onTogglePin: (id: string) => void
}) {
  const dateLabel = new Date(a.createdAt).toISOString().slice(0, 10)
  return (
    <div
      className="surface !p-5 flex flex-col gap-2.5"
      style={pinned ? { borderColor: 'var(--brand-200)', background: 'linear-gradient(180deg,var(--brand-50),#fff 40%)' } : undefined}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`ds-badge ${TAG_TONE[a.tag] ?? 'ds-badge-neutral'}`}>{a.tag}</span>
        <span className="text-[11.5px] mono" style={{ color: 'var(--ink-400)' }}>{dateLabel}</span>
        {pinned && <Pin size={13} className="ml-auto" style={{ color: 'var(--brand-500)' }} />}
        {canWrite && (
          <div className={`flex items-center gap-1.5 ${pinned ? '' : 'ml-auto'}`}>
            <button
              onClick={() => onTogglePin(a.id)}
              className="p-1 rounded hover:bg-[var(--ink-100)] text-[11px] font-medium"
              style={{ color: 'var(--ink-500)' }}
              title={a.pinned ? 'Unpin' : 'Pin'}
            >
              <Pin size={13} />
            </button>
            <button
              onClick={() => onDelete(a.id)}
              className="p-1 rounded hover:bg-[var(--ink-100)]"
              style={{ color: 'var(--ink-400)' }}
              title="Delete"
            >
              <X size={13} />
            </button>
          </div>
        )}
      </div>
      <h3 className="text-[16px] font-bold">{a.title}</h3>
      <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--ink-600)' }}>{a.body}</p>
      <div className="flex items-center gap-4 pt-1.5 text-[12.5px]" style={{ color: 'var(--ink-500)' }}>
        <span className="flex items-center gap-1.5">
          <Sparkles size={14} /> 0
        </span>
        <span className="flex items-center gap-1.5">
          <MessageCircle size={14} /> 0 comments
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <User size={14} /> Committee
        </span>
      </div>
    </div>
  )
}

export default function AnnouncementsPage() {
  const { canWrite } = useRoleCtx()
  const qc = useQueryClient()
  const [composing, setComposing] = useState(false)
  const [title, setTitle]   = useState('')
  const [body, setBody]     = useState('')
  const [tag, setTag]       = useState<Announcement['tag']>('Governance')
  const [pin, setPin]       = useState(false)
  const [saving, setSaving] = useState(false)

  const { data: announcements = [] } = useQuery<Announcement[]>({
    queryKey: ['announcements'],
    queryFn: async () => {
      const { data } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', SETTINGS_KEY)
        .maybeSingle()
      if (!data?.value) return []
      try { return JSON.parse(data.value) as Announcement[] } catch { return [] }
    },
  })

  async function mutate(updated: Announcement[]) {
    setSaving(true)
    try {
      await saveAnnouncements(updated)
      qc.setQueryData(['announcements'], updated)
    } finally {
      setSaving(false)
    }
  }

  async function publish() {
    if (!title.trim()) return
    const a: Announcement = {
      id: crypto.randomUUID(),
      title: title.trim(),
      body: body.trim(),
      tag,
      pinned: pin,
      createdAt: new Date().toISOString(),
    }
    await mutate([a, ...announcements])
    setTitle(''); setBody(''); setTag('Governance'); setPin(false)
    setComposing(false)
  }

  async function handleDelete(id: string) {
    await mutate(announcements.filter(a => a.id !== id))
  }

  async function handleTogglePin(id: string) {
    await mutate(announcements.map(a => a.id === id ? { ...a, pinned: !a.pinned } : a))
  }

  const pinned = announcements.filter(a => a.pinned)
  const rest   = announcements.filter(a => !a.pinned)

  return (
    <div className="flex flex-col gap-5 fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-extrabold">Announcements</h1>
          <p className="text-[13.5px] mt-1" style={{ color: 'var(--ink-500)' }}>
            Notices and updates for residents · {announcements.length} posts
          </p>
        </div>
        {canWrite && (
          <button
            className="flex items-center gap-2 px-4 py-2.5 rounded-[10px] text-white font-semibold text-[14px]"
            style={{ background: 'var(--brand-600)' }}
            onClick={() => setComposing(v => !v)}
          >
            <Plus size={15} /> New announcement
          </button>
        )}
      </div>

      {/* Compose box */}
      {composing && (
        <div className="surface !p-5 flex flex-col gap-3 pop-in" style={{ borderColor: 'var(--brand-200)' }}>
          <div className="flex items-center justify-between">
            <h3 className="text-[15px] font-bold">New announcement</h3>
            <button
              onClick={() => setComposing(false)}
              className="p-1.5 rounded-lg hover:bg-[var(--ink-100)]"
              style={{ color: 'var(--ink-500)' }}
            >
              <X size={16} />
            </button>
          </div>
          <input
            className="ds-field !text-[15px] !font-semibold"
            placeholder="Announcement title…"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
          <textarea
            className="ds-field"
            rows={3}
            placeholder="Write your message to residents…"
            value={body}
            onChange={e => setBody(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2.5">
            <select
              className="ds-field !w-auto !py-2 text-[13px]"
              value={tag}
              onChange={e => setTag(e.target.value as Announcement['tag'])}
            >
              {Object.keys(TAG_TONE).map(t => <option key={t}>{t}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-[13px] cursor-pointer" style={{ color: 'var(--ink-600)' }}>
              <input
                type="checkbox"
                className="accent-[var(--brand-600)] w-4 h-4"
                checked={pin}
                onChange={e => setPin(e.target.checked)}
              />
              Pin to top
            </label>
            <div className="flex-1" />
            <button
              className="flex items-center gap-2 px-4 py-2 rounded-[10px] text-white font-semibold text-[13.5px] disabled:opacity-50"
              style={{ background: 'var(--brand-600)' }}
              onClick={publish}
              disabled={saving}
            >
              <Send size={14} /> {saving ? 'Saving…' : 'Publish'}
            </button>
          </div>
        </div>
      )}

      {announcements.length === 0 ? (
        <div className="surface !p-12 flex flex-col items-center gap-4 text-center">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: 'var(--ink-100)', color: 'var(--ink-400)' }}
          >
            <Megaphone size={26} />
          </div>
          <p className="font-semibold" style={{ color: 'var(--ink-700)' }}>No announcements yet</p>
          <p className="text-[13px]" style={{ color: 'var(--ink-500)' }}>
            Post notices, utility updates, and governance decisions for residents.
          </p>
        </div>
      ) : (
        <>
          {pinned.length > 0 && (
            <div className="flex flex-col gap-3">
              <p
                className="text-[11.5px] font-bold uppercase tracking-wide flex items-center gap-1.5"
                style={{ color: 'var(--ink-400)' }}
              >
                <Pin size={13} /> Pinned
              </p>
              {pinned.map(a => (
                <AnnCard key={a.id} a={a} pinned canWrite={canWrite} onDelete={handleDelete} onTogglePin={handleTogglePin} />
              ))}
            </div>
          )}
          <div className="flex flex-col gap-3">
            {rest.map(a => (
              <AnnCard key={a.id} a={a} canWrite={canWrite} onDelete={handleDelete} onTogglePin={handleTogglePin} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
