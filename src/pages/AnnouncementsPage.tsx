import { useState } from 'react'
import { Pin, Send, Megaphone, Sparkles, MessageCircle, User, X, Plus } from 'lucide-react'
import { useRoleCtx } from '@/contexts/RoleContext'

interface Announcement {
  id: string
  title: string
  body: string
  tag: string
  pinned: boolean
  date: string
  author: string
  audience: string
  reactions: number
  comments: number
}

const TAG_TONE: Record<string, string> = {
  Event:       'ds-badge-brand',
  Utility:     'ds-badge-info',
  Maintenance: 'ds-badge-warn',
  Governance:  'ds-badge-neutral',
  Finance:     'ds-badge-bad',
}

const SAMPLE: Announcement[] = [
  {
    id: 'a1',
    title: 'AGM 2026 — Save the Date',
    body: 'The Annual General Meeting is tentatively scheduled for Dec 21, 10:30 AM at the community hall. Agenda and audited accounts will be circulated 10 days prior.',
    tag: 'Governance', pinned: true,
    date: new Date().toISOString().slice(0, 10),
    author: 'Secretary', audience: 'All residents', reactions: 22, comments: 8,
  },
  {
    id: 'a2',
    title: 'Reminder: Quarterly Maintenance Dues',
    body: 'Maintenance for the current quarter is now due. Kindly clear pending amounts at the earliest. UPI and bank details are on the Dues page.',
    tag: 'Finance', pinned: true,
    date: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10),
    author: 'Treasurer', audience: 'Flats with dues', reactions: 2, comments: 1,
  },
]

function AnnCard({ a, pinned }: { a: Announcement; pinned?: boolean }) {
  return (
    <div
      className="surface !p-5 flex flex-col gap-2.5"
      style={pinned ? { borderColor: 'var(--brand-200)', background: 'linear-gradient(180deg,var(--brand-50),#fff 40%)' } : undefined}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`ds-badge ${TAG_TONE[a.tag] ?? 'ds-badge-neutral'}`}>{a.tag}</span>
        <span className="text-[11.5px]" style={{ color: 'var(--ink-400)' }}>{a.audience}</span>
        <span style={{ color: 'var(--ink-300)' }}>·</span>
        <span className="text-[11.5px] mono" style={{ color: 'var(--ink-400)' }}>{a.date}</span>
        {pinned && <Pin size={13} className="ml-auto" style={{ color: 'var(--brand-500)' }} />}
      </div>
      <h3 className="text-[16px] font-bold">{a.title}</h3>
      <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--ink-600)' }}>{a.body}</p>
      <div className="flex items-center gap-4 pt-1.5 text-[12.5px]" style={{ color: 'var(--ink-500)' }}>
        <span className="flex items-center gap-1.5">
          <Sparkles size={14} /> {a.reactions}
        </span>
        <span className="flex items-center gap-1.5">
          <MessageCircle size={14} /> {a.comments} comments
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <User size={14} /> {a.author}
        </span>
      </div>
    </div>
  )
}

export default function AnnouncementsPage() {
  const { canWrite } = useRoleCtx()
  const [announcements, setAnnouncements] = useState<Announcement[]>(SAMPLE)
  const [composing, setComposing]         = useState(false)
  const [title, setTitle]   = useState('')
  const [body, setBody]     = useState('')
  const [tag, setTag]       = useState('Governance')
  const [audience, setAud]  = useState('All residents')
  const [pin, setPin]       = useState(false)

  function publish() {
    if (!title.trim()) return
    const a: Announcement = {
      id: Date.now().toString(),
      title: title.trim(), body: body.trim(),
      tag, audience, pinned: pin,
      date: new Date().toISOString().slice(0, 10),
      author: 'Committee', reactions: 0, comments: 0,
    }
    setAnnouncements(prev => [a, ...prev])
    setTitle(''); setBody(''); setTag('Governance'); setAud('All residents'); setPin(false)
    setComposing(false)
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
              onChange={e => setTag(e.target.value)}
            >
              {Object.keys(TAG_TONE).map(t => <option key={t}>{t}</option>)}
            </select>
            <select
              className="ds-field !w-auto !py-2 text-[13px]"
              value={audience}
              onChange={e => setAud(e.target.value)}
            >
              {['All residents', 'A & B Blocks', 'C–E Blocks', 'Flats with dues', 'Committee only'].map(t => (
                <option key={t}>{t}</option>
              ))}
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
              className="flex items-center gap-2 px-4 py-2 rounded-[10px] text-white font-semibold text-[13.5px]"
              style={{ background: 'var(--brand-600)' }}
              onClick={publish}
            >
              <Send size={14} /> Publish
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
              {pinned.map(a => <AnnCard key={a.id} a={a} pinned />)}
            </div>
          )}
          <div className="flex flex-col gap-3">
            {rest.map(a => <AnnCard key={a.id} a={a} />)}
          </div>
        </>
      )}
    </div>
  )
}
