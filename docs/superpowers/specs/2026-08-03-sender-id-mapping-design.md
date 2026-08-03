# Sender ID → Flat Mapping Review

**Status:** Draft 2026-08-03
**Author:** Senthil + Claude
**Migration:** none — reuses existing `residents.upi_ids` (text[]), `flats`, `transactions`

## Problem

`src/lib/tagger.ts` auto-tags bank transactions to flats using two hardcoded lookup tables,
`UPI_SENDER_MAP` and `NEFT_SENDER_MAP` (~50 entries total), each mapping a real UPI handle,
phone number, or bank sender name directly to a flat code. These are committed to source and
live on the public GitHub repo. A newer, better mechanism already exists alongside them —
`tagTransaction`'s `dynamicUpiMap` parameter, built at runtime from `residents.upi_ids` — but
nothing has ever migrated the hardcoded entries into it, and there's no UI to review or extend
it, so the hardcoded maps are still load-bearing.

This also came up because the current model implicitly assumes "one sender token → one flat,
forever," which doesn't hold when a resident occasionally pays on behalf of another flat.

## Scope

- **In scope:**
  - A new admin-only "Sender Mappings" page (linked from the Flats page, not a top-level nav
    item) that surfaces the legacy hardcoded entries for one-time review/confirmation into
    `residents.upi_ids`, plus a read view of all current flat ↔ sender-ID mappings.
  - A drill-down view (per sender ID) showing every transaction whose description matched that
    token, so a mapping can be sanity-checked against real history before confirming.
  - An opt-in "also save this sender ID" control added to the existing Review-tab flow
    (`ReviewItem` in `src/pages/TransactionsPage.tsx`), for capturing new mappings going
    forward as unknown transactions get manually resolved.
  - Removing `UPI_SENDER_MAP`/`NEFT_SENDER_MAP` from `tagger.ts` once the legacy backlog is
    fully confirmed, and a follow-up `git filter-repo` history scrub of that file (same
    procedure used earlier for the two PII-bearing reconciliation scripts), since those maps
    contain real resident names/UPI handles/phone numbers and have been in the repo since near
    the start of its history.
- **Out of scope:**
  - Inline edit/remove of a resident's sender IDs on the new page — corrections go through the
    existing Flat/Resident edit dialog on the Flats page, which already supports free editing
    of the comma-separated `upi_ids` field. Avoids a second, duplicate edit path.
  - Supporting one sender genuinely and regularly belonging to two different flats (e.g. a
    co-owner of two units). The data model stays one-token-can-resolve-to-one-flat, same as
    today. A wrong auto-tag from this stays a normal manual correction via the existing
    Edit-transaction dialog in All Transactions — not solved structurally here.
  - Any new database table or column. Everything rides on `residents.upi_ids`,
    `residents.is_active`, `flats`, and `transactions.description`.
  - Automated detection/scanning outside the Review-tab moment — no background job, no
    periodic batch scan for new candidates beyond what a human resolves by hand in Review.

## Design

### 1. Legacy backlog

`UPI_SENDER_MAP` and `NEFT_SENDER_MAP` are already shipped in the client bundle (they're plain
exported constants), so the new page imports them directly — no new exposure from doing so.
Pending entries are computed client-side as a set difference: every `(token, flatCode)` pair
whose `token` (case-insensitive) doesn't already appear in any resident's `upi_ids`.

Each pending row shows: sender token, inferred type badge (`UPI` if from `UPI_SENDER_MAP`,
`NEFT` if from `NEFT_SENDER_MAP`), the flat code from the map, and a resident picker scoped to
that flat's residents (active + inactive), labeled with how many IDs they already have (e.g.
"Ravi Kumar (Owner) — already has 1 ID"). **The picker defaults to unselected** — no
best-guess auto-selection — so a low-confidence match (e.g. `'chinnarasachin'` vs a dissimilar
resident name) never gets silently assigned to the wrong person. Confirm is disabled until a
resident is chosen; on confirm, the token is appended to that resident's `upi_ids` (same
lowercase-and-dedupe normalization `FlatsPage.tsx`'s resident dialog already applies at line
~669).

If the token also appears (via the same substring match `tagTransaction` uses) on transactions
currently tagged to a **different** flat than the map claims, the row shows an inline warning
with the conflicting flat code and count, e.g. "also appears on 3 past transactions for flat
CG1 — double-check before confirming." This is informational only; it doesn't block
confirmation, since a conflict can legitimately be an occasional help-a-neighbor payment rather
than a wrong mapping (see Out of scope).

Once this list reaches zero, `tagger.ts` loses both hardcoded maps (step 3 becomes just the
dynamic map lookup), and that's the trigger for the deferred git-history scrub.

### 2. All-flats table + drill-down

Below the backlog, a flat-by-flat table: one row per resident, their sender IDs rendered as
chips (mixing UPI/NEFT freely — a resident can have several, since `upi_ids` is already an
array), and an Active/Archived status derived from `residents.is_active`. Archived is cosmetic
here — `TransactionsPage.tsx`'s `dynamicUpiMap` query already filters `is_active = true` when
building the tagging map (line ~128), so archived IDs are already excluded from auto-tagging
today; this table just makes that visible instead of silent. Each resident row includes a
"Manage on Flats page →" link as the edit/remove escape hatch.

Clicking any sender ID (legacy row or table chip) opens a drill-down panel: every transaction
whose `description` contains that token (same case-insensitive substring match as
`tagTransaction`), showing date, amount, CR/DR, and the flat it's currently tagged to — with
rows tagged to a flat other than the one being reviewed visually flagged. Read-only; the only
action is closing it. Query: `transactions.select(...).ilike('description', '%' + token + '%').order('value_date', { ascending: false })`.

### 3. Review-tab capture (ongoing)

In `ReviewItem`, alongside the existing flat/category controls, an **unchecked-by-default**
checkbox: "Also save this sender ID for [resident]." Checking it reveals:
- An editable text input prefilled with a heuristic guess — a new `guessSenderToken(description:
  string): string` helper (in `tagger.ts`, alongside the existing patterns) strips known
  prefixes (`UPI/`, `NEFT/`, `IMPS/`, `RTGS/`) and trailing reference numbers/bank codes,
  falling back to the trimmed raw description if nothing matches. It's a starting point, not a
  save — the human always reviews/edits it before confirming.
- A resident dropdown scoped to the **active** residents of the flat just selected in the
  existing flat picker (unlike the legacy backlog picker, which intentionally includes
  inactive residents since older entries may belong to someone who's since moved out — a *new*
  mapping going forward should only ever attach to someone currently living there).

Defaulting to unchecked is deliberate: assigning a flat to *this* transaction and declaring
"this sender always pays for this flat" are different decisions, and the second one needs an
explicit opt-in each time so an occasional help-a-neighbor payment doesn't silently become a
permanent rule.

On save, if the checkbox is checked and a resident is selected: the existing transaction
update happens as today, plus (a) the token is appended to that resident's `upi_ids`, and (b)
**bulk-apply** — every other transaction still sitting in the review queue whose description
also matches the same resolved token gets the same `flat_code`/`flat_id`/`category`/`corpus`
applied in the same action, mirroring the batch-update pattern `BulkRecordDialog` already uses
(`Promise.all` of per-row updates). Only rows still unresolved (in the review queue) are
touched — never a transaction some other manual review has already resolved differently. A
toast reports how many rows were affected, e.g. "Tagged as CS2 · Maintenance — also applied to
2 other matching transactions."

### RBAC

Both the new page and the Review-tab controls are gated on `isAdmin` (not just `canWrite`),
matching the existing precedent that UPI/sender-identity data is admin-only
(`FlatsPage.tsx`'s `upi_ids` column is already admin-gated).

### Error handling

- **Duplicate token across two residents**: if a token being saved already exists on a
  *different* resident, block the write and show an inline error naming the conflicting
  resident/flat — this is a data-quality signal (or a genuine two-flat-sender case, see
  Out of scope) that needs a human decision, not a silent overwrite.
- **Bulk-apply scope**: limited to rows currently in the review queue at the moment of save; a
  row that gets imported later with the same sender resolves via the now-updated
  `dynamicUpiMap` on its own, not via this bulk-apply path.

## Testing

No new Playwright coverage planned — this is a low-frequency admin tool, consistent with how
other one-off admin flows in this app are handled. `npx tsc --noEmit` must pass. Manual
verification:

- Confirming a legacy entry adds it to the chosen resident's `upi_ids` (visible in the Flats
  resident dialog) and removes it from the pending list.
- A token flagged with a flat-conflict warning shows the correct conflicting flat/count, and
  the drill-down for it lists the actual mismatched transactions.
- Archived (moved-out) residents' chips show as Archived, and importing a statement with their
  old sender ID does **not** auto-tag (confirms the existing `is_active` filter still holds).
- In the Review tab, checking "also save this sender ID," editing the prefilled guess, and
  saving: (a) resolves the current transaction as today, (b) appends the token to the selected
  resident, (c) applies the same tag to any other still-unresolved review-queue rows sharing
  that token, and (d) leaves already-resolved transactions untouched.
- Leaving the checkbox unchecked (the default) behaves exactly as today — no mapping saved.

## Acceptance

- `/flats` has a link to the new Sender Mappings page; only visible/reachable for admins.
- Legacy backlog count starts at ~50 and only decreases as entries are confirmed; confirmed
  entries don't reappear.
- All-flats table correctly shows multiple chips per resident where applicable, and reflects
  Active/Archived accurately.
- Drill-down opens for any sender ID and shows real matching transaction history.
- Review-tab nudge defaults unchecked; when used, bulk-applies only to still-unresolved rows.
- Once the legacy backlog is empty, a follow-up change removes `UPI_SENDER_MAP`/
  `NEFT_SENDER_MAP` from `tagger.ts` and the deferred history scrub is performed.
- `npx tsc --noEmit` passes.
