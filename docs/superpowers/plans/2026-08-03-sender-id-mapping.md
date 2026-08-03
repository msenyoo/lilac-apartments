# Sender ID → Flat Mapping Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `UPI_SENDER_MAP`/`NEFT_SENDER_MAP` lookup tables in `tagger.ts`
with a reviewable, DB-backed system: a new "Sender Mappings" tab on the Flats page to migrate
the ~50 legacy entries and browse current mappings with drill-down into matching transaction
history, plus an opt-in capture control in the existing Review-tab flow for new mappings going
forward. Tasks 8–10 were added mid-execution (2026-08-03, user request) to let a legacy entry's
flat be overridden before confirming, add a search box to the Sender Mappings page, and surface
sender IDs (with a best-effort type label) in the existing Flats-tab People card.

**Architecture:** No new tables/columns — everything rides on the existing `residents.upi_ids`
array, `residents.is_active`, `flats`, and `transactions.description`. Follows this repo's
established single-file-per-page convention: UI additions go directly into
`src/pages/FlatsPage.tsx` and `src/pages/TransactionsPage.tsx` as new sibling function
components (matching how `FlatsTab`/`ResidentsTab` and `ReviewTab`/`ReviewItem` already live
in those files); shared pure logic (no Supabase dependency) goes into `src/lib/tagger.ts`
alongside the maps it reads.

**Tech Stack:** React 18 + TypeScript, TanStack Query, Supabase JS, `@/components/ui/dialog`
(Radix Dialog), existing `ds-field`/`ds-lbl`/`btn-primary`/`btn-secondary`/`surface`/
`ds-badge-warn` utility classes, native `<select>` for pickers (this codebase does not use
Shadcn `Select` in `FlatsPage.tsx`/`ReviewItem`).

Full design context: `docs/superpowers/specs/2026-08-03-sender-id-mapping-design.md`.

## Global Constraints

- Repo is **PUBLIC** — this plan touches sender-identity data (UPI IDs, names). No task writes
  real resident data into any committed file; all example/placeholder text in code comments
  must stay generic.
- `npx tsc --noEmit` must pass before every commit — this project has `noUnusedLocals` and
  `noUnusedParameters` enabled (`tsconfig.json:15-16`), so only add an import in the task that
  first uses it.
- **No unit test framework exists in this repo** (no vitest/jest, only Playwright e2e under
  `e2e/`) — consistent with prior plans in this repo (e.g.
  `docs/superpowers/plans/2026-07-08-resident-edit-delete-dialogs.md`), tasks use
  `npx tsc --noEmit` plus a manual verification walkthrough instead of an automated test cycle.
  Do not add a test framework as part of this plan.
- Both the new tab and the Review-tab nudge are gated on `isAdmin` (from `useRoleCtx()`), not
  `canWrite` — matches the existing precedent that `upi_ids` is admin-only sensitive data
  (`FlatsPage.tsx` already gates the `upi_ids` grid column on `isAdmin`).
- `UPI_SENDER_MAP`/`NEFT_SENDER_MAP` removal from `tagger.ts` and the deferred git-history
  scrub are explicitly **out of scope for this plan** — they happen later, once the legacy
  backlog this plan builds is actually driven to zero through real admin usage.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01AU3snjDyBkM6LRmBYcUwrc
  ```

---

### Task 1: Pure helpers in `tagger.ts` — legacy diff + token guess

**Files:**
- Modify: `src/lib/tagger.ts:9` (export `UPI_SENDER_MAP`), `src/lib/tagger.ts:31` (export
  `NEFT_SENDER_MAP`), `src/lib/tagger.ts:123` (insert new exports after `tagTransaction` ends,
  before the `// ── FISCAL HELPERS` comment on line 125)

**Interfaces:**
- Consumes: nothing new (first task).
- Produces: `export const UPI_SENDER_MAP: Record<string, string>`, `export const
  NEFT_SENDER_MAP: Record<string, string>` (both already existed, now exported),
  `export interface LegacyMapping { token: string; type: 'UPI' | 'NEFT'; flatCode: string }`,
  `export function getLegacyMappings(existingUpiIds: string[]): LegacyMapping[]`,
  `export function guessSenderToken(description: string): string` — all consumed by Tasks 2–7.

- [ ] **Step 1: Export the two hardcoded maps**

In `src/lib/tagger.ts`, change line 9 from:
```ts
const UPI_SENDER_MAP: Record<string, string> = {
```
to:
```ts
export const UPI_SENDER_MAP: Record<string, string> = {
```

And change line 31 from:
```ts
const NEFT_SENDER_MAP: Record<string, string> = {
```
to:
```ts
export const NEFT_SENDER_MAP: Record<string, string> = {
```

- [ ] **Step 2: Add `getLegacyMappings` and `guessSenderToken`**

In `src/lib/tagger.ts`, immediately after the closing `}` of `tagTransaction` (line 123) and
before the `// ── FISCAL HELPERS ────` comment (line 125), insert:

```ts
export interface LegacyMapping {
  token:    string
  type:     'UPI' | 'NEFT'
  flatCode: string
}

// Diffs the hardcoded maps above against sender IDs already saved on residents, so the
// Sender Mappings tab only lists entries that haven't been migrated into the DB yet.
export function getLegacyMappings(existingUpiIds: string[]): LegacyMapping[] {
  const existing = new Set(existingUpiIds.map(id => id.toLowerCase()))
  const pending: LegacyMapping[] = []
  for (const [token, flatCode] of Object.entries(UPI_SENDER_MAP)) {
    if (!existing.has(token.toLowerCase())) pending.push({ token, type: 'UPI', flatCode })
  }
  for (const [token, flatCode] of Object.entries(NEFT_SENDER_MAP)) {
    if (!existing.has(token.toLowerCase())) pending.push({ token, type: 'NEFT', flatCode })
  }
  return pending
}

// Best-effort guess at the sender identifier inside a raw bank description. Used only to
// prefill an editable field during transaction review — never saved without human confirmation.
export function guessSenderToken(description: string): string {
  const upiMatch = description.match(/UPI\/([^/]+)/i)
  if (upiMatch) return upiMatch[1].trim()

  const cleaned = description
    .replace(/^(NEFT|IMPS|RTGS)\b[\s-]*/i, '')
    .replace(/^(CR|DR)-/i, '')
    .replace(/^[A-Z]{2,}\d*-/i, '')
  const parts = cleaned.split('-').map(p => p.trim()).filter(Boolean)
  return parts.length > 0 ? parts[0] : description.trim()
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (`UPI_SENDER_MAP`/`NEFT_SENDER_MAP` are now exported but still unused
outside this file until Task 2 — exporting alone doesn't trigger `noUnusedLocals`, only
unused *local* declarations do, so this passes cleanly.)

- [ ] **Step 4: Manual sanity check**

These are pure functions with no UI yet — `guessSenderToken` gets exercised visually in Task 6
and `getLegacyMappings` in Task 2. For now, confirm by reading: `getLegacyMappings([])` should
return one `LegacyMapping` per entry across both hardcoded maps (~50 total); passing every
key from both maps (lowercased) as `existingUpiIds` should return `[]`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tagger.ts
git commit -m "$(cat <<'EOF'
feat(tagger): export legacy sender maps + add mapping-review helpers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AU3snjDyBkM6LRmBYcUwrc
EOF
)"
```

---

### Task 2: Sender Mappings tab — legacy backlog list

**Files:**
- Modify: `src/pages/FlatsPage.tsx:1` (import `useMemo` — already imported), `src/pages/FlatsPage.tsx:6-8` (imports),
  `src/pages/FlatsPage.tsx:14` (`Tab` type), `src/pages/FlatsPage.tsx:25-50` (`FlatsPage`
  component: tab list + render), append new components at end of file (after line 884)

**Interfaces:**
- Consumes: `getLegacyMappings`, `LegacyMapping` from Task 1 (`@/lib/tagger`).
- Produces: `SenderMappingsTab()` component, rendered when `tab === 'mappings'`. Later tasks
  (3, 4, 5) extend this same component and its children.

- [ ] **Step 1: Extend imports**

In `src/pages/FlatsPage.tsx`, change line 7 from:
```tsx
import { formatINR } from '@/lib/tagger'
```
to:
```tsx
import { formatINR, getLegacyMappings, LegacyMapping } from '@/lib/tagger'
```

- [ ] **Step 2: Add the `mappings` tab type**

Change line 14 from:
```tsx
type Tab = 'flats' | 'residents'
```
to:
```tsx
type Tab = 'flats' | 'residents' | 'mappings'
```

- [ ] **Step 3: Gate and render the new tab**

In the `FlatsPage()` component, change:
```tsx
export default function FlatsPage() {
  const [tab, setTab] = useState<Tab>('flats')

  return (
    <div className="flex flex-col gap-5 fade-in">
      <div>
        <h1 className="text-[24px] font-extrabold">Flats &amp; Residents</h1>
        <p className="text-[13.5px] mt-1" style={{ color: 'var(--ink-500)' }}>Manage flat details, maintenance rates, owners and tenants</p>
      </div>


      <div className="flex gap-1 rounded-xl p-1 w-fit" style={{ background: 'var(--ink-100)' }}>
        {([{ key: 'flats', label: 'Flats' }, { key: 'residents', label: 'Residents' }] as { key: Tab; label: string }[]).map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === key ? 'bg-white shadow-sm' : ''}`}
            style={{ color: tab === key ? 'var(--ink-900)' : 'var(--ink-500)' }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'flats'     && <FlatsTab />}
      {tab === 'residents' && <ResidentsTab />}
    </div>
  )
}
```
to:
```tsx
export default function FlatsPage() {
  const { isAdmin } = useRoleCtx()
  const [tab, setTab] = useState<Tab>('flats')

  const tabs: { key: Tab; label: string }[] = [
    { key: 'flats', label: 'Flats' },
    { key: 'residents', label: 'Residents' },
    ...(isAdmin ? [{ key: 'mappings' as Tab, label: 'Sender Mappings' }] : []),
  ]

  return (
    <div className="flex flex-col gap-5 fade-in">
      <div>
        <h1 className="text-[24px] font-extrabold">Flats &amp; Residents</h1>
        <p className="text-[13.5px] mt-1" style={{ color: 'var(--ink-500)' }}>Manage flat details, maintenance rates, owners and tenants</p>
      </div>


      <div className="flex gap-1 rounded-xl p-1 w-fit" style={{ background: 'var(--ink-100)' }}>
        {tabs.map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === key ? 'bg-white shadow-sm' : ''}`}
            style={{ color: tab === key ? 'var(--ink-900)' : 'var(--ink-500)' }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'flats'     && <FlatsTab />}
      {tab === 'residents' && <ResidentsTab />}
      {tab === 'mappings' && isAdmin && <SenderMappingsTab onManageResident={() => setTab('residents')} />}
    </div>
  )
}
```

Note: `useRoleCtx` is already imported at line 8 of this file — no import change needed for it.

- [ ] **Step 4: Add `SenderMappingsTab` and `LegacyBacklog`**

At the end of `src/pages/FlatsPage.tsx` (after the `Field` component, which is currently the
last thing in the file), append:

```tsx
// ── SENDER MAPPINGS TAB ──────────────────────────────────────
function SenderMappingsTab({ onManageResident }: { onManageResident: () => void }) {
  const qc = useQueryClient()

  const { data: residents, isLoading } = useQuery({
    queryKey: ['residents-for-mappings'],
    queryFn: async () => {
      const { data } = await supabase
        .from('residents')
        .select('id, name, type, relation, flat_id, is_active, upi_ids, flat:flat_id(code)')
        .order('name')
      return (data ?? []) as (Resident & { flat: { code: string } | null })[]
    },
  })

  const allUpiIds = useMemo(() => (residents ?? []).flatMap(r => r.upi_ids ?? []), [residents])
  const legacyMappings = useMemo(() => getLegacyMappings(allUpiIds), [allUpiIds])

  if (isLoading) return <div className="h-64 animate-pulse rounded-[var(--ds-radius)]" style={{ background: 'var(--ink-100)' }} />

  return (
    <div className="flex flex-col gap-5">
      <LegacyBacklog
        mappings={legacyMappings}
        residents={residents ?? []}
        onConfirmed={() => qc.invalidateQueries({ queryKey: ['residents-for-mappings'] })}
      />
    </div>
  )
}

function LegacyBacklog({ mappings, residents, onConfirmed }: {
  mappings: LegacyMapping[]
  residents: (Resident & { flat: { code: string } | null })[]
  onConfirmed: () => void
}) {
  if (mappings.length === 0) {
    return (
      <div className="surface !p-6 text-sm" style={{ color: 'var(--ink-500)' }}>
        No legacy mappings left to review.
      </div>
    )
  }
  return (
    <div className="surface !p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold">Legacy mappings to review</h3>
        <span className="ds-badge-warn">{mappings.length} pending</span>
      </div>
      <p className="text-sm" style={{ color: 'var(--ink-500)' }}>
        From the old hardcoded list — pick which resident each one belongs to.
      </p>
      <div className="flex flex-col gap-2">
        {mappings.map(m => (
          <LegacyMappingRow key={`${m.type}-${m.token}`} mapping={m} residents={residents} onConfirmed={onConfirmed} />
        ))}
      </div>
    </div>
  )
}

function LegacyMappingRow({ mapping, residents, onConfirmed }: {
  mapping: LegacyMapping
  residents: (Resident & { flat: { code: string } | null })[]
  onConfirmed: () => void
}) {
  const flatResidents = residents.filter(r => r.flat?.code === mapping.flatCode)
  const [residentId, setResidentId] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleConfirm() {
    if (!residentId) return
    const token = mapping.token.toLowerCase()
    const conflictOwner = residents.find(r => r.id !== residentId && (r.upi_ids ?? []).some(id => id.toLowerCase() === token))
    if (conflictOwner) {
      toast.error(`${mapping.token} is already saved for ${conflictOwner.name} (${conflictOwner.flat?.code ?? '—'}) — resolve that first`)
      return
    }
    setSaving(true)
    const resident = residents.find(r => r.id === residentId)
    const merged = Array.from(new Set([...(resident?.upi_ids ?? []), token]))
    const { error } = await supabase.from('residents').update({ upi_ids: merged }).eq('id', residentId)
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success(`${mapping.token} saved for ${resident?.name}`)
    onConfirmed()
  }

  return (
    <div className="border-t hairline pt-2">
      <div className="grid grid-cols-[1fr_60px_80px_1fr_auto] gap-2 items-center text-sm">
        <span className="font-mono truncate">{mapping.token}</span>
        <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-bold ${mapping.type === 'UPI' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
          {mapping.type}
        </span>
        <span className="font-semibold">{mapping.flatCode}</span>
        <select value={residentId} onChange={e => setResidentId(e.target.value)} className="ds-field w-full">
          <option value="">— select resident —</option>
          {flatResidents.map(r => (
            <option key={r.id} value={r.id}>
              {r.name} ({r.type}){!r.is_active ? ' — moved out' : ''} — {(r.upi_ids ?? []).length} ID(s)
            </option>
          ))}
        </select>
        <button onClick={handleConfirm} disabled={!residentId || saving} className="btn-primary text-xs px-3 py-1.5">
          {saving ? 'Saving…' : 'Confirm'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual verification**

Run `npm run dev`, log in as an admin user, go to `/flats`. Confirm a "Sender Mappings" tab
appears (and does **not** appear when logged in as a non-admin role). Open it: confirm a
"Legacy mappings to review" section lists ~50 rows (one per hardcoded map entry), each with a
token, `UPI`/`NEFT` badge, flat code, and a resident dropdown scoped to that flat. Pick a
resident for one row and click Confirm: the row disappears, the pending count decrements, and
a success toast appears. Switch to the Residents tab and confirm that resident's UPI IDs
column now includes the newly saved token. Also confirm the duplicate guard: manually add the
same token (via the Residents tab edit dialog) to a second resident first, then try to confirm
that legacy row to a third resident — confirm it's blocked with an error toast naming the
resident who already has it, and nothing is written.

- [ ] **Step 7: Commit**

```bash
git add src/pages/FlatsPage.tsx
git commit -m "$(cat <<'EOF'
feat(flats): add Sender Mappings tab with legacy backlog review

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AU3snjDyBkM6LRmBYcUwrc
EOF
)"
```

---

### Task 3: Flat-conflict warning on legacy rows

**Files:**
- Modify: `src/pages/FlatsPage.tsx` — `LegacyMappingRow` (added in Task 2)

**Interfaces:**
- Consumes: `LegacyMappingRow`'s existing `mapping` prop.
- Produces: no new exports; purely additive UI within the same component.

- [ ] **Step 1: Query for conflicting transaction history**

In `LegacyMappingRow` (from Task 2), after the existing `useState` calls, add:

```tsx
  const { data: conflicts } = useQuery({
    queryKey: ['legacy-conflict', mapping.token, mapping.flatCode],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('flat_code')
        .ilike('description', `%${mapping.token}%`)
        .not('flat_code', 'is', null)
        .neq('flat_code', mapping.flatCode)
        .neq('flat_code', 'UNKNOWN')
      return data ?? []
    },
  })

  const conflictSummary = useMemo(() => {
    if (!conflicts || conflicts.length === 0) return null
    const counts = new Map<string, number>()
    for (const c of conflicts) counts.set(c.flat_code!, (counts.get(c.flat_code!) ?? 0) + 1)
    return Array.from(counts.entries()).map(([flat, count]) => `${count} for ${flat}`).join(', ')
  }, [conflicts])
```

- [ ] **Step 2: Render the warning**

Change the row's `return` from:
```tsx
  return (
    <div className="border-t hairline pt-2">
      <div className="grid grid-cols-[1fr_60px_80px_1fr_auto] gap-2 items-center text-sm">
```
to:
```tsx
  return (
    <div className="border-t hairline pt-2">
      <div className="grid grid-cols-[1fr_60px_80px_1fr_auto] gap-2 items-center text-sm">
```
(unchanged), and insert immediately after the closing `</div>` of that grid (before the
row's final closing `</div>`):
```tsx
      {conflictSummary && (
        <p className="text-xs text-amber-600 mt-1">
          ⚠ Also appears on transactions tagged to a different flat — {conflictSummary}. Double-check before confirming.
        </p>
      )}
```

So the full return becomes:
```tsx
  return (
    <div className="border-t hairline pt-2">
      <div className="grid grid-cols-[1fr_60px_80px_1fr_auto] gap-2 items-center text-sm">
        <span className="font-mono truncate">{mapping.token}</span>
        <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-bold ${mapping.type === 'UPI' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
          {mapping.type}
        </span>
        <span className="font-semibold">{mapping.flatCode}</span>
        <select value={residentId} onChange={e => setResidentId(e.target.value)} className="ds-field w-full">
          <option value="">— select resident —</option>
          {flatResidents.map(r => (
            <option key={r.id} value={r.id}>
              {r.name} ({r.type}){!r.is_active ? ' — moved out' : ''} — {(r.upi_ids ?? []).length} ID(s)
            </option>
          ))}
        </select>
        <button onClick={handleConfirm} disabled={!residentId || saving} className="btn-primary text-xs px-3 py-1.5">
          {saving ? 'Saving…' : 'Confirm'}
        </button>
      </div>
      {conflictSummary && (
        <p className="text-xs text-amber-600 mt-1">
          ⚠ Also appears on transactions tagged to a different flat — {conflictSummary}. Double-check before confirming.
        </p>
      )}
    </div>
  )
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

In the running app, find a legacy row whose token appears in transaction history under a
different flat than the map claims (if none exist in current data, temporarily verify the
query logic by checking Supabase directly: pick any token, run the same filter via SQL, and
confirm counts match what the UI shows for a row you construct with matching data). Confirm
the warning text and per-flat counts render correctly, and that it does not block clicking
Confirm.

- [ ] **Step 5: Commit**

```bash
git add src/pages/FlatsPage.tsx
git commit -m "$(cat <<'EOF'
feat(flats): flag legacy mappings that conflict with transaction history

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AU3snjDyBkM6LRmBYcUwrc
EOF
)"
```

---

### Task 4: All-flats mapping table

**Files:**
- Modify: `src/pages/FlatsPage.tsx` — `SenderMappingsTab` (Task 2), append `AllFlatsMappings`

**Interfaces:**
- Consumes: `residents` data already fetched in `SenderMappingsTab` (Task 2).
- Produces: `AllFlatsMappings` component, rendered inside `SenderMappingsTab`.

- [ ] **Step 1: Render `AllFlatsMappings` from `SenderMappingsTab`**

Change `SenderMappingsTab`'s return (from Task 2):
```tsx
  return (
    <div className="flex flex-col gap-5">
      <LegacyBacklog
        mappings={legacyMappings}
        residents={residents ?? []}
        onConfirmed={() => qc.invalidateQueries({ queryKey: ['residents-for-mappings'] })}
      />
    </div>
  )
```
to:
```tsx
  return (
    <div className="flex flex-col gap-5">
      <LegacyBacklog
        mappings={legacyMappings}
        residents={residents ?? []}
        onConfirmed={() => qc.invalidateQueries({ queryKey: ['residents-for-mappings'] })}
      />
      <AllFlatsMappings residents={residents ?? []} onManage={onManageResident} />
    </div>
  )
```

- [ ] **Step 2: Add `AllFlatsMappings`**

Append after `LegacyMappingRow` (end of Task 3's additions):

```tsx
function AllFlatsMappings({ residents, onManage }: {
  residents: (Resident & { flat: { code: string } | null })[]
  onManage: () => void
}) {
  const grouped = useMemo(() => {
    const withIds = residents.filter(r => (r.upi_ids ?? []).length > 0)
    const byFlat = new Map<string, typeof withIds>()
    for (const r of withIds) {
      const code = r.flat?.code ?? '—'
      if (!byFlat.has(code)) byFlat.set(code, [])
      byFlat.get(code)!.push(r)
    }
    return Array.from(byFlat.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [residents])

  return (
    <div className="surface !p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">All flats</h3>
        <button onClick={onManage} className="text-xs" style={{ color: 'var(--brand-600)' }}>
          Manage on Flats page →
        </button>
      </div>
      {grouped.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--ink-500)' }}>No sender IDs saved yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {grouped.map(([flatCode, flatResidents]) => (
            <div key={flatCode} className="grid grid-cols-[70px_1fr_2fr] gap-2 items-start text-sm border-t hairline pt-2">
              <span className="font-semibold">{flatCode}</span>
              <div className="flex flex-col gap-1">
                {flatResidents.map(r => (
                  <span key={r.id} className={r.is_active ? '' : 'text-slate-400'}>
                    {r.name} ({r.type})
                  </span>
                ))}
              </div>
              <div className="flex flex-col gap-1">
                {flatResidents.map(r => (
                  <div key={r.id} className="flex flex-wrap items-center gap-1">
                    {(r.upi_ids ?? []).map(id => (
                      <span key={id}
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${r.is_active ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                        {id}
                      </span>
                    ))}
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${r.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {r.is_active ? 'Active' : 'Archived'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

In the running app, on the Sender Mappings tab, confirm an "All flats" section below the
legacy backlog lists every flat that has at least one resident with a saved sender ID, showing
each resident's chips (multiple chips for a resident with more than one ID) and an
Active/Archived badge matching that resident's actual `is_active` state. Click "Manage on
Flats page →" and confirm it switches to the Residents tab.

- [ ] **Step 5: Commit**

```bash
git add src/pages/FlatsPage.tsx
git commit -m "$(cat <<'EOF'
feat(flats): add all-flats sender ID table to Sender Mappings tab

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AU3snjDyBkM6LRmBYcUwrc
EOF
)"
```

---

### Task 5: Drill-down to matching transactions

**Files:**
- Modify: `src/pages/FlatsPage.tsx:6` (import `Transaction`), `src/pages/FlatsPage.tsx` (add
  `import { formatDateDMY } from '@/lib/date'`), `SenderMappingsTab`, `LegacyMappingRow`,
  `AllFlatsMappings`, append `SenderDrilldownDialog`

**Interfaces:**
- Consumes: `Transaction` type from `@/lib/supabase`, `formatDateDMY` from `@/lib/date`,
  `formatINR` (already imported in this file).
- Produces: `SenderDrilldownDialog` component; click handlers on legacy-row tokens and
  all-flats chips that open it.

- [ ] **Step 1: Extend imports**

Change line 6 from:
```tsx
import { supabase, Flat, Resident } from '@/lib/supabase'
```
to:
```tsx
import { supabase, Flat, Resident, Transaction } from '@/lib/supabase'
```

Add a new import line after it:
```tsx
import { formatDateDMY } from '@/lib/date'
```

- [ ] **Step 2: Add drill-down state to `SenderMappingsTab` and pass it down**

Change `SenderMappingsTab`'s body (from Task 4) from:
```tsx
function SenderMappingsTab({ onManageResident }: { onManageResident: () => void }) {
  const qc = useQueryClient()

  const { data: residents, isLoading } = useQuery({
```
to:
```tsx
function SenderMappingsTab({ onManageResident }: { onManageResident: () => void }) {
  const qc = useQueryClient()
  const [drilldownToken, setDrilldownToken] = useState<string | null>(null)

  const { data: residents, isLoading } = useQuery({
```

And change its `return` from:
```tsx
  return (
    <div className="flex flex-col gap-5">
      <LegacyBacklog
        mappings={legacyMappings}
        residents={residents ?? []}
        onConfirmed={() => qc.invalidateQueries({ queryKey: ['residents-for-mappings'] })}
      />
      <AllFlatsMappings residents={residents ?? []} onManage={onManageResident} />
    </div>
  )
```
to:
```tsx
  return (
    <div className="flex flex-col gap-5">
      <LegacyBacklog
        mappings={legacyMappings}
        residents={residents ?? []}
        onConfirmed={() => qc.invalidateQueries({ queryKey: ['residents-for-mappings'] })}
        onTokenClick={setDrilldownToken}
      />
      <AllFlatsMappings residents={residents ?? []} onManage={onManageResident} onTokenClick={setDrilldownToken} />
      {drilldownToken && (
        <SenderDrilldownDialog token={drilldownToken} onClose={() => setDrilldownToken(null)} />
      )}
    </div>
  )
```

- [ ] **Step 3: Wire the click handler through `LegacyBacklog`/`LegacyMappingRow`**

Change `LegacyBacklog`'s props and pass-through (from Task 2):
```tsx
function LegacyBacklog({ mappings, residents, onConfirmed }: {
  mappings: LegacyMapping[]
  residents: (Resident & { flat: { code: string } | null })[]
  onConfirmed: () => void
}) {
```
to:
```tsx
function LegacyBacklog({ mappings, residents, onConfirmed, onTokenClick }: {
  mappings: LegacyMapping[]
  residents: (Resident & { flat: { code: string } | null })[]
  onConfirmed: () => void
  onTokenClick: (token: string) => void
}) {
```

And its row-mapping line:
```tsx
        {mappings.map(m => (
          <LegacyMappingRow key={`${m.type}-${m.token}`} mapping={m} residents={residents} onConfirmed={onConfirmed} />
        ))}
```
to:
```tsx
        {mappings.map(m => (
          <LegacyMappingRow key={`${m.type}-${m.token}`} mapping={m} residents={residents} onConfirmed={onConfirmed} onTokenClick={onTokenClick} />
        ))}
```

In `LegacyMappingRow`, change its props (from Task 2/3):
```tsx
function LegacyMappingRow({ mapping, residents, onConfirmed }: {
  mapping: LegacyMapping
  residents: (Resident & { flat: { code: string } | null })[]
  onConfirmed: () => void
}) {
```
to:
```tsx
function LegacyMappingRow({ mapping, residents, onConfirmed, onTokenClick }: {
  mapping: LegacyMapping
  residents: (Resident & { flat: { code: string } | null })[]
  onConfirmed: () => void
  onTokenClick: (token: string) => void
}) {
```

And change the token display from:
```tsx
        <span className="font-mono truncate">{mapping.token}</span>
```
to:
```tsx
        <button onClick={() => onTokenClick(mapping.token)} className="font-mono truncate text-left hover:underline">
          {mapping.token}
        </button>
```

- [ ] **Step 4: Wire the click handler through `AllFlatsMappings`**

Change `AllFlatsMappings`'s props (from Task 4):
```tsx
function AllFlatsMappings({ residents, onManage }: {
  residents: (Resident & { flat: { code: string } | null })[]
  onManage: () => void
}) {
```
to:
```tsx
function AllFlatsMappings({ residents, onManage, onTokenClick }: {
  residents: (Resident & { flat: { code: string } | null })[]
  onManage: () => void
  onTokenClick: (token: string) => void
}) {
```

And change each chip from:
```tsx
                    {(r.upi_ids ?? []).map(id => (
                      <span key={id}
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${r.is_active ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                        {id}
                      </span>
                    ))}
```
to:
```tsx
                    {(r.upi_ids ?? []).map(id => (
                      <button key={id} onClick={() => onTokenClick(id)}
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium hover:underline ${r.is_active ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                        {id}
                      </button>
                    ))}
```

- [ ] **Step 5: Add `SenderDrilldownDialog`**

Append after `AllFlatsMappings`:

```tsx
function SenderDrilldownDialog({ token, onClose }: { token: string; onClose: () => void }) {
  const { data: txns, isLoading } = useQuery({
    queryKey: ['sender-drilldown', token],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('id, value_date, amount, cr_dr, flat_code, description')
        .ilike('description', `%${token}%`)
        .order('value_date', { ascending: false })
      return (data ?? []) as Pick<Transaction, 'id' | 'value_date' | 'amount' | 'cr_dr' | 'flat_code' | 'description'>[]
    },
  })

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Transactions matching "{token}"</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="h-40 animate-pulse rounded-[var(--ds-radius)]" style={{ background: 'var(--ink-100)' }} />
        ) : !txns || txns.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--ink-500)' }}>No matching transactions found.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b hairline">
                <th className="py-1.5 pr-2">Date</th>
                <th className="py-1.5 pr-2">Amount</th>
                <th className="py-1.5 pr-2">CR/DR</th>
                <th className="py-1.5 pr-2">Tagged flat</th>
              </tr>
            </thead>
            <tbody>
              {txns.map(t => (
                <tr key={t.id} className="border-b hairline">
                  <td className="py-1.5 pr-2">{formatDateDMY(t.value_date)}</td>
                  <td className="py-1.5 pr-2">{formatINR(t.amount)}</td>
                  <td className="py-1.5 pr-2">{t.cr_dr}</td>
                  <td className="py-1.5 pr-2 font-semibold">{t.flat_code}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual verification**

In the running app, click a legacy row's token and confirm the drill-down dialog opens
showing matching transactions with date/amount/CR-DR/tagged-flat columns (or "No matching
transactions found" if none exist). Close it. Click a chip in the "All flats" table and
confirm the same dialog opens for that ID.

- [ ] **Step 8: Commit**

```bash
git add src/pages/FlatsPage.tsx
git commit -m "$(cat <<'EOF'
feat(flats): drill-down dialog showing transactions matched to a sender ID

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AU3snjDyBkM6LRmBYcUwrc
EOF
)"
```

---

### Task 6: Review-tab capture — opt-in save (single row)

**Files:**
- Modify: `src/pages/TransactionsPage.tsx:13-16` (imports), `src/pages/TransactionsPage.tsx:476-493`
  (`ReviewTab` — add residents query, pass to `ReviewItem`), `src/pages/TransactionsPage.tsx:699-762`
  (`ReviewItem` — new state, UI, `handleSave`)

**Interfaces:**
- Consumes: `guessSenderToken` from `@/lib/tagger` (Task 1).
- Produces: `ReviewItem` now accepts a `residents` prop; extended in Task 7's `handleSave`.

- [ ] **Step 1: Import `guessSenderToken`**

Change lines 13-16 from:
```tsx
import {
  parseStatement, tagTransaction, getFiscalLabel,
  getFiscalYear, getFiscalMonth, bankDateToISO, bankTimeTo24h, formatINR, FLAT_CODES, INCOME_CATS,
} from '@/lib/tagger'
```
to:
```tsx
import {
  parseStatement, tagTransaction, getFiscalLabel,
  getFiscalYear, getFiscalMonth, bankDateToISO, bankTimeTo24h, formatINR, FLAT_CODES, INCOME_CATS,
  guessSenderToken,
} from '@/lib/tagger'
```

- [ ] **Step 2: Fetch active residents in `ReviewTab` and pass down**

Change `ReviewTab` (currently lines 476-493) from:
```tsx
function ReviewTab() {
  const { canWrite, isAdmin } = useRoleCtx()
  const qc = useQueryClient()
  const [bulkOpen, setBulkOpen] = useState(false)
  const { data: items, isLoading } = useQuery({
    queryKey: ['review-queue'],
    queryFn: async () => {
      const { data } = await supabase.from('v_review_queue').select('*').order('value_date', { ascending: false })
      return (data ?? []) as ReviewEntry[]
    },
  })
  const { data: flats } = useQuery({
    queryKey: ['flats'],
    queryFn: async () => {
      const { data } = await supabase.from('flats').select('id,code,maintenance_amt')
      return data ?? []
    },
  })
```
to:
```tsx
function ReviewTab() {
  const { canWrite, isAdmin } = useRoleCtx()
  const qc = useQueryClient()
  const [bulkOpen, setBulkOpen] = useState(false)
  const { data: items, isLoading } = useQuery({
    queryKey: ['review-queue'],
    queryFn: async () => {
      const { data } = await supabase.from('v_review_queue').select('*').order('value_date', { ascending: false })
      return (data ?? []) as ReviewEntry[]
    },
  })
  const { data: flats } = useQuery({
    queryKey: ['flats'],
    queryFn: async () => {
      const { data } = await supabase.from('flats').select('id,code,maintenance_amt')
      return data ?? []
    },
  })
  const { data: residents } = useQuery({
    queryKey: ['residents-active-lite'],
    queryFn: async () => {
      const { data } = await supabase.from('residents').select('id,name,type,flat_id,upi_ids').eq('is_active', true)
      return (data ?? []) as { id: string; name: string; type: string; flat_id: string; upi_ids: string[] }[]
    },
  })
```

Then change the `items.map` line inside the same function's `return`:
```tsx
        {items.map(item => (
          <ReviewItem key={item.id} item={item} flats={flats ?? []} onSaved={() => qc.invalidateQueries()} />
        ))}
```
to:
```tsx
        {items.map(item => (
          <ReviewItem key={item.id} item={item} flats={flats ?? []} residents={residents ?? []} onSaved={() => qc.invalidateQueries()} />
        ))}
```

- [ ] **Step 3: Accept `residents` in `ReviewItem` and add state**

Change `ReviewItem`'s signature and top of body from:
```tsx
function ReviewItem({ item, flats, onSaved }: { item: ReviewEntry; flats: any[]; onSaved: () => void }) {
  const { canWrite } = useRoleCtx()
  const [flatCode, setFlatCode]   = useState('')
  const [category, setCategory]   = useState('Maintenance')
  const [corpus, setCorpus]       = useState<'YES' | 'NO'>('NO')
  const [planId, setPlanId]       = useState<string | null>(null)
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)
  const [showSplit, setShowSplit] = useState(false)
```
to:
```tsx
function ReviewItem({ item, flats, residents, onSaved }: {
  item: ReviewEntry
  flats: any[]
  residents: { id: string; name: string; type: string; flat_id: string; upi_ids: string[] }[]
  onSaved: () => void
}) {
  const { canWrite, isAdmin } = useRoleCtx()
  const [flatCode, setFlatCode]   = useState('')
  const [category, setCategory]   = useState('Maintenance')
  const [corpus, setCorpus]       = useState<'YES' | 'NO'>('NO')
  const [planId, setPlanId]       = useState<string | null>(null)
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)
  const [showSplit, setShowSplit] = useState(false)
  const [saveSender, setSaveSender]         = useState(false)
  const [senderToken, setSenderToken]       = useState(() => guessSenderToken(item.description))
  const [senderResidentId, setSenderResidentId] = useState('')
```

- [ ] **Step 4: Add the nudge UI**

`isFlat` and `selectedFlat` already exist further down in `ReviewItem` (`const isFlat =
FLAT_CODES.includes(flatCode)`, `const selectedFlat = flats.find(f => f.code === flatCode)`).
Change the save-button block from:
```tsx
        <div className="flex gap-2">
          {canWrite && (
            <button onClick={handleSave} disabled={!flatCode || saving} className="btn-primary flex-1 text-sm py-2">
              {saving ? <span className="flex justify-center"><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /></span> : 'Save tag'}
            </button>
          )}
          {canWrite && item.cr_dr === 'CR' && (
            <button onClick={() => setShowSplit(true)} className="btn-secondary text-sm px-3 py-2 flex items-center gap-1.5">
              <Scissors size={14} /> Split
            </button>
          )}
        </div>
```
to:
```tsx
        {isAdmin && isFlat && (
          <div className="flex flex-col gap-2 border-t hairline pt-2">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={saveSender} onChange={e => setSaveSender(e.target.checked)} />
              Also save this sender ID for a resident of {flatCode}
            </label>
            {saveSender && (
              <div className="grid grid-cols-2 gap-2">
                <input type="text" value={senderToken} onChange={e => setSenderToken(e.target.value)}
                  className="ds-field text-xs" placeholder="sender ID" />
                <select value={senderResidentId} onChange={e => setSenderResidentId(e.target.value)} className="ds-field text-xs">
                  <option value="">— select resident —</option>
                  {residents.filter(r => r.flat_id === selectedFlat?.id).map(r => (
                    <option key={r.id} value={r.id}>{r.name} ({r.type})</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          {canWrite && (
            <button onClick={handleSave} disabled={!flatCode || saving} className="btn-primary flex-1 text-sm py-2">
              {saving ? <span className="flex justify-center"><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /></span> : 'Save tag'}
            </button>
          )}
          {canWrite && item.cr_dr === 'CR' && (
            <button onClick={() => setShowSplit(true)} className="btn-secondary text-sm px-3 py-2 flex items-center gap-1.5">
              <Scissors size={14} /> Split
            </button>
          )}
        </div>
```

- [ ] **Step 5: Extend `handleSave`**

Change `handleSave` from:
```tsx
  async function handleSave() {
    if (!flatCode) return
    let resolvedPlanId = effectiveCorpus === 'YES' ? planId : null
    if (effectiveCorpus === 'YES' && !resolvedPlanId) {
      if (activePlans.length === 1) resolvedPlanId = activePlans[0].id
      else if (activePlans.length > 1) { toast.error('Select a corpus plan for this payment'); return }
    }
    setSaving(true)
    const flatId = flats.find(f => f.code === flatCode)?.id ?? null
    const { error } = await supabase.from('transactions').update({
      flat_code: flatCode, flat_id: flatId,
      category: isFlat ? category : flatCode,
      corpus: effectiveCorpus,
      plan_id: resolvedPlanId,
      row_type: 'Normal',
    }).eq('id', item.id)
    setSaving(false)
    if (!error) { setSaved(true); setTimeout(onSaved, 400) }
  }
```
to:
```tsx
  async function handleSave() {
    if (!flatCode) return
    let resolvedPlanId = effectiveCorpus === 'YES' ? planId : null
    if (effectiveCorpus === 'YES' && !resolvedPlanId) {
      if (activePlans.length === 1) resolvedPlanId = activePlans[0].id
      else if (activePlans.length > 1) { toast.error('Select a corpus plan for this payment'); return }
    }
    setSaving(true)
    const flatId = flats.find(f => f.code === flatCode)?.id ?? null
    const { error } = await supabase.from('transactions').update({
      flat_code: flatCode, flat_id: flatId,
      category: isFlat ? category : flatCode,
      corpus: effectiveCorpus,
      plan_id: resolvedPlanId,
      row_type: 'Normal',
    }).eq('id', item.id)
    if (!error && saveSender && senderResidentId && senderToken.trim()) {
      const token = senderToken.trim().toLowerCase()
      const conflictOwner = residents.find(r => r.id !== senderResidentId && (r.upi_ids ?? []).some(id => id.toLowerCase() === token))
      if (conflictOwner) {
        toast.error(`${senderToken.trim()} is already saved for ${conflictOwner.name} — not saved again`)
      } else {
        const resident = residents.find(r => r.id === senderResidentId)
        const merged = Array.from(new Set([...(resident?.upi_ids ?? []), token]))
        await supabase.from('residents').update({ upi_ids: merged }).eq('id', senderResidentId)
      }
    }
    setSaving(false)
    if (!error) { setSaved(true); setTimeout(onSaved, 400) }
  }
```

Note: if a conflict is found, the transaction itself still resolves normally (the `error`
check above it already succeeded) — only the sender-ID write is skipped, matching the spec's
framing that this is a data-quality guard on the identifier write, not a reason to block
resolving the transaction.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual verification**

Run `npm run dev`, log in as admin, go to Transactions → Review (needs at least one UNKNOWN
transaction — if none exist, temporarily set one transaction's `flat_code` to `'UNKNOWN'` in
Supabase, then revert after testing). Pick a flat for it: confirm the "Also save this sender
ID…" checkbox appears (admin only — confirm it's absent for a non-admin/committee login).
Leave it unchecked and save: confirm behavior is unchanged from before this task (no mapping
saved). On another UNKNOWN row, check the box, confirm the token field is prefilled from the
description, edit it if needed, pick a resident, save: confirm the transaction resolves as
before AND the chosen resident's `upi_ids` (visible in Flats → Residents) now includes the
token. Then repeat with a token that's already saved on a *different* active resident: confirm
the transaction still resolves, but an error toast reports the conflict and the token is not
added to the newly chosen resident.

- [ ] **Step 8: Commit**

```bash
git add src/pages/TransactionsPage.tsx
git commit -m "$(cat <<'EOF'
feat(transactions): opt-in sender ID capture in the Review tab

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AU3snjDyBkM6LRmBYcUwrc
EOF
)"
```

---

### Task 7: Bulk-apply to matching review-queue rows

**Files:**
- Modify: `src/pages/TransactionsPage.tsx` — `ReviewItem`'s `handleSave` (Task 6)

**Interfaces:**
- Consumes: `flatCode`, `flatId`, `category`, `isFlat`, `effectiveCorpus`, `resolvedPlanId`,
  `item.id`, `senderToken` — all already in scope inside `handleSave`.
- Produces: no new exports; extends Task 6's save behavior.

- [ ] **Step 1: Extend the sender-save block to bulk-apply**

Change the block added in Task 6:
```tsx
    if (!error && saveSender && senderResidentId && senderToken.trim()) {
      const token = senderToken.trim().toLowerCase()
      const conflictOwner = residents.find(r => r.id !== senderResidentId && (r.upi_ids ?? []).some(id => id.toLowerCase() === token))
      if (conflictOwner) {
        toast.error(`${senderToken.trim()} is already saved for ${conflictOwner.name} — not saved again`)
      } else {
        const resident = residents.find(r => r.id === senderResidentId)
        const merged = Array.from(new Set([...(resident?.upi_ids ?? []), token]))
        await supabase.from('residents').update({ upi_ids: merged }).eq('id', senderResidentId)
      }
    }
```
to:
```tsx
    if (!error && saveSender && senderResidentId && senderToken.trim()) {
      const token = senderToken.trim().toLowerCase()
      const conflictOwner = residents.find(r => r.id !== senderResidentId && (r.upi_ids ?? []).some(id => id.toLowerCase() === token))
      if (conflictOwner) {
        toast.error(`${senderToken.trim()} is already saved for ${conflictOwner.name} — not saved again`)
      } else {
        const resident = residents.find(r => r.id === senderResidentId)
        const merged = Array.from(new Set([...(resident?.upi_ids ?? []), token]))
        await supabase.from('residents').update({ upi_ids: merged }).eq('id', senderResidentId)

        const { data: matches } = await supabase
          .from('transactions')
          .select('id')
          .eq('flat_code', 'UNKNOWN')
          .ilike('description', `%${token}%`)
          .neq('id', item.id)
        if (matches && matches.length > 0) {
          await supabase.from('transactions').update({
            flat_code: flatCode, flat_id: flatId,
            category: isFlat ? category : flatCode,
            corpus: effectiveCorpus, plan_id: resolvedPlanId, row_type: 'Normal',
          }).in('id', matches.map(m => m.id))
          toast.success(`Tagged as ${flatCode} — also applied to ${matches.length} other matching transaction${matches.length > 1 ? 's' : ''}`)
        }
      }
    }
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification**

In Supabase, temporarily set two or three UNKNOWN transactions to share an identical
description substring (a fake token, e.g. `TESTSENDER123`) that doesn't collide with real
data. In the app's Review tab, resolve one of them with the checkbox checked and
`senderToken` set to `TESTSENDER123`: confirm a toast reports the correct count of "other
matching transactions," and confirm in the All Transactions tab that all of them now carry the
same flat/category — not just the one you directly edited. Confirm a transaction that does
**not** contain the token is untouched. Revert the temporary test data afterward.

- [ ] **Step 4: Commit**

```bash
git add src/pages/TransactionsPage.tsx
git commit -m "$(cat <<'EOF'
feat(transactions): bulk-apply sender ID resolution to matching review rows

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AU3snjDyBkM6LRmBYcUwrc
EOF
)"
```

---

### Task 8: Flat override in legacy backlog rows

**Files:**
- Modify: `src/pages/FlatsPage.tsx` — `SenderMappingsTab`, `LegacyBacklog`, `LegacyMappingRow`
  (all built in Tasks 2/3/5)

**Interfaces:**
- Consumes: the `flats` table (`id, code`), already queried elsewhere in this file.
- Produces: no new exports; `LegacyMappingRow` gains an editable flat selection instead of
  being locked to `mapping.flatCode`.

**Why:** the hardcoded legacy map's flat assignment for a token isn't always right (that's the
whole reason for the conflict warning in Task 3) — this lets an admin correct it at confirm
time instead of only being able to pick among the (possibly wrong) flat's residents.

- [ ] **Step 1: Fetch flats in `SenderMappingsTab` and pass down**

In `SenderMappingsTab`, add a flats query alongside the existing `residents` query:

```tsx
  const { data: flatsList } = useQuery({
    queryKey: ['flats-lite'],
    queryFn: async () => {
      const { data } = await supabase.from('flats').select('id,code').order('code')
      return (data ?? []) as { id: string; code: string }[]
    },
  })
```

Pass it to `LegacyBacklog` by adding a `flats={flatsList ?? []}` prop to the existing
`<LegacyBacklog ... />` call.

- [ ] **Step 2: Thread `flats` through `LegacyBacklog` to `LegacyMappingRow`**

Add a `flats: { id: string; code: string }[]` field to `LegacyBacklog`'s props type, and pass
`flats={flats}` on its `<LegacyMappingRow ... />` call. Add the same field to
`LegacyMappingRow`'s props type.

- [ ] **Step 3: Make the flat selectable in `LegacyMappingRow`**

Add local state for the (possibly overridden) flat, seeded from the map's original suggestion:

```tsx
  const [flatCode, setFlatCode] = useState(mapping.flatCode)
```

Change the `flatResidents` derivation from filtering on `mapping.flatCode` to filtering on the
new `flatCode` state variable instead (same filter, different source):

```tsx
  const flatResidents = residents.filter(r => r.flat?.code === flatCode)
```

Change the conflict-check query (added in Task 3) to key off and filter against the current
`flatCode` state instead of `mapping.flatCode`:

```tsx
  const { data: conflicts } = useQuery({
    queryKey: ['legacy-conflict', mapping.token, flatCode],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('flat_code')
        .ilike('description', `%${mapping.token}%`)
        .not('flat_code', 'is', null)
        .neq('flat_code', flatCode)
        .neq('flat_code', 'UNKNOWN')
      return data ?? []
    },
  })
```

Replace the static flat display (`<span className="font-semibold">{mapping.flatCode}</span>`)
with an editable select that resets the chosen resident whenever the flat changes (since the
old resident selection likely doesn't belong to the newly chosen flat):

```tsx
        <select value={flatCode} onChange={e => { setFlatCode(e.target.value); setResidentId('') }} className="ds-field w-full">
          {flats.map(f => <option key={f.id} value={f.code}>{f.code}</option>)}
        </select>
```

The grid column count is unchanged (still 5 columns: token, type badge, flat select, resident
select, confirm button) — you're replacing the static flat `<span>` with a `<select>` in the
same grid cell, not adding a new one.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification**

In the running app, open a legacy backlog row. Confirm the flat column is now a dropdown
pre-selected to the map's original flat. Change it to a different flat: confirm the resident
dropdown repopulates with that flat's residents (and clears the previous selection), and the
conflict warning (if any) re-evaluates against the newly selected flat. Confirm with the
overridden flat + a resident of that flat: confirm the saved token lands on the chosen
resident regardless of what the original hardcoded map said.

- [ ] **Step 6: Commit**

```bash
git add src/pages/FlatsPage.tsx
git commit -m "$(cat <<'EOF'
feat(flats): allow overriding the flat on a legacy sender mapping

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AU3snjDyBkM6LRmBYcUwrc
EOF
)"
```

---

### Task 9: Search on the Sender Mappings page

**Files:**
- Modify: `src/pages/FlatsPage.tsx` — `SenderMappingsTab` (residents query, filtering),
  `LegacyBacklog`/`AllFlatsMappings` call sites (Tasks 2/4)

**Interfaces:**
- Consumes: nothing new.
- Produces: no new exports; `SenderMappingsTab` now filters both the legacy backlog and the
  all-flats table it renders, by one shared search box.

- [ ] **Step 1: Add `phone` to the residents query**

`SenderMappingsTab`'s existing residents query selects `id, name, type, relation, flat_id,
is_active, upi_ids, flat:flat_id(code)` — add `phone` to that select list, since search-by-phone
needs it:

```tsx
        .select('id, name, type, relation, phone, flat_id, is_active, upi_ids, flat:flat_id(code)')
```

- [ ] **Step 2: Add search state and filtering**

In `SenderMappingsTab`, add:

```tsx
  const [search, setSearch] = useState('')

  const filteredLegacyMappings = useMemo(() => {
    if (!search.trim()) return legacyMappings
    const q = search.trim().toLowerCase()
    return legacyMappings.filter(m => m.token.toLowerCase().includes(q) || m.flatCode.toLowerCase().includes(q))
  }, [legacyMappings, search])

  const filteredResidentsForTable = useMemo(() => {
    if (!search.trim()) return residents ?? []
    const q = search.trim().toLowerCase()
    return (residents ?? []).filter(r =>
      (r.flat?.code ?? '').toLowerCase().includes(q) ||
      (r.phone ?? '').toLowerCase().includes(q) ||
      (r.upi_ids ?? []).some(id => id.toLowerCase().includes(q))
    )
  }, [residents, search])
```

Note: `LegacyBacklog` still receives the full, unfiltered `residents` prop (it needs every
resident of a flat to populate its own picker correctly) — only the `mappings` prop passed to
it gets filtered. `AllFlatsMappings` receives the filtered residents list, since it's a pure
display table.

- [ ] **Step 3: Wire the filtered data in and add the input**

Change the `<LegacyBacklog ... />` call's `mappings` prop from `legacyMappings` to
`filteredLegacyMappings`. Change the `<AllFlatsMappings ... />` call's `residents` prop from
`residents ?? []` to `filteredResidentsForTable`.

Add the search input near the top of `SenderMappingsTab`'s returned JSX, before
`<LegacyBacklog ... />`:

```tsx
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by flat, phone, or sender ID…"
        className="ds-field w-full max-w-sm"
      />
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification**

In the running app, on the Sender Mappings tab, type a flat code (e.g. `AF1`) into the search
box: confirm both the legacy backlog and the all-flats table narrow to matching rows only.
Clear it, then search a resident's phone number: confirm only that resident's row remains in
the all-flats table (legacy backlog is unaffected, since it has no phone data yet). Search a
sender ID substring: confirm both sections filter correctly. Clear the box: confirm both
sections return to showing everything.

- [ ] **Step 6: Commit**

```bash
git add src/pages/FlatsPage.tsx
git commit -m "$(cat <<'EOF'
feat(flats): search by flat, phone, or sender ID on the Sender Mappings page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AU3snjDyBkM6LRmBYcUwrc
EOF
)"
```

---

### Task 10: Sender IDs (with best-effort type) in the Flats-tab People card

**Files:**
- Modify: `src/lib/tagger.ts` (add `guessSenderIdType`), `src/pages/FlatsPage.tsx` (import,
  `PersonRow`)

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `export function guessSenderIdType(id: string): 'UPI' | 'NEFT'` in `tagger.ts`.

**Why:** the Flats tab's flat-detail dialog already has a People card (`PeopleCard`/
`PersonRow`) showing each resident's name/relation/phone — this surfaces their saved sender
IDs there too, so an admin doesn't have to go to the Sender Mappings tab or the Residents grid
to see what's on file for a specific flat. The DB has no per-ID type column (a deliberate
non-goal of this plan — see Global Constraints), so type is inferred at display time only.

- [ ] **Step 1: Add `guessSenderIdType` to `tagger.ts`**

In `src/lib/tagger.ts`, after `guessSenderToken` (added in Task 1), add:

```ts
// Best-effort type label for an already-saved sender ID, for display only. Bank-transfer
// sender names always contain a space when saved (e.g. "senthilkumar m"); UPI handles and
// phone-numbers-as-UPI-handles never do. Not stored — inferred fresh each render.
export function guessSenderIdType(id: string): 'UPI' | 'NEFT' {
  return id.trim().includes(' ') ? 'NEFT' : 'UPI'
}
```

- [ ] **Step 2: Import it in `FlatsPage.tsx`**

Extend the existing `@/lib/tagger` import (already importing `formatINR, getLegacyMappings,
LegacyMapping, guessSenderToken` by this point in the plan) to also include
`guessSenderIdType`.

- [ ] **Step 3: Show sender ID chips in `PersonRow`**

`PersonRow` currently returns a single-level flex row. Wrap the existing row content in an
outer `flex flex-col gap-1` container, and add a chips row below it, gated on `isAdmin` (this
component already receives `isAdmin` as a prop) and only when the resident has at least one
saved ID:

```tsx
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-sm gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-medium truncate" style={dateRange ? { color: 'var(--ink-500)' } : undefined}>{p.name}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
            style={{ background: 'var(--ink-100)', color: 'var(--ink-500)' }}>{p.relation}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {dateRange
            ? <span className="text-[11px]" style={{ color: 'var(--ink-400)' }}>{dateRange}</span>
            : (canSeePhone && p.phone && (
                <a href={`tel:${p.phone}`} className="text-[12px] font-medium" style={{ color: 'var(--ink-700)' }}>{p.phone}</a>
              ))}
          {isAdmin && (
            <>
```

(keep the rest of the existing admin edit/delete buttons exactly as they are — this is only
showing where the wrapping `<div>` opens; the brief is not asking you to touch the
edit/delete buttons themselves)

After the existing row's closing `</div>` (the one that currently closes the whole
`PersonRow` return), add the new chips block and the new wrapping `</div>`:

```tsx
      {isAdmin && (p.upi_ids ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1 pl-0.5">
          {(p.upi_ids ?? []).map(id => (
            <span key={id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700">
              <span className="font-bold">{guessSenderIdType(id)}</span> {id}
            </span>
          ))}
        </div>
      )}
    </div>
  )
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification**

In the running app, open a flat's detail dialog (Flats tab → click a row) for a flat whose
resident has at least one saved sender ID. Confirm chips appear under that resident's name
with a `UPI` or `NEFT` label matching the ID's shape (a name with a space → `NEFT`, a handle
or number with no space → `UPI`). Confirm the chips are absent for a non-admin login, and
absent for a resident with no saved IDs.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tagger.ts src/pages/FlatsPage.tsx
git commit -m "$(cat <<'EOF'
feat(flats): show sender IDs with a best-effort type label in the People card

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AU3snjDyBkM6LRmBYcUwrc
EOF
)"
```
