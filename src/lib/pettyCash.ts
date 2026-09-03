export function computePettyCashBalance(txns: { txn_type: string; amount: number }[]): number {
  return txns.reduce((s, t) => t.txn_type === 'Disbursement' ? s - t.amount : s + t.amount, 0)
}
