#!/usr/bin/env node
// One-off: backfill period_from/period_to on EB (Electricity) line items whose
// billing period was only ever captured as free text in the description
// ("A block EB — Mar–Apr 2025"), and trim that description down to just the
// block label now that the period lives in dedicated columns. Idempotent —
// rows without the " — <period>" suffix are skipped.

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
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const MONTHS = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
}
const LAST_DAY = { '01': '31', '02': '28', '03': '31', '04': '30', '05': '31', '06': '30', '07': '31', '08': '31', '09': '30', '10': '31', '11': '30', '12': '31' }

const DRY_RUN = !process.argv.includes('--apply')

async function main() {
  const { data: rows, error } = await supabase
    .from('expense_line_items')
    .select('id, description')
    .ilike('description', '% block EB — %')

  if (error) throw error

  const re = /^([A-E]) block EB — ([A-Za-z]{3})–([A-Za-z]{3}) (\d{4})$/
  const updates = []
  for (const row of rows) {
    const m = row.description.match(re)
    if (!m) {
      console.log('SKIP (no match):', row.id, row.description)
      continue
    }
    const [, block, m1, m2, year] = m
    const mo1 = MONTHS[m1]
    const mo2 = MONTHS[m2]
    if (!mo1 || !mo2) {
      console.log('SKIP (bad month):', row.id, row.description)
      continue
    }
    const periodFrom = `${year}-${mo1}-01`
    const periodTo = `${year}-${mo2}-${LAST_DAY[mo2]}`
    const newDescription = `${block} block EB`
    updates.push({ id: row.id, old: row.description, newDescription, periodFrom, periodTo })
  }

  console.log(`${updates.length} rows to update (of ${rows.length} matched by ILIKE):`)
  for (const u of updates) {
    console.log(`  ${u.old}  ->  "${u.newDescription}"  [${u.periodFrom} .. ${u.periodTo}]`)
  }

  if (DRY_RUN) {
    console.log('\nDry run only — pass --apply to write.')
    return
  }

  for (const u of updates) {
    const { error: updErr } = await supabase
      .from('expense_line_items')
      .update({ description: u.newDescription, period_from: u.periodFrom, period_to: u.periodTo })
      .eq('id', u.id)
    if (updErr) {
      console.error('FAILED', u.id, updErr)
    } else {
      console.log('OK', u.id)
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
