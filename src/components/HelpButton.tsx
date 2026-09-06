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
      'Three hero cards: Net Available Cash (Maintenance + Corpus + Contributions balances, plus petty cash), Fixed Deposits (principal locked + next maturity), and Pending Actions (overdue flats + unreconciled expenses + FDs maturing soon).',
      'Maintenance Fund and Corpus Fund panels break each one down into receipts, payments, and available balance.',
      'One combined 12-month chart: stacked Maintenance+Corpus collection bars with an expense line overlay — plus Aging Receivables (top overdue flats) and a Corpus Plans progress list below.',
      'An "Active Contributions" strip appears only when a contribution drive is currently open.',
    ],
    howTo: 'Click any card or list item to jump straight to the relevant page (Dues, Corpus, Finance, Expenses) for more detail.',
  },
  '/transactions': {
    title: 'Transactions',
    bullets: [
      'Three tabs: Upload (Admin only, import a bank statement CSV/PSV), Review (untagged credits waiting to be assigned), and All Transactions (everything, with filters and export). There\'s no separate Tagged or Voided tab.',
      'On Review, click a credit to assign it to a flat and payment type (Maintenance/Corpus — pick a plan too if 2+ are in play), or use Split for a transfer covering multiple flats, or "Bulk Record" to tag a batch of maintenance credits at once.',
      'On All Transactions, click any row to edit or Void it (Admin only) — Void keeps the row for audit but excludes it from every calculation.',
    ],
    howTo: 'Go to Review, click a credit, and Tag it to a flat and payment type. For a combined payment covering several flats, use Split instead.',
  },
  '/dues': {
    title: 'Dues',
    bullets: [
      'Six tabs — Due, 30d+/60d+/90d+ (overdue-severity buckets), Partial, Clear — filtering the same flat list. The tracked fiscal-year range comes from Settings → General, not a dropdown on this page.',
      'Click any flat for its full breakdown (rate, arrears, collected, pending, advance credit) and a Send/Copy WhatsApp reminder for that one flat.',
      '"+ Arrears" (Admin, inside a flat\'s panel) records a carried-forward due or advance credit. "Broadcast" (top of page) builds one combined message for every overdue flat, meant for the residents\' WhatsApp group.',
    ],
    howTo: 'Use the tabs/summary cards to find who\'s overdue, click a flat for detail, and use its Send button for a one-off reminder or Broadcast for a group-wide one.',
  },
  '/corpus': {
    title: 'Corpus',
    bullets: [
      'Tracks corpus fund collection per plan. Draft and Active plans both collect payments identically — Draft just means "not yet formally launched." Only Admin can create, activate, or close a plan.',
      'By Flat tab: target/collected/balance per flat, with WhatsApp reminders (any role can send). Expenditure tab: expenses linked to this plan (link them from the Expenses page\'s "Corpus plan" field, not here).',
      'Running two plans at once is supported and flagged with a warning banner — but an untagged "Corpus" payment can land against the wrong plan if you skip picking one when 2+ exist.',
    ],
    howTo: 'Pick a plan from the dropdown (or "All active plans"). Click a flat in By Flat for its payment history and reminder button.',
  },
  '/contributions': {
    title: 'Contributions',
    bullets: [
      'Tracks voluntary, one-off collections — festival funds, welfare support for staff or their families — kept fully separate from Maintenance and Corpus.',
      'Each cause is its own "drive" with a running balance: money in (bank credits tagged to it) minus money out (the eventual cash withdrawal or handover).',
      'Tag a bank transaction to a drive from the Transactions page — pick the drive directly, or pick a flat first and set its category to "Contribution".',
      'Closing a drive does not require a zero balance — a small carry-forward is fine, just note why in the close notes.',
    ],
    howTo: 'Click "New drive", give it a name (and optional description), then go tag matching transactions to it from Transactions → Review or All Transactions.',
  },
  '/expenses': {
    title: 'Expenses',
    bullets: [
      'Seven tabs: Day Book, Pending Items, Reconcile, Vendors, Staff, Recurring, Petty Cash. "+ Add Expense" works from any of them.',
      'Add Expense saves as approved immediately. Bundling Pending Items is the one path that creates a Pending expense needing Admin approval first — Approve/Reject is Admin-only today.',
      'Pending Items captures small payments as they happen (or via "Bulk add", a paste-from-Excel grid) — select several with the same funding source and "Bundle" into one Day Book expense.',
      'Cash-mode expenses auto-post to Petty Cash and are blocked if they\'d exceed the balance — check that tab if you want to see the running cash-in-hand figure directly.',
      'Reconcile matches Online/Bank Transfer/Cheque expenses to bank debit rows, with green/amber suggestions for exact/close matches.',
      'Recurring is a reference checklist of regular commitments — it does NOT auto-generate expenses; you still add each one manually when it\'s due.',
      'Direct (owner paid) mode records a flat owner paying a vendor directly — a credit/debit pair, net zero to the bank.',
      'Tick Day Book rows and click "Share PDF" for a WhatsApp-ready approval packet.',
    ],
    howTo: 'For a single payment: "+ Add Expense", fill the header, add balanced line items, save. For lots of small payments: log each in Pending Items, then Bundle them later.',
  },
  '/reports': {
    title: 'Reports',
    bullets: [
      'Eight tabs: Cashbook, Flat statement, Dues aging (= Defaulters List, not month-buckets), AGM reports, R&P Statement, Balance Sheet, Expenditure (4 sub-tabs), and Utilities (one tab per Utility-flagged category).',
      'AGM reports tab has 4 one-click PDFs: Defaulters List, Income & Expenditure, Corpus Fund Statement, and Receipts & Payments Account — no preview step, they download immediately.',
      'Flat statement combines one flat\'s maintenance + corpus + transaction history, with its own WhatsApp reminder and Excel/PDF export.',
      'Every tab is available to Admin, Committee, and Auditor — Owner-role residents can\'t reach this page at all.',
    ],
    howTo: 'Pick the tab for what you need, set its fiscal year/month, then Download PDF or Export Excel.',
  },
  '/flats': {
    title: 'Flats & Residents',
    bullets: [
      'Flats tab: master list of all units with current maintenance rate and live Corpus Target/Balance ("—" if a flat has no active/draft plan). Click a flat for its rate history, area details, People card, and a Dues card with a one-tap WhatsApp reminder (Admin/Committee).',
      'Residents tab: every resident across every flat in one grid — add, edit, move out (with household bulk move-out), reactivate, or delete a person (Admin only).',
      'Sender Mappings tab (Admin only): confirm which resident a bank UPI ID or transfer narration belongs to, so future payments auto-tag instead of landing in Transactions Review.',
    ],
    howTo: 'Click any flat row to open its detail panel for rate/area/dues info. Use the Residents tab to manage who lives where, and Sender Mappings to clean up unrecognized payment senders.',
  },
  '/finance': {
    title: 'Fixed Deposits',
    bullets: [
      'Tracks the society\'s bank fixed deposits — principal, rate, maturity date, and interest earned.',
      'KPI cards show total principal locked, nearest upcoming maturity, and cumulative interest earned.',
      'Add a deposit when one is opened, and Mark Matured when it pays out — both can be linked to the matching bank transaction.',
    ],
    howTo: 'Click "Add Deposit" to record a new FD. When it matures, click "Mark Matured" on its row and enter the actual payout amount from the bank.',
  },
  '/announcements': {
    title: 'Announcements',
    bullets: [
      'A notice board for residents — events, utility interruptions, maintenance and governance updates, tagged by type.',
      'Pinned announcements always show at the top of the feed.',
      'Everyone can read this page, including Owner-role residents — but only Admin can post, pin, or delete.',
    ],
    howTo: 'Click "New announcement", write the title and body, pick a tag, and optionally pin it — then post.',
  },
  '/activity': {
    title: 'Activity Log',
    bullets: [
      'A read-only audit trail of every change made across the app, recorded automatically by database triggers.',
      'Filter by table, action (Insert/Update/Delete), and date range. Expand a row to see the before/after values.',
      'Visible to Admin, Committee, and Auditor — Owner-role residents cannot access this page.',
    ],
    howTo: 'Use the filters at the top to narrow down to a specific table, action, or date range, then click a row to see exactly what changed.',
  },
  '/users': {
    title: 'Users & Access',
    bullets: [
      'Admin-only page — manage user accounts and, on the Permissions tab, fine-tune what Committee/Auditor can see.',
      'Add User creates a login (mobile number → mobile@lilac.com) with an auto-generated password you can share via copy or WhatsApp.',
      'Edit a user to change their role, flat assignment, or generate a new password for them — no need to delete and recreate.',
    ],
    howTo: 'Click "Add User" to create a login, or the edit (pencil) icon on an existing user to change their role or reset their password.',
  },
  '/profile': {
    title: 'My Profile',
    bullets: [
      'Update your own display name and contact email — your mobile number (login ID) can\'t be changed here.',
      'Change your own password anytime, without needing an admin — just enter and confirm a new one (8+ characters).',
      'Available to every role — this is your personal account settings page.',
    ],
    howTo: 'Edit your name/email and save, or use the separate "Change password" form to set a new password.',
  },
  '/my-flat': {
    title: 'My Flat',
    bullets: [
      'A read-only, single-flat summary — your maintenance dues status, corpus plan progress, and how corpus funds are being spent.',
      'Shows the society\'s UPI/bank payment details and a suggested payment remark, plus your full payment history with receipt downloads.',
      'The only action here is downloading a fiscal-year statement PDF — there\'s nothing to add or edit.',
    ],
    howTo: 'Scroll through your dues, corpus, and payment history, then click "Download Statement" for a PDF record of the fiscal year.',
  },
  '/settings': {
    title: 'Settings',
    bullets: [
      'General tab: the "Carry-forward from" fiscal year (this, not a Dues-page dropdown, is what actually sets the tracked dues range), UPI/bank collection details for reminders, and "Advance Fiscal Year" to roll the tracked range forward (auto-converts outstanding pending into arrears).',
      'Maintenance Rates tab: bulk rate changes — raise the rate for one flat or a whole block at once with an effective-from date; it applies forward only, never backdated.',
      'Expense Categories tab: manage categories, mark one "Utility" (with a unit label) to give it its own tab in Reports → Utilities.',
      'Import History tab: a log of every bank statement import.',
      'User management and the audit log live on their own pages now (Users, Activity), not inside Settings.',
    ],
    howTo: 'To raise maintenance for one or more flats: Maintenance Rates tab → "Add Rate Change", enter the new amount, effective date, and pick the flats, then save.',
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
