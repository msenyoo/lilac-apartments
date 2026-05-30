-- ============================================================
-- LILAC APARTMENT ASSOCIATION — Supabase Schema
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ── EXTENSIONS ────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── FLATS ─────────────────────────────────────────────────────
create table if not exists public.flats (
  id                uuid primary key default uuid_generate_v4(),
  code              text not null unique,          -- e.g. BF3
  block             text not null,                 -- A B C D E
  flat_type         text not null,                 -- Flat Ground Penthouse Shop
  maintenance_amt   integer not null,
  corpus_target     integer not null,
  created_at        timestamptz default now()
);

-- ── USERS / COMMITTEE ─────────────────────────────────────────
-- Uses Supabase Auth (auth.users). This table extends it.
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  role        text default 'viewer',              -- admin | editor | viewer
  created_at  timestamptz default now()
);

-- ── UPLOADS ───────────────────────────────────────────────────
create table if not exists public.uploads (
  id              uuid primary key default uuid_generate_v4(),
  filename        text not null,
  original_name   text not null,
  storage_path    text,
  uploaded_by     uuid references public.profiles(id),
  month_label     text,                           -- e.g. May-26
  total_txns      integer default 0,
  new_txns        integer default 0,
  duplicates      integer default 0,
  review_count    integer default 0,
  status          text default 'processed',       -- processing | processed | error
  created_at      timestamptz default now()
);

-- ── SPLIT REFS ────────────────────────────────────────────────
create table if not exists public.split_refs (
  id              uuid primary key default uuid_generate_v4(),
  ref_code        text not null unique,           -- SPL-0001
  original_amount numeric(12,2) not null,
  split_count     integer not null,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz default now(),
  notes           text
);

-- ── TRANSACTIONS ──────────────────────────────────────────────
create table if not exists public.transactions (
  id              uuid primary key default uuid_generate_v4(),
  txn_id          text,                           -- bank txn id e.g. S80831330
  value_date      date not null,
  posted_date     text,
  description     text not null,
  cr_dr           text not null check (cr_dr in ('CR','DR')),
  amount          numeric(12,2) not null,
  flat_id         uuid references public.flats(id),
  flat_code       text,                           -- denormalised for query speed
  category        text,                           -- Maintenance | Corpus | SALARY | EB ...
  corpus          text default 'NO' check (corpus in ('YES','NO')),
  fiscal_year     integer,
  fiscal_month    text,
  fiscal_label    text,                           -- e.g. May-26
  source          text default 'Import',
  upload_id       uuid references public.uploads(id),
  split_ref_id    uuid references public.split_refs(id),
  split_ref_code  text,                           -- denormalised
  row_type        text default 'Normal' check (row_type in ('Normal','VOIDED','SPLIT')),
  months_covered  text,
  notes           text,
  created_at      timestamptz default now()
);

-- Indexes for common queries
create index if not exists idx_txns_fiscal_label  on public.transactions(fiscal_label);
create index if not exists idx_txns_flat_code     on public.transactions(flat_code);
create index if not exists idx_txns_category      on public.transactions(category);
create index if not exists idx_txns_cr_dr         on public.transactions(cr_dr);
create index if not exists idx_txns_row_type      on public.transactions(row_type);
create index if not exists idx_txns_value_date    on public.transactions(value_date);
create index if not exists idx_txns_txn_id        on public.transactions(txn_id);

-- ── VIEWS ─────────────────────────────────────────────────────

-- Monthly maintenance collection per flat per month
create or replace view public.v_monthly_collection as
select
  f.code                as flat_code,
  f.block,
  f.flat_type,
  f.maintenance_amt,
  t.fiscal_label,
  t.fiscal_year,
  coalesce(sum(t.amount) filter (
    where t.cr_dr = 'CR'
    and t.category = 'Maintenance'
    and t.row_type != 'VOIDED'
  ), 0) as collected
from public.flats f
cross join (select distinct fiscal_label, fiscal_year from public.transactions) t
left join public.transactions t2
  on t2.flat_code = f.code
  and t2.fiscal_label = t.fiscal_label
  and t2.cr_dr = 'CR'
  and t2.category = 'Maintenance'
  and t2.row_type != 'VOIDED'
group by f.code, f.block, f.flat_type, f.maintenance_amt, t.fiscal_label, t.fiscal_year;

-- Dues tracker — FY 2026-27
create or replace view public.v_dues_tracker as
select
  f.code              as flat_code,
  f.block,
  f.flat_type,
  f.maintenance_amt,
  coalesce(sum(t.amount) filter (
    where t.fiscal_year = 2026
    and t.cr_dr = 'CR'
    and t.category = 'Maintenance'
    and t.row_type != 'VOIDED'
  ), 0)               as collected_fy2627,
  f.maintenance_amt * 12 as annual_due,
  f.maintenance_amt * 12 - coalesce(sum(t.amount) filter (
    where t.fiscal_year = 2026
    and t.cr_dr = 'CR'
    and t.category = 'Maintenance'
    and t.row_type != 'VOIDED'
  ), 0)               as pending,
  case
    when coalesce(sum(t.amount) filter (
      where t.fiscal_year = 2026
      and t.cr_dr = 'CR'
      and t.category = 'Maintenance'
      and t.row_type != 'VOIDED'
    ), 0) >= f.maintenance_amt * 12 then 'Clear'
    when coalesce(sum(t.amount) filter (
      where t.fiscal_year = 2026
      and t.cr_dr = 'CR'
      and t.category = 'Maintenance'
      and t.row_type != 'VOIDED'
    ), 0) > 0 then 'Partial'
    else 'Due'
  end                 as status
from public.flats f
left join public.transactions t on t.flat_code = f.code
group by f.code, f.block, f.flat_type, f.maintenance_amt
order by f.code;

-- Corpus tracker
create or replace view public.v_corpus_tracker as
select
  f.code              as flat_code,
  f.block,
  f.flat_type,
  f.corpus_target,
  coalesce(sum(t.amount) filter (
    where t.cr_dr = 'CR'
    and t.corpus = 'YES'
    and t.row_type != 'VOIDED'
  ), 0)               as collected,
  f.corpus_target - coalesce(sum(t.amount) filter (
    where t.cr_dr = 'CR'
    and t.corpus = 'YES'
    and t.row_type != 'VOIDED'
  ), 0)               as balance,
  round(coalesce(sum(t.amount) filter (
    where t.cr_dr = 'CR'
    and t.corpus = 'YES'
    and t.row_type != 'VOIDED'
  ), 0) * 100.0 / nullif(f.corpus_target, 0), 1) as pct_paid,
  max(t.value_date) filter (
    where t.cr_dr = 'CR'
    and t.corpus = 'YES'
    and t.row_type != 'VOIDED'
  )                   as last_payment_date,
  case
    when coalesce(sum(t.amount) filter (
      where t.cr_dr = 'CR' and t.corpus = 'YES' and t.row_type != 'VOIDED'
    ), 0) >= f.corpus_target then 'Done'
    when coalesce(sum(t.amount) filter (
      where t.cr_dr = 'CR' and t.corpus = 'YES' and t.row_type != 'VOIDED'
    ), 0) > 0 then 'Partial'
    else 'Pending'
  end                 as status
from public.flats f
left join public.transactions t on t.flat_code = f.code
group by f.code, f.block, f.flat_type, f.corpus_target
order by f.code;

-- Monthly expense summary
create or replace view public.v_expenses as
select
  fiscal_label,
  fiscal_year,
  category,
  sum(amount) as total_amount,
  count(*)    as txn_count
from public.transactions
where cr_dr = 'DR'
  and row_type != 'VOIDED'
group by fiscal_label, fiscal_year, category
order by fiscal_year desc, fiscal_label desc, total_amount desc;

-- Monthly summary (for dashboard cards)
create or replace view public.v_monthly_summary as
select
  fiscal_label,
  fiscal_year,
  sum(amount) filter (where cr_dr = 'CR' and category = 'Maintenance' and row_type != 'VOIDED') as maintenance_collected,
  sum(amount) filter (where cr_dr = 'CR' and corpus = 'YES' and row_type != 'VOIDED')           as corpus_collected,
  sum(amount) filter (where cr_dr = 'DR' and row_type != 'VOIDED')                              as total_expenses,
  sum(amount) filter (where cr_dr = 'DR' and category = 'SALARY' and row_type != 'VOIDED')      as salary,
  sum(amount) filter (where cr_dr = 'DR' and category = 'EB' and row_type != 'VOIDED')          as eb,
  count(distinct flat_code) filter (
    where cr_dr = 'CR' and category = 'Maintenance' and row_type != 'VOIDED'
  )                                                                                               as flats_paid
from public.transactions
group by fiscal_label, fiscal_year
order by fiscal_year desc, fiscal_label desc;

-- Review queue — untagged transactions
create or replace view public.v_review_queue as
select
  id,
  txn_id,
  value_date,
  description,
  cr_dr,
  amount,
  flat_code,
  category,
  fiscal_label,
  source,
  upload_id,
  created_at
from public.transactions
where flat_code = 'UNKNOWN'
  and row_type = 'Normal'
order by value_date desc;

-- ── ROW LEVEL SECURITY ────────────────────────────────────────
alter table public.flats        enable row level security;
alter table public.profiles     enable row level security;
alter table public.uploads      enable row level security;
alter table public.transactions enable row level security;
alter table public.split_refs   enable row level security;

-- Authenticated users can read everything
create policy "Authenticated read flats"
  on public.flats for select to authenticated using (true);

create policy "Authenticated read transactions"
  on public.transactions for select to authenticated using (true);

create policy "Authenticated read uploads"
  on public.uploads for select to authenticated using (true);

create policy "Authenticated read split_refs"
  on public.split_refs for select to authenticated using (true);

-- Only authenticated users can insert/update transactions
create policy "Authenticated insert transactions"
  on public.transactions for insert to authenticated with check (true);

create policy "Authenticated update transactions"
  on public.transactions for update to authenticated using (true);

create policy "Authenticated insert uploads"
  on public.uploads for insert to authenticated with check (true);

create policy "Authenticated insert split_refs"
  on public.split_refs for insert to authenticated with check (true);

-- Profiles: users manage their own
create policy "Users read own profile"
  on public.profiles for select to authenticated using (auth.uid() = id);

create policy "Users update own profile"
  on public.profiles for update to authenticated using (auth.uid() = id);

-- ── SEED: FLAT MASTER DATA ────────────────────────────────────
insert into public.flats (code, block, flat_type, maintenance_amt, corpus_target) values
('AF1','A','Flat',1600,21000),('AF2','A','Flat',1550,21000),
('AG1','A','Ground Floor',1600,21000),('AP1','A','Penthouse',1650,21000),
('BF1','B','Flat',1100,18000),('BF2','B','Flat',1400,21000),
('BF3','B','Flat',1400,21000),('BF4','B','Flat',1400,21000),
('BF5','B','Flat',1400,21000),('BF6','B','Flat',1200,18000),
('BG1','B','Ground Floor',1100,18000),('BG2','B','Ground Floor',1200,18000),
('BP1','B','Penthouse',1600,21000),('BP2','B','Penthouse',1600,21000),
('BS1','B','Shop',1400,21000),('BS2','B','Shop',1400,21000),
('CF1','C','Flat',1100,18000),('CF2','C','Flat',1400,21000),
('CF3','C','Flat',1400,21000),('CF4','C','Flat',1550,21000),
('CF5','C','Flat',1400,21000),('CF6','C','Flat',1200,18000),
('CG1','C','Ground Floor',1100,18000),('CG2','C','Ground Floor',1200,18000),
('CP1','C','Penthouse',1600,21000),('CP2','C','Penthouse',1600,21000),
('CS1','C','Shop',1400,21000),('CS2','C','Shop',1550,21000),
('DF1','D','Flat',1550,21000),('DF2','D','Flat',1550,21000),
('DF3','D','Flat',1500,21000),('DF4','D','Flat',1550,21000),
('DG1','D','Ground Floor',1500,21000),('DG2','D','Ground Floor',1500,21000),
('DP1','D','Penthouse',1650,21000),('DP2','D','Penthouse',1650,21000),
('EF1','E','Flat',1500,21000),('EF2','E','Flat',1500,21000),
('EF3','E','Flat',1500,21000),('EF4','E','Flat',1400,21000),
('EG1','E','Ground Floor',1500,21000),('EG2','E','Ground Floor',1300,18000),
('EP1','E','Penthouse',1650,21000),('EP2','E','Penthouse',1650,21000)
on conflict (code) do nothing;

-- ── STORAGE BUCKET FOR RAW UPLOADS ───────────────────────────
insert into storage.buckets (id, name, public)
values ('raw-statements', 'raw-statements', false)
on conflict do nothing;

create policy "Authenticated upload statements"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'raw-statements');

create policy "Authenticated read statements"
  on storage.objects for select to authenticated
  using (bucket_id = 'raw-statements');
