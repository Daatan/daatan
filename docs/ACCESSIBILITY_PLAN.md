# Accessibility compliance plan (IS 5568 / Israeli law)

Plan to bring daatan.com into compliance with Israeli digital accessibility regulations. Written from an engineering-priorities standpoint — legal applicability (revenue threshold, statutory deadlines) should be confirmed with counsel, not inferred from this doc.

## 1. Legal basis (summary, verify with counsel)

- **Law**: Equal Rights for Persons with Disabilities Law (1998) + Accessibility Regulations (2013), enforced via **Israeli Standard 5568 (IS 5568)**, in force since October 2017.
- **Standard**: IS 5568 is essentially **WCAG 2.0 Level AA** with local additions (Hebrew/RTL considerations, an accessibility statement, a published accessibility coordinator contact).
- **Applicability/exemption**: private organizations serving the general public are in scope. Contractors with average annual revenue **≤ NIS 100,000** are exempt; the **NIS 100,000–300,000** band and **≥ NIS 300,000** band have both been in force since October 2020 (small-business grace period expired). **Confirm which band daatan falls into with counsel** — this determines whether compliance is legally mandatory now vs. best-practice.
- **Enforcement**: civil suits for statutory damages up to **NIS 50,000 per violation without proof of harm**, plus administrative fines. No proof of actual damage required — this is what drives urgency independent of the exemption question.
- **Required disclosures**: a published **accessibility statement** (arrangements made, WCAG level claimed, last review date, contact channel) and a published **accessibility coordinator** contact for complaints/suggestions.

Sources: [BOIA overview](https://www.boia.org/blog/israels-digital-accessibility-laws-an-overview), [EqualWeb IS 5568](https://www.equalweb.com/p/43310/8656/israel_standard_5568_compliance), [Deque MENA laws](https://www.deque.com/mena-digital-accessibility-laws/israel/), [SII accessibility arrangements](https://www.sii.org.il/en/accessibility-statement/)

## 2. Current state (audit, 2026-07)

- `<html lang>`/`dir` are set correctly per-locale in `src/app/layout.tsx` (RTL support for Hebrew already works) — good foundation.
- No skip-to-content link anywhere in `src/`.
- No global `:focus-visible` styling in `globals.css` — keyboard focus is whatever the browser default gives per component.
- `eslint-plugin-jsx-a11y` is only a transitive dep of `eslint-config-next`; `.eslintrc.json` doesn't declare or override it explicitly, so a11y lint coverage is whatever `core-web-vitals` bundles by default, unverified.
- `aria-*`/`role` usage is present but thin and inconsistent (~20 files) — e.g. `Sidebar.tsx` has multiple icon-only `<button>`s without `aria-label` (close button at line 308 confirmed missing).
- Forms: 14 files use `<form>`, but only 6 use `<label htmlFor>` — most inputs likely rely on placeholder text alone, which fails WCAG 1.3.1/4.1.2.
- `CookieConsent.tsx` has no focus management or keyboard trap logic when it appears — relies on default tab order.
- No accessibility statement, no accessibility coordinator contact, published anywhere on daatan.com.
- No automated a11y testing: no `jest-axe`, `@axe-core`, `pa11y`, or Lighthouse CI in the repo.
- No documented color-contrast audit of the Tailwind color system (`navy`/`cobalt`/teal).

## 3. Gap → requirement mapping

| Gap | WCAG/IS 5568 criterion | Priority |
|---|---|---|
| No skip-link | 2.4.1 Bypass Blocks | High — cheap, universal impact |
| No focus-visible styling | 2.4.7 Focus Visible | High — affects every keyboard user site-wide |
| Icon-only buttons missing `aria-label` | 4.1.2 Name, Role, Value | High — screen readers can't announce these controls |
| Form inputs without `<label>` | 1.3.1 Info and Relationships, 3.3.2 Labels or Instructions | High — legally one of the most commonly cited defects |
| Cookie consent no focus management | 2.4.3 Focus Order | Medium |
| Color contrast unverified | 1.4.3 Contrast (Minimum) | Medium — needs measurement before it's known to be a gap |
| No accessibility statement/coordinator | IS 5568 disclosure requirement (not a WCAG criterion) | High — legally mandatory disclosure, independent of remediation progress |
| No automated a11y testing | N/A (process gap) | Medium — prevents regression once fixed |
| jsx-a11y lint not explicit | N/A (process gap) | Low effort, do early — catches new violations at PR time |

## 4. Phased plan

**Phase 0 — Tooling & guardrails (prevents backsliding while everything else is fixed)**
- Add `eslint-plugin-jsx-a11y` as a direct dependency, extend `plugin:jsx-a11y/recommended` explicitly in `.eslintrc.json` (don't rely on the implicit bundle).
- Add `jest-axe` to the vitest suite; wire `toHaveNoViolations()` into a handful of key pages/components as a starting baseline (don't try to cover everything at once).
- Add a `docs/ACCESSIBILITY.md` "how we test a11y" doc once the tooling lands (separate from this plan doc).

**Phase 1 — Quick, high-impact fixes**
- Add a skip-to-content link in `layout.tsx`.
- Add global `:focus-visible` outline styles in `globals.css` (respecting the existing color system, not overriding it).
- Audit every icon-only `<button>` across `src/components` (starting with `Sidebar.tsx`) and add `aria-label`.
- Audit the 14 `<form>`-containing files and ensure every input has an associated `<label htmlFor>` or `aria-label`.
- Add focus handling to `CookieConsent.tsx` (move focus to the banner on mount, trap tab order while visible, return focus on dismiss).

**Phase 2 — Verification**
- Run an automated contrast check (axe or Lighthouse) against the Tailwind color system; fix any AA failures (targeted CSS variable adjustments, not a redesign).
- Run Lighthouse/axe CI against the main user flows (home, forecast detail, sign-in, sign-up, admin) and fix what surfaces.
- Manual keyboard-only walkthrough of the primary flows (forecast creation, resolution, commenting) — automated tools don't catch everything (e.g. logical tab order, meaningful focus order in modals).

**Phase 3 — Legal disclosures (can run in parallel with Phase 1/2, no code dependency)**
- Draft and publish an accessibility statement page (`/accessibility` route) — WCAG level claimed, date of last review, known limitations, contact channel.
- Designate an accessibility coordinator and publish their contact info on that same page.
- Confirm with counsel: which revenue band applies, and whether a third-party certified audit is required/recommended for the accessibility statement's claims.

## 5. Sequencing note

Phase 0 and Phase 3 have no dependency on each other or on Phase 1/2 — they can start immediately and in parallel. Phase 2 depends on Phase 1 being substantially done (verifying fixes that don't exist yet is wasted effort). Recommend: Phase 0 + Phase 3 first (low effort, unblocks everything else and satisfies the disclosure requirement immediately), then Phase 1, then Phase 2.

## 6. Open questions for legal/product

1. Which revenue band does daatan.com fall into (exempt / NIS 100k–300k / ≥300k)? Determines urgency, not whether the work is worth doing.
2. Do we need a third-party certified accessibility audit, or is an internal audit + statement sufficient for the initial disclosure?
3. Who is designated as the accessibility coordinator (a real contact, not a generic inbox)?
