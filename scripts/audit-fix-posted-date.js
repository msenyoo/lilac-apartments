#!/usr/bin/env node
// Recover corrupted `posted_date` values caused by a bankDateToISO() bug: it assumed
// ICICI's "Txn Posted Date" column was always DD/MM/YYYY, but the column actually
// includes a time-of-day suffix (e.g. "01/07/2026 06:34:42 AM"). Splitting that on '/'
// produced garbage like "2026 06:34:42 AM-07-01" — the original date+time is still
// embedded in the garbled string, just reordered, so it's fully recoverable.
//
//   node scripts/audit-fix-posted-date.js --dry-run                       # print recovered mapping only
//   node scripts/audit-fix-posted-date.js --dry-run --from=2026-07-01 --to=2026-07-31
//   node scripts/audit-fix-posted-date.js --from=2026-07-01 --to=2026-07-31   # execute, scoped
//   node scripts/audit-fix-posted-date.js                                 # execute, all corrupted rows
//
// Only touches rows whose posted_date matches the known corruption pattern; anything
// else (clean 'Historical'/'Manual Entry' rows) is left untouched. --from/--to filter
// by value_date (inclusive) so a batch can be applied and spot-checked before widening scope.

import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const DRY = process.argv.includes('--dry-run')
const argVal = (name) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? null
const FROM = argVal('from')
const TO   = argVal('to')

function loadEnv() {
  const raw = readFileSync(join(ROOT, '.env.local'), 'utf-8')
  return Object.fromEntries(raw.split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim()] }))
}
const env = loadEnv()
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

// Corrupted shape: "<YYYY> <HH>:<MM>:<SS> <AM|PM>-<MM>-<DD>"
const CORRUPT_RE = /^(\d{4}) (\d{2}):(\d{2}):(\d{2}) (AM|PM)-(\d{2})-(\d{2})$/

function recover(corrupted) {
  const m = corrupted.match(CORRUPT_RE)
  if (!m) return null
  const [, year, hh12Str, mm, ss, ampm, month, day] = m
  let hh = parseInt(hh12Str, 10)
  if (ampm === 'PM' && hh !== 12) hh += 12
  if (ampm === 'AM' && hh === 12) hh = 0
  return {
    posted_date: `${year}-${month}-${day}`,
    posted_time: `${String(hh).padStart(2, '0')}:${mm}:${ss}`,
  }
}

async function main() {
  console.log(`# Fix corrupted posted_date${DRY ? ' (DRY-RUN — no writes)' : ''}${FROM || TO ? ` [value_date ${FROM ?? '…'} to ${TO ?? '…'}]` : ''}`)

  let query = sb.from('transactions').select('id, value_date, description, posted_date, row_type, source')
  if (FROM) query = query.gte('value_date', FROM)
  if (TO)   query = query.lte('value_date', TO)
  const { data: rows, error } = await query
  if (error) throw new Error(error.message)

  const targets = []
  for (const r of rows) {
    if (!r.posted_date) continue
    const recovered = recover(r.posted_date)
    if (recovered) targets.push({ ...r, recovered })
  }

  console.log(`Found ${targets.length} corrupted rows out of ${rows.length} total.\n`)
  for (const t of targets.slice(0, 20)) {
    console.log(`  [${t.row_type}] ${t.value_date}  "${t.posted_date}"  →  date=${t.recovered.posted_date} time=${t.recovered.posted_time}   ${t.description?.slice(0, 60)}`)
  }
  if (targets.length > 20) console.log(`  ... and ${targets.length - 20} more`)

  if (DRY) { console.log(`\nWOULD UPDATE ${targets.length} rows: SET posted_date=<recovered date>, posted_time=<recovered time>`); return }

  for (const t of targets) {
    const { error: uErr } = await sb.from('transactions').update({
      posted_date: t.recovered.posted_date,
      posted_time: t.recovered.posted_time,
    }).eq('id', t.id)
    if (uErr) throw new Error(`update ${t.id}: ${uErr.message}`)
  }
  console.log(`✓ Updated ${targets.length} rows`)
}
main().catch(e => { console.error('FAILED:', e); process.exit(1) })
