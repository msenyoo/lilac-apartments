# Lilac Apartments — Management App User Guide

**For:** Management committee members, Treasurer, Auditors
**App URL:** https://lilac-apartments.vercel.app
**Society:** Lilac Apartment Association, Rajakil Pakkam, Chennai — 44 flats, Blocks A–E

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Dashboard](#2-dashboard)
3. [Dues Tracker](#3-dues-tracker)
4. [Transactions](#4-transactions)
5. [Corpus Fund](#5-corpus-fund)
6. [Expenses](#6-expenses)
7. [Flats & Residents](#7-flats--residents)
8. [Reports](#8-reports)
9. [Settings](#9-settings)
10. [Users & Access](#10-users--access)
11. [Activity Log](#11-activity-log)
12. [Key Concepts Glossary](#12-key-concepts-glossary)
13. [Role Reference Card](#13-role-reference-card)
14. [Tips & Common Mistakes](#14-tips--common-mistakes)

---

## 1. Getting Started

### How to Log In

1. Open https://lilac-apartments.vercel.app in your browser (Chrome or Safari recommended).
2. Enter your login credentials:
   - **Username:** your 10-digit mobile number followed by `@lilac.com` — for example, `9876543210@lilac.com`
   - **Password:** the password set when your account was created (admin sets this for you)
3. Tap or click **Sign in**.
4. You will land on the Dashboard.

> **Tip:** Bookmark the URL or add it to your phone's home screen for quick access. On Android/iOS, open the URL in Chrome/Safari and choose "Add to Home Screen."

> **Note:** If your password is not working, ask the Treasurer (admin) to reset it. Users cannot reset their own passwords from within the app — password changes require admin access.

### The Three Roles

Every user has exactly one role. The role controls what they can see and do.

| Role | Who typically holds it | What they can do |
|---|---|---|
| **Admin** | Treasurer | Everything — add data, change settings, manage users |
| **Committee** | Committee members | View all data; cannot add or edit anything |
| **Auditor** | Appointed auditor | Read-only access to all data |

When you log in, the app automatically applies your role. Buttons for actions you cannot perform are either hidden or shown as disabled. You will also see a yellow banner on restricted pages reading "Read-only access — contact the administrator to make changes."

Your current role is shown as a small badge next to your name in the top navigation bar.

### Navigation Overview

**On desktop (laptop/computer):** A sidebar appears on the left side. Click any item to navigate.

**On mobile (phone):** A bottom navigation bar appears with icons for the main sections. Tap the icons to navigate.

The navigation items, in order, are:
- **Dashboard** — overview and alerts
- **Transactions** — bank statement import and review
- **Dues** — maintenance dues tracker
- **Corpus** — corpus fund collection and spending
- **Expenses** — day book and reconciliation
- **Reports** — all printable/exportable reports
- **Flats** — flat master and resident details
- **Settings** — app configuration
- **Users** — user management (Admin only)
- **Activity** — audit log

---

## 2. Dashboard

**Who can access:** Admin, Committee, Auditor (all roles)

The Dashboard is your daily starting point. It loads automatically after login and shows the current state of the society's finances at a glance.

### KPI Cards

Four summary numbers appear prominently at the top:

- **Dues pending (current FY):** The total rupee amount of maintenance unpaid across all flats for the current fiscal year. Below this you see a breakdown: how many flats are "Due" (nothing paid), "Partial" (some paid), and "Clear" (fully paid).
- **Corpus pool collected:** Total rupees collected across all active corpus plans. Tells you how much is sitting in the corpus fund.
- **This month's expenses:** Total amount spent this calendar month.
- **Unreconciled expenses:** How many expenses paid by bank transfer or cheque have not yet been matched to a bank debit transaction. A non-zero number here means the books are not fully balanced. This card turns amber as a warning when there are unreconciled expenses.

### Alert Strip

Immediately below the page title, the app shows coloured alert banners if any action is needed:

- **Amber — "X transactions need tagging":** Some imported bank transactions could not be automatically identified (which flat paid, or which expense category a debit belongs to). Click the banner to go directly to the Review tab in Transactions.
- **Amber — "X unreconciled expenses":** Bank transfer expenses exist that haven't been matched to a bank debit. Click to go to the Expenses page.
- **Red — "X flats have pending dues":** Flats with outstanding maintenance. Click to go to Dues Tracker.

Alerts disappear automatically as the underlying issues are resolved.

### Charts

Two charts appear below the KPI cards:

- **Monthly collection & expenses (bar chart):** Shows the last 12 months with three bars per month — Maintenance collected (violet), Corpus collected (blue), and Expenses (red). Useful for spotting trends or months where expenses exceeded collection.
- **Dues status (pie chart):** Shows the current split of flats into Clear / Partial / Due for the current FY. A healthy society should show mostly green (Clear).

If corpus plans are active, a third section shows **corpus plan progress bars** — one bar per plan — showing percentage collected vs target.

### Quick Links

At the bottom of the dashboard, five quick links take you to the most commonly used actions: Upload bank statement, Dues tracker, Corpus fund, Add/reconcile expenses, and Flats & residents.

---

## 3. Dues Tracker

**Who can access:** Admin, Committee, Auditor (all roles can view)
**Who can record payments:** Payments enter the system only through the Transactions page (Admin only). The Dues page itself is read-only.

**Route:** `/dues`

### What "Dues" Means

"Dues" in this app means maintenance money owed by each flat for the current fiscal year (April to March). The calculation is simple: monthly rate × number of months elapsed in the FY, minus whatever has actually been paid (as seen in imported bank transactions tagged to that flat as Maintenance).

### Status Badges

Each flat row in the grid shows one of three status badges:

| Badge | Meaning |
|---|---|
| **Due** (red) | No maintenance payment recorded at all for this FY |
| **Partial** (amber) | Some payment received, but the full amount is not yet covered |
| **Clear** (green) | All dues paid up to date for this FY |

### How to Read the Grid

The grid shows one row per flat with these columns:

- **Flat** — the flat code (e.g., A101, B203)
- **Rate/mo** — the current monthly maintenance amount for that flat
- **Due to date** — total expected amount from the start of the FY to today (or "Total Due" if carry-forward mode spans multiple years)
- **Collected** — total maintenance payments received from that flat in this period
- **Pending** — the difference (Due to date minus Collected). Shown in red if positive, a dash if zero.
- **Status** — the colour-coded badge described above

You can sort any column by clicking the column header. You can filter by typing in the small filter boxes below each header (for example, type "Due" in the Status filter to see only unpaid flats).

### Flat Drill-Down Panel

Click any flat row to open a detail panel on the right (on mobile, it appears below the grid):

- Shows the flat's block, BHK type, current rate per month, annual due, collected amount, and pending balance.
- A colour-coded progress bar shows visually how much of the dues have been paid.
- **Payment history** lists each maintenance credit transaction recorded for that flat, with date and amount.

Click the X button at the top of the panel to close it and deselect the flat.

### WhatsApp Reminder

When a flat has pending dues, a green **"Copy WhatsApp reminder"** button appears in the flat's detail panel.

1. Click a flat row in the grid to open the detail panel.
2. If the flat has pending dues, click **Copy WhatsApp reminder**.
3. The button briefly shows "Copied!" — the message is now in your clipboard.
4. Open WhatsApp, paste into a message to the flat's resident, and send.

The message reads approximately:
> "Dear resident of A101, Your maintenance dues of ₹X,XXX are pending for FY 2025-26. Please make the payment at your earliest convenience. UPI: [your UPI ID] Bank transfer: [your bank details] — Lilac Apartment Association"

The UPI ID and bank details in the message come from Settings → General. Make sure those are filled in.

### Export Dues List

Click the **Export** button in the top-right of the Dues page to download an Excel file with all flat dues data. The export respects any active column filters — so if you've filtered to only show "Due" flats, the export will contain only those.

### How Dues Are Calculated

Dues are computed by a database view (`v_dues_tracker`) and follow these rules:

1. **Rate × months:** The system uses each flat's maintenance rate (from the current maintenance rate history) multiplied by months elapsed since the start of the fiscal year (or a configured carry-forward start date).
2. **Collected:** Sum of all maintenance-category Credit transactions tagged to that flat within the period.
3. **Pending = Due to date − Collected.** If this is negative (over-paid), pending shows as zero.
4. **Carry-forward:** If the Treasurer has set "Carry-forward from FY XXXX" in Settings, the dues calculation spans multiple fiscal years, accumulating unpaid amounts from prior years. The page header will say "FY 2024-25 → FY 2025-26" to show that carry-forward is active.

> **Note:** Dues only update when bank transactions are imported and tagged. If a resident paid but the statement hasn't been uploaded yet, the dues will still show as pending until the import happens.

---

## 4. Transactions

**Who can access:** All roles can view. Only Admin can upload, tag, edit, or void.

**Route:** `/transactions`

### What a Transaction Is

Every row in the Transactions section is one line from the society's bank account statement — either a credit (money received, CR) or a debit (money paid out, DR). The app stores every line of every bank statement import here. This is the raw financial data that drives dues tracking, reconciliation, and reporting.

### Upload Tab — How to Import a Bank Statement

> **Admin only.** Committee and Auditor do not see the Upload tab.

The app supports two file formats:
- **ICICI PSV format:** `.txt` or `.psv` files downloaded from ICICI netbanking
- **Standard CSV:** Any CSV file with columns for Date, Description, and Debit/Credit amounts

**Step by step:**

1. Download your bank statement from ICICI netbanking in the supported format.
2. Navigate to **Transactions** and click the **Upload** tab.
3. Either drag and drop your file onto the upload area, or click it to browse and select the file.
4. The app reads the file and shows a **preview grid** with all transactions, including:
   - How many rows are in the file
   - How many are new (not yet in the database)
   - How many are duplicates (already imported — these will be skipped)
   - How many "Need review" (the auto-tagger couldn't identify them, shown in amber)
5. Review the preview. The "Match" column shows **Auto** (green) for rows the system identified automatically, and **REVIEW** (amber) for unknowns.
6. Click **Confirm — import X transactions** to save the data.
7. If any rows needed review, the app automatically switches to the Review tab.

> **Tip:** The system uses the transaction description and UPI IDs stored in Residents to auto-tag flat payments. The more complete your resident UPI IDs are, the fewer manual reviews you'll need.

> **Note:** Duplicate detection is based on a transaction ID embedded in the bank file. You can safely re-upload a statement — already-imported rows will be skipped automatically.

### Review Tab — Tagging Unknowns

Any transaction that the auto-tagger couldn't identify appears here. These are typically:
- A flat payment made via a new UPI ID not yet saved in the resident record
- Bank debits for miscellaneous expenses with no standard description
- Any transfer the system couldn't match to a flat code or expense category

**To tag a transaction:**

1. Each unidentified transaction shows its amount, date, and description.
2. Use the **Flat / Category** dropdown:
   - If it's a maintenance or corpus payment from a flat, select the flat code (e.g., A101).
   - If it's an expense debit, select the expense category (e.g., SALARY, EB, CIVIL).
3. If you selected a flat, a second **Category** dropdown appears — choose **Maintenance** or **Corpus**.
4. Click **Save tag**.

> **Tip:** If a credit is for multiple months of maintenance (for example, ₹3,600 for a flat with ₹1,800/month rate), a hint appears saying "This looks like 2 months of maintenance." You can also use the **Split** button to split the credit into two separate rows if needed.

### All Transactions Tab — Browsing

This tab shows every transaction in the database as a paginated, filterable grid.

**Filtering by date:**
- **FY XXXX-XX** (default): Shows only the current fiscal year (April to March).
- **Custom:** Enter a From and To date, then click Apply.
- **All time:** Shows up to 2,000 recent rows.

You can also filter by column — click the filter icon in any column header to filter by flat code, category, corpus flag, etc.

### Edit a Transaction

1. Click any row in the All Transactions grid to select it. An action strip slides in above the grid.
2. Click **Edit** in the action strip.
3. In the Edit dialog, change the **Flat / Category** or the **Type** (Maintenance vs Corpus).
4. Click **Save changes**.

> **Note:** Voided transactions cannot be edited. The Edit button is hidden for VOIDED rows.

### Void a Transaction

Voiding marks a transaction as invalid without deleting it. Use this when a row was imported incorrectly or needs to be reversed.

1. Click the row in the All Transactions grid to select it.
2. Click **Edit** in the action strip.
3. In the Edit dialog, click the **Void** button (red, at the bottom).
4. A confirmation prompt appears — click **Yes, void**.
5. The row remains visible in the grid but is grayed out with strikethrough text and shows a **VOIDED** badge.

**Why void instead of delete?** Voiding preserves the audit trail. The transaction is excluded from all financial calculations (dues, reconciliation, reports) but remains in the database so auditors can see that a record existed and was invalidated.

### Export

In the All Transactions tab, click **Export** (top right) to download the current filtered view as an Excel file. The filename includes the date range.

### How Transactions Relate to Dues and Expenses

- **Dues:** Credit transactions tagged to a flat with category "Maintenance" are summed to calculate how much that flat has paid. This drives the Dues Tracker.
- **Corpus:** Credit transactions tagged as Corpus contribute to corpus plan collection totals.
- **Expenses (Reconciliation):** Debit transactions from the bank are matched to Expenses recorded in the Expenses module. A matched expense is "Reconciled." An unmatched expense is "Unreconciled."

---

## 5. Corpus Fund

**Who can access:** All roles can view. Only Admin can manage plans.

**Route:** `/corpus`

### What a Corpus Fund Is

The corpus fund is a one-time capital collection from all flat owners, used to fund large planned expenditures (lift replacement, civil works, etc.). Unlike maintenance dues which are monthly and recurring, corpus is collected in installments over a defined period against a specific plan.

A **corpus plan** has a name, a total target amount, start and end fiscal years, and a per-flat target.

### Plan Statuses

| Status | Meaning |
|---|---|
| **Draft** (amber) | Plan created but not yet activated — flats may not be billed yet |
| **Active** (green) | Collection is ongoing |
| **Completed** (grey) | Target fully met and plan closed |
| **Cancelled** (red) | Plan was abandoned |

### Selecting a Plan

At the top right of the Corpus page is a **Plan selector** dropdown. You can view:
- **All active plans** — shows a consolidated view combining all active/draft plans
- **A specific plan** — filters all data to that plan only

When "All active plans" is selected, a consolidated banner appears showing each plan's collected vs target amounts side by side.

### Progress Bars

The large progress bar on the page shows:
- Percentage of total target collected so far
- Exact amounts: "₹X collected / ₹Y target"

A progress bar is also shown for each individual flat in the flat detail panel.

### By Flat Tab

This is the default tab. It shows a grid with one row per flat (per plan in the combined view), with columns:

- **Flat** — flat code
- **Target** — how much that flat owes for the plan
- **Collected** — how much has actually been paid
- **Balance** — remaining to be paid (amber if positive, green if zero)
- **% Paid** — progress percentage
- **Status** — Done (green), Partial (amber), or pending (grey)
- **Last Payment** — date of the most recent corpus credit transaction

Click any row to open a flat detail panel on the right, showing the payment history (individual corpus credit transactions) and a progress bar.

Click **Export** to download the by-flat data as Excel.

### Installment Plan Tab

Only visible when a specific plan is selected (not "All active plans"). This tab shows the installment schedule — how the total target is split across installments for each flat.

### Expenditure Tab

Shows how corpus money has been spent — corpus-tagged debit transactions from the bank statement. Columns show the category, date, and description of each corpus expenditure.

Summary cards at the top show Total Budget (planned spending), Spent so far, and Remaining budget.

> **Tip:** Corpus expenditures appear here because they are imported as bank transactions (debits) tagged with Corpus = YES during the review or edit process. They are not entered separately.

---

## 6. Expenses

**Who can access:** All roles can view. Only Admin can add, edit, or reconcile expenses.

**Route:** `/expenses`

### What an Expense Is

An expense represents money the committee has paid out — salaries, electricity bills, plumbing repairs, etc. An expense is recorded in the app separately from the bank statement, and is later **reconciled** (matched) to the corresponding bank debit.

### Hub-and-Spoke Payment (Intermediary)

Sometimes the Treasurer makes one bank transfer that covers multiple payments — for example, withdrawing cash to pay the security guard, sweeper, and gardener separately. In this case:
- The header expense is the bank transfer (the hub), paid to "Intermediary"
- Each line item within it represents the actual recipient (the spokes)

This lets the app accurately track where every rupee went, even when it went through the Treasurer's hands as an intermediate step.

### The Day Book Tab

The Day Book (default tab) is a chronological list of all recorded expenses, most recent first. Each entry shows:
- The date and day
- A description
- The voucher number (EXP-YYYY-NNNN, auto-assigned)
- The payee name and category
- A status badge
- The total amount

**Status badges:**

| Status | Meaning |
|---|---|
| **Cash** (grey) | Paid in cash — no bank debit to match |
| **Unreconciled** (amber) | Paid by bank transfer/cheque but not yet matched to a bank debit |
| **Reconciled** (green) | Matched to a specific bank debit transaction |

Click any expense in the list to open a detail panel on the right showing all fields and the breakdown of line items.

Click **Export** (top right) to download the full day book as Excel.

### How to Add an Expense

> **Admin only.** The "Add Expense" button is hidden for Committee and Auditor.

1. Click the **Add Expense** button (top right of the Expenses page).
2. An "Add Expense" dialog appears. Fill in the **header fields**:

   | Field | What to enter |
   |---|---|
   | **Date** | Date of payment (the actual payment date, not invoice date) |
   | **Description** | Brief description of what was paid for (e.g., "June salary — Security") |
   | **Amount** | Total amount paid (whole rupees only) |
   | **Payee type** | Staff / Vendor / Intermediary / Municipal / Other |
   | **Staff / Vendor** | If payee type is Staff or Vendor, select from the dropdown |
   | **Payment mode** | Cash / Online / Bank Transfer / Cheque |
   | **Reference / UTR** | Bank reference number or UTR (for Online or Bank Transfer payments) |
   | **Cheque number** | Only for cheque payments |
   | **Category** | Optional overall category for the expense header |
   | **Corpus plan** | Only if this expense is funded from a corpus plan |
   | **Notes** | Any additional remarks |

3. Below the header, add **Line items**. Every expense must have at least one line item. Line items show the breakdown of the total amount across recipients, cost centres, or periods.

   | Field | What to enter |
   |---|---|
   | **Description** | What this specific line item covers (e.g., "June salary") |
   | **Amount** | Rupee amount for this line item |
   | **Category** | The expense category (required — save is blocked if blank) |
   | **Cost centre** | Block-A through Block-E / Common / Municipal / All |
   | **Payee type** | Who received this payment |
   | **Period from / to** | Month range this covers (e.g., 2025-06-01 to 2025-06-30) |

4. The **running total** of line items is shown at the bottom of the line items section. It turns **green** when the sum matches the header amount, and **amber** when they do not match. You cannot save until they balance.

5. Click **Save** (or "Create expense"). The expense is saved and a voucher number (EXP-2026-NNNN) is automatically assigned.

> **Note:** The voucher number format is EXP-[year of expense]-[sequential number]. It is generated automatically by the database and cannot be changed.

> **Tip:** To add another line item, click the **+ Add line item** button within the dialog.

### Reconcile Tab

The Reconcile tab helps you match recorded expenses to bank debit transactions.

The screen has two columns:
- **Left:** Unreconciled expenses (those paid by bank transfer or cheque, not yet matched)
- **Right:** Unmatched bank debit transactions (DRs from the bank statement not yet linked to an expense)

Match them by selecting an expense on the left and the corresponding bank debit on the right, then confirming the match. Once matched, the expense status changes to "Reconciled" and it leaves the list.

### Vendors Tab

Shows the vendor master list — contractors, service providers, utilities. Each vendor has a name, type, phone number, and PAN number.

To add a vendor: Click **Add Vendor**, fill in the details, and save. The vendor then appears in the Vendor dropdown when adding expenses.

### Staff Tab

Shows the staff master list — security guards, sweepers, gardeners, etc. Each staff member has a name, role, assigned area, phone number, and a salary history (showing current and past salary rates with effective dates).

To add a staff member: Click **Add Staff Member**, enter details and current salary rate, and save.

### Recurring Expenses Tab

Shows templates for regularly recurring expenses (e.g., monthly security salary). A recurring template stores the vendor/staff, category, amount, payment mode, and frequency (monthly, quarterly, etc.). When it's time to record the actual payment, use the template as a starting point to pre-fill the Add Expense form.

### Petty Cash Tab

Tracks small cash transactions managed separately from the main bank account. Each entry is a credit (cash in) or debit (cash out) with a date, amount, and description. The running balance is maintained automatically.

---

## 7. Flats & Residents

**Who can access:** All roles can view. Only Admin can change maintenance rates.

**Route:** `/flats`

### Flat Master — What's Stored Per Flat

The Flats tab shows a grid of all 44 flats with these columns:

| Column | Meaning |
|---|---|
| **Flat** | Flat code (e.g., A101) |
| **Block** | Block A through E |
| **Unit Type** | Apartment / Duplex / Penthouse etc. |
| **BHK** | 2BHK, 3BHK, etc. |
| **P.T.** | "YES" if the flat has a private terrace (which may affect corpus target) |
| **Rate/mo** | Current monthly maintenance amount |
| **Corpus Target** | Total corpus contribution expected from this flat |

Click any flat to open a detail panel on the right showing block, unit type, BHK, rate, corpus target, and the full rate history.

### Maintenance Rate History

Each flat maintains a full history of every rate change with effective dates. In the flat detail panel, the rate history section shows:
- Each rate that applied, from newest to oldest
- The date from which each rate was effective

Rates only apply from their effective date onwards — historical dues calculations use the rate that was active at the time.

### How to Change a Maintenance Rate

> **Admin only.**

1. Click a flat in the grid to open its detail panel.
2. Click the **Change maintenance rate** button.
3. Enter the new rate in rupees (whole number only).
4. Enter the **Effective from** date. This must be a future date or the first of the current month. Rate changes cannot be backdated.
5. Optionally add a note (reason for change).
6. Click **Save**.
7. The flat's Rate/mo column in the grid updates immediately. The rate history in the panel shows the new entry at the top.

> **Note:** Rate changes are "forward-only." Once a rate change is saved, it cannot be edited. If you enter the wrong date or amount, contact the system administrator who will need to correct it in the database directly.

### Residents Tab

Shows the resident master — owners and tenants for each flat.

Each resident record includes:
- Name
- Whether they are the owner or a tenant
- Phone number
- Email address
- UPI ID(s) — these are used by the auto-tagger when importing bank statements to identify which flat a payment came from

> **Tip:** Keep resident UPI IDs up to date. If a resident starts using a new UPI ID for payments, add it to their profile. This reduces the number of transactions that land in the Review queue.

---

## 8. Reports

**Who can access:** All roles can view and export.

**Route:** `/reports`

The Reports page has six tabs across the top, each serving a different reporting need.

### Monthly Summary Tab

A concise statement for any given month, intended to share with the general body or WhatsApp groups.

**How to use:**
1. Select a month from the dropdown in the top right (months are in fiscal label format, e.g., "Jun-25").
2. The summary card shows maintenance collected, how many flats paid, total expenses, corpus collected, and corpus target.
3. Below that, a list of all expenses for the month (by category).
4. Below that, per-flat collection status.
5. Finally, a list of flats with pending dues for that month.

**Actions:**
- **Share with residents** — copies a formatted text summary to your clipboard (or triggers the native share sheet on mobile). Paste into WhatsApp.
- **Export Excel** — downloads an Excel file with Summary, Collections, and Expenses sheets.

### Flat Statement Tab

Generates a full statement for a single flat — all transactions (debits and credits) for any selected period.

Select the flat code and date range, then view or export.

### Dues Aging Tab

Shows all flats with outstanding dues sorted by pending amount (highest first). This is the "defaulters list" used for AGM presentations.

Select the fiscal year from the dropdown. Click **Export** to download the defaulters list as Excel or generate a PDF.

### AGM Reports Tab

The AGM (Annual General Meeting) tab generates formal financial documents required for the annual body meeting. Available reports include:

- **Income & Expenditure (I&E) Statement** — lists all income (maintenance, corpus) and expenditure for the year in a formal accounting format
- **Receipts & Payments Statement** — cash-flow statement showing all money received and paid
- **Defaulters List** — flats with outstanding dues
- **Corpus Fund Statement** — plan-level corpus collection and expenditure

**How to generate an AGM PDF:**
1. Click the **AGM reports** tab.
2. Select the report type (e.g., I&E Statement).
3. Select the fiscal year.
4. Click **Preview** to see the PDF rendered in-browser.
5. Click **Download PDF** to save the file.

> **Note:** AGM PDFs are generated entirely in the browser — no separate software is needed. The PDF is formatted for A4 printing.

### Utilities Tab

Shows electricity and other utility bill tracking. Filter by block or utility type to see historical usage and payments.

### Expenditure Tab

Shows all expenses across any selected period, grouped by category or cost centre. Useful for understanding where money was spent. Supports Excel export.

---

## 9. Settings

**Who can access:** All roles can view. Only Admin can save changes.

**Route:** `/settings`

### General Tab

**Dues configuration:**
- **Carry-forward from:** Select the fiscal year from which dues should be cumulated. For example, if set to FY 2024-25, the Dues Tracker will show the total unpaid amount from April 2024 onwards, not just the current year. Setting this to the current year means only current-year dues are shown.

**Collection payment details:**
- **UPI ID:** The society's UPI handle (e.g., `lilacapts@upi`). This appears in WhatsApp reminder messages sent from the Dues Tracker.
- **Bank transfer details:** Account number and IFSC code. Also appears in WhatsApp reminders.

After making changes, click **Save settings**. The button briefly shows "Saved!" to confirm.

### Maintenance Rates Tab

An overview of the current maintenance rate for every flat, filterable by block. This is a read-only summary — to change a rate, go to Flats & Residents and use the "Change maintenance rate" button in the flat detail panel.

Admins can also click **Add Rate Change** here to add a rate change without going through the Flats page.

### Expense Categories Tab

Lists all configured expense categories (e.g., "Maintenance", "Lift Service", "Civil Work"). Categories are used when adding expense line items.

**To add a category:**
1. Click **Add Category**.
2. Enter the category name.
3. Set the budget type (Maintenance or Corpus).
4. Optionally mark it as a **Utility category** (this flag allows utility-specific fields like units and rate in line items, used for electricity billing).
5. Click **Add Category**.

To edit an existing category, click the pencil icon next to it.

> **Note:** Deleting a category is not supported through the UI to avoid breaking historical expense records that reference it.

### Import History Tab

Shows a list of all bank statement files ever imported, with details of when they were imported, how many transactions were added, how many were duplicates, and how many needed review. Use this to confirm that a specific month's statement was imported.

---

## 10. Users & Access

**Who can access:** Admin only. Committee and Auditor see an "Admin access required" message.

**Route:** `/users` (also accessible from Settings in some configurations)

### The Three Roles Explained

- **Admin (Treasurer):** The person responsible for the society's finances. Can do everything — add expenses, import bank statements, manage users, change settings. Think of this as full access.
- **Committee:** A committee member who can view all financial data and reports but cannot make any changes. Useful for committee meetings where members review the accounts.
- **Auditor:** Strictly read-only. Can view and export all data for auditing purposes but cannot change anything.

### How to Add a User

1. Navigate to **Users** (visible only to Admin).
2. Click **Add user** (top right).
3. Fill in:
   - **Name** — the person's full name (e.g., Rajesh Kumar)
   - **Mobile** — their 10-digit mobile number (no spaces or dashes). This becomes their login username as `<mobile>@lilac.com`
   - **Password** — a password of at least 8 characters. Communicate this to the new user privately.
   - **Role** — Admin / Committee / Auditor
4. Click **Create user**.
5. Tell the new user to log in at https://lilac-apartments.vercel.app with `<their mobile>@lilac.com` and the password you set.

> **Note:** The "Create user" function runs via a secure server function. If you see an error message, the server function may be temporarily unavailable — try again in a few minutes.

### How to Edit a User's Role or Details

1. On the Users page, find the user in the table.
2. Click the pencil (edit) icon at the end of their row.
3. In the Edit dialog, you can change:
   - Display name
   - Mobile number
   - Contact email (a real email address, separate from the login username)
   - Role
4. Click **Save changes**.

> **Note:** Changing a user's role takes effect immediately on their next page load or action. If a committee member is promoted to Admin, they will gain write access as soon as they refresh.

### Login Format

All user logins follow the pattern `<10-digit-mobile>@lilac.com`. For example, if the mobile number is 9876543210, the login is `9876543210@lilac.com`. This avoids confusion with real email addresses and keeps the user list simple.

---

## 11. Activity Log

**Who can access:** All roles can view.

**Route:** `/activity` (visible as "Activity" in the navigation)

### What It Records

The Activity Log captures every create, update, and delete operation on the key tables in the database. It is driven by Postgres triggers — meaning it records changes at the database level, independently of the app UI. Even if a change is made directly in the database by a developer, it appears here.

Tables tracked include: transactions, expenses, uploads, maintenance payments, corpus plans, corpus payments, flats, maintenance rate history, app settings, and user roles.

### How to Read an Entry

Each log entry shows:
- **User** — the email/username of who made the change (or "System" for automated operations)
- **Table** — which database table was affected
- **Action** — INSERT (new record added), UPDATE (record changed), or DELETE (record removed)
- **Timestamp** — date and time of the change

Click any entry to expand it and see the **Before** and **After** values — the exact data fields that changed. This lets you verify precisely what was modified.

### Filters

At the top of the page:
- **Table filter:** Narrow to a specific table (e.g., only show changes to `expenses`)
- **Action filter:** Show only INSERTs, only UPDATEs, or only DELETEs
- **Date range:** Defaults to the last 30 days; adjust as needed

Results are capped at 100 rows per query — if you need more history, adjust the date range.

> **Note:** The Activity Log cannot be edited or deleted by anyone — it is a tamper-evident record maintained by the database itself. Use it for AGM transparency to show the general body that all changes are tracked.

---

## 12. Key Concepts Glossary

**Fiscal Year (FY)**
The financial year runs from 1 April to 31 March. FY 2025-26 means April 2025 to March 2026. All dues, reports, and corpus plans are organised by fiscal year.

**Carry-forward**
When unpaid dues from a prior fiscal year are carried into the current year's calculations, so the Dues Tracker shows the total accumulated outstanding amount rather than just the current year's dues. Configured in Settings → General → Carry-forward from.

**Reconciliation**
The process of matching a recorded expense to the corresponding debit line in the bank statement. Until an expense is reconciled, it is "Unreconciled" — meaning the app knows money was spent, but hasn't confirmed which bank transaction it corresponds to. Reconciliation proves that the recorded expense is backed by an actual bank debit.

**Voucher Number**
A unique reference number assigned to each expense record. Format: EXP-YYYY-NNNN (e.g., EXP-2026-0023). Auto-generated by the database when an expense is saved — no manual entry required. Used in the day book and AGM reports for cross-referencing.

**Cost Centre**
A label that assigns an expense to a specific block (Block-A through Block-E) or a shared area (Common, Municipal, All). Useful for determining which block's residents benefit from or contribute to a specific expense.

**Hub-and-Spoke Payment**
When the Treasurer makes one bank transfer to cover multiple individual payments. The bank transfer is the "hub" — recorded as a single expense with payee type "Intermediary." Each actual recipient (guard's salary, sweeper's salary, etc.) is a "spoke" — a line item within that expense. The line items must sum exactly to the header amount.

**Corpus vs Maintenance**
Maintenance is the recurring monthly collection for day-to-day society operations. Corpus is a one-time or installment-based collection for large capital projects. Both types of payments appear in the Transactions table but are tagged separately (Category = Maintenance or Corpus, and the Corpus flag = YES/NO).

**Void**
A soft-delete action that marks a transaction as invalid without removing it from the database. Voided transactions are greyed out in the grid and excluded from all calculations. They remain visible so that auditors can see that a record existed. Use Void when a transaction was imported by mistake or needs to be reversed.

**CR / DR**
Credit (CR) = money received into the account. Debit (DR) = money paid out. Maintenance payments from residents appear as CRs. Expense payments appear as DRs.

---

## 13. Role Reference Card

| Feature / Action | Admin | Committee | Auditor |
|---|---|---|---|
| **View Dashboard** | Yes | Yes | Yes |
| **View Dues Tracker** | Yes | Yes | Yes |
| **Copy WhatsApp reminder** | Yes | Yes | Yes |
| **Export Dues to Excel** | Yes | Yes | Yes |
| **View Transactions** | Yes | Yes | Yes |
| **Upload bank statement** | Yes | No | No |
| **Tag / review transactions** | Yes | No | No |
| **Edit a transaction** | Yes | No | No |
| **Void a transaction** | Yes | No | No |
| **View Corpus Fund** | Yes | Yes | Yes |
| **Export Corpus data** | Yes | Yes | Yes |
| **View Expenses / Day Book** | Yes | Yes | Yes |
| **Add an expense** | Yes | No | No |
| **Reconcile expenses** | Yes | No | No |
| **Add / edit vendors** | Yes | No | No |
| **Add / edit staff** | Yes | No | No |
| **View Flats & Residents** | Yes | Yes | Yes |
| **Change maintenance rate** | Yes | No | No |
| **View Reports** | Yes | Yes | Yes |
| **Download PDFs** | Yes | Yes | Yes |
| **Download Excel reports** | Yes | Yes | Yes |
| **View Settings** | Yes | Yes | Yes |
| **Save Settings** | Yes | No | No |
| **Add expense categories** | Yes | No | No |
| **Add rate changes** | Yes | No | No |
| **View Users page** | Yes | No | No |
| **Add a user** | Yes | No | No |
| **Edit a user / change role** | Yes | No | No |
| **View Activity Log** | Yes | Yes | Yes |

---

## 14. Tips & Common Mistakes

**Do import the bank statement every month.** The entire dues tracking and reconciliation system depends on up-to-date bank data. If you skip a month, dues will show incorrectly and the dashboard alert count will be wrong.

> **Tip:** Set a reminder on the 5th of each month to download and import the previous month's statement.

**Always review the upload preview before confirming.** The preview shows how many rows are new, how many are duplicates, and how many need manual review. If you see an unexpectedly large number of "Needs review" rows, check that you downloaded the correct file format from the bank.

**Tag all "Review" transactions promptly.** Untagged transactions leave dues incorrect for affected flats and inflate the unreconciled count on the dashboard. The goal is to clear the Review queue to zero after each import.

> **Tip:** If you regularly see the same UPI ID or description landing in Review, add that UPI ID to the resident's profile in Flats & Residents. The system will auto-tag it next time.

**Do not use negative amounts in expenses.** If a vendor refunded money, record the bank credit as a transaction tagged to the appropriate expense category, or add a note. Do not enter a negative expense amount — the form will reject it.

**Line items must sum to the header amount.** When adding an expense, the running total of all line items must exactly equal the header amount before you can save. Watch the indicator — it turns green when balanced. A common mistake is forgetting to add a second line item when splitting a payment.

**Rate changes are permanent from the effective date.** If you enter the wrong rate or date, you cannot edit it. Double-check the rate and effective date before saving a rate change. If you made a mistake, contact the system developer to correct it in the database.

> **Note:** Rate changes apply only from the effective date forward. Past dues calculations are not retroactively changed.

**The WhatsApp reminder uses UPI/bank details from Settings.** If the reminder message shows blank payment details, go to Settings → General and fill in the UPI ID and bank transfer details, then save.

**Void, do not delete.** If you imported a wrong transaction or a duplicate slipped through, use Void — not any manual deletion. Voided rows are preserved in the audit trail and excluded from all calculations.

**AGM reports need complete data.** The I&E Statement and other AGM PDFs are only as accurate as the data in the system. Before generating AGM documents, make sure all bank statements for the fiscal year have been imported, all expenses are recorded and reconciled, and the dues tracker reflects actual collections.

> **Tip:** Run through the Dashboard alerts before an AGM. Zero untagged transactions, zero unreconciled expenses, and a correct dues count means the books are in order.

**Corpus debit transactions must be tagged correctly.** When corpus money is spent (e.g., a bank transfer for lift replacement), the bank debit appears in Transactions. In the Edit dialog, check the **Corpus** checkbox to mark it as corpus expenditure. If this is not done, the Corpus Expenditure tab will show an incomplete picture.

**Users cannot reset their own passwords.** If someone is locked out, the Admin (Treasurer) must use the Supabase dashboard to reset the password. This is an app limitation by design to maintain security.
