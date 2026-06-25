# Lilac Apartments — Project Context

> Portable briefing for AI assistants. Self-contained — assumes no other context.
> **Last refreshed:** 2026-06-25 (post-audit)

---

## How to refresh this file

Ask any AI assistant working in this repo:

> "Refresh `CONTEXT.md` from current repo state — re-read `package.json`, `supabase/migrations/`, `src/App.tsx`, and `git log -20`. Update the Stack, Migrations, Routes, and Recent Work sections, then bump the date at the top."

Plain markdown, no hidden links, no secrets. Safe to share with Claude (web/desktop), ChatGPT, Cursor, Copilot, etc.

---

## What this app is

A society management web app for **Lilac Apartments**, Rajakil Pakkam, Chennai. Replaces Excel/Google Sheets used by the volunteer management committee (residents, not accountants) to run the association's finances.

- **Scope:** ~30 flats across 5 blocks (A–E). Committee ~5 people; owners get a read-only portal.
- **Hosting:** Vercel, auto-deploy from `main`. Production: https://lilac-apartments.vercel.app
- **Backend:** Supabase (Postgres + Auth + Storage + Edge Functions). Project ref `aulttcsvxzcwyceezzpz`.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS + Shadcn/ui (Radix primitives) |
| Data grid | AG Grid Community |
| Charts | Recharts |
| Forms | react-hook-form + zod |
| PDF | @react-pdf/renderer (lazy-loaded) |
| State/data | @tanstack/react-query + Supabase JS client |
| PWA | vite-plugin-pwa |
| Tests | Playwright (Desktop Chrome + Mobile Chrome) |
| Backend | Supabase (Postgres 15, RLS, Edge Functions on Deno) |

---

## Environment

`.env.local` (gitignored) — required to run dev:
```
VITE_SUPABASE_URL=https://aulttcsvxzcwyceezzpz.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable anon key — safe in browser>
SUPABASE_SERVICE_ROLE_KEY=<secret — server/scripts only>
```

`.env.test` (gitignored) — for Playwright:
```
TEST_EMAIL=admin@lilac.com
TEST_PASSWORD=<test admin password>
```

---

## Commands

```bash
npm run dev          # Vite dev server → http://localhost:5173
npm run build        # tsc + vite build
npm run lint         # ESLint (max-warnings 0)
npx tsc --noEmit     # type-check only (run before committing)

# Playwright
npx playwright test --project=setup            # auth once → e2e/.auth/user.json
npx playwright test --project="Desktop Chrome"
npx playwright test --project="Mobile Chrome"

# Supabase CLI (linked to project ref aulttcsvxzcwyceezzpz)
supabase db push                                                  # apply new migrations
supabase functions deploy <name> --project-ref aulttcsvxzcwyceezzpz
```

---

## Routes

| Path | Purpose |
|---|---|
| `/dashboard` | Finance overview — KPI cards, charts, alert strip |
| `/transactions` | Bank import + tag/match; inline edit flat/category before confirming upload |
| `/dues` | Maintenance dues per flat per FY; aging filter tabs; WhatsApp reminders (per-flat + broadcast) |
| `/corpus` | Corpus fund — multi-plan, per-flat targets, WhatsApp reminders |
| `/expenses` | Day book; expense with line items, vendors, staff, recurring templates |
| `/reports` | Collection, Corpus, AGM PDFs, flat statement (with consolidated WhatsApp) |
| `/flats` | Flat master + resident details |
| `/announcements` | Notices (persisted in `app_settings.announcements_data`) |
| `/activity` | Audit log viewer with XLSX export |
| `/users` | Users tab + Permissions matrix; Add/Edit/Delete dialogs |
| `/help` | Help center; floating `?` sheet on every route |
| `/my-flat` | Owner portal — read-only dues, corpus, payment history |
| `/settings` | Rates, categories, general — admin-only |

---

## Key source files

| File | Purpose |
|---|---|
| `src/lib/supabase.ts` | Supabase client + shared TypeScript types |
| `src/App.tsx` | Routes + auth guard + RoleProvider |
| `src/components/layout/Layout.tsx` | Sidebar + mobile bottom nav + HelpButton |
| `src/components/HelpButton.tsx` | Floating context-aware `?` sheet |
| `src/contexts/RoleContext.tsx` | `useRoleCtx()` — role available app-wide |
| `src/hooks/usePermissions.ts` | RBAC permission map (22 resources) |
| `src/pages/UsersPage.tsx` | Users tab + Permissions matrix |
| `src/pages/CorpusPage.tsx` | Plan selector + 4-step create/activate/close wizard |
| `src/components/reports/AgmPdfDocs.tsx` | AGM PDF templates (lazy-loaded) |
| `supabase/migrations/` | Migrations 001–032, all applied to production |
| `supabase/functions/create-user/index.ts` | Edge fn: create auth user + profile + role |
| `supabase/functions/delete-user/index.ts` | Edge fn: admin-only deletion (no self-delete) |
| `e2e/app.spec.ts` | Playwright e2e suite |

---

## Database — key tables

```
flats                       block, flat_no, owner_name, maintenance_amt
residents                   owner/tenant with contact + UPI
transactions                bank statement rows (CR/DR, matched flag, plan_id)
maintenance_payments        payments linked to flat + FY
maintenance_rate_history    rate changes with effective dates (forward-only)
corpus_plans                plan header (name, target, FY, status)
corpus_plan_flats           per-flat target + pre-payment per plan
corpus_payments             corpus payment records
flat_arrears                arrears: maintenance | corpus | credit
flat_credits                advance credits (offset against dues)
expenses                    header (payee, amount, voucher, mode, status)
expense_line_items          split/breakdown from receipts
expense_attachments         bill scans in Supabase Storage
expense_categories          configurable; tagged Maintenance vs Corpus
vendors                     vendor/payee master
staff + staff_salary_history staff master + salary rates
recurring_expense_templates monthly/quarterly recurring expenses
petty_cash_transactions     petty cash register
deposits                    fixed deposits + interest tracking
app_settings                key-value: UPI, bank, role_permissions, announcements, opening balance
user_roles                  RBAC: admin | committee | auditor | owner
profiles                    extended user info: mobile, contact_email, display_name, flat_id
audit_log                   who-changed-what (Postgres triggers, not app-level)
```

Key views: `v_dues_tracker`, `v_corpus_tracker`, `v_expense_reconciliation`, `v_users`.

---

## Migrations (all applied to production)

```
001–008  initial schema, expenses, dues rate history, dedup, fixes
009      storage bucket
010      expense categories gap fill
011      utility categories dynamic
012      audit_log + triggers on 7 tables
013      user_roles + get_my_role() + v_users + RLS lockdown
014      profiles: mobile, contact_email, display_name
015      profiles.flat_id (FK to flats)
016      audit_user_tables
017      profile_self_insert
018      fix audit trigger id
019      app_settings read policy
020      owner role + get_my_flat_id() + get_my_flat_code() + view RLS
021      view security invoker
022      flat_arrears (maintenance / corpus / credit)
023      transactions.plan_id
024      v_dues_tracker rebuilt with arrears + advance_credits + total_outstanding
025      v_corpus_tracker with plan_id
026      flat_credits + 'credit' arrears_type; v_dues_tracker rebuilt
027      CRUD soft-delete
028      deposits
029      corpus v2
030      opening balance setting
031      approval workflow
032      pending line items
```

---

## RBAC

| Role | Access |
|---|---|
| `admin` | Full read + write + user management (Treasurer) |
| `committee` | Read all + approve expenses; permissions configurable |
| `auditor` | Read-only across everything; permissions configurable |
| `owner` | Own flat only (`/my-flat`, `/dashboard`); dues + corpus + history |

Permission map stored in `app_settings.role_permissions` (JSON, 22 resources).
Use `useRoleCtx()` in components — never query `user_roles` directly.

```typescript
const { isAdmin, canWrite, canApprove } = useRoleCtx()
{canWrite && <Button>Add Expense</Button>}
```

---

## Conventions

- **Fiscal year:** April–March (FY 2025-26 = Apr 2025 – Mar 2026)
- **Currency:** whole rupees, stored as integers
- **Cost centres:** Block-A … Block-E, Common, Municipal, All
- **Expense statuses:** Cash | Unreconciled | Reconciled
- **Corpus plan statuses:** Draft | Active | Completed | Cancelled
- **Voucher numbers:** `EXP-YYYY-NNNN` (DB trigger)
- **Rate changes:** forward-only from `effective_from`
- **Audit logging:** Postgres triggers (not app-level)
- **Owner login:** `{mobile}@lilac.com` — phone is the login ID

## Code style

- No comments unless the WHY is non-obvious
- Tailwind only — no inline styles except gradients
- Shadcn/ui for all new dialogs/sheets/badges/selects
- AG Grid Community for data tables
- `useRoleCtx()` for role checks
- Run `npx tsc --noEmit` before every commit

---

## Recent work (last 15 commits)

```
bbf8506 fix(reports): Dues Aging now matches Dues page count
4140762 fix(reports): flat statement outstanding now includes arrears
b7b5901 feat(reports): consolidated WhatsApp reminder on flat statement
8d31be2 feat(corpus): per-flat WhatsApp reminder — Copy + Send buttons
3c04f0f feat(dues): per-flat WhatsApp reminder — modernised + send button
702f28b chore(layout): remove non-functional top search bar; right-align corpus actions
3d777dd fix(transactions): single-click to edit cells in upload preview
b5bc627 feat(transactions): edit flat/category before confirming upload
94a6007 feat(corpus): WhatsApp broadcast for pending corpus contributions
5fadd78 fix(dues): broadcast list sorted by flat code, not by amount
f0466c6 fix(dues): tweak WhatsApp broadcast format
57e7b7c feat: move Bulk Record to Transactions; add WhatsApp broadcast on Dues
9221673 fix(dues): export now matches the UI table
b213671 refactor(dashboard): remove redundant action strip
97d8081 refactor: replace Dashboard with Finance Overview page
```

Theme of recent work: **WhatsApp reminder flows** (dues + corpus + flat statement) and **transaction upload UX** (inline edit before confirm).

---

## Auditor review toolkit

Reusable read-only scripts at `scripts/audit-*.js`. All consume `.env.local` for the Supabase service-role key; output is markdown.

```bash
node scripts/audit-review.js          # full sweep — bank, expenses, dues, corpus, cross-ledger, audit log
node scripts/audit-drilldown.js       # detail rows for top findings
node scripts/audit-split-sweep.js     # strict UPI/IMPS-ref duplicate detection
node scripts/audit-apply-fixes.js     # mutating — supports --dry-run; idempotent
```

Reports go to `docs/audits/YYYY-MM-DD-auditor-review.md`. The 2026-06-25 report is the template. **Before mutating cumulative-balance-affecting rows, compare app cumulative against the live bank statement.** If they match, no fix is needed regardless of what the audit flags — the 2026-06-25 split-payment fix had to be reverted after the user confirmed the bank balance.

## Data quirks worth knowing

- **Source of truth** for cash flow = `transactions`. Legacy `maintenance_payments` / `corpus_payments` are empty.
- **`flat_code` is overloaded** as a sentinel for non-flat allocations: `INTEREST` (historical FD interest mis-tag), `FD`, `EB`, `SEWAGE`, `SALARY`, etc. Joins against `flats.code` silently drop these.
- **Opening balance** is a CR transaction row dated 2025-03-31 (`txn_id='OPENING-FY-2025-26'`, `category='Opening Balance'`), NOT an `app_settings` key.
- **Split-payment pattern**: when one bank credit covers multiple flats, the in-app Split tool voids the original and inserts SPLIT rows linked via `split_refs`. Pre-migration Power Query splits may look like ordinary Normal rows — don't treat as duplicates without verification.
- **All `transactions` aggregations** must filter `.neq('row_type', 'VOIDED')`. Missing filter was the round-1 root cause of the balance mismatch.
- **Cumulative app balance ₹8,78,594** matches live bank ₹8,78,593.69 (31-paise artifact: ₹92,701.69 opening rounds to ₹92,702).

## Known open items

- **`EXP-2026-0018`** — ₹1,073 Online, "Sump water extension" 2026-06-12, not reconciled to a bank DR. Needs UI reconcile.
- **Flat statement "pending" card** — mid-year display shows full-year gap; needs months-elapsed view validation.
- **Utility coverage gap** — EB + sewage tracked; full apartment utility coverage analysis pending.
- **Pending line-items follow-up** — design spec at `docs/superpowers/specs/2026-06-24-line-item-followups-design.md`.
