#!/usr/bin/env node
// Revert the 2026-06-25 split-payment fix from scripts/audit-apply-fixes.js.
// Actual bank balance ₹8,78,593.69 confirmed the original two ₹1,550 rows per pair
// were NOT duplicates of one credit. Restoring pre-fix state.
//
//   node scripts/audit-revert-split-fix.js --dry-run
//   node scripts/audit-revert-split-fix.js

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
const inr = (n) => '₹' + (n || 0).toLocaleString('en-IN')

const VOIDED_ORIGINAL_IDS = [
  '33761123-4182-4579-ad62-1e20a1370058',  // 2025-05-07 DF2
  'a638f158-ddbe-4eb2-9d25-326a778f5382',  // 2025-05-07 CS2
  '6b54312f-a70c-4be1-902e-f031a5713054',  // 2025-06-05 CS2
  'cc98ed84-80ef-404e-94c8-094a28307411',  // 2025-06-05 DF2
]

async function main() {
  console.log(`# Revert split-payment fix${DRY ? ' (DRY-RUN)' : ''}\n`)

  // 1. Find the SPLIT rows we inserted (identified by split_ref_code starting SPL-AUD-)
  const { data: splitRows } = await sb.from('transactions').select('id, value_date, amount, flat_code, split_ref_id, split_ref_code')
    .like('split_ref_code', 'SPL-AUD-%')
  console.log(`SPLIT rows inserted by audit fix: ${splitRows?.length ?? 0}`)
  for (const r of splitRows ?? []) console.log(`  - ${r.value_date} ${r.flat_code} ${inr(r.amount)} ref=${r.split_ref_code}`)

  const splitRefIds = [...new Set((splitRows ?? []).map(r => r.split_ref_id).filter(Boolean))]
  console.log(`Linked split_refs rows: ${splitRefIds.length}`)

  // 2. Verify the 4 originals are still VOIDED
  const { data: originals } = await sb.from('transactions').select('id, value_date, amount, flat_code, row_type').in('id', VOIDED_ORIGINAL_IDS)
  console.log(`\nOriginals to un-void: ${originals?.length ?? 0}`)
  for (const r of originals ?? []) console.log(`  - ${r.value_date} ${r.flat_code} ${inr(r.amount)} row_type=${r.row_type}`)

  if (DRY) {
    console.log(`\nWOULD DELETE ${splitRows?.length ?? 0} SPLIT transactions`)
    console.log(`WOULD DELETE ${splitRefIds.length} split_refs rows`)
    console.log(`WOULD UPDATE ${originals?.length ?? 0} originals: row_type → 'Normal'`)
    return
  }

  // 3. Delete SPLIT rows
  if (splitRows && splitRows.length > 0) {
    const { error } = await sb.from('transactions').delete().in('id', splitRows.map(r => r.id))
    if (error) throw new Error(`delete splits: ${error.message}`)
    console.log(`\n✓ Deleted ${splitRows.length} SPLIT rows`)
  }

  // 4. Delete split_refs rows
  if (splitRefIds.length > 0) {
    const { error } = await sb.from('split_refs').delete().in('id', splitRefIds)
    if (error) throw new Error(`delete split_refs: ${error.message}`)
    console.log(`✓ Deleted ${splitRefIds.length} split_refs rows`)
  }

  // 5. Un-void originals
  const { error } = await sb.from('transactions').update({ row_type: 'Normal' }).in('id', VOIDED_ORIGINAL_IDS)
  if (error) throw new Error(`unvoid: ${error.message}`)
  console.log(`✓ Restored ${VOIDED_ORIGINAL_IDS.length} originals to row_type='Normal'`)

  console.log(`\nDone.`)
}
main().catch(e => { console.error('FAILED:', e); process.exit(1) })
