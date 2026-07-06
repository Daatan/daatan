import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * Phase 2 of the accessibility compliance plan (docs/ACCESSIBILITY_PLAN.md):
 * automated axe-core sweep of the main flows. Runs against a real Chromium
 * render — unlike jest-axe (jsdom/happy-dom), this can actually compute
 * color contrast.
 */
const PAGES = ['/', '/forecasts', '/leaderboard', '/about']

for (const path of PAGES) {
  test(`${path || '/'} has no automatically detectable WCAG 2 A/AA violations`, async ({ page }) => {
    await page.goto(path)
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()

    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
  })
}
