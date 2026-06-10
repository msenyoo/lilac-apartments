# Financial Intelligence & Governance — Design Spec
**Date:** 2026-06-10  
**Scope:** 5 work streams covering treasurer dashboard, corpus fund v2, reporting suite, operations/governance, and owner transparency.

---

## Stream 1: Finance Overview Page (`/finance-overview`)

### Goal
A dedicated treasurer command-center page showing live cash position, maintenance vs corpus fund separation, 12-month cash flow chart, and actionable alerts — answering "how much money do we have and can we spend?" at a glance.

### Architecture
New page `src/pages/FinanceOverviewPage.tsx` added to the router and sidebar (treasurer/admin only). All data from existing tables via new Supabase queries — no schema changes. Charts via Recharts (already installed). Clicking any KPI card or chart element navigates to the relevant detail page.

### Components & Layout

**Section 1 — Hero strip (3 cards)**
- `Net Available Cash` = Maintenance available + Corpus available (blue)
- `Fixed Deposits` = `SUM(deposits.principal_amount) WHERE status='active'` (purple)
- `Pending Actions` = count of (overdue flats + unreconciled expenses + FDs maturing in 30 days) — red if > 0

**Section 2 — Fund panels (side by side)**

Maintenance Fund panel (blue tint):
- Collected this FY = `SUM(transactions.amount) WHERE cr_dr='CR' AND corpus='NO' AND fiscal_year=current_fy`
- Spent this FY = `SUM(expenses.amount) WHERE category.budget_type='Maintenance' AND voided_at IS NULL AND expense_date IN current_fy`
- Available = Collected − Spent
- Pending dues = `SUM(v_dues_tracker.pending) WHERE status != 'Clear'`
- Click "Available" → navigates to `/expenses?filter=maintenance`
- Click "Pending dues" → navigates to `/dues`

Corpus Fund panel (purple tint):
- Collected = `SUM(v_corpus_tracker.collected)` across all active plans
- Spent = `SUM(expenses.amount) WHERE corpus_plan_id IS NOT NULL AND voided_at IS NULL`
- Available = Collected − Spent
- Active plans = count of corpus plans with status='active'
- Click "Available" → navigates to `/corpus`

**Section 3 — 12-month cash flow chart**
- Stacked bar per month: Maintenance collections (blue) + Corpus collections (purple)
- Overlaid line: Total expenses (red)
- Data from `v_monthly_summary` view, last 12 fiscal months
- Click any bar → navigates to `/expenses` filtered to that month

**Section 4 — Action strip**
- Overdue flats (> 60 days): count + "View" button → `/dues`
- FD maturities in next 30 days: count + next maturity date → `/finance`
- Unreconciled bank DRs: count → `/expenses?tab=reconcile`

**Section 5 — Detail panels (two columns)**

Left: Aging receivables table
- Columns: Flat, Block, Amount due, Days overdue (30/60/90+), Last payment
- Sorted by days overdue DESC
- Source: `v_dues_tracker` where status != 'Clear'
- Row click → `/dues` scrolled to that flat

Right: Corpus plan status mini-table
- One row per active corpus plan
- Columns: Plan name, Target, Collected, Spent, Available, % progress bar
- Row click → `/corpus?plan=<id>`

### Navigation
- Add "Finance Overview" to sidebar under the Finance section (admin/committee only, not owner/auditor)
- Sidebar icon: `LayoutDashboard` from lucide-react

---

## Stream 2: Corpus Fund v2

### Goal
Make the corpus module safe and clear for parallel plan scenarios — prevent silent misallocation when two active plans overlap, give the treasurer a unified per-flat collection calendar, and surface inter-plan overflow.

### Architecture
Changes confined to `CorpusPage.tsx` and `supabase/migrations/029_corpus_v2.sql`. No changes to `v_corpus_tracker` view (too complex to change safely). New UI guards and warnings layered on top of existing queries.

### Changes

**1. Parallel plan safety warning**
- When 2+ plans are active simultaneously, show an amber banner at the top of CorpusPage:  
  `"2 active plans detected. Corpus payments without a plan tag will be attributed by FY range. Overlap risk: [Plan A FY] vs [Plan B FY]."`
- No hard block — treasurer can dismiss the warning

**2. Plan-agnostic payment attribution UI**
- When adding a corpus transaction (Transactions page tag flow), if multiple active plans exist, show a "Which corpus plan?" dropdown before saving
- Store selection as `transactions.plan_id`
- If single active plan, auto-select (no extra step)

**3. Unified collection calendar**
- New sub-tab "Collection Calendar" in CorpusPage (alongside By Flat, Installment Plan, Expenditure)
- Grid: rows = flats, columns = installment due dates across ALL active plans
- Cell color: green (paid), amber (partial), red (overdue), grey (not due yet)
- Answers: "Which flats owe money across any active plan this month?"

**4. Overflow indicator**
- In Corpus plan cards (dashboard and CorpusPage), if `collected > effective_target` for a plan, show a green badge "Surplus: ₹X" instead of the balance
- Surplus is informational only — no auto-transfer logic

**5. Plan lifecycle validation**
- Before activating a new plan, check if an existing active plan's FY range overlaps
- Show confirmation dialog: "Plan A (FY 2024–26) is still active and overlaps this plan's FY range. Untagged payments may be split. Proceed?"
- Admin can confirm

**Migration 029**
```sql
-- No new columns needed
-- Add a check function (not constraint) called by app layer:
-- get_overlapping_active_plans(start_fy, end_fy) returns plan names
CREATE OR REPLACE FUNCTION get_overlapping_active_plans(p_start int, p_end int)
RETURNS TABLE(id uuid, name text) AS $$
  SELECT id, name FROM corpus_plans
  WHERE status = 'active'
  AND start_fiscal_year <= p_end
  AND end_fiscal_year >= p_start
$$ LANGUAGE sql SECURITY DEFINER;
```

---

## Stream 3: Reporting Suite

### Goal
Add audit-ready financial statements to the Reports page: Receipts & Payments account, AGM Balance Sheet PDF, and TDS deduction register — sufficient for CA sign-off and AGM submission.

### Architecture
New tabs added to existing `ReportPage.tsx`. PDF generation via `@react-pdf/renderer` (already installed, same pattern as existing AGM PDFs). All data queried server-side at render time — no caching needed for reports.

### Report 1: Receipts & Payments Statement

**Location:** New "R&P Statement" tab in ReportPage  
**Period selector:** FY dropdown (current FY default)

**Receipts section (CRs):**
| Head | Amount |
|---|---|
| Maintenance collected | SUM(transactions) WHERE cr_dr='CR' AND corpus='NO' AND fiscal_year |
| Corpus collected | SUM(transactions) WHERE cr_dr='CR' AND corpus='YES' AND fiscal_year |
| FD interest received | SUM(deposits.interest_earned) WHERE matured in FY |
| Opening balance | Prior FY closing balance (manual entry field) |

**Payments section (DRs):**
- Grouped by expense_categories.name
- Source: `expenses` JOIN `expense_categories` WHERE expense_date IN FY AND voided_at IS NULL
- Subtotal per category
- Total payments

**Closing balance** = Total receipts − Total payments  
**Export:** PDF button (standard A4 format, society header)

### Report 2: AGM Balance Sheet

**Location:** New "Balance Sheet" tab in AGM Reports section  
**Period:** As at 31 March (end of FY)

**Assets:**
- Bank balance = Opening balance (manually entered per FY in Settings) + total CRs − total DRs (from transactions table)
- Fixed deposits = `SUM(deposits.principal_amount)` WHERE status='active'
- Corpus fund collected = `SUM(v_corpus_tracker.collected)` all plans
- Total assets

**Liabilities:**
- Pending maintenance dues = `SUM(v_dues_tracker.pending)` WHERE status != 'Clear'
- Corpus committed not yet collected = `SUM(v_corpus_tracker.balance)` where balance > 0
- Total liabilities

**Net position** = Total assets − Total liabilities  
**Export:** PDF (AGM-ready A4 format)

### Report 3: TDS Compliance Register

**Location:** New "TDS Register" sub-section in Expenditure tab  
**Period:** FY dropdown

**Table columns:** Vendor name, PAN, Total paid this FY, TDS threshold (₹30,000), Amount over threshold, TDS @ 10% due, Status (✓ Deducted / ⚠ Due)  
**Source:** `expense_line_items` grouped by `vendor_id`  
**Export:** Excel (`.xlsx` via existing `xlsx` library)

---

## Stream 4: Operations & Governance

### Goal
Add an expense approval workflow so no payment goes unreviewed, build a Staff CRUD UI (currently zero), and add bulk maintenance payment recording to cut data entry time.

### Architecture
Expense approval: new `status` column on `expenses` (migration 030). Staff management: new tab in ExpensesPage or Settings. Bulk payments: new dialog in DuesPage. RBAC stays the same — admin auto-approves, committee sees a queue.

### Feature 1: Expense Approval Workflow

**Migration 030:**
```sql
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS
  approval_status text NOT NULL DEFAULT 'approved'
  CHECK (approval_status IN ('pending','approved','rejected'));
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS rejection_reason text;
```

**Behaviour:**
- Admin creates expense → `approval_status = 'approved'` automatically (no change to admin workflow)
- Committee member creates expense → `approval_status = 'pending'` (future feature when committee gets write access)
- Pending expenses excluded from all financial totals until approved
- New "Pending Approval" badge on ExpensesPage tab when count > 0
- Admin sees pending expenses in a highlighted section at top of Day Book; can Approve or Reject with one click

**For now:** All existing and new admin expenses default to 'approved'. The infrastructure is in place for when committee write access is added.

### Feature 2: Staff Management UI

**Location:** New "Staff" tab in ExpensesPage (alongside Vendors, Recurring, Petty Cash)

**Staff list:** AG Grid table — Name, Role, Area, Phone, Joined, Status (Active/Left)  
**Add Staff dialog:** Name (required), Role (dropdown: Security, Housekeeping, Electrician, Plumber, Other), Area, Phone, Joined date  
**Edit Staff:** Same dialog pre-filled  
**Mark as Left:** Sets `left_date = today`, greys out in list  
**Hard delete:** Only if staff has zero linked expense line items  

### Feature 3: Bulk Maintenance Payment Recording

**Location:** DuesPage → new "Bulk Record" button (admin only)

**Flow:**
1. Admin uploads bank statement CSV (already done via Transactions page) — or selects from unmatched CRs
2. Dialog shows a list: unmatched CR transactions, each with a "Flat" dropdown
3. Admin assigns each CR to a flat + fiscal month
4. "Record All" saves all as `maintenance_payments` in one batch
5. Cache invalidated: `['dues']`, `['transactions']`

---

## Stream 5: Owner Transparency

### Goal
Show flat owners how their corpus contributions are being used (which projects, how much spent), let them download their annual maintenance statement as PDF, and show society-level financial health without exposing individual flat details.

### Architecture
Changes confined to `OwnerPortalPage.tsx`. No new pages. All queries scoped to the logged-in owner's flat. Society-level aggregates show totals only (no per-flat breakdown of others).

### Feature 1: Corpus Expenditure Visibility

**Location:** New "How Your Corpus Is Used" section in OwnerPortalPage, below corpus contributions

**Shows:**
- For each active corpus plan the owner participates in:
  - Plan name, target, collected society-wide, % progress
  - Expense breakdown: category name, total spent, most recent voucher date
  - Example: "Waterproofing — ₹2,85,000 spent across 3 blocks (Aug 2022 – May 2024)"
- Source: `expenses` WHERE `corpus_plan_id = plan.id` AND `voided_at IS NULL`, grouped by category

### Feature 2: Annual Maintenance Statement PDF

**Location:** "Download Statement" button in OwnerPortalPage header  
**Period:** FY selector (defaults to current FY)

**PDF contents:**
- Header: Society name, flat number, owner name, FY
- Maintenance: Month-by-month table (month, amount due, amount paid, balance)
- Corpus: Per-plan summary (target, paid, balance)
- Total paid summary
- Uses `@react-pdf/renderer` same pattern as existing AGM PDFs

### Feature 3: Society Financial Health Strip

**Location:** New read-only strip at top of OwnerPortalPage (below flat identity card)

**Shows 3 cards:**
- Maintenance collection rate this FY: "X of 44 flats cleared" (no names)
- Corpus progress: "59% of ₹24.3L target collected"
- Last expense: "Most recent: ₹50,000 — Civil Work (07 Jun 2026)"

---

## Implementation Order

Build streams in dependency order:
1. **Stream 1** (Finance Overview) — standalone new page, no deps
2. **Stream 2** (Corpus v2) — parallel with Stream 1
3. **Stream 3** (Reporting Suite) — needs clean corpus data from Stream 2
4. **Stream 4** (Operations) — approval schema needed before Stream 3 R&P
5. **Stream 5** (Owner Transparency) — needs corpus expenditure data (Stream 2 + 3)

Each stream is independently deployable and testable.
