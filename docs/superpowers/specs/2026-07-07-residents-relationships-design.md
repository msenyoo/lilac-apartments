# Residents Relationships & Flat People View — Design

**Date:** 2026-07-07
**Status:** Approved by user (chat), pending implementation

## Problem

The `residents` table only allows `type = Owner | Tenant`, one implicit person per
flat. Real flats have co-owners, spouses, guardians, and tenants' family members.
Three pages (Dues, Corpus, Report) look up a reminder phone with `.maybeSingle()`
on active residents — a query that **errors as soon as a flat has two active
people**. There is also no per-flat view of who lives there now and who did before.

## Decisions (made with user)

1. **Data model:** keep `type = Owner | Tenant`, add a `relation` field
   (`Self | Co-owner | Spouse | Parent | Child | Guardian | Other`).
   `type` = which side of the tenancy; `relation` = the person's tie to it.
2. **Reminders go to multiple contacts:** payer side (tenant/guardian) plus owner
   as notification — a tappable list, not one auto-picked phone.
3. **Flat view lives in the existing Flats-tab side panel** as a new "People" card.
4. **Move-out is a guided dialog:** date picker + group checkbox to move a whole
   household out together.
5. Owner-portal login stays **one user per flat** (unchanged).

## 1. Schema — migration 039 (apply to BOTH prod and dev)

```sql
ALTER TABLE public.residents ADD COLUMN IF NOT EXISTS relation text NOT NULL DEFAULT 'Self'
  CHECK (relation IN ('Self','Co-owner','Spouse','Parent','Child','Guardian','Other'));
```

- Existing rows backfill to `Self` via the default — correct for current data.
- No DB constraint tying `relation` to `type`; the UI guides (e.g. Co-owner only
  offered for Owner side).
- Update the `Resident` interface in `src/lib/supabase.ts`.

## 2. People card (Flats tab side panel)

Rendered between the flat-info card and the area-details card when a flat is
selected:

- **OWNER** group: active `type='Owner'` residents — name, relation badge,
  phone as `tel:` link. Phone visible to admin + committee only (same rule as
  the Residents grid; auditors see names only).
- **TENANT** group: same for active `type='Tenant'`; group hidden when empty.
- **Past residents (N)** — collapsed by default; inactive residents with
  `moved_in → moved_out` period. This is the occupancy history.
- Read-only card; management stays in the Residents tab.

## 3. Residents tab

- Grid gains a **Relation** column (badge), after Type.
- **Add resident** modal gains a relation dropdown, default `Self`.
  When type=Tenant, hide `Co-owner` from the options.
- **Move out** changes from instant click to a dialog:
  - Move-out date picker, defaults to today, editable.
  - If the person's relation is `Self`: checkbox list of the flat's other active
    same-`type` members ("also move out …"), pre-ticked.
  - Save marks all selected inactive with the chosen `moved_out` date.
  - **Reactivate** stays one click (clears `moved_out`, sets active).

## 4. Reminder contacts (bug fix + multi-contact)

New helper `src/lib/contacts.ts`:

```ts
fetchFlatContacts(flatId): Promise<FlatContact[]>
// active residents with non-empty phone, ordered:
// Tenant/Self → Guardian → other tenant-side → Owner/Self → Co-owner → other owner-side
// phone normalized to wa.me format (10-digit → prefix 91)
```

- DuesPage, CorpusPage, ReportPage: replace the `.maybeSingle()` single-phone
  lookup with `fetchFlatContacts`; the reminder UI lists each contact as
  "Name (Type) ☎" WhatsApp button — payer first, owner below as notification.
- OwnerPortalPage statement name: prefer `relation='Self'` when picking the
  active Owner (order by relation, keep `limit(1)`).

## 5. Unchanged / out of scope

- UPI auto-matcher (TransactionsPage) already reads all active residents — no change.
- Owner portal RLS/login model — no change.
- Inline editing of an existing resident's phone/UPI — deferred (workaround:
  move out + re-add).
- `flats.owner` denormalized text (if present anywhere) is not touched.

## Testing (TDD)

- Playwright e2e (dev DB, seeded fixtures):
  1. People card: flat with owner + spouse + tenant shows both groups and
     relation badges; past resident appears under "Past residents".
  2. Group move-out: dialog shows household checkbox, saving marks both
     inactive with the picked date.
  3. Reminder popover on Dues lists ≥2 contacts for a flat with tenant + owner.
- Extend `scripts/seed-e2e-advance-payer.js` (or a sibling seed script) with a
  fixture flat that has owner + spouse + tenant + one moved-out resident.
- `npx tsc --noEmit` clean before every commit.

## Rollout

1. Migration 039 on dev + prod (Management API).
2. Code (RED → GREEN per test above), commit, push → Vercel auto-deploy.
3. No data backfill needed beyond the column default.
