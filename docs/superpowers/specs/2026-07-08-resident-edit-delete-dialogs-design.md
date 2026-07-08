# Resident Edit/Delete + Flats Dialog Adoption — Design

Date: 2026-07-08
Status: Approved (user, this date)
Follow-up to: `2026-07-07-residents-relationships-design.md`

## Problem

1. Residents can be added, moved out, and reactivated — but an existing resident's
   details (name, phone, UPI, relation, type, flat, moved-in date) cannot be edited,
   and an erroneous entry cannot be removed. Fixing a typo currently requires direct
   DB access.
2. The Flats & residents page still presents flat detail in a 288px inline sidebar
   and uses hand-rolled `fixed inset-0` overlays for its modals, while Dues and
   Corpus present flat detail in a Shadcn `Dialog`. The user wants the same dialog
   pattern adopted across the Flats & residents page.

## Decisions (user-approved)

- **Delete = hard delete for mistakes.** Real departures keep using Move out so
  occupancy history is preserved. Delete is framed as fixing data-entry errors.
  The confirm dialog warns: *"This permanently removes the record. If this person
  actually lived here and left, use Move out instead so history is kept."*
  The existing Postgres audit trigger (migration 012, `trg_audit_residents`,
  AFTER INSERT OR UPDATE OR DELETE) records who deleted what. RLS already permits
  it: `residents_admin_write` is `FOR ALL` gated on `get_my_role() = 'admin'`.
  **No migration needed.**
- **Edit/delete available in both places:** the Residents-tab grid Actions column
  AND the People card rows inside the flat detail (per user: "even for flat panel
  should show in dialog").
- **Adopt the Dues/Corpus dialog pattern** for the whole Flats & residents page
  (per user request).

## Scope

### 1. ResidentModal (add + edit)

Generalize the existing `AddResidentModal` into one `ResidentModal` with an
optional `resident` prop:

- **Add mode** (no prop): current behavior, insert.
- **Edit mode**: pre-filled with all fields — flat, name, type, relation, phone,
  UPI IDs, moved-in date — and saves via `update(...).eq('id', resident.id)`.
- Flat stays editable in edit mode ("entered under the wrong flat" is exactly the
  mistake edit exists to fix).
- Same relation rules as add: Co-owner option hidden when type = Tenant; stale
  Co-owner resets to Self on type switch.
- `is_active` / `moved_out` are NOT editable here — the move-out flow owns those.

### 2. Delete confirm dialog

- Shows person's name and flat code + the warning above.
- Confirm performs hard `delete()`. Cancel is the default-focused action.
- Admin-only (same `isAdmin` gate as other resident mutations).

### 3. Entry points

- **Residents tab grid**: pencil (edit) + trash (delete) icons in the Actions
  column next to the existing Move out button. Admin-only.
- **People card** (flat detail): small pencil/trash icons on every person row —
  owners, tenants, and past residents. Admin-only.

### 4. Flat detail → Dialog (match Dues/Corpus)

- Clicking a flat row opens the detail in a Shadcn Dialog styled like DuesPage's
  flat-detail dialog: `max-w-[520px] lg:max-w-[900px] max-h-[85vh] rounded-2xl`,
  scrollable content.
- Contents unchanged: flat facts, Change maintenance rate, Area details, Rate
  history, People card. On `lg` the People card sits in a second column.
- The inline sidebar is removed.

### 5. Convert remaining FlatsPage overlays to Shadcn Dialog

`ResidentModal`, delete confirm, `MoveOutDialog`, `RateChangeModal`,
`AreaDetailsModal` all use `Dialog`/`DialogHeader`/`DialogTitle`/`DialogFooter`
instead of hand-rolled `fixed inset-0` divs. Every dialog gets a real
`DialogTitle` (Radix a11y requirement).

### 6. Drive-by a11y fix

DuesPage's flat-detail `DialogContent` (line ~371) lacks a `DialogTitle` and
logs a Radix error in the browser console (observed on prod). Add a
`DialogTitle` (visible header with the flat code). Check CorpusPage's flat
dialog for the same gap and fix if present. No other Dues/Corpus changes.

## Data flow / invalidations

After edit, delete, add, move-out, or reactivate: invalidate `['residents']`
AND `['flat-residents', flatId]` so both the grid and the People card refresh.
(This also closes the known Minor from the previous review where
`handleReactivate` missed `['flat-residents']`.)

## Testing (TDD, Playwright e2e — both projects)

New tests against synthetic `E2E `-prefixed fixtures (dev DB, seed script is
idempotent and recreates/repairs fixtures each run):

1. **Edit**: open Edit on an E2E fixture from the Residents grid, change relation
   + phone, save; assert new values in the grid AND in the flat's People card.
2. **Delete**: delete an E2E fixture via confirm dialog; assert it disappears
   from grid and People card. (Seed re-creates it next run.)
3. **Flat detail dialog**: clicking a flat opens `getByRole('dialog')` containing
   the flat code heading and the People card.

Updated tests: existing locators that target the sidebar/overlays by CSS
(`.w-72`, `.fixed.inset-0.z-50 input[type="date"]`, etc.) move to
`getByRole('dialog')`-scoped queries — including the People card tests, the
group move-out test, and the long-broken rate-history test (this conversion is
the best shot at fixing its flake; if it still fails for unrelated timing
reasons, document and leave it).

## Out of scope

- Archive/soft-delete flag (Move out already covers real lifecycle).
- Edit/delete for non-admin roles.
- Any Dues/Corpus refactor beyond the DialogTitle fix.
- The broader dead-locator e2e cleanup (separate follow-up).
- Database changes of any kind.

## Global constraints (binding, inherited)

- Repo is PUBLIC: no real resident data in committed code or fixtures — only
  synthetic `E2E `-prefixed fixtures.
- `npx tsc --noEmit` clean before every commit.
- IST-safe dates: never `toISOString().slice(0,10)`; use the existing
  `todayLocal()` helper.
- Shadcn/ui for all dialogs; Tailwind only; AG Grid for tables; `useRoleCtx()`
  for role checks.
- No DB changes this feature; if that changes, apply to BOTH Supabase projects
  (prod `aulttcsvxzcwyceezzpz`, dev `qcoezjcwrsqchulqgydm`).
