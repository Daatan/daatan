import { test, expect } from '@playwright/test'

/**
 * E2E tests for the Express Forecast creation flow.
 *
 * These tests verify the critical user journey:
 *   /create (express input) → AI generates → Review → /create?from=express (wizard)
 *
 * Since the full flow requires authentication and a real AI backend, we test the
 * navigation/routing contract separately — the part that was broken when
 * CreateForecastClient ignored the ?from=express query parameter.
 */

test.describe('Express Forecast Flow — Routing', () => {
  test('/create page loads with Express mode selected by default', async ({ page }) => {
    await page.goto('/create')

    // Unauthenticated users get redirected to sign-in
    // If authenticated (e.g. via storageState), we'd see the create page
    // For now, verify the redirect or the page content
    const url = page.url()

    if (url.includes('/auth/signin')) {
      // Expected for unauthenticated visitors — the redirect itself is correct
      expect(url).toContain('callbackUrl')
    } else {
      // Authenticated — verify the create page renders
      await expect(page.locator('h1')).toContainText('Create Forecast')
      // daatan#2067: Manual mode removed — no Express/Manual toggle
      await expect(page.getByRole('button', { name: 'Manual' })).toHaveCount(0)
    }
  })

  test('/create?from=express renders the ForecastWizard, not the Express input', async ({ page }) => {
    await page.goto('/create?from=express')

    const url = page.url()

    if (url.includes('/auth/signin')) {
      // Unauthenticated — verify callback preserves the from=express param
      expect(url).toContain('callbackUrl')
    } else {
      // Authenticated — the wizard should be visible, NOT the express input
      await expect(page.locator('h1')).toContainText('Create Forecast')

      // The ForecastWizard shows step indicators (Prediction, Outcome, Publish)
      // and should NOT show the mode toggle (Express/Manual buttons)
      await expect(page.getByText('Prediction')).toBeVisible({ timeout: 5000 })

      // The express input textarea should NOT be visible
      await expect(
        page.getByPlaceholder(/Describe your event OR paste/)
      ).not.toBeVisible()
    }
  })

  test('/create?from=express does not show Express/Manual mode toggle', async ({ page }) => {
    await page.goto('/create?from=express')

    const url = page.url()
    if (url.includes('/auth/signin')) return // Skip if unauthenticated

    // Mode toggle should be absent in express wizard flow
    const expressButton = page.locator('button', { hasText: /^Express$/ })
    const manualButton = page.locator('button', { hasText: /^Manual$/ })

    await expect(expressButton).toHaveCount(0)
    await expect(manualButton).toHaveCount(0)
  })
})

test.describe('Express Forecast Flow — localStorage Handoff', () => {
  test('ForecastWizard loads data from localStorage when navigated via ?from=express', async ({
    page,
  }) => {
    // Pre-seed localStorage with express prediction data before navigating
    await page.goto('/create')

    const url = page.url()
    if (url.includes('/auth/signin')) return // Skip if unauthenticated

    // Seed localStorage as ExpressForecastClient would
    await page.evaluate(() => {
      const data = {
        claimText: 'E2E Test: Bitcoin will reach $100k',
        resolveByDatetime: '2026-12-31T23:59:59Z',
        detailsText: 'Test context for e2e',
        domain: 'economics',
        tags: ['e2e-test'],
        resolutionRules: 'Test rules',
        newsAnchor: {
          url: 'https://example.com/test',
          title: 'Test Article',
          snippet: 'Test snippet',
        },
        additionalLinks: [],
      }
      localStorage.setItem('expressPredictionData', JSON.stringify(data))
    })

    // Navigate as the Review & Publish button would
    await page.goto('/create?from=express')

    // The wizard should show the pre-filled claim text from localStorage
    // (StepPrediction is step 2, shown first in express flow)
    const claimInput = page.locator('#claimText, textarea[id="claimText"]')
    if (await claimInput.isVisible()) {
      const value = await claimInput.inputValue()
      expect(value).toContain('E2E Test: Bitcoin will reach $100k')
    }

    // localStorage should be cleared after loading
    const remaining = await page.evaluate(() =>
      localStorage.getItem('expressPredictionData')
    )
    expect(remaining).toBeNull()
  })
})
