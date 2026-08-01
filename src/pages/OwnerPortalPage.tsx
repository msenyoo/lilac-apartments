import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatINR } from '@/lib/tagger'
import { formatDateDMY } from '@/lib/date'
import { IndianRupee, Building2, CheckCircle2, AlertCircle, Clock, Receipt, FileText, Loader2 } from 'lucide-react'
import { useRoleCtx } from '@/contexts/RoleContext'
import { ReceiptButton } from '@/components/ReceiptButton'

interface FlatRow { id: string; code: string; block: string; flat_type: string; bhk_type: string | null; maintenance_amt: number }
interface DuesRow {
  flat_code: string
  maintenance_amt: number
  annual_due: number
  collected_fy: number
  pending: number
  arrears_maintenance: number
  advance_credits: number
  total_outstanding: number
  status: string
  start_fiscal_year: number
}
interface CorpusRow {
  plan_id: string
  plan_name: string
  flat_code: string
  corpus_target: number
  collected: number
  balance: number
  pct_paid: number
  status: string
}
interface ArrearRow { id: string; arrears_type: string; source_label: string; amount: number }
interface TxnRow { id: string; value_date: string; description: string; amount: number; category: string | null; fiscal_label: string | null; corpus: 'YES' | 'NO'; plan_id: string | null; months_covered: string | null; txn_id: string | null; posted_time: string | null }

interface CorpusExpenseRow {
  amount: number
  expense_date: string
  category: { name: string } | null
  corpus_plan: { name: string } | null
}

interface CorpusExpenseGroup {
  categoryName: string
  totalSpent: number
  firstDate: string
  lastDate: string
  count: number
}

interface CorpusPlanExpenses {
  planId: string
  planName: string
  groups: CorpusExpenseGroup[]
  totalSpent: number
}

function currentFiscalYear(): number {
  const now = new Date()
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
}

function buildFiscalYears(): { year: number; label: string; start: string; end: string }[] {
  const now = new Date()
  const currentFyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  const years = []
  for (let y = 2022; y <= currentFyYear; y++) {
    years.push({
      year:  y,
      label: `FY ${y}-${String(y + 1).slice(-2)}`,
      start: `${y}-04-01`,
      end:   `${y + 1}-03-31`,
    })
  }
  return years.reverse()
}

const FISCAL_YEAR_LIST = buildFiscalYears()

const MONTHS_IN_ORDER = ['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar']

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href     = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// All months from April of startFy up to (and including) the current month
function elapsedMonthsSince(startFy: number): string[] {
  const now = new Date()
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const result: string[] = []
  let y = startFy, m = 3 // April of startFy
  while (new Date(y, m, 1) <= now) {
    result.push(`${MONTHS[m]}-${String(y).slice(2)}`)
    if (++m === 12) { m = 0; y++ }
  }
  return result
}

interface HealthCardProps { label: string; value: string; sub?: string }
function HealthCard({ label, value, sub }: HealthCardProps) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-400)' }}>{label}</p>
      <p className="text-[14px] font-bold truncate" style={{ color: 'var(--ink-800)' }}>{value}</p>
      {sub && <p className="text-[11.5px]" style={{ color: 'var(--ink-400)' }}>{sub}</p>}
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const cfg: Record<string, { bg: string; color: string; icon: React.ReactNode }> = {
    Clear:   { bg: 'var(--ok-bg)',   color: 'var(--ok)',   icon: <CheckCircle2 size={13} /> },
    Partial: { bg: 'var(--warn-bg)', color: 'var(--warn)', icon: <Clock size={13} /> },
    Due:     { bg: 'var(--bad-bg)',  color: 'var(--bad)',  icon: <AlertCircle size={13} /> },
    Arrears: { bg: 'var(--bad-bg)',  color: 'var(--bad)',  icon: <AlertCircle size={13} /> },
  }
  const c = cfg[status] ?? { bg: 'var(--ink-100)', color: 'var(--ink-500)', icon: null }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold" style={{ background: c.bg, color: c.color }}>
      {c.icon}{status}
    </span>
  )
}

export default function OwnerPortalPage() {
  const { flatId } = useRoleCtx()

  const [statementFyYear, setStatementFyYear] = useState<number>(() => currentFiscalYear())
  const [generatingStatement, setGeneratingStatement] = useState(false)

  const { data: myFlat } = useQuery<FlatRow | null>({
    queryKey: ['owner-flat', flatId],
    enabled: !!flatId,
    queryFn: async () => {
      const { data } = await supabase
        .from('flats')
        .select('id,code,block,flat_type,bhk_type,maintenance_amt')
        .eq('id', flatId!)
        .maybeSingle()
      return data as FlatRow | null
    },
  })

  const { data: dues } = useQuery<DuesRow | null>({
    queryKey: ['owner-dues', myFlat?.code],
    enabled: !!myFlat?.code,
    queryFn: async () => {
      const { data } = await supabase
        .from('v_dues_tracker')
        .select('*')
        .eq('flat_code', myFlat!.code)
        .maybeSingle()
      return data as DuesRow | null
    },
  })

  const { data: corpusList = [] } = useQuery<CorpusRow[]>({
    queryKey: ['owner-corpus', myFlat?.code],
    enabled: !!myFlat?.code,
    queryFn: async () => {
      const { data } = await supabase
        .from('v_corpus_tracker')
        .select('plan_id,plan_name,flat_code,corpus_target,collected,balance,pct_paid,status')
        .eq('flat_code', myFlat!.code)
      return (data ?? []) as CorpusRow[]
    },
  })

  const { data: corpusArrears = [] } = useQuery<ArrearRow[]>({
    queryKey: ['owner-corpus-arrears', flatId],
    enabled: !!flatId,
    queryFn: async () => {
      const { data } = await supabase
        .from('flat_arrears')
        .select('id,arrears_type,source_label,amount')
        .eq('flat_id', flatId!)
        .eq('arrears_type', 'corpus')
      return (data ?? []) as ArrearRow[]
    },
  })

  const { data: settings } = useQuery({
    queryKey: ['app-settings'],
    queryFn: async () => {
      const { data } = await supabase.from('app_settings').select('*')
      return Object.fromEntries((data ?? []).map((s: any) => [s.key, s.value]))
    },
  })

  const { data: payments = [] } = useQuery<TxnRow[]>({
    queryKey: ['owner-payments', myFlat?.code],
    enabled: !!myFlat?.code,
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('id,value_date,description,amount,category,fiscal_label,corpus,plan_id,months_covered,txn_id,posted_time')
        .eq('flat_code', myFlat!.code)
        .eq('cr_dr', 'CR')
        .neq('row_type', 'VOIDED')
        .order('value_date', { ascending: false })
        .limit(50)
      return (data ?? []) as TxnRow[]
    },
  })

  const { data: healthMaintenance } = useQuery<{ cleared: number; total: number }>({
    queryKey: ['health-maintenance'],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_dues_tracker')
        .select('status')
      const rows = (data ?? []) as { status: string }[]
      return {
        cleared: rows.filter(r => r.status === 'Clear').length,
        total:   rows.length,
      }
    },
    staleTime: 5 * 60 * 1000,
  })

  const { data: healthCorpus } = useQuery<{ collected: number; target: number }>({
    queryKey: ['health-corpus'],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_corpus_tracker')
        .select('collected,effective_target')
      const rows = (data ?? []) as { collected: number; effective_target: number }[]
      return {
        collected: rows.reduce((s, r) => s + (r.collected ?? 0), 0),
        target:    rows.reduce((s, r) => s + (r.effective_target ?? 0), 0),
      }
    },
    staleTime: 5 * 60 * 1000,
  })

  interface LastExpenseRow { expense_date: string; amount: number; category: { name: string } | null }
  const { data: lastExpense } = useQuery<LastExpenseRow | null>({
    queryKey: ['health-last-expense'],
    queryFn: async () => {
      const { data } = await supabase
        .from('expenses')
        .select('expense_date,amount,category:category_id(name)')
        .is('voided_at', null)
        .order('expense_date', { ascending: false })
        .limit(1)
        .maybeSingle()
      return data as LastExpenseRow | null
    },
    staleTime: 5 * 60 * 1000,
  })

  const activePlanIds = corpusList.map((c: any) => c.plan_id)

  const { data: corpusExpenses = [] } = useQuery<CorpusPlanExpenses[]>({
    queryKey: ['corpus-expenses-by-plan', activePlanIds],
    enabled: activePlanIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('expenses')
        .select('amount,expense_date,category:category_id(name),corpus_plan:corpus_plan_id(name)')
        .in('corpus_plan_id', activePlanIds)
        .is('voided_at', null)
        .order('expense_date', { ascending: true })

      const rows = (data ?? []) as unknown as CorpusExpenseRow[]

      const planMap = new Map<string, CorpusPlanExpenses>()
      for (const c of corpusList) {
        planMap.set((c as any).plan_id, {
          planId:     (c as any).plan_id,
          planName:   (c as any).plan_name,
          groups:     [],
          totalSpent: 0,
        })
      }

      for (const row of rows) {
        const planName = (row.corpus_plan as any)?.name ?? ''
        const planEntry = [...planMap.values()].find(p => p.planName === planName)
        if (!planEntry) continue

        const catName = (row.category as any)?.name ?? 'Other'
        let group = planEntry.groups.find(g => g.categoryName === catName)
        if (!group) {
          group = { categoryName: catName, totalSpent: 0, firstDate: row.expense_date, lastDate: row.expense_date, count: 0 }
          planEntry.groups.push(group)
        }
        group.totalSpent  += row.amount
        group.count       += 1
        group.lastDate     = row.expense_date
        planEntry.totalSpent += row.amount
      }

      return [...planMap.values()].filter(p => p.totalSpent > 0)
    },
  })

  async function handleDownloadStatement() {
    if (!myFlat) return
    setGeneratingStatement(true)
    try {
      const fy = FISCAL_YEAR_LIST.find(f => f.year === statementFyYear)
      if (!fy) return

      const { data: fyPayments } = await supabase
        .from('transactions')
        .select('id,value_date,amount,fiscal_month,corpus,fiscal_year')
        .eq('flat_code', (myFlat as any).code)
        .eq('cr_dr', 'CR')
        .eq('fiscal_year', fy.year)
        .neq('row_type', 'VOIDED')

      const fyTxns = (fyPayments ?? []) as {
        id: string; value_date: string; amount: number
        fiscal_month: string | null; corpus: string; fiscal_year: number | null
      }[]

      const monthlyRate = (myFlat as any).maintenance_amt ?? 0

      const now    = new Date()
      const cutoff = fy.year === currentFiscalYear() ? now : new Date(`${fy.year + 1}-03-31`)

      const maintenanceRows = MONTHS_IN_ORDER
        .map(mon => {
          const calYear = ['Jan', 'Feb', 'Mar'].includes(mon) ? fy.year + 1 : fy.year
          const monthDate = new Date(`${calYear}-${String(new Date(`${mon} 1, ${calYear}`).getMonth() + 1).padStart(2, '0')}-01`)
          if (monthDate > cutoff) return null

          const shortLabel = `${mon}-${String(calYear).slice(-2)}`
          const paid = fyTxns
            .filter(t => t.corpus !== 'YES' && t.fiscal_month === mon)
            .reduce((s, t) => s + t.amount, 0)

          return {
            month:   shortLabel,
            due:     monthlyRate,
            paid,
            balance: Math.max(0, monthlyRate - paid),
          }
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)

      const corpusPaid = fyTxns
        .filter(t => t.corpus === 'YES')
        .reduce((s, t) => s + t.amount, 0)

      const corpusRows = (corpusList as any[]).map((c: any) => ({
        planName: c.plan_name,
        target:   c.corpus_target,
        paid:     c.collected,
        balance:  c.balance,
      }))

      const totalMaintPaid  = maintenanceRows.reduce((s, r) => s + r.paid, 0)
      const totalCorpusPaid = corpusPaid

      let ownerName = ''
      const { data: resData } = await supabase
        .from('residents')
        .select('name, relation')
        .eq('flat_id', (myFlat as any).id)
        .eq('type', 'Owner')
        .eq('is_active', true)
      const owners = (resData ?? []) as { name: string; relation: string }[]
      ownerName = (owners.find(o => o.relation === 'Self') ?? owners[0])?.name ?? ''

      const generated = new Date().toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
      })

      const [{ pdf }, { OwnerStatementDoc }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/reports/OwnerStatementPdf'),
      ])

      const blob = await pdf(
        <OwnerStatementDoc data={{
          flatCode:        (myFlat as any).code,
          block:           (myFlat as any).block,
          ownerName,
          fyLabel:         fy.label,
          maintenanceRows,
          corpusRows,
          totalMaintPaid,
          totalCorpusPaid,
          generated,
        }} />
      ).toBlob()

      triggerDownload(blob, `Statement_${(myFlat as any).code}_${fy.label.replace(/\s/g, '_')}.pdf`)
    } finally {
      setGeneratingStatement(false)
    }
  }

  const upi  = settings?.collection_upi  ?? ''
  const bank = settings?.collection_bank ?? ''
  const currentMonth = new Date().toLocaleString('en-IN', { month: 'short' })

  const monthlyRate     = myFlat?.maintenance_amt ?? 0
  const startFy         = dues?.start_fiscal_year ?? currentFiscalYear()
  const allMonths       = elapsedMonthsSince(startFy)
  const paidCount       = monthlyRate > 0 ? Math.floor((dues?.collected_fy ?? 0) / monthlyRate) : 0
  const effectiveStatus = !dues ? 'Due'
    : dues.total_outstanding <= 0 ? 'Clear'
    : dues.pending <= 0 ? 'Arrears'
    : dues.status
  const effectivePaidCount = effectiveStatus === 'Clear' && monthlyRate > 0
    ? Math.min(allMonths.length, Math.floor(((dues?.collected_fy ?? 0) + (dues?.advance_credits ?? 0)) / monthlyRate))
    : paidCount
  const pendingMonths   = effectiveStatus !== 'Clear' ? allMonths.slice(paidCount) : []
  const planNameByPlanId = new Map(corpusList.map(c => [c.plan_id, c.plan_name]))

  return (
    <div className="flex flex-col gap-5 fade-in max-w-2xl">
      {/* Page header: title + download controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[22px] font-extrabold" style={{ color: 'var(--ink-900)' }}>My Flat</h1>
          <p className="text-[13px]" style={{ color: 'var(--ink-400)' }}>Your maintenance &amp; corpus summary</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statementFyYear}
            onChange={e => setStatementFyYear(Number(e.target.value))}
            className="ds-field text-sm"
          >
            {FISCAL_YEAR_LIST.map(f => (
              <option key={f.year} value={f.year}>{f.label}</option>
            ))}
          </select>
          <button
            onClick={handleDownloadStatement}
            disabled={!myFlat || generatingStatement}
            className="btn-primary flex items-center gap-2 py-1.5 px-3 text-sm disabled:opacity-40"
          >
            {generatingStatement
              ? <><Loader2 size={14} className="animate-spin" /> Generating…</>
              : <><FileText size={14} /> Download Statement</>
            }
          </button>
        </div>
      </div>

      {/* Flat identity */}
      <div className="surface !p-5">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--brand-50)' }}>
            <Building2 size={18} style={{ color: 'var(--brand-600)' }} />
          </div>
          <div>
            <p className="text-[18px] font-extrabold" style={{ color: 'var(--ink-900)' }}>
              Flat {myFlat?.code ?? '—'} · Block {myFlat?.block ?? '—'}
            </p>
            <p className="text-[13px]" style={{ color: 'var(--ink-400)' }}>
              {myFlat?.bhk_type ?? ''}
              {myFlat?.maintenance_amt ? `${myFlat.bhk_type ? ' · ' : ''}₹${myFlat.maintenance_amt.toLocaleString('en-IN')}/month` : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Society financial health strip */}
      <div className="surface !p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--ink-400)' }}>
          Society overview
        </p>
        <div className="grid grid-cols-3 gap-3 divide-x" style={{ borderColor: 'var(--ink-100)' }}>
          <HealthCard
            label="Maintenance cleared"
            value={healthMaintenance ? `${healthMaintenance.cleared} of ${healthMaintenance.total} flats` : '—'}
          />
          <div className="pl-3">
            <HealthCard
              label="Corpus collected"
              value={
                healthCorpus && healthCorpus.target > 0
                  ? `${Math.round((healthCorpus.collected / healthCorpus.target) * 100)}% of ${formatINR(healthCorpus.target)}`
                  : '—'
              }
            />
          </div>
          <div className="pl-3">
            <HealthCard
              label="Last expense"
              value={lastExpense ? formatINR(lastExpense.amount) : '—'}
              sub={
                lastExpense
                  ? `${(lastExpense.category as any)?.name ?? 'Expense'} · ${new Date(lastExpense.expense_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
                  : undefined
              }
            />
          </div>
        </div>
      </div>

      {/* Dues card */}
      <div className="surface !p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-[14px]">Maintenance dues</p>
          {dues && <StatusPill status={effectiveStatus} />}
        </div>
        {dues ? (
          <div className="flex flex-col gap-1.5 text-[13px]">
            {effectiveStatus === 'Clear' ? (
              <>
                <p style={{ color: 'var(--ok)' }}>No maintenance due this year</p>
                <div className="flex justify-between pt-1 border-t" style={{ borderColor: 'var(--ink-100)' }}>
                  <span style={{ color: 'var(--ink-500)' }}>Paid this year</span>
                  <span className="font-semibold" style={{ color: 'var(--ok)' }}>{formatINR(dues.collected_fy)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--ink-500)' }}>Months covered</span>
                  <span className="font-semibold" style={{ color: 'var(--ink-800)' }}>{effectivePaidCount} of {allMonths.length}</span>
                </div>
              </>
            ) : effectiveStatus === 'Arrears' ? (
              <>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--ink-500)' }}>Paid this year</span>
                  <span className="font-semibold" style={{ color: 'var(--ok)' }}>{formatINR(dues.collected_fy)} ✓</span>
                </div>
                <div className="flex flex-col gap-1.5 pt-1 border-t" style={{ borderColor: 'var(--ink-100)' }}>
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--ink-500)' }}>Previous balance</span>
                    <span className="font-semibold" style={{ color: 'var(--bad)' }}>{formatINR(dues.arrears_maintenance)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-1.5" style={{ borderColor: 'var(--ink-100)' }}>
                    <span className="font-semibold" style={{ color: 'var(--ink-700)' }}>Outstanding</span>
                    <span className="font-bold" style={{ color: 'var(--bad)' }}>{formatINR(dues.total_outstanding)}</span>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--ink-500)' }}>Due this year</span>
                  <span className="font-medium">{formatINR(dues.annual_due)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--ink-500)' }}>Collected</span>
                  <span className="font-medium" style={{ color: 'var(--ok)' }}>{formatINR(dues.collected_fy)}</span>
                </div>
                {dues.pending > 0 && (
                  <div className="flex flex-col gap-1.5 pt-1 border-t" style={{ borderColor: 'var(--ink-100)' }}>
                    <div className="flex justify-between">
                      <span className="font-semibold" style={{ color: 'var(--bad)' }}>Pending</span>
                      <span className="font-bold" style={{ color: 'var(--bad)' }}>{formatINR(dues.pending)}</span>
                    </div>
                    {pendingMonths.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {pendingMonths.length <= 3
                          ? pendingMonths.map(lbl => (
                              <span key={lbl} className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                                style={{ background: 'var(--bad-bg)', color: 'var(--bad)' }}>
                                {lbl}
                              </span>
                            ))
                          : (
                              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                                style={{ background: 'var(--bad-bg)', color: 'var(--bad)' }}>
                                {pendingMonths[0]} – {pendingMonths[pendingMonths.length - 1]} ({pendingMonths.length} months)
                              </span>
                            )
                        }
                      </div>
                    )}
                  </div>
                )}
                {dues.arrears_maintenance > 0 && (
                  <div className="flex flex-col gap-1.5 pt-1 border-t" style={{ borderColor: 'var(--ink-100)' }}>
                    <div className="flex justify-between">
                      <span style={{ color: 'var(--ink-500)' }}>Previous arrears</span>
                      <span className="font-semibold" style={{ color: 'var(--bad)' }}>{formatINR(dues.arrears_maintenance)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-semibold">Total outstanding</span>
                      <span className="font-bold" style={{ color: 'var(--bad)' }}>{formatINR(dues.total_outstanding)}</span>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <p className="text-[13px]" style={{ color: 'var(--ink-400)' }}>No dues data</p>
        )}
      </div>

      {/* Corpus cards — one per active plan */}
      {corpusList.map(corpus => {
        const isDone = corpus.status === 'Done'
        return (
          <div key={corpus.plan_id} className="surface !p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-[14px]">Corpus — {corpus.plan_name}</p>
              {isDone && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold"
                  style={{ background: 'var(--ok-bg)', color: 'var(--ok)' }}>
                  <CheckCircle2 size={13} /> Paid
                </span>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-end justify-between">
                <span className="text-[22px] font-extrabold" style={{ color: isDone ? 'var(--ok)' : 'var(--brand-700)' }}>
                  {formatINR(corpus.collected)}
                </span>
                <span className="text-[12px]" style={{ color: 'var(--ink-400)' }}>
                  of {formatINR(corpus.corpus_target)}
                </span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--ink-100)' }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${Math.min(corpus.pct_paid ?? 0, 100)}%`, background: isDone ? 'var(--ok)' : 'var(--brand-500)' }}
                />
              </div>
              <p className="text-[11.5px]" style={{ color: isDone ? 'var(--ok)' : 'var(--ink-400)' }}>
                {isDone ? 'Fully paid — thank you!' : `${corpus.pct_paid?.toFixed(0) ?? 0}% paid`}
              </p>
            </div>
          </div>
        )
      })}

      {/* How your corpus is used */}
      {corpusExpenses.length > 0 && (
        <div className="surface !p-5 flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Receipt size={16} style={{ color: 'var(--brand-600)' }} />
            <p className="font-semibold text-[14px]">How your corpus is used</p>
          </div>
          {corpusExpenses.map(plan => (
            <div key={plan.planId} className="flex flex-col gap-2">
              <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-400)' }}>
                {plan.planName} · {formatINR(plan.totalSpent)} spent
              </p>
              <div className="flex flex-col gap-1">
                {plan.groups.map(g => (
                  <div key={g.categoryName} className="flex items-start justify-between gap-2 py-1.5 border-b last:border-0" style={{ borderColor: 'var(--ink-100)' }}>
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <p className="text-[13px] font-medium truncate" style={{ color: 'var(--ink-800)' }}>{g.categoryName}</p>
                      <p className="text-[11px]" style={{ color: 'var(--ink-400)' }}>
                        {new Date(g.firstDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                        {g.firstDate !== g.lastDate && ` – ${new Date(g.lastDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`}
                        {` · ${g.count} payment${g.count !== 1 ? 's' : ''}`}
                      </p>
                    </div>
                    <span className="font-semibold text-[13px] shrink-0" style={{ color: 'var(--ink-700)' }}>
                      {formatINR(g.totalSpent)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Previous corpus arrears from closed plans */}
      {corpusArrears.map(row => (
        <div key={row.id} className="surface !p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-[14px]">Corpus — {row.source_label}</p>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold"
              style={{ background: 'var(--bad-bg)', color: 'var(--bad)' }}>
              <AlertCircle size={13} /> Pending
            </span>
          </div>
          <p className="text-[13px]" style={{ color: 'var(--bad)' }}>
            {formatINR(row.amount)} outstanding — contact admin to resolve
          </p>
        </div>
      ))}

      {corpusList.length === 0 && corpusArrears.length === 0 && (
        <div className="surface !p-5">
          <p className="text-[13px]" style={{ color: 'var(--ink-400)' }}>No corpus plan active</p>
        </div>
      )}

      {/* How to pay */}
      {(upi || bank) && (
        <div className="surface !p-5 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <IndianRupee size={16} style={{ color: 'var(--brand-600)' }} />
            <p className="font-semibold text-[14px]">How to pay</p>
          </div>
          <div className="flex flex-col gap-2 text-[13.5px]">
            {upi && (
              <div className="flex flex-col gap-0.5">
                <span className="text-[11.5px] font-medium uppercase tracking-wide" style={{ color: 'var(--ink-400)' }}>UPI</span>
                <span className="font-mono font-semibold" style={{ color: 'var(--ink-900)' }}>{upi}</span>
              </div>
            )}
            {bank && (
              <div className="flex flex-col gap-0.5">
                <span className="text-[11.5px] font-medium uppercase tracking-wide" style={{ color: 'var(--ink-400)' }}>Bank transfer</span>
                <span style={{ color: 'var(--ink-700)' }}>{bank}</span>
              </div>
            )}
          </div>

          {/* Remark format */}
          <div className="rounded-xl p-3.5 flex flex-col gap-2" style={{ background: 'var(--ink-50)', border: '1px solid var(--ink-100)' }}>
            <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-400)' }}>Payment remark format</p>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium w-20 shrink-0" style={{ color: 'var(--ink-400)' }}>Maintenance</span>
                <code className="text-[12.5px] font-mono px-2 py-0.5 rounded-md" style={{ background: 'var(--brand-50)', color: 'var(--brand-700)' }}>
                  {myFlat?.code ?? 'FlatNo'} {currentMonth} maintenance
                </code>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium w-20 shrink-0" style={{ color: 'var(--ink-400)' }}>Corpus</span>
                <code className="text-[12.5px] font-mono px-2 py-0.5 rounded-md" style={{ background: 'var(--brand-50)', color: 'var(--brand-700)' }}>
                  {myFlat?.code ?? 'FlatNo'} corpus
                </code>
              </div>
            </div>
            <p className="text-[11px]" style={{ color: 'var(--ink-400)' }}>
              Replace the month with the month you are paying for.
            </p>
          </div>
        </div>
      )}

      {/* Payment history */}
      <div className="surface !p-0 overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: 'var(--ink-100)' }}>
          <Receipt size={16} style={{ color: 'var(--brand-600)' }} />
          <p className="font-semibold text-[14px]">Payment history</p>
        </div>
        {payments.length === 0 ? (
          <p className="px-5 py-6 text-[13px]" style={{ color: 'var(--ink-400)' }}>No payments recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="ds-tbl">
              <thead>
                <tr>
                  {['Date', 'Description', 'Type', 'Amount', ''].map(h => <th key={h}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {payments.map(p => (
                  <tr key={p.id}>
                    <td className="mono text-[12px] whitespace-nowrap" style={{ color: 'var(--ink-500)' }}>
                      {formatDateDMY(p.value_date)}
                    </td>
                    <td className="text-[12.5px]" style={{ color: 'var(--ink-700)' }}>
                      <p className="truncate max-w-[220px]">{p.description}</p>
                      {p.fiscal_label && (
                        <p className="text-[11px]" style={{ color: 'var(--ink-400)' }}>{p.fiscal_label}</p>
                      )}
                    </td>
                    <td>
                      <span className={`ds-badge ${p.corpus === 'YES' ? 'ds-badge-info' : 'ds-badge-ok'}`}>
                        {p.corpus === 'YES' ? 'Corpus' : (p.category ?? 'Maintenance')}
                      </span>
                    </td>
                    <td className="font-semibold mono text-right" style={{ color: 'var(--ok)' }}>
                      {formatINR(p.amount)}
                    </td>
                    <td className="text-right">
                      <ReceiptButton
                        txn={p}
                        flat={{ code: myFlat!.code, block: myFlat!.block }}
                        planName={p.plan_id ? planNameByPlanId.get(p.plan_id) ?? null : null}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
