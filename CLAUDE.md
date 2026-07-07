# Lilac Apartments — Claude Code Project Instructions

Society management app for Lilac Apartments, Rajakil Pakkam, Chennai.
Operated by a volunteer management committee (non-accountant residents).

---

## Environment Setup (Required First)

This app connects to Supabase. Create `.env.local` in the project root:

```
VITE_SUPABASE_URL=https://aulttcsvxzcwyceezzpz.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_zPwcS21TWUSR8zeSnhB4FA_2gPhdxD7
SUPABASE_SERVICE_ROLE_KEY=<get from Supabase dashboard → Settings → API → service_role key>
```

> The anon key is a publishable browser key — safe to commit.
> The service role key is secret — get it from Supabase dashboard, never commit it.

For Supabase Management API access (CLI, direct SQL), sessions may have `SUPABASE_ACCESS_TOKEN`
set — locally via `.claude/settings.local.json`, in cloud sessions via the claude.ai environment
config. Use it as `SUPABASE_ACCESS_TOKEN=<token> supabase ...` or as a Bearer token against
`https://api.supabase.com/v1/projects/<ref>/database/query`. Never write its value into repo files.

For Playwright e2e tests, also create `.env.test` (login is mobile-number based):
```
TEST_EMAIL=9999999999
TEST_PASSWORD=lilacadmin
```

---

## Key Commands

```bash
npm run dev          # Start dev server at http://localhost:5173
npm run build        # Production build
npx tsc --noEmit     # TypeScript check (run before committing)

# E2e tests (requires dev server running or reuseExistingServer=true)
node scripts/seed-e2e-advance-payer.js       # Seed dev-DB fixtures (idempotent, re-run monthly)
npx playwright test --project=setup          # Auth once → saves to e2e/.auth/user.json
npx playwright test --project="Desktop Chrome"
npx playwright test --project="Mobile Chrome"
```

---

## Architecture

| Layer | Detail |
|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| UI components | Shadcn/ui (dialogs, sheets, tabs, badges, selects) |
| Data tables | AG Grid Community |
| Charts | Recharts via Shadcn chart wrapper |
| Forms | react-hook-form + zod |
| PDF export | @react-pdf/renderer (lazy-loaded) |
| Backend | Supabase (Postgres + Auth + Storage) |
| Hosting | Vercel — auto-deploys on push to `main` |

---

## Pages & Routes

| Route | Page |
|---|---|
| `/dashboard` | KPI cards, charts, alert strip |
| `/transactions` | Bank statement import + tag/match |
| `/dues` | Maintenance dues per flat per FY |
| `/corpus` | Corpus fund collection + expenditure |
| `/expenses` | Day book, add expense with line items, vendors, staff |
| `/reports` | Collection, corpus, AGM PDFs, expenditure, utilities |
| `/flats` | Flat master + resident details |
| `/settings` | Rates, categories, users, audit log, general |

---

## Key Source Files

| File | Purpose |
|---|---|
| `src/lib/supabase.ts` | Supabase client + all TypeScript types |
| `src/App.tsx` | Routes + auth guard + RoleProvider |
| `src/components/layout/Layout.tsx` | Sidebar + mobile bottom nav + HelpButton |
| `src/hooks/useRole.ts` | `useRole()` — fetches user's role from DB |
| `src/contexts/RoleContext.tsx` | `useRoleCtx()` — role available app-wide |
| `src/components/HelpButton.tsx` | Floating ? help panel (context-aware per page) |
| `src/components/reports/AgmPdfDocs.tsx` | AGM PDF templates (lazy-loaded) |
| `supabase/migrations/` | All schema migrations (001–014) |
| `supabase/functions/create-user/index.ts` | Edge Function: admin-only user creation |
| `e2e/app.spec.ts` | Playwright e2e (43 tests, all passing) |

---

## Database Schema (key tables)

```
flats                      — flat master (block, flat_no, owner, maintenance_amt)
residents                  — owner/tenant with contact + UPI
transactions               — bank statement rows (CR/DR, matched flag)
maintenance_payments       — payments linked to flat + FY
maintenance_rate_history   — rate changes with effective dates
corpus_plans               — corpus plan header (name, target, FY, status)
corpus_plan_flats          — per-flat target + pre-payment per plan
corpus_payments            — corpus payment records
expenses                   — expense header (payee, amount, voucher, mode)
expense_line_items         — split/breakdown from receipts
expense_categories         — configurable list (Maintenance vs Corpus)
vendors                    — vendor/payee master
staff + staff_salary_history — staff master + salary rates
app_settings               — key-value: UPI, bank details, society name
user_roles                 — RBAC: admin | committee | auditor
audit_log                  — who changed what, when (Postgres triggers)
```

Key views: `v_dues_tracker`, `v_corpus_tracker`, `v_expense_reconciliation`, `v_users`

---

## RBAC Roles

| Role | Access |
|---|---|
| `admin` | Full read + write + user management |
| `committee` | Read all + approve expenses (no mutations) |
| `auditor` | Read-only across everything |

Use `useRoleCtx()` in components:
```typescript
const { isAdmin, canWrite, canApprove } = useRoleCtx()
// Gate mutation buttons: {canWrite && <Button>Add Expense</Button>}
```

---

## Migrations — Apply Order

All migrations 001–014 are applied to production.

---

## Conventions

- **Fiscal year:** April–March (FY 2025-26 = Apr 2025 – Mar 2026)
- **Currency:** stored as whole rupees (integers)
- **Cost centres:** Block-A through Block-E, Common, Municipal, All
- **Expense statuses:** Cash | Unreconciled | Reconciled
- **Corpus plan statuses:** Draft | Active | Completed | Cancelled
- **Voucher numbers:** EXP-YYYY-NNNN (auto-generated by DB trigger)
- **Rate changes:** forward-only from effective_from date
- **Audit logging:** Postgres triggers (not app-level)

## Code Style

- No comments unless the WHY is non-obvious
- Tailwind only — no inline styles except gradients
- Shadcn/ui for all new dialogs, sheets, badges, selects
- AG Grid Community for data tables
- `useRoleCtx()` for role checks, never query `user_roles` directly in components
- Run `npx tsc --noEmit` before every commit

---

## Deployment

Push to `main` → Vercel auto-deploys.
Env vars in Vercel dashboard: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
Production URL: https://lilac-apartments.vercel.app
