#!/usr/bin/env node
// Apply a single SQL migration via the Supabase Management API.
// Usage:
//   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/apply-migration.js supabase/migrations/033_calc_primitives.sql
//   SUPABASE_ACCESS_TOKEN=sbp_... SUPABASE_PROJECT_REF=qcoezjcwrsqchulqgydm node ... (defaults to prod)

import { readFileSync } from 'fs'

const PAT = process.env.SUPABASE_ACCESS_TOKEN
const PROD = process.env.SUPABASE_PROJECT_REF || 'aulttcsvxzcwyceezzpz'

if (!PAT) {
  console.error('SUPABASE_ACCESS_TOKEN env var required. Get a PAT from https://supabase.com/dashboard/account/tokens')
  process.exit(1)
}

const migrationFile = process.argv[2]
if (!migrationFile) { console.error('Usage: SUPABASE_ACCESS_TOKEN=... node apply-migration.js <path-to-sql>'); process.exit(1) }

const sql = readFileSync(migrationFile, 'utf-8')
console.log(`Applying ${migrationFile} (${sql.length} chars) to project ${PROD}…`)

const res = await fetch(`https://api.supabase.com/v1/projects/${PROD}/database/query`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${PAT}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: sql }),
})
const txt = await res.text()
console.log(`HTTP ${res.status}: ${txt}`)
if (!res.ok) process.exit(1)
