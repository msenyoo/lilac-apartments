import { test, expect } from '@playwright/test'

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
