#!/usr/bin/env node
// Create 2 corpus expense entries for the Palani painting first instalment
// (₹1,000 token advance 2026-06-27 + ₹4,99,000 RTGS 2026-06-28) and link
// them to the existing bank DR transactions.
// Idempotent: skips DRs that already have a linked expense.

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

const PAINTING_CAT   = '4f7d21b8-b2b6-4ce7-8f3a-6f8b97a403a5'
const CORPUS_2025    = '16193835-1add-48da-be92-7725f7c46be3'
const PALANI_VENDOR  = '952d4a7e-cba6-41d5-be13-a0851af0796e'

const TARGETS = [
  { txnId: 'e9bc8738-0586-4572-af86-d3abb8ee47a9', date: '2026-06-27', amount: 1000,
    desc: 'Palani painting — token advance', ref: 'IMPS/617816726030' },
  { txnId: '8f0de058-86aa-426b-a1f3-af9a39d659a3', date: '2026-06-28', amount: 499000,
    desc: 'Palani painting — 1st instalment', ref: 'RTGS/ICICR42026062800503547' },
]

async function main() {
  for (const t of TARGETS) {
    const { data: dr, error } = await supabase
      .from('transactions')
      .select('id, value_date, amount, expense_id')
      .eq('id', t.txnId)
      .single()
    if (error) { console.error(`  FAIL fetch DR ${t.txnId.slice(0,8)}:`, error); continue }
    if (dr.expense_id) {
      console.log(`  SKIP ${t.date} ₹${t.amount}: DR already linked to expense ${dr.expense_id.slice(0,8)}`)
      continue
    }

    const expRow = {
      expense_date:         t.date,
      description:          t.desc,
      payee_type:           'Vendor',
      vendor_id:            PALANI_VENDOR,
      amount:               t.amount,
      payment_mode:         'Bank Transfer',
      reference_no:         t.ref,
      category_id:          PAINTING_CAT,
      corpus_plan_id:       CORPUS_2025,
      transaction_id:       t.txnId,
      reconciled_at:        new Date().toISOString(),
      reconciliation_notes: `Auto-matched to bank debit ${t.date}`,
      payment_status:       'paid',
      approval_status:      'approved',
      notes:                'Building painting first instalment to Palani (Corpus 2025 plan)',
    }

    const { data: created, error: e1 } = await supabase
      .from('expenses').insert(expRow).select('id, voucher_no').single()
    if (e1) { console.error(`  FAIL insert expense for ${t.date}:`, e1); continue }

    const { error: e2 } = await supabase.from('expense_line_items').insert({
      expense_id:     created.id,
      payee_type:     'Vendor',
      payee_name_raw: 'Palani Painting',
      description:    t.desc,
      category_id:    PAINTING_CAT,
      cost_center:    'Common',
      amount:         t.amount,
      paid_date:      t.date,
    })
    if (e2) { console.error(`  FAIL insert line item for ${t.date}:`, e2); continue }

    const { error: e3 } = await supabase.from('transactions').update({ expense_id: created.id }).eq('id', t.txnId)
    if (e3) { console.error(`  FAIL link bank DR for ${t.date}:`, e3); continue }

    console.log(`  ✓ Created ${created.voucher_no} for ${t.date} ₹${t.amount} → linked to DR ${t.txnId.slice(0,8)}`)
  }
  console.log('\nDone.')
}

main().catch(e => { console.error(e); process.exit(1) })
