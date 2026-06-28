import { test, expect } from '@playwright/test'

/**
 * Self-hosted edition behavior (Layer 2). Server boots with
 * DAATAN_EDITION=self_hosted, APP_NAME="Acme Forecasting", AI add-ons OFF.
 */

test.describe('self-hosted branding', () => {
  test('document title uses APP_NAME, not DAATAN', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/Acme Forecasting/)
    await expect(page.getByText('DAATAN')).toHaveCount(0)
  })

  test('robots.txt disallows all (noindex)', async ({ page }) => {
    const res = await page.request.get('/robots.txt')
    expect(res.ok()).toBeTruthy()
    expect(await res.text()).toMatch(/Disallow:\s*\//)
  })
})

test.describe('self-hosted AI gating', () => {
  test('/create offers the manual wizard only — no Express toggle', async ({ page }) => {
    await page.goto('/create')
    // Authenticated via storageState → create page renders (not a signin redirect).
    expect(page.url()).not.toContain('/auth/signin')
    await expect(page.getByText('Express')).toHaveCount(0)
  })

  test('AI API routes are disabled (404)', async ({ page }) => {
    const res = await page.request.post('/api/ai/suggest-tags', {
      data: { claim: 'will this be disabled on a self-host instance' },
    })
    expect(res.status()).toBe(404)
  })

  test('external-market suggest returns no match when markets are off', async ({ page }) => {
    const res = await page.request.post('/api/forecasts/suggest-market', {
      data: { claimText: 'will X happen by Q3' },
    })
    expect(res.ok()).toBeTruthy()
    expect(await res.json()).toEqual({ match: null })
  })
})
