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
npx tsc --noEmit     # TypeScript check (run before committing)
```

The two scripts point to different Supabase projects via Vite's `--mode` flag:
- `npm run dev` loads `.env.dev.local` (dev/staging project)
- `npm run dev:prod` loads `.env.local` (production project)

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

All migrations live in `supabase/migrations/` and are applied in numeric order (001–014).
All are applied to production. To apply to a new project, run each file against the Supabase Management API or the SQL editor.

After applying migration 013, seed at least one admin user before any writes:

```sql
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin' FROM auth.users WHERE email = 'your@email.com'
ON CONFLICT (user_id) DO UPDATE SET role = 'admin';
```

---

## Bank Statement Import

The Upload tab on the Transactions page accepts:
- **ICICI PSV** — pipe-delimited `.txt` or `.psv` (native ICICI net banking export)
- **Any bank CSV** — comma or semicolon delimited with Date, Description, Debit/Credit columns

Format is auto-detected. Duplicate transactions (matched by `txn_id`) are skipped automatically.

---

## E2E Tests

```bash
# Auth setup (run once — saves session to e2e/.auth/user.json)
npx playwright test --project=setup

# Run all tests
npx playwright test --project="Desktop Chrome"
npx playwright test --project="Mobile Chrome"
```

43 tests covering all pages, dialogs, mobile layout, and RBAC flows.

---

## Deployment

Push to `main` → Vercel auto-deploys.

Set these environment variables in the Vercel dashboard:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

The service role key is only needed for the Edge Function (`create-user`) — set `SUPABASE_SERVICE_ROLE_KEY` in Vercel's Edge Function environment settings.
