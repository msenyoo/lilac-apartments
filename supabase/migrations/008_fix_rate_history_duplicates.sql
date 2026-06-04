-- 008: Deduplicate maintenance_rate_history and add unique constraint
-- Root cause: bulk-insert created 4 identical rows per flat (176 total → 44 unique)
-- Applied directly via Management API (migration tracking not available for non-timestamp filenames)

-- Step 1: Keep only the row with the smallest id per duplicate group
DELETE FROM public.maintenance_rate_history a
USING public.maintenance_rate_history b
WHERE a.id > b.id
  AND a.flat_id        = b.flat_id
  AND a.monthly_rate   = b.monthly_rate
  AND a.effective_from = b.effective_from
  AND (a.effective_to IS NOT DISTINCT FROM b.effective_to);

-- Step 2: Partial unique index — only one open-ended (current) rate per flat
CREATE UNIQUE INDEX IF NOT EXISTS uq_rate_history_current
  ON public.maintenance_rate_history (flat_id)
  WHERE effective_to IS NULL;

-- Step 3: Full unique index — no duplicate closed periods either
CREATE UNIQUE INDEX IF NOT EXISTS uq_rate_history_closed
  ON public.maintenance_rate_history (flat_id, effective_from, effective_to)
  WHERE effective_to IS NOT NULL;
