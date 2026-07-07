import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef } from 'ag-grid-community'
import { Download, X, TrendingDown, ChevronDown, Layers, Plus, Trash2, Send, MessageCircle, Check } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase, CorpusEntry, CorpusPlan, Flat } from '@/lib/supabase'
import { formatINR } from '@/lib/tagger'
import { fetchFlatContactsByCode } from '@/lib/contacts'
import { WhatsAppSendButtons } from '@/components/WhatsAppSendButtons'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRoleCtx } from '@/contexts/RoleContext'
import { toast } from 'sonner'

const STATUS_BADGE: Record<string, string> = {
  active:    'bg-green-100 text-green-700',
  draft:     'bg-amber-100 text-amber-700',
  completed: 'bg-slate-100 text-slate-600',
  cancelled: 'bg-red-100 text-red-500',
}

function fyRange(p: CorpusPlan) {
  return `FY ${p.start_fiscal_year}-${String((p.start_fiscal_year ?? 0) + 1).slice(-2)} – FY ${p.end_fiscal_year}-${String((p.end_fiscal_year ?? 0) + 1).slice(-2)}`
}

function ParallelPlanWarning({ plans, onDismiss }: { plans: CorpusPlan[]; onDismiss: () => void }) {
  const names = plans.map(p => `${p.name} (${fyRange(p)})`).join(' vs ')
  return (
    <div className="flex items-start gap-3 rounded-xl px-4 py-3 border border-amber-300 bg-amber-50">
      <span className="mt-0.5 text-amber-600 shrink-0">⚠</span>
      <p className="flex-1 text-sm text-amber-800">
        <span className="font-semibold">{plans.length} active plans detected.</span>{' '}
        Corpus payments without a plan tag will be attributed by fiscal year range.
        Overlap risk: {names}.
      </p>
      <button
        onClick={onDismiss}
        className="shrink-0 p-0.5 rounded hover:bg-amber-100 text-amber-500"
        aria-label="Dismiss warning"
      >
        <X size={15} />
      </button>
    </div>
  )
}

export default function CorpusPage() {
  const { isAdmin } = useRoleCtx()
  const qc = useQueryClient()
  const [selectedPlanId, setSelectedPlanId] = useState<string>('__all__')
  const [tab, setTab] = useState<'collection' | 'plan' | 'expenditure' | 'calendar'>('collection')
  const [showCreateWizard, setShowCreateWizard] = useState(false)
  const [showActivate, setShowActivate] = useState(false)
  const [showClose, setShowClose] = useState(false)

  function invalidatePlans() {
    qc.invalidateQueries({ queryKey: ['corpus-plans'] })
    qc.invalidateQueries({ queryKey: ['corpus'] })
  }

  const { data: plans = [] } = useQuery({
    queryKey: ['corpus-plans'],
    queryFn: async () => {
      const { data } = await supabase
        .from('corpus_plans')
        .select('*')
        .order('created_at', { ascending: false })
      return (data ?? []) as CorpusPlan[]
    },
  })

  const activePlans  = plans.filter(p => p.status === 'active' || p.status === 'draft')
  const historyPlans = plans.filter(p => p.status === 'completed' || p.status === 'cancelled')

  const trulyActivePlans = plans.filter(p => p.status === 'active')
  const [overlapDismissed, setOverlapDismissed] = useState(false)

  // All entries from v_corpus_tracker (only active/draft plans per view WHERE clause)
  const { data: allCorpus = [], isLoading } = useQuery({
    queryKey: ['corpus'],
    queryFn: async () => {
      const { data } = await supabase.from('v_corpus_tracker').select('*').order('flat_code')
      return (data ?? []) as CorpusEntry[]
    },
  })

  // Filter to selected plan or show all
  const corpus = selectedPlanId === '__all__'
    ? allCorpus
    : allCorpus.filter(e => e.plan_id === selectedPlanId)

  const selectedPlan = selectedPlanId === '__all__'
    ? null
    : plans.find(p => p.id === selectedPlanId) ?? null

  // Installments for selected plan
  const { data: installments = [] } = useQuery({
    queryKey: ['corpus-installments', selectedPlanId],
    queryFn: async () => {
      if (selectedPlanId === '__all__') return []
      const { data } = await supabase
        .from('corpus_plan_installments')
        .select('*')
        .eq('plan_id', selectedPlanId)
        .order('installment_no')
      return data ?? []
    },
    enabled: selectedPlanId !== '__all__',
  })

  const { data: flatInstallments = [] } = useQuery({
    queryKey: ['corpus-flat-installments', selectedPlanId],
    queryFn: async () => {
      if (selectedPlanId === '__all__') return []
      const { data } = await supabase
        .from('corpus_plan_flat_installments')
        .select('*, flat:flat_id(code)')
        .eq('plan_id', selectedPlanId)
      return data ?? []
    },
    enabled: selectedPlanId !== '__all__',
  })

  const { data: planFlats = [] } = useQuery({
    queryKey: ['corpus-plan-flats', selectedPlanId],
    queryFn: async () => {
      if (selectedPlanId === '__all__') return []
      const { data } = await supabase
        .from('corpus_plan_flats')
        .select('*, flat:flat_id(code,block,bhk_type)')
        .eq('plan_id', selectedPlanId)
        .order('flat_id')
      return data ?? []
    },
    enabled: selectedPlanId !== '__all__',
  })

  const { data: expenditures = [] } = useQuery({
    queryKey: ['corpus-expenditure', selectedPlanId, activePlans.map(p => p.id).join(',')],
    queryFn: async () => {
      let q = supabase.from('expenses')
        .select('id,expense_date,description,amount,voucher_no,payee_name_raw,category:category_id(name)')
        .is('voided_at', null)
        .order('expense_date', { ascending: false })
      if (selectedPlanId !== '__all__') {
        q = q.eq('corpus_plan_id', selectedPlanId)
      } else {
        // Match the tracker's scope (active/draft plans only) so Spent and
        // Collected cover the same plans
        if (activePlans.length === 0) return []
        q = q.in('corpus_plan_id', activePlans.map(p => p.id))
      }
      return (await q).data ?? []
    },
  })

  const { data: openCorpusArrears = [] } = useQuery({
    queryKey: ['corpus-arrears-open'],
    queryFn: async () => {
      const { data } = await supabase
        .from('flat_arrears')
        .select('amount, source_label, flat:flat_id(code)')
        .eq('arrears_type', 'corpus')
      return (data ?? []) as unknown as { amount: number; source_label: string; flat: { code: string } | null }[]
    },
  })

  const { data: allInstallments = [] } = useQuery({
    queryKey: ['corpus-all-installments', trulyActivePlans.map(p => p.id).join(',')],
    queryFn: async () => {
      if (trulyActivePlans.length === 0) return []
      const { data } = await supabase
        .from('corpus_plan_installments')
        .select('*')
        .in('plan_id', trulyActivePlans.map(p => p.id))
        .order('plan_id')
        .order('installment_no')
      return data ?? []
    },
    enabled: trulyActivePlans.length > 0,
  })

  const { data: allFlatInstallments = [] } = useQuery({
    queryKey: ['corpus-all-flat-installments', trulyActivePlans.map(p => p.id).join(',')],
    queryFn: async () => {
      if (trulyActivePlans.length === 0) return []
      const { data } = await supabase
        .from('corpus_plan_flat_installments')
        .select('*, flat:flat_id(code)')
        .in('plan_id', trulyActivePlans.map(p => p.id))
      return data ?? []
    },
    enabled: trulyActivePlans.length > 0,
  })

  // Aggregates — per-plan when one selected, or consolidated
  const totalTarget    = corpus.reduce((s, c) => s + c.effective_target, 0)
  const totalCollected = corpus.reduce((s, c) => s + c.collected, 0)
  const totalSpent     = expenditures.reduce((s: number, e: any) => s + e.amount, 0)
  const availableCash  = Math.max(0, totalCollected - totalSpent)
  const stillToCollect = Math.max(0, totalTarget - totalCollected)
  const allowedToSpend = availableCash + stillToCollect
  const pct = totalTarget > 0 ? Math.round(totalCollected * 100 / totalTarget) : 0

  const planLabel = selectedPlan
    ? `${selectedPlan.name} · FY ${selectedPlan.start_fiscal_year}-${String((selectedPlan.start_fiscal_year ?? 0) + 1).slice(-2)} – FY ${selectedPlan.end_fiscal_year}-${String((selectedPlan.end_fiscal_year ?? 0) + 1).slice(-2)}`
    : `All active plans (${activePlans.length})`

  async function handleBroadcast() {
    // Aggregate balance per flat (when multiple plans, sum across them)
    const byFlat = new Map<string, number>()
    for (const c of corpus) {
      if ((c.balance ?? 0) > 0) {
        byFlat.set(c.flat_code, (byFlat.get(c.flat_code) ?? 0) + c.balance)
      }
    }
    const openFlats = Array.from(byFlat.entries())
      .map(([flat_code, balance]) => ({ flat_code, balance }))
      .sort((a, b) => a.flat_code.localeCompare(b.flat_code))
    if (openFlats.length === 0) {
      toast.info('All flats have completed their corpus contribution')
      return
    }
    const total = openFlats.reduce((s, d) => s + d.balance, 0)
    const asOf = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    const lines = [
      `*Lilac Apartments — Corpus update*`,
      selectedPlan ? `${selectedPlan.name} · As of ${asOf}` : `As of ${asOf}`,
      ``,
      ...openFlats.map(d => `${d.flat_code.padEnd(5)} ₹${d.balance.toLocaleString('en-IN')}`),
      ``,
      `Total pending: *₹${total.toLocaleString('en-IN')}* across ${openFlats.length} flat${openFlats.length !== 1 ? 's' : ''}`,
      ``,
      `Kindly contribute at your earliest convenience.`,
      `— The Lilac Apartment Association, Rajakilpakkam`,
    ].join('\n')
    try {
      await navigator.clipboard.writeText(lines)
      toast.success('Copied — open WhatsApp and paste in your group')
      window.open(`https://wa.me/?text=${encodeURIComponent(lines)}`, '_blank', 'noopener')
    } catch {
      toast.error('Copy failed')
    }
  }

  return (
    <div className="flex flex-col gap-5 fade-in">
      {/* Header + plan selector */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[24px] font-extrabold">Corpus fund</h1>
          <p className="text-[13.5px] mt-1" style={{ color: 'var(--ink-500)' }}>{planLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end ml-auto">
          <Button
            size="sm"
            variant="outline"
            onClick={handleBroadcast}
            disabled={!corpus.length}
            className="flex items-center gap-1.5"
            style={{ borderColor: 'var(--ok-bd)', background: 'var(--ok-bg)', color: 'var(--ok)' }}
          >
            <Send size={14} /> Broadcast
          </Button>
          {isAdmin && selectedPlanId !== '__all__' && selectedPlan?.status === 'draft' && (
            <Button size="sm" onClick={() => setShowActivate(true)} style={{ background: 'var(--brand-600)', color: '#fff' }}>
              Activate plan
            </Button>
          )}
          {isAdmin && selectedPlanId !== '__all__' && selectedPlan?.status === 'active' && (
            <Button size="sm" variant="outline" onClick={() => setShowClose(true)} className="border-red-300 text-red-600 hover:bg-red-50">
              Close plan
            </Button>
          )}
          {isAdmin && (
            <Button size="sm" onClick={() => setShowCreateWizard(true)} className="flex items-center gap-1.5" style={{ background: 'var(--brand-600)', color: '#fff' }}>
              <Plus size={14} /> New plan
            </Button>
          )}
          <PlanSelector
            plans={activePlans}
            selectedId={selectedPlanId}
            onChange={id => { setSelectedPlanId(id); setTab('collection') }}
          />
        </div>
      </div>


      {trulyActivePlans.length >= 2 && !overlapDismissed && (
        <ParallelPlanWarning plans={trulyActivePlans} onDismiss={() => setOverlapDismissed(true)} />
      )}

      {openCorpusArrears.length > 0 && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-violet-50 border border-violet-200 text-sm">
          <span className="mt-0.5 text-violet-600 shrink-0">↪</span>
          <p className="flex-1 text-violet-800">
            <span className="font-semibold">
              {formatINR(openCorpusArrears.reduce((s, a) => s + a.amount, 0))} unpaid from closed plans
            </span>{' '}
            ({[...new Set(openCorpusArrears.map(a => a.source_label))].join(', ')}) across{' '}
            {new Set(openCorpusArrears.map(a => a.flat?.code)).size} flats:{' '}
            {openCorpusArrears
              .slice()
              .sort((a, b) => (a.flat?.code ?? '').localeCompare(b.flat?.code ?? ''))
              .map(a => `${a.flat?.code ?? '?'} ${formatINR(a.amount)}`)
              .join(' · ')}.
            {' '}These will be offered as carry-forward when you create the next plan.
          </p>
        </div>
      )}

      {/* Consolidated view banner when showing all */}
      {selectedPlanId === '__all__' && activePlans.length > 1 && (
        <ConsolidatedBanner plans={activePlans} allCorpus={allCorpus} />
      )}

      {/* Compact KPI strip */}
      <div className="surface !p-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-[1fr_1fr_1fr_auto] gap-3 items-center">
          <StatItem label="Target"       value={formatINR(totalTarget)}    color="text-slate-800" />
          <StatItem label="Collected"    value={formatINR(totalCollected)} color="text-green-700" />
          <StatItem label="Spent so far" value={formatINR(totalSpent)}     color="text-red-600" />
          <div className="col-span-2 sm:col-span-3 lg:col-span-1 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2">
            <p className="text-xs" style={{ color: 'var(--ink-500)' }}>Allowed to spend</p>
            <p className="text-xl font-bold text-blue-700">{formatINR(allowedToSpend)}</p>
            <p className="text-xs text-blue-700/80">
              {formatINR(availableCash)} in hand + {formatINR(stillToCollect)} to collect
            </p>
          </div>
        </div>
        <div className="mt-3">
          <div className="ds-track">
            <div className="ds-track-fill" style={{ width: `${Math.min(pct, 100)}%`, background: 'var(--brand-500)' }} />
          </div>
          <div className="flex justify-between mt-1.5 text-xs" style={{ color: 'var(--ink-400)' }}>
            <span>{formatINR(totalCollected)} collected · {pct}%</span>
            <span>{formatINR(totalTarget)} target</span>
          </div>
        </div>
      </div>
      {totalCollected > totalTarget && totalTarget > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-green-50 border border-green-200 text-sm">
          <span className="text-green-600 font-semibold">
            Surplus: {formatINR(totalCollected - totalTarget)}
          </span>
          <span style={{ color: 'var(--ink-500)' }}>
            — collected exceeds the plan target. This is informational.
          </span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl p-1 flex-wrap" style={{ background: 'var(--ink-100)' }}>
        {([
          { key: 'collection',  label: 'By Flat' },
          { key: 'plan',        label: 'Installment Plan', disabled: selectedPlanId === '__all__' },
          { key: 'expenditure', label: 'Expenditure' },
          { key: 'calendar',    label: 'Collection Calendar' },
        ] as { key: typeof tab; label: string; disabled?: boolean }[]).map(({ key, label, disabled }) => (
          <button key={key} onClick={() => !disabled && setTab(key)} disabled={disabled}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === key
                ? 'bg-white shadow-sm'
                : disabled
                ? 'cursor-not-allowed'
                : ''
            }`}
            style={
              tab === key
                ? { color: 'var(--ink-900)' }
                : disabled
                ? { color: 'var(--ink-300)' }
                : { color: 'var(--ink-500)' }
            }>
            {label}
          </button>
        ))}
      </div>

      {tab === 'collection'  && <CollectionGrid corpus={corpus} isLoading={isLoading} multiPlan={selectedPlanId === '__all__'} />}
      {tab === 'plan'        && <PlanGrid planFlats={planFlats} installments={installments} flatInstallments={flatInstallments} corpus={corpus} />}
      {tab === 'expenditure' && (
        <ExpenditureView
          expenditures={expenditures}
          plan={selectedPlan ?? (activePlans.length === 1 ? activePlans[0] : null)}
        />
      )}
      {tab === 'calendar' && (
        <CollectionCalendar
          activePlans={trulyActivePlans}
          allCorpus={allCorpus}
          allInstallments={allInstallments}
          allFlatInstallments={allFlatInstallments}
        />
      )}

      {/* History section */}
      {historyPlans.length > 0 && (
        <PlanHistory plans={historyPlans} />
      )}

      {/* Empty state */}
      {plans.length === 0 && (
        <div className="surface !p-12 flex flex-col items-center gap-4 text-center">
          <Layers size={40} style={{ color: 'var(--ink-300)' }} />
          <div>
            <p className="font-semibold text-lg" style={{ color: 'var(--ink-700)' }}>No corpus plans yet</p>
            <p className="text-sm mt-1" style={{ color: 'var(--ink-500)' }}>Create your first plan to start tracking corpus fund collection.</p>
          </div>
          {isAdmin && (
            <Button onClick={() => setShowCreateWizard(true)} className="flex items-center gap-1.5 mt-2" style={{ background: 'var(--brand-600)', color: '#fff' }}>
              <Plus size={14} /> New plan
            </Button>
          )}
        </div>
      )}

      {showCreateWizard && (
        <CreatePlanWizard
          open={showCreateWizard}
          onClose={() => setShowCreateWizard(false)}
          onSuccess={invalidatePlans}
        />
      )}
      {showActivate && selectedPlanId !== '__all__' && selectedPlan && (
        <ActivatePlanDialog
          open={showActivate}
          plan={selectedPlan}
          onClose={() => setShowActivate(false)}
          onSuccess={invalidatePlans}
        />
      )}
      {showClose && selectedPlanId !== '__all__' && (
        <ClosePlanDialog
          open={showClose}
          planId={selectedPlanId}
          onClose={() => setShowClose(false)}
          onSuccess={invalidatePlans}
        />
      )}
    </div>
  )
}

// ── Plan selector ─────────────────────────────────────────────

function PlanSelector({ plans, selectedId, onChange }: {
  plans: CorpusPlan[]
  selectedId: string
  onChange: (id: string) => void
}) {
  return (
    <Select value={selectedId} onValueChange={onChange}>
      <SelectTrigger className="w-56">
        <SelectValue placeholder="Select plan" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">
          <span className="flex items-center gap-2">
            <Layers size={14} className="text-slate-400" /> All active plans
          </span>
        </SelectItem>
        {plans.map(p => (
          <SelectItem key={p.id} value={p.id}>
            <span className="flex items-center gap-2">
              <span className={`inline-block w-2 h-2 rounded-full ${p.status === 'active' ? 'bg-green-500' : 'bg-amber-400'}`} />
              {p.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// ── Consolidated banner ───────────────────────────────────────

function ConsolidatedBanner({ plans, allCorpus }: { plans: CorpusPlan[]; allCorpus: CorpusEntry[] }) {
  const planSummaries = plans.map(p => {
    const entries = allCorpus.filter(e => e.plan_id === p.id)
    const target    = entries.reduce((s, e) => s + e.effective_target, 0)
    const collected = entries.reduce((s, e) => s + e.collected, 0)
    const rawBalance = target - collected
    return {
      plan: p,
      target,
      collected,
      balance:  Math.max(0, rawBalance),
      surplus:  rawBalance < 0 ? Math.abs(rawBalance) : 0,
    }
  })

  return (
    <div className="surface !p-4" style={{ background: 'var(--brand-50)' }}>
      <p className="text-xs font-semibold text-violet-700 uppercase tracking-wide mb-3">Consolidated corpus pool</p>
      <div className="divide-rows">
        {planSummaries.map(({ plan, target, collected, balance, surplus }) => (
          <div key={plan.id} className="flex items-center gap-3 py-2 text-sm">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[plan.status]}`}>{plan.status}</span>
            <span className="font-medium flex-1" style={{ color: 'var(--ink-800)' }}>{plan.name}</span>
            <span style={{ color: 'var(--ink-500)' }}>{formatINR(collected)} / {formatINR(target)}</span>
            <span className={`font-semibold ${balance > 0 ? 'text-amber-600' : surplus > 0 ? '' : 'text-green-600'}`}>
              {balance > 0
                ? formatINR(balance)
                : surplus > 0
                ? (
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                    Surplus: {formatINR(surplus)}
                  </span>
                )
                : '✓'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Summary card ──────────────────────────────────────────────

function StatItem({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <p className="text-xs mb-0.5" style={{ color: 'var(--ink-500)' }}>{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
    </div>
  )
}

// ── Collection grid ───────────────────────────────────────────

function CollectionGrid({ corpus, isLoading, multiPlan }: { corpus: CorpusEntry[]; isLoading: boolean; multiPlan: boolean }) {
  const gridRef = useRef<AgGridReact>(null)
  const [selectedFlat, setSelectedFlat] = useState<CorpusEntry | null>(null)

  const colDefs = useMemo((): ColDef<any>[] => [
    { field: 'flat_code',     headerName: 'Flat',      width: 90 },
    ...(multiPlan ? [{ field: 'plan_name', headerName: 'Plan', width: 140, filter: true } as ColDef<any>] : []),
    { field: 'effective_target', headerName: 'Target', width: 120, type: 'numericColumn',
      valueFormatter: (p: any) => formatINR(p.value),
    },
    { field: 'collected',     headerName: 'Collected', width: 120, type: 'numericColumn',
      valueFormatter: (p: any) => formatINR(p.value),
    },
    { field: 'balance',       headerName: 'Balance',   width: 120, type: 'numericColumn',
      valueFormatter: (p: any) => formatINR(Math.max(0, p.value)),
      cellStyle: (p: any) => p.value > 0 ? { color: '#d97706', fontWeight: 600 } : { color: '#16a34a', fontWeight: 400 },
    },
    { field: 'pct_paid',      headerName: '% Paid',    width: 100, type: 'numericColumn',
      valueFormatter: (p: any) => `${p.value?.toFixed(0) ?? 0}%`,
    },
    { field: 'status', headerName: 'Status', width: 110, filter: true,
      cellRenderer: (p: any) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
          p.value === 'Done' ? 'bg-green-100 text-green-700' :
          p.value === 'Partial' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
        }`}>{p.value}</span>
      ),
    },
    { field: 'last_payment_date', headerName: 'Last Payment', width: 130 },
  ], [multiPlan])

  function handleExport() {
    const rows: any[] = []
    gridRef.current?.api?.forEachNodeAfterFilterAndSort(node => { if (node.data) rows.push(node.data) })
    const src = rows.length > 0 ? rows : corpus
    const ws = XLSX.utils.json_to_sheet(src.map(r => ({
      Flat: r.flat_code, Plan: r.plan_name,
      Target: r.effective_target, Collected: r.collected,
      Balance: Math.max(0, r.balance), '% Paid': r.pct_paid?.toFixed(1),
      Status: r.status, 'Last Payment': r.last_payment_date,
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Corpus Collection')
    XLSX.writeFile(wb, 'Corpus_Collection.xlsx')
  }

  if (isLoading) return <div className="surface h-64 animate-pulse" style={{ background: 'var(--ink-100)' }} />

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button onClick={handleExport} disabled={!corpus.length}
          className="flex items-center gap-1.5 text-[13px] font-medium disabled:opacity-40" style={{ color: 'var(--brand-700)' }}>
          <Download size={14} /> Export
        </button>
      </div>
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1 min-w-0">
          <div className="overflow-hidden border hairline" style={{ borderRadius: 'var(--ds-radius)', height: 480 }}>
            <AgGridReact
              ref={gridRef}
              rowData={corpus}
              columnDefs={colDefs}
              defaultColDef={{ sortable: true, resizable: true, filter: true, floatingFilter: true }}
              rowSelection={{ mode: 'singleRow' }}
              onRowClicked={e => setSelectedFlat(e.data)}
              getRowStyle={(p: any) => p.data?.flat_code === selectedFlat?.flat_code ? { background: 'var(--brand-50)' } : undefined}
            />
          </div>
        </div>
        {selectedFlat && (
          <FlatCorpusPanel flat={selectedFlat} onClose={() => setSelectedFlat(null)} />
        )}
      </div>
    </div>
  )
}

// ── Installment plan grid ─────────────────────────────────────

function PlanGrid({ planFlats, installments, flatInstallments, corpus }: {
  planFlats: any[]
  installments: any[]
  flatInstallments: any[]
  corpus: CorpusEntry[]
}) {
  const gridRef = useRef<AgGridReact>(null)
  const corpusMap = new Map(corpus.map(c => [c.flat_code, c]))

  // Build per-flat installment map: flatCode → { [installment_no]: amount }
  const flatInstMap = new Map<string, Record<number, number>>()
  for (const fi of flatInstallments) {
    const code = fi.flat?.code ?? ''
    if (!flatInstMap.has(code)) flatInstMap.set(code, {})
    flatInstMap.get(code)![fi.installment_no] = fi.amount
  }

  const rows = planFlats.map((pf: any) => {
    const code     = pf.flat?.code ?? ''
    const c        = corpusMap.get(code)
    const instAmts = flatInstMap.get(code) ?? {}
    const row: any = {
      flat_code:   code,
      bhk_type:    pf.flat?.bhk_type ?? '',
      target:      pf.target_amount,
      pre_payment: pf.pre_payment,
      carry_fwd:   pf.carry_forward_amount ?? 0,
      collected:   c?.collected ?? 0,
      remaining:   Math.max(0, (pf.target_amount + (pf.carry_forward_amount ?? 0)) - (c?.collected ?? 0)),
    }
    for (const inst of installments) {
      row[`inst_${inst.installment_no}`] = instAmts[inst.installment_no] ?? 0
    }
    return row
  })

  const colDefs = useMemo((): ColDef<any>[] => {
    const instCols: ColDef<any>[] = installments.map((inst: any) => ({
      field: `inst_${inst.installment_no}`,
      headerName: inst.label,
      width: 110,
      type: 'numericColumn',
      valueFormatter: (p: any) => p.value > 0 ? formatINR(p.value) : '—',
    }))
    return [
      { field: 'flat_code',   headerName: 'Flat',      width: 90 },
      { field: 'target',      headerName: 'Target',    width: 110, type: 'numericColumn', valueFormatter: (p: any) => formatINR(p.value) },
      { field: 'pre_payment', headerName: 'Pre-paid',  width: 110, type: 'numericColumn', valueFormatter: (p: any) => p.value > 0 ? formatINR(p.value) : '—' },
      { field: 'carry_fwd',   headerName: 'Carry-fwd', width: 110, type: 'numericColumn', valueFormatter: (p: any) => p.value > 0 ? formatINR(p.value) : '—',
        cellStyle: (p: any) => p.value > 0 ? { color: '#7c3aed', fontWeight: 600 } : null,
      },
      ...instCols,
      { field: 'collected',  headerName: 'Collected', width: 110, type: 'numericColumn',
        valueFormatter: (p: any) => formatINR(p.value),
        cellStyle: (p: any) => ({ color: p.value > 0 ? '#16a34a' : '#94a3b8', fontWeight: 600 }),
      },
      { field: 'remaining',  headerName: 'Remaining', width: 110, type: 'numericColumn',
        valueFormatter: (p: any) => p.value > 0 ? formatINR(p.value) : '✓ Done',
        cellStyle: (p: any) => ({ color: p.value > 0 ? '#d97706' : '#16a34a' }),
      },
    ]
  }, [installments])

  function handleExport() {
    const ws = XLSX.utils.json_to_sheet(rows.map(r => {
      const o: any = { Flat: r.flat_code, BHK: r.bhk_type, Target: r.target, 'Pre-paid': r.pre_payment }
      if (rows.some(x => x.carry_fwd > 0)) o['Carry-fwd'] = r.carry_fwd
      for (const inst of installments) o[inst.label] = r[`inst_${inst.installment_no}`]
      o.Collected = r.collected; o.Remaining = r.remaining
      return o
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Corpus Plan')
    XLSX.writeFile(wb, 'Corpus_Plan.xlsx')
  }

  if (!rows.length) return <p className="text-sm surface !p-6 text-center" style={{ color: 'var(--ink-400)' }}>No plan data available</p>

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button onClick={handleExport}
          className="flex items-center gap-1.5 text-[13px] font-medium" style={{ color: 'var(--brand-700)' }}>
          <Download size={14} /> Export
        </button>
      </div>
      <div className="overflow-hidden border hairline" style={{ borderRadius: 'var(--ds-radius)', height: 480 }}>
        <AgGridReact
          ref={gridRef}
          rowData={rows}
          columnDefs={colDefs}
          defaultColDef={{ sortable: true, resizable: true, filter: true, floatingFilter: true }}
        />
      </div>
    </div>
  )
}

// ── Flat detail panel ─────────────────────────────────────────

function FlatCorpusPanel({ flat, onClose }: { flat: CorpusEntry; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const { data: payments = [] } = useQuery({
    queryKey: ['flat-corpus-payments', flat.flat_code, flat.plan_id],
    queryFn: async () => {
      const { data } = await supabase.from('transactions')
        .select('*')
        .eq('flat_code', flat.flat_code)
        .gte('fiscal_year', flat.start_fiscal_year)
        .lte('fiscal_year', flat.end_fiscal_year)
        .eq('cr_dr', 'CR').eq('corpus', 'YES').neq('row_type', 'VOIDED')
        .order('value_date')
      return data ?? []
    },
  })

  const { data: settings } = useQuery({
    queryKey: ['app-settings'],
    queryFn: async () => {
      const { data } = await supabase.from('app_settings').select('*')
      return Object.fromEntries((data ?? []).map((s: any) => [s.key, s.value]))
    },
  })

  const { data: contacts } = useQuery({
    queryKey: ['flat-contacts', flat.flat_code],
    queryFn: () => fetchFlatContactsByCode(flat.flat_code),
  })

  function buildReminderText() {
    const asOf = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    const lines = [
      `*Lilac Apartments — Corpus reminder*`,
      `Flat ${flat.flat_code} · ${flat.plan_name} · As of ${asOf}`,
      ``,
      `Dear resident,`,
      ``,
      `Your corpus contribution balance: *${formatINR(flat.balance)}*.`,
      `  • Target: ${formatINR(flat.corpus_target + (flat.carry_forward_amount ?? 0))}`,
      `  • Collected so far: ${formatINR(flat.collected)}`,
    ]
    const upi  = settings?.collection_upi
    const bank = settings?.collection_bank
    if (upi || bank) {
      lines.push(``, `Payment details:`)
      if (upi)  lines.push(`  UPI: ${upi}`)
      if (bank) lines.push(`  Bank: ${bank}`)
    }
    lines.push(
      ``,
      `Kindly contribute at your earliest convenience.`,
      `— The Lilac Apartment Association, Rajakilpakkam`,
    )
    return lines.join('\n')
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(buildReminderText())
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
    <DialogContent className="max-w-[520px] lg:max-w-[900px] max-h-[85vh] rounded-2xl p-3 md:p-4">
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
      <div className="surface !p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{flat.flat_code}</h3>
        </div>
        <p className="text-xs" style={{ color: 'var(--ink-400)' }}>{flat.plan_name}</p>

        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span style={{ color: 'var(--ink-500)' }}>Target</span>
            <span className="font-medium">{formatINR(flat.corpus_target)}</span>
          </div>
          {flat.carry_forward_amount > 0 && (
            <div className="flex justify-between">
              <span style={{ color: 'var(--ink-500)' }}>Carry-forward</span>
              <span className="font-medium text-violet-600">+{formatINR(flat.carry_forward_amount)}</span>
            </div>
          )}
          {flat.pre_payment > 0 && (
            <div className="flex justify-between">
              <span style={{ color: 'var(--ink-500)' }}>Pre-payment</span>
              <span className="font-medium text-green-700">{formatINR(flat.pre_payment)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span style={{ color: 'var(--ink-500)' }}>Collected</span>
            <span className="font-medium text-green-700">{formatINR(flat.collected)}</span>
          </div>
          <div className="flex justify-between border-t hairline pt-1.5">
            <span style={{ color: 'var(--ink-500)' }}>Balance</span>
            <span className={`font-semibold ${flat.balance <= 0 ? 'text-green-600' : 'text-amber-600'}`}>
              {flat.balance <= 0 ? '✓ Done' : formatINR(flat.balance)}
            </span>
          </div>
        </div>

        <div className="ds-track">
          <div
            className="ds-track-fill"
            style={{
              width: `${Math.min(100, flat.pct_paid ?? 0)}%`,
              background: flat.status === 'Done' ? 'var(--ok)' : flat.status === 'Partial' ? 'var(--warn)' : 'var(--ink-300)',
            }}
          />
        </div>

        {flat.balance > 0 && (
          <div className="flex gap-2">
            <button
              onClick={handleCopy}
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-[10px] border font-medium text-[13px] transition-colors"
              style={{ borderColor: 'var(--ink-200)', background: '#fff', color: 'var(--ink-700)' }}
            >
              {copied
                ? <><Check size={14} /> Copied!</>
                : <><MessageCircle size={14} /> Copy</>}
            </button>
            <WhatsAppSendButtons contacts={contacts ?? []} text={buildReminderText()} />
          </div>
        )}
      </div>

      <div className="surface !p-4">
        <h4 className="font-medium text-sm mb-3 flex items-center gap-1.5">
          <TrendingDown size={14} style={{ color: 'var(--ink-400)' }} /> Payment history
        </h4>
        {!payments.length ? (
          <p className="text-sm" style={{ color: 'var(--ink-400)' }}>No payments yet</p>
        ) : (
          <div className="space-y-2">
            {payments.map((p: any) => (
              <div key={p.id} className="flex justify-between text-sm">
                <div>
                  <p className="font-medium">{p.fiscal_label}</p>
                  <p className="text-xs" style={{ color: 'var(--ink-400)' }}>{p.value_date}</p>
                </div>
                <p className="font-semibold text-green-700">{formatINR(p.amount)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
    </DialogContent>
    </Dialog>
  )
}

// ── Expenditure view ──────────────────────────────────────────

function ExpenditureView({ expenditures, plan }: { expenditures: any[]; plan: CorpusPlan | null }) {
  const totalSpent  = expenditures.reduce((s, e) => s + e.amount, 0)
  const budget: { category: string; budget: number }[] = plan?.planned_budget ?? []
  const totalBudget = budget.reduce((s, b) => s + b.budget, 0)

  // Budget vs actual by category. Budget lines are free text, so match
  // case-insensitively, falling back to prefix ("Civil" ↔ "Civil Work").
  const actualByCat = new Map<string, number>()
  for (const e of expenditures) {
    const name = e.category?.name ?? 'Uncategorised'
    actualByCat.set(name, (actualByCat.get(name) ?? 0) + e.amount)
  }
  function matchesBudget(budgetCat: string, actualCat: string) {
    const b = budgetCat.trim().toLowerCase()
    const a = actualCat.trim().toLowerCase()
    return b === a || a.startsWith(b) || b.startsWith(a)
  }
  const catRows: { category: string; budget: number | null; actual: number }[] = []
  const claimed = new Set<string>()
  for (const b of budget) {
    const actualCat = [...actualByCat.keys()].find(a => !claimed.has(a) && matchesBudget(b.category, a))
    if (actualCat) claimed.add(actualCat)
    catRows.push({
      category: actualCat && actualCat.toLowerCase() !== b.category.toLowerCase() ? `${actualCat} (${b.category})` : (actualCat ?? b.category),
      budget: b.budget,
      actual: actualCat ? actualByCat.get(actualCat)! : 0,
    })
  }
  for (const [name, amount] of actualByCat) {
    if (!claimed.has(name)) catRows.push({ category: name, budget: null, actual: amount })
  }
  catRows.sort((a, b) => b.actual - a.actual)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="surface !p-4 bg-slate-50">
          <p className="text-xs mb-1" style={{ color: 'var(--ink-500)' }}>Total budget</p>
          <p className="text-xl font-bold" style={{ color: 'var(--ink-800)' }}>{formatINR(totalBudget)}</p>
        </div>
        <div className="surface !p-4 bg-red-50">
          <p className="text-xs mb-1" style={{ color: 'var(--ink-500)' }}>Spent so far</p>
          <p className="text-xl font-bold text-red-600">{formatINR(totalSpent)}</p>
        </div>
        <div className="surface !p-4 bg-green-50">
          <p className="text-xs mb-1" style={{ color: 'var(--ink-500)' }}>Remaining budget</p>
          <p className="text-xl font-bold text-green-700">{formatINR(Math.max(0, totalBudget - totalSpent))}</p>
        </div>
      </div>

      {catRows.length > 0 && (
        <div className="surface !p-0">
          <div className="px-4 py-3 border-b hairline">
            <h3 className="font-semibold text-sm">By category — budget vs actual</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b hairline">
                  <th className="px-4 py-2 font-medium" style={{ color: 'var(--ink-500)' }}>Category</th>
                  <th className="px-4 py-2 font-medium text-right" style={{ color: 'var(--ink-500)' }}>Budget</th>
                  <th className="px-4 py-2 font-medium text-right" style={{ color: 'var(--ink-500)' }}>Actual</th>
                  <th className="px-4 py-2 font-medium text-right" style={{ color: 'var(--ink-500)' }}>Remaining</th>
                </tr>
              </thead>
              <tbody className="divide-rows">
                {catRows.map(r => {
                  const remaining = r.budget != null ? r.budget - r.actual : null
                  return (
                    <tr key={r.category}>
                      <td className="px-4 py-2.5" style={{ color: 'var(--ink-700)' }}>
                        {r.category}
                        {r.budget == null && (
                          <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">unbudgeted</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right" style={{ color: 'var(--ink-600)' }}>
                        {r.budget != null ? formatINR(r.budget) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-red-600">
                        {r.actual > 0 ? formatINR(r.actual) : '—'}
                      </td>
                      <td className={`px-4 py-2.5 text-right font-medium ${remaining == null ? '' : remaining < 0 ? 'text-red-600' : 'text-green-700'}`}>
                        {remaining == null ? '—' : remaining < 0 ? `${formatINR(-remaining)} over` : formatINR(remaining)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t hairline font-semibold">
                  <td className="px-4 py-2.5">Total</td>
                  <td className="px-4 py-2.5 text-right">{totalBudget > 0 ? formatINR(totalBudget) : '—'}</td>
                  <td className="px-4 py-2.5 text-right text-red-600">{formatINR(totalSpent)}</td>
                  <td className={`px-4 py-2.5 text-right ${totalBudget > 0 && totalBudget - totalSpent < 0 ? 'text-red-600' : 'text-green-700'}`}>
                    {totalBudget > 0 ? (totalBudget - totalSpent < 0 ? `${formatINR(totalSpent - totalBudget)} over` : formatINR(totalBudget - totalSpent)) : '—'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <div className="surface !p-0">
        <div className="px-4 py-3 border-b hairline">
          <h3 className="font-semibold text-sm">Actual expenditure transactions</h3>
        </div>
        {expenditures.length === 0 ? (
          <p className="px-4 py-6 text-sm text-center" style={{ color: 'var(--ink-400)' }}>No corpus expenditure recorded</p>
        ) : (
          <div className="divide-rows">
            {expenditures.map((e: any) => (
              <div key={e.id} className="flex justify-between items-start px-4 py-3 text-sm">
                <div>
                  <p className="font-medium" style={{ color: 'var(--ink-800)' }}>
                    {e.category?.name ?? '—'}
                    {e.voucher_no && <span className="ml-2 text-xs font-normal" style={{ color: 'var(--ink-400)' }}>{e.voucher_no}</span>}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--ink-400)' }}>
                    {e.expense_date} · {e.payee_name_raw ?? ''}{e.description ? ' · ' + e.description.slice(0, 50) : ''}
                  </p>
                </div>
                <p className="font-semibold text-red-600 shrink-0 ml-3">{formatINR(e.amount)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Collection Calendar ───────────────────────────────────────

interface CalendarColumn {
  key: string
  planId: string
  planName: string
  installmentNo: number
  label: string
  dueDate: string | null
  defaultAmount: number
}

function CollectionCalendar({
  activePlans,
  allCorpus,
  allInstallments,
  allFlatInstallments,
}: {
  activePlans: CorpusPlan[]
  allCorpus: CorpusEntry[]
  allInstallments: any[]
  allFlatInstallments: any[]
}) {
  const today = new Date().toISOString().slice(0, 10)

  const columns: CalendarColumn[] = allInstallments.map(inst => {
    const plan = activePlans.find(p => p.id === inst.plan_id)
    return {
      key: `${inst.plan_id}_inst_${inst.installment_no}`,
      planId: inst.plan_id,
      planName: plan?.name ?? inst.plan_id,
      installmentNo: inst.installment_no,
      label: inst.label,
      dueDate: inst.due_date ?? null,
      defaultAmount: inst.default_amount,
    }
  })

  const flatInstMap = new Map<string, Map<string, Map<number, number>>>()
  for (const fi of allFlatInstallments) {
    const code = fi.flat?.code ?? ''
    if (!flatInstMap.has(code)) flatInstMap.set(code, new Map())
    const planMap = flatInstMap.get(code)!
    if (!planMap.has(fi.plan_id)) planMap.set(fi.plan_id, new Map())
    planMap.get(fi.plan_id)!.set(fi.installment_no, fi.amount)
  }

  const flatCodes = Array.from(new Set(allCorpus.map(e => e.flat_code))).sort()

  const collectedMap = new Map<string, number>()
  for (const e of allCorpus) {
    collectedMap.set(`${e.flat_code}__${e.plan_id}`, e.collected)
  }

  function cellStatus(flatCode: string, col: CalendarColumn): 'paid' | 'partial' | 'overdue' | 'future' {
    const planInsts = allInstallments
      .filter(i => i.plan_id === col.planId)
      .sort((a: any, b: any) => a.installment_no - b.installment_no)
    const instIndex = planInsts.findIndex((i: any) => i.installment_no === col.installmentNo)
    const cumulativeTarget = planInsts.slice(0, instIndex + 1).reduce((sum: number, i: any) => {
      const amt = flatInstMap.get(flatCode)?.get(col.planId)?.get(i.installment_no) ?? i.default_amount
      return sum + amt
    }, 0)
    const collected = collectedMap.get(`${flatCode}__${col.planId}`) ?? 0
    if (collected >= cumulativeTarget) return 'paid'
    if (collected > 0 && col.dueDate && col.dueDate < today) return 'partial'
    if (col.dueDate && col.dueDate < today) return 'overdue'
    return 'future'
  }

  const CELL_STYLE: Record<string, string> = {
    paid:    'bg-green-100 text-green-700',
    partial: 'bg-amber-100 text-amber-700',
    overdue: 'bg-red-100 text-red-600',
    future:  'bg-slate-100 text-slate-400',
  }
  const CELL_LABEL: Record<string, string> = {
    paid: '✓', partial: '~', overdue: '!', future: '—',
  }

  if (activePlans.length === 0) {
    return <p className="surface !p-6 text-sm text-center" style={{ color: 'var(--ink-400)' }}>No active plans to display.</p>
  }
  if (columns.length === 0) {
    return <p className="surface !p-6 text-sm text-center" style={{ color: 'var(--ink-400)' }}>No installments defined on active plans.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4 flex-wrap text-xs">
        <span className="font-medium text-slate-500">Legend:</span>
        {(['paid', 'partial', 'overdue', 'future'] as const).map(s => (
          <span key={s} className={`px-2 py-0.5 rounded-full font-medium ${CELL_STYLE[s]}`}>
            {s === 'paid' ? 'Paid' : s === 'partial' ? 'Partial' : s === 'overdue' ? 'Overdue' : 'Not due'}
          </span>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white px-3 py-2 text-left font-semibold text-slate-600 border-b hairline w-24">Flat</th>
              {activePlans.map(plan => {
                const planCols = columns.filter(c => c.planId === plan.id)
                if (planCols.length === 0) return null
                return (
                  <th key={plan.id} colSpan={planCols.length} className="px-2 py-2 text-center font-semibold border-b hairline border-l hairline" style={{ color: 'var(--brand-700)', background: 'var(--brand-50)' }}>
                    {plan.name}
                  </th>
                )
              })}
            </tr>
            <tr>
              <th className="sticky left-0 bg-white px-3 py-1.5 border-b hairline" />
              {columns.map(col => (
                <th key={col.key} className="px-2 py-1.5 text-center font-medium text-slate-500 border-b hairline border-l hairline whitespace-nowrap">
                  <div>{col.label}</div>
                  {col.dueDate && <div className="text-[10px] font-normal text-slate-400">{col.dueDate}</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {flatCodes.map(flatCode => (
              <tr key={flatCode} className="hover:bg-slate-50">
                <td className="sticky left-0 bg-white px-3 py-1.5 font-medium text-slate-700 border-b hairline w-24">{flatCode}</td>
                {columns.map(col => {
                  const status = cellStatus(flatCode, col)
                  return (
                    <td key={col.key} className={`px-2 py-1.5 text-center border-b hairline border-l hairline font-semibold ${CELL_STYLE[status]}`} title={`${flatCode} · ${col.planName} · ${col.label} · ${status}`}>
                      {CELL_LABEL[status]}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px]" style={{ color: 'var(--ink-400)' }}>
        Paid/Partial status based on cumulative collection vs cumulative installment targets.
      </p>
    </div>
  )
}

// ── Plan history ──────────────────────────────────────────────

function PlanHistory({ plans }: { plans: CorpusPlan[] }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="surface !p-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-[var(--ink-50)] rounded-xl" style={{ color: 'var(--ink-600)' }}
      >
        <span>Closed plans ({plans.length})</span>
        <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="divide-rows border-t hairline">
          {plans.map(p => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[p.status]}`}>{p.status}</span>
              <span className="font-medium flex-1">{p.name}</span>
              <span className="text-[11px]" style={{ color: 'var(--ink-400)' }}>
                FY {p.start_fiscal_year}-{String((p.start_fiscal_year ?? 0) + 1).slice(-2)} – {p.end_fiscal_year}-{String((p.end_fiscal_year ?? 0) + 1).slice(-2)}
              </span>
              {p.closed_at && <span className="text-[11px]" style={{ color: 'var(--ink-400)' }}>Closed {p.closed_at.slice(0, 10)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Create Plan Wizard ────────────────────────────────────────

interface InstallmentRow {
  id: string
  label: string
  dueDate: string
  amount: number
}

interface FlatAmountRow {
  flatId: string
  code: string
  bhkType: string
  targetAmount: number
  prePayment: number
  carryForward: number
}

const FY_RANGE = [2024, 2025, 2026, 2027, 2028, 2029, 2030]

function fyLabel(y: number) { return `FY ${y}-${String(y + 1).slice(-2)}` }

function CreatePlanWizard({ open, onClose, onSuccess }: {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}) {
  const [step, setStep] = useState(1)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [startFY, setStartFY] = useState<number>(2025)
  const [endFY, setEndFY] = useState<number>(2026)
  const [installments, setInstallments] = useState<InstallmentRow[]>([
    { id: crypto.randomUUID(), label: '', dueDate: '', amount: 0 },
  ])
  const [flatAmounts, setFlatAmounts] = useState<FlatAmountRow[]>([])
  const [applyCarryForward, setApplyCarryForward] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: flats = [] } = useQuery({
    queryKey: ['flats-for-corpus-wizard'],
    queryFn: async () => {
      const { data } = await supabase
        .from('flats')
        .select('id, code, block, bhk_type, maintenance_amt')
        .order('code')
      return (data ?? []) as Pick<Flat, 'id' | 'code' | 'block' | 'bhk_type' | 'maintenance_amt'>[]
    },
  })

  // Unpaid balances saved as corpus arrears when earlier plans were closed
  const { data: corpusArrears = [] } = useQuery({
    queryKey: ['corpus-arrears-for-wizard'],
    queryFn: async () => {
      const { data } = await supabase
        .from('flat_arrears')
        .select('id, flat_id, amount, source_label')
        .eq('arrears_type', 'corpus')
      return (data ?? []) as { id: string; flat_id: string; amount: number; source_label: string }[]
    },
    enabled: open,
  })
  const carryByFlat = new Map<string, number>()
  for (const a of corpusArrears) carryByFlat.set(a.flat_id, (carryByFlat.get(a.flat_id) ?? 0) + a.amount)
  const carryTotal = corpusArrears.reduce((s, a) => s + a.amount, 0)
  const carrySources = [...new Set(corpusArrears.map(a => a.source_label))].join(', ')

  const instTotal = installments.reduce((s, i) => s + (i.amount || 0), 0)

  function goToStep3() {
    const defaultRows: FlatAmountRow[] = flats.map(f => ({
      flatId: f.id,
      code: f.code,
      bhkType: f.bhk_type ?? '',
      targetAmount: instTotal,
      prePayment: 0,
      carryForward: carryByFlat.get(f.id) ?? 0,
    }))
    setFlatAmounts(defaultRows)
    setStep(3)
  }

  function addInstallment() {
    setInstallments(prev => [...prev, { id: crypto.randomUUID(), label: '', dueDate: '', amount: 0 }])
  }

  function removeInstallment(id: string) {
    setInstallments(prev => prev.filter(i => i.id !== id))
  }

  function updateInstallment(id: string, field: keyof InstallmentRow, value: string | number) {
    setInstallments(prev => prev.map(i => i.id === id ? { ...i, [field]: value } : i))
  }

  function updateFlatAmount(flatId: string, field: 'targetAmount' | 'prePayment', value: number) {
    setFlatAmounts(prev => prev.map(f => f.flatId === flatId ? { ...f, [field]: value } : f))
  }

  async function submit(status: 'draft' | 'active') {
    setSaving(true)
    setError(null)
    try {
      const carryApplied = applyCarryForward ? flatAmounts.reduce((s, f) => s + (f.carryForward || 0), 0) : 0
      const totalTarget = flatAmounts.reduce((s, f) => s + (f.targetAmount || 0), 0) + carryApplied
      const totalPrePayments = flatAmounts.reduce((s, f) => s + (f.prePayment || 0), 0)

      const { data: plan, error: planErr } = await supabase
        .from('corpus_plans')
        .insert({
          name,
          description: description || null,
          start_fiscal_year: startFY,
          end_fiscal_year: endFY,
          total_target: totalTarget,
          pre_payments: totalPrePayments,
          planned_budget: [],
          status,
        })
        .select()
        .single()

      if (planErr || !plan) throw new Error(planErr?.message ?? 'Failed to create plan')

      const { error: instErr } = await supabase
        .from('corpus_plan_installments')
        .insert(
          installments.map((inst, i) => ({
            plan_id: plan.id,
            installment_no: i + 1,
            label: inst.label,
            due_date: inst.dueDate || null,
            default_amount: inst.amount,
          }))
        )
      if (instErr) throw new Error(instErr.message)

      const { error: flatsErr } = await supabase
        .from('corpus_plan_flats')
        .insert(
          flatAmounts.map(fa => ({
            plan_id: plan.id,
            flat_id: fa.flatId,
            target_amount: fa.targetAmount,
            pre_payment: fa.prePayment,
            carry_forward_amount: applyCarryForward ? fa.carryForward : 0,
          }))
        )
      if (flatsErr) throw new Error(flatsErr.message)

      if (applyCarryForward && corpusArrears.length > 0) {
        // The debt now lives on the new plan's carry_forward_amount — remove
        // the arrears rows so it isn't tracked twice
        const { error: arrErr } = await supabase
          .from('flat_arrears')
          .delete()
          .in('id', corpusArrears.map(a => a.id))
        if (arrErr) toast.error(`Plan created, but clearing old corpus arrears failed: ${arrErr.message}`)
      }

      toast.success(`Plan "${name}" ${status === 'active' ? 'created and activated' : 'saved as draft'}`)
      onSuccess()
      onClose()
    } catch (e: any) {
      setError(e.message ?? 'Unexpected error')
      toast.error(e.message ?? 'Failed to create plan')
    } finally {
      setSaving(false)
    }
  }

  const step1Valid = name.trim().length > 0 && endFY >= startFY
  const step2Valid = installments.length > 0 && installments.every(i => i.label.trim().length > 0)

  const totalFlatTarget    = flatAmounts.reduce((s, f) => s + (f.targetAmount || 0), 0)
  const totalFlatPrePayment = flatAmounts.reduce((s, f) => s + (f.prePayment || 0), 0)

  const STEPS = ['Plan details', 'Installments', 'Per-flat amounts', 'Review']

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New corpus plan</DialogTitle>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center gap-0 mb-2">
          {STEPS.map((label, idx) => {
            const n = idx + 1
            const active = n === step
            const done   = n < step
            return (
              <div key={n} className="flex items-center flex-1 min-w-0">
                <div className="flex flex-col items-center gap-1 shrink-0">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{
                      background: active ? 'var(--brand-600)' : done ? 'var(--brand-200)' : 'var(--ink-100)',
                      color: active ? '#fff' : done ? 'var(--brand-700)' : 'var(--ink-400)',
                    }}
                  >{done ? '✓' : n}</div>
                  <span className="text-[10px] whitespace-nowrap" style={{ color: active ? 'var(--brand-600)' : 'var(--ink-400)' }}>{label}</span>
                </div>
                {idx < STEPS.length - 1 && (
                  <div className="flex-1 h-px mx-1 mt-[-12px]" style={{ background: done ? 'var(--brand-300)' : 'var(--ink-200)' }} />
                )}
              </div>
            )
          })}
        </div>

        {/* Step 1 */}
        {step === 1 && (
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input placeholder="e.g. Corpus 2025: Painting & Civil" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Description <span className="text-[11px]" style={{ color: 'var(--ink-400)' }}>(optional)</span></Label>
              <textarea
                rows={3}
                className="w-full rounded-lg border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--brand-400)]"
                style={{ borderColor: 'var(--ink-200)' }}
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Start FY *</Label>
                <Select value={String(startFY)} onValueChange={v => setStartFY(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FY_RANGE.map(y => <SelectItem key={y} value={String(y)}>{fyLabel(y)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>End FY *</Label>
                <Select value={String(endFY)} onValueChange={v => setEndFY(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FY_RANGE.filter(y => y >= startFY).map(y => <SelectItem key={y} value={String(y)}>{fyLabel(y)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}

        {/* Step 2 */}
        {step === 2 && (
          <div className="space-y-3 mt-2">
            <div className="overflow-auto max-h-72">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b hairline text-left">
                    <th className="pb-2 pr-2 font-medium" style={{ color: 'var(--ink-500)' }}>Label *</th>
                    <th className="pb-2 pr-2 font-medium" style={{ color: 'var(--ink-500)' }}>Due date</th>
                    <th className="pb-2 pr-2 font-medium" style={{ color: 'var(--ink-500)' }}>Amount (₹) *</th>
                    <th className="pb-2 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {installments.map(inst => (
                    <tr key={inst.id} className="border-b hairline">
                      <td className="py-2 pr-2">
                        <Input
                          placeholder="e.g. Phase 1"
                          value={inst.label}
                          onChange={e => updateInstallment(inst.id, 'label', e.target.value)}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <Input
                          type="date"
                          value={inst.dueDate}
                          onChange={e => updateInstallment(inst.id, 'dueDate', e.target.value)}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <Input
                          type="number"
                          min={0}
                          value={inst.amount || ''}
                          onChange={e => updateInstallment(inst.id, 'amount', Number(e.target.value))}
                        />
                      </td>
                      <td className="py-2">
                        <button
                          onClick={() => removeInstallment(inst.id)}
                          disabled={installments.length === 1}
                          className="p-1 rounded hover:bg-red-50 disabled:opacity-30"
                        >
                          <Trash2 size={13} className="text-red-500" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button onClick={addInstallment} className="flex items-center gap-1 text-sm font-medium" style={{ color: 'var(--brand-600)' }}>
              <Plus size={14} /> Add installment
            </button>
            <div className="flex justify-between text-sm pt-1 border-t hairline">
              <span style={{ color: 'var(--ink-500)' }}>Running total</span>
              <span className="font-semibold">{formatINR(instTotal)}</span>
            </div>
          </div>
        )}

        {/* Step 3 */}
        {step === 3 && (
          <div className="space-y-3 mt-2">
            {carryTotal > 0 && (
              <label className="flex items-start gap-2 text-sm cursor-pointer rounded-lg px-3 py-2 bg-violet-50 border border-violet-200">
                <input
                  type="checkbox"
                  checked={applyCarryForward}
                  onChange={e => setApplyCarryForward(e.target.checked)}
                  className="w-4 h-4 rounded mt-0.5"
                />
                <span className="text-violet-800">
                  Carry forward <strong>{formatINR(carryTotal)}</strong> of unpaid balances from {carrySources} ({carryByFlat.size} flat{carryByFlat.size !== 1 ? 's' : ''}).
                  Adds to each flat's target here and clears the old arrears records.
                </span>
              </label>
            )}
            <div className="overflow-auto max-h-80">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b hairline text-left sticky top-0 bg-white">
                    <th className="pb-2 pr-3 font-medium" style={{ color: 'var(--ink-500)' }}>Flat</th>
                    <th className="pb-2 pr-3 font-medium" style={{ color: 'var(--ink-500)' }}>BHK</th>
                    <th className="pb-2 pr-3 font-medium" style={{ color: 'var(--ink-500)' }}>Target (₹)</th>
                    <th className="pb-2 pr-3 font-medium" style={{ color: 'var(--ink-500)' }}>Pre-payment (₹)</th>
                    {applyCarryForward && carryTotal > 0 && (
                      <th className="pb-2 font-medium" style={{ color: 'var(--ink-500)' }}>Carry-fwd (₹)</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {flatAmounts.map(fa => (
                    <tr key={fa.flatId} className="border-b hairline">
                      <td className="py-1.5 pr-3 font-medium">{fa.code}</td>
                      <td className="py-1.5 pr-3" style={{ color: 'var(--ink-500)' }}>{fa.bhkType || '—'}</td>
                      <td className="py-1.5 pr-3">
                        <Input
                          type="number"
                          min={0}
                          value={fa.targetAmount || ''}
                          onChange={e => updateFlatAmount(fa.flatId, 'targetAmount', Number(e.target.value))}
                          className="h-8 text-sm"
                        />
                      </td>
                      <td className="py-1.5 pr-3">
                        <Input
                          type="number"
                          min={0}
                          value={fa.prePayment || ''}
                          onChange={e => updateFlatAmount(fa.flatId, 'prePayment', Number(e.target.value))}
                          className="h-8 text-sm"
                        />
                      </td>
                      {applyCarryForward && carryTotal > 0 && (
                        <td className="py-1.5 font-medium text-violet-600">
                          {fa.carryForward > 0 ? `+${formatINR(fa.carryForward)}` : '—'}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between text-sm border-t hairline pt-2">
              <span style={{ color: 'var(--ink-500)' }}>Total target</span>
              <span className="font-semibold">{formatINR(totalFlatTarget)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--ink-500)' }}>Total pre-payments</span>
              <span className="font-semibold text-green-700">{formatINR(totalFlatPrePayment)}</span>
            </div>
            {applyCarryForward && carryTotal > 0 && (
              <div className="flex justify-between text-sm">
                <span style={{ color: 'var(--ink-500)' }}>Total carry-forward</span>
                <span className="font-semibold text-violet-600">+{formatINR(carryTotal)}</span>
              </div>
            )}
          </div>
        )}

        {/* Step 4 */}
        {step === 4 && (
          <div className="space-y-4 mt-2">
            <div className="surface !p-4 space-y-3 text-sm">
              <div className="flex justify-between">
                <span style={{ color: 'var(--ink-500)' }}>Plan name</span>
                <span className="font-semibold">{name}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--ink-500)' }}>Fiscal years</span>
                <span className="font-medium">{fyLabel(startFY)} – {fyLabel(endFY)}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--ink-500)' }}>Installments</span>
                <span className="font-medium">{installments.length} × {formatINR(instTotal)} default</span>
              </div>
              <div className="flex justify-between border-t hairline pt-3">
                <span style={{ color: 'var(--ink-500)' }}>Total target (all flats)</span>
                <span className="font-bold">{formatINR(totalFlatTarget)}</span>
              </div>
              {totalFlatPrePayment > 0 && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--ink-500)' }}>Total pre-payments</span>
                  <span className="font-semibold text-green-700">{formatINR(totalFlatPrePayment)}</span>
                </div>
              )}
              {applyCarryForward && carryTotal > 0 && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--ink-500)' }}>Carry-forward from closed plans</span>
                  <span className="font-semibold text-violet-600">+{formatINR(carryTotal)}</span>
                </div>
              )}
            </div>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
            )}
          </div>
        )}

        <DialogFooter className="mt-4 gap-2 sm:gap-2">
          {step > 1 && (
            <Button variant="outline" onClick={() => setStep(s => s - 1)} disabled={saving}>Back</Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          {step < 3 && (
            <Button
              disabled={(step === 1 && !step1Valid) || (step === 2 && !step2Valid)}
              onClick={() => {
                if (step === 2) goToStep3()
                else setStep(s => s + 1)
              }}
              style={{ background: 'var(--brand-600)', color: '#fff' }}
            >
              Next
            </Button>
          )}
          {step === 3 && (
            <Button onClick={() => setStep(4)} style={{ background: 'var(--brand-600)', color: '#fff' }}>
              Next
            </Button>
          )}
          {step === 4 && (
            <>
              <Button variant="outline" onClick={() => submit('draft')} disabled={saving}>
                Save as Draft
              </Button>
              <Button onClick={() => submit('active')} disabled={saving} style={{ background: 'var(--brand-600)', color: '#fff' }}>
                {saving ? 'Creating…' : 'Create & Activate'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Activate Plan Dialog ──────────────────────────────────────

function ActivatePlanDialog({ open, plan, onClose, onSuccess }: {
  open: boolean
  plan: CorpusPlan
  onClose: () => void
  onSuccess: () => void
}) {
  const [checking, setChecking]       = useState(false)
  const [overlapping, setOverlapping] = useState<{ id: string; name: string; start_fiscal_year: number; end_fiscal_year: number }[]>([])
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading]         = useState(false)

  useEffect(() => {
    if (!open) return
    setOverlapping([])
    setShowConfirm(false)
    setChecking(true)
    supabase
      .rpc('get_overlapping_active_plans', {
        p_start: plan.start_fiscal_year ?? 0,
        p_end:   plan.end_fiscal_year   ?? 9999,
      })
      .then(({ data, error }) => {
        if (error) toast.error('Overlap check failed: ' + error.message)
        setOverlapping((data ?? []) as { id: string; name: string; start_fiscal_year: number; end_fiscal_year: number }[])
        setChecking(false)
        setShowConfirm(true)
      })
  }, [open, plan.id])

  async function doActivate() {
    setLoading(true)
    const { error } = await supabase
      .from('corpus_plans')
      .update({ status: 'active' })
      .eq('id', plan.id)
    setLoading(false)
    if (error) { toast.error(error.message); return }
    toast.success('Plan activated')
    onSuccess()
    onClose()
  }

  const hasOverlap = overlapping.length > 0

  return (
    <AlertDialog open={open} onOpenChange={v => !v && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Activate Corpus Plan?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              {checking ? (
                <span className="block text-sm">Checking for plan conflicts…</span>
              ) : hasOverlap ? (
                <>
                  <span className="block mb-2 text-amber-700 font-medium">
                    ⚠ {overlapping.length} active plan{overlapping.length > 1 ? 's' : ''} overlap{overlapping.length === 1 ? 's' : ''} this plan&apos;s FY range:
                  </span>
                  <div className="flex flex-col gap-1 mb-2">
                    {overlapping.map(p => (
                      <span key={p.id} className="text-sm text-slate-700">
                        • {p.name} (FY {p.start_fiscal_year}-{String(p.start_fiscal_year + 1).slice(-2)} – FY {p.end_fiscal_year}-{String(p.end_fiscal_year + 1).slice(-2)})
                      </span>
                    ))}
                  </div>
                  <span className="block text-sm text-slate-600">
                    Untagged corpus payments may be split across plans by fiscal year range. Proceed anyway?
                  </span>
                </>
              ) : (
                <span>This will make the plan live and allow collection tracking. No active plan conflicts found.</span>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose} disabled={loading}>Cancel</AlertDialogCancel>
          {showConfirm && (
            <AlertDialogAction
              onClick={doActivate}
              disabled={loading || checking}
              className={hasOverlap ? 'bg-amber-600 hover:bg-amber-700' : ''}
            >
              {loading ? 'Activating…' : hasOverlap ? 'Activate anyway' : 'Activate'}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ── Close Plan Dialog ─────────────────────────────────────────

function ClosePlanDialog({ open, planId, onClose, onSuccess }: {
  open: boolean
  planId: string
  onClose: () => void
  onSuccess: () => void
}) {
  const [preview, setPreview] = useState<{ flat_code: string; balance: number }[]>([])
  const [previewing, setPreviewing] = useState(false)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (!open || !planId) {
      setPreview([])
      return
    }
    setPreviewing(true)
    supabase
      .from('v_corpus_tracker')
      .select('flat_code, balance')
      .eq('plan_id', planId)
      .gt('balance', 0)
      .order('flat_code')
      .then(({ data, error }) => {
        if (error) toast.error('Failed to load outstanding balances')
        setPreview(data ?? [])
        setPreviewing(false)
      })
  }, [open, planId])

  async function confirm() {
    setClosing(true)
    const { error } = await supabase.rpc('close_corpus_plan', { p_plan_id: planId })
    setClosing(false)
    if (error) { toast.error(error.message); return }
    toast.success('Plan closed and arrears recorded')
    onSuccess()
    onClose()
  }

  return (
    <AlertDialog open={open} onOpenChange={v => !v && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Close corpus plan?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              {previewing ? (
                <span className="block text-sm">Loading outstanding balances…</span>
              ) : preview.length > 0 ? (
                <>
                  <span className="block mb-2">
                    {preview.length} flat(s) have outstanding balances that will be saved as corpus arrears
                    (you can roll them into the next plan as carry-forward when creating it):
                  </span>
                  <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                    {preview.map(r => (
                      <span key={r.flat_code} className="flex justify-between text-[12px]">
                        <span>{r.flat_code}</span>
                        <span style={{ color: 'var(--bad)' }}>{formatINR(r.balance)}</span>
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <span>All flats have met their corpus target. No arrears will be created.</span>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose} disabled={closing}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={confirm} disabled={closing || previewing}>
            {closing ? 'Closing…' : 'Close Plan'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
