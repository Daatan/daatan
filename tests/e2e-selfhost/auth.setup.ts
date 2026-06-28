import { test as setup, expect } from '@playwright/test'
import path from 'path'

// Sign in via the Playwright test credentials provider (enabled by
// PLAYWRIGHT_TEST=true) and persist the session for the self-host specs.
const authFile = path.join(__dirname, '../../playwright/.auth/selfhost.json')

setup('authenticate (self-host)', async ({ page }) => {
  await page.goto('/api/auth/signin')
  await page.getByLabel('User ID').fill('selfhost-user-1')
  await page.getByRole('button', { name: 'Sign in with Playwright Test' }).click()
  await expect(page).toHaveURL('/')
  await page.context().storageState({ path: authFile })
})
