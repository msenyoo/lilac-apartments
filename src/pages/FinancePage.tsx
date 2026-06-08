import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PiggyBank, Plus, CalendarClock } from 'lucide-react'
import { supabase, type Deposit } from '@/lib/supabase'
import { formatINR } from '@/lib/tagger'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useRoleCtx } from '@/contexts/RoleContext'
import { toast } from 'sonner'

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function daysUntil(dateStr: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = parseLocalDate(dateStr)
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

function formatDate(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface TxnOption {
  id: string
  value_date: string
  description: string
  amount: number
}

const STATUS_STYLES: Record<Deposit['status'], string> = {
  active:  'bg-green-100 text-green-700 border-green-200',
  matured: 'bg-blue-100 text-blue-700 border-blue-200',
  closed:  'bg-slate-100 text-slate-600 border-slate-200',
}

// ---------------------------------------------------------------------------
// AddDepositDialog
// ---------------------------------------------------------------------------

interface AddDepositDialogProps {
  open: boolean
  onClose: () => void
}

function AddDepositDialog({ open, onClose }: AddDepositDialogProps) {
  const qc = useQueryClient()
  const [depositNo, setDepositNo] = useState('')
  const [bank, setBank] = useState('')
  const [principal, setPrincipal] = useState('')
  const [interestRate, setInterestRate] = useState('')
  const [openedDate, setOpenedDate] = useState('')
  const [maturityDate, setMaturityDate] = useState('')
  const [sourceType, setSourceType] = useState<'surplus' | 'corpus' | 'other'>('surplus')
  const [linkedDrId, setLinkedDrId] = useState<string>('')
  const [notes, setNotes] = useState('')

  const { data: drOptions = [] } = useQuery<TxnOption[]>({
    queryKey: ['deposit-dr-options'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('id,value_date,description,amount')
        .eq('cr_dr', 'DR')
        .is('deposit_id', null)
        .or('category.eq.FD,description.ilike.%FD%,description.ilike.%fixed deposit%')
        .order('value_date', { ascending: false })
      if (error) throw error
      return (data ?? []) as TxnOption[]
    },
    enabled: open,
  })

  const mutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      const { data: inserted, error: insertErr } = await supabase
        .from('deposits')
        .insert({
          deposit_no: depositNo.trim(),
          bank: bank.trim(),
          principal: Math.round(Number(principal)),
          interest_rate: Number(interestRate),
          opened_date: openedDate,
          maturity_date: maturityDate,
          source_type: sourceType,
          notes: notes.trim() || null,
          status: 'active',
          created_by: user?.id ?? null,
        })
        .select('id')
        .single()
      if (insertErr) throw insertErr

      if (linkedDrId) {
        const { error: txnErr } = await supabase
          .from('transactions')
          .update({ deposit_id: inserted.id })
          .eq('id', linkedDrId)
        if (txnErr) throw txnErr
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deposits'] })
      qc.invalidateQueries({ queryKey: ['deposit-dr-options'] })
      handleClose()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  function handleClose() {
    setDepositNo('')
    setBank('')
    setPrincipal('')
    setInterestRate('')
    setOpenedDate('')
    setMaturityDate('')
    setSourceType('surplus')
    setLinkedDrId('')
    setNotes('')
    onClose()
  }

  const isValid = depositNo.trim() && bank.trim() && Number(principal) > 0 &&
    Number(interestRate) > 0 && openedDate && maturityDate

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Deposit</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Deposit No <span className="text-red-500">*</span></Label>
              <Input value={depositNo} onChange={e => setDepositNo(e.target.value)} placeholder="e.g. 353410004045" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Bank <span className="text-red-500">*</span></Label>
              <Input value={bank} onChange={e => setBank(e.target.value)} placeholder="e.g. SBI, HDFC" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Principal (₹) <span className="text-red-500">*</span></Label>
              <Input type="number" min="1" value={principal} onChange={e => setPrincipal(e.target.value)} placeholder="50000" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Interest Rate % <span className="text-red-500">*</span></Label>
              <Input type="number" min="0" step="0.01" value={interestRate} onChange={e => setInterestRate(e.target.value)} placeholder="6.50" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Opened Date <span className="text-red-500">*</span></Label>
              <Input type="date" value={openedDate} onChange={e => setOpenedDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Maturity Date <span className="text-red-500">*</span></Label>
              <Input type="date" value={maturityDate} onChange={e => setMaturityDate(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Source Type</Label>
            <Select value={sourceType} onValueChange={v => setSourceType(v as typeof sourceType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="surplus">Surplus</SelectItem>
                <SelectItem value="corpus">Corpus</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Link opening bank DR (optional)</Label>
            <Select value={linkedDrId} onValueChange={setLinkedDrId}>
              <SelectTrigger>
                <SelectValue placeholder="Select unmatched DR transaction…" />
              </SelectTrigger>
              <SelectContent>
                {drOptions.map(t => (
                  <SelectItem key={t.id} value={t.id}>
                    {formatDate(t.value_date)} — {t.description.slice(0, 40)}{t.description.length > 40 ? '…' : ''} — {formatINR(t.amount)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Notes</Label>
            <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={mutation.isPending}>Cancel</Button>
          <Button
            disabled={!isValid || mutation.isPending}
            onClick={() => mutation.mutate()}
            style={{ background: 'var(--brand-600)', color: '#fff' }}
          >
            {mutation.isPending ? 'Saving…' : 'Save Deposit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// MarkMaturedDialog
// ---------------------------------------------------------------------------

interface MarkMaturedDialogProps {
  deposit: Deposit | null
  onClose: () => void
}

function MarkMaturedDialog({ deposit, onClose }: MarkMaturedDialogProps) {
  const qc = useQueryClient()
  const open = deposit !== null

  const [maturedDate, setMaturedDate] = useState(todayISO())
  const [maturityAmount, setMaturityAmount] = useState('')
  const [linkedCrId, setLinkedCrId] = useState<string>('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!deposit) return
    setMaturedDate(todayISO())
    setMaturityAmount('')
    setLinkedCrId('')
    setNotes(deposit.notes ?? '')
  }, [deposit?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const { data: crOptions = [] } = useQuery<TxnOption[]>({
    queryKey: ['deposit-cr-options'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('id,value_date,description,amount')
        .eq('cr_dr', 'CR')
        .is('deposit_id', null)
        .or('category.eq.FD,description.ilike.%FD%,description.ilike.%fixed deposit%')
        .order('value_date', { ascending: false })
      if (error) throw error
      return (data ?? []) as TxnOption[]
    },
    enabled: open,
  })

  const expectedAmount = deposit
    ? (() => {
        const days = Math.round(
          (parseLocalDate(deposit.maturity_date).getTime() - parseLocalDate(deposit.opened_date).getTime()) / 86_400_000
        )
        return Math.round(deposit.principal * (1 + (deposit.interest_rate / 100) * (days / 365)))
      })()
    : 0

  const mutation = useMutation({
    mutationFn: async () => {
      if (!deposit) return
      const { error: updErr } = await supabase
        .from('deposits')
        .update({
          status: 'matured',
          matured_date: maturedDate,
          maturity_amount: Math.round(Number(maturityAmount)),
          notes: notes.trim() || null,
        })
        .eq('id', deposit.id)
      if (updErr) throw updErr

      if (linkedCrId) {
        const { error: txnErr } = await supabase
          .from('transactions')
          .update({ deposit_id: deposit.id })
          .eq('id', linkedCrId)
        if (txnErr) throw txnErr
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deposits'] })
      qc.invalidateQueries({ queryKey: ['deposit-cr-options'] })
      handleClose()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  function handleClose() {
    setMaturedDate(todayISO())
    setMaturityAmount('')
    setLinkedCrId('')
    setNotes('')
    onClose()
  }

  const isValid = maturedDate && Number(maturityAmount) > 0

  const days = deposit
    ? Math.round(
        (parseLocalDate(deposit.maturity_date).getTime() - parseLocalDate(deposit.opened_date).getTime()) / 86_400_000
      )
    : 0

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Mark Matured — {deposit?.deposit_no}</DialogTitle>
        </DialogHeader>

        {deposit && (
          <div className="grid gap-3 py-1">
            <div className="rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--ink-50)', color: 'var(--ink-600)' }}>
              Expected maturity: {formatINR(deposit.principal)} at {deposit.interest_rate}% for {days} days
              = <span className="font-semibold" style={{ color: 'var(--ink-800)' }}>{formatINR(expectedAmount)}</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Matured Date <span className="text-red-500">*</span></Label>
                <Input type="date" value={maturedDate} onChange={e => setMaturedDate(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Actual Maturity Amount (₹) <span className="text-red-500">*</span></Label>
                <Input
                  type="number"
                  min="1"
                  value={maturityAmount}
                  onChange={e => setMaturityAmount(e.target.value)}
                  placeholder={String(expectedAmount)}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Link maturity bank CR (optional)</Label>
              <Select value={linkedCrId} onValueChange={setLinkedCrId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select unmatched CR transaction…" />
                </SelectTrigger>
                <SelectContent>
                  {crOptions.map(t => (
                    <SelectItem key={t.id} value={t.id}>
                      {formatDate(t.value_date)} — {t.description.slice(0, 40)}{t.description.length > 40 ? '…' : ''} — {formatINR(t.amount)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={mutation.isPending}>Cancel</Button>
          <Button
            disabled={!isValid || mutation.isPending}
            onClick={() => mutation.mutate()}
            style={{ background: 'var(--brand-600)', color: '#fff' }}
          >
            {mutation.isPending ? 'Saving…' : 'Mark Matured'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// EditDepositDialog
// ---------------------------------------------------------------------------

interface EditDepositDialogProps {
  deposit: Deposit | null
  onClose: () => void
}

function EditDepositDialog({ deposit, onClose }: EditDepositDialogProps) {
  const qc = useQueryClient()
  const open = deposit !== null

  const [depositNo, setDepositNo] = useState('')
  const [bank, setBank] = useState('')
  const [principal, setPrincipal] = useState('')
  const [interestRate, setInterestRate] = useState('')
  const [openedDate, setOpenedDate] = useState('')
  const [maturityDate, setMaturityDate] = useState('')
  const [sourceType, setSourceType] = useState<'surplus' | 'corpus' | 'other'>('surplus')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!deposit) return
    setDepositNo(deposit.deposit_no)
    setBank(deposit.bank)
    setPrincipal(String(deposit.principal))
    setInterestRate(String(deposit.interest_rate))
    setOpenedDate(deposit.opened_date)
    setMaturityDate(deposit.maturity_date)
    setSourceType((deposit.source_type as 'surplus' | 'corpus' | 'other') ?? 'surplus')
    setNotes(deposit.notes ?? '')
  }, [deposit?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = useMutation({
    mutationFn: async () => {
      if (!deposit) return
      const { error } = await supabase
        .from('deposits')
        .update({
          deposit_no: depositNo.trim(),
          bank: bank.trim(),
          principal: Math.round(Number(principal)),
          interest_rate: Number(interestRate),
          opened_date: openedDate,
          maturity_date: maturityDate,
          source_type: sourceType,
          notes: notes.trim() || null,
        })
        .eq('id', deposit.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deposits'] })
      handleClose()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  function handleClose() {
    onClose()
  }

  const isValid = depositNo.trim() && bank.trim() && Number(principal) > 0 &&
    Number(interestRate) > 0 && openedDate && maturityDate

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Deposit — {deposit?.deposit_no}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Deposit No <span className="text-red-500">*</span></Label>
              <Input value={depositNo} onChange={e => setDepositNo(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Bank <span className="text-red-500">*</span></Label>
              <Input value={bank} onChange={e => setBank(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Principal (₹) <span className="text-red-500">*</span></Label>
              <Input type="number" min="1" value={principal} onChange={e => setPrincipal(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Interest Rate % <span className="text-red-500">*</span></Label>
              <Input type="number" min="0" step="0.01" value={interestRate} onChange={e => setInterestRate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Opened Date <span className="text-red-500">*</span></Label>
              <Input type="date" value={openedDate} onChange={e => setOpenedDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Maturity Date <span className="text-red-500">*</span></Label>
              <Input type="date" value={maturityDate} onChange={e => setMaturityDate(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Source Type</Label>
            <Select value={sourceType} onValueChange={v => setSourceType(v as typeof sourceType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="surplus">Surplus</SelectItem>
                <SelectItem value="corpus">Corpus</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Notes</Label>
            <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={mutation.isPending}>Cancel</Button>
          <Button
            disabled={!isValid || mutation.isPending}
            onClick={() => mutation.mutate()}
            style={{ background: 'var(--brand-600)', color: '#fff' }}
          >
            {mutation.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// FinancePage
// ---------------------------------------------------------------------------

export default function FinancePage() {
  const { isAdmin } = useRoleCtx()
  const [filter, setFilter] = useState<'active' | 'all'>('active')
  const [addOpen, setAddOpen] = useState(false)
  const [maturedDeposit, setMaturedDeposit] = useState<Deposit | null>(null)
  const [editDeposit, setEditDeposit] = useState<Deposit | null>(null)

  const { data: deposits = [], isLoading } = useQuery({
    queryKey: ['deposits'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deposits')
        .select('*')
        .order('opened_date', { ascending: false })
      if (error) throw error
      return (data ?? []) as Deposit[]
    },
  })

  const activeDeposits  = deposits.filter(d => d.status === 'active')
  const maturedDeposits = deposits.filter(d => d.status === 'matured')

  const totalLocked = activeDeposits.reduce((s, d) => s + d.principal, 0)

  const upcomingDeposit = activeDeposits.length > 0
    ? activeDeposits.reduce((closest, d) =>
        new Date(d.maturity_date) < new Date(closest.maturity_date) ? d : closest
      )
    : null

  const interestEarned = maturedDeposits
    .filter(d => d.maturity_amount !== null)
    .reduce((s, d) => s + (d.maturity_amount! - d.principal), 0)

  const visible = filter === 'active' ? activeDeposits : deposits

  return (
    <div className="flex flex-col gap-5 fade-in">

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[24px] font-extrabold">Finance</h1>
          <p className="text-[13.5px] mt-1" style={{ color: 'var(--ink-500)' }}>
            Fixed deposits &amp; treasury
          </p>
        </div>
        {isAdmin && (
          <Button
            size="sm"
            className="flex items-center gap-1.5"
            style={{ background: 'var(--brand-600)', color: '#fff' }}
            onClick={() => setAddOpen(true)}
          >
            <Plus size={14} /> Add Deposit
          </Button>
        )}
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="surface !p-4 bg-white">
          <p className="text-xs mb-1" style={{ color: 'var(--ink-500)' }}>Total locked (active)</p>
          <p className="text-xl font-bold" style={{ color: 'var(--ink-800)' }}>{formatINR(totalLocked)}</p>
        </div>

        <div className="surface !p-4 bg-amber-50">
          <p className="text-xs mb-1" style={{ color: 'var(--ink-500)' }}>Upcoming maturity</p>
          {upcomingDeposit ? (
            <>
              <p className="text-lg font-bold text-amber-700">{formatDate(upcomingDeposit.maturity_date)}</p>
              <p className="text-[11px] mt-0.5 flex items-center gap-1" style={{ color: 'var(--ink-500)' }}>
                <CalendarClock size={11} />
                {(() => {
                  const days = daysUntil(upcomingDeposit.maturity_date)
                  if (days < 0) return `${Math.abs(days)} days overdue`
                  if (days === 0) return 'Matures today'
                  return `in ${days} day${days === 1 ? '' : 's'}`
                })()}
                &nbsp;· {upcomingDeposit.bank}
              </p>
            </>
          ) : (
            <p className="text-xl font-bold" style={{ color: 'var(--ink-400)' }}>—</p>
          )}
        </div>

        <div className="surface !p-4 bg-green-50">
          <p className="text-xs mb-1" style={{ color: 'var(--ink-500)' }}>Interest earned (matured)</p>
          <p className="text-xl font-bold text-green-700">{formatINR(interestEarned)}</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 rounded-xl p-1 w-fit" style={{ background: 'var(--ink-100)' }}>
        {(['active', 'all'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize ${
              filter === f ? 'bg-white shadow-sm' : ''
            }`}
            style={filter === f ? { color: 'var(--ink-900)' } : { color: 'var(--ink-500)' }}
          >
            {f === 'active' ? 'Active' : 'All'}
          </button>
        ))}
      </div>

      {/* Deposits list */}
      {isLoading ? (
        <div className="surface h-40 animate-pulse" style={{ background: 'var(--ink-100)' }} />
      ) : visible.length === 0 ? (
        <div className="surface !p-12 flex flex-col items-center gap-4 text-center">
          <PiggyBank size={40} style={{ color: 'var(--ink-300)' }} />
          <div>
            <p className="font-semibold text-lg" style={{ color: 'var(--ink-700)' }}>No deposits recorded yet</p>
            <p className="text-sm mt-1" style={{ color: 'var(--ink-500)' }}>
              Add fixed deposits to track maturity dates, interest earned, and locked corpus funds.
            </p>
          </div>
          {isAdmin && (
            <Button
              onClick={() => setAddOpen(true)}
              className="flex items-center gap-1.5 mt-2"
              style={{ background: 'var(--brand-600)', color: '#fff' }}
            >
              <Plus size={14} /> Add Deposit
            </Button>
          )}
        </div>
      ) : (
        <div className="surface !p-0">
          <div className="divide-rows">
            {visible.map(d => {
              const days = daysUntil(d.maturity_date)
              const isOverdue = d.status === 'active' && days < 0

              return (
                <div key={d.id} className="px-4 py-3.5 flex items-center gap-4 flex-wrap sm:flex-nowrap">
                  {/* Left: deposit info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm" style={{ color: 'var(--ink-900)' }}>
                        {d.deposit_no}
                      </span>
                      <span className="text-sm" style={{ color: 'var(--ink-500)' }}>·</span>
                      <span className="text-sm" style={{ color: 'var(--ink-600)' }}>{d.bank}</span>
                      <Badge
                        className={`text-[11px] font-medium border ${STATUS_STYLES[d.status]}`}
                        variant="outline"
                      >
                        {d.status.charAt(0).toUpperCase() + d.status.slice(1)}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap text-xs" style={{ color: 'var(--ink-500)' }}>
                      <span>Opened {formatDate(d.opened_date)}</span>
                      <span>·</span>
                      <span className={isOverdue ? 'text-red-600 font-medium' : ''}>
                        Matures {formatDate(d.maturity_date)}
                        {d.status === 'active' && (
                          <span className="ml-1">
                            ({days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'today' : `in ${days}d`})
                          </span>
                        )}
                        {d.matured_date && (
                          <span className="ml-1 text-blue-600">· Matured {formatDate(d.matured_date)}</span>
                        )}
                      </span>
                      {d.notes && (
                        <>
                          <span>·</span>
                          <span className="truncate max-w-[200px]">{d.notes}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Middle: amounts */}
                  <div className="flex items-center gap-6 shrink-0">
                    <div className="text-right">
                      <p className="text-[11px]" style={{ color: 'var(--ink-400)' }}>Principal</p>
                      <p className="font-semibold text-sm" style={{ color: 'var(--ink-800)' }}>{formatINR(d.principal)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px]" style={{ color: 'var(--ink-400)' }}>Rate</p>
                      <p className="font-semibold text-sm" style={{ color: 'var(--ink-800)' }}>{d.interest_rate}%</p>
                    </div>
                    {d.maturity_amount !== null && (
                      <div className="text-right">
                        <p className="text-[11px]" style={{ color: 'var(--ink-400)' }}>Maturity</p>
                        <p className="font-semibold text-sm text-green-700">{formatINR(d.maturity_amount)}</p>
                      </div>
                    )}
                  </div>

                  {/* Right: actions */}
                  {isAdmin && (
                    <div className="flex items-center gap-2 shrink-0">
                      {d.status === 'active' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs h-7 px-2.5"
                          onClick={() => setMaturedDeposit(d)}
                        >
                          Mark Matured
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7 px-2.5"
                        onClick={() => setEditDeposit(d)}
                      >
                        Edit
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Dialogs */}
      <AddDepositDialog open={addOpen} onClose={() => setAddOpen(false)} />
      <MarkMaturedDialog deposit={maturedDeposit} onClose={() => setMaturedDeposit(null)} />
      <EditDepositDialog deposit={editDeposit} onClose={() => setEditDeposit(null)} />

      {/*
        To map the existing FD transaction, use "Add Deposit" with:
          Deposit No: 353410004045
          Bank: SBI (or whichever bank)
          Opened Date: 2025-04-03
          Principal: 50000
          Link opening bank DR: select "03 Apr 2025 — FD No. 353410004045 - SB A/c- 20174637210 — ₹50,000"
            (transaction id: e7645d66-8462-4fc8-b569-48c7cce76841)
      */}
    </div>
  )
}
