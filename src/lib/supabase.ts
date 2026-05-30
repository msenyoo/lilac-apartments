import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  as string
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(supabaseUrl, supabaseKey)

export type Database = {
  public: {
    Tables: {
      flats:        { Row: Flat }
      transactions: { Row: Transaction }
      uploads:      { Row: Upload }
      split_refs:   { Row: SplitRef }
      profiles:     { Row: Profile }
    }
    Views: {
      v_monthly_collection: { Row: MonthlyCollection }
      v_dues_tracker:       { Row: DuesEntry }
      v_corpus_tracker:     { Row: CorpusEntry }
      v_expenses:           { Row: ExpenseEntry }
      v_monthly_summary:    { Row: MonthlySummary }
      v_review_queue:       { Row: ReviewEntry }
    }
  }
}

export interface Flat {
  id: string
  code: string
  block: string
  flat_type: string
  maintenance_amt: number
  corpus_target: number
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
  role: string
  created_at: string
}

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
  maintenance_amt: number
  collected_fy2627: number
  annual_due: number
  pending: number
  status: 'Clear' | 'Partial' | 'Due'
}

export interface CorpusEntry {
  flat_code: string
  block: string
  flat_type: string
  corpus_target: number
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
