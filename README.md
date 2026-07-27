# Lilac Apartments — Association Management

Society management platform for Lilac Apartments, Rajakil Pakkam, Chennai.
Built for the volunteer management committee — handles dues, expenses, corpus funds, and reports.

**Production:** https://lilac-apartments.vercel.app

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS + Shadcn/ui |
| Data tables | AG Grid Community |
| Charts | Recharts |
| Forms | react-hook-form + zod |
| PDF export | @react-pdf/renderer |
| Backend | Supabase (Postgres + Auth + Storage) |
| Hosting | Vercel (auto-deploy on push to `main`) |

---

## Getting Started

### Prerequisites

- Node.js 18+
- A Supabase project (see [Environment Setup](#environment-setup))

### Install

```bash
npm install
```

### Environment Setup

Create `.env.local` for production (or `.env.dev.local` for the dev DB):

```bash
cp .env.example .env.local   # then fill in values
```

Required variables:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>          # publishable, safe to share
SUPABASE_SERVICE_ROLE_KEY=<service-role>   # secret, never commit
```

For Playwright e2e tests, also create `.env.test`:

```
TEST_EMAIL=admin@lilac.com
TEST_PASSWORD=<password>
```

---

## Development

```bash
npm run dev          # Dev DB (.env.dev.local) — safe to experiment
npm run dev:prod     # Prod DB (.env.local)    — live data
npm run build        # Production build
npm run lint         # ESLint (max-warnings 0)
npx tsc --noEmit     # TypeScript check (run before committing)
```

The two scripts point to different Supabase projects via Vite's `--mode` flag:
- `npm run dev` loads `.env.dev.local` (dev/staging project, ref `qcoezjcwrsqchulqgydm`)
- `npm run dev:prod` loads `.env.local` (production project, ref `aulttcsvxzcwyceezzpz`)

The dev DB can lag behind prod on migrations/data — if something behaves differently under
`npm run dev` than in production, check `supabase/migrations/` for anything not yet applied
to the dev project (see [Database Migrations](#database-migrations)).

---

## Pages

| Route | Description |
|---|---|
| `/dashboard` | KPI cards, charts, alert strip |
| `/transactions` | Bank statement import (PSV/CSV), tag & match |
| `/dues` | Maintenance dues per flat per FY |
| `/corpus` | Corpus fund collection + expenditure |
| `/expenses` | Day book, add expense with line items, vendors, staff |
| `/reports` | Collection, corpus, AGM PDFs, expenditure, utilities |
| `/flats` | Flat master + resident details |
| `/settings` | Rates, categories, users, audit log, general |

---

## Login

Accepts either a 10-digit mobile number or an email address.
Mobile numbers are mapped to `<number>@lilac.com` for Supabase Auth transparently.

---

## RBAC Roles

| Role | Access |
|---|---|
| `admin` | Full read + write + user management |
| `committee` | Read all + approve expenses (no mutations) |
| `auditor` | Read-only across everything |

Roles are stored in `public.user_roles` and take effect immediately without re-login.
Use `useRoleCtx()` in components — never query `user_roles` directly.

---

## Database Migrations

All migrations live in `supabase/migrations/` and are applied in numeric order (currently
001–039, all applied to both prod and dev). To apply to a new project, run each file against
the Supabase Management API or the SQL editor, in order.

After applying migration 013 (`user_roles`), seed at least one admin user before any writes:

```sql
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin' FROM auth.users WHERE email = 'your@email.com'
ON CONFLICT (user_id) DO UPDATE SET role = 'admin';
```

### Supabase CLI

The project is linked to the prod ref. Get a Personal Access Token from
https://supabase.com/dashboard/account/tokens, then:

```bash
SUPABASE_ACCESS_TOKEN=sbp_... supabase link --project-ref aulttcsvxzcwyceezzpz

# Apply any new migration files to prod
SUPABASE_ACCESS_TOKEN=sbp_... supabase db push

# Deploy an Edge Function
SUPABASE_ACCESS_TOKEN=sbp_... supabase functions deploy <name> --project-ref aulttcsvxzcwyceezzpz

# Run raw SQL without the CLI (e.g. from CI or a script)
node scripts/apply-migration.js supabase/migrations/0NN_your_migration.sql
```

To target the dev project instead, swap in ref `qcoezjcwrsqchulqgydm` and re-run `supabase link`
(or set `SUPABASE_PROJECT_REF=qcoezjcwrsqchulqgydm` for scripts that read it, like
`scripts/apply-migration.js`). Dev and prod are separate databases — a migration applied to one
does not touch the other.

---

## Bank Statement Import

The Upload tab on the Transactions page accepts:
- **ICICI PSV** — pipe-delimited `.txt` or `.psv` (native ICICI net banking export)
- **Any bank CSV** — comma or semicolon delimited with Date, Description, Debit/Credit columns

Format is auto-detected. Duplicate transactions (matched by `txn_id`) are skipped automatically.

---

## E2E Tests

Requires `.env.test` (see [Environment Setup](#environment-setup)) and either a running dev
server or `reuseExistingServer` enabled in `playwright.config.ts`.

```bash
# Seed fixtures first (idempotent — safe to re-run)
node scripts/seed-e2e-advance-payer.js
node scripts/seed-e2e-residents.js

# Auth setup (run once — saves session to e2e/.auth/user.json)
npx playwright test --project=setup

# Run all tests
npx playwright test --project="Desktop Chrome"
npx playwright test --project="Mobile Chrome"
```

Around 185 tests exist; a chunk fail pre-existing for unrelated reasons (dead locators from
older UI, stale tests from removed phases) — if you're triaging a CI failure, diff it against
a baseline run on `main` before assuming your change broke it. Run with `--workers=1` if tests
interfere with each other locally.

---

## Debugging & Troubleshooting

**Prod loads a blank page or data won't load, but the site itself returns 200:**
The Supabase free-tier project auto-pauses after ~1 week without activity — this app is used
by residents/committee only occasionally, so it can pause between uses. A paused project's
subdomain stops resolving in DNS entirely, so the frontend still loads (it's static, served by
Vercel) but every Supabase call silently fails.

```bash
# Check status — look for "status":"INACTIVE"
curl -s https://api.supabase.com/v1/projects -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"

# Resume it (checks status, restores if needed, polls until healthy — ~3 min)
SUPABASE_ACCESS_TOKEN=sbp_... node scripts/resume-supabase.js         # prod
SUPABASE_ACCESS_TOKEN=sbp_... node scripts/resume-supabase.js dev     # dev DB
```

A scheduled workflow (`.github/workflows/supabase-keepalive.yml`) pings prod every 3 days to
prevent this; if it's disabled or GitHub Actions has an outage, the pause can still happen.

**Build fails / `npx tsc --noEmit` errors:** fix type errors before pushing — Vercel runs the
same `tsc && vite build` and will fail the deploy on any type error.

**401/403 or empty results from Supabase that you don't expect:** almost always Row Level
Security (RLS). Check `useRoleCtx()` in the component and the relevant policy in
`supabase/migrations/` — RBAC is enforced at the Postgres level via
`public.user_roles` / `get_my_role()`, not just in the UI.

**Auth / login issues:** login accepts a 10-digit mobile number or an email; mobile numbers
map to `{mobile}@lilac.com` in Supabase Auth. Check the Supabase dashboard → Authentication →
Users to confirm the account exists and isn't banned/unconfirmed.

**Where to look for logs:**
- Frontend runtime errors → browser DevTools console (it's a client-side SPA; most bugs surface here first)
- Deploy/build errors → Vercel dashboard → Deployments → pick a deployment → Build/Function logs, or `vercel logs` if the CLI is linked
- Database/API errors → Supabase dashboard → Logs & Reports (Postgres logs, API logs, Auth logs)
- Who-changed-what in the data → `/activity` page in the app (backed by `audit_log`, populated by Postgres triggers)

---

## Deployment

Push to `main` → Vercel auto-deploys (native GitHub integration, not the `.github/workflows/deploy.yml`
file, which is currently vestigial/unused — no matching repo secrets are configured).

Set these environment variables in the Vercel dashboard:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

The service role key is only needed for the Edge Functions (`create-user`, `delete-user`) —
set `SUPABASE_SERVICE_ROLE_KEY` in Vercel's Edge Function environment settings, and deploy
those functions separately via the Supabase CLI (see [Supabase CLI](#supabase-cli)) — Vercel
does not deploy them.

To deploy manually (e.g. to check a build before merging, or if auto-deploy is misbehaving):
```bash
npm i -g vercel   # one-time
vercel link       # one-time, links this folder to the Vercel project
vercel            # preview deploy
vercel --prod     # production deploy
```
