# Arrears Tracking + My Flat for All Users — Design Spec

**Date:** 2026-06-07
**Status:** Approved

---

## Problem

1. **Arrears gap:** `v_dues_tracker` sums maintenance CRs from `dues_start_fiscal_year` onward. When admin advances the FY config (e.g. 2025 → 2026), any unpaid FY 2025-26 balances silently vanish — there is no concept of carried-forward debt. Same gap exists for corpus plans on closure.

2. **Pre-FY25-26 legacy debt:** Some flats (e.g. EP2) made lump-sum payments in April 2025 that included old arrears. The DB over-counts those as current-FY collections, producing a false surplus. Admin needs to record the legacy arrears explicitly so the total outstanding is correct.

3. **My Flat for non-owners:** Only `owner`-role users see their flat's dues/corpus/payments. Admin, committee, and auditor users who live in the building have no way to see their own flat's status.

4. **Flat assignment for all users:** The `profiles.flat_id` column exists but is only populated during owner account creation. There is no UI to assign a flat to any other user role.

---

## Scope

Two parallel features:
- **Feature A:** Arrears tracking (maintenance + corpus)
- **Feature B:** My Flat page + flat assignment for all roles

---

## Feature A — Arrears Tracking

### A1. Schema

#### New table: `flat_arrears`

```sql
CREATE TABLE flat_arrears (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flat_id      uuid NOT NULL REFERENCES flats(id) ON DELETE CASCADE,
  arrears_type text NOT NULL CHECK (arrears_type IN ('maintenance', 'corpus')),
  source_label text NOT NULL,   -- 'FY 2024-25' or 'Corpus 2025'
  amount       integer NOT NULL CHECK (amount > 0),
  notes        text,
  created_at   timestamptz DEFAULT now(),
  created_by   uuid NOT NULL REFERENCES auth.users(id),
  UNIQUE (flat_id, arrears_type, source_label)
);
CREATE INDEX idx_flat_arrears_flat_id ON flat_arrears (flat_id);
```

The `UNIQUE (flat_id, arrears_type, source_label)` constraint makes the FY rollover and corpus closure workflows idempotent — double-clicking cannot create duplicate rows.

`created_by NOT NULL` ensures all system-generated rows have an audit trail.

#### Alter `transactions`: add `plan_id`

```sql
ALTER TABLE transactions ADD COLUMN plan_id uuid REFERENCES corpus_plans(id);
```

- `NULL` on all existing rows → fully backward compatible; FY-range scoping continues to apply.
- Set by admin during transaction tagging when multiple active corpus plans exist in the same FY range.
- When `plan_id IS NOT NULL`, `v_corpus_tracker` attributes the transaction to that plan only.
- When `plan_id IS NULL`, FY-range scoping applies (existing behaviour).
- The import/tagging UI prompts for plan_id when more than one corpus plan is active.

### A2. RLS for `flat_arrears`

```sql
ALTER TABLE flat_arrears ENABLE ROW LEVEL SECURITY;

CREATE POLICY "flat_arrears_read" ON flat_arrears
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'committee', 'auditor')
    OR flat_id = public.get_my_flat_id()
  );

CREATE POLICY "flat_arrears_write" ON flat_arrears
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');
```

### A3. View changes

#### `v_dues_tracker` — add arrears columns

Joins `flat_arrears WHERE arrears_type = 'maintenance'` per flat and exposes:
- `arrears_maintenance` — sum of all maintenance arrears for the flat (0 if none)
- `total_outstanding` — `pending + arrears_maintenance`

View must be recreated with `security_invoker = true` (same as migration 021).

#### `v_corpus_tracker` — multi-plan support + plan_id disambiguation

Existing filter: `WHERE cp.status = 'active'` — already returns one row per flat per plan.

Transaction attribution rule (FILTER clause update):

```sql
WHERE t.corpus = 'YES' AND t.cr_dr = 'CR' AND t.row_type != 'VOIDED'
  AND (
    (t.plan_id = cp.id)
    OR (t.plan_id IS NULL
        AND t.fiscal_year BETWEEN cp.start_fiscal_year AND cp.end_fiscal_year)
  )
```

If two active plans share an overlapping FY range and a transaction has `plan_id = NULL`, it is counted toward all matching plans. The admin tagging UI must warn and prompt for `plan_id` in this scenario to prevent double-counting.

View must be recreated with `security_invoker = true`.

### A4. Workflows

#### FY rollover — Settings page

1. Admin clicks "Advance to FY 2026-27" in Settings.
2. System queries `v_dues_tracker` and displays a preview: flat code + pending amount for every flat with `pending > 0`.
3. Admin confirms.
4. Inside a single DB transaction:
   - `INSERT INTO flat_arrears` for each flat with `pending > 0` (arrears_type='maintenance', source_label='FY 2025-26', amount=pending). Uses `ON CONFLICT DO NOTHING` (idempotent).
   - `UPDATE app_settings SET value = '2026' WHERE key = 'dues_start_fiscal_year'`.
5. React Query cache is invalidated for dues tracker and settings.

Application code must skip flats with `pending = 0` before inserting (the `CHECK (amount > 0)` constraint would throw on zero-amount rows).

#### Corpus plan closure — Corpus page

1. Admin clicks "Mark as Completed" on an active plan.
2. System shows a confirmation modal: lists flats with `balance > 0` (from `v_corpus_tracker` for that plan).
3. On confirm, inside a single DB transaction:
   - `INSERT INTO flat_arrears` for each flat with `balance > 0` (arrears_type='corpus', source_label=plan name). Uses `ON CONFLICT DO NOTHING`.
   - `UPDATE corpus_plans SET status = 'completed'`.
4. Cache invalidated for corpus tracker.

#### Clearing corpus arrears

When a flat later pays their outstanding corpus debt, admin:
1. Imports/tags the bank transaction as corpus with the appropriate plan.
2. Manually edits or deletes the `flat_arrears` row via a simple edit form in the admin view.

No automatic clearing mechanism — this fits the non-accountant committee workflow.

#### Manual arrears entry (legacy / Excel data)

Admin can add, edit, or delete `flat_arrears` rows per flat directly from the dues or flat detail page. Used to enter pre-FY25-26 debt from the Excel spreadsheet.

### A5. Admin UI changes

**Dues tracker page:**
- New "Arrears" column showing `arrears_maintenance` per flat.
- New "Total outstanding" column.
- "Add arrears" button per flat row — opens a small form (source_label, amount, notes).
- "Edit / Delete" action per existing arrears row.

**Settings page — new "Fiscal Year" section:**
- Shows current `dues_start_fiscal_year`.
- "Advance to FY [next year]" button → triggers workflow above.
- Disabled if all flats are fully paid (no pending > 0).

**Corpus page — plan closure:**
- "Mark as Completed" button on active plans.
- Confirmation modal shows flats with outstanding balance before committing.

**Transaction tagging UI:**
- When `corpus = YES` is selected and more than one active corpus plan exists, a plan selector appears.
- Warning shown if a corpus CR falls in an overlapping FY range and no plan is selected.

### A6. Owner portal UI changes

**Maintenance dues card:**
- If `arrears_maintenance > 0`: shows an "Arrears from [source_label]" line with amount in red below the current FY section.
- Total outstanding shown at the bottom.

**Corpus section:**
- Renders one card per row returned by `v_corpus_tracker` (array, not single).
- If `flat_arrears` has corpus rows: renders an additional "Previous corpus — [source_label]" card showing amount owed with a note to contact admin.

---

## Feature B — My Flat Page + Flat Assignment for All Users

### B1. Schema

No new tables. `profiles.flat_id` already exists (migration 015).

### B2. RoleContext — expose `hasFlatAssigned`

`RoleContext` extended to include `flatId: string | null`. Loaded alongside the role fetch. Components use `flatId` to conditionally render "My Flat" nav item and to pass the flat filter to portal queries.

### B3. New route: `/my-flat`

- Renders a shared `FlatPortalView` component (extracted from `OwnerPortalPage`).
- Accessible to any authenticated user whose `profiles.flat_id` is non-null.
- Blocked for users with no flat assigned (redirect to `/dashboard`).

`OwnerPortalPage` (owner role `/dashboard`) is refactored to use the same `FlatPortalView` component.

### B4. Query changes in FlatPortalView

All queries filter explicitly by `flat_id` / `flat_code` from the user's profile — not relying on RLS alone (required for admin/committee/auditor who see all flats by role):

```typescript
// flats
supabase.from('flats').select('...').eq('id', flatId).single()

// v_dues_tracker
supabase.from('v_dues_tracker').select('*').eq('flat_code', flatCode).maybeSingle()

// v_corpus_tracker
supabase.from('v_corpus_tracker').select('*').eq('flat_code', flatCode)

// transactions
supabase.from('transactions').select('...').eq('flat_code', flatCode)
```

### B5. Navigation (Layout.tsx)

- Regular (non-owner) `NAV` gains a conditional "My Flat" entry pointing to `/my-flat`, visible only when `flatId` is non-null.
- Icon: `Home` (same as owner nav).
- `OWNER_BLOCKED` list unchanged — owners are not redirected away from `/my-flat`.

### B6. Flat assignment UI — Users management page

In Settings → Users:
- Each user row shows their currently assigned flat (or "—" if none).
- "Assign flat" button opens a dialog with a searchable flat selector (dropdown of all flat codes + blocks).
- On save: `UPDATE profiles SET flat_id = $selected WHERE id = $userId`.
- On clear: sets `flat_id = NULL`.
- Admin only.

### B7. Profile page

Remove `enabled: isOwner` guard from the `owner-flat` query — any user with a flat assigned sees the read-only "My flat" field.

---

## Migration plan

| Migration | Content |
|-----------|---------|
| 022 | Create `flat_arrears` table + RLS + index |
| 023 | Add `plan_id` to `transactions` |
| 024 | Rewrite `v_dues_tracker` with arrears columns + security_invoker |
| 025 | Rewrite `v_corpus_tracker` with plan_id attribution + security_invoker |

Feature B requires no migrations (profiles.flat_id already exists).

---

## Out of scope

- Importing arrears from Excel (admin enters manually from spreadsheet as reference)
- Automatic corpus arrears clearing (admin marks cleared manually)
- Utility arrears (separate gap analysis planned)
