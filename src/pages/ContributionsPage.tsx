import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, HandHeart, ChevronDown, ChevronUp, Download, Loader2 } from 'lucide-react'
import { supabase, ContributionTracker } from '@/lib/supabase'
import { formatINR } from '@/lib/tagger'
import { formatDateDMY } from '@/lib/date'
import { driveBalanceLabel } from '@/lib/contributions'
import { useRoleCtx } from '@/contexts/RoleContext'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

const STATUS_BADGE: Record<string, string> = {
  open:   'bg-green-100 text-green-700',
  closed: 'bg-slate-100 text-slate-600',
}

interface DriveTxn {
  id: string
  value_date: string
  flat_code: string | null
  cr_dr: 'CR' | 'DR'
  amount: number
  notes: string | null
  description: string
  resident: { name: string } | null
}

export default function ContributionsPage() {
  const { isAdmin } = useRoleCtx()
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [selectedDriveId, setSelectedDriveId] = useState<string | null>(null)

  const { data: drives = [], isLoading, isError } = useQuery({
    queryKey: ['contribution-drives'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_contribution_tracker')
        .select('*')
        .order('status', { ascending: false })
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as ContributionTracker[]
    },
  })

  return (
    <div className="flex flex-col gap-5 fade-in">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-extrabold">Contributions</h1>
          <p className="text-[13.5px] mt-1" style={{ color: 'var(--ink-500)' }}>
            Voluntary collections — festivals, welfare causes — tracked separately from Maintenance and Corpus
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => setShowCreate(true)} className="flex items-center gap-2 shrink-0">
            <Plus size={15} /> New drive
          </Button>
        )}
      </div>

      {isError ? (
        <div className="surface !p-12 flex flex-col items-center gap-3">
          <HandHeart size={40} style={{ color: 'var(--ink-300)' }} />
          <p className="font-semibold text-lg">Couldn't load contribution drives — try refreshing.</p>
        </div>
      ) : isLoading ? (
        <div className="flex flex-col gap-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-20 animate-pulse rounded-[var(--ds-radius)]" style={{ background: 'var(--ink-100)' }} />)}
        </div>
      ) : drives.length === 0 ? (
        <div className="surface !p-12 flex flex-col items-center gap-3">
          <HandHeart size={40} style={{ color: 'var(--ink-300)' }} />
          <p className="font-semibold text-lg">No contribution drives yet</p>
          <p className="text-slate-500 text-sm">{isAdmin ? 'Click "New drive" to start one.' : 'Nothing recorded yet.'}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {drives.map(d => (
            <div key={d.drive_id} className="surface !p-0 overflow-hidden">
              <button
                onClick={() => setSelectedDriveId(id => id === d.drive_id ? null : d.drive_id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--ink-50)] transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{d.name}</span>
                    <span className={`text-[10.5px] font-bold px-1.5 py-0.5 rounded ${STATUS_BADGE[d.status]}`}>{d.status.toUpperCase()}</span>
                  </div>
                  <p className="text-xs mt-1" style={{ color: 'var(--ink-400)' }}>
                    Collected {formatINR(d.collected)} · Disbursed {formatINR(d.disbursed)}
                    {d.last_activity && <> · Last activity {formatDateDMY(d.last_activity)}</>}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs" style={{ color: 'var(--ink-400)' }}>{driveBalanceLabel(d.balance).label}</p>
                  <p className="font-bold" style={{ color: driveBalanceLabel(d.balance).overpaid ? '#dc2626' : d.balance !== 0 ? 'var(--brand-700)' : 'var(--ink-600)' }}>
                    {formatINR(driveBalanceLabel(d.balance).amount)}
                  </p>
                </div>
                {selectedDriveId === d.drive_id
                  ? <ChevronUp size={16} className="shrink-0" style={{ color: 'var(--ink-400)' }} />
                  : <ChevronDown size={16} className="shrink-0" style={{ color: 'var(--ink-400)' }} />}
              </button>
              {selectedDriveId === d.drive_id && (
                <DriveDetail
                  drive={d}
                  isAdmin={isAdmin}
                  onClosed={() => { qc.invalidateQueries({ queryKey: ['contribution-drives'] }); setSelectedDriveId(null) }}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateDriveDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); qc.invalidateQueries({ queryKey: ['contribution-drives'] }) }}
        />
      )}
    </div>
  )
}

type SortKey = 'date' | 'flat' | 'contributor' | 'amount'

function DriveDetail({ drive, isAdmin, onClosed }: {
  drive: ContributionTracker
  isAdmin: boolean
  onClosed: () => void
}) {
  const [showClose, setShowClose] = useState(false)
  const [showReopen, setShowReopen] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'flat', dir: 'asc' })

  const { data: txns = [], isLoading, isError } = useQuery({
    queryKey: ['contribution-drive-txns', drive.drive_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('id, value_date, flat_code, cr_dr, amount, notes, description, resident:resident_id(name)')
        .eq('drive_id', drive.drive_id)
        .neq('row_type', 'VOIDED')
        .order('value_date', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as DriveTxn[]
    },
  })

  function toggleSort(key: SortKey) {
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })
  }

  const [exporting, setExporting] = useState(false)
  async function handleExportPdf() {
    setExporting(true)
    try {
      const [{ pdf }, { ContributionDriveDoc }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/reports/AgmPdfDocs'),
      ])
      const byFlat = [...txns].sort((a, b) => (a.flat_code ?? '').localeCompare(b.flat_code ?? ''))
      const generated = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      const blob = await pdf(
        <ContributionDriveDoc
          driveName={drive.name}
          description={drive.description}
          status={drive.status}
          collected={drive.collected}
          disbursed={drive.disbursed}
          rows={byFlat.map(t => ({
            value_date: t.value_date, flat_code: t.flat_code,
            contributor: t.cr_dr === 'DR' ? (t.notes ?? null) : (t.resident?.name ?? null),
            cr_dr: t.cr_dr, amount: t.amount, description: t.description,
          }))}
          generated={generated}
        />
      ).toBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Lilac_Contribution_${drive.name.replace(/[^a-z0-9]+/gi, '_')}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  const sortedTxns = [...txns].sort((a, b) => {
    let cmp = 0
    if (sort.key === 'date') cmp = a.value_date.localeCompare(b.value_date)
    else if (sort.key === 'flat') cmp = (a.flat_code ?? '').localeCompare(b.flat_code ?? '')
    else if (sort.key === 'contributor') cmp = (a.resident?.name ?? a.notes ?? '').localeCompare(b.resident?.name ?? b.notes ?? '')
    else if (sort.key === 'amount') cmp = a.amount - b.amount
    return sort.dir === 'asc' ? cmp : -cmp
  })

  return (
    <div className="border-t hairline p-4 flex flex-col gap-3">
      {drive.description && <p className="text-sm" style={{ color: 'var(--ink-600)' }}>{drive.description}</p>}

      {isError ? (
        <p className="text-sm text-red-600">Couldn't load transactions for this drive.</p>
      ) : isLoading ? (
        <div className="h-24 animate-pulse rounded-[var(--ds-radius)]" style={{ background: 'var(--ink-100)' }} />
      ) : txns.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--ink-400)' }}>No transactions tagged to this drive yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b hairline text-left">
                {([
                  ['date', 'Date', ''],
                  ['flat', 'Flat', ''],
                  ['contributor', 'Contributor', ''],
                  ['amount', 'Amount', 'text-right'],
                ] as [SortKey, string, string][]).map(([key, label, align]) => (
                  <th key={key}
                    className={`py-2 pr-3 font-semibold text-xs cursor-pointer select-none hover:opacity-70 ${align}`}
                    style={{ color: 'var(--ink-500)' }}
                    onClick={() => toggleSort(key)}
                  >
                    <span className={`inline-flex items-center gap-1 ${align === 'text-right' ? 'flex-row-reverse' : ''}`}>
                      {label}
                      {sort.key === key && (sort.dir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y hairline">
              {sortedTxns.map(t => (
                <tr key={t.id}>
                  <td className="py-2 pr-3 font-mono text-xs whitespace-nowrap" style={{ color: 'var(--ink-600)' }}>{formatDateDMY(t.value_date)}</td>
                  <td className="py-2 pr-3 text-xs" style={{ color: 'var(--ink-700)' }}>{t.flat_code || '—'}</td>
                  <td className="py-2 pr-3 text-xs" style={{ color: 'var(--ink-700)' }}>
                    {t.cr_dr === 'DR'
                      ? (t.notes ? `Paid: ${t.notes}` : '—')
                      : (t.resident?.name ?? '—')}
                  </td>
                  <td className={`py-2 pr-3 text-xs text-right font-semibold tabular-nums ${t.cr_dr === 'CR' ? 'text-green-700' : 'text-red-600'}`}>
                    {t.cr_dr === 'DR' ? '− ' : ''}{formatINR(t.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex gap-2">
        {txns.length > 0 && (
          <button onClick={handleExportPdf} disabled={exporting}
            className="btn-secondary self-start text-sm flex items-center gap-1.5 disabled:opacity-50">
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {exporting ? 'Generating…' : 'Export PDF'}
          </button>
        )}
        {isAdmin && drive.status === 'open' && (
          <button onClick={() => setShowClose(true)} className="btn-secondary self-start text-sm">Close drive</button>
        )}
        {isAdmin && drive.status === 'closed' && (
          <button onClick={() => setShowReopen(true)} className="btn-secondary self-start text-sm">Reopen drive</button>
        )}
      </div>

      {showClose && (
        <CloseDriveDialog
          drive={drive}
          onClose={() => setShowClose(false)}
          onClosed={() => { setShowClose(false); onClosed() }}
        />
      )}

      {showReopen && (
        <ReopenDriveDialog
          drive={drive}
          onClose={() => setShowReopen(false)}
          onReopened={() => { setShowReopen(false); onClosed() }}
        />
      )}
    </div>
  )
}

function CreateDriveDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleCreate() {
    if (!name.trim()) return
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('contribution_drives').insert({
      name: name.trim(),
      description: description.trim() || null,
      created_by: user?.id ?? null,
    })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('Contribution drive created')
    onCreated()
  }

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New contribution drive</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Kannan Security — Family Support" />
          </div>
          <div>
            <Label>Description (optional)</Label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} className="w-full ds-field" rows={3} />
          </div>
        </div>
        <DialogFooter>
          <button onClick={onClose} className="btn-secondary flex-1 text-sm">Cancel</button>
          <button onClick={handleCreate} disabled={!name.trim() || saving} className="btn-primary flex-1 text-sm">
            {saving ? 'Creating…' : 'Create drive'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CloseDriveDialog({ drive, onClose, onClosed }: {
  drive: ContributionTracker
  onClose: () => void
  onClosed: () => void
}) {
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleConfirm() {
    setSaving(true)
    const { error } = await supabase.from('contribution_drives').update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      close_notes: notes.trim() || null,
    }).eq('id', drive.drive_id)
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('Drive closed')
    onClosed()
  }

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Close "{drive.name}"?</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          {drive.balance !== 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
              {driveBalanceLabel(drive.balance).overpaid
                ? <>This drive was <strong>{formatINR(driveBalanceLabel(drive.balance).amount)}</strong> funded by the association (disbursed more than collected).</>
                : <>This drive still has a balance of <strong>{formatINR(drive.balance)}</strong> in hand.</>}
              {' '}Closing does not block on this — make sure that's intentional (e.g. rounding, or a carry-forward you're tracking in the notes below).
            </div>
          )}
          <div>
            <Label>Close notes (optional)</Label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} className="w-full ds-field" rows={3}
              placeholder="e.g. Handed over ₹45,000 cash to the family on 19-Aug-26" />
          </div>
        </div>
        <DialogFooter>
          <button onClick={onClose} className="btn-secondary flex-1 text-sm">Cancel</button>
          <button onClick={handleConfirm} disabled={saving} className="btn-primary flex-1 text-sm">
            {saving ? 'Closing…' : 'Close drive'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReopenDriveDialog({ drive, onClose, onReopened }: {
  drive: ContributionTracker
  onClose: () => void
  onReopened: () => void
}) {
  const [saving, setSaving] = useState(false)

  async function handleConfirm() {
    setSaving(true)
    const { error } = await supabase.from('contribution_drives').update({
      status: 'open',
      closed_at: null,
      close_notes: null,
    }).eq('id', drive.drive_id)
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('Drive reopened')
    onReopened()
  }

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Reopen "{drive.name}"?</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <p className="text-sm" style={{ color: 'var(--ink-600)' }}>
            This makes the drive selectable again when tagging bank transactions, so new
            contributions (or corrections to accidental closes) can be added to it.
          </p>
          {drive.close_notes && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-600">
              Previous close notes: {drive.close_notes}
            </div>
          )}
        </div>
        <DialogFooter>
          <button onClick={onClose} className="btn-secondary flex-1 text-sm">Cancel</button>
          <button onClick={handleConfirm} disabled={saving} className="btn-primary flex-1 text-sm">
            {saving ? 'Reopening…' : 'Reopen drive'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
