# Lilac Apartments — Setup Guide

## What you need (all free)
- GitHub account ✓
- Supabase project ✓ (aulttcsvxzcwyceezzpz)
- Vercel account ✓
- GitHub Codespace ✓

---

## Step 1 — Create GitHub repo and push code

In your Codespace terminal:

```bash
# Clone or init repo
git init
git add .
git commit -m "feat: initial Lilac Apartments app"

# Create repo on GitHub (do this on github.com first, then:)
git remote add origin https://github.com/YOUR_USERNAME/lilac-apartments.git
git branch -M main
git push -u origin main
```

---

## Step 2 — Run the Supabase schema

1. Go to https://supabase.com/dashboard/project/aulttcsvxzcwyceezzpz
2. Click **SQL Editor** → **New Query**
3. Paste the entire contents of `supabase/migrations/001_initial_schema.sql`
4. Click **Run**

You should see: "44 rows inserted" for the flats table.

---

## Step 3 — Enable Supabase Auth (magic link)

1. Supabase dashboard → **Authentication** → **Providers**
2. Make sure **Email** is enabled
3. Under **Email Templates**, you can customise the magic link email
4. Go to **Authentication** → **URL Configuration**
5. Add your Vercel URL to **Site URL** (after deploy, e.g. `https://lilac-apartments.vercel.app`)
6. Also add it to **Redirect URLs**

---

## Step 4 — Connect Vercel

1. Go to https://vercel.com → **Add New Project** → Import from GitHub
2. Select your `lilac-apartments` repo
3. Framework: **Vite**
4. Add environment variables:
   - `VITE_SUPABASE_URL` = `https://aulttcsvxzcwyceezzpz.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = `sb_publishable_zPwcS21TWUSR8zeSnhB4FA_2gPhdxD7`
5. Click **Deploy**

---

## Step 5 — Add GitHub Secrets for CI/CD

Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Add these:
| Secret | Value |
|--------|-------|
| `VITE_SUPABASE_URL` | `https://aulttcsvxzcwyceezzpz.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `sb_publishable_zPwcS21TWUSR8zeSnhB4FA_2gPhdxD7` |
| `VERCEL_TOKEN` | Get from Vercel → Settings → Tokens |
| `VERCEL_ORG_ID` | Get from Vercel → Settings → General |
| `VERCEL_PROJECT_ID` | Get from your Vercel project → Settings |

---

## Step 6 — Install and run locally in Codespace

```bash
npm install
npm run dev
```

Open the forwarded port (Codespace will show a popup) → your app is running!

---

## Step 7 — Sign in

1. Open the app URL
2. Enter your email → click "Send magic link"
3. Check your email → click the link
4. You're in!

---

## Step 8 — Migrate historical data from Google Sheets

Run this in the Codespace terminal after the app is working:

```bash
# We'll build a migration script next
# It reads your existing Google Sheet export and bulk-inserts into Supabase
node scripts/migrate-history.js
```

---

## Monthly workflow (after setup)

1. Open bank app on phone → export pipe-delimited .txt
2. Open Lilac app on phone → tap **Upload** → select the file
3. App auto-tags transactions → shows result
4. Check **Review** tab — fix any untagged items
5. View **Dashboard** and **Report** → tap **Share** to send to residents

---

## Folder structure

```
lilac-apartments/
├── src/
│   ├── lib/
│   │   ├── supabase.ts     # Supabase client + types
│   │   └── tagger.ts       # Auto-tagger + parser
│   ├── pages/
│   │   ├── LoginPage.tsx
│   │   ├── DashboardPage.tsx
│   │   ├── UploadPage.tsx
│   │   ├── ReviewPage.tsx
│   │   ├── DuesPage.tsx
│   │   ├── CorpusPage.tsx
│   │   └── ReportPage.tsx
│   ├── components/
│   │   └── layout/Layout.tsx
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql
├── .github/workflows/deploy.yml
├── .env.local              # NOT committed to git
└── SETUP.md
```
