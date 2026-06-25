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
  // Distinct categories used on transactions
  const { data: txCats } = await sb.from('transactions').select('category').neq('row_type', 'VOIDED').not('category', 'is', null)
  const setT = new Set((txCats ?? []).map(t => t.category))
  console.log('Distinct categories used on transactions:')
  for (const c of [...setT].sort()) console.log(`  - ${c}`)

  // expense_categories table
  const { data: ec } = await sb.from('expense_categories').select('name, type, is_active').order('name')
  console.log('\nexpense_categories rows:')
  for (const c of ec ?? []) console.log(`  - ${c.name}  type=${c.type}  active=${c.is_active}`)

  // Active corpus plan id
  const { data: plans } = await sb.from('corpus_plans').select('id, name, status').eq('status', 'active')
  console.log('\nActive corpus plans:')
  for (const p of plans ?? []) console.log(`  - ${p.id}  ${p.name}`)
}
main().catch(e => { console.error(e); process.exit(1) })
