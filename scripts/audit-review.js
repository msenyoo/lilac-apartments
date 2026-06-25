#!/usr/bin/env node
// Auditor review — read-only checks across ledgers, calculations and integrity.
// Usage: node scripts/audit-review.js
// Output: stdout (markdown).

import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

function loadEnv() {
  const raw = readFileSync(join(ROOT, '.env.local'), 'utf-8')
  return Object.fromEntries(
    raw.split('\n')
      .filter(l => l.includes('=') && !l.startsWith('#'))
      .map(l => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim()] })
  )
}

const env = loadEnv()
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const inr = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN')
const findings = []
function add(severity, area, title, body) { findings.push({ severity, area, title, body }) }

async function fetchAll(table, select, filters = (q) => q) {
  let out = []
  let from = 0
  const page = 1000
  while (true) {
    let q = sb.from(table).select(select).range(from, from + page - 1).order('id', { ascending: true })
    q = filters(q)
    const { data, error } = await q
    if (error) throw new Error(`fetchAll(${table}): ${error.message}`)
    out.push(...(data ?? []))
    if (!data || data.length < page) break
    from += page
  }
  return out
}

function currentFiscalYear(d = new Date()) {
  const m = d.getMonth() + 1
  const y = d.getFullYear()
  return m >= 4 ? y : y - 1
}

function monthsBetween(startDateExcl, endDateExcl) {
  // returns full months in [start, end)
  const s = new Date(startDateExcl)
  const e = new Date(endDateExcl)
  return (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth())
}

async function bankReconciliation() {
  const { data: settings } = await sb.from('app_settings').select('key, value').like('key', 'opening_balance_%')
  const openings = Object.fromEntries((settings ?? []).map(s => [s.key, parseInt(s.value || '0', 10) || 0]))

  const txns = await fetchAll('transactions', 'id, value_date, fiscal_year, amount, cr_dr, row_type, description, flat_code, category, corpus, plan_id, expense_id')
  const active = txns.filter(t => t.row_type !== 'VOIDED')
  const voided = txns.filter(t => t.row_type === 'VOIDED')

  // Per-FY breakdown
  const fys = Array.from(new Set(active.map(t => t.fiscal_year).filter(Boolean))).sort()
  const perFy = fys.map(fy => {
    const rows = active.filter(t => t.fiscal_year === fy)
    const cr = rows.filter(t => t.cr_dr === 'CR').reduce((s, t) => s + (t.amount || 0), 0)
    const dr = rows.filter(t => t.cr_dr === 'DR').reduce((s, t) => s + (t.amount || 0), 0)
    const open = openings[`opening_balance_${fy}`] ?? 0
    return { fy, open, cr, dr, fyBal: open + cr - dr, count: rows.length }
  })

  // Opening balance can be stored either as app_settings.opening_balance_<fy> OR as a CR row with category='Opening Balance'
  const obRows = active.filter(t => t.category === 'Opening Balance')
  const obFromRows = obRows.reduce((s, t) => s + (t.amount || 0), 0)

  // Cumulative balance from earliest opening (settings + Opening Balance rows are already in CR sum)
  const earliestFy = Object.keys(openings).map(k => parseInt(k.split('_').pop(), 10)).sort()[0]
  const earliestOpen = earliestFy ? openings[`opening_balance_${earliestFy}`] : 0
  const totalCr = active.filter(t => t.cr_dr === 'CR').reduce((s, t) => s + (t.amount || 0), 0)
  const totalDr = active.filter(t => t.cr_dr === 'DR').reduce((s, t) => s + (t.amount || 0), 0)
  // If opening is captured as a CR row, don't double-add it via settings
  const cumulative = (obRows.length > 0 ? 0 : earliestOpen) + totalCr - totalDr

  // Tx without fiscal_year
  const noFy = active.filter(t => !t.fiscal_year).length

  // Tx with future value_date
  const today = new Date().toISOString().slice(0, 10)
  const future = active.filter(t => t.value_date > today)

  // Date range
  const sortedDates = active.map(t => t.value_date).sort()
  const earliest = sortedDates[0]
  const latest = sortedDates[sortedDates.length - 1]
  const body = [
    `**Opening balances configured:** ${Object.keys(openings).length} settings, ${obRows.length} transaction rows (${inr(obFromRows)})`,
    ...Object.entries(openings).map(([k, v]) => `  - setting ${k} = ${inr(v)}`),
    ...obRows.map(r => `  - txn row ${r.value_date} ${inr(r.amount)} — ${r.description?.slice(0, 80)}`),
    ``,
    `**Active transactions:** ${active.length} (${earliest} → ${latest})`,
    `**Voided transactions:** ${voided.length}`,
    ``,
    `**Per-FY totals (active only):**`,
    `| FY | Opening | CR | DR | FY balance | # txns |`,
    `|---|---:|---:|---:|---:|---:|`,
    ...perFy.map(p => `| ${p.fy} | ${inr(p.open)} | ${inr(p.cr)} | ${inr(p.dr)} | ${inr(p.fyBal)} | ${p.count} |`),
    ``,
    `**Cumulative running balance** from FY ${earliestFy} opening (${inr(earliestOpen)}) + all CR − all DR = **${inr(cumulative)}**`,
  ].join('\n')
  add('INFO', 'Bank', 'Opening balances and running totals', body)

  if (noFy > 0) {
    add('MEDIUM', 'Bank', `${noFy} transactions missing fiscal_year`,
      `Per-FY reports and v_dues_tracker filter on fiscal_year. Rows without it are silently dropped from dues collection totals.`)
  }
  if (future.length > 0) {
    add('LOW', 'Bank', `${future.length} transactions dated in the future`,
      future.slice(0, 5).map(t => `  - ${t.value_date} ${t.cr_dr} ${inr(t.amount)} — ${t.description?.slice(0, 60)}`).join('\n'))
  }

  return { txns, active, openings, perFy, cumulative, earliestFy }
}

async function expenseLedger() {
  const expenses = await fetchAll('expenses', 'id, voucher_no, expense_date, amount, payment_mode, payee_type, vendor_id, staff_id, transaction_id, corpus_plan_id, approval_status, voided_at, voided_by, void_reason')
  const lineItems = await fetchAll('expense_line_items', 'id, expense_id, amount, category_id, vendor_id, staff_id, cost_center')

  const active = expenses.filter(e => !e.voided_at)
  const voided = expenses.filter(e => e.voided_at)

  // Voucher uniqueness/format/gaps
  const byVoucher = new Map()
  for (const e of expenses) {
    if (!e.voucher_no) continue
    if (!byVoucher.has(e.voucher_no)) byVoucher.set(e.voucher_no, [])
    byVoucher.get(e.voucher_no).push(e)
  }
  const dupVouchers = [...byVoucher.entries()].filter(([_, arr]) => arr.length > 1)
  const noVoucher = expenses.filter(e => !e.voucher_no)
  const badFormat = expenses.filter(e => e.voucher_no && !/^EXP-\d{4}-\d+$/.test(e.voucher_no))

  // Sequence gaps per year
  const byYear = new Map()
  for (const e of expenses) {
    if (!e.voucher_no) continue
    const m = e.voucher_no.match(/^EXP-(\d{4})-(\d+)$/)
    if (!m) continue
    const y = m[1]; const n = parseInt(m[2], 10)
    if (!byYear.has(y)) byYear.set(y, [])
    byYear.get(y).push(n)
  }
  const gaps = []
  for (const [y, nums] of byYear) {
    nums.sort((a, b) => a - b)
    const expected = new Set()
    for (let i = nums[0]; i <= nums[nums.length - 1]; i++) expected.add(i)
    nums.forEach(n => expected.delete(n))
    if (expected.size > 0) gaps.push({ year: y, missing: [...expected].sort((a, b) => a - b) })
  }

  // Header amount = sum(line items)
  const liByExp = new Map()
  for (const li of lineItems) {
    if (!liByExp.has(li.expense_id)) liByExp.set(li.expense_id, [])
    liByExp.get(li.expense_id).push(li)
  }
  const mismatches = []
  const noLines = []
  for (const e of active) {
    const lis = liByExp.get(e.id) ?? []
    if (lis.length === 0) { noLines.push(e); continue }
    const sum = lis.reduce((s, l) => s + (l.amount || 0), 0)
    if (sum !== e.amount) mismatches.push({ expense: e, sum, diff: e.amount - sum })
  }

  // Orphan line items (expense_id missing or voided expense)
  const expIds = new Set(expenses.map(e => e.id))
  const activeIds = new Set(active.map(e => e.id))
  const orphanLi = lineItems.filter(l => !expIds.has(l.expense_id))
  const liOnVoided = lineItems.filter(l => expIds.has(l.expense_id) && !activeIds.has(l.expense_id))

  // Payee integrity
  const badStaff = active.filter(e => e.payee_type === 'Staff' && !e.staff_id)
  const badVendor = active.filter(e => e.payee_type === 'Vendor' && !e.vendor_id)

  // Reconciliation: bank-mode expenses must have transaction_id
  const bankExpensesUnreconciled = active.filter(e =>
    (e.payment_mode === 'Bank Transfer' || e.payment_mode === 'Online' || e.payment_mode === 'Cheque')
    && !e.transaction_id
  )

  // Voided expenses still referenced by an active transaction (orphan link)
  const txns = await fetchAll('transactions', 'id, value_date, amount, cr_dr, expense_id, row_type', q => q.not('expense_id', 'is', null))
  const voidedIds = new Set(voided.map(v => v.id))
  const txnsOnVoidedExp = txns.filter(t => t.row_type !== 'VOIDED' && voidedIds.has(t.expense_id))

  // Summary block
  const totalActive = active.reduce((s, e) => s + (e.amount || 0), 0)
  const totalVoided = voided.reduce((s, e) => s + (e.amount || 0), 0)
  add('INFO', 'Expenses', 'Ledger summary',
    `Active expenses: ${active.length}, total ${inr(totalActive)}\n` +
    `Voided expenses: ${voided.length}, total ${inr(totalVoided)}\n` +
    `Line items: ${lineItems.length}\n` +
    `Reconciled to a bank transaction: ${active.filter(e => e.transaction_id).length}`
  )

  if (dupVouchers.length > 0) {
    add('HIGH', 'Expenses', `${dupVouchers.length} duplicate voucher numbers`,
      dupVouchers.slice(0, 10).map(([v, arr]) => `  - ${v} → ${arr.length}× (ids: ${arr.map(a => a.id.slice(0, 8)).join(', ')})`).join('\n'))
  }
  if (noVoucher.length > 0) {
    add('MEDIUM', 'Expenses', `${noVoucher.length} expenses missing voucher_no`,
      noVoucher.slice(0, 5).map(e => `  - ${e.id} ${e.expense_date} ${inr(e.amount)} — ${e.payee_type}`).join('\n'))
  }
  if (badFormat.length > 0) {
    add('LOW', 'Expenses', `${badFormat.length} voucher_no not matching EXP-YYYY-NNNN`,
      badFormat.slice(0, 5).map(e => `  - ${e.voucher_no} (id ${e.id.slice(0, 8)})`).join('\n'))
  }
  if (gaps.length > 0) {
    add('LOW', 'Expenses', `Voucher sequence has gaps`,
      gaps.map(g => `  - ${g.year}: ${g.missing.length} missing (${g.missing.slice(0, 8).map(n => String(n).padStart(4, '0')).join(', ')}${g.missing.length > 8 ? ', …' : ''})`).join('\n'))
  }
  if (mismatches.length > 0) {
    const totalDiff = mismatches.reduce((s, m) => s + Math.abs(m.diff), 0)
    add('HIGH', 'Expenses', `${mismatches.length} expenses where header amount ≠ Σ line items (total drift ${inr(totalDiff)})`,
      mismatches.slice(0, 10).map(m =>
        `  - ${m.expense.voucher_no || m.expense.id.slice(0, 8)} ${m.expense.expense_date}: header=${inr(m.expense.amount)} lines=${inr(m.sum)} diff=${inr(m.diff)}`
      ).join('\n'))
  }
  if (noLines.length > 0) {
    add('MEDIUM', 'Expenses', `${noLines.length} active expenses with NO line items`,
      noLines.slice(0, 10).map(e => `  - ${e.voucher_no || e.id.slice(0, 8)} ${e.expense_date} ${inr(e.amount)} — ${e.payee_type}`).join('\n'))
  }
  if (orphanLi.length > 0) add('MEDIUM', 'Expenses', `${orphanLi.length} line items with no parent expense`, '')
  if (liOnVoided.length > 0) add('LOW', 'Expenses', `${liOnVoided.length} line items attached to voided expenses (cosmetic)`, '')
  if (badStaff.length > 0) add('LOW', 'Expenses', `${badStaff.length} expenses with payee_type=Staff but no staff_id`, badStaff.slice(0, 5).map(e => `  - ${e.voucher_no} ${e.expense_date}`).join('\n'))
  if (badVendor.length > 0) add('LOW', 'Expenses', `${badVendor.length} expenses with payee_type=Vendor but no vendor_id`, badVendor.slice(0, 5).map(e => `  - ${e.voucher_no} ${e.expense_date}`).join('\n'))
  if (bankExpensesUnreconciled.length > 0) {
    const amt = bankExpensesUnreconciled.reduce((s, e) => s + (e.amount || 0), 0)
    add('MEDIUM', 'Expenses', `${bankExpensesUnreconciled.length} bank-mode expenses NOT reconciled to a transaction (${inr(amt)})`,
      bankExpensesUnreconciled.slice(0, 10).map(e =>
        `  - ${e.voucher_no || e.id.slice(0, 8)} ${e.expense_date} ${e.payment_mode} ${inr(e.amount)}`
      ).join('\n'))
  }
  if (txnsOnVoidedExp.length > 0) {
    add('HIGH', 'Expenses', `${txnsOnVoidedExp.length} active transactions still link to voided expenses`,
      `These DRs may show as "Reconciled" in UI but the expense is voided. Fix by NULLing transactions.expense_id or un-voiding.`)
  }
  return { expenses, active, lineItems, totalActive, totalVoided }
}

async function duesReconciliation() {
  const { data: settings } = await sb.from('app_settings').select('key, value').like('key', 'dues_start_fiscal_year')
  const startFy = parseInt(settings?.[0]?.value || `${currentFiscalYear()}`, 10)

  const flats = await fetchAll('flats', 'id, code, block, maintenance_amt')
  const rates = await fetchAll('maintenance_rate_history', 'id, flat_id, monthly_rate, effective_from, effective_to')
  const arrears = await fetchAll('flat_arrears', 'flat_id, amount, arrears_type')
  const txns = await fetchAll('transactions', 'flat_code, amount, cr_dr, category, fiscal_year, row_type', q => q.eq('cr_dr', 'CR').eq('category', 'Maintenance').neq('row_type', 'VOIDED'))

  // Use the view as ground-truth comparison
  const { data: view } = await sb.from('v_dues_tracker').select('flat_code, annual_due, collected_fy, arrears_maintenance, advance_credits, total_outstanding')

  const today = new Date()
  // tracking window: [start_fy April 1, next-month-1st)
  const trackStart = `${startFy}-04-01`
  const trackEndExcl = `${today.getFullYear()}-${String(today.getMonth() + 2).padStart(2, '0')}-01`

  const arrByFlat = new Map()
  for (const a of arrears) {
    if (!arrByFlat.has(a.flat_id)) arrByFlat.set(a.flat_id, { maintenance: 0, credit: 0, corpus: 0 })
    arrByFlat.get(a.flat_id)[a.arrears_type] += a.amount || 0
  }

  const ratesByFlat = new Map()
  for (const r of rates) {
    if (!ratesByFlat.has(r.flat_id)) ratesByFlat.set(r.flat_id, [])
    ratesByFlat.get(r.flat_id).push(r)
  }

  // Rate history sanity per flat
  const overlaps = []
  const gaps = []
  const noRates = []
  for (const f of flats) {
    const rs = (ratesByFlat.get(f.id) ?? []).slice().sort((a, b) => a.effective_from.localeCompare(b.effective_from))
    if (rs.length === 0) { noRates.push(f); continue }
    for (let i = 0; i < rs.length - 1; i++) {
      const cur = rs[i], next = rs[i + 1]
      const curEnd = cur.effective_to ?? '9999-12-31'
      if (curEnd >= next.effective_from) {
        // overlap: cur ends on or after next starts (same day means overlap by 1 day at least)
        if (curEnd > next.effective_from) overlaps.push({ flat: f.code, cur, next })
      } else {
        // gap exists if curEnd + 1 day < next.effective_from
        const curEndD = new Date(curEnd); curEndD.setDate(curEndD.getDate() + 1)
        if (curEndD.toISOString().slice(0, 10) < next.effective_from) gaps.push({ flat: f.code, gapAfter: curEnd, gapBefore: next.effective_from })
      }
    }
  }

  // Compute annual_due per flat = Σ over rate periods of (months in [period_start, period_end_excl) ∩ [trackStart, trackEndExcl)) × monthly_rate
  function monthFloor(d) { const x = new Date(d); x.setDate(1); return x.toISOString().slice(0, 10) }
  function addMonths(d, n) { const x = new Date(d); x.setMonth(x.getMonth() + n); return x.toISOString().slice(0, 10) }

  const recomputed = []
  for (const f of flats) {
    const rs = ratesByFlat.get(f.id) ?? []
    let dueRecomputed = 0
    for (const r of rs) {
      const ps = monthFloor(r.effective_from)
      const peExcl = r.effective_to ? addMonths(monthFloor(r.effective_to), 1) : addMonths(monthFloor(today.toISOString().slice(0, 10)), 1)
      const lo = ps > trackStart ? ps : trackStart
      const hi = peExcl < trackEndExcl ? peExcl : trackEndExcl
      const m = Math.max(0, monthsBetween(lo, hi))
      dueRecomputed += r.monthly_rate * m
    }
    const collected = txns.filter(t => t.flat_code === f.code && (t.fiscal_year ?? 0) >= startFy).reduce((s, t) => s + (t.amount || 0), 0)
    const arr = arrByFlat.get(f.id) ?? { maintenance: 0, credit: 0, corpus: 0 }
    const outRecomputed = dueRecomputed - collected + (arr.maintenance || 0) - (arr.credit || 0)
    const v = (view ?? []).find(x => x.flat_code === f.code)
    if (v) {
      const diffs = []
      if (v.annual_due !== dueRecomputed) diffs.push(`annual_due view=${inr(v.annual_due)} calc=${inr(dueRecomputed)}`)
      if (v.collected_fy !== collected) diffs.push(`collected view=${inr(v.collected_fy)} calc=${inr(collected)}`)
      if (v.arrears_maintenance !== (arr.maintenance || 0)) diffs.push(`arrears view=${inr(v.arrears_maintenance)} calc=${inr(arr.maintenance || 0)}`)
      if (v.advance_credits !== (arr.credit || 0)) diffs.push(`credits view=${inr(v.advance_credits)} calc=${inr(arr.credit || 0)}`)
      if (v.total_outstanding !== outRecomputed) diffs.push(`total view=${inr(v.total_outstanding)} calc=${inr(outRecomputed)}`)
      if (diffs.length > 0) recomputed.push({ flat: f.code, diffs })
    }
  }

  const totalView = (view ?? []).reduce((s, r) => s + (r.total_outstanding || 0), 0)
  const totalCalc = flats.reduce((s, f) => {
    const arr = arrByFlat.get(f.id) ?? { maintenance: 0, credit: 0 }
    const collected = txns.filter(t => t.flat_code === f.code && (t.fiscal_year ?? 0) >= startFy).reduce((s2, t) => s2 + (t.amount || 0), 0)
    const rs = ratesByFlat.get(f.id) ?? []
    let due = 0
    for (const r of rs) {
      const ps = monthFloor(r.effective_from)
      const peExcl = r.effective_to ? addMonths(monthFloor(r.effective_to), 1) : addMonths(monthFloor(today.toISOString().slice(0, 10)), 1)
      const lo = ps > trackStart ? ps : trackStart
      const hi = peExcl < trackEndExcl ? peExcl : trackEndExcl
      due += r.monthly_rate * Math.max(0, monthsBetween(lo, hi))
    }
    return s + (due - collected + (arr.maintenance || 0) - (arr.credit || 0))
  }, 0)

  add('INFO', 'Dues', 'Reconciliation summary',
    `Tracking from FY ${startFy} (start ${trackStart}, end-excl ${trackEndExcl})\n` +
    `Flats: ${flats.length}\n` +
    `Total outstanding (view): ${inr(totalView)}\n` +
    `Total outstanding (recomputed from raw): ${inr(totalCalc)}\n` +
    `Drift: ${inr(totalCalc - totalView)}`)

  if (noRates.length > 0) {
    add('HIGH', 'Dues', `${noRates.length} flats have NO rate history — annual_due will be ₹0`,
      noRates.slice(0, 10).map(f => `  - ${f.code} (block ${f.block})`).join('\n'))
  }
  if (overlaps.length > 0) {
    add('MEDIUM', 'Dues', `${overlaps.length} rate-history overlaps detected`,
      overlaps.slice(0, 10).map(o => `  - ${o.flat}: ${o.cur.effective_from}..${o.cur.effective_to || '∞'} overlaps ${o.next.effective_from}..`).join('\n'))
  }
  if (gaps.length > 0) {
    add('MEDIUM', 'Dues', `${gaps.length} rate-history gaps detected`,
      gaps.slice(0, 10).map(g => `  - ${g.flat}: gap from ${g.gapAfter} → ${g.gapBefore}`).join('\n'))
  }
  if (recomputed.length > 0) {
    add('HIGH', 'Dues', `${recomputed.length} flats where view disagrees with recomputed values`,
      recomputed.slice(0, 15).map(r => `  - ${r.flat}: ${r.diffs.join('; ')}`).join('\n'))
  }
  // Unmatched maintenance CRs
  const flatCodes = new Set(flats.map(f => f.code))
  const unmatchedMaint = txns.filter(t => !t.flat_code || !flatCodes.has(t.flat_code))
  if (unmatchedMaint.length > 0) {
    const amt = unmatchedMaint.reduce((s, t) => s + (t.amount || 0), 0)
    add('MEDIUM', 'Dues', `${unmatchedMaint.length} Maintenance CRs not tagged to a known flat (${inr(amt)})`,
      `These credits don't reduce any flat's outstanding.`)
  }
  return { startFy, totalView, totalCalc, recomputed }
}

async function corpusReconciliation() {
  const plans = await fetchAll('corpus_plans', 'id, name, status, total_target, start_fiscal_year, end_fiscal_year')
  const planFlats = await fetchAll('corpus_plan_flats', 'plan_id, flat_id, target_amount, pre_payment, carry_forward_amount')
  const flats = await fetchAll('flats', 'id, code')
  const flatById = new Map(flats.map(f => [f.id, f]))
  const txns = await fetchAll('transactions', 'flat_code, amount, cr_dr, corpus, plan_id, fiscal_year, row_type, value_date',
    q => q.eq('corpus', 'YES').eq('cr_dr', 'CR').neq('row_type', 'VOIDED'))

  // Per plan: target sum check
  const planSum = new Map()
  for (const pf of planFlats) {
    const s = planSum.get(pf.plan_id) ?? { target: 0, pre: 0, carry: 0, count: 0 }
    s.target += pf.target_amount || 0
    s.pre += pf.pre_payment || 0
    s.carry += pf.carry_forward_amount || 0
    s.count++
    planSum.set(pf.plan_id, s)
  }
  const targetMismatches = []
  for (const p of plans) {
    if (p.status === 'cancelled') continue
    const s = planSum.get(p.id) ?? { target: 0, pre: 0, carry: 0, count: 0 }
    if (s.target !== p.total_target) targetMismatches.push({ plan: p, sum: s.target, count: s.count })
  }

  // Plans summary
  const planRows = plans.map(p => {
    const s = planSum.get(p.id) ?? { target: 0, pre: 0, carry: 0, count: 0 }
    const planTxns = txns.filter(t => {
      if (t.plan_id === p.id) return true
      if (t.plan_id) return false
      return (t.fiscal_year ?? 0) >= p.start_fiscal_year && (t.fiscal_year ?? 0) <= p.end_fiscal_year
    })
    const collected = s.pre + planTxns.reduce((acc, t) => acc + (t.amount || 0), 0)
    const balance = (s.target + s.carry - s.pre) - planTxns.reduce((acc, t) => acc + (t.amount || 0), 0)
    return { p, s, planTxns: planTxns.length, collected, balance }
  })

  // Cross-plan double counting: corpus CRs with NULL plan_id whose FY overlaps >1 active plan
  const activeOrDraft = plans.filter(p => p.status === 'active' || p.status === 'draft')
  const doubleCount = []
  const txnsNullPlan = txns.filter(t => !t.plan_id)
  for (const t of txnsNullPlan) {
    const overlap = activeOrDraft.filter(p => (t.fiscal_year ?? 0) >= p.start_fiscal_year && (t.fiscal_year ?? 0) <= p.end_fiscal_year)
    if (overlap.length > 1) doubleCount.push({ t, overlap: overlap.map(p => p.name) })
  }

  // Orphan corpus payments — plan_id references a missing plan
  const planIds = new Set(plans.map(p => p.id))
  const orphan = txns.filter(t => t.plan_id && !planIds.has(t.plan_id))

  add('INFO', 'Corpus', 'Plan summary',
    `Plans: ${plans.length} (${plans.filter(p => p.status === 'active').length} active, ${plans.filter(p => p.status === 'draft').length} draft, ${plans.filter(p => p.status === 'completed').length} completed, ${plans.filter(p => p.status === 'cancelled').length} cancelled)\n` +
    `Corpus contribution CRs (active): ${txns.length}\n` +
    `  - with plan_id: ${txns.filter(t => t.plan_id).length}\n` +
    `  - NULL plan_id (FY fallback): ${txnsNullPlan.length}\n\n` +
    `**Plan → collected / balance:**\n` +
    `| Plan | Status | FY range | Target | Collected | Balance | # Tx |\n|---|---|---|---:|---:|---:|---:|\n` +
    planRows.map(r => `| ${r.p.name} | ${r.p.status} | ${r.p.start_fiscal_year}–${r.p.end_fiscal_year} | ${inr(r.p.total_target)} | ${inr(r.collected)} | ${inr(r.balance)} | ${r.planTxns} |`).join('\n')
  )

  if (targetMismatches.length > 0) {
    add('HIGH', 'Corpus', `${targetMismatches.length} plans where Σ(plan_flats.target_amount) ≠ plan.target_amount`,
      targetMismatches.map(m => `  - ${m.plan.name}: plan=${inr(m.plan.total_target)} sum-of-flats=${inr(m.sum)} (${m.count} flats)`).join('\n'))
  }
  if (doubleCount.length > 0) {
    add('HIGH', 'Corpus', `${doubleCount.length} corpus CRs may be double-counted across overlapping plans`,
      `These have NULL plan_id and fall within FY ranges of multiple active/draft plans. v_corpus_tracker will attribute them to ALL of them.\n` +
      doubleCount.slice(0, 10).map(d => `  - ${d.t.value_date} ${d.t.flat_code} ${inr(d.t.amount)} → ${d.overlap.join(' + ')}`).join('\n'))
  }
  if (orphan.length > 0) {
    add('HIGH', 'Corpus', `${orphan.length} corpus CRs reference a missing/deleted plan_id`,
      orphan.slice(0, 10).map(t => `  - ${t.value_date} ${t.flat_code} ${inr(t.amount)} plan_id=${t.plan_id?.slice(0, 8)}`).join('\n'))
  }
  return { plans, planRows }
}

async function crossLedger(active) {
  // Try legacy parallel tables; if missing, skip silently.
  async function safeSum(table) {
    try {
      const rows = await fetchAll(table, 'amount')
      return { ok: true, sum: rows.reduce((s, r) => s + (r.amount || 0), 0), n: rows.length }
    } catch (e) { return { ok: false, err: e.message } }
  }
  const mp = await safeSum('maintenance_payments')
  const cp = await safeSum('corpus_payments')
  const sumTxnsMaintCR = active.filter(t => t.category === 'Maintenance' && t.cr_dr === 'CR').reduce((s, t) => s + (t.amount || 0), 0)
  const sumTxnsCorpusCR = active.filter(t => t.corpus === 'YES' && t.cr_dr === 'CR').reduce((s, t) => s + (t.amount || 0), 0)

  const lines = [
    `**Source of truth = transactions table** (maintenance_payments / corpus_payments appear legacy or absent).`,
    `Transactions Σ Maintenance CR (active) = **${inr(sumTxnsMaintCR)}**`,
    `Transactions Σ Corpus CR (active)      = **${inr(sumTxnsCorpusCR)}**`,
    mp.ok ? `Legacy maintenance_payments Σ = ${inr(mp.sum)} (${mp.n} rows); diff vs txns ${inr(sumTxnsMaintCR - mp.sum)}` : `Legacy maintenance_payments: NOT PRESENT`,
    cp.ok ? `Legacy corpus_payments Σ      = ${inr(cp.sum)} (${cp.n} rows); diff vs txns ${inr(sumTxnsCorpusCR - cp.sum)}` : `Legacy corpus_payments: NOT PRESENT`,
  ]
  add('INFO', 'Ledgers', 'Cross-ledger reconciliation', lines.join('\n'))

  // Transactions categorised but no flat tag
  const catNoFlat = active.filter(t => (t.category === 'Maintenance' || t.corpus === 'YES') && t.cr_dr === 'CR' && !t.flat_code)
  if (catNoFlat.length > 0) {
    add('MEDIUM', 'Ledgers', `${catNoFlat.length} Maintenance/Corpus CRs have no flat_code`,
      catNoFlat.slice(0, 10).map(t => `  - ${t.value_date} ${t.category || (t.corpus === 'YES' ? 'Corpus' : '')} ${inr(t.amount)} — ${t.description?.slice(0, 60)}`).join('\n'))
  }

  // DRs not linked to expense — excluding transfers (FD) and opening balance categories
  const NON_EXPENSE_CATS = new Set(['FD', 'Opening Balance'])
  const unrecDR = active.filter(t => t.cr_dr === 'DR' && !t.expense_id && !NON_EXPENSE_CATS.has(t.category))
  if (unrecDR.length > 0) {
    const amt = unrecDR.reduce((s, t) => s + (t.amount || 0), 0)
    add('LOW', 'Ledgers', `${unrecDR.length} DRs not reconciled to an expense (${inr(amt)})`, '')
  }
}

async function auditLogCoverage() {
  // Audit log row count by table
  const { data: logs } = await sb.rpc('get_my_role') // sanity ping
  const { data: byTable, error } = await sb.from('audit_log').select('table_name, action, created_at').order('created_at', { ascending: false }).limit(5000)
  if (error) { add('INFO', 'Audit log', 'Could not read audit_log', error.message); return }
  const counts = {}
  for (const r of byTable) {
    const k = `${r.table_name}|${r.action}`
    counts[k] = (counts[k] || 0) + 1
  }
  const lastDates = {}
  for (const r of byTable) {
    if (!lastDates[r.table_name] || r.created_at > lastDates[r.table_name]) lastDates[r.table_name] = r.created_at
  }
  add('INFO', 'Audit log', `Sampled ${byTable.length} most recent entries`,
    `**By table:**\n` +
    Object.entries(lastDates).map(([t, d]) => `  - ${t.padEnd(28)} last ${d.slice(0, 10)}`).join('\n') +
    `\n\n**By (table, action) — top 20:**\n` +
    Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, c]) => `  - ${k.padEnd(40)} ${c}`).join('\n'))
}

async function duplicateTransactions(active) {
  // SPLIT rows legitimately share key fields by design (same parent credit). Exclude them.
  const eligible = active.filter(t => t.row_type !== 'SPLIT')
  const seen = new Map(); const dups = []
  for (const t of eligible) {
    const k = `${t.value_date}|${t.cr_dr}|${t.amount}|${(t.description ?? '').trim()}`
    if (seen.has(k)) dups.push({ first: seen.get(k), second: t })
    else seen.set(k, t)
  }
  if (dups.length > 0) {
    const amt = dups.reduce((s, d) => s + (d.second.amount || 0), 0)
    add('HIGH', 'Bank', `${dups.length} likely duplicate transactions (same date+cr_dr+amount+description) — inflates totals by ${inr(amt)}`,
      dups.slice(0, 10).map(d => `  - ${d.first.value_date} ${d.first.cr_dr} ${inr(d.first.amount)} — ${d.first.description?.slice(0, 60)} (ids ${d.first.id?.slice(0, 8)}/${d.second.id?.slice(0, 8)})`).join('\n'))
  }
  const loose = new Map(); const looseDups = []
  for (const t of eligible) {
    const k = `${t.value_date}|${t.cr_dr}|${t.amount}`
    if (loose.has(k)) looseDups.push({ first: loose.get(k), second: t })
    else loose.set(k, t)
  }
  const extra = looseDups.length - dups.length
  if (extra > 0) {
    add('LOW', 'Bank', `${extra} additional same-date/amount/cr_dr pairs with different descriptions (review manually)`, '')
  }
}

async function main() {
  console.log(`# Auditor Review — Lilac Apartments`)
  console.log(`\n_Run: ${new Date().toISOString()}_\n`)

  const bank = await bankReconciliation()
  await duplicateTransactions(bank.active)
  await expenseLedger()
  await duesReconciliation()
  await corpusReconciliation()
  await crossLedger(bank.active)
  await auditLogCoverage()

  // Group findings
  const order = { HIGH: 0, MEDIUM: 1, LOW: 2, INFO: 3 }
  findings.sort((a, b) => order[a.severity] - order[b.severity])

  console.log(`\n## Findings summary\n`)
  console.log(`| # | Severity | Area | Title |`)
  console.log(`|---|---|---|---|`)
  findings.forEach((f, i) => console.log(`| ${i + 1} | ${f.severity} | ${f.area} | ${f.title} |`))

  console.log(`\n## Findings detail\n`)
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i]
    console.log(`\n### ${i + 1}. [${f.severity}] ${f.area} — ${f.title}\n`)
    if (f.body) console.log(f.body)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
