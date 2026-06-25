#!/usr/bin/env node
// Check rates + maintenance history for the suspected split-payment flats.
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

function loadEnv() {
  const raw = readFileSync(join(ROOT, '.env.local'), 'utf-8')
  return Object.fromEntries(
    raw.split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
      .map(l => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim()] })
  )
}
const env = loadEnv()
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const inr = (n) => '₹' + (n||0).toLocaleString('en-IN')

async function main() {
  const codes = ['CS2', 'DF2', 'CF2', 'DF1']
  for (const c of codes) {
    const { data: f } = await sb.from('flats').select('id, code, maintenance_amt, block, flat_type, bhk_type').eq('code', c).single()
    if (!f) { console.log(`${c}: not found`); continue }
    const { data: rates } = await sb.from('maintenance_rate_history').select('monthly_rate, effective_from, effective_to').eq('flat_id', f.id).order('effective_from')
    console.log(`${f.code} (${f.block} ${f.flat_type} ${f.bhk_type}) flats.maintenance_amt=${inr(f.maintenance_amt)}`)
    for (const r of rates ?? []) console.log(`  rate ${inr(r.monthly_rate)} from ${r.effective_from} to ${r.effective_to ?? 'open'}`)
    // All maintenance CRs for this flat in 2025-04 → 2025-07
    const { data: txns } = await sb.from('transactions').select('value_date, amount, category, description').eq('flat_code', c).eq('cr_dr', 'CR').gte('value_date', '2025-04-01').lte('value_date', '2025-07-31').neq('row_type', 'VOIDED').order('value_date')
    console.log(`  CRs Apr-Jul 2025:`)
    for (const t of txns ?? []) console.log(`    ${t.value_date}  ${inr(t.amount)}  [${t.category}]  ${t.description?.slice(0,80)}`)
    console.log()
  }
}
main().catch(e => { console.error(e); process.exit(1) })
