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
        relatedIds: ['roles', 'users-password', 'profile'],
      },
      {
        id: 'roles',
        title: 'The Four Roles',
        summary: 'Admin has full access, Committee and Auditor are read-only across committee pages, and Owner is a separate resident self-service login.',
        examples: [
          {
            label: 'Admin (Treasurer)',
            description: 'Full read + write access across all pages. Can manage users, import bank statements, add expenses, change rates, and all other mutations.',
          },
          {
            label: 'Committee',
            description: 'Read access to all committee-facing pages. Cannot add, edit, or delete records anywhere in the app today — see Approval Status for a known gap between this and the intended design (Committee approving expenses).',
          },
          {
            label: 'Auditor',
            description: 'Strictly read-only. Can view all data, generate reports, and export. Cannot modify anything. Suitable for the statutory auditor or external reviewer.',
          },
          {
            label: 'Owner (resident)',
            description: 'A separate, simplified self-service view for individual flat owners — not a committee role. Sees a cut-down nav (My Flat, Notices, Payment Info, My Profile) scoped to their own flat: their own dues/corpus status, society announcements, payment/UPI details, and their own profile. Cannot see other flats\' data or any committee-only page.',
          },
        ],
        tips: [
          'Your role badge is shown in the top-right corner of every page.',
          'The sidebar shows only the actions available to your role — buttons that require a higher role are hidden or greyed out.',
          'The Owner role gets an entirely different, simplified navigation menu rather than a restricted version of the committee menu.',
        ],
        relatedIds: ['users-roles', 'users-add', 'expenses-approval'],
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
      {
        id: 'profile',
        title: 'My Profile & Changing Your Password',
        summary: 'Every role can update their own display name and contact email, and change their own password, from My Profile.',
        steps: [
          { text: 'Click your name/avatar in the sidebar footer to open My Profile.' },
          { text: 'Update your display name or contact email and save — your mobile number (login ID) is fixed and shown read-only.' },
          { text: 'To change your password, use the separate "Change password" form: enter and confirm a new password (minimum 8 characters).' },
        ],
        tips: [
          'This is genuine self-service — no admin involvement needed, as long as you\'re already logged in.',
          'If you\'re locked out and can\'t log in at all, an Admin can generate a new password for you from the Users page.',
        ],
        relatedIds: ['login', 'users-password'],
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
        id: 'dashboard-cards',
        title: 'Hero Cards',
        summary: 'Three cards at the top: Net Available Cash, Fixed Deposits, and Pending Actions.',
        examples: [
          {
            label: 'Net Available Cash',
            description: 'The combined balance of the Maintenance, Corpus, and Contributions funds (bank receipts minus payments for each, summed). Also shows petty cash in hand as a sub-line when it\'s above zero. Click through to Expenses filtered to Maintenance.',
          },
          {
            label: 'Fixed Deposits',
            description: 'Total principal currently locked in active FDs, how many are active, and the next upcoming maturity date. Click through to the Fixed Deposits page.',
          },
          {
            label: 'Pending Actions',
            description: 'A single count combining overdue flats, unreconciled expenses, and FDs maturing within 30 days — with a sub-line breaking down each component (or "All clear" when there\'s nothing outstanding). Click through to the Dues page.',
          },
        ],
        tips: [
          'These replaced an older 4-KPI layout (pending dues / corpus pool / month\'s expenses / unreconciled count) — the same underlying figures are now folded into these cards and the fund panels below, not shown as four separate tiles.',
          'Cards update in real time as data is added or changed.',
        ],
        relatedIds: ['dashboard-fund-panels', 'dashboard-lists', 'dashboard-chart'],
      },
      {
        id: 'dashboard-fund-panels',
        title: 'Maintenance & Corpus Fund Panels',
        summary: 'Two side-by-side panels breaking down each fund\'s bank activity and current position.',
        examples: [
          {
            label: 'Maintenance Fund panel',
            description: 'Bank credits received, bank debits paid out, the resulting available balance (shown as a deficit in red if maintenance has spent more than it has collected, i.e. effectively funded by corpus), and total outstanding dues across overdue flats. Links to Expenses (Maintenance filter) and Dues.',
          },
          {
            label: 'Corpus Fund panel',
            description: 'Total collected and spent across all corpus plans, the available balance, and a list of each active plan with its % of target collected. Links to the Corpus page.',
          },
        ],
        tips: [
          'A negative Maintenance balance is a real signal — it means maintenance collections have fallen behind what\'s been spent, and the shortfall is effectively being covered by other funds.',
        ],
        relatedIds: ['dashboard-cards', 'dues-statuses', 'corpus-progress'],
      },
      {
        id: 'dashboard-contributions-strip',
        title: 'Active Contributions Strip',
        summary: 'A strip listing any open contribution drives, with their collected/disbursed amounts and running balance — only shown when at least one drive is open.',
        tips: [
          'This section disappears entirely once all contribution drives are closed — no open drives means no strip, not an empty one.',
        ],
        relatedIds: ['contributions-what', 'contributions-tagging'],
      },
      {
        id: 'dashboard-chart',
        title: '12-Month Cash Flow Chart',
        summary: 'One combined chart: stacked bars for Maintenance + Corpus collections each month, with a line overlay for total expenses — not a separate bar chart and donut chart.',
        tips: [
          'The fiscal year runs April–March. The chart always shows the last 12 fiscal months of data.',
          'A healthy month has the collection bars taller than the expense line sitting on top of them.',
        ],
      },
      {
        id: 'dashboard-lists',
        title: 'Aging Receivables & Corpus Plans Lists',
        summary: 'Two lists below the chart: the top flats by amount overdue, and every corpus plan with its collection progress.',
        examples: [
          {
            label: 'Aging Receivables',
            description: 'The top 8 flats by outstanding amount, each with block, amount due, and a status badge. A "+N more" link opens the full Dues page when there are more than 8.',
          },
          {
            label: 'Corpus Plans',
            description: 'Every corpus plan with a progress bar (% of target collected), target/collected figures, and available balance. Click a plan to open it directly on the Corpus page.',
          },
        ],
        relatedIds: ['dues-statuses', 'corpus-progress'],
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
        title: 'Dues Tabs & Status Badges',
        summary: 'Six tabs — Due, 30d+, 60d+, 90d+, Partial, and Clear — filter the same flat list by how overdue they are.',
        examples: [
          {
            label: 'Due',
            description: 'Every flat with any amount currently outstanding (pending + arrears), regardless of how much.',
          },
          {
            label: '30d+ / 60d+ / 90d+',
            description: 'Overdue-severity buckets — a flat lands here when its pending amount exceeds 1, 2, or 3 months\' worth of its own maintenance rate. This is a rate-multiple check, not an actual day-count since the last payment.',
          },
          {
            label: 'Partial',
            description: 'Something is outstanding, but at least some payment has been made this fiscal year.',
          },
          {
            label: 'Clear (green)',
            description: 'Nothing outstanding — pending and arrears both fully settled (a flat can go negative/into credit and still show Clear).',
          },
        ],
        tips: [
          'Four summary cards at the top (Total outstanding, Overdue 1 mo+, Partial, Clear) are clickable shortcuts to the matching tab.',
          'There is no fiscal-year dropdown on this page itself — the tracked range comes from Settings → General\'s "Carry-forward from" setting, which decides how far back unpaid dues are still being followed.',
          'Use the "Open any flat…" dropdown above the grid to jump straight to a specific flat\'s detail panel without scrolling or filtering.',
        ],
        relatedIds: ['dues-calc', 'dues-panel', 'settings-general'],
      },
      {
        id: 'dues-calc',
        title: 'How Dues Are Calculated',
        summary: 'Rate × months elapsed in the tracked range, plus arrears carried forward, minus what\'s been collected and any advance credit.',
        steps: [
          {
            text: 'The system looks up the maintenance rate history for each flat.',
            detail: 'If the rate changed mid-year, each month uses the rate that was active on the 1st of that month.',
          },
          {
            text: 'It sums up the expected amount for each month from the tracked start date to the current month.',
          },
          {
            text: 'Any arrears carried forward from earlier (see Arrears & Advance Credits) are added on top; any advance credit is subtracted.',
          },
          {
            text: 'Total collected (tagged bank CRs) is subtracted to arrive at the pending amount, and pending + arrears together give Total Outstanding.',
          },
        ],
        tips: [
          'Dues are calculated on demand — the system always uses live data from the transactions, rate history, and arrears tables, never a stored snapshot.',
        ],
        relatedIds: ['flats-rate-change', 'dues-statuses', 'dues-arrears'],
      },
      {
        id: 'dues-panel',
        title: 'Flat Drill-Down Panel',
        summary: 'Click any flat row to open a detail panel with rate, arrears, collected/pending figures, and full payment history.',
        steps: [
          { text: 'Click any flat row in the Dues table to open the detail panel.' },
          { text: 'The top section shows: Rate/mo, Previous arrears (if any), Annual due, Collected, Pending, Advance credit (if any), and Total outstanding — with a progress bar underneath.' },
          {
            text: 'The payment history list on the right shows every tagged bank credit for this flat, most recent first, each with a downloadable receipt.',
          },
        ],
        tips: [
          'Use the WhatsApp reminder button inside the panel to send a payment reminder to this one flat — see WhatsApp Reminder below.',
          'Admins see a "+ Arrears" button next to the flat name here to record a carried-forward due or an advance payment — see Arrears & Advance Credits.',
        ],
        relatedIds: ['dues-whatsapp', 'dues-arrears'],
      },
      {
        id: 'dues-arrears',
        title: 'Arrears & Advance Credits',
        summary: 'Admin-only tool to record a carried-forward due or an advance payment against a flat, tracked separately from the current fiscal year\'s rate-based dues.',
        writeRoles: ['admin'],
        steps: [
          { text: 'Open a flat\'s detail panel and click "+ Arrears" next to its name (Admin only).' },
          { text: 'Choose the type: a carried-forward due (maintenance arrears) or an advance credit.' },
          { text: 'Enter a label for the period it relates to (e.g. "FY 2024-25"), the amount, and optional notes, then save.' },
          { text: 'Existing entries are listed under "Carried forward dues" / "Advance paid" — edit or delete any of them from the same panel.' },
        ],
        examples: [
          {
            label: 'Oldest-first settlement',
            description: 'When a flat pays, collections are applied against arrears entries in the order they were created, oldest first. A fully settled entry shows with a strikethrough; a partially settled one shows the remaining balance against its original amount.',
          },
        ],
        tips: [
          'Arrears entries aren\'t only created manually — advancing the tracked fiscal year in Settings → General automatically converts every flat\'s then-outstanding pending amount into a new arrears entry, so nothing is lost when the tracked range rolls forward.',
        ],
        relatedIds: ['dues-calc', 'settings-advance-fy'],
      },
      {
        id: 'dues-whatsapp',
        title: 'WhatsApp Reminder (Single Flat)',
        summary: 'Send (or copy) a pre-filled payment reminder for one flat, including UPI ID, bank details, and the exact pending amount.',
        steps: [
          { text: 'Click on a flat row in the Dues table to open the detail panel.' },
          { text: 'If the flat has a resident with a phone number on file, a "Send" button opens WhatsApp directly with the message pre-filled.' },
          { text: 'If no phone number is on file, a "Copy" button is shown instead — copy the text and paste it into WhatsApp yourself.' },
        ],
        examples: [
          {
            label: 'What the message contains',
            description: 'The flat\'s outstanding maintenance dues for the fiscal year, a breakdown of prior arrears and current-FY pending where relevant, and the society\'s UPI ID / bank details from Settings → General.',
          },
        ],
        tips: [
          'The UPI ID and bank details come from Settings → General — keep them up to date.',
          'Resident phone numbers are managed on the Flats & Residents page.',
        ],
        relatedIds: ['settings-general', 'flats-residents', 'dues-broadcast'],
      },
      {
        id: 'dues-broadcast',
        title: 'Broadcast Reminder (All Overdue Flats)',
        summary: 'A single combined message listing every flat with an outstanding balance, meant for posting to the residents\' WhatsApp group — not a per-contact bulk send.',
        steps: [
          { text: 'Click "Broadcast" at the top of the Dues page.' },
          { text: 'The message text (every overdue flat with its amount, plus a grand total and count) is copied to your clipboard and WhatsApp opens with it pre-filled.' },
          { text: 'Paste/send it into the residents\' WhatsApp group, or wherever the committee shares collective updates.' },
        ],
        warnings: [
          'This does not message each flat individually — it\'s one shared message for a group. Use the per-flat "Send" button in a flat\'s detail panel to message a specific resident directly.',
        ],
        relatedIds: ['dues-whatsapp'],
      },
      {
        id: 'dues-export',
        title: 'Export Dues List',
        summary: 'Download the dues list as an Excel file, respecting whichever tab and filters are currently applied.',
        steps: [
          { text: 'Switch to the tab you want (Due, 30d+, 60d+, 90d+, Partial, or Clear) and apply any column filters.' },
          { text: 'Click the Export button in the top-right toolbar.' },
          { text: 'An Excel file downloads with flat, block, BHK, rate, dues, collected, pending, arrears, total outstanding, and status for the visible rows.' },
        ],
        tips: [
          'The export respects the current tab and any column filters/sort — only the rows currently visible in the grid are exported.',
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
        id: 'txn-tabs',
        title: 'Upload / Review / All Transactions',
        summary: 'Three tabs, not more — there\'s no separate "Tagged" or "Voided" tab. Voided rows just appear greyed-out inside All Transactions.',
        examples: [
          {
            label: 'Upload',
            description: 'Admin-only. Where bank statement files are imported (see Upload Bank Statement).',
          },
          {
            label: 'Review',
            description: 'Untagged credits waiting to be assigned to a flat. Its tab label shows a live count, and the same count drives the red badge on the "Bank Statement" sidebar item.',
          },
          {
            label: 'All Transactions',
            description: 'Every transaction, tagged or not, with column filters, a date-range picker, export, and — for Admin — click-to-edit on any row.',
          },
        ],
        tips: [
          'Only Admin can write here — Committee and Auditor get read-only access (no Upload tab, no tagging, no click-to-edit; Review shows as a plain read-only list).',
        ],
        relatedIds: ['txn-upload', 'txn-review', 'txn-edit'],
      },
      {
        id: 'txn-upload',
        title: 'Upload Bank Statement',
        summary: 'Import a bank statement CSV or PSV file. The app auto-detects column layout and shows an editable preview before committing.',
        roles: ['admin'],
        writeRoles: ['admin'],
        steps: [
          { text: 'Go to the Upload tab (Admin only) and drop or select your bank statement file (.csv, .psv, or .txt).' },
          {
            text: 'The app auto-detects the format and columns and shows an editable preview grid — rows it\'s unsure about are highlighted; fix the Flat or Category cell directly in the preview if needed.',
          },
          { text: 'Click Import to commit all valid rows.' },
          { text: 'If any rows still need review after import, you\'re taken straight to the Review tab; otherwise you stay on an "Import complete" summary.' },
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
          'A collapsed "Show import history" link on this tab shows recent imports without leaving the page — the same information also appears in Settings → Import History.',
        ],
        warnings: [
          'Duplicate detection relies on a transaction ID/reference number column in the file. A generic bank export with no such column (just date/description/amount) can\'t be checked for duplicates at all — re-importing it would add every row again. Prefer a statement format that includes a reference or cheque number column when your bank offers one.',
        ],
        relatedIds: ['txn-review', 'faq-upload-format', 'settings-import-history'],
      },
      {
        id: 'txn-review',
        title: 'Reviewing Untagged Transactions',
        summary: 'The Review tab shows untagged credit rows. Assign each to a flat and payment type.',
        writeRoles: ['admin'],
        steps: [
          { text: 'Go to Transactions → Review tab. All untagged credits (CRs) appear here.' },
          { text: 'Click a row to open the tagging panel.' },
          {
            text: 'Select the Flat from the dropdown.',
            detail: 'Start typing the flat number or owner name to filter the list.',
          },
          {
            text: 'Select the Payment type: Maintenance dues or Corpus contribution.',
          },
          {
            text: 'If the type is Corpus, choose which corpus plan the payment belongs to.',
            detail: 'This only appears as a choice when 2 or more corpus plans are Active or Draft at the same time. With a single plan, it\'s assigned automatically.',
          },
          { text: 'Click "Tag" to save. The row moves out of Review and updates the flat\'s dues/corpus records.' },
        ],
        tips: [
          'If a transfer covers multiple flats (combined payment), use the Split function instead.',
          'Tagging a credit as Maintenance automatically credits that flat\'s dues for the fiscal year.',
          'Optionally save the sender\'s UPI ID/token against the resident while tagging, so future imports from the same sender auto-tag without landing in Review again.',
        ],
        relatedIds: ['txn-split', 'txn-bulk-record', 'txn-void', 'corpus-statuses'],
      },
      {
        id: 'txn-bulk-record',
        title: 'Bulk Record (Maintenance Payments)',
        summary: 'A separate admin-only tool on the Review tab for quickly tagging a batch of unmatched maintenance credits at once, without opening each one individually.',
        roles: ['admin'],
        writeRoles: ['admin'],
        steps: [
          { text: 'Click "Bulk Record" on the Review tab.' },
          { text: 'For each listed credit, pick the flat it belongs to (and adjust the fiscal month if the auto-guess is wrong).' },
          { text: 'Click "Record N payments" to tag them all as Maintenance in one go.' },
        ],
        tips: [
          'This is maintenance-only — it doesn\'t handle Corpus or Contribution tagging, and it\'s a different tool from the per-row Split/Tag flow.',
        ],
        relatedIds: ['txn-review'],
      },
      {
        id: 'txn-edit',
        title: 'Edit a Transaction',
        summary: 'Change the flat assignment or payment type of an already-tagged transaction, from the All Transactions tab.',
        writeRoles: ['admin'],
        steps: [
          { text: 'Go to All Transactions and click the row you need to correct.' },
          { text: 'This opens the same detail/edit panel used for tagging — change the flat, payment type, or corpus plan as needed.' },
          { text: 'Click Save. The change is recorded in the audit log with the previous and new values.' },
        ],
        warnings: [
          'Editing a tagged transaction affects the flat\'s dues balance immediately. Double-check before saving.',
          'A row created by a Direct (owner-paid) expense can\'t be edited here — it\'s managed from that expense on the Expenses page instead.',
        ],
        relatedIds: ['txn-void', 'activity-what'],
      },
      {
        id: 'txn-void',
        title: 'Void a Transaction',
        summary: 'Void marks a transaction as invalid without deleting it, from inside the same edit panel. The audit trail is fully preserved.',
        roles: ['admin'],
        writeRoles: ['admin'],
        steps: [
          { text: 'Open the transaction from All Transactions (click its row).' },
          { text: 'Click Void, then confirm.' },
        ],
        examples: [
          {
            label: 'When to void',
            description: 'Wrong import file imported by mistake, test rows added during setup, or a duplicate entry that slipped past deduplication.',
          },
        ],
        tips: [
          'Voided rows show at reduced opacity with strikethrough text in All Transactions, and a VOIDED badge — they\'re never deleted from the database.',
        ],
        warnings: [
          'Void does NOT delete the row, and there\'s no "un-void" button for a plain void — it\'s one-way. The one exception is a row created by a Split: an "Undo split" action can reverse that specific split back to its original un-split transaction.',
          'A row created by a Direct (owner-paid) expense can\'t be voided here — it\'s managed from that expense on the Expenses page.',
        ],
        relatedIds: ['faq-void-vs-delete', 'txn-edit', 'txn-split'],
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
            text: 'Add a split entry for each flat: select the flat, payment type, and amount (and a corpus plan too, if that row is Corpus and more than one plan is in play).',
            detail: 'Example: ₹6,000 CR → Flat A1 ₹3,000 (Maintenance) + Flat B2 ₹3,000 (Maintenance).',
          },
          { text: 'The total of all splits must equal the original transaction amount. A running balance shows how much remains to be allocated.' },
          { text: 'Save to confirm. Each flat\'s dues/corpus record is updated accordingly.' },
        ],
        tips: [
          'Splits are common when a family pays dues for multiple flats in one transfer.',
          'A split can be reversed with "Undo split" (from the original transaction\'s row in All Transactions) if it needs redoing — this is the one case where a void-like action is reversible.',
        ],
        relatedIds: ['txn-review', 'txn-edit'],
      },
      {
        id: 'txn-export',
        title: 'Export Transactions',
        summary: 'Download the currently filtered/sorted All Transactions view to an Excel file.',
        steps: [
          { text: 'On the All Transactions tab, pick a date range mode (current fiscal year, a custom range, or all-time) and apply any column filters/sort you want.' },
          { text: 'Click the Export button in the toolbar.' },
          { text: 'An Excel file downloads with exactly the rows currently visible, in their current sort order.' },
        ],
        tips: [
          '"All time" is capped at 2,000 rows — for a full historical export beyond that, narrow the date range and export in batches.',
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
            description: 'Maintenance is a recurring monthly amount covering day-to-day running costs (security, sweeping, EB, water). Corpus is a separate one-time collection for a specific capital project, spread over installments.',
          },
          {
            label: 'Typical corpus plans',
            description: 'Exterior painting plan (2 installments), Solar panel installation (3 installments), Electrical rewiring (1 installment).',
          },
        ],
        tips: [
          'A plan sets one flat-rate default target for every flat (based on its installment amounts), which an Admin can then override per flat when creating the plan — it\'s not automatically calculated from BHK type, sqft, or UDS.',
          'Corpus collections are tracked separately from maintenance and have their own reports.',
        ],
        relatedIds: ['faq-corpus-vs-maintenance', 'corpus-statuses', 'corpus-create'],
      },
      {
        id: 'corpus-create',
        title: 'Creating a Corpus Plan',
        summary: 'A 4-step wizard: plan details, installments, per-flat amounts, and review — ending in Save as Draft or Create & Activate.',
        writeRoles: ['admin'],
        steps: [
          { text: 'Click "New plan" on the Corpus page.' },
          { text: 'Step 1 — Plan details: name, optional description, and a Start/End fiscal year picked from a fixed range.' },
          { text: 'Step 2 — Installments: add as many installment rows as you like, each with a label, optional due date, and amount. Their sum becomes the default per-flat target.' },
          {
            text: 'Step 3 — Per-flat amounts: every flat starts with that same default target — override any flat\'s target or pre-payment (money collected before this plan existed) individually if needed.',
            detail: 'If any flats have an unpaid balance carried over from a previous closed plan, a checkbox here (checked by default) offers to carry it forward into this plan\'s targets.',
          },
          { text: 'Step 4 — Review the totals, then click "Save as Draft" or "Create & Activate".' },
        ],
        tips: [
          'Draft and Active behave identically for collecting payments — the only real difference is which action button appears next (Activate vs Close) and a green vs amber dot in the plan selector. See Corpus Plan Statuses.',
          'There\'s no bulk "set by BHK type" tool — the wizard applies one flat-rate default and expects manual overrides for exceptions.',
        ],
        relatedIds: ['corpus-statuses', 'corpus-what'],
      },
      {
        id: 'corpus-statuses',
        title: 'Corpus Plan Statuses',
        summary: 'Draft and Active both actively collect payments; Active can be Closed to Completed. There is no Cancel action in the app today.',
        examples: [
          {
            label: 'Draft',
            description: 'Plan created and per-flat targets configured, but not yet formally activated. Bank credits CAN still be tagged to a Draft plan — it counts toward corpus tracking exactly like an Active plan — so pre-payments made before launch aren\'t lost. The only action available on a Draft plan is "Activate".',
          },
          {
            label: 'Active',
            description: 'The plan has been formally activated. The only action available is "Close plan", which moves it to Completed.',
          },
          {
            label: 'Completed',
            description: 'Closed by an Admin. Any flat still owing a balance at close time gets that balance recorded as an unpaid amount, automatically offered as carry-forward the next time a plan is created. A completed plan drops out of live tracking — you can still see its name in the "Closed plans" list, but not drill into its flat-by-flat detail from this page.',
          },
          {
            label: 'Cancelled',
            description: 'A status value the database supports, but there is no button anywhere in the app to set it — in practice you\'ll only ever see Draft, Active, and Completed plans.',
          },
        ],
        warnings: [
          'Only Admin can change a plan\'s status, and there\'s no way back: Draft → Active → Completed is one-directional, with no "reopen" or "revert to draft".',
          'Be careful with the word "active" on this page — the plan selector, the multi-plan banners, and the collection totals all treat Draft and Active as one "active" bucket, but the Collection Calendar tab and the multi-plan overlap warning only look at plans whose status is literally Active (excluding Draft).',
        ],
        relatedIds: ['corpus-what', 'corpus-create', 'corpus-progress', 'corpus-multi-plan'],
      },
      {
        id: 'corpus-progress',
        title: 'KPIs & Progress Bars',
        summary: 'A KPI strip (Target, Collected, Spent, Allowed to spend) plus an overall collection progress bar for the selected plan (or all plans combined).',
        examples: [
          {
            label: 'Allowed to spend',
            description: 'Cash already in hand from this fund plus whatever is still expected to be collected — a working ceiling for what the committee can commit to spending.',
          },
          {
            label: 'Collection progress bar',
            description: 'Collected ÷ Target across all flats in the plan. If collections exceed the target, a separate "Surplus" banner appears instead of an over-100% bar.',
          },
        ],
        tips: [
          'These figures are scoped to whichever plan is selected — pick "All active plans" from the plan dropdown to see them combined across every Draft/Active plan at once.',
          'The Dashboard shows a similar but fund-wide Corpus card, plus its own list of plans with individual progress bars, both linking back here.',
        ],
        relatedIds: ['corpus-expenditure', 'corpus-byfat', 'corpus-multi-plan'],
      },
      {
        id: 'corpus-byfat',
        title: 'By Flat Tab',
        summary: 'Per-flat breakdown: target, collected, balance, % paid, and status for the selected plan (or all plans, tagged by plan name).',
        steps: [
          { text: 'Select a corpus plan from the dropdown (or leave it on "All active plans").' },
          { text: 'Click the "By Flat" tab.' },
          { text: 'Click any flat row to open its detail panel: target, carry-forward and pre-payment (if any), collected, balance, a progress bar, and the full payment history with receipts.' },
          { text: 'From the same detail panel, send or copy a WhatsApp reminder for that flat\'s corpus balance.' },
        ],
        tips: [
          'Export downloads the currently filtered/sorted grid to Excel.',
        ],
        warnings: [
          'A flat\'s target, pre-payment, or carry-forward amount can only be set when the plan is created — there\'s no edit action for them afterward on this page.',
        ],
        relatedIds: ['corpus-progress', 'corpus-statuses', 'corpus-broadcast'],
      },
      {
        id: 'corpus-expenditure',
        title: 'Expenditure Tab',
        summary: 'A read-only view of expenses charged to this corpus plan — the actual linking happens on the Expenses page, not here.',
        steps: [
          { text: 'Select a corpus plan and click the "Expenditure" tab.' },
          { text: 'A KPI strip shows Total budget, Spent so far, and Remaining budget.' },
          { text: 'Below it, every expense linked to this plan is listed with voucher number, payee, date, and amount.' },
        ],
        tips: [
          'An expense gets linked to a plan by choosing it in that expense\'s "Corpus plan" field on the Expenses page — there\'s no "link expense" action on this tab itself.',
          'The Budget column is populated from a per-plan budget that the plan-creation wizard doesn\'t currently set — so unless it\'s been filled in separately, expect this to show as unbudgeted even for plans with real spending.',
        ],
        relatedIds: ['expenses-add', 'corpus-progress'],
      },
      {
        id: 'corpus-calendar',
        title: 'Collection Calendar Tab',
        summary: 'A grid of installments × flats across truly-Active plans, colour-coded Paid / Partial / Overdue / Not-due.',
        tips: [
          'This view only includes plans with status Active (not Draft) — a plan still in Draft won\'t appear here even though it\'s already collecting payments.',
        ],
        relatedIds: ['corpus-statuses'],
      },
      {
        id: 'corpus-broadcast',
        title: 'WhatsApp Reminders (Corpus)',
        summary: 'A "Broadcast" button for a combined message covering every flat with an outstanding corpus balance, plus a per-flat reminder inside each flat\'s detail panel.',
        steps: [
          { text: 'Click "Broadcast" at the top of the Corpus page for one shareable message covering every flat still owing on the selected plan.' },
          { text: 'Or open a specific flat\'s detail panel (By Flat tab) and use its own Send/Copy reminder button for just that flat.' },
        ],
        tips: [
          'Unlike most write actions on this page, sending a reminder isn\'t Admin-only — any role that can view the Corpus page can trigger one.',
        ],
        relatedIds: ['corpus-byfat', 'dues-broadcast'],
      },
      {
        id: 'corpus-multi-plan',
        title: 'Running More Than One Plan at Once',
        summary: 'The app supports several corpus plans in flight simultaneously, and flags it clearly — but a payment not explicitly tagged to a plan can be misattributed if two plans overlap.',
        examples: [
          {
            label: 'Parallel plan warning',
            description: 'Shown when 2+ plans are truly Active (not Draft) at once, naming them so you know a payment tagged as "Corpus" (without picking a specific plan) could land against the wrong one.',
          },
          {
            label: 'Consolidated view',
            description: 'Selecting "All active plans" shows a banner listing each Draft/Active plan with its own collected/target and balance, so nothing is hidden by only viewing one at a time.',
          },
        ],
        tips: [
          'When tagging a bank credit as Corpus on the Transactions page, a plan picker only appears if 2+ plans are Draft/Active at that moment — with just one, it\'s assigned automatically. See Transactions → Reviewing Untagged Transactions.',
        ],
        relatedIds: ['txn-review', 'corpus-statuses'],
      },
    ],
  },
  {
    id: 'contributions',
    title: 'Contributions',
    icon: 'HandHeart',
    route: '/contributions',
    items: [
      {
        id: 'contributions-what',
        title: 'What Is a Contribution Drive?',
        summary: 'Voluntary, one-off collections — festival funds, welfare support for staff or their families — kept fully separate from Maintenance and Corpus.',
        examples: [
          {
            label: 'Typical drives',
            description: 'Diwali/Pongal staff bonus collection, a one-time welfare fund for a staff member\'s medical emergency, a festival decoration fund.',
          },
          {
            label: 'Why keep it separate?',
            description: 'These are voluntary and don\'t affect anyone\'s maintenance dues or corpus obligation — they need their own running balance so it\'s clear the money in matches what\'s been handed out.',
          },
        ],
        tips: [
          'Each drive has its own balance: money in (bank credits tagged to it) minus money out (the eventual disbursement, tagged as a bank debit).',
        ],
        relatedIds: ['contributions-tagging', 'contributions-close'],
      },
      {
        id: 'contributions-tagging',
        title: 'Creating a Drive and Tagging Payments',
        summary: 'Start a drive, then tag matching bank transactions to it from the Transactions page.',
        writeRoles: ['admin'],
        steps: [
          { text: 'Click "New drive" on the Contributions page.' },
          { text: 'Give it a name and an optional description, then create it.' },
          { text: 'Go to Transactions → Review (or All Transactions) to tag incoming payments to the drive.' },
          {
            text: 'Either pick the drive directly when tagging a credit, or pick the contributor\'s flat first and set the payment type to "Contribution".',
          },
          { text: 'When the collected amount is disbursed (e.g. handed to the recipient or withdrawn), tag that outgoing bank debit to the same drive too.' },
        ],
        tips: [
          'A drive\'s card on the Contributions page shows the running balance at a glance — click it to expand the full list of tagged transactions.',
          'Each drive can generate its own PDF statement (contributors, amounts, and disbursements) via "Export PDF" on its detail view.',
        ],
        relatedIds: ['contributions-what', 'txn-review'],
      },
      {
        id: 'contributions-close',
        title: 'Closing and Reopening a Drive',
        summary: 'Close a drive once it\'s done — a small carry-forward balance is fine, just note why.',
        writeRoles: ['admin'],
        steps: [
          { text: 'Open the drive\'s detail view and click "Close drive".' },
          {
            text: 'If there\'s a non-zero balance, the dialog tells you whether the drive is still holding money or was overpaid (the association funded more than it collected) — add a closing note explaining it.',
          },
          { text: 'A closed drive can be reopened later via "Reopen drive" if more transactions need to be tagged to it.' },
        ],
        tips: [
          'Closing does not require a zero balance — a small leftover or shortfall is normal; the note is what matters for the audit trail.',
        ],
        relatedIds: ['contributions-what', 'contributions-tagging'],
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
        relatedIds: ['expenses-hub-spoke', 'expenses-add', 'expenses-pending', 'expenses-petty-cash', 'expenses-voucher'],
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
          { text: 'Click "+ Add Expense" (available from any tab on the Expenses page).' },
          {
            text: 'Fill in the header fields: Date, Amount, Description, Payee type (Staff / Vendor / Intermediary / Municipal / Other), the matching payee picker, Payment mode (Cash / Online / Bank Transfer / Cheque / Direct), and Reference/UTR or Cheque number if relevant.',
          },
          {
            text: 'Select the Category and, if it applies, the Corpus plan.',
            detail: 'The Corpus plan dropdown only appears when at least one plan is Active or Draft. Categories are configured in Settings → Expense Categories.',
          },
          { text: 'Add optional Notes for context (e.g. "June salary, includes overtime").' },
          {
            text: 'Add line items: for each line, Description, Amount, Category, Cost centre (Block-A/B/C/D/E, Common, Municipal, All), Payee type, and optional Quantity/Unit/Rate (which auto-computes the amount).',
            detail: 'A running total above the line items shows how far off you are from the header amount — the Save button stays disabled until they match exactly.',
          },
          { text: 'Click Save. The voucher number (EXP-YYYY-NNNN) is auto-assigned.' },
        ],
        diagram: {
          nodes: [
            { id: 'header', label: 'Header', sublabel: 'Payee, date, amount, mode', type: 'start' },
            { id: 'lines', label: 'Line Items', sublabel: 'Invoice breakdown', type: 'action' },
            { id: 'voucher', label: 'Voucher', sublabel: 'EXP-YYYY-NNNN', type: 'end' },
          ],
          edges: [
            { from: 'header', to: 'lines' },
            { from: 'lines', to: 'voucher', label: 'Auto-assigned' },
          ],
        },
        tips: [
          'Choosing a Vendor payee shows a TDS warning banner once that vendor\'s payments cross ₹30,000 for the fiscal year.',
          'Selecting "Cash" mode shows how much petty cash is actually available, and blocks saving if the amount would exceed it.',
          '"Add from pending" pulls in waiting Pending Items as line items directly — but only ones tagged to the same corpus plan (or Maintenance) as this expense\'s header.',
          'If the payee is a new vendor or staff member, add them from the Vendors/Staff tab first.',
        ],
        warnings: [
          'Line item amounts must add up exactly to the header amount — you cannot save until they balance.',
          'A new expense saved through this dialog is auto-approved immediately (see Approval Status) — this is different from a bundled Pending Items expense, which starts pending review.',
        ],
        relatedIds: ['expenses-hub-spoke', 'expenses-statuses', 'expenses-approval', 'expenses-vendors', 'expenses-direct'],
      },
      {
        id: 'expenses-direct',
        title: 'Direct Contributions (Owner-Paid Expenses)',
        summary: 'Record one or more flat owners paying a vendor directly, instead of the payment going through the society\'s bank account.',
        writeRoles: ['admin'],
        steps: [
          { text: 'On the Add/Edit Expense dialog, use the "Direct contributions" section (shown regardless of the chosen payment mode).' },
          { text: 'Add a row per contributing flat: the flat, the amount they paid directly, and optionally which corpus plan it counts toward.' },
          { text: 'Each row creates a matching credit (to that flat\'s dues or corpus) and debit (against the expense) — net zero to the bank, since no money actually moved through the society account for that portion.' },
          { text: 'Any remaining amount the society itself paid (if the total doesn\'t come entirely from direct contributions) reconciles normally against the bank statement at that smaller, net figure.' },
        ],
        warnings: [
          'The total of all direct contributions can\'t exceed the expense amount — saving is blocked if it would.',
          'To remove a contribution after saving, use the row\'s remove action rather than editing the amount directly, so the paired credit/debit stay in sync.',
        ],
        relatedIds: ['expenses-add', 'expenses-statuses'],
      },
      {
        id: 'expenses-statuses',
        title: 'Payment Status (Cash / Direct / Unreconciled / Reconciled)',
        summary: 'A derived status showing how each expense relates to the bank statement — separate from its approval status.',
        examples: [
          {
            label: 'Cash',
            description: 'Petty cash expense paid from the cash box. Saving a Cash-mode expense automatically records a disbursement against the petty cash balance, and it will never be matched to a bank statement row — so only use Cash when the money genuinely left the physical cash box, never as a default for "not sure yet".',
          },
          {
            label: 'Direct',
            description: 'The expense is fully covered by owner direct-contributions (see Direct Contributions) — nothing further needs to reconcile against the bank.',
          },
          {
            label: 'Unreconciled',
            description: 'Paid Online/Bank Transfer/Cheque, recorded in the system, but not yet matched to a corresponding bank statement debit row.',
          },
          {
            label: 'Reconciled',
            description: 'The expense has been matched (linked) to a specific bank statement debit row. The bank record and the expense record are confirmed to be the same payment.',
          },
        ],
        tips: [
          'Reconcile all bank-transfer expenses before month-end to ensure your books match the bank statement.',
          'New expenses default to "Online" payment mode, not Cash — this is deliberate: an incorrect Online default just fails to auto-match in reconciliation (a visible, fixable gap), while an incorrect Cash default silently misstates the petty cash balance. Only switch to Cash when you\'re sure.',
          'This status is entirely separate from Approval Status (Pending/Approved/Rejected) — an expense can be Reconciled and still Pending approval, or Approved and still Unreconciled.',
        ],
        warnings: [
          'Don\'t leave a bundled or pending-item expense on "Cash" out of habit — if it was actually paid by UPI or bank transfer, it will wrongly reduce the petty cash balance and can never be reconciled against the real bank debit.',
        ],
        relatedIds: ['expenses-reconcile', 'expenses-pending', 'expenses-approval', 'expenses-petty-cash', 'faq-reconciliation'],
      },
      {
        id: 'expenses-approval',
        title: 'Approval Status',
        summary: 'Pending, Approved, or Rejected — every expense saved through Add Expense is auto-approved immediately; only a bundled Pending Items expense starts out Pending.',
        roles: ['admin'],
        examples: [
          {
            label: 'Approved (the default)',
            description: 'Saving a new expense through the normal Add Expense dialog approves it automatically — there\'s no separate "submit for approval" step for it.',
          },
          {
            label: 'Pending',
            description: 'Only happens when several Pending Items are bundled into one expense — that bundled expense starts in a Pending state and needs an Admin to approve or reject it before it counts toward reports.',
          },
          {
            label: 'Rejected',
            description: 'An Admin declined a pending expense with a reason, which stays visible on the expense afterward.',
          },
        ],
        steps: [
          { text: 'Open a Pending expense from the Day Book (or filter to "Show pending").' },
          { text: 'Click Approve, or Reject and give a reason.' },
        ],
        tips: [
          'A Pending or Rejected expense stays visible in the Day Book, but is excluded from Reports totals until it\'s Approved.',
        ],
        warnings: [
          'Approve/Reject is currently Admin-only in the app, even though Committee is generally expected to review and approve expenses — if you\'re Committee and expected to approve expenses, check with your Admin about this.',
        ],
        relatedIds: ['expenses-pending', 'expenses-statuses'],
      },
      {
        id: 'expenses-pending',
        title: 'Pending Items & Bundling',
        summary: 'Capture small cash/UPI/online payments as they happen, then bundle several of them into one Day Book expense later.',
        writeRoles: ['admin'],
        steps: [
          { text: 'Go to Expenses → Pending Items tab.' },
          { text: 'Click "Add" to log a single small payment as it happens — date, amount, description, category, cost centre, and payment mode.' },
          {
            text: 'For several payments at once, use "Bulk add" — a spreadsheet-style grid where you can type or paste rows straight from Excel (Date, Description, Amount, Category, and more).',
          },
          { text: 'Select several pending items that all belong to the same funding source (all Maintenance, or all the same corpus plan) and click "Bundle".' },
          {
            text: 'Review the bundle header — expense date defaults to the latest paid date among the selected items, and payment mode defaults to whichever mode is most common among them — then adjust if needed and save.',
            detail: 'Saving creates one Day Book expense (with its own voucher number) made up of the bundled items as line items, and removes them from the Pending Items list.',
          },
          { text: 'Later, editing that bundled expense lets you tag each line item individually with its own paid date, vendor/staff payee, payment mode, and reference number.' },
        ],
        tips: [
          'Attach a receipt photo when capturing a pending item — a paper-clip icon shows on items with attachments, and the photo carries over into the bundled expense.',
          'Inside "Add Expense", "Add from pending" pulls waiting pending items directly into the form as line items instead of bundling them separately.',
          'The Pending Items list has no search, date filter, or category filter of its own — it\'s always shown newest-paid-first, so bundle in reasonably small batches to keep it manageable.',
        ],
        warnings: [
          'You cannot mix maintenance items and corpus items (or items from two different corpus plans) in one bundle — the app blocks it both in the dialog and again on save.',
          'A bundled expense always starts in Pending approval status, unlike a normal Add Expense entry (see Approval Status) — it needs an Admin to approve it before it counts in reports.',
          'Double-check the bundle\'s suggested payment mode before saving — see Payment Status for why an incorrect "Cash" default is risky.',
        ],
        relatedIds: ['expenses-add', 'expenses-statuses', 'expenses-approval', 'expenses-hub-spoke'],
      },
      {
        id: 'expenses-reconcile',
        title: 'Reconciliation',
        summary: 'Match unreconciled expenses to their corresponding bank statement debit rows side-by-side, with smart match suggestions.',
        writeRoles: ['admin'],
        steps: [
          { text: 'Go to Expenses → Reconcile tab.' },
          {
            text: 'The left panel lists Unreconciled expenses (Online/Bank Transfer/Cheque, not yet matched — an expense fully covered by Direct contributions never appears here).',
          },
          {
            text: 'The right panel lists unmatched bank debit (DR) rows from imported bank statements.',
          },
          {
            text: 'Click an expense on the left — matching DRs on the right highlight green (exact amount) or amber (close: within 5%/₹500 and 7 days of the expense date) to help you spot the right one.',
          },
          { text: 'Click the matching DR, then click "Match" to confirm.' },
          {
            text: 'If the amounts don\'t match exactly, you\'ll be asked to confirm "Match anyway" — after matching, you can optionally post the difference to Petty Cash as a top-up or shortfall.',
          },
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
          'Selecting a bank DR with no expense chosen offers a "Mark as Deposit" shortcut straight to the Fixed Deposits page — useful when the unmatched debit turns out to be an FD placement, not an expense at all.',
          'A contribution drive\'s payout debit reconciles from the Contributions page, not here — it won\'t show up in this tab\'s unmatched list.',
        ],
        relatedIds: ['expenses-statuses', 'expenses-petty-cash', 'faq-reconciliation'],
      },
      {
        id: 'expenses-petty-cash',
        title: 'Petty Cash',
        summary: 'Its own tab tracking the physical cash-box balance — opening amount, top-ups, and disbursements, most of which are posted automatically by other actions.',
        steps: [
          { text: 'Go to Expenses → Petty Cash tab to see the current balance and full transaction history.' },
          { text: 'Use "Add Entry" (Admin) for anything not tied to a specific expense — the literal cash-box opening balance, or an ad-hoc top-up/withdrawal.' },
          { text: 'Most other entries are posted automatically: saving a Cash-mode expense, voiding one, un-reconciling one, or resolving a reconciliation amount difference.' },
        ],
        examples: [
          {
            label: 'What posts automatically',
            description: 'A Cash-mode expense posts a Disbursement when saved (and removes it if voided or un-reconciled). Reconciling an expense against a bank row with a slightly different amount offers to post the difference as a top-up or shortfall.',
          },
        ],
        tips: [
          'The current balance also shows on the Dashboard\'s cash position card, so there\'s no need to visit this tab just to check the number.',
        ],
        warnings: [
          'Saving a Cash-mode expense that would exceed the current balance is blocked — this is the main safeguard against silently misstating petty cash, but it only applies to expense/reconciliation flows, not the manual "Add Entry" form, which can push the balance negative if used carelessly.',
        ],
        relatedIds: ['expenses-statuses', 'expenses-reconcile'],
      },
      {
        id: 'expenses-recurring',
        title: 'Recurring Expenses (Reference List Only)',
        summary: 'A checklist of regular commitments (security contract, lift AMC, etc.) for the committee\'s own reference — it does not generate expenses automatically.',
        writeRoles: ['admin'],
        steps: [
          { text: 'Go to Expenses → Recurring tab.' },
          { text: 'Add a template: name, description, vendor, category, amount, payment mode, and frequency (Monthly/Quarterly/Annual).' },
          { text: 'Pause or reactivate a template when a commitment is temporarily on hold, or delete it if it no longer applies.' },
        ],
        warnings: [
          'This is a reminder list, not an automation — nothing here creates an actual expense or pending item on its own. Each time a recurring payment is due, you still need to Add Expense (or capture it as a Pending Item) yourself, referencing the same details as the template.',
        ],
        relatedIds: ['expenses-add', 'expenses-pending'],
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
            text: 'Enter: Name, Vendor type (Contractor / Supplier / Utility / Service / Other), Phone, PAN number (for TDS tracking), and optional notes.',
          },
          { text: 'Click Save. The vendor now appears in the Payee dropdown when adding expenses.' },
        ],
        tips: [
          'PAN numbers matter for vendors likely to be paid above ₹30,000 in a fiscal year, which is when the TDS warning kicks in on the Add Expense form.',
          'Mark a vendor Inactive instead of deleting once they\'re no longer used — deleting is blocked anyway if they have any linked expenses.',
        ],
        relatedIds: ['expenses-add', 'expenses-staff'],
      },
      {
        id: 'expenses-staff',
        title: 'Staff',
        summary: 'Staff master used as a payee option in expenses — name, role, assigned area, phone, and joining date.',
        writeRoles: ['admin'],
        steps: [
          { text: 'Go to Expenses → Staff tab.' },
          { text: 'Click "Add Staff" to create a new staff member.' },
          { text: 'Enter: Name, Role (Security / Sweeper / Gardener / Plumber / Electrician / Lift Operator / Other), assigned area, Phone, and joining date.' },
          { text: 'Optionally record a starting monthly salary at the time you add them.' },
          { text: '"Mark as left" (with a "Reactivate" to undo it) retires a staff member without losing their history.' },
        ],
        tips: [
          'Staff records are separate from residents — they do not have login access.',
        ],
        warnings: [
          'A starting salary can only be set when a staff member is first added — there\'s currently no way to record a later salary revision, and nothing in the app looks up a staff member\'s salary automatically. Expense line item amounts for staff payments are always entered manually.',
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
    id: 'finance',
    title: 'Fixed Deposits',
    icon: 'PiggyBank',
    route: '/finance',
    items: [
      {
        id: 'finance-what',
        title: 'Tracking Fixed Deposits',
        summary: 'The Fixed Deposits page tracks the society\'s bank FDs — principal, interest rate, maturity date, and interest earned once matured.',
        examples: [
          {
            label: 'KPI cards',
            description: 'Total principal currently locked in active FDs, the nearest upcoming maturity date (with days remaining, or overdue if past due), and cumulative interest earned across matured deposits.',
          },
        ],
        tips: [
          'Toggle the list between "Active" and "All" deposits to see matured/closed ones too.',
          'An active deposit past its maturity date is highlighted so it doesn\'t get forgotten.',
        ],
        relatedIds: ['finance-add', 'finance-matured'],
      },
      {
        id: 'finance-add',
        title: 'Adding a Fixed Deposit',
        summary: 'Record a new FD when the society opens one, optionally linking it to the bank debit that funded it.',
        writeRoles: ['admin'],
        steps: [
          { text: 'Click "Add Deposit" on the Fixed Deposits page.' },
          { text: 'Enter the deposit number, bank, principal amount, interest rate, opened date, and maturity date.' },
          { text: 'Choose the source of funds — Surplus, Corpus, or Other.' },
          { text: 'Optionally link the deposit to the matching unmatched bank debit (DR) transaction from the statement, for reconciliation.' },
        ],
        relatedIds: ['finance-what', 'finance-matured'],
      },
      {
        id: 'finance-matured',
        title: 'Marking a Deposit Matured',
        summary: 'Record the actual payout when an FD matures — the page shows an expected amount for reference, but the actual figure from the bank is what gets saved.',
        writeRoles: ['admin'],
        steps: [
          { text: 'Click "Mark Matured" on the deposit\'s row.' },
          { text: 'Enter the matured date and the actual maturity amount credited by the bank.' },
          { text: 'Optionally link the matching unmatched bank credit (CR) transaction from the statement.' },
        ],
        tips: [
          'The expected maturity amount shown is a simple-interest estimate — always enter the real amount the bank actually paid, since it may differ slightly (compounding, TDS deducted, etc.).',
        ],
        relatedIds: ['finance-what', 'finance-add'],
      },
    ],
  },
  {
    id: 'announcements',
    title: 'Announcements',
    icon: 'Megaphone',
    route: '/announcements',
    items: [
      {
        id: 'announcements-what',
        title: 'The Notice Board',
        summary: 'A simple notice feed for residents — events, utility interruptions, maintenance notices, governance and finance updates.',
        examples: [
          {
            label: 'Tags',
            description: 'Each announcement is tagged Event, Utility, Maintenance, Governance, or Finance, shown as a coloured badge.',
          },
        ],
        tips: [
          'Everyone can see this page, including Owner-role residents (it appears as "Notices" in their simplified nav) — it\'s one of the few pages residents have access to.',
          'Pinned announcements always show at the top, above the regular feed.',
        ],
        relatedIds: ['announcements-manage'],
      },
      {
        id: 'announcements-manage',
        title: 'Posting an Announcement',
        summary: 'Only Admin can compose, pin, or delete announcements — Committee sees the feed read-only, same as everyone else.',
        writeRoles: ['admin'],
        steps: [
          { text: 'Click "New announcement" on the Announcements page.' },
          { text: 'Enter a title, the body text, and pick a tag (Event / Utility / Maintenance / Governance / Finance).' },
          { text: 'Check "Pin to top" if it should stay above the regular feed (e.g. an urgent notice).' },
          { text: 'Click Post.' },
        ],
        warnings: [
          'Unlike most other pages, this is Admin-only to write — Committee members can read but not post, pin, or delete announcements.',
        ],
        relatedIds: ['announcements-what'],
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
        summary: 'Full list of all units with flat code, block, type, BHK, terrace, maintenance rate, and live corpus target/balance.',
        examples: [
          {
            label: 'Columns explained',
            description: 'Flat code (e.g. A-101), Block (A–E), Unit type (Apartment / Penthouse / Shop), BHK, P.T. (private terrace — Y/N), Rate/mo (current maintenance rate), Corpus Target (this flat\'s target across all active/draft corpus plans), Corpus Balance (how much of that target is still unpaid).',
          },
        ],
        tips: [
          'Click any column header to sort. Use the search box to find a specific flat or owner name.',
          'AG Grid allows you to resize columns by dragging the column header border.',
          'Corpus Target and Corpus Balance are computed live from the current corpus plan(s) — they show "—" for a flat with no active or draft corpus plan, not zero.',
        ],
        relatedIds: ['flats-rate-change', 'flats-area-details', 'flats-residents', 'flats-dues-whatsapp', 'flats-sender-mappings', 'corpus-statuses'],
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
        id: 'flats-area-details',
        title: 'Area Details',
        summary: 'Carpet, plinth, common, saleable, and P.O.T. area, plus U.D.S total, per flat — usually sourced from the sale deed.',
        writeRoles: ['admin'],
        steps: [
          { text: 'Click a flat row to open its detail panel.' },
          { text: 'In the "Area details" card, click "Add area details" (or "Edit area details" if already filled in).' },
          { text: 'Enter carpet area, plinth area, common area, saleable area, and P.O.T. (proportionate to other) area, plus the U.D.S (undivided share) total — all in sq.ft.' },
          { text: 'Click Save.' },
        ],
        tips: [
          'A flat with no area details yet shows a "Pending" badge on the card and "—" for each field. This is informational only — it doesn\'t block anything else in the app.',
          'These figures typically come from each owner\'s sale deed or the builder\'s area statement, so it\'s normal for this to be filled in gradually over time rather than all at once.',
        ],
        relatedIds: ['flats-grid'],
      },
      {
        id: 'flats-residents',
        title: 'People Card (on a Flat\'s Detail Panel)',
        summary: 'The owner(s) and tenant(s) currently linked to one specific flat, with contact phone and UPI IDs used in payment reminders.',
        steps: [
          { text: 'Click a flat row to open its detail panel — the "People" card lists everyone linked to that flat, grouped as Owner and Tenant.' },
          { text: 'Each row shows the person\'s name, their relation (Self, Co-owner, Spouse, Parent, Child, Guardian, Other), and — for Admin/Committee — their phone number as a tap-to-call link.' },
          { text: 'Admins also see any UPI IDs saved against that person, used for auto-matching bank payments.' },
          { text: '"Past residents" is collapsed by default — expand it to see anyone who has moved out of this flat, with their stay dates.' },
        ],
        tips: [
          'The UPI ID stored here appears in the WhatsApp reminder message generated from the Dues page or from this flat\'s own detail panel.',
          'Phone numbers are only visible to Admin and Committee roles — Auditors see names and relations but not contact details.',
          'To add, edit, move out, or delete a person, use the separate top-level Residents tab — see "Managing Residents" below.',
        ],
        relatedIds: ['dues-whatsapp', 'flats-grid', 'flats-dues-whatsapp', 'flats-residents-manage'],
      },
      {
        id: 'flats-residents-manage',
        title: 'Managing Residents (Residents Tab)',
        summary: 'A separate top-level tab listing every resident across every flat — add, edit, move out, reactivate, or delete a person from here.',
        writeRoles: ['admin'],
        steps: [
          { text: 'Go to Flats & Residents → Residents tab (next to the Flats tab at the top of the page).' },
          { text: 'Click "Add resident" to add a new owner or tenant — pick their flat, name, type (Owner/Tenant), relation, phone, email, and UPI IDs.' },
          {
            text: 'On supported phones, "Pick from contacts" fills in the name, phone, and email directly from your phone\'s contact list.',
          },
          { text: 'Click the pencil icon on a row to edit that resident, or the trash icon to permanently delete their record.' },
          {
            text: 'Click "Move out" to mark someone as no longer resident — pick the move-out date; if they share the flat with others of the same type (e.g. a spouse also listed as Self), you can move the whole household out together in one step.',
          },
          { text: 'A moved-out resident shows as "Inactive" and can be brought back with "Reactivate" if it turns out they never actually left.' },
        ],
        tips: [
          'Prefer "Move out" over "Delete" for someone who genuinely lived there and left — it preserves their occupancy history, which Delete does not.',
          'UPI IDs entered here are what auto-matches future bank payments to this resident — see Sender Mappings for cleaning up payments that couldn\'t be auto-matched.',
        ],
        warnings: [
          'Delete permanently removes the resident record. Only use it for a mistaken entry, not for someone who actually lived in the flat.',
        ],
        relatedIds: ['flats-residents', 'flats-sender-mappings'],
      },
      {
        id: 'flats-sender-mappings',
        title: 'Sender Mappings',
        summary: 'Admin-only tab for confirming which resident a bank sender ID (UPI handle or transfer narration token) actually belongs to.',
        roles: ['admin'],
        writeRoles: ['admin'],
        steps: [
          { text: 'Go to Flats & Residents → Sender Mappings tab (Admin only).' },
          {
            text: 'The "Legacy mappings to review" list shows sender tokens carried over from an old hardcoded list that haven\'t yet been assigned to a resident record.',
            detail: 'For each one, pick the flat, then the specific resident it belongs to, and click Confirm — this saves the token as one of that resident\'s UPI IDs.',
          },
          {
            text: 'If a legacy entry doesn\'t apply anymore (e.g. a one-off sender that shouldn\'t be permanently mapped), click the trash icon to dismiss it — this just hides it from the backlog, it doesn\'t save anything.',
          },
          {
            text: 'The "All flats" section below lists every resident who already has UPI IDs saved, grouped by flat — click a token to see every transaction that has matched it, or the small trash icon next to a token to remove that mapping.',
          },
          { text: 'Use the search box to filter either list by flat, phone, or sender ID.' },
        ],
        examples: [
          {
            label: 'Why this matters',
            description: 'When a bank credit\'s narration contains a UPI ID or token that matches a saved mapping, future imports can be tagged to the right flat automatically instead of landing in the Transactions Review queue every time.',
          },
        ],
        warnings: [
          'Confirming a mapping checks for conflicts — if that sender ID is already saved against a different resident, it blocks the save so you don\'t silently overwrite an existing mapping.',
        ],
        relatedIds: ['flats-residents-manage', 'txn-review'],
      },
      {
        id: 'flats-dues-whatsapp',
        title: 'Dues & WhatsApp Reminder on a Flat\'s Detail Panel',
        summary: 'Each flat\'s detail panel shows maintenance and corpus dues together, with a one-tap WhatsApp reminder button.',
        roles: ['admin', 'committee'],
        steps: [
          { text: 'Click a flat row on the Flats & Residents grid to open its detail panel.' },
          { text: 'The "Dues" card shows Maintenance outstanding and, if the flat is covered by an active/draft corpus plan, Corpus outstanding — plus a combined Total outstanding when both are due.' },
          { text: 'If anything is outstanding, a "Send" button appears per resident with a phone number on file — tap it to open WhatsApp with a pre-filled reminder message.' },
          { text: 'If no resident has a phone number saved, a "Copy reminder" button appears instead so you can paste the message manually.' },
        ],
        examples: [
          {
            label: 'What the WhatsApp message contains',
            description: 'The combined outstanding amount, a line-by-line breakdown (Maintenance / Corpus), the society\'s UPI ID and bank details from Settings → General (with a UPI quick-pay link when available), and a closing note from the association.',
          },
        ],
        tips: [
          'This is the fastest way to chase a specific flat — it pulls the same live dues figures shown on the Dues and Corpus pages, so there\'s no need to jump between pages.',
          'The Send/Copy reminder buttons only appear to Admin and Committee roles, matching who can see resident phone numbers.',
        ],
        warnings: [
          'A flat with no active or draft corpus plan will only show Maintenance outstanding in this card — that\'s expected, not a bug.',
        ],
        relatedIds: ['flats-grid', 'flats-residents', 'dues-whatsapp', 'corpus-statuses'],
      },
    ],
  },
  {
    id: 'owner-portal',
    title: 'My Flat (Resident View)',
    icon: 'Home',
    route: '/my-flat',
    items: [
      {
        id: 'owner-portal-what',
        title: 'What Residents See',
        summary: 'A read-only, single-flat summary — the entire "My Flat" / Owner Portal view for a resident\'s own unit.',
        roles: ['admin', 'committee', 'auditor'],
        examples: [
          {
            label: 'What\'s on the page',
            description: 'Flat identity, a society-wide health strip (maintenance cleared %, corpus collected %, last expense), this flat\'s maintenance dues status with pending months, one card per active corpus plan with a progress bar, a "how your corpus is used" expense breakdown, any outstanding corpus arrears from closed plans, the society\'s UPI/bank payment details with a suggested payment remark, and a payment history table with per-payment receipt downloads.',
          },
        ],
        tips: [
          'This is what an Owner-role login sees as their home page (labelled "My Flat") — Owners never see the committee-facing Dues/Corpus/Flats pages.',
          'A staff member (Admin/Committee/Auditor) who also has a flat assigned to them personally gets an extra "My Flat" nav item to see this same view for their own unit.',
          'There is nothing to add, edit, or delete here — the only action is downloading a fiscal-year statement PDF.',
        ],
        relatedIds: ['users-roles', 'dues-statuses', 'corpus-progress'],
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
        id: 'reports-cashbook',
        title: 'Cashbook',
        summary: 'A single fiscal month\'s opening/closing bank and petty cash balances, receipts, and payments — the day-to-day treasury view.',
        steps: [
          { text: 'Go to Reports → Cashbook tab.' },
          { text: 'Pick a fiscal month from the dropdown.' },
          { text: 'Review opening/closing bank balance, opening/closing petty cash, receipts by category, and payments by category (with line-level detail).' },
          { text: 'Export Excel (full itemized detail) or Download PDF.' },
        ],
        tips: [
          'Pending dues shown here are as of that month\'s end, not today — useful for a month-end close, not a live snapshot.',
          'Contribution-drive disbursements and Fixed Deposit placements are folded into Payments here even though neither is a normal expense record.',
        ],
        relatedIds: ['reports-rp', 'expenses-petty-cash'],
      },
      {
        id: 'reports-flat',
        title: 'Flat Statement',
        summary: 'A single flat\'s full transaction and dues/corpus history for a chosen period, with WhatsApp reminder and Excel/PDF export.',
        steps: [
          { text: 'Go to Reports → Flat statement tab and pick a flat.' },
          { text: 'Choose a date mode: current fiscal year, a custom range, or all-time.' },
          { text: 'Review the summary cards (rate, maintenance collected, outstanding, corpus collected/target/balance) and the transaction list below.' },
          { text: 'Use the export popover for a PDF or Excel copy, or Send/Copy a WhatsApp payment reminder directly from this tab.' },
        ],
        tips: [
          'This combines maintenance and corpus into one view per flat — useful for handling an individual owner\'s query without pulling data from two different pages.',
        ],
        relatedIds: ['dues-whatsapp', 'flats-dues-whatsapp'],
      },
      {
        id: 'reports-defaulters',
        title: 'Dues Aging (Defaulters List)',
        summary: 'Despite the tab name, this is the Defaulters List — every flat with an outstanding balance for the selected fiscal year — not a month-bucket aging report.',
        steps: [
          { text: 'Go to Reports → Dues aging tab.' },
          { text: 'Select the fiscal year.' },
          { text: 'Review the list (flat, block, annual due, collected, pending, arrears, total outstanding, status) or export it.' },
        ],
        tips: [
          'The same list, in a different sort order, is also one of the four AGM Reports as "Defaulters List".',
        ],
        relatedIds: ['reports-agm', 'dues-statuses'],
      },
      {
        id: 'reports-agm',
        title: 'AGM Reports (PDF)',
        summary: 'Four PDFs generated in one click each — Defaulters List, Income & Expenditure Statement, Corpus Fund Statement, and Receipts & Payments Account.',
        steps: [
          { text: 'Go to Reports → AGM reports tab.' },
          { text: 'Select the fiscal year (the Corpus Fund Statement ignores this and always covers all active/completed plans).' },
          { text: 'Click "Download PDF" on any of the four cards — it downloads immediately, there\'s no in-browser preview step first.' },
        ],
        examples: [
          {
            label: 'Income & Expenditure Statement',
            description: 'Income by category vs. expenditure by category for the fiscal year, with the resulting surplus or deficit.',
          },
          {
            label: 'Receipts & Payments Account',
            description: 'All receipts and all payments for the year (including contribution drives and owner-direct payments), with the closing balance.',
          },
        ],
        tips: [
          'PDF generation happens in the browser — no server call required.',
          'Generate all four AGM reports and send them to the statutory auditor well before the AGM.',
        ],
        warnings: [
          'Double-check the "Total Payments" figure on the Receipts & Payments Account PDF against the itemized payments list above it before circulating — cross-check it rather than taking the printed total at face value.',
        ],
        relatedIds: ['reports-defaulters', 'reports-rp', 'corpus-statuses'],
      },
      {
        id: 'reports-rp',
        title: 'R&P Statement',
        summary: 'A more detailed Receipts & Payments report than the one inside AGM Reports — includes an opening bank balance and FD interest earned.',
        steps: [
          { text: 'Go to Reports → R&P Statement tab.' },
          { text: 'Select the fiscal year.' },
          { text: 'Review Receipts (opening balance, maintenance/corpus/contribution collections, FD interest received) and Payments (expenditure by category plus contribution disbursements), and the resulting closing balance.' },
          { text: 'Download PDF (there\'s no Excel export on this tab).' },
        ],
        tips: [
          'This is a separate, richer report from the "Receipts & Payments Account" found under AGM Reports — use this one when you need the opening-balance and FD-interest detail.',
        ],
        relatedIds: ['reports-agm', 'reports-balance-sheet'],
      },
      {
        id: 'reports-balance-sheet',
        title: 'Balance Sheet',
        summary: 'A point-in-time snapshot as at 31 March of a chosen year: total assets (bank + FDs + petty cash) vs. liabilities (pending dues + corpus still held).',
        steps: [
          { text: 'Go to Reports → Balance Sheet tab.' },
          { text: 'Pick the "as at 31 March" year.' },
          { text: 'Review Assets, Liabilities, and the resulting Net Position, or Download PDF.' },
        ],
        tips: [
          '"Corpus yet to collect" (target minus collected) is shown as a memo line for context — it isn\'t included in the totals since it hasn\'t been received yet.',
        ],
        relatedIds: ['reports-rp'],
      },
      {
        id: 'reports-expenditure',
        title: 'Expenditure Reports',
        summary: 'Four sub-tabs — By category, By vendor, Monthly trend, and TDS Register — with a Fund filter (All/Maintenance/Corpus) and FY selector applied across all of them.',
        examples: [
          {
            label: 'By category',
            description: 'Bar chart plus table of spend per category, correctly split for vouchers that mix categories across their line items. Click a row to drill into every expense/line item in that category.',
          },
          {
            label: 'By vendor',
            description: 'Total paid per vendor, flagging anyone paid over ₹30,000 in the year as TDS-required.',
          },
          {
            label: 'Monthly trend',
            description: 'Total expenditure by month across the fiscal year (Apr→Mar).',
          },
          {
            label: 'TDS Register',
            description: 'A compliance register: vendor, PAN, total paid, the ₹30,000 threshold, amount over it, and the TDS due at 10%.',
          },
        ],
        tips: [
          'There\'s no separate staff salary report — salary-related spend only shows up as ordinary expense line items under whatever category they were recorded with.',
        ],
        relatedIds: ['expenses-vendors', 'expenses-staff'],
      },
      {
        id: 'reports-utility',
        title: 'Utility Reports',
        summary: 'One tab per category marked "Utility" in Settings — not a fixed EB/sewage layout. Whatever utility categories exist show up here automatically.',
        steps: [
          { text: 'Go to Reports → Utilities tab.' },
          { text: 'Pick one of the category tabs (e.g. Electricity, Water) — categories beyond the first several are tucked under a "More" menu.' },
          { text: 'Select the fiscal year and review the summary cards, the by-block/cost-centre monthly chart, and the line-item detail table.' },
          { text: 'Export Excel (there\'s no PDF export on this tab).' },
        ],
        tips: [
          'A category only appears here once it\'s marked "Utility" in Settings → Expense Categories, with a unit label if you want per-unit tracking (e.g. kWh).',
          'There\'s no built-in year-over-year comparison — switch the fiscal year dropdown manually to compare two years.',
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
        summary: 'The carry-forward fiscal year, the society\'s UPI/bank collection details used in reminders, and an About block.',
        writeRoles: ['admin'],
        steps: [
          { text: 'Go to Settings → General tab.' },
          {
            text: 'Under "Dues configuration", set "Carry-forward from" to the fiscal year dues tracking should start from.',
            detail: 'This is what actually drives the Dues page\'s tracked range — the Dues page itself has no FY selector.',
          },
          { text: 'Under "Collection payment details", update the UPI ID and bank transfer details — these populate every WhatsApp payment reminder across the app.' },
          { text: 'Click Save.' },
        ],
        tips: [
          'The "About" block on this tab (society name, flat/block count, tech info) is static reference text — it isn\'t an editable field here.',
          'Double-check the UPI ID whenever you change bank accounts — a wrong UPI causes residents to pay the wrong account.',
          'Non-admins can view this tab but the fields are read-only for them.',
        ],
        relatedIds: ['dues-whatsapp', 'settings-advance-fy', 'settings-categories'],
      },
      {
        id: 'settings-advance-fy',
        title: 'Advance Fiscal Year',
        summary: 'Roll the tracked dues range forward to the next fiscal year, converting every flat\'s current pending balance into an arrears record so nothing is lost.',
        writeRoles: ['admin'],
        steps: [
          { text: 'On Settings → General, click "Preview & Advance to FY [next]".' },
          { text: 'Review the preview list — every flat with an outstanding pending amount, and the arrears entry it will become.' },
          { text: 'Confirm to advance. The carry-forward fiscal year moves forward, and each listed flat gets a new arrears record instead of losing that unpaid balance.' },
        ],
        warnings: [
          'This is a one-way operation for the fiscal-year setting — review the preview carefully before confirming.',
        ],
        relatedIds: ['dues-arrears', 'dues-calc'],
      },
      {
        id: 'settings-categories',
        title: 'Expense Categories',
        summary: 'Add and edit expense categories. Mark as Utility (with a unit label) to give it its own tab in Utility reports.',
        writeRoles: ['admin'],
        steps: [
          { text: 'Go to Settings → Expense Categories tab.' },
          { text: 'Click "Add Category" to create a new one.' },
          {
            text: 'Enter: Name, Budget type (Maintenance or Corpus), sort order, and check "Utility" if this category should get its own tab in Reports → Utilities.',
            detail: 'A Utility category can also have a unit label (e.g. kWh, KL, trips) — this becomes the quantity column header when entering expense line items for it.',
          },
          { text: 'Click Save. The category is immediately available when adding an expense.' },
        ],
        examples: [
          {
            label: 'Utility category example',
            description: '"Electricity" with the Utility flag set and unit label "kWh". Expenses in this category get their own tab in Reports → Utilities, tracked per block/cost centre with a units column.',
          },
        ],
        tips: [
          'A category can be toggled active/inactive instead of deleted — inactive categories no longer appear when adding new expenses but past expenses keep their existing category.',
          'Cannot delete a category that\'s already used on any expense or line item — mark it inactive instead.',
        ],
        relatedIds: ['expenses-add', 'reports-utility'],
      },
      {
        id: 'settings-rates',
        title: 'Maintenance Rates (Bulk Rate Changes)',
        summary: 'View every flat\'s current rate, past rate history, and apply a rate change to one or many flats at once.',
        writeRoles: ['admin'],
        steps: [
          { text: 'Go to Settings → Maintenance Rates tab.' },
          { text: 'The main table shows each flat\'s current rate, filterable by block. "Rate change history" below lists past (closed) rate periods.' },
          { text: 'Click "Add Rate Change" to open the bulk dialog: enter the new monthly rate, an effective-from date, optional notes, then select which flats it applies to — with a per-block "select all" toggle for raising a whole block at once.' },
          { text: 'Saving automatically closes each selected flat\'s prior rate period and starts the new one from the effective date.' },
        ],
        tips: [
          'This is the same underlying rate-history mechanism as "Change maintenance rate" on a single flat\'s detail panel (Flats & Residents page) — this tab is just the bulk, multi-flat version of it.',
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
          'A lighter version of the same history also appears directly on the Transactions page\'s Upload tab, behind a "Show import history" link — useful when you\'re already there and just want a quick check.',
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
        summary: 'Admin has full read/write access everywhere. Committee and Auditor are read-only by default, but exactly what they can see is fine-tunable on the Permissions tab.',
        roles: ['admin', 'committee', 'auditor'],
        examples: [
          {
            label: 'Admin',
            description: 'Import bank statements, tag transactions, add/edit/delete expenses, change maintenance rates, manage corpus plans, manage users, generate all reports, view audit log. Full read + write access everywhere.',
          },
          {
            label: 'Committee',
            description: 'View all data on every page. Generate and download reports. Cannot add, edit, or delete records anywhere today, and cannot approve/reject expenses in the current build even though that\'s the intended design — see Expenses → Approval Status.',
          },
          {
            label: 'Auditor',
            description: 'View all data. Generate and download all reports. Strictly read-only — no mutations, no user management.',
          },
          {
            label: 'Owner (resident)',
            description: 'A resident\'s self-service login — sees only their own flat\'s dues/corpus status, society announcements, and payment info, via an entirely separate simplified nav. Cannot see other flats or any committee page.',
          },
        ],
        tips: [
          'Role badges are shown in the top-right of the app and in the sidebar footer.',
          'Action buttons (Add, Edit, Delete) are hidden from Committee and Auditor users, not just disabled.',
        ],
        relatedIds: ['users-add', 'users-edit', 'users-permissions'],
      },
      {
        id: 'users-add',
        title: 'Add a User',
        summary: 'Admin-only: create a new user account. Login email is auto-constructed as mobile@lilac.com.',
        roles: ['admin'],
        writeRoles: ['admin'],
        steps: [
          { text: 'Go to the Users page.' },
          { text: 'Click "Add User".' },
          {
            text: 'Enter the user\'s full name.',
          },
          {
            text: 'Enter their 10-digit mobile number (no spaces or country code).',
            detail: 'The login email is auto-constructed: 9876543210 → 9876543210@lilac.com',
          },
          { text: 'Select the role: Admin, Committee, Auditor, or Owner (resident self-service).' },
          { text: 'If the role is Owner, or the user should have "My Flat" access, assign their flat.' },
          { text: 'Click "Create User". A password is generated automatically — copy it or send it via the pre-filled WhatsApp link — and the user can log in immediately.' },
        ],
        tips: [
          'The new user\'s email is always <mobile>@lilac.com. They cannot change it.',
          'You can have multiple Admin users — useful when there is more than one treasurer.',
          'A non-Owner user (admin/committee/auditor) who also has a flat assigned to them personally gets an extra "My Flat" nav item to see their own flat\'s status.',
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
        summary: 'Admin can generate a new password for anyone in-place. Anyone can also change their own password from My Profile.',
        roles: ['admin'],
        writeRoles: ['admin'],
        steps: [
          { text: 'Go to the Users page and click Edit (pencil) on the user who needs a new password.' },
          { text: 'Click "Generate new password" in the edit dialog.' },
          { text: 'Share the new credentials with the user securely (the dialog offers a copy button and a pre-filled WhatsApp link).' },
        ],
        tips: [
          'This resets the password in place — the account, and everything tied to it (their expenses, edits, audit log entries), is untouched. There\'s no need to delete and recreate the user.',
          'Any logged-in user — any role — can also change their own password anytime from the sidebar → My Profile → Change password, without needing an admin.',
        ],
        warnings: [
          'Share passwords securely (in person or via an encrypted channel). Do not send passwords over SMS or unencrypted chat.',
        ],
        relatedIds: ['users-add', 'login'],
      },
      {
        id: 'users-permissions',
        title: 'Permissions Tab',
        summary: 'A matrix for fine-tuning exactly which resources (Transactions, Dues, Corpus, Expenses, Reports, Flats, Settings, Announcements, Activity, Users) Committee and Auditor can see.',
        roles: ['admin'],
        writeRoles: ['admin'],
        steps: [
          { text: 'Go to the Users page → Permissions tab.' },
          { text: 'Toggle a checkbox to grant or revoke a role\'s visibility into a specific resource.' },
        ],
        tips: [
          'Admin\'s row is always fully checked and locked — it can\'t be reduced from here.',
          'User Management itself is always locked to Admin only, for both Committee and Auditor.',
        ],
        relatedIds: ['users-roles'],
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
