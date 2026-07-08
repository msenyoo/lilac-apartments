import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef } from 'ag-grid-community'
import { X, Edit2, Ruler, UserMinus, UserPlus } from 'lucide-react'
import { supabase, Flat, Resident } from '@/lib/supabase'
import { formatINR } from '@/lib/tagger'
import { useRoleCtx } from '@/contexts/RoleContext'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { toast } from 'sonner'


type Tab = 'flats' | 'residents'

const RELATIONS = ['Self', 'Co-owner', 'Spouse', 'Parent', 'Child', 'Guardian', 'Other'] as const

export default function FlatsPage() {
  const [tab, setTab] = useState<Tab>('flats')

  return (
    <div className="flex flex-col gap-5 fade-in">
      <div>
        <h1 className="text-[24px] font-extrabold">Flats &amp; Residents</h1>
        <p className="text-[13.5px] mt-1" style={{ color: 'var(--ink-500)' }}>Manage flat details, maintenance rates, owners and tenants</p>
      </div>


      <div className="flex gap-1 rounded-xl p-1 w-fit" style={{ background: 'var(--ink-100)' }}>
        {([{ key: 'flats', label: 'Flats' }, { key: 'residents', label: 'Residents' }] as { key: Tab; label: string }[]).map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === key ? 'bg-white shadow-sm' : ''}`}
            style={{ color: tab === key ? 'var(--ink-900)' : 'var(--ink-500)' }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'flats'     && <FlatsTab />}
      {tab === 'residents' && <ResidentsTab />}
    </div>
  )
}

// ── FLATS TAB ─────────────────────────────────────────────────
function FlatsTab() {
  const { isAdmin } = useRoleCtx()
  const qc = useQueryClient()
  const [selected, setSelected] = useState<Flat | null>(null)
  const [editRate, setEditRate] = useState(false)
  const [editArea, setEditArea] = useState(false)

  const { data: flats, isLoading } = useQuery({
    queryKey: ['flats-full'],
    queryFn: async () => {
      const { data } = await supabase.from('flats').select('*').order('code')
      return (data ?? []) as Flat[]
    },
  })

  const { data: rateHistory } = useQuery({
    queryKey: ['rate-history', selected?.id],
    queryFn: async () => {
      if (!selected) return []
      const { data } = await supabase.from('maintenance_rate_history')
        .select('*').eq('flat_id', selected.id).order('effective_from', { ascending: false })
      return data ?? []
    },
    enabled: !!selected,
  })

  const colDefs = useMemo((): ColDef<any>[] => [
    { field: 'code',                headerName: 'Flat',         width: 90 },
    { field: 'block',               headerName: 'Block',        width: 80, filter: true },
    { field: 'floor',               headerName: 'Floor',        width: 100, filter: true,
      valueFormatter: (p: any) => p.value ?? '—',
    },
    { field: 'flat_type',           headerName: 'Unit Type',    width: 120, filter: true },
    { field: 'bhk_type',            headerName: 'BHK',          width: 120, filter: true },
    { field: 'has_private_terrace', headerName: 'P.T.',         width: 70,
      cellRenderer: (p: any) => p.value ? <span className="text-purple-600 font-bold text-xs">YES</span> : null,
    },
    { field: 'maintenance_amt',     headerName: 'Rate/mo',      width: 110, type: 'numericColumn',
      valueFormatter: (p: any) => formatINR(p.value),
    },
    { field: 'corpus_target',       headerName: 'Corpus Target', width: 130, type: 'numericColumn',
      valueFormatter: (p: any) => formatINR(p.value),
    },
    { field: 'saleable_area',       headerName: 'Area',         width: 110,
      cellRenderer: (p: any) => p.value
        ? <span>{p.value} sq.ft</span>
        : <span className="text-xs" style={{ color: 'var(--ink-400)' }}>Pending</span>,
    },
  ], [])

  return (
    <div className="flex flex-col gap-4">
      {isLoading ? (
        <div className="surface h-64 animate-pulse" style={{ background: 'var(--ink-100)' }} />
      ) : (
        <div className="overflow-hidden border hairline" style={{ borderRadius: 'var(--ds-radius)', height: 480 }}>
          <AgGridReact
            rowData={flats ?? []}
            columnDefs={colDefs}
            defaultColDef={{ sortable: true, resizable: true, filter: true, floatingFilter: true }}
            rowSelection={{ mode: 'singleRow' }}
            getRowStyle={(p: any) => p.data?.id === selected?.id ? { background: 'var(--brand-50)' } : undefined}
            onRowClicked={e => setSelected(e.data ?? null)}
          />
        </div>
      )}

      {selected && (
        <Dialog open onOpenChange={v => { if (!v) setSelected(null) }}>
          <DialogContent className="max-w-[520px] lg:max-w-[900px] max-h-[85vh] rounded-2xl p-3 md:p-4">
            <DialogHeader className="px-1">
              <DialogTitle>{selected.code}</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start px-1 pb-1">
              <div className="flex flex-col gap-3">
                <div className="surface !p-4 flex flex-col gap-3">
                  <div className="space-y-1.5 text-sm">
                    <Detail label="Block"       value={selected.block} />
                    <Detail label="Floor"       value={selected.floor ?? '—'} />
                    <Detail label="Unit type"   value={selected.flat_type} />
                    <Detail label="BHK"         value={selected.bhk_type ?? '—'} />
                    <Detail label="Private terrace" value={selected.has_private_terrace ? 'Yes' : 'No'} />
                    <Detail label="Current rate" value={formatINR(selected.maintenance_amt) + '/mo'} />
                    <Detail label="Corpus target" value={formatINR(selected.corpus_target)} />
                  </div>
                  {isAdmin && (
                    <button onClick={() => setEditRate(true)}
                      className="w-full btn-secondary text-sm flex items-center justify-center gap-1.5">
                      <Edit2 size={13} /> Change maintenance rate
                    </button>
                  )}
                </div>

                {/* Area details */}
                <div className="surface !p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-sm">Area details</h4>
                    {!selected.carpet_area && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">Pending</span>
                    )}
                  </div>
                  <div className="space-y-1.5 text-sm">
                    <Detail label="Carpet area"   value={fmtArea(selected.carpet_area)} />
                    <Detail label="Plinth area"   value={fmtArea(selected.plinth_area)} />
                    <Detail label="Common area"   value={fmtArea(selected.common_area)} />
                    <Detail label="Saleable area" value={fmtArea(selected.saleable_area)} />
                    <Detail label="P.O.T. area"   value={fmtArea(selected.pot_area)} />
                    <Detail label="U.D.S total"   value={fmtArea(selected.uds_total)} />
                  </div>
                  {isAdmin && (
                    <button onClick={() => setEditArea(true)}
                      className="w-full btn-secondary text-sm flex items-center justify-center gap-1.5">
                      <Ruler size={13} /> {selected.carpet_area ? 'Edit area details' : 'Add area details'}
                    </button>
                  )}
                </div>

                {/* Rate history */}
                {rateHistory && rateHistory.length > 0 && (
                  <div className="surface !p-4">
                    <h4 className="font-medium text-sm mb-3">Rate history</h4>
                    <div className="space-y-2">
                      {rateHistory.map((r: any) => (
                        <div key={r.id} className="flex justify-between text-sm">
                          <div>
                            <p className="font-medium">{formatINR(r.monthly_rate)}/mo</p>
                            <p className="text-[11px]" style={{ color: 'var(--ink-400)' }}>{r.effective_from}{r.effective_to ? ` → ${r.effective_to}` : ' → now'}</p>
                          </div>
                          {r.notes && <p className="text-[11px] max-w-[120px] text-right" style={{ color: 'var(--ink-400)' }}>{r.notes}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <PeopleCard flatId={selected.id} />
            </div>
          </DialogContent>
        </Dialog>
      )}

      {isAdmin && editRate && selected && (
        <RateChangeModal flat={selected} onClose={() => setEditRate(false)} onSaved={() => { setEditRate(false); qc.invalidateQueries() }} />
      )}

      {isAdmin && editArea && selected && (
        <AreaDetailsModal flat={selected} onClose={() => setEditArea(false)}
          onSaved={updated => { setEditArea(false); setSelected(updated); qc.invalidateQueries({ queryKey: ['flats-full'] }) }} />
      )}
    </div>
  )
}

function fmtArea(v: number | null) {
  return v != null ? `${v} sq.ft` : '—'
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span style={{ color: 'var(--ink-500)' }}>{label}</span>
      <span className="font-medium" style={{ color: 'var(--ink-800)' }}>{value}</span>
    </div>
  )
}

function PeopleCard({ flatId }: { flatId: string }) {
  const { isAdmin, role } = useRoleCtx()
  const canSeePhone = isAdmin || role === 'committee'
  const [showPast, setShowPast] = useState(false)

  const { data: people } = useQuery({
    queryKey: ['flat-residents', flatId],
    queryFn: async () => {
      const { data } = await supabase.from('residents').select('*').eq('flat_id', flatId)
      return (data ?? []) as Resident[]
    },
  })

  const byRelation = (a: Resident, b: Resident) =>
    (a.relation === 'Self' ? 0 : 1) - (b.relation === 'Self' ? 0 : 1) || a.name.localeCompare(b.name)
  const active  = (people ?? []).filter(p => p.is_active)
  const past    = (people ?? []).filter(p => !p.is_active)
  const owners  = active.filter(p => p.type === 'Owner').sort(byRelation)
  const tenants = active.filter(p => p.type === 'Tenant').sort(byRelation)

  return (
    <div className="surface !p-4 flex flex-col gap-3">
      <h4 className="font-medium text-sm">People</h4>
      {owners.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold tracking-wide" style={{ color: 'var(--ink-400)' }}>OWNER</p>
          {owners.map(p => <PersonRow key={p.id} p={p} canSeePhone={canSeePhone} />)}
        </div>
      )}
      {tenants.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold tracking-wide" style={{ color: 'var(--ink-400)' }}>TENANT</p>
          {tenants.map(p => <PersonRow key={p.id} p={p} canSeePhone={canSeePhone} />)}
        </div>
      )}
      {active.length === 0 && (
        <p className="text-[13px]" style={{ color: 'var(--ink-400)' }}>No residents on file</p>
      )}
      {past.length > 0 && (
        <div>
          <button onClick={() => setShowPast(v => !v)}
            className="text-[12px] font-medium" style={{ color: 'var(--ink-500)' }}>
            {showPast ? '▾' : '▸'} Past residents ({past.length})
          </button>
          {showPast && (
            <div className="space-y-1.5 mt-2">
              {past.map(p => (
                <div key={p.id} className="flex justify-between text-[13px]">
                  <span style={{ color: 'var(--ink-500)' }}>{p.name}</span>
                  <span style={{ color: 'var(--ink-400)' }}>{p.moved_in ?? '—'} → {p.moved_out ?? '—'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PersonRow({ p, canSeePhone }: { p: Resident; canSeePhone: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm gap-2">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="font-medium truncate">{p.name}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
          style={{ background: 'var(--ink-100)', color: 'var(--ink-500)' }}>{p.relation}</span>
      </div>
      {canSeePhone && p.phone && (
        <a href={`tel:${p.phone}`} className="text-[12px] font-medium shrink-0" style={{ color: 'var(--ink-700)' }}>{p.phone}</a>
      )}
    </div>
  )
}

function RateChangeModal({ flat, onClose, onSaved }: { flat: Flat; onClose: () => void; onSaved: () => void }) {
  const [rate, setRate]       = useState(String(flat.maintenance_amt))
  const [from, setFrom]       = useState('')
  const [notes, setNotes]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  async function handleSave() {
    const r = parseInt(rate); if (!r || !from) { setError('Rate and effective date are required'); return }
    setSaving(true); setError('')
    try {
      await supabase.from('maintenance_rate_history')
        .update({ effective_to: from })
        .eq('flat_id', flat.id)
        .is('effective_to', null)
      await supabase.from('maintenance_rate_history').insert({
        flat_id: flat.id, monthly_rate: r, effective_from: from, notes: notes || null,
      })
      await supabase.from('flats').update({ maintenance_amt: r }).eq('id', flat.id)
      toast.success(`Rate updated for ${flat.code}`)
      onSaved()
    } catch (e: any) {
      setError(e.message ?? 'Failed to save')
      toast.error(e.message ?? 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Change rate — {flat.code}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="ds-lbl">New monthly rate (₹)</label>
            <input type="number" value={rate} onChange={e => setRate(e.target.value)}
              className="ds-field w-full" />
          </div>
          <div>
            <label className="ds-lbl">Effective from</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="ds-field w-full" />
          </div>
          <div>
            <label className="ds-lbl">Notes (optional)</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Annual revision FY2027-28"
              className="ds-field w-full" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">{saving ? 'Saving…' : 'Save'}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AreaDetailsModal({ flat, onClose, onSaved }: { flat: Flat; onClose: () => void; onSaved: (updated: Flat) => void }) {
  const [carpetArea, setCarpetArea]   = useState(flat.carpet_area?.toString() ?? '')
  const [plinthArea, setPlinthArea]   = useState(flat.plinth_area?.toString() ?? '')
  const [commonArea, setCommonArea]   = useState(flat.common_area?.toString() ?? '')
  const [saleableArea, setSaleableArea] = useState(flat.saleable_area?.toString() ?? '')
  const [potArea, setPotArea]         = useState(flat.pot_area?.toString() ?? '')
  const [udsTotal, setUdsTotal]       = useState(flat.uds_total?.toString() ?? '')
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')

  async function handleSave() {
    setSaving(true); setError('')
    const toNum = (s: string) => s.trim() === '' ? null : Number(s)
    const payload = {
      carpet_area: toNum(carpetArea),
      plinth_area: toNum(plinthArea),
      common_area: toNum(commonArea),
      saleable_area: toNum(saleableArea),
      pot_area: toNum(potArea),
      uds_total: toNum(udsTotal),
    }
    const { error: err } = await supabase.from('flats').update(payload).eq('id', flat.id)
    setSaving(false)
    if (err) { setError(err.message); toast.error(err.message); return }
    toast.success(`Area details saved for ${flat.code}`)
    onSaved({ ...flat, ...payload })
  }

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Area details — {flat.code}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex justify-between text-sm">
            <span style={{ color: 'var(--ink-500)' }}>Floor</span>
            <span className="font-medium">{flat.floor ?? '—'}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Carpet area (sq.ft)"   value={carpetArea}   onChange={setCarpetArea}   type="number" />
            <Field label="Plinth area (sq.ft)"   value={plinthArea}   onChange={setPlinthArea}   type="number" />
            <Field label="Common area (sq.ft)"   value={commonArea}   onChange={setCommonArea}   type="number" />
            <Field label="Saleable area (sq.ft)" value={saleableArea} onChange={setSaleableArea} type="number" />
            <Field label="P.O.T. area (sq.ft)"   value={potArea}      onChange={setPotArea}      type="number" />
            <Field label="U.D.S total (sq.ft)"   value={udsTotal}     onChange={setUdsTotal}     type="number" />
          </div>
          <p className="text-[11px]" style={{ color: 'var(--ink-400)' }}>Values will typically come from the sale deed / builder's area statement, shared by each owner.</p>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">{saving ? 'Saving…' : 'Save'}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── RESIDENTS TAB ─────────────────────────────────────────────
function ResidentsTab() {
  const { isAdmin, role } = useRoleCtx()
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [moveOut, setMoveOut] = useState<(Resident & { flat: { code: string; block: string } | null }) | null>(null)

  const { data: residents, isLoading } = useQuery({
    queryKey: ['residents'],
    queryFn: async () => {
      const { data } = await supabase
        .from('residents')
        .select('*, flat:flat_id(code,block)')
        .order('is_active', { ascending: false })
      return (data ?? []) as (Resident & { flat: { code: string; block: string } | null })[]
    },
  })

  const { data: flats } = useQuery({
    queryKey: ['flats'],
    queryFn: async () => {
      const { data } = await supabase.from('flats').select('id,code').order('code')
      return data ?? []
    },
  })

  const colDefs = useMemo((): ColDef<any>[] => [
    { field: 'flat.code',   headerName: 'Flat',     width: 90,
      valueGetter: (p: any) => p.data?.flat?.code ?? '',
      filter: 'agTextColumnFilter',
    },
    { field: 'name',        headerName: 'Name',     flex: 1, minWidth: 150 },
    { field: 'type',        headerName: 'Type',     width: 100, filter: true,
      cellRenderer: (p: any) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${p.value === 'Owner' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
          {p.value}
        </span>
      ),
    },
    { field: 'relation', headerName: 'Relation', width: 110, filter: true,
      cellRenderer: (p: any) => (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">{p.value}</span>
      ),
    },
    // Phone: admin + committee only (needed for dues communication)
    ...(isAdmin || role === 'committee' ? [{ field: 'phone', headerName: 'Phone', width: 130 } as ColDef<any>] : []),
    // UPI IDs: admin only — payment method is sensitive financial data
    ...(isAdmin ? [{ field: 'upi_ids', headerName: 'UPI IDs', flex: 1, minWidth: 180,
      valueFormatter: (p: any) => (p.value ?? []).join(', '),
    } as ColDef<any>] : []),
    { field: 'moved_in',    headerName: 'Moved In', width: 110 },
    { field: 'moved_out',   headerName: 'Moved Out', width: 110 },
    { field: 'is_active',   headerName: 'Active',   width: 90, filter: true,
      cellRenderer: (p: any) => p.value
        ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Active</span>
        : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">Inactive</span>,
    },
    ...(isAdmin ? [{
      headerName: 'Actions', width: 100, sortable: false, filter: false,
      cellRenderer: (p: any) => (
        <button
          onClick={() => p.data.is_active ? setMoveOut(p.data) : handleReactivate(p.data)}
          className="text-xs text-slate-400 hover:text-red-500 flex items-center gap-1"
        >
          <UserMinus size={13} /> {p.data.is_active ? 'Move out' : 'Reactivate'}
        </button>
      ),
    } as ColDef<any>] : []),
  ], [isAdmin])

  async function handleReactivate(resident: Resident) {
    const { error } = await supabase.from('residents')
      .update({ is_active: true, moved_out: null }).eq('id', resident.id)
    if (error) { toast.error(error.message); return }
    qc.invalidateQueries({ queryKey: ['residents'] })
    toast.success(`${resident.name} reactivated`)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm" style={{ color: 'var(--ink-500)' }}>
          {residents?.filter(r => r.is_active).length ?? 0} active residents
          <span className="mx-1" style={{ color: 'var(--ink-300)' }}>·</span>
          UPI IDs stored here auto-match payments on upload
        </p>
        {isAdmin && (
          <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-1.5 text-sm">
            <UserPlus size={15} /> Add resident
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="h-64 animate-pulse rounded-[var(--ds-radius)]" style={{ background: 'var(--ink-100)' }} />
      ) : (
        <div className="overflow-hidden border hairline" style={{ borderRadius: 'var(--ds-radius)', height: 520 }}>
          <AgGridReact
            rowData={residents ?? []}
            columnDefs={colDefs}
            defaultColDef={{ sortable: true, resizable: true, filter: true, floatingFilter: true }}
            pagination={true}
            paginationPageSize={25}
          />
        </div>
      )}

      {isAdmin && showAdd && (
        <ResidentModal
          flats={flats ?? []}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); qc.invalidateQueries({ queryKey: ['residents'] }) }}
        />
      )}

      {moveOut && (
        <MoveOutDialog
          resident={moveOut}
          household={(residents ?? []).filter(r =>
            r.flat_id === moveOut.flat_id && r.is_active && r.type === moveOut.type &&
            r.id !== moveOut.id && moveOut.relation === 'Self')}
          onClose={() => setMoveOut(null)}
          onSaved={() => {
            setMoveOut(null)
            qc.invalidateQueries({ queryKey: ['residents'] })
            qc.invalidateQueries({ queryKey: ['flat-residents'] })
          }}
        />
      )}
    </div>
  )
}

function ResidentModal({ flats, resident, onClose, onSaved }: {
  flats: { id: string; code: string }[]
  resident?: Resident
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!resident
  const [flatId, setFlatId]   = useState(resident?.flat_id ?? '')
  const [name, setName]       = useState(resident?.name ?? '')
  const [type, setType]       = useState<'Owner' | 'Tenant'>(resident?.type ?? 'Owner')
  const [relation, setRelation] = useState<string>(resident?.relation ?? 'Self')
  const [phone, setPhone]     = useState(resident?.phone ?? '')
  const [email, setEmail]     = useState(resident?.email ?? '')
  const [upiRaw, setUpiRaw]   = useState(resident?.upi_ids?.join(', ') ?? '')
  const [movedIn, setMovedIn] = useState(resident?.moved_in ?? '')
  const [notes, setNotes]     = useState(resident?.notes ?? '')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  async function handleSave() {
    if (!flatId || !name) { setError('Flat and name are required'); return }
    setSaving(true); setError('')
    const upi_ids = upiRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    const payload = {
      flat_id: flatId, name, type, relation, phone: phone || null, email: email || null,
      upi_ids, moved_in: movedIn || null, notes: notes || null,
    }
    const { error: err } = isEdit
      ? await supabase.from('residents').update(payload).eq('id', resident!.id)
      : await supabase.from('residents').insert({ ...payload, is_active: true })
    setSaving(false)
    if (err) { setError(err.message); toast.error(err.message); return }
    toast.success(isEdit ? `${name} updated` : `${name} added as resident`)
    onSaved()
  }

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit resident' : 'Add resident'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="ds-lbl">Flat *</label>
              <select value={flatId} onChange={e => setFlatId(e.target.value)} className="ds-field w-full">
                <option value="">— Select —</option>
                {flats.map(f => <option key={f.id} value={f.id}>{f.code}</option>)}
              </select>
            </div>
            <div>
              <label className="ds-lbl">Type</label>
              <select id="restype" value={type} onChange={e => {
                const t = e.target.value as 'Owner' | 'Tenant'
                setType(t)
                if (t === 'Tenant' && relation === 'Co-owner') setRelation('Self')
              }} className="ds-field w-full">
                <option value="Owner">Owner</option>
                <option value="Tenant">Tenant</option>
              </select>
            </div>
          </div>
          <div>
            <label className="ds-lbl">Relation</label>
            <select id="relation" value={relation} onChange={e => setRelation(e.target.value)} className="ds-field w-full">
              {RELATIONS.filter(r => type === 'Owner' || r !== 'Co-owner').map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <p className="text-[11px] mt-1" style={{ color: 'var(--ink-400)' }}>Who this person is — e.g. the owner's spouse, or the tenant themself (Self)</p>
          </div>
          <Field label="Full name *" value={name} onChange={setName} placeholder="e.g. Ramesh Kumar" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone" value={phone} onChange={setPhone} placeholder="9876543210" />
            <Field label="Email" value={email} onChange={setEmail} placeholder="optional" />
          </div>
          <div>
            <label className="ds-lbl">UPI IDs</label>
            <input type="text" value={upiRaw} onChange={e => setUpiRaw(e.target.value)}
              placeholder="upiid1@bank, upiid2@bank (comma separated)"
              className="ds-field w-full" />
            <p className="text-[11px] mt-1" style={{ color: 'var(--ink-400)' }}>These auto-match future payments from this payer</p>
          </div>
          <Field label="Moved in (date)" value={movedIn} onChange={setMovedIn} type="date" />
          <Field label="Notes" value={notes} onChange={setNotes} placeholder="optional" />
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add resident'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function todayLocal() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function MoveOutDialog({ resident, household, onClose, onSaved }: {
  resident: Resident & { flat: { code: string; block: string } | null }
  household: Resident[]
  onClose: () => void
  onSaved: () => void
}) {
  const [date, setDate] = useState(todayLocal())
  const [checked, setChecked] = useState<Set<string>>(new Set(household.map(h => h.id)))
  const [saving, setSaving] = useState(false)

  async function handleMoveOut() {
    setSaving(true)
    const ids = [resident.id, ...Array.from(checked)]
    const { error } = await supabase.from('residents')
      .update({ is_active: false, moved_out: date }).in('id', ids)
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success(`${ids.length > 1 ? `${ids.length} residents` : resident.name} moved out (${date})`)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-5 border-b hairline">
          <h3 className="font-semibold">Move out — {resident.name}{resident.flat ? ` (${resident.flat.code})` : ''}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--ink-100)]"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="ds-lbl">Move-out date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="ds-field w-full" />
          </div>
          {household.length > 0 && (
            <div className="space-y-2">
              <p className="text-[12px]" style={{ color: 'var(--ink-500)' }}>Also move out:</p>
              {household.map(h => (
                <label key={h.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={checked.has(h.id)} aria-label={h.name}
                    onChange={e => setChecked(prev => {
                      const next = new Set(prev)
                      if (e.target.checked) next.add(h.id); else next.delete(h.id)
                      return next
                    })} />
                  {h.name} <span className="text-[11px]" style={{ color: 'var(--ink-400)' }}>({h.relation})</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2 p-5 border-t hairline">
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button onClick={handleMoveOut} disabled={saving || !date} className="btn-primary flex-1">
            {saving ? 'Saving…' : 'Move out'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string
}) {
  return (
    <div>
      <label className="ds-lbl">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="ds-field w-full" />
    </div>
  )
}
