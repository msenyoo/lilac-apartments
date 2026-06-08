import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PiggyBank, Plus, CalendarClock } from 'lucide-react'
import { supabase, type Deposit } from '@/lib/supabase'
import { formatINR } from '@/lib/tagger'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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

const STATUS_STYLES: Record<Deposit['status'], string> = {
  active:  'bg-green-100 text-green-700 border-green-200',
  matured: 'bg-blue-100 text-blue-700 border-blue-200',
  closed:  'bg-slate-100 text-slate-600 border-slate-200',
}

export default function FinancePage() {
  const { isAdmin } = useRoleCtx()
  const [filter, setFilter] = useState<'active' | 'all'>('active')

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
            onClick={() => toast.info('Coming soon')}
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
              onClick={() => toast.info('Coming soon')}
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
                          onClick={() => toast.info('Coming soon')}
                        >
                          Mark Matured
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7 px-2.5"
                        onClick={() => toast.info('Coming soon')}
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
    </div>
  )
}
