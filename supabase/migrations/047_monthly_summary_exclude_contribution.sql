-- 047: v_monthly_summary.total_expenses sums every DR transaction regardless of
-- category. That's harmless today since no Contribution drive (migration 045) has
-- been disbursed yet, but the moment one is, its payout would inflate the Dashboard's
-- "Total Expenses" trend as if it were a real society expense. Exclude Contribution
-- rows from total_expenses, same treatment as v_fund_position (migration 046).

create or replace view public.v_monthly_summary as
select
  fiscal_label,
  fiscal_year,
  sum(amount) filter (where cr_dr = 'CR' and category = 'Maintenance' and row_type != 'VOIDED') as maintenance_collected,
  sum(amount) filter (where cr_dr = 'CR' and corpus = 'YES' and row_type != 'VOIDED') as corpus_collected,
  sum(amount) filter (where cr_dr = 'DR' and category != 'Contribution' and row_type != 'VOIDED') as total_expenses,
  sum(amount) filter (where cr_dr = 'DR' and category = 'SALARY' and row_type != 'VOIDED') as salary,
  sum(amount) filter (where cr_dr = 'DR' and category = 'EB' and row_type != 'VOIDED') as eb,
  count(distinct flat_code) filter (where cr_dr = 'CR' and category = 'Maintenance' and row_type != 'VOIDED') as flats_paid
from public.transactions
group by fiscal_label, fiscal_year
order by fiscal_year desc, fiscal_label desc;
