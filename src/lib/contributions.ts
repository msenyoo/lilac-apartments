// A negative drive balance means disbursements exceeded what was actually collected for
// that drive — the shortfall came out of the association's general funds (Maintenance/
// Corpus), not from contributors. Framing it as "Funded by Association" instead of a
// negative "Balance in hand" makes that plain wherever a drive balance is shown.
export function driveBalanceLabel(balance: number): { label: string; amount: number; overpaid: boolean } {
  return balance < 0
    ? { label: 'Funded by Association', amount: -balance, overpaid: true }
    : { label: 'Balance in hand', amount: balance, overpaid: false }
}
