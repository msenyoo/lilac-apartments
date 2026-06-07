# Arrears Tracking + My Flat for All Users — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add maintenance/corpus arrears tracking with FY-rollover and plan-closure workflows, and make the owner portal accessible to any user with a flat assigned.

**Architecture:** Four DB migrations add the `flat_arrears` table, `transactions.plan_id`, and rewrite both tracker views. `useRole` is extended to expose `flatId`/`hasFlatAssigned` from profiles. `OwnerPortalPage` is updated to filter by `flatId` explicitly (works for owners and non-owners alike) and render arrears. A new `/my-flat` route wraps the same page for non-owner users.

**Tech Stack:** Supabase (Postgres, RLS, RPCs), React 18, TypeScript, TanStack Query, Tailwind CSS, Shadcn/ui dialogs, AG Grid Community.

**Spec:** `docs/superpowers/specs/2026-06-07-arrears-and-my-flat-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `supabase/migrations/022_flat_arrears.sql` | flat_arrears table + RLS + advance_fiscal_year() + close_corpus_plan() RPCs |
| Create | `supabase/migrations/023_transactions_plan_id.sql` | Add nullable plan_id FK to transactions |
| Create | `supabase/migrations/024_dues_tracker_arrears.sql` | Rewrite v_dues_tracker with arrears_maintenance + total_outstanding |
| Create | `supabase/migrations/025_corpus_tracker_plan_id.sql` | Rewrite v_corpus_tracker FILTER to use plan_id when set |
| Modify | `src/lib/supabase.ts` | Add FlatArrears interface; update DuesEntry, Transaction types |
| Modify | `src/hooks/useRole.ts` | Fetch flat_id from profiles; expose flatId + hasFlatAssigned |
| Modify | `src/contexts/RoleContext.tsx` | Add flatId + hasFlatAssigned to context value/interface |
| Modify | `src/pages/OwnerPortalPage.tsx` | Explicit flatId filtering; corpus → array; arrears cards; DuesRow adds arrears fields |
| Create | `src/pages/MyFlatPage.tsx` | Non-owner entry point; guards with hasFlatAssigned; renders OwnerPortalPage |
| Modify | `src/App.tsx` | Add /my-flat route |
| Modify | `src/components/layout/Layout.tsx` | Conditional "My Flat" nav for non-owner users with flat |
| Modify | `src/pages/ProfilePage.tsx` | Remove isOwner guard from flat query |
| Modify | `src/pages/UsersPage.tsx` | Add flat assignment in user edit dialog |
| Modify | `src/pages/DuesPage.tsx` | Arrears column in grid; manual add/edit/delete arrears dialog |
| Modify | `src/pages/SettingsPage.tsx` | Advance FY section in GeneralSettings |
| Modify | `src/pages/CorpusPage.tsx` | Call close_corpus_plan RPC; show affected-flats preview modal |
| Modify | `src/pages/TransactionsPage.tsx` | Plan selector when tagging corpus CR with multiple active plans |

---

## Task 1: Migration 022 — flat_arrears table + RPC functions

**Files:**
- Create: `supabase/migrations/022_flat_arrears.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 022: flat_arrears table + FY rollover + corpus closure RPCs

CREATE TABLE public.flat_arrears (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flat_id      uuid NOT NULL REFERENCES public.flats(id) ON DELETE CASCADE,
  arrears_type text NOT NULL CHECK (arrears_type IN ('maintenance', 'corpus')),
  source_label text NOT NULL,
  amount       integer NOT NULL CHECK (amount > 0),
  notes        text,
  created_at   timestamptz DEFAULT now(),
  created_by   uuid NOT NULL REFERENCES auth.users(id),
  UNIQUE (flat_id, arrears_type, source_label)
);

CREATE INDEX idx_flat_arrears_flat_id ON public.flat_arrears (flat_id);

ALTER TABLE public.flat_arrears ENABLE ROW LEVEL SECURITY;

CREATE POLICY "flat_arrears_read" ON public.flat_arrears
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'committee', 'auditor')
    OR flat_id = public.get_my_flat_id()
  );

CREATE POLICY "flat_arrears_admin_write" ON public.flat_arrears
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- RPC: advance_fiscal_year
-- Snapshots pending maintenance balances as arrears, then bumps dues_start_fiscal_year.
CREATE OR REPLACE FUNCTION public.advance_fiscal_year()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  old_fy integer;
  new_fy integer;
  n      integer;
BEGIN
  SELECT value::integer INTO old_fy
    FROM app_settings WHERE key = 'dues_start_fiscal_year';
  new_fy := old_fy + 1;

  INSERT INTO flat_arrears (flat_id, arrears_type, source_label, amount, created_by)
  SELECT
    f.id,
    'maintenance',
    'FY ' || old_fy || '-' || RIGHT((old_fy + 1)::text, 2),
    vdt.pending::integer,
    auth.uid()
  FROM v_dues_tracker vdt
  JOIN flats f ON f.code = vdt.flat_code
  WHERE vdt.pending > 0
  ON CONFLICT (flat_id, arrears_type, source_label) DO NOTHING;

  GET DIAGNOSTICS n = ROW_COUNT;

  UPDATE app_settings SET value = new_fy::text
    WHERE key = 'dues_start_fiscal_year';

  RETURN json_build_object('new_fy', new_fy, 'arrears_created', n);
END;
$$;

-- RPC: close_corpus_plan
-- Snapshots unpaid corpus balances as arrears, then marks the plan Completed.
CREATE OR REPLACE FUNCTION public.close_corpus_plan(p_plan_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  plan_name_val text;
  n             integer;
BEGIN
  SELECT name INTO plan_name_val FROM corpus_plans WHERE id = p_plan_id;

  INSERT INTO flat_arrears (flat_id, arrears_type, source_label, amount, created_by)
  SELECT
    f.id,
    'corpus',
    plan_name_val,
    vct.balance::integer,
    auth.uid()
  FROM v_corpus_tracker vct
  JOIN flats f ON f.code = vct.flat_code
  WHERE vct.plan_id = p_plan_id AND vct.balance > 0
  ON CONFLICT (flat_id, arrears_type, source_label) DO NOTHING;

  GET DIAGNOSTICS n = ROW_COUNT;

  UPDATE corpus_plans
    SET status = 'completed', closed_at = now()
    WHERE id = p_plan_id;

  RETURN json_build_object('arrears_created', n);
END;
$$;
```

- [ ] **Step 2: Apply via Supabase Dashboard SQL editor**

Open https://supabase.com/dashboard → project → SQL editor → paste and run the migration.
Expected: no errors; `flat_arrears` table visible in Table Editor.

- [ ] **Step 3: Verify**

Run in SQL editor:
```sql
SELECT * FROM flat_arrears LIMIT 1;
SELECT routine_name FROM information_schema.routines
  WHERE routine_name IN ('advance_fiscal_year', 'close_corpus_plan');
```
Expected: empty result for table (no rows yet); both routine names returned.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/022_flat_arrears.sql
git commit -m "feat(db): add flat_arrears table + advance_fiscal_year + close_corpus_plan RPCs"
```

---

## Task 2: Migration 023 — transactions.plan_id

**Files:**
- Create: `supabase/migrations/023_transactions_plan_id.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 023: Add nullable plan_id FK to transactions for corpus plan disambiguation

ALTER TABLE public.transactions
  ADD COLUMN plan_id uuid REFERENCES public.corpus_plans(id);
```

- [ ] **Step 2: Apply via Supabase SQL editor**

Expected: no errors; `transactions` table gains a `plan_id` column (nullable).

- [ ] **Step 3: Verify**

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'transactions' AND column_name = 'plan_id';
```
Expected: `plan_id | uuid | YES`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/023_transactions_plan_id.sql
git commit -m "feat(db): add plan_id to transactions for corpus plan disambiguation"
```

---

## Task 3: Migration 024 — v_dues_tracker with arrears columns

**Files:**
- Create: `supabase/migrations/024_dues_tracker_arrears.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 024: Rewrite v_dues_tracker to expose arrears_maintenance + total_outstanding

DROP VIEW IF EXISTS public.v_dues_tracker;
CREATE VIEW public.v_dues_tracker
  WITH (security_invoker = true)
AS
WITH settings AS (
  SELECT
    (SELECT value::integer FROM public.app_settings WHERE key = 'dues_start_fiscal_year') AS start_fy
),
tracking AS (
  SELECT
    s.start_fy,
    MAKE_DATE(s.start_fy, 4, 1)                                             AS track_start,
    DATE_TRUNC('month', CURRENT_DATE + INTERVAL '1 month')::date            AS track_end_excl
  FROM settings s
),
flat_rate_periods AS (
  SELECT
    mrh.flat_id,
    mrh.monthly_rate,
    GREATEST(
      DATE_TRUNC('month', mrh.effective_from)::date,
      t.track_start
    )                                                                        AS period_start,
    LEAST(
      DATE_TRUNC('month', COALESCE(mrh.effective_to, CURRENT_DATE) + INTERVAL '1 month')::date,
      t.track_end_excl
    )                                                                        AS period_end_excl
  FROM public.maintenance_rate_history mrh
  CROSS JOIN tracking t
  WHERE DATE_TRUNC('month', mrh.effective_from)::date < t.track_end_excl
    AND DATE_TRUNC('month', COALESCE(mrh.effective_to, CURRENT_DATE) + INTERVAL '1 month')::date > t.track_start
),
flat_dues AS (
  SELECT
    frp.flat_id,
    SUM(
      frp.monthly_rate * GREATEST(0,
        EXTRACT(YEAR  FROM AGE(frp.period_end_excl, frp.period_start))::integer * 12 +
        EXTRACT(MONTH FROM AGE(frp.period_end_excl, frp.period_start))::integer
      )
    )::integer AS annual_due
  FROM flat_rate_periods frp
  GROUP BY frp.flat_id
),
flat_arrears_agg AS (
  SELECT flat_id, COALESCE(SUM(amount), 0)::integer AS arrears_maintenance
  FROM public.flat_arrears
  WHERE arrears_type = 'maintenance'
  GROUP BY flat_id
)
SELECT
  f.code                                                                     AS flat_code,
  f.block,
  f.flat_type,
  f.bhk_type,
  f.maintenance_amt,
  CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE) >= 4
    THEN EXTRACT(YEAR FROM CURRENT_DATE)::integer
    ELSE EXTRACT(YEAR FROM CURRENT_DATE)::integer - 1
  END                                                                        AS fiscal_year,
  tr.start_fy                                                                AS start_fiscal_year,
  COALESCE(fd.annual_due, 0)                                                 AS annual_due,
  COALESCE(SUM(t.amount) FILTER (
    WHERE t.fiscal_year >= tr.start_fy
      AND t.cr_dr      = 'CR'
      AND t.category   = 'Maintenance'
      AND t.row_type  != 'VOIDED'
  ), 0)::integer                                                             AS collected_fy,
  COALESCE(fd.annual_due, 0) - COALESCE(SUM(t.amount) FILTER (
    WHERE t.fiscal_year >= tr.start_fy
      AND t.cr_dr      = 'CR'
      AND t.category   = 'Maintenance'
      AND t.row_type  != 'VOIDED'
  ), 0)                                                                      AS pending,
  COALESCE(faa.arrears_maintenance, 0)                                       AS arrears_maintenance,
  COALESCE(fd.annual_due, 0) - COALESCE(SUM(t.amount) FILTER (
    WHERE t.fiscal_year >= tr.start_fy
      AND t.cr_dr      = 'CR'
      AND t.category   = 'Maintenance'
      AND t.row_type  != 'VOIDED'
  ), 0) + COALESCE(faa.arrears_maintenance, 0)                              AS total_outstanding,
  CASE
    WHEN COALESCE(SUM(t.amount) FILTER (
      WHERE t.fiscal_year >= tr.start_fy AND t.cr_dr = 'CR'
        AND t.category = 'Maintenance'   AND t.row_type != 'VOIDED'
    ), 0) >= COALESCE(fd.annual_due, 0) THEN 'Clear'
    WHEN COALESCE(SUM(t.amount) FILTER (
      WHERE t.fiscal_year >= tr.start_fy AND t.cr_dr = 'CR'
        AND t.category = 'Maintenance'   AND t.row_type != 'VOIDED'
    ), 0) > 0 THEN 'Partial'
    ELSE 'Due'
  END                                                                        AS status
FROM public.flats f
CROSS JOIN tracking tr
LEFT JOIN flat_dues fd           ON fd.flat_id = f.id
LEFT JOIN flat_arrears_agg faa   ON faa.flat_id = f.id
LEFT JOIN public.transactions t  ON t.flat_code = f.code
GROUP BY
  f.id, f.code, f.block, f.flat_type, f.bhk_type, f.maintenance_amt,
  tr.start_fy, fd.annual_due, faa.arrears_maintenance
ORDER BY f.code;
```

- [ ] **Step 2: Apply and verify**

Apply via Supabase SQL editor. Then verify:
```sql
SELECT flat_code, pending, arrears_maintenance, total_outstanding
FROM v_dues_tracker LIMIT 5;
```
Expected: `arrears_maintenance = 0` for all rows (no arrears yet); `total_outstanding = pending`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/024_dues_tracker_arrears.sql
git commit -m "feat(db): add arrears_maintenance + total_outstanding to v_dues_tracker"
```

---

## Task 4: Migration 025 — v_corpus_tracker with plan_id filter

**Files:**
- Create: `supabase/migrations/025_corpus_tracker_plan_id.sql`

- [ ] **Step 1: Write the migration**

Check the current v_corpus_tracker definition by running in SQL editor:
```sql
SELECT pg_get_viewdef('public.v_corpus_tracker', true);
```
Copy the output, then write the migration that DROPs and recreates with the updated FILTER clause. The key change is the `WHERE` condition inside every `FILTER (WHERE ...)` block: replace `t.fiscal_year BETWEEN cp.start_fiscal_year AND cp.end_fiscal_year` with the plan_id-aware rule.

```sql
-- 025: Rewrite v_corpus_tracker to respect plan_id on transactions
-- When plan_id IS NOT NULL on a transaction, attribute only to the matching plan.
-- When plan_id IS NULL, fall back to FY-range scoping (existing behaviour).

DROP VIEW IF EXISTS public.v_corpus_tracker;
CREATE VIEW public.v_corpus_tracker
  WITH (security_invoker = true)
AS
SELECT
  f.code                                                  AS flat_code,
  f.block,
  f.flat_type,
  cp.id                                                   AS plan_id,
  cp.name                                                 AS plan_name,
  cp.status                                               AS plan_status,
  cp.start_fiscal_year,
  cp.end_fiscal_year,
  cpf.target_amount                                       AS corpus_target,
  cpf.pre_payment,
  cpf.carry_forward_amount,
  cpf.target_amount - cpf.pre_payment - cpf.carry_forward_amount AS effective_target,
  cpf.pre_payment + cpf.carry_forward_amount + COALESCE(SUM(t.amount) FILTER (
    WHERE t.corpus = 'YES' AND t.cr_dr = 'CR'
      AND t.row_type != 'VOIDED'
      AND (
        (t.plan_id = cp.id)
        OR (t.plan_id IS NULL
            AND t.fiscal_year BETWEEN cp.start_fiscal_year AND cp.end_fiscal_year)
      )
  ), 0)                                                   AS collected,
  cpf.target_amount - cpf.pre_payment - cpf.carry_forward_amount
    - COALESCE(SUM(t.amount) FILTER (
    WHERE t.corpus = 'YES' AND t.cr_dr = 'CR'
      AND t.row_type != 'VOIDED'
      AND (
        (t.plan_id = cp.id)
        OR (t.plan_id IS NULL
            AND t.fiscal_year BETWEEN cp.start_fiscal_year AND cp.end_fiscal_year)
      )
  ), 0)                                                   AS balance,
  ROUND((cpf.pre_payment + cpf.carry_forward_amount + COALESCE(SUM(t.amount) FILTER (
    WHERE t.corpus = 'YES' AND t.cr_dr = 'CR'
      AND t.row_type != 'VOIDED'
      AND (
        (t.plan_id = cp.id)
        OR (t.plan_id IS NULL
            AND t.fiscal_year BETWEEN cp.start_fiscal_year AND cp.end_fiscal_year)
      )
  ), 0)) * 100.0 / NULLIF(cpf.target_amount, 0), 1)      AS pct_paid,
  MAX(t.value_date) FILTER (
    WHERE t.corpus = 'YES' AND t.cr_dr = 'CR'
      AND t.row_type != 'VOIDED'
      AND (
        (t.plan_id = cp.id)
        OR (t.plan_id IS NULL
            AND t.fiscal_year BETWEEN cp.start_fiscal_year AND cp.end_fiscal_year)
      )
  )                                                       AS last_payment_date,
  CASE
    WHEN cpf.pre_payment + cpf.carry_forward_amount + COALESCE(SUM(t.amount) FILTER (
      WHERE t.corpus = 'YES' AND t.cr_dr = 'CR'
        AND t.row_type != 'VOIDED'
        AND (
          (t.plan_id = cp.id)
          OR (t.plan_id IS NULL
              AND t.fiscal_year BETWEEN cp.start_fiscal_year AND cp.end_fiscal_year)
        )
    ), 0) >= cpf.target_amount THEN 'Done'
    WHEN cpf.pre_payment + cpf.carry_forward_amount + COALESCE(SUM(t.amount) FILTER (
      WHERE t.corpus = 'YES' AND t.cr_dr = 'CR'
        AND t.row_type != 'VOIDED'
        AND (
          (t.plan_id = cp.id)
          OR (t.plan_id IS NULL
              AND t.fiscal_year BETWEEN cp.start_fiscal_year AND cp.end_fiscal_year)
        )
    ), 0) > 0 THEN 'Partial'
    ELSE 'Pending'
  END                                                     AS status
FROM public.corpus_plans cp
JOIN public.corpus_plan_flats cpf ON cpf.plan_id = cp.id
JOIN public.flats f               ON f.id = cpf.flat_id
LEFT JOIN public.transactions t   ON t.flat_code = f.code
WHERE cp.status IN ('active', 'draft')
GROUP BY
  f.code, f.block, f.flat_type,
  cp.id, cp.name, cp.status, cp.start_fiscal_year, cp.end_fiscal_year,
  cpf.target_amount, cpf.pre_payment, cpf.carry_forward_amount
ORDER BY f.code;
```

Note: if the current view does not have `carry_forward_amount` (check from step 1 output), replace `cpf.carry_forward_amount` with `0` everywhere above.

- [ ] **Step 2: Apply and verify**

```sql
SELECT flat_code, plan_id, plan_name, collected, balance FROM v_corpus_tracker LIMIT 5;
```
Expected: same rows as before (plan_id IS NULL on all existing transactions, so FY-range scoping applies unchanged).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/025_corpus_tracker_plan_id.sql
git commit -m "feat(db): v_corpus_tracker respects plan_id on transactions for disambiguation"
```

---

## Task 5: TypeScript types

**Files:**
- Modify: `src/lib/supabase.ts`

- [ ] **Step 1: Add FlatArrears interface after the Profile interface (~line 152)**

```typescript
export interface FlatArrears {
  id: string
  flat_id: string
  arrears_type: 'maintenance' | 'corpus'
  source_label: string
  amount: number
  notes: string | null
  created_at: string
  created_by: string
}
```

- [ ] **Step 2: Update DuesEntry interface — add arrears fields**

Find the `DuesEntry` interface and add two fields after `status`:

```typescript
export interface DuesEntry {
  flat_code: string
  block: string
  flat_type: string
  bhk_type: string | null
  maintenance_amt: number
  fiscal_year: number
  start_fiscal_year: number
  collected_fy: number
  annual_due: number
  pending: number
  arrears_maintenance: number   // ← add
  total_outstanding: number      // ← add
  status: 'Clear' | 'Partial' | 'Due'
}
```

- [ ] **Step 3: Update Transaction interface — add plan_id**

```typescript
export interface Transaction {
  // ... existing fields ...
  plan_id: string | null   // ← add after corpus field
  // ... rest unchanged ...
}
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```
Expected: 0 errors (new fields are additive; existing code ignores unknown fields).

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase.ts
git commit -m "feat(types): add FlatArrears; update DuesEntry and Transaction types"
```

---

## Task 6: useRole + RoleContext — expose flatId

**Files:**
- Modify: `src/hooks/useRole.ts`
- Modify: `src/contexts/RoleContext.tsx`

- [ ] **Step 1: Update useRole.ts**

Replace the entire file:

```typescript
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export type AppRole = 'admin' | 'committee' | 'auditor' | 'owner'

export function useRole() {
  const [role, setRole]     = useState<AppRole | null>(null)
  const [flatId, setFlatId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setRole(null); setFlatId(null); setLoading(false); return }
      const [roleRes, profileRes] = await Promise.all([
        supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle(),
        supabase.from('profiles').select('flat_id').eq('id', user.id).maybeSingle(),
      ])
      setRole((roleRes.data?.role as AppRole) ?? null)
      setFlatId(profileRes.data?.flat_id ?? null)
      setLoading(false)
    })
  }, [])

  return {
    role,
    flatId,
    loading,
    isAdmin:         role === 'admin',
    isCommittee:     role === 'committee',
    isAuditor:       role === 'auditor',
    isOwner:         role === 'owner',
    canWrite:        role === 'admin',
    canApprove:      role === 'admin' || role === 'committee',
    hasFlatAssigned: flatId !== null,
  }
}
```

- [ ] **Step 2: Update RoleContext.tsx**

Replace the entire file:

```typescript
import { createContext, useContext, ReactNode } from 'react'
import { useRole, AppRole } from '@/hooks/useRole'

interface RoleContextValue {
  role: AppRole | null
  flatId: string | null
  hasFlatAssigned: boolean
  loading: boolean
  isAdmin: boolean
  isOwner: boolean
  canWrite: boolean
  canApprove: boolean
}

const RoleContext = createContext<RoleContextValue>({
  role: null, flatId: null, hasFlatAssigned: false,
  loading: true, isAdmin: false, isOwner: false, canWrite: false, canApprove: false,
})

export function RoleProvider({ children }: { children: ReactNode }) {
  const value = useRole()
  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>
}

export const useRoleCtx = () => useContext(RoleContext)
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useRole.ts src/contexts/RoleContext.tsx
git commit -m "feat(auth): expose flatId and hasFlatAssigned in RoleContext"
```

---

## Task 7: OwnerPortalPage — explicit flat filtering + arrears cards + corpus array

**Files:**
- Modify: `src/pages/OwnerPortalPage.tsx`

- [ ] **Step 1: Update interfaces at the top of the file**

Add `arrears_maintenance` and `total_outstanding` to `DuesRow`, and update `CorpusRow` to include `plan_id` and `plan_name`:

```typescript
interface DuesRow {
  flat_code: string
  maintenance_amt: number
  annual_due: number
  collected_fy: number
  pending: number
  arrears_maintenance: number
  total_outstanding: number
  status: string
  start_fiscal_year: number
}
interface CorpusRow {
  plan_id: string
  plan_name: string
  flat_code: string
  corpus_target: number
  collected: number
  balance: number
  pct_paid: number
  status: string
}
interface ArrearRow { id: string; arrears_type: string; source_label: string; amount: number }
```

- [ ] **Step 2: Update the component to use flatId from context**

At the top of `OwnerPortalPage()`, add:

```typescript
const { flatId } = useRoleCtx()
```

- [ ] **Step 3: Update the flats query to filter by flatId**

```typescript
const { data: myFlat } = useQuery<FlatRow | null>({
  queryKey: ['owner-flat', flatId],
  enabled: !!flatId,
  queryFn: async () => {
    const { data } = await supabase
      .from('flats')
      .select('id,code,block,flat_type,bhk_type,maintenance_amt,corpus_target')
      .eq('id', flatId!)
      .single()
    return data as FlatRow | null
  },
})
```

- [ ] **Step 4: Update dues query to filter by flat_code**

```typescript
const { data: dues } = useQuery<DuesRow | null>({
  queryKey: ['owner-dues', myFlat?.code],
  enabled: !!myFlat?.code,
  queryFn: async () => {
    const { data } = await supabase
      .from('v_dues_tracker')
      .select('*')
      .eq('flat_code', myFlat!.code)
      .maybeSingle()
    return data as DuesRow | null
  },
})
```

- [ ] **Step 5: Update corpus query to return array filtered by flat_code**

```typescript
const { data: corpusList = [] } = useQuery<CorpusRow[]>({
  queryKey: ['owner-corpus', myFlat?.code],
  enabled: !!myFlat?.code,
  queryFn: async () => {
    const { data } = await supabase
      .from('v_corpus_tracker')
      .select('plan_id,plan_name,flat_code,corpus_target,collected,balance,pct_paid,status')
      .eq('flat_code', myFlat!.code)
    return (data ?? []) as CorpusRow[]
  },
})
```

- [ ] **Step 6: Add corpus arrears query**

```typescript
const { data: corpusArrears = [] } = useQuery<ArrearRow[]>({
  queryKey: ['owner-corpus-arrears', flatId],
  enabled: !!flatId,
  queryFn: async () => {
    const { data } = await supabase
      .from('flat_arrears')
      .select('id,arrears_type,source_label,amount')
      .eq('flat_id', flatId!)
      .eq('arrears_type', 'corpus')
    return (data ?? []) as ArrearRow[]
  },
})
```

- [ ] **Step 7: Update payments query to filter by flat_code**

```typescript
const { data: payments = [] } = useQuery<TxnRow[]>({
  queryKey: ['owner-payments', myFlat?.code],
  enabled: !!myFlat?.code,
  queryFn: async () => {
    const { data } = await supabase
      .from('transactions')
      .select('id,value_date,description,amount,category,fiscal_label,corpus')
      .eq('flat_code', myFlat!.code)
      .eq('cr_dr', 'CR')
      .neq('row_type', 'VOIDED')
      .order('value_date', { ascending: false })
      .limit(50)
    return (data ?? []) as TxnRow[]
  },
})
```

- [ ] **Step 8: Update the dues card to show arrears**

In the JSX, after the existing pending section inside the dues card, add:

```tsx
{(dues?.arrears_maintenance ?? 0) > 0 && (
  <div className="flex flex-col gap-1.5 pt-1 border-t" style={{ borderColor: 'var(--ink-100)' }}>
    <div className="flex justify-between text-[13px]">
      <span style={{ color: 'var(--ink-500)' }}>Previous arrears</span>
      <span className="font-semibold" style={{ color: 'var(--bad)' }}>
        {formatINR(dues!.arrears_maintenance)}
      </span>
    </div>
    <div className="flex justify-between text-[13px]">
      <span className="font-semibold">Total outstanding</span>
      <span className="font-bold" style={{ color: 'var(--bad)' }}>
        {formatINR(dues!.total_outstanding)}
      </span>
    </div>
  </div>
)}
```

- [ ] **Step 9: Replace single corpus card with mapped array + corpus arrears card**

Replace the existing corpus card JSX with:

```tsx
{/* Corpus cards — one per active plan */}
{corpusList.map(corpus => (
  <div key={corpus.plan_id} className="surface !p-5 flex flex-col gap-3">
    <p className="font-semibold text-[14px]">
      Corpus — {corpus.plan_name}
    </p>
    <div className="flex flex-col gap-2">
      <div className="flex items-end justify-between">
        <span className="text-[22px] font-extrabold" style={{ color: 'var(--brand-700)' }}>
          {formatINR(corpus.collected)}
        </span>
        <span className="text-[12px]" style={{ color: 'var(--ink-400)' }}>
          of {formatINR(corpus.corpus_target)}
        </span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--ink-100)' }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(corpus.pct_paid ?? 0, 100)}%`, background: 'var(--brand-500)' }}
        />
      </div>
      <p className="text-[11.5px]" style={{ color: 'var(--ink-400)' }}>
        {corpus.pct_paid?.toFixed(0) ?? 0}% complete · {corpus.status}
      </p>
    </div>
  </div>
))}

{/* Previous corpus arrears from closed plans */}
{corpusArrears.map(row => (
  <div key={row.id} className="surface !p-5 flex flex-col gap-3">
    <div className="flex items-center justify-between">
      <p className="font-semibold text-[14px]">Corpus — {row.source_label}</p>
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold"
        style={{ background: 'var(--bad-bg)', color: 'var(--bad)' }}>
        <AlertCircle size={13} /> Pending
      </span>
    </div>
    <p className="text-[13px]" style={{ color: 'var(--bad)' }}>
      {formatINR(row.amount)} outstanding — contact admin to resolve
    </p>
  </div>
))}

{corpusList.length === 0 && corpusArrears.length === 0 && (
  <div className="surface !p-5">
    <p className="text-[13px]" style={{ color: 'var(--ink-400)' }}>No corpus plan active</p>
  </div>
)}
```

The corpus section was previously inside the 2-column grid. Move corpus card(s) outside and below the grid since there may now be multiple. Keep only the dues card inside the grid.

- [ ] **Step 10: Import useRoleCtx**

Add to imports at top:
```typescript
import { useRoleCtx } from '@/contexts/RoleContext'
```

- [ ] **Step 11: Type-check and verify in browser**

```bash
npx tsc --noEmit
npm run dev
```
Log in as owner and verify: flat identity shows, dues shows, corpus shows (one card per active plan), payment history shows. No console errors.

- [ ] **Step 12: Commit**

```bash
git add src/pages/OwnerPortalPage.tsx
git commit -m "feat(owner-portal): explicit flat filtering, corpus array, arrears display"
```

---

## Task 8: MyFlatPage + App route + Layout nav

**Files:**
- Create: `src/pages/MyFlatPage.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/layout/Layout.tsx`

- [ ] **Step 1: Create MyFlatPage.tsx**

```typescript
import { Navigate } from 'react-router-dom'
import { useRoleCtx } from '@/contexts/RoleContext'
import OwnerPortalPage from './OwnerPortalPage'

export default function MyFlatPage() {
  const { hasFlatAssigned, loading } = useRoleCtx()
  if (loading) return null
  if (!hasFlatAssigned) return <Navigate to="/dashboard" replace />
  return <OwnerPortalPage />
}
```

- [ ] **Step 2: Add /my-flat route to App.tsx**

Import MyFlatPage:
```typescript
import MyFlatPage from '@/pages/MyFlatPage'
```

Add route after the `profile` route:
```tsx
<Route path="my-flat" element={<MyFlatPage />} />
```

- [ ] **Step 3: Add conditional "My Flat" nav in Layout.tsx**

In Layout.tsx, import `hasFlatAssigned` from `useRoleCtx`:
```typescript
const { role, isOwner, loading: roleLoading, hasFlatAssigned } = useRoleCtx()
```

In the regular `NAV` array, add a "My Flat" entry only for non-owner users who have a flat. Do this by filtering in `visibleNav`:

```typescript
const visibleNav = roleLoading
  ? []
  : isOwner
    ? OWNER_NAV
    : [
        ...NAV.filter(n => !n.adminOnly || role === 'admin'),
        ...(hasFlatAssigned ? [{ to: '/my-flat', icon: Home, label: 'My Flat' }] : []),
      ]
```

Also add `/my-flat` to `OWNER_BLOCKED` so owners are not redirected away from it:
```typescript
// Remove /my-flat from OWNER_BLOCKED — owners are allowed there
const OWNER_BLOCKED = ['/transactions', '/dues', '/corpus', '/expenses', '/flats', '/reports', '/activity', '/users']
```
`/my-flat` is intentionally absent from this list.

- [ ] **Step 4: Type-check and verify in browser**

```bash
npx tsc --noEmit
npm run dev
```
Log in as admin with a flat assigned → "My Flat" appears in sidebar → clicking shows the owner portal with correct flat data. Log in as admin without flat assigned → no "My Flat" in sidebar.

- [ ] **Step 5: Commit**

```bash
git add src/pages/MyFlatPage.tsx src/App.tsx src/components/layout/Layout.tsx
git commit -m "feat: add /my-flat page and nav for non-owner users with a flat assigned"
```

---

## Task 9: ProfilePage — show flat for any user with flat assigned

**Files:**
- Modify: `src/pages/ProfilePage.tsx`

- [ ] **Step 1: Remove isOwner guard from flat query**

Find the `myFlat` query (around line 33) and change `enabled: isOwner` to `enabled: !!userId`:

```typescript
const { data: myFlat } = useQuery({
  queryKey: ['owner-flat-profile', userId],
  enabled: !!userId,
  queryFn: async () => {
    const { data } = await supabase.from('flats').select('code, block').single()
    return data as { code: string; block: string } | null
  },
})
```

Note: this still uses `.single()` which relies on RLS. For owners it returns their one flat. For admin/committee/auditor it returns all flats — `.single()` will fail. Fix by filtering explicitly:

```typescript
const { flatId } = useRoleCtx()

const { data: myFlat } = useQuery({
  queryKey: ['owner-flat-profile', userId, flatId],
  enabled: !!userId && !!flatId,
  queryFn: async () => {
    const { data } = await supabase
      .from('flats')
      .select('code, block')
      .eq('id', flatId!)
      .maybeSingle()
    return data as { code: string; block: string } | null
  },
})
```

Add `import { useRoleCtx } from '@/contexts/RoleContext'` if not already present (it already is on line 9).

- [ ] **Step 2: Type-check and verify**

```bash
npx tsc --noEmit
npm run dev
```
Log in as admin with flat assigned → Profile page shows read-only "My flat" field.
Log in as admin without flat → "My flat" field absent.

- [ ] **Step 3: Commit**

```bash
git add src/pages/ProfilePage.tsx
git commit -m "feat(profile): show My Flat field for any user with flat assigned"
```

---

## Task 10: UsersPage — flat assignment UI

**Files:**
- Modify: `src/pages/UsersPage.tsx`

- [ ] **Step 1: Add flat list query**

Inside the `UsersPage` component (or in the user edit dialog component), add:

```typescript
const { data: flats = [] } = useQuery({
  queryKey: ['all-flats-for-assign'],
  queryFn: async () => {
    const { data } = await supabase
      .from('flats')
      .select('id, code, block')
      .order('code')
    return (data ?? []) as { id: string; code: string; block: string }[]
  },
})
```

- [ ] **Step 2: Add assignedFlatId state to the edit dialog**

Find the user edit dialog state/component. Add:

```typescript
const [assignedFlatId, setAssignedFlatId] = useState<string>('')
```

When the dialog opens for a user, populate from `profiles.flat_id`. Fetch it:

```typescript
// Inside the handler that opens the edit dialog:
const { data: prof } = await supabase
  .from('profiles')
  .select('flat_id')
  .eq('id', user.user_id)
  .maybeSingle()
setAssignedFlatId(prof?.flat_id ?? '')
```

- [ ] **Step 3: Add flat selector to the edit dialog JSX**

Inside the edit dialog form, add below the role selector:

```tsx
<div className="flex flex-col gap-1">
  <Label>Assigned flat</Label>
  <Select value={assignedFlatId} onValueChange={setAssignedFlatId}>
    <SelectTrigger>
      <SelectValue placeholder="None" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="">None</SelectItem>
      {flats.map(f => (
        <SelectItem key={f.id} value={f.id}>
          {f.code} · Block {f.block}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>
```

- [ ] **Step 4: Save flat assignment on dialog submit**

In the save handler, after updating the role, upsert the profile flat_id:

```typescript
await supabase
  .from('profiles')
  .upsert({
    id: editingUser.user_id,
    flat_id: assignedFlatId || null,
  })
```

- [ ] **Step 5: Show assigned flat in the user list**

In the user table/card, add a flat badge. Where user role badge is rendered, add alongside:

```tsx
{user.flat_code && (
  <span className="ds-badge ds-badge-neutral">{user.flat_code}</span>
)}
```

To get `flat_code`, join profiles in the user list query:

```typescript
// Extend existing v_users or profiles query to include flat info
const { data } = await supabase
  .from('v_users')   // or whichever view/table the page uses
  .select('*, profiles(flat_id, flats(code))')
```

If `v_users` doesn't support this join, use a separate query per user or fetch a flat lookup map:

```typescript
const { data: flatMap } = useQuery({
  queryKey: ['flat-assignments'],
  queryFn: async () => {
    const { data } = await supabase
      .from('profiles')
      .select('id, flat_id, flats(code)')
    return Object.fromEntries((data ?? []).map((p: any) => [p.id, p.flats?.code ?? null]))
  },
})
// Usage: flatMap[user.user_id] → flat code or null
```

- [ ] **Step 6: Type-check and verify**

```bash
npx tsc --noEmit
npm run dev
```
Open Settings → Users as admin. Edit a user → flat selector appears. Assign a flat → save. Log in as that user → "My Flat" appears in nav.

- [ ] **Step 7: Commit**

```bash
git add src/pages/UsersPage.tsx
git commit -m "feat(users): add flat assignment UI in user edit dialog"
```

---

## Task 11: DuesPage — arrears column + manual entry dialog

**Files:**
- Modify: `src/pages/DuesPage.tsx`

- [ ] **Step 1: Add arrears_maintenance and total_outstanding columns to the AG Grid colDefs**

Find the `colDefs` array. Add after the `pending` column:

```typescript
{
  headerName: 'Arrears',
  field: 'arrears_maintenance',
  width: 110,
  cellRenderer: ({ value }: any) =>
    value > 0
      ? `<span style="color:var(--bad);font-weight:600">${formatINR(value)}</span>`
      : '<span style="color:var(--ink-300)">—</span>',
},
{
  headerName: 'Total Outstanding',
  field: 'total_outstanding',
  width: 140,
  cellRenderer: ({ value }: any) =>
    value > 0
      ? `<span style="font-weight:700;color:var(--bad)">${formatINR(value)}</span>`
      : '<span style="color:var(--ok)">Clear</span>',
},
```

- [ ] **Step 2: Add an "Arrears" action to the flat detail panel (or row action)**

The page already has a `selectedFlat` detail panel. Add an arrears section inside it:

```tsx
{/* Inside the flat detail panel, after the pending section */}
<ArrearsMgmt flatCode={selectedFlat.flat_code} />
```

- [ ] **Step 3: Create the ArrearsMgmt component at the bottom of DuesPage.tsx**

```tsx
function ArrearsMgmt({ flatCode }: { flatCode: string }) {
  const qc = useQueryClient()
  const { isAdmin } = useRoleCtx()
  const [showAdd, setShowAdd] = useState(false)
  const [editRow, setEditRow] = useState<any>(null)

  // Fetch flat_id for this flat_code
  const { data: flatIdData } = useQuery({
    queryKey: ['flat-id-for-code', flatCode],
    queryFn: async () => {
      const { data } = await supabase
        .from('flats').select('id').eq('code', flatCode).single()
      return data?.id as string | null
    },
  })

  const { data: arrears = [] } = useQuery({
    queryKey: ['arrears-for-flat', flatCode],
    queryFn: async () => {
      const { data } = await supabase
        .from('flat_arrears')
        .select('*')
        .eq('flat_id', flatIdData!)
        .eq('arrears_type', 'maintenance')
        .order('created_at')
      return data ?? []
    },
    enabled: !!flatIdData,
  })

  async function handleDelete(id: string) {
    await supabase.from('flat_arrears').delete().eq('id', id)
    qc.invalidateQueries({ queryKey: ['arrears-for-flat', flatCode] })
    qc.invalidateQueries({ queryKey: ['dues'] })
  }

  return (
    <div className="flex flex-col gap-2 pt-3">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-400)' }}>
          Maintenance Arrears
        </p>
        {isAdmin && (
          <Button size="sm" variant="outline" onClick={() => setShowAdd(true)}>
            + Add
          </Button>
        )}
      </div>
      {arrears.length === 0 && (
        <p className="text-[12px]" style={{ color: 'var(--ink-400)' }}>None</p>
      )}
      {arrears.map((row: any) => (
        <div key={row.id} className="flex items-center justify-between text-[12.5px]">
          <span>{row.source_label}</span>
          <div className="flex items-center gap-2">
            <span className="font-semibold" style={{ color: 'var(--bad)' }}>{formatINR(row.amount)}</span>
            {isAdmin && (
              <>
                <button onClick={() => setEditRow(row)} className="text-[var(--ink-400)] hover:text-[var(--ink-700)]">
                  <Pencil size={13} />
                </button>
                <button onClick={() => handleDelete(row.id)} className="text-[var(--bad)] hover:opacity-70">
                  <Trash2 size={13} />
                </button>
              </>
            )}
          </div>
        </div>
      ))}
      {(showAdd || editRow) && flatIdData && (
        <ArrearsDialog
          flatId={flatIdData}
          row={editRow}
          onClose={() => { setShowAdd(false); setEditRow(null) }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['arrears-for-flat', flatCode] })
            qc.invalidateQueries({ queryKey: ['dues'] })
            setShowAdd(false); setEditRow(null)
          }}
        />
      )}
    </div>
  )
}

function ArrearsDialog({ flatId, row, onClose, onSaved }: {
  flatId: string
  row: any | null
  onClose: () => void
  onSaved: () => void
}) {
  const [label, setLabel] = useState(row?.source_label ?? '')
  const [amount, setAmount] = useState(row?.amount?.toString() ?? '')
  const [notes, setNotes] = useState(row?.notes ?? '')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    const amt = parseInt(amount)
    if (!label.trim() || isNaN(amt) || amt <= 0) return
    setSaving(true)
    if (row) {
      await supabase.from('flat_arrears').update({ source_label: label.trim(), amount: amt, notes: notes.trim() || null }).eq('id', row.id)
    } else {
      const { data: { user } } = await supabase.auth.getUser()
      await supabase.from('flat_arrears').insert({
        flat_id: flatId, arrears_type: 'maintenance',
        source_label: label.trim(), amount: amt,
        notes: notes.trim() || null, created_by: user!.id,
      })
    }
    setSaving(false)
    onSaved()
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>{row ? 'Edit arrears' : 'Add arrears'}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <div className="flex flex-col gap-1">
            <Label>Period label (e.g. FY 2024-25)</Label>
            <Input value={label} onChange={e => setLabel(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Amount (₹)</Label>
            <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Notes</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

Add needed imports at the top of DuesPage.tsx: `Pencil, Trash2` from lucide-react; `Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter` from Shadcn; `useQueryClient` from TanStack; `useRoleCtx` from contexts; `Button, Input, Label` from ui.

- [ ] **Step 4: Type-check and verify**

```bash
npx tsc --noEmit
npm run dev
```
Open Dues page → grid shows Arrears and Total Outstanding columns (all zero initially). Click a flat → arrears section shows "None" with "+ Add" button for admin. Add an arrears row → grid updates.

- [ ] **Step 5: Commit**

```bash
git add src/pages/DuesPage.tsx
git commit -m "feat(dues): add arrears columns to grid and manual arrears management panel"
```

---

## Task 12: SettingsPage — Advance FY section

**Files:**
- Modify: `src/pages/SettingsPage.tsx`

- [ ] **Step 1: Add AdvanceFYSection component at the bottom of SettingsPage.tsx**

```tsx
function AdvanceFYSection() {
  const qc = useQueryClient()
  const [preview, setPreview] = useState<{ flat_code: string; pending: number }[]>([])
  const [showModal, setShowModal] = useState(false)
  const [advancing, setAdvancing] = useState(false)

  const { data: settings } = useQuery({
    queryKey: ['app-settings'],
    queryFn: async () => {
      const { data } = await supabase.from('app_settings').select('*')
      return Object.fromEntries((data ?? []).map((s: any) => [s.key, s.value]))
    },
  })

  const currentFY = settings?.dues_start_fiscal_year
  const nextFY = currentFY ? parseInt(currentFY) + 1 : null

  async function handlePreview() {
    const { data } = await supabase
      .from('v_dues_tracker')
      .select('flat_code,pending')
      .gt('pending', 0)
      .order('flat_code')
    setPreview((data ?? []) as { flat_code: string; pending: number }[])
    setShowModal(true)
  }

  async function handleAdvance() {
    setAdvancing(true)
    const { error } = await supabase.rpc('advance_fiscal_year')
    setAdvancing(false)
    if (error) { toast.error(error.message); return }
    toast.success(`Advanced to FY ${nextFY}-${String(nextFY! + 1).slice(-2)}`)
    setShowModal(false)
    qc.invalidateQueries({ queryKey: ['app-settings'] })
    qc.invalidateQueries({ queryKey: ['dues'] })
  }

  if (!currentFY || !nextFY) return null

  return (
    <div className="surface !p-5 flex flex-col gap-4">
      <div>
        <p className="font-semibold text-[14px]">Advance Fiscal Year</p>
        <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--ink-500)' }}>
          Current tracking from FY {currentFY}-{String(parseInt(currentFY) + 1).slice(-2)}.
          Advancing will snapshot all pending balances as arrears, then start fresh from April {nextFY}.
        </p>
      </div>
      <div className="flex">
        <Button variant="outline" onClick={handlePreview}>
          Preview &amp; Advance to FY {nextFY}-{String(nextFY + 1).slice(-2)}
        </Button>
      </div>

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Advance to FY {nextFY}-{String(nextFY + 1).slice(-2)}</DialogTitle>
          </DialogHeader>
          {preview.length === 0 ? (
            <p className="text-[13px] py-2" style={{ color: 'var(--ink-500)' }}>
              All flats are fully paid. No arrears will be created.
            </p>
          ) : (
            <div className="flex flex-col gap-2 py-2">
              <p className="text-[12.5px]" style={{ color: 'var(--ink-500)' }}>
                The following {preview.length} flat(s) have outstanding balances that will be saved as arrears:
              </p>
              <div className="max-h-48 overflow-y-auto flex flex-col gap-1">
                {preview.map(r => (
                  <div key={r.flat_code} className="flex justify-between text-[12.5px]">
                    <span className="font-medium">{r.flat_code}</span>
                    <span style={{ color: 'var(--bad)' }}>{formatINR(r.pending)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleAdvance} disabled={advancing}>
              {advancing ? 'Advancing…' : 'Confirm Advance'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 2: Add the section to GeneralSettings (admin only)**

Inside the `GeneralSettings` component's return JSX, add at the bottom (before the closing fragment):

```tsx
{isAdmin && <AdvanceFYSection />}
```

- [ ] **Step 3: Add missing imports to SettingsPage.tsx**

Add `Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter` to existing Shadcn dialog import if not already present.

- [ ] **Step 4: Type-check and verify**

```bash
npx tsc --noEmit
npm run dev
```
Open Settings → General as admin. "Advance Fiscal Year" section shows at bottom. Click "Preview & Advance" → modal lists flats with pending balances.

- [ ] **Step 5: Commit**

```bash
git add src/pages/SettingsPage.tsx
git commit -m "feat(settings): add Advance FY section with preview modal and arrears snapshot"
```

---

## Task 13: CorpusPage — enhanced plan closure with arrears capture

**Files:**
- Modify: `src/pages/CorpusPage.tsx`

- [ ] **Step 1: Update the close plan handler to call the RPC**

Find the existing plan close handler (look for `showClose` state usage or a "Close plan" button handler). Replace any direct `UPDATE corpus_plans SET status = 'completed'` call with:

```typescript
async function handleClosePlan(planId: string) {
  // Fetch flats with outstanding balance to show in preview
  const { data: preview } = await supabase
    .from('v_corpus_tracker')
    .select('flat_code, balance')
    .eq('plan_id', planId)
    .gt('balance', 0)
    .order('flat_code')
  setClosePreview(preview ?? [])
  setClosingPlanId(planId)
  setShowClose(true)
}

async function confirmClosePlan() {
  if (!closingPlanId) return
  setClosing(true)
  const { error } = await supabase.rpc('close_corpus_plan', { p_plan_id: closingPlanId })
  setClosing(false)
  if (error) { toast.error(error.message); return }
  toast.success('Plan closed and arrears recorded')
  setShowClose(false)
  setClosingPlanId(null)
  invalidatePlans()
}
```

- [ ] **Step 2: Add state for close preview**

```typescript
const [closePreview, setClosePreview] = useState<{ flat_code: string; balance: number }[]>([])
const [closingPlanId, setClosingPlanId] = useState<string | null>(null)
const [closing, setClosing] = useState(false)
```

- [ ] **Step 3: Update the close confirmation dialog to show affected flats**

Find the existing `showClose` AlertDialog and update its description:

```tsx
<AlertDialogDescription>
  {closePreview.length > 0 ? (
    <>
      <span className="block mb-2">
        {closePreview.length} flat(s) have outstanding balances that will be saved as corpus arrears:
      </span>
      <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
        {closePreview.map(r => (
          <span key={r.flat_code} className="flex justify-between text-[12px]">
            <span>{r.flat_code}</span>
            <span style={{ color: 'var(--bad)' }}>{formatINR(r.balance)}</span>
          </span>
        ))}
      </div>
    </>
  ) : (
    'All flats have met their corpus target. No arrears will be created.'
  )}
</AlertDialogDescription>
```

Update the AlertDialogAction to call `confirmClosePlan`:
```tsx
<AlertDialogAction onClick={confirmClosePlan} disabled={closing}>
  {closing ? 'Closing…' : 'Close Plan'}
</AlertDialogAction>
```

- [ ] **Step 4: Type-check and verify**

```bash
npx tsc --noEmit
npm run dev
```
Open Corpus page → active plan → close plan button → modal shows affected flats with balances. Confirm → plan marked completed, corpus arrears created. Owner portal for affected flat shows corpus arrears card.

- [ ] **Step 5: Commit**

```bash
git add src/pages/CorpusPage.tsx
git commit -m "feat(corpus): enhanced plan closure calls RPC and shows arrears preview"
```

---

## Task 14: Transaction tagging — corpus plan selector

**Files:**
- Modify: `src/pages/TransactionsPage.tsx`

- [ ] **Step 1: Locate the transaction tagging dialog/panel**

Search for where `corpus` is set to `'YES'` in the tag/review panel. This is likely in a tagging form or inline editor in the review queue.

- [ ] **Step 2: Fetch active corpus plans when corpus = YES is selected**

Add a query for active plans:

```typescript
const { data: activePlans = [] } = useQuery({
  queryKey: ['active-corpus-plans'],
  queryFn: async () => {
    const { data } = await supabase
      .from('corpus_plans')
      .select('id, name')
      .eq('status', 'active')
      .order('name')
    return (data ?? []) as { id: string; name: string }[]
  },
})
```

- [ ] **Step 3: Add plan selector when multiple active plans exist and corpus = YES**

In the tagging form, after the corpus toggle:

```tsx
{tagForm.corpus === 'YES' && activePlans.length > 1 && (
  <div className="flex flex-col gap-1">
    <Label>Corpus plan</Label>
    <Select value={tagForm.plan_id ?? ''} onValueChange={v => setTagForm(f => ({ ...f, plan_id: v || null }))}>
      <SelectTrigger>
        <SelectValue placeholder="Select plan (required for overlapping plans)" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="">Auto (by year)</SelectItem>
        {activePlans.map(p => (
          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
)}
```

- [ ] **Step 4: Include plan_id in the tag save call**

When saving the tag, include `plan_id` in the update:

```typescript
await supabase
  .from('transactions')
  .update({
    corpus: tagForm.corpus,
    category: tagForm.category,
    plan_id: tagForm.corpus === 'YES' ? (tagForm.plan_id || null) : null,
    // ... other fields
  })
  .eq('id', txn.id)
```

Add `plan_id: string | null` to the tag form state type.

- [ ] **Step 5: Type-check and verify**

```bash
npx tsc --noEmit
npm run dev
```
Go to Transactions review queue → tag a CR as corpus → if only one active plan, no plan selector shown. Add a second active corpus plan in DB → tag dialog now shows plan selector.

- [ ] **Step 6: Commit**

```bash
git add src/pages/TransactionsPage.tsx
git commit -m "feat(transactions): show corpus plan selector when multiple active plans exist"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|-----------------|------|
| flat_arrears table + RLS + unique constraint | Task 1 |
| advance_fiscal_year RPC | Task 1 |
| close_corpus_plan RPC | Task 1 |
| transactions.plan_id | Task 2 |
| v_dues_tracker arrears_maintenance + total_outstanding | Task 3 |
| v_corpus_tracker plan_id filter | Task 4 |
| FlatArrears TypeScript type | Task 5 |
| DuesEntry arrears fields | Task 5 |
| Transaction.plan_id field | Task 5 |
| useRole flatId + hasFlatAssigned | Task 6 |
| RoleContext flatId + hasFlatAssigned | Task 6 |
| OwnerPortalPage explicit flat filtering | Task 7 |
| OwnerPortalPage corpus array | Task 7 |
| OwnerPortalPage arrears display | Task 7 |
| /my-flat route | Task 8 |
| Layout conditional My Flat nav | Task 8 |
| ProfilePage any-user flat display | Task 9 |
| UsersPage flat assignment UI | Task 10 |
| DuesPage arrears column + manual entry | Task 11 |
| SettingsPage Advance FY | Task 12 |
| CorpusPage closure with arrears | Task 13 |
| Transaction tagging plan selector | Task 14 |

All spec requirements covered. No placeholders or TBDs found.
