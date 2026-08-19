# Voluntary Contribution Drives

**Status:** Draft 2026-08-19
**Author:** Senthil + Claude
**Migration:** 045 (new)
**Trigger:** Kannan Security (society's gate security guard) passed away 2026-08-19; residents are
contributing money on the spot for his family. The app currently has no way to record this kind of
one-off voluntary collection without it clubbing with Maintenance or Corpus.

## Problem

`transactions.category` today only means something to the rest of the app when it's `'Maintenance'`
(counted by `v_dues_tracker`) or `corpus = 'YES'` (counted by `v_corpus_tracker`). There is no
concept of a voluntary, non-obligatory collection — money residents give by choice, for a specific
cause, that is not a flat's maintenance/corpus obligation and must never be counted as either. This
need recurs: Diwali collections, New Year, a local temple festival, and (as today) support for a
staff member's family are all the same shape of problem — an ad hoc pool of money collected from
willing residents, tracked to a balance, and eventually paid out or handed over in full.

## Scope

- **In scope:**
  - A new `contribution_drives` table — each cause (e.g. "Kannan Security — Family Support",
    "Diwali 2026") is its own record with a running balance.
  - Tagging bank transactions (CR = contribution in, DR = cash withdrawal / handover out) to a
    drive, via the existing Transactions review UI.
  - Attributing a contribution to the specific resident who gave it (owner or tenant — a flat can
    have both contributing separately), not just the flat.
  - A new `/contributions` page: list drives, create/close a drive (admin), view a drive's
    transaction history and balance.
  - RLS + audit logging consistent with every other table in the schema.
- **Out of scope (explicitly deferred, do not build):**
  - Recording cash-in-hand before it's deposited to the bank. Per-user decision: cash contributions
    get deposited as a single lump sum, which then shows up as one ordinary bank CR row to tag —
    same as any other transaction. No "manual cash intake, no bank row" feature.
  - Per-flat or per-resident targets, budgets, or reminders — contributions are voluntary with no
    fixed amount expected of anyone.
  - PDF receipts or reports for contribution drives (Reports page integration). Can be a later,
    separate spec once the base tracking exists.
  - A dedicated `contribution_payments` table analogous to `corpus_payments` — not needed, since
    there's no per-flat target to reconcile against. `transactions` rows tagged with `drive_id` are
    the full record.
  - Hard-blocking closing a drive at nonzero balance (see Design → Closing a drive).

## Design

### Data model

```sql
-- 045_contribution_drives.sql

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
```

- `category = 'Contribution'` is used for every transaction tagged to a drive — plain text, no new
  CHECK constraint needed (the column has none today). This is what keeps these rows out of
  `v_dues_tracker` (`category = 'Maintenance'` only) and `v_corpus_tracker` (`corpus = 'YES'` only)
  automatically, with zero changes to either view.
- `drive_id` is required whenever `category = 'Contribution'` — enforced in the app layer (the UI
  never lets you pick "Contribution" without also picking a drive), not a DB constraint, matching
  how `corpus_plan_id`/`corpus = 'YES'` pairing is enforced today.
- `resident_id` is a general nullable column on `transactions` (harmless for existing rows) but the
  UI only ever sets it from the new Contribution tagging flow — Maintenance/Corpus tagging is
  unchanged. It's nullable because the contributor isn't always known (e.g. an unmatched sender, or
  the lump-sum cash deposit covering several people's cash gifts at once).
- No new payments table. A drive's full history — money in (CR) and money out (DR, the eventual
  cash withdrawal handed to the family) — is just `transactions` rows filtered by `drive_id`.

### View: `v_contribution_tracker`

One row per drive:

```sql
create or replace view public.v_contribution_tracker
with (security_invoker = true) as
select
  cd.id                                                                     as drive_id,
  cd.name,
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
group by cd.id, cd.name, cd.status, cd.created_at, cd.closed_at;
```

Matches the `security_invoker = true` convention already used for every view since migration 021.

### RLS + audit

Mirrors `corpus_plans` exactly (migrations 013 + 020):

```sql
alter table public.contribution_drives enable row level security;

create policy "contribution_drives_read" on public.contribution_drives
  for select to authenticated using (true);

create policy "contribution_drives_admin_write" on public.contribution_drives
  for all to authenticated
  using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');

create trigger trg_audit_contribution_drives
  after insert or update or delete on public.contribution_drives
  for each row execute function public.fn_audit_trigger();
```

No RLS change needed on `transactions` — the existing `transactions_read`/write policies already
cover the new `drive_id`/`resident_id` columns.

### Tagging UX (`src/pages/TransactionsPage.tsx`)

Two existing dropdown patterns get one new option each, reusing the exact mechanics already built
for `corpusCats`/`planId`:

1. **Top-level "Flat / Category" dropdown** (both the AG Grid inline editor's `categoryOptions` and
   the review-card `<select>`): a new DB-driven optgroup **"Contributions"**, populated from
   `contribution_drives where status = 'open'` (same shape as today's "Corpus works" optgroup
   sourced from `expense_categories`). Picking a drive name directly sets `category='Contribution'`,
   `drive_id=<that drive>`, no flat — for contributions not tied to a specific flat (e.g. the
   lump-sum cash deposit, or an unmatched sender who isn't a resident).
2. **Secondary "Category" dropdown** (shown once a real flat is selected, currently
   Maintenance/Corpus only): gains a third option **"Contribution"**. Picking it reveals:
   - A drive picker, auto-selected if exactly one drive is open (mirrors the existing
     `activePlans.length === 1` auto-select for corpus plans), otherwise a required select.
   - A resident picker scoped to `residents where flat_id = <selected flat>` (owner, tenant, whoever
     is on record) — optional, left blank if the specific contributor isn't known.
3. Same additions apply in both places `flatCode`/`category` state is edited: the AG Grid cell
   editor (`categoryOptions` at line ~331) and `ReviewItem`'s inline dialog (~line 1099), since both
   already duplicate this pattern for Maintenance/Corpus today.

No changes to `src/lib/tagger.ts` (auto-tagging) — new contributions always start as `REVIEW`
confidence and get manually assigned to a drive, same as any transaction the auto-tagger can't
place today. Auto-tagging a bank credit straight to a specific drive isn't safe (the tagger has no
way to know "today's contributions are for the Kannan fund" vs. next month's Diwali fund).

### `/contributions` page (new)

- Route: `App.tsx` gets `<Route path="contributions" element={<ContributionsPage />} />`.
- Sidebar nav (`Layout.tsx` `NAV_ITEMS`): new entry, e.g. `{ to: '/contributions', icon: HandHeart,
  label: 'Contributions' }`, placed near Corpus Fund. Added to `OWNER_BLOCKED` alongside
  `/dues`/`/corpus`/etc. — owners keep their existing restricted self-service view; this is a
  committee-facing page like the others it sits next to, even though `contribution_drives` itself
  has no owner-specific RLS restriction.
- List view: drives from `v_contribution_tracker`, open ones first, showing name, collected,
  disbursed, balance, status, last activity.
- "New drive" (admin, gated by `canWrite` from `useRoleCtx()`): name + optional description, inserts
  `status='open'`.
- Drive detail (click a row): transaction list — date, flat code + resident name (when known),
  CR/DR, amount, notes — pulled from `transactions where drive_id = ...`, newest first. Same shape
  as Corpus's per-plan payment list, minus the per-flat target columns that don't apply here.
- "Close drive" (admin): sets `status='closed'`, `closed_at=now()`, optional `close_notes`. **Does
  not block on nonzero balance** — real drives can close with a small carry-forward (rounding, or a
  late contribution the committee decides to fold into the next cause) and the committee should be
  able to record that deliberately via `close_notes` rather than being forced to zero it out
  artificially. The UI shows a warning (not a hard stop) if balance ≠ 0 at close time.
- `HelpButton.tsx` gets a new context entry for `/contributions`, following the same pattern as the
  other pages' help content.

### TypeScript types (`src/lib/supabase.ts`)

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

export interface ContributionTracker {
  drive_id: string
  name: string
  status: 'open' | 'closed'
  created_at: string
  closed_at: string | null
  collected: number
  disbursed: number
  balance: number
  last_activity: string | null
}
```

`Transaction` gains `drive_id: string | null` and `resident_id: string | null`.

## Testing

- `npx tsc --noEmit` must pass.
- Manual verification against the dev DB (per project convention — no destructive testing against
  prod): create a drive, tag a synthetic CR transaction to it both via the flat-linked path (with a
  resident picked) and the non-flat "Contributions" optgroup path, confirm `v_contribution_tracker`
  reflects the right collected/balance, confirm the row does **not** appear in `v_dues_tracker` or
  `v_corpus_tracker`, tag a DR row as a disbursement, confirm balance drops, close the drive, revert
  test data.
- No Playwright coverage required by this spec (existing e2e suite has known-broken pre-existing
  failures per `project_e2e_suite_state` — a full new-page e2e spec is a reasonable follow-up but not
  a blocker for this feature).

## Acceptance

- A CR transaction tagged to an open drive shows up in that drive's balance and never in
  `v_dues_tracker` or `v_corpus_tracker`.
- A flat-linked contribution can optionally record which resident (owner or tenant) gave it.
- A DR transaction tagged to a drive (the cash withdrawal handed to the family) reduces that drive's
  balance and is visible in its transaction history.
- Only admins can create or close drives; all roles can read `/contributions` except `owner`
  (blocked from the nav/route like the other committee-facing pages).
- Closing a drive with a nonzero balance shows a warning but is not blocked.
- `npx tsc --noEmit` passes; migration 045 applies cleanly to both dev and prod per the project's
  Management-API apply process (`db push` is unreliable per `CLAUDE.md`).
