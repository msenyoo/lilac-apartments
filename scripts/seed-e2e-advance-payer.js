#!/usr/bin/env node
// Seed the DEV Supabase project with fixtures for the reports e2e tests:
//   AG1 — "advance payer": total_outstanding kept at 0 via a payment dated the
//         last day of the PREVIOUS month (the DP2/DG1 pattern: current month
//         shows zero collections while nothing is actually due).
//   AF1 — "month payer": one payment dated the 1st of the CURRENT month so the
//         current fiscal period exists in v_monthly_collection (the view only
//         emits periods that have transactions).
// Idempotent by state — safe to re-run any month; run before the e2e suite.

import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

function loadEnv(file) {
  const raw = readFileSync(join(ROOT, file), 'utf-8')
  return Object.fromEntries(
    raw.split('\n')
      .filter(l => l.includes('=') && !l.startsWith('#'))
      .map(l => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim()] })
  )
}

const env = loadEnv('.env.dev.local')
if (!env.VITE_SUPABASE_URL.includes('qcoezjcwrsqchulqgydm')) {
  console.error('Refusing to run: .env.dev.local does not point at the dev project')
  process.exit(1)
}
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const ADVANCE_FLAT = 'AG1'
const MONTH_FLAT = 'AF1'
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function labelOf(d) { return `${MONTHS[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}` }
function isoOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function fyOf(d) { return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1 }

function baseRow(d, flat, amount, descr, txnId, notes) {
  return {
    txn_id: txnId,
    value_date: isoOf(d),
    posted_date: isoOf(d),
    description: descr,
    cr_dr: 'CR',
    amount,
    flat_id: flat.id,
    flat_code: flat.code,
    category: 'Maintenance',
    corpus: 'NO',
    fiscal_year: fyOf(d),
    fiscal_month: MONTHS[d.getMonth()],
    fiscal_label: labelOf(d),
    source: 'Manual Entry',
    row_type: 'Normal',
    notes,
  }
}

async function getFlat(code) {
  const { data, error } = await supabase.from('flats').select('id, code, maintenance_amt').eq('code', code).single()
  if (error) { console.error(error.message); process.exit(1) }
  return data
}

async function ensureAdvancePayer() {
  const { data: dues, error } = await supabase
    .from('v_dues_tracker').select('total_outstanding').eq('flat_code', ADVANCE_FLAT).single()
  if (error) { console.error(error.message); process.exit(1) }
  if (dues.total_outstanding <= 0) {
    console.log(`${ADVANCE_FLAT} already clear (outstanding=${dues.total_outstanding}).`)
    return
  }
  const flat = await getFlat(ADVANCE_FLAT)
  const now = new Date()
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)
  const row = baseRow(
    prevMonthEnd, flat, dues.total_outstanding,
    `UPI/E2E FIXTURE/${ADVANCE_FLAT} ${MONTHS[now.getMonth()]}${now.getFullYear()} maintenance paid in advance`,
    `E2E-FIXTURE-ADVANCE-PAYER-${labelOf(prevMonthEnd)}`,
    'E2E fixture: advance payer — dues cleared through the current month by a prior-month payment.',
  )
  const { error: ie } = await supabase.from('transactions').insert(row)
  if (ie) { console.error(ie.message); process.exit(1) }
  console.log(`Topped up ${ADVANCE_FLAT} by ${row.amount} dated ${row.value_date} (${row.fiscal_label})`)
}

async function ensureMonthPayer() {
  const now = new Date()
  const label = labelOf(now)
  const { data: existing } = await supabase
    .from('transactions').select('id')
    .eq('flat_code', MONTH_FLAT).eq('fiscal_label', label)
    .eq('category', 'Maintenance').eq('cr_dr', 'CR').limit(1)
  if (existing?.length) {
    console.log(`${MONTH_FLAT} already has a ${label} maintenance payment.`)
    return
  }
  const flat = await getFlat(MONTH_FLAT)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const row = baseRow(
    monthStart, flat, flat.maintenance_amt,
    `UPI/E2E FIXTURE/${MONTH_FLAT} ${MONTHS[now.getMonth()]}${now.getFullYear()} maintenance`,
    `E2E-FIXTURE-MONTH-PAYER-${label}`,
    'E2E fixture: normal current-month payment so the period exists in v_monthly_collection.',
  )
  const { error: ie } = await supabase.from('transactions').insert(row)
  if (ie) { console.error(ie.message); process.exit(1) }
  console.log(`Seeded ${MONTH_FLAT} payment of ${row.amount} dated ${row.value_date} (${label})`)
}

async function report() {
  const now = new Date()
  const { data: dues } = await supabase
    .from('v_dues_tracker').select('flat_code, annual_due, total_outstanding, status').eq('flat_code', ADVANCE_FLAT).single()
  const { data: mc } = await supabase
    .from('v_monthly_collection').select('fiscal_label, collected').eq('flat_code', ADVANCE_FLAT)
    .eq('fiscal_label', labelOf(now))
  console.log(`v_dues_tracker ${ADVANCE_FLAT}:`, dues)
  console.log(`v_monthly_collection ${ADVANCE_FLAT} ${labelOf(now)}:`, mc)
}

await ensureAdvancePayer()
await ensureMonthPayer()
await report()
