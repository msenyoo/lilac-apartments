import { useState, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef } from 'ag-grid-community'
import { Download, X, TrendingDown } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase, CorpusEntry, CorpusPlan } from '@/lib/supabase'
import { formatINR } from '@/lib/tagger'


export default function CorpusPage() {
  const [tab, setTab] = useState<'collection' | 'plan' | 'expenditure'>('collection')

  const { data: plans } = useQuery({
    queryKey: ['corpus-plans'],
    queryFn: async () => {
      const { data } = await supabase.from('corpus_plans').select('*').order('created_at', { ascending: false })
      return (data ?? []) as CorpusPlan[]
    },
  })

  const activePlan = plans?.[0] ?? null

  const { data: corpus, isLoading } = useQuery({
    queryKey: ['corpus'],
    queryFn: async () => {
      const { data } = await supabase.from('v_corpus_tracker').select('*').order('flat_code')
      return (data ?? []) as CorpusEntry[]
    },
  })

  const { data: planFlats } = useQuery({
    queryKey: ['corpus-plan-flats', activePlan?.id],
    queryFn: async () => {
      if (!activePlan) return []
      const { data } = await supabase.from('corpus_plan_flats')
        .select('*, flat:flat_id(code,block,bhk_type)')
        .eq('plan_id', activePlan.id)
        .order('flat_id')
      return data ?? []
    },
    enabled: !!activePlan,
  })

  const { data: expenditures } = useQuery({
    queryKey: ['corpus-expenditure'],
    queryFn: async () => {
      const { data } = await supabase.from('transactions')
        .select('*')
        .eq('cr_dr', 'DR')
        .eq('corpus', 'YES')
        .neq('row_type', 'VOIDED')
        .order('value_date', { ascending: false })
      return data ?? []
    },
  })

  const totalCollected = corpus?.reduce((s, c) => s + c.collected, 0) ?? 0
  const totalTarget    = corpus?.reduce((s, c) => s + c.corpus_target, 0) ?? activePlan?.total_target ?? 0
  const pct = totalTarget > 0 ? Math.round(totalCollected * 100 / totalTarget) : 0
  const totalSpent = expenditures?.reduce((s, e: any) => s + e.amount, 0) ?? 0

  // Derive plan period label from first corpus entry (all share same plan)
  const firstEntry = corpus?.[0]
  const planPeriod = firstEntry
    ? `FY ${firstEntry.start_fiscal_year}-${String(firstEntry.start_fiscal_year + 1).slice(-2)} – FY ${firstEntry.end_fiscal_year}-${String(firstEntry.end_fiscal_year + 1).slice(-2)}`
    : null

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold">Corpus fund</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {firstEntry?.plan_name ?? activePlan?.name ?? '—'}
            {planPeriod ? ` · ${planPeriod}` : ''}
            {activePlan?.description ? ` · ${activePlan.description}` : ''}
          </p>
        </div>
      </div>

      {/* Top-level summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="Target"        value={formatINR(totalTarget)}    color="text-slate-800" bg="bg-white" />
        <SummaryCard label="Collected"     value={formatINR(totalCollected)} color="text-green-700" bg="bg-green-50" />
        <SummaryCard label="Balance"       value={formatINR(Math.max(0, totalTarget - totalCollected))} color="text-amber-600" bg="bg-amber-50" />
        <SummaryCard label="Spent so far"  value={formatINR(totalSpent)}     color="text-red-600" bg="bg-red-50" />
      </div>

      {/* Progress bar */}
      <div className="card p-4">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-slate-500">Collection progress</span>
          <span className="font-semibold">{pct}%</span>
        </div>
        <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-brand-600 rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <div className="flex justify-between mt-1.5 text-xs text-slate-400">
          <span>{formatINR(totalCollected)} collected</span>
          <span>{formatINR(totalTarget)} target</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {([
          { key: 'collection', label: 'By Flat' },
          { key: 'plan',       label: 'Installment Plan' },
          { key: 'expenditure',label: 'Expenditure' },
        ] as { key: typeof tab; label: string }[]).map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === key ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'collection'  && <CollectionGrid corpus={corpus ?? []} isLoading={isLoading} />}
      {tab === 'plan'        && <PlanGrid planFlats={planFlats ?? []} corpus={corpus ?? []} />}
      {tab === 'expenditure' && <ExpenditureView expenditures={expenditures ?? []} plan={activePlan} />}
    </div>
  )
}

function SummaryCard({ label, value, color, bg }: { label: string; value: string; color: string; bg: string }) {
  return (
    <div className={`card p-4 ${bg}`}>
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  )
}

function CollectionGrid({ corpus, isLoading }: { corpus: CorpusEntry[]; isLoading: boolean }) {
  const gridRef = useRef<AgGridReact>(null)
  const [selectedFlat, setSelectedFlat] = useState<CorpusEntry | null>(null)

  const colDefs = useMemo((): ColDef<any>[] => [
    { field: 'flat_code',         headerName: 'Flat',     width: 90 },
    { field: 'corpus_target',     headerName: 'Target',   width: 120, type: 'numericColumn',
      valueFormatter: (p: any) => formatINR(p.value),
    },
    { field: 'collected',         headerName: 'Collected', width: 120, type: 'numericColumn',
      valueFormatter: (p: any) => formatINR(p.value),
    },
    { field: 'balance',           headerName: 'Balance',  width: 120, type: 'numericColumn',
      valueFormatter: (p: any) => formatINR(Math.max(0, p.value)),
      cellStyle: (p: any) => p.value > 0 ? { color: '#d97706', fontWeight: 600 } : { color: '#16a34a', fontWeight: 400 },
    },
    { field: 'pct_paid',          headerName: '% Paid',   width: 100, type: 'numericColumn',
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
  ], [])

  function handleExport() {
    const rows: any[] = []
    gridRef.current?.api?.forEachNodeAfterFilterAndSort(node => { if (node.data) rows.push(node.data) })
    const exportRows = (rows.length > 0 ? rows : corpus).map(r => ({
      Flat: r.flat_code, Target: r.corpus_target, Collected: r.collected,
      Balance: Math.max(0, r.balance), '% Paid': r.pct_paid?.toFixed(1),
      Status: r.status, 'Last Payment': r.last_payment_date,
    }))
    const ws = XLSX.utils.json_to_sheet(exportRows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Corpus Collection')
    XLSX.writeFile(wb, 'Corpus_Collection.xlsx')
  }

  if (isLoading) return <div className="card h-64 animate-pulse bg-slate-100" />

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button onClick={handleExport} disabled={!corpus.length}
          className="flex items-center gap-1.5 text-sm text-brand-700 hover:text-brand-900 disabled:opacity-40">
          <Download size={14} /> Export
        </button>
      </div>
      <div className="flex gap-4">
        <div className="flex-1 min-w-0">
          <div className="rounded-xl overflow-hidden border border-slate-200" style={{ height: 480 }}>
            <AgGridReact
              ref={gridRef}
              rowData={corpus}
              columnDefs={colDefs}
              defaultColDef={{ sortable: true, resizable: true, filter: true, floatingFilter: true }}
              rowSelection={{ mode: 'singleRow' }}
              onRowClicked={e => setSelectedFlat(e.data)}
              getRowStyle={(p: any) => p.data?.flat_code === selectedFlat?.flat_code ? { background: '#eff6ff' } : undefined}
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

function PlanGrid({ planFlats, corpus }: { planFlats: any[]; corpus: CorpusEntry[] }) {
  const gridRef = useRef<AgGridReact>(null)
  const corpusMap = new Map(corpus.map(c => [c.flat_code, c]))

  const rows = planFlats.map((pf: any) => {
    const c = corpusMap.get(pf.flat?.code ?? '')
    const collected = c?.collected ?? 0
    return {
      flat_code:    pf.flat?.code ?? '',
      bhk_type:     pf.flat?.bhk_type ?? '',
      target:       pf.target_amount,
      pre_payment:  pf.pre_payment,
      inst_1:       pf.installment_1,
      inst_2:       pf.installment_2,
      inst_3:       pf.installment_3,
      collected,
      remaining:    Math.max(0, pf.target_amount - collected),
    }
  })

  const colDefs = useMemo((): ColDef<any>[] => [
    { field: 'flat_code',   headerName: 'Flat',       width: 90 },
    { field: 'target',      headerName: 'Target',     width: 110, type: 'numericColumn', valueFormatter: (p: any) => formatINR(p.value) },
    { field: 'pre_payment', headerName: 'Pre-paid',   width: 110, type: 'numericColumn', valueFormatter: (p: any) => p.value > 0 ? formatINR(p.value) : '—' },
    { field: 'inst_1',      headerName: 'Inst 1',     width: 100, type: 'numericColumn', valueFormatter: (p: any) => formatINR(p.value) },
    { field: 'inst_2',      headerName: 'Inst 2',     width: 100, type: 'numericColumn', valueFormatter: (p: any) => formatINR(p.value) },
    { field: 'inst_3',      headerName: 'Inst 3',     width: 100, type: 'numericColumn', valueFormatter: (p: any) => formatINR(p.value) },
    { field: 'collected',   headerName: 'Collected',  width: 110, type: 'numericColumn',
      valueFormatter: (p: any) => formatINR(p.value),
      cellStyle: (p: any) => ({ color: p.value > 0 ? '#16a34a' : '#94a3b8', fontWeight: 600 }),
    },
    { field: 'remaining',   headerName: 'Remaining',  width: 110, type: 'numericColumn',
      valueFormatter: (p: any) => p.value > 0 ? formatINR(p.value) : '✓ Done',
      cellStyle: (p: any) => ({ color: p.value > 0 ? '#d97706' : '#16a34a' }),
    },
  ], [])

  function handleExport() {
    const exportRows = (rows).map(r => ({
      Flat: r.flat_code, BHK: r.bhk_type, Target: r.target,
      'Pre-paid': r.pre_payment, 'Inst 1': r.inst_1, 'Inst 2': r.inst_2, 'Inst 3': r.inst_3,
      Collected: r.collected, Remaining: r.remaining,
    }))
    const ws = XLSX.utils.json_to_sheet(exportRows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Corpus Plan')
    XLSX.writeFile(wb, 'Corpus_Plan.xlsx')
  }

  if (!rows.length) return <p className="text-sm text-slate-400 card p-6 text-center">No plan data available</p>

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button onClick={handleExport}
          className="flex items-center gap-1.5 text-sm text-brand-700 hover:text-brand-900">
          <Download size={14} /> Export
        </button>
      </div>
      <div className="rounded-xl overflow-hidden border border-slate-200" style={{ height: 480 }}>
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

function FlatCorpusPanel({ flat, onClose }: { flat: CorpusEntry; onClose: () => void }) {
  const { data: payments } = useQuery({
    queryKey: ['flat-corpus-payments', flat.flat_code, flat.start_fiscal_year, flat.end_fiscal_year],
    queryFn: async () => {
      const { data } = await supabase.from('transactions')
        .select('*')
        .eq('flat_code', flat.flat_code)
        .gte('fiscal_year', flat.start_fiscal_year)
        .lte('fiscal_year', flat.end_fiscal_year)
        .eq('cr_dr', 'CR')
        .eq('corpus', 'YES')
        .neq('row_type', 'VOIDED')
        .order('value_date')
      return data ?? []
    },
  })

  return (
    <div className="w-72 shrink-0 space-y-3">
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{flat.flat_code}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X size={15} /></button>
        </div>

        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Target</span>
            <span className="font-medium">{formatINR(flat.corpus_target)}</span>
          </div>
          {flat.pre_payment > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-500">Pre-payment</span>
              <span className="font-medium text-green-700">{formatINR(flat.pre_payment)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-slate-500">Collected</span>
            <span className="font-medium text-green-700">{formatINR(flat.collected)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-100 pt-1.5">
            <span className="text-slate-500">Balance</span>
            <span className={`font-semibold ${flat.balance <= 0 ? 'text-green-600' : 'text-amber-600'}`}>
              {flat.balance <= 0 ? '✓ Done' : formatINR(flat.balance)}
            </span>
          </div>
        </div>

        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${flat.status === 'Done' ? 'bg-green-500' : flat.status === 'Partial' ? 'bg-amber-400' : 'bg-slate-300'}`}
            style={{ width: `${Math.min(100, flat.pct_paid ?? 0)}%` }}
          />
        </div>
      </div>

      <div className="card p-4">
        <h4 className="font-medium text-sm mb-3 flex items-center gap-1.5">
          <TrendingDown size={14} className="text-slate-400" /> Payment history
        </h4>
        {!payments?.length ? (
          <p className="text-sm text-slate-400">No payments yet</p>
        ) : (
          <div className="space-y-2">
            {payments.map((p: any) => (
              <div key={p.id} className="flex justify-between text-sm">
                <div>
                  <p className="font-medium">{p.fiscal_label}</p>
                  <p className="text-xs text-slate-400">{p.value_date}</p>
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

function ExpenditureView({ expenditures, plan }: { expenditures: any[]; plan: CorpusPlan | null }) {
  const totalSpent = expenditures.reduce((s, e) => s + e.amount, 0)
  const budget: { category: string; budget: number }[] = plan?.planned_budget ?? []
  const totalBudget = budget.reduce((s, b) => s + b.budget, 0)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="card p-4 bg-slate-50">
          <p className="text-xs text-slate-500 mb-1">Total budget</p>
          <p className="text-xl font-bold text-slate-800">{formatINR(totalBudget)}</p>
        </div>
        <div className="card p-4 bg-red-50">
          <p className="text-xs text-slate-500 mb-1">Spent so far</p>
          <p className="text-xl font-bold text-red-600">{formatINR(totalSpent)}</p>
        </div>
        <div className="card p-4 bg-green-50">
          <p className="text-xs text-slate-500 mb-1">Remaining budget</p>
          <p className="text-xl font-bold text-green-700">{formatINR(Math.max(0, totalBudget - totalSpent))}</p>
        </div>
      </div>

      {budget.length > 0 && (
        <div className="card">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="font-semibold text-sm">Budget breakdown</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {budget.map(b => (
              <div key={b.category} className="flex justify-between px-4 py-3 text-sm">
                <span className="text-slate-600">{b.category}</span>
                <span className="font-semibold">{formatINR(b.budget)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="font-semibold text-sm">Actual expenditure transactions</h3>
        </div>
        {expenditures.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-400 text-center">No corpus expenditure recorded</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {expenditures.map((e: any) => (
              <div key={e.id} className="flex justify-between items-start px-4 py-3 text-sm">
                <div>
                  <p className="font-medium text-slate-800">{e.category}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{e.value_date} · {e.description.slice(0, 60)}</p>
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
