# Lilac Apartments — Management Platform

Society management app for Lilac Apartments, Rajakil Pakkam, Chennai.
Operated by the management committee — non-accountant residents on desktop + mobile.

---

## Live App

**Production:** https://lilac-apartments.vercel.app  
**Auth:** Supabase (email + password, single admin account)  
**Supabase project:** `aulttcsvxzcwyceezzpz`

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Routing | React Router v6 |
| Styling | Tailwind CSS + Shadcn/ui |
| Data tables | AG Grid Community |
| Charts | Recharts (via Shadcn chart wrapper) |
| Forms | react-hook-form + zod |
| PDF export | @react-pdf/renderer |
| Backend | Supabase (Postgres + Auth + Storage) |
| Hosting | Vercel (SPA, auto-deploy on push to main) |
| Testing | Playwright (Desktop Chrome + Mobile Chrome) |

---

## Pages & Routes

| Route | Page | Purpose |
|---|---|---|
| `/dashboard` | DashboardPage | KPI strip, charts, alert strip |
| `/transactions` | TransactionsPage | Bank statement import + match |
| `/dues` | DuesPage | Maintenance dues tracker per flat |
| `/corpus` | CorpusPage | Corpus plan collection + expenditure |
| `/expenses` | ExpensesPage | Expense day book, vendors, staff, recurring |
| `/reports` | ReportPage | Collection, Corpus, AGM, Expenditure reports + PDFs |
| `/flats` | FlatsPage | Flat master list + owner details |
| `/settings` | SettingsPage | Maintenance rates, expense categories, general settings |

---

## Database Schema (key tables)

```
flats                       — flat master (block, flat_no, owner, maintenance_amt)
transactions                — bank statement rows (CR/DR, matched flag)
maintenance_payments        — payments linked to flats + FY
corpus_plans                — corpus plan header (name, target, FY range, status)
corpus_plan_flats           — per-flat target + pre-payment per plan
corpus_payments             — corpus payment records
expenses                    — expense header (payee, amount, voucher, mode)
expense_line_items          — per-line breakdown (cost centre, category, units)
expense_attachments         — bill scans in Supabase Storage
expense_categories          — configurable categories (Maintenance / Corpus)
vendors                     — vendor/payee master
staff                       — staff master (security, sweeper, etc.)
staff_salary_history        — salary rates with effective dates
maintenance_rate_history    — rate changes with effective dates
app_settings                — key-value: society name, UPI, bank details
petty_cash_transactions     — petty cash register
recurring_expense_templates — monthly/quarterly recurring expense templates
```

Key views: `v_dues_tracker`, `v_corpus_tracker`

---

## Completed Work

### Phase 1 — Foundation
- Supabase schema: flats, transactions, maintenance_payments
- Bank statement CSV import with column mapping
- Transaction matching (flat + FY assignment)
- Basic dues tracker view

### Phase 2 — Platform v2 Core
- Full design system: violet/lilac brand, Inter font, Shadcn/ui components
- Multi-corpus plan support (multiple active plans simultaneously)
- Expenses module: day book, add expense with dynamic line items, vendor/staff master
- Expense categories (Maintenance vs Corpus), recurring templates, petty cash
- Dynamic utility tracking (EB units, sewage trips per block)
- Reports expansion: Collection, Corpus, AGM (I&E, R&P, Defaulters), Expenditure
- PDF export for AGM reports via @react-pdf/renderer
- Reconciliation UI: match bank DRs to expenses
- Dashboard: KPI cards, charts (bar, pie, area), alert strip
- Rate history settings: add maintenance rate changes per flat

### Phase 3 — Reconciliation & Settings
- Side-by-side reconciliation (bank DR ↔ expense matching)
- Maintenance rate history settings tab
- General settings: society name, UPI ID, bank details
- WhatsApp reminder copy button on dues detail panel

### Phase 8 — Mobile Responsiveness & Polish
- All dialogs: `max-h-[90vh] overflow-y-auto flex flex-col` in base DialogContent
- Rate change modal: sticky header/body/footer structure (no clipping on laptop)
- Detail panels (Dues, Flats, Corpus): `flex-col` on mobile → `flex-row lg:` on desktop
- KPI grids: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` responsive stacking
- Tab bars with 6+ tabs: `overflow-x-auto` for horizontal scroll on narrow screens
- Playwright e2e test infrastructure: auth setup + full page coverage

---

## Current State (as of 2026-06-05)

- All phases committed and deployed to production
- Playwright config set up with Desktop Chrome + Mobile Chrome projects
- Auth setup test passes; full e2e suite partially passing (navigation, dashboard, dues grid, corpus selector all green)
- Some e2e selectors need tuning against live DOM (tab label text, combobox selectors)

---

## Future Roadmap

### Next: Help Documentation
In-app contextual help system:
- Help icon (?) on each page opening a slide-over with worked examples
- Per-feature guides: how to import a bank statement, how to add an expense with line items, how to close a corpus plan
- Possibly a Help page (`/help`) with searchable articles
- Stack suggestion: Shadcn Sheet + markdown rendering, or a simple accordion per section

### User Management + RBAC
Three roles:
- **Admin** — full read/write on everything
- **Committee** — read + approve expenses, view reports
- **Auditor** — read-only, reports + export

Implementation:
- Supabase Auth + custom `user_roles` table
- Row-level security policies per role
- Role badge in sidebar (current user's role)
- Route guards: redirect non-admins away from settings/mutations

### Audit Logging
Full trail: who changed what, when.
- New `audit_log` table: `(id, user_id, action, table_name, record_id, old_val jsonb, new_val jsonb, created_at)`
- Trigger-based logging on key tables (expenses, corpus_payments, maintenance_payments, corpus_plans)
- Audit log viewer in Settings page (filterable by user, table, date range)
- Export as Excel for committee review

### Remaining Feature Gaps (from original spec)
| Gap | Notes |
|---|---|
| Bank statement CSV auto-import | Currently manual row-by-row; need bulk CSV → transactions |
| EB metering detail per flat | Currently per-block only; depends on smart meter data |
| Flat ownership transfer | New owner inherits dues/corpus balance |
| Maker-checker for high-value actions | Two-person confirmation for corpus close, large expenses |
| TDS certificate generation | Beyond flagging; actual Form 16A generation |
| Mobile native app | Currently responsive web; PWA wrapper possible |

---

## Key Conventions

- **Fiscal year:** April–March (FY 2025-26 = Apr 2025–Mar 2026)
- **Currency:** INR paise stored as integers (₹1 = 100 in DB? No — stored as whole rupees)
- **Voucher numbers:** `EXP-YYYY-NNNN` auto-generated per fiscal year
- **Cost centres:** Block-A, Block-B, Block-C, Block-D, Block-E, Common, Municipal, All
- **Expense statuses:** Cash | Unreconciled | Reconciled
- **Corpus plan statuses:** Draft | Active | Completed | Cancelled

## Key Files

| File | Purpose |
|---|---|
| `src/lib/supabase.ts` | Supabase client + all TypeScript types |
| `src/components/layout/Layout.tsx` | Sidebar nav + mobile bottom nav |
| `src/components/ui/dialog.tsx` | Base dialog (scrollable, max-h-[90vh]) |
| `src/components/reports/AgmPdfDocs.tsx` | AGM PDF templates (I&E, Defaulters, R&P) |
| `supabase/migrations/` | All schema migrations in order |
| `e2e/app.spec.ts` | Playwright e2e tests |
| `playwright.config.ts` | Playwright: Desktop Chrome + Mobile Chrome |

---

## Running Locally

```bash
npm install
npm run dev          # starts at http://localhost:5173

# E2E tests (requires TEST_EMAIL + TEST_PASSWORD in .env.test)
npx playwright test --project=setup   # auth once
npx playwright test --project="Desktop Chrome"
npx playwright test --project="Mobile Chrome"
```

## Deployment

Push to `main` → Vercel auto-deploys.  
Env vars managed in Vercel dashboard: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
