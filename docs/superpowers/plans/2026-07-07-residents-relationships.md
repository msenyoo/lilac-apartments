# Residents Relationships & Flat People View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `relation` field to residents (Self/Co-owner/Spouse/Parent/Child/Guardian/Other), a read-only "People" card in the flat side panel with occupancy history, a group move-out dialog, and multi-contact WhatsApp reminders (fixing the `.maybeSingle()` crash when a flat has 2+ active residents).

**Architecture:** One additive migration on `residents`. UI changes live in `FlatsPage.tsx` (People card, relation column, move-out dialog). A new `src/lib/contacts.ts` helper + `src/components/WhatsAppSendButtons.tsx` component replace the single-phone lookup in DuesPage, CorpusPage, ReportPage. Spec: `docs/superpowers/specs/2026-07-07-residents-relationships-design.md`.

**Tech Stack:** React 18 + TypeScript + Vite, Supabase (Postgres), TanStack Query, AG Grid Community, Playwright e2e (the ONLY test framework — there is no vitest/jest; all TDD cycles are e2e tests).

## Global Constraints

- Repo is **PUBLIC**: commit only synthetic fixture data (names prefixed `E2E `); never commit real resident data or the Supabase PAT.
- Migrations/DDL apply to **BOTH** Supabase projects: prod `aulttcsvxzcwyceezzpz`, dev `qcoezjcwrsqchulqgydm`.
- `npx tsc --noEmit` must pass before every commit.
- e2e tests run against the DEV DB (`npm run dev` on http://localhost:5173); login is mobile-number based: `9999999999` / `lilacadmin`. Auth state is pre-saved by `npx playwright test --project=setup`.
- Never call `new Date().toISOString().slice(0,10)` for a local date — IST shifts it. Use manual `getFullYear/getMonth/getDate` formatting.
- Tailwind classes + existing CSS vars (`var(--ink-500)` etc.) only; no inline styles except where the surrounding code already uses `style={{ color: 'var(--…)' }}`.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01JDn3HaFupmZi1bJHGJL4SM
  ```

---

### Task 1: Migration 039 — `residents.relation` column

**Files:**
- Create: `supabase/migrations/039_resident_relation.sql`
- Modify: `src/lib/supabase.ts:29-44` (Resident interface)

**Interfaces:**
- Produces: `residents.relation text NOT NULL DEFAULT 'Self'` in both DBs; TS type `Relation` and `Resident.relation: Relation` used by every later task.

- [ ] **Step 1: Write the migration file**

```sql
-- 039: resident relation — who this person is relative to the tenancy.
-- type = Owner|Tenant stays the business-logic axis; relation is descriptive.
ALTER TABLE public.residents
  ADD COLUMN IF NOT EXISTS relation text NOT NULL DEFAULT 'Self'
  CHECK (relation IN ('Self','Co-owner','Spouse','Parent','Child','Guardian','Other'));
```

- [ ] **Step 2: Apply to BOTH projects via Management API**

Run (Bash tool — token comes from `.claude/settings.local.json`, never inline the literal):

```bash
cd /d/projects/lilac-apartments
TOKEN=$(node -e "console.log(require('./.claude/settings.local.json').env.SUPABASE_ACCESS_TOKEN)")
BODY=$(node -e 'console.log(JSON.stringify({query: require("fs").readFileSync("supabase/migrations/039_resident_relation.sql","utf8")}))')
for ref in aulttcsvxzcwyceezzpz qcoezjcwrsqchulqgydm; do
  echo "== $ref =="
  curl -s -X POST "https://api.supabase.com/v1/projects/$ref/database/query" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data "$BODY"
  echo
done
```

Expected: `[]` (empty result) for each project — DDL returns no rows.

- [ ] **Step 3: Verify the column on both projects**

```bash
VERIFY=$(node -e 'console.log(JSON.stringify({query: "SELECT column_name, column_default FROM information_schema.columns WHERE table_name = '"'"'residents'"'"' AND column_name = '"'"'relation'"'"'"}))')
for ref in aulttcsvxzcwyceezzpz qcoezjcwrsqchulqgydm; do
  curl -s -X POST "https://api.supabase.com/v1/projects/$ref/database/query" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data "$VERIFY"
  echo
done
```

Expected on both: `[{"column_name":"relation","column_default":"'Self'::text"}]`

- [ ] **Step 4: Update the Resident TypeScript type**

In `src/lib/supabase.ts`, above `export interface Resident` add, and add the field after `type`:

```typescript
export type Relation = 'Self' | 'Co-owner' | 'Spouse' | 'Parent' | 'Child' | 'Guardian' | 'Other'

export interface Resident {
  id: string
  flat_id: string
  name: string
  type: 'Owner' | 'Tenant'
  relation: Relation
  phone: string | null
  // …rest unchanged
}
```

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add supabase/migrations/039_resident_relation.sql src/lib/supabase.ts
git commit -m "feat(residents): relation column (migration 039, applied to prod+dev)"
```

---

### Task 2: e2e fixtures — synthetic residents on the dev DB

**Files:**
- Create: `scripts/seed-e2e-residents.js`
- Modify: `.gitignore` (add `e2e/fixtures.json`)

**Interfaces:**
- Produces: dev-DB residents for AG1 (People card test), AF1 (move-out test), and a dynamically chosen "contacts flat" with outstanding dues (reminder test); manifest file `e2e/fixtures.json` with shape `{ "contactsFlat": "<code>" }` read by Task 6's test.
- All fixture names start `E2E ` — synthetic, safe for the public repo; script is committable (unlike `seed-uds-totals.js` which holds real data).

- [ ] **Step 1: Write the seed script**

`scripts/seed-e2e-residents.js` (mirrors the loadEnv/dev-guard pattern of `scripts/seed-e2e-advance-payer.js`):

```javascript
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
```

- [ ] **Step 2: Gitignore the generated manifest**

Append to `.gitignore` under the "Playwright output" section:

```
e2e/fixtures.json
```

- [ ] **Step 3: Run it against the dev DB**

```bash
node scripts/seed-e2e-residents.js
```

Expected output: `inserted`/`updated` line per fixture, then `contacts flat: <code> (written to e2e/fixtures.json)`, `Done.`

If it errors with `column "relation" does not exist`, Task 1 was not applied to dev — stop and fix that first.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-e2e-residents.js .gitignore
git commit -m "test(e2e): synthetic resident fixtures seed script (dev DB)"
```

---

### Task 3: People card in the flat side panel (TDD)

**Files:**
- Test: `e2e/app.spec.ts` (inside the existing `test.describe('Flats', …)` block, after the `clicking flat opens detail panel` test at ~line 270)
- Modify: `src/pages/FlatsPage.tsx` — insert `<PeopleCard flatId={selected.id} />` between the flat-info card (ends line 134) and the Area-details card (starts line 136); add the `PeopleCard` + `PersonRow` components after the `Detail` component (~line 203).

**Interfaces:**
- Consumes: `Resident` type with `relation` (Task 1), AG1 fixtures (Task 2).
- Produces: `PeopleCard({ flatId }: { flatId: string })` — self-contained, no exports needed elsewhere.

- [ ] **Step 1: Write the failing e2e test**

```typescript
test('People card shows owner group, tenant group, and past residents', async ({ page }) => {
  await page.goto('/flats')
  await page.getByText('AG1', { exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'People' })).toBeVisible()
  await expect(page.getByText('E2E Owner One')).toBeVisible()
  await expect(page.getByText('E2E Owner Spouse')).toBeVisible()
  await expect(page.getByText('E2E Tenant One')).toBeVisible()
  // history is collapsed by default
  await expect(page.getByText('E2E Past Tenant')).toBeHidden()
  await page.getByRole('button', { name: /Past residents/ }).click()
  await expect(page.getByText('E2E Past Tenant')).toBeVisible()
})
```

- [ ] **Step 2: Run it, verify it fails for the right reason**

Prereqs: dev server running (`npm run dev`), auth saved (`npx playwright test --project=setup`), fixtures seeded (Task 2).

```bash
npx playwright test --project="Desktop Chrome" -g "People card"
```

Expected: FAIL on `getByRole('heading', { name: 'People' })` — the card doesn't exist yet. Any other failure (login, AG1 not clickable) is environmental — fix that first.

- [ ] **Step 3: Implement PeopleCard**

In `FlatsPage.tsx`, insert into the detail panel (after the first card's closing `</div>` at line 134):

```tsx
          <PeopleCard flatId={selected.id} />
```

Add the components after `Detail` (~line 203). Note `useQuery` and `useRoleCtx` are already imported:

```tsx
function PeopleCard({ flatId }: { flatId: string }) {
  const { isAdmin, role } = useRoleCtx()
  const canSeePhone = isAdmin || role === 'committee'
  const [showPast, setShowPast] = useState(false)

  const { data: people } = useQuery({
    queryKey: ['flat-residents', flatId],
    queryFn: async () => {
      const { data } = await supabase.from('residents').select('*').eq('flat_id', flatId)
      return (data ?? []) as Resident[]
    },
  })

  const byRelation = (a: Resident, b: Resident) =>
    (a.relation === 'Self' ? 0 : 1) - (b.relation === 'Self' ? 0 : 1) || a.name.localeCompare(b.name)
  const active  = (people ?? []).filter(p => p.is_active)
  const past    = (people ?? []).filter(p => !p.is_active)
  const owners  = active.filter(p => p.type === 'Owner').sort(byRelation)
  const tenants = active.filter(p => p.type === 'Tenant').sort(byRelation)

  return (
    <div className="surface !p-4 flex flex-col gap-3">
      <h4 className="font-medium text-sm">People</h4>
      {owners.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold tracking-wide" style={{ color: 'var(--ink-400)' }}>OWNER</p>
          {owners.map(p => <PersonRow key={p.id} p={p} canSeePhone={canSeePhone} />)}
        </div>
      )}
      {tenants.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold tracking-wide" style={{ color: 'var(--ink-400)' }}>TENANT</p>
          {tenants.map(p => <PersonRow key={p.id} p={p} canSeePhone={canSeePhone} />)}
        </div>
      )}
      {active.length === 0 && (
        <p className="text-[13px]" style={{ color: 'var(--ink-400)' }}>No residents on file</p>
      )}
      {past.length > 0 && (
        <div>
          <button onClick={() => setShowPast(v => !v)}
            className="text-[12px] font-medium" style={{ color: 'var(--ink-500)' }}>
            {showPast ? '▾' : '▸'} Past residents ({past.length})
          </button>
          {showPast && (
            <div className="space-y-1.5 mt-2">
              {past.map(p => (
                <div key={p.id} className="flex justify-between text-[13px]">
                  <span style={{ color: 'var(--ink-500)' }}>{p.name}</span>
                  <span style={{ color: 'var(--ink-400)' }}>{p.moved_in ?? '—'} → {p.moved_out ?? '—'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PersonRow({ p, canSeePhone }: { p: Resident; canSeePhone: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm gap-2">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="font-medium truncate">{p.name}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
          style={{ background: 'var(--ink-100)', color: 'var(--ink-500)' }}>{p.relation}</span>
      </div>
      {canSeePhone && p.phone && (
        <a href={`tel:${p.phone}`} className="text-[12px] font-medium shrink-0" style={{ color: 'var(--ink-700)' }}>{p.phone}</a>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the test, verify it passes (both projects)**

```bash
npx tsc --noEmit
npx playwright test --project="Desktop Chrome" --project="Mobile Chrome" -g "People card"
```

Expected: PASS ×2.

- [ ] **Step 5: Commit**

```bash
git add src/pages/FlatsPage.tsx e2e/app.spec.ts
git commit -m "feat(flats): People card — owner/tenant groups, relations, occupancy history"
```

---

### Task 4: Relation in the Residents tab (grid column + Add modal)

**Files:**
- Test: `e2e/app.spec.ts` (same `Flats` describe block)
- Modify: `src/pages/FlatsPage.tsx` — `ResidentsTab` colDefs (~line 354) and `AddResidentModal` (~line 444).

**Interfaces:**
- Consumes: `Relation` type from `src/lib/supabase.ts` (Task 1).
- Produces: `RELATIONS` const in FlatsPage.tsx (module scope): `['Self','Co-owner','Spouse','Parent','Child','Guardian','Other']` — Task 5 does not need it, but the modal and future edits do.

- [ ] **Step 1: Write the failing e2e test**

```typescript
test('Residents tab has Relation column and Add modal relation dropdown', async ({ page }) => {
  await page.goto('/flats')
  await page.getByRole('button', { name: 'Residents' }).click()
  await expect(page.getByText('Relation', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Add resident/ }).click()
  const relationSelect = page.locator('select#relation')
  await expect(relationSelect).toBeVisible()
  await expect(relationSelect.locator('option', { hasText: 'Co-owner' })).toHaveCount(1)
  // Tenant side must not offer Co-owner
  await page.locator('select#restype').selectOption('Tenant')
  await expect(relationSelect.locator('option', { hasText: 'Co-owner' })).toHaveCount(0)
})
```

- [ ] **Step 2: Run it, verify it fails**

```bash
npx playwright test --project="Desktop Chrome" -g "Relation column"
```

Expected: FAIL — no `Relation` column header, no `select#relation`.

- [ ] **Step 3: Implement**

Module scope (near the top of FlatsPage.tsx, after imports):

```typescript
const RELATIONS = ['Self', 'Co-owner', 'Spouse', 'Parent', 'Child', 'Guardian', 'Other'] as const
```

In `ResidentsTab` colDefs, insert directly after the `type` column def (after line 366):

```typescript
    { field: 'relation', headerName: 'Relation', width: 110, filter: true,
      cellRenderer: (p: any) => (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">{p.value}</span>
      ),
    },
```

In `AddResidentModal`:
1. Add state after `type`: `const [relation, setRelation] = useState<string>('Self')`
2. Add `relation` to the insert payload (line 460-463): `flat_id: flatId, name, type, relation, phone: …`
3. Give the existing Type select `id="restype"`, and when it changes to Tenant reset a stale Co-owner:

```tsx
              <select id="restype" value={type} onChange={e => {
                const t = e.target.value as 'Owner' | 'Tenant'
                setType(t)
                if (t === 'Tenant' && relation === 'Co-owner') setRelation('Self')
              }} className="ds-field w-full">
```

4. Add the Relation select as a new row right below the Flat/Type grid (after line 493):

```tsx
          <div>
            <label className="ds-lbl">Relation</label>
            <select id="relation" value={relation} onChange={e => setRelation(e.target.value)} className="ds-field w-full">
              {RELATIONS.filter(r => type === 'Owner' || r !== 'Co-owner').map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <p className="text-[11px] mt-1" style={{ color: 'var(--ink-400)' }}>Who this person is — e.g. the owner's spouse, or the tenant themself (Self)</p>
          </div>
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
npx tsc --noEmit
npx playwright test --project="Desktop Chrome" -g "Relation column"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/FlatsPage.tsx e2e/app.spec.ts
git commit -m "feat(residents): relation badge column + relation picker in Add resident"
```

---

### Task 5: Group move-out dialog

**Files:**
- Test: `e2e/app.spec.ts` (same `Flats` describe block)
- Modify: `src/pages/FlatsPage.tsx` — `ResidentsTab` Actions cell (~line 380-390), `handleDeactivate` (~line 393), new `MoveOutDialog` component.

**Interfaces:**
- Consumes: AF1 movable pair fixtures (Task 2). Re-running `node scripts/seed-e2e-residents.js` re-activates them — required before every suite run.
- Produces: `MoveOutDialog({ resident, household, onClose, onSaved })` — internal to FlatsPage.tsx.

- [ ] **Step 1: Write the failing e2e test**

```typescript
test('group move-out moves the whole household out with a chosen date', async ({ page }) => {
  await page.goto('/flats')
  await page.getByRole('button', { name: 'Residents' }).click()
  const row = page.locator('.ag-row', { hasText: 'E2E Movable Self' })
  await row.getByRole('button', { name: /Move out/ }).click()
  await expect(page.getByRole('heading', { name: /Move out/ })).toBeVisible()
  // household member offered and pre-ticked
  const spouseCheck = page.getByRole('checkbox', { name: /E2E Movable Spouse/ })
  await expect(spouseCheck).toBeChecked()
  await page.locator('input[type="date"]').fill('2026-06-30')
  await page.getByRole('button', { name: /^Move out$/ }).last().click()
  await expect(page.locator('.ag-row', { hasText: 'E2E Movable Self' }).getByText('Inactive')).toBeVisible()
  await expect(page.locator('.ag-row', { hasText: 'E2E Movable Spouse' }).getByText('Inactive')).toBeVisible()
})
```

- [ ] **Step 2: Run it, verify it fails**

```bash
node scripts/seed-e2e-residents.js   # re-activate the movable pair first
npx playwright test --project="Desktop Chrome" -g "group move-out"
```

Expected: FAIL — clicking "Move out" today mutates instantly; no dialog heading appears.

- [ ] **Step 3: Implement**

In `ResidentsTab`: add `const [moveOut, setMoveOut] = useState<(Resident & { flat: { code: string; block: string } | null }) | null>(null)`.

Change the Actions cellRenderer (line 382-389): **Move out opens the dialog; Reactivate stays instant.**

```tsx
      cellRenderer: (p: any) => (
        <button
          onClick={() => p.data.is_active ? setMoveOut(p.data) : handleReactivate(p.data)}
          className="text-xs text-slate-400 hover:text-red-500 flex items-center gap-1"
        >
          <UserMinus size={13} /> {p.data.is_active ? 'Move out' : 'Reactivate'}
        </button>
      ),
```

Replace `handleDeactivate` with a reactivate-only handler:

```typescript
  async function handleReactivate(resident: Resident) {
    const { error } = await supabase.from('residents')
      .update({ is_active: true, moved_out: null }).eq('id', resident.id)
    if (error) { toast.error(error.message); return }
    qc.invalidateQueries({ queryKey: ['residents'] })
    toast.success(`${resident.name} reactivated`)
  }
```

Render the dialog at the bottom of `ResidentsTab`'s JSX (next to the AddResidentModal render):

```tsx
      {moveOut && (
        <MoveOutDialog
          resident={moveOut}
          household={(residents ?? []).filter(r =>
            r.flat_id === moveOut.flat_id && r.is_active && r.type === moveOut.type &&
            r.id !== moveOut.id && moveOut.relation === 'Self')}
          onClose={() => setMoveOut(null)}
          onSaved={() => {
            setMoveOut(null)
            qc.invalidateQueries({ queryKey: ['residents'] })
            qc.invalidateQueries({ queryKey: ['flat-residents'] })
          }}
        />
      )}
```

New component (place after `AddResidentModal`). Note the local-date helper — no `toISOString` (IST shift):

```tsx
function todayLocal() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function MoveOutDialog({ resident, household, onClose, onSaved }: {
  resident: Resident & { flat: { code: string; block: string } | null }
  household: Resident[]
  onClose: () => void
  onSaved: () => void
}) {
  const [date, setDate] = useState(todayLocal())
  const [checked, setChecked] = useState<Set<string>>(new Set(household.map(h => h.id)))
  const [saving, setSaving] = useState(false)

  async function handleMoveOut() {
    setSaving(true)
    const ids = [resident.id, ...Array.from(checked)]
    const { error } = await supabase.from('residents')
      .update({ is_active: false, moved_out: date }).in('id', ids)
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success(`${ids.length > 1 ? `${ids.length} residents` : resident.name} moved out (${date})`)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-5 border-b hairline">
          <h3 className="font-semibold">Move out — {resident.name}{resident.flat ? ` (${resident.flat.code})` : ''}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--ink-100)]"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="ds-lbl">Move-out date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="ds-field w-full" />
          </div>
          {household.length > 0 && (
            <div className="space-y-2">
              <p className="text-[12px]" style={{ color: 'var(--ink-500)' }}>Also move out:</p>
              {household.map(h => (
                <label key={h.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={checked.has(h.id)} aria-label={h.name}
                    onChange={e => setChecked(prev => {
                      const next = new Set(prev)
                      if (e.target.checked) next.add(h.id); else next.delete(h.id)
                      return next
                    })} />
                  {h.name} <span className="text-[11px]" style={{ color: 'var(--ink-400)' }}>({h.relation})</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2 p-5 border-t hairline">
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button onClick={handleMoveOut} disabled={saving || !date} className="btn-primary flex-1">
            {saving ? 'Saving…' : 'Move out'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
npx tsc --noEmit
npx playwright test --project="Desktop Chrome" -g "group move-out"
```

Expected: PASS. (If the checkbox locator misses, the `aria-label={h.name}` on the input is what `getByRole('checkbox', { name: … })` matches — check it survived.)

- [ ] **Step 5: Commit**

```bash
git add src/pages/FlatsPage.tsx e2e/app.spec.ts
git commit -m "feat(residents): group move-out dialog with date picker"
```

---

### Task 6: Multi-contact reminders (fixes the `.maybeSingle()` crash)

**Files:**
- Create: `src/lib/contacts.ts`, `src/components/WhatsAppSendButtons.tsx`
- Test: `e2e/app.spec.ts` (inside the existing `test.describe('Dues', …)` block)
- Modify: `src/pages/DuesPage.tsx:323-336` (ownerPhone query), `:377-383` (handleSendWhatsApp), `:463-470` (Send button)
- Modify: `src/pages/CorpusPage.tsx:740-752`, `:787-793`, `:854-860`
- Modify: `src/pages/ReportPage.tsx:910-922`, `:961-967`, `:1016-1019`
- Modify: `src/pages/OwnerPortalPage.tsx:362-371` (statement owner name prefers relation='Self')

**Interfaces:**
- Consumes: `Relation`/`Resident` (Task 1), contacts-flat fixtures + `e2e/fixtures.json` (Task 2).
- Produces:
  ```typescript
  // src/lib/contacts.ts
  export interface FlatContact { name: string; type: 'Owner' | 'Tenant'; relation: string; waPhone: string }
  export function toWaPhone(phone: string | null): string | null
  export async function fetchFlatContactsByCode(flatCode: string): Promise<FlatContact[]>
  // src/components/WhatsAppSendButtons.tsx
  export function WhatsAppSendButtons({ contacts, text }: { contacts: FlatContact[]; text: string }): JSX.Element
  ```

- [ ] **Step 1: Write the failing e2e test**

Add to the `Dues` describe block. Top of `e2e/app.spec.ts` needs `import { readFileSync, existsSync } from 'fs'`:

```typescript
  test('dues reminder lists every active contact with a phone', async ({ page }) => {
    test.skip(!existsSync('e2e/fixtures.json'), 'run scripts/seed-e2e-residents.js first')
    const { contactsFlat } = JSON.parse(readFileSync('e2e/fixtures.json', 'utf-8'))
    await page.goto('/dues')
    await page.getByText(contactsFlat, { exact: true }).first().click()
    await expect(page.getByRole('button', { name: /Send · E2E Contact Tenant/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Send · E2E Contact Owner/ })).toBeVisible()
  })
```

- [ ] **Step 2: Run it, verify it fails**

```bash
npx playwright test --project="Desktop Chrome" -g "reminder lists every active contact"
```

Expected: FAIL — today there is a single "Send" button (and with 2+ active residents the old `ownerPhone` query errors, leaving `ownerPhone` null → button says "Share").

- [ ] **Step 3: Create the helper and the component**

`src/lib/contacts.ts`:

```typescript
import { supabase } from './supabase'

export interface FlatContact {
  name: string
  type: 'Owner' | 'Tenant'
  relation: string
  waPhone: string
}

// Payer side first: the tenant/guardian actually pays; the owner is notified.
function rank(c: { type: string; relation: string }) {
  if (c.type === 'Tenant' && c.relation === 'Self') return 0
  if (c.relation === 'Guardian') return 1
  if (c.type === 'Tenant') return 2
  if (c.type === 'Owner' && c.relation === 'Self') return 3
  if (c.relation === 'Co-owner') return 4
  return 5
}

export function toWaPhone(phone: string | null): string | null {
  const raw = (phone ?? '').replace(/\D/g, '')
  if (!raw) return null
  return raw.length === 10 ? `91${raw}` : raw
}

export async function fetchFlatContactsByCode(flatCode: string): Promise<FlatContact[]> {
  const { data: f } = await supabase.from('flats').select('id').eq('code', flatCode).maybeSingle()
  if (!f) return []
  const { data } = await supabase
    .from('residents').select('name, type, relation, phone')
    .eq('flat_id', f.id).eq('is_active', true)
  return (data ?? [])
    .map(r => ({ name: r.name, type: r.type as 'Owner' | 'Tenant', relation: r.relation as string, waPhone: toWaPhone(r.phone) }))
    .filter((c): c is FlatContact => c.waPhone !== null)
    .sort((a, b) => rank(a) - rank(b))
}
```

`src/components/WhatsAppSendButtons.tsx`:

```tsx
import { Send } from 'lucide-react'
import type { FlatContact } from '@/lib/contacts'

export function WhatsAppSendButtons({ contacts, text }: { contacts: FlatContact[]; text: string }) {
  const open = (waPhone?: string) => window.open(
    waPhone
      ? `https://wa.me/${waPhone}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`,
    '_blank', 'noopener')

  if (!contacts.length) {
    return (
      <button onClick={() => open()}
        className="flex-1 flex items-center justify-center gap-2 py-2 rounded-[10px] border font-medium text-[13px] transition-colors"
        style={{ borderColor: 'var(--ok-bd)', background: 'var(--ok-bg)', color: 'var(--ok)' }}
        title="No phone on file — opens WhatsApp share to pick a contact">
        <Send size={14} /> Share
      </button>
    )
  }
  return (
    <div className="flex flex-col gap-1.5 flex-1">
      {contacts.map(c => (
        <button key={c.waPhone + c.name} onClick={() => open(c.waPhone)}
          className="flex items-center justify-center gap-2 py-2 rounded-[10px] border font-medium text-[13px] transition-colors"
          style={{ borderColor: 'var(--ok-bd)', background: 'var(--ok-bg)', color: 'var(--ok)' }}
          title={`Opens WhatsApp chat with ${c.name} (+${c.waPhone})`}>
          <Send size={14} /> Send · {c.name} ({c.type})
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Integrate in DuesPage**

Replace the `ownerPhone` query (lines 323-336) with:

```typescript
  const { data: contacts } = useQuery({
    queryKey: ['flat-contacts', flat.flat_code],
    queryFn: () => fetchFlatContactsByCode(flat.flat_code),
  })
```

Delete `handleSendWhatsApp` (lines 377-383). Replace the Send button (lines 463-470) with:

```tsx
            <WhatsAppSendButtons contacts={contacts ?? []} text={buildReminderText()} />
```

Imports: add `import { fetchFlatContactsByCode } from '@/lib/contacts'` and `import { WhatsAppSendButtons } from '@/components/WhatsAppSendButtons'`; remove `Send` from the lucide import if now unused in the file.

- [ ] **Step 5: Integrate in CorpusPage and ReportPage (same pattern)**

CorpusPage: replace `ownerPhone` query (740-752) with the identical `contacts` query (key `['flat-contacts', flat.flat_code]`), delete `handleSend` (787-793), replace the send button (~854-860) with `<WhatsAppSendButtons contacts={contacts ?? []} text={buildReminderText()} />`.

ReportPage: replace `ownerPhone` query (910-922) with

```typescript
  const { data: contacts } = useQuery({
    queryKey: ['flat-contacts', flatCode],
    queryFn: () => fetchFlatContactsByCode(flatCode),
    enabled: !!flatCode,
  })
```

delete `handleSendConsolidated` (961-967), replace its button (~1016-1019) with `<WhatsAppSendButtons contacts={contacts ?? []} text={buildConsolidatedReminder()} />`. Same imports in all three files.

- [ ] **Step 6: Owner portal statement prefers Owner/Self**

In `OwnerPortalPage.tsx` replace lines 362-371 with:

```typescript
      let ownerName = ''
      const { data: resData } = await supabase
        .from('residents')
        .select('name, relation')
        .eq('flat_id', (myFlat as any).id)
        .eq('type', 'Owner')
        .eq('is_active', true)
      const owners = (resData ?? []) as { name: string; relation: string }[]
      ownerName = (owners.find(o => o.relation === 'Self') ?? owners[0])?.name ?? ''
```

- [ ] **Step 7: Run the test, verify it passes**

```bash
npx tsc --noEmit
npx playwright test --project="Desktop Chrome" -g "reminder lists every active contact"
```

Expected: PASS — two Send buttons, tenant listed before owner.

- [ ] **Step 8: Commit**

```bash
git add src/lib/contacts.ts src/components/WhatsAppSendButtons.tsx src/pages/DuesPage.tsx src/pages/CorpusPage.tsx src/pages/ReportPage.tsx src/pages/OwnerPortalPage.tsx e2e/app.spec.ts
git commit -m "feat(reminders): multi-contact WhatsApp send — fixes maybeSingle crash on 2+ active residents"
```

---

### Task 7: Full regression, docs, push

**Files:**
- Modify: `CLAUDE.md` (Key Commands: add the residents seed script next to the existing seed line)

- [ ] **Step 1: Reseed + full e2e suite**

```bash
node scripts/seed-e2e-advance-payer.js
node scripts/seed-e2e-residents.js
npx playwright test --project="Desktop Chrome" --project="Mobile Chrome"
```

Expected: all tests pass (47 existing + 4 new = 51 per project, minus any explicitly skipped). Any failure in an EXISTING test means a regression — fix before proceeding (likely suspects: Flats detail-panel tests seeing the new People card, Dues detail tests seeing the new buttons).

- [ ] **Step 2: Update CLAUDE.md key commands**

After the `node scripts/seed-e2e-advance-payer.js` line add:

```
node scripts/seed-e2e-residents.js           # Seed synthetic residents fixtures (idempotent, re-run before suite)
```

- [ ] **Step 3: Final typecheck, commit, push**

```bash
npx tsc --noEmit
git add CLAUDE.md
git commit -m "docs: residents e2e seed step"
git pull --rebase origin main && git push origin main
```

Expected: push succeeds; Vercel auto-deploys.

- [ ] **Step 4: Prod smoke check**

Prod DB already has migration 039 (Task 1) with all rows defaulted to `relation='Self'`, and prod has real phone numbers — after deploy, open https://lilac-apartments.vercel.app/flats, click a flat, confirm the People card renders the real owner with a `Self` badge, and open one dues detail to confirm the reminder buttons render (single owner ⇒ one Send button).
