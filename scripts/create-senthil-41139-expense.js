#!/usr/bin/env node
// Create the Senthil reimbursement expense for ₹41,139 (bank DR 2026-06-28,
// IMPS/617920402985) with 17 line items (each carrying its own paid_date),
// link it to the bank transaction, and void the standalone ₹1,073
// EXP-2026-0018 whose amount is included in this bundle.
// Idempotent: skips if the DR is already linked.

import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf-8')
    .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim()] })
)
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const SENTHIL_VENDOR_ID = '9acbc147-f23c-4818-bbfc-15e795e5025e'
const DR_TXN_ID         = 'a8c2a46f-dd76-4d0b-8021-aaaa08316037' // ₹41,139 DR 2026-06-28
const OLD_1073_EXP_ID   = '0699e8d2-ad79-4cc1-b0b0-b46e02835452' // EXP-2026-0018

const CAT_NAMES = ['Plumbing', 'Motor Pumps', 'Electrical Work', 'Cleaning Supplies', 'Miscellaneous', 'Sump water']

async function loadCats() {
  const { data, error } = await supabase.from('expense_categories').select('id,name').in('name', CAT_NAMES)
  if (error) { console.error(error); process.exit(1) }
  const m = {}
  for (const c of data ?? []) m[c.name] = c.id
  for (const n of CAT_NAMES) if (!m[n]) { console.error(`Category not found: ${n}`); process.exit(1) }
  return m
}

const LINE_ITEMS = [
  { paid_date: '2026-06-09', description: 'PVC pipes for drainage (2860 + 1307 + 1065)',        amount: 5232, cost_center: 'Common',  cat: 'Plumbing' },
  { paid_date: '2026-06-13', description: 'Man holes for drainage',                              amount: 4800, cost_center: 'Common',  cat: 'Plumbing' },
  { paid_date: '2026-06-12', description: 'Sump tap extension - main gate (473 + 600)',          amount: 1073, cost_center: 'Common',  cat: 'Sump water' },
  { paid_date: '2026-06-18', description: 'Pipe material sump tank to motor',                    amount: 1906, cost_center: 'Common',  cat: 'Sump water' },
  { paid_date: '2026-06-19', description: 'B motor service',                                     amount: 2200, cost_center: 'Block-B', cat: 'Motor Pumps' },
  { paid_date: '2026-06-20', description: 'Main gate welding',                                   amount: 6000, cost_center: 'Common',  cat: 'Miscellaneous' },
  { paid_date: '2026-06-20', description: 'LED bulb 3 × 70',                                     amount:  210, cost_center: 'Common',  cat: 'Electrical Work' },
  { paid_date: '2026-06-20', description: 'Thodapam 2 × 130',                                    amount:  260, cost_center: 'Common',  cat: 'Cleaning Supplies' },
  { paid_date: '2026-06-20', description: 'Lizol 5 liters',                                      amount:  630, cost_center: 'Common',  cat: 'Cleaning Supplies' },
  { paid_date: '2026-06-19', description: 'Drainage materials',                                  amount: 1500, cost_center: 'Common',  cat: 'Plumbing' },
  { paid_date: '2026-06-24', description: 'Plumbing material',                                   amount:  240, cost_center: 'Common',  cat: 'Plumbing' },
  { paid_date: '2026-06-24', description: 'Digging work',                                        amount:  500, cost_center: 'Common',  cat: 'Plumbing' },
  { paid_date: '2026-06-28', description: 'D motor plumbing and sump civil work materials',      amount: 7838, cost_center: 'Block-D', cat: 'Plumbing' },
  { paid_date: '2026-06-28', description: 'Civil labour',                                        amount: 4500, cost_center: 'Common',  cat: 'Miscellaneous' },
  { paid_date: '2026-06-28', description: 'Plumbing material',                                   amount:  750, cost_center: 'Common',  cat: 'Plumbing' },
  { paid_date: '2026-06-28', description: 'Plumbing labour',                                     amount: 3500, cost_center: 'Common',  cat: 'Plumbing' },
]

async function main() {
  const { data: dr, error: drErr } = await supabase
    .from('transactions').select('id, value_date, amount, expense_id').eq('id', DR_TXN_ID).single()
  if (drErr) { console.error(drErr); process.exit(1) }
  if (dr.expense_id) {
    console.log(`DR ${DR_TXN_ID.slice(0,8)} already linked to expense ${dr.expense_id.slice(0,8)} — skipping`)
    return
  }

  const cats = await loadCats()
  const total = LINE_ITEMS.reduce((s, l) => s + l.amount, 0)
  if (total !== 41139) { console.error(`Line items sum to ₹${total}, expected ₹41,139`); process.exit(1) }

  const expRow = {
    expense_date:         dr.value_date,
    description:          'Maintenance expenses Jun 2026 (drainage, sump, motors, gate, supplies) — Senthil reimbursement',
    payee_type:           'Vendor',
    vendor_id:            SENTHIL_VENDOR_ID,
    amount:               41139,
    payment_mode:         'Bank Transfer',
    reference_no:         'IMPS/617920402985',
    category_id:          null,
    corpus_plan_id:       null,
    transaction_id:       DR_TXN_ID,
    reconciled_at:        new Date().toISOString(),
    reconciliation_notes: `Auto-matched to bank debit ${dr.value_date}`,
    payment_status:       'paid',
    approval_status:      'approved',
    notes:                'Senthil reimbursement covering 16 maintenance items paid 09–28 Jun 2026. Includes the ₹1,073 sump tap extension previously recorded as EXP-2026-0018 (now voided as merged).',
  }

  const { data: created, error: e1 } = await supabase.from('expenses').insert(expRow).select('id, voucher_no').single()
  if (e1) { console.error('insert expense failed:', e1); process.exit(1) }
  console.log(`Created ${created.voucher_no} (${created.id.slice(0,8)}) for ₹41,139`)

  const lineRows = LINE_ITEMS.map(l => ({
    expense_id:     created.id,
    payee_type:     'Vendor',
    payee_name_raw: 'Senthilkumar',
    description:    l.description,
    category_id:    cats[l.cat],
    cost_center:    l.cost_center,
    amount:         l.amount,
    paid_date:      l.paid_date,
  }))
  const { error: e2 } = await supabase.from('expense_line_items').insert(lineRows)
  if (e2) { console.error('insert line items failed:', e2); process.exit(1) }
  console.log(`Inserted ${lineRows.length} line items`)

  const { error: e3 } = await supabase.from('transactions').update({ expense_id: created.id }).eq('id', DR_TXN_ID)
  if (e3) { console.error('link bank DR failed:', e3); process.exit(1) }
  console.log(`Linked bank DR ${DR_TXN_ID.slice(0,8)} → expense ${created.id.slice(0,8)}`)

  const { error: e4 } = await supabase.from('expenses').update({
    voided_at:   new Date().toISOString(),
    void_reason: `Merged into ${created.voucher_no} (₹41,139 Senthil reimbursement bundle) — same ₹1,073 sump tap extension`,
  }).eq('id', OLD_1073_EXP_ID).is('voided_at', null)
  if (e4) { console.error('void EXP-2026-0018 failed:', e4); process.exit(1) }
  console.log(`Voided EXP-2026-0018 (superseded by ${created.voucher_no})`)
}

main().catch(e => { console.error(e); process.exit(1) })
