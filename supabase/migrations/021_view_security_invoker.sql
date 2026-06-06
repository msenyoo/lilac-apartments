-- ============================================================
-- Migration 021: Set SECURITY INVOKER on shared views
--
-- v_corpus_tracker and v_dues_tracker are owned by the postgres
-- superuser, which causes their underlying table queries to run
-- with superuser privileges, bypassing RLS entirely.
--
-- SECURITY INVOKER makes the views evaluate RLS as the querying
-- user, so owners see only their own flat's row while
-- admins/committee/auditors continue to see all rows.
-- ============================================================

ALTER VIEW public.v_corpus_tracker SET (security_invoker = true);
ALTER VIEW public.v_dues_tracker    SET (security_invoker = true);
