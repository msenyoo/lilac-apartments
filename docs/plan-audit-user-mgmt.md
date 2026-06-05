# Implementation Plan: Audit Logging + User Management & RBAC

**Status:** Draft — ready for implementation  
**Target:** Lilac Apartments · React 18 + Supabase  
**Next migration number:** 012 (current highest: 011_utility_categories_dynamic.sql)

---

## Part 1 — Audit Logging

### 1.1 Recommendation: Postgres Triggers (not application-level)

**Decision: Postgres triggers, not application-level logging.**

Justification:
- The app currently performs direct `supabase.from(table).insert/update/delete()` calls scattered across many components (TransactionsPage, SettingsPage, CorpusPage, ExpensesPage, etc.). Retrofitting every mutation call with a paired audit write is error-prone and easy to miss.
- Triggers fire unconditionally — even if a record is changed via the Supabase Dashboard SQL editor, a direct psql session, or a future migration. Application-level logging only captures what goes through the React code.
- The Supabase anon key is used client-side. A trigger can capture `auth.uid()` and `auth.email()` server-side without trusting the client to supply them.
- One trigger function can be attached to all audited tables with zero per-table React changes.

The only downside (slightly higher write latency) is negligible for this workload.

---

### 1.2 Schema: `audit_log` table

```sql
-- 012_audit_log.sql

CREATE TABLE IF NOT EXISTS public.audit_log (
  id           uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      uuid,                          -- auth.uid() at time of change; NULL = system/migration
  user_email   text,                          -- auth.email() — denormalised for fast display
  action       text        NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  table_name   text        NOT NULL,
  record_id    uuid        NOT NULL,          -- the PK of the changed row
  old_val      jsonb,                         -- NULL on INSERT
  new_val      jsonb,                         -- NULL on DELETE
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_table_record ON public.audit_log (table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_user         ON public.audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at   ON public.audit_log (created_at DESC);

-- RLS: admins see all; committee/auditor see all (read); no one can INSERT/UPDATE/DELETE directly
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user can read (the viewer UI enforces role filtering)
CREATE POLICY "audit_log_select"
  ON public.audit_log FOR SELECT TO authenticated USING (true);

-- Write: ONLY the trigger (SECURITY DEFINER function) writes here — no direct client inserts
-- No INSERT/UPDATE/DELETE policy = client cannot write directly
```

---

### 1.3 Trigger function

```sql
-- Shared trigger function used by all audited tables

CREATE OR REPLACE FUNCTION public.fn_audit_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER   -- runs as postgres superuser so it can always write audit_log
SET search_path = public
AS $$
DECLARE
  v_record_id uuid;
  v_old_val   jsonb;
  v_new_val   jsonb;
BEGIN
  IF    TG_OP = 'INSERT' THEN
    v_record_id := NEW.id;
    v_new_val   := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_record_id := NEW.id;
    v_old_val   := to_jsonb(OLD);
    v_new_val   := to_jsonb(NEW);
  ELSIF TG_OP = 'DELETE' THEN
    v_record_id := OLD.id;
    v_old_val   := to_jsonb(OLD);
  END IF;

  INSERT INTO public.audit_log
    (user_id, user_email, action, table_name, record_id, old_val, new_val)
  VALUES (
    auth.uid(),
    auth.email(),
    TG_OP,
    TG_TABLE_NAME,
    v_record_id,
    v_old_val,
    v_new_val
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;
```

---

### 1.4 Tables to audit + trigger attachment

The following tables contain financial or configuration state where a change trail is required:

| Table | Why |
|---|---|
| `transactions` | Core financial data — any edit/void/split must be traceable |
| `expenses` | Expense vouchers — approval changes, reconciliation updates |
| `corpus_plans` | Plan status changes (draft → active → completed) |
| `corpus_plan_flats` | Per-flat targets and carry-forward amounts |
| `maintenance_rate_history` | Rate changes affect every dues calculation going forward |
| `flats` | Maintenance amount and corpus target are financial figures |
| `residents` | Resident add/deactivate; UPI IDs used for auto-matching |

Tables intentionally excluded: `uploads`, `split_refs`, `app_settings` (low-sensitivity config), `expense_categories`, `staff`, `vendors` (these are reference master data, not financial records — add later if needed).

```sql
-- Attach trigger to each audited table

CREATE TRIGGER trg_audit_transactions
  AFTER INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

CREATE TRIGGER trg_audit_expenses
  AFTER INSERT OR UPDATE OR DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

CREATE TRIGGER trg_audit_corpus_plans
  AFTER INSERT OR UPDATE OR DELETE ON public.corpus_plans
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

CREATE TRIGGER trg_audit_corpus_plan_flats
  AFTER INSERT OR UPDATE OR DELETE ON public.corpus_plan_flats
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

CREATE TRIGGER trg_audit_maintenance_rate_history
  AFTER INSERT OR UPDATE OR DELETE ON public.maintenance_rate_history
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

CREATE TRIGGER trg_audit_flats
  AFTER INSERT OR UPDATE OR DELETE ON public.flats
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

CREATE TRIGGER trg_audit_residents
  AFTER INSERT OR UPDATE OR DELETE ON public.residents
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();
```

---

### 1.5 Audit Log viewer UI

**Location:** Settings page → new tab "Audit Log"  
**Route:** `/settings` (existing page, new tab added alongside General / Maintenance Rates / Expense Categories / Import History)

#### Filters (top of panel)
- Table selector: dropdown listing all audited tables + "All tables" default
- Date range: two date inputs (from / to), defaulting to last 30 days
- Action: "All" / INSERT / UPDATE / DELETE pills (same style as existing block filters)

#### Table columns
| Column | Notes |
|---|---|
| Timestamp | `created_at` formatted as `dd MMM yyyy HH:mm` |
| User | `user_email` — truncated to local part on mobile |
| Table | Badge chip styled like existing `badge-review` |
| Action | Colour-coded: INSERT = green, UPDATE = amber, DELETE = red |
| Record ID | First 8 chars of UUID, click → expand row |
| Summary | One-line diff: for UPDATE, list changed field names; for INSERT/DELETE, show JSON preview |

#### Row expansion (click to expand)
- Show full `old_val` / `new_val` as a two-column diff or simple JSON block
- Use a `<pre className="text-xs bg-slate-50 p-3 rounded overflow-x-auto">` with JSON.stringify(…, null, 2)

#### Query pattern
```typescript
// Paginated, 50 rows per page
const { data } = await supabase
  .from('audit_log')
  .select('*')
  .gte('created_at', fromDate)
  .lte('created_at', toDate)
  .eq('table_name', selectedTable)   // omit when "All"
  .eq('action', selectedAction)      // omit when "All"
  .order('created_at', { ascending: false })
  .range(page * 50, page * 50 + 49)
```

---

## Part 2 — User Management & RBAC

### 2.1 Role definitions

| Role | Description | What they can do |
|---|---|---|
| `admin` | Association secretary / treasurer | Full read + write across all tables; manage users; access audit log |
| `committee` | Committee members | Read all data; can approve expenses (`expenses.approved_by`); cannot mutate financial records |
| `auditor` | External auditor or resident auditor | Read-only across all tables + audit log; no mutations |

---

### 2.2 Recommendation: Separate `user_roles` table (not custom JWT claims)

**Decision: separate `user_roles` table, not Supabase custom JWT claims.**

Justification:
- Custom claims require a hook function that embeds the role in the JWT at login time. Changing a user's role then requires them to log out and back in for it to take effect — a poor UX for a small committee app.
- A `user_roles` table is readable at request time via a helper function or a single extra query in `useRole()`. Role changes are effective immediately.
- The existing `profiles` table already has a `role text DEFAULT 'viewer'` column, but it predates the 3-role design and RLS does not enforce it. The cleanest upgrade path is to:
  1. Add a `user_roles` table with the typed constraint.
  2. Backfill from `profiles.role` for existing users.
  3. Update RLS to read from `user_roles` via a helper function.
  4. Keep `profiles.role` for now (remove in a later clean-up migration).

This avoids breaking anything currently working and gives a clean forward path.

---

### 2.3 Schema: `user_roles` table

```sql
-- 013_user_roles.sql

-- Helper function: returns the role of the calling user
-- Called inside RLS policies — must be SECURITY DEFINER to avoid recursion
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
$$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id    uuid  PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text  NOT NULL CHECK (role IN ('admin', 'committee', 'auditor')),
  assigned_by uuid REFERENCES auth.users(id),   -- who set the role
  assigned_at timestamptz DEFAULT now()
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read roles (needed by useRole() client-side)
CREATE POLICY "user_roles_select"
  ON public.user_roles FOR SELECT TO authenticated USING (true);

-- Only admins can insert/update/delete role assignments
CREATE POLICY "user_roles_admin_write"
  ON public.user_roles FOR ALL TO authenticated
  USING      (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- Backfill: map existing profiles.role values into user_roles
-- 'admin' → 'admin', anything else → 'committee' as a conservative default
INSERT INTO public.user_roles (user_id, role)
SELECT id,
  CASE WHEN role = 'admin' THEN 'admin' ELSE 'committee' END
FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;
```

---

### 2.4 RLS policy updates per table

The existing policies grant all authenticated users write access. Replace them with role-aware policies. The pattern is consistent: admins write, committee/auditor read.

Create a migration (`013_user_roles.sql` continued) that drops the old blanket policies and replaces them:

```sql
-- ── transactions ──────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated insert transactions" ON public.transactions;
DROP POLICY IF EXISTS "Authenticated update transactions" ON public.transactions;

CREATE POLICY "transactions_admin_write"
  ON public.transactions FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() = 'admin');

CREATE POLICY "transactions_admin_update"
  ON public.transactions FOR UPDATE TO authenticated
  USING (public.get_my_role() = 'admin');

-- ── expenses ──────────────────────────────────────────────────
-- (no existing write policies defined in migrations — add fresh)
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expenses_select"
  ON public.expenses FOR SELECT TO authenticated USING (true);

CREATE POLICY "expenses_admin_write"
  ON public.expenses FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() = 'admin');

CREATE POLICY "expenses_admin_update"
  ON public.expenses FOR UPDATE TO authenticated
  USING (public.get_my_role() = 'admin');

-- Committee can update approved_by + approved_at only
-- This is handled in the React layer (button gated by role), not a separate policy,
-- because Postgres column-level RLS is complex. The committee role check in
-- React is sufficient for this low-stakes approval field.

-- ── corpus_plans ──────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_all_corpus_plans" ON public.corpus_plans;

CREATE POLICY "corpus_plans_select"
  ON public.corpus_plans FOR SELECT TO authenticated USING (true);

CREATE POLICY "corpus_plans_admin_write"
  ON public.corpus_plans FOR ALL TO authenticated
  USING      (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- ── corpus_plan_flats ─────────────────────────────────────────
DROP POLICY IF EXISTS "auth_all_corpus_plan_flats" ON public.corpus_plan_flats;

CREATE POLICY "corpus_plan_flats_select"
  ON public.corpus_plan_flats FOR SELECT TO authenticated USING (true);

CREATE POLICY "corpus_plan_flats_admin_write"
  ON public.corpus_plan_flats FOR ALL TO authenticated
  USING      (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- ── maintenance_rate_history ──────────────────────────────────
DROP POLICY IF EXISTS "auth_write_rate_hist" ON public.maintenance_rate_history;

CREATE POLICY "rate_hist_admin_write"
  ON public.maintenance_rate_history FOR ALL TO authenticated
  USING      (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- ── flats ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_update_flats" ON public.flats;

CREATE POLICY "flats_admin_update"
  ON public.flats FOR UPDATE TO authenticated
  USING (public.get_my_role() = 'admin');

-- ── residents ────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_write_residents" ON public.residents;

CREATE POLICY "residents_admin_write"
  ON public.residents FOR ALL TO authenticated
  USING      (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- ── app_settings ─────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_all_app_settings" ON public.app_settings;

CREATE POLICY "app_settings_select"
  ON public.app_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "app_settings_admin_write"
  ON public.app_settings FOR ALL TO authenticated
  USING      (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- ── uploads + split_refs (keep existing read; restrict write) ─
DROP POLICY IF EXISTS "Authenticated insert uploads"    ON public.uploads;
DROP POLICY IF EXISTS "Authenticated insert split_refs" ON public.split_refs;

CREATE POLICY "uploads_admin_insert"
  ON public.uploads FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() = 'admin');

CREATE POLICY "split_refs_admin_insert"
  ON public.split_refs FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() = 'admin');
```

---

### 2.5 React: `useRole()` hook

**File to create:** `src/hooks/useRole.ts`

```typescript
// src/hooks/useRole.ts
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export type AppRole = 'admin' | 'committee' | 'auditor'

export function useRole() {
  const [role, setRole]       = useState<AppRole | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setRole(null); setLoading(false); return }
      const { data } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle()
      setRole((data?.role as AppRole) ?? null)
      setLoading(false)
    })
  }, [])

  return {
    role,
    loading,
    isAdmin:     role === 'admin',
    isCommittee: role === 'committee',
    isAuditor:   role === 'auditor',
    canWrite:    role === 'admin',
    canApprove:  role === 'admin' || role === 'committee',
  }
}
```

---

### 2.6 React: Route guards and UI gating

**Pattern:** No full route redirect for non-admin — the data is read-only, so auditors and committee can still navigate to all pages. Mutation buttons are conditionally hidden or disabled.

#### Global: make role available via context

**File to create:** `src/contexts/RoleContext.tsx`

```typescript
// src/contexts/RoleContext.tsx
import { createContext, useContext, ReactNode } from 'react'
import { useRole, AppRole } from '@/hooks/useRole'

interface RoleContextValue {
  role: AppRole | null
  loading: boolean
  isAdmin: boolean
  canWrite: boolean
  canApprove: boolean
}

const RoleContext = createContext<RoleContextValue>({
  role: null, loading: true, isAdmin: false, canWrite: false, canApprove: false,
})

export function RoleProvider({ children }: { children: ReactNode }) {
  const value = useRole()
  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>
}

export const useRoleCtx = () => useContext(RoleContext)
```

**Modify:** `src/App.tsx` — wrap `<Layout />` route with `<RoleProvider>`:

```tsx
// In App.tsx, wrap the root route element:
import { RoleProvider } from '@/contexts/RoleContext'

<Route path="/" element={<RoleProvider><Layout /></RoleProvider>}>
```

#### Per-page gating examples

In any page that has mutation buttons, replace bare buttons with role-checked renders:

```tsx
// Example: TransactionsPage — hide "Save tag" button for auditors
const { canWrite } = useRoleCtx()

{canWrite && (
  <button onClick={handleSaveTag} className="btn-primary">Save tag</button>
)}
```

```tsx
// Example: ExpensesPage — disable "Add Expense" for non-admins
const { isAdmin } = useRoleCtx()

<Button onClick={() => setAddOpen(true)} disabled={!isAdmin}>
  <Plus size={15} /> Add Expense
</Button>
```

```tsx
// Example: Corpus / Settings — show read-only banner
const { canWrite } = useRoleCtx()

{!canWrite && (
  <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 mb-4">
    <span>You have read-only access. Contact the administrator to make changes.</span>
  </div>
)}
```

#### Settings page: Users tab is admin-only
The Users tab itself should only render if `isAdmin`. Non-admins see it grayed out or hidden from the tab bar entirely.

---

### 2.7 UI: Settings → Users tab

**File to modify:** `src/pages/SettingsPage.tsx`

Add `'users'` and `'audit'` to the `SettingsTab` type and tab bar. The Users tab renders only when `isAdmin`:

```typescript
type SettingsTab = 'general' | 'rates' | 'categories' | 'imports' | 'users' | 'audit'
```

Tab bar — add conditionally:
```tsx
// Only show Users tab to admins
{ key: 'users', label: 'Users' },       // conditional on isAdmin
{ key: 'audit', label: 'Audit Log' },   // all roles (read-only viewer)
```

#### `UsersSettings` component (new, inside SettingsPage.tsx)

**Sections:**

1. **User list** — query `user_roles` joined with `auth.users` via Supabase Admin API or a Postgres view. Supabase does not expose `auth.users` to client-side RLS, so use one of:
   - Option A (recommended): Create a Postgres view `public.v_users` using `SECURITY DEFINER` that SELECTs `id, email, created_at` from `auth.users` joined with `user_roles`. Admins can then query `v_users` client-side.
   - Option B: Call `supabase.auth.admin.listUsers()` from a Supabase Edge Function (requires service role key — more complex).

   Go with Option A. Add to migration 013:
   ```sql
   CREATE OR REPLACE VIEW public.v_users AS
   SELECT
     u.id,
     u.email,
     u.created_at,
     u.last_sign_in_at,
     ur.role,
     ur.assigned_at
   FROM auth.users u
   LEFT JOIN public.user_roles ur ON ur.user_id = u.id;

   -- Only admins can query this view
   ALTER VIEW public.v_users OWNER TO authenticated;  -- not needed; use RLS on underlying table
   -- Access is controlled by user_roles RLS + the SECURITY DEFINER on get_my_role()
   -- Add explicit policy by wrapping in a function or gating in React (admin role check)
   ```

   Because RLS doesn't apply to views directly, protect it with a Postgres function or check in the app that `get_my_role() = 'admin'` before querying. In practice: the Users tab only renders for admins; non-admins never call this query.

2. **Role assignment** — dropdown `<Select>` per user row: admin / committee / auditor. On change: `supabase.from('user_roles').upsert({ user_id, role, assigned_by: currentUserId, assigned_at: now() })`.

3. **Invite new user** — Input for email + role selector + "Send invite" button. Calls `supabase.auth.admin.inviteUserByEmail(email)` — requires service role key, so this must go through an Edge Function. For the plan:
   - **Edge Function:** `supabase/functions/invite-user/index.ts` — accepts `{ email, role }`, verifies caller is admin via JWT, calls `supabase.auth.admin.inviteUserByEmail(email)`, then inserts into `user_roles`.
   - The React UI calls this function via `supabase.functions.invoke('invite-user', { body: { email, role } })`.

#### `AuditLogSettings` component (new, inside SettingsPage.tsx)

Implements the viewer described in section 1.5. Query `audit_log` with filters; display in a table with expandable rows.

---

## Part 3 — Migration Files Summary

### Files to create

#### `supabase/migrations/012_audit_log.sql`

Full content:
1. Create `audit_log` table with indexes and RLS (SELECT only for authenticated)
2. Create `fn_audit_trigger()` SECURITY DEFINER function
3. Attach triggers to: `transactions`, `expenses`, `corpus_plans`, `corpus_plan_flats`, `maintenance_rate_history`, `flats`, `residents`

#### `supabase/migrations/013_user_roles.sql`

Full content:
1. Create `get_my_role()` helper function (SECURITY DEFINER, STABLE)
2. Create `user_roles` table with RLS
3. Backfill from `profiles.role`
4. Create `v_users` view
5. Drop and replace all existing blanket-write RLS policies on: `transactions`, `expenses`, `corpus_plans`, `corpus_plan_flats`, `maintenance_rate_history`, `flats`, `residents`, `app_settings`, `uploads`, `split_refs`

#### `supabase/functions/invite-user/index.ts` (new Edge Function)

Handles inviting new users with role assignment. Only required if the invite-user feature is implemented in the current session; can be deferred.

---

## Part 4 — React Files to Create / Modify

### New files

| File | Purpose |
|---|---|
| `src/hooks/useRole.ts` | `useRole()` hook — fetches current user's role from `user_roles` |
| `src/contexts/RoleContext.tsx` | `RoleProvider` + `useRoleCtx()` — makes role available app-wide without prop drilling |
| `supabase/functions/invite-user/index.ts` | Edge Function for sending invite emails with role assignment |

### Modified files

| File | Changes needed |
|---|---|
| `src/App.tsx` | Import `RoleProvider`; wrap `<Layout />` route element with `<RoleProvider>` |
| `src/lib/supabase.ts` | Add `UserRole` interface: `{ user_id: string; role: 'admin' \| 'committee' \| 'auditor'; assigned_by: string \| null; assigned_at: string }` |
| `src/pages/SettingsPage.tsx` | (1) Add `'users'` and `'audit'` to `SettingsTab` type; (2) Add tabs conditionally; (3) Add `UsersSettings` component; (4) Add `AuditLogSettings` component |
| `src/pages/TransactionsPage.tsx` | Gate `Save tag`, `Split`, `Void` buttons behind `canWrite` check from `useRoleCtx()` |
| `src/pages/ExpensesPage.tsx` | Gate `Add Expense` and approve buttons; show read-only banner for non-admins |
| `src/pages/CorpusPage.tsx` | Gate any write actions (plan status changes, flat target edits) |
| `src/pages/SettingsPage.tsx` | Gate `Add Rate Change`, `Save settings`, category edits behind `isAdmin` |
| `src/pages/DuesPage.tsx` | Read-only — no changes needed (no mutations in this page) |
| `src/pages/DashboardPage.tsx` | Read-only — no changes needed |
| `src/pages/FlatsPage.tsx` | Gate resident add/edit/deactivate behind `isAdmin` |
| `src/pages/ReportPage.tsx` | Read-only — no changes needed |
| `src/components/layout/Layout.tsx` | Optionally show current user's role badge in the sidebar footer next to the Sign out button |

---

## Part 5 — Implementation Order

Run in this sequence to avoid breaking the live app:

1. Run `012_audit_log.sql` — additive only, no existing policy changes. Triggers start capturing from this point forward.
2. Run `013_user_roles.sql` — creates roles table and backfills, then drops+replaces write policies. **Do this when the admin user is confirmed to have the `admin` role in `user_roles`, otherwise all mutations will be blocked.**
3. Create `src/hooks/useRole.ts` and `src/contexts/RoleContext.tsx`
4. Modify `src/App.tsx` to wrap with `RoleProvider`
5. Add Users + Audit Log tabs to `SettingsPage.tsx`
6. Gate mutation buttons across remaining pages (can be done page-by-page)
7. Deploy Edge Function for invite-user (optional, can defer)

**Important pre-flight check before running 013:** Verify the logged-in admin user's `auth.uid()` and insert their row into `user_roles` with `role = 'admin'` before dropping the old policies. Otherwise no one will be able to write anything.

```sql
-- Run this BEFORE applying the new RLS policies in 013
-- Replace the email with the actual admin account email
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'
FROM auth.users
WHERE email = 'msenyoo@gmail.com'
ON CONFLICT (user_id) DO UPDATE SET role = 'admin';
```

---

## Part 6 — Out of Scope (Deferred)

- Column-level RLS for committee approval fields (overkill for this team size)
- Row-level audit diff highlighting (full JSON shown instead)
- Audit log retention/archival policy
- Multiple admin users (the current app has one operator; design supports it)
- SCIM provisioning or SSO (not needed for 44-flat association)
