import { test, expect } from '@playwright/test'
import { readFileSync, existsSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

// The move-out test mutates the AF1 "movable" fixture pair to Inactive.
// Both Desktop and Mobile projects share the same dev-DB rows, so whichever
// project's copy of this test runs second needs them reset back to Active first.
async function resetMovableFixture() {
  const raw = readFileSync('.env.dev.local', 'utf-8')
  const env = Object.fromEntries(
    raw.split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
      .map(l => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim()] })
  )
  const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: flat } = await supabase.from('flats').select('id').eq('code', 'AF1').single()
  await supabase.from('residents').update({ is_active: true, moved_out: null })
    .eq('flat_id', flat.id).in('name', ['E2E Movable Self', 'E2E Movable Spouse'])
}

// All tab bars in this app are custom <button> elements, NOT Radix/ARIA tabs.
// Use getByRole('button', { name: /label/i }) to click them.

// ─────────────────────────────────────────────
// Navigation
// ─────────────────────────────────────────────

test.describe('Navigation', () => {
  test('redirects / to /dashboard', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/dashboard/)
  })

  test('nav links work', async ({ page }) => {
    const routes = ['/transactions', '/dues', '/corpus', '/expenses', '/reports', '/settings']
    for (const route of routes) {
      await page.goto(route)
      await expect(page).toHaveURL(new RegExp(route.replace('/', '\\/')))
    }
  })
})

// ─────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/dashboard') })

  test('shows KPI cards', async ({ page }) => {
    await expect(page.locator('.rounded-xl').first()).toBeVisible()
  })

  test('page title is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible()
  })
})

// ─────────────────────────────────────────────
// Dues
// ─────────────────────────────────────────────

test.describe('Dues', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/dues') })

  test('renders flat grid', async ({ page }) => {
    await expect(page.locator('.ag-root-wrapper')).toBeVisible({ timeout: 10_000 })
  })

  test('clicking a flat opens detail panel', async ({ page }) => {
    await page.locator('.ag-root-wrapper').waitFor({ timeout: 10_000 })
    const firstRow = page.locator('.ag-row').first()
    await firstRow.waitFor({ timeout: 10_000 })
    await firstRow.click()
    await expect(page.getByText(/payment history/i)).toBeVisible({ timeout: 5_000 })
  })

  test('FY label is shown in page', async ({ page }) => {
    // DuesPage shows an FY label in the heading area
    await expect(page.getByText(/FY \d{4}/)).toBeVisible({ timeout: 5_000 })
  })

  test('dues reminder lists every active contact with a phone', async ({ page }) => {
    test.skip(!existsSync('e2e/fixtures.json'), 'run scripts/seed-e2e-residents.js first')
    const { contactsFlat } = JSON.parse(readFileSync('e2e/fixtures.json', 'utf-8'))
    await page.goto('/dues')
    await page.getByText(contactsFlat, { exact: true }).first().click()
    await expect(page.getByRole('button', { name: /Send · E2E Contact Tenant/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Send · E2E Contact Owner/ })).toBeVisible()
    // Payer-first ordering: tenant button must precede the owner button
    const sendButtons = page.getByRole('button', { name: /Send · E2E Contact/ })
    await expect(sendButtons.first()).toHaveText(/Tenant/)
  })
})

// ─────────────────────────────────────────────
// Transactions
// ─────────────────────────────────────────────

test.describe('Transactions', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/transactions') })

  test('shows Upload tab by default', async ({ page }) => {
    // Default tab is Upload — shows drag & drop area
    await expect(page.getByText(/click to select or drag/i).first()).toBeVisible({ timeout: 10_000 })
  })

  test('All Transactions tab shows grid', async ({ page }) => {
    await page.getByRole('button', { name: /all transactions/i }).click()
    await expect(page.locator('.ag-root-wrapper')).toBeVisible({ timeout: 15_000 })
  })

  test('tab buttons are visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: /^upload$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /all transactions/i })).toBeVisible()
  })
})

// ─────────────────────────────────────────────
// Corpus
// ─────────────────────────────────────────────

test.describe('Corpus', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/corpus') })

  test('shows plan selector or plan name', async ({ page }) => {
    const hasPlanContent = await page.locator('h2,h3,select,button').filter({ hasText: /corpus|plan/i }).count() > 0
    expect(hasPlanContent).toBeTruthy()
  })

  test('"By Flat" tab renders flat grid', async ({ page }) => {
    // "By Flat" is the default tab (key: collection) — grid loads automatically
    await expect(page.locator('.ag-root-wrapper')).toBeVisible({ timeout: 15_000 })
  })

  test('clicking flat row opens detail panel', async ({ page }) => {
    // "By Flat" tab is the default — wait for grid then click a row
    await page.locator('.ag-root-wrapper').waitFor({ timeout: 15_000 })
    await page.locator('.ag-row').first().waitFor({ timeout: 10_000 })
    await page.locator('.ag-row').first().click()
    await expect(page.getByText(/payment history/i)).toBeVisible({ timeout: 5_000 })
  })
})

// ─────────────────────────────────────────────
// Expenses
// ─────────────────────────────────────────────

test.describe('Expenses', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/expenses') })

  test('Day Book tab is default and renders', async ({ page }) => {
    // Default tab is daybook — KPI cards or empty state is visible
    await expect(page.locator('.card').first()).toBeVisible({ timeout: 10_000 })
  })

  test('Day Book tab button is present', async ({ page }) => {
    // Tab label is "Day Book" (with space)
    await expect(page.getByRole('button', { name: /day book/i })).toBeVisible()
  })

  test('Add Expense button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: /add expense/i })).toBeVisible()
  })

  test('Add Expense dialog opens and closes', async ({ page }) => {
    await page.getByRole('button', { name: /add expense/i }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5_000 })
    // Description input placeholder text from the JSX
    await expect(page.getByPlaceholder(/security salary june/i)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
  })

  test('Vendors tab renders with Add Vendor button', async ({ page }) => {
    await page.getByRole('button', { name: /^vendors$/i }).click()
    await expect(page.getByRole('button', { name: /add vendor/i })).toBeVisible({ timeout: 10_000 })
  })

  test('Staff tab renders with Add Staff button', async ({ page }) => {
    await page.getByRole('button', { name: /^staff$/i }).click()
    await expect(page.getByRole('button', { name: /add staff/i })).toBeVisible({ timeout: 10_000 })
  })
})

// ─────────────────────────────────────────────
// Reports
// ─────────────────────────────────────────────

test.describe('Reports', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/reports') })

  test('tab buttons show main report categories', async ({ page }) => {
    // Tabs: Monthly summary, Flat statement, Dues aging, AGM reports, Utilities, Expenditure
    await expect(page.getByRole('button', { name: /monthly summary/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /agm reports/i })).toBeVisible()
  })

  test('Monthly summary tab loads with KPI', async ({ page }) => {
    // Default tab is monthly summary — shows a card with the summary
    await expect(page.locator('.card').first()).toBeVisible({ timeout: 10_000 })
  })

  test('Flat statement tab renders', async ({ page }) => {
    await page.getByRole('button', { name: /^flat statement$/i }).click()
    // Flat statement shows cards and/or transaction ledger
    await expect(page.locator('.card').first()).toBeVisible({ timeout: 10_000 })
  })

  test('AGM reports tab shows report cards', async ({ page }) => {
    await page.getByRole('button', { name: /^agm reports$/i }).click()
    // Should show "Download PDF" buttons on the report cards
    await expect(page.getByRole('button', { name: /download pdf/i }).first()).toBeVisible({ timeout: 10_000 })
  })

  test('Expenditure tab renders', async ({ page }) => {
    await page.getByRole('button', { name: /^expenditure$/i }).click()
    await expect(page.locator('.card').first()).toBeVisible({ timeout: 10_000 })
  })

  test('advance payer with no outstanding is not listed as pending', async ({ page }) => {
    // Fixture (scripts/seed-e2e-advance-payer.js): AG1 cleared all dues through
    // the current month with a payment dated in the previous month. A flat with
    // total_outstanding <= 0 must not appear in the pending/outstanding list,
    // even though no money landed in the current month.
    await expect(page.getByRole('heading', { name: /collections by flat/i })).toBeVisible({ timeout: 10_000 })
    const pendingCard = page.locator('.surface').filter({
      has: page.getByRole('heading', { name: /pending maintenance|outstanding dues/i }),
    })
    await expect(pendingCard).toBeVisible({ timeout: 10_000 })
    await expect(pendingCard.getByText('AG1', { exact: true })).toHaveCount(0)

    // ...and the collections list must positively show the month is covered
    const collectionsCard = page.locator('.surface').filter({
      has: page.getByRole('heading', { name: /collections by flat/i }),
    })
    const ag1Row = collectionsCard.locator('div.flex', { hasText: 'AG1' })
    await expect(ag1Row.getByText(/paid in advance/i)).toBeVisible()
  })
})

// ─────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/settings') })

  test('Maintenance Rates tab renders rate list', async ({ page }) => {
    // Default tab is General — must click to Maintenance Rates first
    // Tab label is exactly "Maintenance Rates"
    await page.getByRole('button', { name: /^maintenance rates$/i }).click()
    // Rates render as card divs (not a table); wait for the card + Add Rate Change button
    await expect(page.locator('.card').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: /add rate change/i })).toBeVisible({ timeout: 5_000 })
  })

  test('Rate change dialog opens and is not clipped by viewport', async ({ page }) => {
    // Must navigate to Maintenance Rates tab first (default is General)
    await page.getByRole('button', { name: /^maintenance rates$/i }).click()
    await page.getByRole('button', { name: /add rate change/i }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5_000 })

    // Dialog must fit inside the viewport
    const box      = await dialog.boundingBox()
    const viewport = page.viewportSize()!
    expect(box).not.toBeNull()
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 5)

    // Apply/Save button at bottom must be reachable (not hidden under viewport)
    // Button text is "Apply to N flats" or "Apply to 0 flats"
    const saveBtn = dialog.getByRole('button', { name: /apply|save/i }).first()
    await expect(saveBtn).toBeVisible()

    await page.keyboard.press('Escape')
  })

  test('General tab has UPI field', async ({ page }) => {
    // General is the default tab, but click it explicitly to be safe
    await page.getByRole('button', { name: /^general$/i }).click()
    // UPI ID label text — rendered as a native <label> element
    await expect(page.getByText(/upi id/i)).toBeVisible()
  })
})

// ─────────────────────────────────────────────
// Flats
// ─────────────────────────────────────────────

test.describe('Flats', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/flats') })

  test('shows flat grid', async ({ page }) => {
    await expect(page.locator('.ag-root-wrapper')).toBeVisible({ timeout: 10_000 })
  })

  test('clicking flat opens detail panel', async ({ page }) => {
    await page.locator('.ag-row').first().waitFor({ timeout: 10_000 })
    await page.locator('.ag-row').first().click()
    // Detail panel shows flat code in an h3 (e.g. "AF1") and Rate history h4
    await expect(page.locator('.w-full.lg\\:w-72, .w-72').first()).toBeVisible({ timeout: 5_000 })
  })

  test('People card shows owner group, tenant group, and past residents', async ({ page }) => {
    await page.goto('/flats')
    await page.getByText('AG1', { exact: true }).first().click()
    await expect(page.getByRole('heading', { name: 'People' })).toBeVisible()
    await expect(page.getByText('E2E Owner One')).toBeVisible()
    await expect(page.getByRole('link', { name: '9000000001' })).toBeVisible()
    await expect(page.getByText('E2E Owner Spouse')).toBeVisible()
    await expect(page.getByText('E2E Tenant One')).toBeVisible()
    // history is collapsed by default
    await expect(page.getByText('E2E Past Tenant')).toBeHidden()
    await page.getByRole('button', { name: /Past residents/ }).click()
    await expect(page.getByText('E2E Past Tenant')).toBeVisible()
  })

  test('Residents tab has Relation column and Add modal relation dropdown', async ({ page }) => {
    await page.goto('/flats')
    await page.getByRole('button', { name: 'Residents' }).click()
    await expect(page.getByText('Relation', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Add resident/ }).click()
    const relationSelect = page.locator('select#relation')
    await expect(relationSelect).toBeVisible()
    await expect(relationSelect.locator('option', { hasText: 'Co-owner' })).toHaveCount(1)
    // Tenant side must not offer Co-owner
    await page.locator('select#restype').selectOption('Tenant')
    await expect(relationSelect.locator('option', { hasText: 'Co-owner' })).toHaveCount(0)
  })

  test('group move-out moves the whole household out with a chosen date', async ({ page }) => {
    await resetMovableFixture()
    // The residents grid has 9+ columns; on narrow (mobile) viewports the
    // Actions column is virtualized out of the DOM until scrolled into view.
    // This test is about the move-out flow, not column virtualization, so
    // widen the viewport to keep the Actions column reachable everywhere.
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/flats')
    await page.getByRole('button', { name: 'Residents' }).click()
    const row = page.locator('.ag-row', { hasText: 'E2E Movable Self' })
    await row.getByRole('button', { name: /Move out/ }).click()
    await expect(page.getByRole('heading', { name: /Move out/ })).toBeVisible()
    // household member offered and pre-ticked
    const spouseCheck = page.getByRole('checkbox', { name: /E2E Movable Spouse/ })
    await expect(spouseCheck).toBeChecked()
    await page.locator('.fixed.inset-0.z-50 input[type="date"]').fill('2026-06-30')
    await page.getByRole('button', { name: /^Move out$/ }).last().click()
    await expect(page.locator('.ag-row', { hasText: 'E2E Movable Self' }).getByText('Inactive')).toBeVisible()
    await expect(page.locator('.ag-row', { hasText: 'E2E Movable Spouse' }).getByText('Inactive')).toBeVisible()
  })
})

// ─────────────────────────────────────────────
// Phase 9: RBAC & User Management
// ─────────────────────────────────────────────

test.describe('Phase 9 — Settings: Users tab', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/settings') })

  test('Users tab is visible for admin', async ({ page }) => {
    // The Users tab is adminOnly — the test user is admin@lilac.com (admin role)
    await expect(page.getByRole('button', { name: /^users$/i })).toBeVisible({ timeout: 10_000 })
  })

  test('Users tab shows user grid with Add User button', async ({ page }) => {
    await page.getByRole('button', { name: /^users$/i }).click()
    // Grid header and Add User button should appear once the tab loads
    await expect(page.getByRole('button', { name: /add user/i })).toBeVisible({ timeout: 10_000 })
    // The user grid should show at least one row (the logged-in admin)
    await expect(page.getByText(/admin@lilac\.com|admin/i).first()).toBeVisible({ timeout: 10_000 })
  })

  test('Add User dialog opens with required fields', async ({ page }) => {
    await page.getByRole('button', { name: /^users$/i }).click()
    await page.getByRole('button', { name: /add user/i }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5_000 })
    // Dialog title
    await expect(dialog.getByText(/add user/i)).toBeVisible()
    // Required fields: Name, Mobile, Password, Role
    await expect(dialog.getByLabel(/^name/i)).toBeVisible()
    await expect(dialog.getByLabel(/^mobile/i)).toBeVisible()
    await expect(dialog.getByLabel(/^password/i)).toBeVisible()
    await expect(dialog.getByLabel(/^role/i)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
  })

  test('Mobile hint appears in Add User dialog when mobile typed', async ({ page }) => {
    await page.getByRole('button', { name: /^users$/i }).click()
    await page.getByRole('button', { name: /add user/i }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5_000 })
    // Type a 10-digit mobile — hint "Will log in as XXXXXXXXXX@lilac.com" should appear
    await dialog.getByLabel(/^mobile/i).fill('9876543210')
    await expect(dialog.getByText(/9876543210@lilac\.com/i)).toBeVisible({ timeout: 3_000 })
    await page.keyboard.press('Escape')
  })

  test('Edit User dialog opens from pencil icon in user row', async ({ page }) => {
    await page.getByRole('button', { name: /^users$/i }).click()
    // Wait for at least one user row to render
    await expect(page.getByRole('button', { name: /add user/i })).toBeVisible({ timeout: 10_000 })
    // Click the first edit (pencil) button in the list
    const editBtn = page.locator('button[title="Edit user"]').first()
    await editBtn.waitFor({ timeout: 10_000 })
    await editBtn.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5_000 })
    await expect(dialog.getByText(/edit user/i)).toBeVisible()
    // Role select should be present
    await expect(dialog.getByLabel(/^role/i)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
  })
})

test.describe('Phase 9 — Sidebar role badge', () => {
  test('sidebar footer shows role badge for logged-in admin', async ({ page }) => {
    await page.goto('/dashboard')
    // On desktop (default viewport) the sidebar is always visible
    // The role badge sits in the sidebar footer — look for "admin" text in that area
    const sidebar = page.locator('aside')
    await expect(sidebar).toBeVisible({ timeout: 10_000 })
    // Role badge text is the raw role string ("admin" / "committee" / "auditor")
    await expect(sidebar.getByText(/^admin$/i)).toBeVisible({ timeout: 5_000 })
  })

  test('sidebar footer shows user identifier', async ({ page }) => {
    await page.goto('/dashboard')
    const sidebar = page.locator('aside')
    await expect(sidebar).toBeVisible({ timeout: 10_000 })
    // The user label is the email without the @domain suffix, or full email
    // For admin@lilac.com it strips the domain → "admin"
    // We just assert that some non-empty user identifier text is visible
    await expect(sidebar.locator('.text-slate-300').first()).toBeVisible({ timeout: 5_000 })
  })
})

// ─────────────────────────────────────────────
// Mobile: no horizontal overflow
// ─────────────────────────────────────────────

test.describe('Mobile: key pages render without horizontal overflow', () => {
  const routes = ['/dashboard', '/dues', '/corpus', '/expenses', '/reports', '/settings']

  for (const route of routes) {
    test(`${route} — no horizontal scrollbar`, async ({ page }) => {
      await page.goto(route)
      await page.waitForLoadState('domcontentloaded')
      const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 10)
    })
  }
})

// ─── Phase 10: Expenses, Settings, Flats mutations ───────────────────────────

// ─────────────────────────────────────────────
// Expenses — Add Expense (Phase 10)
// ─────────────────────────────────────────────

test.describe('Phase 10 — Expenses: Add Expense', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/expenses') })

  test('Add Expense dialog has required header fields and line item section', async ({ page }) => {
    await page.getByRole('button', { name: /add expense/i }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5_000 })

    // Header fields
    await expect(dialog.locator('input[type="date"]').first()).toBeVisible()
    await expect(dialog.locator('input[type="number"]').first()).toBeVisible()
    await expect(dialog.getByPlaceholder(/security salary june/i)).toBeVisible()

    // Payee type and payment mode selects (SelectTriggers rendered as buttons with role combobox)
    await expect(dialog.getByText(/payee type/i)).toBeVisible()
    await expect(dialog.getByText(/payment mode/i)).toBeVisible()

    // Line items section heading
    await expect(dialog.getByText(/split.*line items|line items/i)).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
  })

  test('Add Expense — fill header + line item + save creates voucher', async ({ page }) => {
    await page.getByRole('button', { name: /add expense/i }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5_000 })

    // Fill header amount
    const amountInput = dialog.locator('input[type="number"]').first()
    await amountInput.fill('5000')

    // Fill description
    await dialog.getByPlaceholder(/security salary june/i).fill('E2E Test Expense')

    // Change payee type to "Other" so we get a free-text payee name field
    // (avoids needing a vendor to be pre-selected)
    await dialog.getByRole('combobox').first().click()
    // Select "Other" from the payee type dropdown
    const payeeOption = page.getByRole('option', { name: /^other$/i })
    if (await payeeOption.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await payeeOption.click()
    } else {
      await page.keyboard.press('Escape')
    }

    // Fill line item description (first text input in the line item card)
    await dialog.getByPlaceholder(/what is this for/i).fill('Test line item')

    // Fill line item amount — second number input in the dialog
    const lineAmountInput = dialog.locator('input[type="number"]').nth(1)
    await lineAmountInput.fill('5000')

    // Select a category for the line item — open the Category combobox inside the line item
    // The SelectTrigger for category is labeled "Category" and has placeholder text
    const categoryTrigger = dialog.getByRole('combobox').filter({ hasText: /category/i }).first()
    if (await categoryTrigger.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await categoryTrigger.click()
      // Pick the first available option in the dropdown
      const firstOption = page.getByRole('option').first()
      await firstOption.waitFor({ timeout: 3_000 })
      await firstOption.click()
    }

    // Save — button is enabled only when line total === header amount
    const saveBtn = dialog.getByRole('button', { name: /save expense/i })
    await expect(saveBtn).toBeEnabled({ timeout: 3_000 })
    await saveBtn.click()

    // Dialog should close after successful save
    await expect(dialog).not.toBeVisible({ timeout: 10_000 })

    // New entry should appear in Day Book list (look for the description or voucher pattern)
    await expect(page.getByText(/E2E Test Expense/)).toBeVisible({ timeout: 10_000 })
    // Voucher pattern: EXP-YYYY-NNNN
    await expect(page.getByText(/EXP-\d{4}-\d{4}/)).toBeVisible({ timeout: 5_000 })
  })

  test('Add Expense — line item balance indicator shows mismatch then match', async ({ page }) => {
    await page.getByRole('button', { name: /add expense/i }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5_000 })

    // Set header amount = 5000
    const amountInput = dialog.locator('input[type="number"]').first()
    await amountInput.fill('5000')

    // Set line item amount = 3000 (mismatch)
    const lineAmountInput = dialog.locator('input[type="number"]').nth(1)
    await lineAmountInput.fill('3000')

    // Trigger re-render by tabbing out
    await lineAmountInput.press('Tab')

    // The running total indicator should show mismatch — text like "3,000 / 5,000"
    // and should be in red (not green). The Save button should be disabled.
    const saveBtn = dialog.getByRole('button', { name: /save expense/i })
    await expect(saveBtn).toBeDisabled({ timeout: 3_000 })

    // Balance text shows both numbers
    await expect(dialog.getByText(/3,000/)).toBeVisible()

    // Now set line item amount = 5000 (match)
    await lineAmountInput.fill('5000')
    await lineAmountInput.press('Tab')

    // Save button should now be enabled (balance matches)
    await expect(saveBtn).toBeEnabled({ timeout: 3_000 })

    // Balance indicator shows matching total (green — text-green-600 class applied)
    // Just verify the amount text is present; colour testing via CSS class is fragile in e2e
    await expect(dialog.getByText(/5,000.*5,000|5,000 \/ 5,000/)).toBeVisible()

    await page.keyboard.press('Escape')
  })
})

// ─────────────────────────────────────────────
// Transactions — Void (Phase 10)
// ─────────────────────────────────────────────

test.describe('Phase 10 — Transactions: Void', () => {
  test('select a non-voided transaction, open Edit, void it', async ({ page }) => {
    await page.goto('/transactions')

    // Switch to All Transactions tab
    await page.getByRole('button', { name: /all transactions/i }).click()
    await expect(page.locator('.ag-root-wrapper')).toBeVisible({ timeout: 15_000 })

    // Switch to "All time" filter so sparse dev DB shows rows
    await page.getByRole('button', { name: /all time/i }).click()

    // Wait for grid to reload
    await page.waitForTimeout(1_000)

    // Click the first non-voided row
    // AG Grid rows: pick first .ag-row that does NOT contain "VOIDED" text
    const rows = page.locator('.ag-row')
    await rows.first().waitFor({ timeout: 10_000 })

    let targetRow = rows.first()
    const rowCount = await rows.count()
    for (let i = 0; i < rowCount; i++) {
      const rowText = await rows.nth(i).innerText()
      if (!rowText.includes('VOIDED')) {
        targetRow = rows.nth(i)
        break
      }
    }
    await targetRow.click()

    // Action strip / Edit button should appear
    const editBtn = page.getByRole('button', { name: /^edit$/i })
    await expect(editBtn).toBeVisible({ timeout: 5_000 })
    await editBtn.click()

    // Edit modal opens — Void button should be visible
    const voidBtn = page.getByRole('button', { name: /^void$/i })
    await expect(voidBtn).toBeVisible({ timeout: 5_000 })
    await voidBtn.click()

    // Confirmation appears: "Yes, void" button
    const confirmBtn = page.getByRole('button', { name: /yes.*void|yes, void/i })
    await expect(confirmBtn).toBeVisible({ timeout: 3_000 })
    await confirmBtn.click()

    // Modal closes; grid refreshes — the row should now show strikethrough / VOIDED style
    // The voided row is still in the grid but with opacity and line-through (CSS, not text).
    // We can confirm the modal is gone and no error is thrown.
    await expect(page.getByRole('button', { name: /yes.*void|yes, void/i })).not.toBeVisible({ timeout: 10_000 })
  })
})

// ─────────────────────────────────────────────
// Settings — Add expense category (Phase 10)
// ─────────────────────────────────────────────

test.describe('Phase 10 — Settings: Add expense category', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/settings') })

  test('Add Category dialog opens and new category appears in list', async ({ page }) => {
    // Navigate to Expense Categories tab
    await page.getByRole('button', { name: /expense categories/i }).click()

    // Click "+ Add Category"
    await page.getByRole('button', { name: /add category/i }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5_000 })
    await expect(dialog.getByText(/add category/i)).toBeVisible()

    // Fill name
    const nameInput = dialog.locator('input').first()
    await nameInput.fill('E2E Test Category')

    // Submit — button text is "Add Category"
    await dialog.getByRole('button', { name: /^add category$/i }).click()

    // Dialog closes
    await expect(dialog).not.toBeVisible({ timeout: 10_000 })

    // New category should appear in the categories list
    await expect(page.getByText('E2E Test Category')).toBeVisible({ timeout: 5_000 })
  })
})

// ─────────────────────────────────────────────
// Settings — Save general settings (Phase 10)
// ─────────────────────────────────────────────

test.describe('Phase 10 — Settings: Save general settings', () => {
  test('UPI ID persists after navigating away and back', async ({ page }) => {
    await page.goto('/settings')

    // General is the default tab
    await page.getByRole('button', { name: /^general$/i }).click()

    // Find the UPI ID input — labeled "UPI ID"
    // The label uses <label className="ds-lbl"> (not a <Label> component), so use getByText + sibling
    const upiLabel = page.getByText(/^UPI ID$/i)
    await expect(upiLabel).toBeVisible({ timeout: 5_000 })

    // The input is the one immediately after the UPI ID label — use a more stable locator
    // The Input component renders as <input> with placeholder "e.g. lilacapts@upi"
    const upiInput = page.getByPlaceholder(/lilacapts@upi/i)
    await upiInput.fill('test@upi')

    // Click Save settings
    await page.getByRole('button', { name: /save settings/i }).click()

    // Wait for save confirmation (button briefly shows "Saved!")
    await expect(page.getByRole('button', { name: /saved!/i })).toBeVisible({ timeout: 5_000 })

    // Navigate away
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/dashboard/)

    // Navigate back to settings
    await page.goto('/settings')
    await page.getByRole('button', { name: /^general$/i }).click()

    // UPI ID should still show the saved value
    const upiInputAfter = page.getByPlaceholder(/lilacapts@upi/i)
    await expect(upiInputAfter).toHaveValue('test@upi', { timeout: 5_000 })
  })
})

// ─────────────────────────────────────────────
// Flats — Change maintenance rate (Phase 10)
// ─────────────────────────────────────────────

test.describe('Phase 10 — Flats: Change maintenance rate', () => {
  test('change rate for first flat and verify rate history entry', async ({ page }) => {
    await page.goto('/flats')

    // Wait for grid to load and click the first flat row
    await page.locator('.ag-row').first().waitFor({ timeout: 10_000 })
    await page.locator('.ag-row').first().click()

    // Detail panel should open showing the flat code
    const detailPanel = page.locator('.w-full.lg\\:w-72, .w-72').first()
    await expect(detailPanel).toBeVisible({ timeout: 5_000 })

    // "Change maintenance rate" button is visible for admin
    const changeRateBtn = page.getByRole('button', { name: /change maintenance rate/i })
    await expect(changeRateBtn).toBeVisible({ timeout: 5_000 })
    await changeRateBtn.click()

    // Rate change modal opens — it is a custom modal (not Shadcn Dialog), look for the heading
    await expect(page.getByText(/change rate/i)).toBeVisible({ timeout: 5_000 })

    // "New monthly rate" input — pre-filled with current rate
    const rateInput = page.locator('input[type="number"]').first()
    await expect(rateInput).toBeVisible({ timeout: 3_000 })

    // Fill new rate = 1950
    await rateInput.fill('1950')

    // Compute next month's first day dynamically
    const nextMonthDate = await page.evaluate(() => {
      const d = new Date()
      d.setMonth(d.getMonth() + 1)
      d.setDate(1)
      return d.toISOString().slice(0, 10)
    })

    // Effective from date input
    const dateInput = page.locator('input[type="date"]').first()
    await dateInput.fill(nextMonthDate)

    // Click Save
    await page.getByRole('button', { name: /^save$/i }).click()

    // Modal should close
    await expect(page.getByText(/change rate/i)).not.toBeVisible({ timeout: 10_000 })

    // Rate history section should now show an entry with ₹1,950
    // The panel re-renders after save with the new rate history entry
    await expect(detailPanel.getByText(/1,950|₹1,950/)).toBeVisible({ timeout: 5_000 })
  })
})
