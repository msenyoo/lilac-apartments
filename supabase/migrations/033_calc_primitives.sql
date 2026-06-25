-- 033: Calc primitives — single source of truth for bank balance + per-fund position
--
-- Eliminates the duplicated `Σ CR − Σ DR` pattern that previously lived in:
--   - ReportPage.tsx BalanceSheetTab (cumulativeCR + cumulativeDR queries)
--   - ReportPage.tsx RPStatementTab (opening balance: priorCR + priorDR queries)
--   - DashboardPage.tsx Net Available Cash (maintCollected + maintSpent queries)
--
-- All callers now go through fn_bank_balance_as_of() or v_fund_position. The VOIDED
-- filter is enforced in one place, structurally preventing the regression that caused
-- the 2026-06-23 balance mismatch.

-- ── 1. Bank balance as of any date ─────────────────────────────────────────
-- Cumulative position: Σ CR − Σ DR for all non-voided transactions on or before p_date.
CREATE OR REPLACE FUNCTION public.fn_bank_balance_as_of(p_date date)
RETURNS bigint
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(
    SUM(CASE WHEN cr_dr = 'CR' THEN amount ELSE -amount END),
    0
  )::bigint
  FROM transactions
  WHERE row_type <> 'VOIDED'
    AND value_date <= p_date;
$$;

GRANT EXECUTE ON FUNCTION public.fn_bank_balance_as_of(date) TO authenticated;

COMMENT ON FUNCTION public.fn_bank_balance_as_of(date) IS
  'Single source of truth for bank balance. Σ CR − Σ DR over non-voided transactions ≤ p_date.';

-- ── 2. Lifetime fund position view ─────────────────────────────────────────
-- Per-fund (Maintenance vs Corpus, by transactions.corpus flag) lifetime receipts,
-- payments, and balance. Used by Dashboard Net Available Cash and similar.
DROP VIEW IF EXISTS public.v_fund_position;
CREATE VIEW public.v_fund_position
  WITH (security_invoker = true)
AS
SELECT
  CASE WHEN corpus = 'YES' THEN 'Corpus' ELSE 'Maintenance' END AS fund,
  COALESCE(SUM(CASE WHEN cr_dr = 'CR' THEN amount ELSE 0 END), 0)::bigint  AS receipts,
  COALESCE(SUM(CASE WHEN cr_dr = 'DR' THEN amount ELSE 0 END), 0)::bigint  AS payments,
  COALESCE(SUM(CASE WHEN cr_dr = 'CR' THEN amount ELSE -amount END), 0)::bigint AS balance
FROM public.transactions
WHERE row_type <> 'VOIDED'
GROUP BY CASE WHEN corpus = 'YES' THEN 'Corpus' ELSE 'Maintenance' END;

COMMENT ON VIEW public.v_fund_position IS
  'Lifetime per-fund position from transactions, segregated by corpus flag. VOIDED rows excluded.';

-- ── 3. Flats summary view ─────────────────────────────────────────────────
-- Removes the hard-coded `44 flats` magic constant scattered across the codebase.
DROP VIEW IF EXISTS public.v_flats_summary;
CREATE VIEW public.v_flats_summary
  WITH (security_invoker = true)
AS
SELECT
  COUNT(*)::int                AS total_flats,
  COUNT(DISTINCT block)::int   AS total_blocks
FROM public.flats;

COMMENT ON VIEW public.v_flats_summary IS
  'Society shape: total flats and blocks. Use instead of hard-coded counts.';
