#!/usr/bin/env node
// Drill-downs for audit findings that need detail.
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
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const inr = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN')

async function fetchAll(table, select, filters = (q) => q) {
  let out = [], from = 0, page = 1000
  while (true) {
    let q = sb.from(table).select(select).range(from, from + page - 1).order('id', { ascending: true })
    q = filters(q)
    const { data, error } = await q
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < page) break
    from += page
  }
  return out
}

async function main() {
  // 1) Unmatched Maintenance CRs — list them with descriptions and any flat_code value present
  const flats = await fetchAll('flats', 'code')
  const codes = new Set(flats.map(f => f.code))
  const maintCR = await fetchAll('transactions', 'id, value_date, amount, flat_code, description, fiscal_year',
    q => q.eq('cr_dr', 'CR').eq('category', 'Maintenance').neq('row_type', 'VOIDED'))
  const orphans = maintCR.filter(t => !t.flat_code || !codes.has(t.flat_code))
  console.log(`\n## Unmatched Maintenance CRs (${orphans.length}, ${inr(orphans.reduce((s, t) => s + t.amount, 0))})`)
  for (const t of orphans) {
    console.log(`  - ${t.value_date}  flat_code='${t.flat_code ?? ''}'  ${inr(t.amount)}  ${t.description?.slice(0, 100)}`)
  }

  // 2) The two duplicate transactions — full row
  console.log(`\n## Suspected duplicate transactions (full rows)`)
  const dupSpec = [
    { date: '2025-05-07', amt: 1550, cr_dr: 'CR' },
    { date: '2025-06-05', amt: 1550, cr_dr: 'CR' },
  ]
  for (const s of dupSpec) {
    const { data } = await sb.from('transactions').select('id, value_date, amount, cr_dr, flat_code, description, row_type, fiscal_year, category, expense_id, created_at').eq('value_date', s.date).eq('amount', s.amt).eq('cr_dr', s.cr_dr)
    for (const r of data ?? []) console.log(`  - id=${r.id}  ${r.value_date}  ${r.cr_dr}  ${inr(r.amount)}  flat=${r.flat_code}  cat=${r.category}  row_type=${r.row_type}  created=${r.created_at?.slice(0,10)}  desc=${r.description?.slice(0,90)}`)
  }

  // 3) Opening balance settings — what's there?
  const { data: settings } = await sb.from('app_settings').select('key, value').order('key')
  console.log(`\n## All app_settings keys`)
  for (const s of settings ?? []) {
    const v = (s.value ?? '').toString()
    console.log(`  - ${s.key.padEnd(36)} = ${v.length > 80 ? v.slice(0, 80) + '…' : v}`)
  }

  // 4) The bank-mode unreconciled expense and the unreconciled DR
  const { data: badExp } = await sb.from('expenses').select('*').eq('voucher_no', 'EXP-2026-0018').single()
  console.log(`\n## EXP-2026-0018 (bank-mode, unreconciled)`)
  console.log(`  - date=${badExp?.expense_date}  ${badExp?.payment_mode}  ${inr(badExp?.amount)}  ref=${badExp?.reference_no ?? '-'}  desc=${badExp?.description}`)

  const { data: unrecDR } = await sb.from('transactions').select('id, value_date, amount, description').eq('cr_dr', 'DR').is('expense_id', null).neq('row_type', 'VOIDED')
  console.log(`\n## Unreconciled DRs`)
  for (const t of unrecDR ?? []) console.log(`  - ${t.value_date}  ${inr(t.amount)}  ${t.description?.slice(0, 100)}`)

  // 5) Current FY pace check — FY 2026 = Apr 2026 onwards
  const { data: fy26 } = await sb.from('transactions').select('value_date, amount, cr_dr, category, corpus, description').eq('fiscal_year', 2026).neq('row_type', 'VOIDED')
  const fy26CR = (fy26 ?? []).filter(t => t.cr_dr === 'CR')
  const fy26DR = (fy26 ?? []).filter(t => t.cr_dr === 'DR')
  const fy26MaintCR = fy26CR.filter(t => t.category === 'Maintenance').reduce((s, t) => s + t.amount, 0)
  const fy26CorpusCR = fy26CR.filter(t => t.corpus === 'YES').reduce((s, t) => s + t.amount, 0)
  console.log(`\n## FY 2026-27 (Apr–Jun 2026) cash flow`)
  console.log(`  - CR count=${fy26CR.length}, total=${inr(fy26CR.reduce((s, t) => s + t.amount, 0))}`)
  console.log(`    - Maintenance CR: ${inr(fy26MaintCR)}`)
  console.log(`    - Corpus CR:      ${inr(fy26CorpusCR)}`)
  console.log(`  - DR count=${fy26DR.length}, total=${inr(fy26DR.reduce((s, t) => s + t.amount, 0))}`)
  const fy26TopDRs = [...fy26DR].sort((a, b) => b.amount - a.amount).slice(0, 8)
  console.log(`  - Top 8 DRs in FY 2026-27:`)
  for (const t of fy26TopDRs) console.log(`    - ${t.value_date}  ${inr(t.amount)}  ${t.description?.slice(0, 80)}`)

  // 6) Corpus plan_id usage — which 2 CRs have plan_id set vs which 63 don't
  const { data: corpusCR } = await sb.from('transactions').select('value_date, amount, plan_id, flat_code, description').eq('corpus', 'YES').eq('cr_dr', 'CR').neq('row_type', 'VOIDED')
  const withPlan = (corpusCR ?? []).filter(t => t.plan_id)
  const nullPlan = (corpusCR ?? []).filter(t => !t.plan_id)
  console.log(`\n## Corpus CRs plan_id usage: ${withPlan.length} have plan_id, ${nullPlan.length} are NULL`)
  console.log(`  Plan_id is set on:`)
  for (const t of withPlan) console.log(`    - ${t.value_date}  ${t.flat_code}  ${inr(t.amount)}  plan=${t.plan_id?.slice(0, 8)}`)
}
main().catch(e => { console.error(e); process.exit(1) })
