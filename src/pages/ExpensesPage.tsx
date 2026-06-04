import { Receipt } from 'lucide-react'

export default function ExpensesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Expenses</h1>
        <p className="text-sm text-slate-500 mt-1">Day book, reconciliation, vendors &amp; staff</p>
      </div>

      <div className="card p-12 flex flex-col items-center justify-center text-center gap-4">
        <div className="w-14 h-14 rounded-full bg-brand-100 flex items-center justify-center">
          <Receipt size={26} className="text-brand-600" />
        </div>
        <div>
          <p className="text-base font-medium text-slate-800">Expenses module coming soon</p>
          <p className="text-sm text-slate-500 mt-1">
            Day book, staff salary splits, EB line items, sewage tanker logs, and bank reconciliation.
          </p>
        </div>
      </div>
    </div>
  )
}
