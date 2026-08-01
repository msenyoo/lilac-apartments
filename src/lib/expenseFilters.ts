// Reports must only reflect confirmed spend: an expense still awaiting committee
// approval hasn't actually cleared, and one paid Online/Bank/Cheque but not yet
// matched to a bank transaction ("Unreconciled") isn't confirmed to have gone
// through as recorded. Cash and Direct (owner-paid) are settled by definition and
// always pass. Mirrors the Cash/Reconciled/Direct/Unreconciled classification in
// v_expense_reconciliation and expenseStatus() in ExpensesPage.tsx.
export function applyReportableFilter<T extends { is: any; eq: any; or: any }>(q: T): T {
  return q
    .is('voided_at', null)
    .eq('approval_status', 'approved')
    .or('payment_mode.eq.Cash,payment_mode.eq.Direct,transaction_id.not.is.null,reconciled_at.not.is.null')
}
