#!/usr/bin/env node
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
function loadEnv() {
  const raw = readFileSync(join(ROOT, '.env.local'), 'utf-8')
  return Object.fromEntries(raw.split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim()] }))
}
const env = loadEnv()
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

async function main() {
  const { data: fd } = await sb.from('transactions').select('id, value_date, amount, cr_dr, category, flat_code, expense_id, description').eq('value_date', '2025-04-03').eq('amount', 50000)
  console.log('FD transfer row:'); for (const r of fd ?? []) console.log(`  - ${JSON.stringify(r)}`)

  const { data: ob } = await sb.from('transactions').select('id, value_date, amount, cr_dr, category, flat_code, description').eq('category', 'Opening Balance')
  console.log('\nOpening Balance rows in transactions:'); for (const r of ob ?? []) console.log(`  - ${JSON.stringify(r)}`)

  const { data: deposits } = await sb.from('deposits').select('*')
  console.log(`\nDeposits rows (${deposits?.length}):`); for (const r of deposits ?? []) console.log(`  - ${JSON.stringify(r)}`)
}
main().catch(e => { console.error(e); process.exit(1) })
