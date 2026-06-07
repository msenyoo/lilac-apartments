import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef } from 'ag-grid-community'
import { Download, X, TrendingDown, ChevronDown, Layers, Plus, Trash2 } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase, CorpusEntry, CorpusPlan, Flat } from '@/lib/supabase'
import { formatINR } from '@/lib/tagger'
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

export default function CorpusPage() {
  const { isAdmin } = useRoleCtx()
  const qc = useQueryClient()
  const [selectedPlanId, setSelectedPlanId] = useState<string>('__all__')
  const [tab, setTab] = useState<'collection' | 'plan' | 'expenditure'>('collection')
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
    queryKey: ['corpus-expenditure', selectedPlanId],
    queryFn: async () => {
      let q = supabase.from('transactions').select('*')
        .eq('cr_dr', 'DR').eq('corpus', 'YES').neq('row_type', 'VOIDED')
        .order('value_date', { ascending: false })
      return (await q).data ?? []
    },
  })

  // Aggregates — per-plan when one selected, or consolidated
  const totalTarget    = corpus.reduce((s, c) => s + c.effective_target, 0)
  const totalCollected = corpus.reduce((s, c) => s + c.collected, 0)
  const totalSpent     = expenditures.reduce((s: number, e: any) => s + e.amount, 0)
  const pct = totalTarget > 0 ? Math.round(totalCollected * 100 / totalTarget) : 0

  const planLabel = selectedPlan
    ? `${selectedPlan.name} · FY ${selectedPlan.start_fiscal_year}-${String((selectedPlan.start_fiscal_year ?? 0) + 1).slice(-2)} – FY ${selectedPlan.end_fiscal_year}-${String((selectedPlan.end_fiscal_year ?? 0) + 1).slice(-2)}`
    : `All active plans (${activePlans.length})`

  return (
    <div className="flex flex-col gap-5 fade-in">
      {/* Header + plan selector */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[24px] font-extrabold">Corpus fund</h1>
          <p className="text-[13.5px] mt-1" style={{ color: 'var(--ink-500)' }}>{planLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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


      {/* Consolidated view banner when showing all */}
      {selectedPlanId === '__all__' && activePlans.length > 1 && (
        <ConsolidatedBanner plans={activePlans} allCorpus={allCorpus} />
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="Target"       value={formatINR(totalTarget)}                      color="text-slate-800" bg="bg-white" />
        <SummaryCard label="Collected"    value={formatINR(totalCollected)}                   color="text-green-700" bg="bg-green-50" />
        <SummaryCard label="Balance"      value={formatINR(Math.max(0, totalTarget - totalCollected))} color="text-amber-600" bg="bg-amber-50" />
        <SummaryCard label="Spent so far" value={formatINR(totalSpent)}                       color="text-red-600"   bg="bg-red-50" />
      </div>

      {/* Progress bar */}
      <div className="surface !p-4">
        <div className="flex justify-between text-sm mb-2">
          <span style={{ color: 'var(--ink-500)' }}>Collection progress</span>
          <span className="font-semibold">{pct}%</span>
        </div>
        <div className="ds-track">
          <div className="ds-track-fill" style={{ width: `${Math.min(pct, 100)}%`, background: 'var(--brand-500)' }} />
        </div>
        <div className="flex justify-between mt-1.5 text-xs" style={{ color: 'var(--ink-400)' }}>
          <span>{formatINR(totalCollected)} collected</span>
          <span>{formatINR(totalTarget)} target</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl p-1 flex-wrap" style={{ background: 'var(--ink-100)' }}>
        {([
          { key: 'collection',  label: 'By Flat' },
          { key: 'plan',        label: 'Installment Plan', disabled: selectedPlanId === '__all__' },
          { key: 'expenditure', label: 'Expenditure' },
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
      {tab === 'expenditure' && <ExpenditureView expenditures={expenditures} plan={selectedPlan} />}

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
      {showActivate && selectedPlanId !== '__all__' && (
        <ActivatePlanDialog
          open={showActivate}
          planId={selectedPlanId}
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
    return { plan: p, target, collected, balance: Math.max(0, target - collected) }
  })

  return (
    <div className="surface !p-4" style={{ background: 'var(--brand-50)' }}>
      <p className="text-xs font-semibold text-violet-700 uppercase tracking-wide mb-3">Consolidated corpus pool</p>
      <div className="divide-rows">
        {planSummaries.map(({ plan, target, collected, balance }) => (
          <div key={plan.id} className="flex items-center gap-3 py-2 text-sm">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[plan.status]}`}>{plan.status}</span>
            <span className="font-medium flex-1" style={{ color: 'var(--ink-800)' }}>{plan.name}</span>
            <span style={{ color: 'var(--ink-500)' }}>{formatINR(collected)} / {formatINR(target)}</span>
            <span className={`font-semibold ${balance > 0 ? 'text-amber-600' : 'text-green-600'}`}>{balance > 0 ? formatINR(balance) : '✓'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Summary card ──────────────────────────────────────────────

function SummaryCard({ label, value, color, bg }: { label: string; value: string; color: string; bg: string }) {
  return (
    <div className={`surface !p-4 ${bg}`}>
      <p className="text-xs mb-1" style={{ color: 'var(--ink-500)' }}>{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
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

  const instColDefs: ColDef<any>[] = installments.map(inst => ({
    field: `inst_${inst.installment_no}`,
    headerName: inst.label,
    width: 110,
    type: 'numericColumn',
    valueFormatter: (p: any) => p.value > 0 ? formatINR(p.value) : '—',
  }))

  const colDefs = useMemo((): ColDef<any>[] => [
    { field: 'flat_code',   headerName: 'Flat',      width: 90 },
    { field: 'target',      headerName: 'Target',    width: 110, type: 'numericColumn', valueFormatter: (p: any) => formatINR(p.value) },
    { field: 'pre_payment', headerName: 'Pre-paid',  width: 110, type: 'numericColumn', valueFormatter: (p: any) => p.value > 0 ? formatINR(p.value) : '—' },
    { field: 'carry_fwd',   headerName: 'Carry-fwd', width: 110, type: 'numericColumn', valueFormatter: (p: any) => p.value > 0 ? formatINR(p.value) : '—',
      cellStyle: (p: any) => p.value > 0 ? { color: '#7c3aed', fontWeight: 600 } : null,
    },
    ...instColDefs,
    { field: 'collected',  headerName: 'Collected', width: 110, type: 'numericColumn',
      valueFormatter: (p: any) => formatINR(p.value),
      cellStyle: (p: any) => ({ color: p.value > 0 ? '#16a34a' : '#94a3b8', fontWeight: 600 }),
    },
    { field: 'remaining',  headerName: 'Remaining', width: 110, type: 'numericColumn',
      valueFormatter: (p: any) => p.value > 0 ? formatINR(p.value) : '✓ Done',
      cellStyle: (p: any) => ({ color: p.value > 0 ? '#d97706' : '#16a34a' }),
    },
  ], [instColDefs])

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

  return (
    <div className="w-full lg:w-72 shrink-0 space-y-3">
      <div className="surface !p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{flat.flat_code}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--ink-100)]"><X size={15} /></button>
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
  )
}

// ── Expenditure view ──────────────────────────────────────────

function ExpenditureView({ expenditures, plan }: { expenditures: any[]; plan: CorpusPlan | null }) {
  const totalSpent  = expenditures.reduce((s, e) => s + e.amount, 0)
  const budget: { category: string; budget: number }[] = plan?.planned_budget ?? []
  const totalBudget = budget.reduce((s, b) => s + b.budget, 0)

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

      {budget.length > 0 && (
        <div className="surface !p-0">
          <div className="px-4 py-3 border-b hairline">
            <h3 className="font-semibold text-sm">Budget breakdown</h3>
          </div>
          <div className="divide-rows">
            {budget.map(b => (
              <div key={b.category} className="flex justify-between px-4 py-3 text-sm">
                <span style={{ color: 'var(--ink-600)' }}>{b.category}</span>
                <span className="font-semibold">{formatINR(b.budget)}</span>
              </div>
            ))}
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
                  <p className="font-medium" style={{ color: 'var(--ink-800)' }}>{e.category}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--ink-400)' }}>{e.value_date} · {e.description?.slice(0, 60)}</p>
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

  const instTotal = installments.reduce((s, i) => s + (i.amount || 0), 0)

  function goToStep3() {
    const defaultRows: FlatAmountRow[] = flats.map(f => ({
      flatId: f.id,
      code: f.code,
      bhkType: f.bhk_type ?? '',
      targetAmount: instTotal,
      prePayment: 0,
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
      const totalTarget = flatAmounts.reduce((s, f) => s + (f.targetAmount || 0), 0)
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
            carry_forward_amount: 0,
          }))
        )
      if (flatsErr) throw new Error(flatsErr.message)

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
            <div className="overflow-auto max-h-80">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b hairline text-left sticky top-0 bg-white">
                    <th className="pb-2 pr-3 font-medium" style={{ color: 'var(--ink-500)' }}>Flat</th>
                    <th className="pb-2 pr-3 font-medium" style={{ color: 'var(--ink-500)' }}>BHK</th>
                    <th className="pb-2 pr-3 font-medium" style={{ color: 'var(--ink-500)' }}>Target (₹)</th>
                    <th className="pb-2 font-medium" style={{ color: 'var(--ink-500)' }}>Pre-payment (₹)</th>
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
                      <td className="py-1.5">
                        <Input
                          type="number"
                          min={0}
                          value={fa.prePayment || ''}
                          onChange={e => updateFlatAmount(fa.flatId, 'prePayment', Number(e.target.value))}
                          className="h-8 text-sm"
                        />
                      </td>
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

function ActivatePlanDialog({ open, planId, onClose, onSuccess }: {
  open: boolean
  planId: string
  onClose: () => void
  onSuccess: () => void
}) {
  const [loading, setLoading] = useState(false)

  async function confirm() {
    setLoading(true)
    const { error } = await supabase.from('corpus_plans').update({ status: 'active' }).eq('id', planId)
    setLoading(false)
    if (error) { toast.error(error.message); return }
    toast.success('Plan activated')
    onSuccess()
    onClose()
  }

  return (
    <AlertDialog open={open} onOpenChange={v => !v && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Activate Corpus Plan?</AlertDialogTitle>
          <AlertDialogDescription>
            This will make the plan live and allow collection tracking.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={confirm} disabled={loading}>
            {loading ? 'Activating…' : 'Activate'}
          </AlertDialogAction>
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
      .then(({ data }) => {
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
                    {preview.length} flat(s) have outstanding balances that will be saved as corpus arrears:
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
