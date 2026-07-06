# Auditor Review — Lilac Apartments — 2026-07-06

Scope: production database (Supabase) via `scripts/audit-review.js` + targeted drilldowns, and
end-to-end UI flow walk on https://lilac-apartments.vercel.app (Treasurer login) covering
Dashboard, Dues, Corpus, Expenses, Reports (dues aging), Transactions.

## Headline

**Production data is sound.** Every ledger identity checks out: net available cash on the
Dashboard (₹3,93,094) equals the sum recomputed from raw transactions to the rupee; the fund
split (Maintenance ₹57,095 + Corpus ₹3,35,999) sums exactly to net cash; corpus plan figures
reconcile including pre-payments; expense ledger total on the Expenses page (₹21,96,138)
matches the DB. Both HIGH findings raised by the automated sweep were verified and are
**false positives**. Two genuine but low-severity issues found: a Dashboard KPI inconsistency
(UI bug, not data) and two untagged corpus `plan_id`s.

> **Resolution (same day):** Finding 1 fixed — Dashboard now sums clamped `total_outstanding`
> (relabelled "Outstanding dues"), verified showing ₹96,500 (32 flats) against prod data.
> Finding 2 fixed — both rows backfilled to Corpus 2025 via `audit-apply-fixes.js`; 0 NULL
> `plan_id` corpus rows remain. Findings 3–4 remain open.

## Findings

### 1. [MEDIUM · UI bug] Dashboard "Pending dues" disagrees with Dues page and dues aging report
- Dashboard shows **₹1,01,150** (33 flats); Dues page KPI and Reports → Dues aging both show **₹96,500**.
- Cause: `DashboardPage.tsx:188` sums `Math.max(0, pending)` from `v_dues_tracker`, ignoring
  `advance_credits`. Commit `2252304` fixed exactly this on DuesPage (sums clamped
  `total_outstanding`) but the Dashboard was not updated.
- Effect: overstates dues by ₹4,650 — BF2 (credit ₹1,400), CP1 (₹1,600), and one flat fully
  covered by credit (₹1,650) still appear as owing. The Aging Receivables card has the same
  issue (shows BF2 at ₹2,800 vs ₹1,400 actually outstanding).
- Fix: sum `Math.max(0, total_outstanding)` and rank the aging list by it.

### 2. [LOW · data hygiene] 2 corpus credits missing `plan_id`
- 2026-06-27 EG1 ₹11,500 and 2026-06-29 EP1 ₹15,000 (`corpus='YES'`, `plan_id` NULL).
- Created **after** the 2026-06-25 backfill → the transaction-tagging flow still allows
  corpus CRs without a plan. Counted correctly today via the FY fallback (only one active
  plan), but will double-count if a second plan with an overlapping FY range is activated.
- Fix: backfill these two (`audit-apply-fixes.js` supports this) and make plan selection
  mandatory when tagging `corpus='YES'`.

### 3. [OPEN ITEM · awaiting bank statement] EXP-2026-0027 unreconciled
- ₹12,558, 2026-06-30, Online, "Bundled — 3 items", approval Pending.
- No matching bank DR exists in the ledger (last imported statement row: 2026-07-02).
  Expected to clear on the next statement import; chase if it doesn't appear.
- UI surfaces it correctly (Expenses page badge + Dashboard "1 unreconciled").

### 4. [COSMETIC] Minor items
- 2 line items still attached to voided expense EXP-2026-0018 (₹1,073) — harmless orphans.
- PWA manifest icon `pwa-192x192.png` fails to load (console warning on every page) and
  `apple-mobile-web-app-capable` meta is deprecated.
- `audit-review.js` prints "from FY undefined opening" in the cumulative-balance line.

## False positives from the automated sweep (verified, no action)

- **"2 duplicate transactions, ₹3,100"** — the two KARTHICKGUNA88 pairs (2025-05-07,
  2025-06-05; ₹1,550 ×2, same UPI ref, flats CS2/DF2) are pre-migration ETL splits of one
  credit paying two flats. The cumulative balance including these rows was verified against
  the live bank statement on 2026-06-25 (₹8,78,594 vs ₹8,78,593.69). Do not void.
- **"15 flats where dues view disagrees with recomputed"** — the script predates migration
  037 (arrears settle oldest-first). For all 15 flats, (raw collected − view `collected_fy`)
  exactly equals the settled arrears, and total-outstanding drift is ₹0. The script should
  compare `collected_fy + arrears_paid` instead.

## Numeric summary (verified prod ↔ UI)

| Figure | DB (recomputed) | UI | Match |
|---|---:|---:|---|
| Net available cash | ₹3,93,094 | Dashboard ₹3,93,094 | ✓ |
| Maintenance available | ₹57,095 | Dashboard ₹57,095 | ✓ |
| Corpus in hand | ₹3,35,999 | Dashboard + Corpus page ₹3,35,999 | ✓ |
| Corpus collected (incl. ₹2,85,000 pre-payments) | ₹15,68,000 | Corpus page ₹15,68,000 (65%) | ✓ |
| Corpus target / to collect | ₹24,30,000 / ₹8,62,000 | Corpus page same | ✓ |
| Dues outstanding (clamped per flat) | ₹96,500 | Dues page + aging report ₹96,500 | ✓ |
| Dues outstanding — Dashboard | ₹96,500 expected | **₹1,01,150** | ✗ (Finding 1) |
| Expense ledger total | ₹21,96,138 | Expenses page ₹21,96,138 | ✓ |
| Unreconciled expenses | 1 (₹12,558) | Dashboard "1 unreconciled" + badge | ✓ |

Flow checks: login (mobile + password), sidebar/role gating (Treasurer), Dashboard KPIs and
charts, Dues grid + per-flat popover data, Corpus by-flat grid, Expenses day book, Reports
tab switching + dues aging table, Transactions grid with July imports. No console errors on
any page (only the 2 PWA warnings above).
