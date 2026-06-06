import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatINR } from '@/lib/tagger'
import { IndianRupee, Building2, CheckCircle2, AlertCircle, Clock } from 'lucide-react'

interface FlatRow { id: string; code: string; block: string; flat_type: string; bhk_type: string | null; maintenance_amt: number; corpus_target: number }
interface DuesRow { flat_code: string; maintenance_amt: number; annual_due: number; collected_fy: number; pending: number; status: string }
interface CorpusRow { flat_code: string; corpus_target: number; collected: number; balance: number; pct_paid: number; status: string }

function StatusPill({ status }: { status: string }) {
  const cfg: Record<string, { bg: string; color: string; icon: React.ReactNode }> = {
    Clear:   { bg: 'var(--ok-bg)',   color: 'var(--ok)',   icon: <CheckCircle2 size={13} /> },
    Partial: { bg: 'var(--warn-bg)', color: 'var(--warn)', icon: <Clock size={13} /> },
    Due:     { bg: 'var(--bad-bg)',  color: 'var(--bad)',  icon: <AlertCircle size={13} /> },
  }
  const c = cfg[status] ?? { bg: 'var(--ink-100)', color: 'var(--ink-500)', icon: null }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold" style={{ background: c.bg, color: c.color }}>
      {c.icon}{status}
    </span>
  )
}

export default function OwnerPortalPage() {
  const { data: myFlat } = useQuery<FlatRow | null>({
    queryKey: ['owner-flat'],
    queryFn: async () => {
      const { data } = await supabase.from('flats').select('id,code,block,flat_type,bhk_type,maintenance_amt,corpus_target').single()
      return data as FlatRow | null
    },
  })

  const { data: dues } = useQuery<DuesRow | null>({
    queryKey: ['owner-dues'],
    queryFn: async () => {
      const { data } = await supabase.from('v_dues_tracker').select('*').limit(1).maybeSingle()
      return data as DuesRow | null
    },
  })

  const { data: corpus } = useQuery<CorpusRow | null>({
    queryKey: ['owner-corpus'],
    queryFn: async () => {
      const { data } = await supabase.from('v_corpus_tracker').select('*').limit(1).maybeSingle()
      return data as CorpusRow | null
    },
  })

  const { data: settings } = useQuery({
    queryKey: ['app-settings'],
    queryFn: async () => {
      const { data } = await supabase.from('app_settings').select('*')
      return Object.fromEntries((data ?? []).map((s: any) => [s.key, s.value]))
    },
  })

  const upi  = settings?.collection_upi  ?? ''
  const bank = settings?.collection_bank ?? ''

  return (
    <div className="flex flex-col gap-5 fade-in max-w-2xl">
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
              {myFlat?.flat_type ?? ''}{myFlat?.bhk_type ? ` · ${myFlat.bhk_type}` : ''}
              {myFlat?.maintenance_amt ? ` · ₹${myFlat.maintenance_amt.toLocaleString('en-IN')}/month` : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Dues + Corpus side by side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Dues card */}
        <div className="surface !p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-[14px]">Maintenance dues</p>
            {dues && <StatusPill status={dues.status} />}
          </div>
          {dues ? (
            <div className="flex flex-col gap-1.5 text-[13px]">
              <div className="flex justify-between">
                <span style={{ color: 'var(--ink-500)' }}>Due this year</span>
                <span className="font-medium">{formatINR(dues.annual_due)}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--ink-500)' }}>Collected</span>
                <span className="font-medium" style={{ color: 'var(--ok)' }}>{formatINR(dues.collected_fy)}</span>
              </div>
              {dues.pending > 0 && (
                <div className="flex justify-between pt-1 border-t" style={{ borderColor: 'var(--ink-100)' }}>
                  <span className="font-semibold" style={{ color: 'var(--bad)' }}>Pending</span>
                  <span className="font-bold" style={{ color: 'var(--bad)' }}>{formatINR(dues.pending)}</span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-[13px]" style={{ color: 'var(--ink-400)' }}>No dues data</p>
          )}
        </div>

        {/* Corpus card */}
        <div className="surface !p-5 flex flex-col gap-3">
          <p className="font-semibold text-[14px]">Corpus contribution</p>
          {corpus ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-end justify-between">
                <span className="text-[22px] font-extrabold" style={{ color: 'var(--brand-700)' }}>
                  {formatINR(corpus.collected)}
                </span>
                <span className="text-[12px]" style={{ color: 'var(--ink-400)' }}>
                  of {formatINR(corpus.corpus_target)}
                </span>
              </div>
              {/* Progress bar */}
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--ink-100)' }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${Math.min(corpus.pct_paid ?? 0, 100)}%`, background: 'var(--brand-500)' }}
                />
              </div>
              <p className="text-[11.5px]" style={{ color: 'var(--ink-400)' }}>
                {corpus.pct_paid?.toFixed(0) ?? 0}% complete · {corpus.status}
              </p>
            </div>
          ) : (
            <p className="text-[13px]" style={{ color: 'var(--ink-400)' }}>No corpus plan active</p>
          )}
        </div>
      </div>

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
          <p className="text-[11.5px]" style={{ color: 'var(--ink-400)' }}>
            Include your flat number in the payment description/remarks.
          </p>
        </div>
      )}
    </div>
  )
}
