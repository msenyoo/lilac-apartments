import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL  as string
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(supabaseUrl, supabaseKey)

// ── TABLE TYPES ───────────────────────────────────────────────

export interface Flat {
  id: string
  code: string
  block: string
  flat_type: string
  bhk_type: string | null
  has_private_terrace: boolean
  maintenance_amt: number
  corpus_target: number
  flat_notes: string | null
  floor: string | null
  carpet_area: number | null
  plinth_area: number | null
  common_area: number | null
  saleable_area: number | null
  pot_area: number | null
  uds_total: number | null
}

export interface Resident {
  id: string
  flat_id: string
  name: string
  type: 'Owner' | 'Tenant'
  phone: string | null
  email: string | null
  upi_ids: string[]
  moved_in: string | null
  moved_out: string | null
  is_active: boolean
  notes: string | null
  created_at: string
  updated_at: string
  flat?: Flat
}

export interface MaintenanceRateHistory {
  id: string
  flat_id: string
  monthly_rate: number
  effective_from: string
  effective_to: string | null
  notes: string | null
  created_at: string
  created_by: string | null
}

export interface CorpusPlan {
  id: string
  name: string
  description: string | null
  total_target: number
  pre_payments: number
  planned_budget: { category: string; budget: number }[]
  status: 'draft' | 'active' | 'completed' | 'cancelled'
  start_fiscal_year: number | null
  end_fiscal_year: number | null
  closed_at: string | null
  close_notes: string | null
  created_at: string
}

export interface CorpusPlanFlat {
  id: string
  plan_id: string
  flat_id: string
  target_amount: number
  pre_payment: number
  carry_forward_amount: number
  carry_forward_plan_id: string | null
  flat?: Flat
}

export interface CorpusPlanInstallment {
  id: string
  plan_id: string
  installment_no: number
  label: string
  due_date: string | null
  default_amount: number
}

export interface CorpusPlanFlatInstallment {
  id: string
  plan_id: string
  flat_id: string
  installment_no: number
  amount: number
}

export interface Transaction {
  id: string
  txn_id: string | null
  value_date: string
  posted_date: string | null
  description: string
  cr_dr: 'CR' | 'DR'
  amount: number
  flat_id: string | null
  flat_code: string | null
  category: string | null
  corpus: 'YES' | 'NO'
  plan_id: string | null
  fiscal_year: number | null
  fiscal_month: string | null
  fiscal_label: string | null
  source: string
  upload_id: string | null
  split_ref_id: string | null
  split_ref_code: string | null
  row_type: 'Normal' | 'VOIDED' | 'SPLIT'
  months_covered: string | null
  notes: string | null
  created_at: string
}

export interface Upload {
  id: string
  filename: string
  original_name: string
  storage_path: string | null
  uploaded_by: string | null
  month_label: string | null
  total_txns: number
  new_txns: number
  duplicates: number
  review_count: number
  status: string
  created_at: string
}

export interface SplitRef {
  id: string
  ref_code: string
  original_amount: number
  split_count: number
  created_by: string | null
  created_at: string
  notes: string | null
}

export interface Profile {
  id: string
  full_name: string | null
  display_name: string | null
  mobile: string | null
  contact_email: string | null
  flat_id: string | null
  role: string
  created_at: string
}

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

export interface AppSetting {
  key: string
  value: string
  updated_at: string
}

export interface UserRole {
  user_id: string
  role: 'admin' | 'committee' | 'auditor' | 'owner'
  assigned_by: string | null
  assigned_at: string
}

// ── VIEW TYPES ────────────────────────────────────────────────

export interface MonthlyCollection {
  flat_code: string
  block: string
  flat_type: string
  maintenance_amt: number
  fiscal_label: string
  fiscal_year: number
  collected: number
}

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
  arrears_maintenance: number
  arrears_original: number
  arrears_paid: number
  advance_credits: number
  total_outstanding: number
  status: 'Clear' | 'Partial' | 'Due'
}

export interface CorpusEntry {
  flat_code: string
  block: string
  flat_type: string
  plan_id: string
  plan_name: string
  plan_status: 'draft' | 'active' | 'completed' | 'cancelled'
  start_fiscal_year: number
  end_fiscal_year: number
  corpus_target: number
  pre_payment: number
  carry_forward_amount: number
  effective_target: number
  collected: number
  balance: number
  pct_paid: number
  last_payment_date: string | null
  status: 'Done' | 'Partial' | 'Pending'
}

export interface ExpenseEntry {
  fiscal_label: string
  fiscal_year: number
  category: string
  total_amount: number
  txn_count: number
}

export interface MonthlySummary {
  fiscal_label: string
  fiscal_year: number
  maintenance_collected: number
  corpus_collected: number
  total_expenses: number
  salary: number
  eb: number
  flats_paid: number
}

export interface ReviewEntry {
  id: string
  txn_id: string | null
  value_date: string
  description: string
  cr_dr: 'CR' | 'DR'
  amount: number
  flat_code: string
  category: string | null
  fiscal_label: string | null
  source: string
  upload_id: string | null
  created_at: string
}

export interface Deposit {
  id: string
  deposit_no: string
  bank: string
  principal: number
  interest_rate: number
  opened_date: string
  maturity_date: string
  matured_date: string | null
  maturity_amount: number | null
  status: 'active' | 'matured' | 'closed'
  source_type: string
  corpus_plan_id: string | null
  notes: string | null
  created_at: string
}

export interface PendingLineItem {
  id: string
  paid_date: string
  description: string
  amount: number
  payment_mode: 'Cash' | 'Online' | 'Bank Transfer' | 'Cheque'
  reference_no: string | null
  payee_type: 'Staff' | 'Vendor' | 'Utility' | 'Municipal' | 'Other'
  staff_id: string | null
  vendor_id: string | null
  payee_name_raw: string | null
  category_id: string | null
  cost_center: string
  corpus_plan_id: string | null
  notes: string | null
  created_at: string
  created_by: string | null
  voided_at: string | null
  voided_by: string | null
  void_reason: string | null
}
