-- Single source of truth for "what category was this rupee actually spent on".
--
-- expenses.category_id is frequently NULL on vouchers that were split across several
-- categories at entry time (e.g. a reimbursement covering Plumbing, Sump water, Motor
-- Pumps) — the real categorisation lives on each expense_line_items row instead. Every
-- report that grouped by expenses.category_id directly (Cashbook, Expenditure-by-category,
-- Utilities) has independently hit this and had to re-implement the same header/line-item
-- fallback in application code. This view centralises it so future reports and ad-hoc SQL
-- audits get it right without re-deriving the logic.
--
-- Grain: one row per "spend" — either a line item (using its own category_id, falling back
-- to its header's), or, for headers with no line items at all, the header itself.

create or replace view public.v_expense_category_spend
with (security_invoker = true)
as
with rows as (
  select
    li.id                                         as line_item_id,
    e.id                                           as expense_id,
    e.expense_date,
    e.corpus_plan_id,
    e.voucher_no,
    coalesce(li.category_id, e.category_id)        as category_id,
    li.amount,
    coalesce(li.description, e.description)        as description,
    coalesce(li.payee_type, e.payee_type)          as payee_type,
    coalesce(li.vendor_id, e.vendor_id)            as vendor_id,
    coalesce(li.staff_id, e.staff_id)              as staff_id,
    coalesce(li.payee_name_raw, e.payee_name_raw)  as payee_name_raw
  from public.expense_line_items li
  join public.expenses e on e.id = li.expense_id
  where e.voided_at is null

  union all

  select
    null::uuid as line_item_id,
    e.id, e.expense_date, e.corpus_plan_id, e.voucher_no,
    e.category_id, e.amount, e.description,
    e.payee_type, e.vendor_id, e.staff_id, e.payee_name_raw
  from public.expenses e
  where e.voided_at is null
    and not exists (select 1 from public.expense_line_items li where li.expense_id = e.id)
)
select
  rows.*,
  ec.name        as category_name,
  ec.budget_type as budget_type,
  v.name         as vendor_name,
  s.name         as staff_name,
  case
    when rows.payee_type = 'Staff'  then coalesce(s.name, rows.payee_name_raw)
    when rows.payee_type = 'Vendor' then coalesce(v.name, rows.payee_name_raw)
    else rows.payee_name_raw
  end as resolved_payee
from rows
left join public.expense_categories ec on ec.id = rows.category_id
left join public.vendors            v  on v.id  = rows.vendor_id
left join public.staff              s  on s.id  = rows.staff_id;
