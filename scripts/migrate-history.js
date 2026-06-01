#!/usr/bin/env node
// Historical data migration: Excel consolidate files → Supabase transactions table
// Usage:
//   node scripts/migrate-history.js            # live run
//   node scripts/migrate-history.js --dry-run  # preview only

import { readFileSync, readdirSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import xlsx from 'xlsx'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DRY_RUN = process.argv.includes('--dry-run')

// ── ENV ───────────────────────────────────────────────────────────────────────
function loadEnv() {
  const raw = readFileSync(join(ROOT, '.env.local'), 'utf-8')
  return Object.fromEntries(
    raw.split('\n')
      .filter(l => l.includes('=') && !l.startsWith('#'))
      .map(l => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim()] })
  )
}
const env = loadEnv()
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
if (!serviceKey) { console.error('Missing SUPABASE_SERVICE_ROLE_KEY in .env.local'); process.exit(1) }
const supabase = createClient(env.VITE_SUPABASE_URL, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ── HELPERS ───────────────────────────────────────────────────────────────────
function excelDateToISO(serial) {
  if (!serial || typeof serial !== 'number') return null
  return new Date((serial - 25569) * 86400 * 1000).toISOString().slice(0, 10)
}

const CAT_NORM = {
  'CCTV C MOTOR': 'CCTV/MOTOR',
  'cctv c motor': 'CCTV/MOTOR',
  'Expenses':     'EXPENSES',
}
function normalise(val) {
  const s = String(val ?? '').trim()
  return CAT_NORM[s] ?? s
}

// ── PSV PARSER (mirrors tagger.ts parsePipeStatement) ────────────────────────
function parsePipeStatement(rawText) {
  const lines = rawText.split(/\r?\n/)
  const results = []
  let headerFound = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.includes('Transaction ID') && trimmed.includes('Description')) {
      headerFound = true; continue
    }
    if (!headerFound) continue
    const cols = trimmed.split('|')
    if (cols.length < 8) continue
    if (!/^\d+$/.test(cols[0].trim())) continue
    const crDr = cols[6].trim().toUpperCase()
    if (crDr !== 'CR' && crDr !== 'DR') continue
    results.push({
      txnId:       cols[1].trim(),
      description: cols[5].trim(),
    })
  }
  return results
}

// ── BUILD PSV TXN-ID LOOKUP ───────────────────────────────────────────────────
function buildPsvTxnMap() {
  const map = new Map()
  const dataDir = join(ROOT, 'data')
  for (const file of readdirSync(dataDir)) {
    if (!/\.(psv|txt)$/i.test(file)) continue
    try {
      const raw = readFileSync(join(dataDir, file), 'utf-8')
      for (const { txnId, description } of parsePipeStatement(raw)) {
        if (txnId && description) map.set(description, txnId)
      }
      console.log(`  PSV: ${file} → ${map.size} txn-id entries so far`)
    } catch { /* skip unreadable files */ }
  }
  return map
}

// ── LOAD EXCEL ROWS ───────────────────────────────────────────────────────────
function loadExcelRows(psvTxnMap) {
  const wb = xlsx.readFile(join(ROOT, 'data', 'Consolidate statement 2026to2027.xlsx'))
  const rows = []

  // Source 1: All Statements — fiscal_year 2025 rows (Apr-25 to Mar-26, no txn_id)
  const wsAll = wb.Sheets['All Statements']
  const allData = xlsx.utils.sheet_to_json(wsAll, { header: 1, defval: '' })
  let s1count = 0
  for (let i = 1; i < allData.length; i++) {
    const r = allData[i]
    if (r[0] === '') continue
    if (r[9] !== 2025) continue       // only FY 2025-26 from this source
    const desc = String(r[3]).trim()
    const flatCode = normalise(r[1])
    const category = r[6] !== '' ? String(r[6]).trim() : normalise(r[1])
    rows.push({
      txn_id:       psvTxnMap.get(desc) ?? null,
      value_date:   excelDateToISO(r[0]),
      posted_date:  r[2] ? excelDateToISO(Math.floor(r[2])) : null,
      description:  desc,
      cr_dr:        String(r[4]).trim(),
      corpus:       String(r[5]).trim() || 'NO',
      category,
      amount:       Number(r[7]),
      flat_code:    flatCode,
      fiscal_year:  r[9],
      fiscal_month: String(r[10]).trim(),
      fiscal_label: String(r[12]).trim(),
      source:       'Historical',
      row_type:     'Normal',
    })
    s1count++
  }
  console.log(`  Source 1 (All Statements, FY2025): ${s1count} rows`)

  // Source 2: Statements 2026 2027 — Apr-26 to May-26 with txn_ids
  const ws27 = wb.Sheets['Statements 2026 2027']
  const range27 = xlsx.utils.decode_range(ws27['!ref'] || 'A1')
  const data27 = xlsx.utils.sheet_to_json(ws27, { header: 1, defval: '', range: { s: { r: 0, c: 0 }, e: { r: Math.min(range27.e.r, 5000), c: range27.e.c } } })
  let s2count = 0
  for (let i = 1; i < data27.length; i++) {
    const r = data27[i]
    if (r[0] === '' && r[1] === '') continue
    const desc = String(r[4]).trim()
    const flatCode = normalise(r[2])
    const category = r[7] !== '' ? String(r[7]).trim() : normalise(r[2])
    rows.push({
      txn_id:       String(r[0]).trim() || null,
      value_date:   excelDateToISO(r[1]),
      posted_date:  r[3] ? excelDateToISO(Math.floor(r[3])) : null,
      description:  desc,
      cr_dr:        String(r[5]).trim(),
      corpus:       String(r[6]).trim() || 'NO',
      category,
      amount:       Number(r[8]),
      flat_code:    flatCode,
      fiscal_year:  r[10],
      fiscal_month: String(r[11]).trim(),
      fiscal_label: String(r[13]).trim(),
      source:       'Historical',
      row_type:     'Normal',
    })
    s2count++
  }
  console.log(`  Source 2 (Statements 2026 2027): ${s2count} rows`)

  return rows
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`Lilac Apartments — Historical Data Migration`)
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`)
  console.log('─'.repeat(60))

  // 1. Build PSV txn-id lookup
  console.log('\n[1] Scanning PSV files for Transaction IDs…')
  const psvTxnMap = buildPsvTxnMap()
  console.log(`    ${psvTxnMap.size} descriptions mapped to txn_ids from PSV files`)

  // 2. Load Excel rows
  console.log('\n[2] Reading Excel…')
  const rows = loadExcelRows(psvTxnMap)
  console.log(`    Total rows to process: ${rows.length}`)

  // 3. Load existing txn_ids and description+date dedup keys from Supabase
  console.log('\n[3] Fetching existing transactions from Supabase for dedup…')
  const { data: existing, error: fetchErr } = await supabase
    .from('transactions')
    .select('txn_id, description, value_date, amount')
    .eq('source', 'Historical')
  if (fetchErr) {
    // If no rows yet, treat as empty
    if (!fetchErr.message?.includes('No rows')) {
      console.warn('    Warning fetching existing:', fetchErr.message)
    }
  }
  const existingTxnIds = new Set((existing ?? []).filter(r => r.txn_id).map(r => r.txn_id))
  const existingNoId   = new Set(
    (existing ?? [])
      .filter(r => !r.txn_id)
      .map(r => `${r.description}|${r.value_date}`)
  )
  console.log(`    Existing rows: ${(existing ?? []).length} (${existingTxnIds.size} with txn_id, ${existingNoId.size} without)`)

  // 4. Filter duplicates
  const toInsert = []
  let skipped = 0
  for (const row of rows) {
    if (row.txn_id && existingTxnIds.has(row.txn_id)) { skipped++; continue }
    if (!row.txn_id && existingNoId.has(`${row.description}|${row.value_date}`)) { skipped++; continue }
    if (!row.value_date) { console.warn('    Skipping row with no value_date:', row.description); skipped++; continue }
    toInsert.push(row)
  }
  console.log(`\n[4] Dedup result:`)
  console.log(`    To insert : ${toInsert.length}`)
  console.log(`    Skipped   : ${skipped} (already exist)`)

  // Breakdown by fiscal_label
  const breakdown = {}
  toInsert.forEach(r => { breakdown[r.fiscal_label] = (breakdown[r.fiscal_label] || 0) + 1 })
  if (Object.keys(breakdown).length) {
    console.log('\n    Rows by month:')
    Object.entries(breakdown).sort(([a],[b]) => a.localeCompare(b)).forEach(([k, v]) => {
      console.log(`      ${k.padEnd(8)} ${v}`)
    })
  }

  // Count PSV-enriched txn_ids
  const withTxnId = toInsert.filter(r => r.txn_id).length
  console.log(`\n    Rows with txn_id : ${withTxnId} (${toInsert.length - withTxnId} without)`)

  if (DRY_RUN) {
    console.log('\n─'.repeat(60))
    console.log('DRY RUN complete — no data written.')
    console.log('Run without --dry-run to insert.')
    return
  }

  if (toInsert.length === 0) {
    console.log('\nNothing to insert — database is already up to date.')
    return
  }

  // 5. Get flat_id lookup
  const { data: flats } = await supabase.from('flats').select('id,code')
  const flatMap = new Map((flats ?? []).map(f => [f.code, f.id]))

  // Attach flat_id
  toInsert.forEach(r => { r.flat_id = flatMap.get(r.flat_code) ?? null })

  // 6. Batch insert
  console.log('\n[5] Inserting…')
  const BATCH = 100
  let inserted = 0
  let errors = 0
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH)
    const { error } = await supabase.from('transactions').insert(batch)
    if (error) {
      console.error(`    Batch ${Math.floor(i/BATCH)+1} error:`, error.message)
      errors += batch.length
    } else {
      inserted += batch.length
      process.stdout.write(`\r    ${inserted}/${toInsert.length} inserted…`)
    }
  }
  console.log(`\n\n${'─'.repeat(60)}`)
  console.log(`Migration complete`)
  console.log(`  Inserted : ${inserted}`)
  console.log(`  Skipped  : ${skipped}`)
  console.log(`  Errors   : ${errors}`)
  console.log('─'.repeat(60))
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
