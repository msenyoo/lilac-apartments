#!/usr/bin/env node
// Manually resume a paused (free-tier auto-paused) Supabase project.
// Usage:
//   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/resume-supabase.js         (defaults to prod)
//   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/resume-supabase.js dev
//
// Get a PAT from https://supabase.com/dashboard/account/tokens if you don't have one.

const PAT = process.env.SUPABASE_ACCESS_TOKEN
if (!PAT) {
  console.error('SUPABASE_ACCESS_TOKEN env var required. Get a PAT from https://supabase.com/dashboard/account/tokens')
  process.exit(1)
}

const REFS = {
  prod: 'aulttcsvxzcwyceezzpz',
  dev: 'qcoezjcwrsqchulqgydm',
}

const target = process.argv[2] || 'prod'
const ref = REFS[target]
if (!ref) {
  console.error(`Unknown target "${target}". Use "prod" or "dev".`)
  process.exit(1)
}

async function getStatus() {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}`, {
    headers: { Authorization: `Bearer ${PAT}` },
  })
  if (!res.ok) throw new Error(`Status check failed: HTTP ${res.status} ${await res.text()}`)
  const json = await res.json()
  return json.status
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const status = await getStatus()
console.log(`${target} (${ref}) status: ${status}`)

if (status === 'ACTIVE_HEALTHY') {
  console.log('Already active — nothing to do.')
  process.exit(0)
}

console.log('Triggering restore…')
const restoreRes = await fetch(`https://api.supabase.com/v1/projects/${ref}/restore`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
  body: '{}',
})
if (!restoreRes.ok) {
  console.error(`Restore request failed: HTTP ${restoreRes.status} ${await restoreRes.text()}`)
  process.exit(1)
}

const maxWaitMs = 5 * 60 * 1000
const pollIntervalMs = 15 * 1000
const start = Date.now()

while (Date.now() - start < maxWaitMs) {
  await sleep(pollIntervalMs)
  const s = await getStatus()
  console.log(`  … ${s}`)
  if (s === 'ACTIVE_HEALTHY') {
    console.log('Project is back up.')
    process.exit(0)
  }
}

console.error('Timed out waiting for project to become ACTIVE_HEALTHY. Check the Supabase dashboard.')
process.exit(1)
