# Corpus Flow Validation — Production — 2026-07-07

Post-deploy audit of the corpus module after commit `c86051a` (carry-forward lifecycle,
mandatory plan tags, budget vs actual, fund filter, spent-scope fix). Read-only against
the production database and https://lilac-apartments.vercel.app; no prod mutations.
The mutating path (close plan → wizard carry-forward → arrears consumed) was exercised
end-to-end on the dev database on 2026-07-06 and the dev state restored.

## Verdict: PASS — all ledger identities hold and all new surfaces render correct figures.

## Data layer (prod DB)

| Check | Result |
|---|---|
| Corpus CRs: 67 rows, ₹12,83,000; `plan_id` NULL count | **0** ✓ (latest: 2026-06-29 EP1 ₹15,000) |
| Tracker: Σ effective_target / collected / balance | ₹24,30,000 / ₹15,68,000 / ₹8,62,000 ✓ |
| collected − pre-payments (₹2,85,000) == Σ bank CRs | ✓ |
| target − collected == balance | ✓ |
| Corpus expenses ₹12,32,001 == bank DRs ₹9,47,001 + cash ₹2,85,000 | ✓ |
| Corpus fund bank balance == Σ CRs − Σ DRs == collected − spent | ₹3,35,999 ✓ (three-way) |
| Corpus arrears rows | 0 (expected — no plan closed on prod) |

## UI layer (production site, Treasurer login)

- **Corpus page KPIs**: Target ₹24,30,000 · Collected ₹15,68,000 (65%) · Spent ₹12,32,001 ·
  Allowed ₹11,97,999 (₹3,35,999 in hand + ₹8,62,000 to collect) — all match DB. Carry-over
  banner correctly absent (no closed plans).
- **Budget vs actual** (Expenditure tab): Painting ₹5,00,000 of ₹17,00,000 (₹12,00,000 left);
  **Civil Work (Civil) ₹1,97,001 over** its ₹2,50,000 budget; Waterproofing ₹2,85,000 flagged
  *unbudgeted*; Buffer ₹50,000 untouched; totals ₹20,00,000 / ₹12,32,001 / ₹7,67,999.
  Fuzzy budget-name matching ("Civil" ↔ "Civil Work") works; single-active-plan budget now
  shows in the all-plans view.
- **Close plan** (plan-scoped view, admin): preview dialog lists 31 flats with balances and
  the new carry-forward hint; Cancel exits with no mutation. Not confirmed on prod by design.
- **Reports → Expenditure fund filter**: Corpus = Painting ₹5,00,000 + Civil Work ₹4,47,001
  = ₹9,47,001 (FY 2026-27; the 2022/24 cash waterproofing correctly falls outside the FY);
  Maintenance = ₹2,36,101; sum ₹11,83,102 equals the Expenses page FY total exactly — the
  split is exhaustive. Corpus KPI shows "—" under the Maintenance filter.
- **Transaction edit dialog** (EP1 ₹15,000 corpus CR): "Corpus plan" selector now visible
  with a single active plan and pre-populated with **Corpus 2025**; closed without saving.

## Notes for the next audit

- Budget total (₹20,00,000) is intentionally below plan target (₹24,30,000) — informational,
  not a defect.
- When Corpus 2025 is eventually closed on prod, re-run this validation plus:
  arrears rows created == close-dialog preview; wizard consumes them; dashboard/corpus
  "Spent" excludes the completed plan (scope fix ships in `c86051a`).
- Dev/prod schema drift exists (`v_review_queue` missing on dev) — harmless 404 in dev only.
