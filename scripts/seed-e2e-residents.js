#!/usr/bin/env node
// Seed synthetic residents on the DEV DB for the relationships e2e tests.
//   AG1 — owner + spouse + tenant (all active) + one moved-out past tenant.
//   AF1 — "movable" tenant pair; reset to active each run (the group
//         move-out e2e test moves them out, so re-run this before the suite).
//   contacts flat — first flat with outstanding > 0 (not AG1/AF1) gets an
//         owner + tenant with phones; its code lands in e2e/fixtures.json.
// All names are E2E-prefixed synthetic fixtures — no real resident data.

import { readFileSync, writeFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

function loadEnv(file) {
  const raw = readFileSync(join(ROOT, file), 'utf-8')
  return Object.fromEntries(
    raw.split('\n')
      .filter(l => l.includes('=') && !l.startsWith('#'))
      .map(l => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim()] })
  )
}

const env = loadEnv('.env.dev.local')
if (!env.VITE_SUPABASE_URL.includes('qcoezjcwrsqchulqgydm')) {
  console.error('Refusing to run: .env.dev.local does not point at the dev project')
  process.exit(1)
}
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function flatIdOf(code) {
  const { data, error } = await supabase.from('flats').select('id').eq('code', code).single()
  if (error) { console.error(`${code}: ${error.message}`); process.exit(1) }
  return data.id
}

// Idempotent by (flat_id, name): update to the desired state, or insert.
async function ensureResident(flat_id, fields) {
  const { data: existing } = await supabase.from('residents')
    .select('id').eq('flat_id', flat_id).eq('name', fields.name).maybeSingle()
  const row = { flat_id, upi_ids: [], email: null, notes: 'E2E fixture', ...fields }
  if (existing) {
    const { error } = await supabase.from('residents').update(row).eq('id', existing.id)
    if (error) { console.error(`${fields.name}: ${error.message}`); process.exit(1) }
    console.log(`updated  ${fields.name}`)
  } else {
    const { error } = await supabase.from('residents').insert(row)
    if (error) { console.error(`${fields.name}: ${error.message}`); process.exit(1) }
    console.log(`inserted ${fields.name}`)
  }
}

const ag1 = await flatIdOf('AG1')
await ensureResident(ag1, { name: 'E2E Owner One',    type: 'Owner',  relation: 'Self',   phone: '9000000001', is_active: true,  moved_in: '2020-06-01', moved_out: null })
await ensureResident(ag1, { name: 'E2E Owner Spouse', type: 'Owner',  relation: 'Spouse', phone: '9000000002', is_active: true,  moved_in: '2020-06-01', moved_out: null })
await ensureResident(ag1, { name: 'E2E Tenant One',   type: 'Tenant', relation: 'Self',   phone: '9000000003', is_active: true,  moved_in: '2025-02-01', moved_out: null })
await ensureResident(ag1, { name: 'E2E Past Tenant',  type: 'Tenant', relation: 'Self',   phone: null,         is_active: false, moved_in: '2024-01-01', moved_out: '2025-01-31' })

const af1 = await flatIdOf('AF1')
await ensureResident(af1, { name: 'E2E Movable Self',   type: 'Tenant', relation: 'Self',   phone: null, is_active: true, moved_in: '2025-05-01', moved_out: null })
await ensureResident(af1, { name: 'E2E Movable Spouse', type: 'Tenant', relation: 'Spouse', phone: null, is_active: true, moved_in: '2025-05-01', moved_out: null })

const { data: dues, error: de } = await supabase
  .from('v_dues_tracker').select('flat_code, total_outstanding')
  .gt('total_outstanding', 0).order('flat_code')
if (de) { console.error(de.message); process.exit(1) }
const contactsFlat = (dues ?? []).map(d => d.flat_code).find(c => c !== 'AG1' && c !== 'AF1')
if (!contactsFlat) { console.error('No flat with outstanding > 0 found for the contacts fixture'); process.exit(1) }
const cf = await flatIdOf(contactsFlat)
await ensureResident(cf, { name: 'E2E Contact Owner',  type: 'Owner',  relation: 'Self', phone: '9000000011', is_active: true, moved_in: null, moved_out: null })
await ensureResident(cf, { name: 'E2E Contact Tenant', type: 'Tenant', relation: 'Self', phone: '9000000012', is_active: true, moved_in: null, moved_out: null })

writeFileSync(join(ROOT, 'e2e', 'fixtures.json'), JSON.stringify({ contactsFlat }, null, 2))
console.log(`\ncontacts flat: ${contactsFlat} (written to e2e/fixtures.json)`)
console.log('Done.')
