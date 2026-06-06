export type Role = 'admin' | 'committee' | 'auditor'

export interface HelpStep {
  text: string
  detail?: string
}

export interface HelpExample {
  label: string
  description: string
}

export interface FlowNode {
  id: string
  label: string
  sublabel?: string
  type: 'start' | 'action' | 'decision' | 'end' | 'data'
}

export interface FlowEdge {
  from: string
  to: string
  label?: string
}

export interface FlowDiagramDef {
  nodes: FlowNode[]
  edges: FlowEdge[]
  direction?: 'horizontal' | 'vertical'
}

export interface HelpItem {
  id: string
  title: string
  summary: string
  roles?: Role[]
  writeRoles?: Role[]
  steps?: HelpStep[]
  examples?: HelpExample[]
  diagram?: FlowDiagramDef
  tips?: string[]
  warnings?: string[]
  relatedIds?: string[]
}

export interface HelpSection {
  id: string
  title: string
  icon: string
  route?: string
  items: HelpItem[]
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: 'Rocket',
    items: [
      {
        id: 'login',
        title: 'How to Log In',
        summary: 'Your login email is your mobile number followed by @lilac.com. Password is set by the admin.',
        steps: [
          { text: 'Open https://lilac-apartments.vercel.app in your browser.' },
          {
            text: 'Enter your email: <mobile>@lilac.com',
            detail: 'Example: if your mobile is 9876543210, your email is 9876543210@lilac.com',
          },
          { text: 'Enter the password provided by your admin.' },
          { text: 'Click Sign in. You will land on the Dashboard.' },
        ],
        tips: [
          'Bookmark the URL so you can access it quickly each time.',
          'Use the mobile browser on your phone — the app is fully responsive.',
        ],
        warnings: [
          'There is no self-service password reset. Contact your admin if you are locked out.',
        ],
        relatedIds: ['roles', 'users-password'],
      },
      {
        id: 'roles',
        title: 'The Three Roles',
        summary: 'Admin has full access, Committee can approve and read, Auditor is read-only.',
        examples: [
          {
            label: 'Admin (Treasurer)',
            description: 'Full read + write access across all pages. Can manage users, import bank statements, add expenses, change rates, and all other mutations.',
          },
          {
            label: 'Committee',
            description: 'Read access to all pages. Can approve expenses. Cannot add, edit, or delete records. Ideal for committee members who review but don\'t manage data.',
          },
          {
            label: 'Auditor',
            description: 'Strictly read-only. Can view all data, generate reports, and export. Cannot modify anything. Suitable for the statutory auditor or external reviewer.',
          },
        ],
        tips: [
          'Your role badge is shown in the top-right corner of every page.',
          'The sidebar shows only the actions available to your role — buttons that require a higher role are hidden or greyed out.',
        ],
        relatedIds: ['users-roles', 'users-add'],
      },
      {
        id: 'navigation',
        title: 'Navigating the App',
        summary: 'Sidebar on desktop, bottom bar on mobile, and a global search with ⌘K.',
        steps: [
          {
            text: 'Desktop: use the left sidebar to move between sections.',
            detail: 'The active page is highlighted in violet. Badge counts (e.g. on Transactions) show items needing attention.',
          },
          {
            text: 'Mobile: use the bottom navigation bar for the four most common pages.',
            detail: 'Tap "More" to open the full menu and access other sections.',
          },
          {
            text: 'Global search: press ⌘K (Mac) or Ctrl+K (Windows) to open the command palette.',
            detail: 'Type a flat number, page name, or action to jump there instantly.',
          },
        ],
        tips: [
          'On desktop, hovering over nav items shows a tooltip with the full label.',
          'The notification bell in the top-right shows a red dot when transactions need tagging.',
        ],
        relatedIds: ['keyboard-shortcuts'],
      },
      {
        id: 'keyboard-shortcuts',
        title: 'Keyboard Shortcuts',
        summary: 'Ctrl+/ opens the Help Center from anywhere. ⌘K opens global search.',
        examples: [
          {
            label: 'Ctrl+/ or Ctrl+?',
            description: 'Open this Help Center from any page.',
          },
          {
            label: '⌘K (Mac) / Ctrl+K (Windows)',
            description: 'Open the global search / command palette to jump to any page or flat.',
          },
          {
            label: 'Escape',
            description: 'Close any open dialog, sheet, or panel.',
          },
        ],
        tips: [
          'The keyboard shortcut Ctrl+/ works even when a text field is not focused.',
        ],
      },
    ],
  },
  {
    id: 'dashboard',
    title: 'Dashboard',
    icon: 'LayoutDashboard',
    route: '/dashboard',
    items: [
      {
        id: 'dashboard-kpis',
        title: 'KPI Cards',
        summary: 'Four cards at the top: total pending dues, corpus pool collected, this month\'s expenses, and unreconciled transactions.',
        examples: [
          {
            label: 'Total Pending Dues',
            description: 'Sum of all outstanding maintenance dues across all flats for the current fiscal year. Click to go to the Dues page.',
          },
          {
            label: 'Corpus Pool',
            description: 'Total corpus fund collected across all active plans. Shows how much has been received vs the overall target.',
          },
          {
            label: 'This Month Expenses',
            description: 'Total expenses recorded with a date falling in the current calendar month.',
          },
          {
            label: 'Unreconciled Transactions',
            description: 'Number of bank statement debits that have been imported but not yet matched to an expense record.',
          },
        ],
        tips: [
          'KPI cards update in real time as data is added or changed.',
          'Click a KPI card to navigate directly to the underlying page.',
        ],
        relatedIds: ['dashboard-alerts', 'dashboard-charts'],
      },
      {
        id: 'dashboard-alerts',
        title: 'Alert Strip',
        summary: 'Coloured banners at the top that flag items requiring your attention.',
        examples: [
          {
            label: 'Transactions need tagging',
            description: 'N credit (CR) rows in the bank statement have not been assigned to a flat and payment type. Click the alert to go directly to the Transactions Review tab.',
          },
          {
            label: 'Unreconciled expenses',
            description: 'Expenses recorded as bank transfers that have not been matched to a corresponding bank debit row. Reconcile before month-end.',
          },
          {
            label: 'Flats with overdue dues',
            description: 'One or more flats have dues unpaid for 2+ months. Click to open the Dues page filtered to overdue flats.',
          },
        ],
        tips: [
          'Alerts disappear automatically once the underlying issue is resolved.',
          'Aim to have zero alerts before the end of each month.',
        ],
        relatedIds: ['txn-review', 'expenses-reconcile', 'dues-statuses'],
      },
      {
        id: 'dashboard-charts',
        title: 'Charts',
        summary: 'Monthly collection vs expenditure bar chart, and a dues status donut chart.',
        examples: [
          {
            label: 'Monthly Bar Chart',
            description: 'Plots maintenance collections (green), corpus collections (violet), and expenses (red/amber) side by side for each of the last 12 fiscal months. Hover a bar for the exact amount.',
          },
          {
            label: 'Dues Status Donut',
            description: 'Shows the proportion of flats in Clear, Partial, and Due status for the current fiscal year. Hover a segment for the count and percentage.',
          },
        ],
        tips: [
          'The fiscal year runs April–March. The bar chart always shows the last 12 fiscal months.',
          'A healthy month has green bars (collections) taller than red bars (expenses).',
        ],
      },
    ],
  },
  {
    id: 'dues',
    title: 'Dues Tracker',
    icon: 'IndianRupee',
    route: '/dues',
    items: [
      {
        id: 'dues-statuses',
        title: 'Dues Status Badges',
        summary: 'Each flat shows Due, Partial, or Clear based on how much has been collected vs. what is owed.',
        examples: [
          {
            label: 'Due (red)',
            description: 'Zero payments received. Example: flat owes ₹27,000 for the year, ₹0 collected.',
          },
          {
            label: 'Partial (amber)',
            description: 'Some payments received but not the full amount owed. Example: ₹27,000 owed, ₹10,000 collected.',
          },
          {
            label: 'Clear (green)',
            description: 'All dues for the fiscal year are fully paid. Example: ₹27,000 owed, ₹27,000 collected.',
          },
        ],
        tips: [
          'A flat can be "Clear" mid-year if they paid in advance for remaining months.',
          'The status resets at the start of each new fiscal year (April 1).',
        ],
        relatedIds: ['dues-calc', 'dues-panel'],
      },
      {
        id: 'dues-calc',
        title: 'How Dues Are Calculated',
        summary: 'Rate × months elapsed in the fiscal year, plus any carry-forward from the previous FY.',
        steps: [
          {
            text: 'The system looks up the maintenance rate history for each flat.',
            detail: 'If the rate changed mid-year, each month uses the rate that was active on the 1st of that month.',
          },
          {
            text: 'It sums up the expected amount for each month from April to the current month.',
            detail: 'Example: ₹1,800/mo × 3 months (Apr–Jun) = ₹5,400 expected so far.',
          },
          {
            text: 'Any unpaid balance carried forward from the previous fiscal year is added on top.',
          },
          {
            text: 'Total collected (tagged bank CRs) is subtracted to get the pending amount.',
          },
        ],
        tips: [
          'Dues are calculated on demand — the system always uses live data from the transactions and rate history tables.',
          'Annual dues (full year) are shown as a reference even mid-year.',
        ],
        relatedIds: ['flats-rate-change', 'dues-statuses'],
      },
      {
        id: 'dues-panel',
        title: 'Flat Drill-Down Panel',
        summary: 'Click any flat row to open a detail panel with month-by-month payments, rate history, and pending amount.',
        steps: [
          { text: 'Click any flat row in the Dues table to open the detail side panel.' },
          { text: 'The top section shows the current rate, annual target, total collected, and pending amount.' },
          {
            text: 'The payment history table lists every tagged bank credit with its date and amount.',
            detail: 'Payments are shown in chronological order. Each payment shows the transaction reference.',
          },
          { text: 'The rate history section shows every rate that applied during the fiscal year with the date range.' },
        ],
        tips: [
          'Use the WhatsApp reminder button inside the panel to quickly send a payment reminder.',
        ],
        relatedIds: ['dues-whatsapp', 'flats-rate-history'],
      },
      {
        id: 'dues-whatsapp',
        title: 'WhatsApp Reminder',
        summary: 'Copy a pre-filled payment reminder message for a flat owner, including UPI ID and pending amount.',
        steps: [
          { text: 'Click on a flat row in the Dues table to open the detail panel.' },
          { text: 'Click "Copy WhatsApp reminder" at the top of the panel.' },
          { text: 'Open WhatsApp on your phone and paste into the flat owner\'s chat.' },
        ],
        examples: [
          {
            label: 'What the message contains',
            description: 'Dear [Owner Name], your maintenance dues for [Flat No] for FY [year] are pending: ₹[amount]. Please pay via UPI to [UPI ID] / Bank transfer to [account details]. Thank you.',
          },
        ],
        tips: [
          'The UPI ID in the reminder comes from Settings → General. Make sure it is up to date.',
          'Owner phone numbers are stored in the Flats → Residents tab.',
        ],
        relatedIds: ['settings-general', 'flats-residents'],
      },
      {
        id: 'dues-export',
        title: 'Export Dues List',
        summary: 'Download the full dues list for the selected fiscal year as an Excel file.',
        steps: [
          { text: 'Select the fiscal year from the dropdown at the top of the Dues page.' },
          { text: 'Click the Export button (spreadsheet icon) in the top-right toolbar.' },
          { text: 'An Excel file downloads with all flats, their annual target, collected amount, and pending balance.' },
        ],
        tips: [
          'The export respects the current filter — if you have searched or filtered by block, only those rows are exported.',
        ],
      },
    ],
  },
  {
    id: 'transactions',
    title: 'Transactions',
    icon: 'Banknote',
    route: '/transactions',
    items: [
      {
        id: 'txn-upload',
        title: 'Upload Bank Statement',
        summary: 'Import a bank statement CSV or PSV file. The app auto-detects column layout and validates rows before importing.',
        roles: ['admin'],
        writeRoles: ['admin'],
        steps: [
          { text: 'Click "Import Statement" on the Transactions page.' },
          {
            text: 'Select your bank statement file (CSV or PSV — pipe-separated).',
            detail: 'Required columns: Date, Description/Narration, Credit amount, Debit amount. Column headers are auto-detected.',
          },
          { text: 'The app shows a preview of the detected rows. Verify the column mapping looks correct.' },
          { text: 'Click "Import" to load all valid rows. Duplicate rows (same date + amount + narration) are skipped automatically.' },
          { text: 'Imported credits (CR) appear in the Review tab awaiting tagging.' },
        ],
        diagram: {
          nodes: [
            { id: 'csv', label: 'CSV / PSV File', type: 'data' },
            { id: 'upload', label: 'Upload', type: 'action' },
            { id: 'detect', label: 'Auto-detect Columns', type: 'action' },
            { id: 'review', label: 'Review Rows', type: 'action' },
            { id: 'tagged', label: 'Tagged', type: 'end' },
          ],
          edges: [
            { from: 'csv', to: 'upload' },
            { from: 'upload', to: 'detect' },
            { from: 'detect', to: 'review' },
            { from: 'review', to: 'tagged' },
          ],
        },
        tips: [
          'Both comma-separated (CSV) and pipe-separated (PSV) formats are supported and auto-detected.',
          'Re-importing the same file is safe — duplicates are detected by date + narration + amount.',
        ],
        relatedIds: ['txn-review', 'faq-upload-format'],
      },
      {
        id: 'txn-review',
        title: 'Review Untagged Transactions',
        summary: 'The Review tab shows untagged credit rows. Assign each to a flat and payment type.',
        writeRoles: ['admin'],
        steps: [
          { text: 'Go to Transactions → Review tab. All untagged credits (CRs) appear here.' },
          { text: 'Click a row to open the tagging panel on the right.' },
          {
            text: 'Select the Flat from the dropdown.',
            detail: 'Start typing the flat number or owner name to filter the list.',
          },
          {
            text: 'Select the Payment type: Maintenance dues or Corpus contribution.',
          },
          { text: 'Optionally select the Corpus plan if the type is Corpus.' },
          { text: 'Click "Tag" to save. The row moves to the Tagged tab and updates the flat\'s dues/corpus records.' },
        ],
        tips: [
          'If a transfer covers multiple flats (combined payment), use the Split function instead.',
          'Tagging a credit as Maintenance automatically credits that flat\'s dues for the fiscal year.',
        ],
        relatedIds: ['txn-split', 'txn-void'],
      },
      {
        id: 'txn-edit',
        title: 'Edit a Transaction',
        summary: 'Change the flat assignment or payment type of an already-tagged transaction.',
        writeRoles: ['admin'],
        steps: [
          { text: 'Go to the Tagged tab and find the transaction you need to correct.' },
          { text: 'Click the Edit (pencil) icon on the row.' },
          { text: 'Change the flat, payment type, or corpus plan as needed.' },
          { text: 'Click Save. The change is recorded in the audit log with the previous and new values.' },
        ],
        warnings: [
          'Editing a tagged transaction affects the flat\'s dues balance immediately. Double-check before saving.',
        ],
        relatedIds: ['txn-void', 'activity-what'],
      },
      {
        id: 'txn-void',
        title: 'Void a Transaction',
        summary: 'Void marks a transaction as invalid without deleting it. The audit trail is fully preserved.',
        writeRoles: ['admin'],
        steps: [
          { text: 'Find the transaction in the Tagged or All tab.' },
          { text: 'Click the Void button (or the actions menu → Void).' },
          { text: 'Confirm the void. The row is marked VOIDED and excluded from all calculations.' },
        ],
        examples: [
          {
            label: 'When to void',
            description: 'Wrong import file imported by mistake, test rows added during setup, or a duplicate entry that slipped past deduplication.',
          },
        ],
        warnings: [
          'Void does NOT delete the row. The row remains in the database with a VOIDED status for audit purposes.',
          'A voided transaction cannot be un-voided. Create a fresh import if needed.',
        ],
        relatedIds: ['faq-void-vs-delete', 'txn-edit'],
      },
      {
        id: 'txn-split',
        title: 'Split a Transaction',
        summary: 'Map one bank credit to multiple flats when a combined transfer covers several residents.',
        writeRoles: ['admin'],
        steps: [
          { text: 'In the Review tab, click on the combined credit row.' },
          { text: 'Click "Split" instead of "Tag".' },
          {
            text: 'Add a split entry for each flat: select the flat, payment type, and amount.',
            detail: 'Example: ₹6,000 CR → Flat A1 ₹3,000 (Maintenance) + Flat B2 ₹3,000 (Maintenance).',
          },
          { text: 'The total of all splits must equal the original transaction amount. A running balance shows how much remains to be allocated.' },
          { text: 'Click "Save Split" to confirm. Each flat\'s dues record is updated accordingly.' },
        ],
        tips: [
          'Splits are common when a family pays dues for multiple flats in one transfer.',
        ],
        relatedIds: ['txn-review', 'txn-edit'],
      },
      {
        id: 'txn-export',
        title: 'Export Transactions',
        summary: 'Download filtered transactions to an Excel file for external reporting or reconciliation.',
        steps: [
          { text: 'Apply any filters you need: date range, status (Tagged/Untagged/Voided), type (CR/DR).' },
          { text: 'Click the Export button in the toolbar.' },
          { text: 'An Excel file downloads with all visible rows and their current tagging details.' },
        ],
        tips: [
          'Export works on any tab — Tagged, Review, or All.',
        ],
      },
    ],
  },
  {
    id: 'corpus',
    title: 'Corpus Fund',
    icon: 'Building2',
    route: '/corpus',
    items: [
      {
        id: 'corpus-what',
        title: 'What Is the Corpus Fund?',
        summary: 'A one-time capital collection for major works like painting, electrical upgrades, or solar panels — separate from monthly maintenance.',
        examples: [
          {
            label: 'Corpus vs Maintenance',
            description: 'Maintenance is ₹1,800/month recurring to cover day-to-day running costs (security, sweeping, EB, water). Corpus is a separate one-time collection for a specific capital project, spread over installments.',
          },
          {
            label: 'Typical corpus plans',
            description: 'Exterior painting plan (₹5,000/flat, 2 installments), Solar panel installation (₹15,000/flat, 3 installments), Electrical rewiring (₹8,000/flat).',
          },
        ],
        tips: [
          'Each corpus plan has its own target per flat. Different flat types (2BHK vs 3BHK) can have different targets.',
          'Corpus collections are tracked separately from maintenance and have their own reports.',
        ],
        relatedIds: ['faq-corpus-vs-maintenance', 'corpus-statuses'],
      },
      {
        id: 'corpus-statuses',
        title: 'Corpus Plan Statuses',
        summary: 'Plans move through Draft → Active → Completed or Cancelled.',
        examples: [
          {
            label: 'Draft',
            description: 'Plan created but not yet activated. Per-flat targets are being configured. Payments cannot be tagged to a Draft plan.',
          },
          {
            label: 'Active',
            description: 'Collection is in progress. Bank credits can be tagged as corpus contributions against this plan.',
          },
          {
            label: 'Completed',
            description: 'All flats have paid in full (or the plan is manually marked complete). No further collections expected.',
          },
          {
            label: 'Cancelled',
            description: 'Plan abandoned. All associated payments remain in the audit trail but the plan is excluded from active dashboards.',
          },
        ],
        warnings: [
          'Only Admin can change a plan\'s status. Once Completed or Cancelled, the plan cannot be reopened.',
        ],
        relatedIds: ['corpus-what', 'corpus-progress'],
      },
      {
        id: 'corpus-progress',
        title: 'Reading Progress Bars',
        summary: 'Each plan shows a progress bar for overall collection and, separately, spending from corpus funds.',
        examples: [
          {
            label: 'Collection progress',
            description: 'Green bar: total collected ÷ total target across all flats. Example: ₹1,20,000 collected of ₹2,00,000 target = 60%.',
          },
          {
            label: 'Expenditure progress',
            description: 'Violet bar: amount spent from this corpus plan (via linked expenses) ÷ total collected. Shows what proportion of collected funds has been deployed.',
          },
        ],
        tips: [
          'A healthy corpus plan has collection progress ahead of expenditure progress.',
          'Hover over a progress bar to see the exact amounts.',
        ],
        relatedIds: ['corpus-expenditure', 'corpus-byfat'],
      },
      {
        id: 'corpus-byfat',
        title: 'By Flat Tab',
        summary: 'View per-flat installment breakdown: target, paid, and remaining for each flat in the selected plan.',
        steps: [
          { text: 'Select a corpus plan from the dropdown.' },
          { text: 'Click the "By Flat" tab.' },
          { text: 'Each row shows: Flat, Target amount, Amount paid, Remaining balance, and payment dates.' },
          { text: 'Click any flat row to see the full installment payment history with dates and amounts.' },
        ],
        tips: [
          'Flats with a pre-payment (paid before the plan was activated) show the pre-payment amount in a separate column.',
        ],
        relatedIds: ['corpus-progress', 'corpus-statuses'],
      },
      {
        id: 'corpus-expenditure',
        title: 'Corpus Expenditure Tab',
        summary: 'See which expenses have been charged to this corpus plan and how much of the collected fund has been deployed.',
        steps: [
          { text: 'Select a corpus plan and click the "Expenditure" tab.' },
          { text: 'Each row lists an expense (with voucher number, payee, date, and amount) linked to this corpus plan.' },
          { text: 'The summary shows total collected vs. total spent, and the remaining corpus balance.' },
        ],
        tips: [
          'An expense is linked to a corpus plan by selecting the plan in the expense\'s "Corpus plan" field when adding the expense.',
        ],
        relatedIds: ['expenses-add', 'corpus-progress'],
      },
    ],
  },
  {
    id: 'expenses',
    title: 'Expenses',
    icon: 'Receipt',
    route: '/expenses',
    items: [
      {
        id: 'expenses-what',
        title: 'What Is an Expense?',
        summary: 'An expense records an actual bank debit made by the committee — separate from dues collections coming in.',
        examples: [
          {
            label: 'Maintenance expense',
            description: 'Monthly salary transfer to security agency (AG1), EB bill payment to TNEB, water tanker charges, sweeping staff salary.',
          },
          {
            label: 'Corpus expense',
            description: 'Contractor payment for exterior painting, electrician charges for rewiring, solar panel vendor invoice.',
          },
        ],
        tips: [
          'Expenses flow out of the society\'s bank account. Dues flow in. They are tracked separately.',
          'Every expense gets a voucher number (EXP-YYYY-NNNN) auto-assigned by the system.',
        ],
        relatedIds: ['expenses-hub-spoke', 'expenses-add', 'expenses-voucher'],
      },
      {
        id: 'expenses-hub-spoke',
        title: 'Hub-and-Spoke Model',
        summary: 'The committee transfers a lump sum to an intermediary (AG1, CG1 Raja) who distributes to individual staff. Record the total transfer as the header, then each recipient as a line item.',
        examples: [
          {
            label: 'Security staff via AG1',
            description: 'The committee transfers ₹25,000 to AG1 (the security agency). AG1 pays Guard 1 ₹8,000, Guard 2 ₹8,000, Sweeper 1 ₹4,500, Sweeper 2 ₹4,500. The header is ₹25,000 to AG1; the line items are the four individual payments.',
          },
          {
            label: 'EB bill via CG1 Raja',
            description: 'CG1 Raja collects EB bills block by block, pays TNEB, and gets reimbursed. Header: total EB transfer. Line items: Block-A EB ₹X, Block-B EB ₹Y, Common area EB ₹Z.',
          },
        ],
        diagram: {
          nodes: [
            { id: 'bank', label: 'Committee Bank', type: 'start' },
            { id: 'ag1', label: 'AG1', sublabel: 'Header ₹25,000', type: 'action' },
            { id: 'g1', label: 'Guard 1', sublabel: '₹8,000', type: 'end' },
            { id: 'g2', label: 'Guard 2', sublabel: '₹8,000', type: 'end' },
            { id: 'sw1', label: 'Sweeper 1', sublabel: '₹4,500', type: 'end' },
            { id: 'sw2', label: 'Sweeper 2', sublabel: '₹4,500', type: 'end' },
          ],
          edges: [
            { from: 'bank', to: 'ag1', label: '₹25,000' },
            { from: 'ag1', to: 'g1' },
            { from: 'ag1', to: 'g2' },
            { from: 'ag1', to: 'sw1' },
            { from: 'ag1', to: 'sw2' },
          ],
        },
        tips: [
          'The line items must sum exactly to the header amount. The system shows a running balance and turns green when balanced.',
          'Each line item can have a different category and cost centre (Block-A, Block-B, Common, etc.).',
        ],
        relatedIds: ['expenses-add', 'expenses-staff'],
      },
      {
        id: 'expenses-add',
        title: 'Adding an Expense',
        summary: 'Step-by-step guide to recording a new expense with header fields and line items.',
        writeRoles: ['admin'],
        steps: [
          { text: 'Click "+ Add Expense" on the Expenses → Day Book tab.' },
          {
            text: 'Fill in the header fields: Date, Total Amount, Payee type (Vendor / Staff / Other), Vendor / Staff name (dropdown), Payment mode (Bank transfer / Cash / Cheque), Reference/UTR number.',
          },
          {
            text: 'Select the Category (e.g. Security, EB, Maintenance, Corpus works).',
            detail: 'Categories are configured in Settings → Categories. Mark a category as "Utility" if it should appear in utility reports.',
          },
          {
            text: 'If this is a capital expense, select the Corpus plan from the dropdown.',
            detail: 'Linking an expense to a corpus plan deducts from that plan\'s remaining balance.',
          },
          { text: 'Add optional Notes for any context (e.g. "June salary, includes overtime").' },
          {
            text: 'Add line items: for each line, enter Description, Amount, Category, Cost centre (Block-A/B/C/D/E, Common, Municipal, All), Payee type, and optional Period from/to.',
            detail: 'The running total at the bottom of the line items shows how much remains to allocate. It turns green when all amounts sum to the header.',
          },
          { text: 'Click Save. The voucher number (EXP-YYYY-NNNN) is auto-assigned.' },
        ],
        diagram: {
          nodes: [
            { id: 'header', label: 'Header', sublabel: 'Bank transfer details', type: 'start' },
            { id: 'lines', label: 'Line Items', sublabel: 'Invoice breakdown', type: 'action' },
            { id: 'voucher', label: 'Voucher', sublabel: 'EXP-YYYY-NNNN', type: 'end' },
          ],
          edges: [
            { from: 'header', to: 'lines' },
            { from: 'lines', to: 'voucher', label: 'Auto-assigned' },
          ],
        },
        tips: [
          'Use the "Cash" payment mode for petty cash expenses — these won\'t appear in the bank statement and don\'t need reconciliation.',
          'If the payee is a new vendor, you can add them on the fly from the Vendors tab before creating the expense.',
        ],
        warnings: [
          'Line item amounts must add up exactly to the header amount. You cannot save until they balance.',
        ],
        relatedIds: ['expenses-hub-spoke', 'expenses-statuses', 'expenses-vendors'],
      },
      {
        id: 'expenses-statuses',
        title: 'Expense Statuses',
        summary: 'Cash, Unreconciled, and Reconciled — indicating how the expense relates to the bank statement.',
        examples: [
          {
            label: 'Cash',
            description: 'Petty cash expense paid from the cash box. Will never appear as a bank debit. No reconciliation needed.',
          },
          {
            label: 'Unreconciled',
            description: 'Bank transfer recorded in the system but not yet matched to a corresponding bank statement debit row. The transfer happened but the bank statement import hasn\'t been matched yet.',
          },
          {
            label: 'Reconciled',
            description: 'The expense has been matched (linked) to a specific bank statement debit row. The bank record and the expense record are confirmed to be the same payment.',
          },
        ],
        tips: [
          'Reconcile all bank-transfer expenses before month-end to ensure your books match the bank statement.',
          'Cash expenses never need reconciliation — they are self-contained.',
        ],
        relatedIds: ['expenses-reconcile', 'faq-reconciliation'],
      },
      {
        id: 'expenses-reconcile',
        title: 'Reconciliation',
        summary: 'Match unreconciled expenses to their corresponding bank statement debit rows side-by-side.',
        writeRoles: ['admin'],
        steps: [
          { text: 'Go to Expenses → Reconciliation tab.' },
          {
            text: 'The left panel lists all Unreconciled expenses (bank transfers recorded but not matched).',
            detail: 'Each row shows: voucher number, payee, date, amount.',
          },
          {
            text: 'The right panel lists all unmatched bank debit (DR) rows from the imported bank statement.',
          },
          {
            text: 'Click an expense on the left, then click the matching bank DR on the right. Both will highlight.',
          },
          { text: 'Click "Link" to confirm the match. The expense status changes to Reconciled.' },
        ],
        diagram: {
          nodes: [
            { id: 'exp', label: 'Unreconciled Expense', type: 'data' },
            { id: 'match', label: 'Match', type: 'decision' },
            { id: 'bank', label: 'Bank DR Row', type: 'data' },
            { id: 'done', label: 'Reconciled', type: 'end' },
          ],
          edges: [
            { from: 'exp', to: 'match' },
            { from: 'bank', to: 'match' },
            { from: 'match', to: 'done', label: 'Link' },
          ],
        },
        tips: [
          'Sort both panels by amount to quickly find matching pairs.',
          'If amounts differ slightly (e.g. bank charges), you can override the match with a note.',
        ],
        relatedIds: ['expenses-statuses', 'faq-reconciliation'],
      },
      {
        id: 'expenses-vendors',
        title: 'Vendors',
        summary: 'Maintain the vendor master list used when recording expenses. Includes name, type, phone, and PAN for TDS.',
        writeRoles: ['admin'],
        steps: [
          { text: 'Go to Expenses → Vendors tab.' },
          { text: 'Click "Add Vendor" to create a new vendor.' },
          {
            text: 'Enter: Name, Vendor type (Contractor / Service provider / Utility / Other), Phone, PAN number (for TDS tracking), and optional notes.',
          },
          { text: 'Click Save. The vendor now appears in the Payee dropdown when adding expenses.' },
        ],
        tips: [
          'PAN numbers are required for vendors subject to TDS (typically contractors paid above ₹30,000 per year).',
          'You can edit vendor details at any time without affecting past expense records.',
        ],
        relatedIds: ['expenses-add', 'expenses-staff'],
      },
      {
        id: 'expenses-staff',
        title: 'Staff',
        summary: 'Staff master with salary history and effective dates, used in payroll-type expenses.',
        writeRoles: ['admin'],
        steps: [
          { text: 'Go to Expenses → Staff tab.' },
          { text: 'Click "Add Staff" to create a new staff member.' },
          { text: 'Enter: Name, Role (Security Guard / Sweeper / Other), Phone, and current monthly salary.' },
          {
            text: 'To record a salary change, click the staff row → "Change Salary" → enter the new amount and effective date.',
            detail: 'Historical salary rates are preserved. The system uses the rate in effect on the expense date.',
          },
        ],
        tips: [
          'Staff records are separate from residents — they do not have login access.',
          'Salary history is used in the Staff salary report to show per-person cost trends.',
        ],
        relatedIds: ['expenses-hub-spoke', 'expenses-add'],
      },
      {
        id: 'expenses-voucher',
        title: 'Voucher Numbers',
        summary: 'EXP-YYYY-NNNN format, auto-assigned, sequential per fiscal year, never reused, used for audit.',
        examples: [
          {
            label: 'EXP-2025-0001',
            description: 'First expense of fiscal year 2025-26 (April 2025 onwards).',
          },
          {
            label: 'EXP-2026-0047',
            description: 'The 47th expense in fiscal year 2026-27.',
          },
        ],
        tips: [
          'Voucher numbers are assigned by a database trigger — they are guaranteed to be sequential and unique.',
          'Use the voucher number when referencing expenses in audit queries or external correspondence.',
          'Voided expenses retain their voucher numbers — the number is never reused.',
        ],
        warnings: [
          'You cannot manually set or change a voucher number.',
        ],
        relatedIds: ['activity-what', 'faq-void-vs-delete'],
      },
    ],
  },
  {
    id: 'flats',
    title: 'Flats & Residents',
    icon: 'Users',
    route: '/flats',
    items: [
      {
        id: 'flats-grid',
        title: 'Flat Master Grid',
        summary: 'Full list of all units with flat code, block, type, BHK, terrace, maintenance rate, and corpus target.',
        examples: [
          {
            label: 'Columns explained',
            description: 'Flat code (e.g. A-101), Block (A–E), Unit type (Apartment / Penthouse / Shop), BHK, P.T. (private terrace — Y/N), Rate/mo (current maintenance rate), Corpus target (total corpus obligation for the active plan).',
          },
        ],
        tips: [
          'Click any column header to sort. Use the search box to find a specific flat or owner name.',
          'AG Grid allows you to resize columns by dragging the column header border.',
        ],
        relatedIds: ['flats-rate-change', 'flats-residents'],
      },
      {
        id: 'flats-rate-change',
        title: 'Change Maintenance Rate',
        summary: 'Update the maintenance rate for a flat with an effective date. Applies forward-only — past months are not affected.',
        writeRoles: ['admin'],
        steps: [
          { text: 'Click a flat row to open the detail panel.' },
          { text: 'Click "Change maintenance rate" in the panel header.' },
          {
            text: 'Enter the new rate (in rupees per month) and the effective-from date.',
            detail: 'The effective date must be the 1st of a month. Example: 2026-07-01 means the new rate applies from July 2026.',
          },
          { text: 'Click Save. The rate history table updates immediately.' },
        ],
        diagram: {
          nodes: [
            { id: 'old', label: 'Old Rate', sublabel: '₹1,600/mo Apr 2024–Jun 2026', type: 'data' },
            { id: 'change', label: 'Rate Change', type: 'action' },
            { id: 'new', label: 'New Rate', sublabel: '₹1,800/mo Jul 2026–now', type: 'end' },
          ],
          edges: [
            { from: 'old', to: 'change' },
            { from: 'change', to: 'new' },
          ],
        },
        warnings: [
          'Rates are forward-only. Changing the rate does not recalculate past months\' dues.',
          'To correct a past rate error, contact admin. There is no backdating feature.',
        ],
        relatedIds: ['flats-rate-history', 'dues-calc', 'faq-rate-backdating'],
      },
      {
        id: 'flats-rate-history',
        title: 'Rate History',
        summary: 'Full history of all maintenance rate changes for a flat, with date ranges and who made each change.',
        steps: [
          { text: 'Click a flat row to open the detail panel.' },
          { text: 'Scroll to the "Rate History" section.' },
          { text: 'Each row shows: effective-from date, effective-to date, rate, and the admin user who set it.' },
        ],
        tips: [
          'The audit log (Activity page) contains even more detail about who changed what and when.',
        ],
        relatedIds: ['flats-rate-change', 'activity-what'],
      },
      {
        id: 'flats-residents',
        title: 'Residents Tab',
        summary: 'Owner vs tenant details including contact phone and UPI ID used in payment reminders.',
        steps: [
          { text: 'Click a flat row → Residents tab (if not already visible).' },
          { text: 'The Owner row shows: name, phone, email, UPI ID, and move-in date.' },
          { text: 'If a tenant lives in the flat, a Tenant row appears below the owner with their contact details.' },
          { text: 'Click Edit to update any resident details. Changes are recorded in the audit log.' },
        ],
        tips: [
          'The UPI ID stored here appears in the WhatsApp reminder message generated from the Dues page.',
          'Keep phone numbers up to date — they are the primary contact for payment reminders.',
        ],
        relatedIds: ['dues-whatsapp', 'flats-grid'],
      },
    ],
  },
  {
    id: 'reports',
    title: 'Reports',
    icon: 'FileText',
    route: '/reports',
    items: [
      {
        id: 'reports-collection',
        title: 'Collection Reports',
        summary: 'Monthly collection totals, flat-wise payment history, dues aging, and defaulters list.',
        steps: [
          { text: 'Go to Reports → Collection tab.' },
          { text: 'Select the fiscal year from the dropdown.' },
          { text: 'Choose a report type: Monthly summary, Flat-wise history, Dues aging, or Defaulters list.' },
          { text: 'Click Generate / Download PDF to produce the report.' },
        ],
        examples: [
          {
            label: 'Defaulters List',
            description: 'All flats with outstanding dues as of today, sorted by pending amount (largest first). Required for AGM.',
          },
          {
            label: 'Dues Aging',
            description: 'Flats grouped by how many months they have been in arrears: 1 month, 2–3 months, 4–6 months, 6+ months.',
          },
        ],
        relatedIds: ['reports-agm', 'dues-statuses'],
      },
      {
        id: 'reports-corpus',
        title: 'Corpus Fund Statement',
        summary: 'Per-plan, per-flat progress report showing collections and expenditure. Required for AGM.',
        steps: [
          { text: 'Go to Reports → Corpus tab.' },
          { text: 'Select the corpus plan from the dropdown.' },
          { text: 'Click "Download PDF" to generate the AGM-ready statement.' },
        ],
        tips: [
          'The Corpus Fund Statement is a required document for the AGM. Generate it before the meeting.',
        ],
        relatedIds: ['corpus-what', 'reports-agm'],
      },
      {
        id: 'reports-agm',
        title: 'AGM Reports (PDF)',
        summary: 'Income & Expenditure Statement, Receipts & Payments, Defaulters List, and Corpus Fund Statement — all in-browser PDF preview before download.',
        steps: [
          { text: 'Go to Reports → AGM tab.' },
          { text: 'Select the fiscal year.' },
          { text: 'Click any report to open an in-browser PDF preview.' },
          { text: 'Click "Download PDF" in the preview toolbar to save the file.' },
        ],
        examples: [
          {
            label: 'Income & Expenditure Statement',
            description: 'Summary of all income (maintenance + corpus + other) vs. all expenses for the fiscal year. Required for statutory audit.',
          },
          {
            label: 'Receipts & Payments',
            description: 'Cash-flow view: opening balance, all receipts, all payments, closing balance.',
          },
        ],
        tips: [
          'PDF generation happens in the browser — no server call required. Works offline once the page has loaded.',
          'Generate all four AGM reports and send them to the statutory auditor at least 15 days before the AGM.',
        ],
        relatedIds: ['reports-collection', 'reports-corpus'],
      },
      {
        id: 'reports-expenditure',
        title: 'Expenditure Reports',
        summary: 'Category-wise expenses, vendor payment history, salary summary, and EB units per block.',
        examples: [
          {
            label: 'Category-wise',
            description: 'Total spending per category (Security, EB, Water, Maintenance works, etc.) for the selected period.',
          },
          {
            label: 'Vendor payments',
            description: 'All payments made to a specific vendor in the fiscal year — useful for TDS calculations.',
          },
          {
            label: 'Salary history',
            description: 'Month-by-month salary payments per staff member, including any mid-year salary changes.',
          },
        ],
        relatedIds: ['expenses-vendors', 'expenses-staff'],
      },
      {
        id: 'reports-utility',
        title: 'Utility Reports',
        summary: 'EB consumption by block, sewage tanker log, and year-over-year comparison.',
        examples: [
          {
            label: 'EB by block',
            description: 'Monthly electricity consumption (units) and cost split by Block-A through Block-E and Common area. Data comes from expenses tagged with Utility categories and cost centres.',
          },
          {
            label: 'Year-over-year',
            description: 'Compare EB spend this fiscal year vs. the previous year to identify trends.',
          },
        ],
        tips: [
          'Utility data is only available if expenses are recorded with a Utility category (configured in Settings → Categories).',
        ],
        relatedIds: ['settings-categories', 'reports-expenditure'],
      },
    ],
  },
  {
    id: 'settings',
    title: 'Settings',
    icon: 'Settings',
    route: '/settings',
    items: [
      {
        id: 'settings-general',
        title: 'General Settings',
        summary: 'UPI ID, bank transfer details, society name, and carry-forward fiscal year selector.',
        writeRoles: ['admin'],
        steps: [
          { text: 'Go to Settings → General tab.' },
          { text: 'Update the UPI ID — this appears in all WhatsApp payment reminders.' },
          { text: 'Update bank account details (account number, IFSC, bank name) — also appear in reminders.' },
          { text: 'Set the "Carry-forward FY" to control which previous year\'s unpaid dues are brought forward.' },
          { text: 'Click Save.' },
        ],
        tips: [
          'The society name shown here appears in the header of all generated PDF reports.',
          'Double-check the UPI ID whenever you change bank accounts — a wrong UPI causes residents to pay the wrong account.',
        ],
        relatedIds: ['dues-whatsapp', 'settings-categories'],
      },
      {
        id: 'settings-categories',
        title: 'Expense Categories',
        summary: 'Add and edit expense categories. Mark as Utility to enable per-block tracking in Utility reports.',
        writeRoles: ['admin'],
        steps: [
          { text: 'Go to Settings → Categories tab.' },
          { text: 'Click "Add Category" to create a new category.' },
          {
            text: 'Enter: Name, Budget type (Maintenance or Corpus), and check "Utility" if this category should appear in Utility reports with per-block tracking.',
          },
          { text: 'Click Save. The category is immediately available in the Add Expense form.' },
        ],
        examples: [
          {
            label: 'Utility category example',
            description: '"EB — Block A" with Utility flag set. Expenses in this category will appear in the EB consumption report broken down by block.',
          },
        ],
        tips: [
          'Cannot delete a category that is already used in expenses. Instead, rename it or mark it inactive.',
        ],
        relatedIds: ['expenses-add', 'reports-utility'],
      },
      {
        id: 'settings-rates',
        title: 'Maintenance Rates Overview',
        summary: 'Read-only summary of all current maintenance rates across all flats.',
        steps: [
          { text: 'Go to Settings → Rates tab.' },
          { text: 'The table shows each flat\'s current rate and the date it took effect.' },
          { text: 'To change a rate, go to the Flats page → click the flat → Change maintenance rate.' },
        ],
        tips: [
          'This view is a quick reference. All rate changes must be made from the Flats page.',
        ],
        relatedIds: ['flats-rate-change', 'flats-rate-history'],
      },
      {
        id: 'settings-import-history',
        title: 'Import History',
        summary: 'List of all bank statement uploads with row counts, import date, and the user who imported.',
        steps: [
          { text: 'Go to Settings → Import History tab.' },
          { text: 'Each row shows: import date/time, filename, rows imported, rows skipped (duplicates), and the importing user.' },
        ],
        tips: [
          'Use Import History to confirm whether a specific bank statement month has been imported.',
          'If you accidentally imported a wrong file, contact admin to void the affected transactions.',
        ],
        relatedIds: ['txn-upload', 'txn-void'],
      },
    ],
  },
  {
    id: 'users',
    title: 'Users & Access',
    icon: 'Shield',
    route: '/users',
    items: [
      {
        id: 'users-roles',
        title: 'Role Permissions Matrix',
        summary: 'Admin has full access, Committee can read and approve, Auditor is read-only.',
        roles: ['admin', 'committee', 'auditor'],
        examples: [
          {
            label: 'Admin',
            description: 'Import bank statements, tag transactions, add/edit/delete expenses, change maintenance rates, manage corpus plans, manage users, generate all reports, view audit log. Full read + write access everywhere.',
          },
          {
            label: 'Committee',
            description: 'View all data on every page. Approve expenses. Generate and download reports. Cannot add, edit, or delete records. Cannot manage users or change rates.',
          },
          {
            label: 'Auditor',
            description: 'View all data. Generate and download all reports. Strictly read-only — no mutations, no user management.',
          },
        ],
        tips: [
          'Role badges are shown in the top-right of the app and in the sidebar footer.',
          'Action buttons (Add, Edit, Delete) are hidden from Committee and Auditor users, not just disabled.',
        ],
        relatedIds: ['users-add', 'users-edit'],
      },
      {
        id: 'users-add',
        title: 'Add a User',
        summary: 'Admin-only: create a new user account. Login email is auto-constructed as mobile@lilac.com.',
        roles: ['admin'],
        writeRoles: ['admin'],
        steps: [
          { text: 'Go to Settings → Users tab (or the /users page).' },
          { text: 'Click "Add User".' },
          {
            text: 'Enter the user\'s full name.',
          },
          {
            text: 'Enter their 10-digit mobile number (no spaces or country code).',
            detail: 'The login email is auto-constructed: 9876543210 → 9876543210@lilac.com',
          },
          { text: 'Set an initial password (share it securely with the user).' },
          { text: 'Select the role: Admin, Committee, or Auditor.' },
          { text: 'Click "Create User". The user can log in immediately.' },
        ],
        tips: [
          'The new user\'s email is always <mobile>@lilac.com. They cannot change it.',
          'You can have multiple Admin users — useful when there is more than one treasurer.',
        ],
        warnings: [
          'Share passwords securely (in person or via an encrypted channel). Do not send passwords over SMS or WhatsApp.',
        ],
        relatedIds: ['users-roles', 'users-edit'],
      },
      {
        id: 'users-edit',
        title: 'Edit a User',
        summary: 'Change a user\'s display name, contact email, or role at any time.',
        roles: ['admin'],
        writeRoles: ['admin'],
        steps: [
          { text: 'Go to the Users page.' },
          { text: 'Click the Edit (pencil) icon on the user row.' },
          { text: 'Update the name, contact email, or role.' },
          { text: 'Click Save. Changes take effect immediately — the user\'s next action will use the new role.' },
        ],
        warnings: [
          'Changing a user\'s role from Admin to Auditor immediately removes their write access. Do this with care.',
        ],
        relatedIds: ['users-add', 'users-roles'],
      },
      {
        id: 'users-password',
        title: 'Password Reset',
        summary: 'There is no self-service password reset. Admin must delete and recreate the user account.',
        roles: ['admin'],
        writeRoles: ['admin'],
        steps: [
          { text: 'Go to the Users page and find the user who needs a new password.' },
          { text: 'Click Delete on the user row. Confirm deletion.' },
          { text: 'Click "Add User" and recreate the account with the same mobile number and a new password.' },
          { text: 'Share the new password securely with the user.' },
        ],
        warnings: [
          'Deleting a user does not delete any data they entered. All expenses, transactions, and audit log entries remain intact.',
          'The user cannot log in during the brief period between deletion and recreation.',
        ],
        relatedIds: ['users-add', 'login'],
      },
    ],
  },
  {
    id: 'activity',
    title: 'Activity Log',
    icon: 'History',
    route: '/activity',
    items: [
      {
        id: 'activity-what',
        title: 'What Gets Logged',
        summary: 'Every INSERT, UPDATE, and DELETE on key tables is recorded automatically via Postgres triggers.',
        examples: [
          {
            label: 'Logged actions',
            description: 'Adding or editing an expense, tagging or voiding a transaction, changing a maintenance rate, adding or editing a flat resident, creating or modifying a corpus plan, adding or editing a user.',
          },
          {
            label: 'Log entry contents',
            description: 'Actor (user email), table name, action (INSERT/UPDATE/DELETE), changed values (old → new for updates), timestamp (IST).',
          },
        ],
        tips: [
          'The audit log cannot be disabled. Every change to key tables is captured automatically.',
          'Postgres triggers write to the audit_log table directly — even changes made via SQL tools are captured.',
        ],
        relatedIds: ['activity-reading', 'activity-tamper'],
      },
      {
        id: 'activity-reading',
        title: 'Reading an Audit Entry',
        summary: 'Each entry shows who made a change, on which table, what the action was, and the before/after values.',
        examples: [
          {
            label: 'UPDATE on expenses',
            description: '"Senthil (9876543210@lilac.com) updated expense EXP-2025-0042 on 2025-11-01 12:34 IST — amount changed from ₹24,000 to ₹25,000."',
          },
          {
            label: 'DELETE on transactions',
            description: '"Admin voided transaction TXN-20251104-00089 (₹1,800 CR from NEFT/XXXX) at 2025-11-05 09:12 IST."',
          },
        ],
        tips: [
          'Use the date filter to narrow down the log to a specific day or range.',
          'Use the table filter to show only changes to a specific entity (e.g. only expense changes).',
        ],
        relatedIds: ['activity-what', 'activity-tamper'],
      },
      {
        id: 'activity-tamper',
        title: 'Tamper Evidence',
        summary: 'The audit log is append-only. No app user can edit or delete log entries.',
        tips: [
          'Audit log entries are written by Postgres triggers with the security definer privilege — app users cannot bypass them.',
          'The audit log is a strong evidence trail for the statutory auditor and any dispute resolution.',
          'Even the Admin role cannot delete audit log entries through the app.',
        ],
        warnings: [
          'Do not attempt to alter the audit_log table directly in the database. This would violate the integrity of the audit trail.',
        ],
        relatedIds: ['activity-what', 'activity-reading'],
      },
    ],
  },
  {
    id: 'faq',
    title: 'FAQ',
    icon: 'HelpCircle',
    items: [
      {
        id: 'faq-void-vs-delete',
        title: 'Why doesn\'t Void delete the row?',
        summary: 'Voiding preserves the row for audit trail integrity and reconciliation accuracy.',
        examples: [
          {
            label: 'Audit trail preservation',
            description: 'If a transaction was voided after being matched to a dues payment, the audit log must show that the match existed and was subsequently voided. A hard delete would create a gap in the audit trail.',
          },
          {
            label: 'Reconciliation integrity',
            description: 'Reconciliation reports show all bank credits, including voided ones, so the total of credits always matches the bank statement balance. Deleting a row would cause the report totals to differ from the bank.',
          },
        ],
        tips: [
          'Voided rows are excluded from all calculations (dues, corpus, reconciliation) but remain visible in the All tab with a VOIDED badge.',
        ],
        relatedIds: ['txn-void', 'activity-what'],
      },
      {
        id: 'faq-corpus-vs-maintenance',
        title: 'What\'s the difference between corpus and maintenance?',
        summary: 'Maintenance is monthly recurring for day-to-day costs. Corpus is a one-time capital collection for major works.',
        examples: [
          {
            label: 'Maintenance (monthly)',
            description: 'Covers: security salaries, sweeping staff, EB for common areas, water tanker, lift maintenance, minor repairs. Charged every month at a flat rate (e.g. ₹1,800/mo).',
          },
          {
            label: 'Corpus (one-time per project)',
            description: 'Covers: exterior painting, solar panel installation, electrical rewiring, roof waterproofing. Charged once per project, can be split into 2–3 installments. Tracked separately from maintenance.',
          },
        ],
        relatedIds: ['corpus-what', 'dues-calc'],
      },
      {
        id: 'faq-rate-backdating',
        title: 'Can I change the rate for past months?',
        summary: 'No — rates are forward-only. Past dues calculations use the rate that was active at the time.',
        examples: [
          {
            label: 'Why forward-only?',
            description: 'If you raise the rate from ₹1,600 to ₹1,800 on July 1, you don\'t want April–June to be recalculated retroactively. Residents already received their dues notices and some may have paid. Backdating would create discrepancies.',
          },
        ],
        warnings: [
          'If a rate was incorrectly entered (e.g. wrong amount or wrong date), contact your admin to correct it. The correction itself is forward-only — old dues must be manually adjusted via transaction tagging.',
        ],
        relatedIds: ['flats-rate-change', 'dues-calc'],
      },
      {
        id: 'faq-upload-format',
        title: 'My CSV upload failed — what format does it need?',
        summary: 'The file must have Date, Description/Narration, Credit amount, and Debit amount columns. CSV and PSV (pipe-separated) both work.',
        examples: [
          {
            label: 'Minimum required columns',
            description: 'Date (DD/MM/YYYY or YYYY-MM-DD), Description or Narration (transaction details), Credit (amount received, blank for debits), Debit (amount paid out, blank for credits).',
          },
          {
            label: 'PSV format',
            description: 'Same structure but columns are separated by pipe (|) instead of comma. Some banks export in PSV format. The app auto-detects which separator is used.',
          },
        ],
        tips: [
          'Download the statement directly from your internet banking portal in CSV format.',
          'If the bank gives you an Excel file, open it in Excel and Save As CSV before uploading.',
          'Remove any header rows that are not column names before uploading (e.g. bank logo rows, account summary rows at the top of the file).',
        ],
        relatedIds: ['txn-upload'],
      },
      {
        id: 'faq-reconciliation',
        title: 'What does "Unreconciled" mean?',
        summary: 'An expense is Unreconciled when it was recorded as a bank transfer but hasn\'t been matched to a bank statement debit row yet.',
        examples: [
          {
            label: 'Typical workflow',
            description: 'You transfer ₹25,000 to AG1 on Nov 1. You record the expense in the app that day. The bank statement for November hasn\'t been imported yet. The expense stays Unreconciled until you import the November statement and link the DR row to the expense.',
          },
        ],
        tips: [
          'Import the bank statement at the end of each month and reconcile all pending expenses before closing the books for that month.',
          'Cash expenses never become Unreconciled — they are self-contained and don\'t appear in the bank statement.',
        ],
        warnings: [
          'If an expense stays Unreconciled for more than 30 days, investigate whether the bank transfer actually went through.',
        ],
        relatedIds: ['expenses-statuses', 'expenses-reconcile'],
      },
    ],
  },
]
