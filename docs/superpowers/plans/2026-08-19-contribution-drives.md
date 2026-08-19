# Voluntary Contribution Drives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the committee track voluntary, non-obligatory collections (memorial support, festival collections, etc.) in their own "drives" with a running balance, fully separate from Maintenance and Corpus — tagged via the existing Transactions review/edit UI and managed on a new `/contributions` page.

**Architecture:** One new table (`contribution_drives`, open/closed lifecycle, no per-flat targets), two new nullable columns on `transactions` (`drive_id`, `resident_id`), one new tracking view (`v_contribution_tracker`), and a `category = 'Contribution'` convention that keeps these rows invisible to `v_dues_tracker` and `v_corpus_tracker`. The existing "pick a flat/category" dropdowns in `TransactionsPage.tsx` gain a drive-aware branch (mirroring how they already handle Corpus plans); a new `ContributionsPage.tsx` lists drives and their transaction history.

**Tech Stack:** React 18 + TypeScript + Vite, Supabase (Postgres + RLS + Postgres triggers), TanStack Query, Tailwind, Shadcn/ui, `@supabase/supabase-js` client.

**Spec:** `docs/superpowers/specs/2026-08-19-contribution-drives-design.md`

## Global Constraints

- Migration SQL must be applied via the Supabase Management API (`scripts/apply-migration.js`), never `supabase db push` — the remote migration-history ledger has drifted from actual schema state (see `CLAUDE.md`).
- Every migration must be applied to **both** dev (`qcoezjcwrsqchulqgydm`) and prod (`aulttcsvxzcwyceezzpz`).
- `category = 'Contribution'` is the fixed literal used for every drive-tagged transaction (not a per-drive category name) — this is what keeps them out of `v_dues_tracker` (`category = 'Maintenance'` only) and `v_corpus_tracker` (`corpus = 'YES'` only) with zero changes to either view.
- `drive_id` is required whenever `category = 'Contribution'`, enforced in the app layer only (no DB constraint), matching how `corpus_plan_id`/`corpus = 'YES'` pairing is enforced today.
- No new `contribution_payments` table, no per-flat targets, no cash-in-hand tracking before bank deposit, no PDF/report integration — all explicitly out of scope per the spec.
- `npx tsc --noEmit` must pass after every task that touches TypeScript.
- No destructive testing against prod — manual verification happens against dev (`qcoezjcwrsqchulqgydm`).

---

### Task 1: Migration 045 — `contribution_drives` table, `transactions` columns, tracker view, RLS, audit

**Files:**
- Create: `supabase/migrations/045_contribution_drives.sql`
- Test: none (SQL, verified by direct query against dev/prod)

**Interfaces:**
- Consumes: `public.get_my_role()` (existing helper, migration 020), `public.fn_audit_trigger()` (existing helper, migration 012).
- Produces: table `public.contribution_drives(id, name, description, status, created_at, created_by, closed_at, close_notes)`; new columns `public.transactions.drive_id`, `public.transactions.resident_id`; view `public.v_contribution_tracker(drive_id, name, description, status, created_at, closed_at, collected, disbursed, balance, last_activity)`. All later tasks read/write these.

- [ ] **Step 1: Write the migration file**

```sql
-- 045: Voluntary contribution drives — voluntary collections (memorial support, festival
-- collections, etc.) tracked separately from Maintenance and Corpus. See
-- docs/superpowers/specs/2026-08-19-contribution-drives-design.md

create table public.contribution_drives (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  status       text not null default 'open' check (status in ('open', 'closed')),
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id),
  closed_at    timestamptz,
  close_notes  text
);

alter table public.transactions
  add column drive_id    uuid references public.contribution_drives(id),
  add column resident_id uuid references public.residents(id);

create index idx_txns_drive_id on public.transactions(drive_id);

-- View: one row per drive, collected/disbursed/balance from transactions tagged to it.
-- category='Contribution' is not filtered on here — drive_id is the sole discriminator —
-- so this view stays correct even though category is a shared literal across all drives.
create or replace view public.v_contribution_tracker
with (security_invoker = true) as
select
  cd.id                                                                     as drive_id,
  cd.name,
  cd.description,
  cd.status,
  cd.created_at,
  cd.closed_at,
  coalesce(sum(t.amount) filter (where t.cr_dr = 'CR' and t.row_type != 'VOIDED'), 0) as collected,
  coalesce(sum(t.amount) filter (where t.cr_dr = 'DR' and t.row_type != 'VOIDED'), 0) as disbursed,
  coalesce(sum(t.amount) filter (where t.cr_dr = 'CR' and t.row_type != 'VOIDED'), 0)
    - coalesce(sum(t.amount) filter (where t.cr_dr = 'DR' and t.row_type != 'VOIDED'), 0) as balance,
  max(t.value_date)                                                         as last_activity
from public.contribution_drives cd
left join public.transactions t on t.drive_id = cd.id
group by cd.id, cd.name, cd.description, cd.status, cd.created_at, cd.closed_at;

-- RLS: mirrors corpus_plans (migrations 013 + 020) — read-all, admin-only write
alter table public.contribution_drives enable row level security;

drop policy if exists "contribution_drives_read" on public.contribution_drives;
create policy "contribution_drives_read" on public.contribution_drives
  for select to authenticated using (true);

drop policy if exists "contribution_drives_admin_write" on public.contribution_drives;
create policy "contribution_drives_admin_write" on public.contribution_drives
  for all to authenticated
  using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');

-- Audit trigger (mirrors pattern from 012/016/032)
drop trigger if exists trg_audit_contribution_drives on public.contribution_drives;
create trigger trg_audit_contribution_drives
  after insert or update or delete on public.contribution_drives
  for each row execute function public.fn_audit_trigger();
```

Note: `description` is included in the view and carried through to the TS type in Task 2 even
though the spec's SQL sketch omitted it — the `/contributions` page (Task 5) needs to show a
drive's description without a second round-trip, and `contribution_drives.description` already
exists as a column, so surfacing it on the tracker view is a direct, low-risk extension of the
approved design rather than a new mechanism.

- [ ] **Step 2: Apply to dev**

```bash
SUPABASE_ACCESS_TOKEN=<your PAT> SUPABASE_PROJECT_REF=qcoezjcwrsqchulqgydm \
  node scripts/apply-migration.js supabase/migrations/045_contribution_drives.sql
```

Expected: `HTTP 200: [...]` with no error text. If it fails, read the error, fix the SQL, and
re-run — do not proceed until this succeeds.

- [ ] **Step 3: Verify against dev with a scratch query**

Create a temporary, uncommitted file `scripts/_scratch_verify_045.sql`:

```sql
insert into public.contribution_drives (name, description)
values ('TEST — Delete Me', 'Scratch row for migration 045 verification')
returning id, name, status;

select * from public.v_contribution_tracker where name = 'TEST — Delete Me';
```

Run it the same way:

```bash
SUPABASE_ACCESS_TOKEN=<your PAT> SUPABASE_PROJECT_REF=qcoezjcwrsqchulqgydm \
  node scripts/apply-migration.js scripts/_scratch_verify_045.sql
```

Expected: the insert returns one row with `status: "open"`, and the tracker view returns one row
for it with `collected: 0, disbursed: 0, balance: 0, last_activity: null`. **Keep this test drive
in the dev DB** — Tasks 3 and 4 reuse it for manual verification of the tagging UI; Task 4's last
step deletes it. Delete `scripts/_scratch_verify_045.sql` now (it must never be committed).

- [ ] **Step 4: Apply to prod**

```bash
SUPABASE_ACCESS_TOKEN=<your PAT> \
  node scripts/apply-migration.js supabase/migrations/045_contribution_drives.sql
```

(No `SUPABASE_PROJECT_REF` needed — the script defaults to prod, `aulttcsvxzcwyceezzpz`.)

Expected: `HTTP 200`. Do **not** insert a test row into prod — prod verification is just that the
migration applied cleanly (HTTP 200, no error body).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/045_contribution_drives.sql
git commit -m "$(cat <<'EOF'
feat(db): add contribution_drives table + tracker view

New voluntary-collection mechanism, kept separate from Maintenance and
Corpus via a dedicated category literal and drive_id/resident_id
columns on transactions. Applied to both dev and prod.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: TypeScript types

**Files:**
- Modify: `src/lib/supabase.ts:103-128` (the `Transaction` interface), and add two new interfaces near `CorpusEntry` (around line 221-239, same "VIEW TYPES" section for `ContributionTracker`; `ContributionDrive` goes near the other `── TABLE TYPES ──` interfaces, e.g. right after `CorpusPlan` around line 73).

**Interfaces:**
- Consumes: nothing (pure type definitions).
- Produces: `ContributionDrive`, `ContributionTracker`, and `Transaction.drive_id` / `Transaction.resident_id` — every later frontend task imports these.

- [ ] **Step 1: Add `drive_id` and `resident_id` to `Transaction`**

In `src/lib/supabase.ts`, the current `Transaction` interface reads:

```ts
export interface Transaction {
  id: string
  txn_id: string | null
  value_date: string
  posted_date: string | null
  posted_time: string | null
  description: string
  cr_dr: 'CR' | 'DR'
  amount: number
  flat_id: string | null
  flat_code: string | null
  category: string | null
  corpus: 'YES' | 'NO'
  plan_id: string | null
  fiscal_year: number | null
  fiscal_month: string | null
  fiscal_label: string | null
  source: string
  upload_id: string | null
  split_ref_id: string | null
  split_ref_code: string | null
  row_type: 'Normal' | 'VOIDED' | 'SPLIT'
  months_covered: string | null
  notes: string | null
  created_at: string
}
```

Change the `plan_id` line to add the two new fields directly after it:

```ts
  plan_id: string | null
  drive_id: string | null
  resident_id: string | null
```

- [ ] **Step 2: Add `ContributionDrive` interface**

Directly after the closing `}` of `CorpusPlanFlatInstallment` (the interface right before `Transaction`, ending around line 101), insert:

```ts
export interface ContributionDrive {
  id: string
  name: string
  description: string | null
  status: 'open' | 'closed'
  created_at: string
  created_by: string | null
  closed_at: string | null
  close_notes: string | null
}
```

- [ ] **Step 3: Add `ContributionTracker` interface**

In the `// ── VIEW TYPES ──` section, directly after the closing `}` of `CorpusEntry` (ends around
line 239, right before `ExpenseEntry`), insert:

```ts
export interface ContributionTracker {
  drive_id: string
  name: string
  description: string | null
  status: 'open' | 'closed'
  created_at: string
  closed_at: string | null
  collected: number
  disbursed: number
  balance: number
  last_activity: string | null
}
```

- [ ] **Step 4: Run the type check**

```bash
npx tsc --noEmit
```

Expected: passes (no other file references `drive_id`/`resident_id`/`ContributionDrive`/
`ContributionTracker` yet, so this is a pure addition — no breakage possible).

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase.ts
git commit -m "$(cat <<'EOF'
feat(types): add ContributionDrive/ContributionTracker + transaction fields

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Contribution tagging in the Review tab (`ReviewItem`)

**Files:**
- Modify: `src/pages/TransactionsPage.tsx` — the `ReviewItem` component (currently lines 806-1084).
- Test: manual, against dev (see Step 6).

**Interfaces:**
- Consumes: `ContributionDrive` isn't directly needed here (only `id`/`name` are queried inline); `Transaction.drive_id`/`resident_id` from Task 2; the `contribution_drives` table/RLS from Task 1.
- Produces: nothing consumed by later tasks directly — Task 4 duplicates this pattern independently in `EditModal` (matching how Maintenance/Corpus tagging is already duplicated between the two components today; see the "no changes to `tagger.ts`" note in the spec — this is UI-layer duplication that already exists in the codebase, not something this plan introduces).

- [ ] **Step 1: Add the open-drives query and a name→id lookup**

In `ReviewItem`, directly after the existing `corpusCats` query (ends at line 846 with the closing
`})`), add:

```ts
  const { data: openDrives = [] } = useQuery({
    queryKey: ['open-contribution-drives'],
    queryFn: async () => {
      const { data } = await supabase
        .from('contribution_drives')
        .select('id, name')
        .eq('status', 'open')
        .order('name')
      return (data ?? []) as { id: string; name: string }[]
    },
  })
  const driveIdByName = useMemo(() => new Map(openDrives.map(d => [d.name, d.id])), [openDrives])
```

- [ ] **Step 2: Add `driveId` and `contributorResidentId` state**

Directly after the existing `const [planId, setPlanId] = useState<string | null>(null)` line
(line 816), add:

```ts
  const [driveId, setDriveId] = useState<string | null>(null)
  const [contributorResidentId, setContributorResidentId] = useState<string | null>(null)
```

- [ ] **Step 3: Update the top "Flat / Category" `<select>`'s `onChange`, and add the Contributions optgroup**

The current block (lines 972-992):

```tsx
            <select
              value={flatCode}
              onChange={e => {
                const val = e.target.value
                setFlatCode(val)
                if (!FLAT_CODES.includes(val)) {
                  setCategory(val)
                  const isCorpusCat = corpusCats.includes(val)
                  setCorpus(isCorpusCat ? 'YES' : 'NO')
                  if (isCorpusCat && activePlans.length === 1) setPlanId(activePlans[0].id)
                  if (!isCorpusCat) setPlanId(null)
                }
              }}
              className="w-full ds-field bg-white"
            >
              <option value="">— Select —</option>
              <optgroup label="Flats">{FLAT_CODES.map(f => <option key={f} value={f}>{f}</option>)}</optgroup>
              <optgroup label="Income">{INCOME_CATS.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
              <optgroup label="Expenses">{EXPENSE_CATS.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
              <optgroup label="Corpus works">{corpusCats.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
            </select>
```

Replace it with:

```tsx
            <select
              value={flatCode}
              onChange={e => {
                const val = e.target.value
                setFlatCode(val)
                if (!FLAT_CODES.includes(val)) {
                  const driveIdForVal = driveIdByName.get(val) ?? null
                  setCategory(driveIdForVal ? 'Contribution' : val)
                  const isCorpusCat = corpusCats.includes(val)
                  setCorpus(isCorpusCat ? 'YES' : 'NO')
                  if (isCorpusCat && activePlans.length === 1) setPlanId(activePlans[0].id)
                  if (!isCorpusCat) setPlanId(null)
                  setDriveId(driveIdForVal)
                  setContributorResidentId(null)
                }
              }}
              className="w-full ds-field bg-white"
            >
              <option value="">— Select —</option>
              <optgroup label="Flats">{FLAT_CODES.map(f => <option key={f} value={f}>{f}</option>)}</optgroup>
              <optgroup label="Income">{INCOME_CATS.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
              <optgroup label="Expenses">{EXPENSE_CATS.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
              <optgroup label="Corpus works">{corpusCats.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
              <optgroup label="Contributions">{openDrives.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}</optgroup>
            </select>
```

- [ ] **Step 4: Add "Contribution" to the secondary Category `<select>`, and render the drive/contributor pickers**

The current block (lines 994-1035):

```tsx
          {isFlat && (
            <div>
              <label className="ds-lbl">Category</label>
              <select
                value={category}
                onChange={e => {
                  setCategory(e.target.value)
                  if (e.target.value === 'Corpus') {
                    setCorpus('YES')
                    if (activePlans.length === 1) setPlanId(activePlans[0].id)
                  } else {
                    setCorpus('NO')
                    setPlanId(null)
                  }
                }}
                className="w-full ds-field bg-white"
              >
                <option value="Maintenance">Maintenance</option>
                <option value="Corpus">Corpus</option>
              </select>
            </div>
          )}
        </div>

        {effectiveCorpus === 'YES' && activePlans.length > 1 && (
          <div className="flex flex-col gap-1">
            <Label>Corpus plan</Label>
            <Select
              value={planId ?? ''}
              onValueChange={v => setPlanId(v || null)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select plan…" />
              </SelectTrigger>
              <SelectContent>
                {activePlans.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
```

Replace it with:

```tsx
          {isFlat && (
            <div>
              <label className="ds-lbl">Category</label>
              <select
                value={category}
                onChange={e => {
                  const val = e.target.value
                  setCategory(val)
                  if (val === 'Corpus') {
                    setCorpus('YES')
                    if (activePlans.length === 1) setPlanId(activePlans[0].id)
                    setDriveId(null)
                  } else if (val === 'Contribution') {
                    setCorpus('NO')
                    setPlanId(null)
                    setDriveId(openDrives.length === 1 ? openDrives[0].id : null)
                  } else {
                    setCorpus('NO')
                    setPlanId(null)
                    setDriveId(null)
                    setContributorResidentId(null)
                  }
                }}
                className="w-full ds-field bg-white"
              >
                <option value="Maintenance">Maintenance</option>
                <option value="Corpus">Corpus</option>
                <option value="Contribution">Contribution</option>
              </select>
            </div>
          )}
        </div>

        {effectiveCorpus === 'YES' && activePlans.length > 1 && (
          <div className="flex flex-col gap-1">
            <Label>Corpus plan</Label>
            <Select
              value={planId ?? ''}
              onValueChange={v => setPlanId(v || null)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select plan…" />
              </SelectTrigger>
              <SelectContent>
                {activePlans.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {category === 'Contribution' && openDrives.length > 1 && (
          <div className="flex flex-col gap-1">
            <Label>Contribution drive</Label>
            <Select value={driveId ?? ''} onValueChange={v => setDriveId(v || null)}>
              <SelectTrigger>
                <SelectValue placeholder="Select drive…" />
              </SelectTrigger>
              <SelectContent>
                {openDrives.map(d => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {category === 'Contribution' && isFlat && (
          <div>
            <label className="ds-lbl">Contributor (optional)</label>
            <select
              value={contributorResidentId ?? ''}
              onChange={e => setContributorResidentId(e.target.value || null)}
              className="w-full ds-field bg-white"
            >
              <option value="">— Not specified —</option>
              {residents.filter(r => r.flat_id === selectedFlat?.id).map(r => (
                <option key={r.id} value={r.id}>{r.name} ({r.type})</option>
              ))}
            </select>
          </div>
        )}
```

- [ ] **Step 5: Update `handleSave` to resolve and persist `drive_id`/`resident_id`**

The current `handleSave` (lines 859-874, the part before the sender-capture block):

```ts
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
```

Replace it with:

```ts
  async function handleSave() {
    if (!flatCode) return
    const isContribution = category === 'Contribution'
    let resolvedPlanId = effectiveCorpus === 'YES' ? planId : null
    if (effectiveCorpus === 'YES' && !resolvedPlanId) {
      if (activePlans.length === 1) resolvedPlanId = activePlans[0].id
      else if (activePlans.length > 1) { toast.error('Select a corpus plan for this payment'); return }
    }
    let resolvedDriveId = isContribution ? driveId : null
    if (isContribution && !resolvedDriveId) {
      if (openDrives.length === 1) resolvedDriveId = openDrives[0].id
      else { toast.error('Select a contribution drive for this transaction'); return }
    }
    setSaving(true)
    const flatId = flats.find(f => f.code === flatCode)?.id ?? null
    const { error } = await supabase.from('transactions').update({
      flat_code: flatCode, flat_id: flatId,
      category: isContribution ? 'Contribution' : (isFlat ? category : flatCode),
      corpus: effectiveCorpus,
      plan_id: resolvedPlanId,
      drive_id: resolvedDriveId,
      resident_id: isContribution ? contributorResidentId : null,
      row_type: 'Normal',
    }).eq('id', item.id)
```

Then, further down in the same function, the bulk-apply-to-matching-transactions block (around
line 928-935) currently reads:

```ts
              const { error: bulkError } = await supabase.from('transactions').update({
                flat_code: flatCode, flat_id: flatId,
                category: isFlat ? category : flatCode,
                corpus: effectiveCorpus, plan_id: resolvedPlanId,
              }).in('id', Array.from(matchIds))
```

Replace it with:

```ts
              const { error: bulkError } = await supabase.from('transactions').update({
                flat_code: flatCode, flat_id: flatId,
                category: isContribution ? 'Contribution' : (isFlat ? category : flatCode),
                corpus: effectiveCorpus, plan_id: resolvedPlanId,
                drive_id: resolvedDriveId, resident_id: isContribution ? contributorResidentId : null,
              }).in('id', Array.from(matchIds))
```

(`isContribution` and `resolvedDriveId` are already in scope here — they're declared at the top of
the same `handleSave` function body, and this block runs later in that same function.)

- [ ] **Step 6: Run the type check**

```bash
npx tsc --noEmit
```

Expected: passes. If `openDrives`, `driveIdByName`, `driveId`, or `contributorResidentId` show as
unused or undefined, re-check Steps 1-2 were inserted in `ReviewItem`, not accidentally in a
different component.

- [ ] **Step 7: Manual verification against dev**

Start the dev server pointed at the dev DB and log in as admin:

```bash
npm run dev
```

1. Go to Transactions → Review tab. If there's no unresolved (`REVIEW`) row available to test
   with, temporarily flip any one `Normal` transaction's `flat_code` to `'UNKNOWN'` and
   `row_type` stays `'Normal'` via a scratch SQL update against dev (through
   `scripts/apply-migration.js` with a scratch file, same pattern as Task 1 Step 3) so it appears
   in the Review queue — revert this afterward.
2. On that review card, open the "Flat / Category" dropdown — confirm a **Contributions** optgroup
   appears containing "TEST — Delete Me" (the drive created in Task 1 Step 3).
3. Select it directly (non-flat path): confirm the card doesn't show a "Category" sub-dropdown
   (since it's not a flat), click **Save tag**, and confirm the transaction saves without error.
4. Query dev directly (scratch SQL, same pattern) to confirm: `select category, drive_id,
   resident_id from transactions where id = '<that txn id>';` returns
   `category = 'Contribution'`, `drive_id` = the test drive's id, `resident_id = null`.
5. Repeat with a different unresolved row using the **flat-linked path**: pick a real flat code
   first, then in the "Category" sub-dropdown pick **Contribution**, confirm the "Contribution
   drive" picker only appears if there's more than one open drive (with only one open drive it
   auto-assigns silently), pick a "Contributor" from the dropdown (or leave blank), save, and
   verify via scratch SQL that `flat_id`, `category='Contribution'`, `drive_id`, and
   `resident_id` (if you picked one) all saved correctly.
6. Query dev's `v_dues_tracker` and `v_corpus_tracker` (scratch SQL) and confirm neither includes
   these two test transactions.
7. Revert any temporary `flat_code`/`row_type` change made in step 1.

- [ ] **Step 8: Commit**

```bash
git add src/pages/TransactionsPage.tsx
git commit -m "$(cat <<'EOF'
feat(transactions): tag Review-tab rows to a contribution drive

Extends the existing Maintenance/Corpus tagging pattern in ReviewItem
with a third "Contribution" branch — flat-linked or not, with an
optional contributor (owner/tenant) picker.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Contribution tagging in All Transactions → Edit (`EditModal`)

**Files:**
- Modify: `src/pages/TransactionsPage.tsx` — `AllTransactionsTab` (currently lines 1495-1761, specifically the `residents` query and the `<EditModal>` call site) and `EditModal` (currently lines 1087-1312).
- Test: manual, against dev (see Step 8), which also cleans up the Task 1 test drive.

**Interfaces:**
- Consumes: `Transaction.drive_id`/`resident_id` (Task 2), `contribution_drives` table (Task 1). Independent of Task 3's changes (same pattern, separately implemented, matching this file's existing Maintenance/Corpus duplication between `ReviewItem` and `EditModal`).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Fetch `residents` in `AllTransactionsTab` and pass to `EditModal`**

`AllTransactionsTab` currently has a `flats` query (lines 1526-1532) but no `residents` query.
Directly after that `flats` query, add:

```ts
  const { data: residents } = useQuery({
    queryKey: ['residents-active-lite'],
    queryFn: async () => {
      const { data } = await supabase.from('residents').select('id,name,type,flat_id,upi_ids').eq('is_active', true)
      return (data ?? []) as { id: string; name: string; type: string; flat_id: string; upi_ids: string[] }[]
    },
  })
```

Then update the `<EditModal>` call site (currently lines 1711-1718):

```tsx
      {showEdit && selectedTxn && (
        <EditModal
          txn={selectedTxn}
          flats={flats ?? []}
          onClose={() => setShowEdit(false)}
          onSaved={(updated) => { setSelectedTxn(updated); setShowEdit(false); qc.invalidateQueries() }}
          onSplit={() => { setShowEdit(false); setShowSplit(true) }}
          onVoided={() => { setShowEdit(false); setSelectedTxn(null); qc.invalidateQueries({ queryKey: ['all-transactions'] }) }}
        />
      )}
```

by adding a `residents` prop:

```tsx
      {showEdit && selectedTxn && (
        <EditModal
          txn={selectedTxn}
          flats={flats ?? []}
          residents={residents ?? []}
          onClose={() => setShowEdit(false)}
          onSaved={(updated) => { setSelectedTxn(updated); setShowEdit(false); qc.invalidateQueries() }}
          onSplit={() => { setShowEdit(false); setShowSplit(true) }}
          onVoided={() => { setShowEdit(false); setSelectedTxn(null); qc.invalidateQueries({ queryKey: ['all-transactions'] }) }}
        />
      )}
```

- [ ] **Step 2: Accept `residents` in `EditModal`'s props, add drive query + state**

The current signature (lines 1087-1096):

```tsx
function EditModal({ txn, flats, onClose, onSaved, onSplit, onVoided }: {
  txn: Transaction
  flats: any[]
  onClose: () => void
  onSaved: (updated: Transaction) => void
  onSplit: () => void
  onVoided: () => void
}) {
  const { isAdmin } = useRoleCtx()
  const isFlat = (code: string) => FLAT_CODES.includes(code)

  const [flatCode,     setFlatCode]     = useState(txn.flat_code ?? '')
  const [category,     setCategory]     = useState(txn.category ?? '')
  const [corpus,       setCorpus]       = useState<'YES' | 'NO'>(txn.corpus ?? 'NO')
  const [planId,       setPlanId]       = useState<string | null>(txn.plan_id ?? null)
```

Replace it with:

```tsx
function EditModal({ txn, flats, residents, onClose, onSaved, onSplit, onVoided }: {
  txn: Transaction
  flats: any[]
  residents: { id: string; name: string; type: string; flat_id: string }[]
  onClose: () => void
  onSaved: (updated: Transaction) => void
  onSplit: () => void
  onVoided: () => void
}) {
  const { isAdmin } = useRoleCtx()
  const isFlat = (code: string) => FLAT_CODES.includes(code)

  const [flatCode,     setFlatCode]     = useState(txn.flat_code ?? '')
  const [category,     setCategory]     = useState(txn.category ?? '')
  const [corpus,       setCorpus]       = useState<'YES' | 'NO'>(txn.corpus ?? 'NO')
  const [planId,       setPlanId]       = useState<string | null>(txn.plan_id ?? null)
  const [driveId,      setDriveId]      = useState<string | null>(txn.drive_id ?? null)
  const [residentId,   setResidentId]   = useState<string | null>(txn.resident_id ?? null)
```

Then directly after the existing `corpusCats` query (ends line 1129 with `})`), add:

```ts
  const { data: openDrives = [] } = useQuery({
    queryKey: ['open-contribution-drives'],
    queryFn: async () => {
      const { data } = await supabase
        .from('contribution_drives')
        .select('id, name')
        .eq('status', 'open')
        .order('name')
      return (data ?? []) as { id: string; name: string }[]
    },
  })
  const driveIdByName = useMemo(() => new Map(openDrives.map(d => [d.name, d.id])), [openDrives])
```

- [ ] **Step 3: Update `handleFlatChange` and `handleCategoryChange`**

Current (lines 1131-1152):

```ts
  function handleFlatChange(val: string) {
    setFlatCode(val)
    if (!isFlat(val)) {
      setCategory(val)
      const isCorpusCat = corpusCats.includes(val)
      setCorpus(isCorpusCat ? 'YES' : 'NO')
      if (isCorpusCat && activePlans.length === 1) setPlanId(activePlans[0].id)
      if (!isCorpusCat) setPlanId(null)
    }
    else { setCategory('Maintenance'); setCorpus('NO'); setPlanId(null) }
  }

  function handleCategoryChange(val: string) {
    setCategory(val)
    if (val === 'Corpus') {
      setCorpus('YES')
      if (activePlans.length === 1) setPlanId(activePlans[0].id)
    } else {
      setCorpus('NO')
      setPlanId(null)
    }
  }
```

Replace it with:

```ts
  function handleFlatChange(val: string) {
    setFlatCode(val)
    if (!isFlat(val)) {
      const driveIdForVal = driveIdByName.get(val) ?? null
      setCategory(driveIdForVal ? 'Contribution' : val)
      const isCorpusCat = corpusCats.includes(val)
      setCorpus(isCorpusCat ? 'YES' : 'NO')
      if (isCorpusCat && activePlans.length === 1) setPlanId(activePlans[0].id)
      if (!isCorpusCat) setPlanId(null)
      setDriveId(driveIdForVal)
      setResidentId(null)
    }
    else { setCategory('Maintenance'); setCorpus('NO'); setPlanId(null); setDriveId(null); setResidentId(null) }
  }

  function handleCategoryChange(val: string) {
    setCategory(val)
    if (val === 'Corpus') {
      setCorpus('YES')
      if (activePlans.length === 1) setPlanId(activePlans[0].id)
      setDriveId(null)
    } else if (val === 'Contribution') {
      setCorpus('NO')
      setPlanId(null)
      setDriveId(openDrives.length === 1 ? openDrives[0].id : null)
    } else {
      setCorpus('NO')
      setPlanId(null)
      setDriveId(null)
      setResidentId(null)
    }
  }
```

- [ ] **Step 4: Update `handleSave`**

Current (lines 1160-1177):

```ts
  async function handleSave() {
    let resolvedPlanId = corpus === 'YES' ? planId : null
    if (corpus === 'YES' && !resolvedPlanId) {
      if (activePlans.length === 1) resolvedPlanId = activePlans[0].id
      else if (activePlans.length > 1) { toast.error('Select a corpus plan for this transaction'); return }
    }
    setSaving(true)
    const flatId = flats.find(f => f.code === flatCode)?.id ?? null
    const resolvedCategory = isFlat(flatCode) ? category : flatCode
    const { error } = await supabase.from('transactions').update({
      flat_code: flatCode, flat_id: flatId, category: resolvedCategory, corpus,
      plan_id: resolvedPlanId,
    }).eq('id', txn.id)
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('Transaction updated')
    onSaved({ ...txn, flat_code: flatCode, flat_id: flatId, category: resolvedCategory, corpus, plan_id: resolvedPlanId })
  }
```

Replace it with:

```ts
  async function handleSave() {
    const isContribution = category === 'Contribution'
    let resolvedPlanId = corpus === 'YES' ? planId : null
    if (corpus === 'YES' && !resolvedPlanId) {
      if (activePlans.length === 1) resolvedPlanId = activePlans[0].id
      else if (activePlans.length > 1) { toast.error('Select a corpus plan for this transaction'); return }
    }
    let resolvedDriveId = isContribution ? driveId : null
    if (isContribution && !resolvedDriveId) {
      if (openDrives.length === 1) resolvedDriveId = openDrives[0].id
      else { toast.error('Select a contribution drive for this transaction'); return }
    }
    setSaving(true)
    const flatId = flats.find(f => f.code === flatCode)?.id ?? null
    const resolvedCategory = isContribution ? 'Contribution' : (isFlat(flatCode) ? category : flatCode)
    const resolvedResidentId = isContribution ? residentId : null
    const { error } = await supabase.from('transactions').update({
      flat_code: flatCode, flat_id: flatId, category: resolvedCategory, corpus,
      plan_id: resolvedPlanId, drive_id: resolvedDriveId, resident_id: resolvedResidentId,
    }).eq('id', txn.id)
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('Transaction updated')
    onSaved({ ...txn, flat_code: flatCode, flat_id: flatId, category: resolvedCategory, corpus, plan_id: resolvedPlanId, drive_id: resolvedDriveId, resident_id: resolvedResidentId })
  }
```

- [ ] **Step 5: Update the JSX — add the Contributions optgroup, the Contribution option, guard the corpus checkbox, and render the drive/contributor pickers**

The top combined dropdown (lines 1219-1226):

```tsx
            <select value={flatCode} onChange={e => handleFlatChange(e.target.value)}
              className="w-full ds-field">
              <option value="">— Select —</option>
              <optgroup label="Flats">{FLAT_CODES.map(f => <option key={f} value={f}>{f}</option>)}</optgroup>
              <optgroup label="Income">{INCOME_CATS.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
              <optgroup label="Expenses">{EXPENSE_CATS.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
              <optgroup label="Corpus works">{corpusCats.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
            </select>
```

Replace it with:

```tsx
            <select value={flatCode} onChange={e => handleFlatChange(e.target.value)}
              className="w-full ds-field">
              <option value="">— Select —</option>
              <optgroup label="Flats">{FLAT_CODES.map(f => <option key={f} value={f}>{f}</option>)}</optgroup>
              <optgroup label="Income">{INCOME_CATS.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
              <optgroup label="Expenses">{EXPENSE_CATS.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
              <optgroup label="Corpus works">{corpusCats.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
              <optgroup label="Contributions">{openDrives.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}</optgroup>
            </select>
```

The "Type" select and the non-flat corpus checkbox (lines 1229-1252):

```tsx
          {isFlat(flatCode) && (
            <div>
              <label className="ds-lbl">Type</label>
              <select value={category} onChange={e => handleCategoryChange(e.target.value)}
                className="w-full ds-field">
                <option value="Maintenance">Maintenance</option>
                <option value="Corpus">Corpus</option>
              </select>
            </div>
          )}

          {!isFlat(flatCode) && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={corpus === 'YES'} onChange={e => {
                const checked = e.target.checked
                setCorpus(checked ? 'YES' : 'NO')
                if (checked && !planId && activePlans.length === 1) setPlanId(activePlans[0].id)
                if (!checked) setPlanId(null)
              }}
                className="w-4 h-4 rounded" />
              <span className="text-slate-700">Corpus {txn.cr_dr === 'DR' ? 'expenditure' : 'collection'}</span>
              <span className="text-xs text-slate-400">{txn.cr_dr === 'DR' ? '(from corpus fund)' : '(corpus)'}</span>
            </label>
          )}
```

Replace it with:

```tsx
          {isFlat(flatCode) && (
            <div>
              <label className="ds-lbl">Type</label>
              <select value={category} onChange={e => handleCategoryChange(e.target.value)}
                className="w-full ds-field">
                <option value="Maintenance">Maintenance</option>
                <option value="Corpus">Corpus</option>
                <option value="Contribution">Contribution</option>
              </select>
            </div>
          )}

          {!isFlat(flatCode) && category !== 'Contribution' && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={corpus === 'YES'} onChange={e => {
                const checked = e.target.checked
                setCorpus(checked ? 'YES' : 'NO')
                if (checked && !planId && activePlans.length === 1) setPlanId(activePlans[0].id)
                if (!checked) setPlanId(null)
              }}
                className="w-4 h-4 rounded" />
              <span className="text-slate-700">Corpus {txn.cr_dr === 'DR' ? 'expenditure' : 'collection'}</span>
              <span className="text-xs text-slate-400">{txn.cr_dr === 'DR' ? '(from corpus fund)' : '(corpus)'}</span>
            </label>
          )}
```

Then, directly after the existing corpus-plan `Select` block (ends line 1271 with `)}`, right
before the `<div className="flex gap-2 pt-1">` at line 1273), insert:

```tsx
          {category === 'Contribution' && openDrives.length > 1 && (
            <div className="flex flex-col gap-1">
              <Label>Contribution drive</Label>
              <Select value={driveId ?? ''} onValueChange={v => setDriveId(v || null)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select drive…" />
                </SelectTrigger>
                <SelectContent>
                  {openDrives.map(d => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {category === 'Contribution' && isFlat(flatCode) && (
            <div>
              <label className="ds-lbl">Contributor (optional)</label>
              <select
                value={residentId ?? ''}
                onChange={e => setResidentId(e.target.value || null)}
                className="w-full ds-field"
              >
                <option value="">— Not specified —</option>
                {residents.filter(r => r.flat_id === flats.find(f => f.code === flatCode)?.id).map(r => (
                  <option key={r.id} value={r.id}>{r.name} ({r.type})</option>
                ))}
              </select>
            </div>
          )}
```

- [ ] **Step 6: Run the type check**

```bash
npx tsc --noEmit
```

Expected: passes.

- [ ] **Step 7: Manual verification against dev**

With `npm run dev` still pointed at dev DB:

1. Go to Transactions → All Transactions tab, click any `Normal` transaction to select it, click
   **Edit**.
2. Confirm the top dropdown's **Contributions** optgroup shows "TEST — Delete Me".
3. Pick it directly (non-flat path), save, confirm success toast, then re-open the row and confirm
   it now shows the drive selected (state round-trips from `txn.drive_id` correctly).
4. Edit a different transaction: pick a real flat, then in "Type" pick **Contribution**, confirm
   the "Corpus expenditure/collection" checkbox does NOT show (it's flat-linked, so that checkbox
   never showed anyway — re-confirm instead that picking Contribution on a **non-flat** row, e.g.
   one already tagged `SALARY`, hides that checkbox correctly), pick a contributor, save.
5. Verify via scratch SQL (same pattern as Task 1 Step 3) that both edits persisted
   `category='Contribution'`, the correct `drive_id`, and `resident_id` where set.
6. **Clean up:** delete the Task 1 test drive and its two-to-four test transactions from dev:

```sql
delete from public.transactions where drive_id = (select id from public.contribution_drives where name = 'TEST — Delete Me');
delete from public.contribution_drives where name = 'TEST — Delete Me';
```

   Run this via the same scratch-file + `apply-migration.js` pattern, then delete the scratch file.
   Confirm with a `select` that both are gone before moving on.

- [ ] **Step 8: Commit**

```bash
git add src/pages/TransactionsPage.tsx
git commit -m "$(cat <<'EOF'
feat(transactions): tag All Transactions edits to a contribution drive

Same Contribution branch as ReviewItem (Task 3), applied to EditModal
— including threading a residents query through AllTransactionsTab so
the contributor picker has data to show.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `ContributionsPage.tsx` + route

**Files:**
- Create: `src/pages/ContributionsPage.tsx`
- Modify: `src/App.tsx:5-22` (import), `src/App.tsx:56` area (route)
- Test: manual, against dev (see Step 3).

**Interfaces:**
- Consumes: `ContributionTracker` type (Task 2), `v_contribution_tracker` view + `contribution_drives` table (Task 1).
- Produces: the `/contributions` route, which Task 6 links from the sidebar nav.

- [ ] **Step 1: Create `src/pages/ContributionsPage.tsx`**

```tsx
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, HandHeart, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase, ContributionTracker } from '@/lib/supabase'
import { formatINR } from '@/lib/tagger'
import { formatDateDMY } from '@/lib/date'
import { useRoleCtx } from '@/contexts/RoleContext'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

const STATUS_BADGE: Record<string, string> = {
  open:   'bg-green-100 text-green-700',
  closed: 'bg-slate-100 text-slate-600',
}

interface DriveTxn {
  id: string
  value_date: string
  flat_code: string | null
  cr_dr: 'CR' | 'DR'
  amount: number
  notes: string | null
  resident: { name: string } | null
}

export default function ContributionsPage() {
  const { isAdmin } = useRoleCtx()
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [selectedDriveId, setSelectedDriveId] = useState<string | null>(null)

  const { data: drives = [], isLoading } = useQuery({
    queryKey: ['contribution-drives'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_contribution_tracker')
        .select('*')
        .order('status', { ascending: true })
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as ContributionTracker[]
    },
  })

  return (
    <div className="flex flex-col gap-5 fade-in">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-extrabold">Contributions</h1>
          <p className="text-[13.5px] mt-1" style={{ color: 'var(--ink-500)' }}>
            Voluntary collections — festivals, welfare causes — tracked separately from Maintenance and Corpus
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => setShowCreate(true)} className="flex items-center gap-2 shrink-0">
            <Plus size={15} /> New drive
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-20 animate-pulse rounded-[var(--ds-radius)]" style={{ background: 'var(--ink-100)' }} />)}
        </div>
      ) : drives.length === 0 ? (
        <div className="surface !p-12 flex flex-col items-center gap-3">
          <HandHeart size={40} style={{ color: 'var(--ink-300)' }} />
          <p className="font-semibold text-lg">No contribution drives yet</p>
          <p className="text-slate-500 text-sm">{isAdmin ? 'Click "New drive" to start one.' : 'Nothing recorded yet.'}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {drives.map(d => (
            <div key={d.drive_id} className="surface !p-0 overflow-hidden">
              <button
                onClick={() => setSelectedDriveId(id => id === d.drive_id ? null : d.drive_id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--ink-50)] transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{d.name}</span>
                    <span className={`text-[10.5px] font-bold px-1.5 py-0.5 rounded ${STATUS_BADGE[d.status]}`}>{d.status.toUpperCase()}</span>
                  </div>
                  <p className="text-xs mt-1" style={{ color: 'var(--ink-400)' }}>
                    Collected {formatINR(d.collected)} · Disbursed {formatINR(d.disbursed)}
                    {d.last_activity && <> · Last activity {formatDateDMY(d.last_activity)}</>}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs" style={{ color: 'var(--ink-400)' }}>Balance in hand</p>
                  <p className="font-bold" style={{ color: d.balance !== 0 ? 'var(--brand-700)' : 'var(--ink-600)' }}>{formatINR(d.balance)}</p>
                </div>
                {selectedDriveId === d.drive_id
                  ? <ChevronUp size={16} className="shrink-0" style={{ color: 'var(--ink-400)' }} />
                  : <ChevronDown size={16} className="shrink-0" style={{ color: 'var(--ink-400)' }} />}
              </button>
              {selectedDriveId === d.drive_id && (
                <DriveDetail
                  drive={d}
                  isAdmin={isAdmin}
                  onClosed={() => { qc.invalidateQueries({ queryKey: ['contribution-drives'] }); setSelectedDriveId(null) }}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateDriveDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); qc.invalidateQueries({ queryKey: ['contribution-drives'] }) }}
        />
      )}
    </div>
  )
}

function DriveDetail({ drive, isAdmin, onClosed }: {
  drive: ContributionTracker
  isAdmin: boolean
  onClosed: () => void
}) {
  const [showClose, setShowClose] = useState(false)

  const { data: txns = [], isLoading } = useQuery({
    queryKey: ['contribution-drive-txns', drive.drive_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('id, value_date, flat_code, cr_dr, amount, notes, resident:resident_id(name)')
        .eq('drive_id', drive.drive_id)
        .neq('row_type', 'VOIDED')
        .order('value_date', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as DriveTxn[]
    },
  })

  return (
    <div className="border-t hairline p-4 flex flex-col gap-3">
      {drive.description && <p className="text-sm" style={{ color: 'var(--ink-600)' }}>{drive.description}</p>}

      {isLoading ? (
        <div className="h-24 animate-pulse rounded-[var(--ds-radius)]" style={{ background: 'var(--ink-100)' }} />
      ) : txns.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--ink-400)' }}>No transactions tagged to this drive yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b hairline text-left">
                <th className="py-2 pr-3 font-semibold text-xs" style={{ color: 'var(--ink-500)' }}>Date</th>
                <th className="py-2 pr-3 font-semibold text-xs" style={{ color: 'var(--ink-500)' }}>Flat</th>
                <th className="py-2 pr-3 font-semibold text-xs" style={{ color: 'var(--ink-500)' }}>Contributor</th>
                <th className="py-2 pr-3 font-semibold text-xs text-right" style={{ color: 'var(--ink-500)' }}>Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y hairline">
              {txns.map(t => (
                <tr key={t.id}>
                  <td className="py-2 pr-3 font-mono text-xs whitespace-nowrap" style={{ color: 'var(--ink-600)' }}>{formatDateDMY(t.value_date)}</td>
                  <td className="py-2 pr-3 text-xs" style={{ color: 'var(--ink-700)' }}>{t.flat_code ?? '—'}</td>
                  <td className="py-2 pr-3 text-xs" style={{ color: 'var(--ink-700)' }}>{t.resident?.name ?? '—'}</td>
                  <td className={`py-2 pr-3 text-xs text-right font-semibold tabular-nums ${t.cr_dr === 'CR' ? 'text-green-700' : 'text-red-600'}`}>
                    {t.cr_dr === 'DR' ? '− ' : ''}{formatINR(t.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isAdmin && drive.status === 'open' && (
        <button onClick={() => setShowClose(true)} className="btn-secondary self-start text-sm">Close drive</button>
      )}

      {showClose && (
        <CloseDriveDialog
          drive={drive}
          onClose={() => setShowClose(false)}
          onClosed={() => { setShowClose(false); onClosed() }}
        />
      )}
    </div>
  )
}

function CreateDriveDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleCreate() {
    if (!name.trim()) return
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('contribution_drives').insert({
      name: name.trim(),
      description: description.trim() || null,
      created_by: user?.id ?? null,
    })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('Contribution drive created')
    onCreated()
  }

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New contribution drive</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Kannan Security — Family Support" />
          </div>
          <div>
            <Label>Description (optional)</Label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} className="w-full ds-field" rows={3} />
          </div>
        </div>
        <DialogFooter>
          <button onClick={onClose} className="btn-secondary flex-1 text-sm">Cancel</button>
          <button onClick={handleCreate} disabled={!name.trim() || saving} className="btn-primary flex-1 text-sm">
            {saving ? 'Creating…' : 'Create drive'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CloseDriveDialog({ drive, onClose, onClosed }: {
  drive: ContributionTracker
  onClose: () => void
  onClosed: () => void
}) {
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleConfirm() {
    setSaving(true)
    const { error } = await supabase.from('contribution_drives').update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      close_notes: notes.trim() || null,
    }).eq('id', drive.drive_id)
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('Drive closed')
    onClosed()
  }

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Close "{drive.name}"?</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          {drive.balance !== 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
              This drive still has a balance of <strong>{formatINR(drive.balance)}</strong> in hand. Closing does not
              block on this — make sure that's intentional (e.g. rounding, or a carry-forward you're tracking in the notes below).
            </div>
          )}
          <div>
            <Label>Close notes (optional)</Label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} className="w-full ds-field" rows={3}
              placeholder="e.g. Handed over ₹45,000 cash to the family on 19-Aug-26" />
          </div>
        </div>
        <DialogFooter>
          <button onClick={onClose} className="btn-secondary flex-1 text-sm">Cancel</button>
          <button onClick={handleConfirm} disabled={saving} className="btn-primary flex-1 text-sm">
            {saving ? 'Closing…' : 'Close drive'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Wire the route in `src/App.tsx`**

Add the import, directly after `import CorpusPage from '@/pages/CorpusPage'` (line 10):

```ts
import ContributionsPage from '@/pages/ContributionsPage'
```

Add the route, directly after `<Route path="corpus" element={<CorpusPage />} />` (line 56):

```tsx
          <Route path="contributions" element={<ContributionsPage />} />
```

- [ ] **Step 3: Type-check, then manually verify against dev**

```bash
npx tsc --noEmit
```

Expected: passes.

With `npm run dev` pointed at dev DB, log in as admin, navigate directly to
`http://localhost:5173/contributions` (no sidebar link yet — that's Task 6):

1. Confirm the empty state renders ("No contribution drives yet") since Task 4's cleanup step
   already deleted the test drive.
2. Click **New drive**, create one named e.g. "TEST — Page Verify" with a description, confirm it
   appears in the list with `OPEN` badge, ₹0 collected/disbursed/balance.
3. Click the row to expand — confirm the description shows and "No transactions tagged to this
   drive yet." appears, and a **Close drive** button is visible (admin, open status).
4. Go to Transactions → Review or All Transactions, tag one CR transaction to "TEST — Page
   Verify" (using the flow built in Task 3 or 4).
5. Return to `/contributions`, confirm the row's Collected/Balance numbers updated and the
   expanded transaction table shows that row with the right flat/amount.
6. Click **Close drive**, confirm the balance warning shows if balance ≠ 0, add a close note,
   confirm — confirm the badge flips to `CLOSED` and the button disappears.
7. Clean up: delete "TEST — Page Verify" and its transactions via scratch SQL (same pattern as
   Task 1 Step 3), same delete pattern as Task 4 Step 7 but matching `name = 'TEST — Page Verify'`.

- [ ] **Step 4: Commit**

```bash
git add src/pages/ContributionsPage.tsx src/App.tsx
git commit -m "$(cat <<'EOF'
feat(contributions): add /contributions page — drive list, create, close

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Sidebar nav, owner-blocking, and Help panel entry

**Files:**
- Modify: `src/components/layout/Layout.tsx:4-9` (icon import), `:22-36` (`NAV` array), `:47` (`OWNER_BLOCKED` array)
- Modify: `src/components/HelpButton.tsx:17-107` (`HELP` map)
- Test: manual (see Step 3).

**Interfaces:**
- Consumes: the `/contributions` route from Task 5.
- Produces: nothing consumed elsewhere — this is the final polish task.

- [ ] **Step 1: Add the nav entry and owner-block in `Layout.tsx`**

The icon import (lines 4-9) currently reads:

```ts
import {
  LayoutDashboard, IndianRupee, Banknote, Building2, Receipt,
  FileText, Users, Settings, LogOut, Menu,
  Megaphone, History, Shield, Bell,
  MoreHorizontal, HelpCircle, Home, User, PiggyBank,
} from 'lucide-react'
```

Add `HandHeart` to the list:

```ts
import {
  LayoutDashboard, IndianRupee, Banknote, Building2, Receipt,
  FileText, Users, Settings, LogOut, Menu,
  Megaphone, History, Shield, Bell,
  MoreHorizontal, HelpCircle, Home, User, PiggyBank, HandHeart,
} from 'lucide-react'
```

The `NAV` array (lines 22-36) currently has the Corpus Fund entry at line 25:

```ts
  { to: '/corpus',           icon: Building2,       label: 'Corpus Fund' },
```

Add a new entry directly after it:

```ts
  { to: '/corpus',           icon: Building2,       label: 'Corpus Fund' },
  { to: '/contributions',    icon: HandHeart,       label: 'Contributions' },
```

The `OWNER_BLOCKED` array (line 47) currently reads:

```ts
const OWNER_BLOCKED = ['/transactions', '/dues', '/corpus', '/finance', '/expenses', '/flats', '/reports', '/activity', '/users']
```

Add `/contributions`:

```ts
const OWNER_BLOCKED = ['/transactions', '/dues', '/corpus', '/contributions', '/finance', '/expenses', '/flats', '/reports', '/activity', '/users']
```

- [ ] **Step 2: Add the Help panel entry in `HelpButton.tsx`**

Directly after the `/corpus` entry (ends line 53 with `},`), insert:

```ts
  '/contributions': {
    title: 'Contributions',
    bullets: [
      'Tracks voluntary, one-off collections — festival funds, welfare support for staff or their families — kept fully separate from Maintenance and Corpus.',
      'Each cause is its own "drive" with a running balance: money in (bank credits tagged to it) minus money out (the eventual cash withdrawal or handover).',
      'Tag a bank transaction to a drive from the Transactions page — pick the drive directly, or pick a flat first and set its category to "Contribution".',
      'Closing a drive does not require a zero balance — a small carry-forward is fine, just note why in the close notes.',
    ],
    howTo: 'Click "New drive", give it a name (and optional description), then go tag matching transactions to it from Transactions → Review or All Transactions.',
  },
```

- [ ] **Step 3: Manual verification against dev**

With `npm run dev` running:

1. Confirm "Contributions" appears in the sidebar between "Corpus Fund" and "Expenses", with a
   hand-heart icon, and clicking it navigates to `/contributions`.
2. Log in (or switch role, if the dev environment supports it) as an `owner`-role user and confirm
   `/contributions` is not in their nav and that navigating to it directly redirects to
   `/dashboard` (same behavior as `/corpus` today).
3. Click the floating **?** help button on `/contributions` and confirm the new help content
   renders instead of the generic default.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/Layout.tsx src/components/HelpButton.tsx
git commit -m "$(cat <<'EOF'
feat(contributions): add sidebar nav entry and help panel content

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
