#!/usr/bin/env node
// Sweep all CR pairs that have same (date, amount) but different flat_codes -
// these are the candidates where ONE bank credit was duplicated as N rows.
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
const inr = (n) => '₹' + (n||0).toLocaleString('en-IN')

async function fetchAll(table, select, filters = (q) => q) {
  let out = [], from = 0, page = 1000
  while (true) {
    let q = sb.from(table).select(select).range(from, from + page - 1).order('id', { ascending: true })
    q = filters(q); const { data, error } = await q
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < page) break
    from += page
  }
  return out
}

async function main() {
  const flats = await fetchAll('flats', 'code')
  const codes = new Set(flats.map(f => f.code))

  // All non-voided CR transactions
  const txns = await fetchAll('transactions', 'id, value_date, amount, flat_code, description, category, corpus, created_at',
    q => q.eq('cr_dr', 'CR').neq('row_type', 'VOIDED'))

  // Group by (date, amount)
  const groups = new Map()
  for (const t of txns) {
    const k = `${t.value_date}|${t.amount}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(t)
  }

  // Suspect groups: 2+ rows with SAME amount on SAME date but DIFFERENT flat codes.
  // For each such group, check if rows share an exact UPI reference (in description),
  // because that proves they're the same bank credit.
  const suspect = []
  for (const [k, rows] of groups) {
    if (rows.length < 2) continue
    const codesUsed = new Set(rows.map(r => r.flat_code).filter(Boolean))
    if (codesUsed.size < 2) continue
    // Extract a UPI ref token from each description (12-digit ref or hash after UPI/)
    const refOf = (d) => {
      const m1 = d?.match(/UPI\/(\d{6,})/i); if (m1) return m1[1]
      const m2 = d?.match(/IMPS\/(\d{6,})/i); if (m2) return m2[1]
      return null
    }
    const refGroups = new Map()
    for (const r of rows) {
      const ref = refOf(r.description)
      if (!ref) continue
      if (!refGroups.has(ref)) refGroups.set(ref, [])
      refGroups.get(ref).push(r)
    }
    for (const [ref, sharedRows] of refGroups) {
      if (sharedRows.length >= 2) {
        suspect.push({ date: sharedRows[0].value_date, amount: sharedRows[0].amount, ref, rows: sharedRows })
      }
    }
  }

  console.log(`# Split-payment sweep`)
  console.log(`Total CR transactions scanned: ${txns.length}`)
  console.log(`Same-date+amount groups: ${[...groups.values()].filter(g => g.length > 1).length}`)
  console.log(`Confirmed split-payment cases (same UPI/IMPS ref appears on 2+ rows with different flat codes):`)
  console.log(`Total cases: ${suspect.length}`)
  console.log()

  let inflation = 0
  for (const c of suspect) {
    console.log(`## ${c.date}  ${inr(c.amount)}  ref=${c.ref}`)
    for (const r of c.rows) {
      console.log(`  - id=${r.id}  flat=${r.flat_code}  [${r.category}${r.corpus === 'YES' ? '/corpus' : ''}]  ${r.description?.slice(0, 90)}`)
    }
    inflation += c.amount * (c.rows.length - 1)
    console.log()
  }
  console.log(`Total over-counting inflation if all are single-credit duplicates: ${inr(inflation)}`)
}
main().catch(e => { console.error(e); process.exit(1) })
