import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { CircleHelp, CheckCircle2 } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

interface HelpPage {
  title: string
  bullets: string[]
  howTo: string
}

const HELP: Record<string, HelpPage> = {
  '/dashboard': {
    title: 'Dashboard',
    bullets: [
      'KPI cards show total dues pending, corpus pool collected, this month\'s expenses, and unreconciled bank debits.',
      'The bar chart plots maintenance, corpus, and expense totals for the last 12 fiscal months.',
      'Alert strips at the top flag transactions that need tagging, unreconciled expenses, and flats with outstanding dues.',
    ],
    howTo: 'Click any alert strip to jump directly to the relevant page. Use the Quick Links section at the bottom for fast navigation to common tasks.',
  },
  '/transactions': {
    title: 'Transactions',
    bullets: [
      'Upload a bank statement CSV using the Import button — map columns once and the app remembers the format.',
      'Each credit (CR) row needs to be matched to a flat\'s dues payment or corpus contribution.',
      'Unmatched credits stay in the "Unmatched" tab until you tag or dismiss them.',
    ],
    howTo: 'Go to the Review tab, find a CR, and click "Tag" to assign it to a flat and payment type. Matched entries move to the Tagged tab automatically.',
  },
  '/dues': {
    title: 'Dues',
    bullets: [
      'Shows every flat\'s maintenance dues status (Clear / Partial / Due) for the selected fiscal year.',
      'Click any flat row to open a detail panel with the full month-by-month payment history.',
      'Use "Copy WhatsApp reminder" on a flat\'s detail panel to generate a payment reminder message.',
    ],
    howTo: 'Select the fiscal year from the dropdown at the top, then click a flat to see what months are paid and what is outstanding.',
  },
  '/corpus': {
    title: 'Corpus',
    bullets: [
      'Tracks corpus fund collection per installment plan — select a plan from the dropdown.',
      'Each row shows a flat\'s target, amount collected, and remaining balance for the chosen plan.',
      'Click a flat row to see the full installment payment history with dates and amounts.',
    ],
    howTo: 'Pick a corpus plan from the dropdown. Click any flat to expand its payment history and verify installment receipts.',
  },
  '/expenses': {
    title: 'Expenses',
    bullets: [
      'The Day Book tab lists all expenses in chronological order with payee, amount, mode, and category.',
      'Click "Add Expense" to record a new payment — fill in the payee, date, amount, and payment mode, then add line items for the cost breakdown.',
      'The Pending Items tab captures individual small payments (cash, UPI, online) as they happen. Select several and click Bundle to merge them into one Day Book expense.',
      '"Bulk add" in Pending Items opens a spreadsheet-style grid — type rows or paste them straight from Excel (Date, Description, Amount, Category columns) and save them all at once.',
      'Tick one or more Day Book expenses and click "Share PDF" to generate an approval packet (line items + receipt images) for your WhatsApp approval group.',
      'Inside Add Expense, "Add from pending" pulls waiting pending items into the form as line items — receipts carry over and the items leave the pending list when you save.',
      'Items in one bundle must all be either maintenance or all belong to the same corpus plan.',
      'Attach a receipt photo when capturing a pending item — a paper-clip icon shows on items with attachments.',
      'When editing a bundled expense, each line item can be tagged with its own paid date, vendor/staff payee, payment mode, and reference number.',
      'Vendor and Staff tabs let you manage the master lists used when recording expenses.',
    ],
    howTo: 'For single payments: click "Add Expense", fill the header (payee, date, amount, mode), and add at least one line item with a category and amount. For lots of small payments: capture each in Pending Items as you pay it, then bundle them later — the bundled expense enters the normal approval and reconciliation flow.',
  },
  '/reports': {
    title: 'Reports',
    bullets: [
      'Generate collection summaries, corpus fund statements, and AGM-ready financial PDFs.',
      'Available reports include Income & Expenditure, Receipts & Payments, and the Defaulters List.',
      'Use the FY selector to filter all reports to a specific fiscal year before downloading.',
    ],
    howTo: 'Select the fiscal year, choose the report type, and click Generate (or Download PDF) to produce the document.',
  },
  '/flats': {
    title: 'Flats & Residents',
    bullets: [
      'Flat master list showing all units, owner names, and current occupancy status.',
      'Click a flat to view owner details, contact information, and edit if needed.',
      'UPI IDs stored here are used in WhatsApp payment reminder messages.',
    ],
    howTo: 'Click any flat row to open its detail panel. Use the edit button to update owner name, phone number, or UPI ID.',
  },
  '/settings': {
    title: 'Settings',
    bullets: [
      'Add maintenance rate changes — specify the new rate and effective-from date; it applies forward only and does not backdate.',
      'Manage expense categories used when recording day-book entries.',
      'Set the society\'s UPI ID and bank details that appear in WhatsApp payment reminders.',
    ],
    howTo: 'To raise maintenance: click "Add Rate", enter the new amount and effective date, and save. The dues tracker will use the new rate for all months from that date onward.',
  },
  '/help': {
    title: 'Help Center',
    bullets: [
      'Browse all help topics by section using the left sidebar.',
      'Use the search bar at the top to find help for any feature instantly.',
      'Each topic shows step-by-step instructions, role badges (who can do it), and examples.',
    ],
    howTo: 'Click any section in the left panel, then pick a topic to read. Use the search bar to jump straight to what you need.',
  },
}

const DEFAULT_HELP: HelpPage = {
  title: 'Help',
  bullets: [
    'Use the sidebar to navigate between sections.',
    'Each page has contextual help — click the ? button on any page to learn more.',
    'For full documentation open Help Center from the sidebar.',
  ],
  howTo: 'Navigate to a specific page and open the help panel for detailed guidance.',
}

function getHelp(pathname: string): HelpPage {
  if (HELP[pathname]) return HELP[pathname]
  const match = Object.keys(HELP).find(key => pathname.startsWith(key))
  return match ? HELP[match] : DEFAULT_HELP
}

export default function HelpButton() {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const help = getHelp(location.pathname)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Open help"
        className="fixed bottom-20 right-4 z-50 lg:bottom-6 lg:right-6
                   w-11 h-11 rounded-full bg-violet-600 text-white shadow-lg
                   flex items-center justify-center
                   hover:bg-violet-700 active:scale-95
                   transition-all duration-150 focus-visible:outline-none
                   focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
      >
        <CircleHelp size={20} strokeWidth={2} />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="mb-6">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-violet-100 flex items-center justify-center shrink-0">
                <CircleHelp size={15} className="text-violet-600" />
              </div>
              <SheetTitle className="text-base">{help.title}</SheetTitle>
            </div>
          </SheetHeader>

          <section className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">
              What you can do here
            </p>
            <ul className="space-y-3">
              {help.bullets.map((bullet, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <CheckCircle2 size={15} className="text-violet-500 shrink-0 mt-0.5" />
                  <span className="text-sm text-slate-700 leading-relaxed">{bullet}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl bg-violet-50 border border-violet-100 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-500 mb-2">
              How to
            </p>
            <p className="text-sm text-slate-700 leading-relaxed">{help.howTo}</p>
          </section>
        </SheetContent>
      </Sheet>
    </>
  )
}
