import { test as setup, expect } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)
const authFile   = path.join(__dirname, '.auth/user.json')

setup('authenticate', async ({ page }) => {
  const email    = process.env.TEST_EMAIL    ?? ''
  const password = process.env.TEST_PASSWORD ?? ''

  if (!email || !password) {
    throw new Error('TEST_EMAIL and TEST_PASSWORD env vars must be set')
  }

  await page.goto('/')

  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')

  // Wait until we land on dashboard (redirect after login)
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })

  await page.context().storageState({ path: authFile })
})
