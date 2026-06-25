#!/usr/bin/env node
// Apply audit findings fixes. Idempotent; supports --dry-run.
//
//   node scripts/audit-apply-fixes.js --dry-run    # plan only, no writes
//   node scripts/audit-apply-fixes.js              # execute
//
// Active fixes (idempotent — re-runs are no-ops):
//  1. FD-interest rows: category='Maintenance'/flat_code='INTEREST' → category='FD Interest', flat_code=NULL.
//  2. Backfill plan_id = Corpus 2025 on corpus CRs where plan_id IS NULL.
//
// SPLIT_PAIRS is intentionally empty. A split-payment fix attempted on 2026-06-25
// for the 2025-05-07 and 2025-06-05 ICICI rows was reverted after the live bank
// balance ₹8,78,593.69 confirmed the original rows were correct (Power Query ETL
// had already split them at import time). See docs/audits/2026-06-25-auditor-review.md.
// Only add entries here after independently verifying that the bank rows are true
// full-amount duplicates of a single credit.

import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const DRY = process.argv.includes('--dry-run')

function loadEnv() {
  const raw = readFileSync(join(ROOT, '.env.local'), 'utf-8')
  return Object.fromEntries(raw.split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim()] }))
}
const env = loadEnv()
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const inr = (n) => '₹' + (n||0).toLocaleString('en-IN')

const ACTIVE_PLAN_ID = '16193835-1add-48da-be92-7725f7c46be3'   // Corpus 2025

const SPLIT_PAIRS = []   // see note above — empty by design

const FD_INTEREST_IDS_QUERY = (q) => q.eq('cr_dr', 'CR').eq('category', 'Maintenance').eq('flat_code', 'INTEREST').neq('row_type', 'VOIDED')

async function fixSplitPair(pair) {
  console.log(`\n→ Pair: ${pair.label}`)
  // Verify both originals still in expected state
  const { data: rows, error: e1 } = await sb.from('transactions')
    .select('id, value_date, amount, flat_code, row_type, description, posted_date, category, corpus, fiscal_year, fiscal_month, fiscal_label, source, upload_id')
    .in('id', pair.duplicate_ids)
  if (e1) throw new Error(e1.message)
  if (rows.length !== 2) { console.log(`  SKIP: expected 2 rows, found ${rows.length}`); return }
  for (const r of rows) {
    if (r.row_type === 'VOIDED') { console.log(`  SKIP: ${r.id} already VOIDED`); return }
    if (r.amount !== pair.original_amount) { console.log(`  SKIP: ${r.id} amount ${inr(r.amount)} ≠ expected ${inr(pair.original_amount)}`); return }
  }
  const ref = rows[0]   // template for inherited fields

  if (DRY) {
    console.log(`  WOULD VOID rows: ${pair.duplicate_ids.join(', ')}`)
    console.log(`  WOULD INSERT split_refs row (original_amount=${pair.original_amount}, split_count=${pair.splits.length})`)
    for (const s of pair.splits) console.log(`  WOULD INSERT SPLIT row: ${s.flat_code} ${inr(s.amount)} [${s.category}]`)
    return
  }

  // 1. Insert split_ref
  const refCode = `SPL-AUD-${Date.now().toString().slice(-7)}`
  const { data: splitRef, error: e2 } = await sb.from('split_refs').insert({
    ref_code: refCode,
    original_amount: pair.original_amount,
    split_count: pair.splits.length,
    notes: `Audit fix: was double-counted as two ${inr(pair.original_amount)} rows. Voided both, inserted ${pair.splits.length}-way split. (${ref.description?.slice(0, 100)})`,
  }).select('id').single()
  if (e2) throw new Error(`split_refs insert: ${e2.message}`)

  // 2. Void both duplicates
  const { error: e3 } = await sb.from('transactions').update({ row_type: 'VOIDED' }).in('id', pair.duplicate_ids)
  if (e3) throw new Error(`void: ${e3.message}`)

  // 3. Lookup flat_id for each split row
  const flatCodes = [...new Set(pair.splits.map(s => s.flat_code))]
  const { data: flats } = await sb.from('flats').select('id, code').in('code', flatCodes)
  const flatById = new Map(flats.map(f => [f.code, f.id]))

  // 4. Insert split rows
  const splitRows = pair.splits.map(s => ({
    value_date: ref.value_date,
    posted_date: ref.posted_date,
    description: `${ref.description} [${refCode}]`,
    cr_dr: 'CR',
    amount: s.amount,
    flat_id: flatById.get(s.flat_code) ?? null,
    flat_code: s.flat_code,
    category: s.category,
    corpus: s.corpus,
    fiscal_year: ref.fiscal_year,
    fiscal_month: ref.fiscal_month,
    fiscal_label: ref.fiscal_label,
    source: ref.source,
    upload_id: ref.upload_id,
    split_ref_id: splitRef.id,
    split_ref_code: refCode,
    row_type: 'SPLIT',
  }))
  const { error: e4 } = await sb.from('transactions').insert(splitRows)
  if (e4) throw new Error(`insert splits: ${e4.message}`)

  console.log(`  ✓ Voided 2 originals; inserted ${splitRows.length} SPLIT rows totalling ${inr(splitRows.reduce((s, r) => s + r.amount, 0))}`)
}

async function fixFdInterest() {
  console.log(`\n→ FD interest recategorisation`)
  const { data: rows } = await sb.from('transactions').select('id, value_date, amount, description').match({ cr_dr: 'CR', category: 'Maintenance', flat_code: 'INTEREST' }).neq('row_type', 'VOIDED')
  if (!rows || rows.length === 0) { console.log(`  SKIP: 0 rows match (likely already fixed)`); return }
  console.log(`  Found ${rows.length} rows totalling ${inr(rows.reduce((s, r) => s + r.amount, 0))}`)
  for (const r of rows) console.log(`    - ${r.value_date} ${inr(r.amount)} ${r.description?.slice(0, 80)}`)
  if (DRY) { console.log(`  WOULD UPDATE: SET category='FD Interest', flat_code=NULL`); return }
  const { error } = await sb.from('transactions').update({ category: 'FD Interest', flat_code: null })
    .match({ cr_dr: 'CR', category: 'Maintenance', flat_code: 'INTEREST' })
  if (error) throw new Error(error.message)
  console.log(`  ✓ Updated ${rows.length} rows`)
}

async function fixCorpusPlanId() {
  console.log(`\n→ Corpus plan_id backfill`)
  const { data: rows } = await sb.from('transactions').select('id, value_date, amount, flat_code')
    .eq('corpus', 'YES').eq('cr_dr', 'CR').is('plan_id', null).neq('row_type', 'VOIDED')
  if (!rows || rows.length === 0) { console.log(`  SKIP: 0 rows match`); return }
  console.log(`  Found ${rows.length} rows; total ${inr(rows.reduce((s, r) => s + r.amount, 0))}`)
  if (DRY) { console.log(`  WOULD UPDATE: SET plan_id='${ACTIVE_PLAN_ID}'`); return }
  const { error } = await sb.from('transactions').update({ plan_id: ACTIVE_PLAN_ID })
    .eq('corpus', 'YES').eq('cr_dr', 'CR').is('plan_id', null).neq('row_type', 'VOIDED')
  if (error) throw new Error(error.message)
  console.log(`  ✓ Updated ${rows.length} rows`)
}

async function main() {
  console.log(`# Audit fixes${DRY ? ' (DRY-RUN — no writes)' : ''}`)
  for (const p of SPLIT_PAIRS) await fixSplitPair(p)
  await fixFdInterest()
  await fixCorpusPlanId()
  console.log(`\nDone${DRY ? ' (dry-run)' : ''}.`)
}
main().catch(e => { console.error('FAILED:', e); process.exit(1) })
